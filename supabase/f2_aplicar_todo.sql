-- ============================================================================
-- SaaS Gastronómico — FASE 2 (Ventas de mostrador), base de datos completa
-- (generado con gen_f2.sh: no editar a mano)
-- Pegar y ejecutar UNA vez en el SQL Editor de Supabase, DESPUÉS de la Fase 0 y
-- la Fase 1. Es idempotente. Orden: f2_ventas, f2_caja_ventas, f2_ventas_rpc.
-- Para usar el módulo, activarlo en la empresa:
--   update empresas set modulos = '{admin,costos,carta,rrhh,ventas}' where nombre = '...';
-- ============================================================================

-- >>>>>>>>>> f2_ventas.sql
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

-- >>>>>>>>>> f2_caja_ventas.sql
-- ============================================================================
-- SaaS Gastronómico — Fase 2 (2/3): cambios en `movimientos_caja`
-- ----------------------------------------------------------------------------
-- El cierre de un turno de ventas vuelca sus totales al Flujo de caja:
--   • origen      'manual' (cargado a mano) | 'cierre_turno' (ventas del cierre)
--                 | 'turno' (salida de efectivo registrada durante el turno)
--   • turno_id    turno que lo generó
--   • activo      baja lógica: nada se borra (si se reabre un turno, sus
--                 movimientos de cierre quedan inactivos)
-- Un movimiento de cierre ACTIVO por (turno, medio): no se duplican cierres.
-- "Borrar" desde la app pasa a ser baja lógica (se intercepta el DELETE), para
-- que el frontend anterior siga funcionando; los movimientos que no son
-- manuales no se pueden borrar (para corregirlos se reabre el turno).
-- Los clientes no pueden fijar origen / turno_id / activo al insertar.
-- Orden: después de f2_ventas.sql (turnos_caja). Idempotente.
-- ============================================================================

alter table movimientos_caja add column if not exists origen varchar(20) not null default 'manual';
alter table movimientos_caja drop constraint if exists movimientos_caja_origen_check;
alter table movimientos_caja add constraint movimientos_caja_origen_check
  check (origen in ('manual', 'cierre_turno', 'turno'));
alter table movimientos_caja add column if not exists turno_id uuid references turnos_caja(id) on delete restrict;
alter table movimientos_caja add column if not exists activo boolean not null default true;

create unique index if not exists ux_movcaja_cierre_turno
  on movimientos_caja (turno_id, medio) where origen = 'cierre_turno' and activo;
create index if not exists ix_movcaja_turno on movimientos_caja (turno_id) where turno_id is not null;

-- Permisos por columna: lo manual se escribe directo; origen/turno_id/activo, no.
revoke insert, update on movimientos_caja from authenticated;
grant insert (empresa_id, fecha, tipo, categoria, medio, monto_centavos, nota, creado_por)
  on movimientos_caja to authenticated;
grant update (fecha, tipo, categoria, medio, monto_centavos, nota) on movimientos_caja to authenticated;

-- Un movimiento no manual no se edita a mano (las políticas ya limitan a ADMIN/GERENTE).
create or replace function _trg_movcaja_manual()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Las RPC de turnos (reabrir_turno) habilitan el cambio con app.permite_mov.
  if old.origen <> 'manual' and coalesce(current_setting('app.permite_mov', true), '') <> '1' then
    raise exception 'Este movimiento lo generó el cierre de caja y no se edita: reabrí el turno para corregirlo.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_movcaja_manual on movimientos_caja;
create trigger trg_movcaja_manual before update on movimientos_caja
  for each row execute function _trg_movcaja_manual();

-- DELETE → baja lógica (con auditoría); los no manuales se rechazan.
create or replace function _trg_movcaja_baja()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.origen <> 'manual' then
    raise exception 'Este movimiento lo generó el cierre de caja y no se borra: reabrí el turno para corregirlo.';
  end if;
  update movimientos_caja set activo = false where id = old.id;
  perform auditar('baja_movimiento_caja', 'movimientos_caja', old.id,
    jsonb_build_object('tipo', old.tipo, 'medio', old.medio, 'monto_centavos', old.monto_centavos, 'fecha', old.fecha),
    jsonb_build_object('activo', false));
  return null;   -- no se borra la fila
end;
$$;
revoke all on function _trg_movcaja_baja() from public, authenticated;
drop trigger if exists trg_movcaja_baja on movimientos_caja;
create trigger trg_movcaja_baja before delete on movimientos_caja
  for each row execute function _trg_movcaja_baja();

-- >>>>>>>>>> f2_ventas_rpc.sql
-- ============================================================================
-- SaaS Gastronómico — Fase 2 (3/3): Ventas de mostrador — funciones RPC
-- ----------------------------------------------------------------------------
-- Todas SECURITY DEFINER, validan empresa y ROL adentro (el CAJERO no toca
-- ninguna tabla de negocio: todo pasa por acá). Precio y costo salen SIEMPRE
-- de la base, nunca del cliente.
--   Configuración : set_config_ventas, config_cobro, configurar_venta_receta
--   Carta         : carta_mostrador
--   Turnos        : abrir_turno, resumen_turno, cerrar_turno, reabrir_turno
--   Pedidos       : crear_pedido, marcar_entregado, anular_pedido, registrar_comanda
--   Efectivo      : registrar_egreso_turno
-- Roles de operación: ADMIN, GERENTE, CAJERO. reabrir_turno: solo ADMIN.
-- Orden: después de f2_ventas.sql y f2_caja_ventas.sql. Idempotente.
-- ============================================================================

create or replace function _ventas_empresa(p_roles text[] default array['ADMIN','GERENTE','CAJERO'])
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_empresa uuid := mi_empresa();
begin
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en(variadic p_roles) then
    raise exception 'Sin permiso: tu rol no puede realizar esta operación.';
  end if;
  if not modulo_activo('ventas') then
    raise exception 'El módulo de ventas no está activo en tu plan.';
  end if;
  return v_empresa;
end;
$$;
revoke all on function _ventas_empresa(text[]) from public, authenticated;

-- ---------------------------------------------------------------------------
-- set_config_ventas(clave, valor) — único camino para la configuración de
-- ventas. Solo ADMIN, lista blanca, validada y auditada.
-- ---------------------------------------------------------------------------
create or replace function set_config_ventas(p_clave text, p_valor jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_antes jsonb; v_txt text; v_arr text[];
begin
  v_empresa := _ventas_empresa(array['ADMIN']);
  v_txt := p_valor #>> '{}';

  select to_jsonb(e) -> p_clave into v_antes from empresas e where id = v_empresa;

  if p_clave = 'alias_transferencia' then
    v_txt := nullif(btrim(coalesce(v_txt, '')), '');
    if v_txt is not null and (length(v_txt) > 60 or v_txt !~ '^[A-Za-z0-9._@\- ]+$') then
      raise exception 'Alias inválido: usá letras, números, punto, guion o arroba (máx. 60).';
    end if;
    update empresas set alias_transferencia = v_txt where id = v_empresa;
  elsif p_clave = 'whatsapp_cocina' then
    v_txt := nullif(regexp_replace(coalesce(v_txt, ''), '[^0-9]', '', 'g'), '');
    if v_txt is not null and length(v_txt) not between 8 and 20 then
      raise exception 'Número de WhatsApp inválido: ingresalo con código de país, solo números.';
    end if;
    update empresas set whatsapp_cocina = v_txt where id = v_empresa;
  elsif p_clave = 'costo_envio_default_centavos' then
    if v_txt is null or v_txt !~ '^[0-9]{1,12}$' then raise exception 'Costo de envío inválido.'; end if;
    update empresas set costo_envio_default_centavos = v_txt::bigint where id = v_empresa;
  elsif p_clave = 'hora_corte_dia' then
    if v_txt is null or v_txt !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Hora de corte inválida (HH:MM).'; end if;
    update empresas set hora_corte_dia = v_txt::time where id = v_empresa;
  elsif p_clave = 'medios_pago_habilitados' then
    if jsonb_typeof(p_valor) <> 'array' then raise exception 'Medios de pago inválidos.'; end if;
    select array_agg(distinct x order by x) into v_arr from jsonb_array_elements_text(p_valor) x;
    if v_arr is null or not (v_arr <@ array['efectivo','transferencia','tarjeta','qr','otro']::text[]) then
      raise exception 'Medios de pago inválidos: efectivo, transferencia, tarjeta, qr u otro (al menos uno).';
    end if;
    update empresas set medios_pago_habilitados = v_arr where id = v_empresa;
  elsif p_clave = 'usa_delivery' then
    if jsonb_typeof(p_valor) <> 'boolean' then raise exception 'Valor inválido: usa_delivery es sí/no.'; end if;
    update empresas set usa_delivery = (p_valor #>> '{}')::boolean where id = v_empresa;
  elsif p_clave = 'modo_comanda' then
    if v_txt is null or v_txt not in ('whatsapp', 'impresora', 'impresora_whatsapp') then
      raise exception 'Modo de comanda inválido.';
    end if;
    update empresas set modo_comanda = v_txt where id = v_empresa;
  elsif p_clave = 'ancho_ticket_mm' then
    if v_txt is null or v_txt not in ('58', '80') then raise exception 'Ancho de ticket inválido (58 u 80 mm).'; end if;
    update empresas set ancho_ticket_mm = v_txt::int where id = v_empresa;
  elsif p_clave = 'plantilla_comanda' then
    v_txt := nullif(btrim(coalesce(v_txt, '')), '');
    if v_txt is not null and length(v_txt) > 2000 then raise exception 'La plantilla es demasiado larga (máx. 2000).'; end if;
    update empresas set plantilla_comanda = v_txt where id = v_empresa;
  else
    raise exception 'Parámetro desconocido: %.', p_clave;
  end if;

  perform auditar('config_ventas', 'empresas', v_empresa,
    jsonb_build_object(p_clave, v_antes), jsonb_build_object(p_clave, p_valor));
end;
$$;
grant execute on function set_config_ventas(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- config_cobro() — lo que el mostrador necesita saber (el cajero no lee `empresas`).
-- ---------------------------------------------------------------------------
create or replace function config_cobro()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_empresa uuid; r empresas;
begin
  v_empresa := _ventas_empresa();
  select * into r from empresas where id = v_empresa;
  return jsonb_build_object(
    'negocio', r.nombre,
    'alias_transferencia', r.alias_transferencia,
    'whatsapp_cocina', r.whatsapp_cocina,
    'medios_pago_habilitados', to_jsonb(r.medios_pago_habilitados),
    'usa_delivery', r.usa_delivery,
    'costo_envio_default_centavos', r.costo_envio_default_centavos,
    'modo_comanda', r.modo_comanda,
    'ancho_ticket_mm', r.ancho_ticket_mm,
    'plantilla_comanda', r.plantilla_comanda,
    'hora_corte_dia', to_char(r.hora_corte_dia, 'HH24:MI'),
    'zona_horaria', r.zona_horaria);
end;
$$;
grant execute on function config_cobro() to authenticated;

-- ---------------------------------------------------------------------------
-- configurar_venta_receta — marca una receta como vendible (ADMIN/GERENTE/COCINA).
-- ---------------------------------------------------------------------------
create or replace function configurar_venta_receta(
  p_receta uuid, p_vende boolean, p_categoria text default null, p_orden int default 0, p_es_adicional boolean default false
) returns void language plpgsql security definer set search_path = public as $$
declare v_empresa uuid := mi_empresa(); r recetas;
begin
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN', 'GERENTE', 'COCINA') then
    raise exception 'Sin permiso: tu rol no puede realizar esta operación.';
  end if;
  select * into r from recetas where id = p_receta and empresa_id = v_empresa;
  if not found then raise exception 'Receta inexistente.'; end if;
  if p_vende then
    if r.tipo <> 'plato' then raise exception 'Solo los platos se pueden vender en el mostrador.'; end if;
    if not r.activo then raise exception 'La receta está dada de baja.'; end if;
    if r.precio_venta_publico_centavos <= 0 then raise exception 'Cargá un precio de venta antes de venderla.'; end if;
  end if;
  if length(coalesce(p_categoria, '')) > 60 then raise exception 'La categoría es demasiado larga (máx. 60).'; end if;
  update recetas set vende_en_mostrador = coalesce(p_vende, false),
    categoria_venta = nullif(btrim(coalesce(p_categoria, '')), ''),
    orden_venta = coalesce(p_orden, 0), es_adicional = coalesce(p_es_adicional, false),
    modificado_en = now()
  where id = p_receta;
end;
$$;
grant execute on function configurar_venta_receta(uuid, boolean, text, int, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- carta_mostrador() — sin costos ni márgenes.
-- ---------------------------------------------------------------------------
create or replace function carta_mostrador()
returns table (id uuid, nombre varchar, precio_centavos bigint, categoria_venta varchar, orden_venta int, es_adicional boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_empresa uuid;
begin
  v_empresa := _ventas_empresa();
  return query
    select r.id, r.nombre, r.precio_venta_publico_centavos, r.categoria_venta, r.orden_venta, r.es_adicional
      from recetas r
     where r.empresa_id = v_empresa and r.vende_en_mostrador and r.activo
     order by r.es_adicional, coalesce(r.categoria_venta, ''), r.orden_venta, r.nombre;
end;
$$;
grant execute on function carta_mostrador() to authenticated;

-- ---------------------------------------------------------------------------
-- Resumen de un turno (interno): se usa al cerrar y para mostrar.
-- ---------------------------------------------------------------------------
create or replace function _resumen_turno(p_turno uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t turnos_caja; v_cant int; v_total bigint; v_anul int; v_anul_monto bigint;
        v_medios jsonb; v_efe bigint; v_egr bigint; v_esp bigint; v_costo bigint;
begin
  select * into t from turnos_caja where id = p_turno;
  select count(*) filter (where estado <> 'anulado'), coalesce(sum(total_centavos) filter (where estado <> 'anulado'), 0),
         count(*) filter (where estado = 'anulado'), coalesce(sum(total_centavos) filter (where estado = 'anulado'), 0),
         coalesce(sum(costo_total_centavos) filter (where estado <> 'anulado'), 0)
    into v_cant, v_total, v_anul, v_anul_monto, v_costo
    from pedidos where turno_id = p_turno;
  select coalesce(jsonb_object_agg(medio, monto), '{}'::jsonb) into v_medios from (
    select pp.medio, sum(pp.monto_centavos)::bigint as monto
      from pedido_pagos pp join pedidos p on p.id = pp.pedido_id
     where p.turno_id = p_turno and p.estado <> 'anulado' group by pp.medio) x;
  v_efe := coalesce((v_medios ->> 'efectivo')::bigint, 0);
  select coalesce(sum(monto_centavos), 0) into v_egr from movimientos_caja
   where turno_id = p_turno and origen = 'turno' and tipo = 'egreso' and medio = 'efectivo' and activo;
  v_esp := t.fondo_inicial_centavos + v_efe - v_egr;
  return jsonb_build_object(
    'turno_id', t.id, 'estado', t.estado, 'fecha_operativa', t.fecha_operativa,
    'pedidos', v_cant, 'ventas_centavos', v_total,
    'anulados', v_anul, 'anulados_centavos', v_anul_monto,
    'por_medio', v_medios,
    'ticket_promedio_centavos', case when v_cant > 0 then round(v_total::numeric / v_cant) else 0 end,
    'costo_total_centavos', v_costo,
    'fondo_inicial_centavos', t.fondo_inicial_centavos,
    'ventas_efectivo_centavos', v_efe, 'egresos_efectivo_centavos', v_egr,
    'efectivo_esperado_centavos', coalesce(t.efectivo_esperado_centavos, v_esp),
    'efectivo_contado_centavos', t.efectivo_contado_centavos,
    'diferencia_centavos', case when t.efectivo_contado_centavos is null then null
                                else t.efectivo_contado_centavos - coalesce(t.efectivo_esperado_centavos, v_esp) end);
end;
$$;
revoke all on function _resumen_turno(uuid) from public, authenticated;

create or replace function resumen_turno(p_turno uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_empresa uuid; t turnos_caja;
begin
  v_empresa := _ventas_empresa(array['ADMIN','GERENTE','AUDITOR','CAJERO']);
  select * into t from turnos_caja where id = p_turno and empresa_id = v_empresa;
  if not found then raise exception 'Turno inexistente.'; end if;
  if rol_en('CAJERO') and t.estado <> 'abierto' then raise exception 'Sin permiso: tu rol solo ve el turno abierto.'; end if;
  return _resumen_turno(p_turno);
end;
$$;
grant execute on function resumen_turno(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- abrir_turno
-- ---------------------------------------------------------------------------
create or replace function abrir_turno(p_fondo_inicial bigint default 0, p_sucursal uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; e empresas; v_id uuid;
begin
  v_empresa := _ventas_empresa();
  if p_fondo_inicial is null or p_fondo_inicial < 0 then raise exception 'El fondo inicial no puede ser negativo.'; end if;
  if p_sucursal is not null and not exists (select 1 from sucursales where id = p_sucursal and empresa_id = v_empresa) then
    raise exception 'Sucursal inexistente.';
  end if;
  select * into e from empresas where id = v_empresa for update;   -- serializa aperturas simultáneas
  if exists (select 1 from turnos_caja where empresa_id = v_empresa and estado = 'abierto'
             and coalesce(sucursal_id, '00000000-0000-0000-0000-000000000000'::uuid)
               = coalesce(p_sucursal, '00000000-0000-0000-0000-000000000000'::uuid)) then
    raise exception 'Ya hay una caja abierta. Cerrala antes de abrir otra.';
  end if;
  insert into turnos_caja (empresa_id, sucursal_id, fecha_operativa, fondo_inicial_centavos, abierto_por)
  values (v_empresa, p_sucursal, fecha_operativa(now(), e.zona_horaria, e.hora_corte_dia), p_fondo_inicial, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function abrir_turno(bigint, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- crear_pedido — idempotente por client_uuid; precio y costo desde la base.
-- p_datos : {cliente_nombre, cliente_telefono, modalidad, direccion, descuento_centavos,
--            envio_centavos, nota}
-- p_items : [{receta_id, cantidad, nota, adicionales:[{receta_id, cantidad}]}]
-- p_pagos : [{medio, monto_centavos}]
-- ---------------------------------------------------------------------------
create or replace function crear_pedido(
  p_turno uuid, p_datos jsonb, p_items jsonb, p_pagos jsonb, p_client_uuid uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_empresa uuid; e empresas; t turnos_caja; v_ex pedidos;
  v_mod text; v_desc bigint; v_envio bigint; v_sub bigint := 0; v_costo bigint := 0; v_total bigint;
  v_num int; v_id uuid; v_item jsonb; v_ad jsonb; v_rec recetas; v_cant int; v_unit bigint; v_cu bigint;
  v_padre uuid; v_pago jsonb; v_suma bigint := 0; v_medio text; v_monto bigint; v_alias varchar;
begin
  v_empresa := _ventas_empresa();
  select * into e from empresas where id = v_empresa;

  -- Serializa a los que cargan en este turno (numeración y reintentos).
  select * into t from turnos_caja where id = p_turno and empresa_id = v_empresa for update;
  if not found then raise exception 'Turno inexistente.'; end if;

  if p_client_uuid is not null then
    select * into v_ex from pedidos where empresa_id = v_empresa and client_uuid = p_client_uuid;
    if found then
      return jsonb_build_object('id', v_ex.id, 'numero', v_ex.numero, 'total_centavos', v_ex.total_centavos, 'repetido', true);
    end if;
  end if;
  if t.estado <> 'abierto' then raise exception 'La caja está cerrada: abrí un turno para cargar pedidos.'; end if;

  p_datos := coalesce(p_datos, '{}'::jsonb);
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido no tiene productos.';
  end if;
  if jsonb_typeof(p_pagos) <> 'array' or jsonb_array_length(p_pagos) = 0 then
    raise exception 'Indicá cómo se cobra el pedido.';
  end if;

  v_mod := coalesce(nullif(p_datos ->> 'modalidad', ''), 'retiro');
  if v_mod not in ('retiro', 'delivery', 'local') then raise exception 'Modalidad inválida.'; end if;
  if v_mod = 'delivery' and not e.usa_delivery then raise exception 'Este local no tiene delivery habilitado.'; end if;
  v_desc := coalesce(nullif(p_datos ->> 'descuento_centavos', ''), '0')::bigint;
  v_envio := coalesce(nullif(p_datos ->> 'envio_centavos', ''), '0')::bigint;
  if v_desc < 0 or v_envio < 0 then raise exception 'Descuento y envío no pueden ser negativos.'; end if;
  if v_envio > 0 and not e.usa_delivery then raise exception 'Este local no cobra envío.'; end if;

  -- Cabecera provisoria (los totales se completan al final).
  select coalesce(max(numero), 0) + 1 into v_num from pedidos where turno_id = p_turno;
  insert into pedidos (empresa_id, turno_id, numero, client_uuid, cliente_nombre, cliente_telefono, modalidad,
                       direccion, subtotal_centavos, total_centavos, nota, creado_por)
  values (v_empresa, p_turno, v_num, p_client_uuid,
          nullif(left(btrim(coalesce(p_datos ->> 'cliente_nombre', '')), 120), ''),
          nullif(left(btrim(coalesce(p_datos ->> 'cliente_telefono', '')), 40), ''),
          v_mod, nullif(btrim(coalesce(p_datos ->> 'direccion', '')), ''), 0, 0,
          nullif(btrim(coalesce(p_datos ->> 'nota', '')), ''), auth.uid())
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if (v_item ->> 'cantidad') is null or (v_item ->> 'cantidad') !~ '^[0-9]{1,3}$' or (v_item ->> 'cantidad')::int < 1 then
      raise exception 'Cantidad inválida.';
    end if;
    v_cant := (v_item ->> 'cantidad')::int;
    select * into v_rec from recetas
     where id = (v_item ->> 'receta_id')::uuid and empresa_id = v_empresa and vende_en_mostrador and activo;
    if not found then raise exception 'Hay un producto que ya no está disponible en la carta.'; end if;
    if v_rec.es_adicional then raise exception 'El adicional "%" tiene que ir sobre un producto.', v_rec.nombre; end if;
    v_unit := v_rec.precio_venta_publico_centavos;
    v_cu := round(_costo_receta(v_rec.id, '{}'::uuid[], 0));
    insert into pedido_items (empresa_id, pedido_id, receta_id, nombre_snapshot, cantidad, precio_unit_centavos, costo_unit_centavos, nota)
    values (v_empresa, v_id, v_rec.id, v_rec.nombre, v_cant, v_unit, v_cu, nullif(btrim(coalesce(v_item ->> 'nota', '')), ''))
    returning id into v_padre;
    v_sub := v_sub + v_unit * v_cant;  v_costo := v_costo + v_cu * v_cant;

    for v_ad in select * from jsonb_array_elements(coalesce(v_item -> 'adicionales', '[]'::jsonb)) loop
      if (v_ad ->> 'cantidad') is null or (v_ad ->> 'cantidad') !~ '^[0-9]{1,3}$' or (v_ad ->> 'cantidad')::int < 1 then
        raise exception 'Cantidad de adicional inválida.';
      end if;
      select * into v_rec from recetas
       where id = (v_ad ->> 'receta_id')::uuid and empresa_id = v_empresa and vende_en_mostrador and activo;
      if not found then raise exception 'Hay un adicional que ya no está disponible en la carta.'; end if;
      if not v_rec.es_adicional then raise exception '"%" no es un adicional.', v_rec.nombre; end if;
      v_cant := (v_ad ->> 'cantidad')::int;
      v_unit := v_rec.precio_venta_publico_centavos;
      v_cu := round(_costo_receta(v_rec.id, '{}'::uuid[], 0));
      insert into pedido_items (empresa_id, pedido_id, receta_id, item_padre_id, nombre_snapshot, cantidad, precio_unit_centavos, costo_unit_centavos)
      values (v_empresa, v_id, v_rec.id, v_padre, v_rec.nombre, v_cant, v_unit, v_cu);
      v_sub := v_sub + v_unit * v_cant;  v_costo := v_costo + v_cu * v_cant;
    end loop;
  end loop;

  if v_desc > v_sub then raise exception 'El descuento no puede superar el subtotal.'; end if;
  v_total := v_sub - v_desc + v_envio;
  if v_total <= 0 then raise exception 'El total del pedido debe ser mayor a cero.'; end if;

  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    v_medio := v_pago ->> 'medio';
    if v_medio is null or not (v_medio = any (e.medios_pago_habilitados)) then
      raise exception 'Medio de pago no habilitado: %.', coalesce(v_medio, '(vacío)');
    end if;
    if (v_pago ->> 'monto_centavos') is null or (v_pago ->> 'monto_centavos') !~ '^[0-9]{1,12}$' or (v_pago ->> 'monto_centavos')::bigint <= 0 then
      raise exception 'Monto de pago inválido.';
    end if;
    v_monto := (v_pago ->> 'monto_centavos')::bigint;
    insert into pedido_pagos (empresa_id, pedido_id, medio, monto_centavos) values (v_empresa, v_id, v_medio, v_monto);
    v_suma := v_suma + v_monto;
    if v_medio = 'transferencia' then v_alias := e.alias_transferencia; end if;
  end loop;
  if v_suma <> v_total then
    raise exception 'Los pagos (%) no coinciden con el total del pedido (%).', v_suma, v_total;
  end if;

  update pedidos set subtotal_centavos = v_sub, descuento_centavos = v_desc, envio_centavos = v_envio,
         total_centavos = v_total, costo_total_centavos = v_costo, alias_cobro = v_alias
   where id = v_id;

  return jsonb_build_object('id', v_id, 'numero', v_num, 'total_centavos', v_total, 'repetido', false);
end;
$$;
grant execute on function crear_pedido(uuid, jsonb, jsonb, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- marcar_entregado / registrar_comanda / anular_pedido
-- ---------------------------------------------------------------------------
create or replace function marcar_entregado(p_pedido uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; p pedidos;
begin
  v_empresa := _ventas_empresa();
  select * into p from pedidos where id = p_pedido and empresa_id = v_empresa for update;
  if not found then raise exception 'Pedido inexistente.'; end if;
  if rol_en('CAJERO') and not exists (select 1 from turnos_caja where id = p.turno_id and estado = 'abierto') then
    raise exception 'Sin permiso: tu rol solo opera el turno abierto.';
  end if;
  if p.estado = 'entregado' then return; end if;
  if p.estado <> 'confirmado' then raise exception 'Solo se puede entregar un pedido confirmado.'; end if;
  update pedidos set estado = 'entregado' where id = p_pedido;
end;
$$;
grant execute on function marcar_entregado(uuid) to authenticated;

-- Deja constancia de cómo salió la comanda (imprimida / enviada por WhatsApp).
create or replace function registrar_comanda(p_pedido uuid, p_via text)
returns void language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; p pedidos;
begin
  v_empresa := _ventas_empresa();
  if p_via is null or p_via not in ('impresora', 'whatsapp') then raise exception 'Vía de comanda inválida.'; end if;
  select * into p from pedidos where id = p_pedido and empresa_id = v_empresa for update;
  if not found then raise exception 'Pedido inexistente.'; end if;
  if rol_en('CAJERO') and not exists (select 1 from turnos_caja where id = p.turno_id and estado = 'abierto') then
    raise exception 'Sin permiso: tu rol solo opera el turno abierto.';
  end if;
  update pedidos set comanda_via = p_via, comanda_en = now() where id = p_pedido;
end;
$$;
grant execute on function registrar_comanda(uuid, text) to authenticated;

create or replace function anular_pedido(p_pedido uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; p pedidos; t turnos_caja;
begin
  v_empresa := _ventas_empresa();
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Indicá el motivo de la anulación.'; end if;
  select * into p from pedidos where id = p_pedido and empresa_id = v_empresa for update;
  if not found then raise exception 'Pedido inexistente.'; end if;
  select * into t from turnos_caja where id = p.turno_id;
  if t.estado <> 'abierto' then
    raise exception 'El turno está cerrado: para anular el pedido hay que reabrir la caja.';
  end if;
  if p.estado = 'anulado' then raise exception 'El pedido ya está anulado.'; end if;
  update pedidos set estado = 'anulado', motivo_anulacion = btrim(p_motivo), anulado_por = auth.uid(), anulado_en = now()
   where id = p_pedido;
  perform auditar('anular_pedido', 'pedidos', p_pedido,
    jsonb_build_object('estado', p.estado, 'numero', p.numero, 'total_centavos', p.total_centavos),
    jsonb_build_object('estado', 'anulado', 'motivo', btrim(p_motivo)));
end;
$$;
grant execute on function anular_pedido(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- registrar_egreso_turno — salida de EFECTIVO de la caja durante el turno.
-- ---------------------------------------------------------------------------
create or replace function registrar_egreso_turno(p_turno uuid, p_monto bigint, p_categoria text, p_nota text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; t turnos_caja; v_id uuid;
begin
  v_empresa := _ventas_empresa();
  if p_monto is null or p_monto <= 0 then raise exception 'El monto debe ser mayor a cero.'; end if;
  if length(btrim(coalesce(p_categoria, ''))) = 0 or length(p_categoria) > 60 then
    raise exception 'Indicá el motivo de la salida (hielo, delivery, retiro…).';
  end if;
  select * into t from turnos_caja where id = p_turno and empresa_id = v_empresa for update;
  if not found then raise exception 'Turno inexistente.'; end if;
  if t.estado <> 'abierto' then raise exception 'La caja está cerrada.'; end if;
  insert into movimientos_caja (empresa_id, fecha, tipo, categoria, medio, monto_centavos, nota, creado_por, origen, turno_id)
  values (v_empresa, t.fecha_operativa, 'egreso', btrim(p_categoria), 'efectivo', p_monto,
          nullif(btrim(coalesce(p_nota, '')), ''), auth.uid(), 'turno', p_turno)
  returning id into v_id;
  perform auditar('egreso_turno', 'turnos_caja', p_turno, null,
    jsonb_build_object('monto_centavos', p_monto, 'categoria', btrim(p_categoria)));
  return v_id;
end;
$$;
grant execute on function registrar_egreso_turno(uuid, bigint, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- cerrar_turno — vuelca los totales al Flujo de caja (un ingreso por medio).
-- Idempotente: cerrar un turno ya cerrado devuelve el resumen sin duplicar.
-- ---------------------------------------------------------------------------
create or replace function cerrar_turno(p_turno uuid, p_efectivo_contado bigint, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; t turnos_caja; v_res jsonb; v_esp bigint; m record; n int;
begin
  v_empresa := _ventas_empresa();
  select * into t from turnos_caja where id = p_turno and empresa_id = v_empresa for update;
  if not found then raise exception 'Turno inexistente.'; end if;
  if t.estado = 'cerrado' then
    return _resumen_turno(p_turno) || jsonb_build_object('ya_cerrado', true);
  end if;
  if p_efectivo_contado is null or p_efectivo_contado < 0 then
    raise exception 'Indicá el efectivo contado (0 si no hay).';
  end if;

  v_res := _resumen_turno(p_turno);
  v_esp := (v_res ->> 'efectivo_esperado_centavos')::bigint;
  n := (v_res ->> 'pedidos')::int;

  for m in
    select pp.medio, sum(pp.monto_centavos)::bigint as monto
      from pedido_pagos pp join pedidos p on p.id = pp.pedido_id
     where p.turno_id = p_turno and p.estado <> 'anulado' group by pp.medio having sum(pp.monto_centavos) > 0
  loop
    insert into movimientos_caja (empresa_id, fecha, tipo, categoria, medio, monto_centavos, nota, creado_por, origen, turno_id)
    values (v_empresa, t.fecha_operativa, 'ingreso', 'Ventas', m.medio, m.monto,
            'Cierre de caja — ' || n || case when n = 1 then ' pedido' else ' pedidos' end, auth.uid(), 'cierre_turno', p_turno);
  end loop;

  update turnos_caja set estado = 'cerrado', efectivo_contado_centavos = p_efectivo_contado,
         efectivo_esperado_centavos = v_esp, cerrado_en = now(), cerrado_por = auth.uid(),
         nota_cierre = nullif(btrim(coalesce(p_nota, '')), '')
   where id = p_turno;
  perform auditar('cerrar_turno', 'turnos_caja', p_turno, null,
    jsonb_build_object('esperado_centavos', v_esp, 'contado_centavos', p_efectivo_contado, 'diferencia_centavos', p_efectivo_contado - v_esp));
  return _resumen_turno(p_turno) || jsonb_build_object('ya_cerrado', false);
end;
$$;
grant execute on function cerrar_turno(uuid, bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- reabrir_turno — solo ADMIN. Da de baja los ingresos del cierre y reabre.
-- ---------------------------------------------------------------------------
create or replace function reabrir_turno(p_turno uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; t turnos_caja;
begin
  v_empresa := _ventas_empresa(array['ADMIN']);
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Indicá el motivo de la reapertura.'; end if;
  select * into t from turnos_caja where id = p_turno and empresa_id = v_empresa for update;
  if not found then raise exception 'Turno inexistente.'; end if;
  if t.estado <> 'cerrado' then raise exception 'El turno ya está abierto.'; end if;
  if exists (select 1 from turnos_caja where empresa_id = v_empresa and estado = 'abierto'
             and coalesce(sucursal_id, '00000000-0000-0000-0000-000000000000'::uuid)
               = coalesce(t.sucursal_id, '00000000-0000-0000-0000-000000000000'::uuid)) then
    raise exception 'Hay otra caja abierta: cerrala antes de reabrir este turno.';
  end if;
  perform set_config('app.permite_mov', '1', true);
  update movimientos_caja set activo = false where turno_id = p_turno and origen = 'cierre_turno' and activo;
  perform set_config('app.permite_mov', '', true);
  update turnos_caja set estado = 'abierto', efectivo_contado_centavos = null, efectivo_esperado_centavos = null,
         cerrado_en = null, cerrado_por = null where id = p_turno;
  perform auditar('reabrir_turno', 'turnos_caja', p_turno,
    jsonb_build_object('estado', 'cerrado', 'contado_centavos', t.efectivo_contado_centavos),
    jsonb_build_object('estado', 'abierto', 'motivo', btrim(p_motivo)));
end;
$$;
grant execute on function reabrir_turno(uuid, text) to authenticated;
