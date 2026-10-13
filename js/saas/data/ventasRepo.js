// ============================================================
// saas/data/ventasRepo.js — Ventas de mostrador (Fase 2)
// ------------------------------------------------------------
// Todo se escribe por RPC (la base valida rol, precios y costos).
// El cajero no lee tablas de negocio: solo estas funciones y los
// pedidos/turnos del turno abierto.
// ============================================================

import { supabase } from "../../config/supabase.js";

async function rpc(nombre, args = {}) {
  const { data, error } = await supabase.rpc(nombre, args);
  if (error) throw error;
  return data;
}

// ---------- Configuración ----------
export const configCobro = () => rpc("config_cobro");
export const cartaMostrador = () => rpc("carta_mostrador");
export const setConfigVentas = (clave, valor) => rpc("set_config_ventas", { p_clave: clave, p_valor: valor });
export const configurarVentaReceta = (id, vende, categoria, orden, esAdicional) =>
  rpc("configurar_venta_receta", {
    p_receta: id, p_vende: !!vende, p_categoria: categoria || null, p_orden: Number(orden) || 0, p_es_adicional: !!esAdicional,
  });

// ---------- Turnos ----------
/** Turno abierto de la empresa (o null). */
export async function turnoAbierto() {
  const { data, error } = await supabase.from("turnos_caja").select("*").eq("estado", "abierto")
    .order("abierto_en", { ascending: false }).limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
}
export const abrirTurno = (fondoCentavos) => rpc("abrir_turno", { p_fondo_inicial: fondoCentavos, p_sucursal: null });
export const resumenTurno = (id) => rpc("resumen_turno", { p_turno: id });
export const cerrarTurno = (id, contadoCentavos, nota) =>
  rpc("cerrar_turno", { p_turno: id, p_efectivo_contado: contadoCentavos, p_nota: nota || null });
export const reabrirTurno = (id, motivo) => rpc("reabrir_turno", { p_turno: id, p_motivo: motivo });
export const registrarEgreso = (turnoId, montoCentavos, categoria, nota) =>
  rpc("registrar_egreso_turno", { p_turno: turnoId, p_monto: montoCentavos, p_categoria: categoria, p_nota: nota || null });

/** Turnos cerrados (más recientes primero). Solo ADMIN/GERENTE/AUDITOR (por RLS). */
export async function turnosCerrados(limite = 60) {
  const { data, error } = await supabase.from("turnos_caja").select("*").eq("estado", "cerrado")
    .order("fecha_operativa", { ascending: false }).order("abierto_en", { ascending: false }).limit(limite);
  if (error) throw error;
  return data || [];
}

// ---------- Pedidos ----------
/** UUID para idempotencia (crear_pedido no duplica ante reintentos de red). */
export function nuevoClientUuid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const crearPedido = (turnoId, datos, items, pagos, clientUuid) =>
  rpc("crear_pedido", { p_turno: turnoId, p_datos: datos, p_items: items, p_pagos: pagos, p_client_uuid: clientUuid });
export const marcarEntregado = (id) => rpc("marcar_entregado", { p_pedido: id });
export const anularPedido = (id, motivo) => rpc("anular_pedido", { p_pedido: id, p_motivo: motivo });
export const registrarComanda = (id, via) => rpc("registrar_comanda", { p_pedido: id, p_via: via });

/**
 * Pedidos de un turno con sus items (adicionales anidados) y pagos, listos para
 * la lógica pura (core/ventas.js).
 */
export async function pedidosDelTurno(turnoId) {
  const { data: pedidos, error } = await supabase.from("pedidos").select("*").eq("turno_id", turnoId)
    .order("numero", { ascending: true });
  if (error) throw error;
  if (!pedidos || !pedidos.length) return [];
  const ids = pedidos.map((p) => p.id);
  const [it, pg] = await Promise.all([
    supabase.from("pedido_items").select("*").in("pedido_id", ids),
    supabase.from("pedido_pagos").select("*").in("pedido_id", ids),
  ]);
  if (it.error) throw it.error;
  if (pg.error) throw pg.error;
  return pedidos.map((p) => ({ ...p, items: armarItems((it.data || []).filter((x) => x.pedido_id === p.id)),
    pagos: (pg.data || []).filter((x) => x.pedido_id === p.id) }));
}

/** Items planos de la base → [{nombre, cantidad, precio_unit_centavos, nota, adicionales:[…]}]. */
export function armarItems(filas) {
  const base = (f) => ({ nombre: f.nombre_snapshot, cantidad: f.cantidad, precio_unit_centavos: Number(f.precio_unit_centavos), nota: f.nota || "" });
  return filas.filter((f) => !f.item_padre_id).map((f) => ({
    ...base(f),
    adicionales: filas.filter((a) => a.item_padre_id === f.id).map(base),
  }));
}

/** Egresos de efectivo registrados en el turno (para el resumen). */
export async function egresosDelTurno(turnoId) {
  const { data, error } = await supabase.from("movimientos_caja").select("*")
    .eq("turno_id", turnoId).eq("origen", "turno").eq("activo", true);
  if (error) throw error;
  return data || [];
}
