-- ============================================================================
-- SaaS Gastronómico — Migración: unidad de uso de los insumos
-- ----------------------------------------------------------------------------
-- El insumo distingue lo que SE COMPRA (presentación: botella, caja, barra...)
-- de lo que SE USA en las recetas (ml, oz, g...).
--   • `magnitud` / `unidad_base`  → pasan a ser los de USO (los que lee Recetas).
--   • `presentacion_cantidad_base` → cuántas unidades base de USO trae la
--     presentación (ej: 1000 ml por botella).
-- Se agregan los datos de la presentación tal como se cargan, y la unidad de
-- uso elegida (para mostrar costos y cargar recetas en oz, cc, etc.).
-- Los insumos existentes siguen funcionando igual (columnas nuevas opcionales).
-- Idempotente. Ejecutar en Supabase → SQL Editor → Run.
-- ============================================================================

alter table insumos add column if not exists presentacion_magnitud varchar(20);
alter table insumos add column if not exists presentacion_cantidad numeric(14,4);
alter table insumos add column if not exists presentacion_unidad   varchar(10);
alter table insumos add column if not exists unidad_uso            varchar(10);
