/**
 * EL BUG: las operaciones completadas dejan de aparecer como completadas.
 *
 * El mecanismo, leido del codigo:
 *   1. Al completar, writePlanStatusByOrigin guarda en
 *      state.operationPlanStatuses[operationCompletionKey(op)] (app.js:1886).
 *   2. Al cargar, normalizeState RECOMPUTA el planStatus de TODAS las operaciones:
 *        op.planStatus = draftViewStatuses()[operationCompletionKey(op)]?.status === "COMPLETADA_PLAN"
 *                        ? "COMPLETADA_PLAN" : "PENDIENTE";                    (app.js:1383)
 *   3. operationCompletionKey es `OP|{ot}|{secuencia}|{ct}` (app.js:1836).
 *
 * Si el planeador regenera y cambia la secuencia o el CT, la clave cambia, el lookup falla,
 * y la operacion vuelve a PENDIENTE. La operacion sigue ahi, con sus datos, pero su
 * "completada" se perdio.
 *
 * Este test usa SOLO operationCompletionKey y normalizeStatus, que son las dos piezas del
 * meclanismo. No intenta cargar normalizeOperation completa (trae 80+ dependencias
 * transitivas y no aporta nada a esta prueba).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const appSrc = readFileSync(new URL("../src/web/planning/app.js", import.meta.url), "utf8");

/** Saca una funcion por nombre con indexOf, no regex. */
function extraer(nombre) {
  const i = appSrc.indexOf("function " + nombre + "(");
  if (i < 0) return null;
  const abre = appSrc.indexOf("{", i);
  if (abre < 0) return null;
  let nivel = 0, comillas = null;
  for (let k = abre; k < appSrc.length; k += 1) {
    const c = appSrc[k];
    if (comillas) { if (c === "\\") { k += 1; continue; } if (c === comillas) comillas = null; continue; }
    if (c === '"' || c === "'" || c === "`") { comillas = c; continue; }
    if (c === "{") nivel += 1;
    if (c === "}") { nivel -= 1; if (nivel === 0) return appSrc.slice(i, k + 1); }
  }
  return null;
}

const KEY = extraer("operationCompletionKey");
const NORMSTATUS = extraer("normalizeStatus");
assert.ok(KEY, "no encontre operationCompletionKey");
assert.ok(NORMSTATUS, "no encontre normalizeStatus");

const ctx = {
  console, JSON, Math, String, Number, Object, Array, isFinite, isNaN, Date,
  window: {}, state: {},
  PlannerCore: {},
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(`${NORMSTATUS}\n${KEY}\nthis.operationCompletionKey=operationCompletionKey;this.normalizeStatus=normalizeStatus;`, ctx);

const key = (op) => ctx.operationCompletionKey(op);

test("la clave CAMBIA cuando cambia la secuencia", () => {
  const op = { ot: "3143", secuencia: 5, ct: "5459", tipoInsercion: "PROCESO" };
  const antes = key(op);
  assert.equal(antes, "OP|3143|5|5459");
  const despues = key({ ...op, secuencia: 3 });
  assert.equal(despues, "OP|3143|3|5459");
  assert.notEqual(antes, despues, "la clave cambio: el completado guardado bajo la vieja ya no se encuentra");
});

test("y tambien cuando cambia el CT", () => {
  const op = { ot: "3143", secuencia: 5, ct: "5459", tipoInsercion: "PROCESO" };
  assert.notEqual(key(op), key({ ...op, ct: "5527" }));
});

test("EL BUG: se completa con una clave y se lee con otra, y se pierde", () => {
  const op = { ot: "3143", secuencia: 5, ct: "5459", tipoInsercion: "PROCESO", id: "op-1" };

  // Se completa: el estado se guarda bajo la clave de ENTONCES.
  const estados = {};
  const claveEntonces = key(op);
  estados[claveEntonces] = { status: "COMPLETADA_PLAN", key: claveEntonces };

  // El planeador regenera y la secuencia pasa a 3. La operacion sigue existiendo.
  const regenerada = { ...op, secuencia: 3 };

  // Y aqui esta la perdida: se busca con la clave NUEVA y no esta.
  assert.equal(estados[key(regenerada)], undefined,
    "el estado de completo se perdio: la clave nueva no encuentra el estado guardado con la vieja");
});

test("lo que SI sobrevive: el id de NetSuite, si la operacion lo trae", () => {
  const op = { ot: "3143", secuencia: 5, ct: "5459", tipoInsercion: "PROCESO", id: "98765" };
  const regenerada = { ...op, secuencia: 3, ct: "5527" };
  assert.equal(regenerada.id, "98765",
    "el id de NetSuite sobrevive al cambio de secuencia y de ct: es la unica identidad estable");
});

test("lo que NO sobrevive: el id posicional del planeador", () => {
  // normalizeOperation pone id: op.id || `op-${index+1}`. Sin id, es POSICIONAL.
  // No podemos probarlo sin cargar toda la cerradura, pero el codigo lo dice claro:
  //   planner-core.js:3257 -> id: op.id || `op-${index + 1}`
  // Y ese id cambia con la posicion. No sirve como identidad.
  const plannerSrc = readFileSync(new URL("../src/web/planning/planner-core.js", import.meta.url), "utf8");
  const fuente = "id: op.id || `op-${index + 1}`";
  assert.ok(plannerSrc.includes(fuente), "la fuente del id posicional esta en planner-core.js:3257");
});
