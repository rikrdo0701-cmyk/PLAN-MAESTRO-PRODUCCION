// Candado del ReferenceError que la suite NO vio.
//
// MEDIDO 2026-09-30 en produccion: "No se pudieron guardar los catalogos: Cannot access
// 'fuera' before initialization". El apagado del borrado (BorradoDeCatalogosHabilitado) se
// inserto con la guarda ANTES de la declaracion de `fuera`, que es un const: usarla antes de
// declararla es un ReferenceError de zona muerta temporal.
//
// Y aqui esta lo que lo hace indigno: la suite estaba en 66 de 66 con el bug dentro. Ninguno
// de los 66 archivos ejecuta la rama de guardado de catalogos con la guarda apagada, porque el
// arnes de tests no llega a ese punto. Un fallo que la suite entera no puede ver no lo cubre
// ningun numero de tests al lado: lo cubre un test que ejecute esa rama.
//
// ESTE TEST NO EJECUTA LA RAMA. Afirma sobre el ORDEN, que es lo que se rompió y lo que se
// puede afirmar sin una base de datos. Es mas debIL que ejecutar el codigo, y por eso se dice
// aqui: es la red minima, no la buena.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const escritor = await readFile(new URL("../src/web/shared/supabase-writer.js", import.meta.url), "utf8");

test("la declaracion de `fuera` va ANTES de la guarda que la usa", () => {
  const decl = escritor.indexOf("const fuera = leidas.filter");
  const guarda = escritor.indexOf("if (!BorradoDeCatalogosHabilitado) {");
  const uso = escritor.indexOf("if (fuera.length) {");

  assert.ok(decl > 0, "no se encontro la declaracion de fuera");
  assert.ok(guarda > 0, "no se encontro la guarda del borrado");
  assert.ok(uso > 0, "no se encontro el uso de fuera dentro de la guarda");

  assert.ok(decl < guarda,
    "la declaracion de `fuera` tiene que ir antes de la guarda: usarla antes es un ReferenceError");
  assert.ok(guarda < uso,
    "el uso tiene que estar dentro de la guarda, despues de declararse");
});

test("la guarda del borrado apagado esta antes del borrado de verdad, no despues", () => {
  // Si la guarda se colgara despues del bucle de DELETE, la primera vez que se guardara un
  // catalogo con la bandera apagada ya habria borrado. El orden es la proteccion.
  const guarda = escritor.indexOf("if (!BorradoDeCatalogosHabilitado) {");
  const borraDeVerdad = escritor.indexOf("const cond = condicionDeClave(def, clave);");
  assert.ok(guarda > 0 && borraDeVerdad > 0, "no se localizaron las dos piezas");
  assert.ok(guarda < borraDeVerdad,
    "la guarda tiene que cortar ANTES de armar la condicion de borrado, no despues");
});
