// El candado del borrado por DIFERENCIA, que murio el 2026-10-06 (RULE-SUP-061).
//
// HISTORIA, MEDIDA: hasta hoy, guardarCatalogos decidia que borrar comparando las claves
// leidas al arrancar con las que el estado tiene ahora, y apago TODO con una bandera
// (BorradoDeCatalogosHabilitado = false) despues de que esa comparacion borrara 76 filas de
// ot_configurations el 2026-09-30: las dos listas salen del MISMO estado, y quien guarda no
// puede distinguir "la persona la quito" de "el navegador simplemente no la tiene".
// Ese apagado dejo el candado viejo (el orden guarda/declaracion de `fuera`) como un
// ReferenceError esperando: la suite estaba en verde con el bug dentro porque NINGUN archivo
// ejecutaba esa rama.
//
// LO QUE HAY AHORA (RULE-SUP-061): la bandera NO EXISTE y el borrado es por INTENCION — solo
// borra claves registradas en state.__borradosPendientes por el handler que quito la fila,
// con el registro limpiado solo cuando el DELETE tuvo exito. El candado bueno, el que EJECUTA
// la rama (borrar con intencion, no borrar por diferencia, anular la intencion si la fila
// volvio, reintentar un DELETE fallido), vive en tests/borrado-a-proposito.test.mjs.
//
// ESTE TEST ES LA RED MINIMA de fuente: afirma lo que solo se ve leyendo el codigo — que la
// bandera no puede volver, y que donde existe `fuera` (lo que el navegador no tiene) no hay
// NINGUNA peticion. Es mas debil que ejecutar el codigo, y por eso se dice aqui.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const escritor = await readFile(new URL("../src/web/shared/supabase-writer.js", import.meta.url), "utf8");

test("la bandera del borrado por diferencia no puede volver: ya no existe ni apagada", () => {
  assert.ok(!escritor.includes("BorradoDeCatalogosHabilitado"),
    "BorradoDeCatalogosHabilitado volvio al fuente. El borrado por diferencia (leidas vs estado) " +
    "no es una bandera que se enciende y se apaga: es un modelo que se retiro (RULE-SUP-061)");
});

test("`fuera` (lo que el navegador no tiene) vive donde NO hay ninguna peticion", () => {
  // Desde que se declara `fuera` hasta el cierre de guardarCatalogos no puede haber ni un
  // pedir(: si lo hubiera, una fila que el navegador no tiene podria recibir un DELETE sin
  // intencion registrada, que es exactamente el fallo del 2026-09-30.
  const decl = escritor.indexOf("const fuera = leidas.filter");
  assert.ok(decl > 0, "no se encontro la declaracion de fuera");
  const cierre = escritor.indexOf("return cerrar(informe, t0);", decl);
  assert.ok(cierre > decl, "no se encontro el cierre de guardarCatalogos despues de fuera");
  const tramo = escritor.slice(decl, cierre);
  assert.ok(!tramo.includes("pedir("),
    "hay una peticion en el tramo donde existe `fuera`: la diferencia entre lo leido y lo que hay " +
    "no puede tocar la red, solo puede avisar");
});

test("el unico DELETE por clave se dispara despues de leer __borradosPendientes", () => {
  const declaraPendientes = escritor.indexOf("const pendientes = datos.__borradosPendientes");
  assert.ok(declaraPendientes > 0, "no se encontro la lectura de __borradosPendientes");
  const borraDeVerdad = escritor.indexOf('await pedir(ctx.token, "DELETE", tabla, { condicion: cond })');
  assert.ok(borraDeVerdad > 0, "no se encontro el DELETE por clave");
  assert.ok(declaraPendientes < borraDeVerdad,
    "el DELETE por clave tiene que vivir DESPUES de leer __borradosPendientes: sin intencion " +
    "registrada no hay borrado");
  assert.ok(escritor.includes("registrarBorrado: registrarBorrado"),
    "registrarBorrado no esta en la API del escritor: la intencion no tendria puerta de entrada");
});
