-- ============================================================================
-- SaaS Gastronómico — Fase 0.6: operaciones atómicas y códigos sin carrera
-- ----------------------------------------------------------------------------
-- Antes el navegador hacía varias escrituras sueltas (borrar ingredientes y
-- reinsertarlos; insumo + historial; calcular el próximo código leyendo y
-- luego insertando). Si algo fallaba a mitad de camino quedaban recetas vacías
-- o códigos repetidos. Ahora cada operación es UNA transacción:
--   • guardar_receta(id, datos, ingredientes)   receta + ingredientes + costos
--   • crear_insumo(datos)                       insumo + primer punto de historial
--   • actualizar_costo_insumo(...)              costo + historial + recálculo
--   • actualizar_insumo(id, datos, costo, ...)  datos + (opcional) costo, juntos
--   • códigos INS-/REC-/PROV- asignados por trigger con bloqueo (sin duplicados)
-- Roles: ADMIN, GERENTE y COCINA (como la matriz de insumos/recetas).
-- Orden: después de f0_costeo.sql. Idempotente.
-- ============================================================================

-- ---- Códigos legibles sin carrera ----
create or replace function siguiente_codigo(p_empresa uuid, p_tabla text, p_prefijo text)
returns text language plpgsql security definer set search_path = public as $$
declare v_max int;
begin
  if p_tabla not in ('insumos', 'recetas', 'proveedores') then raise exception 'Tabla inválida.'; end if;
  -- Bloqueo de la transacción: dos altas simultáneas no pueden sacar el mismo número.
  perform pg_advisory_xact_lock(hashtext('cod:' || p_empresa::text || ':' || p_tabla));
  execute format(
    'select coalesce(max((regexp_match(codigo, %L))[1]::int), 0) from %I where empresa_id = $1',
    '^' || p_prefijo || '-([0-9]+)$', p_tabla)
  into v_max using p_empresa;
  return p_prefijo || '-' || lpad((v_max + 1)::text, 3, '0');
end;
$$;
revoke all on function siguiente_codigo(uuid, text, text) from public, authenticated;

create or replace function _trg_asignar_codigo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.codigo is null or btrim(new.codigo) = '' then
    new.codigo := siguiente_codigo(new.empresa_id, tg_table_name, tg_argv[0]);
  end if;
  return new;
end;
$$;
revoke all on function _trg_asignar_codigo() from public, authenticated;

drop trigger if exists trg_codigo_insumos on insumos;
create trigger trg_codigo_insumos before insert on insumos
  for each row execute function _trg_asignar_codigo('INS');
drop trigger if exists trg_codigo_recetas on recetas;
create trigger trg_codigo_recetas before insert on recetas
  for each row execute function _trg_asignar_codigo('REC');
drop trigger if exists trg_codigo_proveedores on proveedores;
create trigger trg_codigo_proveedores before insert on proveedores
  for each row execute function _trg_asignar_codigo('PROV');

-- Índice único por empresa (si ya hubiera códigos repetidos se avisa y se sigue).
do $$
declare t text;
begin
  foreach t in array array['insumos', 'recetas', 'proveedores'] loop
    begin
      execute format('create unique index if not exists uq_%s_codigo on %I (empresa_id, codigo) where codigo is not null', t, t);
    exception when unique_violation then
      raise notice 'Hay códigos repetidos en %: no se creó el índice único; corregilos y volvé a correr este script.', t;
    end;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- guardar_receta — crea (p_id null) o actualiza una receta con sus ingredientes.
-- p_datos: nombre, tipo, rendimiento_cantidad, rendimiento_unidad,
--          precio_venta_publico_centavos, alicuota_venta, sector_venta
-- p_ingredientes: [{tipo:'insumo'|'receta', ref_id, cantidad}]
-- Todo o nada: si hay un ciclo, un ingrediente inexistente o cualquier error,
-- la receta queda exactamente como estaba.
-- ----------------------------------------------------------------------------
create or replace function guardar_receta(p_id uuid, p_datos jsonb, p_ingredientes jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_empresa uuid; v_id uuid; v_nombre text; v_tipo text;
  ing jsonb; v_orden int := 0; v_cant numeric; v_ref uuid; v_t text;
  v_rend numeric; v_unidad text; v_precio bigint; v_ali numeric; v_sector text;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN', 'GERENTE', 'COCINA') then
    raise exception 'Sin permiso: tu rol no puede realizar esta operación.';
  end if;

  v_nombre := btrim(coalesce(p_datos ->> 'nombre', ''));
  if v_nombre = '' then raise exception 'El nombre es obligatorio.'; end if;
  v_tipo := case when p_datos ->> 'tipo' = 'preparacion' then 'preparacion' else 'plato' end;
  if p_ingredientes is null or jsonb_typeof(p_ingredientes) <> 'array' or jsonb_array_length(p_ingredientes) = 0 then
    raise exception 'Agregá al menos un ingrediente.';
  end if;

  v_rend   := coalesce(nullif(nullif(p_datos ->> 'rendimiento_cantidad', '')::numeric, 0), 1);
  v_unidad := coalesce(nullif(btrim(coalesce(p_datos ->> 'rendimiento_unidad', '')), ''), 'un');
  v_precio := case when v_tipo = 'plato' then coalesce(nullif(p_datos ->> 'precio_venta_publico_centavos', '')::bigint, 0) else 0 end;
  v_ali    := case when v_tipo = 'plato' then coalesce(nullif(p_datos ->> 'alicuota_venta', '')::numeric, 0) else 0 end;
  v_sector := case when v_tipo = 'plato' then nullif(btrim(coalesce(p_datos ->> 'sector_venta', '')), '') else null end;

  if p_id is null then
    insert into recetas (empresa_id, nombre, tipo, rendimiento_cantidad, rendimiento_unidad,
                         precio_venta_publico_centavos, alicuota_venta, sector_venta, creado_por)
    values (v_empresa, v_nombre, v_tipo, v_rend, v_unidad, v_precio, v_ali, v_sector, auth.uid())
    returning id into v_id;
  else
    select id into v_id from recetas where id = p_id and empresa_id = v_empresa for update;
    if not found then raise exception 'Receta inexistente.'; end if;
    update recetas set nombre = v_nombre, tipo = v_tipo, rendimiento_cantidad = v_rend,
      rendimiento_unidad = v_unidad, precio_venta_publico_centavos = v_precio,
      alicuota_venta = v_ali, sector_venta = v_sector, modificado_por = auth.uid()
    where id = v_id;
    delete from ingredientes_receta where receta_padre_id = v_id;
  end if;

  for ing in select value from jsonb_array_elements(p_ingredientes) loop
    v_t := ing ->> 'tipo';
    v_ref := nullif(ing ->> 'ref_id', '')::uuid;
    v_cant := nullif(ing ->> 'cantidad', '')::numeric;
    if v_cant is null or v_cant <= 0 then
      raise exception 'Cada ingrediente necesita una cantidad mayor a cero.';
    end if;
    if v_t = 'insumo' then
      if not exists (select 1 from insumos where id = v_ref and empresa_id = v_empresa and activo) then
        raise exception 'Hay un insumo inexistente o dado de baja.';
      end if;
      insert into ingredientes_receta (empresa_id, receta_padre_id, insumo_id, cantidad, orden)
        values (v_empresa, v_id, v_ref, v_cant, v_orden);
    elsif v_t = 'receta' then
      if not exists (select 1 from recetas where id = v_ref and empresa_id = v_empresa and activo and tipo = 'preparacion') then
        raise exception 'Hay una preparación inexistente o dada de baja.';
      end if;
      insert into ingredientes_receta (empresa_id, receta_padre_id, subreceta_hija_id, cantidad, orden)
        values (v_empresa, v_id, v_ref, v_cant, v_orden);
    else
      raise exception 'Tipo de ingrediente inválido.';
    end if;
    v_orden := v_orden + 1;
  end loop;

  perform _costo_receta(v_id, '{}'::uuid[], 0);   -- lanza si hay ciclo o demasiados niveles
  perform _recalcular_costos(v_empresa);
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- crear_insumo — insumo + primer punto del historial de precios.
-- p_datos: nombre, rubro, magnitud, unidad_base, costo_neto_por_unidad_base_centavos,
--   alicuota_iva, factor_correccion, presentacion_*, unidad_uso, proveedor_habitual_id
-- ----------------------------------------------------------------------------
create or replace function crear_insumo(p_datos jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_id uuid; v_nombre text; v_costo numeric; v_prov uuid;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN', 'GERENTE', 'COCINA') then
    raise exception 'Sin permiso: tu rol no puede realizar esta operación.';
  end if;
  v_nombre := btrim(coalesce(p_datos ->> 'nombre', ''));
  if v_nombre = '' then raise exception 'El nombre es obligatorio.'; end if;
  v_costo := coalesce(nullif(p_datos ->> 'costo_neto_por_unidad_base_centavos', '')::numeric, 0);
  if v_costo < 0 then raise exception 'El costo no puede ser negativo.'; end if;
  v_prov := nullif(p_datos ->> 'proveedor_habitual_id', '')::uuid;
  if v_prov is not null and not exists (select 1 from proveedores where id = v_prov and empresa_id = v_empresa) then
    raise exception 'Proveedor inexistente en la empresa.';
  end if;

  insert into insumos (
    empresa_id, nombre, rubro, magnitud, unidad_base, costo_neto_por_unidad_base_centavos,
    alicuota_iva, factor_correccion, presentacion_desc, presentacion_cantidad_base,
    presentacion_precio_neto_centavos, presentacion_magnitud, presentacion_cantidad,
    presentacion_unidad, unidad_uso, proveedor_habitual_id, fecha_ultimo_precio, creado_por
  ) values (
    v_empresa, v_nombre, nullif(btrim(coalesce(p_datos ->> 'rubro', '')), ''),
    p_datos ->> 'magnitud', p_datos ->> 'unidad_base', v_costo,
    coalesce(nullif(p_datos ->> 'alicuota_iva', '')::numeric, 0),
    coalesce(nullif(p_datos ->> 'factor_correccion', '')::numeric, 1),
    nullif(btrim(coalesce(p_datos ->> 'presentacion_desc', '')), ''),
    nullif(p_datos ->> 'presentacion_cantidad_base', '')::numeric,
    nullif(p_datos ->> 'presentacion_precio_neto_centavos', '')::bigint,
    nullif(p_datos ->> 'presentacion_magnitud', ''),
    nullif(p_datos ->> 'presentacion_cantidad', '')::numeric,
    nullif(p_datos ->> 'presentacion_unidad', ''),
    nullif(p_datos ->> 'unidad_uso', ''), v_prov, now(), auth.uid()
  ) returning id into v_id;

  insert into historial_precios_insumo
    (empresa_id, insumo_id, costo_anterior_centavos, costo_nuevo_centavos, variacion_porcentual, origen, usuario)
    values (v_empresa, v_id, 0, v_costo, 0, 'carga_inicial', auth.uid());
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- actualizar_costo_insumo — nuevo costo por unidad base + historial + recetas.
-- Devuelve {variacion, recetas_recalculadas}.
-- ----------------------------------------------------------------------------
create or replace function actualizar_costo_insumo(
  p_id uuid, p_costo numeric, p_origen text default 'manual',
  p_factura uuid default null, p_precio_presentacion bigint default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_ins insumos%rowtype; v_var numeric; v_pres bigint;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN', 'GERENTE', 'COCINA') then
    raise exception 'Sin permiso: tu rol no puede realizar esta operación.';
  end if;
  if p_costo is null or p_costo < 0 then raise exception 'El costo no es válido.'; end if;
  if p_origen not in ('factura', 'manual') then raise exception 'Origen inválido.'; end if;
  if p_factura is not null and not exists (select 1 from facturas where id = p_factura and empresa_id = v_empresa) then
    raise exception 'Factura inexistente.';
  end if;

  select * into v_ins from insumos where id = p_id and empresa_id = v_empresa for update;
  if not found then raise exception 'Insumo inexistente.'; end if;

  perform set_config('app.recalculadas', '0', true);
  v_var := case when v_ins.costo_neto_por_unidad_base_centavos > 0
    then round((p_costo - v_ins.costo_neto_por_unidad_base_centavos) / v_ins.costo_neto_por_unidad_base_centavos * 100, 2)
    else 0 end;
  -- Precio de la presentación: el exacto si viene, o el derivado del nuevo costo.
  v_pres := coalesce(p_precio_presentacion,
    case when coalesce(v_ins.presentacion_cantidad_base, 0) > 0 then round(p_costo * v_ins.presentacion_cantidad_base)::bigint end,
    v_ins.presentacion_precio_neto_centavos);

  insert into historial_precios_insumo
    (empresa_id, insumo_id, costo_anterior_centavos, costo_nuevo_centavos, variacion_porcentual, origen, factura_id, usuario)
    values (v_empresa, p_id, v_ins.costo_neto_por_unidad_base_centavos, p_costo, v_var, p_origen, p_factura, auth.uid());

  update insumos set costo_neto_por_unidad_base_centavos = p_costo, fecha_ultimo_precio = now(),
    presentacion_precio_neto_centavos = v_pres
  where id = p_id;     -- el trigger recalcula las recetas

  return jsonb_build_object('variacion', v_var,
    'recetas_recalculadas', coalesce(nullif(current_setting('app.recalculadas', true), ''), '0')::int);
end;
$$;

-- ----------------------------------------------------------------------------
-- actualizar_insumo — edita los datos del insumo y (opcional) su costo, juntos.
-- p_datos: cualquiera de nombre, rubro, alicuota_iva, factor_correccion,
--   proveedor_habitual_id, magnitud, unidad_base, unidad_uso, presentacion_desc,
--   presentacion_cantidad_base, presentacion_precio_neto_centavos,
--   presentacion_magnitud, presentacion_cantidad, presentacion_unidad.
-- Si p_costo viene y cambió, queda en el historial como 'manual'.
-- ----------------------------------------------------------------------------
create or replace function actualizar_insumo(
  p_id uuid, p_datos jsonb, p_costo numeric default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_ins insumos%rowtype; v_var numeric := 0; v_prov uuid; v_cambio boolean := false;
begin
  v_empresa := mi_empresa();
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN', 'GERENTE', 'COCINA') then
    raise exception 'Sin permiso: tu rol no puede realizar esta operación.';
  end if;
  select * into v_ins from insumos where id = p_id and empresa_id = v_empresa for update;
  if not found then raise exception 'Insumo inexistente.'; end if;
  if p_datos ? 'nombre' and btrim(coalesce(p_datos ->> 'nombre', '')) = '' then
    raise exception 'El nombre es obligatorio.';
  end if;
  if p_datos ? 'proveedor_habitual_id' then
    v_prov := nullif(p_datos ->> 'proveedor_habitual_id', '')::uuid;
    if v_prov is not null and not exists (select 1 from proveedores where id = v_prov and empresa_id = v_empresa) then
      raise exception 'Proveedor inexistente en la empresa.';
    end if;
  end if;
  if p_costo is not null and p_costo < 0 then raise exception 'El costo no es válido.'; end if;

  perform set_config('app.recalculadas', '0', true);

  update insumos set
    nombre = case when p_datos ? 'nombre' then btrim(p_datos ->> 'nombre') else nombre end,
    rubro = case when p_datos ? 'rubro' then nullif(btrim(coalesce(p_datos ->> 'rubro', '')), '') else rubro end,
    alicuota_iva = case when p_datos ? 'alicuota_iva' then (p_datos ->> 'alicuota_iva')::numeric else alicuota_iva end,
    factor_correccion = case when p_datos ? 'factor_correccion' then coalesce(nullif(p_datos ->> 'factor_correccion', '')::numeric, 1) else factor_correccion end,
    proveedor_habitual_id = case when p_datos ? 'proveedor_habitual_id' then v_prov else proveedor_habitual_id end,
    magnitud = case when p_datos ? 'magnitud' then p_datos ->> 'magnitud' else magnitud end,
    unidad_base = case when p_datos ? 'unidad_base' then p_datos ->> 'unidad_base' else unidad_base end,
    unidad_uso = case when p_datos ? 'unidad_uso' then nullif(p_datos ->> 'unidad_uso', '') else unidad_uso end,
    presentacion_desc = case when p_datos ? 'presentacion_desc' then nullif(btrim(coalesce(p_datos ->> 'presentacion_desc', '')), '') else presentacion_desc end,
    presentacion_cantidad_base = case when p_datos ? 'presentacion_cantidad_base' then nullif(p_datos ->> 'presentacion_cantidad_base', '')::numeric else presentacion_cantidad_base end,
    presentacion_precio_neto_centavos = case when p_datos ? 'presentacion_precio_neto_centavos' then nullif(p_datos ->> 'presentacion_precio_neto_centavos', '')::bigint else presentacion_precio_neto_centavos end,
    presentacion_magnitud = case when p_datos ? 'presentacion_magnitud' then nullif(p_datos ->> 'presentacion_magnitud', '') else presentacion_magnitud end,
    presentacion_cantidad = case when p_datos ? 'presentacion_cantidad' then nullif(p_datos ->> 'presentacion_cantidad', '')::numeric else presentacion_cantidad end,
    presentacion_unidad = case when p_datos ? 'presentacion_unidad' then nullif(p_datos ->> 'presentacion_unidad', '') else presentacion_unidad end,
    modificado_por = auth.uid()
  where id = p_id;

  if p_costo is not null and p_costo is distinct from v_ins.costo_neto_por_unidad_base_centavos then
    v_cambio := true;
    v_var := case when v_ins.costo_neto_por_unidad_base_centavos > 0
      then round((p_costo - v_ins.costo_neto_por_unidad_base_centavos) / v_ins.costo_neto_por_unidad_base_centavos * 100, 2)
      else 0 end;
    insert into historial_precios_insumo
      (empresa_id, insumo_id, costo_anterior_centavos, costo_nuevo_centavos, variacion_porcentual, origen, usuario)
      values (v_empresa, p_id, v_ins.costo_neto_por_unidad_base_centavos, p_costo, v_var, 'manual', auth.uid());
    update insumos set costo_neto_por_unidad_base_centavos = p_costo, fecha_ultimo_precio = now() where id = p_id;
  end if;

  return jsonb_build_object('variacion', v_var, 'costo_cambio', v_cambio,
    'recetas_recalculadas', coalesce(nullif(current_setting('app.recalculadas', true), ''), '0')::int);
end;
$$;

grant execute on function guardar_receta(uuid, jsonb, jsonb) to authenticated;
grant execute on function crear_insumo(jsonb) to authenticated;
grant execute on function actualizar_costo_insumo(uuid, numeric, text, uuid, bigint) to authenticated;
grant execute on function actualizar_insumo(uuid, jsonb, numeric) to authenticated;
