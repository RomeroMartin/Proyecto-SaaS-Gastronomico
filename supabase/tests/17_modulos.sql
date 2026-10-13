-- ============================================================================
-- Test Fase 1 — módulos activables por empresa
-- ============================================================================
begin;

-- Las empresas existentes quedan con los módulos que ya usaban.
select t_ok((select modulos from empresas where id = '11111111-1111-1111-1111-111111111111') = '{admin,costos,carta,rrhh}',
  'empresa existente queda con admin, costos, carta y rrhh');

-- Nadie del cliente escribe `modulos` (probado por API: rol authenticated).
set role authenticated;
select t_login('admA');
select t_falla($$update empresas set modulos = '{admin,costos,carta,rrhh,ventas,reparto}'$$,
  'ADMIN no puede modificar modulos', 'permission denied');
select t_falla($$select set_config_empresa('modulos', '["admin","ventas"]')$$,
  'tampoco por set_config_empresa', 'desconocido');
select t_falla($$insert into empresas (nombre, modulos) values ('x', '{admin}')$$,
  'ni crear empresas con módulos', 'permission denied');
select t_ok(modulo_activo('admin'), 'modulo_activo: admin está activo');
select t_ok(not modulo_activo('ventas'), 'modulo_activo: ventas no está activo');
select t_login('admB');
select t_ok(modulo_activo('rrhh'), 'modulo_activo funciona para otra empresa');
select t_login('inaA');
select t_ok(not modulo_activo('admin'), 'usuario inactivo: ningún módulo activo');
reset role;

-- Dueño del producto (SQL Editor / service role).
select t_falla($$update empresas set modulos = '{admin,inventado}' where id = '11111111-1111-1111-1111-111111111111'$$,
  'módulo desconocido se rechaza', 'desconocido');
select t_falla($$update empresas set modulos = '{}' where id = '11111111-1111-1111-1111-111111111111'$$,
  'lista vacía se rechaza', 'al menos un módulo');
select t_falla($$update empresas set modulos = null where id = '11111111-1111-1111-1111-111111111111'$$,
  'lista nula se rechaza', 'nula');
select t_falla($$update empresas set modulos = '{admin,ventas}' where id = '11111111-1111-1111-1111-111111111111'$$,
  'ventas sin carta se rechaza', 'requiere');
select t_falla($$update empresas set modulos = '{carta,ventas}' where id = '11111111-1111-1111-1111-111111111111'$$,
  'ventas sin admin se rechaza', 'requiere');
select t_falla($$update empresas set modulos = '{costos,reparto}' where id = '11111111-1111-1111-1111-111111111111'$$,
  'reparto sin admin se rechaza', 'requiere');
select t_ok((select modulos from empresas where id = '11111111-1111-1111-1111-111111111111') = '{admin,costos,carta,rrhh}',
  'los rechazos no cambiaron nada');

-- Perfil 1: mostrador con ventas y reparto, sin RRHH.
update empresas set modulos = '{reparto,ventas,carta,admin}' where id = '11111111-1111-1111-1111-111111111111';
select t_ok((select modulos from empresas where id = '11111111-1111-1111-1111-111111111111') = '{admin,carta,ventas,reparto}',
  'se normaliza: ordenado y sin repetidos');
update empresas set modulos = '{admin,admin,costos}' where id = '11111111-1111-1111-1111-111111111111';
select t_ok((select modulos from empresas where id = '11111111-1111-1111-1111-111111111111') = '{admin,costos}', 'sin duplicados');
-- Perfil 2: reparto sin rrhh es válido; ventas no hace falta.
update empresas set modulos = '{admin,reparto}' where id = '11111111-1111-1111-1111-111111111111';
select t_ok((select 'reparto' = any (modulos) and not 'rrhh' = any (modulos) from empresas where id = '11111111-1111-1111-1111-111111111111'), 'reparto sin rrhh es válido');

-- Auditoría: quedó el rastro (aunque se cambió sin usuario).
select t_ok((select count(*) from auditoria where accion = 'modulos_empresa'
             and empresa_id = '11111111-1111-1111-1111-111111111111') >= 3, 'los cambios de módulos quedan auditados');
select t_ok((select despues -> 'modulos' from auditoria where accion = 'modulos_empresa'
             and empresa_id = '11111111-1111-1111-1111-111111111111' order by creado_en desc, id limit 1) is not null,
  'la auditoría guarda el valor nuevo');
-- Un UPDATE que no cambia módulos no audita.
select count(*) as antes from auditoria where accion = 'modulos_empresa' \gset
update empresas set modulos = modulos where id = '11111111-1111-1111-1111-111111111111';
select t_igual((select count(*)::int from auditoria where accion = 'modulos_empresa'), :antes, 'sin cambio no hay auditoría');

-- El ADMIN lee sus módulos (perfil) y la auditoría de ellos.
set role authenticated;
select t_login('admA');
select t_ok((select modulos from empresas) = '{admin,reparto}', 'el ADMIN lee los módulos de su empresa');
select t_ok((select count(*) from auditoria where accion = 'modulos_empresa') >= 3, 'y ve la auditoría de módulos');
select t_login('gerA');
select t_igual((select count(*)::int from auditoria where accion = 'modulos_empresa'), 0, 'GERENTE no ve la auditoría');
reset role;

rollback;
