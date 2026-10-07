-- ============================================================================
-- SaaS Gastronómico — Esquema SQL (Fases 1–4) para Supabase / PostgreSQL
-- ----------------------------------------------------------------------------
-- Módulo: Compras, Costos y Rentabilidad (multi-tenant).
-- La Fase 5 (Inventario/sectores/movimientos/ventas) NO se incluye todavía.
--
-- Convenciones (heredadas de la app y del diagnóstico):
--   • Dinero = ENTERO en CENTAVOS (BIGINT). Nunca float. (Regla de Oro 3.3)
--   • Toda tabla de negocio lleva empresa_id para aislamiento multi-tenant.
--   • Soft delete: columna `activo` (nada se borra físicamente).
--   • Auditoría: creado_en / creado_por / modificado_en / modificado_por.
--   • Aislamiento por empresa vía RLS + función mi_empresa() (sin custom JWT).
--
-- Cómo usar: pegar TODO este archivo en Supabase → SQL Editor → Run.
-- Es idempotente en lo posible (usa IF NOT EXISTS / CREATE OR REPLACE).
-- ============================================================================

create extension if not exists "uuid-ossp";

-- ============================================================================
-- 0. HELPERS DE AUDITORÍA Y TENANT
-- ============================================================================

-- Setea modificado_en en cada UPDATE.
create or replace function set_modificado_en()
returns trigger language plpgsql as $$
begin
  new.modificado_en := now();
  return new;
end;
$$;

-- NOTA: las funciones de tenant mi_empresa() / mi_rol() se definen más abajo
-- (sección 4.5), DESPUÉS de crear la tabla `usuarios`, porque una función SQL
-- se valida contra el esquema al momento de crearse.

-- ============================================================================
-- 1. CORE MULTI-TENANT
-- ============================================================================

create table if not exists empresas (
  id              uuid primary key default uuid_generate_v4(),
  nombre          varchar(255) not null,
  cuit_rut        varchar(50),
  -- Política de costeo de ESTA empresa:
  --   true  → costea con IVA incluido (precio final).
  --   false → descuenta IVA como crédito fiscal cuando corresponde (Factura A + RI).
  costea_con_iva  boolean not null default true,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  creado_por      uuid,
  modificado_en   timestamptz not null default now(),
  modificado_por  uuid
);

create table if not exists sucursales (
  id              uuid primary key default uuid_generate_v4(),
  empresa_id      uuid not null references empresas(id) on delete cascade,
  nombre          varchar(255) not null,
  direccion       text,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  creado_por      uuid,
  modificado_en   timestamptz not null default now(),
  modificado_por  uuid
);
create index if not exists ix_sucursales_empresa on sucursales(empresa_id);

-- Perfil de usuario. El id coincide con auth.users.id (Supabase Auth).
create table if not exists usuarios (
  id              uuid primary key references auth.users(id) on delete cascade,
  empresa_id      uuid not null references empresas(id) on delete cascade,
  email           varchar(255) not null,
  nombre          varchar(255) not null,
  rol             varchar(20) not null default 'COCINA'
                  check (rol in ('ADMIN','GERENTE','COCINA','AUDITOR')),
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  modificado_en   timestamptz not null default now()
);
create index if not exists ix_usuarios_empresa on usuarios(empresa_id);

-- ============================================================================
-- 2. PROVEEDORES Y CUENTAS POR PAGAR
-- ============================================================================

create table if not exists proveedores (
  id                          uuid primary key default uuid_generate_v4(),
  empresa_id                  uuid not null references empresas(id) on delete cascade,
  codigo                      varchar(50),
  nombre                      varchar(255) not null,
  cuit                        varchar(50),
  condicion_fiscal            varchar(30) not null default 'responsable_inscripto'
                              check (condicion_fiscal in ('responsable_inscripto','monotributo','exento')),
  contacto                    varchar(255),
  telefono                    varchar(50),
  email                       varchar(255),
  rubro_principal             varchar(100),
  rubros                      text[] default '{}',
  -- El saldo NO se escribe desde el cliente: lo mueven las RPC de facturas/pagos.
  saldo_total_deuda_centavos  bigint not null default 0,
  activo                      boolean not null default true,
  creado_en                   timestamptz not null default now(),
  creado_por                  uuid,
  modificado_en               timestamptz not null default now(),
  modificado_por              uuid
);
create index if not exists ix_proveedores_empresa on proveedores(empresa_id);

create table if not exists facturas (
  id                          uuid primary key default uuid_generate_v4(),
  empresa_id                  uuid not null references empresas(id) on delete cascade,
  sucursal_id                 uuid references sucursales(id) on delete restrict,
  proveedor_id                uuid not null references proveedores(id) on delete restrict,
  tipo_comprobante            char(1) not null check (tipo_comprobante in ('A','B','C')),
  numero_factura              varchar(50),
  fecha_emision               date not null,
  fecha_vencimiento           date,
  neto_gravado_centavos       bigint not null default 0 check (neto_gravado_centavos >= 0),
  iva_discriminado_centavos   bigint not null default 0 check (iva_discriminado_centavos >= 0),
  percepciones_centavos       bigint not null default 0 check (percepciones_centavos >= 0),
  otros_impuestos_centavos    bigint not null default 0 check (otros_impuestos_centavos >= 0),
  monto_total_centavos        bigint not null default 0 check (monto_total_centavos >= 0),
  saldo_pendiente_centavos    bigint not null default 0 check (saldo_pendiente_centavos >= 0),
  estado                      varchar(20) not null default 'pendiente'
                              check (estado in ('pendiente','parcial','pagada','anulada')),
  observaciones               text,
  activo                      boolean not null default true,
  creado_en                   timestamptz not null default now(),
  creado_por                  uuid,
  modificado_en               timestamptz not null default now(),
  modificado_por              uuid,
  -- Cuadratura obligatoria (Sección 5.4 de la app).
  constraint chk_cuadratura_factura
    check (neto_gravado_centavos + iva_discriminado_centavos
           + percepciones_centavos + otros_impuestos_centavos = monto_total_centavos)
);
create index if not exists ix_facturas_empresa on facturas(empresa_id);
create index if not exists ix_facturas_proveedor on facturas(proveedor_id);
create index if not exists ix_facturas_pendientes
  on facturas(proveedor_id, fecha_emision) where saldo_pendiente_centavos > 0;

-- Migración idempotente: instalaciones existentes (tabla `facturas` ya creada
-- sin esta columna) reciben `otros_impuestos_centavos` (impuesto interno u
-- otros cargos no recuperables, ej. bebidas alcohólicas) y la cuadratura se
-- amplía para contemplarla. No-op en instalaciones nuevas.
alter table facturas add column if not exists otros_impuestos_centavos bigint not null default 0 check (otros_impuestos_centavos >= 0);
alter table facturas drop constraint if exists chk_cuadratura_factura;
alter table facturas add constraint chk_cuadratura_factura
  check (neto_gravado_centavos + iva_discriminado_centavos
         + percepciones_centavos + otros_impuestos_centavos = monto_total_centavos);

create table if not exists pagos (
  id                      uuid primary key default uuid_generate_v4(),
  empresa_id              uuid not null references empresas(id) on delete cascade,
  proveedor_id            uuid not null references proveedores(id) on delete restrict,
  fecha_pago              date not null default current_date,
  monto_pagado_centavos   bigint not null,   -- puede ser negativo (contraasiento)
  metodo_pago             varchar(20) not null default 'transferencia'
                          check (metodo_pago in ('efectivo','transferencia','cheque','echeq','otro')),
  referencia              text,
  modo_imputacion         varchar(10) not null default 'fifo'
                          check (modo_imputacion in ('fifo','manual')),
  estado                  varchar(10) not null default 'activo'
                          check (estado in ('activo','anulado')),
  anula_a_pago_id         uuid references pagos(id) on delete set null,
  anulado_por_pago_id     uuid references pagos(id) on delete set null,
  creado_en               timestamptz not null default now(),
  creado_por              uuid
);
create index if not exists ix_pagos_empresa on pagos(empresa_id);
create index if not exists ix_pagos_proveedor on pagos(proveedor_id);

-- Imputación N:M pago↔factura (reemplaza el array embebido de Firestore).
create table if not exists pago_imputaciones (
  id                      uuid primary key default uuid_generate_v4(),
  empresa_id              uuid not null references empresas(id) on delete cascade,
  pago_id                 uuid not null references pagos(id) on delete cascade,
  factura_id              uuid not null references facturas(id) on delete restrict,
  monto_imputado_centavos bigint not null
);
create index if not exists ix_imput_pago on pago_imputaciones(pago_id);
create index if not exists ix_imput_factura on pago_imputaciones(factura_id);

-- ============================================================================
-- 3. INSUMOS Y COSTOS
-- ============================================================================

create table if not exists insumos (
  id                                    uuid primary key default uuid_generate_v4(),
  empresa_id                            uuid not null references empresas(id) on delete cascade,
  codigo                                varchar(50),
  nombre                                varchar(255) not null,
  rubro                                 varchar(100),
  magnitud                              varchar(20) not null check (magnitud in ('masa','volumen','unidad')),
  unidad_base                           varchar(10) not null,          -- g | ml | un
  costo_neto_por_unidad_base_centavos   bigint not null default 0 check (costo_neto_por_unidad_base_centavos >= 0),
  alicuota_iva                          numeric(5,2) not null default 21
                                        check (alicuota_iva in (0, 10.5, 21, 27)),
  factor_correccion                     numeric(8,4) not null default 1 check (factor_correccion > 0),
  presentacion_desc                     varchar(120),
  presentacion_cantidad_base            numeric(14,4),                 -- en unidad base
  presentacion_precio_neto_centavos     bigint,
  presentacion_magnitud                 varchar(20),                   -- magnitud de COMPRA
  presentacion_cantidad                 numeric(14,4),                 -- cantidad de compra (en presentacion_unidad)
  presentacion_unidad                   varchar(10),
  unidad_uso                            varchar(10),                   -- unidad de USO elegida (ml, oz, g...)
  proveedor_habitual_id                 uuid references proveedores(id) on delete set null,
  fecha_ultimo_precio                   timestamptz,
  activo                                boolean not null default true,
  creado_en                             timestamptz not null default now(),
  creado_por                            uuid,
  modificado_en                         timestamptz not null default now(),
  modificado_por                        uuid
);
create index if not exists ix_insumos_empresa on insumos(empresa_id);

create table if not exists historial_precios_insumo (
  id                          uuid primary key default uuid_generate_v4(),
  empresa_id                  uuid not null references empresas(id) on delete cascade,
  insumo_id                   uuid not null references insumos(id) on delete cascade,
  costo_anterior_centavos     bigint not null default 0,
  costo_nuevo_centavos        bigint not null,
  variacion_porcentual        numeric(8,2) not null default 0,
  origen                      varchar(20) not null default 'manual'
                              check (origen in ('factura','manual','carga_inicial')),
  factura_id                  uuid references facturas(id) on delete set null,
  usuario                     uuid,
  fecha                       timestamptz not null default now()
);
create index if not exists ix_histprecio_insumo on historial_precios_insumo(insumo_id, fecha);

-- ============================================================================
-- 4. RENTABILIDAD Y ESCANDALLOS
-- ============================================================================

create table if not exists recetas (
  id                              uuid primary key default uuid_generate_v4(),
  empresa_id                      uuid not null references empresas(id) on delete cascade,
  codigo                          varchar(50),
  nombre                          varchar(255) not null,
  tipo                            varchar(20) not null default 'plato'
                                  check (tipo in ('plato','preparacion')),
  rendimiento_cantidad            numeric(14,4) not null default 1 check (rendimiento_cantidad > 0),
  rendimiento_unidad              varchar(20) not null default 'un',
  precio_venta_publico_centavos   bigint not null default 0 check (precio_venta_publico_centavos >= 0),
  alicuota_venta                  numeric(5,2) not null default 0,
  sector_venta                    varchar(100),
  costo_calculado_centavos        bigint not null default 0,     -- snapshot desnormalizado
  fecha_calculo                   timestamptz,
  activo                          boolean not null default true,
  creado_en                       timestamptz not null default now(),
  creado_por                      uuid,
  modificado_en                   timestamptz not null default now(),
  modificado_por                  uuid
);
create index if not exists ix_recetas_empresa on recetas(empresa_id);

create table if not exists ingredientes_receta (
  id                  uuid primary key default uuid_generate_v4(),
  empresa_id          uuid not null references empresas(id) on delete cascade,
  receta_padre_id     uuid not null references recetas(id) on delete cascade,
  insumo_id           uuid references insumos(id) on delete restrict,
  subreceta_hija_id   uuid references recetas(id) on delete restrict,
  cantidad            numeric(14,4) not null,        -- en unidad base del ingrediente
  porcentaje_merma    numeric(5,2) not null default 0,
  orden               int not null default 0,
  -- Un ingrediente es un insumo O una sub-receta, nunca ambos ni ninguno.
  constraint chk_ingrediente_tipo check (
    (insumo_id is not null and subreceta_hija_id is null) or
    (insumo_id is null and subreceta_hija_id is not null)
  )
);
create index if not exists ix_ingr_receta on ingredientes_receta(receta_padre_id);

-- ============================================================================
-- 4.5. FUNCIONES DE TENANT (ya existe la tabla usuarios)
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER: corren con permisos elevados para no chocar con la RLS de
-- `usuarios` (evita recursión de políticas).
-- ============================================================================

-- Devuelve la empresa_id del usuario autenticado.
-- En plpgsql el cuerpo NO se valida al crear la función (se resuelve al
-- ejecutar), así que el orden de creación nunca da problemas.
create or replace function mi_empresa()
returns uuid language plpgsql stable security definer set search_path = public as $$
begin
  return (select empresa_id from public.usuarios where id = auth.uid());
end;
$$;

-- Rol del usuario autenticado.
create or replace function mi_rol()
returns text language plpgsql stable security definer set search_path = public as $$
begin
  return (select rol from public.usuarios where id = auth.uid());
end;
$$;

-- ============================================================================
-- 5. TRIGGERS DE modificado_en
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'empresas','sucursales','proveedores','facturas','insumos','recetas'
  ] loop
    execute format('drop trigger if exists trg_mod_%1$s on %1$s;', t);
    execute format(
      'create trigger trg_mod_%1$s before update on %1$s
       for each row execute function set_modificado_en();', t);
  end loop;
end $$;

-- ============================================================================
-- 6. ROW LEVEL SECURITY (aislamiento por empresa)
-- ----------------------------------------------------------------------------
-- Patrón: cada usuario ve/escribe SOLO filas de su empresa (mi_empresa()).
-- La tabla `usuarios` tiene reglas especiales (ver abajo).
-- Las escrituras de saldos las hacen las RPC (SECURITY DEFINER), no el cliente.
-- ============================================================================

-- Tablas con aislamiento simple por empresa_id.
do $$
declare t text;
begin
  foreach t in array array[
    'empresas','sucursales','proveedores','facturas','pagos','pago_imputaciones',
    'insumos','historial_precios_insumo','recetas','ingredientes_receta'
  ] loop
    execute format('alter table %s enable row level security;', t);
    execute format('drop policy if exists tenant_all on %s;', t);
  end loop;
end $$;

-- empresas: el usuario ve/edita SU empresa (por id, no por empresa_id).
create policy tenant_all on empresas
  for all to authenticated
  using (id = mi_empresa())
  with check (id = mi_empresa());

-- Resto de tablas: filtran por empresa_id = mi_empresa().
do $$
declare t text;
begin
  foreach t in array array[
    'sucursales','proveedores','facturas','pagos','pago_imputaciones',
    'insumos','historial_precios_insumo','recetas','ingredientes_receta'
  ] loop
    execute format($f$
      create policy tenant_all on %s
        for all to authenticated
        using (empresa_id = mi_empresa())
        with check (empresa_id = mi_empresa());
    $f$, t);
  end loop;
end $$;

-- usuarios: se lee la propia empresa; solo ADMIN da de alta/edita perfiles.
alter table usuarios enable row level security;
drop policy if exists usuarios_read on usuarios;
drop policy if exists usuarios_write on usuarios;
drop policy if exists usuarios_update on usuarios;

create policy usuarios_read on usuarios
  for select to authenticated
  using (empresa_id = mi_empresa());

create policy usuarios_write on usuarios
  for insert to authenticated
  with check (empresa_id = mi_empresa() and mi_rol() = 'ADMIN');

create policy usuarios_update on usuarios
  for update to authenticated
  using (empresa_id = mi_empresa() and mi_rol() = 'ADMIN')
  with check (empresa_id = mi_empresa() and mi_rol() = 'ADMIN');

-- ============================================================================
-- FIN. Próximo archivo a ejecutar: supabase/functions.sql (RPC + bootstrap).
-- ============================================================================
