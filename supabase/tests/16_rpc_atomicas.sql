-- ============================================================================
-- Test Fase 0.6 — RPC atómicas (recetas, insumos) y códigos sin carrera
-- ============================================================================
begin;
set role authenticated;

-- ---- crear_insumo ----
select t_login('audA');
select t_falla($$select crear_insumo('{"nombre":"X","magnitud":"masa","unidad_base":"g"}')$$, 'AUDITOR no crea insumos', 'Sin permiso');
select t_login('cajA');
select t_falla($$select crear_insumo('{"nombre":"X","magnitud":"masa","unidad_base":"g"}')$$, 'CAJERO no crea insumos', 'Sin permiso');
select t_login('cocA');
select t_falla($$select crear_insumo('{"nombre":"  ","magnitud":"masa","unidad_base":"g"}')$$, 'el nombre es obligatorio', 'nombre');
select t_falla($$select crear_insumo('{"nombre":"X","magnitud":"inventada","unidad_base":"g"}')$$, 'magnitud inválida se rechaza', 'check');
select t_falla($$select crear_insumo('{"nombre":"X","magnitud":"masa","unidad_base":"g","costo_neto_por_unidad_base_centavos":-5}')$$, 'costo negativo se rechaza', 'negativo');
select t_falla($$select crear_insumo('{"nombre":"X","magnitud":"masa","unidad_base":"g","proveedor_habitual_id":"c2000000-0000-0000-0000-000000000001"}')$$, 'proveedor de otra empresa se rechaza', 'Proveedor');

select crear_insumo('{"nombre":"Harina","rubro":"Almacén","magnitud":"masa","unidad_base":"g","costo_neto_por_unidad_base_centavos":12.5,"alicuota_iva":21,"factor_correccion":1,"presentacion_desc":"Bolsa 1 kg","presentacion_cantidad_base":1000,"presentacion_precio_neto_centavos":12500,"unidad_uso":"g"}') as harina \gset
select crear_insumo('{"nombre":"Sal","magnitud":"masa","unidad_base":"g","costo_neto_por_unidad_base_centavos":0.4,"alicuota_iva":0}') as sal \gset
select t_igual((select codigo from insumos where id = :'harina'), 'INS-001', 'primer insumo: INS-001');
select t_igual((select codigo from insumos where id = :'sal'), 'INS-002', 'segundo insumo: INS-002');
select t_igual((select costo_neto_por_unidad_base_centavos from insumos where id = :'harina'), 12.5, 'el costo decimal se guarda exacto');
select t_igual((select count(*)::int from historial_precios_insumo where insumo_id = :'harina' and origen = 'carga_inicial'), 1, 'crear_insumo deja el primer punto del historial');
reset role;
insert into insumos (empresa_id, nombre, magnitud, unidad_base, codigo) values ('11111111-1111-1111-1111-111111111111', 'Con código', 'masa', 'g', 'INS-050');
insert into insumos (empresa_id, nombre, magnitud, unidad_base) values ('11111111-1111-1111-1111-111111111111', 'Sin código', 'masa', 'g');
select t_igual((select codigo from insumos where nombre = 'Sin código'), 'INS-051', 'un código explícito se respeta y el siguiente continúa desde el máximo');
select t_falla($$insert into insumos (empresa_id, nombre, magnitud, unidad_base, codigo) values ('11111111-1111-1111-1111-111111111111', 'Dup', 'masa', 'g', 'INS-001')$$, 'el índice único impide códigos repetidos', 'duplicate key');
insert into insumos (empresa_id, nombre, magnitud, unidad_base) values ('22222222-2222-2222-2222-222222222222', 'De B', 'masa', 'g');
select t_igual((select codigo from insumos where nombre = 'De B'), 'INS-001', 'cada empresa numera por separado');
select t_igual((select codigo from proveedores where id = 'c1000000-0000-0000-0000-000000000001'), 'PROV-001', 'los proveedores también reciben código automático');
insert into proveedores (empresa_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Otro');
select t_igual((select codigo from proveedores where nombre = 'Otro'), 'PROV-002', 'y continúan la numeración');
set role authenticated;

-- ---- guardar_receta ----
select t_login('audA');
select t_falla(format($f$select guardar_receta(null, '{"nombre":"X","tipo":"plato"}', '[{"tipo":"insumo","ref_id":"%s","cantidad":1}]')$f$, :'harina'), 'AUDITOR no guarda recetas', 'Sin permiso');
select t_login('cajA');
select t_falla(format($f$select guardar_receta(null, '{"nombre":"X","tipo":"plato"}', '[{"tipo":"insumo","ref_id":"%s","cantidad":1}]')$f$, :'harina'), 'CAJERO no guarda recetas', 'Sin permiso');
select t_login('cocA');
select t_falla($$select guardar_receta(null, '{"nombre":"","tipo":"plato"}', '[]')$$, 'el nombre es obligatorio', 'nombre');
select t_falla($$select guardar_receta(null, '{"nombre":"Vacía","tipo":"plato"}', '[]')$$, 'una receta sin ingredientes se rechaza', 'ingrediente');
select t_falla(format($f$select guardar_receta(null, '{"nombre":"X","tipo":"plato"}', '[{"tipo":"insumo","ref_id":"%s","cantidad":0}]')$f$, :'harina'), 'cantidad 0 se rechaza', 'cantidad');
select t_falla($$select guardar_receta(null, '{"nombre":"X","tipo":"plato"}', '[{"tipo":"insumo","ref_id":"00000000-0000-0000-0000-000000000099","cantidad":1}]')$$, 'insumo inexistente se rechaza', 'inexistente');
select t_falla(format($f$select guardar_receta(null, '{"nombre":"X","tipo":"plato"}', '[{"tipo":"cosa","ref_id":"%s","cantidad":1}]')$f$, :'harina'), 'tipo de ingrediente inválido', 'inválido');

select guardar_receta(null, '{"nombre":"Masa","tipo":"preparacion","rendimiento_cantidad":1000,"rendimiento_unidad":"g"}',
  format('[{"tipo":"insumo","ref_id":"%s","cantidad":600}]', :'harina')::jsonb) as masa \gset
select t_igual((select codigo from recetas where id = :'masa'), 'REC-001', 'primera receta: REC-001');
select t_igual((select costo_calculado_centavos from recetas where id = :'masa'), 9075::bigint, 'costo calculado por la base: 600 g × 12,5 ¢ × 1,21 = 9075');
select guardar_receta(null, '{"nombre":"Pizza","tipo":"plato","precio_venta_publico_centavos":1500000,"alicuota_venta":21,"sector_venta":"Cocina"}',
  format('[{"tipo":"receta","ref_id":"%s","cantidad":250},{"tipo":"insumo","ref_id":"%s","cantidad":100}]', :'masa', :'harina')::jsonb) as pizza \gset
select t_igual((select costo_calculado_centavos from recetas where id = :'pizza'), 3781::bigint, 'pizza = 250 g de masa (2268,75) + 100 g de harina (1512,5) = 3781,25 → 3781');
select t_igual((select count(*)::int from ingredientes_receta where receta_padre_id = :'pizza'), 2, 'la receta quedó con sus 2 ingredientes');
select t_igual((select sector_venta from recetas where id = :'pizza'), 'Cocina', 'datos del plato guardados');

-- Las sub-recetas deben ser preparaciones (no platos).
select t_falla(format($f$select guardar_receta(null, '{"nombre":"Mal","tipo":"plato"}', '[{"tipo":"receta","ref_id":"%s","cantidad":1}]')$f$, :'pizza'), 'un plato no puede usarse como sub-receta', 'preparación');

-- Atomicidad: un ciclo deja la receta EXACTAMENTE como estaba.
select guardar_receta(null, '{"nombre":"A","tipo":"preparacion"}', format('[{"tipo":"insumo","ref_id":"%s","cantidad":10}]', :'harina')::jsonb) as ra \gset
select guardar_receta(null, '{"nombre":"B","tipo":"preparacion"}', format('[{"tipo":"receta","ref_id":"%s","cantidad":1}]', :'ra')::jsonb) as rb \gset
select t_falla(format($f$select guardar_receta(%L, '{"nombre":"A","tipo":"preparacion"}', '[{"tipo":"receta","ref_id":"%s","cantidad":1}]')$f$, :'ra', :'rb'),
  'cerrar un ciclo A→B→A se rechaza', 'circular');
select t_igual((select count(*)::int from ingredientes_receta where receta_padre_id = :'ra'), 1, 'tras el error, A conserva su ingrediente');
select t_igual((select insumo_id::text from ingredientes_receta where receta_padre_id = :'ra'), :'harina', 'y es el mismo de antes');
select t_igual((select cantidad from ingredientes_receta where receta_padre_id = :'ra'), 10::numeric, 'con la misma cantidad');
-- Falla a mitad de camino (segundo ingrediente inexistente): el primero tampoco queda.
select t_falla(format($f$select guardar_receta(%L, '{"nombre":"A2","tipo":"preparacion"}', '[{"tipo":"insumo","ref_id":"%s","cantidad":99},{"tipo":"insumo","ref_id":"00000000-0000-0000-0000-000000000099","cantidad":1}]')$f$, :'ra', :'harina'),
  'un ingrediente inválido deshace todo', 'inexistente');
select t_igual((select nombre from recetas where id = :'ra'), 'A', 'el nombre tampoco cambió');
select t_igual((select cantidad from ingredientes_receta where receta_padre_id = :'ra'), 10::numeric, 'ni la cantidad del ingrediente original');

-- Aislamiento entre empresas.
select t_login('admB');
select t_falla(format($f$select guardar_receta(%L, '{"nombre":"Hack","tipo":"plato"}', '[{"tipo":"insumo","ref_id":"%s","cantidad":1}]')$f$, :'pizza', :'harina'),
  'otra empresa no puede editar mi receta', 'inexistente');
select t_falla(format($f$select actualizar_costo_insumo(%L, 1)$f$, :'harina'), 'otra empresa no puede cambiar mi costo', 'inexistente');
select t_falla(format($f$select actualizar_insumo(%L, '{"nombre":"Hack"}')$f$, :'harina'), 'otra empresa no puede editar mi insumo', 'inexistente');

-- ---- actualizar_costo_insumo ----
select t_login('audA');
select t_falla(format($f$select actualizar_costo_insumo(%L, 25)$f$, :'harina'), 'AUDITOR no cambia costos', 'Sin permiso');
select t_login('gerA');
select t_falla(format($f$select actualizar_costo_insumo(%L, -1)$f$, :'harina'), 'costo negativo se rechaza', 'válido');
select t_falla(format($f$select actualizar_costo_insumo(%L, 25, 'inventado')$f$, :'harina'), 'origen inválido se rechaza', 'Origen');
select t_falla(format($f$select actualizar_costo_insumo(%L, 25, 'factura', gen_random_uuid())$f$, :'harina'), 'factura inexistente se rechaza', 'Factura');
select actualizar_costo_insumo(:'harina', 25) as r1 \gset
select t_igual((:'r1'::jsonb ->> 'variacion')::numeric, 100.00, 'variación +100 % (12,5 → 25)');
select t_ok((:'r1'::jsonb ->> 'recetas_recalculadas')::int >= 3, 'informa cuántas recetas se recalcularon (masa, pizza, A, B)');
select t_igual((select costo_calculado_centavos from recetas where id = :'masa'), 18150::bigint, 'masa recalculada: 600 × 25 × 1,21 = 18150');
select t_igual((select costo_neto_por_unidad_base_centavos from insumos where id = :'harina'), 25::numeric, 'el insumo tiene el costo nuevo');
select t_igual((select presentacion_precio_neto_centavos from insumos where id = :'harina'), 25000::bigint, 'el precio de la presentación se deriva (1000 g × 25 ¢)');
select t_ok(exists (select 1 from historial_precios_insumo where insumo_id = :'harina' and origen = 'manual'
  and costo_anterior_centavos = 12.5 and costo_nuevo_centavos = 25 and variacion_porcentual = 100), 'queda el punto de historial con anterior, nuevo y variación');
select actualizar_costo_insumo(:'harina', 30, 'manual', null, 30500) as r2 \gset
select t_igual((select presentacion_precio_neto_centavos from insumos where id = :'harina'), 30500::bigint, 'si viene el precio exacto de la presentación se usa ese');

-- ---- actualizar_insumo ----
select t_login('audA');
select t_falla(format($f$select actualizar_insumo(%L, '{"nombre":"Hack"}')$f$, :'harina'), 'AUDITOR no edita insumos', 'Sin permiso');
select t_login('cocA');
select t_falla(format($f$select actualizar_insumo(%L, '{"nombre":" "}')$f$, :'harina'), 'nombre vacío se rechaza', 'nombre');
select t_falla(format($f$select actualizar_insumo(%L, '{"proveedor_habitual_id":"c2000000-0000-0000-0000-000000000001"}')$f$, :'harina'), 'proveedor de otra empresa se rechaza', 'Proveedor');
select actualizar_insumo(:'harina', '{"nombre":"Harina 000","alicuota_iva":10.5,"unidad_uso":"kg"}') as r3 \gset
select t_ok(((:'r3'::jsonb ->> 'costo_cambio')::boolean) = false, 'sin costo nuevo no marca cambio de costo');
select t_igual((select nombre from insumos where id = :'harina'), 'Harina 000', 'cambia el nombre');
select t_igual((select alicuota_iva from insumos where id = :'harina'), 10.5, 'cambia el IVA');
select t_igual((select rubro from insumos where id = :'harina'), 'Almacén', 'los campos que no vienen no se tocan');
select t_ok((:'r3'::jsonb ->> 'recetas_recalculadas')::int >= 3, 'cambiar el IVA recalcula las recetas');
select t_igual((select count(*)::int from historial_precios_insumo where insumo_id = :'harina' and origen = 'manual'), 2, 'sin cambio de costo no se agrega historial');
select actualizar_insumo(:'harina', '{"rubro":"Secos"}', 40) as r4 \gset
select t_ok(((:'r4'::jsonb ->> 'costo_cambio')::boolean), 'con costo nuevo marca el cambio');
select t_igual((select count(*)::int from historial_precios_insumo where insumo_id = :'harina' and origen = 'manual'), 3, 'y agrega un punto de historial');
select t_igual((select costo_neto_por_unidad_base_centavos from insumos where id = :'harina'), 40::numeric, 'datos y costo se guardan juntos');

rollback;
