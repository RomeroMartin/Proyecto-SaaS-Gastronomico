-- ============================================================================
-- SaaS Gastronómico — Fase 0.3: usuarios activos, rol CAJERO y alta de usuarios
-- ----------------------------------------------------------------------------
--   • mi_empresa()/mi_rol() ignoran a los usuarios INACTIVOS (antes un usuario
--     desactivado seguía viendo todos los datos).
--   • Se agrega el rol CAJERO.
--   • vincular_usuario(email, rol, nombre): el ADMIN vincula a su empresa una
--     cuenta ya creada en Supabase → Authentication → Users.
--   • Salvaguardas (trigger): siempre queda al menos un ADMIN activo y nadie
--     puede desactivarse a sí mismo. Los cambios de rol/estado se auditan.
-- Orden: después de f0_roles_rls.sql y f0_auditoria.sql. Idempotente.
-- ============================================================================

alter table usuarios drop constraint if exists usuarios_rol_check;
alter table usuarios add constraint usuarios_rol_check
  check (rol in ('ADMIN','GERENTE','COCINA','AUDITOR','CAJERO'));

create or replace function mi_empresa()
returns uuid language plpgsql stable security definer set search_path = public as $$
begin
  return (select empresa_id from public.usuarios where id = auth.uid() and activo);
end;
$$;

create or replace function mi_rol()
returns text language plpgsql stable security definer set search_path = public as $$
begin
  return (select rol from public.usuarios where id = auth.uid() and activo);
end;
$$;

-- modificado_en automático (el cliente ya no tiene que mandarlo).
drop trigger if exists trg_mod_usuarios on usuarios;
create trigger trg_mod_usuarios before update on usuarios
  for each row execute function set_modificado_en();

-- ----------------------------------------------------------------------------
-- Salvaguardas y auditoría de cambios de rol / estado.
-- ----------------------------------------------------------------------------
create or replace function usuarios_cambio()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.rol is distinct from old.rol or new.activo is distinct from old.activo then
    -- Nadie se desactiva a sí mismo.
    if new.activo = false and old.activo and auth.uid() is not null and auth.uid() = new.id then
      raise exception 'No podés desactivar tu propio usuario.';
    end if;
    -- Siempre debe quedar al menos un ADMIN activo.
    if old.rol = 'ADMIN' and old.activo and (new.rol <> 'ADMIN' or new.activo = false) then
      if not exists (
        select 1 from usuarios u
        where u.empresa_id = old.empresa_id and u.id <> old.id and u.rol = 'ADMIN' and u.activo
      ) then
        raise exception 'Debe quedar al menos un ADMIN activo en la empresa.';
      end if;
    end if;
    perform auditar('cambio_usuario', 'usuarios', new.id,
      jsonb_build_object('email', old.email, 'rol', old.rol, 'activo', old.activo),
      jsonb_build_object('email', new.email, 'rol', new.rol, 'activo', new.activo));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_usuarios_cambio on usuarios;
create trigger trg_usuarios_cambio before update on usuarios
  for each row execute function usuarios_cambio();

-- ----------------------------------------------------------------------------
-- vincular_usuario — alta de un usuario en la empresa del ADMIN.
-- Paso previo (manual): crear la cuenta en Supabase → Authentication → Users.
-- ----------------------------------------------------------------------------
create or replace function vincular_usuario(
  p_email text, p_rol text, p_nombre text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_uid uuid; v_email text; v_pert uuid;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN') then raise exception 'Sin permiso: solo un ADMIN puede agregar usuarios.'; end if;
  if p_rol is null or p_rol not in ('ADMIN','GERENTE','COCINA','AUDITOR','CAJERO') then
    raise exception 'Rol inválido.';
  end if;

  select id, email into v_uid, v_email from auth.users
    where lower(email) = lower(trim(coalesce(p_email, ''))) limit 1;
  if v_uid is null then
    raise exception 'No existe una cuenta con ese email. Creala primero en Supabase → Authentication → Users.';
  end if;

  select empresa_id into v_pert from usuarios where id = v_uid;
  if v_pert is not null then
    if v_pert = v_empresa then raise exception 'Ese usuario ya pertenece a tu empresa.'; end if;
    raise exception 'Ese email ya está vinculado a otra empresa.';
  end if;

  insert into usuarios (id, empresa_id, email, nombre, rol)
    values (v_uid, v_empresa, v_email, coalesce(nullif(trim(p_nombre), ''), v_email), p_rol);

  perform auditar('vincular_usuario', 'usuarios', v_uid, null,
    jsonb_build_object('email', v_email, 'rol', p_rol));
  return v_uid;
end;
$$;
grant execute on function vincular_usuario(text, text, text) to authenticated;
