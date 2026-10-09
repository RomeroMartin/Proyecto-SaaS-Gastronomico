-- ============================================================================
-- SaaS Gastronómico — Funciones (RPC) para Supabase / PostgreSQL
-- ----------------------------------------------------------------------------
-- Operaciones sensibles que el frontend NO debe hacer directo (mueven saldos,
-- imputan pagos, crean empresas). Corren como SECURITY DEFINER: el cliente
-- solo las INVOCA; el aislamiento por empresa se valida adentro con mi_empresa().
-- Esto CIERRA el hueco que la versión Firebase admitía (saldo escribible desde
-- la consola del navegador).
--
-- Ejecutar DESPUÉS de supabase/schema.sql, en Supabase → SQL Editor → Run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- crear_empresa_y_admin — bootstrap self-service (para altas futuras).
-- El usuario autenticado crea SU empresa y queda como ADMIN. Una sola vez.
-- ----------------------------------------------------------------------------
create or replace function crear_empresa_y_admin(
  p_nombre_empresa text,
  p_nombre_usuario text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_uid uuid; v_email text;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'No autenticado.'; end if;
  if exists (select 1 from usuarios where id = v_uid) then
    raise exception 'El usuario ya pertenece a una empresa.';
  end if;
  select email into v_email from auth.users where id = v_uid;

  insert into empresas (nombre, creado_por) values (p_nombre_empresa, v_uid)
    returning id into v_empresa;
  insert into usuarios (id, empresa_id, email, nombre, rol)
    values (v_uid, v_empresa, coalesce(v_email, ''),
            coalesce(nullif(p_nombre_usuario, ''), v_email, 'Administrador'), 'ADMIN');
  return v_empresa;
end;
$$;

-- ----------------------------------------------------------------------------
-- crear_factura — valida cuadratura + suma al saldo del proveedor (atómico).
-- Devuelve el id de la factura creada.
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

-- ----------------------------------------------------------------------------
-- anular_factura — anula una factura sin pagos imputados (Regla 3.4: no se
-- edita, se anula). Revierte la deuda que había generado en el proveedor.
-- Si ya tiene pagos aplicados, hay que anular esos pagos primero.
-- ----------------------------------------------------------------------------
create or replace function anular_factura(p_factura_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_fac facturas%rowtype;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
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

-- ----------------------------------------------------------------------------
-- registrar_pago — imputa FIFO (o manual) a las facturas del proveedor.
-- p_modo_imputacion: 'fifo' | 'manual'. En manual, p_factura_ids da el orden.
-- Devuelve el id del pago. El excedente baja igual el saldo (queda a favor).
-- ----------------------------------------------------------------------------
create or replace function registrar_pago(
  p_proveedor_id uuid,
  p_monto_centavos bigint,
  p_metodo_pago text default 'transferencia',
  p_referencia text default null,
  p_fecha_pago date default null,
  p_modo_imputacion text default 'fifo',
  p_factura_ids uuid[] default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_pago uuid; v_restante bigint; v_aplica bigint; f record;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if p_monto_centavos <= 0 then raise exception 'El monto del pago debe ser mayor a cero.'; end if;
  if not exists (select 1 from proveedores where id = p_proveedor_id and empresa_id = v_empresa) then
    raise exception 'Proveedor inexistente en la empresa.';
  end if;

  insert into pagos (
    empresa_id, proveedor_id, fecha_pago, monto_pagado_centavos, metodo_pago,
    referencia, modo_imputacion, estado, creado_por
  ) values (
    v_empresa, p_proveedor_id, coalesce(p_fecha_pago, current_date), p_monto_centavos,
    coalesce(p_metodo_pago, 'transferencia'), p_referencia,
    case when p_modo_imputacion = 'manual' then 'manual' else 'fifo' end, 'activo', auth.uid()
  ) returning id into v_pago;

  v_restante := p_monto_centavos;

  for f in
    select id, saldo_pendiente_centavos, monto_total_centavos
    from facturas
    where empresa_id = v_empresa and proveedor_id = p_proveedor_id
      and estado <> 'anulada' and activo = true and saldo_pendiente_centavos > 0
      and (p_modo_imputacion <> 'manual' or id = any(coalesce(p_factura_ids, '{}'::uuid[])))
    order by
      case when p_modo_imputacion = 'manual'
           then array_position(p_factura_ids, id) end asc nulls last,
      fecha_emision asc
    for update
  loop
    exit when v_restante <= 0;
    v_aplica := least(v_restante, f.saldo_pendiente_centavos);

    insert into pago_imputaciones (empresa_id, pago_id, factura_id, monto_imputado_centavos)
      values (v_empresa, v_pago, f.id, v_aplica);

    -- En el CASE, saldo_pendiente_centavos es el valor ANTERIOR (pre-update).
    update facturas
      set saldo_pendiente_centavos = saldo_pendiente_centavos - v_aplica,
          estado = case
            when saldo_pendiente_centavos - v_aplica <= 0 then 'pagada'
            when saldo_pendiente_centavos - v_aplica >= monto_total_centavos then 'pendiente'
            else 'parcial' end
      where id = f.id;

    v_restante := v_restante - v_aplica;
  end loop;

  update proveedores
    set saldo_total_deuda_centavos = saldo_total_deuda_centavos - p_monto_centavos
    where id = p_proveedor_id;

  return v_pago;
end;
$$;

-- ----------------------------------------------------------------------------
-- anular_pago — contraasiento: revierte imputaciones y saldos, marca el
-- original como anulado. Nada se edita ni se borra (Regla 3.4).
-- ----------------------------------------------------------------------------
create or replace function anular_pago(p_pago_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_orig pagos%rowtype; v_contra uuid; imp record;
begin
  v_empresa := mi_empresa();
  select * into v_orig from pagos where id = p_pago_id and empresa_id = v_empresa for update;
  if not found then raise exception 'Pago inexistente.'; end if;
  if v_orig.estado = 'anulado' then raise exception 'El pago ya está anulado.'; end if;

  insert into pagos (
    empresa_id, proveedor_id, fecha_pago, monto_pagado_centavos, metodo_pago,
    referencia, modo_imputacion, estado, anula_a_pago_id, creado_por
  ) values (
    v_empresa, v_orig.proveedor_id, current_date, -v_orig.monto_pagado_centavos, v_orig.metodo_pago,
    'ANULACIÓN de pago ' || p_pago_id::text, v_orig.modo_imputacion, 'activo', p_pago_id, auth.uid()
  ) returning id into v_contra;

  for imp in
    select factura_id, monto_imputado_centavos from pago_imputaciones where pago_id = p_pago_id
  loop
    update facturas
      set saldo_pendiente_centavos = saldo_pendiente_centavos + imp.monto_imputado_centavos,
          estado = case
            when saldo_pendiente_centavos + imp.monto_imputado_centavos >= monto_total_centavos then 'pendiente'
            when saldo_pendiente_centavos + imp.monto_imputado_centavos <= 0 then 'pagada'
            else 'parcial' end
      where id = imp.factura_id;

    insert into pago_imputaciones (empresa_id, pago_id, factura_id, monto_imputado_centavos)
      values (v_empresa, v_contra, imp.factura_id, -imp.monto_imputado_centavos);
  end loop;

  update pagos set estado = 'anulado', anulado_por_pago_id = v_contra where id = p_pago_id;
  update proveedores
    set saldo_total_deuda_centavos = saldo_total_deuda_centavos + v_orig.monto_pagado_centavos
    where id = v_orig.proveedor_id;

  return v_contra;
end;
$$;

-- ----------------------------------------------------------------------------
-- Permisos: solo usuarios autenticados pueden invocar las RPC.
-- ----------------------------------------------------------------------------
grant execute on function crear_empresa_y_admin(text, text) to authenticated;
grant execute on function crear_factura(uuid, char, text, date, date, bigint, bigint, bigint, bigint, uuid, text, bigint) to authenticated;
grant execute on function anular_factura(uuid) to authenticated;
grant execute on function registrar_pago(uuid, bigint, text, text, date, text, uuid[]) to authenticated;
grant execute on function anular_pago(uuid) to authenticated;

-- ============================================================================
-- FIN. Para el PRIMER usuario/empresa, ver supabase/bootstrap.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- editar_factura — corrige una factura (ver supabase/migracion_editar_factura.sql).
-- ----------------------------------------------------------------------------
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

grant execute on function editar_factura(uuid, uuid, char, varchar, date, date, bigint, bigint, bigint, bigint, bigint, text) to authenticated;
