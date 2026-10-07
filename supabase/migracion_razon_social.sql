-- ============================================================================
-- SaaS Gastronómico — Migración: razón social del proveedor
-- ----------------------------------------------------------------------------
-- `proveedores.nombre` pasa a ser el NOMBRE DE FANTASÍA (es el que se muestra en
-- toda la app). Se agrega `razon_social` como dato aparte (opcional).
-- Idempotente. Ejecutar en Supabase → SQL Editor → Run.
-- ============================================================================

alter table proveedores add column if not exists razon_social varchar(255);
