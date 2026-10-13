-- ============================================================================
-- SaaS Gastronómico — Fase 0.7: costeo en SQL (fuente única de verdad)
-- ----------------------------------------------------------------------------
-- El costo de una receta se calculaba SOLO en el navegador y se guardaba como
-- snapshot (`costo_calculado_centavos`): podía quedar viejo, y Ventas lo usa
-- como costo al momento de la venta. Ahora lo calcula la base:
--   • costo_receta(receta)   costo actual (centavos, fraccionario). Misma fórmula
--                            que js/core/costeo.js (hay test de paridad):
--                              insumo:   cantidad × neto × (1 + IVA%) ÷ factor
--                              receta:   cantidad × costo_sub ÷ rendimiento_sub
--                            Ignora insumos/sub-recetas dados de baja; rechaza
--                            ciclos y más de 4 niveles de sub-recetas.
--   • recalcular_costos()    refresca el snapshot de TODAS las recetas.
--   • triggers: si cambia el costo/IVA/factor de un insumo o se da de baja un
--     insumo/receta, el snapshot se recalcula solo (sin pasar por el navegador).
-- Precisión: el costo por unidad base pasa de centavos ENTEROS a numeric(18,6)
-- (un insumo de $125/kg = 12,5 ¢/g ya no se redondea a 13 ¢).
-- `ingredientes_receta.porcentaje_merma` queda DEPRECADA: no se usa ni acá ni en
-- el JS (la merma se modela con `insumos.factor_correccion`). Se elimina cuando
-- ya no haya clientes de la versión anterior.
-- Orden: después de f0_roles_rls.sql (usa rol_en). Idempotente.
-- ============================================================================

-- ---- Precisión del costo por unidad base ----
alter table insumos alter column costo_neto_por_unidad_base_centavos type numeric(18,6);
alter table historial_precios_insumo alter column costo_anterior_centavos type numeric(18,6);
alter table historial_precios_insumo alter column costo_nuevo_centavos type numeric(18,6);

comment on column ingredientes_receta.porcentaje_merma is
  'DEPRECADA: no se usa. La merma se modela con insumos.factor_correccion.';

-- ---- Costeo recursivo (INTERNA: no se expone; no valida empresa) ----
create or replace function _costo_receta(p_receta uuid, p_pila uuid[], p_prof int)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v_total numeric;
begin
  if p_prof > 4 then
    raise exception 'Se superó la profundidad máxima de sub-recetas (4).';
  end if;
  if p_receta = any (p_pila) then
    raise exception 'Referencia circular entre sub-recetas.';
  end if;

  select coalesce(sum(
    case
      when ir.insumo_id is not null then
        ir.cantidad * (i.costo_neto_por_unidad_base_centavos * (1 + i.alicuota_iva / 100.0)
                       / coalesce(nullif(i.factor_correccion, 0), 1))
      else
        ir.cantidad * (_costo_receta(ir.subreceta_hija_id, p_pila || p_receta, p_prof + 1)
                       / coalesce(nullif(s.rendimiento_cantidad, 0), 1))
    end), 0)
  into v_total
  from ingredientes_receta ir
  left join insumos i on i.id = ir.insumo_id and i.activo
  left join recetas s on s.id = ir.subreceta_hija_id and s.activo
  where ir.receta_padre_id = p_receta
    and (i.id is not null or s.id is not null);   -- se ignoran los dados de baja

  return v_total;
end;
$$;
revoke all on function _costo_receta(uuid, uuid[], int) from public, authenticated;

-- ---- Recalcula el snapshot de todas las recetas de una empresa (INTERNA) ----
-- Acumula en `app.recalculadas` (local a la transacción) cuántas cambiaron, para
-- que las RPC puedan informarlo.
create or replace function _recalcular_costos(p_empresa uuid)
returns int language plpgsql security definer set search_path = public as $$
declare r record; v_costo numeric; n int := 0;
begin
  for r in select id, costo_calculado_centavos from recetas where empresa_id = p_empresa and activo loop
    begin
      v_costo := round(_costo_receta(r.id, '{}'::uuid[], 0));
    exception when others then
      continue;   -- ciclo o profundidad excedida: se omite (igual que el JS)
    end;
    if v_costo is distinct from r.costo_calculado_centavos then
      update recetas set costo_calculado_centavos = v_costo, fecha_calculo = now() where id = r.id;
      n := n + 1;
    end if;
  end loop;
  perform set_config('app.recalculadas',
    (coalesce(nullif(current_setting('app.recalculadas', true), ''), '0')::int + n)::text, true);
  return n;
end;
$$;
revoke all on function _recalcular_costos(uuid) from public, authenticated;

-- ---- API pública ----
create or replace function costo_receta(p_receta uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v_empresa uuid;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN', 'GERENTE', 'COCINA', 'AUDITOR') then
    raise exception 'Sin permiso: tu rol no puede realizar esta operación.';
  end if;
  if not exists (select 1 from recetas where id = p_receta and empresa_id = v_empresa) then
    raise exception 'Receta inexistente.';
  end if;
  return _costo_receta(p_receta, '{}'::uuid[], 0);
end;
$$;

create or replace function recalcular_costos()
returns int language plpgsql security definer set search_path = public as $$
declare v_empresa uuid;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN', 'GERENTE', 'COCINA') then
    raise exception 'Sin permiso: tu rol no puede realizar esta operación.';
  end if;
  return _recalcular_costos(v_empresa);
end;
$$;

grant execute on function costo_receta(uuid) to authenticated;
grant execute on function recalcular_costos() to authenticated;

-- ---- Triggers: el snapshot no puede quedar viejo ----
create or replace function _trg_recalcular_costos()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform _recalcular_costos(new.empresa_id);
  return null;
end;
$$;
revoke all on function _trg_recalcular_costos() from public, authenticated;

drop trigger if exists trg_insumo_recalcula on insumos;
create trigger trg_insumo_recalcula
  after update of costo_neto_por_unidad_base_centavos, alicuota_iva, factor_correccion, activo on insumos
  for each row execute function _trg_recalcular_costos();

drop trigger if exists trg_receta_recalcula on recetas;
create trigger trg_receta_recalcula
  after update of activo, rendimiento_cantidad on recetas
  for each row execute function _trg_recalcular_costos();
