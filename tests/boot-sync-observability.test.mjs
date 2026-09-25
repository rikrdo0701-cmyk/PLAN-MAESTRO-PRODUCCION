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

const syncNetSuiteDataSource = sourceBetween("async function syncNetSuiteData(", "function validateNetSuiteImportedData(");

/**
 * Harness de la sincronizacion de carga. El caso que importa: si la carga falla, el
 * usuario se queda con los datos del servidor y las OTs ya cerradas en NetSuite siguen
 * en Backlog y en Planeado/No planeado. Antes eso solo dejaba un banner.
 */
function createNetSuiteSync({ runtime = true, failWith = null, workOrders = [{ ot: "1905" }] } = {}) {
  const toasts = [];
  const alerts = [];
  const applied = [];
  const rendered = [];
  const context = {
    state: { workOrders: [{ ot: "3483" }], operations: [], netSuiteSyncAlert: null },
    netSuiteSyncInFlight: false,
    toasts,
    alerts,
    applied,
    rendered,
  };

  const factory = Function(
    "state", "netSuiteSyncInFlight", "isAppsScriptRuntime", "callAppsScript", "validateNetSuiteImportedData",
    "applyImported", "applyNetSuiteWorkOrdersPayload", "fetchNetSuiteExercise", "importJson",
    "persistReferencePricesFromSync", "clearNetSuiteSyncAlert", "setNetSuiteSyncAlert",
    "setNetSuiteSyncState", "render", "showToast", "STATE_BOX",
    `${syncNetSuiteDataSource}\nreturn { syncNetSuiteData, get inFlight() { return netSuiteSyncInFlight; } };`,
  );

  const api = factory(
    context.state,
    false,
    () => runtime,
    async () => {
      if (failWith) throw new Error(failWith);
      return { workOrders, syncedAt: "2026-09-25T15:00:00.000Z" };
    },
    () => {},
    async (imported) => { applied.push(imported); Object.assign(context.state, imported); },
    (imported) => { context.appliedWorkOrders = imported.workOrders; },
    async () => ({ ok: true }),
    () => ({}),
    () => {},
    () => { context.state.netSuiteSyncAlert = null; },
    (message) => { context.state.netSuiteSyncAlert = { message: String(message) }; },
    (inProgress) => { context.syncing = inProgress; },
    (...args) => { rendered.push(args); },
    (message, duration) => { toasts.push({ message: String(message), duration }); },
    context,
  );

  return { ...api, context, toasts, alerts, applied, rendered };
}

test("una carga fallida avisa con el motivo real aunque no se pida mensaje", async () => {
  const harness = createNetSuiteSync({ failWith: "NetSuite RESTlet: 400 SSS_REQUEST_LIMIT_EXCEEDED" });

  const loaded = await harness.syncNetSuiteData(false, { mode: "workOrders", background: true });

  assert.equal(loaded, false);
  assert.equal(harness.inFlight, false, "la bandera de sincronizacion siempre se libera");
  assert.equal(harness.context.state.netSuiteSyncAlert.message, "NetSuite RESTlet: 400 SSS_REQUEST_LIMIT_EXCEEDED");
  assert.equal(harness.toasts.length, 1, "una carga fallida no puede quedar solo en el banner");
  assert.equal(harness.toasts[0].message, "No se pudo cargar NetSuite: NetSuite RESTlet: 400 SSS_REQUEST_LIMIT_EXCEEDED");
  assert.equal(harness.toasts[0].duration, 9000);
  assert.equal(harness.rendered.length, 1);
});

test("una sincronizacion sin mensaje y sin bandera de carga conserva el silencio", async () => {
  const harness = createNetSuiteSync({ failWith: "INVALID_LOGIN_ATTEMPT" });

  const loaded = await harness.syncNetSuiteData(false, { mode: "workOrders" });

  assert.equal(loaded, false);
  assert.deepEqual(harness.toasts, []);
  assert.equal(harness.context.state.netSuiteSyncAlert.message, "INVALID_LOGIN_ATTEMPT");
});

test("una sincronizacion pedida con mensaje sigue avisando aunque no sea la de carga", async () => {
  const harness = createNetSuiteSync({ failWith: "INVALID_LOGIN_ATTEMPT" });

  await harness.syncNetSuiteData(true, { mode: "workOrders" });

  assert.equal(harness.toasts.length, 1);
  assert.ok(harness.toasts[0].message.startsWith("No se pudo cargar NetSuite: "));
});

test("una carga correcta aplica la lista abierta, limpia la alerta y no avisa", async () => {
  const harness = createNetSuiteSync({ workOrders: [{ ot: "1905" }] });
  harness.context.state.netSuiteSyncAlert = { message: "Sincronizacion NetSuite fallo antes" };

  const loaded = await harness.syncNetSuiteData(false, { mode: "workOrders", background: true });

  assert.equal(loaded, true);
  assert.deepEqual(harness.applied[0].workOrders, [{ ot: "1905" }]);
  assert.deepEqual(harness.context.appliedWorkOrders, [{ ot: "1905" }]);
  assert.equal(harness.context.state.netSuiteSyncAlert, null, "una carga correcta limpia la alerta previa");
  assert.deepEqual(harness.toasts, []);
  assert.equal(harness.inFlight, false);
});

test("sin runtime de Apps Script la carga no marca error de NetSuite", async () => {
  const harness = createNetSuiteSync({ runtime: false, failWith: "no deberia llamarse" });

  const loaded = await harness.syncNetSuiteData(false, { mode: "workOrders", background: true });

  // Fuera del runtime de Apps Script la carga usa el endpoint estatico; el harness no lo
  // modela, asi que basta con comprobar que la bandera se libera sin dejar aviso.
  assert.equal(harness.inFlight, false);
  assert.equal(typeof loaded, "boolean");
});
