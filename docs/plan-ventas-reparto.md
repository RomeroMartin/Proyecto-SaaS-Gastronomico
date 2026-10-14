# Plan de implementación — Base segura, Ventas, Rentabilidad real y Reparto de ingresos

> **Para Claude Code.** Este documento es la hoja de ruta para sumar al SaaS
> Gastronómico los módulos de **Ventas (mostrador)**, **Rentabilidad real** y
> **Tablero de reparto**, **precedidos por una fase de blindaje** que la
> revisión del repo mostró imprescindible.
>
> Es una **versión revisada** del plan original. Cambios respecto del original:
> se agrega la **Fase 0** (seguridad, fechas, integridad, costeo en SQL), se
> corrigen cuentas y supuestos (efectivo esperado, aguinaldo, costos variables)
> y todo se redactó **genérico**: nada depende de un cliente.
>
> **Cómo trabajar:** una fase por vez, en orden. Al cerrar cada fase:
> `npm test` en verde, tests SQL en verde, `docs/manual.md` y `README.md`
> actualizados, y la lista de SQL a correr en Supabase **en orden**.
>
> Estado: ☐ pendiente. Marcá las casillas a medida que se cierre cada ítem.

---

## Índice

0. [Contexto y principios](#0-contexto-y-principios)
1. [Hallazgos de la revisión (verificados)](#1-hallazgos-de-la-revisión-verificados)
2. [Cómo probar el SQL sin tocar producción](#2-cómo-probar-el-sql-sin-tocar-producción)
3. [Fase 0 — Base segura](#fase-0--base-segura-bloquea-todo-lo-demás)
4. [Fase 1 — Módulos activables y configuración de empresa](#fase-1--módulos-activables-y-configuración-de-empresa)
5. [Fase 2 — Ventas (mostrador)](#fase-2--ventas-mostrador)
6. [Fase 3 — Rentabilidad real](#fase-3--rentabilidad-real-ventas--costo)
7. [Fase 4 — Tablero de reparto](#fase-4--tablero-de-reparto-apartados)
8. [Fase 5 — Puesta en marcha de un cliente](#fase-5--puesta-en-marcha-de-un-cliente)
9. [Fase 6 — Backlog de producto](#fase-6--backlog-de-producto)
10. [Matriz de roles](#matriz-de-roles-propuesta-por-defecto)
11. [Orden de los scripts SQL](#orden-de-los-scripts-sql)
12. [Decisiones abiertas](#decisiones-abiertas)
13. [Estimación](#estimación-y-orden)

---

## 0. Contexto y principios

### Origen del pedido

El primer cliente que motivó estos cambios es **Mantecados** (hamburguesería de
La Plata, **monotributista**, abre de 19:30 a 23:30 y a veces cierra pasada la
medianoche). Pidió:

1. **Módulos activables por empresa.**
2. **Módulo Ventas (mostrador):** armar el pedido desde la carta, cobrar en
   efectivo o transferencia, número correlativo, y que al **cerrar la caja** los
   totales pasen **solos** al Flujo de caja. Sin salón, sin mesas, sin
   facturación electrónica.
3. **Rentabilidad real:** food cost de lo efectivamente vendido.
4. **Tablero de reparto ("apartados"):** cuánto de lo que entra hay que separar
   para alquiler, sueldos, servicios, proveedores, etc., y cómo viene el mes
   contra el punto de equilibrio.

### Principio rector: se diseña un producto, no un cliente

> **Mantecados es el eslabón que motivó los cambios, no la especificación.**
> Todo lo que sea particular de un negocio es **configuración por empresa**,
> nunca código.

Consecuencias prácticas:

- Nada de nombres, alias, horarios, categorías ni medios de pago escritos en el
  código. Todo vive en la empresa (`empresas`) o en catálogos.
- Los defaults sirven para un local común; el cliente los ajusta.
- Cada fase se prueba con **dos perfiles ficticios distintos** (ej.: un local de
  mostrador monotributista que cierra de madrugada, y un restaurante con
  mozos, responsable inscripto y sin ventas cargadas en el sistema). Si una
  pantalla solo funciona para uno, está mal diseñada.
- Lo que hoy no se necesita pero es predecible (pago dividido, IVA, sucursales)
  se **deja el modelo listo**, aunque la pantalla llegue después.

### Parámetros por empresa (resumen)

| Parámetro | Dónde | Default | Fase |
|---|---|---|---|
| `zona_horaria` | `empresas` | `America/Argentina/Buenos_Aires` | 0 |
| `condicion_fiscal` | `empresas` | `monotributo` | 0 / 6 |
| `modulos` | `empresas` | los que ya tenía | 1 |
| `alias_transferencia`, `whatsapp_cocina`, `costo_envio_default_centavos` | `empresas` | vacío / 0 | 2 |
| `hora_corte_dia` | `empresas` | `06:00` | 2 |
| `medios_pago_habilitados` | `empresas` | `{efectivo,transferencia}` | 2 |
| `cmv_objetivo_pct`, `costos_variables_pct`, `dias_operativos_mes` | `empresas` | 35 / 0 / 30 | 4 |
| `cargas_sociales_pct`, `provisionar_aguinaldo` | `empresas` | 0 / true | 4 |
| `categorias_venta` | `empresas` | `{Ventas,Ventas tarjeta,Ventas QR}` | 4 |

### Reglas de oro del proyecto (siguen vigentes)

- Dinero = **entero en centavos** (`bigint`). Nunca float. Usar `core/dinero.js`.
- Toda tabla de negocio lleva `empresa_id` + **RLS** con `mi_empresa()`.
- **No se edita, se anula.** Nada se borra físicamente (`activo` / `estado`).
  Excepciones documentadas: catálogos de configuración.
- Operaciones multi-tabla → **función RPC en PostgreSQL** (transacción).
- Capas: `core/` (lógica pura, testeada, sin DOM ni Supabase) · `data/`
  (repos, sin DOM) · `ui/` (DOM, no calcula).
- Scripts SQL **idempotentes** (`if not exists`, `create or replace`), en
  archivos nuevos dentro de `supabase/`, uno por tema, con cabecera que diga
  en qué orden se ejecutan.
- El stack sigue siendo **100 % frontend**: HTML + CSS + JS vanilla (módulos
  ES) sobre Supabase. No agregar backend propio ni frameworks.

### Reglas nuevas (surgen de la revisión)

- **R1. La seguridad vive en la base.** El gating de la UI es cosmético; la
  barrera real son RLS, permisos por columna y chequeo de rol dentro de cada
  RPC. Ninguna pantalla nueva se entrega sin su política por rol.
- **R2. Las fechas de negocio se calculan en la zona horaria de la empresa.**
  Prohibido `current_date` / `now()::date` en lógica de negocio (la base corre
  en UTC y entre las 21:00 y las 24:00 de Argentina "hoy" ya es mañana).
- **R3. Una sola fuente de verdad para los costos:** SQL. El JS solo muestra
  vistas previas en vivo y tiene tests de paridad contra SQL.
- **R4. Todo SQL nuevo se ejecuta contra un PostgreSQL real antes de
  entregarlo** (ver §2) y trae sus tests.
- **R5. Lo sensible se audita:** cambios de alias de cobro, roles, módulos,
  anulaciones y reaperturas dejan rastro en `auditoria`.
- **R6. Operaciones repetibles son idempotentes:** una red que reintenta no
  puede duplicar un pedido ni un cierre (`client_uuid`, índices únicos).

### Archivos existentes que se van a tocar o usar

| Archivo | Para qué |
|---|---|
| `js/saas/ui/app.js` | `MENU` (módulos → submódulos), gating por rol y por módulo |
| `js/saas/auth.js` | `miPerfil()`: sumar `modulos`, `zona_horaria`, rechazar inactivos |
| `supabase/schema.sql` | `empresas`, `usuarios`, `recetas`, `ingredientes_receta`, `mi_empresa()`, `mi_rol()` |
| `supabase/functions.sql` | RPC de facturas y pagos (`registrar_pago`, `anular_pago`, …) |
| `supabase/movimientos_caja.sql` | Flujo de caja |
| `supabase/pagos_programados.sql` | Agenda de pagos a proveedores |
| `supabase/rrhh.sql` | RRHH: sueldos, legajo, `vw_sueldo_vigente`, patrón de RLS por rol |
| `js/saas/ui/caja.js` + `data/movimientosCajaRepo.js` | Pantalla y repo del Flujo de caja |
| `js/saas/ui/carta.js`, `rentabilidad.js`, `recetas.js` | Carta, rentabilidad teórica, editor de recetas |
| `js/saas/data/recetasRepo.js`, `insumosRepo.js` | Hoy hacen escrituras multi-paso desde el navegador |
| `js/core/costeo.js`, `core/utilsFecha.js`, `core/dinero.js` | Lógica pura |
| `js/saas/ui/helpers.js` | `toast`, `confirmar`, `kpiHTML`, `labelInfo`, … |
| `index.html` | CSS global (hoy `main-inner` 960 px y botones de ~35 px) |

---

## 1. Hallazgos de la revisión (verificados)

La revisión leyó el 100 % del repo y **ejecutó todos los SQL en un PostgreSQL 16
local** con un esquema `auth` simulado. Todos los scripts corren sin errores y
los 43 tests pasan. Lo siguiente **se reprodujo** (ver §2 para repetirlo):

| ID | Hallazgo | Gravedad | Se corrige en |
|---|---|---|---|
| H1 | **Cualquier rol modifica la empresa** (`tenant_all` sobre `empresas`). Un usuario `COCINA` pudo renombrarla. Ahí se va a guardar el alias de cobro y los módulos. | Alta | 0.2 |
| H2 | **`AUDITOR` no es solo lectura:** pudo crear una factura por RPC y editar un proveedor. Los roles son decorativos fuera de RRHH. | Alta | 0.1 |
| H3 | **`usuarios.activo` no se aplica:** un usuario inactivo sigue leyendo todos los datos. | Alta | 0.3 |
| H4 | **Fechas en UTC:** `registrar_pago` y `anular_pago` usan `current_date`; `TimeZone = Etc/UTC`. A las 22:30 de Argentina la fecha es la del día siguiente. Lo mismo en las vistas de RRHH (`vw_sueldo_vigente`, `vw_documentos_estado`) y `dias_vacaciones`. | Alta | 0.4 |
| H5 | **Guardar una receta no es atómico:** `recetasRepo.actualizar` borra y reinserta ingredientes desde el navegador; si falla en el medio, la receta queda vacía. Igual `insumosRepo` (update + historial separados). | Media | 0.6 |
| H6 | **Se puede anular el contraasiento de un pago** llamando a la RPC con su id: deja la contabilidad incoherente (el original figura "anulado" pero su efecto vuelve a contar). La UI no lo ofrece. | Media | 0.5 |
| H7 | **El costo de las recetas se calcula en el navegador** y se guarda como snapshot (`costo_calculado_centavos`). Puede quedar viejo, y el plan lo usa como costo al momento de la venta. | Media | 0.7 |
| H8 | **Borrados físicos** en caja, documentos y ausencias (regla "nada se borra"). | Media | 0.5 / 2 |
| H9 | **Librerías externas sin versión fija:** `supabase-js@2` por jsDelivr sin SRI y SheetJS 0.18.5 (vieja). La app maneja plata y sueldos. | Media | 0.9 |
| H10 | Sin CI: `npm test` no corre en los PR; el SQL no tiene tests; todo merge a `main` es producción. | Media | 0.8 / 5 |
| H11 | `empresas.costea_con_iva` es un toggle que **no hace nada** (la propia pantalla lo aclara). | Baja | 6 (política fiscal) |
| H12 | `porcentaje_merma` en `ingredientes_receta` nunca se usa en el costeo. | Baja | 0.7 |
| H13 | `hoyStr()/addDias()/fmt()` copiados en `caja.js`, `agenda.js`, `resumenes.js`, `proveedores.js`; usan la hora del navegador. | Baja | 0.4 |
| H14 | `siguienteCodigo()` (insumos, recetas, proveedores) lee y luego inserta: dos altas simultáneas pueden repetir el código. | Baja | 0.6 |
| H15 | `app.js:224` inserta `err.message` sin escapar. | Baja | 0.9 |
| H16 | El costo por unidad base se guarda en **centavos enteros**: insumos baratos por gramo/ml pierden precisión (ej. $125/kg = 12,5 ¢/g → 13 ¢, 4 % de error). | Baja | 0.7 |
| H17 | Crear usuarios es un hueco: la pantalla dice "agregalo en Supabase → Authentication", pero esa cuenta **no queda vinculada a ninguna empresa** (no hay RPC ni UI). | Alta para Ventas | 0.3 |

**Lo que está bien y se conserva:** el aislamiento entre empresas por RLS
(verificado: un usuario de otra empresa ve 0 filas y recibe "Factura
inexistente"), la separación `core/data/ui`, las RPC de saldos, `editar_factura`
(probada con y sin pagos), y el patrón de RLS por rol de `rrhh.sql`.

---

## 2. Cómo probar el SQL sin tocar producción

> **Estado de validación de este documento.** Los bloques SQL de este plan
> (mock de Supabase, `rol_en`, políticas por rol, permisos por columna en
> `empresas`, `mi_empresa()` con usuarios activos, constraint de roles con
> `CAJERO`, `hoy_empresa()`, `auditoria`, `turnos_caja`/`pedidos`/
> `pedido_pagos`/`pedido_items` y `gastos_fijos`) se **ejecutaron sin errores
> en PostgreSQL 16** sobre el esquema real del repo, y se comprobó que las
> restricciones nuevas (turno abierto único, `client_uuid` único, descuento ≤
> subtotal, número único por turno, medios válidos) rechazan lo que deben.
> Las funciones RPC descriptas en prosa (`crear_pedido`, `cerrar_turno`,
> `gasto_empleados_mensual`, etc.) **todavía no están escritas**: se
> implementan y prueban en su fase.

Regla R4. Se usa un PostgreSQL local (Docker o el del sistema) con un
**Supabase simulado**. Guardar esto como `supabase/tests/00_mock_supabase.sql`:

```sql
-- Simula lo mínimo de Supabase para ejecutar y probar los scripts del repo.
create role anon nologin;
create role authenticated nologin;

create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[]
  language sql as $$ select string_to_array(name, '/') $$;

grant usage on schema public, auth to authenticated, anon;
alter default privileges in schema public grant all on tables to authenticated;
alter default privileges in schema public grant all on functions to authenticated;
```

**Cómo se simula un usuario** dentro de un test:

```sql
set role authenticated;
select set_config('request.jwt.claim.sub', '<uuid del usuario>', false);
-- ... consultas como ese usuario ...
reset role;
```

**Estructura de tests SQL** (`supabase/tests/`):

```
00_mock_supabase.sql      -- lo de arriba
01_datos_base.sql         -- 2 empresas, 1 usuario por rol, 1 inactivo
10_roles_rls.sql          -- matriz de roles (Fase 0.1)
11_empresas_columnas.sql  -- permisos por columna (0.2)
12_usuarios_inactivos.sql -- (0.3)
13_fechas_zona.sql        -- (0.4)
14_integridad_pagos.sql   -- (0.5)
...                       -- un archivo por fase
run.sh                    -- crea una DB limpia, corre schema+funciones+tests
```

Cada test **imprime `OK`/`FALLA`** (o usa `do $$ … assert … $$`) y `run.sh`
termina con código ≠ 0 si algo falla.

Ejecución manual local (Ubuntu): `initdb`, levantar en otro puerto, crear la
base, correr `00_mock_supabase.sql`, los `supabase/*.sql` en el orden de §11 y
después los tests. En CI se usa un *service container* de PostgreSQL (ver 0.8).

---

## Fase 0 — Base segura (bloquea todo lo demás)

**Objetivo:** que el producto resista a un usuario de bajo privilegio con
acceso real a la base (un cajero, un auditor, alguien desvinculado) y que las
fechas y los costos sean confiables. **Ninguna fase posterior se da por
terminada si Fase 0 no está cerrada.**

> Compatibilidad: todo debe dejar a las empresas actuales funcionando igual.
> Los roles existentes (`ADMIN`, `GERENTE`, `COCINA`, `AUDITOR`) mantienen su
> uso actual salvo donde se indica restricción explícita.

### 0.1 Roles y RLS reales  ☐

**Problema (H2):** `tenant_all` deja leer y escribir todo a cualquier rol de la
empresa; las RPC (`crear_factura`, `registrar_pago`, …) tampoco chequean rol.

**Qué hacer:**

1. Crear helpers en `supabase/f0_roles_rls.sql`:
   ```sql
   create or replace function rol_en(variadic p_roles text[])
   returns boolean language sql stable security definer set search_path = public as $$
     select coalesce(mi_rol() = any(p_roles), false) $$;
   ```
2. Reemplazar `tenant_all` por políticas **separadas** de lectura y escritura
   según la [matriz de roles](#matriz-de-roles-propuesta-por-defecto). Patrón:
   ```sql
   -- lectura
   create policy leer on facturas for select to authenticated
     using (empresa_id = mi_empresa() and rol_en('ADMIN','GERENTE','AUDITOR'));
   -- escritura
   create policy escribir on facturas for all to authenticated
     using (empresa_id = mi_empresa() and rol_en('ADMIN','GERENTE'))
     with check (empresa_id = mi_empresa() and rol_en('ADMIN','GERENTE'));
   ```
   Generarlas con un `DO $$ … foreach t in array … $$` como ya hace
   `schema.sql`, tabla por tabla, a partir de la matriz.
3. **Chequear el rol dentro de cada RPC** existente (`crear_factura`,
   `editar_factura`, `anular_factura`, `registrar_pago`, `anular_pago`):
   `if not rol_en('ADMIN','GERENTE') then raise exception 'Sin permiso.'; end if;`
4. Quitar a `CAJERO` (cuando exista, Fase 2) todo acceso directo a tablas de
   compras, costos, caja y RRHH. Su única vía de lectura son vistas/RPC
   acotadas (ver 2.4).
5. La UI (`app.js`) sigue ocultando lo que el rol no puede usar, pero ya no
   es la barrera.

**Tests (`10_roles_rls.sql`):** para cada rol y cada tabla de la matriz,
probar que lo permitido funciona y lo prohibido falla (`AUDITOR` no puede
`insert/update/delete` ni llamar RPC de escritura; `COCINA` no ve facturas ni
caja; un usuario de otra empresa ve 0 filas).

**Aceptación:**
- [ ] `AUDITOR` no puede crear facturas, pagos ni editar proveedores (hoy sí puede).
- [ ] `COCINA` no lee `facturas`, `pagos`, `movimientos_caja`.
- [ ] Un usuario sin rol permitido recibe error claro desde las RPC.
- [ ] El aislamiento entre empresas sigue intacto.

### 0.2 `empresas`: lectura general, escritura mínima  ☐

**Problema (H1):** cualquier rol puede actualizar `empresas`.

**Qué hacer:** separar la política (`select` para todos los roles de la
empresa; sin `insert/delete` desde el cliente) y limitar `update` **por
columna**. RLS por sí sola no restringe columnas; los *grants* por columna
sí (verificado en PostgreSQL 16 con el trigger de `modificado_en` activo):

```sql
revoke insert, update, delete on empresas from authenticated;
grant update (nombre, cuit_rut) on empresas to authenticated;
-- y la política de update exige rol ADMIN:
create policy empresas_update on empresas for update to authenticated
  using (id = mi_empresa() and rol_en('ADMIN'))
  with check (id = mi_empresa() and rol_en('ADMIN'));
```

Las columnas sensibles (`modulos`, `alias_transferencia`, `zona_horaria`,
`condicion_fiscal`, parámetros de reparto) **solo se cambian por RPC**
`security definer` que validan rol y escriben en `auditoria` (0.8):

- `set_config_empresa(p_clave text, p_valor jsonb)` — ADMIN; lista blanca de
  claves; valida tipos.
- `modulos`: ver Fase 1 (no hay RPC para el cliente).

**Aceptación:**
- [ ] Un `COCINA` que intenta `update empresas set nombre=…` recibe error.
- [ ] Un `ADMIN` puede cambiar `nombre` y `cuit_rut`, y **no** puede escribir
      `modulos` ni `alias_transferencia` con `update` directo (verificado).
- [ ] `empresasRepo.actualizar` sigue funcionando para nombre y CUIT.

### 0.3 Usuarios: inactivos que no entran y alta de usuarios  ☐

**Problema (H3, H17):** `mi_empresa()`/`mi_rol()` no miran `activo`; no hay
forma de vincular un usuario nuevo a una empresa.

**Qué hacer** (`supabase/f0_usuarios.sql`):

1. Redefinir `mi_empresa()` y `mi_rol()` para ignorar usuarios inactivos
   (verificado: con esto un usuario inactivo pasa a ver 0 filas):
   ```sql
   create or replace function mi_empresa() returns uuid
   language sql stable security definer set search_path = public as $$
     select empresa_id from public.usuarios where id = auth.uid() and activo $$;
   -- mi_rol() análogo.
   ```
2. `auth.js → miPerfil()`: si el usuario está inactivo, cerrar sesión y mostrar
   "Tu usuario está desactivado. Contactá al administrador."
3. Agregar `CAJERO` al `check` de roles (el nombre real es `usuarios_rol_check`):
   ```sql
   alter table usuarios drop constraint if exists usuarios_rol_check;
   alter table usuarios add constraint usuarios_rol_check
     check (rol in ('ADMIN','GERENTE','COCINA','AUDITOR','CAJERO'));
   ```
   y sumar `CAJERO` a `ROLES` en `ui/config.js`.
4. **RPC `vincular_usuario(p_email text, p_rol text, p_nombre text)`**
   (`security definer`, solo ADMIN): busca el usuario en `auth.users` por
   email, inserta en `usuarios` con la `empresa_id` del ADMIN, valida que el
   email no pertenezca ya a otra empresa. Audita.
5. **Configuración → Usuarios:** botón "Agregar usuario": pide email, nombre y
   rol; explica el paso previo ("creá la cuenta en Supabase → Authentication
   → Users y después vinculala acá"). Corregir el texto actual que sugiere que
   alcanza con crearla en Auth.
6. **Salvaguardas** (trigger o dentro de la RPC de cambio de rol/estado):
   - siempre debe quedar **al menos un ADMIN activo** por empresa;
   - un usuario no puede desactivarse a sí mismo;
   - cambios de rol/estado se auditan.
7. Mover `usuariosRepo.actualizar` a una RPC `cambiar_usuario(p_id, p_rol,
   p_activo)` para poder auditar y aplicar las salvaguardas.

**Aceptación:**
- [ ] Un usuario inactivo no ve datos y la app lo desloguea con mensaje claro.
- [ ] Un ADMIN puede vincular un usuario existente de Auth y asignarle rol.
- [ ] No se puede dejar la empresa sin ADMIN activo.
- [ ] `CAJERO` es un rol válido.

### 0.4 Fechas y zona horaria  ☐

**Problema (H4, H13):** `current_date` en UTC; helpers de fecha duplicados que
usan la hora del dispositivo.

**Qué hacer** (`supabase/f0_zona_horaria.sql`):

1. `empresas.zona_horaria text not null default 'America/Argentina/Buenos_Aires'`.
2. Función `hoy_empresa()` (referencia; **validar con test**):
   ```sql
   create or replace function hoy_empresa() returns date
   language sql stable security definer set search_path = public as $$
     select (now() at time zone coalesce(
       (select zona_horaria from empresas where id = mi_empresa()),
       'America/Argentina/Buenos_Aires'))::date $$;
   ```
3. Reemplazar `current_date` por `hoy_empresa()` en: `registrar_pago`,
   `anular_pago`, `vw_sueldo_vigente`, `vw_documentos_estado`,
   `dias_vacaciones` y cualquier otra lógica de negocio. Las vistas ya son
   `security_invoker`, así que `mi_empresa()` resuelve bien.
4. JS: concentrar en `core/utilsFecha.js` (con tests): `hoyISO(zona)`
   (usando `Intl.DateTimeFormat('en-CA', {timeZone})`), `addDias`,
   `diasEntre`. **Eliminar** las copias de `caja.js`, `agenda.js`,
   `resumenes.js`, `proveedores.js` y usar las del core con la zona de
   `perfil.empresa.zona_horaria`.
5. Test con instantes simulados: 2026-10-14 01:30 UTC debe dar **13/10** en
   Buenos Aires y 14/10 en UTC (verificado).
6. La **fecha operativa** (turnos de madrugada) se define en Fase 2.6 y se
   apoya en esto.

**Aceptación:**
- [ ] Un pago registrado a las 22:30 hora local queda con la fecha de ese día.
- [ ] No quedan helpers de fecha duplicados en `ui/`.
- [ ] Ningún script SQL de negocio usa `current_date` ni `now()::date`.

### 0.5 Integridad financiera y borrados  ☐

1. **`anular_pago`:** rechazar contraasientos —
   `if v_orig.anula_a_pago_id is not null then raise exception 'No se puede
   anular un contraasiento.'; end if;` (H6). Test: anular un pago, intentar
   anular su contraasiento → error; deuda sin cambios.
2. **Borrados físicos (H8):** `movimientos_caja` pasa a baja lógica en Fase
   2.5. Para `documentos` y `ausencias` (RRHH) mantener `delete` pero
   **auditado** (0.8) o pasar a `activo`; decidir con el producto y
   documentarlo como excepción.
3. Constraint de saldos coherentes: test que recorra una secuencia
   pago/anulación/edición y verifique que
   `proveedores.saldo = Σ facturas.saldo_pendiente − Σ pagos a favor`.

**Aceptación:**
- [ ] Anular un contraasiento falla con mensaje claro.
- [ ] El test de coherencia de saldos pasa tras una secuencia aleatoria de operaciones.

### 0.6 Operaciones atómicas (RPC) y códigos  ☐

**Problema (H5, H14):** escrituras multi-paso desde el navegador.

Crear en `supabase/f0_rpc_atomicas.sql` y migrar `data/` para usarlas:

- `guardar_receta(p_id uuid, p_datos jsonb, p_ingredientes jsonb) returns uuid`
  — crea o actualiza receta + ingredientes **en una transacción**; valida
  ciclos y profundidad máxima (la misma regla que `core/costeo.js`);
  recalcula el costo (0.7).
- `crear_insumo(p_datos jsonb) returns uuid` — insumo + primer punto del
  historial.
- `actualizar_costo_insumo(p_id uuid, p_costo bigint, p_origen text,
  p_factura uuid default null, p_precio_presentacion bigint default null)` —
  update + historial + recálculo de recetas afectadas.
- `siguiente_codigo(p_tabla text, p_prefijo text)` con bloqueo (o
  `unique (empresa_id, codigo)` + reintento) para eliminar la carrera.

Todas validan `mi_empresa()` y rol (`ADMIN`/`GERENTE`/`COCINA` según la
matriz).

**Aceptación:**
- [ ] Forzar un error a mitad de `guardar_receta` no deja la receta sin ingredientes (test).
- [ ] Dos altas concurrentes no repiten código.

### 0.7 Costeo en SQL (fuente única de verdad)  ☐

**Problema (H7, H12, H16).** El costo que usa Ventas como snapshot no puede
depender de que alguien haya recalculado desde el navegador.

**Qué hacer** (`supabase/f0_costeo.sql`):

1. `costo_receta(p_receta uuid) returns numeric` — recursiva con control de
   ciclos y profundidad (`MAX_PROFUNDIDAD_RECETA = 4`), misma fórmula que
   `core/costeo.js`: `cantidad × costo_neto × (1 + IVA) / factor_corrección`
   para insumos y `cantidad × costo_total_sub / rendimiento` para
   sub-recetas. Resolver en esta fase qué pasa con `porcentaje_merma`:
   **o se aplica en ambos lados (SQL y JS) o se elimina la columna**. No
   puede quedar una columna que parece hacer algo y no lo hace.
2. `recalcular_costos()` — recalcula `costo_calculado_centavos` y
   `fecha_calculo` de todas las recetas de la empresa; la llaman
   `actualizar_costo_insumo`, `guardar_receta` y un botón "Recalcular".
3. **Precisión (H16):** guardar el costo por unidad base con más resolución
   (p. ej. `numeric(14,4)` en centavos, o centavos por 1000 unidades base)
   y migrar los existentes sin cambiar su valor.
4. **Paridad JS↔SQL:** archivo de fixtures (`test/fixtures/costeo.json`) con
   recetas, sub-recetas, IVA y factor; el test de Node y el test SQL deben dar
   el mismo resultado al centavo. Si difieren, el CI falla.
5. El JS (`core/costeo.js`) se mantiene para la **vista previa en vivo** del
   editor, pero ya no escribe el snapshot: lo hace la base.

**Aceptación:**
- [ ] Cambiar el precio de un insumo actualiza `costo_calculado_centavos` de todas las recetas que lo usan, sin pasar por el navegador.
- [ ] El test de paridad pasa con ≥ 10 casos (incluye sub-recetas de 3 niveles y un ciclo rechazado).
- [ ] `porcentaje_merma` tiene un comportamiento definido y documentado.

### 0.8 Auditoría y CI  ☐

**Tabla `auditoria`** (`supabase/f0_auditoria.sql`):

```sql
create table if not exists auditoria (
  id          uuid primary key default uuid_generate_v4(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  usuario_id  uuid,
  accion      varchar(60) not null,   -- 'alias_cobro', 'cambio_rol', 'anular_pedido', …
  entidad     varchar(40),
  entidad_id  uuid,
  antes       jsonb,
  despues     jsonb,
  creado_en   timestamptz not null default now()
);
create index if not exists ix_auditoria_empresa on auditoria(empresa_id, creado_en desc);
alter table auditoria enable row level security;
-- lectura: solo ADMIN. Sin insert/update/delete desde el cliente (las RPC escriben).
```

Función interna `auditar(p_accion, p_entidad, p_id, p_antes, p_despues)`
(`security definer`) que usan todas las RPC sensibles. Pantalla simple
**Configuración → Auditoría** (solo ADMIN, solo lectura).

**CI** (`.github/workflows/tests.yml`), en cada PR y push a `main`:

```yaml
on: [pull_request, push]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: postgres }
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready --health-interval 5s --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm test
      - run: bash supabase/tests/run.sh   # crea DB limpia, scripts + tests SQL
```

**Aceptación:**
- [ ] Un PR con un test roto (JS o SQL) no se puede mergear.
- [ ] Cambiar alias, rol o estado de un usuario deja una fila en `auditoria`.

### 0.9 Dependencias externas y detalles  ☐

- Fijar la versión de `@supabase/supabase-js` (ej. `@2.x.y`, no `@2`) y agregar
  **SRI** (`integrity`) o copiar el archivo al repo (`js/vendor/`).
- SheetJS: dejar de usar 0.18.5 por cdnjs; usar una versión mantenida
  (distribución oficial de SheetJS) fijada y con SRI, o vendorizarla. Es
  requisito previo para la importación desde Excel (Fase 5).
- `app.js:224`: escapar `err.message` con `escapar()`.
- `index.html`: agregar `Content-Security-Policy` por `<meta>` (restringir
  orígenes de script a los dos o tres usados).
- Quitar del `.gitignore` y de `package.json` las referencias a Firebase y
  renombrar el paquete (`app-proveedores-costos-gg`).
- Documentar en el README que **cada merge a `main` se publica** y cómo se
  hace una prueba en el entorno de staging (ver Fase 5).

### Cierre de Fase 0

- [ ] Todos los ítems 0.1 a 0.9 marcados.
- [ ] `supabase/tests/run.sh` verde en CI.
- [ ] Hallazgos H1–H17 re-probados con los scripts de §2: ninguno se reproduce.
- [ ] `docs/manual.md`: sección "Roles y permisos" (matriz) y "Cómo agregar un usuario".
- [ ] Lista de SQL a correr en Supabase, en orden, entregada al dueño del producto.

---

## Fase 1 — Módulos activables y configuración de empresa  ✅ implementada

**Objetivo:** cada empresa ve solo los módulos que contrató. Base para vender
por planes.

> Nota de producto: **quien activa módulos es el dueño del producto, no el
> cliente.** Si un ADMIN de cliente pudiera hacerlo, se activaría el plan
> premium solo. Por eso **no hay RPC para el cliente**: se edita desde el SQL
> Editor (o una futura consola de superadmin).

### Base de datos (`supabase/f1_modulos_empresa.sql`)

- `empresas.modulos text[] not null default '{admin,costos,carta,rrhh}'`.
- Valores válidos: `admin`, `costos`, `carta`, `rrhh`, `ventas`, `reparto`.
  `check` que valide que todos los elementos están en la lista.
- Las empresas existentes quedan con los módulos que ya usaban.
- **Sin** permiso de `update` sobre esta columna para `authenticated` (Fase
  0.2). Cambios solo por SQL Editor / service role. Documentarlo.

### Dependencias entre módulos

| Módulo | Requiere | Si falta |
|---|---|---|
| `reparto` | `admin` (usa Flujo de caja) | no se puede activar |
| `ventas` | `carta` (usa recetas y precios) y `admin` (cierre → caja) | no se puede activar |
| Rentabilidad real (Fase 3) | `ventas` | la pantalla "Ventas reales" no aparece |
| `reparto` sin `rrhh` | — | sueldos se cargan como gasto fijo (ver Fase 4) |

Validar estas dependencias con un `check` o un trigger (mensaje claro).

### Frontend

- `auth.js → miPerfil()`: traer `modulos`, `zona_horaria`, `condicion_fiscal`
  y demás parámetros en `perfil.empresa`.
- `app.js`: cada grupo del `MENU` tiene `id` (`admin`, `costos`, `carta`,
  `rrhh`, `ventas`, `reparto`, `config`). Filtrar por `perfil.empresa.modulos`
  (y por rol). `config` siempre visible. Un ítem de un módulo apagado que
  llega por `localStorage` (última pantalla) cae en la inicial.
- **Configuración → Empresa:** mostrar los módulos activos **en solo lectura**
  ("Para cambiar tu plan contactá a …").
- Aclaración: el gating por módulo es de **experiencia**, no de seguridad
  (las tablas siguen protegidas por rol y empresa). Es aceptable para vender
  planes; si algún día se necesita blindaje duro, se agrega por módulo en RLS.

### Aceptación

- [ ] Con un módulo quitado de `modulos`, no aparece en el menú ni se abre aunque la última pantalla guardada fuera de ese módulo.
- [ ] Las empresas existentes no pierden nada.
- [ ] Un ADMIN no puede modificar `modulos` (probado por API).
- [ ] Si `reparto` está activo y `rrhh` no, el tablero funciona con sueldos como gasto fijo.

---

## Fase 2 — Ventas (mostrador)

> **Estado:** ✅ entrega 1/2 (base de datos + lógica pura + tests) y entrega 2/2 (pantallas: Mostrador, Historial, Configuración, campos de venta en recetas, impresión con respaldo WhatsApp) hechas.
> Entrega 1/2:
> `f2_ventas.sql`, `f2_caja_ventas.sql`, `f2_ventas_rpc.sql` (o `f2_aplicar_todo.sql`),
> `js/core/ventas.js`. Falta la entrega 2/2: pantallas (Mostrador, Historial,
> Configuración, campos de venta en recetas) y el ajuste del Flujo de caja.
> Cambios respecto de lo escrito abajo:
> - La config de ventas se cambia con **`set_config_ventas`** (solo ADMIN, auditada),
>   no con `set_config_empresa` (así no se pisa al re-ejecutar la Fase 0).
> - Orden de scripts: `f2_ventas` → `f2_caja_ventas` → `f2_ventas_rpc` (la caja
>   referencia a `turnos_caja`).
> - Se marca una receta como vendible con **`configurar_venta_receta`** (ADMIN/GERENTE/COCINA).
> - **Comanda configurable por empresa** (`modo_comanda`: `whatsapp` | `impresora` |
>   `impresora_whatsapp`; `ancho_ticket_mm`: 58/80; `plantilla_comanda`).
>   Impresión v1 = `window.print()` sobre una hoja angosta (sirve para cualquier
>   térmica instalada como impresora del sistema; modo kiosco de Chrome para evitar
>   el diálogo). Si falla, la pantalla ofrece **Enviar por WhatsApp** como respaldo.
>   `registrar_comanda` deja constancia de cómo salió (`pedidos.comanda_via`).
>   Más adelante, opcional: WebUSB / puente ESC/POS.
> - El borrado en el Flujo de caja pasó a baja lógica (trigger), así el frontend
>   anterior no se rompe; los movimientos de cierre no se editan ni borran.

**Objetivo:** un módulo dentro del SaaS, sobre Supabase, conectado a la carta y
a la caja, **genérico para cualquier local con mostrador o venta rápida**.

> **Antes de empezar:** pedir al dueño del producto el repo de la **app de
> pedidos del primer cliente** (hoy sobre Firebase). Leerla para reutilizar la
> UI del carrito, el armado del mensaje de WhatsApp a cocina y el formato de
> número de pedido. **No se migra Firebase:** se reescribe la capa de datos
> sobre Supabase. Lo que se reutilice se **generaliza** (plantillas, no textos
> fijos).

### 2.1 La carta de venta sale de las recetas

No hay tabla de productos nueva: **un producto vendible es una receta de tipo
`plato`**, que ya tiene `precio_venta_publico_centavos`, `sector_venta` y
`costo_calculado_centavos`.

Agregar a `recetas` (migración idempotente):

| Columna | Tipo | Uso |
|---|---|---|
| `vende_en_mostrador` | `boolean not null default false` | Aparece en el panel de ventas |
| `categoria_venta` | `varchar(60)` | Agrupa botones (la define cada empresa) |
| `orden_venta` | `int not null default 0` | Orden de los botones |
| `es_adicional` | `boolean not null default false` | Se agrega *sobre* otro ítem (extra, medallón extra) |

- Bebidas y reventa: recetas `plato` con **un solo ingrediente** (el insumo),
  así tienen costo y entran en la rentabilidad.
- `categoria_venta` usa un catálogo nuevo `cat_venta` (sin defaults
  hardcodeados de un rubro en particular).
- En **Platos y preparaciones** agregar estos campos al formulario.

### 2.2 Tablas (`supabase/f2_ventas.sql`)

Cambios respecto del plan original: **`pedido_pagos`** (pago dividido listo
desde el modelo), **`client_uuid`** (idempotencia ante reintentos),
**auditoría de anulación** y **egresos del turno** para que el efectivo
esperado sea correcto.

```sql
-- Turno de caja: una apertura y un cierre. Es la unidad que se cierra.
create table if not exists turnos_caja (
  id                          uuid primary key default uuid_generate_v4(),
  empresa_id                  uuid not null references empresas(id) on delete cascade,
  sucursal_id                 uuid references sucursales(id) on delete restrict,
  fecha_operativa             date not null,           -- el día de negocio (ver 2.6)
  estado                      varchar(10) not null default 'abierto'
                              check (estado in ('abierto','cerrado')),
  fondo_inicial_centavos      bigint not null default 0 check (fondo_inicial_centavos >= 0),
  efectivo_contado_centavos   bigint,                  -- lo que se contó al cerrar
  efectivo_esperado_centavos  bigint,                  -- snapshot al cerrar (2.4)
  abierto_en                  timestamptz not null default now(),
  abierto_por                 uuid,
  cerrado_en                  timestamptz,
  cerrado_por                 uuid,
  nota_cierre                 text
);
-- Un solo turno abierto por empresa (y por sucursal si se usa).
create unique index if not exists ux_turno_abierto
  on turnos_caja(empresa_id, coalesce(sucursal_id, '00000000-0000-0000-0000-000000000000'))
  where estado = 'abierto';
create index if not exists ix_turnos_empresa_fecha on turnos_caja(empresa_id, fecha_operativa);

create table if not exists pedidos (
  id                    uuid primary key default uuid_generate_v4(),
  empresa_id            uuid not null references empresas(id) on delete cascade,
  turno_id              uuid not null references turnos_caja(id) on delete restrict,
  numero                int  not null,                 -- correlativo dentro del turno
  client_uuid           uuid,                          -- idempotencia (R6)
  cliente_nombre        varchar(120),
  cliente_telefono      varchar(40),
  modalidad             varchar(10) not null default 'retiro'
                        check (modalidad in ('retiro','delivery','local')),
  direccion             text,
  subtotal_centavos     bigint not null check (subtotal_centavos >= 0),
  descuento_centavos    bigint not null default 0 check (descuento_centavos >= 0),
  envio_centavos        bigint not null default 0 check (envio_centavos >= 0),
  total_centavos        bigint not null check (total_centavos >= 0),
  costo_total_centavos  bigint not null default 0,     -- snapshot de costo (2.4)
  alias_cobro           varchar(60),                   -- snapshot del alias vigente
  estado                varchar(12) not null default 'confirmado'
                        check (estado in ('confirmado','entregado','anulado')),
  motivo_anulacion      text,
  anulado_por           uuid,
  anulado_en            timestamptz,
  nota                  text,
  creado_en             timestamptz not null default now(),
  creado_por            uuid,
  unique (turno_id, numero),
  constraint chk_descuento check (descuento_centavos <= subtotal_centavos)
);
create unique index if not exists ux_pedido_client_uuid
  on pedidos(empresa_id, client_uuid) where client_uuid is not null;

-- Un pedido puede cobrarse con 1..n medios (v1 de la UI: uno solo).
create table if not exists pedido_pagos (
  id             uuid primary key default uuid_generate_v4(),
  empresa_id     uuid not null references empresas(id) on delete cascade,
  pedido_id      uuid not null references pedidos(id) on delete cascade,
  medio          varchar(20) not null
                 check (medio in ('efectivo','transferencia','tarjeta','qr','otro')),
  monto_centavos bigint not null check (monto_centavos > 0)
);

create table if not exists pedido_items (
  id                     uuid primary key default uuid_generate_v4(),
  empresa_id             uuid not null references empresas(id) on delete cascade,
  pedido_id              uuid not null references pedidos(id) on delete cascade,
  receta_id              uuid not null references recetas(id) on delete restrict,
  item_padre_id          uuid references pedido_items(id) on delete cascade, -- adicionales
  nombre_snapshot        varchar(255) not null,
  cantidad               int not null check (cantidad > 0),
  precio_unit_centavos   bigint not null check (precio_unit_centavos >= 0),
  costo_unit_centavos    bigint not null default 0,
  nota                   text
);
create index if not exists ix_pedidos_turno on pedidos(empresa_id, turno_id);
create index if not exists ix_items_pedido on pedido_items(pedido_id);
create index if not exists ix_items_receta on pedido_items(empresa_id, receta_id);
```

- **Invariante** (validada en `crear_pedido` y con test): `Σ pedido_pagos =
  total_centavos` de cada pedido no anulado.
- RLS: `select` por rol (ver matriz; `CAJERO` solo ve los pedidos del turno
  abierto); **sin** `insert/update/delete` desde el cliente: solo RPC
  `security definer`.
- Si el negocio no usa delivery, `modalidad`, `direccion` y `envio` quedan en
  sus defaults y la pantalla los oculta (configurable en 2.3).

### 2.3 Configuración de ventas

Columnas en `empresas` (se cambian **solo por RPC** `set_config_empresa`, con
auditoría — ver 0.2):

- `alias_transferencia varchar(60)` — alias vigente de cobro. **Solo ADMIN.**
  Cada cambio queda en `auditoria` y cada pedido guarda su copia
  (`alias_cobro`). *Es un vector de fraude real: quien lo cambia redirige los
  pagos.*
- `whatsapp_cocina varchar(30)` — destino de la comanda.
- `costo_envio_default_centavos bigint default 0`.
- `hora_corte_dia time default '06:00'` — ver 2.6.
- `medios_pago_habilitados text[] default '{efectivo,transferencia}'` —
  subconjunto de `efectivo, transferencia, tarjeta, qr, otro`. Mismos valores
  que los medios de `movimientos_caja` (así el cierre mapea 1 a 1).
- `usa_delivery boolean default false` — muestra/oculta modalidad, dirección y
  envío.

Pantalla **Ventas → Configuración** (ADMIN).

### 2.4 Funciones RPC (todas `security definer`, `set search_path = public`, validan `mi_empresa()` y rol)

**`config_cobro() returns jsonb`** — para `CAJERO`: devuelve solo
`{alias_transferencia, whatsapp_cocina, medios_pago_habilitados, usa_delivery,
costo_envio_default_centavos}`. El cajero no lee `empresas` directo.

**`carta_mostrador() returns table(...)`** — para `CAJERO`: `id, nombre,
precio_centavos, categoria_venta, orden_venta, es_adicional` de las recetas
`vende_en_mostrador and activo`. **Nunca** devuelve costos ni márgenes.

**`abrir_turno(p_fondo_inicial bigint, p_sucursal uuid default null) returns uuid`**
- Falla si ya hay un turno abierto (mensaje claro, no el error del índice).
- Calcula `fecha_operativa` en la zona de la empresa (2.6).
- Roles: `ADMIN`, `GERENTE`, `CAJERO`.

**`crear_pedido(p_turno uuid, p_datos jsonb, p_items jsonb, p_pagos jsonb, p_client_uuid uuid) returns jsonb`**
- `p_items` = `[{receta_id, cantidad, nota, adicionales:[{receta_id, cantidad}]}]`.
- Si ya existe un pedido con ese `client_uuid` en la empresa, **devuelve el
  existente** (idempotencia: doble toque o reintento de red no duplican).
- Verifica que el turno esté **abierto** y sea de la empresa; que cada receta
  sea `vende_en_mostrador` y `activo`; que los medios estén en
  `medios_pago_habilitados`.
- **Toma precio y costo de la base, nunca del cliente:**
  `precio_unit = recetas.precio_venta_publico_centavos` y
  `costo_unit = round(costo_receta(receta_id))` calculado **en el momento**
  (0.7). Así el snapshot es real aunque nadie haya recalculado.
- Calcula `subtotal`, `total = subtotal − descuento + envio` y
  `costo_total`; el descuento no puede superar el subtotal.
- Verifica `Σ pagos = total`.
- Asigna `numero = max(numero) + 1` del turno con `select … for update` sobre
  el turno (dos cajas no sacan el mismo número).
- Copia `alias_cobro` si hay pago por transferencia.
- Devuelve `{id, numero, total_centavos}`.

**`marcar_entregado(p_pedido uuid)`** — `confirmado → entregado`.

**`anular_pedido(p_pedido uuid, p_motivo text)`**
- Solo con turno **abierto**. Motivo **obligatorio**.
- Roles: `ADMIN` y `GERENTE` siempre; `CAJERO` **sí**, dentro de su turno
  abierto (los errores de carga se dan en el momento y un cajero que no puede
  corregirlos termina usando papel). Queda `anulado_por/en` y `auditoria`; el
  resumen del turno muestra cantidad y monto de anulados para que el dueño
  detecte anomalías.
- Con el turno cerrado no se anula: hay que reabrirlo.

**`registrar_egreso_turno(p_turno uuid, p_monto bigint, p_categoria text, p_nota text)`**
— salida de **efectivo de la caja** durante el turno (hielo, delivery, retiro).
Inserta en `movimientos_caja` (`tipo='egreso'`, `medio='efectivo'`,
`origen='turno'`, `turno_id`). Sin esto la diferencia de caja da siempre mal.

**`cerrar_turno(p_turno uuid, p_efectivo_contado bigint, p_nota text) returns jsonb`**
- Suma los `pedido_pagos` de pedidos **no anulados** agrupados por `medio`.
- Por cada medio con total > 0 inserta **un** movimiento en
  `movimientos_caja`: `tipo='ingreso'`, `categoria='Ventas'`
  (configurable por `categorias_venta`), `medio`, `fecha = fecha_operativa`,
  `origen='cierre_turno'`, `turno_id`, `nota = 'Cierre de caja — N pedidos'`.
- **Efectivo esperado** = `fondo_inicial + ventas en efectivo − egresos en
  efectivo del turno` (el plan original ignoraba los egresos).
- **Diferencia de caja** = `efectivo_contado − efectivo_esperado`; se guarda
  `efectivo_esperado_centavos` como snapshot.
- Marca el turno `cerrado`. Devuelve el resumen: cantidad de pedidos, total
  por medio, esperado, diferencia, ticket promedio, anulados.
- Idempotente: cerrar un turno ya cerrado devuelve el resumen sin duplicar.

**`reabrir_turno(p_turno uuid, p_motivo text)`** (solo ADMIN, audita)
- Pone `activo = false` en los movimientos de caja generados por ese cierre
  (2.5) y vuelve el turno a `abierto`. Falla si ya hay otro turno abierto.

### 2.5 Cambios en `movimientos_caja` (`supabase/f2_caja_ventas.sql`)

Migración idempotente:

- `origen varchar(20) not null default 'manual' check (origen in ('manual','cierre_turno','turno'))`
- `turno_id uuid references turnos_caja(id) on delete restrict`
- `activo boolean not null default true`
- Índice único parcial: un movimiento **activo** por `(turno_id, medio)` cuando
  `origen = 'cierre_turno'` (evita cierres duplicados).

En `caja.js` / `movimientosCajaRepo.js`:

- Listar solo `activo = true`.
- Los movimientos con `origen = 'cierre_turno'` se muestran con la etiqueta
  "Cierre de caja" y **no se pueden eliminar** desde la pantalla (para
  corregirlos se reabre el turno).
- `eliminar(id)` pasa a **baja lógica** (`activo = false`) con auditoría
  (resuelve H8).
- Los ingresos de categoría de venta cargados **a mano** el mismo día en que
  hay un cierre automático muestran una advertencia de posible duplicado.

### 2.6 Fecha operativa (importante)

El local puede cerrar después de medianoche; la venta tiene que quedar en el
día en que se abrió la caja.

- `fecha_operativa` = fecha de apertura **en la zona de la empresa**; si la
  hora de apertura es **anterior a `hora_corte_dia`** (default `06:00`),
  corresponde al día anterior.
- Todo lo de ventas, caja y reparto agrupa por `fecha_operativa`, **nunca** por
  `creado_en`.
- Implementar **dos veces y con los mismos casos de prueba**: función SQL
  `fecha_operativa(p_instante timestamptz, p_zona text, p_corte time)` y su
  espejo puro en `core/utilsFecha.js`. Casos: 19:30 → mismo día; 00:40 → día
  anterior; 05:59 → día anterior; 06:00 → mismo día; cambio de mes y de año.

### 2.7 Lógica pura (`js/core/ventas.js` + `test/ventas.test.js`)

- `totalPedido(items, {descuento, envio})` → centavos; mismo cálculo que la
  RPC para mostrar el total mientras se arma el pedido.
- `resumenTurno(pedidos, egresos, fondoInicial)` → totales por medio, esperado
  en efectivo (con egresos), ticket promedio, anulados.
- `textoComanda(pedido, items, plantilla)` → string listo para `wa.me`. La
  **plantilla es configurable** (por defecto el formato del cliente piloto).
- Tests: adicionales, descuento mayor al subtotal (debe fallar), redondeo en
  centavos, anulados excluidos, pago dividido que no suma el total (falla),
  esperado de efectivo con egresos.

### 2.8 Pantallas (`js/saas/ui/ventas*.js`)

Nuevo grupo en el `MENU`: `{ id: "ventas", titulo: "Ventas", … }`.

1. **Mostrador** (`ventasMostrador.js`) — la pantalla de uso diario.
   - Sin turno abierto: botón grande "Abrir caja" (pide fondo inicial).
   - Izquierda: botones de productos por `categoria_venta`, ordenados por
     `orden_venta`. Tocar suma 1. Los adicionales se agregan sobre el último
     ítem seleccionado.
   - Derecha: pedido en armado (ítems, +/−, notas), modalidad (si
     `usa_delivery`), nombre/teléfono, medio de pago, **total grande**.
     Con transferencia, el **alias vigente** bien visible y copiable.
   - "Confirmar pedido" → `crear_pedido` (con `client_uuid` generado en el
     cliente) → muestra el número y ofrece "Enviar a cocina por WhatsApp".
   - Debajo: pedidos del turno (número, cliente, total, medio, estado) con
     "Entregado" y "Anular" (con motivo).
   - Botón "Registrar salida de efectivo" (`registrar_egreso_turno`).
   - Botón "Cerrar caja" → modal con `resumenTurno`, "Efectivo contado",
     diferencia, confirmar → `cerrar_turno`.
   - **Diseño táctil:** botones de **≥ 48 px**, sin dependencia de hover, total
     siempre visible, operable con una mano. Esto exige un **"modo caja"**:
     layout a pantalla completa (sin el ancho máximo de 960 px de
     `.main-inner` y con la barra lateral colapsada), definido en `index.html`
     como variante de CSS, no como copia de estilos.
2. **Historial de ventas** — turnos cerrados con su resumen y detalle.
3. **Configuración** — alias, WhatsApp, envío, hora de corte, medios, delivery.

### 2.9 Rol `CAJERO`

- Agregado en 0.3. En el `MENU`, `CAJERO` solo ve **Ventas → Mostrador**
  (y su historial del turno).
- **El blindaje por rol NO es opcional** (el plan original lo postergaba): el
  `CAJERO` no tiene acceso a ninguna tabla de negocio; todo pasa por
  `carta_mostrador()`, `config_cobro()` y las RPC de turnos/pedidos. Un
  cajero con acceso directo podría leer deudas, costos y márgenes, cambiar
  precios de la carta o borrar movimientos de caja. Ya está resuelto por 0.1;
  Fase 2 **agrega los tests** correspondientes.

### 2.10 Sin conexión

El mostrador depende de internet. Versión 1:

- Detectar `navigator.onLine` y errores de red; mostrar una franja roja "Sin
  conexión — anotá el pedido en papel" y deshabilitar Confirmar.
- **Cola offline: fuera de alcance** (Fase 6). Gracias a `client_uuid`, si
  la red cae justo al confirmar y se reintenta, **no se duplica** el pedido.

### Aceptación

- [ ] Abrir caja, cargar 5 pedidos (con adicionales, efectivo y transferencia), anular 1, registrar 1 salida de efectivo, cerrar caja.
- [ ] En Flujo de caja del día operativo aparecen los ingresos "Ventas" (uno por medio) con los totales correctos, y las salidas de efectivo como egresos.
- [ ] Efectivo esperado y diferencia de caja correctos **con** egresos del turno.
- [ ] Cerrar el mismo turno dos veces es imposible (segundo intento no duplica).
- [ ] Reintentar `crear_pedido` con el mismo `client_uuid` devuelve el mismo pedido.
- [ ] Un pedido cargado a las 00:40 queda en la fecha operativa del día anterior.
- [ ] Cambiar el precio o el costo de una receta no altera pedidos ya cargados.
- [ ] `CAJERO` solo ve el Mostrador y **no puede** leer `recetas`, `facturas`, `proveedores` ni `movimientos_caja` por API.
- [ ] Un `CAJERO` no puede cambiar el alias de cobro ni los precios (probado por API).
- [ ] Todo con tests SQL y JS en verde.

---

## Fase 3 — Rentabilidad real (ventas × costo)  ✅ implementada

**Objetivo:** que la rentabilidad muestre **lo que realmente se vendió y cuánto
costó**, con la honestidad metodológica que corresponde.

> **Aclaración de nombres.** El costo de lo vendido se calcula como
> `unidades × costo de la receta`. Eso es el **costo teórico de lo vendido**
> (CMV teórico): no ve mermas, porciones de más, errores ni pérdidas. El
> "food cost real" de verdad se obtiene con inventario (fuera de alcance).
> Por eso la pantalla usa el nombre **"CMV teórico"** y suma un segundo
> indicador independiente: **compras del período** (ver abajo). La diferencia
> entre ambos es una señal útil de desperdicio, no una verdad.

### Base de datos (`supabase/f3_ventas_reportes.sql`)

Vistas `security_invoker = true`:

- `v_ventas_por_plato (empresa_id, fecha_operativa, receta_id, nombre,
  unidades, ingreso_centavos, costo_centavos)` — desde `pedido_items` +
  `pedidos` (solo no anulados) + `turnos_caja`. Los adicionales cuentan como
  su propia receta.
- `v_ventas_por_dia (empresa_id, fecha_operativa, pedidos, ingreso_centavos,
  costo_centavos, anulados, monto_anulado_centavos)`.
- `v_ventas_por_hora` (franja horaria en la zona de la empresa) y por día de
  la semana: sirven para el tablero y para la proyección de Fase 4.
- **Compras del período:** función `compras_periodo(p_desde, p_hasta)` que
  suma `facturas` no anuladas por `fecha_emision` de los rubros que cuentan
  como mercadería (`empresas.rubros_cmv text[]`, default: todos menos
  `Limpieza` y `Descartables`).

### Lógica pura (`js/core/costeo.js`, sumar funciones + tests)

- `cmvTeoricoPct(ingreso, costo)` → %.
- `mixDeVentas(filas)` → participación de cada plato en unidades e ingreso.
- `brechaComprasVsCmv(comprasCentavos, cmvTeoricoCentavos)` → monto y %.
  Devuelve además un flag `periodoCorto` si el rango tiene menos de 28 días
  (con menos días el stock inicial/final distorsiona y la brecha no es
  confiable).
- Si la empresa es **responsable inscripto** (Fase 6), ingreso y costo se
  comparan **netos de IVA**. Para `monotributo` y `exento`, tal cual.

### Pantalla: Rentabilidad de carta → **Ventas reales**

- Selector de rango (7 / 30 días / mes actual / mes anterior / personalizado).
- KPIs: ventas, costo de lo vendido (CMV teórico), CMV teórico %, margen
  bruto, unidades, ticket promedio, % de pedidos anulados.
- **Compras del período** y **brecha** contra el CMV teórico, con nota
  explicativa y el aviso de período corto.
- Tabla por plato: unidades, ingreso, costo, CMV %, % de las ventas,
  comparación contra el food cost **teórico de la carta**.
- Ventas por día de la semana y por franja horaria.
- Exportar a Excel (`js/export/excel.js`).
- **Aviso** si hay insumos con precio desactualizado (+30 días), que ya calcula
  el Resumen de Costos.

### Aceptación

- [ ] Los totales de la vista coinciden con la suma de los cierres del mismo rango.
- [ ] Un plato con precio cambiado a mitad de mes muestra el ingreso real cobrado.
- [ ] La pantalla nunca llama "real" al costo teórico.
- [ ] La brecha de compras avisa cuando el período es corto.

---

## Fase 4 — Tablero de reparto ("apartados")  ✅ implementada

**Objetivo:** que el dueño vea, a medida que entran los cierres, **cuánto de lo
que entró ya está comprometido** y cuánto le queda de verdad. Es **informativo**:
no mueve plata ni genera movimientos de caja.

### 4.1 Gastos fijos y parámetros (`supabase/f4_reparto.sql`)

```sql
create table if not exists gastos_fijos (
  id                      uuid primary key default uuid_generate_v4(),
  empresa_id              uuid not null references empresas(id) on delete cascade,
  nombre                  varchar(120) not null,   -- "Alquiler local", "Luz", "Retiro del dueño"
  categoria               varchar(40) not null,    -- catálogo cat_gasto_fijo (abierto)
  monto_mensual_centavos  bigint not null check (monto_mensual_centavos > 0),
  dia_vencimiento         int check (dia_vencimiento between 1 and 31),
  categorias_caja         text[] not null default '{}',   -- egresos de caja que cuentan como "ya pagado"
  orden                   int not null default 0,
  activo                  boolean not null default true,
  creado_en               timestamptz not null default now(),
  modificado_en           timestamptz not null default now()
);
-- RLS: solo ADMIN (el tablero es solo ADMIN).
```

- **Categorías abiertas:** el plan original las fijaba con un `check`; es
  mejor un catálogo (`cat_gasto_fijo`) con defaults — `alquiler`, `servicios`,
  `impuestos`, `sistemas`, `marketing`, `mantenimiento`, `financiero /
  cuotas`, **`retiro_del_dueño`**, `otros` — extensible por cada negocio.
  Reservadas por el sistema: `sueldos` y `cargas_sociales` (ver 4.1.b).
- **Parámetros en `empresas`:**
  - `cmv_objetivo_pct numeric(5,2) default 35` — % de las ventas que se va en
    mercadería cuando todavía no hay datos propios.
  - **`costos_variables_pct numeric(5,2) default 0`** — otros costos que
    crecen con la venta: comisiones de tarjeta y QR, Ingresos Brutos, envases,
    comisión de plataformas. **Faltaba en el plan original.**
  - `dias_operativos_mes int default 30`.
  - `categorias_venta text[] default '{Ventas,Ventas tarjeta,Ventas QR}'`:
    qué categorías de ingreso de caja cuentan como ventas (hoy la categoría es
    texto libre; "ventas" vs "Ventas" romperían el cálculo si no se define).

### 4.1.b Sueldos desde RRHH (fuente principal)

El gasto en empleados **sale de RRHH**, no de una carga manual. Datos que ya
existen: `empleados` (estado), `empleados_sueldos` (historial, `tipo` mensual
o por hora, `vigencia_desde`), `vw_sueldo_vigente`, y desde ahora
`empleados.fecha_alta` (alta formal) y `empleados_legajo.modalidad`.

**Problema de permisos:** `empleados_sueldos` es solo ADMIN. **No abrir esa
RLS.** Una RPC devuelve solo agregados.

**RPC `gasto_empleados_mensual(p_fecha date default hoy_empresa()) returns jsonb`**
(`security definer`, `set search_path = public`):

- Valida `mi_empresa()` y rol **`ADMIN`** (el Tablero es solo ADMIN; abrir la
  RPC a `GERENTE` le entregaría la masa salarial por la puerta de atrás).
- Para los empleados **activos**, suma el sueldo vigente a `p_fecha`:
  - `mensual` → el monto.
  - `por_hora` → `monto × empleados.horas_mensuales_estimadas`; si falta el
    dato, **no se suma** y se cuenta en `sin_horas`.
- **Quién genera cargas y aguinaldo (el plan original no lo distinguía):**
  - **Cargas sociales** (`empresas.cargas_sociales_pct`, que el dueño o su
    contador definen e incluye aportes patronales, obra social, ART, etc.):
    solo para empleados **con `fecha_alta` no nula y ≤ `p_fecha`** y cuya
    `modalidad` no sea `monotributista` ni `pasantia`.
  - **Provisión de aguinaldo** (`provisionar_aguinaldo`): 1/12 del sueldo por
    mes para los empleados en relación de dependencia (no `monotributista`),
    **estén o no dados de alta** — la obligación existe igual. Las **cargas
    sobre el aguinaldo** se calculan solo para los dados de alta.
- Devuelve **solo agregados**, nunca sueldos individuales:
  `{ sueldos_centavos, cargas_centavos, aguinaldo_centavos,
     cargas_aguinaldo_centavos, total_centavos, empleados_incluidos,
     sin_horas, sin_alta }` (`sin_alta` = cuántos empleados no generan cargas
  por no estar dados de alta; informativo).
- `grant execute … to authenticated`.

**Columnas nuevas** (migración idempotente en `f4_reparto.sql`):

| Tabla | Columna | Uso |
|---|---|---|
| `empleados` | `horas_mensuales_estimadas numeric(6,2)` | Pasar sueldos por hora a mensual |
| `empresas` | `cargas_sociales_pct numeric(5,2) not null default 0` | % sobre el sueldo |
| `empresas` | `provisionar_aguinaldo boolean not null default true` | Suma 1/12 mensual para el SAC |

En RRHH → ficha del empleado: campo "Horas mensuales estimadas" (visible solo
si el sueldo vigente es por hora).

**Regla para no contar dos veces:**

- Con `rrhh` activo, el sobre **Sueldos** sale de la RPC y las categorías
  `sueldos` / `cargas_sociales` se **ocultan** en el ABM de gastos fijos. Si
  ya existían gastos fijos de esas categorías, se **ignoran** en el cálculo y
  se avisa para darlos de baja.
- Sin `rrhh`, los sueldos se cargan como gasto fijo (categoría `sueldos`).

### 4.2 Lógica pura (`js/core/reparto.js` + `test/reparto.test.js`)

Todo en centavos. `core/` recibe los **sobres ya armados** (no sabe de dónde
vienen: de gastos fijos o de RRHH); quien decide la fuente es `ui/`.

Entradas: sobres de gastos fijos (+ el sobre Sueldos si hay RRHH) → `F` total
mensual; `cmvPct`; `varPct` (`costos_variables_pct`); `ventasMes`;
`diasTranscurridos`, `diasOperativosMes`; y opcionalmente el histórico de
ventas por día de la semana.

- **`cmvPct`:** food cost / CMV teórico del mes (Fase 3) **si hay datos
  suficientes** — definido como **≥ 7 días operativos con ventas y ≥ 100
  unidades vendidas** (constantes en el core, con test); si no,
  `cmv_objetivo_pct`.
- **`ventasMes`:** suma de ingresos de caja con categoría en
  `categorias_venta`, `activo = true`, por `fecha_operativa` del mes. La
  fuente es `movimientos_caja` y no `pedidos`, para que el tablero funcione
  también sin el módulo Ventas.
- **Neto de IVA:** si la empresa es responsable inscripto, `ventasMes` entra
  neta (`÷ (1 + IVA)`); para monotributo/exento, tal cual (Fase 6).

Salidas:

1. **Margen de contribución** `mc = 1 − cmvPct − varPct` (error claro si
   `mc ≤ 0`; no divide por cero).
   **Punto de equilibrio** mensual `PE = F / mc`; diario `PEd = PE /
   diasOperativosMes`.
2. **Reparto de cada peso que entra** (método proporcional, fácil de
   explicar). De cada $1 de venta:
   - **Proveedores / mercadería:** `cmvPct`.
   - **Costos variables:** `varPct`.
   - **Cada gasto fijo `i`:** `mc × F_i / F`, mientras el mes no haya cubierto
     el PE.
   - **Una vez cubierto el PE:** proveedores y costos variables **siguen**
     llevándose `cmvPct` y `varPct`; el resto (`mc`) es **ganancia**.
   - Se expresa como "de cada $10.000 que entran: $3.500 proveedores, $600
     costos variables, $2.100 sueldos, $1.200 alquiler, … $X te queda".
3. **Por cada sobre** (gasto fijo, proveedores, costos variables): apartado
   acumulado del mes, objetivo mensual, % cubierto y si llega antes de su
   `dia_vencimiento` al ritmo actual.
4. **Ritmo del mes:** ventas acumuladas vs `PEd × diasTranscurridos` → "vas $X
   arriba/abajo del equilibrio".
   **Proyección a fin de mes:** si hay histórico, **ponderada por día de la
   semana** (un local de mostrador vende mucho más viernes y sábado; la
   proyección lineal engaña a principio de mes); si no, lineal, marcada como
   "estimación simple".
5. **Reparto del día:** para el cierre de un día, cuánto separar para cada
   sobre.
6. **Redondeo:** método del **mayor resto** — la suma de las partes da
   **exactamente** el total (en vez de cargar el resto de centavos en el
   último sobre).

Tests: sin gastos fijos (no divide por cero); `cmvPct + varPct ≥ 100` (error
claro); mes que ya cubrió el PE; redondeo (suma exacta); proyección con
histórico y sin él; sobre Sueldos con RRHH y sin RRHH.

### 4.3 Pantallas

Grupo propio `{ id: "reparto", titulo: "Reparto de ingresos" }` (para poder
venderlo como módulo). **Solo ADMIN** por defecto; abrirlo a `GERENTE` sería
una opción por empresa a futuro.

1. **Tablero**
   - Arriba: ventas del mes, punto de equilibrio, % cubierto (barra), ganancia
     estimada, proyección.
   - "Reparto de hoy": el último cierre y cuánto separar para cada sobre.
   - Sobres: una tarjeta por gasto fijo, una de **Proveedores** y una de
     **Costos variables**, con barra, objetivo, vencimiento y estado (en
     ritmo / atrasado).
   - **Proveedores con datos reales:** además del % de CMV, la **deuda
     actual** (`Σ proveedores.saldo_total_deuda_centavos`) y lo **agendado en
     los próximos 7 días** (`pagos_programados` pendientes) en efectivo y en
     cuenta.
   - Sobre **Sueldos** (si hay RRHH): total con desglose (sueldos, cargas,
     aguinaldo), cuántos empleados incluye y enlace a RRHH → Empleados.
     Avisos: "N empleados por hora sin horas estimadas" y "N empleados sin
     alta: no incluyen cargas".
2. **Gastos fijos** — ABM simple (alta, edición, baja lógica, orden, y
   categorías de caja mapeadas para el "ya pagado").
3. **Configuración** (ADMIN) — CMV objetivo, costos variables %, días
   operativos, % de cargas, provisión de aguinaldo, categorías de venta.

### 4.4 A tener en cuenta

- **No** crear "cuentas" ni saldos de sobres en la base: todo se calcula al
  vuelo desde ventas, gastos fijos, deuda y agenda.
- Los egresos reales de caja (pago de alquiler, sueldos) se muestran como "ya
  pagado" en cada sobre cuando su categoría está mapeada a él.
- Si hay Ventas activo **y** alguien carga ventas a mano en caja, hay riesgo de
  duplicado: el tablero lo advierte (mismo criterio que 2.5).

### Aceptación

- [ ] F = $3.000.000, CMV 35 %, costos variables 0 %, 30 días → PE ≈ $4.615.385 y PE diario ≈ $153.846.
- [ ] Con los mismos datos y **costos variables 6 %** → PE ≈ $5.084.746.
- [ ] La suma del reparto de un cierre da **exactamente** el total del cierre.
- [ ] Funciona sin el módulo Ventas, con ingresos cargados a mano.
- [ ] Con RRHH: dar de alta un empleado con sueldo mensual actualiza el sobre Sueldos sin tocar gastos fijos.
- [ ] Un aumento con vigencia futura no cambia el sobre hasta esa fecha.
- [ ] 2 empleados de $800.000, **ambos con alta**, cargas 20 % y aguinaldo activo: sueldos $1.600.000 + cargas $320.000 + aguinaldo $133.333 + cargas s/aguinaldo $26.667 = **≈ $2.080.000**.
- [ ] El mismo caso con **uno sin alta**: no se suman cargas de ese empleado y el aviso "sin alta" cuenta 1.
- [ ] Un empleado `monotributista` no genera cargas ni aguinaldo.
- [ ] Un `GERENTE` no ve el Tablero **ni** puede invocar `gasto_empleados_mensual`.
- [ ] Sin RRHH, el sobre Sueldos sale de los gastos fijos categoría `sueldos`.

---

## Fase 5 — Puesta en marcha de un cliente

Playbook **genérico**: se aplica a cualquier cliente nuevo. El primero
(hamburguesería monotributista de mostrador, abierta de noche) es el piloto.

### 5.0 Entornos y despliegue

- **Hoy cada merge a `main` se publica** (GitHub Pages). Antes de que un
  cliente opere con plata real, separar **producción** y **staging**:
  - un proyecto Supabase de pruebas distinto del real;
  - selección de entorno por *hostname* en `js/config/supabase.js` (staging
    en una rama/ruta aparte);
  - los PR se prueban en staging y recién después se mergean.
- **Backups:** pasar a un plan de Supabase **con backups automáticos** antes
  del primer cierre real (el plan gratuito no los garantiza para datos de
  ventas y sueldos). Documentar cómo restaurar.
- Heartbeat: ya existe (`supabase/heartbeat.sql` + workflow); en producción
  con plan pago deja de ser necesario pero no molesta.

### 5.1 Checklist de alta de un cliente

1. Crear la empresa y el ADMIN (`bootstrap.sql` o `crear_empresa_y_admin`).
2. Fijar parámetros: zona horaria, `condicion_fiscal`, `hora_corte_dia`,
   medios de pago, alias, WhatsApp (por `set_config_empresa`).
3. Activar módulos (SQL Editor): `modulos = '{admin,costos,carta,rrhh,ventas,reparto}'`
   o los que contrató.
4. Si tiene RRHH: activar el módulo (RRHH → Configuración) y cargar
   **empleados** con sueldo vigente, **fecha de ingreso y fecha de alta** (si
   corresponde), modalidad y horas estimadas si cobran por hora. Definir con
   el dueño o su contador el **% de cargas sociales**.
5. Cargar insumos, recetas y la **carta de venta** (`vende_en_mostrador`,
   `categoria_venta`, adicionales). Partir de la carta que ya usa el cliente.
6. Cargar proveedores y **gastos fijos** (alquiler, servicios, etc., **sin
   sueldos** si hay RRHH). *Opcional recomendado:* pantalla **"Importar desde
   Excel"** para proveedores, insumos y gastos fijos con SheetJS (versión
   fijada, ver 0.9), vista previa y validación antes de guardar.
7. Crear usuarios con `vincular_usuario` (ver 0.3), incluido el `CAJERO`.
8. **Una semana en paralelo** con el sistema anterior: comparar cada noche el
   cierre de caja. Criterio de salida: 7 cierres seguidos con diferencia ≤ la
   tolerancia que el dueño defina.
9. Capacitación breve del cajero (abrir caja, armar pedido, anular, cerrar) y
   una hoja de papel para la contingencia sin conexión.

### 5.2 Criterios para dar un cliente por "en producción"

- [ ] Fase 0 cerrada y verde en CI.
- [ ] Backups activos y un restore probado.
- [ ] Semana en paralelo completa.
- [ ] El dueño sabe leer el cierre y el tablero.

---

## Fase 6 — Backlog de producto

Cosas **previsibles** para un producto genérico; el modelo ya las contempla
pero la pantalla llega después. Cada una se prioriza con el siguiente cliente.

- **Política fiscal por empresa** (resuelve H11): `condicion_fiscal`
  (`monotributo` / `responsable_inscripto` / `exento`) gobierna el costeo y la
  rentabilidad.
  - Monotributo y exento: el IVA de las compras **es costo** (hoy, siempre).
  - Responsable inscripto: el IVA de compras con **factura A de proveedor RI**
    es crédito fiscal → el costo del insumo va **neto**; el precio de carta se
    compara **neto de IVA** y las ventas del tablero de reparto se toman netas
    (parte de cada venta es IVA a pagar). `core/fiscal.js` ya tiene
    `recuperaCreditoFiscal()` y `costoRealPorUnidadBase()` ya recibe
    proveedor y tipo de comprobante: falta cablearlo.
  - Se implementa **en SQL y en JS a la vez** (R3) con tests de paridad.
  - No cambia nada para los clientes monotributistas.
- **Pago dividido** en la pantalla (el modelo `pedido_pagos` ya lo permite).
- **Propinas** y recargos por medio de pago.
- **Cola offline** del mostrador (service worker + sincronización con
  `client_uuid`).
- Impresión directa sin diálogo (WebUSB / puente ESC/POS) y tickets fiscales. La impresión básica de comandas sí está en la Fase 2.
- **Inventario / stock:** descuento por venta, conteos, y con eso el "food cost
  real". Hasta entonces, CMV teórico + compras.
- **Facturación electrónica (ARCA):** requiere certificado y un servidor; no es
  seguro hacerlo 100 % en el navegador. Dejar `pedidos` listo para sumar un
  `comprobante_id`.
- **Pedidos online** del cliente final; **salón / mesas / mozos**.
- **Multi-sucursal** completo (el modelo ya tiene `sucursal_id`).
- **Bloqueo duro por módulo** en RLS (hoy es de experiencia).
- **Notificaciones** (vencimientos de documentos, deuda, tablero).
- **Consola de superadmin** para el dueño del producto (módulos, planes,
  alta de clientes).

---

## Matriz de roles (propuesta por defecto)

R = lectura, W = escritura (alta/edición/baja lógica), — = sin acceso.
Es **configuración de producto**: se ajusta con el primer cliente real, pero
lo que figura como "—" **no se abre sin una razón escrita**.

| Recurso | ADMIN | GERENTE | COCINA | AUDITOR | CAJERO |
|---|---|---|---|---|---|
| `empresas` (nombre, CUIT) | R/W | R | R | R | R (vía `config_cobro()`) |
| `empresas` (alias, módulos, parámetros) | solo por RPC | — | — | — | — |
| `usuarios` | R/W (por RPC) | R | R (propio) | R (propio) | R (propio) |
| `proveedores` | R/W | R/W | R | R | — |
| `facturas`, `pagos`, `pago_imputaciones` | R/W | R/W | — | R | — |
| `pagos_programados` (agenda) | R/W | R/W | — | R | — |
| `movimientos_caja` | R/W | R/W | — | R | — |
| `insumos`, `historial_precios_insumo` | R/W | R/W | R/W | R | — |
| `recetas`, `ingredientes_receta` | R/W | R/W | R/W | R | — (carta vía `carta_mostrador()`) |
| `catalogos` | R/W | R/W | R | R | — |
| RRHH: `empleados`, `ausencias`, `documentos` | R/W | R/W | — | — | — |
| RRHH: `empleados_sueldos`, `empleados_legajo` | R/W | — | — | — | — |
| Ventas: `turnos_caja`, `pedidos`, `pedido_items`, `pedido_pagos` | R | R | — | R | R (turno abierto) |
| Ventas: operaciones (abrir, pedido, anular, cerrar) | RPC | RPC | — | — | RPC (acotado) |
| `reabrir_turno` | RPC | — | — | — | — |
| `gastos_fijos`, tablero de reparto | R/W | — | — | — | — |
| `auditoria` | R | — | — | — | — |

Notas:

- Las **RPC de escritura** chequean el rol adentro (R1): la matriz vale por la
  vía de tablas **y** por la de funciones.
- `AUDITOR` es **estrictamente lectura**.
- `COCINA` ve proveedores e insumos para trabajar con la carta, pero no la
  contabilidad.
- `CAJERO` no toca ninguna tabla de negocio directamente.

---

## Orden de los scripts SQL

Se ejecutan en este orden (cada uno idempotente, con cabecera que lo indica).
Los existentes quedan como están.

**Existentes (instalación nueva):** `schema.sql` → `functions.sql` →
`catalogos.sql` → `pagos_programados.sql` → `movimientos_caja.sql` →
`rrhh.sql` → migraciones (`migracion_*.sql`) → `heartbeat.sql`.

**Nuevos:**

| # | Archivo | Fase |
|---|---|---|
| 1 | `f0_roles_rls.sql` (helpers, políticas por rol, chequeo de rol en RPC) | 0.1 |
| 2 | `f0_auditoria.sql` (tabla + `auditar()`) | 0.8 |
| 3 | `f0_empresas_columnas.sql` (grants por columna, `set_config_empresa`) | 0.2 |
| 4 | `f0_usuarios.sql` (activos, `CAJERO`, `vincular_usuario`, salvaguardas) | 0.3 |
| 5 | `f0_zona_horaria.sql` (`zona_horaria`, `hoy_empresa()`, reemplazos) | 0.4 |
| 6 | `f0_integridad.sql` (`anular_pago`, soft-delete donde corresponda) | 0.5 |
| 7 | `f0_costeo.sql` (`costo_receta`, `recalcular_costos`, precisión) | 0.7 |
| 8 | `f0_rpc_atomicas.sql` (`guardar_receta`, `crear_insumo`, …) | 0.6 |
| 9 | `f1_modulos_empresa.sql` | 1 |
| 10 | `f2_ventas.sql` (config, tablas, RLS, `fecha_operativa`) | 2 |
| 11 | `f2_caja_ventas.sql` (cambios a `movimientos_caja`) | 2.5 |
| 11b | `f2_ventas_rpc.sql` (RPC del mostrador) | 2.4 |
| 12 | `f3_ventas_reportes.sql` (vistas `v_ventas_*`, `compras_periodo`, `set_config_reportes`) | 3 |
| 13 | `f4_reparto.sql` | 4 |

Cada fase entrega además su carpeta de tests en `supabase/tests/`.

---

## Decisiones abiertas

Resolver con el dueño del producto **antes** de la fase indicada.

| # | Pregunta | Antes de | Propuesta |
|---|---|---|---|
| D1 | ¿Quién activa módulos: solo el dueño del producto o también el ADMIN del cliente? | Fase 1 | Solo el dueño (SQL / superadmin) |
| D2 | ¿Matriz de roles tal cual (¿`COCINA` puede escribir insumos y recetas)? | Fase 0.1 | Tal cual; ajustar con el primer cliente |
| D3 | ¿`CAJERO` puede anular pedidos en su turno abierto? | Fase 2 | Sí, con motivo obligatorio y auditado |
| D4 | ¿Un alias de cobro único o uno por medio (transferencia / QR)? | Fase 2 | Uno solo en v1 |
| D5 | ¿`GERENTE` puede ver el Tablero de reparto? | Fase 4 | No (opción futura por empresa) |
| D6 | ¿`porcentaje_merma`: se aplica o se elimina? | Fase 0.7 | Decidir; hoy es una columna muerta |
| D7 | ¿Staging en un proyecto Supabase aparte? | Fase 5 | Sí, antes del primer cierre real |
| D8 | Tolerancia de diferencia de caja para dar por buena la semana en paralelo | Fase 5 | La define el dueño del local |
| D9 | ¿`documentos` y `ausencias` de RRHH: baja lógica o `delete` auditado? | Fase 0.5 | Baja lógica |

---

## Estimación y orden

| Fase | Estimación |
|---|---|
| 0. Base segura (roles, empresas, usuarios, fechas, integridad, RPC atómicas, costeo SQL, auditoría, CI) | 5 a 7 días |
| 1. Módulos activables | 1 a 2 días |
| 2. Ventas (mostrador, turnos, cierre → caja) | 7 a 9 días |
| 3. Rentabilidad real | 2 a 3 días |
| 4. Tablero de reparto (incluye RPC de sueldos desde RRHH) | 5 a 7 días |
| 5. Puesta en marcha + semana en paralelo | 3 días + 1 semana |
| 6. Backlog de producto | se prioriza por cliente |

Recomendación de corte para entregar valor temprano:
**Fase 0 → Fase 1 → Fase 2 (2a: turnos, pedidos y cierre; 2b: historial,
configuración y comanda) → Fase 3 → Fase 4 → Fase 5.**

## Fuera de alcance (no implementar ahora)

- Facturación electrónica / ARCA (ver Fase 6; dejar el modelo listo).
- Pedidos online hechos por el cliente final.
- Salón, mesas, mozos.
- Descuento de stock por venta (llega con inventario).
- Cola offline del mostrador (v1 solo avisa y bloquea).

## Instrucciones para Claude Code

- **Una fase por sesión.** Antes de codear, leé los archivos listados en §0 y
  confirmá el plan de la fase en pocas líneas.
- Orden dentro de cada fase: **`core/` con sus tests → SQL con sus tests →
  `data/` → `ui/`.**
- **Todo SQL se ejecuta contra un PostgreSQL real** (§2) y se entrega con su
  test. No se entrega SQL "a ojo".
- Cada script SQL nuevo: idempotente, con cabecera como los existentes y la
  aclaración de **en qué orden se ejecuta**.
- **No romper lo existente:** si una migración cambia una tabla en uso
  (`movimientos_caja`, `recetas`, `empresas`, `usuarios`), los valores por
  defecto deben dejar a las empresas actuales funcionando igual.
- Las pantallas nuevas **se diseñan para el producto, no para un cliente**:
  probarlas con dos perfiles distintos (§0).
- Al cerrar cada fase: `npm test` y `supabase/tests/run.sh` en verde, sección
  nueva en `docs/manual.md`, actualizar `README.md` y entregar **la lista de
  SQL a correr en Supabase, en orden**.
- Cada PR en borrador; el merge a `main` lo autoriza el dueño del producto
  (cada merge se publica).
