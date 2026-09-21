# Especificación técnica y funcional — SaaS Gastronómico

> **Documento maestro** del proyecto: qué es, qué hace, cómo está construido,
> qué tan grande es y cuánto vale como producto a medida.
>
> Aplicación web **100 % frontend** (HTML + CSS + JavaScript vanilla, módulos ES)
> sobre **Supabase** (PostgreSQL + Auth + Row Level Security). Es un **SaaS
> multi-empresa** de gestión administrativa para gastronomía.
>
> Fecha del documento: 2026-09-21.

---

## 1. Resumen ejecutivo

**Qué es.** Un back-office (sistema de gestión interna) para restaurantes, bares
y cocinas. Centraliza compras a proveedores, cuentas por pagar, costos de
insumos, recetas / fichas técnicas, rentabilidad de la carta, flujo de caja y
recursos humanos.

**Para quién.** Dueños y administración de negocios gastronómicos que hoy manejan
todo esto en planillas de Excel sueltas y quieren orden, control de costos y
visibilidad de la rentabilidad plato por plato.

**Modelo.** SaaS **multi-empresa** (multi-tenant): una misma instalación sirve a
muchos negocios, cada uno aislado del otro por seguridad a nivel de base de
datos. Cada empresa tiene sus usuarios con distintos roles.

**Qué NO hace (por diseño).** No mueve dinero real, no emite comprobantes
fiscales (AFIP), no liquida sueldos ni calcula cargas sociales. Es una app
**informativa de gestión**: llega hasta el reporte y el análisis.

---

## 2. Arquitectura general

```
Navegador (SPA vanilla JS)  ──HTTPS──►  Supabase
  ├─ index.html (shell + menú lateral)        ├─ PostgreSQL (datos)
  ├─ js/core   (lógica pura, testeable)        ├─ Auth (login por email)
  ├─ js/saas/data (repos, 1 por tabla)         ├─ RLS (aislamiento por empresa)
  ├─ js/saas/ui   (1 pantalla por módulo)      ├─ Funciones RPC (transacciones)
  └─ js/export (Excel .xlsx)                    └─ Storage (bucket privado docs)
```

### Principios de diseño (separación de responsabilidades)

- **`core/`** — lógica pura de negocio (dinero, unidades, fiscal, costeo). No
  conoce ni la base de datos ni el DOM. **Es la parte testeada.**
- **`data/`** — un repositorio por tabla; habla con Supabase. No toca el DOM.
- **`ui/`** — una pantalla por módulo + shell + helpers. **No calcula** nada de
  negocio: delega en `core/`.
- **`export/`** — generación de planillas Excel con SheetJS.

### Decisiones de arquitectura destacables

1. **La integridad de saldos vive en la base, no en el cliente.** Operaciones
   como crear una factura, registrar un pago o anularlo se hacen en **funciones
   RPC transaccionales** de PostgreSQL. El cliente **no puede** escribir un saldo
   directamente. Esto evita inconsistencias por cierres de pestaña, doble clic o
   manipulación.
2. **Aislamiento multi-empresa por RLS (Row Level Security).** Las políticas de
   PostgreSQL garantizan que un usuario de la empresa A jamás vea datos de la
   empresa B, aunque intente forzar la consulta. La barrera real es la base, no
   la interfaz.
3. **Dinero como entero en centavos (`BIGINT`).** Nunca `float`: se evitan los
   errores clásicos de redondeo con decimales.
4. **Toda magnitud física en unidad base** (`g` / `ml` / `un`). Se compra en kg
   y se usa en g sin errores de conversión.
5. **Nada se borra ni se edita: se anula.** Los movimientos contables se revierten
   con **contraasiento**; los registros usan **baja lógica** (`activo` / `estado`).
   Así los saldos siempre cierran y hay trazabilidad.

---

## 3. Módulos funcionales

### 3.1 Inicio · Tablero
Resumen del negocio de un vistazo: deuda total, facturas por vencer (7 días),
lo que hay que pagar según la agenda, balance de caja del día, top de deudores,
próximos vencimientos y peores food cost.

### 3.2 Compras · Proveedores
Padrón de proveedores con **KPIs** (deuda total, facturas pendientes, por vencer,
cantidad). Buscador y filtros (por nombre/código/CUIT, rubro, orden por deuda).
Alta con condición fiscal, contacto y **rubros** (uno principal). **Ficha de
cuenta corriente**: facturas y pagos lado a lado, totales facturado/pagado y
deuda. **Exportación a Excel** de la deuda.

### 3.3 Compras · Facturas
Carga de comprobantes A/B/C con **desglose neto / IVA / percepciones** y
**cálculo bidireccional** (escribís el neto y sale el total, o al revés).
Opcionalmente, en la misma carga se **actualizan los costos de los insumos** de
esa compra, lo que **recalcula automáticamente las recetas** que los usan.

### 3.4 Compras · Pagos
Registro de pagos con **imputación FIFO** (paga las facturas más viejas primero)
o **manual** (elegís a cuáles). Métodos: efectivo, transferencia, cheque, e-Cheq,
otro. El excedente queda como **saldo a favor**. Historial con **anulación por
contraasiento** (revierte, no borra).

### 3.5 Caja · Agenda de pagos
Planificación del flujo de caja: qué pagar en los próximos 7 / 15 / 30 / 90 días,
agrupado por día, distinguiendo **efectivo vs. en cuenta** y lo **vencido**. Es
planificación pura; no toca la cuenta corriente.

### 3.6 Caja · Flujo de caja
Libro de caja diario: ingresos y egresos con categoría (combo abierto), medio de
pago, monto y nota. Balance del día y tabla de los últimos 7 días.

### 3.7 Costos · Insumos
Alta de insumos con **magnitud** (masa/volumen/unidad), **presentación de compra**
(ej. barra de 5 kg), **factor de corrección** (rendimiento tras limpieza/desposte)
y alícuota de IVA. La app calcula el **costo por unidad base útil** con IVA y
merma. Actualización rápida de precio con **variación % en vivo**, **historial de
precios** con mini-gráfico y **recálculo de recetas** al cambiar un costo.

### 3.8 Rentabilidad · Recetas y costos (escandallos)
Recetario / fichas técnicas con **platos** (se venden) y **preparaciones**
(sub-recetas reutilizables, ej. una salsa). Ingredientes = insumos y/o
preparaciones anidadas (**hasta 4 niveles**). Cálculo en vivo de **food cost %**,
**margen** y **precio sugerido**, con **calculadora inversa** ("¿a qué precio
vender para un food cost del X %?"). **Detección de referencias circulares** entre
sub-recetas.

### 3.9 Rentabilidad · Carta y análisis
La carta agrupada por sector de despacho, imprimible y exportable a Excel.
Análisis fino de food cost % y margen por plato y por sector con **semáforo**
(🟢 ≤ 30 % · 🟡 30–35 % · 🔴 > 35 %) y ranking del peor al mejor.

### 3.10 Recursos Humanos
Módulo aparte que se acopla sin tocar lo existente:
- **Empleados** con búsqueda, filtros y semáforo de documentación.
- **Ficha** por pestañas: Datos, **Legajo** (DNI/CUIL/CBU/obra social — solo
  dueño), **Sueldo** (vigente + historial, montos en centavos — solo dueño),
  **Ausencias** (vacaciones/enfermedad/franco/licencias con saldo orientativo y
  bloqueo de solapamientos), **Documentos** (imagen o PDF con **compresión** de
  imágenes y visor por **signed URL** temporal).
- **Vencimientos** — tablero de documentación vencida y por vencer (30 días).
- **Configuración** — ABM de tipos de documento y tramos de vacaciones (LCT).
- Bucket de Storage **privado** (`rrhh-docs`); archivos solo por URL firmada.
- **No liquida sueldos**: llega hasta el reporte de datos.

### 3.11 Configuración
Datos de la empresa y **preferencia de costeo** (con/sin IVA), gestión de
**usuarios y roles**, y **catálogos** editables (rubros, sectores, unidades de
rendimiento, categorías de caja).

---

## 4. Roles y permisos

| Rol | Alcance |
|---|---|
| `ADMIN` (dueño) | Todo, incluidos datos sensibles de RRHH (legajo y sueldos) y configuración de la empresa. |
| `GERENTE` (encargado) | Operación diaria: compras, costos, recetas, empleados/ausencias/documentos. **No** ve legajo ni sueldos. |
| `COCINA` | Acceso operativo acotado; sin RRHH. |
| `AUDITOR` | Solo lectura; sin RRHH. |

> El ocultamiento en la interfaz es de conveniencia; la **barrera real** son las
> políticas RLS de la base de datos.

---

## 5. Modelo de datos (PostgreSQL)

**21 tablas** más vistas y funciones. Agrupadas:

- **Núcleo / multi-tenant:** `empresas`, `sucursales`, `usuarios`, `catalogos`.
- **Compras:** `proveedores`, `facturas`, `pagos`, `pago_imputaciones`.
- **Caja:** `movimientos_caja`, `pagos_programados`.
- **Costos:** `insumos`, `historial_precios_insumo`.
- **Recetas:** `recetas`, `ingredientes_receta`.
- **RRHH:** `empleados`, `empleados_legajo`, `empleados_sueldos`, `ausencias`,
  `tipos_documento`, `documentos`, `config_vacaciones`.

### Funciones RPC (lógica transaccional en la base)

| Función | Qué hace |
|---|---|
| `crear_empresa_y_admin(...)` | Bootstrap de una empresa nueva con su primer ADMIN. |
| `crear_factura(...)` | Alta de factura + desglose + suba de deuda, en transacción. |
| `registrar_pago(...)` | Pago con imputación FIFO/manual + saldo a favor. |
| `anular_pago(p_pago_id)` | Contraasiento que revierte un pago sin borrarlo. |
| `dias_vacaciones(empleado, año)` | Cálculo orientativo de días según antigüedad (LCT). |
| `seed_rrhh_empresa()` | Siembra tipos de documento y tramos de vacaciones. |
| `mi_empresa()` / `mi_rol()` | Helpers de contexto usados por las políticas RLS. |
| `set_modificado_en()` | Trigger de auditoría (timestamp de modificación). |

---

## 6. Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | HTML5, CSS, **JavaScript vanilla** con módulos ES (sin framework, sin build) |
| Backend / DB | **Supabase**: PostgreSQL, Auth (email), Row Level Security, Storage |
| Lógica de servidor | Funciones **RPC** en PL/pgSQL (transaccionales) |
| Exportación | **SheetJS** (xlsx) |
| Imágenes | Compresión en cliente (redimensionado a 1200px + JPEG 0.7) |
| Tests | `node --test` (runner nativo de Node) sobre el `core/` |
| Deploy | Sitio estático: Cloudflare Pages / Netlify / Vercel / GitHub Pages |

**Ventaja de costos de infraestructura:** al ser 100 % frontend estático +
Supabase, el hosting arranca en **plan gratuito** y escala barato. No hay
servidor propio que mantener.

---

## 7. Calidad, seguridad y tamaño

### Calidad
- Núcleo de negocio con **tests automatizados** (`costeo`, `dinero`, `fiscal`,
  `unidades`, `utilsFecha`).
- Separación estricta de capas → mantenible y ampliable.
- **Documentación completa** incluida: README, manual de uso para el operador y
  guías de migración/módulo RRHH.

### Seguridad
- RLS activa en todas las tablas sensibles; aislamiento por empresa.
- Datos sensibles de RRHH (legajo/sueldos) restringidos a ADMIN vía RLS.
- Bucket de documentos **privado**; acceso solo por signed URL temporal.
- Integridad de saldos garantizada por transacciones en la base.
- Sin borrado físico: todo es baja lógica o contraasiento (trazabilidad).

### Tamaño del proyecto (magnitud del trabajo)
- **~6.000 líneas** de JavaScript (≈ 45 archivos entre core, data, ui, export).
- **~1.200 líneas** de SQL (esquema, funciones, catálogos, RRHH, bootstrap).
- **21 tablas**, **8+ funciones RPC**, **11 pantallas** funcionales.
- Documentación de usuario y técnica completa.

---

## 8. Estado y limitaciones conocidas

- App **informativa**: no integra medios de pago reales ni facturación AFIP.
- RRHH **no liquida**: exporta datos para el contador; cálculos de vacaciones
  orientativos y editables.
- Alta de usuarios nuevos se hace desde el panel de Supabase (Auth), luego el
  ADMIN les asigna rol dentro de la app.
- Diseñado para crecer: hay lugar previsto para fichaje, turnos y costo laboral
  (horas × sueldo vigente) sin migración destructiva.

---

## 9. Valuación: ¿cuánto se puede cobrar este producto?

> **Aclaración importante.** Los números de abajo son un **rango de referencia**
> de mercado (2026), no un presupuesto cerrado. El precio real depende del país,
> del cliente, de si vendés una licencia a medida o un servicio mensual, y de qué
> incluís (implementación, soporte, capacitación). Va lo relevante para orientarte.

### 9.1 Qué estás vendiendo, en realidad

Esto **no es una landing** ni un sitio simple: es un **sistema de gestión (ERP
acotado) multi-empresa** con lógica de negocio real, seguridad a nivel de base y
módulo de RRHH. La valuación tiene que reflejar eso.

### 9.2 Estimación por esfuerzo (costo de reproducirlo)

Reconstruir esto desde cero razonablemente lleva **entre 250 y 450 horas** de un
desarrollador con experiencia (análisis, modelo de datos + RLS, RPC
transaccionales, 11 pantallas, RRHH, tests y documentación).

| Tarifa por hora | 250 h | 450 h |
|---|---|---|
| USD 15/h (junior/LatAm) | ~USD 3.750 | ~USD 6.750 |
| USD 30/h (semi-senior) | ~USD 7.500 | ~USD 13.500 |
| USD 50/h (senior/freelance intl.) | ~USD 12.500 | ~USD 22.500 |

### 9.3 Precios sugeridos según modelo de venta

**A) Venta a medida (licencia + implementación, un solo pago).**
Un cliente único que quiere el sistema instalado y adaptado a su negocio.

- Mercado **Argentina / LatAm** (PyME gastronómica): **USD 2.500 – 6.000**
  (o equivalente en ARS), típicamente **USD 3.000 – 4.500**.
- Mercado **internacional / freelance** (EE. UU., Europa): **USD 8.000 – 18.000**.

**B) SaaS por suscripción (recomendado para maximizar valor).**
Cobrás una mensualidad por local. Es donde este producto brilla, porque ya es
multi-empresa.

- **USD 25 – 80 por local/mes** según tamaño y módulos (RRHH suele ir aparte).
- Con **10 locales** a USD 40/mes = **USD 4.800/año recurrentes**; con 30 locales,
  ~USD 14.400/año. El valor se compone con el tiempo.
- Opcional: **setup fee** de USD 200 – 800 por alta de cliente (implementación +
  capacitación).

**C) Servicios asociados (ingreso extra).**
- Implementación y carga inicial de datos: **USD 300 – 1.200**.
- Capacitación al personal: **USD 100 – 300** por sesión.
- Soporte / mantenimiento mensual: **USD 50 – 200/mes**.
- Personalizaciones (nuevos reportes, integraciones): por hora, USD 20 – 60.

### 9.4 Recomendación práctica

1. **No lo vendas como "una página".** Posicionalo como *sistema de control de
   costos y rentabilidad para gastronomía*. El comprador paga por **ahorrar plata**
   (bajar food cost, controlar deuda), no por líneas de código.
2. Para tus primeros clientes en Argentina, un rango **a medida de
   USD 3.000 – 4.500** (o su equivalente en ARS al cambio del momento) es
   defendible y competitivo.
3. Si podés, **empujá el modelo SaaS mensual**: menor barrera de entrada para el
   cliente y **ingreso recurrente** para vos. Es el mejor uso de que ya sea
   multi-empresa.
4. Cobrá **aparte** implementación, capacitación y soporte. Suman y son lo que
   fideliza.
5. Mostrá el **ROI**: si el sistema le ayuda a bajar 2–3 puntos de food cost en un
   local que factura, se paga solo en semanas. Ese es tu mejor argumento de venta.

---

## 10. Puesta en marcha (resumen)

1. Crear proyecto Supabase (plan Free) y habilitar Auth por email.
2. Ejecutar los scripts SQL en orden: `schema.sql` → `functions.sql` →
   `catalogos.sql` → `pagos_programados.sql` (+ `rrhh.sql` para RRHH).
3. Crear el primer usuario y correr `bootstrap.sql` para dejarlo como ADMIN.
4. Pegar Project URL + publishable key en `js/config/supabase.js`.
5. Publicar el sitio estático y registrar la URL pública en Supabase.

Detalle completo en el [`README.md`](../README.md), el [manual de uso](manual.md)
y las guías de [`plan-migracion-supabase.md`](plan-migracion-supabase.md) y
[`modulo-rrhh.md`](modulo-rrhh.md).
