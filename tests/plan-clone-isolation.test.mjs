/**
 * El probe de viabilidad no puede mutar el estado real.
 *
 * cloneFeasibilityContext es una función interna del núcleo (no exportada), así
 * que no se puede probar directamente. En su lugar se prueba el comportamiento
 * observable: schedulePlan debe devolver operaciones NUEVAS (no las mismas
 * referencias del estado de entrada), y el estado de entrada debe quedar intacto
 * después de la llamada.
 *
 * Esto es crítico porque el probe se ejecuta miles de veces por corrida. Si
 * mutara el estado original, cada candidato corrompería el siguiente, y el
 * resultado final dependería del orden de evaluación — no del mérito.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../src/web/planning/planner-core.js", import.meta.url), "utf8");
const ctx = { console, JSON, Math, String, Number, Object, Array, isFinite, isNaN, Date, Set, Map, Promise };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx);
const api = ctx.PlannerCore;

function estadoMinimo() {
  return {
    operations: [
      { id: "1", ot: "3143", secuencia: 10, ct: "5458", tipoInsercion: "PROCESO", planStatus: "PENDIENTE", operador: "A" },
      { id: "2", ot: "3143", secuencia: 20, ct: "5459", tipoInsercion: "PROCESO", planStatus: "PENDIENTE", operador: "B" },
    ],
    workOrders: [{ ot: "3143", item: "X", status: "En curso", exists: true, quantity: 10, pendingQuantity: 10 }],
    selectedOts: ["3143"],
    lockedOts: [],
    expandedOts: [],
    operationPlanStatuses: {},
    publishedPlanStatuses: {},
    machineTools: new Map(),
    scheduledByKey: new Map(),
    operators: ["A", "B"],
    operatorProfiles: {},
    operatorPerformance: {},
    operatorCapacity: {},
    cts: ["5458", "5459"],
    configuredCapabilities: [],
    customCapabilities: [],
    hiddenCapabilities: [],
    excludedCapabilities: [],
    machines: [],
    toolCatalog: [],
    machineToolHistory: [],
    otConfigurations: {},
    planStart: "2026-09-28",
    horizonDays: 15,
    settings: {},
    lastSchedule: null,
  };
}

test("schedulePlan devuelve operaciones NUEVAS, no las referencias del estado original", async () => {
  const state = estadoMinimo();
  const opsOriginales = state.operations;
  const op0Original = state.operations[0];

  const result = await api.schedulePlan(state, {
    planStart: state.planStart,
    horizonDays: state.horizonDays,
    executionTime: new Date().toISOString(),
    startFromExecutionTime: true,
    affectedOts: state.selectedOts,
    strategyPool: ["balanced_goal"],
    timeBudgetMs: 300000,
    collectStats: true,
    progressEveryMs: 300,
    isDryRun: false,
    onProgress: () => {},
  });

  assert.ok(result.operations && result.operations.length > 0, "debe devolver operaciones");
  assert.notStrictEqual(result.operations[0], op0Original,
    "la operación devuelta debe ser un objeto nuevo, no la referencia original");
  assert.strictEqual(result.operations[0].id, op0Original.id,
    "pero debe conservar los mismos datos");
});

test("el estado de entrada no muta después de schedulePlan", async () => {
  const state = estadoMinimo();
  const opsAntes = JSON.stringify(state.operations);
  const op0Antes = state.operations[0];

  await api.schedulePlan(state, {
    planStart: state.planStart,
    horizonDays: state.horizonDays,
    executionTime: new Date().toISOString(),
    startFromExecutionTime: true,
    affectedOts: state.selectedOts,
    strategyPool: ["balanced_goal"],
    timeBudgetMs: 300000,
    collectStats: true,
    progressEveryMs: 300,
    isDryRun: false,
    onProgress: () => {},
  });

  assert.strictEqual(JSON.stringify(state.operations), opsAntes,
    "las operaciones del estado original no deben cambiar");
  assert.strictEqual(state.operations[0], op0Antes,
    "las referencias del estado original deben ser las mismas");
});

test("múltiples llamadas con el mismo estado producen el mismo resultado", async () => {
  // Si el probe mutara el estado, la segunda llamada vería un estado corrupto
  // y produciría un resultado diferente. Esto detecta exactamente eso.
  const state = estadoMinimo();
  const opts = {
    planStart: state.planStart,
    horizonDays: state.horizonDays,
    executionTime: new Date().toISOString(),
    startFromExecutionTime: true,
    affectedOts: state.selectedOts,
    strategyPool: ["balanced_goal"],
    timeBudgetMs: 300000,
    collectStats: true,
    progressEveryMs: 300,
    isDryRun: false,
    onProgress: () => {},
  };

  const r1 = await api.schedulePlan(state, opts);
  const r2 = await api.schedulePlan(state, opts);

  assert.strictEqual(r1.operations.length, r2.operations.length,
    "el número de operaciones debe ser idéntico entre corridas");
  assert.strictEqual(
    JSON.stringify(r1.operations.map((o) => [o.id, o.operador, o.fechaInicio])),
    JSON.stringify(r2.operations.map((o) => [o.id, o.operador, o.fechaInicio])),
    "las asignaciones deben ser idénticas entre corridas",
  );
});
