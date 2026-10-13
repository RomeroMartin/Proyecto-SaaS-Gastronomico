-- ============================================================================
-- Test Fase 0.2 — empresas: lectura general, escritura mínima, parámetros por RPC
-- ============================================================================
begin;
set role authenticated;

select t_login('admA');
select t_igual((select count(*)::int from empresas), 1, 'ADMIN ve solo su empresa');
select t_login('cajA');
select t_igual((select count(*)::int from empresas), 1, 'CAJERO lee su empresa (nombre, parámetros públicos)');
select t_login('inaA');
select t_igual((select count(*)::int from empresas), 0, 'usuario inactivo no ve la empresa');

-- Quién puede actualizar la empresa.
select t_login('cocA');
select t_filas($$update empresas set nombre = 'HACKEADA'$$, 0, 'COCINA no puede renombrar la empresa');
select t_login('gerA');
select t_filas($$update empresas set nombre = 'HACKEADA'$$, 0, 'GERENTE no puede renombrar la empresa');
select t_login('audA');
select t_filas($$update empresas set nombre = 'HACKEADA'$$, 0, 'AUDITOR no puede renombrar la empresa');
select t_login('admB');
select t_filas($$update empresas set nombre = 'OtraEmpresa' where id = '11111111-1111-1111-1111-111111111111'$$, 0, 'otra empresa no puede tocar la mía');

select t_login('admA');
select t_filas($$update empresas set nombre = 'A renombrada', cuit_rut = '30-1' where id = '11111111-1111-1111-1111-111111111111'$$, 1, 'ADMIN sí cambia nombre y CUIT');
select t_filas($$update empresas set costea_con_iva = false where id = '11111111-1111-1111-1111-111111111111'$$, 1, 'ADMIN sí cambia costea_con_iva (compatibilidad)');

-- Columnas sensibles: solo por RPC.
select t_falla($$update empresas set zona_horaria = 'UTC' where id = '11111111-1111-1111-1111-111111111111'$$,
  'ADMIN no escribe zona_horaria directo', 'permission denied');
select t_falla($$update empresas set condicion_fiscal = 'exento' where id = '11111111-1111-1111-1111-111111111111'$$,
  'ADMIN no escribe condicion_fiscal directo', 'permission denied');
select t_falla($$insert into empresas (nombre) values ('nueva')$$, 'nadie crea empresas directo', 'permission denied');
select t_falla($$delete from empresas where id = '11111111-1111-1111-1111-111111111111'$$, 'nadie borra empresas', 'permission denied');

-- set_config_empresa.
select t_login('gerA');
select t_falla($$select set_config_empresa('zona_horaria', '"UTC"')$$, 'GERENTE no puede usar set_config_empresa', 'Sin permiso');
select t_login('cajA');
select t_falla($$select set_config_empresa('condicion_fiscal', '"exento"')$$, 'CAJERO no puede usar set_config_empresa', 'Sin permiso');
select t_login('admA');
select t_falla($$select set_config_empresa('zona_horaria', '"Marte/Olimpo"')$$, 'zona horaria inválida se rechaza', 'inválida');
select t_falla($$select set_config_empresa('condicion_fiscal', '"inventada"')$$, 'condición fiscal inválida se rechaza', 'inválida');
select t_falla($$select set_config_empresa('modulos', '["admin"]')$$, 'parámetro fuera de la lista blanca se rechaza', 'desconocido');
select set_config_empresa('zona_horaria', '"America/Argentina/Cordoba"');
select set_config_empresa('condicion_fiscal', '"responsable_inscripto"');
select t_igual((select zona_horaria from empresas), 'America/Argentina/Cordoba', 'ADMIN cambia la zona horaria por RPC');
select t_igual((select condicion_fiscal from empresas), 'responsable_inscripto', 'ADMIN cambia la condición fiscal por RPC');

-- Auditoría de esos cambios.
select t_igual((select count(*)::int from auditoria where accion = 'config_empresa'), 2, 'los cambios de configuración quedan auditados');
select t_ok((select despues ->> 'zona_horaria' from auditoria where accion = 'config_empresa' and despues ? 'zona_horaria') = 'America/Argentina/Cordoba',
  'la auditoría guarda el valor nuevo');
select t_login('gerA');
select t_igual((select count(*)::int from auditoria), 0, 'GERENTE no lee la auditoría');
select t_login('audA');
select t_igual((select count(*)::int from auditoria), 0, 'AUDITOR no lee la auditoría');
select t_login('admB');
select t_igual((select count(*)::int from auditoria), 0, 'otra empresa no lee mi auditoría');
select t_login('admA');
select t_falla($$insert into auditoria (empresa_id, accion) values ('11111111-1111-1111-1111-111111111111', 'falsa')$$,
  'nadie escribe la auditoría directo', 'permission denied');
select t_falla($$delete from auditoria$$, 'nadie borra la auditoría', 'permission denied');
select t_falla($$select auditar('x', 'y', null, null, null)$$, 'el cliente no puede invocar auditar()', 'permission denied');

rollback;
