-- ============================================================================
-- SaaS Gastronómico — Fase 5: importación masiva (proveedores, insumos, gastos fijos)
-- ----------------------------------------------------------------------------
-- La pantalla "Importar desde Excel" valida y normaliza el archivo en el navegador y
-- manda las filas ya limpias a estas RPC. Cada RPC corre en UNA transacción: si una
-- fila falla, no se guarda ninguna (todo o nada).
--
--   • importar_proveedores(filas, actualizar)   ADMIN, GERENTE
--   • importar_insumos(filas, actualizar)       ADMIN, GERENTE, COCINA
--   • importar_gastos_fijos(filas, actualizar)  ADMIN (+ módulo reparto activo)
--
-- `filas` es un arreglo JSON (máx. 2000). Las filas que ya existen (mismo nombre, sin
-- distinguir mayúsculas ni espacios de los bordes, entre los activos de la empresa) se
-- SALTEAN, o se ACTUALIZAN si `actualizar` es true. Un nombre repetido dentro del mismo
-- archivo cuenta como existente (la primera fila lo crea).
-- Devuelven {creados, actualizados, salteados}. Los insumos nuevos dejan su primer punto
-- en el historial de precios ('carga_inicial'); al actualizar un costo queda 'manual'.
-- Orden: después de f4_reparto.sql (usa gastos_fijos). Idempotente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Proveedores
-- fila: nombre*, razon_social, cuit, condicion_fiscal, contacto, telefono, email, rubros[]
-- ---------------------------------------------------------------------------
create or replace function importar_proveedores(p_filas jsonb, p_actualizar boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_empresa uuid := mi_empresa(); f jsonb; v_nombre text; v_id uuid; v_cond text; v_rubros text[];
  v_creados int := 0; v_actualizados int := 0; v_salteados int := 0; v_n int := 0;
begin
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN', 'GERENTE') then raise exception 'Sin permiso: tu rol no puede importar proveedores.'; end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then raise exception 'Las filas a importar tienen que ser una lista.'; end if;
  if jsonb_array_length(p_filas) > 2000 then raise exception 'Máximo 2000 filas por importación.'; end if;

  for f in select * from jsonb_array_elements(p_filas) loop
    v_n := v_n + 1;
    v_nombre := btrim(coalesce(f ->> 'nombre', ''));
    if v_nombre = '' then raise exception 'Fila %: el nombre es obligatorio.', v_n; end if;
    v_cond := coalesce(nullif(btrim(f ->> 'condicion_fiscal'), ''), 'responsable_inscripto');
    if v_cond not in ('responsable_inscripto', 'monotributo', 'exento') then
      raise exception 'Fila % (%): condición fiscal inválida.', v_n, v_nombre;
    end if;
    v_rubros := coalesce(array(select btrim(x) from jsonb_array_elements_text(coalesce(f -> 'rubros', '[]'::jsonb)) x where btrim(x) <> ''), '{}');

    select id into v_id from proveedores
     where empresa_id = v_empresa and activo and lower(btrim(nombre)) = lower(v_nombre) limit 1;
    if v_id is not null then
      if not p_actualizar then v_salteados := v_salteados + 1; continue; end if;
      update proveedores set
        razon_social = coalesce(nullif(btrim(f ->> 'razon_social'), ''), razon_social),
        cuit = coalesce(nullif(btrim(f ->> 'cuit'), ''), cuit),
        condicion_fiscal = case when nullif(btrim(f ->> 'condicion_fiscal'), '') is null then condicion_fiscal else v_cond end,
        contacto = coalesce(nullif(btrim(f ->> 'contacto'), ''), contacto),
        telefono = coalesce(nullif(btrim(f ->> 'telefono'), ''), telefono),
        email = coalesce(nullif(btrim(f ->> 'email'), ''), email),
        rubros = case when cardinality(v_rubros) > 0 then v_rubros else rubros end,
        rubro_principal = case when cardinality(v_rubros) > 0 then v_rubros[1] else rubro_principal end,
        modificado_por = auth.uid()
       where id = v_id;
      v_actualizados := v_actualizados + 1;
    else
      insert into proveedores (empresa_id, nombre, razon_social, cuit, condicion_fiscal, contacto, telefono, email,
                               rubro_principal, rubros, creado_por)
      values (v_empresa, v_nombre, nullif(btrim(f ->> 'razon_social'), ''), nullif(btrim(f ->> 'cuit'), ''), v_cond,
              nullif(btrim(f ->> 'contacto'), ''), nullif(btrim(f ->> 'telefono'), ''), nullif(btrim(f ->> 'email'), ''),
              case when cardinality(v_rubros) > 0 then v_rubros[1] end, v_rubros, auth.uid());
      v_creados := v_creados + 1;
    end if;
  end loop;
  return jsonb_build_object('creados', v_creados, 'actualizados', v_actualizados, 'salteados', v_salteados);
end;
$$;

-- ---------------------------------------------------------------------------
-- Insumos
-- fila: los mismos campos que crear_insumo (nombre*, rubro, magnitud, unidad_base,
--   costo_neto_por_unidad_base_centavos, alicuota_iva, factor_correccion, presentacion_*,
--   unidad_uso, proveedor_habitual_id). Los calcula la pantalla con core/unidades.js.
-- Al actualizar un existente NO se puede cambiar la magnitud de uso (altera sus recetas).
-- ---------------------------------------------------------------------------
create or replace function importar_insumos(p_filas jsonb, p_actualizar boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_empresa uuid := mi_empresa(); f jsonb; v_nombre text; v_ins insumos%rowtype; v_costo numeric;
  v_creados int := 0; v_actualizados int := 0; v_salteados int := 0; v_n int := 0;
begin
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN', 'GERENTE', 'COCINA') then raise exception 'Sin permiso: tu rol no puede importar insumos.'; end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then raise exception 'Las filas a importar tienen que ser una lista.'; end if;
  if jsonb_array_length(p_filas) > 2000 then raise exception 'Máximo 2000 filas por importación.'; end if;

  for f in select * from jsonb_array_elements(p_filas) loop
    v_n := v_n + 1;
    v_nombre := btrim(coalesce(f ->> 'nombre', ''));
    if v_nombre = '' then raise exception 'Fila %: el nombre es obligatorio.', v_n; end if;
    if f ->> 'magnitud' is null or f ->> 'magnitud' not in ('masa', 'volumen', 'unidad') then
      raise exception 'Fila % (%): magnitud inválida.', v_n, v_nombre;
    end if;

    select * into v_ins from insumos
     where empresa_id = v_empresa and activo and lower(btrim(nombre)) = lower(v_nombre) limit 1;
    if found then
      if not p_actualizar then v_salteados := v_salteados + 1; continue; end if;
      if v_ins.magnitud is distinct from f ->> 'magnitud' then
        raise exception 'Fila % (%): ya existe con otra magnitud de uso (% → %). Cambiarla altera sus recetas: editalo desde Insumos.',
          v_n, v_nombre, v_ins.magnitud, f ->> 'magnitud';
      end if;
      v_costo := nullif(f ->> 'costo_neto_por_unidad_base_centavos', '')::numeric;
      perform actualizar_insumo(v_ins.id, f - 'costo_neto_por_unidad_base_centavos', v_costo);
      v_actualizados := v_actualizados + 1;
    else
      perform crear_insumo(f);
      v_creados := v_creados + 1;
    end if;
  end loop;
  return jsonb_build_object('creados', v_creados, 'actualizados', v_actualizados, 'salteados', v_salteados);
end;
$$;

-- ---------------------------------------------------------------------------
-- Gastos fijos (solo ADMIN, módulo reparto)
-- fila: nombre*, categoria*, monto_mensual_centavos* (> 0), dia_vencimiento (1–31), categorias_caja[]
-- ---------------------------------------------------------------------------
create or replace function importar_gastos_fijos(p_filas jsonb, p_actualizar boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_empresa uuid := mi_empresa(); f jsonb; v_nombre text; v_cat text; v_monto bigint; v_dia int; v_id uuid;
  v_cajas text[]; v_orden int;
  v_creados int := 0; v_actualizados int := 0; v_salteados int := 0; v_n int := 0;
begin
  if v_empresa is null then raise exception 'Usuario sin empresa.'; end if;
  if not rol_en('ADMIN') then raise exception 'Sin permiso: solo un ADMIN importa gastos fijos.'; end if;
  if not modulo_activo('reparto') then raise exception 'El módulo de reparto no está activo en tu plan.'; end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then raise exception 'Las filas a importar tienen que ser una lista.'; end if;
  if jsonb_array_length(p_filas) > 2000 then raise exception 'Máximo 2000 filas por importación.'; end if;
  select coalesce(max(orden), 0) into v_orden from gastos_fijos where empresa_id = v_empresa;

  for f in select * from jsonb_array_elements(p_filas) loop
    v_n := v_n + 1;
    v_nombre := btrim(coalesce(f ->> 'nombre', ''));
    v_cat := btrim(coalesce(f ->> 'categoria', ''));
    if v_nombre = '' then raise exception 'Fila %: el nombre es obligatorio.', v_n; end if;
    if v_cat = '' then raise exception 'Fila % (%): la categoría es obligatoria.', v_n, v_nombre; end if;
    v_monto := nullif(f ->> 'monto_mensual_centavos', '')::bigint;
    if v_monto is null or v_monto <= 0 then raise exception 'Fila % (%): el monto mensual tiene que ser mayor a cero.', v_n, v_nombre; end if;
    v_dia := nullif(f ->> 'dia_vencimiento', '')::int;
    if v_dia is not null and (v_dia < 1 or v_dia > 31) then raise exception 'Fila % (%): el día de vencimiento va de 1 a 31.', v_n, v_nombre; end if;
    v_cajas := coalesce(array(select btrim(x) from jsonb_array_elements_text(coalesce(f -> 'categorias_caja', '[]'::jsonb)) x where btrim(x) <> ''), '{}');

    select id into v_id from gastos_fijos
     where empresa_id = v_empresa and activo and lower(btrim(nombre)) = lower(v_nombre) limit 1;
    if v_id is not null then
      if not p_actualizar then v_salteados := v_salteados + 1; continue; end if;
      update gastos_fijos set categoria = v_cat, monto_mensual_centavos = v_monto, dia_vencimiento = v_dia,
             categorias_caja = case when cardinality(v_cajas) > 0 then v_cajas else categorias_caja end
       where id = v_id;
      v_actualizados := v_actualizados + 1;
    else
      v_orden := v_orden + 1;
      insert into gastos_fijos (empresa_id, nombre, categoria, monto_mensual_centavos, dia_vencimiento, categorias_caja, orden, creado_por)
      values (v_empresa, v_nombre, v_cat, v_monto, v_dia, v_cajas, v_orden, auth.uid());
      v_creados := v_creados + 1;
    end if;
  end loop;
  return jsonb_build_object('creados', v_creados, 'actualizados', v_actualizados, 'salteados', v_salteados);
end;
$$;

revoke all on function importar_proveedores(jsonb, boolean) from public;
revoke all on function importar_insumos(jsonb, boolean) from public;
revoke all on function importar_gastos_fijos(jsonb, boolean) from public;
grant execute on function importar_proveedores(jsonb, boolean) to authenticated;
grant execute on function importar_insumos(jsonb, boolean) to authenticated;
grant execute on function importar_gastos_fijos(jsonb, boolean) to authenticated;
