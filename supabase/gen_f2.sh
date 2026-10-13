#!/usr/bin/env bash
# Regenera supabase/f2_aplicar_todo.sql a partir de los f2_*.sql (no editar a mano el resultado).
cd "$(dirname "$0")"
{
echo "-- ============================================================================"
echo "-- SaaS Gastronómico — FASE 2 (Ventas de mostrador), base de datos completa"
echo "-- (generado con gen_f2.sh: no editar a mano)"
echo "-- Pegar y ejecutar UNA vez en el SQL Editor de Supabase, DESPUÉS de la Fase 0 y"
echo "-- la Fase 1. Es idempotente. Orden: f2_ventas, f2_caja_ventas, f2_ventas_rpc."
echo "-- Para usar el módulo, activarlo en la empresa:"
echo "--   update empresas set modulos = '{admin,costos,carta,rrhh,ventas}' where nombre = '...';"
echo "-- ============================================================================"
for s in f2_ventas f2_caja_ventas f2_ventas_rpc; do echo; echo "-- >>>>>>>>>> $s.sql"; cat $s.sql; done
} > f2_aplicar_todo.sql
