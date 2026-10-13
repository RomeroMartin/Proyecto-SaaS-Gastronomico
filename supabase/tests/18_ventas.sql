-- ============================================================================
-- Test Fase 2 — Ventas de mostrador: configuración, carta, turnos, pedidos,
-- cierre al Flujo de caja, reapertura, permisos por rol y fecha operativa.
-- ============================================================================
begin;

-- Fixture (como dueño de la base): empresa A con ventas, un insumo y 4 recetas.
update empresas set modulos = '{admin,costos,carta,rrhh,ventas}' where id = '11111111-1111-1111-1111-111111111111';
insert into insumos (id, empresa_id, nombre, magnitud, unidad_base, costo_neto_por_unidad_base_centavos)
values ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Carne', 'masa', 'g', 12.5);
insert into recetas (id, empresa_id, nombre, tipo, precio_venta_publico_centavos) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Hamburguesa', 'plato', 10000),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Gaseosa', 'plato', 2500),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Medallón extra', 'plato', 1500),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Salsa base', 'preparacion', 0),
  ('f1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Plato sin precio', 'plato', 0);
insert into ingredientes_receta (empresa_id, receta_padre_id, insumo_id, cantidad)
select '11111111-1111-1111-1111-111111111111', r.id, 'e1000000-0000-0000-0000-000000000001', c
  from (values ('f1000000-0000-0000-0000-000000000001'::uuid, 200), ('f1000000-0000-0000-0000-000000000002', 50),
               ('f1000000-0000-0000-0000-000000000003', 100)) v(rid, c) join recetas r on r.id = v.rid;

select (2 * round(_costo_receta('f1000000-0000-0000-0000-000000000001', '{}'::uuid[], 0))
        + round(_costo_receta('f1000000-0000-0000-0000-000000000003', '{}'::uuid[], 0))
        + round(_costo_receta('f1000000-0000-0000-0000-000000000002', '{}'::uuid[], 0)))::bigint as costo_esp \gset

-- ---- fecha_operativa: casos compartidos con test/utilsFecha.test.js ----
select t_igual(fecha_operativa('2026-03-10 19:30-03', 'America/Argentina/Buenos_Aires', '06:00'), date '2026-03-10', '19:30 → mismo día');
select t_igual(fecha_operativa('2026-03-11 00:40-03', 'America/Argentina/Buenos_Aires', '06:00'), date '2026-03-10', '00:40 → día anterior');
select t_igual(fecha_operativa('2026-03-11 05:59-03', 'America/Argentina/Buenos_Aires', '06:00'), date '2026-03-10', '05:59 → día anterior');
select t_igual(fecha_operativa('2026-03-11 06:00-03', 'America/Argentina/Buenos_Aires', '06:00'), date '2026-03-11', '06:00 → mismo día');
select t_igual(fecha_operativa('2026-03-01 01:00-03', 'America/Argentina/Buenos_Aires', '06:00'), date '2026-02-28', 'cambio de mes');
select t_igual(fecha_operativa('2027-01-01 02:00-03', 'America/Argentina/Buenos_Aires', '06:00'), date '2026-12-31', 'cambio de año');
select t_igual(fecha_operativa('2026-03-11 02:30-03', 'America/Argentina/Buenos_Aires', '03:00'), date '2026-03-10', 'corte configurable (03:00)');
select t_igual(fecha_operativa('2026-03-11 02:30+00', 'America/Mexico_City', '06:00'), date '2026-03-10', 'otra zona horaria');

set role authenticated;

-- ---- Receta vendible: quién la configura ----
select t_login('cajA');
select t_falla($$select configurar_venta_receta('f1000000-0000-0000-0000-000000000001', true, 'Burgers', 1, false)$$, 'CAJERO no configura la carta', 'Sin permiso');
select t_login('audA');
select t_falla($$select configurar_venta_receta('f1000000-0000-0000-0000-000000000001', true, 'Burgers', 1, false)$$, 'AUDITOR no configura la carta', 'Sin permiso');
select t_login('cocA');
select configurar_venta_receta('f1000000-0000-0000-0000-000000000001', true, 'Burgers', 1, false);
select t_login('admA');
select configurar_venta_receta('f1000000-0000-0000-0000-000000000002', true, 'Bebidas', 1, false);
select configurar_venta_receta('f1000000-0000-0000-0000-000000000003', true, 'Extras', 1, true);
select t_falla($$select configurar_venta_receta('f1000000-0000-0000-0000-000000000004', true, 'X', 1, false)$$, 'una preparación no se vende', 'plato');
select t_falla($$select configurar_venta_receta('f1000000-0000-0000-0000-000000000005', true, 'X', 1, false)$$, 'un plato sin precio no se vende', 'precio');
select t_login('admB');
select t_falla($$select configurar_venta_receta('f1000000-0000-0000-0000-000000000001', true, 'X', 1, false)$$, 'otra empresa no toca mis recetas', 'inexistente');
reset role;
select t_falla($$update recetas set vende_en_mostrador = true where id = 'f1000000-0000-0000-0000-000000000004'$$, 'constraint: solo platos vendibles', 'chk_vende_solo_platos');
set role authenticated;

-- ---- Módulo activo + roles ----
select t_login('admB');
select t_falla($$select abrir_turno(0)$$, 'sin el módulo ventas no se puede operar', 'módulo de ventas');
select t_falla($$select config_cobro()$$, 'ni leer la configuración de cobro', 'módulo de ventas');

-- ---- Configuración de ventas ----
select t_login('cajA');
select t_falla($$select set_config_ventas('alias_transferencia', '"mi.alias"')$$, 'CAJERO no cambia el alias de cobro', 'Sin permiso');
select t_login('gerA');
select t_falla($$select set_config_ventas('alias_transferencia', '"mi.alias"')$$, 'GERENTE no cambia el alias de cobro', 'Sin permiso');
select t_login('admA');
select t_falla($$update empresas set alias_transferencia = 'x' where id = '11111111-1111-1111-1111-111111111111'$$, 'ADMIN no escribe el alias directo', 'permission denied');
select t_falla($$update empresas set modo_comanda = 'impresora' where id = '11111111-1111-1111-1111-111111111111'$$, 'ni el modo de comanda directo', 'permission denied');
select set_config_ventas('alias_transferencia', '"local.cobros"');
select set_config_ventas('whatsapp_cocina', '"+54 9 221 200-8160"');
select set_config_ventas('medios_pago_habilitados', '["transferencia","efectivo"]');
select t_falla($$select set_config_ventas('alias_transferencia', '"a;drop table x"')$$, 'alias con caracteres raros se rechaza', 'inválido');
select t_falla($$select set_config_ventas('whatsapp_cocina', '"123"')$$, 'WhatsApp muy corto se rechaza', 'inválido');
select t_falla($$select set_config_ventas('medios_pago_habilitados', '[]')$$, 'sin medios de pago se rechaza', 'inválidos');
select t_falla($$select set_config_ventas('medios_pago_habilitados', '["bitcoin"]')$$, 'medio desconocido se rechaza', 'inválidos');
select t_falla($$select set_config_ventas('hora_corte_dia', '"25:00"')$$, 'hora de corte inválida', 'inválida');
select t_falla($$select set_config_ventas('modo_comanda', '"paloma"')$$, 'modo de comanda inválido', 'inválido');
select t_falla($$select set_config_ventas('ancho_ticket_mm', '70')$$, 'ancho de ticket inválido', 'inválido');
select t_falla($$select set_config_ventas('usa_delivery', '"si"')$$, 'booleano inválido', 'inválido');
select t_falla($$select set_config_ventas('inventada', '1')$$, 'clave fuera de la lista', 'desconocido');
select set_config_ventas('modo_comanda', '"impresora_whatsapp"');
select set_config_ventas('ancho_ticket_mm', '58');
select set_config_ventas('plantilla_comanda', '"PEDIDO {numero} - {total}"');
select t_ok((select alias_transferencia = 'local.cobros' and whatsapp_cocina = '5492212008160' and modo_comanda = 'impresora_whatsapp'
                    and ancho_ticket_mm = 58 and medios_pago_habilitados = '{efectivo,transferencia}' from empresas),
  'configuración guardada y normalizada');
select t_ok((select count(*) from auditoria where accion = 'config_ventas') >= 5, 'los cambios de configuración quedan auditados');
select t_login('cajA');
select t_ok((config_cobro() ->> 'alias_transferencia') = 'local.cobros', 'CAJERO ve el alias vigente por config_cobro()');
select t_ok((config_cobro() ->> 'modo_comanda') = 'impresora_whatsapp' and (config_cobro() ->> 'ancho_ticket_mm') = '58', 'y el modo de comanda');
select t_igual((select count(*)::int from empresas where alias_transferencia is not null), 1, 'CAJERO lee la empresa (nombre) pero solo vía RPC el resto');
select t_login('audA');
select t_falla($$select config_cobro()$$, 'AUDITOR no usa el mostrador', 'Sin permiso');

-- ---- Carta del mostrador (sin costos) ----
select t_login('cajA');
select t_igual((select count(*)::int from carta_mostrador()), 3, 'el cajero ve las 3 recetas vendibles (no la preparación)');
select t_ok(not exists (select 1 from carta_mostrador() c where c.nombre = 'Salsa base'), 'la preparación no aparece');
select t_ok((select es_adicional from carta_mostrador() where nombre = 'Medallón extra'), 'el adicional viene marcado');
select t_igual((select count(*)::int from information_schema.columns where table_name = 'carta_mostrador'), 0, 'carta_mostrador es función, sin tabla de costos');
select t_login('cocA');
select t_falla($$select * from carta_mostrador()$$, 'COCINA no usa el mostrador', 'Sin permiso');

-- ---- El CAJERO no toca tablas de negocio ----
select t_login('cajA');
select t_igual((select count(*)::int from recetas), 0, 'CAJERO no lee recetas');
select t_igual((select count(*)::int from facturas), 0, 'CAJERO no lee facturas');
select t_igual((select count(*)::int from proveedores), 0, 'CAJERO no lee proveedores');
select t_igual((select count(*)::int from movimientos_caja), 0, 'CAJERO no lee el flujo de caja');
select t_filas($$update recetas set precio_venta_publico_centavos = 1$$, 0, 'CAJERO no cambia precios (0 filas)');

-- ---- Abrir caja ----
select t_login('cocA');
select t_falla($$select abrir_turno(0)$$, 'COCINA no abre caja', 'Sin permiso');
select t_login('audA');
select t_falla($$select abrir_turno(0)$$, 'AUDITOR no abre caja', 'Sin permiso');
select t_login('cajA');
select t_falla($$select abrir_turno(-1)$$, 'fondo negativo', 'negativo');
select abrir_turno(5000) as turno \gset
select t_falla($$select abrir_turno(0)$$, 'solo una caja abierta', 'Ya hay una caja abierta');
select t_ok((select estado = 'abierto' and fondo_inicial_centavos = 5000 and fecha_operativa is not null from turnos_caja where id = :'turno'),
  'el turno queda abierto con su fondo y fecha operativa');
select t_falla($$insert into turnos_caja (empresa_id, fecha_operativa) values ('11111111-1111-1111-1111-111111111111', current_date)$$,
  'no se crean turnos por API', 'permission denied');

-- ---- Pedidos ----
select t_login('audA');
select t_falla(format('select crear_pedido(%L, ''{}'', ''[]'', ''[]'', null)', :'turno'), 'AUDITOR no crea pedidos', 'Sin permiso');
select t_login('cajA');
select t_falla(format('select crear_pedido(%L, ''{}'', ''[]'', ''[]'', null)', :'turno'), 'pedido sin productos', 'no tiene productos');
select t_falla(format($f$select crear_pedido(%L, '{}', '[{"receta_id":"f1000000-0000-0000-0000-000000000001","cantidad":1}]', '[]', null)$f$, :'turno'),
  'pedido sin pago', 'cobra');
select t_falla(format($f$select crear_pedido(%L, '{}', '[{"receta_id":"f1000000-0000-0000-0000-000000000001","cantidad":0}]', '[{"medio":"efectivo","monto_centavos":10000}]', null)$f$, :'turno'),
  'cantidad cero', 'Cantidad inválida');
select t_falla(format($f$select crear_pedido(%L, '{}', '[{"receta_id":"f1000000-0000-0000-0000-000000000004","cantidad":1}]', '[{"medio":"efectivo","monto_centavos":1}]', null)$f$, :'turno'),
  'una preparación no se vende', 'ya no está disponible');
select t_falla(format($f$select crear_pedido(%L, '{}', '[{"receta_id":"f1000000-0000-0000-0000-000000000003","cantidad":1}]', '[{"medio":"efectivo","monto_centavos":1500}]', null)$f$, :'turno'),
  'un adicional no va solo', 'tiene que ir sobre');
select t_falla(format($f$select crear_pedido(%L, '{}', '[{"receta_id":"f1000000-0000-0000-0000-000000000001","cantidad":1,"adicionales":[{"receta_id":"f1000000-0000-0000-0000-000000000002","cantidad":1}]}]', '[{"medio":"efectivo","monto_centavos":12500}]', null)$f$, :'turno'),
  'un producto no es adicional', 'no es un adicional');
select t_falla(format($f$select crear_pedido(%L, '{}', '[{"receta_id":"f1000000-0000-0000-0000-000000000001","cantidad":1}]', '[{"medio":"efectivo","monto_centavos":9999}]', null)$f$, :'turno'),
  'los pagos tienen que sumar el total', 'no coinciden');
select t_falla(format($f$select crear_pedido(%L, '{}', '[{"receta_id":"f1000000-0000-0000-0000-000000000001","cantidad":1}]', '[{"medio":"tarjeta","monto_centavos":10000}]', null)$f$, :'turno'),
  'medio de pago no habilitado', 'no habilitado');
select t_falla(format($f$select crear_pedido(%L, '{"descuento_centavos":10001}', '[{"receta_id":"f1000000-0000-0000-0000-000000000001","cantidad":1}]', '[{"medio":"efectivo","monto_centavos":1}]', null)$f$, :'turno'),
  'descuento mayor al subtotal', 'descuento');
select t_falla(format($f$select crear_pedido(%L, '{"modalidad":"delivery"}', '[{"receta_id":"f1000000-0000-0000-0000-000000000001","cantidad":1}]', '[{"medio":"efectivo","monto_centavos":10000}]', null)$f$, :'turno'),
  'delivery deshabilitado', 'delivery');
select t_falla(format($f$select crear_pedido(%L, '{"envio_centavos":500}', '[{"receta_id":"f1000000-0000-0000-0000-000000000001","cantidad":1}]', '[{"medio":"efectivo","monto_centavos":10500}]', null)$f$, :'turno'),
  'envío sin delivery', 'envío');
select t_falla(format($f$select crear_pedido(%L, '{}', '[{"receta_id":"f1000000-0000-0000-0000-000000000001","cantidad":1}]', '[{"medio":"efectivo","monto_centavos":10.5}]', null)$f$, :'turno'),
  'monto con decimales', 'inválido');
select t_igual((select count(*)::int from pedidos), 0, 'ningún intento fallido dejó pedidos a medias');

-- Pedido 1: 2 hamburguesas + 1 extra + 1 gaseosa, efectivo. El precio que mande el cliente se ignora.
select (crear_pedido(:'turno', '{"cliente_nombre":"Ana","nota":"sin cebolla"}',
  '[{"receta_id":"f1000000-0000-0000-0000-000000000001","cantidad":2,"precio_unit_centavos":1,"adicionales":[{"receta_id":"f1000000-0000-0000-0000-000000000003","cantidad":1}]},
    {"receta_id":"f1000000-0000-0000-0000-000000000002","cantidad":1}]',
  '[{"medio":"efectivo","monto_centavos":24000}]', 'a0000000-0000-0000-0000-000000000001') ->> 'id') as p1 \gset
select t_ok((select numero = 1 and total_centavos = 24000 and subtotal_centavos = 24000 and estado = 'confirmado' from pedidos where id = :'p1'),
  'pedido 1: número 1, total 24.000 (precios de la base)');
select t_igual((select count(*)::int from pedido_items where pedido_id = :'p1'), 3, 'items: hamburguesa, adicional hijo y gaseosa');
select t_ok((select item_padre_id is not null from pedido_items where pedido_id = :'p1' and nombre_snapshot = 'Medallón extra'), 'el adicional cuelga de su producto');
select t_igual((select costo_total_centavos from pedidos where id = :'p1'), :costo_esp::bigint,
  'el costo del pedido es el costo de las recetas al momento');
select t_ok((select costo_total_centavos > 0 from pedidos where id = :'p1'), 'y es mayor a cero');

-- Idempotencia por client_uuid.
select t_ok((crear_pedido(:'turno', '{}', '[{"receta_id":"f1000000-0000-0000-0000-000000000002","cantidad":9}]',
  '[{"medio":"efectivo","monto_centavos":22500}]', 'a0000000-0000-0000-0000-000000000001') ->> 'repetido')::boolean,
  'reintentar con el mismo client_uuid devuelve el pedido existente');
select t_igual((select count(*)::int from pedidos), 1, 'sin duplicar');

-- Pedido 2: pago dividido y transferencia (guarda el alias vigente).
select (crear_pedido(:'turno', '{"cliente_nombre":"Beto","cliente_telefono":"221"}',
  '[{"receta_id":"f1000000-0000-0000-0000-000000000001","cantidad":1}]',
  '[{"medio":"efectivo","monto_centavos":4000},{"medio":"transferencia","monto_centavos":6000}]', null) ->> 'id') as p2 \gset
select t_ok((select numero = 2 and alias_cobro = 'local.cobros' from pedidos where id = :'p2'), 'pedido 2: número 2 y alias de cobro copiado');
select t_igual((select count(*)::int from pedido_pagos where pedido_id = :'p2'), 2, 'pago dividido en dos medios');
-- Pedido 3: transferencia.
select (crear_pedido(:'turno', '{}', '[{"receta_id":"f1000000-0000-0000-0000-000000000002","cantidad":2}]',
  '[{"medio":"transferencia","monto_centavos":5000}]', null) ->> 'id') as p3 \gset
-- Pedido 4: el que se va a anular.
select (crear_pedido(:'turno', '{}', '[{"receta_id":"f1000000-0000-0000-0000-000000000001","cantidad":1}]',
  '[{"medio":"efectivo","monto_centavos":10000}]', null) ->> 'id') as p4 \gset
select t_igual((select numero from pedidos where id = :'p4'), 4, 'numeración correlativa sin saltos tras los intentos fallidos');

-- Cambiar el precio/costo de la receta no altera lo ya cargado.
select t_login('admA');
update recetas set precio_venta_publico_centavos = 99999 where id = 'f1000000-0000-0000-0000-000000000001';
update insumos set costo_neto_por_unidad_base_centavos = 999 where id = 'e1000000-0000-0000-0000-000000000001';
select t_login('cajA');
select t_ok((select total_centavos = 24000 and costo_total_centavos = :costo_esp::bigint from pedidos where id = :'p1'),
  'subir precio y costo no cambia pedidos ya cargados');
select t_ok((select precio_unit_centavos = 10000 from pedido_items where pedido_id = :'p1' and nombre_snapshot = 'Hamburguesa'), 'ni el precio del item');
select t_login('admA');
update recetas set precio_venta_publico_centavos = 10000 where id = 'f1000000-0000-0000-0000-000000000001';
select t_login('cajA');

-- ---- Pedidos: lectura y operación ----
select t_igual((select count(*)::int from pedidos), 4, 'el cajero ve los pedidos del turno abierto');
select t_falla($$update pedidos set total_centavos = 1$$, 'nadie edita pedidos por API', 'permission denied');
select t_falla($$delete from pedidos$$, 'ni los borra', 'permission denied');
select t_falla($$insert into pedido_pagos (empresa_id, pedido_id, medio, monto_centavos) values ('11111111-1111-1111-1111-111111111111', gen_random_uuid(), 'efectivo', 1)$$, 'ni agrega pagos', 'permission denied');
select marcar_entregado(:'p1');
select t_igual((select estado from pedidos where id = :'p1'), 'entregado', 'marcar entregado');
select marcar_entregado(:'p1');
select t_login('audA');
select t_falla(format('select marcar_entregado(%L)', :'p2'), 'AUDITOR no marca entregados', 'Sin permiso');
select t_falla(format('select anular_pedido(%L, ''error de carga'')', :'p4'), 'AUDITOR no anula', 'Sin permiso');
select t_login('cajA');
select registrar_comanda(:'p1', 'impresora');
select registrar_comanda(:'p2', 'whatsapp');
select t_ok((select comanda_via = 'impresora' and comanda_en is not null from pedidos where id = :'p1'), 'se registra cómo salió la comanda (impresora)');
select t_ok((select comanda_via = 'whatsapp' from pedidos where id = :'p2'), 'y el respaldo por WhatsApp');
select t_falla(format('select registrar_comanda(%L, ''paloma'')', :'p2'), 'vía de comanda inválida', 'inválida');
select t_falla(format('select anular_pedido(%L, '''')', :'p4'), 'anular exige motivo', 'motivo');
select anular_pedido(:'p4', 'error de carga');
select t_ok((select estado = 'anulado' and motivo_anulacion = 'error de carga' and anulado_por is not null and anulado_en is not null from pedidos where id = :'p4'),
  'el CAJERO anula en su turno abierto, con motivo y rastro');
select t_falla(format('select anular_pedido(%L, ''otra vez'')', :'p4'), 'no se anula dos veces', 'ya está anulado');
select t_login('admA');
select t_ok((select count(*) from auditoria where accion = 'anular_pedido' and entidad_id = :'p4') = 1, 'la anulación queda en auditoría');

-- ---- Salida de efectivo del turno ----
select t_login('cajA');
select t_falla(format('select registrar_egreso_turno(%L, 0, ''hielo'')', :'turno'), 'egreso en cero', 'mayor a cero');
select t_falla(format('select registrar_egreso_turno(%L, 500, '''')', :'turno'), 'egreso sin motivo', 'motivo');
select registrar_egreso_turno(:'turno', 1200, 'Hielo', 'bolsa') as eg \gset
select t_login('audA');
select t_falla(format('select registrar_egreso_turno(%L, 100, ''x'')', :'turno'), 'AUDITOR no registra egresos', 'Sin permiso');
select t_login('cajA');

-- ---- Resumen y cierre ----
-- Ventas no anuladas: P1 24000 (ef) + P2 10000 (4000 ef + 6000 tr) + P3 5000 (tr) = 39000. Efectivo 28000, transf 11000.
select t_ok((resumen_turno(:'turno') ->> 'ventas_centavos') = '39000' and (resumen_turno(:'turno') ->> 'pedidos') = '3'
        and (resumen_turno(:'turno') ->> 'anulados') = '1' and (resumen_turno(:'turno') ->> 'anulados_centavos') = '10000',
  'resumen: 3 pedidos, 39.000, 1 anulado por 10.000');
select t_ok((resumen_turno(:'turno') -> 'por_medio' ->> 'efectivo') = '28000' and (resumen_turno(:'turno') -> 'por_medio' ->> 'transferencia') = '11000',
  'resumen por medio');
select t_ok((resumen_turno(:'turno') ->> 'efectivo_esperado_centavos') = '31800', 'esperado = fondo 5.000 + efectivo 28.000 − salidas 1.200');
select t_ok((resumen_turno(:'turno') ->> 'ticket_promedio_centavos') = '13000', 'ticket promedio');
select t_falla(format('select cerrar_turno(%L, null)', :'turno'), 'cerrar exige contar el efectivo', 'efectivo contado');
select t_login('audA');
select t_falla(format('select cerrar_turno(%L, 0)', :'turno'), 'AUDITOR no cierra', 'Sin permiso');
select t_login('cajA');
select cerrar_turno(:'turno', 31500, 'faltaron 300') as cierre \gset
select t_ok((:'cierre'::jsonb ->> 'diferencia_centavos') = '-300' and (:'cierre'::jsonb ->> 'efectivo_esperado_centavos') = '31800'
        and (:'cierre'::jsonb ->> 'ya_cerrado') = 'false', 'cierre: diferencia −300 respecto del esperado');
select t_ok((cerrar_turno(:'turno', 1, 'otra vez') ->> 'ya_cerrado') = 'true', 'cerrar dos veces devuelve el resumen sin duplicar');
select t_igual((select efectivo_contado_centavos from turnos_caja where id = :'turno'), null, 'el CAJERO ya no ve el turno cerrado');
select t_igual((select count(*)::int from pedidos), 0, 'ni sus pedidos');
select t_falla(format('select anular_pedido(%L, ''tarde'')', :'p1'), 'no se anula con el turno cerrado', 'cerrado|inexistente');
select t_falla(format('select crear_pedido(%L, ''{}'', ''[{"receta_id":"f1000000-0000-0000-0000-000000000002","cantidad":1}]'', ''[{"medio":"efectivo","monto_centavos":2500}]'', null)', :'turno'),
  'no se cargan pedidos con la caja cerrada', 'cerrada');
select t_falla(format('select registrar_egreso_turno(%L, 100, ''x'')', :'turno'), 'ni egresos', 'cerrada');
select t_ok((crear_pedido(:'turno', '{}', '[{"receta_id":"f1000000-0000-0000-0000-000000000002","cantidad":9}]',
  '[{"medio":"efectivo","monto_centavos":22500}]', 'a0000000-0000-0000-0000-000000000001') ->> 'repetido')::boolean,
  'un reintento de red después del cierre sigue devolviendo el pedido original');

-- ---- Flujo de caja ----
select t_login('gerA');
select t_igual((select count(*)::int from movimientos_caja where origen = 'cierre_turno' and activo and categoria = 'Ventas'), 2, 'el cierre generó un ingreso por medio');
select t_ok((select tipo = 'egreso' and medio = 'efectivo' and monto_centavos = 300 and fecha = (select fecha_operativa from turnos_caja where id = :'turno')
                    and nota like '%faltante%' from movimientos_caja where origen = 'cierre_turno' and categoria = 'Diferencia de caja' and activo),
  'el faltante de caja (300) pasó al Flujo como egreso de efectivo');
select t_igual((select count(*)::int from movimientos_caja where origen = 'cierre_turno' and activo and categoria = 'Diferencia de caja'), 1, 'una sola línea de diferencia');
select t_igual((select monto_centavos from movimientos_caja where origen = 'cierre_turno' and medio = 'efectivo' and categoria = 'Ventas'), 28000::bigint, 'ingreso Ventas efectivo');
select t_igual((select monto_centavos from movimientos_caja where origen = 'cierre_turno' and medio = 'transferencia'), 11000::bigint, 'ingreso Ventas transferencia');
select t_ok((select bool_and(tipo = 'ingreso' and nota like 'Cierre de caja — 3 pedidos') from movimientos_caja where origen = 'cierre_turno' and categoria = 'Ventas'),
  'categoría Ventas y nota del cierre');
select t_ok((select tipo = 'egreso' and medio = 'efectivo' and monto_centavos = 1200 and categoria = 'Hielo' from movimientos_caja where origen = 'turno'), 'la salida de efectivo está como egreso');
select t_ok((select bool_and(fecha = (select fecha_operativa from turnos_caja where id = :'turno')) from movimientos_caja where turno_id = :'turno'),
  'los movimientos caen en el día operativo del turno');
select t_falla($$delete from movimientos_caja where origen = 'cierre_turno'$$, 'un ingreso de cierre no se borra', 'no se borra');
select t_falla($$update movimientos_caja set monto_centavos = 1 where origen = 'cierre_turno'$$, 'ni se edita', 'no se edita');
select t_falla($$insert into movimientos_caja (empresa_id, fecha, tipo, medio, monto_centavos, origen) values ('11111111-1111-1111-1111-111111111111', current_date, 'ingreso', 'efectivo', 1, 'cierre_turno')$$,
  'nadie fabrica un movimiento de cierre', 'permission denied');
select t_falla($$update movimientos_caja set activo = false where origen = 'cierre_turno'$$, 'ni lo da de baja directo', 'permission denied');
-- Movimiento manual: "borrar" es baja lógica con auditoría.
insert into movimientos_caja (empresa_id, fecha, tipo, medio, monto_centavos) values ('11111111-1111-1111-1111-111111111111', current_date, 'egreso', 'efectivo', 777);
select t_filas($$delete from movimientos_caja where monto_centavos = 777$$, 0, 'borrar un manual no elimina la fila (baja lógica)');
reset role;
select t_ok((select not activo from movimientos_caja where monto_centavos = 777), 'queda inactivo');
select t_ok((select count(*) from auditoria where accion = 'baja_movimiento_caja') = 1, 'y auditado');
set role authenticated;

-- ---- Reabrir ----
select t_login('gerA');
select t_falla(format('select reabrir_turno(%L, ''corregir'')', :'turno'), 'GERENTE no reabre', 'Sin permiso');
select t_login('cajA');
select t_falla(format('select reabrir_turno(%L, ''corregir'')', :'turno'), 'CAJERO no reabre', 'Sin permiso');
select t_login('admA');
select t_falla(format('select reabrir_turno(%L, '''')', :'turno'), 'reabrir exige motivo', 'motivo');
select abrir_turno(0) as turno2 \gset
select t_falla(format('select reabrir_turno(%L, ''corregir'')', :'turno'), 'no se reabre con otra caja abierta', 'otra caja abierta');
select cerrar_turno(:'turno2', 0, null);
select reabrir_turno(:'turno', 'corregir un cobro');
select t_ok((select estado = 'abierto' and efectivo_contado_centavos is null and efectivo_esperado_centavos is null from turnos_caja where id = :'turno'), 'el turno vuelve a abierto');
select t_igual((select count(*)::int from movimientos_caja where origen = 'cierre_turno' and turno_id = :'turno' and activo), 0, 'los ingresos del cierre quedan de baja');
select t_igual((select count(*)::int from movimientos_caja where origen = 'cierre_turno' and turno_id = :'turno'), 3, 'sin borrarse (2 de ventas y la diferencia de caja)');
select t_igual((select count(*)::int from movimientos_caja where origen = 'turno' and turno_id = :'turno' and activo), 1, 'la salida de efectivo sigue vigente');
select t_ok((select count(*) from auditoria where accion = 'reabrir_turno' and entidad_id = :'turno') = 1, 'la reapertura queda auditada');
select anular_pedido(:'p3', 'cobro mal cargado');
select cerrar_turno(:'turno', 31800, null);
select t_igual((select count(*)::int from movimientos_caja where origen = 'cierre_turno' and turno_id = :'turno' and activo), 2, 'al recerrar hay un ingreso vigente por medio (sin duplicar) y sin diferencia (caja justa)');
select t_igual((select sum(monto_centavos)::bigint from movimientos_caja where origen = 'cierre_turno' and turno_id = :'turno' and activo), 34000::bigint,
  'y refleja el pedido anulado en la reapertura (39.000 − 5.000)');
select t_ok((resumen_turno(:'turno') ->> 'diferencia_centavos') = '0' and (resumen_turno(:'turno') ->> 'efectivo_esperado_centavos') = '31800',
  'al recerrar el esperado sigue siendo 31.800 y la diferencia 0');

-- ---- Lectura por rol ----
select t_login('audA');
select t_igual((select count(*)::int from pedidos), 4, 'AUDITOR lee todos los pedidos (solo lectura)');
select t_igual((select count(*)::int from turnos_caja), 2, 'y los turnos');
select t_login('cocA');
select t_igual((select count(*)::int from pedidos), 0, 'COCINA no ve pedidos');
select t_igual((select count(*)::int from turnos_caja), 0, 'ni turnos');
select t_login('admB');
select t_igual((select count(*)::int from pedidos), 0, 'otra empresa no ve mis pedidos');
select t_igual((select count(*)::int from turnos_caja), 0, 'ni mis turnos');

reset role;
-- Invariante: en todo pedido no anulado, Σ pagos = total.
select t_ok(not exists (
  select 1 from pedidos p where p.estado <> 'anulado'
   and p.total_centavos <> (select coalesce(sum(monto_centavos), 0) from pedido_pagos where pedido_id = p.id)),
  'invariante: Σ pagos = total en todo pedido no anulado');

-- Un turno cerrado ANTES de que el cierre volcara la diferencia: el script la agrega una sola vez.
insert into turnos_caja (id, empresa_id, fecha_operativa, estado, fondo_inicial_centavos, efectivo_contado_centavos, efectivo_esperado_centavos, cerrado_en)
values ('b1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', date '2026-01-05', 'cerrado', 0, 8000, 10000, now());
\ir ../f2_ventas_rpc.sql
\ir ../f2_ventas_rpc.sql
select t_igual((select count(*)::int from movimientos_caja where turno_id = 'b1000000-0000-0000-0000-000000000009' and categoria = 'Diferencia de caja'), 1,
  'la diferencia de un turno ya cerrado se agrega una sola vez (aunque se re-ejecute)');
select t_ok((select tipo = 'egreso' and monto_centavos = 2000 and fecha = date '2026-01-05' from movimientos_caja where turno_id = 'b1000000-0000-0000-0000-000000000009'),
  'faltante de $20 del turno ya cerrado, en su día operativo');

rollback;
