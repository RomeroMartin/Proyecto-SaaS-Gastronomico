-- ============================================================================
-- SaaS Gastronómico — FASE 0 completa (generado con gen_todo.sh: no editar a mano)
-- Pegar y ejecutar UNA vez en el SQL Editor de Supabase, DESPUÉS de haber
-- corrido todos los scripts anteriores. Es idempotente: se puede re-ejecutar.
-- Orden: roles_rls, auditoria, usuarios, empresas_columnas, zona_horaria,
--        integridad, costeo, rpc_atomicas.
-- ============================================================================

-- >>>>>>>>>> f0_roles_rls.sql
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

-- >>>>>>>>>> f0_auditoria.sql
-- ============================================================================
-- SaaS Gastronómico — Fase 0.8: auditoría
-- ----------------------------------------------------------------------------
-- Rastro de lo sensible: cambios de rol/estado de usuarios, vínculo de
-- usuarios, parámetros de empresa y (en fases siguientes) alias de cobro,
-- anulaciones y reaperturas de caja.
--   • Solo ADMIN puede LEER la tabla.
--   • Nadie escribe directo: la llenan las RPC/triggers SECURITY DEFINER a
--     través de auditar().
-- Orden: después de f0_roles_rls.sql (usa rol_en). Idempotente.
-- ============================================================================

create table if not exists auditoria (
  id          uuid primary key default uuid_generate_v4(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  usuario_id  uuid,
  accion      varchar(60) not null,   -- 'cambio_usuario', 'vincular_usuario', 'config_empresa', …
  entidad     varchar(40),
  entidad_id  uuid,
  antes       jsonb,
  despues     jsonb,
  creado_en   timestamptz not null default now()
);
create index if not exists ix_auditoria_empresa on auditoria(empresa_id, creado_en desc);

alter table auditoria enable row level security;
drop policy if exists leer on auditoria;
create policy leer on auditoria for select to authenticated
  using (empresa_id = mi_empresa() and rol_en('ADMIN'));
revoke insert, update, delete on auditoria from authenticated;

-- Registra un evento de auditoría de la empresa del usuario actual.
-- Es interna: la usan las RPC/triggers; el cliente no la invoca.
create or replace function auditar(
  p_accion text, p_entidad text, p_entidad_id uuid, p_antes jsonb, p_despues jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then
    -- Contexto sin usuario (mantenimiento): se toma la empresa de la entidad si es posible.
    return;
  end if;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, antes, despues)
  values (v_empresa, auth.uid(), p_accion, p_entidad, p_entidad_id, p_antes, p_despues);
end;
$$;
revoke all on function auditar(text, text, uuid, jsonb, jsonb) from public, authenticated;

-- >>>>>>>>>> f0_usuarios.sql
-- ============================================================================
-- SaaS Gastronómico — Fase 0.3: usuarios activos, rol CAJERO y alta de usuarios
-- ----------------------------------------------------------------------------
--   • mi_empresa()/mi_rol() ignoran a los usuarios INACTIVOS (antes un usuario
--     desactivado seguía viendo todos los datos).
--   • Se agrega el rol CAJERO.
--   • vincular_usuario(email, rol, nombre): el ADMIN vincula a su empresa una
--     cuenta ya creada en Supabase → Authentication → Users.
--   • Salvaguardas (trigger): siempre queda al menos un ADMIN activo y nadie
--     puede desactivarse a sí mismo. Los cambios de rol/estado se auditan.
-- Orden: después de f0_roles_rls.sql y f0_auditoria.sql. Idempotente.
-- ============================================================================

alter table usuarios drop constraint if exists usuarios_rol_check;
alter table usuarios add constraint usuarios_rol_check
  check (rol in ('ADMIN','GERENTE','COCINA','AUDITOR','CAJERO'));

create or replace function mi_empresa()
returns uuid language plpgsql stable security definer set search_path = public as $$
begin
  return (select empresa_id from public.usuarios where id = auth.uid() and activo);
end;
$$;

create or replace function mi_rol()
returns text language plpgsql stable security definer set search_path = public as $$
begin
  return (select rol from public.usuarios where id = auth.uid() and activo);
end;
$$;

-- modificado_en automático (el cliente ya no tiene que mandarlo).
drop trigger if exists trg_mod_usuarios on usuarios;
create trigger trg_mod_usuarios before update on usuarios
  for each row execute function set_modificado_en();

-- ----------------------------------------------------------------------------
-- Salvaguardas y auditoría de cambios de rol / estado.
-- ----------------------------------------------------------------------------
create or replace function usuarios_cambio()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.rol is distinct from old.rol or new.activo is distinct from old.activo then
    -- Nadie se desactiva a sí mismo.
    if new.activo = false and old.activo and auth.uid() is not null and auth.uid() = new.id then
      raise exception 'No podés desactivar tu propio usuario.';
    end if;
    -- Siempre debe quedar al menos un ADMIN activo.
    if old.rol = 'ADMIN' and old.activo and (new.rol <> 'ADMIN' or new.activo = false) then
      if not exists (
        select 1 from usuarios u
        where u.empresa_id = old.empresa_id and u.id <> old.id and u.rol = 'ADMIN' and u.activo
      ) then
        raise exception 'Debe quedar al menos un ADMIN activo en la empresa.';
      end if;
    end if;
    perform auditar('cambio_usuario', 'usuarios', new.id,
      jsonb_build_object('email', old.email, 'rol', old.rol, 'activo', old.activo),
      jsonb_build_object('email', new.email, 'rol', new.rol, 'activo', new.activo));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_usuarios_cambio on usuarios;
create trigger trg_usuarios_cambio before update on usuarios
  for each row execute function usuarios_cambio();

-- ----------------------------------------------------------------------------
-- vincular_usuario — alta de un usuario en la empresa del ADMIN.
-- Paso previo (manual): crear la cuenta en Supabase → Authentication → Users.
-- ----------------------------------------------------------------------------
create or replace function vincular_usuario(
  p_email text, p_rol text, p_nombre text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_uid uuid; v_email text; v_pert uuid;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN') then raise exception 'Sin permiso: solo un ADMIN puede agregar usuarios.'; end if;
  if p_rol is null or p_rol not in ('ADMIN','GERENTE','COCINA','AUDITOR','CAJERO') then
    raise exception 'Rol inválido.';
  end if;

  select id, email into v_uid, v_email from auth.users
    where lower(email) = lower(trim(coalesce(p_email, ''))) limit 1;
  if v_uid is null then
    raise exception 'No existe una cuenta con ese email. Creala primero en Supabase → Authentication → Users.';
  end if;

  select empresa_id into v_pert from usuarios where id = v_uid;
  if v_pert is not null then
    if v_pert = v_empresa then raise exception 'Ese usuario ya pertenece a tu empresa.'; end if;
    raise exception 'Ese email ya está vinculado a otra empresa.';
  end if;

  insert into usuarios (id, empresa_id, email, nombre, rol)
    values (v_uid, v_empresa, v_email, coalesce(nullif(trim(p_nombre), ''), v_email), p_rol);

  perform auditar('vincular_usuario', 'usuarios', v_uid, null,
    jsonb_build_object('email', v_email, 'rol', p_rol));
  return v_uid;
end;
$$;
grant execute on function vincular_usuario(text, text, text) to authenticated;

-- >>>>>>>>>> f0_empresas_columnas.sql
-- ============================================================================
-- SaaS Gastronómico — Fase 0.2: `empresas` con lectura general y escritura mínima
-- ----------------------------------------------------------------------------
-- Antes cualquier rol podía modificar la empresa (tenant_all). Ahora:
--   • todos los roles de la empresa la LEEN;
--   • solo ADMIN actualiza, y únicamente nombre / cuit_rut / costea_con_iva
--     (permisos por columna);
--   • los parámetros sensibles (zona_horaria, condicion_fiscal y, en fases
--     siguientes, alias de cobro, módulos, etc.) se cambian SOLO por
--     set_config_empresa(), que valida el rol y deja rastro en `auditoria`.
-- Parámetros nuevos:
--   zona_horaria     default 'America/Argentina/Buenos_Aires'
--   condicion_fiscal default 'monotributo' (el costeo actual no cambia)
-- Orden: después de f0_roles_rls.sql, f0_auditoria.sql y f0_usuarios.sql. Idempotente.
-- ============================================================================

alter table empresas add column if not exists zona_horaria text not null
  default 'America/Argentina/Buenos_Aires';
alter table empresas add column if not exists condicion_fiscal varchar(30) not null
  default 'monotributo';
alter table empresas drop constraint if exists empresas_condicion_fiscal_check;
alter table empresas add constraint empresas_condicion_fiscal_check
  check (condicion_fiscal in ('monotributo','responsable_inscripto','exento'));

drop policy if exists tenant_all on empresas;
drop policy if exists empresas_leer on empresas;
drop policy if exists empresas_actualizar on empresas;

create policy empresas_leer on empresas for select to authenticated
  using (id = mi_empresa());
create policy empresas_actualizar on empresas for update to authenticated
  using (id = mi_empresa() and rol_en('ADMIN'))
  with check (id = mi_empresa() and rol_en('ADMIN'));

revoke insert, update, delete on empresas from authenticated;
grant update (nombre, cuit_rut, costea_con_iva) on empresas to authenticated;

-- ----------------------------------------------------------------------------
-- set_config_empresa(clave, valor) — único camino para parámetros sensibles.
-- Lista blanca de claves; valida tipo y valor; audita antes/después.
-- ----------------------------------------------------------------------------
create or replace function set_config_empresa(p_clave text, p_valor jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_antes jsonb; v_txt text;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN') then raise exception 'Sin permiso: solo un ADMIN puede cambiar la configuración.'; end if;

  v_txt := p_valor #>> '{}';
  if p_clave = 'zona_horaria' then
    if v_txt is null or not exists (select 1 from pg_timezone_names where name = v_txt) then
      raise exception 'Zona horaria inválida.';
    end if;
    select to_jsonb(zona_horaria) into v_antes from empresas where id = v_empresa;
    update empresas set zona_horaria = v_txt where id = v_empresa;
  elsif p_clave = 'condicion_fiscal' then
    if v_txt is null or v_txt not in ('monotributo','responsable_inscripto','exento') then
      raise exception 'Condición fiscal inválida.';
    end if;
    select to_jsonb(condicion_fiscal) into v_antes from empresas where id = v_empresa;
    update empresas set condicion_fiscal = v_txt where id = v_empresa;
  else
    raise exception 'Parámetro desconocido: %.', p_clave;
  end if;

  perform auditar('config_empresa', 'empresas', v_empresa,
    jsonb_build_object(p_clave, v_antes), jsonb_build_object(p_clave, p_valor));
end;
$$;
grant execute on function set_config_empresa(text, jsonb) to authenticated;

-- >>>>>>>>>> f0_zona_horaria.sql
-- ============================================================================
-- SaaS Gastronómico — Fase 0.4: fechas en la zona horaria de la empresa
-- ----------------------------------------------------------------------------
-- La base corre en UTC: entre las 21:00 y las 24:00 de Argentina,
-- `current_date` ya es "mañana". Toda la lógica de negocio usa ahora
-- hoy_empresa(), que toma la zona de la empresa (empresas.zona_horaria,
-- default America/Argentina/Buenos_Aires).
--   • fecha_en_zona(instante, zona): función pura (testeable con instantes fijos).
--   • hoy_empresa(): la fecha de hoy en la zona de la empresa del usuario.
--   • vw_sueldo_vigente usa hoy_empresa() (las demás vistas de RRHH y las RPC de
--     pagos se redefinen en f0_integridad.sql).
-- Orden: después de f0_empresas_columnas.sql. Idempotente.
-- ============================================================================

create or replace function fecha_en_zona(p_instante timestamptz, p_zona text)
returns date language sql immutable as $$
  select (p_instante at time zone coalesce(nullif(p_zona, ''), 'America/Argentina/Buenos_Aires'))::date $$;

create or replace function hoy_empresa()
returns date language sql stable security definer set search_path = public as $$
  select fecha_en_zona(now(), (select zona_horaria from empresas where id = mi_empresa())) $$;

grant execute on function fecha_en_zona(timestamptz, text) to authenticated;
grant execute on function hoy_empresa() to authenticated;

-- Defaults de fecha que dependían de current_date.
alter table pagos alter column fecha_pago set default hoy_empresa();

-- Sueldo vigente hoy, por empleado.
create or replace view vw_sueldo_vigente
with (security_invoker = true) as
select distinct on (empleado_id)
  empleado_id, monto_centavos, tipo, vigencia_desde, motivo
from empleados_sueldos
where vigencia_desde <= hoy_empresa()
order by empleado_id, vigencia_desde desc;

-- >>>>>>>>>> f0_integridad.sql
-- ============================================================================
-- SaaS Gastronómico — Fase 0.5: integridad financiera y bajas lógicas
-- ----------------------------------------------------------------------------
--   • registrar_pago / anular_pago: exigen rol ADMIN/GERENTE, usan la fecha de
--     la empresa (hoy_empresa) y anular_pago RECHAZA anular un contraasiento
--     (antes dejaba la contabilidad incoherente si se llamaba directo).
--   • RRHH: `documentos` y `ausencias` pasan a BAJA LÓGICA (columna `activo`);
--     el cliente ya no puede hacer DELETE. La restricción de ausencias sin
--     solapamiento solo considera las activas. Las vistas filtran las activas
--     y usan la fecha de la empresa.
-- Orden: después de f0_zona_horaria.sql. Idempotente.
-- Compatibilidad: el DELETE de documentos/ausencias desde la app anterior
-- falla → se publica junto con la versión nueva del frontend.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- registrar_pago — imputa FIFO (o manual) a las facturas del proveedor.
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
  if not rol_en('ADMIN', 'GERENTE') then raise exception 'Sin permiso: tu rol no puede realizar esta operación.'; end if;
  if p_monto_centavos <= 0 then raise exception 'El monto del pago debe ser mayor a cero.'; end if;
  if not exists (select 1 from proveedores where id = p_proveedor_id and empresa_id = v_empresa) then
    raise exception 'Proveedor inexistente en la empresa.';
  end if;

  insert into pagos (
    empresa_id, proveedor_id, fecha_pago, monto_pagado_centavos, metodo_pago,
    referencia, modo_imputacion, estado, creado_por
  ) values (
    v_empresa, p_proveedor_id, coalesce(p_fecha_pago, hoy_empresa()), p_monto_centavos,
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
-- anular_pago — contraasiento: revierte imputaciones y saldos.
-- ----------------------------------------------------------------------------
create or replace function anular_pago(p_pago_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_orig pagos%rowtype; v_contra uuid; imp record;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN', 'GERENTE') then raise exception 'Sin permiso: tu rol no puede realizar esta operación.'; end if;
  select * into v_orig from pagos where id = p_pago_id and empresa_id = v_empresa for update;
  if not found then raise exception 'Pago inexistente.'; end if;
  if v_orig.estado = 'anulado' then raise exception 'El pago ya está anulado.'; end if;
  if v_orig.anula_a_pago_id is not null then raise exception 'No se puede anular un contraasiento.'; end if;

  insert into pagos (
    empresa_id, proveedor_id, fecha_pago, monto_pagado_centavos, metodo_pago,
    referencia, modo_imputacion, estado, anula_a_pago_id, creado_por
  ) values (
    v_empresa, v_orig.proveedor_id, hoy_empresa(), -v_orig.monto_pagado_centavos, v_orig.metodo_pago,
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

grant execute on function registrar_pago(uuid, bigint, text, text, date, text, uuid[]) to authenticated;
grant execute on function anular_pago(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- RRHH: baja lógica de documentos y ausencias.
-- ----------------------------------------------------------------------------
alter table documentos add column if not exists activo boolean not null default true;
alter table ausencias  add column if not exists activo boolean not null default true;
revoke delete on documentos, ausencias from authenticated;

-- Sin solapamiento SOLO entre ausencias activas.
alter table ausencias drop constraint if exists ausencias_sin_solape;
alter table ausencias add constraint ausencias_sin_solape
  exclude using gist (
    empleado_id with =,
    daterange(desde, hasta, '[]') with &&
  ) where (activo);

-- Estado de documentación (solo activos), con la fecha de la empresa.
create or replace view vw_documentos_estado
with (security_invoker = true) as
select
  d.id,
  d.empleado_id,
  e.empresa_id,
  e.nombre || ' ' || e.apellido as empleado,
  td.nombre as tipo,
  d.fecha_vencimiento,
  (d.fecha_vencimiento - hoy_empresa()) as dias_restantes,
  case
    when d.fecha_vencimiento is null then 'sin_vencimiento'
    when d.fecha_vencimiento < hoy_empresa() then 'vencido'
    when d.fecha_vencimiento <= hoy_empresa() + 30 then 'por_vencer'
    else 'vigente'
  end as estado
from documentos d
join empleados e on e.id = d.empleado_id
join tipos_documento td on td.id = d.tipo_documento_id
where e.estado = 'activo' and d.activo;

-- Saldo de vacaciones del año en curso (solo ausencias activas).
create or replace view vw_saldo_vacaciones
with (security_invoker = true) as
select
  e.id as empleado_id,
  e.empresa_id,
  e.nombre || ' ' || e.apellido as empleado,
  dias_vacaciones(e.id, extract(year from hoy_empresa())::int) as corresponden,
  coalesce(sum(a.dias), 0)::int as tomados,
  dias_vacaciones(e.id, extract(year from hoy_empresa())::int)
    - coalesce(sum(a.dias), 0)::int as saldo
from empleados e
left join ausencias a
  on a.empleado_id = e.id
 and a.activo
 and a.tipo = 'vacaciones'
 and extract(year from a.desde) = extract(year from hoy_empresa())
where e.estado = 'activo'
group by e.id;

-- >>>>>>>>>> f0_costeo.sql
-- ============================================================================
-- SaaS Gastronómico — Fase 0.7: costeo en SQL (fuente única de verdad)
-- ----------------------------------------------------------------------------
-- El costo de una receta se calculaba SOLO en el navegador y se guardaba como
-- snapshot (`costo_calculado_centavos`): podía quedar viejo, y Ventas lo usa
-- como costo al momento de la venta. Ahora lo calcula la base:
--   • costo_receta(receta)   costo actual (centavos, fraccionario). Misma fórmula
--                            que js/core/costeo.js (hay test de paridad):
--                              insumo:   cantidad × neto × (1 + IVA%) ÷ factor
--                              receta:   cantidad × costo_sub ÷ rendimiento_sub
--                            Ignora insumos/sub-recetas dados de baja; rechaza
--                            ciclos y más de 4 niveles de sub-recetas.
--   • recalcular_costos()    refresca el snapshot de TODAS las recetas.
--   • triggers: si cambia el costo/IVA/factor de un insumo o se da de baja un
--     insumo/receta, el snapshot se recalcula solo (sin pasar por el navegador).
-- Precisión: el costo por unidad base pasa de centavos ENTEROS a numeric(18,6)
-- (un insumo de $125/kg = 12,5 ¢/g ya no se redondea a 13 ¢).
-- `ingredientes_receta.porcentaje_merma` queda DEPRECADA: no se usa ni acá ni en
-- el JS (la merma se modela con `insumos.factor_correccion`). Se elimina cuando
-- ya no haya clientes de la versión anterior.
-- Orden: después de f0_roles_rls.sql (usa rol_en). Idempotente.
-- ============================================================================

-- ---- Precisión del costo por unidad base ----
do $$
declare c record;
begin
  for c in select * from (values
      ('insumos','costo_neto_por_unidad_base_centavos'),
      ('historial_precios_insumo','costo_anterior_centavos'),
      ('historial_precios_insumo','costo_nuevo_centavos')) v(t,col)
  loop
    -- Solo si todavía no tiene la precisión nueva (re-ejecutable aunque existan triggers).
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = c.t and column_name = c.col
                     and numeric_precision = 18 and numeric_scale = 6) then
      execute format('alter table %I alter column %I type numeric(18,6)', c.t, c.col);
    end if;
  end loop;
end $$;

comment on column ingredientes_receta.porcentaje_merma is
  'DEPRECADA: no se usa. La merma se modela con insumos.factor_correccion.';

-- ---- Costeo recursivo (INTERNA: no se expone; no valida empresa) ----
create or replace function _costo_receta(p_receta uuid, p_pila uuid[], p_prof int)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v_total numeric;
begin
  if p_prof > 4 then
    raise exception 'Se superó la profundidad máxima de sub-recetas (4).';
  end if;
  if p_receta = any (p_pila) then
    raise exception 'Referencia circular entre sub-recetas.';
  end if;

  select coalesce(sum(
    case
      when ir.insumo_id is not null then
        ir.cantidad * (i.costo_neto_por_unidad_base_centavos * (1 + i.alicuota_iva / 100.0)
                       / coalesce(nullif(i.factor_correccion, 0), 1))
      else
        ir.cantidad * (_costo_receta(ir.subreceta_hija_id, p_pila || p_receta, p_prof + 1)
                       / coalesce(nullif(s.rendimiento_cantidad, 0), 1))
    end), 0)
  into v_total
  from ingredientes_receta ir
  left join insumos i on i.id = ir.insumo_id and i.activo
  left join recetas s on s.id = ir.subreceta_hija_id and s.activo
  where ir.receta_padre_id = p_receta
    and (i.id is not null or s.id is not null);   -- se ignoran los dados de baja

  return v_total;
end;
$$;
revoke all on function _costo_receta(uuid, uuid[], int) from public, authenticated;

-- ---- Recalcula el snapshot de todas las recetas de una empresa (INTERNA) ----
-- Acumula en `app.recalculadas` (local a la transacción) cuántas cambiaron, para
-- que las RPC puedan informarlo.
create or replace function _recalcular_costos(p_empresa uuid)
returns int language plpgsql security definer set search_path = public as $$
declare r record; v_costo numeric; n int := 0;
begin
  for r in select id, costo_calculado_centavos from recetas where empresa_id = p_empresa and activo loop
    begin
      v_costo := round(_costo_receta(r.id, '{}'::uuid[], 0));
    exception when others then
      continue;   -- ciclo o profundidad excedida: se omite (igual que el JS)
    end;
    if v_costo is distinct from r.costo_calculado_centavos then
      update recetas set costo_calculado_centavos = v_costo, fecha_calculo = now() where id = r.id;
      n := n + 1;
    end if;
  end loop;
  perform set_config('app.recalculadas',
    (coalesce(nullif(current_setting('app.recalculadas', true), ''), '0')::int + n)::text, true);
  return n;
end;
$$;
revoke all on function _recalcular_costos(uuid) from public, authenticated;

-- ---- API pública ----
create or replace function costo_receta(p_receta uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v_empresa uuid;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN', 'GERENTE', 'COCINA', 'AUDITOR') then
    raise exception 'Sin permiso: tu rol no puede realizar esta operación.';
  end if;
  if not exists (select 1 from recetas where id = p_receta and empresa_id = v_empresa) then
    raise exception 'Receta inexistente.';
  end if;
  return _costo_receta(p_receta, '{}'::uuid[], 0);
end;
$$;

create or replace function recalcular_costos()
returns int language plpgsql security definer set search_path = public as $$
declare v_empresa uuid;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN', 'GERENTE', 'COCINA') then
    raise exception 'Sin permiso: tu rol no puede realizar esta operación.';
  end if;
  return _recalcular_costos(v_empresa);
end;
$$;

grant execute on function costo_receta(uuid) to authenticated;
grant execute on function recalcular_costos() to authenticated;

-- ---- Triggers: el snapshot no puede quedar viejo ----
create or replace function _trg_recalcular_costos()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform _recalcular_costos(new.empresa_id);
  return null;
end;
$$;
revoke all on function _trg_recalcular_costos() from public, authenticated;

drop trigger if exists trg_insumo_recalcula on insumos;
create trigger trg_insumo_recalcula
  after update of costo_neto_por_unidad_base_centavos, alicuota_iva, factor_correccion, activo on insumos
  for each row execute function _trg_recalcular_costos();

drop trigger if exists trg_receta_recalcula on recetas;
create trigger trg_receta_recalcula
  after update of activo, rendimiento_cantidad on recetas
  for each row execute function _trg_recalcular_costos();

-- >>>>>>>>>> f0_rpc_atomicas.sql
-- ============================================================================
-- SaaS Gastronómico — Fase 0.6: operaciones atómicas y códigos sin carrera
-- ----------------------------------------------------------------------------
-- Antes el navegador hacía varias escrituras sueltas (borrar ingredientes y
-- reinsertarlos; insumo + historial; calcular el próximo código leyendo y
-- luego insertando). Si algo fallaba a mitad de camino quedaban recetas vacías
-- o códigos repetidos. Ahora cada operación es UNA transacción:
--   • guardar_receta(id, datos, ingredientes)   receta + ingredientes + costos
--   • crear_insumo(datos)                       insumo + primer punto de historial
--   • actualizar_costo_insumo(...)              costo + historial + recálculo
--   • actualizar_insumo(id, datos, costo, ...)  datos + (opcional) costo, juntos
--   • códigos INS-/REC-/PROV- asignados por trigger con bloqueo (sin duplicados)
-- Roles: ADMIN, GERENTE y COCINA (como la matriz de insumos/recetas).
-- Orden: después de f0_costeo.sql. Idempotente.
-- ============================================================================

-- ---- Códigos legibles sin carrera ----
create or replace function siguiente_codigo(p_empresa uuid, p_tabla text, p_prefijo text)
returns text language plpgsql security definer set search_path = public as $$
declare v_max int;
begin
  if p_tabla not in ('insumos', 'recetas', 'proveedores') then raise exception 'Tabla inválida.'; end if;
  -- Bloqueo de la transacción: dos altas simultáneas no pueden sacar el mismo número.
  perform pg_advisory_xact_lock(hashtext('cod:' || p_empresa::text || ':' || p_tabla));
  execute format(
    'select coalesce(max((regexp_match(codigo, %L))[1]::int), 0) from %I where empresa_id = $1',
    '^' || p_prefijo || '-([0-9]+)$', p_tabla)
  into v_max using p_empresa;
  return p_prefijo || '-' || lpad((v_max + 1)::text, 3, '0');
end;
$$;
revoke all on function siguiente_codigo(uuid, text, text) from public, authenticated;

create or replace function _trg_asignar_codigo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.codigo is null or btrim(new.codigo) = '' then
    new.codigo := siguiente_codigo(new.empresa_id, tg_table_name, tg_argv[0]);
  end if;
  return new;
end;
$$;
revoke all on function _trg_asignar_codigo() from public, authenticated;

drop trigger if exists trg_codigo_insumos on insumos;
create trigger trg_codigo_insumos before insert on insumos
  for each row execute function _trg_asignar_codigo('INS');
drop trigger if exists trg_codigo_recetas on recetas;
create trigger trg_codigo_recetas before insert on recetas
  for each row execute function _trg_asignar_codigo('REC');
drop trigger if exists trg_codigo_proveedores on proveedores;
create trigger trg_codigo_proveedores before insert on proveedores
  for each row execute function _trg_asignar_codigo('PROV');

-- Índice único por empresa (si ya hubiera códigos repetidos se avisa y se sigue).
do $$
declare t text;
begin
  foreach t in array array['insumos', 'recetas', 'proveedores'] loop
    begin
      execute format('create unique index if not exists uq_%s_codigo on %I (empresa_id, codigo) where codigo is not null', t, t);
    exception when unique_violation then
      raise notice 'Hay códigos repetidos en %: no se creó el índice único; corregilos y volvé a correr este script.', t;
    end;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- guardar_receta — crea (p_id null) o actualiza una receta con sus ingredientes.
-- p_datos: nombre, tipo, rendimiento_cantidad, rendimiento_unidad,
--          precio_venta_publico_centavos, alicuota_venta, sector_venta
-- p_ingredientes: [{tipo:'insumo'|'receta', ref_id, cantidad}]
-- Todo o nada: si hay un ciclo, un ingrediente inexistente o cualquier error,
-- la receta queda exactamente como estaba.
-- ----------------------------------------------------------------------------
create or replace function guardar_receta(p_id uuid, p_datos jsonb, p_ingredientes jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_empresa uuid; v_id uuid; v_nombre text; v_tipo text;
  ing jsonb; v_orden int := 0; v_cant numeric; v_ref uuid; v_t text;
  v_rend numeric; v_unidad text; v_precio bigint; v_ali numeric; v_sector text;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN', 'GERENTE', 'COCINA') then
    raise exception 'Sin permiso: tu rol no puede realizar esta operación.';
  end if;

  v_nombre := btrim(coalesce(p_datos ->> 'nombre', ''));
  if v_nombre = '' then raise exception 'El nombre es obligatorio.'; end if;
  v_tipo := case when p_datos ->> 'tipo' = 'preparacion' then 'preparacion' else 'plato' end;
  if p_ingredientes is null or jsonb_typeof(p_ingredientes) <> 'array' or jsonb_array_length(p_ingredientes) = 0 then
    raise exception 'Agregá al menos un ingrediente.';
  end if;

  v_rend   := coalesce(nullif(nullif(p_datos ->> 'rendimiento_cantidad', '')::numeric, 0), 1);
  v_unidad := coalesce(nullif(btrim(coalesce(p_datos ->> 'rendimiento_unidad', '')), ''), 'un');
  v_precio := case when v_tipo = 'plato' then coalesce(nullif(p_datos ->> 'precio_venta_publico_centavos', '')::bigint, 0) else 0 end;
  v_ali    := case when v_tipo = 'plato' then coalesce(nullif(p_datos ->> 'alicuota_venta', '')::numeric, 0) else 0 end;
  v_sector := case when v_tipo = 'plato' then nullif(btrim(coalesce(p_datos ->> 'sector_venta', '')), '') else null end;

  if p_id is null then
    insert into recetas (empresa_id, nombre, tipo, rendimiento_cantidad, rendimiento_unidad,
                         precio_venta_publico_centavos, alicuota_venta, sector_venta, creado_por)
    values (v_empresa, v_nombre, v_tipo, v_rend, v_unidad, v_precio, v_ali, v_sector, auth.uid())
    returning id into v_id;
  else
    select id into v_id from recetas where id = p_id and empresa_id = v_empresa for update;
    if not found then raise exception 'Receta inexistente.'; end if;
    update recetas set nombre = v_nombre, tipo = v_tipo, rendimiento_cantidad = v_rend,
      rendimiento_unidad = v_unidad, precio_venta_publico_centavos = v_precio,
      alicuota_venta = v_ali, sector_venta = v_sector, modificado_por = auth.uid()
    where id = v_id;
    delete from ingredientes_receta where receta_padre_id = v_id;
  end if;

  for ing in select value from jsonb_array_elements(p_ingredientes) loop
    v_t := ing ->> 'tipo';
    v_ref := nullif(ing ->> 'ref_id', '')::uuid;
    v_cant := nullif(ing ->> 'cantidad', '')::numeric;
    if v_cant is null or v_cant <= 0 then
      raise exception 'Cada ingrediente necesita una cantidad mayor a cero.';
    end if;
    if v_t = 'insumo' then
      if not exists (select 1 from insumos where id = v_ref and empresa_id = v_empresa and activo) then
        raise exception 'Hay un insumo inexistente o dado de baja.';
      end if;
      insert into ingredientes_receta (empresa_id, receta_padre_id, insumo_id, cantidad, orden)
        values (v_empresa, v_id, v_ref, v_cant, v_orden);
    elsif v_t = 'receta' then
      if not exists (select 1 from recetas where id = v_ref and empresa_id = v_empresa and activo and tipo = 'preparacion') then
        raise exception 'Hay una preparación inexistente o dada de baja.';
      end if;
      insert into ingredientes_receta (empresa_id, receta_padre_id, subreceta_hija_id, cantidad, orden)
        values (v_empresa, v_id, v_ref, v_cant, v_orden);
    else
      raise exception 'Tipo de ingrediente inválido.';
    end if;
    v_orden := v_orden + 1;
  end loop;

  perform _costo_receta(v_id, '{}'::uuid[], 0);   -- lanza si hay ciclo o demasiados niveles
  perform _recalcular_costos(v_empresa);
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- crear_insumo — insumo + primer punto del historial de precios.
-- p_datos: nombre, rubro, magnitud, unidad_base, costo_neto_por_unidad_base_centavos,
--   alicuota_iva, factor_correccion, presentacion_*, unidad_uso, proveedor_habitual_id
-- ----------------------------------------------------------------------------
create or replace function crear_insumo(p_datos jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_id uuid; v_nombre text; v_costo numeric; v_prov uuid;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN', 'GERENTE', 'COCINA') then
    raise exception 'Sin permiso: tu rol no puede realizar esta operación.';
  end if;
  v_nombre := btrim(coalesce(p_datos ->> 'nombre', ''));
  if v_nombre = '' then raise exception 'El nombre es obligatorio.'; end if;
  v_costo := coalesce(nullif(p_datos ->> 'costo_neto_por_unidad_base_centavos', '')::numeric, 0);
  if v_costo < 0 then raise exception 'El costo no puede ser negativo.'; end if;
  v_prov := nullif(p_datos ->> 'proveedor_habitual_id', '')::uuid;
  if v_prov is not null and not exists (select 1 from proveedores where id = v_prov and empresa_id = v_empresa) then
    raise exception 'Proveedor inexistente en la empresa.';
  end if;

  insert into insumos (
    empresa_id, nombre, rubro, magnitud, unidad_base, costo_neto_por_unidad_base_centavos,
    alicuota_iva, factor_correccion, presentacion_desc, presentacion_cantidad_base,
    presentacion_precio_neto_centavos, presentacion_magnitud, presentacion_cantidad,
    presentacion_unidad, unidad_uso, proveedor_habitual_id, fecha_ultimo_precio, creado_por
  ) values (
    v_empresa, v_nombre, nullif(btrim(coalesce(p_datos ->> 'rubro', '')), ''),
    p_datos ->> 'magnitud', p_datos ->> 'unidad_base', v_costo,
    coalesce(nullif(p_datos ->> 'alicuota_iva', '')::numeric, 0),
    coalesce(nullif(p_datos ->> 'factor_correccion', '')::numeric, 1),
    nullif(btrim(coalesce(p_datos ->> 'presentacion_desc', '')), ''),
    nullif(p_datos ->> 'presentacion_cantidad_base', '')::numeric,
    nullif(p_datos ->> 'presentacion_precio_neto_centavos', '')::bigint,
    nullif(p_datos ->> 'presentacion_magnitud', ''),
    nullif(p_datos ->> 'presentacion_cantidad', '')::numeric,
    nullif(p_datos ->> 'presentacion_unidad', ''),
    nullif(p_datos ->> 'unidad_uso', ''), v_prov, now(), auth.uid()
  ) returning id into v_id;

  insert into historial_precios_insumo
    (empresa_id, insumo_id, costo_anterior_centavos, costo_nuevo_centavos, variacion_porcentual, origen, usuario)
    values (v_empresa, v_id, 0, v_costo, 0, 'carga_inicial', auth.uid());
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- actualizar_costo_insumo — nuevo costo por unidad base + historial + recetas.
-- Devuelve {variacion, recetas_recalculadas}.
-- ----------------------------------------------------------------------------
create or replace function actualizar_costo_insumo(
  p_id uuid, p_costo numeric, p_origen text default 'manual',
  p_factura uuid default null, p_precio_presentacion bigint default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_ins insumos%rowtype; v_var numeric; v_pres bigint;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN', 'GERENTE', 'COCINA') then
    raise exception 'Sin permiso: tu rol no puede realizar esta operación.';
  end if;
  if p_costo is null or p_costo < 0 then raise exception 'El costo no es válido.'; end if;
  if p_origen not in ('factura', 'manual') then raise exception 'Origen inválido.'; end if;
  if p_factura is not null and not exists (select 1 from facturas where id = p_factura and empresa_id = v_empresa) then
    raise exception 'Factura inexistente.';
  end if;

  select * into v_ins from insumos where id = p_id and empresa_id = v_empresa for update;
  if not found then raise exception 'Insumo inexistente.'; end if;

  perform set_config('app.recalculadas', '0', true);
  v_var := case when v_ins.costo_neto_por_unidad_base_centavos > 0
    then round((p_costo - v_ins.costo_neto_por_unidad_base_centavos) / v_ins.costo_neto_por_unidad_base_centavos * 100, 2)
    else 0 end;
  -- Precio de la presentación: el exacto si viene, o el derivado del nuevo costo.
  v_pres := coalesce(p_precio_presentacion,
    case when coalesce(v_ins.presentacion_cantidad_base, 0) > 0 then round(p_costo * v_ins.presentacion_cantidad_base)::bigint end,
    v_ins.presentacion_precio_neto_centavos);

  insert into historial_precios_insumo
    (empresa_id, insumo_id, costo_anterior_centavos, costo_nuevo_centavos, variacion_porcentual, origen, factura_id, usuario)
    values (v_empresa, p_id, v_ins.costo_neto_por_unidad_base_centavos, p_costo, v_var, p_origen, p_factura, auth.uid());

  update insumos set costo_neto_por_unidad_base_centavos = p_costo, fecha_ultimo_precio = now(),
    presentacion_precio_neto_centavos = v_pres
  where id = p_id;     -- el trigger recalcula las recetas

  return jsonb_build_object('variacion', v_var,
    'recetas_recalculadas', coalesce(nullif(current_setting('app.recalculadas', true), ''), '0')::int);
end;
$$;

-- ----------------------------------------------------------------------------
-- actualizar_insumo — edita los datos del insumo y (opcional) su costo, juntos.
-- p_datos: cualquiera de nombre, rubro, alicuota_iva, factor_correccion,
--   proveedor_habitual_id, magnitud, unidad_base, unidad_uso, presentacion_desc,
--   presentacion_cantidad_base, presentacion_precio_neto_centavos,
--   presentacion_magnitud, presentacion_cantidad, presentacion_unidad.
-- Si p_costo viene y cambió, queda en el historial como 'manual'.
-- ----------------------------------------------------------------------------
create or replace function actualizar_insumo(
  p_id uuid, p_datos jsonb, p_costo numeric default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_ins insumos%rowtype; v_var numeric := 0; v_prov uuid; v_cambio boolean := false;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN', 'GERENTE', 'COCINA') then
    raise exception 'Sin permiso: tu rol no puede realizar esta operación.';
  end if;
  select * into v_ins from insumos where id = p_id and empresa_id = v_empresa for update;
  if not found then raise exception 'Insumo inexistente.'; end if;
  if p_datos ? 'nombre' and btrim(coalesce(p_datos ->> 'nombre', '')) = '' then
    raise exception 'El nombre es obligatorio.';
  end if;
  if p_datos ? 'proveedor_habitual_id' then
    v_prov := nullif(p_datos ->> 'proveedor_habitual_id', '')::uuid;
    if v_prov is not null and not exists (select 1 from proveedores where id = v_prov and empresa_id = v_empresa) then
      raise exception 'Proveedor inexistente en la empresa.';
    end if;
  end if;
  if p_costo is not null and p_costo < 0 then raise exception 'El costo no es válido.'; end if;

  perform set_config('app.recalculadas', '0', true);

  update insumos set
    nombre = case when p_datos ? 'nombre' then btrim(p_datos ->> 'nombre') else nombre end,
    rubro = case when p_datos ? 'rubro' then nullif(btrim(coalesce(p_datos ->> 'rubro', '')), '') else rubro end,
    alicuota_iva = case when p_datos ? 'alicuota_iva' then (p_datos ->> 'alicuota_iva')::numeric else alicuota_iva end,
    factor_correccion = case when p_datos ? 'factor_correccion' then coalesce(nullif(p_datos ->> 'factor_correccion', '')::numeric, 1) else factor_correccion end,
    proveedor_habitual_id = case when p_datos ? 'proveedor_habitual_id' then v_prov else proveedor_habitual_id end,
    magnitud = case when p_datos ? 'magnitud' then p_datos ->> 'magnitud' else magnitud end,
    unidad_base = case when p_datos ? 'unidad_base' then p_datos ->> 'unidad_base' else unidad_base end,
    unidad_uso = case when p_datos ? 'unidad_uso' then nullif(p_datos ->> 'unidad_uso', '') else unidad_uso end,
    presentacion_desc = case when p_datos ? 'presentacion_desc' then nullif(btrim(coalesce(p_datos ->> 'presentacion_desc', '')), '') else presentacion_desc end,
    presentacion_cantidad_base = case when p_datos ? 'presentacion_cantidad_base' then nullif(p_datos ->> 'presentacion_cantidad_base', '')::numeric else presentacion_cantidad_base end,
    presentacion_precio_neto_centavos = case when p_datos ? 'presentacion_precio_neto_centavos' then nullif(p_datos ->> 'presentacion_precio_neto_centavos', '')::bigint else presentacion_precio_neto_centavos end,
    presentacion_magnitud = case when p_datos ? 'presentacion_magnitud' then nullif(p_datos ->> 'presentacion_magnitud', '') else presentacion_magnitud end,
    presentacion_cantidad = case when p_datos ? 'presentacion_cantidad' then nullif(p_datos ->> 'presentacion_cantidad', '')::numeric else presentacion_cantidad end,
    presentacion_unidad = case when p_datos ? 'presentacion_unidad' then nullif(p_datos ->> 'presentacion_unidad', '') else presentacion_unidad end,
    modificado_por = auth.uid()
  where id = p_id;

  if p_costo is not null and p_costo is distinct from v_ins.costo_neto_por_unidad_base_centavos then
    v_cambio := true;
    v_var := case when v_ins.costo_neto_por_unidad_base_centavos > 0
      then round((p_costo - v_ins.costo_neto_por_unidad_base_centavos) / v_ins.costo_neto_por_unidad_base_centavos * 100, 2)
      else 0 end;
    insert into historial_precios_insumo
      (empresa_id, insumo_id, costo_anterior_centavos, costo_nuevo_centavos, variacion_porcentual, origen, usuario)
      values (v_empresa, p_id, v_ins.costo_neto_por_unidad_base_centavos, p_costo, v_var, 'manual', auth.uid());
    update insumos set costo_neto_por_unidad_base_centavos = p_costo, fecha_ultimo_precio = now() where id = p_id;
  end if;

  return jsonb_build_object('variacion', v_var, 'costo_cambio', v_cambio,
    'recetas_recalculadas', coalesce(nullif(current_setting('app.recalculadas', true), ''), '0')::int);
end;
$$;

grant execute on function guardar_receta(uuid, jsonb, jsonb) to authenticated;
grant execute on function crear_insumo(jsonb) to authenticated;
grant execute on function actualizar_costo_insumo(uuid, numeric, text, uuid, bigint) to authenticated;
grant execute on function actualizar_insumo(uuid, jsonb, numeric) to authenticated;
