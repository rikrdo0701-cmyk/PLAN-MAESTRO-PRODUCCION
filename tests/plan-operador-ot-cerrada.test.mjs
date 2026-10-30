// "Plan por operador": una OT cerrada (RULE-OT-049) ya no esta en `state.workOrders`, asi que
// `workOrderForOt` daba null y la fila salia con Parte y Piezas vacios (MEDIDO 2026-10-30,
// OT 4111). `renderProductionReportRow` ahora cae a `closedWorkOrderFichaForOt` (resumen
// compacto + ficha del espejo), que conserva el articulo y su cantidad.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8").then((s) => s.replace(/\r\n/g, "\n"));

function fuenteDesde(inicio, fin) {
  const start = app.indexOf(inicio);
  const end = app.indexOf(fin, start);
  assert.ok(start >= 0 && end > start, `Falta ${inicio} en app.js`);
  return app.slice(start, end);
}

test("Plan por operador: OT cerrada muestra articulo y cantidad desde el resumen compacto", () => {
  // `closedWorkOrderFichaForOt` con el resumen completo (item presente): no necesita red.
  const fichaSource = fuenteDesde("// FICHA EFECTIVA DE UNA OT CERRADA", "function closedSummaryFichaForOt(");
  const cerradaFor = Function(
    "state", "materialOtKey", "closedWorkOrderSummaryForOt", "closedSummaryFichaForOt",
    "closedWorkOrderFichaCache",
    `${fichaSource}; return closedWorkOrderFichaForOt;`,
  )(
    { workOrders: [] },
    (v) => String(v || "").trim().toUpperCase(),
    (ot) => (String(ot) === "4111" ? { ot: "4111", item: "CM 400 E", quantity: 10, pendingQuantity: 0, scheduledStart: "2026-10-27T08:00:00Z", scheduledEnd: "2026-10-27T16:00:00Z", weekStart: "2026-10-26" } : null),
    () => ({}),
    new Map(),
  );
  assert.deepEqual(cerradaFor("4111"), { item: "CM 400 E", quantity: 10, pendingQuantity: 10 });
});

test("Plan por operador: renderProductionReportRow pinta parte y piezas de una OT cerrada", () => {
  const rowSource = fuenteDesde("function renderProductionReportRow(", "function operationCycleMinutesForReport(");
  const op = { ot: "4111", parte: "", ct: "3OTD", descripcion: "CORTE DE TUBO", cantidadPendiente: 0, secuencia: 1, maquina: "", herramental: "", fechaInicio: "2026-10-27", horaInicio: "13:27", fechaFin: "2026-10-27", horaFin: "13:37" };
  const html = Function(
    "op", "index", "options", "state",
    "opStart", "opEnd", "workOrderForOt", "closedWorkOrderFichaForOt",
    "cleanResourceValue", "isToolChangeReportOperation", "cleanToolValue", "window",
    "isBendingAppOperation", "toolCatalogForAppOperation", "operationCompletionKey",
    "formatReportNumber", "formatReportDuration", "operationCycleMinutesForReport",
    "operationSetupMinutesForReport", "scheduledProductionMinutesForExport",
    "formatReportDate", "formatReportTime", "reportOperationCommentCell",
    "planStatusActionCell", "escapeHtml",
    `${rowSource}; return renderProductionReportRow;`,
  )(
    op, 1, { statusActions: false },
    { workOrders: [], closedWorkOrderSummaries: {} },
    () => new Date(2026, 9, 27, 13, 27),
    () => new Date(2026, 9, 27, 13, 37),
    () => null,
    () => ({ item: "CM 400 E", quantity: 10, pendingQuantity: 10 }),
    (v) => String(v || ""), () => false, (v) => String(v || ""),
    { PlanningWorkflowCore: { effectiveJobTool: () => "" } },
    () => false, () => null, () => "k",
    (v) => String(v), (ms) => `${ms}`, () => 0, () => 0, () => 0,
    () => "27/10/2026", () => "13:27", () => "", () => "", (v) => String(v),
  );

  const out = html(op, 1, { statusActions: false });
  assert.match(out, /CM 400 E/, "el articulo de la OT cerrada no puede salir vacio");
  assert.match(out, /10/, "y la cantidad queda en la fila");
});

test("Plan por operador: sin resumen cerrado la fila queda como estaba (no rompe OTs abiertas)", () => {
  const rowSource = fuenteDesde("function renderProductionReportRow(", "function operationCycleMinutesForReport(");
  const op = { ot: "4064", parte: "C 2590 UAD", ct: "3OTD", descripcion: "CORTE DE TUBO", cantidadPendiente: 20, secuencia: 1 };
  const html = Function(
    "op", "index", "options", "state",
    "opStart", "opEnd", "workOrderForOt", "closedWorkOrderFichaForOt",
    "cleanResourceValue", "isToolChangeReportOperation", "cleanToolValue", "window",
    "isBendingAppOperation", "toolCatalogForAppOperation", "operationCompletionKey",
    "formatReportNumber", "formatReportDuration", "operationCycleMinutesForReport",
    "operationSetupMinutesForReport", "scheduledProductionMinutesForExport",
    "formatReportDate", "formatReportTime", "reportOperationCommentCell",
    "planStatusActionCell", "escapeHtml",
    `${rowSource}; return renderProductionReportRow;`,
  )(
    op, 1, { statusActions: false },
    { workOrders: [{ ot: "4064", item: "C 2590 UAD", pendingQuantity: 20 }], closedWorkOrderSummaries: {} },
    () => new Date(2026, 9, 27, 11, 21),
    () => new Date(2026, 9, 27, 11, 36),
    (ot) => (String(ot) === "4064" ? { item: "C 2590 UAD", pendingQuantity: 20 } : null),
    () => null,
    (v) => String(v || ""), () => false, (v) => String(v || ""),
    { PlanningWorkflowCore: { effectiveJobTool: () => "" } },
    () => false, () => null, () => "k",
    (v) => String(v), (ms) => `${ms}`, () => 0, () => 0, () => 0,
    () => "27/10/2026", () => "11:21", () => "", () => "", (v) => String(v),
  );
  const out = html(op, 1, { statusActions: false });
  assert.match(out, /C 2590 UAD/, "una OT abierta normal sigue con su parte");
  assert.match(out, /20/, "y sus piezas");
});