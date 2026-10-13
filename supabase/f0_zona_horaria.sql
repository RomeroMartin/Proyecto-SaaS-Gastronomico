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
