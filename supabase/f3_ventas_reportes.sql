-- ============================================================================
-- SaaS Gastronómico — Fase 3: Rentabilidad real (ventas × costo)
-- ----------------------------------------------------------------------------
-- Vistas de lo que REALMENTE se vendió (pedidos no anulados) con el costo que
-- tenía cada receta AL MOMENTO de la venta (snapshot de crear_pedido), y las
-- compras del período para contrastarlas.
--
-- HONESTIDAD METODOLÓGICA: `costo_centavos` es el COSTO TEÓRICO de lo vendido
-- (unidades × costo de receta): no ve mermas, porciones de más ni pérdidas. No es
-- el "food cost real" (eso exige inventario). Se contrasta con las COMPRAS del
-- período; la diferencia es una señal de desperdicio, no una verdad.
--
-- Todas las vistas son security_invoker: respetan la RLS de pedidos/turnos/
-- facturas (ADMIN, GERENTE y AUDITOR leen; CAJERO y COCINA no ven nada).
-- Todo agrupa por `fecha_operativa` (el día de negocio), nunca por creado_en.
--
-- Orden: después de f2_ventas_rpc.sql. Idempotente.
-- ============================================================================

-- Rubros de proveedor que NO cuentan como mercadería en las compras (por empresa).
alter table empresas add column if not exists rubros_excluidos_cmv text[] not null
  default '{Limpieza,Descartables}';
revoke update (rubros_excluidos_cmv) on empresas from authenticated;

-- ---------------------------------------------------------------------------
-- Por plato: unidades, ingreso a precio de lista (lo que se cobró por el
-- producto, sin descuentos globales ni envío) y costo teórico. Los adicionales
-- cuentan como su propia receta.
-- ---------------------------------------------------------------------------
create or replace view v_ventas_por_plato with (security_invoker = true) as
select t.empresa_id, t.fecha_operativa, i.receta_id,
       max(i.nombre_snapshot)                              as nombre,
       sum(i.cantidad)::bigint                             as unidades,
       sum(i.cantidad * i.precio_unit_centavos)::bigint    as ingreso_centavos,
       sum(i.cantidad * i.costo_unit_centavos)::bigint     as costo_centavos
  from pedido_items i
  join pedidos p on p.id = i.pedido_id
  join turnos_caja t on t.id = p.turno_id
 where p.estado <> 'anulado'
 group by t.empresa_id, t.fecha_operativa, i.receta_id;

-- ---------------------------------------------------------------------------
-- Por día operativo.
--   ingreso_centavos          = lo cobrado (coincide con la suma de los cierres de caja)
--   productos_netos_centavos  = productos − descuentos (base del CMV teórico %)
--   envio_centavos            = envíos cobrados (no son venta de producto)
-- ---------------------------------------------------------------------------
create or replace view v_ventas_por_dia with (security_invoker = true) as
select t.empresa_id, t.fecha_operativa,
       count(*) filter (where p.estado <> 'anulado')::int                                   as pedidos,
       coalesce(sum(p.total_centavos) filter (where p.estado <> 'anulado'), 0)::bigint      as ingreso_centavos,
       coalesce(sum(p.subtotal_centavos - p.descuento_centavos) filter (where p.estado <> 'anulado'), 0)::bigint as productos_netos_centavos,
       coalesce(sum(p.descuento_centavos) filter (where p.estado <> 'anulado'), 0)::bigint  as descuento_centavos,
       coalesce(sum(p.envio_centavos) filter (where p.estado <> 'anulado'), 0)::bigint      as envio_centavos,
       coalesce(sum(p.costo_total_centavos) filter (where p.estado <> 'anulado'), 0)::bigint as costo_centavos,
       count(*) filter (where p.estado = 'anulado')::int                                    as anulados,
       coalesce(sum(p.total_centavos) filter (where p.estado = 'anulado'), 0)::bigint       as monto_anulado_centavos
  from pedidos p
  join turnos_caja t on t.id = p.turno_id
 group by t.empresa_id, t.fecha_operativa;

-- ---------------------------------------------------------------------------
-- Por franja horaria (hora LOCAL de la empresa) y día de la semana (1 = lunes … 7 = domingo,
-- del día operativo). Sirve para el tablero y para proyecciones.
-- ---------------------------------------------------------------------------
create or replace view v_ventas_por_hora with (security_invoker = true) as
select t.empresa_id, t.fecha_operativa,
       extract(isodow from t.fecha_operativa)::int                                    as dow,
       extract(hour from p.creado_en at time zone e.zona_horaria)::int                as hora,
       count(*)::int                                                                  as pedidos,
       sum(p.total_centavos)::bigint                                                  as ingreso_centavos
  from pedidos p
  join turnos_caja t on t.id = p.turno_id
  join empresas e on e.id = t.empresa_id
 where p.estado <> 'anulado'
 group by t.empresa_id, t.fecha_operativa, extract(hour from p.creado_en at time zone e.zona_horaria);

grant select on v_ventas_por_plato, v_ventas_por_dia, v_ventas_por_hora to authenticated;

-- ---------------------------------------------------------------------------
-- Compras del período: facturas no anuladas por fecha de emisión, de los rubros
-- que cuentan como mercadería. Importe = neto + IVA discriminado (misma base que
-- el costo de las recetas, que incluye IVA); no incluye percepciones.
-- Es SECURITY INVOKER: solo quien puede leer facturas (ADMIN/GERENTE/AUDITOR) ve algo.
-- ---------------------------------------------------------------------------
create or replace function compras_periodo(p_desde date, p_hasta date)
returns jsonb language plpgsql stable set search_path = public as $$
declare v_excl text[]; v_compras bigint; v_excluidas bigint; v_n int;
begin
  if p_desde is null or p_hasta is null or p_hasta < p_desde then raise exception 'Rango de fechas inválido.'; end if;
  select coalesce(array_agg(lower(btrim(x))), '{}') into v_excl
    from empresas e, unnest(e.rubros_excluidos_cmv) x where e.id = mi_empresa();
  select coalesce(sum(f.neto_gravado_centavos + f.iva_discriminado_centavos) filter (where not (lower(btrim(coalesce(pr.rubro_principal, ''))) = any (v_excl))), 0),
         coalesce(sum(f.neto_gravado_centavos + f.iva_discriminado_centavos) filter (where lower(btrim(coalesce(pr.rubro_principal, ''))) = any (v_excl)), 0),
         count(*) filter (where not (lower(btrim(coalesce(pr.rubro_principal, ''))) = any (v_excl)))
    into v_compras, v_excluidas, v_n
    from facturas f join proveedores pr on pr.id = f.proveedor_id
   where f.empresa_id = mi_empresa() and f.activo and f.estado <> 'anulada'
     and f.fecha_emision between p_desde and p_hasta;
  return jsonb_build_object('compras_centavos', v_compras, 'excluidas_centavos', v_excluidas, 'facturas', v_n,
                            'desde', p_desde, 'hasta', p_hasta);
end;
$$;
grant execute on function compras_periodo(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- set_config_reportes(clave, valor) — configuración de los reportes (solo ADMIN, auditada).
--   rubros_excluidos_cmv : lista de rubros de proveedor que no son mercadería.
-- ---------------------------------------------------------------------------
create or replace function set_config_reportes(p_clave text, p_valor jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_antes jsonb; v_arr text[];
begin
  v_empresa := _ventas_empresa(array['ADMIN']);
  select to_jsonb(e) -> p_clave into v_antes from empresas e where id = v_empresa;
  if p_clave = 'rubros_excluidos_cmv' then
    if jsonb_typeof(p_valor) <> 'array' then raise exception 'Valor inválido: se espera una lista de rubros.'; end if;
    select coalesce(array_agg(distinct btrim(x)) filter (where btrim(x) <> ''), '{}') into v_arr from jsonb_array_elements_text(p_valor) x;
    if cardinality(v_arr) > 30 or exists (select 1 from unnest(v_arr) y where length(y) > 100) then
      raise exception 'Demasiados rubros o un nombre demasiado largo.';
    end if;
    update empresas set rubros_excluidos_cmv = v_arr where id = v_empresa;
  else
    raise exception 'Parámetro desconocido: %.', p_clave;
  end if;
  perform auditar('config_reportes', 'empresas', v_empresa,
    jsonb_build_object(p_clave, v_antes), jsonb_build_object(p_clave, p_valor));
end;
$$;
grant execute on function set_config_reportes(text, jsonb) to authenticated;
