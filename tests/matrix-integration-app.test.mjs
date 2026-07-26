import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");
const plannerSource = await readFile(new URL("../src/web/planning/planner-core.js", import.meta.url), "utf8");
const plannerContext = { globalThis: {} };
vm.runInNewContext(plannerSource, plannerContext, { filename: "planner-core.js" });
const PlannerCore = plannerContext.globalThis.PlannerCore;

function sourceBetween(startText, endText) {
  const start = app.indexOf(startText);
  const end = app.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `Falta ${startText}`);
  return app.slice(start, end);
}

function normalizeStatus(value) {
  return String(value || "PLAN").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function isClosedJobStatus(status) {
  return ["CERRAD", "CLOSED", "COMPLETE", "COMPLETADO"].some((value) => normalizeStatus(status).includes(value));
}

function isProgrammedJobStatus(status) {
  return normalizeStatus(status).includes("PROGRAMAD");
}

function isPlannedJobStatus(status) {
  return normalizeStatus(status).includes("PLANIFICAD");
}

test("tarjetas, estado y fin programado derivan solo de operaciones incluidas", () => {
  const state = {
    excludedCapabilities: ["5459::DOBLADO"],
    operations: [
      {
        id: "excluded",
        ot: "100",
        ct: "5459",
        descripcion: "DOBLADO",
        estatus: "CERRADA",
        operador: "FANTASMA",
        prioridad: 1,
        fechaInicio: "2026-07-30",
        horaInicio: "07:00",
        fechaFin: "2026-07-30",
        horaFin: "17:00",
      },
      {
        id: "included",
        ot: "100",
        ct: "100",
        descripcion: "CORTE",
        estatus: "PLAN",
        operador: "ANA",
        prioridad: 5,
        tiempoProd: 60,
        fechaInicio: "2026-07-27",
        horaInicio: "07:00",
        fechaFin: "2026-07-27",
        horaFin: "08:00",
      },
    ],
    workOrders: [{ ot: "100", status: "PLAN", item: "P-1" }],
  };
  const currentPlanOperations = Function(
    "state", "window",
    `${sourceBetween("function currentPlanOperations(", "function currentDraftScheduledOperations(")}; return currentPlanOperations;`,
  )(state, { PlannerCore });
  const jobStatusSource = sourceBetween("function jobStatusFromOperations(", "function matchesStatusFilter(");
  const { jobStatusFromOperations, jobStatusForOt } = Function(
    "state", "currentPlanOperations", "workOrderForOt", "isClosedJobStatus",
    "isProgrammedJobStatus", "isPlannedJobStatus", "materialOtKey",
    `${jobStatusSource}; return { jobStatusFromOperations, jobStatusForOt };`,
  )(
    state,
    currentPlanOperations,
    (ot) => state.workOrders.find((item) => item.ot === ot),
    isClosedJobStatus,
    isProgrammedJobStatus,
    isPlannedJobStatus,
    (value) => String(value || "").trim().toUpperCase(),
  );
  const jobScheduledFinish = Function(
    "currentPlanOperations", "opEnd",
    `${sourceBetween("function jobScheduledFinish(", "function jobRiskLevel(")}; return jobScheduledFinish;`,
  )(
    currentPlanOperations,
    (op) => op.fechaFin ? new Date(`${op.fechaFin}T${op.horaFin}:00`) : null,
  );
  const getPriorityJobs = Function(
    "state", "currentPlanOperations", "sequenceSort", "opStart", "workOrderForOt",
    "workOrderPlaceholderOperation", "jobPriority", "effectiveWorkOrderDueDate",
    "pendingPiecesForWorkOrder", "uniq", "materialsForOt", "materialBaseForOt",
    "jobStatusForOt", "isMovablePlanningStatus", "isProgrammedJobStatus",
    "isClosedJobStatus", "isJobLocked", "operationDuration", "compareJobs",
    `${sourceBetween("function getPriorityJobs()", "function getSelectedPriorityJob()")}; return getPriorityJobs;`,
  )(
    state,
    currentPlanOperations,
    (a, b) => a.secuencia - b.secuencia,
    (op) => op.fechaInicio ? new Date(`${op.fechaInicio}T${op.horaInicio}:00`) : null,
    (ot) => state.workOrders.find((item) => item.ot === ot),
    (wo) => ({ id: `placeholder-${wo.ot}`, ot: wo.ot }),
    (ops) => Math.min(...ops.map((op) => op.prioridad), 999),
    () => "",
    () => 0,
    (values) => [...new Set(values)],
    () => [],
    () => "",
    jobStatusForOt,
    (status) => !isClosedJobStatus(status) && !isProgrammedJobStatus(status),
    isProgrammedJobStatus,
    isClosedJobStatus,
    () => false,
    (op) => Number(op.tiempoProd || 0),
    () => 0,
  );

  const jobs = getPriorityJobs();

  assert.equal(jobStatusFromOperations("100", currentPlanOperations(), state.workOrders), "PLAN");
  assert.equal(jobStatusForOt("100"), "PLAN");
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0].ops.map((op) => op.id), ["included"]);
  assert.deepEqual(jobs[0].operators, ["ANA"]);
  assert.deepEqual(jobs[0].cts, ["100"]);
  assert.equal(jobs[0].minutes, 60);
  const finish = jobScheduledFinish({ ops: state.operations });
  assert.equal(finish.getFullYear(), 2026);
  assert.equal(finish.getMonth(), 6);
  assert.equal(finish.getDate(), 27);
  assert.equal(finish.getHours(), 8);
});

test("KPI histórico se calcula solo con el snapshot publicado", () => {
  const published = {
    snapshotId: "published-1",
    selectedOts: ["100"],
    lastSchedule: { scheduledOts: ["100"] },
    workOrders: [{ ot: "100", status: "PLAN", pendingQuantity: 7 }],
    operationPlanStatuses: {},
    operations: [{
      id: "published-op",
      ot: "100",
      ct: "100",
      descripcion: "CORTE",
      estatus: "PLAN",
      secuencia: 1,
      pendingPieces: 7,
      fechaInicio: "2026-07-01",
      horaInicio: "07:00",
      fechaFin: "2026-07-01",
      horaFin: "08:00",
    }],
  };
  const jobStatusFromOperations = Function(
    "isClosedJobStatus", "isProgrammedJobStatus", "isPlannedJobStatus", "materialOtKey",
    `${sourceBetween("function jobStatusFromOperations(", "function jobStatusForOt(")}; return jobStatusFromOperations;`,
  )(
    isClosedJobStatus,
    isProgrammedJobStatus,
    isPlannedJobStatus,
    (value) => String(value || "").trim().toUpperCase(),
  );
  const stalePublishedPieces = Function(
    "window", "jobStatusFromOperations", "isClosedJobStatus", "opStart", "opEnd",
    "sequenceSort", "pendingPiecesForWorkOrder", "materialOtKey",
    `${sourceBetween("function stalePublishedPieces(", "function weeklyJobSummary(")}; return stalePublishedPieces;`,
  )(
    { PlannerCore },
    jobStatusFromOperations,
    isClosedJobStatus,
    (op) => op.fechaInicio ? new Date(`${op.fechaInicio}T${op.horaInicio}:00`) : null,
    (op) => op.fechaFin ? new Date(`${op.fechaFin}T${op.horaFin}:00`) : null,
    (a, b) => a.secuencia - b.secuencia,
    (wo) => Number(wo?.pendingQuantity || 0),
    (value) => String(value || "").trim().toUpperCase(),
  );

  const result = stalePublishedPieces(
    new Date("2026-07-20T00:00:00"),
    published.operations,
    published,
  );

  assert.deepEqual(result, { initialCut: 7, finishing: 7 });
});
