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

function createWeeklyJobSummary({
  workOrdersByOt = new Map(),
  configurations = {},
  invoicePrices = {},
  closedPieces = {},
  inspectionPieces = {},
  closedSummaries = {},
  reportSnapshot = undefined,
} = {}) {
  const source = sourceBetween("function weeklyJobSummary(", "function renderWeeklyJobDays(");
  // `weeklyJobSummary` reconstruye una operación sintética para las OTs cerradas vía
  // `closedWorkOrderOperation` (y su ayuda `closedSummarySchedule`), que viven FUERA del
  // recorte de `weeklyJobSummary`. Se inyectan reales, no un stub, para ejercitar el camino
  // completo.
  const closedOperationSource = sourceBetween("function closedSummarySchedule(", "function closedWorkOrderOperation(")
    + sourceBetween("function closedWorkOrderOperation(", "// La ficha (`work_orders`) de una OT cerrada");
  // `closedSummaryFichaForOt` (el rescate de articulo/cantidad desde la ficha cuando el
  // resumen compacto viene incompleto) se dobla sobre el `workOrdersByOt` del arnes: es la
  // misma ficha que `workOrderForOt` entrega aqui.
  const realClosedWorkOrderOperation = Function("materialOtKey", "closedSummaryFichaForOt", `${closedOperationSource}; return closedWorkOrderOperation;`)(
    (value) => String(value || "").trim().toUpperCase(),
    (summary, ot) => workOrdersByOt.get(String(ot || "").trim().toUpperCase()) || {},
    undefined,
  );
  return Function(
    "state", "selectedWeekRange", "reportOperationsSource", "isToolChangeReportOperation",
    "sequenceSort", "isFinalReleaseOperation", "opStart", "opEnd", "workOrderForOt",
    "articleConfigurationValue", "pendingPiecesForWorkOrder", "invoiceUnitPriceForOt",
    "closedPendingPiecesForOt", "inspectionPendingPiecesForOt", "closedWorkOrderOperation",
    "reportSnapshot", "workOrdersByOt", "closedSummaryFichaForOt",
    `${source}; return weeklyJobSummary;`,
  )(
    { reportWeekStart: "2026-07-20", closedWorkOrderSummaries: closedSummaries },
    (value) => {
      const start = new Date(`${String(value).slice(0, 10)}T00:00:00`);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { start, end };
    },
    () => [],
    () => false,
    (a, b) => Number(a.secuencia || 0) - Number(b.secuencia || 0),
    () => false,
    (op) => (op.fechaInicio ? new Date(`${op.fechaInicio}T${op.horaInicio || "08:00"}:00`) : null),
    (op) => (op.fechaFin ? new Date(`${op.fechaFin}T${op.horaFin || "16:00"}:00`) : null),
    (ot) => workOrdersByOt.get(String(ot || "").trim().toUpperCase()) || null,
    (part) => configurations[String(part || "").trim().toUpperCase()] || {},
    (workOrder) => {
      if (!workOrder) return 0;
      if (Number.isFinite(Number(workOrder.pendingQuantity))) return Math.max(0, Number(workOrder.pendingQuantity));
      return Math.max(0, Number(workOrder.quantity || 0) - Number(workOrder.builtQuantity || 0));
    },
    (ot) => Math.max(0, Number(invoicePrices[String(ot || "").trim().toUpperCase()] || 0)),
    (ot) => Math.max(0, Number(closedPieces[String(ot || "").trim().toUpperCase()] || 0)),
    (ot) => {
      const entry = inspectionPieces[String(ot || "").trim().toUpperCase()];
      if (!entry) return null;
      const quantity = Number(entry.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) return null;
      const built = Number(entry.builtQuantity);
      return Math.max(0, quantity - (Number.isFinite(built) ? built : 0));
    },
    realClosedWorkOrderOperation,
    reportSnapshot,
    workOrdersByOt,
    (summary, ot) => workOrdersByOt.get(String(ot || "").trim().toUpperCase()) || {},
  );
}

const baseOp = {
  ot: "4501",
  parte: "PARTE-A",
  secuencia: 1,
  fechaInicio: "2026-07-21",
  horaInicio: "08:00",
  fechaFin: "2026-07-21",
  horaFin: "16:00",
};

test("weeklyJobSummary usa cantPendiente de la ruta cuando la OT no esta en workOrders", () => {
  const weeklyJobSummary = createWeeklyJobSummary();
  const summary = weeklyJobSummary("2026-07-20", {
    operations: [{ ...baseOp, cantPendiente: 70 }],
  });

  assert.equal(summary.starts.length, 1);
  assert.equal(summary.starts[0].pendingPieces, 70);
  assert.equal(summary.finishes[0].pendingPieces, 70);
});

test("weeklyJobSummary deriva el monto desde unitPrice cuando la operacion no trae amount", () => {
  const weeklyJobSummary = createWeeklyJobSummary({
    invoicePrices: { "4501": 12.5 },
  });
  const summary = weeklyJobSummary("2026-07-20", {
    operations: [{ ...baseOp, cantPendiente: 70 }],
  });

  assert.equal(summary.starts[0].unitPrice, 12.5);
  assert.equal(summary.starts[0].amount, 875);
  assert.equal(summary.finishes[0].amount, 875);
});

test("weeklyJobSummary prefiere pendingPieces de la operacion y cae a workOrder si no hay piezas en ops", () => {
  const workOrdersByOt = new Map([["4501", { pendingQuantity: 40 }]]);
  const weeklyJobSummary = createWeeklyJobSummary({ workOrdersByOt });

  const withOpPieces = weeklyJobSummary("2026-07-20", {
    operations: [{ ...baseOp, pendingPieces: 12, cantPendiente: 0 }],
  });
  assert.equal(withOpPieces.starts[0].pendingPieces, 12);

  const withoutOpPieces = weeklyJobSummary("2026-07-20", {
    operations: [{ ...baseOp, secuencia: 1 }],
  });
  assert.equal(withoutOpPieces.starts[0].pendingPieces, 40);
});

test("weeklyJobSummary respeta amount explicito de la operacion sin sobreescribirlo", () => {
  const weeklyJobSummary = createWeeklyJobSummary({
    invoicePrices: { "4501": 12.5 },
  });
  const summary = weeklyJobSummary("2026-07-20", {
    operations: [{ ...baseOp, cantPendiente: 70, amount: 999 }],
  });

  assert.equal(summary.starts[0].amount, 999);
});

test("weeklyJobSummary ignora unitPrice/amount en cero del snapshot y deriva desde invoice", () => {
  const weeklyJobSummary = createWeeklyJobSummary({
    invoicePrices: { "4501": 12.5 },
  });
  const summary = weeklyJobSummary("2026-07-20", {
    operations: [{ ...baseOp, cantPendiente: 70, unitPrice: 0, amount: 0 }],
  });

  assert.equal(summary.starts[0].unitPrice, 12.5);
  assert.equal(summary.starts[0].amount, 875);
  assert.equal(summary.finishes[0].amount, 875);
});

test("weeklyJobSummary usa el mayor unitPrice entre ops, invoice y manual", () => {
  const weeklyJobSummary = createWeeklyJobSummary({
    invoicePrices: { "4501": 12.5 },
    configurations: { "PARTE-A": { manualUnitPrice: 9 } },
  });
  const summary = weeklyJobSummary("2026-07-20", {
    operations: [{ ...baseOp, cantPendiente: 70, unitPrice: 0.01 }],
  });

  assert.equal(summary.starts[0].unitPrice, 12.5);
  assert.equal(summary.starts[0].amount, 875);
});

test("weeklyJobSummary amount usa el mayor entre amount de ops y unitPrice * piezas", () => {
  const weeklyJobSummary = createWeeklyJobSummary({
    invoicePrices: { "4501": 12.5 },
  });
  const tiny = weeklyJobSummary("2026-07-20", {
    operations: [{ ...baseOp, cantPendiente: 70, amount: 0.02, unitPrice: 0.01 }],
  });
  assert.equal(tiny.starts[0].amount, 875);

  const largerOpAmount = weeklyJobSummary("2026-07-20", {
    operations: [{ ...baseOp, cantPendiente: 70, amount: 999, unitPrice: 0.01 }],
  });
  assert.equal(largerOpAmount.starts[0].amount, 999);
  assert.equal(largerOpAmount.starts[0].unitPrice, 12.5);
});

test("weeklyJobSummary con ceros de snapshot y sin precio deja monto nulo (no amount 0 bloqueante)", () => {
  const weeklyJobSummary = createWeeklyJobSummary();
  const summary = weeklyJobSummary("2026-07-20", {
    operations: [{ ...baseOp, cantPendiente: 70, unitPrice: 0, amount: 0 }],
  });

  assert.equal(summary.starts[0].unitPrice, null);
  assert.equal(summary.starts[0].amount, null);
});

test("weeklyJobSummary ignora precios residuales (< $1 MXN) cuando no hay otra fuente de precio", () => {
  const weeklyJobSummary = createWeeklyJobSummary();
  const summary = weeklyJobSummary("2026-07-20", {
    operations: [{ ...baseOp, cantPendiente: 20, unitPrice: 0.01, amount: 0.02 }],
  });

  assert.equal(summary.starts[0].unitPrice, null);
  assert.equal(summary.starts[0].amount, null);
  assert.equal(summary.finishes[0].amount, null);
});

test("weeklyJobSummary ignora unitPrice/amount residuales (< $1 MXN) y deriva monto desde invoice real", () => {
  const weeklyJobSummary = createWeeklyJobSummary({
    invoicePrices: { "4501": 12.5 },
  });
  const summary = weeklyJobSummary("2026-07-20", {
    operations: [{ ...baseOp, cantPendiente: 20, unitPrice: 0.1, amount: 0.3 }],
  });

  assert.equal(summary.starts[0].unitPrice, 12.5);
  assert.equal(summary.starts[0].amount, 250);
});

test("weeklyJobSummary ignora manualUnitPrice residual (< $1 MXN) sin precio invoice", () => {
  const weeklyJobSummary = createWeeklyJobSummary({
    configurations: { "PARTE-A": { manualUnitPrice: 0.5 } },
  });
  const summary = weeklyJobSummary("2026-07-20", {
    operations: [{ ...baseOp, cantPendiente: 20 }],
  });

  assert.equal(summary.starts[0].unitPrice, null);
  assert.equal(summary.starts[0].amount, null);
});

test("weeklyJobSummary usa piezas no ensambladas de la OT cerrada cuando las ops traen 0 pendientes", () => {
  const weeklyJobSummary = createWeeklyJobSummary({
    invoicePrices: { "4501": 4592 },
    closedPieces: { "4501": 1 },
  });
  const summary = weeklyJobSummary("2026-07-20", {
    operations: [{ ...baseOp, pendingPieces: 0, cantPendiente: 0, unitPrice: 4592, amount: 0 }],
  });

  assert.equal(summary.starts[0].pendingPieces, 1);
  assert.equal(summary.starts[0].unitPrice, 4592);
  assert.equal(summary.starts[0].amount, 4592);
  assert.equal(summary.finishes[0].amount, 4592);
});

test("weeklyJobSummary prioriza piezas vivas de workOrder sobre las de la OT cerrada", () => {
  const workOrdersByOt = new Map([["4501", { pendingQuantity: 40 }]]);
  const weeklyJobSummary = createWeeklyJobSummary({
    workOrdersByOt,
    closedPieces: { "4501": 1 },
  });
  const summary = weeklyJobSummary("2026-07-20", {
    operations: [{ ...baseOp, secuencia: 1 }],
  });

  assert.equal(summary.starts[0].pendingPieces, 40);
});

test("weeklyJobSummary sin piezas vivas ni cerradas deja monto en nulo", () => {
  const weeklyJobSummary = createWeeklyJobSummary({
    invoicePrices: { "4501": 4592 },
  });
  const summary = weeklyJobSummary("2026-07-20", {
    operations: [{ ...baseOp, pendingPieces: 0, cantPendiente: 0, unitPrice: 4592, amount: 0 }],
  });

  assert.equal(summary.starts[0].pendingPieces, 0);
  assert.equal(summary.starts[0].amount, null);
});

test("weeklyJobSummary conserva una OT cerrada que el borrador ya no trae (RULE-REP-027)", () => {
  // La OT 4701 se cerró en NetSuite: `removeClosedWorkOrdersFromDraft` la retiró de
  // `state.operations` y dejó su resumen compacto en `state.closedWorkOrderSummaries`.
  // El reporte semanal NO debe esfumarla: debe seguir mostrándola con sus piezas y su costo.
  const weeklyJobSummary = createWeeklyJobSummary({
    configurations: { "PARTE-CERRADA": { manualUnitPrice: 500 } },
    closedSummaries: {
      "4701": {
        ot: "4701",
        item: "PARTE-CERRADA",
        quantity: 5,
        builtQuantity: 0,
        pendingQuantity: 5,
        scheduledStart: "2026-07-22T08:00:00Z",
        scheduledEnd: "2026-07-23T16:00:00Z",
        weekStart: "2026-07-20",
        finalStatus: "CERRADA",
      },
    },
  });
  const summary = weeklyJobSummary("2026-07-20", { operations: [] });

  assert.equal(
    summary.starts.some((row) => row.ot === "4701"),
    true,
    "debe aparecer en 'OT que inician' con su inicio programado",
  );
  const finish = summary.finishes.find((row) => row.ot === "4701");
  assert.ok(finish, "debe aparecer en 'OT que terminan' con su fin programado");
  assert.equal(finish.part, "PARTE-CERRADA");
  assert.equal(finish.pendingPieces, 5);
  assert.equal(finish.amount, 2500, "debe conservar el costo (5 piezas x $500)");
});

test("weeklyJobSummary NO mezcla OTs cerradas de hoy en un plan publicado (instantánea inmutable)", () => {
  // Un plan publicado ya guarda sus propias operaciones: agregarle las OTs cerradas del
  // estado vivo reescribiría el pasado. Solo el borrador recibe el rescate.
  const weeklyJobSummary = createWeeklyJobSummary({
    closedSummaries: {
      "4701": {
        ot: "4701",
        item: "PARTE-CERRADA",
        quantity: 5,
        scheduledStart: "2026-07-22T08:00:00Z",
        scheduledEnd: "2026-07-23T16:00:00Z",
      },
    },
    reportSnapshot: { snapshotId: "snap-1750000000000", operations: [] },
  });
  const summary = weeklyJobSummary("2026-07-20", { operations: [] });

  assert.equal(summary.starts.length, 0);
  assert.equal(summary.finishes.length, 0);
});

test("weeklyJobSummary usa solo lo pendiente de ensamblar del detalle de inspeccion por encima de la ruta", () => {
  const weeklyJobSummary = createWeeklyJobSummary({
    invoicePrices: { "4501": 4592 },
    inspectionPieces: { "4501": { quantity: 15, builtQuantity: 15 } },
    closedPieces: { "4501": 15 },
  });
  const summary = weeklyJobSummary("2026-07-20", {
    operations: [{ ...baseOp, cantPendiente: 15, unitPrice: 4592, amount: 68880 }],
  });

  assert.equal(summary.starts[0].pendingPieces, 0);
  assert.equal(summary.starts[0].amount, null);
  assert.equal(summary.finishes[0].pendingPieces, 0);
});

test("weeklyJobSummary resta lo ensamblado de inspeccion cuando la OT esta a medio construir", () => {
  const weeklyJobSummary = createWeeklyJobSummary({
    invoicePrices: { "4501": 4592 },
    inspectionPieces: { "4501": { quantity: 480, builtQuantity: 480 } },
  });
  const summary = weeklyJobSummary("2026-07-20", {
    operations: [{ ...baseOp, cantPendiente: 480 }],
  });

  const partial = createWeeklyJobSummary({
    invoicePrices: { "4501": 4592 },
    inspectionPieces: { "4501": { quantity: 480, builtQuantity: 192 } },
  })("2026-07-20", { operations: [{ ...baseOp, cantPendiente: 480 }] });

  assert.equal(summary.starts[0].pendingPieces, 0);
  assert.equal(partial.starts[0].pendingPieces, 288);
  assert.equal(partial.starts[0].amount, 288 * 4592);
});

test("weeklyJobSummary rescata la OT 4111 cerrada CON su articulo y su cantidad real (DECISION 2026-10-30)", () => {
  // MEDIDO 2026-10-30: la OT 4111 (cerrada) aparecia en el Plan de la semana como fila
  // fantasma: PARTE vacio, 0 pzs, $0.00, porque su resumen compacto llego con `item` y
  // cantidades en 0. El usuario pidio que aparezca EN SU LUGAR, con el articulo y la
  // cantidad de la OT. Datos reales: work_orders -> CM 400 E, cantidad 10, ensamblada 10.
  const weeklyJobSummary = createWeeklyJobSummary({
    workOrdersByOt: new Map([
      ["4111", { ot: "4111", item: "CM 400 E", quantity: 10, builtQuantity: 10, pendingQuantity: 0 }],
    ]),
    configurations: { "CM 400 E": { manualUnitPrice: 133.75 } },
    closedSummaries: {
      // El resumen tal como lo dejo el cierre: vacio, pero con su horario.
      "4111": {
        ot: "4111",
        item: "",
        quantity: 0,
        builtQuantity: 0,
        pendingQuantity: 0,
        scheduledStart: "2026-10-27T08:00:00Z",
        scheduledEnd: "2026-10-27T16:00:00Z",
        weekStart: "2026-10-26",
        finalStatus: "CERRADA",
      },
    },
  });
  const summary = weeklyJobSummary("2026-10-26", { operations: [] });
  const finish = summary.finishes.find((row) => row.ot === "4111");
  assert.ok(finish, "la 4111 aparece en su lugar (no se oculta)");
  assert.equal(finish.part, "CM 400 E", "con el articulo real de la OT");
  // 10 de cantidad y 10 ensambladas: no falta nada por terminar, igual que en las demas OTs
  // cerradas que conserva RULE-REP-027.
  assert.equal(finish.pendingPieces, 0);
  assert.equal(finish.unitPrice, 133.75);
});

test("weeklyJobSummary completa la cantidad desde la ficha cuando el resumen no la trae", () => {
  const weeklyJobSummary = createWeeklyJobSummary({
    workOrdersByOt: new Map([
      ["4702", { ot: "4702", item: "PARTE-B", quantity: 12, builtQuantity: 5, pendingQuantity: 7 }],
    ]),
    invoicePrices: { "4702": 10 },
    closedSummaries: {
      "4702": {
        ot: "4702",
        item: "",
        quantity: 0,
        builtQuantity: 0,
        pendingQuantity: 0,
        scheduledStart: "2026-07-21T08:00:00Z",
        scheduledEnd: "2026-07-22T16:00:00Z",
        weekStart: "2026-07-20",
        finalStatus: "CERRADA",
      },
    },
  });
  const summary = weeklyJobSummary("2026-07-20", { operations: [] });
  const finish = summary.finishes.find((row) => row.ot === "4702");
  assert.ok(finish, "se rescata");
  assert.equal(finish.part, "PARTE-B");
  assert.equal(finish.pendingPieces, 7, "12 - 5 ensambladas, la misma cuenta de compactClosedWorkOrder");
  assert.equal(finish.amount, 70);
});

test("weeklyJobSummary SI rescata una OT cerrada sin articulo pero con piezas pendientes", () => {
  // La regla nueva no se pasa de lista: si una OT cerrada tiene piezas pendientes, se
  // rescata igual (RULE-REP-027), aunque el resumen no traiga el articulo.
  const weeklyJobSummary = createWeeklyJobSummary({
    configurations: { "": { manualUnitPrice: 10 } },
    invoicePrices: { "4701": 10 },
    closedPieces: { "4701": 3 },
    closedSummaries: {
      "4701": {
        ot: "4701",
        item: "",
        quantity: 0,
        builtQuantity: 0,
        pendingQuantity: 3,
        scheduledStart: "2026-07-22T08:00:00Z",
        scheduledEnd: "2026-07-23T16:00:00Z",
        weekStart: "2026-07-20",
        finalStatus: "CERRADA",
      },
    },
  });
  const summary = weeklyJobSummary("2026-07-20", { operations: [] });
  const finish = summary.finishes.find((row) => row.ot === "4701");
  assert.ok(finish, "se rescata con piezas pendientes");
  assert.equal(finish.pendingPieces, 3);
});
