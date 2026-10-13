-- ============================================================================
-- Test Fase 0.1 — matriz de roles y RLS
-- ============================================================================
begin;

-- Datos de ejemplo en cada tabla de la matriz (como superusuario).
do $$
declare
  ea uuid := '11111111-1111-1111-1111-111111111111';
  eb uuid := '22222222-2222-2222-2222-222222222222';
  pa uuid := 'c1000000-0000-0000-0000-000000000001';
  pb uuid := 'c2000000-0000-0000-0000-000000000001';
  fa uuid := gen_random_uuid(); pg uuid := gen_random_uuid(); ia uuid := gen_random_uuid(); ra uuid := gen_random_uuid();
begin
  insert into sucursales (empresa_id, nombre) values (ea, 'Suc A'), (eb, 'Suc B');
  insert into facturas (id, empresa_id, proveedor_id, tipo_comprobante, fecha_emision, neto_gravado_centavos, monto_total_centavos, saldo_pendiente_centavos)
    values (fa, ea, pa, 'A', current_date, 100, 100, 100), (gen_random_uuid(), eb, pb, 'A', current_date, 100, 100, 100);
  insert into pagos (id, empresa_id, proveedor_id, monto_pagado_centavos) values (pg, ea, pa, 10), (gen_random_uuid(), eb, pb, 10);
  insert into pago_imputaciones (empresa_id, pago_id, factura_id, monto_imputado_centavos) values (ea, pg, fa, 10);
  insert into pagos_programados (empresa_id, fecha_programada, monto_centavos) values (ea, current_date, 5), (eb, current_date, 5);
  insert into movimientos_caja (empresa_id, fecha, tipo, monto_centavos) values (ea, current_date, 'ingreso', 5), (eb, current_date, 'ingreso', 5);
  insert into insumos (id, empresa_id, nombre, magnitud, unidad_base) values (ia, ea, 'Ins A', 'masa', 'g'), (gen_random_uuid(), eb, 'Ins B', 'masa', 'g');
  insert into historial_precios_insumo (empresa_id, insumo_id, costo_nuevo_centavos) values (ea, ia, 1);
  insert into recetas (id, empresa_id, nombre) values (ra, ea, 'Rec A'), (gen_random_uuid(), eb, 'Rec B');
  insert into ingredientes_receta (empresa_id, receta_padre_id, insumo_id, cantidad) values (ea, ra, ia, 1);
  insert into catalogos (empresa_id, tipo, valor) values (ea, 'rubro', 'X'), (eb, 'rubro', 'Y');
end $$;

set role authenticated;

-- Matriz: tabla, roles que leen, roles que escriben (independiente de la implementación).
do $$
declare
  m record; a text; n int; lee boolean; escribe boolean;
  roles text[][] := array[['admA','ADMIN'],['gerA','GERENTE'],['cocA','COCINA'],['audA','AUDITOR'],['cajA','CAJERO']];
  i int;
begin
  for m in select * from (values
    ('sucursales',               '{ADMIN,GERENTE,COCINA,AUDITOR}', '{ADMIN}'),
    ('proveedores',              '{ADMIN,GERENTE,COCINA,AUDITOR}', '{ADMIN,GERENTE}'),
    ('facturas',                 '{ADMIN,GERENTE,AUDITOR}',        '{ADMIN,GERENTE}'),
    ('pagos',                    '{ADMIN,GERENTE,AUDITOR}',        '{ADMIN,GERENTE}'),
    ('pago_imputaciones',        '{ADMIN,GERENTE,AUDITOR}',        '{ADMIN,GERENTE}'),
    ('pagos_programados',        '{ADMIN,GERENTE,AUDITOR}',        '{ADMIN,GERENTE}'),
    ('movimientos_caja',         '{ADMIN,GERENTE,AUDITOR}',        '{ADMIN,GERENTE}'),
    ('insumos',                  '{ADMIN,GERENTE,COCINA,AUDITOR}', '{ADMIN,GERENTE,COCINA}'),
    ('historial_precios_insumo', '{ADMIN,GERENTE,COCINA,AUDITOR}', '{ADMIN,GERENTE,COCINA}'),
    ('recetas',                  '{ADMIN,GERENTE,COCINA,AUDITOR}', '{ADMIN,GERENTE,COCINA}'),
    ('ingredientes_receta',      '{ADMIN,GERENTE,COCINA,AUDITOR}', '{ADMIN,GERENTE,COCINA}'),
    ('catalogos',                '{ADMIN,GERENTE,COCINA,AUDITOR}', '{ADMIN,GERENTE}')
  ) as x(tabla, lectura, escritura)
  loop
    for i in 1..array_length(roles, 1) loop
      perform t_login(roles[i][1]);
      lee      := roles[i][2] = any (m.lectura::text[]);
      escribe  := roles[i][2] = any (m.escritura::text[]);
      execute format('select count(*) from %I', m.tabla) into n;
      perform t_ok((n > 0) = lee, format('%s %s lee %s', roles[i][2], case when lee then 'puede' else 'NO puede' end, m.tabla));
      execute format('update %I set empresa_id = empresa_id', m.tabla);
      get diagnostics n = row_count;
      perform t_ok((n > 0) = escribe, format('%s %s escribir %s', roles[i][2], case when escribe then 'puede' else 'NO puede' end, m.tabla));
    end loop;
    -- Usuario inactivo y de otra empresa: nada.
    perform t_login('inaA');
    execute format('select count(*) from %I', m.tabla) into n;
    perform t_ok(n = 0, format('usuario INACTIVO no ve %s', m.tabla));
    perform t_login('admB');
    execute format('select count(*) from %I where empresa_id = %L', m.tabla, '11111111-1111-1111-1111-111111111111') into n;
    perform t_ok(n = 0, format('otra empresa no ve filas de %s', m.tabla));
    execute format('update %I set empresa_id = empresa_id where empresa_id = %L', m.tabla, '11111111-1111-1111-1111-111111111111');
    get diagnostics n = row_count;
    perform t_ok(n = 0, format('otra empresa no puede modificar %s', m.tabla));
  end loop;
end $$;

-- Escritura real (insert) según rol.
select t_login('audA');
select t_falla($$insert into proveedores (empresa_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'X')$$,
  'AUDITOR no puede insertar proveedores', 'row-level security');
select t_login('cocA');
select t_falla($$insert into facturas (empresa_id, proveedor_id, tipo_comprobante, fecha_emision, neto_gravado_centavos, monto_total_centavos, saldo_pendiente_centavos)
  values ('11111111-1111-1111-1111-111111111111','c1000000-0000-0000-0000-000000000001','A',current_date,1,1,1)$$,
  'COCINA no puede insertar facturas', 'row-level security');
select t_login('cajA');
select t_falla($$insert into movimientos_caja (empresa_id, fecha, tipo, monto_centavos) values ('11111111-1111-1111-1111-111111111111', current_date, 'ingreso', 1)$$,
  'CAJERO no puede insertar movimientos de caja', 'row-level security');
select t_login('gerA');
select t_filas($$insert into proveedores (empresa_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Nuevo')$$, 1, 'GERENTE sí inserta proveedores');
select t_login('cocA');
select t_filas($$insert into insumos (empresa_id, nombre, magnitud, unidad_base) values ('11111111-1111-1111-1111-111111111111', 'Nuevo', 'masa', 'g')$$, 1, 'COCINA sí inserta insumos');

-- RPC de facturas: exigen rol ADMIN/GERENTE.
select t_login('audA');
select t_falla($$select crear_factura('c1000000-0000-0000-0000-000000000001','A','T-1',current_date,null,100,0,0,100,null,null,0)$$,
  'AUDITOR no puede crear factura por RPC', 'Sin permiso');
select t_login('cocA');
select t_falla($$select crear_factura('c1000000-0000-0000-0000-000000000001','A','T-1',current_date,null,100,0,0,100,null,null,0)$$,
  'COCINA no puede crear factura por RPC', 'Sin permiso');
select t_login('cajA');
select t_falla($$select crear_factura('c1000000-0000-0000-0000-000000000001','A','T-1',current_date,null,100,0,0,100,null,null,0)$$,
  'CAJERO no puede crear factura por RPC', 'Sin permiso');
select t_login('gerA');
select t_ok(crear_factura('c1000000-0000-0000-0000-000000000001','A','T-1',current_date,null,100,0,0,100,null,null,0) is not null,
  'GERENTE sí crea factura por RPC');
select t_login('admA');
select t_ok(crear_factura('c1000000-0000-0000-0000-000000000001','A','T-2',current_date,null,100,0,0,100,null,null,0) is not null,
  'ADMIN sí crea factura por RPC');

select t_login('audA');
select t_falla($$select anular_factura((select id from facturas limit 1))$$, 'AUDITOR no puede anular factura', 'Sin permiso');
select t_falla($$select editar_factura((select id from facturas limit 1),'c1000000-0000-0000-0000-000000000001','A','x',current_date,null,1,0,0,0,1,null)$$,
  'AUDITOR no puede editar factura', 'Sin permiso');

-- usuarios: lectura y escritura acotadas.
select t_login('audA');
select t_igual((select count(*)::int from usuarios), 1, 'AUDITOR ve solo su propia fila de usuarios');
select t_login('cocA');
select t_igual((select count(*)::int from usuarios), 1, 'COCINA ve solo su propia fila de usuarios');
select t_login('gerA');
select t_igual((select count(*)::int from usuarios), 6, 'GERENTE ve los usuarios de su empresa');
select t_filas($$update usuarios set rol = 'ADMIN' where id = t_uid('cocA')$$, 0, 'GERENTE no puede cambiar roles');
select t_login('cocA');
select t_filas($$update usuarios set nombre = 'hack' where id = t_uid('audA')$$, 0, 'COCINA no puede editar a otros');
select t_login('admA');
select t_filas($$update usuarios set rol = 'GERENTE' where id = t_uid('cocA')$$, 1, 'ADMIN sí cambia roles');
select t_falla($$update usuarios set empresa_id = '22222222-2222-2222-2222-222222222222' where id = t_uid('cocA')$$,
  'ADMIN no puede mover un usuario a otra empresa (columna protegida)', 'permission denied');
select t_falla($$insert into usuarios (id, empresa_id, email, nombre, rol) values (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'z@z', 'z', 'ADMIN')$$,
  'nadie inserta usuarios directo', 'permission denied');
select t_falla($$delete from usuarios where id = t_uid('cocA')$$, 'nadie borra usuarios', 'permission denied');

rollback;
