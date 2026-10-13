#!/usr/bin/env bash
# Regenera supabase/f0_aplicar_todo.sql a partir de los f0_*.sql (no editar a mano el resultado).
cd "$(dirname "$0")"
{
echo "-- ============================================================================"
echo "-- SaaS Gastronómico — FASE 0 completa (generado con gen_todo.sh: no editar a mano)"
echo "-- Pegar y ejecutar UNA vez en el SQL Editor de Supabase, DESPUÉS de haber"
echo "-- corrido todos los scripts anteriores. Es idempotente: se puede re-ejecutar."
echo "-- Orden: roles_rls, auditoria, usuarios, empresas_columnas, zona_horaria,"
echo "--        integridad, costeo, rpc_atomicas."
echo "-- ============================================================================"
for s in f0_roles_rls f0_auditoria f0_usuarios f0_empresas_columnas f0_zona_horaria f0_integridad f0_costeo f0_rpc_atomicas; do
  echo; echo "-- >>>>>>>>>> $s.sql"; cat $s.sql
done; } > f0_aplicar_todo.sql
