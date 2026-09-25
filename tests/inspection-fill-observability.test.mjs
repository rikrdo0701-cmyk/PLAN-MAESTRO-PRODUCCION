import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");

function sourceBetween(startText, endText) {
  const start = app.indexOf(startText);
  const end = app.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `Falta ${startText}`);
  return app.slice(start, end);
}

/**
 * Harness de ensureInspectionWorkOrders con las dependencia reales de la app
 * inyectadas: el puente resuelve con { ok: false, error } sin rechazar, y ese
 * camino no puede quedar en silencio.
 */
function createInspectionFill({
  responses = {},
  onHold = () => false,
  runtime = true,
} = {}) {
  const toasts = [];
  const warnings = [];
  const reRenders = [];
  const calls = [];

  const source = sourceBetween("const inspectionWorkOrderCache = new Map();", "function inspectionWorkOrderEntry(");
  const fillSource = sourceBetween("async function ensureInspectionWorkOrders(", "function mergeClosedWorkOrderSummaries(");

  const factory = Function(
    // dependencias
    "isAppsScriptRuntime", "materialOtKey", "callAppsScript", "withTimeout", "showToast",
    "scheduleInspectionReRender", "inspectionFillOnHold", "console",
    `${source}\n${fillSource}\nreturn { ensureInspectionWorkOrders, recordInspectionWorkOrderFailure, inspectionWorkOrderFailureLines, cache: inspectionWorkOrderCache, attempted: inspectionWorkOrderFillAttempted, failures: inspectionWorkOrderFailures };`,
  );

  const api = factory(
    () => runtime,
    (ot) => String(ot || "").trim().toUpperCase(),
    async (method, ot) => {
      calls.push(`${method}:${ot}`);
      const responder = responses[String(ot || "").trim()];
      if (typeof responder === "function") return responder(ot);
      return responder ?? { ok: true, data: { workOrder: { quantity: 10, builtQuantity: 4, pendingQuantity: 6, status: "En curso" } } };
    },
    async (promise) => promise,
    (message, duration) => { toasts.push({ message: String(message), duration }); },
    () => { reRenders.push(true); },
    onHold,
    { warn: (message) => warnings.push(String(message)) },
  );

  return { ...api, toasts, warnings, reRenders, calls };
}

const rateLimited = {
  ok: false,
  error: 'NetSuite inspeccion: 400 {"error" : {"code" : "SSS_REQUEST_LIMIT_EXCEEDED","message" : "Se excedio el limite de solicitudes."}}',
};

test("un ok:false del puente deja registro con folio, metodo y motivo real", async () => {
  const harness = createInspectionFill({ responses: { 3483: rateLimited } });

  await harness.ensureInspectionWorkOrders(["3483"]);

  assert.deepEqual(harness.calls, ["getInspectionWorkOrder:3483"]);
  assert.equal(harness.cache.size, 0);
  assert.deepEqual(harness.warnings, [
    '[inspeccion] getInspectionWorkOrder fallo para la OT 3483: NetSuite inspeccion: 400 {"error" : {"code" : "SSS_REQUEST_LIMIT_EXCEEDED","message" : "Se excedio el limite de solicitudes."}}',
  ]);
  assert.deepEqual([...harness.failures.keys()], ["3483"]);
  assert.equal(harness.failures.get("3483").method, "getInspectionWorkOrder");
  assert.ok(harness.failures.get("3483").error.includes("SSS_REQUEST_LIMIT_EXCEEDED"));
  assert.equal(harness.toasts.length, 1);
  assert.ok(harness.toasts[0].message.startsWith("Inspeccion: 1 OT(s) sin dato de NetSuite"), harness.toasts[0].message);
  assert.ok(harness.toasts[0].message.includes("3483"), harness.toasts[0].message);
  assert.equal(harness.reRenders.length, 0);
});

test("una promesa rechazada tambien queda registrada", async () => {
  const harness = createInspectionFill({
    responses: { 3483: () => { throw new Error("Tiempo agotado al ejecutar getInspectionWorkOrder"); } },
  });

  await harness.ensureInspectionWorkOrders(["3483"]);

  assert.equal(harness.warnings.length, 1);
  assert.ok(harness.warnings[0].includes("Tiempo agotado"), harness.warnings[0]);
  assert.equal(harness.failures.get("3483").ot, "3483");
});

test("un ok:true sin workOrder se registra como fallo y no como cache vacia", async () => {
  const harness = createInspectionFill({ responses: { 3483: { ok: true, data: {} } } });

  await harness.ensureInspectionWorkOrders(["3483"]);

  assert.equal(harness.cache.size, 0);
  assert.ok(harness.failures.get("3483").error.includes("no devolvio datos de inspeccion"), harness.failures.get("3483").error);
  assert.equal(harness.toasts.length, 1);
});

test("una carga correcta no registra fallos ni avisa", async () => {
  const harness = createInspectionFill();

  await harness.ensureInspectionWorkOrders(["3483"]);

  assert.equal(harness.cache.size, 1);
  assert.deepEqual(harness.cache.get("3483"), { quantity: 10, builtQuantity: 4, pendingQuantity: 6, status: "En curso" });
  assert.equal(harness.warnings.length, 0);
  assert.equal(harness.toasts.length, 0);
  assert.equal(harness.reRenders.length, 1);
});

test("cantidad total en cero no se registra como fallo ni se cachea", async () => {
  const harness = createInspectionFill({
    responses: { 3483: { ok: true, data: { workOrder: { quantity: 0, builtQuantity: 0 } } } },
  });

  await harness.ensureInspectionWorkOrders(["3483"]);

  assert.equal(harness.cache.size, 0);
  assert.equal(harness.warnings.length, 0);
  assert.equal(harness.toasts.length, 0);
});

test("la OT fallida se marca comoYa intentada y no se reintenta en la misma carga", async () => {
  const harness = createInspectionFill({ responses: { 3483: rateLimited } });

  await harness.ensureInspectionWorkOrders(["3483"]);
  await harness.ensureInspectionWorkOrders(["3483"]);

  assert.deepEqual(harness.calls, ["getInspectionWorkOrder:3483"]);
  assert.equal(harness.attempted.has("3483"), true);
});

test("el resumen de fallos deduplica el mismo error y ordena por folio", () => {
  const harness = createInspectionFill();
  harness.recordInspectionWorkOrderFailure("3483", "getInspectionWorkOrder", "mismo");
  harness.recordInspectionWorkOrderFailure("3483", "getInspectionWorkOrder", "mismo");
  harness.recordInspectionWorkOrderFailure("3006", "getInspectionWorkOrder", "otro");

  assert.equal(harness.failures.size, 2);
  assert.equal(
    harness.inspectionWorkOrderFailureLines(),
    "getInspectionWorkOrder fallo para la OT 3006: otro; getInspectionWorkOrder fallo para la OT 3483: mismo",
  );
});

test("sin runtime de Apps Script no se llama al puente ni se registra nada", async () => {
  const harness = createInspectionFill({ runtime: false, responses: { 3483: rateLimited } });

  await harness.ensureInspectionWorkOrders(["3483"]);

  assert.deepEqual(harness.calls, []);
  assert.equal(harness.warnings.length, 0);
  assert.equal(harness.toasts.length, 0);
});
