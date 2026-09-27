/**
 * EL ARREGLO DEL BUG DE LOS COMPLETADOS.
 *
 * El bug: normalizeState sobrescribe el planStatus de TODAS las operaciones basándose en
 * operationCompletionKey. Si la clave cambia (secuencia o CT), el lookup falla y la operación
 * vuelve a PENDIENTE, perdiendo su "completada".
 *
 * El arreglo: si el mapa no tiene estado para la clave actual, NO tocar el planStatus que la
 * operación ya trae.
 *
 * Este test usa el bloque REAL de normalizeState (extraido del archivo) y un stub trivial de
 * draftViewStatuses. El stub es suficiente porque:
 *   - draftViewStatuses no tiene el bug; el bug está en el bloque de planStatus.
 *   - El stub es una línea: lee state.operationPlanStatuses. No cambia la semántica.
 *   - El bloque real de normalizeState es el que estamos probando.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const appSrc = readFileSync("C:/Users/plane/Downloads/plangit/src/web/planning/app.js", "utf8");

/** Saca una funcion por nombre con indexOf. */
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
vm.runInContext(
  `${NORMSTATUS}\n${KEY}\nthis.operationCompletionKey=operationCompletionKey;this.normalizeStatus=normalizeStatus;`,
  ctx,
);

/** El bloque REAL de normalizeState, extraido del archivo. */
function extraerBloquePlanStatus() {
  const i = appSrc.indexOf("for (const op of state.operations) {");
  if (i < 0) return null;
  const abre = appSrc.indexOf("{", i);
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

const BLOQUE = extraerBloquePlanStatus();
assert.ok(BLOQUE, "no encontre el bloque de planStatus en normalizeState");

/** Stub trivial: lee state.operationPlanStatuses. */
const draftViewStatuses = (state) => state.operationPlanStatuses || {};

/** Corre el bloque real sobre un estado. */
function correrBloque(state) {
  const fn = new Function("state", "operationCompletionKey", "draftViewStatuses", BLOQUE);
  return fn(state, ctx.operationCompletionKey, () => draftViewStatuses(state));
}

test("SIN el arreglo: la operacion pierde su completada cuando la clave cambia", () => {
  const state = {
    operations: [
      { ot: "3143", secuencia: 3, ct: "5459", tipoInsercion: "PROCESO", planStatus: "COMPLETADA_PLAN" },
    ],
    operationPlanStatuses: {
      "OP|3143|5|5459": { status: "COMPLETADA_PLAN", key: "OP|3143|5|5459" },
    },
    publishedPlanStatuses: {},
  };

  const bloqueViejo = `for (const op of state.operations) {
    const status = draftViewStatuses()[operationCompletionKey(op)];
    op.planStatus = status?.status === "COMPLETADA_PLAN" ? "COMPLETADA_PLAN" : "PENDIENTE";
  }`;
  const fnViejo = new Function("state", "operationCompletionKey", "draftViewStatuses", bloqueViejo);
  fnViejo(state, ctx.operationCompletionKey, () => draftViewStatuses(state));

  assert.equal(state.operations[0].planStatus, "PENDIENTE",
    "sin el arreglo, la operacion pierde su completada: ese es el bug");
});

test("CON el arreglo: la operacion CONSERVA su completada aunque la clave cambie", () => {
  const state = {
    operations: [
      { ot: "3143", secuencia: 3, ct: "5459", tipoInsercion: "PROCESO", planStatus: "COMPLETADA_PLAN" },
    ],
    operationPlanStatuses: {
      "OP|3143|5|5459": { status: "COMPLETADA_PLAN", key: "OP|3143|5|5459" },
    },
    publishedPlanStatuses: {},
  };

  correrBloque(state);

  assert.equal(state.operations[0].planStatus, "COMPLETADA_PLAN",
    "con el arreglo, la operacion conserva su completada aunque la clave haya cambiado");
});

test("y si el mapa dice PENDIENTE explicitamente, si se sobrescribe", () => {
  const state = {
    operations: [
      { ot: "3143", secuencia: 3, ct: "5459", tipoInsercion: "PROCESO", planStatus: "COMPLETADA_PLAN" },
    ],
    operationPlanStatuses: {
      "OP|3143|3|5459": { status: "PENDIENTE", key: "OP|3143|3|5459" },
    },
    publishedPlanStatuses: {},
  };

  correrBloque(state);

  assert.equal(state.operations[0].planStatus, "PENDIENTE",
    "si el mapa dice PENDIENTE explicitamente, se sobrescribe: es el caso de descompletar");
});

test("y si el mapa dice COMPLETADA_PLAN para la clave actual, se mantiene", () => {
  const state = {
    operations: [
      { ot: "3143", secuencia: 3, ct: "5459", tipoInsercion: "PROCESO", planStatus: "PENDIENTE" },
    ],
    operationPlanStatuses: {
      "OP|3143|3|5459": { status: "COMPLETADA_PLAN", key: "OP|3143|3|5459" },
    },
    publishedPlanStatuses: {},
  };

  correrBloque(state);

  assert.equal(state.operations[0].planStatus, "COMPLETADA_PLAN",
    "si el mapa dice COMPLETADA_PLAN, se mantiene");
});
