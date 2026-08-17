import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");
const plannerSource = await readFile(new URL("../src/web/planning/planner-core.js", import.meta.url), "utf8");
const plannerContext = { globalThis: {} };
vm.runInNewContext(plannerSource, plannerContext, { filename: "planner-core.js" });
const PlannerCore = plannerContext.globalThis.PlannerCore;
const TOOL_CHANGE_KEY = "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL";

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

function normalizeCapabilityKeysForApp(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => {
    const text = String(value || "").trim();
    if (!text) return "";
    const separator = text.indexOf("::");
    if (separator < 0) return text;
    const ct = text.slice(0, separator).trim();
    const label = normalizeStatus(text.slice(separator + 2).replace(/_/g, " ")).replace(/\s+/g, "_");
    return ct && label ? `${ct}::${label}` : "";
  }).filter(Boolean))]
    .filter((key) => normalizeStatus(key).replace(/\s+/g, "_") !== TOOL_CHANGE_KEY);
}

function loadCurrentPlanOperations(state, plannerCore = PlannerCore) {
  const operationsSource = sourceBetween(
    "function invalidateCurrentPlanOperationsCache",
    "function currentDraftScheduledOperations(",
  );
  return Function(
    "state", "window", "normalizeCapabilityKeys",
    `let currentPlanOperationsCache = null;
      ${operationsSource};
      return {
        currentPlanOperations,
        invalidateCurrentPlanOperationsCache:
          typeof invalidateCurrentPlanOperationsCache === "function"
            ? invalidateCurrentPlanOperationsCache
            : undefined,
      };`,
  )(state, { PlannerCore: plannerCore }, normalizeCapabilityKeysForApp);
}

test("TOOL_CHANGE obligatorio se normaliza y se muestra fijo en la matriz", () => {
  const capability = {
    key: TOOL_CHANGE_KEY,
    ct: "TOOL_CHANGE",
    label: "CAMBIO DE HERRAMENTAL",
    count: 0,
  };
  const normalizeCapabilityKeys = Function(
    "uniq", "normalizeHeader", "TOOL_CHANGE_CAPABILITY",
    `${sourceBetween("function normalizeCapabilityKeys(", "function parseManualCapability(")}; return normalizeCapabilityKeys;`,
  )(
    (items) => [...new Set(items)],
    (value) => normalizeStatus(value).replace(/\s+/g, "_"),
    capability,
  );
  const state = {
    operators: [],
    matrixSearch: "",
    excludedCapabilities: normalizeCapabilityKeys([
      TOOL_CHANGE_KEY,
      " 5459::dóblado ",
    ]),
    operationRules: {},
  };
  const matrixWrap = {
    innerHTML: "",
    querySelectorAll: () => [],
  };
  const els = {
    matrixWrap,
    matrixSearchInput: { value: "" },
    matrixSearchCount: { textContent: "" },
    clearMatrixSearchBtn: { disabled: false },
  };
  const renderMatrix = Function(
    "state", "els", "window", "renderOperationCatalogSelect", "getCapabilityRows",
    "capacityModeForCapability", "escapeHtml", "isOperatorSkilledForCapability",
    "TOOL_CHANGE_CAPABILITY", "normalizeHeader",
    `${sourceBetween("function renderMatrix()", "function renderOperationCatalogSelect()")}; return renderMatrix;`,
  )(
    state,
    els,
    { PlannerCore },
    () => {},
    () => [capability],
    () => "FINITA",
    (value) => String(value),
    () => false,
    capability,
    (value) => normalizeStatus(value).replace(/\s+/g, "_"),
  );

  renderMatrix();

  assert.deepEqual(state.excludedCapabilities, ["5459::DOBLADO"]);
  assert.match(matrixWrap.innerHTML, /data-capability-plan-state="TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL"[^>]*disabled/);
  assert.doesNotMatch(matrixWrap.innerHTML, /value="EXCLUDE"/);
});

test("un estado corrupto no oculta el cambio generado por el motor", () => {
  const corruptState = {
    selectedOts: ["100"],
    excludedCapabilities: [TOOL_CHANGE_KEY],
    operations: [
      {
        id: "old-completed-change",
        ot: "100",
        secuencia: 0,
        ct: "TOOL_CHANGE",
        descripcion: "CAMBIO DE HERRAMENTAL",
        tipoInsercion: "CAMBIO_HERRAMENTAL",
        estatus: "PLAN",
        planStatus: "COMPLETADA_PLAN",
        generatedBy: "PLANNER_CORE_V2",
        operador: "AJUSTADOR",
        maquina: "M1",
        herramental: "H0",
        fechaInicio: "2026-07-24",
        horaInicio: "07:00",
        fechaFin: "2026-07-24",
        horaFin: "07:30",
        tiempoSetup: 30,
      },
      {
        id: "bend-100",
        ot: "100",
        secuencia: 1,
        ct: "5459",
        descripcion: "DOBLEZ",
        estatus: "PLAN",
        operador: "OPERADOR 1",
        maquina: "M1",
        herramental: "H1",
        tiempoProd: 20,
      },
    ],
    workOrders: [{ ot: "100" }],
    operators: ["OPERADOR 1", "AJUSTADOR"],
    matrix: {
      "5459::DOBLEZ": ["OPERADOR 1"],
      [TOOL_CHANGE_KEY]: ["AJUSTADOR"],
    },
    configuredCapabilities: ["5459::DOBLEZ", TOOL_CHANGE_KEY],
    settings: { optimizationPasses: 1, toolChangeMinutes: 30 },
    workSchedule: {},
  };
  const scheduled = PlannerCore.schedulePlan(corruptState, {
    planStart: "2026-07-27",
    horizonDays: 5,
    executionTime: "2026-07-27T07:00:00",
  });
  const scheduledChanges = scheduled.operations
    .filter((op) => op.tipoInsercion === "CAMBIO_HERRAMENTAL");
  const visibleChanges = PlannerCore.filterExcludedOperations(corruptState, scheduled.operations)
    .filter((op) => op.tipoInsercion === "CAMBIO_HERRAMENTAL");

  assert.ok(scheduledChanges.length > 0, JSON.stringify(scheduled.lastSchedule.diagnostics));
  assert.deepEqual(
    visibleChanges.map((op) => op.id),
    scheduledChanges.map((op) => op.id),
  );
  assert.ok(visibleChanges.every((op) => op.fechaInicio && op.fechaFin));
});

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
  const { currentPlanOperations } = loadCurrentPlanOperations(state);
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

test("los consumidores del render comparten operaciones incluidas hasta invalidar cambios relevantes", () => {
  let filterCalls = 0;
  const instrumentedPlannerCore = {
    ...PlannerCore,
    filterExcludedOperations(...args) {
      filterCalls += 1;
      return PlannerCore.filterExcludedOperations(...args);
    },
  };
  const state = {
    excludedCapabilities: [],
    operations: [
      { id: "cut", ct: "100", descripcion: "CORTE" },
    ],
  };
  const { currentPlanOperations, invalidateCurrentPlanOperationsCache } =
    loadCurrentPlanOperations(state, instrumentedPlannerCore);

  const first = currentPlanOperations();
  const second = currentPlanOperations();

  assert.equal(first, second);
  assert.equal(filterCalls, 1);
  assert.equal(typeof invalidateCurrentPlanOperationsCache, "function");

  state.operations.push({ id: "bend", ct: "5459", descripcion: "DOBLADO" });
  invalidateCurrentPlanOperationsCache();
  const afterOperationsChange = currentPlanOperations();
  assert.notEqual(afterOperationsChange, second);
  assert.deepEqual(afterOperationsChange.map((operation) => operation.id), ["cut", "bend"]);
  assert.equal(filterCalls, 2);

  state.excludedCapabilities = ["5459::DOBLADO"];
  invalidateCurrentPlanOperationsCache();
  const afterExclusionChange = currentPlanOperations();
  assert.notEqual(afterExclusionChange, afterOperationsChange);
  assert.deepEqual(afterExclusionChange.map((operation) => operation.id), ["cut"]);
  assert.equal(filterCalls, 3);
});

test("getPriorityJobs reutiliza indices y se invalida al cambiar los datos base", () => {
  const state = {
    operations: [{ id: "op-1", ot: "100", secuencia: 1, ct: "5458", prioridad: 10, tiempoProd: 30 }],
    workOrders: [{ ot: "100", status: "PLAN", item: "P-100" }],
    materials: [{ ot: "100", component: "MP-100" }],
    selectedOts: [],
    lockedOts: [],
    netSuiteChangeAlerts: [],
  };
  let materialScans = 0;
  let workOrderScans = 0;
  const source = [
    sourceBetween("function invalidateCurrentPlanOperationsCache", "function currentDraftScheduledOperations("),
    sourceBetween("function getPriorityJobs()", "function getSelectedPriorityJob()"),
  ].join("\n");
  const api = Function(
    "state", "window", "normalizeCapabilityKeys", "sequenceSort", "opStart", "workOrderPlaceholderOperation",
    "jobPriority", "effectiveWorkOrderDueDate", "pendingPiecesForWorkOrder", "uniq", "jobStatusForOt",
    "isMovablePlanningStatus", "isProgrammedJobStatus", "isClosedJobStatus", "isJobLocked", "operationDuration",
    "compareJobs", "materialOtKey", "workOrderForOt", "materialsForOt", "materialBaseForOt",
    `let currentPlanOperationsCache = null;
     let priorityJobsCache = null;
     let planningStateIndexesCache = null;
     let planAlertItemsCache = null;
     let operatorLoadsCache = null;
     ${source};
     return { getPriorityJobs, invalidatePriorityJobsCache };`,
  )(
    state,
    { PlannerCore },
    normalizeCapabilityKeysForApp,
    (a, b) => a.secuencia - b.secuencia,
    () => 0,
    (wo) => ({ id: `placeholder-${wo.ot}`, ot: wo.ot }),
    (ops) => Math.min(...ops.map((op) => op.prioridad), 999),
    () => "",
    () => 0,
    (values) => [...new Set(values)],
    () => "PLAN",
    () => true,
    () => false,
    () => false,
    () => false,
    (op) => Number(op.tiempoProd || 0),
    (a, b) => String(a.ot).localeCompare(String(b.ot), "es", { numeric: true }),
    (value) => String(value || "").trim().toUpperCase(),
    (ot) => { workOrderScans += 1; return state.workOrders.find((item) => String(item.ot) === String(ot)); },
    (ot) => { materialScans += 1; return state.materials.filter((item) => String(item.ot) === String(ot)); },
    (ot) => state.materials.find((item) => String(item.ot) === String(ot))?.component || "",
  );

  const first = api.getPriorityJobs();
  const second = api.getPriorityJobs();
  assert.strictEqual(first, second);
  assert.equal(first[0].materialBase, "MP-100");
  assert.equal(materialScans, 0);
  assert.equal(workOrderScans, 0);

  state.materials = [{ ot: "100", component: "MP-200" }];
  api.invalidatePriorityJobsCache();
  const third = api.getPriorityJobs();
  assert.notStrictEqual(third, first);
  assert.equal(third[0].materialBase, "MP-200");
});

test("la firma de exclusiones distingue claves que contienen separadores", () => {
  const state = {
    excludedCapabilities: ["100::A|B", "200::C"],
    operations: [
      { id: "pipe-label", ct: "100", descripcion: "A|B" },
      { id: "plain-label", ct: "100", descripcion: "A" },
    ],
  };
  const { currentPlanOperations } = loadCurrentPlanOperations(state);

  const first = currentPlanOperations();
  state.excludedCapabilities = ["100::A", "B|200::C"];
  const second = currentPlanOperations();

  assert.notEqual(second, first);
  assert.deepEqual(first.map((operation) => operation.id), ["plain-label"]);
  assert.deepEqual(second.map((operation) => operation.id), ["pipe-label"]);
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

test("la app conserva el concepto OPERADOR de CALENDARIO y mapea su recurso al normalizar estado", () => {
  const calendarSource = sourceBetween(
    "state.calendarExceptions = (Array.isArray(state.calendarExceptions)",
    "state.subcontracts = (Array.isArray(state.subcontracts)",
  );
  const normalizeCalendar = Function(
    "state", "normalizeStatus", "normalizeOtDate",
    `${calendarSource}; return state;`,
  );
  const call = (source, extra) => normalizeCalendar(
    { calendarExceptions: [source] },
    normalizeStatus,
    (value) => String(value || "").slice(0, 10),
  );

  const operatorException = call({ concept: "OPERADOR", resource: "SOLDADOR", fechaInicio: "2026-08-20", fechaFin: "2026-08-20" });
  assert.equal(operatorException.calendarExceptions[0].concept, "OPERADOR");
  assert.equal(operatorException.calendarExceptions[0].resource, "SOLDADOR");
  assert.equal(operatorException.calendarExceptions[0].machine, "");

  const fallbackFromBackend = call({ concept: "OPERADOR", machine: "PUNTEADOR", fechaInicio: "2026-08-22", fechaFin: "2026-08-22" });
  assert.equal(fallbackFromBackend.calendarExceptions[0].resource, "PUNTEADOR");
});
