-- ============================================================================
-- Tests SQL — datos base: 2 empresas, un usuario por rol (+1 inactivo) y un
-- proveedor por empresa. Se carga DESPUÉS de los scripts del repo (necesita
-- el rol CAJERO de f0_usuarios.sql).
-- ============================================================================

insert into auth.users (id, email) values
  (t_uid('admA'), 'adma@t'), (t_uid('gerA'), 'gera@t'), (t_uid('cocA'), 'coca@t'),
  (t_uid('audA'), 'auda@t'), (t_uid('cajA'), 'caja@t'), (t_uid('inaA'), 'inaa@t'),
  (t_uid('admB'), 'admb@t');

insert into empresas (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Empresa A'),
  ('22222222-2222-2222-2222-222222222222', 'Empresa B');

insert into usuarios (id, empresa_id, email, nombre, rol, activo) values
  (t_uid('admA'), '11111111-1111-1111-1111-111111111111', 'adma@t', 'admA', 'ADMIN',   true),
  (t_uid('gerA'), '11111111-1111-1111-1111-111111111111', 'gera@t', 'gerA', 'GERENTE', true),
  (t_uid('cocA'), '11111111-1111-1111-1111-111111111111', 'coca@t', 'cocA', 'COCINA',  true),
  (t_uid('audA'), '11111111-1111-1111-1111-111111111111', 'auda@t', 'audA', 'AUDITOR', true),
  (t_uid('cajA'), '11111111-1111-1111-1111-111111111111', 'caja@t', 'cajA', 'CAJERO',  true),
  (t_uid('inaA'), '11111111-1111-1111-1111-111111111111', 'inaa@t', 'inaA', 'COCINA',  false),
  (t_uid('admB'), '22222222-2222-2222-2222-222222222222', 'admb@t', 'admB', 'ADMIN',   true);

insert into proveedores (id, empresa_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Prov A'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Prov B');
