import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODULOS_VALIDOS, MODULOS_POR_DEFECTO, normalizarModulos, moduloActivo, validarModulos,
} from "../js/core/modulos.js";

test("normalizarModulos: sin dato asume los módulos por defecto", () => {
  assert.deepEqual(normalizarModulos(undefined), MODULOS_POR_DEFECTO);
  assert.deepEqual(normalizarModulos(null), MODULOS_POR_DEFECTO);
});

test("normalizarModulos: ordena, quita repetidos y desconocidos", () => {
  assert.deepEqual(normalizarModulos(["reparto", "admin", "admin", "xyz"]), ["admin", "reparto"]);
});

test("moduloActivo: config siempre; el resto según la lista", () => {
  assert.equal(moduloActivo(["admin"], "config"), true);
  assert.equal(moduloActivo([], "config"), true);
  assert.equal(moduloActivo(["admin", "costos"], "costos"), true);
  assert.equal(moduloActivo(["admin", "costos"], "rrhh"), false);
  assert.equal(moduloActivo(undefined, "rrhh"), true); // perfil viejo: lo de siempre
  assert.equal(moduloActivo(undefined, "ventas"), false);
});

test("validarModulos: perfiles válidos", () => {
  assert.equal(validarModulos(MODULOS_VALIDOS).ok, true);
  assert.equal(validarModulos(["admin", "carta", "ventas", "reparto"]).ok, true); // mostrador sin RRHH
  assert.equal(validarModulos(["admin", "reparto"]).ok, true); // reparto sin rrhh
  assert.equal(validarModulos(["costos"]).ok, true);
});

test("validarModulos: dependencias, vacío y desconocidos", () => {
  assert.equal(validarModulos(["admin", "ventas"]).ok, false);
  assert.equal(validarModulos(["carta", "ventas"]).ok, false);
  assert.equal(validarModulos(["costos", "reparto"]).ok, false);
  assert.equal(validarModulos([]).ok, false);
  assert.equal(validarModulos(["admin", "inventado"]).ok, false);
  assert.equal(validarModulos(null).ok, false);
  assert.match(validarModulos(["admin", "ventas"]).errores[0], /ventas requiere/);
});
