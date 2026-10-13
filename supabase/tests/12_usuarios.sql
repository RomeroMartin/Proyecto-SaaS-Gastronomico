-- ============================================================================
-- Test Fase 0.3 — usuarios inactivos, CAJERO, vincular_usuario y salvaguardas
-- ============================================================================
begin;

insert into auth.users (id, email) values
  ('d0000000-0000-0000-0000-000000000001', 'nuevo@t'),
  ('d0000000-0000-0000-0000-000000000002', 'otro@t');

set role authenticated;

-- Usuario inactivo.
select t_login('inaA');
select t_ok(mi_empresa() is null, 'mi_empresa() es null para un usuario inactivo');
select t_ok(mi_rol() is null, 'mi_rol() es null para un usuario inactivo');
select t_igual((select count(*)::int from proveedores), 0, 'usuario inactivo no ve proveedores');
select t_igual((select count(*)::int from usuarios), 1, 'usuario inactivo ve su propia fila (para poder avisarle)');
select t_igual((select activo from usuarios), false, 'y esa fila dice activo = false');
select t_falla($$select crear_factura('c1000000-0000-0000-0000-000000000001','A','X',current_date,null,1,0,0,1,null,null,0)$$,
  'usuario inactivo no opera por RPC', 'sin empresa');

-- CAJERO es un rol válido.
select t_login('admA');
select t_filas($$update usuarios set rol = 'CAJERO' where id = t_uid('cocA')$$, 1, 'CAJERO es un rol válido');
select t_falla($$update usuarios set rol = 'SUPERHEROE' where id = t_uid('cocA')$$, 'un rol inventado se rechaza', 'check');

-- vincular_usuario.
select t_login('gerA');
select t_falla($$select vincular_usuario('nuevo@t', 'COCINA', 'Nuevo')$$, 'GERENTE no puede vincular usuarios', 'Sin permiso');
select t_login('cajA');
select t_falla($$select vincular_usuario('nuevo@t', 'COCINA', 'Nuevo')$$, 'CAJERO no puede vincular usuarios', 'Sin permiso');
select t_login('admA');
select t_falla($$select vincular_usuario('noexiste@t', 'COCINA', 'X')$$, 'email sin cuenta en Auth se rechaza con mensaje claro', 'No existe una cuenta');
select t_falla($$select vincular_usuario('nuevo@t', 'REY', 'X')$$, 'rol inválido se rechaza', 'Rol inválido');
select t_falla($$select vincular_usuario('adma@t', 'ADMIN', 'X')$$, 'no se puede vincular a alguien que ya es de mi empresa', 'ya pertenece a tu empresa');
select t_ok(vincular_usuario('NUEVO@t', 'CAJERO', 'Cajero Nuevo') = 'd0000000-0000-0000-0000-000000000001'::uuid,
  'ADMIN vincula una cuenta existente (el email no distingue mayúsculas)');
select t_igual((select rol from usuarios where id = 'd0000000-0000-0000-0000-000000000001'), 'CAJERO', 'el usuario vinculado queda con el rol elegido');
select t_igual((select empresa_id from usuarios where id = 'd0000000-0000-0000-0000-000000000001'), '11111111-1111-1111-1111-111111111111'::uuid, 'y en la empresa del ADMIN');
select t_falla($$select vincular_usuario('nuevo@t', 'COCINA', 'X')$$, 'no se vincula dos veces', 'ya pertenece a tu empresa');
select t_igual((select count(*)::int from auditoria where accion = 'vincular_usuario'), 1, 'el vínculo queda auditado');

select t_login('admB');
select t_falla($$select vincular_usuario('nuevo@t', 'COCINA', 'X')$$, 'otra empresa no puede robarse un usuario ya vinculado', 'otra empresa');
select t_ok(vincular_usuario('otro@t', 'AUDITOR', null) is not null, 'otra empresa vincula su propia cuenta');

-- El usuario vinculado ya opera con su rol.
select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-000000000001', false);
select t_igual(mi_rol(), 'CAJERO', 'el usuario vinculado entra con rol CAJERO');
select t_igual((select count(*)::int from facturas), 0, 'y el CAJERO recién vinculado no ve facturas');

-- Salvaguardas.
select t_login('admA');
select t_falla($$update usuarios set activo = false where id = t_uid('admA')$$, 'nadie se desactiva a sí mismo', 'No podés desactivar');
select t_falla($$update usuarios set rol = 'GERENTE' where id = t_uid('admA')$$, 'no se puede dejar la empresa sin ADMIN (degradar)', 'al menos un ADMIN');
select t_filas($$update usuarios set activo = false where id = t_uid('cocA')$$, 1, 'ADMIN desactiva a otro usuario');
select t_login('cocA');
select t_igual((select count(*)::int from proveedores), 0, 'el usuario desactivado pierde el acceso al instante');
select t_login('admA');
select t_filas($$update usuarios set activo = true where id = t_uid('cocA')$$, 1, 'ADMIN reactiva al usuario');
select t_filas($$update usuarios set rol = 'ADMIN' where id = t_uid('gerA')$$, 1, 'ADMIN promueve a otro ADMIN');
select t_filas($$update usuarios set rol = 'GERENTE' where id = t_uid('admA')$$, 1, 'con otro ADMIN activo, el primero sí puede degradarse');
select t_login('gerA');   -- ahora ADMIN, único
select t_falla($$update usuarios set rol = 'COCINA' where id = t_uid('gerA')$$, 'el único ADMIN no puede degradarse', 'al menos un ADMIN');

-- Auditoría de cambios de rol/estado (los ve el ADMIN de la empresa).
select t_igual((select count(*)::int from auditoria where accion = 'cambio_usuario'), 5,
  'los cambios de rol/estado quedan auditados (CAJERO, baja, alta, promoción, degradación)');
select t_ok(exists (select 1 from auditoria where accion = 'cambio_usuario' and antes ->> 'rol' = 'COCINA' and despues ->> 'rol' = 'CAJERO'),
  'la auditoría guarda el valor anterior y el nuevo');

rollback;
