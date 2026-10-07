# SaaS Gastronómico — Back-office de compras, costos y rentabilidad

Aplicación web **100 % frontend** (HTML + CSS + JavaScript vanilla, módulos ES)
sobre **Supabase** (PostgreSQL + Auth + RLS). Es un **SaaS multi-empresa** de
gestión administrativa para gastronomía: proveedores y cuentas por pagar,
insumos y costos técnicos, recetas y rentabilidad, agenda de pagos y tablero.

> Es una app **informativa de gestión**: no mueve dinero real ni emite
> comprobantes fiscales.

---

> 📖 **Manual de uso** (cómo operar cada pantalla): [`docs/manual.md`](docs/manual.md).

## Módulos

- **Inicio · Tablero** — resumen: deuda, vencimientos, flujo de caja, peores food cost, alertas.
- **Compras · Proveedores** — padrón con KPIs, filtros, ficha de cuenta corriente y export a Excel.
- **Compras · Facturas** — carga con desglose neto/IVA/percepciones (cálculo bidireccional).
- **Compras · Pagos** — imputación FIFO/manual y anulación por contraasiento.
- **Caja · Agenda de pagos** — planificación del flujo de caja (efectivo vs. en cuenta).
- **Costos · Insumos** — unidad base normalizada, factor de corrección, historial de precios.
- **Rentabilidad · Recetas y costos** — recetas y sub-recetas, food cost %, margen y precio sugerido.
- **Recursos Humanos** — empleados, legajo, historial de sueldos, ausencias/vacaciones y documentación con vencimientos. Ver [`docs/modulo-rrhh.md`](docs/modulo-rrhh.md).

---

## Arquitectura

```
├── index.html               ← app (SPA con menú lateral)
├── js/
│   ├── config/supabase.js    ← cliente Supabase (URL + publishable key)
│   ├── core/                 ← lógica pura y testeable (no conoce la DB ni el DOM)
│   │   ├── dinero.js · unidades.js · fiscal.js · costeo.js · rubros.js
│   ├── saas/
│   │   ├── auth.js           ← login / sesión / perfil
│   │   ├── data/             ← repos Supabase (uno por tabla) + RPC
│   │   └── ui/               ← una pantalla por módulo + shell + helpers
│   └── export/excel.js       ← exportación a .xlsx (SheetJS)
├── supabase/                 ← scripts SQL (esquema, funciones, tablas, bootstrap)
└── test/                     ← tests del núcleo (node --test)
```

**Separación de responsabilidades:** `core/` no conoce Supabase ni el DOM;
`data/` no conoce el DOM; `ui/` no calcula. La integridad de saldos vive en
**funciones RPC** de la base (no se puede escribir un saldo desde el cliente),
y el aislamiento entre empresas lo garantiza **Row Level Security (RLS)**.

---

## Reglas de negocio (núcleo)

1. Toda magnitud física se guarda en **unidad base** (`g`/`ml`/`un`).
2. El dinero se guarda como **entero en centavos** (`BIGINT`).
3. Los movimientos contables **no se editan: se anulan** (contraasiento).
4. Operaciones multi-tabla en **transacción** (RPC en PostgreSQL).
5. **Nada se borra físicamente** (soft delete `activo`).

---

## Puesta en marcha

### 1. Crear el proyecto Supabase (una vez)

Ver el paso a paso en [`docs/plan-migracion-supabase.md`](docs/plan-migracion-supabase.md).
En resumen:

1. Crear proyecto en [supabase.com](https://supabase.com) (plan Free).
2. **Authentication → Providers**: habilitar Email.
3. **SQL Editor**: ejecutar en orden los scripts de `supabase/`:
   `schema.sql` → `functions.sql` → `catalogos.sql` → `pagos_programados.sql`.
   Para el módulo de RRHH, ejecutar además `rrhh.sql` (ver [`docs/modulo-rrhh.md`](docs/modulo-rrhh.md)).
4. Crear el primer usuario (Authentication → Users) y correr `bootstrap.sql`
   (con tu email y el nombre de tu empresa) para quedar como ADMIN.
5. Pegar **Project URL** y **publishable key** en `js/config/supabase.js`.

> **¿Ya tenías el proyecto corriendo antes de esta versión?** Además de lo de
> arriba, corré una vez `supabase/migracion_impuesto_interno.sql` (agrega el
> campo de impuesto interno / otros impuestos no recuperables a Facturas) y
> `supabase/migracion_anular_factura.sql` (permite anular una factura mal
> cargada, en vez de editarla) y `supabase/migracion_razon_social.sql` (agrega
> la **razón social** del proveedor; el campo "nombre" pasa a ser el nombre de fantasía).

### 2. Correr los tests del núcleo

```bash
npm test
```

### 3. Probar localmente

Al usar módulos ES nativos, servila por HTTP (no `file://`):

```bash
npx serve .        # o: python3 -m http.server 8080
```

Abrí `http://localhost:8080/` (o `index.html` con Live Server).

### 4. Desplegar

Es un sitio estático: se publica en Cloudflare Pages, Netlify, Vercel o
GitHub Pages. Recordá agregar la URL pública en Supabase →
**Authentication → URL Configuration**.

---

## Roles

`ADMIN`, `GERENTE`, `COCINA`, `AUDITOR` (en la tabla `usuarios`). El gating de
la UI es de conveniencia; la barrera real son las políticas RLS.
