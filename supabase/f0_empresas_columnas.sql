-- ============================================================================
-- SaaS Gastronómico — Fase 0.2: `empresas` con lectura general y escritura mínima
-- ----------------------------------------------------------------------------
-- Antes cualquier rol podía modificar la empresa (tenant_all). Ahora:
--   • todos los roles de la empresa la LEEN;
--   • solo ADMIN actualiza, y únicamente nombre / cuit_rut / costea_con_iva
--     (permisos por columna);
--   • los parámetros sensibles (zona_horaria, condicion_fiscal y, en fases
--     siguientes, alias de cobro, módulos, etc.) se cambian SOLO por
--     set_config_empresa(), que valida el rol y deja rastro en `auditoria`.
-- Parámetros nuevos:
--   zona_horaria     default 'America/Argentina/Buenos_Aires'
--   condicion_fiscal default 'monotributo' (el costeo actual no cambia)
-- Orden: después de f0_roles_rls.sql, f0_auditoria.sql y f0_usuarios.sql. Idempotente.
-- ============================================================================

alter table empresas add column if not exists zona_horaria text not null
  default 'America/Argentina/Buenos_Aires';
alter table empresas add column if not exists condicion_fiscal varchar(30) not null
  default 'monotributo';
alter table empresas drop constraint if exists empresas_condicion_fiscal_check;
alter table empresas add constraint empresas_condicion_fiscal_check
  check (condicion_fiscal in ('monotributo','responsable_inscripto','exento'));

drop policy if exists tenant_all on empresas;
drop policy if exists empresas_leer on empresas;
drop policy if exists empresas_actualizar on empresas;

create policy empresas_leer on empresas for select to authenticated
  using (id = mi_empresa());
create policy empresas_actualizar on empresas for update to authenticated
  using (id = mi_empresa() and rol_en('ADMIN'))
  with check (id = mi_empresa() and rol_en('ADMIN'));

revoke insert, update, delete on empresas from authenticated;
grant update (nombre, cuit_rut, costea_con_iva) on empresas to authenticated;

-- ----------------------------------------------------------------------------
-- set_config_empresa(clave, valor) — único camino para parámetros sensibles.
-- Lista blanca de claves; valida tipo y valor; audita antes/después.
-- ----------------------------------------------------------------------------
create or replace function set_config_empresa(p_clave text, p_valor jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_antes jsonb; v_txt text;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN') then raise exception 'Sin permiso: solo un ADMIN puede cambiar la configuración.'; end if;

  v_txt := p_valor #>> '{}';
  if p_clave = 'zona_horaria' then
    if v_txt is null or not exists (select 1 from pg_timezone_names where name = v_txt) then
      raise exception 'Zona horaria inválida.';
    end if;
    select to_jsonb(zona_horaria) into v_antes from empresas where id = v_empresa;
    update empresas set zona_horaria = v_txt where id = v_empresa;
  elsif p_clave = 'condicion_fiscal' then
    if v_txt is null or v_txt not in ('monotributo','responsable_inscripto','exento') then
      raise exception 'Condición fiscal inválida.';
    end if;
    select to_jsonb(condicion_fiscal) into v_antes from empresas where id = v_empresa;
    update empresas set condicion_fiscal = v_txt where id = v_empresa;
  else
    raise exception 'Parámetro desconocido: %.', p_clave;
  end if;

  perform auditar('config_empresa', 'empresas', v_empresa,
    jsonb_build_object(p_clave, v_antes), jsonb_build_object(p_clave, p_valor));
end;
$$;
grant execute on function set_config_empresa(text, jsonb) to authenticated;
