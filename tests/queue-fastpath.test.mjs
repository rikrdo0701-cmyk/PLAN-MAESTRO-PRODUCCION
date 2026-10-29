import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runInNewContext } from "node:vm";

test("planner-core expone normalizeKey en su API", async () => {
  const source = await readFile(path.join(process.cwd(), "src", "web", "planning", "planner-core.js"), "utf8");
  const sandbox = { module: { exports: {} }, exports: {}, console, globalThis: {} };
  sandbox.window = sandbox;
  runInNewContext(source, sandbox);
  const core = sandbox.module.exports;
  assert.equal(typeof core.normalizeKey, "function");
  assert.equal(core.normalizeKey("  Ejemplo Áéí  "), "EJEMPLO AEI");
});

test("app.js usa normalizeKey de PlannerCore con fallback", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const start = app.indexOf("function normalizeKey(value) {");
  const end = app.indexOf("\n}\n\nfunction ", start);
  const helper = app.slice(start, end < 0 ? start + 400 : end + 2);
  assert.match(helper, /window\.PlannerCore\?\.normalizeKey/);
  assert.match(helper, /trim\(\)\.toUpperCase\(\)/);
});

test("queueItemSignature refleja cantidad y fecha y la cola re-renderiza cuando cambian", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const sigStart = app.indexOf("function queueItemSignature(job) {");
  const sig = app.slice(sigStart, app.indexOf("function renderPriorityQueue()", sigStart));
  const queue = app.slice(
    app.indexOf("function renderPriorityQueue()"),
    app.indexOf("function jobMatchesSearch(", app.indexOf("function renderPriorityQueue()")),
  );

  const queueItemSignature = Function(
    "job", "workOrderForOt", "formatOtDateValue", "formatMaterialQuantity",
    "jobRiskCardClass", "jobRiskIndicatorHtml", "netSuiteChangeBadgeHtml",
    "workOrderSyncWarningHtml", "jobTypeTagHtml", "jobToolMiniHtml",
    `${sig}; return queueItemSignature;`,
  )(
    ({ ot: "100" }),
    () => ({ dueDate: "2026-09-20", dueDateOverride: false }),
    () => "20/09/2026",
    (value) => String(value || 0),
    () => "", () => "", () => "", () => "", () => "", () => "",
  );

  const withStats = (job, workOrder = () => ({ dueDate: "2026-09-20", dueDateOverride: false })) => Function(
    "job", "workOrderForOt", "formatOtDateValue", "formatMaterialQuantity",
    "jobRiskCardClass", "jobRiskIndicatorHtml", "netSuiteChangeBadgeHtml",
    "workOrderSyncWarningHtml", "jobTypeTagHtml", "jobToolMiniHtml",
    `${sig}; return queueItemSignature;`,
  )(job, workOrder, () => "20/09/2026", (value) => String(value || 0), () => "", () => "", () => "", () => "", () => "", () => "");

  const sinCantidad = withStats({ ot: "100", quantity: 0, dueDate: "" });
  const conCantidad = withStats({ ot: "100", quantity: 15, dueDate: "2026-09-20" });
  assert.notEqual(sinCantidad, conCantidad, "cambiar cantidad y fecha debe alterar la firma");

  assert.match(queue, /el\.dataset\.queueSig === queueItemSignature\(job\)/);
  assert.match(queue, /data-queue-sig="\$\{escapeHtml\(queueItemSignature\(job\)\)\}"/);
});