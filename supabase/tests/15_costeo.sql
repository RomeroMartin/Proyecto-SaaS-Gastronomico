-- ============================================================================
-- Test Fase 0.7 — costeo en SQL: paridad con JS, snapshot, triggers y permisos
-- ============================================================================
begin;

\ir .gen/costeo_fixture.sql

create function t_snapshot_coherente(p_empresa uuid) returns boolean language plpgsql as $$
declare r record; v numeric;
begin
  for r in select id, nombre, costo_calculado_centavos from recetas where empresa_id = p_empresa and activo loop
    begin
      v := round(_costo_receta(r.id, '{}'::uuid[], 0));
    exception when others then
      continue;
    end;
    if v is distinct from r.costo_calculado_centavos then
      raise notice 'snapshot de % = %, calculado %', r.nombre, r.costo_calculado_centavos, v;
      return false;
    end if;
  end loop;
  return true;
end $$;

-- ---- Paridad con js/core/costeo.js (mismos casos que test/costeo_paridad.test.js) ----
set role authenticated;
select t_login('admA');
do $$
declare c record; v numeric;
begin
  for c in select * from t_costeo_esperado order by nombre loop
    if c.esperado is null then
      perform t_falla(format('select costo_receta(%L)', c.receta_id), 'costo_receta(' || c.nombre || ') debe fallar (ciclo / más de 4 niveles)');
    else
      v := costo_receta(c.receta_id);
      perform t_ok(abs(v - c.esperado) < 0.000001, format('costo_receta(%s) = %s (esperado %s)', c.nombre, v, c.esperado));
    end if;
  end loop;
end $$;
select t_falla($$select costo_receta((select receta_id from t_costeo_esperado where nombre = 'ciclo_x'))$$, 'el ciclo se informa con mensaje claro', 'circular');
select t_falla($$select costo_receta((select receta_id from t_costeo_esperado where nombre = 'profundo_5'))$$, 'más de 4 niveles se informa con mensaje claro', 'profundidad');

-- ---- Precisión: 12,5 ¢/g ya no se redondea ----
select t_igual((select costo_neto_por_unidad_base_centavos from insumos where nombre = 'aceite'), 12.5, 'el costo por unidad base conserva decimales (12,5 ¢/g)');
select t_igual((select costo_neto_por_unidad_base_centavos from insumos where nombre = 'sal'), 0.4, 'incluso por debajo de 1 centavo (0,4 ¢/g)');

-- ---- Snapshot ----
select t_igual((select count(*)::int from recetas where costo_calculado_centavos <> 0), 0, 'antes de recalcular, los snapshots están en 0');
select t_ok(recalcular_costos() > 0, 'recalcular_costos() actualiza snapshots');
select t_igual((select costo_calculado_centavos from recetas where nombre = 'masa'), 109595::bigint, 'snapshot de masa = round(109594,625)');
select t_igual((select costo_calculado_centavos from recetas where nombre = 'pizza'), 420649::bigint, 'snapshot de pizza = round(420648,65625)');
select t_igual((select costo_calculado_centavos from recetas where nombre = 'ciclo_x'), 0::bigint, 'una receta con ciclo conserva su snapshot (se omite)');
select t_igual(recalcular_costos(), 0, 'recalcular de nuevo no cambia nada');
reset role;
select t_ok(t_snapshot_coherente('11111111-1111-1111-1111-111111111111'), 'snapshots coherentes con el cálculo');

-- ---- Triggers: el snapshot no queda viejo aunque nadie llame a recalcular ----
update insumos set costo_neto_por_unidad_base_centavos = 300 where nombre = 'harina';
select t_igual((select costo_calculado_centavos from recetas where nombre = 'masa'), 218495::bigint, 'subir el costo de un insumo recalcula la receta sola (218494,625 → 218495)');
select t_ok(t_snapshot_coherente('11111111-1111-1111-1111-111111111111'), 'snapshots coherentes tras cambiar el costo');
update insumos set alicuota_iva = 0 where nombre = 'harina';
select t_ok(t_snapshot_coherente('11111111-1111-1111-1111-111111111111'), 'snapshots coherentes tras cambiar el IVA');
update insumos set factor_correccion = 0.5 where nombre = 'queso';
select t_ok(t_snapshot_coherente('11111111-1111-1111-1111-111111111111'), 'snapshots coherentes tras cambiar el factor de corrección');
update insumos set activo = false where nombre = 'queso';
select t_ok(t_snapshot_coherente('11111111-1111-1111-1111-111111111111'), 'snapshots coherentes tras dar de baja un insumo');
update recetas set activo = false where nombre = 'nivel_b';
select t_ok(t_snapshot_coherente('11111111-1111-1111-1111-111111111111'), 'snapshots coherentes tras dar de baja una sub-receta');
update recetas set rendimiento_cantidad = 4000 where nombre = 'masa';
select t_ok(t_snapshot_coherente('11111111-1111-1111-1111-111111111111'), 'snapshots coherentes tras cambiar el rendimiento de una sub-receta');

-- ---- Permisos y aislamiento ----
set role authenticated;
select t_login('cajA');
select t_falla($$select costo_receta((select receta_id from t_costeo_esperado where nombre = 'masa'))$$, 'CAJERO no consulta costos', 'Sin permiso');
select t_login('audA');
select t_ok(costo_receta((select receta_id from t_costeo_esperado where nombre = 'masa')) > 0, 'AUDITOR sí consulta costos');
select t_falla($$select recalcular_costos()$$, 'AUDITOR no puede recalcular', 'Sin permiso');
select t_login('cocA');
select t_ok(recalcular_costos() >= 0, 'COCINA sí puede recalcular');
select t_login('admB');
select t_falla($$select costo_receta((select receta_id from t_costeo_esperado where nombre = 'masa'))$$, 'otra empresa no ve costos de mis recetas', 'inexistente');
select t_falla($$select _costo_receta((select receta_id from t_costeo_esperado where nombre = 'masa'), '{}', 0)$$, 'la función interna no es invocable por el cliente', 'permission denied');
select t_falla($$select _recalcular_costos('11111111-1111-1111-1111-111111111111')$$, 'el recálculo interno no es invocable por el cliente', 'permission denied');
select t_login('inaA');
select t_falla($$select recalcular_costos()$$, 'usuario inactivo no opera', 'sin empresa');

rollback;
