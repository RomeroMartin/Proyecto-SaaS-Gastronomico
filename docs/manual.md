# Manual de uso — SaaS Gastronómico

Guía práctica de todo lo que hace la app y cómo usarla en el día a día.
Pensada para administración (no hace falta saber de programación).

> La app es de **gestión informativa**: te ayuda a controlar compras, costos,
> caja y rentabilidad. **No** mueve plata real ni emite facturas fiscales.

---

## Índice

1. [Ingresar](#1-ingresar)
2. [Cómo moverse (navegación general)](#2-cómo-moverse-navegación-general)
3. [Módulo Administrativo](#3-módulo-administrativo)
4. [Módulo Costos](#4-módulo-costos)
5. [Módulo Rentabilidad de carta](#5-módulo-rentabilidad-de-carta)
6. [Configuración](#6-configuración)
7. [Conceptos clave (glosario)](#7-conceptos-clave-glosario)
8. [Preguntas frecuentes](#8-preguntas-frecuentes)

---

## 1. Ingresar

1. Abrí la app en el navegador.
2. Ingresá tu **email** y **contraseña**.
3. Entrás directamente al **Resumen del módulo Administrativo**.

Arriba a la izquierda vas a ver el **nombre de tu empresa**; abajo del menú,
tu usuario, tu rol y el botón para **salir**.

---

## 2. Cómo moverse (navegación general)

- **Menú lateral (izquierda):** está dividido en **módulos** (Administrativo,
  Costos, Rentabilidad de carta, Configuración).
- **Clic en un módulo:** se **abre** y muestra su **Resumen**; si volvés a
  tocarlo, se **cierra**.
- Cada módulo tiene **submódulos** (las pantallas). El submódulo activo queda
  resaltado.
- **En el celular:** el menú se esconde; se abre con el botón **☰** de arriba.

### Detalles que se repiten en toda la app

- **Ícono "i":** al lado de los campos menos obvios hay un **ícono de ayuda**.
  Pasá el mouse (o tocá) y aparece una explicación breve.
- **Campos con desplegable abierto (combos):** en Rubro, Sector, Unidad,
  Categorías de caja, etc., podés **elegir de la lista o escribir uno nuevo**.
  Lo que escribís **se guarda** y aparece la próxima vez.
- **Avisos (toasts):** cuando algo sale bien o mal, aparece un cartelito arriba
  a la derecha.
- **Confirmaciones:** las acciones delicadas (anular, dar de baja, eliminar)
  piden confirmación antes de ejecutarse.
- **Importes:** se escriben como en Argentina (ej: `34.000,50`).

---

## 3. Módulo Administrativo

Todo lo de proveedores, deudas, pagos y caja.

### 3.1 Resumen (tablero)
Vista rápida: **deuda total**, **facturas por vencer** (7 días), **a pagar según
la agenda** (7 días) y **balance de caja de hoy**, más el top de deudores y las
próximas facturas a vencer.

### 3.2 Proveedores
- **Tarjetas (KPIs) arriba:** deuda total, facturas pendientes, por vencer y
  cantidad de proveedores. Cada una tiene su "i" que explica qué muestra.
- **Buscador y filtros:** buscá por nombre/código/CUIT, filtrá por rubro y
  ordená por deuda. Botón **Limpiar** para resetear.
- **Nuevo proveedor:** nombre, CUIT, condición fiscal, contacto, teléfono,
  email y **rubros** (agregás uno o varios; elegís el **principal**, con el que
  se agrupa y se registra la deuda).
- **Editar:** botón en cada fila.
- **Ver ficha (cuenta corriente):** abre la ficha con tabs **Facturas**,
  **Pagos** y **Debe / Haber** (totales facturado y pagado), y la **deuda**
  arriba. Desde ahí podés **Cargar factura**, **Registrar pago** y **Anular**
  pagos.
- **Exportar Excel:** baja la deuda de todos los proveedores a un `.xlsx`.

### 3.3 Facturas
1. Elegí el **proveedor**.
2. Cargá **Comprobante** (A/B/C), número, fechas de emisión y vencimiento.
3. **Importes con cálculo bidireccional:** escribís el **neto** y se completa el
   **total** (o al revés). Elegís la **alícuota** de IVA y, si hay,
   **percepciones** (IVA/IIBB) y/o **impuesto interno / otros** (cargos no
   recuperables, ej. bebidas alcohólicas). Abajo ves el desglose completo
   (neto · IVA · percep · otros imp. · total).
4. **(Opcional) Actualizar costos de insumos de esta compra:** agregás filas
   con **insumo + cantidad + unidad + precio neto** (la unidad puede ser la
   propia presentación, ej. *2 Botellas*). Al guardar, se **actualiza
   el costo** de esos insumos (queda en su historial) y se **recalculan las
   recetas** automáticamente.
5. **Guardar factura:** sube la **deuda** del proveedor.
6. **Ver:** el botón **Ver** abre el detalle completo de la factura (proveedor,
   fechas, desglose de importes, observaciones y los pagos imputados). También
   se abre desde la ficha del proveedor y desde "Próximas a vencer" del Resumen.
7. **Editar:** corrige una factura ya cargada.
   - **Sin pagos imputados:** se puede cambiar todo (proveedor, comprobante,
     número, fechas, importes, observaciones); la deuda del proveedor se ajusta
     sola.
   - **Con pagos imputados:** solo comprobante, número, fechas y observaciones.
     Para cambiar importes o proveedor, primero anulá esos pagos.
   - Las fechas deben tener un año entre 2000 y 2100 (evita errores de tipeo
     como el año 0026, que aparecía como "vencida hace 730477 días").
8. **Anular:** revierte la deuda que había generado la factura; queda anulada
   (no se borra). Solo si **todavía no tiene pagos imputados**.

### 3.4 Pagos
1. Elegí el **proveedor** → ves su **deuda** y las **facturas pendientes**.
2. Cargá **monto**, **método** (efectivo, transferencia, cheque, e-Cheq, otro),
   **fecha** y **modo de imputación**:
   - **FIFO:** paga primero las facturas más viejas.
   - **Manual:** tildás a qué facturas imputar.
3. **Registrar pago:** baja las facturas y el saldo. Si pagás de más, el
   excedente queda como **saldo a favor** (te avisa).
4. **Historial de pagos** con botón **Anular** (genera un contraasiento: revierte
   todo, no borra nada).

### 3.5 Agenda de pagos
Planificás los pagos **a proveedores** de los próximos días.
- Cargás **proveedor, fecha, monto y cómo vas a pagar**.
- Ves, **agrupado por día**, cuánto necesitás en **efectivo** y cuánto **en
  cuenta**, más lo **vencido**.
- Botones **Pagado** (lo saca de lo pendiente) y **Quitar**.
- Selector de rango: 7 / 15 / 30 / 90 días.

> La agenda es **planificación**: no toca la cuenta corriente. El pago real se
> registra en **Pagos** (o desde la ficha del proveedor).

### 3.6 Flujo de caja
Libro de caja **diario**: registrás lo que **entra** y lo que **sale**.
- **Cargar movimiento:** tipo (ingreso/egreso), **categoría** (combo abierto),
  **medio** (efectivo, tarjeta, QR, transferencia, cheque, otro), monto y nota.
- Arriba ves **Ingresos**, **Egresos** y **Balance** del día.
- Podés cambiar el día (‹ ›) y ves una tabla con los **últimos 7 días**.

---

## 4. Módulo Costos

### 4.1 Resumen
Cantidad de insumos, **precios desactualizados** (+30 días) y **últimos
aumentos** registrados.

### 4.2 Insumos
- **Nuevo insumo:** nombre, rubro, **proveedor habitual**, **magnitud de
  compra** (masa/volumen/unidad), alícuota de IVA y **factor de corrección**.
- **Presentación de compra:** cómo lo comprás (ej: *Botella*), cantidad,
  unidad y **precio neto** de esa presentación.
- **Unidad de uso:** cómo lo usás en las recetas. Elegís la **magnitud de uso**,
  la **unidad de uso** (ml, cc, l, **oz**, g…) y **cuántas unidades de uso trae
  la presentación** (ej: botella de Fernet → volumen, oz, 33,8). Si la magnitud
  de uso es la misma que la de compra, la cantidad se calcula sola. La app
  calcula el **costo por unidad de uso** y lo muestra **con IVA y merma**; ese
  es el costo que usan las recetas. *(1 oz = 29,57 ml)*
- En cada fila:
  - **Ficha:** todos los datos + historial de precios. Desde ahí podés
    **Editar** (todos los campos del insumo, incluido el precio de la
    presentación) o **Actualizar precio** (cambio rápido, con **variación %**).
    Si cambia el costo, queda en el **historial** y se **recalculan las
    recetas**.
  - **Baja.**

### 4.3 Historial de precios
Elegís un insumo y ves la **evolución de su costo**: un **mini-gráfico** y una
tabla con cada cambio, el **% de variación** y el origen (factura/manual).

---

## 5. Módulo Rentabilidad de carta

### 5.1 Resumen
**Food cost promedio**, cantidad de **platos caros** (sobre el umbral) y **margen
por sector**, con los peores food cost.

### 5.2 Platos y preparaciones
El **recetario / fichas técnicas**.
- **Plato:** se vende (tiene precio de carta y sector).
- **Preparación:** una sub-receta (ej: una salsa) que se usa dentro de otras.
- **Ingredientes:** agregás **insumos** y/o **preparaciones**, con su cantidad.
  Para los insumos podés elegir la unidad (por defecto, la de uso: ej. oz; o
  cc, ml…) y se convierte sola. Ves el **costo de cada línea** y el **costo total** en vivo.
- Para platos: **food cost %**, **margen** y una **calculadora inversa**
  ("¿a qué precio vender para un food cost del X%?").
- Detecta **referencias circulares** entre sub-recetas y no deja guardarlas.

### 5.3 Carta
Los **platos que se venden**, con su **precio** y **sector de despacho**,
agrupados por sector. Se puede **imprimir** y **exportar a Excel**.

### 5.4 Rentabilidad de carta
Análisis fino: **food cost % y margen por plato y por sector**, con **semáforo**
(🟢 ≤ 30 % · 🟡 30–35 % · 🔴 > 35 %) y ranking del peor al mejor.

---

## 5b. Módulo Ventas (mostrador)

Solo aparece si tu plan incluye **Ventas**. Pensado para locales con mostrador o venta rápida.

### Preparación (una sola vez)
1. **Ventas → Configuración** (ADMIN): alias de cobro, WhatsApp de cocina, medios de pago, delivery,
   hora de corte del día y **cómo sale la comanda** (solo WhatsApp, solo impresora, o impresora con
   WhatsApp de respaldo).
2. **Rentabilidad de carta → Platos → Editar**: tildá **Se vende en el mostrador**, elegí la categoría de venta
   y el orden. Si es un extra que se suma a otro producto (ej. medallón extra), tildá **Es un adicional**.
   Las bebidas y reventa se cargan como platos con un solo ingrediente.

### Uso diario (Ventas → Mostrador)
- **Abrir caja** con el fondo de cambio. Hay una sola caja abierta por vez.
- Tocá los productos para armar el pedido; los adicionales se agregan al producto seleccionado.
  Elegí el medio de pago (con transferencia se muestra el alias para copiar) y **Confirmar pedido**.
- La **comanda** sale según la configuración: se imprime en la impresora del local y/o se envía por WhatsApp.
  Si la impresora falla, usá **No salió: enviar por WhatsApp**. Desde "Pedidos del turno" podés reimprimir o reenviar.
- **Anular** un pedido exige un motivo y queda registrado. **Entregado** marca la entrega.
- **Salida de efectivo**: plata que sale de la caja durante el turno (hielo, retiro…).
- **Cerrar caja**: se cuenta el efectivo; el sistema muestra lo esperado y la diferencia, y vuelca las ventas al
  **Flujo de caja** (un ingreso "Ventas" por medio de pago, en el día operativo).
- Sin internet aparece una franja roja: anotá en papel y cargá cuando vuelva (los reintentos no duplican pedidos).

### Día operativo
Lo vendido antes de la **hora de corte** (por defecto 06:00) cuenta para el día anterior: un local que cierra
pasada la medianoche vende "el día de ayer".

### Historial y correcciones
**Ventas → Historial de turnos** muestra cada cierre con su resumen y pedidos. Un **ADMIN** puede **reabrir** un
turno (con motivo) para corregirlo: los ingresos que se habían volcado al Flujo de caja se dan de baja y se
generan de nuevo al cerrar. Los movimientos que genera un cierre no se editan ni borran desde el Flujo de caja.

### Impresora
Instalá la térmica como impresora del equipo (cualquier modelo de 58 u 80 mm).
1. En **Ventas → Configuración** elegí el ancho del papel y tocá **Imprimir ticket de prueba**.
2. En el diálogo de imprimir elegí la térmica, **Márgenes: Ninguno** y **Escala: 100 %**. En las preferencias del
   driver de la impresora, el papel debe ser el **rollo de 58 u 80 mm** (no A4).
3. El ticket se arma con el ancho y el largo justos del contenido; si sale una tira larga o en blanco, revisá el
   tamaño de papel del driver.
4. Para que imprima **sin mostrar el diálogo**, abrí Chrome con `--kiosk-printing` (acceso directo →
   Propiedades → Destino: agregar `--kiosk-printing`).

## 6. Configuración

### 6.1 Empresa
Editás el **nombre**, CUIT y la **preferencia de costeo** (con IVA). Solo un
**ADMIN** puede modificarlo.

### 6.2 Usuarios y roles
Lista de usuarios de la empresa. Un **ADMIN** puede cambiar el **rol** y
**activar/desactivar** a cada uno. Un usuario desactivado no puede entrar ni ver datos.

| Rol | Qué puede hacer |
|---|---|
| `ADMIN` | Todo, incluida la configuración, usuarios y auditoría. |
| `GERENTE` | Operar todos los módulos (facturas, pagos, costos, RRHH); no administra usuarios ni empresa. |
| `COCINA` | Costos y recetas (insumos, platos); no ve pagos ni facturas. |
| `AUDITOR` | Solo lectura. |
| `CAJERO` | Caja y cobros (se usará desde las fases de Ventas). |

**Agregar un usuario:** 1) crealo en Supabase (Authentication → Users);
2) en *Configuración → Usuarios* tocá **+ Agregar usuario**, poné su email y rol.
Queda vinculado a tu empresa. Un ADMIN no puede quedarse sin otro ADMIN activo.

### 6.2b Zona horaria, condición fiscal y auditoría
En *Empresa* se define la **zona horaria** (las fechas "de hoy" se calculan en esa
zona, no en UTC) y la **condición fiscal** (monotributo, responsable inscripto…).
La pantalla **Auditoría** (solo ADMIN) muestra quién cambió roles, usuarios y datos sensibles.

### 6.2c Módulos de tu plan
En *Empresa* se ven los **módulos activos** de tu plan (solo lectura). Un módulo
apagado no aparece en el menú. Para cambiar de plan, contactá a tu proveedor del sistema.

### 6.3 Catálogos
Administrás las opciones de los desplegables: **rubros, sectores, unidades de
rendimiento y categorías de caja** (ingreso/egreso). Podés **agregar** y
**quitar** las que agregaste (las de fábrica no se borran).

---

## 7. Conceptos clave (glosario)

- **Unidad base:** todo se guarda por **gramo (g)**, **mililitro (ml)** o
  **unidad (un)**. Evita errores al comprar en kg y usar en g.
- **Factor de corrección:** rendimiento del insumo tras limpieza/desposte.
  `1` = sin pérdida; `0,78` = queda 78 % útil (encarece el gramo usable).
- **Food cost %:** cuánto del precio de venta se lo lleva el costo del plato.
  Cuanto **más bajo, mejor**. Referencia habitual: mantenerlo ≤ 30–35 %.
- **Margen:** precio de venta − costo del plato.
- **FIFO:** al pagar, se cancelan primero las facturas **más antiguas**.
- **Contraasiento (anulación):** en vez de borrar un pago, se genera uno
  inverso que revierte todo. Así los saldos siempre cierran.
- **Efectivo vs. en cuenta (agenda/caja):** efectivo = plata en mano;
  en cuenta = transferencias, cheques, e-Cheq (dinero bancario).

---

## 8. Preguntas frecuentes

**¿Por qué el food cost de un plato cambió solo?**
Porque actualizaste el costo de un insumo que usa (por factura o a mano) y las
recetas se **recalculan automáticamente**.

**Cargué un pago de más, ¿qué pasa?**
El excedente queda como **saldo a favor** del proveedor (deuda negativa) y la
app te avisa.

**Me equivoqué en un pago.**
No se edita ni se borra: se **anula** (contraasiento) desde el historial de
pagos o la ficha del proveedor.

**¿Puedo recuperar una opción que borré de un catálogo?**
Volvés a escribirla en cualquier combo y se guarda de nuevo.

**Agregué un usuario en Supabase pero no puede cambiar nada.**
Un ADMIN tiene que asignarle el rol correcto en **Configuración → Usuarios y
roles**.

**Los importes, ¿con o sin IVA?**
En **facturas** se guarda el desglose (neto/IVA/total). El **costeo** de la app
usa el **precio final con IVA** (según la configuración de la empresa).
