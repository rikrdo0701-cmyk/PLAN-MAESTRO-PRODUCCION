/**
 * EL ARREGLO DEL BUG DE LOS COMPLETADOS, CON FALLBACK Y GUARDA DE REAPERTURA.
 *
 * El bug: normalizeState sobrescribía el planStatus de TODAS las operaciones desde
 * operationCompletionKey. Si la clave cambiaba (secuencia o CT), el lookup fallaba y la
 * operación volvía a PENDIENTE, perdiendo su "completada".
 *
 * El arreglo tiene DOS partes:
 *   1. Usar operationPlanStatusEntry, que tiene tres niveles de búsqueda:
 *      clave directa → operationId → ot+secuencia+ct.
 *      Con eso se recuperan los completados aunque la clave haya cambiado.
 *   2. La guarda de reapertura: si la entrada tiene reopenedAt, la operación fue reabierta
 *      y NO debe marcarse como COMPLETADA_PLAN, aunque el estatus diga eso.
 *      Sin esta guarda, el fallback por contenido podría recuperar un COMPLETADA_PLAN viejo
 *      y no respetar la reapertura. Es un conflicto real: la hoja tiene entradas con
 *      FECHA_REAPERTURA (ej. OP|3385|1|5458).
 *
 * Este test usa el bloque REAL de normalizeState (extraido del archivo) y un stub de
 * operationPlanStatusEntry que implementa el fallback. El stub es suficiente porque:
 *   - operationPlanStatusEntry no tiene el bug; el bug está en el bloque de planStatus.
 *   - El fallback es lo nuevo, y lo que se prueba es que el bloque lo usa correctamente.
 *   - La función real ya está probada por los tests existentes (que prueban
 *     operationCompletionKey).
 *
 * Y un test de que el fallback por operationId recupera el completado.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const appSrc = readFileSync(new URL("../src/web/planning/app.js", import.meta.url), "utf8");

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

/** Stub de operationPlanStatusEntry con fallback por operationId y ot+secuencia+ct. */
function makeEntry(map) {
  return (state, op) => {
    const key = `OP|${op.ot}|${op.secuencia}|${op.ct}`;
    if (map[key]) return map[key];
    const byId = Object.values(map).find((e) => e.operationId === op.id);
    if (byId) return byId;
    return Object.values(map).find((e) =>
      e.ot === op.ot && e.secuencia === op.secuencia && e.ct === op.ct) || null;
  };
}

/** Corre el bloque real sobre un estado. */
function correrBloque(state, entry) {
  // El bloque usa window.PlanningWorkflowCore?.operationPlanStatusEntry?.(...), asi que el
  // arnes tiene que proveer window.PlanningWorkflowCore con la funcion.
  const windowStub = { PlanningWorkflowCore: { operationPlanStatusEntry: entry } };
  const fn = new Function("state", "window", "draftViewStatuses", BLOQUE);
  return fn(state, windowStub, () => state.operationPlanStatuses || {});
}

test("el fallback por operationId RECUPERA el completado cuando la clave cambia", () => {
  // El escenario real de la hoja: la clave vieja es OP|3494|27|5458, la nueva es OP|3494|30|5458.
  // El operationId es el mismo: ns-3494-1.
  const state = {
    operations: [
      { ot: "3494", secuencia: 30, ct: "5458", tipoInsercion: "PROCESO", id: "ns-3494-1", planStatus: "PENDIENTE" },
    ],
    operationPlanStatuses: {
      "OP|3494|27|5458": { status: "COMPLETADA_PLAN", key: "OP|3494|27|5458", operationId: "ns-3494-1" },
    },
    publishedPlanStatuses: {},
  };

  correrBloque(state, makeEntry(state.operationPlanStatuses));

  assert.equal(state.operations[0].planStatus, "COMPLETADA_PLAN",
    "el fallback por operationId recupera el completado aunque la clave haya cambiado");
});

test("y el fallback por ot+secuencia+ct también, si el id tampoco coincide", () => {
  // El fallback por contenido matchea cuando la secuencia y el CT son los mismos pero el id
  // es diferente. Si la secuencia tambien cambio, no matchea (y no deberia: es otra operacion).
  const state = {
    operations: [
      { ot: "3494", secuencia: 27, ct: "5458", tipoInsercion: "PROCESO", id: "otro-id", planStatus: "PENDIENTE" },
    ],
    operationPlanStatuses: {
      "OP|3494|27|5458": { status: "COMPLETADA_PLAN", key: "OP|3494|27|5458", operationId: "ns-3494-1" },
    },
    publishedPlanStatuses: {},
  };

  correrBloque(state, makeEntry(state.operationPlanStatuses));

  assert.equal(state.operations[0].planStatus, "COMPLETADA_PLAN",
    "el fallback por contenido también recupera el completado");
});

test("LA GUARDA DE REAPERTURA: si la entrada tiene reopenedAt, NO se marca como completada", () => {
  // El conflicto real: la hoja tiene entradas con FECHA_REAPERTURA (ej. OP|3385|1|5458).
  // Si el fallback recupera un COMPLETADA_PLAN viejo y la operación fue reabierta,
  // marcarla como completada sería ignorar la reapertura.
  const state = {
    operations: [
      { ot: "3385", secuencia: 1, ct: "5458", tipoInsercion: "PROCESO", id: "ns-3385-1", planStatus: "PENDIENTE" },
    ],
    operationPlanStatuses: {
      "OP|3385|1|5458": { status: "COMPLETADA_PLAN", key: "OP|3385|1|5458", operationId: "ns-3385-1", reopenedAt: "2026-09-21T20:32:21.126Z" },
    },
    publishedPlanStatuses: {},
  };

  correrBloque(state, makeEntry(state.operationPlanStatuses));

  assert.equal(state.operations[0].planStatus, "PENDIENTE",
    "si la entrada tiene reopenedAt, la operacion fue reabierta y NO debe marcarse como completada");
});

test("y si el mapa dice PENDIENTE explicitamente, si se sobrescribe", () => {
  const state = {
    operations: [
      { ot: "3143", secuencia: 3, ct: "5459", tipoInsercion: "PROCESO", id: "op-1", planStatus: "COMPLETADA_PLAN" },
    ],
    operationPlanStatuses: {
      "OP|3143|3|5459": { status: "PENDIENTE", key: "OP|3143|3|5459" },
    },
    publishedPlanStatuses: {},
  };

  correrBloque(state, makeEntry(state.operationPlanStatuses));

  assert.equal(state.operations[0].planStatus, "PENDIENTE",
    "si el mapa dice PENDIENTE explicitamente, se sobrescribe: es el caso de descompletar");
});

test("y si el mapa dice COMPLETADA_PLAN para la clave actual, se mantiene", () => {
  const state = {
    operations: [
      { ot: "3143", secuencia: 3, ct: "5459", tipoInsercion: "PROCESO", id: "op-1", planStatus: "PENDIENTE" },
    ],
    operationPlanStatuses: {
      "OP|3143|3|5459": { status: "COMPLETADA_PLAN", key: "OP|3143|3|5459" },
    },
    publishedPlanStatuses: {},
  };

  correrBloque(state, makeEntry(state.operationPlanStatuses));

  assert.equal(state.operations[0].planStatus, "COMPLETADA_PLAN",
    "si el mapa dice COMPLETADA_PLAN, se mantiene");
});

test("SIN el fallback (busqueda directa), el completado se pierde — es el bug original", () => {
  const state = {
    operations: [
      { ot: "3494", secuencia: 30, ct: "5458", tipoInsercion: "PROCESO", id: "ns-3494-1", planStatus: "PENDIENTE" },
    ],
    operationPlanStatuses: {
      "OP|3494|27|5458": { status: "COMPLETADA_PLAN", key: "OP|3494|27|5458", operationId: "ns-3494-1" },
    },
    publishedPlanStatuses: {},
  };

  // El bloque VIEJO (sin fallback): busqueda directa por clave.
  const bloqueViejo = `for (const op of state.operations) {
    const status = draftViewStatuses()[operationCompletionKey(op)];
    op.planStatus = status?.status === "COMPLETADA_PLAN" ? "COMPLETADA_PLAN" : "PENDIENTE";
  }`;
  const fnViejo = new Function("state", "operationCompletionKey", "draftViewStatuses", bloqueViejo);
  fnViejo(state, (op) => `OP|${op.ot}|${op.secuencia}|${op.ct}`, () => state.operationPlanStatuses);

  assert.equal(state.operations[0].planStatus, "PENDIENTE",
    "sin el fallback, el completado se pierde: ese es el bug que el usuario reporto");
});
