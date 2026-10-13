-- ============================================================================
-- SaaS Gastronómico — Fase 2 (1/3): Ventas de mostrador — modelo de datos
-- ----------------------------------------------------------------------------
-- Genérico para cualquier local con mostrador o venta rápida. Nada de un
-- cliente en particular: todo lo propio de un negocio es CONFIGURACIÓN de la
-- empresa (alias de cobro, WhatsApp, medios de pago, delivery, hora de corte,
-- cómo se despacha la comanda…).
--
-- Contiene:
--   • columnas de configuración de ventas en `empresas` (se cambian SOLO por
--     set_config_ventas(), solo ADMIN, con auditoría);
--   • columnas de venta en `recetas` (un producto vendible = receta tipo plato);
--   • tablas turnos_caja, pedidos, pedido_pagos, pedido_items (solo lectura
--     por API; todo se escribe por RPC → f2_ventas_rpc.sql);
--   • fecha_operativa() (el día de negocio puede terminar después de medianoche).
--
-- Orden: después de f1_modulos_empresa.sql.
--        Luego: f2_caja_ventas.sql → f2_ventas_rpc.sql.   Idempotente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Configuración de ventas por empresa
-- ---------------------------------------------------------------------------
alter table empresas add column if not exists alias_transferencia varchar(60);
alter table empresas add column if not exists whatsapp_cocina varchar(30);
alter table empresas add column if not exists costo_envio_default_centavos bigint not null default 0;
alter table empresas add column if not exists hora_corte_dia time not null default '06:00';
alter table empresas add column if not exists medios_pago_habilitados text[] not null
  default '{efectivo,transferencia}';
alter table empresas add column if not exists usa_delivery boolean not null default false;
-- Cómo sale la comanda a cocina:
--   whatsapp              → enlace de WhatsApp (por defecto, no requiere hardware)
--   impresora             → se imprime en la impresora del local
--   impresora_whatsapp    → imprime; si falla, ofrece WhatsApp como respaldo
alter table empresas add column if not exists modo_comanda varchar(20) not null default 'whatsapp';
alter table empresas add column if not exists ancho_ticket_mm int not null default 80;
-- Plantilla de texto de la comanda (null = formato estándar del sistema).
alter table empresas add column if not exists plantilla_comanda text;

alter table empresas drop constraint if exists empresas_ventas_check;
alter table empresas add constraint empresas_ventas_check check (
  costo_envio_default_centavos >= 0
  and modo_comanda in ('whatsapp', 'impresora', 'impresora_whatsapp')
  and ancho_ticket_mm in (58, 80)
  and cardinality(medios_pago_habilitados) > 0
  and medios_pago_habilitados <@ array['efectivo','transferencia','tarjeta','qr','otro']::text[]
  and (plantilla_comanda is null or length(plantilla_comanda) <= 2000)
);

-- Las columnas nuevas NO se agregan al grant por columna de `empresas`
-- (f0_empresas_columnas.sql): ni un ADMIN las escribe directo.
revoke update (alias_transferencia, whatsapp_cocina, costo_envio_default_centavos, hora_corte_dia,
               medios_pago_habilitados, usa_delivery, modo_comanda, ancho_ticket_mm, plantilla_comanda)
  on empresas from authenticated;

-- ---------------------------------------------------------------------------
-- 2) Recetas vendibles
-- ---------------------------------------------------------------------------
alter table recetas add column if not exists vende_en_mostrador boolean not null default false;
alter table recetas add column if not exists categoria_venta varchar(60);
alter table recetas add column if not exists orden_venta int not null default 0;
alter table recetas add column if not exists es_adicional boolean not null default false;

alter table recetas drop constraint if exists chk_vende_solo_platos;
alter table recetas add constraint chk_vende_solo_platos check (not vende_en_mostrador or tipo = 'plato');

-- ---------------------------------------------------------------------------
-- 3) fecha_operativa: el día de negocio de un instante.
--    Si el instante (en la zona de la empresa) es anterior a la hora de corte,
--    pertenece al día anterior. Espejo en js/core/utilsFecha.js (mismos casos).
-- ---------------------------------------------------------------------------
create or replace function fecha_operativa(p_instante timestamptz, p_zona text, p_corte time default '06:00')
returns date language sql stable as $$
  select ((p_instante at time zone coalesce(nullif(p_zona, ''), 'America/Argentina/Buenos_Aires'))
          - coalesce(p_corte, time '06:00')::interval)::date $$;
grant execute on function fecha_operativa(timestamptz, text, time) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Tablas
-- ---------------------------------------------------------------------------
create table if not exists turnos_caja (
  id                          uuid primary key default uuid_generate_v4(),
  empresa_id                  uuid not null references empresas(id) on delete cascade,
  sucursal_id                 uuid references sucursales(id) on delete restrict,
  fecha_operativa             date not null,
  estado                      varchar(10) not null default 'abierto' check (estado in ('abierto','cerrado')),
  fondo_inicial_centavos      bigint not null default 0 check (fondo_inicial_centavos >= 0),
  efectivo_contado_centavos   bigint check (efectivo_contado_centavos is null or efectivo_contado_centavos >= 0),
  efectivo_esperado_centavos  bigint,
  abierto_en                  timestamptz not null default now(),
  abierto_por                 uuid,
  cerrado_en                  timestamptz,
  cerrado_por                 uuid,
  nota_cierre                 text
);
-- Un solo turno abierto por empresa (y por sucursal si se usa).
create unique index if not exists ux_turno_abierto
  on turnos_caja (empresa_id, coalesce(sucursal_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where estado = 'abierto';
create index if not exists ix_turnos_empresa_fecha on turnos_caja (empresa_id, fecha_operativa);

create table if not exists pedidos (
  id                    uuid primary key default uuid_generate_v4(),
  empresa_id            uuid not null references empresas(id) on delete cascade,
  turno_id              uuid not null references turnos_caja(id) on delete restrict,
  numero                int not null,
  client_uuid           uuid,
  cliente_nombre        varchar(120),
  cliente_telefono      varchar(40),
  modalidad             varchar(10) not null default 'retiro' check (modalidad in ('retiro','delivery','local')),
  direccion             text,
  subtotal_centavos     bigint not null check (subtotal_centavos >= 0),
  descuento_centavos    bigint not null default 0 check (descuento_centavos >= 0),
  envio_centavos        bigint not null default 0 check (envio_centavos >= 0),
  total_centavos        bigint not null check (total_centavos >= 0),
  costo_total_centavos  bigint not null default 0,
  alias_cobro           varchar(60),
  estado                varchar(12) not null default 'confirmado' check (estado in ('confirmado','entregado','anulado')),
  motivo_anulacion      text,
  anulado_por           uuid,
  anulado_en            timestamptz,
  nota                  text,
  -- Cómo se despachó la comanda a cocina (null = todavía no se envió/imprimió).
  comanda_via           varchar(10) check (comanda_via in ('impresora','whatsapp')),
  comanda_en            timestamptz,
  creado_en             timestamptz not null default now(),
  creado_por            uuid,
  unique (turno_id, numero),
  constraint chk_descuento check (descuento_centavos <= subtotal_centavos)
);
create unique index if not exists ux_pedido_client_uuid
  on pedidos (empresa_id, client_uuid) where client_uuid is not null;
create index if not exists ix_pedidos_turno on pedidos (empresa_id, turno_id);

create table if not exists pedido_pagos (
  id              uuid primary key default uuid_generate_v4(),
  empresa_id      uuid not null references empresas(id) on delete cascade,
  pedido_id       uuid not null references pedidos(id) on delete cascade,
  medio           varchar(20) not null check (medio in ('efectivo','transferencia','tarjeta','qr','otro')),
  monto_centavos  bigint not null check (monto_centavos > 0)
);
create index if not exists ix_pedido_pagos_pedido on pedido_pagos (pedido_id);

create table if not exists pedido_items (
  id                    uuid primary key default uuid_generate_v4(),
  empresa_id            uuid not null references empresas(id) on delete cascade,
  pedido_id             uuid not null references pedidos(id) on delete cascade,
  receta_id             uuid not null references recetas(id) on delete restrict,
  item_padre_id         uuid references pedido_items(id) on delete cascade,
  nombre_snapshot       varchar(255) not null,
  cantidad              int not null check (cantidad > 0),
  precio_unit_centavos  bigint not null check (precio_unit_centavos >= 0),
  costo_unit_centavos   bigint not null default 0,
  nota                  text
);
create index if not exists ix_items_pedido on pedido_items (pedido_id);
create index if not exists ix_items_receta on pedido_items (empresa_id, receta_id);

-- ---------------------------------------------------------------------------
-- 5) RLS: solo lectura por API (matriz: ADMIN/GERENTE/AUDITOR ven todo;
--    CAJERO solo el turno abierto; COCINA nada). Escribe únicamente la RPC.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['turnos_caja', 'pedidos', 'pedido_pagos', 'pedido_items'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists leer on %I', t);
    execute format('revoke insert, update, delete on %I from authenticated', t);
  end loop;
end $$;

create policy leer on turnos_caja for select to authenticated using (
  empresa_id = mi_empresa()
  and (rol_en('ADMIN', 'GERENTE', 'AUDITOR') or (rol_en('CAJERO') and estado = 'abierto')));

create policy leer on pedidos for select to authenticated using (
  empresa_id = mi_empresa()
  and (rol_en('ADMIN', 'GERENTE', 'AUDITOR')
       or (rol_en('CAJERO') and exists (select 1 from turnos_caja t
                                         where t.id = pedidos.turno_id and t.estado = 'abierto'))));

create policy leer on pedido_pagos for select to authenticated using (
  empresa_id = mi_empresa()
  and (rol_en('ADMIN', 'GERENTE', 'AUDITOR')
       or (rol_en('CAJERO') and exists (select 1 from pedidos p join turnos_caja t on t.id = p.turno_id
                                         where p.id = pedido_pagos.pedido_id and t.estado = 'abierto'))));

create policy leer on pedido_items for select to authenticated using (
  empresa_id = mi_empresa()
  and (rol_en('ADMIN', 'GERENTE', 'AUDITOR')
       or (rol_en('CAJERO') and exists (select 1 from pedidos p join turnos_caja t on t.id = p.turno_id
                                         where p.id = pedido_items.pedido_id and t.estado = 'abierto'))));
