import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");

function persistableStateSource() {
  const start = app.indexOf("function persistableState(");
  const end = app.indexOf("function createAppSheetPayload(", start);
  assert.ok(start >= 0 && end > start, "Falta persistableState");
  return app.slice(start, end);
}

function buildPersistableState() {
  const context = { machineToolHistory: null };
  vm.runInNewContext(persistableStateSource(), context, { filename: "persistableState" });
  return context;
}

test("persistableState excluye machineToolHistory e indices internos __ y conserva datos criticos", () => {
  const { persistableState } = buildPersistableState();
  const source = {
    matrixSearch: "x",
    selectedDetailOt: "1",
    queueMoveOt: "2",
    machineToolHistory: [{ id: "m1" }],
    __ctResolution: { "5459::DOBLEZ": "5459" },
    __windowCache: {},
    operations: [{ id: "op1" }],
    workOrders: [{ ot: "1" }],
    materials: [{ ot: "1", component: "MP" }],
    revision: 10,
    planStart: "2026-09-07",
    expandedOts: ["1"],
    _locallyRemovedDraftOts: ["2"],
  };
  const persisted = persistableState(source);
  assert.equal("machineToolHistory" in persisted, false);
  assert.equal("__ctResolution" in persisted, false);
  assert.equal("__windowCache" in persisted, false);
  assert.equal("matrixSearch" in persisted, false);
  assert.equal("selectedDetailOt" in persisted, false);
  assert.equal("queueMoveOt" in persisted, false);
  assert.equal(JSON.stringify(persisted.operations), JSON.stringify([{ id: "op1" }]));
  assert.equal(JSON.stringify(persisted.workOrders), JSON.stringify([{ ot: "1" }]));
  assert.equal(JSON.stringify(persisted.materials), JSON.stringify([{ ot: "1", component: "MP" }]));
  assert.equal(persisted.revision, 10);
  assert.equal(persisted.planStart, "2026-09-07");
  assert.equal(JSON.stringify(persisted.expandedOts), JSON.stringify(["1"]));
  assert.equal(JSON.stringify(persisted._locallyRemovedDraftOts), JSON.stringify(["2"]));
});

test("persistableState con estado por defecto no rompe con estado vacio", () => {
  const { persistableState } = buildPersistableState();
  const persisted = persistableState({});
  assert.equal(Object.keys(persisted).length, 0);
});