#!/usr/bin/env bash
# ============================================================================
# Corre TODOS los scripts SQL del repo y los tests contra un PostgreSQL limpio.
#
#   Uso:  bash supabase/tests/run.sh
#   Conexión: variables estándar de psql (PGHOST, PGPORT, PGUSER, PGPASSWORD).
#             Por defecto: socket local, usuario postgres.
#
# 1) Crea una base temporal vacía.
# 2) Carga el Supabase simulado.
# 3) Ejecuta los scripts de supabase/ en el orden documentado (instalación
#    nueva + migraciones + f0_*).
# 4) Carga helpers y datos base y corre cada test (supabase/tests/[1-9]*.sql).
# Termina con código ≠ 0 al primer error/falla. Borra la base temporal al final.
# ============================================================================
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"          # .../supabase
DB="rev_test_$$"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)

"${PSQL[@]}" -d postgres -c "create database $DB" >/dev/null
cleanup() { "${PSQL[@]}" -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

sql() {  # ejecuta un archivo; aborta si falla
  local f="$1"
  if ! out=$("${PSQL[@]}" -d "$DB" -f "$f" 2>&1); then
    echo "$out"; echo "✗ ERROR ejecutando $f"; exit 1
  fi
}

echo "▶ Supabase simulado"
sql "$DIR/tests/00_mock_supabase.sql"

echo "▶ Scripts del repo (orden de instalación)"
ORDEN=(
  schema functions catalogos pagos_programados movimientos_caja rrhh
  migracion_impuesto_interno migracion_anular_factura migracion_razon_social
  migracion_unidad_uso migracion_fecha_alta migracion_editar_factura heartbeat
  f0_roles_rls f0_auditoria f0_usuarios f0_empresas_columnas f0_zona_horaria
  f0_integridad f0_costeo f0_rpc_atomicas f1_modulos_empresa f2_ventas f2_caja_ventas f2_ventas_rpc f3_ventas_reportes
)
for s in "${ORDEN[@]}"; do
  if [ -f "$DIR/$s.sql" ]; then echo "   · $s.sql"; sql "$DIR/$s.sql"; fi
done

echo "▶ Helpers y datos base"
sql "$DIR/tests/01_helpers.sql"
sql "$DIR/tests/02_datos_base.sql"

echo "▶ Datos generados para los tests (casos de costeo compartidos con Node)"
mkdir -p "$DIR/tests/.gen"
node "$DIR/tests/gen_costeo_fixture.mjs" > "$DIR/tests/.gen/costeo_fixture.sql"

echo "▶ Tests"
fallos=0
for t in "$DIR"/tests/[1-9]*.sql; do
  [ -f "$t" ] || continue
  nombre="$(basename "$t")"
  if out=$("${PSQL[@]}" -d "$DB" -f "$t" 2>&1); then
    n=$(echo "$out" | grep -c "OK:" || true)
    echo "   ✓ $nombre ($n verificaciones)"
  else
    echo "   ✗ $nombre"; echo "$out" | grep -v "^$" | tail -15; fallos=$((fallos+1))
  fi
done

echo "▶ Idempotencia: re-ejecutar f0_* sobre la base ya migrada"
for s in f0_roles_rls f0_auditoria f0_usuarios f0_empresas_columnas f0_zona_horaria f0_integridad f0_costeo f0_rpc_atomicas f1_modulos_empresa f2_ventas f2_caja_ventas f2_ventas_rpc f3_ventas_reportes; do
  sql "$DIR/$s.sql"
done
echo "   ✓ re-ejecución sin errores"

if [ "$fallos" -gt 0 ]; then echo "✗ $fallos archivo(s) de test con fallas"; exit 1; fi
echo "✓ Todos los tests SQL pasaron"
