# Plan — Pedidos web (módulo `pedidos_web`)

Canal de pedidos online para cualquier negocio de la plataforma: el cliente entra al **link público**
del local, arma su pedido y le llega a la caja, que lo confirma (recién ahí se imprime la comanda) y lo
lleva por estados hasta que se entrega o se retira. El primer cliente es **Mantecados**, que hoy usa
"Resto Simple" solo para esto.

> Estado: **plan para aprobar**. No hay código todavía. Las etapas se entregan y se prueban por separado.

---

## 1. Reglas de negocio (acordadas)

1. **El link está abierto solo con la caja abierta.** Se abre un turno → el link recibe pedidos; se cierra
   el turno → el link queda bloqueado ("Estamos cerrados"). No hay horarios aparte.
2. **Con caja abierta**, la cajera puede **pausar** los pedidos y **activar o desactivar por separado el
   retiro (take away) y el delivery** (puede trabajar solo con uno de los dos).
3. **No hay pasarela de pago.** El cliente elige *efectivo* (al retirar o al recibir) o *transferencia* (la
   página le muestra el alias y el monto). La cajera resuelve el cobro, y **el pago es independiente del
   estado del pedido**: todo pedido empieza **sin abonar** y la cajera lo marca **abonado** cuando la plata
   realmente entró (ver sección 2b). Un pedido puede estar confirmado y en viaje y seguir sin abonar.
4. **No se imprime nada hasta que la cajera confirma.** Un pedido recién llegado está "entrado" y solo suena
   y aparece en la bandeja.
5. **Carta online = la carta de venta** (todo lo que tiene `vende_en_mostrador`), con la posibilidad de
   **ocultar productos solo del canal online** (sin sacarlos del mostrador) y marcarlos agotados.
6. **Delivery con zonas dibujadas en un mapa**, cada una con su precio. El cliente escribe su dirección, elige
   una sugerencia y el sistema valida que esté dentro de una zona y suma el envío. **Fuera de zona se
   bloquea** el delivery (puede pedir retiro).
7. Los precios y el costo de envío **siempre se calculan en el servidor**.

## 2. Estados del pedido

| Estado | Quién lo mueve | Qué pasa |
|---|---|---|
| `entrado` | el cliente (al enviar) | Llega a la bandeja con sonido. No se imprime. |
| `confirmado` | cajera | **Se imprime la comanda** y se crea el pedido del mostrador en el turno abierto (caja, cierre, reportes). |
| `en_preparacion` | cajera | — |
| `listo_retiro` | cajera (solo retiro) | Aviso al cliente de que ya puede pasar. |
| `en_viaje` | cajera (solo delivery) | — |
| `finalizado` | cajera | Retirado / entregado. **Exige que esté abonado** (si no, se cobra en el mismo paso). Marca el pedido del mostrador como entregado. |
| `rechazado` | cajera (desde `entrado`) | Con motivo. No genera pedido ni impresión. |
| `cancelado` | cajera (desde `confirmado` en adelante) | Con motivo. Anula el pedido del mostrador. |

Transiciones válidas: `entrado → confirmado | rechazado` · `confirmado → en_preparacion | cancelado` ·
`en_preparacion → listo_retiro (retiro) | en_viaje (delivery) | cancelado` ·
`listo_retiro | en_viaje → finalizado | cancelado`. Cada cambio queda en un historial con hora y usuario.

**Al cerrar la caja:** los pedidos `entrado` se rechazan solos ("el local cerró") y, si quedan pedidos
`confirmado/en_preparacion/en_viaje/listo_retiro`, el cierre avisa y pide finalizarlos o cancelarlos.
**Tampoco se puede cerrar la caja con pedidos sin abonar** (ver 2b).

### 2b. Pago: abonado / sin abonar

El pago es un dato aparte del estado, con dos valores: **`sin_abonar`** y **`abonado`**.

| Caso | Cuándo se marca *abonado* |
|---|---|
| **Transferencia** | Cuando la cajera ve la plata en su banco. Puede ser **antes o después de confirmar**. |
| **Efectivo con retiro** | Cuando el cliente paga al retirar. |
| **Efectivo con delivery** | Cuando vuelve el repartidor con la plata, es decir, al **finalizar** el pedido. Mientras está **en viaje**, sigue sin abonar. |

Reglas:
- Se puede **confirmar y mover un pedido sin abonar**: lo que exige confirmación es el reparto, no el pago.
- La cajera elige **con qué medio se cobró realmente** al marcarlo abonado (el cliente pudo decir "efectivo" y
  pagar por transferencia). Por defecto se propone el que eligió el cliente.
- **No se puede finalizar un pedido sin abonar**: al finalizar, la pantalla pide cobrarlo en el mismo paso
  ("¿Cuánto y cómo se cobró?").
- **La plata entra a la caja recién al marcar abonado.** Un pedido sin abonar no suma efectivo esperado ni ingresos
  del Flujo de caja; al cobrarlo, sí, en el turno abierto.
- **No se puede cerrar la caja** mientras haya pedidos confirmados sin abonar: el cierre lista cuáles son para
  cobrarlos o cancelarlos (así el efectivo esperado y el cierre nunca quedan inflados).
- Si un pedido sin abonar se **cancela**, no hay nada que devolver ni anular en la caja. Si ya estaba abonado, se
  anula como cualquier pedido del mostrador.
- La **comanda** impresa lo deja a la vista: **"A COBRAR $X EN EFECTIVO"** (para que el repartidor sepa que tiene que
  cobrar), **"TRANSFERENCIA: VERIFICAR"** o **"ABONADO"**.

## 3. Modelo de datos (`supabase/f6_pedidos_web.sql`)

**`empresas`** (columnas nuevas, se escriben solo por RPC auditada): `web_slug` (único, minúsculas y guiones),
`web_nombre_publico`, `web_mensaje`, `web_pausado` (bool), `web_retiro` (bool), `web_delivery` (bool),
`web_demora_retiro_min`, `web_demora_delivery_min`, `web_pedido_minimo_centavos`, `web_pedido_maximo_centavos`.
El costo de envío único usa el `costo_envio_default_centavos` que ya existe (Etapa 1A); en 1B lo reemplazan las zonas.

**`pedidos`** (mostrador): columna nueva **`pago_estado`** (`abonado` por defecto, así el mostrador sigue igual) que
toma `sin_abonar` para los pedidos web hasta que se cobran.

**`recetas`**: `oculto_online` (bool, por defecto false) y `agotado_online` (bool).

**`pedidos_web`**: empresa, `numero_web`, `token_seguimiento` (aleatorio de 128 bits), estado, modalidad
(`retiro|delivery`), datos del cliente (nombre, teléfono, email opcional), dirección (texto, `lat`, `lng`, `zona_id`),
nota, `medio_pago` (el que **eligió** el cliente: `efectivo|transferencia`), **`pago_estado`** (`sin_abonar|abonado`),
`medio_cobro` y `abonado_en` (cómo y cuándo se cobró de verdad), `subtotal`, `envio`, `total` (centavos, calculados por el servidor),
`pedido_id` (el pedido del mostrador una vez confirmado), `motivo`, marcas de tiempo.
**`pedidos_web_items`**: producto, nombre y precio congelados, cantidad, nota, adicionales (mismo modelo del mostrador).
**`pedidos_web_eventos`**: historial de estados (estado, usuario, hora).
**`zonas_delivery`** (1B): nombre, `poligono` (GeoJSON), precio de envío, orden, activa.
**`web_bloqueos`**: teléfonos bloqueados por empresa.

RLS: nadie del público toca tablas. `authenticated` lee `pedidos_web*` de su empresa (roles ADMIN, GERENTE, CAJERO)
y **escribe solo por RPC**.

## 4. API

**Pública (rol `anon`, solo estas funciones, todas `SECURITY DEFINER` y validadas):**

| RPC | Hace |
|---|---|
| `web_negocio(slug)` | Nombre, mensaje, si está **abierto** (turno abierto y no pausado), qué modalidades acepta, demoras, mínimo y alias (solo se muestra al elegir transferencia). |
| `web_carta(slug)` | Productos visibles online por categoría, con adicionales, precios y agotados. Sin costos ni márgenes. |
| `web_cotizar_envio(slug, lat, lng)` | (1B) Zona y precio de envío, o "fuera de zona". |
| `web_crear_pedido(slug, datos, items, client_uuid)` | Valida todo, **recalcula precios**, aplica los límites anti-abuso y devuelve `token` y número. Idempotente por `client_uuid`. |
| `web_seguimiento(token)` | Estado actual, demora estimada y resumen del pedido (solo ese pedido). |

**Interna (`authenticated`):** `confirmar_pedido_web(id)`, `cambiar_estado_pedido_web(id, estado, motivo)`,
`rechazar_pedido_web(id, motivo)`, `set_config_web(clave, valor)` (ADMIN, auditada), `web_bloquear_telefono(...)`,
`set_disponibilidad_online(receta, oculto, agotado)`, `guardar_zonas_delivery(...)` (1B).

`confirmar_pedido_web` arma los datos y llama a **`crear_pedido`** del mostrador (mismo turno, misma numeración,
mismos totales). Si los precios de la carta cambiaron mientras el pedido esperaba, **no confirma** y avisa a la
cajera para que lo revise o lo rechace.

**Cobro (cambios en el módulo de ventas):**
- `crear_pedido` acepta crear un pedido **sin pagos** cuando viene marcado `pago_pendiente` (solo lo usa la confirmación
  web); el del mostrador sigue exigiendo que los pagos sumen el total.
- Nueva **`registrar_cobro_pedido(pedido, medio)`**: inserta el pago por el total, pone `pago_estado = abonado` (en el
  pedido y en `pedidos_web`) y deja auditoría. Solo con el turno abierto. También la usa "finalizar" cuando el pedido
  está sin abonar.
- **`cerrar_turno`** se rechaza si hay pedidos no anulados con `pago_estado = sin_abonar` (y dice cuáles).
- `resumen_turno` y el cierre **no cambian de criterio**: siguen sumando `pedido_pagos`, que solo existen cuando se
  cobró. Por eso el efectivo esperado y el Flujo de caja salen bien sin tocar nada más.

## 5. Seguridad y anti-abuso

- Sin servidor propio **no se puede bloquear por IP**. Se defiende en la base: tope de ítems por pedido,
  cantidades máximas, monto mínimo y máximo, **máximo 2 pedidos `entrado` por teléfono**, espera mínima entre
  pedidos del mismo teléfono, **tope de pedidos `entrado` simultáneos por negocio**, campo trampa (honeypot),
  longitudes máximas y bloqueo de teléfonos desde la bandeja.
- Los datos del cliente solo los ve la empresa; el seguimiento por `token` solo devuelve ese pedido.
- Auditoría de cambios de configuración (alias, zonas, apertura de modalidades).
- Límite conocido: un atacante decidido puede llenar la bandeja de pedidos falsos; por eso **nada se imprime ni se
  descuenta hasta que la cajera confirma**. Una etapa posterior puede sumar un captcha (Cloudflare Turnstile) con una
  Edge Function de Supabase.

## 6. Pantallas

**Página pública `pedir.html?n=<slug>`** (sin login, pensada para celular): carta por categorías con buscador, carrito,
checkout (retiro/delivery, datos, dirección con sugerencias, medio de pago, nota), confirmación y **seguimiento por
link** que se actualiza solo. Cartel "Estamos cerrados / pausado" cuando corresponde.

**En la app (solo con el módulo activo):**
- **Pedidos web → Bandeja:** tablero por estado, con una etiqueta **"Sin abonar" / "Abonado"** en cada pedido y el botón
  **"Marcar abonado"** (elige el medio), **sonido** y contador al llegar un pedido, botones de avance, indicador
  **"Recibiendo pedidos / Desconectado"**, atajos para **pausar** y para activar/desactivar **retiro y delivery**,
  mensaje de WhatsApp prearmado para avisar al cliente.
- **Pedidos web → Configuración:** link del negocio y QR, nombre público, mensaje, demoras, pedido mínimo, modalidades.
- **Carta:** columna "Visible online" y "Agotado" por producto.
- **Impresión:** al **confirmar** se imprime con el mismo motor del mostrador (formato Texto/Imagen, relleno, ancho).
  Se agrega "WEB", modalidad, dirección, teléfono y el estado del pago (**A COBRAR / ABONADO**).

Tiempo real: **Supabase Realtime** sobre `pedidos_web` y, si se corta, reintento automático cada 8 segundos.
Requisito operativo: la app abierta en la PC de caja durante el turno, con el Chrome ya configurado para imprimir
sin diálogo.

## 7. Mapas y direcciones (Etapa 1B)

- **Editor de zonas:** Leaflet + OpenStreetMap con dibujo de polígonos; cada zona lleva nombre, precio y orden.
  Si dos zonas se superponen, gana la de menor orden.
- **Validación:** la zona se calcula **en la base** (punto dentro del polígono) a partir de la latitud/longitud de la
  dirección elegida; el navegador solo muestra el resultado.
- **Autocompletado de direcciones:** detrás de un módulo único (`geocoder.js`) para poder cambiar de proveedor sin
  tocar el resto. Opciones: Geoapify o LocationIQ (plan gratuito, clave restringida al dominio) o Google Places
  (mejor calidad en Argentina, con costo). El servicio público de OpenStreetMap (Nominatim) **no permite**
  autocompletar. **Decisión pendiente** (ver abajo).
- Mapa de fondo de OpenStreetMap para empezar; con volumen alto conviene pasar a un proveedor de teselas.

## 8. Etapas, entregas y pruebas

| Etapa | Entrega | Pruebas |
|---|---|---|
| **1A.1** Base | Tablas, RLS, RPC públicas e internas, estados, anti-abuso | Tests SQL: permisos por rol, `anon` solo ve lo público, precios recalculados, transiciones válidas, límites, confirmar crea el pedido del mostrador, cambio de precios, cierre de caja, **pago: sin abonar no suma a la caja, abonar al final, finalizar exige cobro, cierre bloqueado con pedidos sin abonar, cancelar sin abonar** |
| **1A.2** App | Bandeja con sonido, configuración, disponibilidad online, impresión al confirmar | Pruebas en navegador con Supabase simulado; tests Node de la lógica |
| **1A.3** Página pública | `pedir.html`: carta, carrito, checkout, seguimiento | Navegador móvil (viewport chico), casos cerrado/pausado/sin delivery |
| **1B** Zonas | Editor de mapa, autocompletado, cotización de envío en el servidor | Tests SQL del punto-en-polígono (bordes, superpuestas, fuera de zona) y pruebas de pantalla |
| **2** | Seguimiento enriquecido, estadísticas, cupones, QR, dominio propio | A definir |

Cada etapa va en su PR; las que tocan la base traen su `.sql`, que se corre **una vez** en el SQL Editor antes de
mergear. El módulo se activa por empresa desde el SQL Editor (`modulos`), como el resto.

## 9. Decisiones pendientes

1. **Proveedor de direcciones** para 1B: Geoapify / LocationIQ (gratis, buena para empezar) o Google Places (mejor
   en Argentina, con costo). Propuesta: arrancar gratis detrás de `geocoder.js`.
2. **Link definitivo:** `https://romeromartin.github.io/Proyecto-SaaS-Gastronomico/pedir.html?n=mantecados` al
   principio; dominio propio más adelante.
3. **Límites iniciales** (ajustables): pedido máximo, 2 pedidos `entrado` por teléfono, 30 `entrado` simultáneos.
