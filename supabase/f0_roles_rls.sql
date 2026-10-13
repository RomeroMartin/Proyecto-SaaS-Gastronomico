-- ============================================================================
-- SaaS Gastronómico — Fase 0.1: roles y RLS reales
-- ----------------------------------------------------------------------------
-- Hasta ahora `tenant_all` dejaba leer y escribir TODO a cualquier rol de la
-- empresa (AUDITOR incluido) y las RPC tampoco miraban el rol. Esta migración:
--   • crea rol_en(...) (helper de rol),
--   • reemplaza `tenant_all` por políticas de lectura/escritura por rol según
--     la matriz de docs/plan-ventas-reparto.md,
--   • restringe `usuarios` (cada uno ve su fila; ADMIN/GERENTE ven la empresa;
--     solo ADMIN edita nombre/rol/activo; altas solo por vincular_usuario),
--   • exige rol ADMIN/GERENTE dentro de las RPC de facturas.
-- RRHH ya tenía sus políticas por rol (rrhh.sql) y no se toca.
--
-- Orden: ejecutar DESPUÉS de schema/functions/catalogos/pagos_programados/
-- movimientos_caja/rrhh y sus migraciones. Idempotente.
-- Compatibilidad: el ADMIN y el GERENTE actuales siguen operando igual.
-- ============================================================================

create or replace function rol_en(variadic p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(mi_rol() = any(p_roles), false) $$;
grant execute on function rol_en(text[]) to authenticated;

-- ----------------------------------------------------------------------------
-- Matriz de roles → políticas `leer` / `escribir` por tabla.
-- ----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select * from (values
      -- tabla                      lectura                                       escritura
      ('sucursales',               array['ADMIN','GERENTE','COCINA','AUDITOR'],  array['ADMIN']),
      ('proveedores',              array['ADMIN','GERENTE','COCINA','AUDITOR'],  array['ADMIN','GERENTE']),
      ('facturas',                 array['ADMIN','GERENTE','AUDITOR'],           array['ADMIN','GERENTE']),
      ('pagos',                    array['ADMIN','GERENTE','AUDITOR'],           array['ADMIN','GERENTE']),
      ('pago_imputaciones',        array['ADMIN','GERENTE','AUDITOR'],           array['ADMIN','GERENTE']),
      ('pagos_programados',        array['ADMIN','GERENTE','AUDITOR'],           array['ADMIN','GERENTE']),
      ('movimientos_caja',         array['ADMIN','GERENTE','AUDITOR'],           array['ADMIN','GERENTE']),
      ('insumos',                  array['ADMIN','GERENTE','COCINA','AUDITOR'],  array['ADMIN','GERENTE','COCINA']),
      ('historial_precios_insumo', array['ADMIN','GERENTE','COCINA','AUDITOR'],  array['ADMIN','GERENTE','COCINA']),
      ('recetas',                  array['ADMIN','GERENTE','COCINA','AUDITOR'],  array['ADMIN','GERENTE','COCINA']),
      ('ingredientes_receta',      array['ADMIN','GERENTE','COCINA','AUDITOR'],  array['ADMIN','GERENTE','COCINA']),
      ('catalogos',                array['ADMIN','GERENTE','COCINA','AUDITOR'],  array['ADMIN','GERENTE'])
    ) as t(tabla, lectura, escritura)
  loop
    if to_regclass(r.tabla) is null then continue; end if;   -- tabla opcional aún no creada
    execute format('alter table %I enable row level security', r.tabla);
    execute format('drop policy if exists tenant_all on %I', r.tabla);
    execute format('drop policy if exists leer on %I', r.tabla);
    execute format('drop policy if exists escribir on %I', r.tabla);
    execute format(
      'create policy leer on %I for select to authenticated using (empresa_id = mi_empresa() and rol_en(variadic %L::text[]))',
      r.tabla, r.lectura);
    execute format(
      'create policy escribir on %I for all to authenticated using (empresa_id = mi_empresa() and rol_en(variadic %L::text[])) with check (empresa_id = mi_empresa() and rol_en(variadic %L::text[]))',
      r.tabla, r.escritura, r.escritura);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- usuarios: cada uno ve su fila (aunque esté inactivo, para poder avisarle);
-- ADMIN/GERENTE ven toda la empresa; solo ADMIN edita nombre/rol/activo.
-- Altas únicamente por vincular_usuario() (f0_usuarios.sql); sin bajas.
-- ----------------------------------------------------------------------------
alter table usuarios enable row level security;
drop policy if exists usuarios_read on usuarios;
drop policy if exists usuarios_write on usuarios;
drop policy if exists usuarios_update on usuarios;
drop policy if exists usuarios_leer on usuarios;
drop policy if exists usuarios_actualizar on usuarios;

create policy usuarios_leer on usuarios for select to authenticated
  using (id = auth.uid() or (empresa_id = mi_empresa() and rol_en('ADMIN', 'GERENTE')));

create policy usuarios_actualizar on usuarios for update to authenticated
  using (empresa_id = mi_empresa() and rol_en('ADMIN'))
  with check (empresa_id = mi_empresa() and rol_en('ADMIN'));

revoke insert, update, delete on usuarios from authenticated;
grant update (nombre, rol, activo, modificado_en) on usuarios to authenticated;

-- ----------------------------------------------------------------------------
-- RPC de facturas: ahora exigen rol ADMIN o GERENTE (la RLS no las alcanza
-- porque son SECURITY DEFINER).
-- ----------------------------------------------------------------------------
create or replace function crear_factura(
  p_proveedor_id uuid,
  p_tipo_comprobante char,
  p_numero_factura text,
  p_fecha_emision date,
  p_fecha_vencimiento date,
  p_neto_centavos bigint,
  p_iva_centavos bigint,
  p_percepciones_centavos bigint,
  p_total_centavos bigint,
  p_sucursal_id uuid default null,
  p_observaciones text default null,
  p_otros_impuestos_centavos bigint default 0
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_factura uuid;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN', 'GERENTE') then raise exception 'Sin permiso: tu rol no puede realizar esta operación.'; end if;
  if not exists (select 1 from proveedores where id = p_proveedor_id and empresa_id = v_empresa) then
    raise exception 'Proveedor inexistente en la empresa.';
  end if;
  if (p_neto_centavos + p_iva_centavos + p_percepciones_centavos + p_otros_impuestos_centavos) <> p_total_centavos then
    raise exception 'La factura no cuadra: neto + IVA + percepciones + otros impuestos <> total.';
  end if;

  insert into facturas (
    empresa_id, sucursal_id, proveedor_id, tipo_comprobante, numero_factura,
    fecha_emision, fecha_vencimiento, neto_gravado_centavos, iva_discriminado_centavos,
    percepciones_centavos, otros_impuestos_centavos, monto_total_centavos, saldo_pendiente_centavos, estado,
    observaciones, creado_por
  ) values (
    v_empresa, p_sucursal_id, p_proveedor_id, p_tipo_comprobante, p_numero_factura,
    p_fecha_emision, p_fecha_vencimiento, p_neto_centavos, p_iva_centavos,
    p_percepciones_centavos, p_otros_impuestos_centavos, p_total_centavos, p_total_centavos, 'pendiente',
    p_observaciones, auth.uid()
  ) returning id into v_factura;

  update proveedores
    set saldo_total_deuda_centavos = saldo_total_deuda_centavos + p_total_centavos
    where id = p_proveedor_id;

  return v_factura;
end;
$$;

create or replace function anular_factura(p_factura_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_fac facturas%rowtype;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN', 'GERENTE') then raise exception 'Sin permiso: tu rol no puede realizar esta operación.'; end if;
  select * into v_fac from facturas where id = p_factura_id and empresa_id = v_empresa for update;
  if not found then raise exception 'Factura inexistente.'; end if;
  if v_fac.estado = 'anulada' then raise exception 'La factura ya está anulada.'; end if;
  if v_fac.saldo_pendiente_centavos <> v_fac.monto_total_centavos then
    raise exception 'No se puede anular: la factura ya tiene pagos imputados. Anulá esos pagos primero.';
  end if;

  update facturas set estado = 'anulada', saldo_pendiente_centavos = 0 where id = p_factura_id;

  update proveedores
    set saldo_total_deuda_centavos = saldo_total_deuda_centavos - v_fac.monto_total_centavos
    where id = v_fac.proveedor_id;
end;
$$;

create or replace function editar_factura(
  p_factura_id uuid,
  p_proveedor_id uuid,
  p_tipo_comprobante char(1),
  p_numero_factura varchar,
  p_fecha_emision date,
  p_fecha_vencimiento date,
  p_neto_centavos bigint,
  p_iva_centavos bigint,
  p_percepciones_centavos bigint,
  p_otros_impuestos_centavos bigint,
  p_total_centavos bigint,
  p_observaciones text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_fac facturas%rowtype; v_tiene_pagos boolean;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN', 'GERENTE') then raise exception 'Sin permiso: tu rol no puede realizar esta operación.'; end if;
  select * into v_fac from facturas where id = p_factura_id and empresa_id = v_empresa for update;
  if not found then raise exception 'Factura inexistente.'; end if;
  if v_fac.estado = 'anulada' then raise exception 'Una factura anulada no se puede editar.'; end if;
  if p_total_centavos <= 0 then raise exception 'El total de la factura debe ser mayor a cero.'; end if;
  if (p_neto_centavos + p_iva_centavos + p_percepciones_centavos + p_otros_impuestos_centavos) <> p_total_centavos then
    raise exception 'La factura no cuadra: neto + IVA + percepciones + otros impuestos <> total.';
  end if;
  if p_fecha_emision not between date '2000-01-01' and date '2100-12-31'
     or (p_fecha_vencimiento is not null and p_fecha_vencimiento not between date '2000-01-01' and date '2100-12-31') then
    raise exception 'Fecha inválida: revisá el año (debe estar entre 2000 y 2100).';
  end if;

  v_tiene_pagos := v_fac.saldo_pendiente_centavos <> v_fac.monto_total_centavos;

  if v_tiene_pagos then
    if p_proveedor_id <> v_fac.proveedor_id
       or p_neto_centavos <> v_fac.neto_gravado_centavos
       or p_iva_centavos <> v_fac.iva_discriminado_centavos
       or p_percepciones_centavos <> v_fac.percepciones_centavos
       or p_otros_impuestos_centavos <> v_fac.otros_impuestos_centavos
       or p_total_centavos <> v_fac.monto_total_centavos then
      raise exception 'La factura ya tiene pagos imputados: solo podés corregir comprobante, número, fechas y observaciones. Para cambiar importes o proveedor, anulá primero esos pagos.';
    end if;
  else
    if not exists (select 1 from proveedores where id = p_proveedor_id and empresa_id = v_empresa) then
      raise exception 'Proveedor inexistente en la empresa.';
    end if;
    if p_proveedor_id = v_fac.proveedor_id then
      update proveedores
        set saldo_total_deuda_centavos = saldo_total_deuda_centavos + (p_total_centavos - v_fac.monto_total_centavos)
        where id = p_proveedor_id;
    else
      update proveedores
        set saldo_total_deuda_centavos = saldo_total_deuda_centavos - v_fac.monto_total_centavos
        where id = v_fac.proveedor_id;
      update proveedores
        set saldo_total_deuda_centavos = saldo_total_deuda_centavos + p_total_centavos
        where id = p_proveedor_id;
    end if;
  end if;

  update facturas set
    proveedor_id = p_proveedor_id,
    tipo_comprobante = p_tipo_comprobante,
    numero_factura = nullif(trim(p_numero_factura), ''),
    fecha_emision = p_fecha_emision,
    fecha_vencimiento = p_fecha_vencimiento,
    neto_gravado_centavos = p_neto_centavos,
    iva_discriminado_centavos = p_iva_centavos,
    percepciones_centavos = p_percepciones_centavos,
    otros_impuestos_centavos = p_otros_impuestos_centavos,
    monto_total_centavos = p_total_centavos,
    saldo_pendiente_centavos = case when v_tiene_pagos then v_fac.saldo_pendiente_centavos else p_total_centavos end,
    observaciones = nullif(trim(coalesce(p_observaciones, '')), ''),
    modificado_por = auth.uid()
  where id = p_factura_id;
end;
$$;

grant execute on function crear_factura(uuid, char, text, date, date, bigint, bigint, bigint, bigint, uuid, text, bigint) to authenticated;
grant execute on function anular_factura(uuid) to authenticated;
grant execute on function editar_factura(uuid, uuid, char, varchar, date, date, bigint, bigint, bigint, bigint, bigint, text) to authenticated;
