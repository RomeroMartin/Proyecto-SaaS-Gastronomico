-- ============================================================================
-- Test Fase 3 — Rentabilidad real: vistas de ventas, compras del período,
-- configuración de rubros y permisos por rol.
-- ============================================================================
begin;

update empresas set modulos = '{admin,costos,carta,rrhh,ventas}', usa_delivery = true where id = '11111111-1111-1111-1111-111111111111';
insert into insumos (id, empresa_id, nombre, magnitud, unidad_base, costo_neto_por_unidad_base_centavos)
values ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Carne', 'masa', 'g', 12.5);
insert into recetas (id, empresa_id, nombre, tipo, precio_venta_publico_centavos, vende_en_mostrador, categoria_venta, es_adicional) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Hamburguesa', 'plato', 10000, true, 'Burgers', false),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Gaseosa', 'plato', 2500, true, 'Bebidas', false),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Medallón extra', 'plato', 1500, true, 'Extras', true);
insert into ingredientes_receta (empresa_id, receta_padre_id, insumo_id, cantidad)
select '11111111-1111-1111-1111-111111111111', r.id, 'e1000000-0000-0000-0000-000000000001', c
  from (values ('f1000000-0000-0000-0000-000000000001'::uuid, 200), ('f1000000-0000-0000-0000-000000000002', 50),
               ('f1000000-0000-0000-0000-000000000003', 100)) v(rid, c) join recetas r on r.id = v.rid;
select round(_costo_receta('f1000000-0000-0000-0000-000000000001', '{}'::uuid[], 0))::bigint as c_ham,
       round(_costo_receta('f1000000-0000-0000-0000-000000000002', '{}'::uuid[], 0))::bigint as c_gas,
       round(_costo_receta('f1000000-0000-0000-0000-000000000003', '{}'::uuid[], 0))::bigint as c_ext \gset

set role authenticated;
select t_login('cajA');

-- ---- Día 1 (10/03): 3 pedidos + 1 anulado ----
select abrir_turno(0) as t1 \gset
reset role;
update turnos_caja set fecha_operativa = date '2026-03-10' where id = :'t1';
set role authenticated;
select t_login('cajA');
select (crear_pedido(:'t1', '{}', '[{"receta_id":"f1000000-0000-0000-0000-000000000001","cantidad":2,"adicionales":[{"receta_id":"f1000000-0000-0000-0000-000000000003","cantidad":1}]}]',
  '[{"medio":"efectivo","monto_centavos":21500}]', null) ->> 'id') as p1 \gset
select crear_pedido(:'t1', '{"descuento_centavos":500}', '[{"receta_id":"f1000000-0000-0000-0000-000000000002","cantidad":2}]',
  '[{"medio":"efectivo","monto_centavos":4500}]', null);
select crear_pedido(:'t1', '{"modalidad":"delivery","envio_centavos":800}', '[{"receta_id":"f1000000-0000-0000-0000-000000000001","cantidad":1}]',
  '[{"medio":"efectivo","monto_centavos":10800}]', null);
select (crear_pedido(:'t1', '{}', '[{"receta_id":"f1000000-0000-0000-0000-000000000001","cantidad":1}]',
  '[{"medio":"efectivo","monto_centavos":10000}]', null) ->> 'id') as p4 \gset
select anular_pedido(:'p4', 'error de carga');
reset role;
update pedidos set creado_en = timestamptz '2026-03-10 22:15-03' where id = :'p1';
set role authenticated;
select t_login('cajA');
select cerrar_turno(:'t1', 36800, null);

-- ---- Día 2 (11/03): el precio de la hamburguesa sube a mitad del período ----
reset role;
update recetas set precio_venta_publico_centavos = 12000 where id = 'f1000000-0000-0000-0000-000000000001';
set role authenticated;
select t_login('cajA');
select abrir_turno(0) as t2 \gset
reset role;
update turnos_caja set fecha_operativa = date '2026-03-11' where id = :'t2';
set role authenticated;
select t_login('cajA');
select crear_pedido(:'t2', '{}', '[{"receta_id":"f1000000-0000-0000-0000-000000000001","cantidad":1}]', '[{"medio":"efectivo","monto_centavos":12000}]', null);
select cerrar_turno(:'t2', 12000, null);

-- ---- Vistas ----
select t_login('gerA');
select t_igual((select pedidos from v_ventas_por_dia where fecha_operativa = date '2026-03-10'), 3, 'día 1: 3 pedidos (el anulado no cuenta)');
select t_igual((select ingreso_centavos from v_ventas_por_dia where fecha_operativa = date '2026-03-10'), 36800::bigint, 'día 1: ingreso cobrado = 21.500 + 4.500 + 10.800');
select t_igual((select productos_netos_centavos from v_ventas_por_dia where fecha_operativa = date '2026-03-10'), 36000::bigint, 'productos netos = ingreso − envío (36.000)');
select t_igual((select descuento_centavos from v_ventas_por_dia where fecha_operativa = date '2026-03-10'), 500::bigint, 'descuentos');
select t_igual((select envio_centavos from v_ventas_por_dia where fecha_operativa = date '2026-03-10'), 800::bigint, 'envíos');
select t_igual((select costo_centavos from v_ventas_por_dia where fecha_operativa = date '2026-03-10'),
  (3 * :c_ham + :c_ext + 2 * :c_gas)::bigint, 'costo teórico = costo de las recetas al vender (sin el anulado)');
select t_ok((select anulados = 1 and monto_anulado_centavos = 10000 from v_ventas_por_dia where fecha_operativa = date '2026-03-10'), 'el anulado se informa aparte');
select t_igual((select ingreso_centavos from v_ventas_por_dia where fecha_operativa = date '2026-03-11'), 12000::bigint, 'día 2');
-- Los totales de la vista coinciden con la suma de los cierres de caja del mismo rango.
select t_igual((select sum(ingreso_centavos)::bigint from v_ventas_por_dia where fecha_operativa between date '2026-03-10' and date '2026-03-11'),
  (select sum(monto_centavos)::bigint from movimientos_caja where categoria = 'Ventas' and origen = 'cierre_turno' and activo and fecha between date '2026-03-10' and date '2026-03-11'),
  'Σ ventas de la vista = Σ ingresos "Ventas" de los cierres');
-- Por plato: el precio cambió a mitad del período → ingreso real cobrado.
select t_igual((select unidades from v_ventas_por_plato where nombre = 'Hamburguesa' and fecha_operativa = date '2026-03-10'), 3::bigint, 'hamburguesas del día 1 (2 + 1; el anulado no)');
select t_igual((select sum(ingreso_centavos)::bigint from v_ventas_por_plato where nombre = 'Hamburguesa'), 42000::bigint,
  'hamburguesa: 3 × 10.000 + 1 × 12.000 (precio real cobrado, no el de hoy)');
select t_igual((select unidades from v_ventas_por_plato where nombre = 'Medallón extra'), 1::bigint, 'el adicional cuenta como su propia receta');
select t_igual((select costo_centavos from v_ventas_por_plato where nombre = 'Gaseosa'), (2 * :c_gas)::bigint, 'costo por plato');
-- Por hora (hora local de la empresa) y día de la semana.
select t_ok((select pedidos = 1 and ingreso_centavos = 21500 and dow = 2 from v_ventas_por_hora where hora = 22 and fecha_operativa = date '2026-03-10'),
  'franja de las 22 h (hora local) del martes');
select t_igual((select sum(pedidos) from v_ventas_por_hora)::int, 4, 'las franjas suman los 4 pedidos');

-- ---- Permisos de las vistas ----
select t_login('audA');
select t_ok((select count(*) from v_ventas_por_dia) = 2, 'AUDITOR lee las ventas');
select t_login('admA');
select t_ok((select count(*) from v_ventas_por_plato) > 0, 'ADMIN lee las ventas por plato');
select t_login('cajA');
select t_igual((select count(*)::int from v_ventas_por_dia), 0, 'CAJERO no ve reportes (turnos cerrados)');
select t_igual((select count(*)::int from v_ventas_por_plato), 0, 'ni por plato');
select t_login('cocA');
select t_igual((select count(*)::int from v_ventas_por_dia), 0, 'COCINA no ve ventas');
select t_login('admB');
select t_igual((select count(*)::int from v_ventas_por_dia), 0, 'otra empresa no ve mis ventas');

-- ---- Compras del período ----
reset role;
insert into proveedores (id, empresa_id, nombre, rubro_principal) values
  ('c1000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Verdulería', 'Verduras'),
  ('c1000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'Limpieza SA', ' limpieza '),
  ('c1000000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'Bebidas SA', 'Bebidas');
insert into facturas (empresa_id, proveedor_id, tipo_comprobante, fecha_emision, neto_gravado_centavos, iva_discriminado_centavos, percepciones_centavos, monto_total_centavos, saldo_pendiente_centavos, estado) values
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-0000000000a1', 'A', date '2026-03-05', 100000, 21000, 0, 121000, 121000, 'pendiente'),
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-0000000000a1', 'A', date '2026-03-06', 50000, 10500, 3000, 63500, 63500, 'anulada'),
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-0000000000a1', 'A', date '2026-02-20', 70000, 14700, 0, 84700, 84700, 'pendiente'),
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-0000000000a2', 'A', date '2026-03-07', 20000, 4200, 0, 24200, 24200, 'pendiente'),
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-0000000000a3', 'B', date '2026-03-08', 30000, 0, 0, 30000, 30000, 'pagada');
set role authenticated;
select t_login('audA');
select t_ok((compras_periodo(date '2026-03-01', date '2026-03-31') ->> 'compras_centavos')::bigint = 121000 + 30000,
  'compras = facturas no anuladas del rango, neto + IVA, sin rubros excluidos (Limpieza) ni percepciones');
select t_ok((compras_periodo(date '2026-03-01', date '2026-03-31') ->> 'excluidas_centavos')::bigint = 24200, 'lo excluido se informa aparte (rubro con espacios y minúsculas)');
select t_ok((compras_periodo(date '2026-03-01', date '2026-03-31') ->> 'facturas')::int = 2, 'cantidad de facturas que cuentan');
select t_ok((compras_periodo(date '2026-02-01', date '2026-02-28') ->> 'compras_centavos')::bigint = 84700, 'otro rango');
select t_falla($$select compras_periodo(date '2026-03-31', date '2026-03-01')$$, 'rango invertido', 'inválido');
select t_login('cajA');
select t_ok((compras_periodo(date '2026-03-01', date '2026-03-31') ->> 'compras_centavos')::bigint = 0, 'CAJERO no ve compras');
select t_login('admB');
select t_ok((compras_periodo(date '2026-03-01', date '2026-03-31') ->> 'compras_centavos')::bigint = 0, 'otra empresa no ve mis compras');

-- ---- Configuración de rubros ----
select t_login('gerA');
select t_falla($$select set_config_reportes('rubros_excluidos_cmv', '["Bebidas"]')$$, 'GERENTE no cambia la configuración', 'Sin permiso');
select t_login('cajA');
select t_falla($$select set_config_reportes('rubros_excluidos_cmv', '["Bebidas"]')$$, 'CAJERO tampoco', 'Sin permiso');
select t_login('admA');
select t_falla($$update empresas set rubros_excluidos_cmv = '{}' where id = '11111111-1111-1111-1111-111111111111'$$, 'no se escribe directo', 'permission denied');
select t_falla($$select set_config_reportes('rubros_excluidos_cmv', '"Bebidas"')$$, 'valor que no es lista', 'inválido');
select t_falla($$select set_config_reportes('otra', '[]')$$, 'clave desconocida', 'desconocido');
select set_config_reportes('rubros_excluidos_cmv', '["Limpieza", "Bebidas", "Bebidas", " "]');
select t_ok((compras_periodo(date '2026-03-01', date '2026-03-31') ->> 'compras_centavos')::bigint = 121000, 'al excluir Bebidas también, las compras bajan');
select t_ok((select count(*) from auditoria where accion = 'config_reportes') = 1, 'el cambio queda auditado');

reset role;
rollback;
