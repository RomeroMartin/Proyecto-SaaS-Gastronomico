-- ============================================================================
-- SaaS Gastronómico — Migración: fecha de alta del empleado (RRHH)
-- ----------------------------------------------------------------------------
-- `fecha_ingreso` = cuándo empezó a trabajar realmente (base de antigüedad y
-- vacaciones). `fecha_alta` = cuándo se lo registró formalmente; es opcional
-- (vacía = todavía sin dar de alta). Idempotente.
-- Ejecutar en Supabase → SQL Editor → Run.
-- ============================================================================

alter table empleados add column if not exists fecha_alta date;
