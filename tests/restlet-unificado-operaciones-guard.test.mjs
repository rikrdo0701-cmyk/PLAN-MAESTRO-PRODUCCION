// =============================================================================
// GUARDIA: EL 2246 NUNCA PUEDE DEVOLVER ENSAMBLES COMO OPERACIONES
// =============================================================================
//
// MEDIDO 2026-10-29 en produccion: la ingesta fallaba en `operations` con
//
//   operations: ERROR al escribir: Supabase rpc ingesta_mirror operations 409:
//   codigo 23505 | duplicate key value violates unique constraint "operations_operation_id_key"
//
// y `ensambles_ot` con el 400 de build_tranid. La causa: en el commit cb99d81, el SQL de
// `operaciones_()` (netsuite-restlet-unificado-supabase.js) fue REEMPLAZADO por el de
// `ensambles_()` — la consulta de WOCompl. Con ese SQL equivocado, `operaciones` devolvia
// las filas de ensamble y cada una se mapeaba con `operation_id='ns-'` (todas iguales), asi
// que el mirror moria en el segundo INSERT por duplicate key y la tabla conservaba lo
// anterior. Ningun test lo atrapo porque ninguno comprobaba de QUE consulta salia la accion.
//
// Este guardia ata las DOS acciones a su consulta: operaciones lee de
// `manufacturingoperationtask` (así se llama la tabla real, medido 2026-09-28) y ensambles
// de WOCompl. Si alguien vuelve a copiar el SQL de una a la otra, falla aqui antes de
// desplegarse a NetSuite.
//
// Por qué se prueba sobre el TEXTO y no con el harness: el harness del restlet ya cubre el
// comportamiento (tests/restlet-unificado-workorders-cerradas.test.mjs). Aqui el punto es
// el archivo fuente: una consulta equivocada no se detecta con respuestas falsas, y el
// target es que el texto no vuelva a mezclarse.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const fuente = await readFile(new URL("../netsuite-restlet-unificado-supabase.js", import.meta.url), "utf8");

/** Extrae el cuerpo de `function X_()` solo con CODIGO (comentarios fuera). */
function cuerpoDe(nombre) {
  const inicio = fuente.indexOf("function " + nombre + "_()");
  assert.ok(inicio >= 0, "el 2246 tiene que declarar " + nombre + "_: se busco y no existe");
  const desde = fuente.indexOf("{", inicio);
  let nivel = 0;
  let i = desde;
  let abierto = false;
  for (; i < fuente.length; i += 1) {
    const c = fuente[i];
    if (c === "{") { nivel += 1; abierto = true; }
    if (c === "}") { nivel -= 1; if (abierto && nivel === 0) break; }
  }
  const cuerpo = fuente.slice(desde, i + 1);
  // Solo codigo: los comentarios describen el pasado (el de operaciones explica que llego a
  // ser el SQL de ensambles) y un `// WOCompl` en prosa no debe sonar como consulta.
  return cuerpo
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\/\*(?!.*\*\/)[\s\S]*$/g, " ");
}

test("la accion operaciones lee de manufacturingoperationtask y NO de WOCompl", () => {
  const cuerpo = cuerpoDe("operaciones");
  assert.match(cuerpo, /FROM manufacturingoperationtask mot/, "operaciones consulta manufacturingoperationtask");
  assert.match(cuerpo, /mot\.id AS workorder_id/, "el id de la operacion sale de mot.id");
  assert.doesNotMatch(cuerpo, /WOCompl/, "nunca la consulta de completo de ensamble");
  assert.doesNotMatch(cuerpo, /build_tranid/, "nunca la columna de ensambles");
  assert.doesNotMatch(cuerpo, /AS build_id/, "nunca la clave de ensambles");
});

test("la accion ensambles lee de WOCompl y NO manufactura", () => {
  const cuerpo = cuerpoDe("ensambles");
  assert.match(cuerpo, /WHERE tr\.type = 'WOCompl'/, "ensambles consulta WOCompl");
  assert.match(cuerpo, /AS build_tranid/, "lleva build_tranid, que el resto no tiene");
  assert.doesNotMatch(cuerpo, /manufacturingoperationtask/, "ensambles nunca la tabla de operaciones");
  assert.doesNotMatch(cuerpo, /operation_id/, "ensambles nunca emite operation_id");
});

test("las dos consultas NO comparten el mismo arreglo sql (la regresion de cb99d81)", () => {
  // En la regresion, `operaciones_` apuntaba al MISMO bloque de ensambles. Aunque hoy
  // fueran identicas en texto (copiadas a mano), la prueba de fondo es que tengan el
  // mismo comportamiento: distinta tabla de origen. Este test solo enuncia la regla:
  // si alguien une las dos funciones, que lo haga con los ojos abiertos.
  const operaciones = cuerpoDe("operaciones");
  const ensambles = cuerpoDe("ensambles");
  assert.match(operaciones, /manufacturingoperationtask/);
  assert.match(ensambles, /WOCompl/);
});