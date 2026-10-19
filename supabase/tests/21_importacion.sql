-- ============================================================================
-- Test Fase 5 — importación masiva: proveedores, insumos y gastos fijos
-- (permisos por rol, saltear/actualizar, todo-o-nada, historial y aislamiento por empresa).
-- ============================================================================
begin;

update empresas set modulos = '{admin,costos,carta,rrhh,reparto}' where id = '11111111-1111-1111-1111-111111111111';

set role authenticated;

-- ---- Permisos ----
select t_login('cocA');
select t_falla($$select importar_proveedores('[{"nombre":"X"}]'::jsonb)$$, 'COCINA no importa proveedores', 'Sin permiso');
select t_login('audA');
select t_falla($$select importar_insumos('[]'::jsonb)$$, 'AUDITOR no importa insumos', 'Sin permiso');
select t_login('cajA');
select t_falla($$select importar_insumos('[]'::jsonb)$$, 'CAJERO no importa insumos', 'Sin permiso');
select t_login('gerA');
select t_falla($$select importar_gastos_fijos('[]'::jsonb)$$, 'GERENTE no importa gastos fijos', 'Sin permiso');
select t_login('admB');
select t_falla($$select importar_gastos_fijos('[]'::jsonb)$$, 'sin módulo reparto no importa gastos fijos', 'módulo');

-- ---- Proveedores ----
select t_login('gerA');
select importar_proveedores('[
  {"nombre":"Lácteos del Sur","cuit":"30-1","condicion_fiscal":"responsable_inscripto","rubros":["Lácteos","Almacén"]},
  {"nombre":"  Verduras Juan ","condicion_fiscal":"monotributo","telefono":"11-5555"},
  {"nombre":"Prov A"}
]'::jsonb) as r1 \gset
select t_ok((:'r1'::jsonb ->> 'creados')::int = 2 and (:'r1'::jsonb ->> 'salteados')::int = 1 and (:'r1'::jsonb ->> 'actualizados')::int = 0,
  'proveedores: crea 2 y saltea el existente ("Prov A")');
select t_ok((select rubro_principal = 'Lácteos' and rubros = '{Lácteos,Almacén}' and codigo like 'PROV-%' from proveedores where nombre = 'Lácteos del Sur'),
  'proveedor con rubros (el primero es el principal) y código asignado por la base');
select t_igual((select count(*)::int from proveedores where nombre = 'Verduras Juan'), 1, 'se recortan los espacios del nombre');
-- segunda corrida: todo existe → se saltea (idempotente)
select importar_proveedores('[{"nombre":"lácteos del sur"},{"nombre":"VERDURAS JUAN"}]'::jsonb) as r2 \gset
select t_ok((:'r2'::jsonb ->> 'creados')::int = 0 and (:'r2'::jsonb ->> 'salteados')::int = 2, 'repetir no duplica (sin distinguir mayúsculas)');
-- actualizar: pisa solo lo que viene con dato
select importar_proveedores('[{"nombre":"Lácteos del Sur","telefono":"11-0000"}]'::jsonb, true) as r3 \gset
select t_ok((:'r3'::jsonb ->> 'actualizados')::int = 1 and (select telefono = '11-0000' and cuit = '30-1' from proveedores where nombre = 'Lácteos del Sur'),
  'actualizar cambia el teléfono y conserva el CUIT');
-- todo o nada: una fila inválida a mitad de camino no deja nada guardado
select t_falla($$select importar_proveedores('[{"nombre":"Nuevo 1"},{"nombre":"Roto","condicion_fiscal":"otra"},{"nombre":"Nuevo 2"}]'::jsonb)$$,
  'condición fiscal inválida', 'condición fiscal');
select t_igual((select count(*)::int from proveedores where nombre in ('Nuevo 1', 'Roto', 'Nuevo 2')), 0, 'todo o nada: no se guardó ninguna fila');
select t_falla($$select importar_proveedores('[{"nombre":""}]'::jsonb)$$, 'nombre vacío', 'obligatorio');
select t_falla($$select importar_proveedores('{"a":1}'::jsonb)$$, 'no es una lista', 'lista');

-- ---- Insumos ----
select t_login('cocA');
select importar_insumos('[
  {"nombre":"Harina 0000 x 25kg","rubro":"Almacén","magnitud":"masa","unidad_base":"g","costo_neto_por_unidad_base_centavos":96,
   "alicuota_iva":21,"factor_correccion":1,"presentacion_desc":"Bolsa 25 kg","presentacion_cantidad_base":25000,
   "presentacion_precio_neto_centavos":2400000,"presentacion_magnitud":"masa","presentacion_cantidad":25,"presentacion_unidad":"kg","unidad_uso":"g"},
  {"nombre":"Aperol 750cc","magnitud":"volumen","unidad_base":"ml","costo_neto_por_unidad_base_centavos":1100,"alicuota_iva":21,"unidad_uso":"ml"}
]'::jsonb) as i1 \gset
select t_ok((:'i1'::jsonb ->> 'creados')::int = 2, 'insumos: crea 2');
select t_ok((select codigo like 'INS-%' and costo_neto_por_unidad_base_centavos = 96 and presentacion_precio_neto_centavos = 2400000 from insumos where nombre = 'Harina 0000 x 25kg'),
  'insumo con presentación, costo y código asignado');
select t_igual((select count(*)::int from historial_precios_insumo h join insumos i on i.id = h.insumo_id where i.nombre in ('Harina 0000 x 25kg', 'Aperol 750cc') and h.origen = 'carga_inicial'), 2,
  'cada insumo nuevo deja su punto "carga_inicial" en el historial');
select importar_insumos('[{"nombre":"harina 0000 x 25KG","magnitud":"masa","unidad_base":"g","costo_neto_por_unidad_base_centavos":100}]'::jsonb) as i2 \gset
select t_ok((:'i2'::jsonb ->> 'salteados')::int = 1 and (select costo_neto_por_unidad_base_centavos = 96 from insumos where nombre = 'Harina 0000 x 25kg'),
  'existente: se saltea y no toca su costo');
-- actualizar: el nuevo costo queda en el historial como manual y se recalculan recetas
select importar_insumos('[{"nombre":"Harina 0000 x 25kg","magnitud":"masa","unidad_base":"g","costo_neto_por_unidad_base_centavos":120,"presentacion_precio_neto_centavos":3000000}]'::jsonb, true) as i3 \gset
select t_ok((:'i3'::jsonb ->> 'actualizados')::int = 1 and (select costo_neto_por_unidad_base_centavos = 120 from insumos where nombre = 'Harina 0000 x 25kg'),
  'actualizar cambia el costo');
select t_igual((select count(*)::int from historial_precios_insumo h join insumos i on i.id = h.insumo_id where i.nombre = 'Harina 0000 x 25kg' and h.origen = 'manual'), 1,
  'y deja un punto manual en el historial');
select t_falla($$select importar_insumos('[{"nombre":"Harina 0000 x 25kg","magnitud":"volumen","unidad_base":"ml","costo_neto_por_unidad_base_centavos":5}]'::jsonb, true)$$,
  'no cambia la magnitud de uso de un insumo existente', 'magnitud');
select t_falla($$select importar_insumos('[{"nombre":"Z1","magnitud":"masa","unidad_base":"g"},{"nombre":"Z2","magnitud":"nada","unidad_base":"g"}]'::jsonb)$$,
  'magnitud inválida', 'magnitud inválida');
select t_igual((select count(*)::int from insumos where nombre in ('Z1', 'Z2')), 0, 'todo o nada en insumos');
-- proveedor habitual inexistente (de otra empresa)
select t_falla($$select importar_insumos('[{"nombre":"Q","magnitud":"masa","unidad_base":"g","proveedor_habitual_id":"c2000000-0000-0000-0000-000000000001"}]'::jsonb)$$,
  'proveedor de otra empresa', 'Proveedor inexistente');

-- ---- Gastos fijos ----
select t_login('admA');
select importar_gastos_fijos('[
  {"nombre":"Alquiler","categoria":"alquiler","monto_mensual_centavos":150000000,"dia_vencimiento":10,"categorias_caja":["Alquiler"]},
  {"nombre":"Luz","categoria":"servicios","monto_mensual_centavos":8000000}
]'::jsonb) as g1 \gset
select t_ok((:'g1'::jsonb ->> 'creados')::int = 2, 'gastos fijos: crea 2');
select t_ok((select dia_vencimiento = 10 and categorias_caja = '{Alquiler}' and orden = 1 from gastos_fijos where nombre = 'Alquiler')
  and (select orden = 2 from gastos_fijos where nombre = 'Luz'), 'con día, categorías de caja y orden correlativo');
select importar_gastos_fijos('[{"nombre":"alquiler","categoria":"alquiler","monto_mensual_centavos":1}]'::jsonb) as g2 \gset
select t_ok((:'g2'::jsonb ->> 'salteados')::int = 1, 'gasto repetido: se saltea');
select importar_gastos_fijos('[{"nombre":"Alquiler","categoria":"alquiler","monto_mensual_centavos":160000000,"dia_vencimiento":5}]'::jsonb, true) as g3 \gset
select t_ok((:'g3'::jsonb ->> 'actualizados')::int = 1 and (select monto_mensual_centavos = 160000000 and dia_vencimiento = 5 from gastos_fijos where nombre = 'Alquiler'), 'actualizar cambia monto y día');
select t_falla($$select importar_gastos_fijos('[{"nombre":"Bueno","categoria":"x","monto_mensual_centavos":100},{"nombre":"Malo","categoria":"x","monto_mensual_centavos":0}]'::jsonb)$$,
  'monto cero', 'mayor a cero');
select t_igual((select count(*)::int from gastos_fijos where nombre in ('Bueno', 'Malo')), 0, 'todo o nada en gastos fijos');
select t_falla($$select importar_gastos_fijos('[{"nombre":"Mal día","categoria":"x","monto_mensual_centavos":100,"dia_vencimiento":40}]'::jsonb)$$, 'día fuera de rango', '1 a 31');

-- ---- Aislamiento por empresa ----
select t_login('admB');
select t_igual((select count(*)::int from proveedores where nombre = 'Lácteos del Sur'), 0, 'la empresa B no ve lo importado por A');
select importar_proveedores('[{"nombre":"Lácteos del Sur"}]'::jsonb) as rb \gset
select t_ok((:'rb'::jsonb ->> 'creados')::int = 1, 'y puede tener un proveedor con el mismo nombre');

rollback;
