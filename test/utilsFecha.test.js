// Tests de core/utilsFecha.js — cálculos de fechas de RRHH (lógica pura)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fechaOperativa,
  diasCorridos,
  antiguedadAnios,
  antiguedadTexto,
  sumarMeses,
  formatearFecha,
  fechaEnZona,
  hoyISO,
  addDias,
  diasEntre,
  setZonaHoraria,
  getZonaHoraria,
  ZONA_POR_DEFECTO,
} from "../js/core/utilsFecha.js";

test("diasCorridos: ambos extremos incluidos", () => {
  assert.equal(diasCorridos("2024-01-01", "2024-01-01"), 1);
  assert.equal(diasCorridos("2024-01-01", "2024-01-10"), 10);
  assert.equal(diasCorridos("2024-02-28", "2024-03-01"), 3); // 2024 bisiesto
});

test("diasCorridos: rango inválido o vacío → 0", () => {
  assert.equal(diasCorridos("2024-01-10", "2024-01-01"), 0);
  assert.equal(diasCorridos("", "2024-01-01"), 0);
  assert.equal(diasCorridos("2024-01-01", null), 0);
});

test("antiguedadAnios: años cumplidos", () => {
  assert.equal(antiguedadAnios("2020-06-15", "2024-06-15"), 4);
  assert.equal(antiguedadAnios("2020-06-15", "2024-06-14"), 3); // aún no cumple
  assert.equal(antiguedadAnios("2024-06-15", "2024-06-15"), 0);
});

test("antiguedadTexto: legible", () => {
  assert.equal(antiguedadTexto("2022-01-01", "2024-04-01"), "2 años y 3 meses");
  assert.equal(antiguedadTexto("2023-08-01", "2024-04-01"), "8 meses");
  assert.equal(antiguedadTexto("2024-03-20", "2024-04-01"), "menos de un mes");
});

test("sumarMeses: vencimiento = emisión + vigencia", () => {
  assert.equal(sumarMeses("2024-01-15", 12), "2025-01-15");
  assert.equal(sumarMeses("2024-01-31", 1), "2024-02-29"); // ajusta fin de mes
  assert.equal(sumarMeses("2024-06-01", 36), "2027-06-01");
  assert.equal(sumarMeses("2024-06-01", null), "");
});

test("formatearFecha: ISO → DD/MM/YYYY", () => {
  assert.equal(formatearFecha("2024-03-09"), "09/03/2024");
  assert.equal(formatearFecha(""), "—");
  assert.equal(formatearFecha("basura"), "—");
});

// ---------- Zona horaria (mismos casos que supabase/tests/13_fechas_zona.sql) ----------
const BA = "America/Argentina/Buenos_Aires";
const en = (iso, zona) => fechaEnZona(new Date(iso), zona);

test("fechaEnZona: 01:30 UTC es el día anterior en Buenos Aires y el siguiente en UTC", () => {
  assert.equal(en("2026-10-14T01:30:00Z", BA), "2026-10-13");
  assert.equal(en("2026-10-14T01:30:00Z", "UTC"), "2026-10-14");
});

test("fechaEnZona: el límite de medianoche local", () => {
  assert.equal(en("2026-10-14T03:00:00Z", BA), "2026-10-14");
  assert.equal(en("2026-10-14T02:59:59Z", BA), "2026-10-13");
});

test("fechaEnZona: cambio de año", () => {
  assert.equal(en("2026-12-31T23:30:00Z", BA), "2026-12-31");
  assert.equal(en("2027-01-01T02:30:00Z", BA), "2026-12-31");
});

test("hoyISO usa la zona configurada y setZonaHoraria ignora zonas inválidas", () => {
  const ahora = new Date("2026-10-14T01:30:00Z");
  assert.equal(getZonaHoraria(), ZONA_POR_DEFECTO);
  assert.equal(hoyISO(undefined, ahora), "2026-10-13");
  setZonaHoraria("Marte/Olimpo");
  assert.equal(getZonaHoraria(), ZONA_POR_DEFECTO);
  setZonaHoraria("UTC");
  assert.equal(hoyISO(undefined, ahora), "2026-10-14");
  setZonaHoraria(ZONA_POR_DEFECTO);
});

test("addDias: cruza meses, años y bisiestos", () => {
  assert.equal(addDias("2026-10-31", 1), "2026-11-01");
  assert.equal(addDias("2026-12-31", 1), "2027-01-01");
  assert.equal(addDias("2024-02-28", 1), "2024-02-29");
  assert.equal(addDias("2026-03-01", -1), "2026-02-28");
  assert.equal(addDias("2026-10-13", 0), "2026-10-13");
  assert.equal(addDias("", 1), "");
});

test("diasEntre: signo y datos faltantes", () => {
  assert.equal(diasEntre("2026-10-13", "2026-10-13"), 0);
  assert.equal(diasEntre("2026-10-13", "2026-10-20"), 7);
  assert.equal(diasEntre("2026-10-20", "2026-10-13"), -7);
  assert.equal(diasEntre("2026-10-13", ""), null);
});

test("fechaOperativa: mismos casos que fecha_operativa() de SQL", () => {
  const BA = "America/Argentina/Buenos_Aires";
  const op = (iso, zona = BA, corte = "06:00") => fechaOperativa(new Date(iso), zona, corte);
  assert.equal(op("2026-03-10T19:30:00-03:00"), "2026-03-10"); // 19:30 → mismo día
  assert.equal(op("2026-03-11T00:40:00-03:00"), "2026-03-10"); // 00:40 → día anterior
  assert.equal(op("2026-03-11T05:59:00-03:00"), "2026-03-10"); // 05:59 → día anterior
  assert.equal(op("2026-03-11T06:00:00-03:00"), "2026-03-11"); // 06:00 → mismo día
  assert.equal(op("2026-03-01T01:00:00-03:00"), "2026-02-28"); // cambio de mes
  assert.equal(op("2027-01-01T02:00:00-03:00"), "2026-12-31"); // cambio de año
  assert.equal(op("2026-03-11T02:30:00-03:00", BA, "03:00"), "2026-03-10"); // corte configurable
  assert.equal(op("2026-03-11T02:30:00Z", "America/Mexico_City"), "2026-03-10"); // otra zona
});
