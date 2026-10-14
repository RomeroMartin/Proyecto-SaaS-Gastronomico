-- ============================================================================
-- Test Fase 4 — tablero de reparto: gastos fijos (solo ADMIN), parámetros y
-- gasto en empleados desde RRHH (agregados, cargas y aguinaldo).
-- ============================================================================
begin;

update empresas set modulos = '{admin,costos,carta,rrhh,reparto}', cargas_sociales_pct = 20, provisionar_aguinaldo = true
 where id = '11111111-1111-1111-1111-111111111111';

-- Dos empleados de $800.000 (en centavos: 80.000.000) en relación de dependencia, ambos con alta.
insert into empleados (id, empresa_id, nombre, apellido, fecha_ingreso, fecha_alta, estado) values
  ('e2000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Ana', 'Uno', date '2025-01-01', date '2025-01-01', 'activo'),
  ('e2000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Beto', 'Dos', date '2025-01-01', date '2025-01-01', 'activo');
insert into empleados_sueldos (empleado_id, monto_centavos, tipo, vigencia_desde) values
  ('e2000000-0000-0000-0000-000000000001', 80000000, 'mensual', date '2025-01-01'),
  ('e2000000-0000-0000-0000-000000000002', 80000000, 'mensual', date '2025-01-01');

set role authenticated;

-- ---- Quién puede llamar a la RPC ----
select t_login('gerA');
select t_falla($$select gasto_empleados_mensual()$$, 'GERENTE no puede invocar gasto_empleados_mensual', 'Sin permiso');
select t_igual((select count(*)::int from empleados_sueldos), 0, 'y sigue sin leer los sueldos por tabla');
select t_login('cocA');
select t_falla($$select gasto_empleados_mensual()$$, 'COCINA tampoco', 'Sin permiso');
select t_login('audA');
select t_falla($$select gasto_empleados_mensual()$$, 'AUDITOR tampoco', 'Sin permiso');
select t_login('cajA');
select t_falla($$select gasto_empleados_mensual()$$, 'CAJERO tampoco', 'Sin permiso');
select t_login('admB');
select t_falla($$select gasto_empleados_mensual()$$, 'una empresa sin el módulo reparto no la usa', 'módulo');

-- ---- Caso de aceptación: 2 × $800.000 con alta, cargas 20 %, aguinaldo ----
select t_login('admA');
select gasto_empleados_mensual() as g \gset
select t_igual((:'g'::jsonb ->> 'sueldos_centavos')::bigint, 160000000::bigint, 'sueldos $1.600.000');
select t_igual((:'g'::jsonb ->> 'cargas_centavos')::bigint, 32000000::bigint, 'cargas $320.000');
select t_igual((:'g'::jsonb ->> 'aguinaldo_centavos')::bigint, 13333333::bigint, 'aguinaldo ≈ $133.333');
select t_igual((:'g'::jsonb ->> 'cargas_aguinaldo_centavos')::bigint, 2666667::bigint, 'cargas sobre el aguinaldo ≈ $26.667');
select t_igual((:'g'::jsonb ->> 'total_centavos')::bigint, 208000000::bigint, 'total ≈ $2.080.000');
select t_ok((:'g'::jsonb ->> 'empleados_incluidos')::int = 2 and (:'g'::jsonb ->> 'sin_alta')::int = 0 and (:'g'::jsonb ->> 'sin_horas')::int = 0, '2 empleados, ninguno sin alta ni sin horas');
select t_ok(not (:'g'::jsonb ? 'empleados') and not (:'g'::jsonb::text ~ '80000000'), 'devuelve solo agregados: ningún sueldo individual');

-- ---- Uno sin alta: no genera cargas (sí aguinaldo) y se cuenta ----
reset role;
update empleados set fecha_alta = null where id = 'e2000000-0000-0000-0000-000000000002';
set role authenticated;
select t_login('admA');
select gasto_empleados_mensual() as g2 \gset
select t_ok((:'g2'::jsonb ->> 'cargas_centavos')::bigint = 16000000 and (:'g2'::jsonb ->> 'sin_alta')::int = 1, 'sin alta: cargas solo del empleado con alta y "sin_alta" = 1');
select t_igual((:'g2'::jsonb ->> 'aguinaldo_centavos')::bigint, 13333333::bigint, 'el aguinaldo se provisiona igual (la obligación existe)');
select t_igual((:'g2'::jsonb ->> 'cargas_aguinaldo_centavos')::bigint, 1333333::bigint, 'cargas sobre aguinaldo solo del dado de alta');
select t_igual((:'g2'::jsonb ->> 'total_centavos')::bigint, 160000000::bigint + 16000000 + 13333333 + 1333333, 'total con uno sin alta');
-- Alta con fecha futura: todavía no genera cargas a la fecha de hoy.
reset role;
update empleados set fecha_alta = current_date + 30 where id = 'e2000000-0000-0000-0000-000000000002';
set role authenticated;
select t_login('admA');
select t_ok((gasto_empleados_mensual() ->> 'sin_alta')::int = 1, 'alta con fecha futura = todavía sin alta');
select t_ok((gasto_empleados_mensual(current_date + 31) ->> 'sin_alta')::int = 0, 'pero a esa fecha ya genera cargas');

-- ---- Monotributista y pasantía ----
reset role;
insert into empleados (id, empresa_id, nombre, apellido, fecha_ingreso, fecha_alta, estado) values
  ('e2000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Cami', 'Mono', date '2025-01-01', date '2025-01-01', 'activo'),
  ('e2000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Dani', 'Pasante', date '2025-01-01', date '2025-01-01', 'activo');
insert into empleados_legajo (empleado_id, modalidad) values ('e2000000-0000-0000-0000-000000000003', 'monotributista'), ('e2000000-0000-0000-0000-000000000004', 'pasantia');
insert into empleados_sueldos (empleado_id, monto_centavos, tipo, vigencia_desde) values
  ('e2000000-0000-0000-0000-000000000003', 50000000, 'mensual', date '2025-01-01'),
  ('e2000000-0000-0000-0000-000000000004', 30000000, 'mensual', date '2025-01-01');
update empleados set fecha_alta = date '2025-01-01' where id = 'e2000000-0000-0000-0000-000000000002';
set role authenticated;
select t_login('admA');
select gasto_empleados_mensual() as g3 \gset
-- sueldos 160M + 50M + 30M = 240M; cargas solo de los 2 con alta (160M × 20 %); aguinaldo sin el monotributista: (160M + 30M)/12; cargas s/aguinaldo solo dependientes con alta.
select t_igual((:'g3'::jsonb ->> 'sueldos_centavos')::bigint, 240000000::bigint, 'el monotributista y el pasante suman sueldo');
select t_igual((:'g3'::jsonb ->> 'cargas_centavos')::bigint, 32000000::bigint, 'pero ninguno de los dos genera cargas');
select t_igual((:'g3'::jsonb ->> 'aguinaldo_centavos')::bigint, round(190000000 / 12.0)::bigint, 'el monotributista no genera aguinaldo (el pasante sí, según el plan)');
select t_igual((:'g3'::jsonb ->> 'cargas_aguinaldo_centavos')::bigint, round(160000000 / 12.0 * 0.2)::bigint, 'cargas sobre aguinaldo: solo dependientes con alta');
select t_igual((:'g3'::jsonb ->> 'sin_alta')::int, 0, 'monotributista y pasante no cuentan como "sin alta"');

-- ---- Por hora (con y sin horas), inactivos y aumentos futuros ----
reset role;
insert into empleados (id, empresa_id, nombre, apellido, fecha_ingreso, fecha_alta, estado) values
  ('e2000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Eli', 'Hora', date '2025-01-01', date '2025-01-01', 'activo'),
  ('e2000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Fede', 'SinHoras', date '2025-01-01', date '2025-01-01', 'activo'),
  ('e2000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Gus', 'Baja', date '2025-01-01', date '2025-01-01', 'inactivo');
update empleados set horas_mensuales_estimadas = 100 where id = 'e2000000-0000-0000-0000-000000000005';
insert into empleados_sueldos (empleado_id, monto_centavos, tipo, vigencia_desde) values
  ('e2000000-0000-0000-0000-000000000005', 200000, 'por_hora', date '2025-01-01'),
  ('e2000000-0000-0000-0000-000000000006', 200000, 'por_hora', date '2025-01-01'),
  ('e2000000-0000-0000-0000-000000000007', 99999999, 'mensual', date '2025-01-01');
set role authenticated;
select t_login('admA');
select gasto_empleados_mensual() as g4 \gset
select t_igual((:'g4'::jsonb ->> 'sueldos_centavos')::bigint, 240000000::bigint + 200000 * 100, 'por hora × horas estimadas; sin horas no suma; el inactivo no cuenta');
select t_igual((:'g4'::jsonb ->> 'sin_horas')::int, 1, 'se avisa cuántos por hora no tienen horas estimadas');
-- Un aumento con vigencia futura no cambia el sobre hasta esa fecha.
reset role;
insert into empleados_sueldos (empleado_id, monto_centavos, tipo, vigencia_desde) values
  ('e2000000-0000-0000-0000-000000000001', 100000000, 'mensual', current_date + 20);
set role authenticated;
select t_login('admA');
select t_igual((gasto_empleados_mensual() ->> 'sueldos_centavos')::bigint, (:'g4'::jsonb ->> 'sueldos_centavos')::bigint, 'el aumento futuro no cambia el total de hoy');
select t_igual((gasto_empleados_mensual(current_date + 20) ->> 'sueldos_centavos')::bigint, (:'g4'::jsonb ->> 'sueldos_centavos')::bigint + 20000000, 'pero sí a partir de su vigencia (+ $200.000)');
-- Aguinaldo desactivado.
select set_config_reparto('provisionar_aguinaldo', 'false');
select t_igual((gasto_empleados_mensual() ->> 'aguinaldo_centavos')::bigint, 0::bigint, 'sin provisión de aguinaldo no se suma');
select set_config_reparto('provisionar_aguinaldo', 'true');

-- ---- Parámetros ----
select t_login('gerA');
select t_falla($$select set_config_reparto('cmv_objetivo_pct', '30')$$, 'GERENTE no cambia parámetros', 'Sin permiso');
select t_login('admA');
select t_falla($$update empresas set cmv_objetivo_pct = 10 where id = '11111111-1111-1111-1111-111111111111'$$, 'no se escribe directo', 'permission denied');
select t_falla($$select set_config_reparto('cmv_objetivo_pct', '101')$$, 'porcentaje > 100', 'entre 0 y 100');
select t_falla($$select set_config_reparto('costos_variables_pct', '"6"')$$, 'porcentaje como texto', 'entre 0 y 100');
select t_falla($$select set_config_reparto('dias_operativos_mes', '0')$$, 'días fuera de rango', 'entre 1 y 31');
select t_falla($$select set_config_reparto('dias_operativos_mes', '26.5')$$, 'días no enteros', 'entre 1 y 31');
select t_falla($$select set_config_reparto('categorias_venta', '[]')$$, 'sin categorías de venta', 'categorías');
select t_falla($$select set_config_reparto('inventada', '1')$$, 'clave desconocida', 'desconocido');
select set_config_reparto('cmv_objetivo_pct', '32.5');
select set_config_reparto('costos_variables_pct', '6');
select set_config_reparto('dias_operativos_mes', '26');
select set_config_reparto('categorias_venta', '["Ventas", " Ventas QR ", "Ventas", ""]');
select t_ok((select cmv_objetivo_pct = 32.5 and costos_variables_pct = 6 and dias_operativos_mes = 26 and categorias_venta = '{Ventas,"Ventas QR"}' from empresas), 'parámetros guardados y normalizados');
select t_ok((select count(*) from auditoria where accion = 'config_reparto') >= 4, 'los cambios quedan auditados');
select t_login('admB');
select t_falla($$select set_config_reparto('cmv_objetivo_pct', '30')$$, 'otra empresa sin el módulo', 'módulo');

-- ---- Gastos fijos: solo ADMIN ----
select t_login('admA');
insert into gastos_fijos (empresa_id, nombre, categoria, monto_mensual_centavos, dia_vencimiento, categorias_caja)
  values ('11111111-1111-1111-1111-111111111111', 'Alquiler', 'alquiler', 150000000, 10, '{Alquiler}');
select t_igual((select count(*)::int from gastos_fijos), 1, 'ADMIN crea y lee gastos fijos');
select t_falla($$insert into gastos_fijos (empresa_id, nombre, categoria, monto_mensual_centavos) values ('11111111-1111-1111-1111-111111111111', 'X', 'otros', 0)$$, 'monto en cero', 'check');
select t_falla($$insert into gastos_fijos (empresa_id, nombre, categoria, monto_mensual_centavos, dia_vencimiento) values ('11111111-1111-1111-1111-111111111111', 'X', 'otros', 100, 32)$$, 'día de vencimiento inválido', 'check');
select t_falla($$delete from gastos_fijos$$, 'no se borra: baja lógica', 'permission denied');
select t_filas($$update gastos_fijos set activo = false$$, 1, 'baja lógica');
select t_filas($$update gastos_fijos set activo = true$$, 1, 'y reactivar');
select t_login('gerA');
select t_igual((select count(*)::int from gastos_fijos), 0, 'GERENTE no ve los gastos fijos');
select t_falla($$insert into gastos_fijos (empresa_id, nombre, categoria, monto_mensual_centavos) values ('11111111-1111-1111-1111-111111111111', 'X', 'otros', 100)$$, 'GERENTE no crea gastos fijos', 'row-level security');
select t_login('audA');
select t_igual((select count(*)::int from gastos_fijos), 0, 'AUDITOR no ve los gastos fijos');
select t_login('cajA');
select t_igual((select count(*)::int from gastos_fijos), 0, 'CAJERO no ve los gastos fijos');
select t_login('admB');
select t_igual((select count(*)::int from gastos_fijos), 0, 'otra empresa no ve mis gastos fijos');
select t_filas($$update gastos_fijos set nombre = 'hack'$$, 0, 'ni los modifica');

reset role;
rollback;
