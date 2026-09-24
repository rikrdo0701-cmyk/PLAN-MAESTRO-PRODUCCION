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
} = {}) {
  const source = sourceBetween("function weeklyJobSummary(", "function renderWeeklyJobDays(");
  return Function(
    "state", "selectedWeekRange", "reportOperationsSource", "isToolChangeReportOperation",
    "sequenceSort", "isFinalReleaseOperation", "opStart", "opEnd", "workOrderForOt",
    "articleConfigurationValue", "pendingPiecesForWorkOrder", "invoiceUnitPriceForOt",
    `${source}; return weeklyJobSummary;`,
  )(
    { reportWeekStart: "2026-07-20" },
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
