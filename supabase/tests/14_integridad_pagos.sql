-- ============================================================================
-- Test Fase 0.5 — integridad de pagos/facturas y bajas lógicas de RRHH
-- ============================================================================
begin;

-- Invariante contable (lo crea el superusuario; lo corre cada usuario con su RLS):
--   saldo del proveedor = Σ saldo pendiente de facturas no anuladas − Σ excedentes de pagos
-- (excedente = monto del pago − lo imputado; los contraasientos cancelan al original).
create function t_invariante(p_prov uuid) returns void language plpgsql as $$
declare v_saldo bigint; v_fact bigint; v_exc bigint; v_mal int;
begin
  select saldo_total_deuda_centavos into v_saldo from proveedores where id = p_prov;
  select coalesce(sum(saldo_pendiente_centavos), 0) into v_fact
    from facturas where proveedor_id = p_prov and estado <> 'anulada';
  select coalesce(sum(p.monto_pagado_centavos - coalesce(
           (select sum(i.monto_imputado_centavos) from pago_imputaciones i where i.pago_id = p.id), 0)), 0) into v_exc
    from pagos p where p.proveedor_id = p_prov;
  if v_saldo <> v_fact - v_exc then
    raise exception 'FALLA invariante de saldos: saldo=% facturas=% excedente=%', v_saldo, v_fact, v_exc;
  end if;
  select count(*) into v_mal from facturas
    where proveedor_id = p_prov and (saldo_pendiente_centavos < 0 or saldo_pendiente_centavos > monto_total_centavos);
  if v_mal > 0 then raise exception 'FALLA: % facturas con saldo fuera de rango', v_mal; end if;
  select count(*) into v_mal from facturas
    where proveedor_id = p_prov and estado = 'pagada' and saldo_pendiente_centavos <> 0;
  if v_mal > 0 then raise exception 'FALLA: % facturas "pagada" con saldo', v_mal; end if;
end $$;

set role authenticated;

-- ---- Roles en las RPC de pagos ----
select t_login('admA');
select crear_factura('c1000000-0000-0000-0000-000000000001','A','P-1',current_date,null,10000,0,0,10000,null,null,0) as f1 \gset
select registrar_pago('c1000000-0000-0000-0000-000000000001', 4000, 'efectivo', 'r1', null, 'fifo', null) as p1 \gset

select t_login('audA');
select t_falla($$select registrar_pago('c1000000-0000-0000-0000-000000000001', 1, 'efectivo', null, null, 'fifo', null)$$, 'AUDITOR no puede registrar pagos', 'Sin permiso');
select t_falla(format('select anular_pago(%L)', :'p1'), 'AUDITOR no puede anular pagos', 'Sin permiso');
select t_login('cocA');
select t_falla($$select registrar_pago('c1000000-0000-0000-0000-000000000001', 1, 'efectivo', null, null, 'fifo', null)$$, 'COCINA no puede registrar pagos', 'Sin permiso');
select t_login('cajA');
select t_falla($$select registrar_pago('c1000000-0000-0000-0000-000000000001', 1, 'efectivo', null, null, 'fifo', null)$$, 'CAJERO no puede registrar pagos', 'Sin permiso');
select t_login('gerA');
select t_ok(registrar_pago('c1000000-0000-0000-0000-000000000001', 1000, 'efectivo', null, null, 'fifo', null) is not null, 'GERENTE sí registra pagos');
select t_login('admB');
select t_falla(format('select anular_pago(%L)', :'p1'), 'otra empresa no puede anular mis pagos', 'inexistente');

-- ---- Contraasientos ----
select t_login('admA');
select t_igual((select saldo_total_deuda_centavos from proveedores where id = 'c1000000-0000-0000-0000-000000000001'), 5000::bigint, 'deuda tras 2 pagos');
select anular_pago(:'p1') as contra \gset
select t_igual((select saldo_total_deuda_centavos from proveedores where id = 'c1000000-0000-0000-0000-000000000001'), 9000::bigint, 'anular el pago devuelve la deuda');
select t_falla(format('select anular_pago(%L)', :'contra'), 'no se puede anular un contraasiento', 'contraasiento');
select t_falla(format('select anular_pago(%L)', :'p1'), 'no se puede anular dos veces el mismo pago', 'ya está anulado');
select t_igual((select saldo_total_deuda_centavos from proveedores where id = 'c1000000-0000-0000-0000-000000000001'), 9000::bigint, 'la deuda no cambió tras los intentos rechazados');
select t_invariante('c1000000-0000-0000-0000-000000000001');

-- ---- Secuencia aleatoria de operaciones: el invariante se mantiene siempre ----
do $$
declare
  prov uuid := 'c1000000-0000-0000-0000-000000000001';
  i int; op int; x uuid; ids uuid[]; m bigint; ok_pagos int; ok_anul int;
begin
  perform setseed(0.42);
  for i in 1..400 loop
    op := floor(random() * 7)::int;
    begin
      m := 1 + floor(random() * 50000)::bigint;
      if op in (0, 1) then
        perform crear_factura(prov, 'A', 'R-' || i, current_date, null, m, 0, 0, m, null, null, 0);
      elsif op = 2 then
        perform registrar_pago(prov, 1 + floor(random() * 40000)::bigint, 'efectivo', null, null, 'fifo', null);
      elsif op = 3 then
        select array_agg(id) into ids from (
          select id from facturas where proveedor_id = prov and estado <> 'anulada' and saldo_pendiente_centavos > 0
          order by random() limit 2) q;
        perform registrar_pago(prov, 1 + floor(random() * 40000)::bigint, 'transferencia', null, null, 'manual', ids);
      elsif op = 4 then
        select id into x from pagos where proveedor_id = prov and estado = 'activo' and monto_pagado_centavos > 0 order by random() limit 1;
        if x is not null then perform anular_pago(x); end if;
      elsif op = 5 then
        select id into x from facturas where proveedor_id = prov and estado <> 'anulada' order by random() limit 1;
        if x is not null then perform anular_factura(x); end if;
      else
        select id into x from facturas where proveedor_id = prov and estado <> 'anulada' order by random() limit 1;
        if x is not null then
          perform editar_factura(x, prov, 'A', 'E-' || i, current_date, null, m, 0, 0, 0, m, null);
        end if;
      end if;
    exception when others then
      null;   -- operación rechazada por una regla de negocio: es lo esperado
    end;
    perform t_invariante(prov);
  end loop;
  select count(*) into ok_pagos from pagos where proveedor_id = prov and monto_pagado_centavos > 0;
  select count(*) into ok_anul from pagos where proveedor_id = prov and estado = 'anulado';
  perform t_ok(ok_pagos >= 30 and ok_anul >= 3,
    format('la secuencia aleatoria hizo trabajo real (%s pagos, %s anulados) y el invariante se sostuvo 400 veces', ok_pagos, ok_anul));
end $$;

-- ---- RRHH: baja lógica ----
reset role;
do $$
declare ea uuid := '11111111-1111-1111-1111-111111111111'; emp uuid := gen_random_uuid(); td uuid := gen_random_uuid();
begin
  insert into empleados (id, empresa_id, nombre, apellido, fecha_ingreso) values (emp, ea, 'Lu', 'Gil', date '2020-01-01');
  insert into tipos_documento (id, empresa_id, nombre) values (td, ea, 'DNI');
  perform set_config('t.emp', emp::text, false); perform set_config('t.td', td::text, false);
end $$;
set role authenticated;
select t_login('gerA');

insert into ausencias (empleado_id, tipo, desde, hasta, dias)
  values (current_setting('t.emp')::uuid, 'vacaciones', make_date(extract(year from hoy_empresa())::int, 3, 10), make_date(extract(year from hoy_empresa())::int, 3, 14), 5);
select t_falla($$insert into ausencias (empleado_id, tipo, desde, hasta, dias)
  values (current_setting('t.emp')::uuid, 'franco', make_date(extract(year from hoy_empresa())::int, 3, 12), make_date(extract(year from hoy_empresa())::int, 3, 13), 2)$$,
  'dos ausencias activas no pueden solaparse', 'exclusion');
select t_igual((select tomados from vw_saldo_vacaciones where empleado_id = current_setting('t.emp')::uuid), 5, 'las vacaciones activas cuentan en el saldo');
select t_falla($$delete from ausencias$$, 'el cliente no puede borrar ausencias (baja lógica)', 'permission denied');
select t_filas($$update ausencias set activo = false$$, 1, 'la baja lógica de una ausencia sí se puede');
select t_igual((select tomados from vw_saldo_vacaciones where empleado_id = current_setting('t.emp')::uuid), 0, 'una ausencia dada de baja deja de contar');
select t_filas($$insert into ausencias (empleado_id, tipo, desde, hasta, dias)
  values (current_setting('t.emp')::uuid, 'franco', make_date(extract(year from hoy_empresa())::int, 3, 12), make_date(extract(year from hoy_empresa())::int, 3, 13), 2)$$,
  1, 'tras la baja lógica el período queda libre');

insert into documentos (empleado_id, tipo_documento_id, fecha_vencimiento)
  values (current_setting('t.emp')::uuid, current_setting('t.td')::uuid, hoy_empresa() - 5);
select t_igual((select count(*)::int from vw_documentos_estado where estado = 'vencido'), 1, 'documento vencido visible');
select t_falla($$delete from documentos$$, 'el cliente no puede borrar documentos (baja lógica)', 'permission denied');
select t_filas($$update documentos set activo = false$$, 1, 'la baja lógica de un documento sí se puede');
select t_igual((select count(*)::int from vw_documentos_estado where estado = 'vencido'), 0, 'un documento dado de baja sale del tablero de vencimientos');

rollback;
