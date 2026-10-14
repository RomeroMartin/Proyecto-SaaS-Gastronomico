-- ============================================================================
-- SaaS Gastronómico — Fase 4: tablero de reparto ("apartados")
-- ----------------------------------------------------------------------------
-- Informativo: no mueve plata ni genera movimientos de caja. Todo se calcula al
-- vuelo desde ventas, gastos fijos, deuda y agenda; no hay "cuentas" de sobres.
-- SOLO ADMIN: el tablero y la masa salarial son del dueño.
--
-- Contiene:
--   • parámetros del tablero en `empresas` (solo por set_config_reparto, auditado);
--   • tabla `gastos_fijos` (RLS solo ADMIN, baja lógica);
--   • `empleados.horas_mensuales_estimadas` (para pasar sueldos por hora a mensual);
--   • gasto_empleados_mensual(): agregados de sueldos desde RRHH SIN abrir la RLS de
--     `empleados_sueldos` (devuelve totales, nunca sueldos individuales).
-- Orden: después de f3_ventas_reportes.sql (y de rrhh.sql). Idempotente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Parámetros por empresa
-- ---------------------------------------------------------------------------
alter table empresas add column if not exists cmv_objetivo_pct numeric(5,2) not null default 35;
alter table empresas add column if not exists costos_variables_pct numeric(5,2) not null default 0;
alter table empresas add column if not exists dias_operativos_mes int not null default 30;
alter table empresas add column if not exists categorias_venta text[] not null default '{Ventas,Ventas tarjeta,Ventas QR}';
alter table empresas add column if not exists cargas_sociales_pct numeric(5,2) not null default 0;
alter table empresas add column if not exists provisionar_aguinaldo boolean not null default true;

alter table empresas drop constraint if exists empresas_reparto_check;
alter table empresas add constraint empresas_reparto_check check (
  cmv_objetivo_pct between 0 and 100 and costos_variables_pct between 0 and 100
  and dias_operativos_mes between 1 and 31 and cargas_sociales_pct between 0 and 100
  and cardinality(categorias_venta) > 0
);
revoke update (cmv_objetivo_pct, costos_variables_pct, dias_operativos_mes, categorias_venta,
               cargas_sociales_pct, provisionar_aguinaldo) on empresas from authenticated;

-- ---------------------------------------------------------------------------
-- 2) Gastos fijos (solo ADMIN)
--    categoria: catálogo abierto `cat_gasto_fijo`. Reservadas: 'sueldos' y
--    'cargas_sociales' (con RRHH activo se calculan desde RRHH y se ignoran acá).
--    categorias_caja: categorías de EGRESO de caja que cuentan como "ya pagado".
-- ---------------------------------------------------------------------------
create table if not exists gastos_fijos (
  id                      uuid primary key default uuid_generate_v4(),
  empresa_id              uuid not null references empresas(id) on delete cascade,
  nombre                  varchar(120) not null,
  categoria               varchar(40) not null,
  monto_mensual_centavos  bigint not null check (monto_mensual_centavos > 0),
  dia_vencimiento         int check (dia_vencimiento between 1 and 31),
  categorias_caja         text[] not null default '{}',
  orden                   int not null default 0,
  activo                  boolean not null default true,
  creado_en               timestamptz not null default now(),
  creado_por              uuid,
  modificado_en           timestamptz not null default now()
);
create index if not exists ix_gastos_fijos_empresa on gastos_fijos (empresa_id, activo, orden);

drop trigger if exists trg_mod_gastos_fijos on gastos_fijos;
create trigger trg_mod_gastos_fijos before update on gastos_fijos
  for each row execute function set_modificado_en();

alter table gastos_fijos enable row level security;
drop policy if exists tenant_all on gastos_fijos;
drop policy if exists escribir on gastos_fijos;
create policy escribir on gastos_fijos for all to authenticated
  using (empresa_id = mi_empresa() and rol_en('ADMIN'))
  with check (empresa_id = mi_empresa() and rol_en('ADMIN'));
revoke delete on gastos_fijos from authenticated;     -- baja lógica (activo = false)

-- ---------------------------------------------------------------------------
-- 3) RRHH: horas mensuales estimadas (para empleados con sueldo por hora)
-- ---------------------------------------------------------------------------
alter table empleados add column if not exists horas_mensuales_estimadas numeric(6,2)
  check (horas_mensuales_estimadas is null or horas_mensuales_estimadas between 0 and 744);

-- ---------------------------------------------------------------------------
-- 4) gasto_empleados_mensual(p_fecha) — AGREGADOS de sueldos desde RRHH. Solo ADMIN.
--    Empleados ACTIVOS con sueldo vigente a p_fecha:
--      mensual  → monto;  por_hora → monto × horas_mensuales_estimadas (si falta, no se suma: sin_horas).
--    Cargas sociales: solo empleados con fecha_alta ≤ p_fecha y modalidad ≠ monotributista/pasantia.
--    Aguinaldo (1/12 mensual, si se provisiona): relación de dependencia (modalidad ≠ monotributista),
--      estén o no dados de alta; las cargas sobre el aguinaldo, solo para los dados de alta.
--    Devuelve solo totales (nunca un sueldo individual).
-- ---------------------------------------------------------------------------
create or replace function gasto_empleados_mensual(p_fecha date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_empresa uuid := mi_empresa(); v_fecha date; e empresas;
  v_sueldos numeric := 0; v_sueldos_alta numeric := 0; v_sueldos_dep numeric := 0; v_sueldos_dep_alta numeric := 0;
  v_incl int := 0; v_sin_horas int := 0; v_sin_alta int := 0;
  r record; v_monto numeric; v_alta boolean; v_sin_cargas boolean; v_monot boolean;
  v_cargas bigint; v_agui bigint; v_cargas_agui bigint;
begin
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN') then raise exception 'Sin permiso: solo un ADMIN ve el gasto en empleados.'; end if;
  if not modulo_activo('reparto') then raise exception 'El módulo de reparto no está activo en tu plan.'; end if;
  select * into e from empresas where id = v_empresa;
  v_fecha := coalesce(p_fecha, fecha_en_zona(now(), e.zona_horaria));

  for r in
    select distinct on (em.id) em.id, em.fecha_alta, em.horas_mensuales_estimadas, s.monto_centavos, s.tipo, lower(coalesce(l.modalidad, '')) as modalidad
      from empleados em
      join empleados_sueldos s on s.empleado_id = em.id and s.vigencia_desde <= v_fecha
      left join empleados_legajo l on l.empleado_id = em.id
     where em.empresa_id = v_empresa and em.estado = 'activo'
     order by em.id, s.vigencia_desde desc
  loop
    if r.tipo = 'por_hora' then
      if r.horas_mensuales_estimadas is null or r.horas_mensuales_estimadas <= 0 then v_sin_horas := v_sin_horas + 1; continue; end if;
      v_monto := r.monto_centavos * r.horas_mensuales_estimadas;
    else
      v_monto := r.monto_centavos;
    end if;
    v_incl := v_incl + 1;
    v_monot := r.modalidad = 'monotributista';
    v_alta := r.fecha_alta is not null and r.fecha_alta <= v_fecha;
    v_sin_cargas := v_monot or r.modalidad = 'pasantia';
    v_sueldos := v_sueldos + v_monto;
    if not v_sin_cargas then
      if v_alta then v_sueldos_alta := v_sueldos_alta + v_monto; else v_sin_alta := v_sin_alta + 1; end if;
    end if;
    if not v_monot then
      v_sueldos_dep := v_sueldos_dep + v_monto;
      if v_alta and not v_sin_cargas then v_sueldos_dep_alta := v_sueldos_dep_alta + v_monto; end if;
    end if;
  end loop;

  v_cargas := round(v_sueldos_alta * e.cargas_sociales_pct / 100);
  v_agui := case when e.provisionar_aguinaldo then round(v_sueldos_dep / 12) else 0 end;
  v_cargas_agui := case when e.provisionar_aguinaldo then round(v_sueldos_dep_alta / 12 * e.cargas_sociales_pct / 100) else 0 end;
  return jsonb_build_object(
    'sueldos_centavos', round(v_sueldos), 'cargas_centavos', v_cargas, 'aguinaldo_centavos', v_agui,
    'cargas_aguinaldo_centavos', v_cargas_agui,
    'total_centavos', round(v_sueldos) + v_cargas + v_agui + v_cargas_agui,
    'empleados_incluidos', v_incl, 'sin_horas', v_sin_horas, 'sin_alta', v_sin_alta, 'fecha', v_fecha);
end;
$$;
grant execute on function gasto_empleados_mensual(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) set_config_reparto(clave, valor) — parámetros del tablero (solo ADMIN, validado y auditado).
-- ---------------------------------------------------------------------------
create or replace function set_config_reparto(p_clave text, p_valor jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_empresa uuid := mi_empresa(); v_antes jsonb; v_txt text; v_arr text[];
begin
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN') then raise exception 'Sin permiso: solo un ADMIN puede cambiar la configuración.'; end if;
  if not modulo_activo('reparto') then raise exception 'El módulo de reparto no está activo en tu plan.'; end if;
  v_txt := p_valor #>> '{}';
  select to_jsonb(e) -> p_clave into v_antes from empresas e where id = v_empresa;

  if p_clave in ('cmv_objetivo_pct', 'costos_variables_pct', 'cargas_sociales_pct') then
    if jsonb_typeof(p_valor) <> 'number' or v_txt::numeric < 0 or v_txt::numeric > 100 then raise exception 'El porcentaje tiene que estar entre 0 y 100.'; end if;
    if p_clave = 'cmv_objetivo_pct' then update empresas set cmv_objetivo_pct = round(v_txt::numeric, 2) where id = v_empresa;
    elsif p_clave = 'costos_variables_pct' then update empresas set costos_variables_pct = round(v_txt::numeric, 2) where id = v_empresa;
    else update empresas set cargas_sociales_pct = round(v_txt::numeric, 2) where id = v_empresa; end if;
  elsif p_clave = 'dias_operativos_mes' then
    if jsonb_typeof(p_valor) <> 'number' or v_txt::numeric <> trunc(v_txt::numeric) or v_txt::int not between 1 and 31 then raise exception 'Los días operativos son un número entre 1 y 31.'; end if;
    update empresas set dias_operativos_mes = v_txt::int where id = v_empresa;
  elsif p_clave = 'provisionar_aguinaldo' then
    if jsonb_typeof(p_valor) <> 'boolean' then raise exception 'Valor inválido: es sí/no.'; end if;
    update empresas set provisionar_aguinaldo = v_txt::boolean where id = v_empresa;
  elsif p_clave = 'categorias_venta' then
    if jsonb_typeof(p_valor) <> 'array' then raise exception 'Valor inválido: se espera una lista de categorías.'; end if;
    select coalesce(array_agg(distinct btrim(x)) filter (where btrim(x) <> ''), '{}') into v_arr from jsonb_array_elements_text(p_valor) x;
    if cardinality(v_arr) = 0 or cardinality(v_arr) > 30 or exists (select 1 from unnest(v_arr) y where length(y) > 60) then
      raise exception 'Indicá entre 1 y 30 categorías (hasta 60 caracteres cada una).';
    end if;
    update empresas set categorias_venta = v_arr where id = v_empresa;
  else
    raise exception 'Parámetro desconocido: %.', p_clave;
  end if;
  perform auditar('config_reparto', 'empresas', v_empresa, jsonb_build_object(p_clave, v_antes), jsonb_build_object(p_clave, p_valor));
end;
$$;
grant execute on function set_config_reparto(text, jsonb) to authenticated;
