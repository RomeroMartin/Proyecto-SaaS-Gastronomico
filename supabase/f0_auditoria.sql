-- ============================================================================
-- SaaS Gastronómico — Fase 0.8: auditoría
-- ----------------------------------------------------------------------------
-- Rastro de lo sensible: cambios de rol/estado de usuarios, vínculo de
-- usuarios, parámetros de empresa y (en fases siguientes) alias de cobro,
-- anulaciones y reaperturas de caja.
--   • Solo ADMIN puede LEER la tabla.
--   • Nadie escribe directo: la llenan las RPC/triggers SECURITY DEFINER a
--     través de auditar().
-- Orden: después de f0_roles_rls.sql (usa rol_en). Idempotente.
-- ============================================================================

create table if not exists auditoria (
  id          uuid primary key default uuid_generate_v4(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  usuario_id  uuid,
  accion      varchar(60) not null,   -- 'cambio_usuario', 'vincular_usuario', 'config_empresa', …
  entidad     varchar(40),
  entidad_id  uuid,
  antes       jsonb,
  despues     jsonb,
  creado_en   timestamptz not null default now()
);
create index if not exists ix_auditoria_empresa on auditoria(empresa_id, creado_en desc);

alter table auditoria enable row level security;
drop policy if exists leer on auditoria;
create policy leer on auditoria for select to authenticated
  using (empresa_id = mi_empresa() and rol_en('ADMIN'));
revoke insert, update, delete on auditoria from authenticated;

-- Registra un evento de auditoría de la empresa del usuario actual.
-- Es interna: la usan las RPC/triggers; el cliente no la invoca.
create or replace function auditar(
  p_accion text, p_entidad text, p_entidad_id uuid, p_antes jsonb, p_despues jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then
    -- Contexto sin usuario (mantenimiento): se toma la empresa de la entidad si es posible.
    return;
  end if;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, antes, despues)
  values (v_empresa, auth.uid(), p_accion, p_entidad, p_entidad_id, p_antes, p_despues);
end;
$$;
revoke all on function auditar(text, text, uuid, jsonb, jsonb) from public, authenticated;
