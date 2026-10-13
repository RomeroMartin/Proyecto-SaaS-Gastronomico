-- ============================================================================
-- Test Fase 0.4 — fechas en la zona horaria de la empresa
-- ============================================================================
begin;

-- Función pura con instantes fijos.
select t_igual(fecha_en_zona('2026-10-14 01:30:00+00', 'America/Argentina/Buenos_Aires'), date '2026-10-13',
  '01:30 UTC = 22:30 del día anterior en Buenos Aires');
select t_igual(fecha_en_zona('2026-10-14 01:30:00+00', 'UTC'), date '2026-10-14', 'en UTC es el día siguiente (el bug original)');
select t_igual(fecha_en_zona('2026-10-14 03:00:00+00', 'America/Argentina/Buenos_Aires'), date '2026-10-14', 'las 00:00 locales ya son el día nuevo');
select t_igual(fecha_en_zona('2026-10-14 02:59:59+00', 'America/Argentina/Buenos_Aires'), date '2026-10-13', 'un segundo antes de medianoche local sigue siendo el día anterior');
select t_igual(fecha_en_zona('2026-12-31 23:30:00+00', 'America/Argentina/Buenos_Aires'), date '2026-12-31', 'cambio de año: 20:30 local del 31/12');
select t_igual(fecha_en_zona('2027-01-01 02:30:00+00', 'America/Argentina/Buenos_Aires'), date '2026-12-31', 'cambio de año: 23:30 local del 31/12 (UTC ya es 2027)');
select t_igual(fecha_en_zona('2026-10-14 01:30:00+00', null), date '2026-10-13', 'sin zona usa Buenos Aires por defecto');

set role authenticated;

-- hoy_empresa() sigue la zona configurada.
select t_login('admA');
select t_igual(hoy_empresa(), fecha_en_zona(now(), 'America/Argentina/Buenos_Aires'), 'hoy_empresa() usa la zona por defecto');
select set_config_empresa('zona_horaria', '"Pacific/Kiritimati"');   -- UTC+14
select t_igual(hoy_empresa(), fecha_en_zona(now(), 'Pacific/Kiritimati'), 'hoy_empresa() sigue la zona configurada (UTC+14)');
select set_config_empresa('zona_horaria', '"Pacific/Pago_Pago"');    -- UTC-11
select t_igual(hoy_empresa(), fecha_en_zona(now(), 'Pacific/Pago_Pago'), 'hoy_empresa() sigue la zona configurada (UTC-11)');
select t_login('admB');
select t_igual(hoy_empresa(), fecha_en_zona(now(), 'America/Argentina/Buenos_Aires'), 'cada empresa tiene su propia zona');
select t_login('admA');

-- Pagos: la fecha por defecto y la del contraasiento son las de la empresa.
select registrar_pago('c1000000-0000-0000-0000-000000000001', 500, 'efectivo', null, null, 'fifo', null) as pago \gset
select t_igual((select fecha_pago from pagos where id = :'pago'), hoy_empresa(), 'registrar_pago sin fecha usa la fecha de la empresa');
select anular_pago(:'pago') as contra \gset
select t_igual((select fecha_pago from pagos where id = :'contra'), hoy_empresa(), 'el contraasiento usa la fecha de la empresa');
reset role;

-- Vistas de RRHH con la fecha de la empresa (tests deterministas respecto de hoy_empresa()).
do $$
declare
  ea uuid := '11111111-1111-1111-1111-111111111111';
  emp uuid := gen_random_uuid(); td uuid := gen_random_uuid();
begin
  insert into empleados (id, empresa_id, nombre, apellido, fecha_ingreso) values (emp, ea, 'Ana', 'Paz', date '2020-01-01');
  insert into tipos_documento (id, empresa_id, nombre) values (td, ea, 'Libreta');
  perform set_config('t.emp', emp::text, false); perform set_config('t.td', td::text, false);
end $$;
set role authenticated;
select t_login('admA');
insert into empleados_sueldos (empleado_id, monto_centavos, vigencia_desde) values
  (current_setting('t.emp')::uuid, 100, hoy_empresa()),
  (current_setting('t.emp')::uuid, 999, hoy_empresa() + 1);
select t_igual((select monto_centavos from vw_sueldo_vigente where empleado_id = current_setting('t.emp')::uuid), 100::bigint,
  'vw_sueldo_vigente toma el sueldo de hoy (según la empresa) y no el de mañana');
insert into documentos (empleado_id, tipo_documento_id, fecha_vencimiento) values
  (current_setting('t.emp')::uuid, current_setting('t.td')::uuid, hoy_empresa() - 1),
  (current_setting('t.emp')::uuid, current_setting('t.td')::uuid, hoy_empresa()),
  (current_setting('t.emp')::uuid, current_setting('t.td')::uuid, hoy_empresa() + 30),
  (current_setting('t.emp')::uuid, current_setting('t.td')::uuid, hoy_empresa() + 31);
select t_igual((select count(*)::int from vw_documentos_estado where estado = 'vencido'), 1, 'ayer = vencido');
select t_igual((select count(*)::int from vw_documentos_estado where estado = 'por_vencer'), 2, 'hoy y en 30 días = por vencer');
select t_igual((select count(*)::int from vw_documentos_estado where estado = 'vigente'), 1, 'en 31 días = vigente');
select t_igual((select dias_restantes from vw_documentos_estado where fecha_vencimiento = hoy_empresa()), 0, 'dias_restantes de hoy = 0');

rollback;
