-- ============================================================================
-- SaaS Gastronómico — Módulo RRHH (empleados, legajo, sueldos, ausencias,
-- documentos con vencimientos y vacaciones). Multi-tenant sobre `empresas`.
-- ----------------------------------------------------------------------------
-- Este archivo SE AGREGA al esquema existente. NO modifica ni pisa nada de
-- schema.sql / functions.sql. Ejecutar DESPUÉS de esos dos, en
-- Supabase → SQL Editor → Run. Es idempotente en lo posible.
--
-- Convenciones heredadas del SaaS (no re-abrir):
--   • Tenant = tabla `empresas`. Cada tabla de negocio aísla por empresa_id.
--   • Usuario↔empresa: tabla `usuarios(id=auth.uid, empresa_id, rol)`, 1:1.
--   • Roles ya existentes: ADMIN | GERENTE | COCINA | AUDITOR.
--       - RRHH mapea: dueño = ADMIN, encargado = GERENTE.
--       - COCINA y AUDITOR NO acceden a RRHH (la RLS les devuelve cero filas).
--       - Legajo y sueldos: SOLO ADMIN (datos sensibles).
--   • Helpers ya definidos en schema.sql: mi_empresa() y mi_rol() (SIN args).
--   • Dinero = ENTERO en CENTAVOS (BIGINT). Nunca numeric/float. (Regla 3.3)
--   • Baja lógica: nunca se borra un empleado (estado + fecha_egreso).
--   • UUID: uuid_generate_v4() (extensión uuid-ossp, ya activa en schema.sql).
-- ============================================================================

-- Requerida para la restricción de solapamiento de ausencias (exclude gist).
create extension if not exists btree_gist;

-- ============================================================================
-- 1. TABLAS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Núcleo operativo. Lo ven ADMIN (dueño) y GERENTE (encargado).
-- ----------------------------------------------------------------------------
create table if not exists empleados (
  id             uuid primary key default uuid_generate_v4(),
  empresa_id     uuid not null references empresas(id) on delete cascade,
  nombre         varchar(255) not null,
  apellido       varchar(255) not null,
  apodo          varchar(120),
  puesto         varchar(120),                 -- cocina, salón, barra, delivery...
  fecha_ingreso  date not null,                -- cuándo empezó a trabajar (antigüedad y vacaciones)
  fecha_alta     date,                         -- cuándo se lo dio de alta formalmente (null = sin alta)
  fecha_egreso   date,
  -- Baja lógica: 'inactivo' equivale al `activo=false` del resto del SaaS,
  -- pero acá guardamos también la fecha_egreso, por eso usamos estado.
  estado         varchar(20) not null default 'activo'
                 check (estado in ('activo','inactivo')),
  telefono       varchar(50),
  foto_url       text,
  creado_en      timestamptz not null default now(),
  creado_por     uuid,
  modificado_en  timestamptz not null default now(),
  modificado_por uuid,
  constraint chk_egreso_posterior_a_ingreso
    check (fecha_egreso is null or fecha_egreso >= fecha_ingreso)
);
create index if not exists ix_empleados_empresa on empleados(empresa_id, estado);

-- ----------------------------------------------------------------------------
-- Datos sensibles. SOLO ADMIN. Relación 1:1 con empleados, misma PK.
-- ----------------------------------------------------------------------------
create table if not exists empleados_legajo (
  empleado_id         uuid primary key references empleados(id) on delete cascade,
  dni                 varchar(30),
  cuil                varchar(30),
  fecha_nacimiento    date,
  domicilio           text,
  localidad           varchar(120),
  contacto_emergencia varchar(255),
  tel_emergencia      varchar(50),
  obra_social         varchar(120),
  modalidad           varchar(30),   -- 'efectivo' | 'eventual' | 'pasantia' | 'monotributista'
  cbu                 varchar(40),
  observaciones       text
);

-- ----------------------------------------------------------------------------
-- Historial de sueldos. SOLO ADMIN. El monto viaja en CENTAVOS (bigint).
-- Los registros históricos no se editan: un aumento es un registro nuevo.
-- ----------------------------------------------------------------------------
create table if not exists empleados_sueldos (
  id             uuid primary key default uuid_generate_v4(),
  empleado_id    uuid not null references empleados(id) on delete cascade,
  monto_centavos bigint not null check (monto_centavos >= 0),
  tipo           varchar(20) not null default 'mensual'
                 check (tipo in ('mensual','por_hora')),
  vigencia_desde date not null,
  motivo         varchar(30),   -- 'ingreso' | 'paritaria' | 'ascenso' | 'ajuste'
  creado_en      timestamptz not null default now(),
  creado_por     uuid,
  unique (empleado_id, vigencia_desde)
);
create index if not exists ix_sueldos_empleado
  on empleados_sueldos(empleado_id, vigencia_desde desc);

-- ----------------------------------------------------------------------------
-- Ausencias. Una sola tabla para todos los tipos. ADMIN + GERENTE.
-- ----------------------------------------------------------------------------
create table if not exists ausencias (
  id            uuid primary key default uuid_generate_v4(),
  empleado_id   uuid not null references empleados(id) on delete cascade,
  tipo          varchar(30) not null
                check (tipo in ('vacaciones','enfermedad','franco',
                                'licencia_especial','injustificada')),
  desde         date not null,
  hasta         date not null,
  dias          int not null check (dias > 0),
  observaciones text,
  creado_por    uuid,
  creado_en     timestamptz not null default now(),
  constraint chk_rango_ausencia check (hasta >= desde)
);

-- Un empleado no puede tener dos ausencias solapadas. Se resuelve en la base.
-- El error resultante (SQLSTATE 23P01) lo traduce el frontend a un mensaje claro.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ausencias_sin_solape'
  ) then
    alter table ausencias add constraint ausencias_sin_solape
      exclude using gist (
        empleado_id with =,
        daterange(desde, hasta, '[]') with &&
      );
  end if;
end $$;

create index if not exists ix_ausencias_empleado on ausencias(empleado_id, desde);

-- ----------------------------------------------------------------------------
-- Tipos de documento, configurables por empresa. Lectura ADMIN+GERENTE,
-- escritura solo ADMIN.
-- ----------------------------------------------------------------------------
create table if not exists tipos_documento (
  id             uuid primary key default uuid_generate_v4(),
  empresa_id     uuid not null references empresas(id) on delete cascade,
  nombre         varchar(255) not null,
  vigencia_meses int,          -- null = no vence (ej. copia de DNI)
  obligatorio    boolean not null default false,
  orden          int not null default 0,
  activo         boolean not null default true,
  unique (empresa_id, nombre)
);
create index if not exists ix_tipos_doc_empresa on tipos_documento(empresa_id, activo);

-- ----------------------------------------------------------------------------
-- Documentos cargados. ADMIN + GERENTE.
-- ----------------------------------------------------------------------------
create table if not exists documentos (
  id                 uuid primary key default uuid_generate_v4(),
  empleado_id        uuid not null references empleados(id) on delete cascade,
  tipo_documento_id  uuid not null references tipos_documento(id) on delete restrict,
  numero             varchar(120),
  fecha_emision      date,
  fecha_vencimiento  date,
  archivo_path       text,     -- path en Supabase Storage (bucket rrhh-docs)
  creado_en          timestamptz not null default now(),
  creado_por         uuid
);
create index if not exists ix_documentos_venc
  on documentos(empleado_id, fecha_vencimiento);

-- ----------------------------------------------------------------------------
-- Tramos de vacaciones por antigüedad. Configurable por empresa.
-- Lectura ADMIN+GERENTE, escritura solo ADMIN.
-- ----------------------------------------------------------------------------
create table if not exists config_vacaciones (
  empresa_id             uuid not null references empresas(id) on delete cascade,
  antiguedad_desde_anios int not null,
  dias_corridos          int not null,
  primary key (empresa_id, antiguedad_desde_anios)
);

-- ============================================================================
-- 2. AUDITORÍA (reutiliza el trigger set_modificado_en de schema.sql)
-- ============================================================================
drop trigger if exists trg_mod_empleados on empleados;
create trigger trg_mod_empleados before update on empleados
  for each row execute function set_modificado_en();

-- ============================================================================
-- 3. ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- Sin backend, la RLS es la única defensa. `empresa_id` vive solo en
-- `empleados`, `tipos_documento` y `config_vacaciones`; las demás tablas
-- heredan el tenant por join a `empleados`.
-- ============================================================================

alter table empleados         enable row level security;
alter table empleados_legajo  enable row level security;
alter table empleados_sueldos enable row level security;
alter table ausencias         enable row level security;
alter table documentos        enable row level security;
alter table tipos_documento   enable row level security;
alter table config_vacaciones enable row level security;

-- EMPLEADOS: ADMIN + GERENTE, de la propia empresa.
drop policy if exists empleados_rw on empleados;
create policy empleados_rw on empleados
  for all to authenticated
  using      (empresa_id = mi_empresa() and mi_rol() in ('ADMIN','GERENTE'))
  with check (empresa_id = mi_empresa() and mi_rol() in ('ADMIN','GERENTE'));

-- LEGAJO: SOLO ADMIN. Hereda el tenant del empleado.
drop policy if exists legajo_rw on empleados_legajo;
create policy legajo_rw on empleados_legajo
  for all to authenticated
  using (mi_rol() = 'ADMIN' and exists (
    select 1 from empleados e
    where e.id = empleado_id and e.empresa_id = mi_empresa()))
  with check (mi_rol() = 'ADMIN' and exists (
    select 1 from empleados e
    where e.id = empleado_id and e.empresa_id = mi_empresa()));

-- SUELDOS: SOLO ADMIN.
drop policy if exists sueldos_rw on empleados_sueldos;
create policy sueldos_rw on empleados_sueldos
  for all to authenticated
  using (mi_rol() = 'ADMIN' and exists (
    select 1 from empleados e
    where e.id = empleado_id and e.empresa_id = mi_empresa()))
  with check (mi_rol() = 'ADMIN' and exists (
    select 1 from empleados e
    where e.id = empleado_id and e.empresa_id = mi_empresa()));

-- AUSENCIAS: ADMIN + GERENTE.
drop policy if exists ausencias_rw on ausencias;
create policy ausencias_rw on ausencias
  for all to authenticated
  using (mi_rol() in ('ADMIN','GERENTE') and exists (
    select 1 from empleados e
    where e.id = empleado_id and e.empresa_id = mi_empresa()))
  with check (mi_rol() in ('ADMIN','GERENTE') and exists (
    select 1 from empleados e
    where e.id = empleado_id and e.empresa_id = mi_empresa()));

-- DOCUMENTOS: ADMIN + GERENTE.
drop policy if exists documentos_rw on documentos;
create policy documentos_rw on documentos
  for all to authenticated
  using (mi_rol() in ('ADMIN','GERENTE') and exists (
    select 1 from empleados e
    where e.id = empleado_id and e.empresa_id = mi_empresa()))
  with check (mi_rol() in ('ADMIN','GERENTE') and exists (
    select 1 from empleados e
    where e.id = empleado_id and e.empresa_id = mi_empresa()));

-- TIPOS DE DOCUMENTO: lectura ADMIN+GERENTE, escritura solo ADMIN.
drop policy if exists tipos_doc_read on tipos_documento;
create policy tipos_doc_read on tipos_documento
  for select to authenticated
  using (empresa_id = mi_empresa() and mi_rol() in ('ADMIN','GERENTE'));

drop policy if exists tipos_doc_write on tipos_documento;
create policy tipos_doc_write on tipos_documento
  for all to authenticated
  using      (empresa_id = mi_empresa() and mi_rol() = 'ADMIN')
  with check (empresa_id = mi_empresa() and mi_rol() = 'ADMIN');

-- CONFIG VACACIONES: lectura ADMIN+GERENTE, escritura solo ADMIN.
drop policy if exists config_vac_read on config_vacaciones;
create policy config_vac_read on config_vacaciones
  for select to authenticated
  using (empresa_id = mi_empresa() and mi_rol() in ('ADMIN','GERENTE'));

drop policy if exists config_vac_write on config_vacaciones;
create policy config_vac_write on config_vacaciones
  for all to authenticated
  using      (empresa_id = mi_empresa() and mi_rol() = 'ADMIN')
  with check (empresa_id = mi_empresa() and mi_rol() = 'ADMIN');

-- ============================================================================
-- 4. VISTAS (heredan RLS con security_invoker; sin él filtrarían mal)
-- ============================================================================

-- Sueldo vigente hoy, por empleado.
create or replace view vw_sueldo_vigente
with (security_invoker = true) as
select distinct on (empleado_id)
  empleado_id, monto_centavos, tipo, vigencia_desde, motivo
from empleados_sueldos
where vigencia_desde <= current_date
order by empleado_id, vigencia_desde desc;

-- Estado de documentación, con semáforo ya calculado.
create or replace view vw_documentos_estado
with (security_invoker = true) as
select
  d.id,
  d.empleado_id,
  e.empresa_id,
  e.nombre || ' ' || e.apellido as empleado,
  td.nombre as tipo,
  d.fecha_vencimiento,
  (d.fecha_vencimiento - current_date) as dias_restantes,
  case
    when d.fecha_vencimiento is null then 'sin_vencimiento'
    when d.fecha_vencimiento < current_date then 'vencido'
    when d.fecha_vencimiento <= current_date + 30 then 'por_vencer'
    else 'vigente'
  end as estado
from documentos d
join empleados e on e.id = d.empleado_id
join tipos_documento td on td.id = d.tipo_documento_id
where e.estado = 'activo';

-- Resumen por empleado, para pintar la lista con el badge de semáforo.
-- sueldo_actual llega en null para GERENTE (la RLS de sueldos lo oculta).
create or replace view vw_empleados_resumen
with (security_invoker = true) as
select
  e.*,
  sv.monto_centavos as sueldo_actual_centavos,
  sv.tipo           as sueldo_tipo,
  count(de.id) filter (where de.estado = 'vencido')    as docs_vencidos,
  count(de.id) filter (where de.estado = 'por_vencer') as docs_por_vencer,
  min(de.fecha_vencimiento) filter (where de.estado in ('vencido','por_vencer'))
    as proximo_vencimiento
from empleados e
left join vw_sueldo_vigente sv on sv.empleado_id = e.id
left join vw_documentos_estado de on de.empleado_id = e.id
group by e.id, sv.monto_centavos, sv.tipo;

-- ============================================================================
-- 5. CÁLCULO DE VACACIONES (orientativo, no vinculante)
-- ============================================================================
create or replace function dias_vacaciones(p_empleado uuid, p_anio int)
returns int
language plpgsql
stable
as $$
declare
  v_ingreso    date;
  v_empresa    uuid;
  v_antiguedad int;
  v_dias       int;
  v_meses      int;
begin
  select fecha_ingreso, empresa_id into v_ingreso, v_empresa
  from empleados where id = p_empleado;

  if v_ingreso is null then return 0; end if;

  -- Antigüedad computada al 31/12 del año que se otorga (LCT art. 150).
  v_antiguedad := extract(year from age(
                    make_date(p_anio, 12, 31), v_ingreso))::int;

  -- Menos de 6 meses trabajados: proporcional, 1 día c/20 días (LCT art. 153).
  v_meses := extract(year  from age(make_date(p_anio,12,31), v_ingreso))::int * 12
           + extract(month from age(make_date(p_anio,12,31), v_ingreso))::int;

  if v_meses < 6 then
    return greatest(1, floor(
      (make_date(p_anio,12,31) - v_ingreso) / 20.0
    )::int);
  end if;

  select dias_corridos into v_dias
  from config_vacaciones
  where empresa_id = v_empresa
    and antiguedad_desde_anios <= v_antiguedad
  order by antiguedad_desde_anios desc
  limit 1;

  return coalesce(v_dias, 14);
end;
$$;

-- Saldo de vacaciones del año en curso.
create or replace view vw_saldo_vacaciones
with (security_invoker = true) as
select
  e.id as empleado_id,
  e.empresa_id,
  e.nombre || ' ' || e.apellido as empleado,
  dias_vacaciones(e.id, extract(year from current_date)::int) as corresponden,
  coalesce(sum(a.dias), 0)::int as tomados,
  dias_vacaciones(e.id, extract(year from current_date)::int)
    - coalesce(sum(a.dias), 0)::int as saldo
from empleados e
left join ausencias a
  on a.empleado_id = e.id
 and a.tipo = 'vacaciones'
 and extract(year from a.desde) = extract(year from current_date)
where e.estado = 'activo'
group by e.id;

-- ============================================================================
-- 6. SEED POR EMPRESA (idempotente). La invoca el ADMIN al activar el módulo
-- (botón "Activar RRHH" en Configuración) o se puede correr a mano.
-- ============================================================================
create or replace function seed_rrhh_empresa()
returns void
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if mi_rol() <> 'ADMIN' then
    raise exception 'Solo un ADMIN puede activar el módulo RRHH.';
  end if;

  -- Tipos de documento sugeridos para gastronomía (el usuario los edita luego).
  insert into tipos_documento (empresa_id, nombre, vigencia_meses, obligatorio, orden) values
    (v_empresa, 'Libreta sanitaria',                    12,  true,  10),
    (v_empresa, 'Curso de manipulación de alimentos',   36,  true,  20),
    (v_empresa, 'Copia de DNI',                          null, true, 30),
    (v_empresa, 'Alta temprana AFIP',                    null, true, 40),
    (v_empresa, 'Constancia de ART',                     12,  false, 50),
    (v_empresa, 'Examen médico preocupacional',          null, false, 60)
  on conflict (empresa_id, nombre) do nothing;

  -- Tramos de vacaciones (base LCT art. 150, días corridos).
  insert into config_vacaciones (empresa_id, antiguedad_desde_anios, dias_corridos) values
    (v_empresa, 0,  14),
    (v_empresa, 5,  21),
    (v_empresa, 10, 28),
    (v_empresa, 20, 35)
  on conflict (empresa_id, antiguedad_desde_anios) do nothing;
end;
$$;

grant execute on function seed_rrhh_empresa() to authenticated;
grant execute on function dias_vacaciones(uuid, int) to authenticated;

-- ============================================================================
-- 7. STORAGE — bucket privado rrhh-docs
-- ----------------------------------------------------------------------------
-- Path: {empresa_id}/{empleado_id}/{uuid}-{nombre_archivo}
-- El empresa_id como primer segmento permite escribir la política sin joins.
-- Mostrar archivos SIEMPRE con signed URLs de expiración corta; nunca públicas.
-- ============================================================================
insert into storage.buckets (id, name, public)
  values ('rrhh-docs', 'rrhh-docs', false)
  on conflict (id) do nothing;

drop policy if exists rrhh_docs_rw on storage.objects;
create policy rrhh_docs_rw on storage.objects
  for all to authenticated
  using (
    bucket_id = 'rrhh-docs'
    and (storage.foldername(name))[1] = mi_empresa()::text
    and mi_rol() in ('ADMIN','GERENTE')
  )
  with check (
    bucket_id = 'rrhh-docs'
    and (storage.foldername(name))[1] = mi_empresa()::text
    and mi_rol() in ('ADMIN','GERENTE')
  );

-- ============================================================================
-- FIN. Verificación rápida (checklist de seguridad):
--   • RLS activada en las 7 tablas (arriba).
--   • Vistas con security_invoker = true.
--   • Con rol GERENTE, empleados_legajo y empleados_sueldos devuelven vacío.
--   • Con usuario de otra empresa, empleados devuelve cero filas.
--   • Bucket rrhh-docs privado; archivos solo por signed URL.
-- ============================================================================
