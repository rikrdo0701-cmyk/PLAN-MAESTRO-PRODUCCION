"use strict";

const STORAGE_KEY = "plan-produccion-app-v1";
const APP_SHEET_API = "/api/plan-sheet";
const NETSUITE_EXERCISE_API = "/api/netsuite-exercise";
const NETSUITE_PLANNING_TIMEOUT_MS = 15000;
const NETSUITE_PLANNING_FRESH_MS = 5 * 60 * 1000;
const PLAN_SNAPSHOTS_API = "/api/plan-snapshots";
const MIN_OPERATION_MINUTES = 1;
const WORK_START_HOUR = 7;
const WORK_END_HOUR = 17;
const WORK_DAY_MINUTES = (WORK_END_HOUR - WORK_START_HOUR) * 60;
const DEFAULT_HORIZON_DAYS = 15;
const APP_SCHEMA_VERSION = 29;
const REPORT_ROW_LIMIT = 25;
const CUSTOM_CATALOG_VALUE = "__NUEVO__";
const DEFAULT_WEEKLY_RELEASE_TARGET = 1110000;
const DEFAULT_WORK_SCHEDULE = {
  MON: { enabled: true, start: "07:00", end: "17:00" },
  TUE: { enabled: true, start: "07:00", end: "17:00" },
  WED: { enabled: true, start: "07:00", end: "17:00" },
  THU: { enabled: true, start: "07:00", end: "17:00" },
  FRI: { enabled: true, start: "07:00", end: "17:00" },
  SAT: { enabled: false, start: "07:00", end: "13:00" },
  SUN: { enabled: false, start: "07:00", end: "13:00" },
};
const DEFAULT_DAILY_BREAKS = {
  MEAL: { enabled: false, start: "13:00", end: "13:30" },
  PRODUCTION: { enabled: false, start: "10:00", end: "10:10" },
};

const PLAN_HEADERS = [
  "NUM",
  "OT",
  "PARTE",
  "DESCRIPCION",
  "CONTENIDO",
  "PRIORIDAD",
  "FECHA_REQ",
  "CANT_TOTAL",
  "SECUENCIA",
  "CT",
  "OPERADOR",
  "MAQUINA",
  "HERRAMENTAL",
  "KIT_HERRAMENTAL",
  "CANT_PENDIENTE",
  "TIEMPO_CICLO",
  "TIEMPO_SETUP",
  "TIEMPO_PROD",
  "FECHA_INICIO",
  "HORA_INICIO",
  "FECHA_FIN",
  "HORA_FIN",
  "TIPO_INSERCION",
  "ESTATUS",
  "LOG",
  "DIAS_SUBCONTRATO",
  "KIT_PENDIENTE",
  "AUTO_FROZEN",
  "HERRAMENTAL_ORIGEN",
  "KIT_ORIGEN",
  "HERRAMENTAL_DESTINO",
  "KIT_DESTINO",
  "COMENTARIO",
];

const FIELD_MAP = {
  NUM: "num",
  OT: "ot",
  PARTE: "parte",
  DESCRIPCION: "descripcion",
  CONTENIDO: "contenido",
  PRIORIDAD: "prioridad",
  FECHA_REQ: "fechaReq",
  CANT_TOTAL: "cantTotal",
  SECUENCIA: "secuencia",
  CT: "ct",
  OPERADOR: "operador",
  MAQUINA: "maquina",
  HERRAMENTAL: "herramental",
  KIT_HERRAMENTAL: "kitHerramental",
  CANT_PENDIENTE: "cantPendiente",
  TIEMPO_CICLO: "tiempoCiclo",
  TIEMPO_SETUP: "tiempoSetup",
  TIEMPO_PROD: "tiempoProd",
  FECHA_INICIO: "fechaInicio",
  HORA_INICIO: "horaInicio",
  FECHA_FIN: "fechaFin",
  HORA_FIN: "horaFin",
  TIPO_INSERCION: "tipoInsercion",
  ESTATUS: "estatus",
  LOG: "log",
  DIAS_SUBCONTRATO: "subcontractDays",
  KIT_PENDIENTE: "kitPending",
  AUTO_FROZEN: "autoFrozen",
  HERRAMENTAL_ORIGEN: "toolChangeFromHerramental",
  KIT_ORIGEN: "toolChangeFromKit",
  HERRAMENTAL_DESTINO: "toolChangeToHerramental",
  KIT_DESTINO: "toolChangeToKit",
  COMENTARIO: "comentario",
};

const LEGACY_PRIORITY = { ALTA: 1, ALTO: 1, NORMAL: 50, MEDIO: 50, MEDIA: 50, BAJA: 100, BAJO: 100 };
const CAPACITY_MODES = ["FINITA", "NO_FINITA"];
const DEFAULT_CAPACITY_MINUTES = 40 * 60;
const GANTT_VIEWS = ["job", "operator", "machine", "ct"];
const GANTT_ZOOM_LEVELS = [
  { dayWidth: 120, label: "Dia", minorMinutes: 300, majorMinutes: 300, labelMinutes: 300, snapMinutes: 30 },
  { dayWidth: 180, label: "5 h", minorMinutes: 300, majorMinutes: 300, labelMinutes: 300, snapMinutes: 30 },
  { dayWidth: 320, label: "2 h", minorMinutes: 120, majorMinutes: 120, labelMinutes: 120, snapMinutes: 15 },
  { dayWidth: 480, label: "1 h", minorMinutes: 60, majorMinutes: 60, labelMinutes: 60, snapMinutes: 10 },
  { dayWidth: 900, label: "30 min", minorMinutes: 30, majorMinutes: 60, labelMinutes: 60, snapMinutes: 5 },
  { dayWidth: 1800, label: "10 min", minorMinutes: 10, majorMinutes: 30, labelMinutes: 30, snapMinutes: 5 },
  { dayWidth: 3600, label: "1 min", minorMinutes: 1, majorMinutes: 15, labelMinutes: 15, snapMinutes: 1 },
];
const GANTT_DAY_WIDTHS = GANTT_ZOOM_LEVELS.map((level) => level.dayWidth);
const DEFAULT_GANTT_DAY_WIDTH = 180;
const RESOURCE_CATEGORIES = ["TD", "ACABADOS", "FUERA_DE_PLAN"];
const JOB_BAR_COLORS = ["#147d78", "#416f8f", "#a06d16", "#9d4b45", "#6c7842", "#7f536b"];
const WORKSPACE_TITLES = {
  "plan-semanal": "Planeacion de Produccion",
  matriz: "Matriz de habilidades",
  calendario: "Calendario de capacidad",
  herramentales: "Catalogos",
  cargas: "Cargas de operadores",
  reportes: "Reportes de produccion",
};
const DEFAULT_SUBCONTRACTS = [
  { id: "sub-cromado", part: "*", name: "CROMADO", days: 3, active: true },
  { id: "sub-metokote", part: "*", name: "METOKOTE", days: 3, active: true },
  { id: "sub-maka", part: "*", name: "MAKA", days: 3, active: true },
];
const DEFAULT_OT_TYPES = [
  { id: "tipo-oem", name: "OEM", active: true },
  { id: "tipo-especial", name: "ESPECIAL", active: true },
  { id: "tipo-linea", name: "LINEA", active: true },
];
const DEFAULT_PLANNING_TYPES = ["NORMAL", "PROTOTIPO", "EXPEDITADO"];
const TOOL_CHANGE_CAPABILITY = {
  key: "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL",
  ct: "TOOL_CHANGE",
  label: "CAMBIO DE HERRAMENTAL",
  source: "SISTEMA",
  active: true,
};

const sampleState = {
  schemaVersion: APP_SCHEMA_VERSION,
  revision: 0,
  ganttView: "job",
  ganttDayWidth: DEFAULT_GANTT_DAY_WIDTH,
  selectedOperationId: "op-1",
  capacityMinutes: DEFAULT_CAPACITY_MINUTES,
  planStart: "2026-06-29",
  horizonDays: DEFAULT_HORIZON_DAYS,
  loadWeekStart: "2026-06-29",
  reportWeekStart: "2026-06-29",
  draftVersionId: "",
  activePublishedVersionId: "",
  publishedVersions: [],
  reportFilters: {
    operator: { date: "2026-06-29", showAll: false, status: "PENDIENTES" },
    adjuster: { date: "2026-06-29", showAll: false, status: "PENDIENTES" },
    subcontract: { date: "2026-06-29", showAll: false },
  },
  dailyBreaks: deepClone(DEFAULT_DAILY_BREAKS),
  lockedOts: [],
  expandedOts: null,
  plant: { name: "Demo", locationId: null },
  settings: {
    defaultSubcontractDays: 3,
    toolChangeCt: "122",
    toolChangeMinutes: 120,
    toolChangeOperator: "AJUSTADOR",
    weeklyReleaseTarget: DEFAULT_WEEKLY_RELEASE_TARGET,
  },
  operators: ["DOBLADOR 1", "DOBLADOR 2", "SOLDADOR 1", "PINTURA 1", "AJUSTADOR"],
  operatorProfiles: {
    "DOBLADOR 1": { name: "DOBLADOR 1", category: "TD" },
    "DOBLADOR 2": { name: "DOBLADOR 2", category: "TD" },
    "SOLDADOR 1": { name: "SOLDADOR 1", category: "TD" },
    "PINTURA 1": { name: "PINTURA 1", category: "ACABADOS" },
    "AJUSTADOR": { name: "AJUSTADOR", category: "ACABADOS" },
  },
  cts: ["5459", "5527", "6462", "5495", "122", TOOL_CHANGE_CAPABILITY.ct],
  customCapabilities: [{ ...TOOL_CHANGE_CAPABILITY }],
  hiddenCapabilities: [],
  operationRules: {
    5459: { overlap: 0.6, keywords: "DOBLADO" },
    5527: { overlap: 0.6, keywords: "DOBLADO" },
    6462: { overlap: 1, keywords: "SUBCONTRATO, GALVANIZADO" },
  },
  machines: [],
  toolCatalog: [],
  machineToolHistory: [],
  workOrders: [],
  otConfigurations: {},
  articleConfigurations: {},
  materials: [],
  calendarExceptions: [],
  subcontracts: DEFAULT_SUBCONTRACTS.map((item) => ({ ...item })),
  otTypes: DEFAULT_OT_TYPES.map((item) => ({ ...item })),
  operationPlanStatuses: {},
  netSuiteChangeAlerts: [],
  netSuiteSyncAlert: null,
  capacityModes: {
    5459: "FINITA",
    5527: "FINITA",
    6462: "FINITA",
    5495: "FINITA",
    122: "FINITA",
    [TOOL_CHANGE_CAPABILITY.key]: "FINITA",
  },
  matrix: {
    5459: ["DOBLADOR 1", "DOBLADOR 2"],
    5527: ["DOBLADOR 1", "DOBLADOR 2"],
    6462: ["PINTURA 1"],
    5495: ["PINTURA 1"],
    122: ["AJUSTADOR"],
    [TOOL_CHANGE_CAPABILITY.key]: ["AJUSTADOR"],
  },
  operations: [
    {
      id: "op-1",
      num: 1,
      ot: "WO-10482",
      parte: "MP-CD-001",
      descripcion: "Doblado base superior",
      contenido: "PZA",
      prioridad: 1,
      fechaReq: "2026-07-01",
      cantTotal: 70,
      secuencia: 1,
      ct: "5459",
      operador: "DOBLADOR 1",
      maquina: "DOB-01",
      herramental: "H-18",
      kitHerramental: "KIT-A",
      cantPendiente: 70,
      tiempoCiclo: 4,
      tiempoSetup: 30,
      tiempoProd: 210,
      fechaInicio: "2026-06-29",
      horaInicio: "07:00",
      fechaFin: "2026-06-29",
      horaFin: "11:00",
      tipoInsercion: "OPERACION",
      estatus: "LIBERADO",
      log: "Demo",
    },
    {
      id: "op-2",
      num: 2,
      ot: "WO-10482",
      parte: "MP-CD-001",
      descripcion: "Soldadura soporte",
      contenido: "PZA",
      prioridad: 1,
      fechaReq: "2026-07-01",
      cantTotal: 70,
      secuencia: 2,
      ct: "5527",
      operador: "SOLDADOR 1",
      maquina: "SOL-02",
      herramental: "H-18",
      kitHerramental: "KIT-A",
      cantPendiente: 70,
      tiempoCiclo: 5,
      tiempoSetup: 20,
      tiempoProd: 260,
      fechaInicio: "2026-06-29",
      horaInicio: "11:30",
      fechaFin: "2026-06-29",
      horaFin: "16:10",
      tipoInsercion: "OPERACION",
      estatus: "LIBERADO",
      log: "Demo",
    },
    {
      id: "op-3",
      num: 3,
      ot: "WO-10510",
      parte: "MP-CD-120",
      descripcion: "Cambio herramental prensa",
      contenido: "HERR",
      prioridad: 50,
      fechaReq: "2026-07-03",
      cantTotal: 1,
      secuencia: 1,
      ct: "122",
      operador: "AJUSTADOR",
      maquina: "DOB-02",
      herramental: "H-22",
      kitHerramental: "KIT-C",
      cantPendiente: 1,
      tiempoCiclo: 0,
      tiempoSetup: 120,
      tiempoProd: 0,
      fechaInicio: "2026-06-30",
      horaInicio: "07:00",
      fechaFin: "2026-06-30",
      horaFin: "09:00",
      tipoInsercion: "CAMBIO_HERRAMENTAL",
      estatus: "LIBERADO",
      log: "Cambio automatico",
    },
    {
      id: "op-4",
      num: 4,
      ot: "WO-10510",
      parte: "MP-CD-120",
      descripcion: "Doblado lateral",
      contenido: "PZA",
      prioridad: 50,
      fechaReq: "2026-07-03",
      cantTotal: 35,
      secuencia: 1,
      ct: "5459",
      operador: "DOBLADOR 2",
      maquina: "DOB-02",
      herramental: "H-22",
      kitHerramental: "KIT-C",
      cantPendiente: 35,
      tiempoCiclo: 6,
      tiempoSetup: 25,
      tiempoProd: 180,
      fechaInicio: "2026-06-30",
      horaInicio: "09:00",
      fechaFin: "2026-06-30",
      horaFin: "12:25",
      tipoInsercion: "OPERACION",
      estatus: "LIBERADO",
      log: "Demo",
    },
    {
      id: "op-5",
      num: 5,
      ot: "WO-10544",
      parte: "MP-CD-210",
      descripcion: "Envio a pintura e-coat",
      contenido: "LOTE",
      prioridad: 100,
      fechaReq: "2026-07-08",
      cantTotal: 120,
      secuencia: 3,
      ct: "5495",
      operador: "PINTURA 1",
      maquina: "LINEA-EC",
      herramental: "",
      kitHerramental: "",
      cantPendiente: 120,
      tiempoCiclo: 3,
      tiempoSetup: 15,
      tiempoProd: 360,
      fechaInicio: "2026-07-01",
      horaInicio: "07:30",
      fechaFin: "2026-07-01",
      horaFin: "13:45",
      tipoInsercion: "OPERACION",
      estatus: "LIBERADO",
      log: "Demo",
    },
    {
      id: "op-6",
      num: 6,
      ot: "WO-10561",
      parte: "MP-CD-330",
      descripcion: "Doblado tapa final",
      contenido: "PZA",
      prioridad: 50,
      fechaReq: "2026-07-04",
      cantTotal: 45,
      secuencia: 1,
      ct: "5527",
      operador: "DOBLADOR 1",
      maquina: "DOB-01",
      herramental: "H-19",
      kitHerramental: "KIT-B",
      cantPendiente: 45,
      tiempoCiclo: 4,
      tiempoSetup: 35,
      tiempoProd: 190,
      fechaInicio: "2026-07-02",
      horaInicio: "07:00",
      fechaFin: "2026-07-02",
      horaFin: "10:45",
      tipoInsercion: "OPERACION",
      estatus: "LIBERADO",
      log: "Demo",
    },
    {
      id: "op-7",
      num: 7,
      ot: "WO-10590",
      parte: "MP-CD-410",
      descripcion: "Subcontrato acabado",
      contenido: "LOTE",
      prioridad: 100,
      fechaReq: "2026-07-10",
      cantTotal: 20,
      secuencia: 2,
      ct: "6462",
      operador: "PINTURA 1",
      maquina: "EXT",
      herramental: "",
      kitHerramental: "",
      cantPendiente: 20,
      tiempoCiclo: 0,
      tiempoSetup: 0,
      tiempoProd: 480,
      fechaInicio: "2026-07-03",
      horaInicio: "08:00",
      fechaFin: "2026-07-03",
      horaFin: "16:00",
      tipoInsercion: "SUBCONTRATO",
      estatus: "LIBERADO",
      log: "Demo",
    },
  ],
};

let state = loadState();
let drag = null;
let appSheetAvailable = false;
let appSheetSaveTimer = null;
let appSheetSaveInFlight = false;
let appSheetSavePending = false;
let appSheetDirtyScopes = new Set();
let netSuiteSyncInFlight = false;
let netSuitePlanningSyncInFlight = false;
let planningActionsBusy = "";
let stateHistory = [];
let queuePointerDrag = null;
let backlogPointerDrag = null;
let suppressQueueClick = false;
let suppressBacklogClick = false;
let planningDialogResolve = null;
let resourceCategoryDrag = null;
let planSnapshots = [];
let reportSnapshot = null;
const els = {};

const GANTT_GROUPS_CACHE = new Map();
let GANTT_GROUPS_CACHE_VERSION = 0;

function invalidateGanttCache() {
  clearOperationDurationCache();
  GANTT_GROUPS_CACHE.clear();
  GANTT_GROUPS_CACHE_VERSION++;
}

function invalidateGanttGroupsCache() {
  GANTT_GROUPS_CACHE.clear();
  GANTT_GROUPS_CACHE_VERSION++;
}

window.addEventListener("beforeunload", () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
});

function initializePlanningApp() {
  bindElements();
  bindEvents();
  render();
  saveState("ui");
  loadAppStateInBackground();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializePlanningApp, { once: true });
else initializePlanningApp();

async function loadAppStateInBackground() {
  const loaded = await loadAppSheetIfAvailable(false);
  if (loaded) await new Promise((resolve) => requestAnimationFrame(resolve));
  state.selectedOperationId = "";
  saveState("ui");
  render();
  applyInitialWorkspaceView();
  if (isAppsScriptRuntime()) syncNetSuiteInBackground({ showMessage: state.workOrders.length === 0 });
  loadPlanSnapshots(false);
}

function bindElements() {
  [
    "metricPlanned",
    "metricOverload",
    "planWindow",
    "workspaceTitle",
    "kpiOps",
    "kpiSelected",
    "kpiHours",
    "kpiDue",
    "kpiChanges",
    "kpiAlerts",
    "draftExecutiveSummary",
    "draftExecutiveBody",
    "weeklyReleaseTargetInput",
    "generatePlanBtn",
    "publishPlanBtn",
    "pdfBtn",
    "restoreDraftBtn",
    "planAlerts",
    "scheduleBtn",
    "undoBtn",
    "planStartInput",
    "horizonSelect",
    "ganttZoomOut",
    "ganttZoomIn",
    "ganttZoomValue",
    "ganttFullscreenBtn",
    "gantt",
    "priorityCount",
    "syncBacklogOtsBtn",
    "searchInput",
    "statusFilter",
    "priorityList",
    "priorityQueue",
    "queueSearchInput",
    "selectedJobCount",
    "lockAllBtn",
    "unlockAllBtn",
    "selectedJobPanel",
    "closeDetailPanelBtn",
    "ganttCanvas",
    "loadList",
    "loadWeekInput",
    "loadWeekRange",
    "matrixWrap",
    "newOperatorInput",
    "addOperatorBtn",
    "newCtInput",
    "addCtBtn",
    "weekReport",
    "weekExecutiveSummary",
    "weekReportStartInput",
    "operatorReport",
    "operatorReportSelect",
    "operatorReportStatus",
    "operatorReportStartInput",
    "operatorReportFutureDays",
    "operatorReportCount",
    "printOperatorBtn",
    "adjusterReport",
    "adjusterReportStartInput",
    "adjusterReportStatus",
    "adjusterReportFutureDays",
    "adjusterReportCount",
    "printAdjusterBtn",
    "subcontractReport",
    "subcontractReportStartInput",
    "subcontractReportFutureDays",
    "subcontractReportStatus",
    "printSubcontractBtn",
    "subcontractPrintContext",
    "subcontractReportCount",
    "planSnapshotSelect",
    "refreshSnapshotsBtn",
    "reportSnapshotMeta",
    "weekPrintContext",
    "operatorPrintContext",
    "adjusterPrintContext",
    "syncBtn",
    "loadNsExerciseBtn",
    "saveBtn",
    "saveAppSheetBtn",
    "exportCsvBtn",
    "balanceBtn",
    "printWeekBtn",
    "toolPartInput",
    "toolHerrInput",
    "toolHerrNewInput",
    "toolKitInput",
    "toolKitNewInput",
    "toolSetupInput",
    "kitSetupInput",
    "addToolBtn",
    "toolCatalogTable",
    "machineNameInput",
    "addMachineBtn",
    "machineTable",
    "dailyBreaksTable",
    "calendarConceptInput",
    "calendarMachineField",
    "calendarMachineInput",
    "calendarStartDateInput",
    "calendarEndDateField",
    "calendarEndDateInput",
    "calendarStartInput",
    "calendarEndInput",
    "calendarReasonInput",
    "calendarFormHint",
    "addCalendarBtn",
    "calendarTable",
    "workScheduleTable",
    "subcontractPartInput",
    "subcontractNameInput",
    "subcontractDaysInput",
    "addSubcontractBtn",
    "subcontractTable",
    "otTypeNameInput",
    "addOtTypeBtn",
    "otTypeTable",
    "articleConfigPartInput",
    "articleConfigJobTypeInput",
    "articleConfigPlanningTypeInput",
    "articleConfigPriceInput",
    "saveArticleConfigBtn",
    "articleConfigTable",
    "planningDialog",
    "planningDialogForm",
    "planningDialogTitle",
    "planningDialogSummary",
    "planningDialogBody",
    "planningDialogClose",
    "planningDialogCancel",
    "planningDialogConfirm",
    "toast",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
  els.scheduleBtn = els.generatePlanBtn || els.scheduleBtn;
  els.loadNsExerciseBtn = els.syncBtn || els.loadNsExerciseBtn;
  els.saveAppSheetBtn = els.saveBtn || els.saveAppSheetBtn;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function printPlanHeader(title) {
  return `<header class="individual-print-header">
    <strong class="individual-print-logo">MALDONADO</strong>
    <h2>${escapeHtml(title)}</h2>
    <div class="individual-print-meta"><small class="individual-print-code">MP CD 28-02 V02</small><strong class="individual-print-date"></strong></div>
  </header>`;
}

function prepareIndividualPrint(target) {
  if (!target) return;
  if (!target.querySelector(".individual-print-header")) {
    const title = target.id === "weekTab" ? "PLAN DE PRODUCCIÓN SEMANAL" : "PLAN DE PRODUCCIÓN DIARIO INDIVIDUAL";
    target.insertAdjacentHTML("afterbegin", printPlanHeader(title));
  }
  document.querySelectorAll(".print-target").forEach((node) => node.classList.remove("print-target"));
  target.classList.add("print-target");
  const date = target.querySelector(".individual-print-date");
  if (date) date.textContent = formatDateTime(new Date());
  document.body.classList.add("printing-individual-plan");
  const cleanup = () => {
    target.classList.remove("print-target");
    document.body.classList.remove("printing-individual-plan");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup, { once: true });
  window.print();
}

function bindEvents() {
  document.querySelectorAll(".segmented button").forEach((button) => {
    button.onclick = () => setGanttView(button.dataset.view);
  });
  els.searchInput.addEventListener("input", debounce(renderPriorityList, 150));
  els.syncBacklogOtsBtn.addEventListener("click", syncBacklogWorkOrders);
  els.statusFilter.addEventListener("change", renderPriorityList);
  els.queueSearchInput.addEventListener("input", debounce(renderPriorityQueue, 150));
  els.generatePlanBtn.addEventListener("click", scheduleCurrentPlan);
  els.publishPlanBtn.addEventListener("click", publishCurrentPlan);
  els.restoreDraftBtn.addEventListener("click", openRestoreDraftDialog);
  els.pdfBtn.addEventListener("click", generatePlanPdf);
  els.undoBtn.addEventListener("click", undoLastChange);
  els.planStartInput.addEventListener("change", () => {
    checkpointState();
    state.planStart = els.planStartInput.value;
    const hasScheduledDraft = Boolean(scheduledPlanWindowStart());
    saveAndRender(hasScheduledDraft
      ? "Inicio guardado para la siguiente generacion; el Gantt conserva el borrador programado"
      : "Inicio del horizonte actualizado");
  });
  els.horizonSelect.addEventListener("change", () => {
    checkpointState();
    state.horizonDays = Math.max(1, Number(els.horizonSelect.value) || DEFAULT_HORIZON_DAYS);
    saveAndRender(`Horizonte de ${state.horizonDays} dias`);
  });
  els.ganttZoomOut.addEventListener("click", () => changeGanttZoom(-1));
  els.ganttZoomIn.addEventListener("click", () => changeGanttZoom(1));
  els.ganttFullscreenBtn.addEventListener("click", () => toggleGanttFullscreen());
  els.weeklyReleaseTargetInput.addEventListener("change", () => {
    checkpointState();
    const raw = String(els.weeklyReleaseTargetInput.value || "").replace(/[^0-9.eE\-]/g, "");
    state.settings.weeklyReleaseTarget = Math.max(0, Number(raw) || 0);
    els.weeklyReleaseTargetInput.value = state.settings.weeklyReleaseTarget.toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    saveAndRender("Objetivo semanal actualizado", "catalogs");
  });
  els.closeDetailPanelBtn.addEventListener("click", () => {
    state.selectedOperationId = "";
    saveState();
    render();
  });
  els.loadNsExerciseBtn.addEventListener("click", loadNetSuiteExercise);
  els.saveAppSheetBtn.addEventListener("click", () => saveAppSheet(true));
  els.exportCsvBtn.addEventListener("click", exportCsv);
  els.addOperatorBtn.addEventListener("click", addOperator);
  els.addCtBtn.addEventListener("click", addCt);
  els.loadWeekInput.addEventListener("change", () => {
    state.loadWeekStart = normalizeWeekStartValue(els.loadWeekInput.value);
    saveAndRender("Semana de cargas actualizada");
  });
  els.printWeekBtn.addEventListener("click", () => prepareIndividualPrint(els.weekReport.closest(".tab-panel")));
  els.weekReportStartInput.addEventListener("change", () => {
    state.reportWeekStart = normalizeWeekStartValue(els.weekReportStartInput.value);
    syncReportFilterDates(state.reportWeekStart);
    saveAndRender("Semana del reporte actualizada");
  });
  els.operatorReportStartInput.addEventListener("change", () => {
    updateReportFilter("operator", { date: els.operatorReportStartInput.value });
  });
  els.operatorReportFutureDays.addEventListener("change", () => updateReportFilter("operator", { futureDays: Number(els.operatorReportFutureDays.value) }));
  els.operatorReportStatus.addEventListener("change", () => updateReportFilter("operator", { status: els.operatorReportStatus.value }));
  els.adjusterReportStartInput.addEventListener("change", () => {
    updateReportFilter("adjuster", { date: els.adjusterReportStartInput.value });
  });
  els.adjusterReportFutureDays.addEventListener("change", () => updateReportFilter("adjuster", { futureDays: Number(els.adjusterReportFutureDays.value) }));
  els.adjusterReportStatus.addEventListener("change", () => updateReportFilter("adjuster", { status: els.adjusterReportStatus.value }));
  els.subcontractReportStartInput.addEventListener("change", () => {
    updateReportFilter("subcontract", { date: els.subcontractReportStartInput.value });
  });
  els.subcontractReportFutureDays.addEventListener("change", () => updateReportFilter("subcontract", { futureDays: Number(els.subcontractReportFutureDays.value) }));
  els.subcontractReportStatus.addEventListener("change", () => updateReportFilter("subcontract", { status: els.subcontractReportStatus.value }));
  els.printSubcontractBtn.addEventListener("click", () => { renderSubcontractReport(); prepareIndividualPrint(els.subcontractReport.closest(".tab-panel")); });
  els.operatorReportSelect.addEventListener("change", renderOperatorReport);
  els.planSnapshotSelect.addEventListener("change", () => loadSelectedPlanSnapshot(els.planSnapshotSelect.value));
  document.querySelectorAll("[data-report-source-select]").forEach((select) => {
    select.addEventListener("change", () => loadSelectedPlanSnapshot(select.value));
  });
  els.refreshSnapshotsBtn.addEventListener("click", () => loadPlanSnapshots(true));
  els.printOperatorBtn.addEventListener("click", () => {
    renderOperatorReport();
    prepareIndividualPrint(els.operatorReport.closest(".tab-panel"));
  });
  els.printAdjusterBtn.addEventListener("click", () => {
    renderAdjusterReport();
    prepareIndividualPrint(els.adjusterReport.closest(".tab-panel"));
  });
  els.addToolBtn.addEventListener("click", addToolCatalogItem);
  els.toolHerrInput.addEventListener("change", () => updateCatalogCustomInput(els.toolHerrInput, els.toolHerrNewInput));
  els.toolKitInput.addEventListener("change", () => updateCatalogCustomInput(els.toolKitInput, els.toolKitNewInput));
  els.addMachineBtn.addEventListener("click", addMachine);
  els.addCalendarBtn.addEventListener("click", addCalendarException);
  els.calendarConceptInput.addEventListener("change", () => updateCalendarForm(true));
  els.calendarStartDateInput.addEventListener("change", () => {
    els.calendarEndDateInput.min = els.calendarStartDateInput.value;
    if (!els.calendarEndDateField.hidden && (!els.calendarEndDateInput.value || els.calendarEndDateInput.value < els.calendarStartDateInput.value)) {
      els.calendarEndDateInput.value = els.calendarStartDateInput.value;
    }
  });
  els.addSubcontractBtn.addEventListener("click", addSubcontract);
  els.addOtTypeBtn.addEventListener("click", addOtType);
  els.articleConfigPartInput.addEventListener("change", updateArticleConfigForm);
  els.saveArticleConfigBtn.addEventListener("click", saveArticleConfiguration);
  els.lockAllBtn.addEventListener("click", () => toggleAllJobs(true));
  els.unlockAllBtn.addEventListener("click", () => toggleAllJobs(false));
  els.planningDialogClose.addEventListener("click", () => closePlanningDialog(null));
  els.planningDialogCancel.addEventListener("click", () => closePlanningDialog(null));
  els.planningDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closePlanningDialog(null);
  });
  els.planningDialogForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!els.planningDialogForm.reportValidity()) return;
    closePlanningDialog(Object.fromEntries(new FormData(els.planningDialogForm).entries()));
  });

  document.addEventListener("mousemove", (event) => updateQueueDrag(event.clientX, event.clientY));
  document.addEventListener("mouseup", () => finishQueueDrag(true));
  document.addEventListener("mousemove", (event) => updateBacklogDrag(event.clientX, event.clientY));
  document.addEventListener("mouseup", () => finishBacklogDrag(true));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && els.gantt.classList.contains("gantt-fullscreen")) toggleGanttFullscreen(false);
  });

  document.querySelectorAll(".tabs button").forEach((button) => {
    button.addEventListener("click", () => showTab(button.dataset.tab));
  });

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", (event) => {
      event.preventDefault();
      const targetHash = item.getAttribute("href") || "#plan-semanal";
      if (window.location.hash === targetHash) applyInitialWorkspaceView();
      else window.location.hash = targetHash;
    });
  });
  window.addEventListener("hashchange", applyInitialWorkspaceView);
}

function applyInitialWorkspaceView() {
  const hash = window.location.hash || "#plan-semanal";
  const items = [...document.querySelectorAll(".nav-item")];
  const item = items.find((candidate) => candidate.getAttribute("href") === hash) || items.find((candidate) => candidate.getAttribute("href") === "#plan-semanal");
  if (!item) return;
  showWorkspaceView(item.dataset.section, item.dataset.tab || "");
}

function showWorkspaceView(section, tab = "") {
  const workspace = document.querySelector(".workspace");
  if (!workspace) return;
  const view = section === "cargas" ? "loads" : (section === "reportes" ? "reports" : (section === "plan-semanal" ? "plan" : "config"));
  workspace.dataset.view = view;
  workspace.dataset.section = section;
  document.querySelectorAll(".nav-item").forEach((item) => {
    const active = item.dataset.section === section;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  if (els.workspaceTitle) els.workspaceTitle.textContent = WORKSPACE_TITLES[section] || "Planeacion de Produccion";
  if (tab) showTab(tab);
  if (view === "loads") renderLoads();
  if (view === "reports") renderReports();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return deepClone(sampleState);
    return { ...deepClone(sampleState), ...JSON.parse(raw) };
  } catch {
    return deepClone(sampleState);
  }
}

function normalizeState() {
  state.schemaVersion = APP_SCHEMA_VERSION;
  state.revision = Number(state.revision || 0);
  state.ganttView = window.PlanningWorkflowCore.normalizeGanttView(state.ganttView);
  state.ganttDayWidth = nearestGanttDayWidth(state.ganttDayWidth);
  state.planStart = state.planStart || formatDate(weekStart(new Date()));
  state.horizonDays = Math.max(1, Math.min(45, Number(state.horizonDays || DEFAULT_HORIZON_DAYS)));
  state.loadWeekStart = normalizeWeekStartValue(state.loadWeekStart || state.planStart);
  state.reportWeekStart = normalizeWeekStartValue(state.reportWeekStart || state.planStart);
  state.draftVersionId = String(state.draftVersionId || "");
  state.activePublishedVersionId = String(state.activePublishedVersionId || "");
  state.publishedVersions = Array.isArray(state.publishedVersions) ? state.publishedVersions : [];
  state.preparedPlanningByOt = state.preparedPlanningByOt && typeof state.preparedPlanningByOt === "object" ? state.preparedPlanningByOt : {};
  state.reportFilters = normalizeReportFilters(state.reportFilters, state.reportWeekStart);
  state.workSchedule = { ...deepClone(DEFAULT_WORK_SCHEDULE), ...(state.workSchedule || {}) };
  state.dailyBreaks = Object.keys(DEFAULT_DAILY_BREAKS).reduce((out, key) => {
    const source = state.dailyBreaks?.[key] || {};
    out[key] = {
      enabled: source.enabled === true,
      start: String(source.start || DEFAULT_DAILY_BREAKS[key].start),
      end: String(source.end || DEFAULT_DAILY_BREAKS[key].end),
    };
    return out;
  }, {});
  state.settings = {
    defaultSubcontractDays: 3,
    toolChangeCt: "122",
    toolChangeMinutes: 120,
    toolChangeOperator: "AJUSTADOR",
    weeklyReleaseTarget: DEFAULT_WEEKLY_RELEASE_TARGET,
    ...(state.settings && typeof state.settings === "object" ? state.settings : {}),
  };
  state.settings.weeklyReleaseTarget = Math.max(0, Number(state.settings.weeklyReleaseTarget) || DEFAULT_WEEKLY_RELEASE_TARGET);
  state.customCapabilities = Array.isArray(state.customCapabilities) ? state.customCapabilities : [];
  const hadConfiguredCapabilities = Array.isArray(state.configuredCapabilities);
  state.configuredCapabilities = hadConfiguredCapabilities ? state.configuredCapabilities : [];
  state.operationCatalog = Array.isArray(state.operationCatalog) ? state.operationCatalog : [];
  state.hiddenCapabilities = Array.isArray(state.hiddenCapabilities) ? state.hiddenCapabilities : [];
  state.operationRules = state.operationRules && typeof state.operationRules === "object" ? state.operationRules : {};
  state.machines = (Array.isArray(state.machines) ? state.machines : [])
    .map((machine) => ({ id: String(machine.id || machine.machine || machine.maquina || "").trim().toUpperCase(), active: machine.active !== false }))
    .filter((machine) => machine.id);
  state.toolCatalog = (Array.isArray(state.toolCatalog) ? state.toolCatalog : []).map((item, index) => ({
    id: String(item.id || `tool-${index + 1}`),
    part: String(item.part || item.parte || "").trim(),
    herramental: cleanToolValue(item.herramental),
    kitHerramental: cleanToolValue(item.kitHerramental),
    toolSetupMinutes: Math.max(0, Number(item.toolSetupMinutes) || 0),
    kitSetupMinutes: Math.max(0, Number(item.kitSetupMinutes) || 0),
    active: item.active !== false,
  })).filter((item) => item.part && item.herramental);
  state.machineToolHistory = (Array.isArray(state.machineToolHistory) ? state.machineToolHistory : [])
    .map((item, index) => ({
      id: String(item.id || item.operationId || `tool-history-${index + 1}`),
      operationId: String(item.operationId || item.id || ""),
      snapshotId: String(item.snapshotId || ""),
      ot: String(item.ot || ""),
      machine: String(item.machine || item.maquina || "").trim().toUpperCase(),
      herramental: cleanToolValue(item.herramental),
      kitHerramental: cleanToolValue(item.kitHerramental || item.kit),
      endDate: normalizeOtDate(item.endDate || item.fechaFin),
      endTime: String(item.endTime || item.horaFin || "").trim(),
    }))
    .filter((item) => item.machine && item.herramental && item.endDate && item.endTime)
    .slice(-2000);
  state.workOrders = normalizeWorkOrders(state.workOrders);
  state.otConfigurations = state.otConfigurations && typeof state.otConfigurations === "object" ? state.otConfigurations : {};
  state.articleConfigurations = normalizeArticleConfigurations(state.articleConfigurations);
  migrateLegacyCommercialOtConfigurations();
  state.materials = normalizeMaterials(state.materials);
  state.calendarExceptions = (Array.isArray(state.calendarExceptions) ? state.calendarExceptions : []).map((item, index) => {
    const rawConcept = normalizeStatus(item.concept || item.concepto || item.resourceType || item.tipoRecurso || "GENERAL");
    const concept = ["GENERAL", "MAQUINA", "ASUETO", "VACACIONES"].includes(rawConcept) ? rawConcept : "GENERAL";
    const startDate = normalizeOtDate(item.startDate || item.fechaInicio || item.date || item.fecha);
    const endDate = normalizeOtDate(item.endDate || item.fechaFin || item.date || item.fecha || startDate);
    return {
      id: String(item.id || `cal-${index + 1}`),
      concept,
      machine: concept === "MAQUINA" ? String(item.machine || item.maquina || item.resource || item.recurso || "").trim().toUpperCase() : "",
      startDate,
      endDate: endDate || startDate,
      start: String(item.start || item.horaInicio || "00:00"),
      end: String(item.end || item.horaFin || "24:00"),
      reason: String(item.reason || item.motivo || "").trim(),
      active: item.active !== false,
    };
  }).filter((item) => item.startDate && item.endDate);
  state.subcontracts = (Array.isArray(state.subcontracts) ? state.subcontracts : []).map((item, index) => ({
    id: String(item.id || `sub-${index + 1}`),
    part: String(item.part || item.parte || "*").trim().toUpperCase() || "*",
    name: String(item.name || item.tipo || "").trim().toUpperCase(),
    days: Math.max(1, Math.round(Number(item.days || item.dias) || 3)),
    active: item.active !== false,
  })).filter((item) => item.name);
  state.otTypes = (Array.isArray(state.otTypes) && state.otTypes.length ? state.otTypes : DEFAULT_OT_TYPES)
    .map((item, index) => ({
      id: String(item.id || `tipo-${index + 1}`),
      name: String(item.name || item.nombre || item.tipo || "").trim().toUpperCase(),
      active: item.active !== false,
    }))
    .filter((item) => item.name);
  state.operationPlanStatuses = normalizeOperationPlanStatuses(state.operationPlanStatuses);
  state.netSuiteChangeAlerts = normalizeNetSuiteChangeAlerts(state.netSuiteChangeAlerts);
  state.netSuiteSyncAlert = normalizeNetSuiteSyncAlert(state.netSuiteSyncAlert);
  state.capacityModes = state.capacityModes && typeof state.capacityModes === "object" ? state.capacityModes : {};
  state.matrix = state.matrix && typeof state.matrix === "object" ? state.matrix : {};
  state.operators = Array.isArray(state.operators) ? state.operators : [];
  state.operatorProfiles = state.operatorProfiles && typeof state.operatorProfiles === "object" ? state.operatorProfiles : {};
  state.operatorPerformance = normalizeOperatorPerformance(state.operatorPerformance, state.operators);
  state.cts = Array.isArray(state.cts) ? state.cts : [];
  ensureToolChangeCapability();
  state.operations = (Array.isArray(state.operations) ? state.operations : []).map((op, index) => normalizeOperation(op, index));
  for (const op of state.operations) {
    const status = state.operationPlanStatuses[operationCompletionKey(op)];
    op.planStatus = status?.status === "COMPLETADA_PLAN" ? "COMPLETADA_PLAN" : "PENDIENTE";
  }
  applyWorkOrderDueDates();
  const operationCapabilities = state.operations
    .filter((op) => op.tipoInsercion !== "CAMBIO_HERRAMENTAL")
    .map(capabilityFromOperation);
  const catalogByKey = new Map();
  for (const item of state.operationCatalog) {
    const ct = String(item.ct || "").trim();
    const label = String(item.label || item.operation || "").trim();
    const key = String(item.key || capabilityKey(ct, label)).trim();
    if (key && ct && label) catalogByKey.set(key, { key, ct, label, source: item.source || "NETSUITE", active: item.active !== false });
  }
  for (const capability of operationCapabilities) {
    if (!catalogByKey.has(capability.key)) catalogByKey.set(capability.key, { ...capability, source: "NETSUITE", active: true });
  }
  state.operationCatalog = [...catalogByKey.values()]
    .sort((a, b) => a.ct.localeCompare(b.ct, "es", { numeric: true }) || a.label.localeCompare(b.label, "es"));
  normalizeOtResourceAssignments();
  state.configuredCapabilities = uniq((hadConfiguredCapabilities
    ? state.configuredCapabilities
    : [...operationCapabilities.map((capability) => capability.key), TOOL_CHANGE_CAPABILITY.key])
    .map(String)
    .filter(Boolean));
  const operationOts = state.operations.filter((op) => op.tipoInsercion !== "CAMBIO_HERRAMENTAL").map((op) => op.ot);
  const workOrderOts = state.workOrders.map((workOrder) => workOrder.ot);
  const jobOts = uniq([...operationOts, ...workOrderOts].filter(Boolean));
  const visibleOts = new Set(jobOts.filter((ot) => !isClosedJobStatus(jobStatusForOt(ot))));
  const movableOts = new Set(jobOts.filter((ot) => isMovablePlanningStatus(jobStatusForOt(ot))));
  const configuredSelectedOts = Array.isArray(state.selectedOts)
    ? state.selectedOts.filter((ot) => visibleOts.has(ot) && movableOts.has(ot))
    : [];
  state.selectedOts = uniq(configuredSelectedOts);
  if (state.lastSchedule && typeof state.lastSchedule === "object") {
    const scheduledOts = Array.isArray(state.lastSchedule.scheduledOts) ? state.lastSchedule.scheduledOts : [];
    state.lastSchedule = {
      ...state.lastSchedule,
      scheduledOts: uniq(scheduledOts).filter((ot) => visibleOts.has(ot)),
    };
  }
  const derivedLockedOts = uniq(state.operations.filter((op) => op.locked === true).map((op) => op.ot));
  const configuredLockedOts = Array.isArray(state.lockedOts) && state.lockedOts.length ? state.lockedOts : derivedLockedOts;
  state.lockedOts = uniq(configuredLockedOts)
    .filter((ot) => state.selectedOts.includes(ot));
  const selectedOperationOt = state.operations.find((op) => op.id === state.selectedOperationId)?.ot;
  if (selectedOperationOt && !visibleOts.has(selectedOperationOt)) {
    state.selectedOperationId = state.operations.find((op) => state.selectedOts.includes(op.ot) || visibleOts.has(op.ot))?.id || "";
  }
  const activeSelectedOperationOt = state.operations.find((op) => op.id === state.selectedOperationId)?.ot;
  state.expandedOts = Array.isArray(state.expandedOts)
    ? state.expandedOts.filter((ot) => jobOts.includes(ot))
    : (activeSelectedOperationOt ? [activeSelectedOperationOt] : []);
  state.expandedCts = Array.isArray(state.expandedCts) ? state.expandedCts : [];
  for (const op of state.operations) op.locked = state.lockedOts.includes(op.ot);
  const priorityByOt = new Map();
  for (const op of state.operations) {
    const current = priorityByOt.get(op.ot);
    priorityByOt.set(op.ot, current == null ? op.prioridad : Math.min(current, op.prioridad));
  }
  for (const op of state.operations) op.prioridad = priorityByOt.get(op.ot) || 999;
  const selectedOrderIndex = new Map(state.selectedOts.map((ot, index) => [ot, index]));
  state.selectedOts.sort((a, b) =>
    (priorityByOt.get(a) || 999) - (priorityByOt.get(b) || 999) ||
    (selectedOrderIndex.get(a) || 0) - (selectedOrderIndex.get(b) || 0)
  );
  let movablePriority = 1;
  state.selectedOts.forEach((ot) => {
    state.operations.filter((op) => op.ot === ot).forEach((op) => { op.prioridad = movablePriority; });
    movablePriority += 1;
  });
  state.operators = uniq(state.operators)
    .filter(isLoadBearingOperator);
  state.operatorProfiles = normalizeOperatorProfiles(state.operatorProfiles, state.operators);
  const toolChangeResource = state.operators.find((operator) => normalizeStatus(operator) === normalizeStatus(state.settings.toolChangeOperator));
  if (toolChangeResource) state.operatorProfiles[toolChangeResource].category = "FUERA_DE_PLAN";
  state.cts = uniq([...state.cts, ...state.operations.map((op) => op.ct).filter(Boolean)]);
  for (const ct of state.cts) {
    if (!state.matrix[ct]) state.matrix[ct] = [];
    if (!CAPACITY_MODES.includes(state.capacityModes[ct])) state.capacityModes[ct] = "FINITA";
  }
  for (const capability of getCapabilityRows()) {
    const existingRule = state.operationRules[capability.key] || state.operationRules[capability.ct] || {};
    state.operationRules[capability.key] = {
      ...existingRule,
      efficiency: Math.max(1, Math.min(100, Number(existingRule.efficiency ?? existingRule.eficiencia) || 100)),
      requiresTool: isBendingCapability(capability),
      requiresKit: isBendingCapability(capability),
    };
    if (!CAPACITY_MODES.includes(state.capacityModes[capability.key]) && !CAPACITY_MODES.includes(state.capacityModes[capability.ct])) {
      state.capacityModes[capability.key] = "FINITA";
    }
  }
  invalidateGanttCache();
}

function ensureToolChangeCapability() {
  const hidden = new Set(state.hiddenCapabilities || []);
  const key = TOOL_CHANGE_CAPABILITY.key;
  const legacyCt = String(state.settings?.toolChangeCt || "122").trim();
  const legacyOperators = Array.isArray(state.matrix?.[legacyCt]) ? state.matrix[legacyCt] : [];

  if (!state.customCapabilities.some((capability) => capability.key === key)) {
    state.customCapabilities.push({ ...TOOL_CHANGE_CAPABILITY });
  }
  if (!state.cts.includes(TOOL_CHANGE_CAPABILITY.ct)) state.cts.push(TOOL_CHANGE_CAPABILITY.ct);
  if (hidden.has(key)) return;
  if (!state.configuredCapabilities.includes(key)) state.configuredCapabilities.push(key);
  if (!Array.isArray(state.matrix[key])) state.matrix[key] = uniq(legacyOperators);
  if (!CAPACITY_MODES.includes(state.capacityModes[key])) state.capacityModes[key] = "FINITA";
}

function normalizeOperation(op, index) {
  const next = { ...op };
  next.id = next.id || `op-${Date.now()}-${index}`;
  next.num = Number(next.num || index + 1);
  next.ot = String(next.ot || "").trim() || `OT-${index + 1}`;
  next.prioridad = normalizePriority(next.prioridad);
  next.secuencia = Number(next.secuencia || 1);
  next.ct = String(next.ct || "").trim() || "SIN_CT";
  next.operador = String(next.operador || "").trim() || "SIN_OPERADOR";
  next.maquina = String(next.maquina || "").trim();
  next.herramental = cleanToolValue(next.herramental);
  next.kitHerramental = cleanToolValue(next.kitHerramental);
  const toolFields = normalizeToolFields(next.maquina, next.herramental, next.kitHerramental);
  next.maquina = toolFields.maquina;
  next.herramental = toolFields.herramental;
  next.kitHerramental = toolFields.kitHerramental;
  next.tipoInsercion = String(next.tipoInsercion || "OPERACION").trim().toUpperCase();
  if (!isBendingAppOperation(next) && next.tipoInsercion !== "CAMBIO_HERRAMENTAL") next.maquina = "";
  if (isBendingAppOperation(next) && normalizeStatus(next.maquina) === "SIN_MAQUINA") next.maquina = "";
  if (String(next.ct) === "5459" && next.maquina === "1") next.maquina = "";
  next.estatus = String(next.estatus || "PLAN").trim();
  next.locked = next.locked === true || String(next.locked || "").trim().toUpperCase() === "TRUE";
  next.tiempoSetup = Number(next.tiempoSetup || 0);
  next.tiempoProd = Number(next.tiempoProd || 0);
  next.subcontractType = String(next.subcontractType || "").trim().toUpperCase();
  next.subcontractDays = Number(next.subcontractDays || 0);
  if (isSubcontractAppOperation(next)) {
    next.operador = "SUBCONTRATO";
    next.maquina = "";
  }
  next.toolChangeFromHerramental = cleanToolValue(next.toolChangeFromHerramental);
  next.toolChangeFromKit = cleanToolValue(next.toolChangeFromKit);
  next.toolChangeToHerramental = cleanToolValue(next.toolChangeToHerramental);
  next.toolChangeToKit = cleanToolValue(next.toolChangeToKit);
  next.comentario = String(next.comentario || next.comment || "").trim();
  next.kitPending = next.kitPending === true || String(next.kitPending || "").trim().toUpperCase() === "TRUE";
  next.autoFrozen = next.autoFrozen === true || String(next.autoFrozen || "").trim().toUpperCase() === "TRUE";
  next.planStatus = normalizeStatus(next.planStatus) === "COMPLETADA_PLAN" ? "COMPLETADA_PLAN" : "PENDIENTE";
  next.needsReschedule = next.needsReschedule === true || String(next.needsReschedule || "").trim().toUpperCase() === "TRUE";
  if ((!next.fechaInicio || !next.horaInicio) && !next.needsReschedule) {
    const base = addMinutes(weekStart(new Date()), index * 180 + 7 * 60);
    setOperationStart(next, base);
  }
  if ((!next.fechaFin || !next.horaFin) && !next.needsReschedule) {
    const start = opStart(next) || new Date();
    setOperationEnd(next, addMinutes(start, operationDuration(next)));
  }
  return next;
}

function normalizeMaterials(materials) {
  const seen = new Set();
  return (Array.isArray(materials) ? materials : []).map((item, index) => {
    const ot = String(materialValue(item, ["ot", "woFolio", "WO Folio", "Orden de trabajo", "OT"]) || "").trim();
    const workOrderId = String(materialValue(item, ["workOrderId", "woInternalId", "WO Internal ID"]) || "").trim();
    const componentId = String(materialValue(item, ["componentId", "Componente ID"]) || "").trim();
    const component = String(materialValue(item, ["component", "Componente"]) || componentId).trim();
    return {
      id: String(item.id || `mat-${workOrderId || ot}-${componentId || component || index + 1}`).trim(),
      ot,
      workOrderId,
      assembly: String(materialValue(item, ["assembly", "Ensamble"]) || "").trim(),
      componentId,
      component,
      description: String(materialValue(item, ["description", "Descripcion", "Descripción"]) || "").trim(),
      unit: String(materialValue(item, ["unit", "Unidad"]) || "").trim(),
      required: Number(materialValue(item, ["required", "Requerido"]) || 0),
      issued: Number(materialValue(item, ["issued", "Emitido"]) || 0),
      pending: Number(materialValue(item, ["pending", "Pendiente"]) || 0),
    };
  }).filter((item) => {
    if (!item.ot || !item.component) return false;
    const key = `${materialOtKey(item.ot)}|${item.componentId || item.component}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeWorkOrders(workOrders) {
  const seen = new Set();
  return (Array.isArray(workOrders) ? workOrders : []).map((item, index) => ({
    id: String(item.id || `wo-${item.workOrderId || item.ot || index + 1}`).trim(),
    workOrderId: String(item.workOrderId || item.woInternalId || "").trim(),
    ot: String(item.ot || item.woFolio || "").trim(),
    item: String(item.item || item.article || item.parte || "").trim(),
    description: String(item.description || item.descripcion || "").trim(),
    photoUrl: safePhotoUrl(item.photoUrl || item.imageUrl || item.fotoUrl),
    startDate: normalizeOtDate(item.startDate || item.fechaInicio),
    endDate: normalizeOtDate(item.endDate || item.fechaFin),
    dueDate: normalizeOtDate(item.dueDate || item.fechaVencimiento),
    dueDateOverride: normalizeOtDate(item.dueDateOverride || item.fechaEntregaAjustada),
    quantity: Number(item.quantity || item.cantidad || 0),
    builtQuantity: Math.max(0, Number(item.builtQuantity ?? item.quantityBuilt ?? item.cantidadEnsamblada ?? 0)),
    pendingQuantity: Math.max(0, Number(item.pendingQuantity ?? item.cantidadPendiente ?? Math.max(0, Number(item.quantity || item.cantidad || 0) - Number(item.builtQuantity ?? item.quantityBuilt ?? item.cantidadEnsamblada ?? 0)))),
    averageSalePrice: Math.max(0, Number(item.averageSalePrice ?? item.precioPromedioVenta ?? 0)),
    averageSalePriceFrom: normalizeOtDate(item.averageSalePriceFrom || item.precioDesde),
    averageSalePriceTo: normalizeOtDate(item.averageSalePriceTo || item.precioHasta),
    status: String(item.status || item.estatus || "").trim(),
    customer: String(item.customer || item.cliente || "").trim(),
  })).filter((item) => {
    const key = materialOtKey(item.ot);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeOperationPlanStatuses(source) {
  const rows = Array.isArray(source) ? source : Object.values(source && typeof source === "object" ? source : {});
  return rows.reduce((out, item) => {
    const key = String(item?.key || item?.completionKey || "").trim();
    if (!key) return out;
    out[key] = {
      ...item,
      key,
      type: normalizeStatus(item.type || item.tipo) === "TOOL_CHANGE" ? "TOOL_CHANGE" : "OPERATION",
      status: normalizeStatus(item.status || item.planStatus) === "COMPLETADA_PLAN" ? "COMPLETADA_PLAN" : "PENDIENTE",
      ot: String(item.ot || "").trim(),
      sequence: Number(item.sequence ?? item.secuencia ?? 0),
      ct: String(item.ct || "").trim(),
      operationId: String(item.operationId || item.idOperacion || "").trim(),
      completedAt: String(item.completedAt || item.fechaCompletado || "").trim(),
    };
    return out;
  }, {});
}

function normalizeNetSuiteChangeAlerts(source) {
  return (Array.isArray(source) ? source : []).map((item, index) => {
    const ot = String(item?.ot || "").trim();
    return {
      id: String(item?.id || `netsuite-change-${ot || index + 1}`),
      ot,
      type: normalizeStatus(item?.type || item?.tipo || "CAMBIO_NETSUITE") || "CAMBIO_NETSUITE",
      severity: normalizeStatus(item?.severity || item?.severidad || "MEDIA") || "MEDIA",
      summary: String(item?.summary || item?.resumen || "OT modificada en NetSuite").trim(),
      changes: item?.changes && typeof item.changes === "object" ? item.changes : {},
      impact: item?.impact && typeof item.impact === "object" ? item.impact : {},
      detectedAt: String(item?.detectedAt || item?.fechaDeteccion || "").trim(),
    };
  }).filter((item) => item.ot);
}

function netSuiteNumberOrZero(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function netSuiteOperationSignature(op) {
  return [
    Number(op?.secuencia ?? op?.sec ?? op?.sequence ?? 0),
    normalizeStatus(op?.ct),
    normalizeStatus(op?.descripcion || op?.operation || op?.operacion || op?.tipoInsercion),
  ].join("|");
}

function netSuiteOperationTimeSignature(op) {
  return [
    netSuiteNumberOrZero(op?.tiempoCiclo ?? op?.cycleTime),
    netSuiteNumberOrZero(op?.tiempoSetup ?? op?.setupTime),
    netSuiteNumberOrZero(op?.tiempoProd ?? op?.productionTime),
  ].join("|");
}

function netSuiteIsProductionOperation(op) {
  return normalizeStatus(op?.tipoInsercion) !== "CAMBIO_HERRAMENTAL";
}

function netSuiteGroupOperationsByOt(operations = []) {
  return operations.filter(netSuiteIsProductionOperation).reduce((groups, op) => {
    const key = materialOtKey(op.ot);
    if (!key) return groups;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(op);
    return groups;
  }, new Map());
}

function netSuiteCompletedOtsFromState(source = {}) {
  return new Set(Object.values(source.operationPlanStatuses || {})
    .filter((item) => normalizeStatus(item?.status || item?.planStatus) === "COMPLETADA_PLAN")
    .map((item) => materialOtKey(item.ot))
    .filter(Boolean));
}

function netSuiteTrackedOtsFromState(source = {}) {
  return new Set([
    ...(source.selectedOts || []),
    ...(source.lockedOts || []),
    ...netSuiteCompletedOtsFromState(source),
  ].map(materialOtKey).filter(Boolean));
}

function netSuiteWorkOrderQuantity(source, ot, operations) {
  const workOrder = (source.workOrders || []).find((item) => materialOtKey(item.ot) === ot);
  const candidates = [
    workOrder?.pendingQuantity,
    workOrder?.cantidadPendiente,
    workOrder?.quantity,
    workOrder?.cantidad,
    operations.find((op) => netSuiteNumberOrZero(op?.cantPendiente) > 0)?.cantPendiente,
    operations.find((op) => netSuiteNumberOrZero(op?.cantTotal) > 0)?.cantTotal,
  ];
  const value = candidates.find((item) => Number.isFinite(Number(item)) && Number(item) >= 0);
  return value == null ? null : Number(value);
}

function netSuiteOperationSummary(op) {
  return {
    signature: netSuiteOperationSignature(op),
    sequence: Number(op?.secuencia ?? op?.sec ?? op?.sequence ?? 0),
    ct: String(op?.ct || "").trim(),
    description: String(op?.descripcion || op?.operation || op?.operacion || "").trim(),
    time: {
      cycle: netSuiteNumberOrZero(op?.tiempoCiclo ?? op?.cycleTime),
      setup: netSuiteNumberOrZero(op?.tiempoSetup ?? op?.setupTime),
      production: netSuiteNumberOrZero(op?.tiempoProd ?? op?.productionTime),
    },
  };
}

function netSuiteCompareOperations(previousOps, currentOps) {
  const previousBySignature = new Map(previousOps.map((op) => [netSuiteOperationSignature(op), op]));
  const currentBySignature = new Map(currentOps.map((op) => [netSuiteOperationSignature(op), op]));
  const added = [];
  const removed = [];
  const timeChanged = [];
  for (const [signature, op] of currentBySignature) {
    if (!previousBySignature.has(signature)) added.push(netSuiteOperationSummary(op));
  }
  for (const [signature, op] of previousBySignature) {
    if (!currentBySignature.has(signature)) removed.push(netSuiteOperationSummary(op));
  }
  for (const [signature, previous] of previousBySignature) {
    const current = currentBySignature.get(signature);
    if (current && netSuiteOperationTimeSignature(previous) !== netSuiteOperationTimeSignature(current)) {
      timeChanged.push({
        signature,
        previous: netSuiteOperationSummary(previous).time,
        current: netSuiteOperationSummary(current).time,
      });
    }
  }
  return { added, removed, timeChanged };
}

function netSuiteOperationChangesEmpty(changes) {
  return !changes.added.length && !changes.removed.length && !changes.timeChanged.length;
}

function detectNetSuiteOtChanges(previousState = {}, incomingState = {}, options = {}) {
  const tracked = netSuiteTrackedOtsFromState(previousState);
  const previousByOt = netSuiteGroupOperationsByOt(previousState.operations || []);
  const incomingByOt = netSuiteGroupOperationsByOt(incomingState.operations || []);
  const completed = netSuiteCompletedOtsFromState(previousState);
  const alerts = [];
  const ots = new Set([...previousByOt.keys(), ...incomingByOt.keys()]);

  for (const ot of [...ots].sort((a, b) => a.localeCompare(b, "es", { numeric: true }))) {
    if (!tracked.has(ot)) continue;
    const previousOps = previousByOt.get(ot) || [];
    const currentOps = incomingByOt.get(ot) || [];
    const quantityPrevious = netSuiteWorkOrderQuantity(previousState, ot, previousOps);
    const quantityCurrent = netSuiteWorkOrderQuantity(incomingState, ot, currentOps);
    const operations = netSuiteCompareOperations(previousOps, currentOps);
    const changes = {};
    if (quantityPrevious != null && quantityCurrent != null && quantityPrevious !== quantityCurrent) {
      changes.quantity = { previous: quantityPrevious, current: quantityCurrent };
    }
    if (!netSuiteOperationChangesEmpty(operations)) changes.operations = operations;
    if (!Object.keys(changes).length) continue;

    const hasOperations = Boolean(changes.operations);
    alerts.push({
      id: `netsuite-change-${ot}`,
      ot,
      type: hasOperations ? "OPERACIONES_CAMBIADAS" : "CANTIDAD_CAMBIADA",
      severity: completed.has(ot) || hasOperations ? "ALTA" : "MEDIA",
      summary: hasOperations
        ? `OT ${ot}: NetSuite cambio operaciones o tiempos`
        : `OT ${ot}: NetSuite cambio cantidad de ${changes.quantity.previous} a ${changes.quantity.current}`,
      changes,
      impact: {
        selected: (previousState.selectedOts || []).map(materialOtKey).includes(ot),
        locked: (previousState.lockedOts || []).map(materialOtKey).includes(ot),
        completed: completed.has(ot),
      },
      detectedAt: options.detectedAt || new Date().toISOString(),
    });
  }

  return alerts;
}

function operationCompletionKey(op) {
  if (window.PlannerCore?.operationCompletionKey) return window.PlannerCore.operationCompletionKey(op);
  if (op?.completionKey) return String(op.completionKey);
  if (normalizeStatus(op?.tipoInsercion) === "CAMBIO_HERRAMENTAL") {
    return `TOOL_CHANGE|${normalizeStatus(op?.id || `${op?.ot}-${op?.secuencia}`)}|${normalizeStatus(op?.maquina)}|${normalizeStatus(op?.herramental)}|${normalizeStatus(op?.kitHerramental)}`;
  }
  return op?.id ? `OP|${normalizeStatus(op.id)}` : `OP|${normalizeStatus(op?.ot)}|${Number(op?.secuencia || 0)}|${normalizeStatus(op?.ct)}`;
}

function isPlanCompletedOperation(op) {
  if (!op) return false;
  if (normalizeStatus(op.planStatus) === "COMPLETADA_PLAN") return true;
  return state.operationPlanStatuses?.[operationCompletionKey(op)]?.status === "COMPLETADA_PLAN";
}

function normalizeOtDate(value) {
  const parsed = parseDate(value);
  if (!parsed) return "";
  return `${parsed.year}-${String(parsed.month).padStart(2, "0")}-${String(parsed.day).padStart(2, "0")}`;
}

function safePhotoUrl(value) {
  const text = String(value || "").trim();
  return /^(https:\/\/|data:image\/)/i.test(text) ? text : "";
}

function materialValue(item, names) {
  for (const name of names) {
    if (item && item[name] != null && item[name] !== "") return item[name];
  }
  return "";
}

function render(options = {}) {
  const parts = options.parts || {};
  const all = parts === true || typeof parts !== "object" || !Object.keys(parts).length;
  if (all || parts.normalize) normalizeState();
  if (all || parts.top) renderTop();
  if (all || parts.alerts) renderPlanAlerts();
  if (all || parts.summary) renderDraftExecutiveSummary();
  if (all || parts.priorityList) renderPriorityList();
  if (all || parts.queue) renderPriorityQueue();
  if (all || parts.gantt) renderGantt();
  if (all || parts.loads) renderLoads();
  if (all || parts.matrix) renderMatrix();
  if (all || parts.catalogs) renderConfiguration();
  if (all || parts.reports) renderReports();
  saveState(options.saveScope || "plan");
}

function renderDraftExecutiveSummary() {
  if (!els.draftExecutiveBody) return;
  const draftOperations = state.operations.filter((op) => isJobScheduled(op.ot) && !isPlanCompletedOperation(op));
  const summary = weeklyExecutiveSummary(
    weeklyJobSummary(state.planStart, { operations: draftOperations }),
    state.planStart,
    { operations: draftOperations }
  );
  els.draftExecutiveBody.innerHTML = renderWeeklyExecutiveSummary(summary, {
    title: "Resumen",
    subtitle: "",
  });
}

function renderTop() {
  const scheduledOperations = state.operations.filter((op) => isJobScheduled(op.ot) && !isPlanCompletedOperation(op));
  const total = scheduledOperations.length;
  const planned = scheduledOperations.filter((op) => op.estatus.toUpperCase() !== "COMPLETE").length;
  const dueCount = getPriorityJobs().filter((job) => isJobSelected(job.ot) && Boolean(job.dueDate)).length;
  const changes = scheduledOperations.filter((op) => op.tipoInsercion === "CAMBIO_HERRAMENTAL").length;
  const minutes = scheduledOperations.reduce((sum, op) => sum + operationDuration(op), 0);
  const loads = getOperatorLoads();
  const overload = loads.filter((item) => item.percent > 100).length;
  const window = getPlanWindow();

  els.metricPlanned.textContent = String(planned);
  els.metricOverload.textContent = String(overload);
  els.kpiOps.textContent = String(total);
  els.kpiSelected.textContent = String(state.selectedOts.length);
  els.kpiHours.textContent = String(Math.round(minutes / 60));
  els.kpiDue.textContent = String(dueCount);
  els.kpiChanges.textContent = String(changes);
  els.kpiAlerts.textContent = String(planAlertItems().length);
  const plantName = state.plant?.name ? `${state.plant.name} - ` : "";
  els.planWindow.textContent = `${plantName}${formatShortDate(window.start)} a ${formatShortDate(window.end)}`;
  els.planStartInput.value = formatDate(window.start);
  els.horizonSelect.value = String(state.horizonDays);
  renderGanttDisplayControls();
  els.undoBtn.disabled = stateHistory.length === 0;
  renderGanttViewSelection();
}

function renderPlanAlerts() {
  if (!els.planAlerts) return;
  const alerts = planAlertItems();
  els.planAlerts.hidden = alerts.length === 0;
  els.planAlerts.innerHTML = alerts.slice(0, 6).map((alert) => `
    <button class="plan-alert plan-alert--${escapeHtml(alert.level)}" type="button" data-alert-ot="${escapeHtml(alert.ot || "")}">
      <strong>${escapeHtml(alert.title)}</strong>
      <span>${escapeHtml(alert.message)}</span>
    </button>
  `).join("");
  els.planAlerts.querySelectorAll("[data-alert-ot]").forEach((button) => {
    button.addEventListener("click", () => {
      const ot = button.dataset.alertOt;
      const job = getPriorityJobs().find((item) => item.ot === ot);
      if (!job) return;
      state.selectedOperationId = job.firstOp.id;
      saveState();
      render();
    });
  });
}

function planAlertItems() {
  const alerts = [];
  if (state.netSuiteSyncAlert) {
    alerts.push({
      level: "critical",
      title: "Sincronizacion NetSuite",
      message: state.netSuiteSyncAlert.message || "No se pudo sincronizar NetSuite",
    });
  }
  for (const alert of state.netSuiteChangeAlerts || []) {
    alerts.push({
      level: normalizeStatus(alert.severity) === "ALTA" ? "critical" : "warning",
      ot: alert.ot,
      title: `Cambio NetSuite OT ${alert.ot}`,
      message: alert.summary || "La OT cambio en NetSuite",
    });
  }
  for (const job of getPriorityJobs().filter((item) => isJobSelected(item.ot))) {
    const risk = jobRiskLevel(job);
    if (risk.level === "ROJO") {
      alerts.push({ level: "critical", ot: job.ot, title: `Riesgo OT ${job.ot}`, message: risk.label });
    } else if (risk.level === "AMARILLO") {
      alerts.push({ level: "warning", ot: job.ot, title: `Faltante OT ${job.ot}`, message: risk.label });
    }
  }
  const target = weeklyExecutiveSummary(weeklyJobSummary(state.planStart), state.planStart);
  if (!target.targetMet) {
    alerts.push({
      level: "warning",
      title: "Meta semanal",
      message: `Meta semanal no alcanzada: ${formatCurrency(target.releaseAmount)} / ${formatCurrency(target.releaseTarget)}. Faltan ${formatCurrency(target.releaseGap)}`,
    });
  }
  return alerts;
}

function renderPriorityList() {
  const query = els.searchInput.value.trim().toLowerCase();
  const statusFilter = els.statusFilter.value;
  renderSelectedJobPanel();
  const jobs = getPriorityJobs()
    .filter((job) => {
      return !job.closed && !isJobSelected(job.ot) && jobMatchesSearch(job, query) && matchesStatusFilter(job, statusFilter);
    });

  els.priorityCount.textContent = `${jobs.length} trabajos en espera`;
  els.priorityList.innerHTML = "";

  for (const job of jobs) {
    const workOrder = workOrderForOt(job.ot);
    const dueDateOverridden = Boolean(workOrder?.dueDateOverride);
    const article = job.parte || "SIN ARTICULO";
    const quantity = Number(job.quantity || job.ops.find((op) => Number(op.cantTotal) > 0)?.cantTotal || 0);
    const quantityLabel = quantity ? `${formatMaterialQuantity(quantity)} pzas` : "Sin dato";
    const toolMini = jobToolMiniHtml(job);
    const photoMarkup = job.photoUrl
      ? `<img src="${escapeHtml(job.photoUrl)}" alt="Foto del articulo ${escapeHtml(article)}" data-backlog-photo />`
      : "";
    const card = document.createElement("article");
    card.className = `priority-card ${jobRiskCardClass(job)}${job.ot === selectedJobOt() ? " focused" : ""}${job.movable ? "" : " ineligible"}`;
    card.dataset.ot = job.ot;
    card.tabIndex = 0;
    card.title = `${job.ot} - ${job.ops.length} operaciones - ${formatMinutes(job.minutes)}`;
    card.innerHTML = `
      <div class="priority-card-main">
        <button class="job-add" type="button"${job.movable ? "" : " disabled"} aria-label="Agregar OT ${escapeHtml(job.ot)} al plan" title="${job.movable ? "Agregar al plan" : `No disponible por estatus ${escapeHtml(job.status)}`}">+</button>
        <span class="drag-handle" aria-hidden="true">&#8942;&#8942;</span>
        <div class="priority-photo${job.photoUrl ? " has-photo" : ""}">${photoMarkup}<span>Sin foto</span></div>
        <div class="priority-card-copy">
          <div class="job-title-line"><strong>OT ${escapeHtml(job.ot)}</strong><span class="job-status${job.movable ? "" : " blocked"}">${escapeHtml(job.status)}</span>${jobRiskIndicatorHtml(job)}${netSuiteChangeBadgeHtml(job.ot)}</div>
          <span class="priority-article">${escapeHtml(article)}</span>
          <span class="priority-description">${escapeHtml(job.descripcion || job.materialBase || "Sin descripcion")}</span>
          ${toolMini}
          ${jobTypeTagHtml(job)}${workOrderSyncWarningHtml(job.ot)}
        </div>
      </div>
      <div class="priority-program">
        <span>Carga</span>
        <strong>${formatHours(job.minutes)}</strong>
        <small>${job.ops.length} ops</small>
      </div>
      <div class="priority-quantity"><span>Cantidad</span><strong>${escapeHtml(quantityLabel)}</strong></div>
      <label class="priority-due-date"><span>Entrega</span><input class="job-due-date${dueDateOverridden ? " is-overridden" : ""}" data-due-ot="${escapeHtml(job.ot)}" type="date" value="${escapeHtml(job.dueDate)}" aria-label="Fecha de entrega OT ${escapeHtml(job.ot)}" title="NetSuite: ${escapeHtml(formatOtDateValue(workOrder?.dueDate))}"></label>
    `;

    card.addEventListener("click", () => {
      if (suppressBacklogClick) return;
      state.selectedOperationId = job.firstOp.id;
      state.expandedOts = uniq([...state.expandedOts, job.ot]);
      renderPriorityList();
      renderGantt();
      saveState();
    });
    card.addEventListener("pointerdown", (event) => {
      if (!job.movable || event.button !== 0 || event.target.closest("button, input, select")) return;
      backlogPointerDrag = {
        pointerId: event.pointerId,
        sourceOt: job.ot,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        toPlanned: false,
        item: card,
      };
      card.setPointerCapture?.(event.pointerId);
    });
    card.addEventListener("pointermove", (event) => {
      if (!backlogPointerDrag || backlogPointerDrag.pointerId !== event.pointerId) return;
      updateBacklogDrag(event.clientX, event.clientY);
    });
    card.addEventListener("pointerup", (event) => finishBacklogDrag(true, event.pointerId));
    card.addEventListener("pointercancel", (event) => finishBacklogDrag(false, event.pointerId));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        card.click();
      }
    });
    const dueDateInput = card.querySelector("[data-due-ot]");
    const addButton = card.querySelector(".job-add");
    const photo = card.querySelector("[data-backlog-photo]");
    if (photo) photo.addEventListener("error", () => photo.parentElement.classList.remove("has-photo"));
    addButton.addEventListener("click", (event) => {
      event.stopPropagation();
      selectJob(job.ot, true);
    });
    dueDateInput.addEventListener("click", (event) => event.stopPropagation());
    dueDateInput.addEventListener("change", (event) => {
      event.stopPropagation();
      updateWorkOrderDueDate(job.ot, event.target.value);
    });

    els.priorityList.appendChild(card);
  }
}

function renderPriorityQueue() {
  const query = els.queueSearchInput.value.trim().toLowerCase();
  const jobsByOt = new Map(getPriorityJobs().map((job) => [job.ot, job]));
  const ordered = state.selectedOts.map((ot) => jobsByOt.get(ot)).filter(Boolean);
  state.selectedOts = ordered.map((job) => job.ot);
  const visibleJobs = ordered.filter((job) => jobMatchesSearch(job, query));
  const fixedCount = ordered.filter((job) => job.programmed || job.locked).length;
  const pendingCount = ordered.filter((job) => !isJobScheduled(job.ot)).length;
  els.lockAllBtn.disabled = !ordered.some((job) => !job.programmed && !job.locked);
  els.unlockAllBtn.disabled = !ordered.some((job) => !job.programmed && job.locked);
  els.selectedJobCount.textContent = `${ordered.length} en el plan${pendingCount ? ` / ${pendingCount} por programar` : ""}${fixedCount ? ` / ${fixedCount} fijas` : ""}`;
  if (!ordered.length) {
    els.priorityQueue.innerHTML = `<div class="queue-empty">Arrastra aqui los trabajos que deseas programar</div>`;
    return;
  }
  if (!visibleJobs.length) {
    els.priorityQueue.innerHTML = `<div class="queue-empty">No hay trabajos planeados que coincidan con la busqueda</div>`;
    return;
  }

  const existingItems = els.priorityQueue.querySelectorAll("[data-queue-ot]");
  const existingOts = new Set();
  existingItems.forEach((el) => existingOts.add(el.dataset.queueOt));
  const sameSet = existingItems.length === visibleJobs.length && visibleJobs.every((job) => existingOts.has(job.ot));

  if (sameSet) {
    const otToElement = new Map();
    existingItems.forEach((el) => otToElement.set(el.dataset.queueOt, el));
    const parent = els.priorityQueue;
    const queueEmpty = parent.querySelector(".queue-empty");
    if (queueEmpty) queueEmpty.remove();
    visibleJobs.forEach((job, i) => {
      const el = otToElement.get(job.ot);
      if (!el) return;
      const scheduled = isJobScheduled(job.ot);
      el.classList.toggle("focused", job.ot === selectedJobOt());
      el.classList.toggle("pending-schedule", !scheduled);
      el.classList.toggle("pinned", Boolean(job.programmed));
      el.classList.toggle("locked", !job.programmed && job.locked);
      if (parent.children[i] !== el) parent.insertBefore(el, parent.children[i] || null);
    });
    return;
  }

  els.priorityQueue.innerHTML = visibleJobs.map((job) => {
    const pendingSchedule = !isJobScheduled(job.ot);
    const article = job.parte || "SIN ARTICULO";
    const quantity = Number(job.quantity || job.ops.find((op) => Number(op.cantTotal) > 0)?.cantTotal || 0);
    const quantityLabel = quantity ? formatMaterialQuantity(quantity) : "Sin dato";
    const toolMini = jobToolMiniHtml(job);
    const workOrder = workOrderForOt(job.ot);
    const dueDateOverridden = Boolean(workOrder?.dueDateOverride);
    const photoMarkup = job.photoUrl
      ? `<img src="${escapeHtml(job.photoUrl)}" alt="Foto del articulo ${escapeHtml(article)}" data-queue-photo />`
      : "";
    const positionLabel = job.programmed
      ? "Trabajo programado fijo"
      : (job.locked ? "Trabajo bloqueado" : "Trabajo planeado");
    return `
      <article class="queue-item ${jobRiskCardClass(job)}${pendingSchedule ? " pending-schedule" : ""}${job.ot === selectedJobOt() ? " focused" : ""}${job.programmed ? " pinned" : ""}${job.locked && !job.programmed ? " locked" : ""}" data-queue-ot="${escapeHtml(job.ot)}" tabindex="0" aria-label="${positionLabel}${pendingSchedule ? ", pendiente de programar" : ", programada"}, OT ${escapeHtml(job.ot)}, articulo ${escapeHtml(article)}, cantidad ${escapeHtml(quantityLabel)}">
        <div class="queue-photo${job.photoUrl ? " has-photo" : ""}">${photoMarkup}<span>Sin foto</span></div>
        <div class="queue-main">
          <div class="queue-title-line"><strong>OT ${escapeHtml(job.ot)}</strong><span class="job-status${job.movable ? "" : " blocked"}">${escapeHtml(job.status)}</span>${jobRiskIndicatorHtml(job)}${netSuiteChangeBadgeHtml(job.ot)}</div>${workOrderSyncWarningHtml(job.ot)}
          <div class="queue-article" title="Articulo ${escapeHtml(article)}"><span>Articulo</span><strong>${escapeHtml(article)}</strong></div>
          <div class="queue-description">${escapeHtml(job.descripcion || "Sin descripcion")}</div>
          ${toolMini}
          ${jobTypeTagHtml(job)}
          <label class="queue-delivery"><span>Entrega</span><input class="job-due-date${dueDateOverridden ? " is-overridden" : ""}" data-queue-due-date="${escapeHtml(job.ot)}" type="date" value="${escapeHtml(job.dueDate)}" aria-label="Fecha de entrega OT ${escapeHtml(job.ot)}" title="NetSuite: ${escapeHtml(formatOtDateValue(workOrder?.dueDate))}"></label>
          <div class="queue-meta"><span>Cantidad <strong>${escapeHtml(quantityLabel)}</strong></span><span>${formatHours(job.minutes)}</span></div>
        </div>
        <button class="queue-lock${job.locked ? " locked" : ""}" type="button" data-lock-ot="${escapeHtml(job.ot)}" aria-label="${job.programmed ? `OT ${escapeHtml(job.ot)} fija por estatus programado` : `${job.locked ? "Desbloquear" : "Bloquear"} OT ${escapeHtml(job.ot)}`}" title="${job.programmed ? "Fija por estatus programado" : (job.locked ? "Desbloquear programacion" : "Bloquear programacion")}"${job.programmed ? " disabled" : ""}>
          <svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="1"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
        </button>
        <span class="drag-handle" aria-hidden="true">&#8942;&#8942;</span>
      </article>
    `;
  }).join("");

  els.priorityQueue.querySelectorAll("[data-queue-photo]").forEach((photo) => {
    photo.addEventListener("error", () => photo.parentElement.classList.remove("has-photo"));
  });

  els.priorityQueue.querySelectorAll("[data-queue-due-date]").forEach((input) => {
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("change", (event) => {
      event.stopPropagation();
      updateWorkOrderDueDate(input.dataset.queueDueDate, input.value);
    });
  });

  els.priorityQueue.querySelectorAll("[data-queue-ot]").forEach((item) => {
    item.addEventListener("click", () => {
      if (suppressQueueClick) return;
      const job = jobsByOt.get(item.dataset.queueOt);
      if (!job) return;
      state.selectedOperationId = job.firstOp.id;
      state.expandedOts = uniq([...state.expandedOts, job.ot]);
      renderPriorityList();
      renderPriorityQueue();
      saveState();
      requestAnimationFrame(renderGantt);
    });
    item.addEventListener("keydown", (event) => {
      const job = jobsByOt.get(item.dataset.queueOt);
      if (job?.programmed || job?.locked) return;
      const direction = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
      if (!direction) return;
      const index = state.selectedOts.indexOf(item.dataset.queueOt);
      const targetOt = state.selectedOts[index + direction];
      if (!targetOt) return;
      event.preventDefault();
      reorderSelectedJobs(item.dataset.queueOt, targetOt);
    });
    item.addEventListener("pointerdown", (event) => {
      const job = jobsByOt.get(item.dataset.queueOt);
      if (job?.programmed || job?.locked) return;
      if (event.button !== 0 || event.target.closest("button, input, select")) return;
      queuePointerDrag = {
        pointerId: event.pointerId,
        sourceOt: item.dataset.queueOt,
        targetOt: "",
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        item,
      };
      item.setPointerCapture?.(event.pointerId);
    });
    let lastDragMove = 0;
    item.addEventListener("pointermove", (event) => {
      if (!queuePointerDrag || queuePointerDrag.pointerId !== event.pointerId) return;
      const now = performance.now();
      if (now - lastDragMove < 16) return;
      lastDragMove = now;
      updateQueueDrag(event.clientX, event.clientY);
    });
    item.addEventListener("pointerup", (event) => finishQueueDrag(true, event.pointerId));
    item.addEventListener("pointercancel", (event) => finishQueueDrag(false, event.pointerId));
    item.querySelector("[data-lock-ot]").addEventListener("click", (event) => {
      event.stopPropagation();
      toggleJobLock(event.currentTarget.dataset.lockOt);
    });
  });
}

function updateQueueDrag(clientX, clientY) {
  if (!queuePointerDrag) return;
  const distance = Math.hypot(clientX - queuePointerDrag.startX, clientY - queuePointerDrag.startY);
  if (!queuePointerDrag.moved && distance < 6) return;
  queuePointerDrag.moved = true;
  queuePointerDrag.item.classList.add("dragging");
  els.priorityQueue.querySelectorAll(".drop-before").forEach((target) => target.classList.remove("drop-before"));
  const point = document.elementFromPoint(clientX, clientY);
  const target = point?.closest("[data-queue-ot]");
  queuePointerDrag.toBacklog = Boolean(point?.closest(".priorities-panel"));
  document.querySelector(".priorities-panel")?.classList.toggle("drag-target", queuePointerDrag.toBacklog);
  queuePointerDrag.targetOt = target && target !== queuePointerDrag.item ? target.dataset.queueOt : "";
  if (queuePointerDrag.targetOt) target.classList.add("drop-before");
}

function finishQueueDrag(commit, pointerId = null) {
  if (!queuePointerDrag || (pointerId !== null && queuePointerDrag.pointerId !== pointerId)) return;
  const { moved, sourceOt, targetOt, toBacklog, item } = queuePointerDrag;
  item.releasePointerCapture?.(queuePointerDrag.pointerId);
  item.classList.remove("dragging");
  els.priorityQueue.querySelectorAll(".drop-before").forEach((target) => target.classList.remove("drop-before"));
  document.querySelector(".priorities-panel")?.classList.remove("drag-target");
  queuePointerDrag = null;
  if (!moved) return;
  suppressQueueClick = true;
  setTimeout(() => { suppressQueueClick = false; }, 0);
  if (commit && toBacklog) selectJob(sourceOt, false);
  else if (commit && targetOt) reorderSelectedJobs(sourceOt, targetOt);
}

function updateBacklogDrag(clientX, clientY) {
  if (!backlogPointerDrag) return;
  const distance = Math.hypot(clientX - backlogPointerDrag.startX, clientY - backlogPointerDrag.startY);
  if (!backlogPointerDrag.moved && distance < 6) return;
  backlogPointerDrag.moved = true;
  backlogPointerDrag.item.classList.add("drag-source");
  const point = document.elementFromPoint(clientX, clientY);
  backlogPointerDrag.toPlanned = Boolean(point?.closest(".queue-panel"));
  els.priorityQueue.classList.toggle("drag-target", backlogPointerDrag.toPlanned);
}

function finishBacklogDrag(commit, pointerId = null) {
  if (!backlogPointerDrag || (pointerId !== null && backlogPointerDrag.pointerId !== pointerId)) return;
  const { moved, sourceOt, toPlanned, item } = backlogPointerDrag;
  item.releasePointerCapture?.(backlogPointerDrag.pointerId);
  item.classList.remove("drag-source");
  els.priorityQueue.classList.remove("drag-target");
  backlogPointerDrag = null;
  if (!moved) return;
  suppressBacklogClick = true;
  setTimeout(() => { suppressBacklogClick = false; }, 0);
  if (commit && toPlanned) selectJob(sourceOt, true);
}

async function selectJob(ot, selected) {
  if (!ot) return;
  const job = getPriorityJobs().find((item) => item.ot === ot);
  if (selected && job && !job.movable && !job.programmed) {
    showToast(`OT ${ot} no puede agregarse al plan por estatus ${job.status}`);
    return;
  }
  if (!selected && job?.programmed) {
    showToast(`OT ${ot} esta programada y debe permanecer en el plan`);
    return;
  }
  if (!selected) {
    const removal = window.PlanningWorkflowCore.canRemoveSelectedOt(state, ot);
    if (!removal.allowed) {
      showToast(removal.reason);
      return;
    }
  }
  const alreadySelected = state.selectedOts.includes(ot);
  if (selected && !alreadySelected) {
    state._pendingAddOt = ot;
    state._pendingAddOtSnapshot = [...state.selectedOts];
    const prepared = await prepareJobForPlanning(job, { forceConfirm: true });
    if (!prepared) {
      delete state._pendingAddOt;
      delete state._pendingAddOtSnapshot;
      return;
    }
    checkpointState();
  } else {
    checkpointState();
  }
  if (selected && !alreadySelected) {
    const signature = String(state.preparedPlanningByOt?.[ot] || "");
    Object.assign(state, window.PlanningWorkflowCore.commitPreparedOtSelection(state, ot, signature));
    delete state._pendingAddOt;
    delete state._pendingAddOtSnapshot;
  }
  if (!selected && alreadySelected) {
    Object.assign(state, window.PlanningWorkflowCore.removeOtFromDraft(state, ot));
  }
  applyQueuePriorities();
  if (!selected && alreadySelected) {
    renderPriorityList();
    renderPriorityQueue();
    showToast(`OT ${ot} devuelta al backlog`);
    saveState("plan");
    return;
  }
  requestAnimationFrame(() => {
    renderPriorityQueue();
    showToast(`OT ${ot} ${selected ? "agregada al plan" : "devuelta al backlog"}`);
    requestAnimationFrame(() => {
      renderTop();
      renderPlanAlerts();
      renderPriorityList();
    });
  });
  saveState("plan");
}

async function prepareJobForPlanning(job, options = {}) {
  if (!job) return false;
  const operations = job.ops.filter((op) => op.tipoInsercion !== "CAMBIO_HERRAMENTAL");
  const issues = window.PlannerCore?.planningConfigurationIssues
    ? window.PlannerCore.planningConfigurationIssues(state, operations)
    : [];
  const blockers = issues.filter((issue) => ["MISSING_CAPABILITY", "MISSING_OPERATOR", "MISSING_TOOL_CHANGE_CAPABILITY", "MISSING_TOOL_CHANGE_OPERATOR"].includes(issue.code));
  if (blockers.length) {
    await showPlanningBlockers(job, blockers);
    return false;
  }

  const requirements = buildPlanningRequirements(issues, operations);
  const commercial = commercialPlanningRequirement(job, { alwaysPlanningType: options.forceConfirm === true });
  const signature = planningPreparationSignature(job, operations, commercial);
  if (!options.forceConfirm && !window.PlanningWorkflowCore.needsPlanningPreparation(state, job.ot, signature)) return true;
  const onlyOptionalKit = requirements.length > 0 && requirements.every((item) => item.codes.size === 1 && item.codes.has("OPTIONAL_KIT"));
  const hasPreparationOperation = operations.some((op) => isSubcontractAppOperation(op) || isBendingAppOperation(op));
  const mustConfirmPlanning = hasPreparationOperation || (!onlyOptionalKit && requirements.length > 0) || commercial.needsType || commercial.needsPlanningType;
  if (!mustConfirmPlanning) {
    Object.assign(state, window.PlanningWorkflowCore.markPlanningPrepared(state, job.ot, signature));
    return true;
  }
  const values = await showPlanningRequirements(job, requirements, commercial);
  if (!values) return false;

  applyPlanningRequirements(requirements, values, operations);
  applyCommercialPlanningRequirement(job, values, commercial);
  assignPlanningOperators(operations);
  Object.assign(state, window.PlanningWorkflowCore.markPlanningPrepared(
    state, job.ot, planningPreparationSignature(job, operations, commercialPlanningRequirement(job))
  ));
  return true;
}

function setGanttView(view) {
  state.ganttView = window.PlanningWorkflowCore.normalizeGanttView(view);
  invalidateGanttGroupsCache();
  renderGantt();
  renderGanttViewSelection();
  renderGanttDisplayControls();
  saveState("ui");
  showToast(ganttViewMessage(state.ganttView));
}

function renderGanttViewSelection() {
  document.querySelectorAll(".segmented button").forEach((button) => {
    const active = window.PlanningWorkflowCore.isActiveGanttView(state.ganttView, button.dataset.view);
    button.classList.toggle("segmented-active", active);
    button.setAttribute("aria-selected", String(active));
  });
}

function planningPreparationSignature(job, operations, commercial) {
  const productive = operations || [];
  return window.PlanningWorkflowCore.planningPreparationSignature({
    ot: job?.ot || "",
    machine: productive.map((op) => op.maquina || "").join("|"),
    tool: productive.map((op) => op.herramental || "").join("|"),
    kit: productive.map((op) => op.kitHerramental || "").join("|"),
    kitPending: productive.some((op) => op.kitPending === true),
    subcontractType: productive.map((op) => op.subcontractType || "").join("|"),
    subcontractDays: Math.max(0, ...productive.map((op) => Number(op.subcontractDays || 0))),
    commercialType: commercial?.currentType || "",
    planningType: commercial?.currentPlanningType || "",
    operationVersion: productive.map((op) => [op.id, op.secuencia, op.ct, op.tipoInsercion].join("|")).join(";")
  });
}

function commercialPlanningRequirement(job, options = {}) {
  const configuration = articleConfigurationValue(job.parte);
  const invoicePrice = invoiceUnitPriceForOt(job.ot);
  const manualPrice = Math.max(0, Number(configuration.manualUnitPrice || 0));
  const planningType = String(configuration.planningType || configuration.tipoTrabajo || "").trim().toUpperCase();
  return {
    currentType: String(configuration.jobType || "").trim().toUpperCase(),
    currentPlanningType: planningType,
    invoicePrice,
    manualPrice,
    pendingPieces: pendingPiecesForWorkOrder(workOrderForOt(job.ot)),
    needsType: !String(configuration.jobType || "").trim(),
    needsPlanningType: options.alwaysPlanningType === true || !planningType,
    needsManualPrice: !(invoicePrice > 0) && !(manualPrice > 0),
  };
}

function applyCommercialPlanningRequirement(job, values, commercial) {
  const configuration = articleConfigurationFor(job?.parte);
  const selectedType = String(values.ot_job_type || commercial.currentType || configuration.jobType || "").trim().toUpperCase();
  const selectedPlanningType = String(values.ot_planning_type || commercial.currentPlanningType || configuration.planningType || suggestedPlanningTypeForJob(job) || "NORMAL").trim().toUpperCase();
  if (selectedType) configuration.jobType = selectedType;
  if (selectedPlanningType) configuration.planningType = selectedPlanningType;
  if (!(commercial.invoicePrice > 0)) {
    const manualPrice = Number(values.ot_manual_price || commercial.manualPrice || 0);
    if (manualPrice >= 0) configuration.manualUnitPrice = manualPrice;
  }
  configuration.updatedAt = new Date().toISOString();
}

function buildPlanningRequirements(issues, operations) {
  const byOperation = new Map(operations.map((op) => [op.id, op]));
  const grouped = new Map();
  for (const issue of issues) {
    if (!["MISSING_MACHINE", "MISSING_TOOL", "MISSING_SUBCONTRACT_TYPE", "MISSING_SUBCONTRACT_DAYS"].includes(issue.code)) continue;
    const op = byOperation.get(issue.operationId);
    if (!op) continue;
    const requirement = grouped.get(op.id) || { op, codes: new Set() };
    requirement.codes.add(issue.code);
    grouped.set(op.id, requirement);
  }
  for (const op of operations) {
    const requirement = grouped.get(op.id) || { op, codes: new Set() };
    if (window.PlannerCore?.isBendingOperation?.(op)) {
      if (!String(op.maquina || "").trim() || op.maquina === "SIN_MAQUINA") {
        requirement.codes.add("MISSING_MACHINE");
      }
      requirement.codes.add("OT_TOOL");
      requirement.codes.add("OPTIONAL_KIT");
    }
    if (isSubcontractAppOperation(op)) requirement.codes.add("OT_SUBCONTRACT");
    if (requirement.codes.size) grouped.set(op.id, requirement);
  }
  return [...grouped.values()].map((item, index) => ({ ...item, index }));
}

async function showPlanningBlockers(job, blockers) {
  const items = blockers.map((issue) => {
    const capability = issue.capability || capabilityFromOperation(findOperation(issue.operationId) || {});
    if (issue.code === "MISSING_TOOL_CHANGE_CAPABILITY") return `<li>Falta agregar <strong>CAMBIO DE HERRAMENTAL</strong> a la matriz de habilidades.</li>`;
    if (issue.code === "MISSING_TOOL_CHANGE_OPERATOR") return `<li>Falta habilitar al menos un operador para <strong>CAMBIO DE HERRAMENTAL</strong>.</li>`;
    if (issue.code === "MISSING_CAPABILITY") return `<li>Falta agregar <strong>${escapeHtml(capability.label)}</strong> (CT ${escapeHtml(capability.ct)}) a la matriz de habilidades.</li>`;
    return `<li>Falta habilitar al menos un operador para <strong>${escapeHtml(capability.label)}</strong> (CT ${escapeHtml(capability.ct)}).</li>`;
  }).join("");
  const result = await openPlanningDialog({
    title: `OT ${job.ot} no puede agregarse al plan`,
    summary: "Completa la configuracion antes de programar este trabajo.",
    body: `<div class="planning-error"><ul>${items}</ul></div>`,
    confirmLabel: "Ir a matriz",
    cancelVisible: false,
  });
  if (result) showWorkspaceView("matriz");
}

function planningCatalogSelectMarkup(name, field, currentValue, options = {}) {
  const values = toolCatalogValues(field, currentValue);
  const attributes = options.attributes || "";
  return `<select name="${escapeHtml(name)}" data-catalog-select="${escapeHtml(name)}"${options.required ? " required" : ""}${attributes}>${catalogSelectOptions(values, currentValue, options.emptyLabel || "Selecciona")}</select>
    <input name="${escapeHtml(name)}_custom" data-catalog-custom="${escapeHtml(name)}" type="text" placeholder="${escapeHtml(options.customPlaceholder || "Nombre nuevo")}" hidden disabled>`;
}

function updatePlanningCatalogSelect(select) {
  const input = els.planningDialogBody.querySelector(`[data-catalog-custom="${select.dataset.catalogSelect}"]`);
  if (!input) return;
  const custom = !select.disabled && select.value === CUSTOM_CATALOG_VALUE;
  input.hidden = !custom;
  input.disabled = !custom;
  input.required = custom;
  if (!custom) input.value = "";
}

function planningCatalogValue(values, name) {
  return cleanToolValue(values[name] === CUSTOM_CATALOG_VALUE ? values[`${name}_custom`] : values[name]);
}

async function showPlanningRequirements(job, requirements, commercial = commercialPlanningRequirement(job)) {
  const bendingRequirements = requirements.filter((item) => item.codes.has("MISSING_MACHINE"));
  const bendingOps = job.ops.filter(isBendingAppOperation);
  const compatibleMachines = compatibleMachineOptionsForOps(bendingOps);
  const configuration = otConfigurationFor(job.ot);
  const configuredMachine = normalizeMachineValue(configuration.machine);
  const configuredMachineValid = Boolean(configuredMachine) && !(configuredMachine === "1" && bendingOps.some((op) => String(op.ct) === "5459"));
  const operationMachine = bendingOps.map((op) => normalizeMachineValue(op.maquina, op))
    .find((machine) => machine && !(machine === "1" && bendingOps.some((op) => String(op.ct) === "5459"))) || "";
  const currentMachine = compatibleMachines.includes(configuredMachine) && configuredMachineValid
    ? configuredMachine
    : (compatibleMachines.includes(operationMachine) ? operationMachine : "");
  const needsOtKit = requirements.some((item) => item.codes.has("OPTIONAL_KIT"));
  const needsSubcontract = requirements.some((item) => item.codes.has("MISSING_SUBCONTRACT_TYPE") || item.codes.has("MISSING_SUBCONTRACT_DAYS") || item.codes.has("OT_SUBCONTRACT"));
  const registeredSubcontract = subcontractRegistrationForJob(job.ot, job.ops);
  const subcontractRequirement = requirements.find((item) => item.codes.has("MISSING_SUBCONTRACT_TYPE") || item.codes.has("MISSING_SUBCONTRACT_DAYS") || item.codes.has("OT_SUBCONTRACT"));
  const subcontractCatalog = subcontractRequirement ? subcontractCatalogForAppOperation(subcontractRequirement.op) : null;
  const currentSubcontractType = configuration.subcontractType || registeredSubcontract?.name || subcontractCatalog?.name || "";
  const currentSubcontractDays = Number(configuration.subcontractDays || registeredSubcontract?.days || subcontractCatalog?.days || 0);
  const currentKit = cleanToolValue(configuration.kitHerramental) || getOtKitValue(job.ops) || requirements.map((item) => cleanToolValue(toolCatalogForAppOperation(item.op)?.kitHerramental)).find(Boolean) || "";
  const currentPlanningType = commercial.currentPlanningType || suggestedPlanningTypeForJob(job) || "NORMAL";
  const planningTypeOptions = DEFAULT_PLANNING_TYPES
    .map((type) => `<option value="${escapeHtml(type)}"${type === currentPlanningType ? " selected" : ""}>${escapeHtml(type)}</option>`)
    .join("");
  const typeOptions = state.otTypes
    .filter((item) => item.active !== false || normalizeStatus(item.name) === normalizeStatus(commercial.currentType))
    .map((item) => `<option value="${escapeHtml(item.name)}"${normalizeStatus(item.name) === normalizeStatus(commercial.currentType) ? " selected" : ""}>${escapeHtml(item.name)}</option>`)
    .join("");
  const planningTypeField = commercial.needsPlanningType
    ? `<label>Tipo de trabajo<select name="ot_planning_type" required><option value="">Selecciona normal, prototipo o expeditado</option>${planningTypeOptions}</select></label>`
    : `<label>Tipo de trabajo<input type="text" value="${escapeHtml(commercial.currentPlanningType || currentPlanningType || "")}" readonly></label>`;
  const jobTypeField = commercial.needsType
    ? `<label>Tipo comercial<select name="ot_job_type" required><option value="">Selecciona OEM, especial o linea</option>${typeOptions}</select></label>`
    : `<label>Tipo comercial<input type="text" value="${escapeHtml(commercial.currentType || "")}" readonly></label>`;
  const priceField = commercial.needsManualPrice
    ? `<label>Precio unitario temporal (opcional)<input name="ot_manual_price" type="number" min="0" step="0.01" value="${escapeHtml(commercial.manualPrice || "")}"><small>Puede quedar vacio o ser cero</small></label>`
    : "";
  const commercialFields = commercial.needsType || commercial.needsPlanningType || commercial.needsManualPrice ? `<section class="planning-requirement planning-requirement-commercial">
    <div class="planning-requirement-title"><strong>Clasificacion y valor del articulo</strong><span>Obligatorio antes de programar</span></div>
    <div class="planning-requirement-fields">
      ${planningTypeField}
      ${jobTypeField}
      ${priceField}
    </div>
  </section>` : "";
  const machineField = bendingOps.length ? `<label>Maquina de la OT
    <select name="ot_machine" required>
      <option value="">${compatibleMachines.length ? "Selecciona una maquina" : "No hay maquinas configuradas"}</option>
      ${compatibleMachines.map((machine) => `<option value="${escapeHtml(machine)}"${machine === currentMachine ? " selected" : ""}>${escapeHtml(machine)}</option>`).join("")}
    </select>
  </label>${compatibleMachines.length ? "" : `<p class="planning-inline-warning">Registra una maquina en Catalogos para poder guardar esta OT.</p>`}` : "";
  const subcontractTypes = subcontractTypesForPart(job.parte);
  const subcontractTypeField = subcontractTypes.length
    ? `<select name="ot_subcontract_type" data-subcontract-select="ot" required>
         <option value="">Selecciona un tipo</option>
         ${subcontractTypes.map((item) => `<option value="${escapeHtml(item.name)}"${normalizeStatus(item.name) === normalizeStatus(currentSubcontractType) ? " selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
       </select>`
    : `<input name="ot_subcontract_type" type="text" value="${escapeHtml(currentSubcontractType)}" placeholder="Tipo de subcontrato" required>`;
  const commonFields = bendingOps.length || needsOtKit || needsSubcontract ? `<section class="planning-requirement planning-requirement-ot">
    <div class="planning-requirement-title"><strong>Datos generales de la OT ${escapeHtml(job.ot)}</strong><span>Una asignacion para toda la orden</span></div>
    <div class="planning-requirement-fields">
      ${machineField}
      ${needsOtKit ? `<label>Kit de la OT (opcional)${planningCatalogSelectMarkup("ot_kit", "kitHerramental", currentKit, { emptyLabel: "Sin kit", customPlaceholder: "Nombre del nuevo kit", attributes: ` data-kit-input="ot"${currentKit ? "" : " disabled"}` })}</label>
      <label class="defer-kit-option"><input name="ot_kit_later" data-kit-later="ot" type="checkbox" value="true"${currentKit ? "" : " checked"}> Registrar kit despues</label>` : ""}
      ${needsSubcontract ? `<label>Tipo de subcontrato
        ${subcontractTypeField}
      </label>
      <label>Dias habiles<input name="ot_subcontract_days" data-subcontract-days="ot" type="number" min="1" max="90" step="1" value="${escapeHtml(currentSubcontractDays || "")}" required></label>` : ""}
    </div>
  </section>` : "";
  const operationFields = requirements.map((requirement) => {
    const { op, codes, index } = requirement;
    const catalog = toolCatalogForAppOperation(op);
    const currentTool = cleanToolValue(configuration.herramental) || cleanToolValue(op.herramental) || cleanToolValue(catalog?.herramental);
    const toolFields = codes.has("MISSING_TOOL") || codes.has("OT_TOOL")
      ? `<label>Herramental requerido${planningCatalogSelectMarkup(`tool_${index}`, "herramental", currentTool, { required: true, emptyLabel: "Selecciona un herramental", customPlaceholder: "Nombre del nuevo herramental" })}</label>`
      : "";
    if (!toolFields) return "";
    return `<section class="planning-requirement">
      <div class="planning-requirement-title"><strong>Sec. ${escapeHtml(op.secuencia)} - ${escapeHtml(op.descripcion)}</strong><span>CT ${escapeHtml(op.ct)}</span></div>
      <div class="planning-requirement-fields">${toolFields}</div>
    </section>`;
  }).join("");
  return new Promise((resolve, reject) => {
    requestAnimationFrame(() => {
      openPlanningDialog({
        title: `Preparar OT ${job.ot}`,
        summary: "Los datos comerciales se guardan por articulo; maquina, kit y subcontrato se guardan para esta OT.",
        body: `${commercialFields}${commonFields}${operationFields}`,
        confirmLabel: "Agregar al plan",
        cancelVisible: true,
        setup: () => {
          els.planningDialogBody.querySelectorAll("[data-catalog-select]").forEach((select) => {
            select.addEventListener("change", () => updatePlanningCatalogSelect(select));
            updatePlanningCatalogSelect(select);
          });
          els.planningDialogBody.querySelectorAll("[data-kit-later]").forEach((checkbox) => {
            const update = () => {
              const input = els.planningDialogBody.querySelector(`[data-kit-input="${checkbox.dataset.kitLater}"]`);
              if (input) {
                input.disabled = checkbox.checked;
                updatePlanningCatalogSelect(input);
              }
            };
            checkbox.addEventListener("change", update);
            update();
          });
          els.planningDialogBody.querySelectorAll("[data-subcontract-select]").forEach((select) => {
            select.addEventListener("change", () => {
              const input = els.planningDialogBody.querySelector(`[data-subcontract-days="${select.dataset.subcontractSelect}"]`);
              const catalogItem = subcontractCatalogForSelection(job.parte, select.value);
              if (input && catalogItem) input.value = String(Math.max(1, Number(catalogItem.days) || 1));
            });
          });
        },
      }).then(resolve, reject);
    });
  });
}

function applyPlanningRequirements(requirements, values, operations) {
  for (const op of operations) {
    const catalog = toolCatalogForAppOperation(op);
    if (catalog) {
      if (!cleanToolValue(op.herramental)) op.herramental = cleanToolValue(catalog.herramental);
    }
  }

  if (operations.some(isBendingAppOperation)) {
    const machine = String(values.ot_machine || "").trim().toUpperCase();
    applyMachineToJob(operations[0]?.ot, machine);
  }
  if (requirements.some((item) => item.codes.has("OPTIONAL_KIT"))) {
    const kitLater = values.ot_kit_later === "true";
    const kit = planningCatalogValue(values, "ot_kit");
    applyKitToJob(operations[0]?.ot, kit, kitLater);
  }
  const registeredSubcontract = subcontractRegistrationForJob(operations[0]?.ot, operations);
  if (requirements.some((item) => item.codes.has("MISSING_SUBCONTRACT_DAYS") || item.codes.has("OT_SUBCONTRACT"))) {
    applySubcontractToJob(operations[0]?.ot, values.ot_subcontract_type, values.ot_subcontract_days);
  } else if (registeredSubcontract) {
    applySubcontractToJob(operations[0]?.ot, registeredSubcontract.name, registeredSubcontract.days);
  }

  for (const requirement of requirements) {
    const { op, codes, index } = requirement;
    if (codes.has("MISSING_TOOL") || codes.has("OT_TOOL")) {
      const currentCatalog = toolCatalogForAppOperation(op);
      const tool = planningCatalogValue(values, `tool_${index}`) || cleanToolValue(currentCatalog?.herramental);
      applyToolToJob(op.ot, tool);
      if (tool && !state.toolCatalog.some((item) => item.active !== false && normalizeStatus(item.part || item.parte) === normalizeStatus(op.parte) && cleanToolValue(item.herramental) === tool && cleanToolValue(item.kitHerramental) === op.kitHerramental)) {
        state.toolCatalog.push({
          id: uid("tool"), part: op.parte,
          herramental: tool, kitHerramental: op.kitHerramental,
          toolSetupMinutes: Number(currentCatalog?.toolSetupMinutes || 0), kitSetupMinutes: Number(currentCatalog?.kitSetupMinutes || 0), active: true,
        });
      }
    }
  }
}

function assignPlanningOperators(operations) {
  for (const op of operations) {
    if (isSubcontractAppOperation(op)) {
      op.operador = "SUBCONTRATO";
      op.maquina = "";
      continue;
    }
    const allowed = getAllowedOperatorsForOperation(op);
    if (!allowed.includes(op.operador)) op.operador = allowed[0] || "SIN_OPERADOR";
  }
}

function openPlanningDialog({ title, summary, body, confirmLabel, cancelVisible, setup }) {
  if (planningDialogResolve) closePlanningDialog(null);
  els.planningDialogTitle.textContent = title;
  els.planningDialogSummary.textContent = summary || "";
  els.planningDialogBody.innerHTML = body || "";
  els.planningDialogConfirm.textContent = confirmLabel || "Aceptar";
  els.planningDialogCancel.hidden = cancelVisible === false;
  const promise = new Promise((resolve) => { planningDialogResolve = resolve; });
  els.planningDialog.showModal();
  if (setup) setup();
  return promise;
}

function closePlanningDialog(result) {
  const resolve = planningDialogResolve;
  planningDialogResolve = null;
  if (els.planningDialog.open) els.planningDialog.close();
  if (resolve) resolve(result);
}

function toggleJobLock(ot) {
  const job = getPriorityJobs().find((item) => item.ot === ot);
  if (job?.programmed) {
    showToast(`OT ${ot} permanece fija por estatus programado`);
    return;
  }
  if (!isJobSelected(ot)) {
    showToast(`Selecciona la OT ${ot} antes de bloquearla`);
    return;
  }
  checkpointState();
  const locked = !isJobLocked(ot);
  state.lockedOts = locked ? uniq([...state.lockedOts, ot]) : state.lockedOts.filter((item) => item !== ot);
  state.operations.filter((op) => op.ot === ot).forEach((op) => {
    op.locked = locked;
    op.log = appendLog(op.log, locked ? "OT_BLOQUEADA_APP" : "OT_DESBLOQUEADA_APP");
  });
  saveAndRender(`OT ${ot} ${locked ? "bloqueada" : "desbloqueada"}`);
}

function toggleAllJobs(locked) {
  const editableOts = state.selectedOts.filter((ot) => !isProgrammedJobStatus(jobStatusForOt(ot)));
  if (!editableOts.length) return showToast("No hay trabajos editables en el plan");
  checkpointState();
  state.lockedOts = locked
    ? uniq([...state.lockedOts, ...editableOts])
    : state.lockedOts.filter((ot) => !editableOts.includes(ot));
  for (const op of state.operations) {
    if (!editableOts.includes(op.ot)) continue;
    op.locked = locked;
    op.log = appendLog(op.log, locked ? "OT_BLOQUEADA_MASIVO" : "OT_DESBLOQUEADA_MASIVO");
  }
  saveAndRenderQueueChange(locked ? "Todos los trabajos fueron bloqueados" : "Todos los trabajos fueron desbloqueados");
}

function reorderSelectedJobs(sourceOt, targetOt) {
  if (!sourceOt || !targetOt || sourceOt === targetOt) return;
  const sourceJob = getPriorityJobs().find((item) => item.ot === sourceOt);
  if (sourceJob?.programmed || sourceJob?.locked) {
    showToast(`OT ${sourceOt} esta bloqueada y no se puede mover`);
    return;
  }
  const order = [...state.selectedOts];
  const sourceIndex = order.indexOf(sourceOt);
  const targetIndex = order.indexOf(targetOt);
  if (sourceIndex < 0 || targetIndex < 0) return;
  const crossedFixed = order.slice(Math.min(sourceIndex, targetIndex), Math.max(sourceIndex, targetIndex) + 1)
    .some((ot) => ot !== sourceOt && (isJobLocked(ot) || isProgrammedJobStatus(jobStatusForOt(ot))));
  if (crossedFixed) {
    showToast("No puedes mover una OT a traves de un trabajo fijo");
    return;
  }
  checkpointState();
  order.splice(sourceIndex, 1);
  order.splice(order.indexOf(targetOt), 0, sourceOt);
  state.selectedOts = order;
  applyQueuePriorities();
  saveAndRenderQueueChange("Orden del plan actualizado");
}

function applyQueuePriorities() {
  let priority = 1;
  state.selectedOts.forEach((ot) => {
    if (isProgrammedJobStatus(jobStatusForOt(ot))) return;
    state.operations.filter((op) => op.ot === ot).forEach((op) => {
      op.prioridad = priority;
      op.log = appendLog(op.log, "PRIORIDAD_COLA_APP");
    });
    priority += 1;
  });
}

function openDetailPanel() {
  const panel = document.querySelector(".detail-panel");
  if (!panel) return;
  panel.hidden = false;
  document.body.classList.add("detail-panel-open");
}

function closeDetailPanel() {
  const panel = document.querySelector(".detail-panel");
  if (!panel) return;
  panel.hidden = true;
  document.body.classList.remove("detail-panel-open");
}

function renderSelectedJobPanel() {
  const job = getSelectedPriorityJob();
  if (!job) {
    els.selectedJobPanel.innerHTML = "";
    closeDetailPanel();
    return;
  }
  openDetailPanel();

  const selectedWorkOrder = workOrderForOt(job.ot);
  const dueDateOverridden = Boolean(selectedWorkOrder?.dueDateOverride);

  const toolGroups = getJobToolGroups(job.ops);
  const bendingOps = job.ops.filter(isBendingAppOperation);
  const hasBendingOperations = bendingOps.length > 0;
  const bulkMachineValue = getBulkMachineValue(job.ops);
  const machineOptions = getMachineOptions(job.ops);
  const otKit = getOtKitValue(job.ops);
  const otKitPending = !otKit && job.ops.filter(operationUsesOtKit).some((op) => op.kitPending === true);
  const toolSummary = toolGroups.length
    ? toolGroups.map((tool) => `<span class="tool-chip">${escapeHtml(tool.label)}<small>${tool.count} ops</small></span>`).join("")
    : `<span class="tool-chip empty">SIN HERRAMENTAL<small>${job.ops.length} ops</small></span>`;
  const bendingToolValues = uniq(bendingOps.map((op) => cleanToolValue(op.herramental)).filter(Boolean));
  const currentBendingTool = bendingToolValues.length === 1 ? bendingToolValues[0] : "";
  const articleToolOptions = uniq(state.toolCatalog
    .filter((item) => item.active !== false && normalizeStatus(item.part || item.parte) === normalizeStatus(job.parte))
    .map((item) => cleanToolValue(item.herramental)).filter(Boolean));
  const subcontractOps = job.ops.filter(isSubcontractAppOperation);
  const otConfiguration = otConfigurationFor(job.ot);
  const catalogSubcontract = subcontractOps.map(subcontractCatalogForAppOperation).find(Boolean);
  const currentSubcontractType = String(otConfiguration.subcontractType || catalogSubcontract?.name || "").trim().toUpperCase();
  const currentSubcontractDays = Number(otConfiguration.subcontractDays || catalogSubcontract?.days || 0);
  const subcontractTypeOptions = subcontractTypesForPart(job.parte)
    .map((item) => `<option value="${escapeHtml(item.name)}"${normalizeStatus(item.name) === normalizeStatus(currentSubcontractType) ? " selected" : ""}>${escapeHtml(item.name)}</option>`)
    .join("");
  const subcontractRows = subcontractOps.length ? `<div class="job-subcontract-row">
    <span><strong>${subcontractOps.length} operaciones</strong><small>Un valor para toda la OT</small></span>
    <select id="jobSubcontractType" aria-label="Tipo de subcontrato de OT ${escapeHtml(job.ot)}"><option value="">Tipo</option>${subcontractTypeOptions}</select>
    <input id="jobSubcontractDays" type="number" min="1" max="90" step="1" value="${escapeHtml(currentSubcontractDays || "")}" placeholder="Dias" aria-label="Dias de subcontrato de OT ${escapeHtml(job.ot)}" />
  </div>` : "";
  const firstQuantity = Number(job.quantity || job.ops.find((op) => Number(op.cantTotal) > 0)?.cantTotal || 0);
  const materialRows = job.materials.map((material) => `
    <div class="job-material-row" title="${escapeHtml(material.description || material.component)}">
      <span><strong>${escapeHtml(material.component)}</strong><small>${escapeHtml(material.description || "SIN DESCRIPCION")}</small></span>
      <span>${escapeHtml(material.unit || "-")}</span>
      <span>${escapeHtml(formatMaterialQuantity(material.required))}</span>
      <span>${escapeHtml(formatMaterialQuantity(material.issued))}</span>
      <span class="${Number(material.pending) > 0 ? "pending" : "complete"}">${escapeHtml(formatMaterialQuantity(material.pending))}</span>
    </div>
  `).join("");

  els.selectedJobPanel.innerHTML = `
    <article class="job-detail">
      <div class="job-detail-head">
        <div class="job-identity">
          <div>
            <strong>OT ${escapeHtml(job.ot)}</strong>
            <span title="${escapeHtml(job.parte || "SIN ARTICULO")}">${escapeHtml(job.parte || "SIN ARTICULO")}</span>
          </div>
        </div>
        <div class="job-detail-actions">
          <span class="pill ${priorityClass(job.prioridad)}">${escapeHtml(priorityLabel(job.prioridad))}</span>
          <button class="icon-button detail-lock${job.locked ? " locked" : ""}" type="button" data-detail-lock="${escapeHtml(job.ot)}" aria-label="${job.programmed ? `OT ${escapeHtml(job.ot)} fija por estatus programado` : `${job.locked ? "Desbloquear" : "Bloquear"} OT ${escapeHtml(job.ot)}`}" title="${job.programmed ? "Fija por estatus programado" : (job.locked ? "Desbloquear programacion" : "Bloquear programacion")}"${job.programmed ? " disabled" : ""}>
            <svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="1"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
          </button>
        </div>
      </div>
      <div class="job-facts job-detail-quick-facts">
        <div class="job-fact"><span>Cantidad</span><strong>${escapeHtml(firstQuantity)}</strong></div>
        <label class="job-fact job-delivery-fact"><span>Entrega</span><input id="jobDueDateInput" class="job-due-date${dueDateOverridden ? " is-overridden" : ""}" type="date" value="${escapeHtml(job.dueDate)}" aria-label="Fecha de entrega OT ${escapeHtml(job.ot)}" title="NetSuite: ${escapeHtml(formatOtDateValue(selectedWorkOrder?.dueDate))}"></label>
      </div>
      ${hasBendingOperations ? `<details class="job-resource-section">
        <summary><span>Maquina</span><strong>${escapeHtml(bulkMachineValue === "__MULTIPLE__" ? "VARIAS" : machineLabel(bulkMachineValue || "SIN MAQUINA"))}</strong></summary>
        <div class="job-section">
        <div class="job-machine-row">
          <select id="jobMachineSelect" class="job-machine-select" aria-label="Maquina de la OT ${escapeHtml(job.ot)}">
            ${bulkMachineValue === "__MULTIPLE__" ? `<option value="__MULTIPLE__">VARIAS MAQUINAS</option>` : ""}
            ${machineOptions.map((machine) => `<option value="${escapeHtml(machine)}"${machine === bulkMachineValue ? " selected" : ""}>${escapeHtml(machineLabel(machine))}</option>`).join("")}
          </select>
          <span class="assignment-scope">${bendingOps.length} ops de doblado</span>
        </div></div>
      </details>` : ""}
      ${hasBendingOperations ? `<details class="job-resource-section">
        <summary><span>Kit</span><strong>${escapeHtml(otKit || (otKitPending ? "REGISTRAR DESPUES" : "SIN KIT"))}</strong></summary>
        <div class="job-section">
        <div class="job-kit-row">
          <input id="jobKitInput" type="text" value="${escapeHtml(otKit)}" placeholder="Kit opcional" aria-label="Kit de la OT ${escapeHtml(job.ot)}"${otKitPending ? " disabled" : ""}>
          <label><input id="jobKitPending" type="checkbox"${otKitPending ? " checked" : ""}> Registrar despues</label>
        </div></div>
      </details>
      <details class="job-resource-section">
        <summary><span>Herramental</span><strong>${toolGroups.length} grupos</strong></summary>
        <div class="job-section">
        <label class="job-tool-editor"><span>Herramental para doblado</span><input id="jobToolInput" list="jobToolOptions" type="text" value="${escapeHtml(currentBendingTool)}" placeholder="${bendingToolValues.length > 1 ? "VARIOS HERRAMENTALES" : "Selecciona o captura"}" autocomplete="off"><datalist id="jobToolOptions">${articleToolOptions.map((tool) => `<option value="${escapeHtml(tool)}"></option>`).join("")}</datalist></label>
        <div class="tool-chip-row">${toolSummary}</div>
        </div>
      </details>` : ""}
      ${subcontractRows ? `<details class="job-resource-section"><summary><span>Subcontrato</span><strong>${escapeHtml(currentSubcontractType || "SIN TIPO")} · ${currentSubcontractDays || 0} dias</strong></summary><div class="job-section"><div class="job-subcontract-list">${subcontractRows}</div></div></details>` : ""}
      <details class="job-materials job-resource-section">
        <summary><span>Materiales <small>${job.materials.length} componentes</small></span><strong>${escapeHtml(job.materialBase ? `Base ${job.materialBase}` : "SIN MATERIAL")}</strong></summary>
        ${job.materials.length ? `
          <div class="job-material-header"><span>Componente</span><span>UM</span><span>Req.</span><span>Emit.</span><span>Pend.</span></div>
          <div class="job-material-list">${materialRows}</div>
        ` : `<div class="job-material-empty">Sin materiales reportados por NetSuite</div>`}
      </details>
      <div class="job-detail-operations-scroll">
        <div class="job-operations-title"><span>Operaciones</span><span>${job.ops.length} filas - ${formatMinutes(job.minutes)}</span></div>
        <div class="job-op-header"><span>Sec.</span><span>Operacion</span><span>CT</span><span>Tiempo</span><span>Estado</span></div>
        <div class="job-op-list">
        ${job.ops.map((op) => {
          const isToolChangeOp = normalizeStatus(op.tipoInsercion) === "CAMBIO_HERRAMENTAL" || /CAMBIO\s+(?:DE\s+)?HERRAMENTAL/.test(normalizeStatus(op.descripcion || op.log));
          const completed = isPlanCompletedOperation(op);
          const key = operationCompletionKey(op);
          const statusCell = isToolChangeOp ? "<span class=\"op-status\">-</span>"
            : `<span class="op-status${completed ? " completed-label" : ""}">${completed ? "Completada " : ""}${planStatusActionCell(op)}</span>`;
          return `
          <div class="job-op-row${completed && !isToolChangeOp ? " op-completed" : ""}" title="${escapeHtml(toolLabel(op))}">
            <span>${escapeHtml(op.secuencia)}</span>
            <span class="op-name">${escapeHtml(op.descripcion || op.tipoInsercion || "Operacion")}<small>CT ${escapeHtml(op.ct)}</small></span>
            <span>${escapeHtml(op.ct)}</span>
            <span class="op-time">${formatMinutes(operationDuration(op))}</span>
            <span class="op-status-cell">${statusCell}</span>
          </div>`;
        }).join("")}
        </div>
      </div>
    </article>
  `;

  els.selectedJobPanel.querySelector("[data-detail-lock]").addEventListener("click", (event) => {
    toggleJobLock(event.currentTarget.dataset.detailLock);
  });
  const dueDateInput = els.selectedJobPanel.querySelector("#jobDueDateInput");
  if (dueDateInput) dueDateInput.addEventListener("change", () => updateWorkOrderDueDate(job.ot, dueDateInput.value));
  const toolInput = els.selectedJobPanel.querySelector("#jobToolInput");
  if (toolInput) toolInput.addEventListener("change", () => {
    checkpointState();
    applyToolToJob(job.ot, toolInput.value);
    saveAndRender("Herramental de OT actualizado", "ot-config");
  });
  const bulkSelect = els.selectedJobPanel.querySelector("#jobMachineSelect");
  if (bulkSelect) {
    bulkSelect.addEventListener("change", (event) => {
      if (event.target.value === "__MULTIPLE__") return;
      checkpointState();
      applyMachineToJob(job.ot, event.target.value);
      saveAndRender("Maquina de OT actualizada", "ot-config");
    });
  }
  const kitInput = els.selectedJobPanel.querySelector("#jobKitInput");
  const kitPending = els.selectedJobPanel.querySelector("#jobKitPending");
  if (kitInput && kitPending) {
    kitInput.addEventListener("change", () => {
      checkpointState();
      applyKitToJob(job.ot, kitInput.value, false);
      saveAndRender("Kit de OT actualizado", "ot-config");
    });
    kitPending.addEventListener("change", () => {
      checkpointState();
      applyKitToJob(job.ot, kitInput.value, kitPending.checked);
      saveAndRender(kitPending.checked ? "Kit marcado para registrar despues" : "Kit de OT habilitado", "ot-config");
    });
  }
  const subcontractTypeInput = els.selectedJobPanel.querySelector("#jobSubcontractType");
  const subcontractDaysInput = els.selectedJobPanel.querySelector("#jobSubcontractDays");
  if (subcontractTypeInput && subcontractDaysInput) {
    const saveSubcontract = () => {
      checkpointState();
      const catalogItem = subcontractCatalogForSelection(job.parte, subcontractTypeInput.value);
      if (catalogItem && Number(subcontractDaysInput.value || 0) <= 0) subcontractDaysInput.value = String(Math.max(1, Number(catalogItem.days) || 1));
      applySubcontractToJob(job.ot, subcontractTypeInput.value, subcontractDaysInput.value);
      saveAndRender("Subcontrato de OT actualizado", "ot-config");
    };
    subcontractTypeInput.addEventListener("change", saveSubcontract);
    subcontractDaysInput.addEventListener("change", saveSubcontract);
  }
  bindPlanStatusActions(els.selectedJobPanel);
}

function renderGantt() {
  const groups = getGanttGroups();
  const window = getPlanWindow();
  const days = range(state.horizonDays).map((i) => addDays(window.start, i));
  const selectedOt = selectedJobOt();
  const zoomLevel = ganttZoomLevelForWidth(state.ganttDayWidth);
  const totalWindowMinutes = workWindowMinutes();

  els.ganttCanvas.innerHTML = "";
  const inner = document.createElement("div");
  inner.className = "gantt-inner";
  inner.style.setProperty("--gantt-days", String(state.horizonDays));
  inner.style.setProperty("--gantt-day-width", `${state.ganttDayWidth}px`);
  inner.style.setProperty("--gantt-grid-minor-size", `${zoomLevel.minorMinutes / totalWindowMinutes * 100}%`);
  inner.style.setProperty("--gantt-grid-major-size", `${zoomLevel.majorMinutes / totalWindowMinutes * 100}%`);
  inner.style.setProperty("--gantt-day-minor-size", `${zoomLevel.minorMinutes / WORK_DAY_MINUTES * 100}%`);
  inner.style.setProperty("--gantt-day-major-size", `${zoomLevel.majorMinutes / WORK_DAY_MINUTES * 100}%`);
  inner.style.minWidth = `${Math.max(980, 190 + state.horizonDays * state.ganttDayWidth)}px`;

  const header = document.createElement("div");
  header.className = "gantt-header";
  header.innerHTML = `<div>${escapeHtml(ganttHeaderLabel())}</div>${days
    .map((day) => `<div class="gantt-day-heading ${isGeneralWorkingDay(day) ? "" : "non-working"}"><span class="gantt-day-title">${formatDayHeader(day)}</span>${ganttTimeScaleHtml(zoomLevel)}</div>`)
    .join("")}`;
  inner.appendChild(header);

  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = "gantt-empty";
    empty.textContent = "Sin operaciones programadas";
    inner.appendChild(empty);
    els.ganttCanvas.appendChild(inner);
    return;
  }

  for (const group of groups) {
    const row = document.createElement("div");
    row.className = `gantt-row${group.type ? ` ${group.type}` : ""}${state.ganttView === "job" && group.ot === selectedOt ? " selected-operation" : ""}`;
    row.dataset.group = group.key;
    row.innerHTML = `<div class="gantt-row-label">${ganttGroupLabelHtml(group)}</div><div class="gantt-lane"></div>`;
    const lane = row.querySelector(".gantt-lane");
    if (group.type === "job-summary") {
      const summaryBar = createGanttSummaryBar(group, window);
      if (summaryBar) lane.appendChild(summaryBar);
      row.querySelector("[data-expand-ot]").addEventListener("click", () => toggleExpandedJob(group.ot));
    } else if (group.type === "ct-summary") {
      const summaryBar = createGanttSummaryBar(group, window);
      if (summaryBar) lane.appendChild(summaryBar);
      row.querySelector("[data-expand-ct]").addEventListener("click", () => toggleExpandedCt(group.key));
    } else {
      for (const op of group.ops) {
        const bar = createGanttBar(op, window);
        if (bar) lane.appendChild(bar);
      }
    }
    inner.appendChild(row);
  }

  els.ganttCanvas.appendChild(inner);
}

function ganttTimeScaleHtml(zoomLevel) {
  const ticks = [];
  for (let minute = 0; minute < WORK_DAY_MINUTES; minute += zoomLevel.labelMinutes) {
    const absoluteMinute = WORK_START_HOUR * 60 + minute;
    const hour = String(Math.floor(absoluteMinute / 60)).padStart(2, "0");
    const minuteText = String(absoluteMinute % 60).padStart(2, "0");
    const edgeClass = minute === 0 ? " first" : "";
    ticks.push(`<span class="gantt-time-tick${edgeClass}" style="left:${minute / WORK_DAY_MINUTES * 100}%">${hour}:${minuteText}</span>`);
  }
  return `<div class="gantt-time-scale" aria-label="Escala de tiempo cada ${escapeHtml(zoomLevel.label)}">${ticks.join("")}</div>`;
}

function changeGanttZoom(direction) {
  const current = GANTT_DAY_WIDTHS.indexOf(nearestGanttDayWidth(state.ganttDayWidth));
  const next = Math.max(0, Math.min(GANTT_DAY_WIDTHS.length - 1, current + direction));
  if (next === current) return;
  const centerRatio = els.ganttCanvas.scrollWidth > els.ganttCanvas.clientWidth
    ? (els.ganttCanvas.scrollLeft + els.ganttCanvas.clientWidth / 2) / els.ganttCanvas.scrollWidth
    : 0;
  state.ganttDayWidth = GANTT_DAY_WIDTHS[next];
  renderGantt();
  renderGanttDisplayControls();
  els.ganttCanvas.scrollLeft = Math.max(0, centerRatio * els.ganttCanvas.scrollWidth - els.ganttCanvas.clientWidth / 2);
  saveState();
}

function nearestGanttDayWidth(value) {
  const numeric = Number(value) || DEFAULT_GANTT_DAY_WIDTH;
  return GANTT_DAY_WIDTHS.reduce((nearest, width) =>
    Math.abs(width - numeric) < Math.abs(nearest - numeric) ? width : nearest
  , DEFAULT_GANTT_DAY_WIDTH);
}

function ganttZoomLevelForWidth(value) {
  const width = nearestGanttDayWidth(value);
  return GANTT_ZOOM_LEVELS.find((level) => level.dayWidth === width) || GANTT_ZOOM_LEVELS[1];
}

function ganttSnapMinutes() {
  return ganttZoomLevelForWidth(state.ganttDayWidth).snapMinutes;
}

function renderGanttDisplayControls() {
  const index = GANTT_DAY_WIDTHS.indexOf(nearestGanttDayWidth(state.ganttDayWidth));
  els.ganttZoomOut.disabled = index <= 0;
  els.ganttZoomIn.disabled = index >= GANTT_DAY_WIDTHS.length - 1;
  const zoomLevel = ganttZoomLevelForWidth(state.ganttDayWidth);
  els.ganttZoomValue.value = zoomLevel.label;
  els.ganttZoomValue.title = `Escala minima: ${zoomLevel.label}`;
}

function toggleGanttFullscreen(force) {
  const active = els.gantt.classList.contains("gantt-fullscreen");
  const next = typeof force === "boolean" ? force : !active;
  els.gantt.classList.toggle("gantt-fullscreen", next);
  document.body.classList.toggle("gantt-fullscreen-active", next);
  els.ganttFullscreenBtn.setAttribute("aria-pressed", String(next));
  els.ganttFullscreenBtn.setAttribute("aria-label", next ? "Salir de pantalla completa" : "Mostrar Gantt en pantalla completa");
  els.ganttFullscreenBtn.title = next ? "Salir de pantalla completa" : "Pantalla completa";
}

function ganttGroupLabelHtml(group) {
  if (group.type === "job-summary") {
    return `<button class="gantt-expand${group.expanded ? " expanded" : ""}" type="button" data-expand-ot="${escapeHtml(group.ot)}" aria-label="${group.expanded ? "Contraer" : "Expandir"} OT ${escapeHtml(group.ot)}"><svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button><div class="gantt-label-main"><strong>OT ${escapeHtml(group.ot)}</strong><span>${escapeHtml(group.subtitle)}</span></div>${group.locked ? `<span class="gantt-lock-mark" title="OT bloqueada"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="1"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span>` : ""}`;
  }
  if (group.type === "ct-summary") {
    return `<button class="gantt-expand${group.expanded ? " expanded" : ""}" type="button" data-expand-ct="${escapeHtml(group.key)}" aria-label="${group.expanded ? "Contraer" : "Expandir"} CT ${escapeHtml(group.label)}"><svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button><div class="gantt-label-main"><strong>CT ${escapeHtml(group.label)}</strong><span>${escapeHtml(group.subtitle)}</span></div>`;
  }
  if (group.type === "operation-row") {
    const op = group.ops[0];
    return `<span class="gantt-tree-branch" aria-hidden="true"></span><div class="gantt-label-main"><strong>(0/${escapeHtml(op.secuencia)}) ${escapeHtml(op.descripcion || "Operacion")}</strong><span>CT ${escapeHtml(op.ct)} - ${escapeHtml(op.operador || "SIN OPERADOR")}</span></div>`;
  }
  if (group.type === "operation-flat") {
    const op = group.ops[0];
    return `<div class="gantt-label-main"><strong>OT ${escapeHtml(op.ot)} / Sec ${escapeHtml(op.secuencia)}</strong><span>${escapeHtml(op.descripcion || "Operacion")} - CT ${escapeHtml(op.ct)} - ${escapeHtml(op.operador || "SIN OPERADOR")}</span></div>`;
  }
  return `<div class="gantt-label-main"><strong>${escapeHtml(group.label || group.key)}</strong><span>${escapeHtml(group.subtitle)}</span></div>`;
}

function toggleExpandedJob(ot) {
  state.expandedOts = state.expandedOts.includes(ot)
    ? state.expandedOts.filter((item) => item !== ot)
    : uniq([...state.expandedOts, ot]);
  renderGantt();
  saveState();
}
function toggleExpandedCt(key) {
  state.expandedCts = state.expandedCts.includes(key)
    ? state.expandedCts.filter((item) => item !== key)
    : uniq([...state.expandedCts, key]);
  renderGantt();
  saveState();
}

function createGanttSummaryBar(group, window) {
  const starts = group.ops.map(opStart).filter(Boolean);
  const ends = group.ops.map(opEnd).filter(Boolean);
  if (!starts.length || !ends.length) return null;
  const start = new Date(Math.min(...starts.map((date) => date.getTime())));
  const end = new Date(Math.max(...ends.map((date) => date.getTime())));
  const startMin = workMinuteOffset(start, window.start);
  const windowMinutes = workWindowMinutes();
  const endMin = Math.max(startMin + MIN_OPERATION_MINUTES, workMinuteOffset(end, window.start, "end"));
  const bar = document.createElement("div");
  const job = getPriorityJobs().find((item) => item.ot === group.ot);
  const typeClass = job ? jobTypeClass(jobDisplayType(job)) : "";
  const riskClassName = job ? riskClass(jobRiskLevel(job).level) : "";
  bar.className = `gantt-summary-bar ${typeClass} ${riskClassName}${group.locked ? " locked" : ""}`;
  bar.dataset.summaryOt = group.ot;
  bar.style.left = `${(startMin / windowMinutes) * 100}%`;
  bar.style.width = `${(Math.max(MIN_OPERATION_MINUTES, Math.min(endMin - startMin, windowMinutes - startMin)) / windowMinutes) * 100}%`;
  bar.style.setProperty("--job-color", jobBarColor(group.ot));
  bar.title = `OT ${group.ot}: ${formatDateTime(start)} a ${formatDateTime(end)}${group.locked ? " - BLOQUEADA" : ""}`;
  bar.innerHTML = `<strong>OT ${escapeHtml(group.ot)}</strong><span>${group.ops.length} ops${group.locked ? " - bloqueada" : ""}</span>`;
  return bar;
}

function createGanttBar(op, window) {
  const start = opStart(op);
  const end = opEnd(op);
  if (!start || !end) return null;

  const startMin = workMinuteOffset(start, window.start);
  const windowMinutes = workWindowMinutes();
  const endMin = Math.max(startMin + MIN_OPERATION_MINUTES, workMinuteOffset(end, window.start, "end"));
  const widthMin = Math.max(MIN_OPERATION_MINUTES, Math.min(endMin - startMin, windowMinutes - startMin));
  const left = (startMin / windowMinutes) * 100;
  const width = (widthMin / windowMinutes) * 100;

  const bar = document.createElement("div");
  bar.className = "gantt-bar";
  bar.dataset.id = op.id;
  bar.dataset.priorityBand = priorityClass(op.prioridad);
  bar.dataset.type = op.tipoInsercion;
  const isToolChange = normalizeStatus(op.tipoInsercion) === "CAMBIO_HERRAMENTAL";
  if (isToolChange) bar.classList.add("gantt-bar--tool-change");
  if (isJobLocked(op.ot)) bar.classList.add("locked");
  const job = getPriorityJobs().find((item) => item.ot === op.ot);
  if (job) {
    bar.classList.add(jobTypeClass(jobDisplayType(job)), riskClass(jobRiskLevel(job).level));
  }
  if (op.ot === findOperation(state.selectedOperationId)?.ot) bar.classList.add("in-sequence");
  const materialBase = materialBaseForOt(op.ot);
  const timing = globalThis.PlanningWorkflowCore.ganttOperationTiming(ganttProductiveMinutes(op, start, end), start, end);
  const tooltip = isToolChange ? [
    `Cambio de herramental - OT ${op.ot}`,
    `Maquina: ${op.maquina || "SIN MAQUINA"}`,
    `Origen: ${formatToolPair(op.toolChangeFromHerramental, op.toolChangeFromKit)}`,
    `Destino: ${formatToolPair(op.toolChangeToHerramental || op.herramental, op.toolChangeToKit || op.kitHerramental)}`,
    `Ajustador: ${op.operador || "SIN AJUSTADOR"}`,
    `Inicio: ${formatDateTime(start)}`,
    `Fin: ${formatDateTime(end)}`,
    `Duracion: ${timing.elapsedMinutes} min`,
  ] : [
    `${op.ot} / Sec ${op.secuencia} - CT ${op.ct} - ${op.operador}${materialBase ? ` - Material ${materialBase}` : ""}`,
    `Inicio: ${formatDateTime(start)}`,
    `Fin: ${formatDateTime(end)}`,
    `Minutos productivos: ${timing.productiveMinutes}`,
    `Minutos no operativos: ${timing.nonOperatingMinutes}`,
  ];
  if (Number(op.esperaMinutos || 0) > 0 || op.causaEspera || op.recursoEspera || op.otBloqueadora || op.secuenciaBloqueadora !== "" && op.secuenciaBloqueadora != null) {
    tooltip.push(`Espera: ${Math.max(0, Number(op.esperaMinutos) || 0)} min`);
    if (op.causaEspera) tooltip.push(`Causa de espera: ${op.causaEspera}`);
    if (op.recursoEspera) tooltip.push(`Recurso de espera: ${op.recursoEspera}`);
    if (op.otBloqueadora) tooltip.push(`OT bloqueadora: ${op.otBloqueadora}`);
    if (op.secuenciaBloqueadora !== "" && op.secuenciaBloqueadora != null) tooltip.push(`Secuencia bloqueadora: ${op.secuenciaBloqueadora}`);
  }
  bar.title = tooltip.join("\n");
  bar.innerHTML = isToolChange
    ? `<strong>Cambio de herramental</strong><span>OT ${escapeHtml(op.ot)} / ${timing.elapsedMinutes} min</span>`
    : `<strong>Sec ${escapeHtml(op.secuencia)}</strong><span>${escapeHtml(op.ot)} / ${timing.productiveMinutes} min productivos</span>`;
  bar.style.setProperty("--job-color", jobBarColor(op.ot));
  bar.style.left = `${left}%`;
  bar.style.width = `${width}%`;
  bar.addEventListener("pointerdown", startDrag);
  return bar;
}

function jobBarColor(ot) {
  const hash = String(ot || "").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return JOB_BAR_COLORS[hash % JOB_BAR_COLORS.length];
}

function startDrag(event) {
  const bar = event.currentTarget;
  const op = findOperation(bar.dataset.id);
  if (!op) return;
  if (isJobLocked(op.ot)) {
    showToast(`OT ${op.ot} bloqueada; desbloqueala para moverla`);
    return;
  }
  checkpointState();
  const lane = bar.parentElement;
  const ganttRect = els.ganttCanvas.getBoundingClientRect();
  const laneRect = lane.getBoundingClientRect();

  drag = {
    id: op.id,
    view: state.ganttView,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originalStart: opStart(op),
    originalEnd: opEnd(op),
    originalOffset: workMinuteOffset(opStart(op), getPlanWindow().start),
    windowStart: getPlanWindow().start,
    sequence: getJobSequence(op).map((sequenceOp) => ({
      id: sequenceOp.id,
      duration: operationDuration(sequenceOp),
    })),
    laneWidth: laneRect.width,
    ganttLeft: ganttRect.left,
    scrollLeft: els.ganttCanvas.scrollLeft,
    groups: getGanttGroups().map((group) => group.key),
  };
  drag.anchorIndex = drag.sequence.findIndex((item) => item.id === op.id);
  drag.anchorOffset = drag.sequence.slice(0, Math.max(0, drag.anchorIndex)).reduce((sum, item) => sum + item.duration, 0);
  drag.totalDuration = drag.sequence.reduce((sum, item) => sum + item.duration, 0);

  bar.setPointerCapture(event.pointerId);
  bar.classList.add("dragging");
  state.selectedOperationId = op.id;
  document.addEventListener("pointermove", moveDrag);
  document.addEventListener("pointerup", endDrag);
}

let _dragRaf = null;
let _lastDragEvent = null;

function moveDrag(event) {
  _lastDragEvent = event;
  if (_dragRaf) return;
  _dragRaf = requestAnimationFrame(() => {
    _dragRaf = null;
    const e = _lastDragEvent;
    if (!drag || !e) return;
    const op = findOperation(drag.id);
    if (!op) return;
    const window = { start: drag.windowStart };
    const dx = e.clientX - drag.startX + (els.ganttCanvas.scrollLeft - drag.scrollLeft);
    const windowMinutes = workWindowMinutes();
    const minuteDelta = snap((dx / drag.laneWidth) * windowMinutes, ganttSnapMinutes());
    const duration = Math.max(MIN_OPERATION_MINUTES, drag.totalDuration || diffMinutes(drag.originalStart, drag.originalEnd));
    const maxSequenceStart = Math.max(0, windowMinutes - Math.min(duration, windowMinutes));
    const maxAnchorOffset = Math.min(windowMinutes, maxSequenceStart + drag.anchorOffset);
    const newOffset = Math.max(0, Math.min(maxAnchorOffset, drag.originalOffset + minuteDelta));
    const newStart = dateFromWorkOffset(window.start, newOffset);
    const row = document.elementFromPoint(e.clientX, e.clientY)?.closest(".gantt-row");
    const targetGroup = row?.dataset.group;
    applyDraggedSequence(newStart, targetGroup);
    renderGantt();
    renderLoads();
    renderReports();
  });
}

function applyDraggedSequence(newAnchorStart, targetGroup) {
  if (!drag?.sequence?.length) return false;
  const windowStart = drag.windowStart;
  const anchorOffset = workMinuteOffset(newAnchorStart, windowStart);
  const windowMinutes = workWindowMinutes();
  const maxStartOffset = Math.max(0, windowMinutes - Math.min(drag.totalDuration, windowMinutes));
  let sequenceStartOffset = anchorOffset - drag.anchorOffset;
  sequenceStartOffset = Math.max(0, Math.min(maxStartOffset, sequenceStartOffset));
  let cursor = sequenceStartOffset;
  const sequenceIds = new Set(drag.sequence.map((item) => item.id));
  const occupied = state.operations
    .filter((op) => isJobScheduled(op.ot) && !isPlanCompletedOperation(op) && !sequenceIds.has(op.id) && opStart(op) && opEnd(op))
    .map((op) => ({
      operator: op.operador,
      machine: normalizeMachineValue(op.maquina, op),
      finite: isFiniteCapacityOperation(op),
      start: workMinuteOffset(opStart(op), windowStart),
      end: workMinuteOffset(opEnd(op), windowStart),
    }))
    .filter((slot) => slot.end > slot.start);
  const staged = [];
  const stagedOccupied = [...occupied];

  for (const item of drag.sequence) {
    const sequenceOp = findOperation(item.id);
    if (!sequenceOp) continue;
    const candidateOp = { ...sequenceOp };
    if (targetGroup && drag.view === "operator") candidateOp.operador = targetGroup;
    if (targetGroup && drag.view === "machine") candidateOp.maquina = targetGroup;
    const duration = Math.max(MIN_OPERATION_MINUTES, Math.ceil(item.duration));
    const capacitySlot = findCapacityOffset(candidateOp, cursor, duration, stagedOccupied);
    if (capacitySlot.conflict) {
      drag.capacityConflict = true;
      return false;
    }
    const scheduledOffset = capacitySlot.offset;
    const start = dateFromWorkOffset(windowStart, scheduledOffset);
    const end = dateFromWorkOffset(windowStart, scheduledOffset + duration, "end");
    staged.push({ sequenceOp, candidateOp, start, end });
    stagedOccupied.push({
      operator: candidateOp.operador,
      machine: normalizeMachineValue(candidateOp.maquina, candidateOp),
      finite: isFiniteCapacityOperation(candidateOp),
      start: scheduledOffset,
      end: scheduledOffset + duration,
    });
    cursor = scheduledOffset + duration;
  }

  for (const placement of staged) {
    if (targetGroup && drag.view === "operator") placement.sequenceOp.operador = placement.candidateOp.operador;
    if (targetGroup && drag.view === "machine") placement.sequenceOp.maquina = placement.candidateOp.maquina;
    setOperationStart(placement.sequenceOp, placement.start);
    setOperationEnd(placement.sequenceOp, placement.end);
    placement.sequenceOp.log = appendLog(placement.sequenceOp.log, "SECUENCIA_REPROGRAMADA_APP");
  }
  drag.capacityConflict = false;
  return true;
}

function findCapacityOffset(op, earliestOffset, duration, occupied) {
  const latestOffset = Math.max(0, workWindowMinutes() - duration);
  const snapMinutes = ganttSnapMinutes();
  const firstOffset = Math.max(0, Math.min(latestOffset, snap(earliestOffset, snapMinutes)));
  for (let candidate = firstOffset; candidate <= latestOffset; candidate += snapMinutes) {
    const end = candidate + duration;
    const hasConflict = occupied.some((slot) =>
      resourcesCompete(op, slot) && candidate < slot.end && end > slot.start
    );
    if (!hasConflict) return { offset: candidate, conflict: false };
  }
  return { offset: firstOffset, conflict: true };
}

function resourcesCompete(op, slot) {
  const operator = String(op.operador || "").trim();
  const machine = normalizeMachineValue(op.maquina, op);
  const sameOperator = isLoadBearingOperator(operator) && operator === slot.operator;
  const sameMachine = isFiniteCapacityOperation(op)
    && slot.finite
    && isBendingAppOperation(op)
    && machine
    && machine === slot.machine;
  return sameOperator || sameMachine;
}

function endDrag() {
  if (!drag) return;
  const movedOps = drag.sequence.map((item) => findOperation(item.id)).filter(Boolean);
  const mismatch = movedOps.filter((item) => !isAllowedOperatorForOperation(item, item.operador));
  if (drag.capacityConflict) {
    showToast("Movimiento no aplicado: no hay un hueco libre para toda la secuencia");
  } else if (mismatch.length) {
    for (const item of mismatch) {
      item.log = appendLog(item.log, `WARN operador fuera de matriz OP=${capabilityLabelForOperation(item)}`);
    }
    showToast(`${mismatch.length} operaciones fuera de matriz`);
  } else {
    showToast(`${movedOps.length} operaciones de la OT reprogramadas`);
  }
  document.removeEventListener("pointermove", moveDrag);
  document.removeEventListener("pointerup", endDrag);
  drag = null;
  saveAndRender("", "gantt");
}

function renderLoads() {
  const loads = getOperatorLoads(state.loadWeekStart, 7);
  els.loadWeekInput.value = state.loadWeekStart;
  const week = selectedWeekRange(state.loadWeekStart);
  els.loadWeekRange.textContent = `${formatShortDate(week.start)} - ${formatShortDate(addDays(week.end, -1))} ${week.start.getFullYear()}`;
  let rowNumber = 0;
  const groups = RESOURCE_CATEGORIES.map((category) => {
    const categoryRows = loads.filter((item) => resourceCategoryFor(item.operator) === category).map((item) => {
      rowNumber += 1;
      const severity = item.percent > 100 ? "danger" : item.percent < 85 ? "warn" : "";
      const profile = state.operatorProfiles[item.operator] || { name: item.operator, category };
      const loadCell = category === "FUERA_DE_PLAN"
        ? `<td class="load-percent inactive"><strong>-</strong><span>Fuera del plan</span></td>`
        : `<td class="load-percent ${severity}"><strong>${Math.round(item.percent)}%</strong><span>${formatHours(item.minutes)} / ${formatHours(item.available)}</span></td>`;
      return `<tr class="resource-row" draggable="true" data-resource-row="${escapeHtml(item.operator)}" data-resource-category="${category}" title="Arrastra para cambiar de categoria">
        <td>${rowNumber}</td>
        <td><input class="resource-person-input" data-resource="${escapeHtml(item.operator)}" type="text" value="${escapeHtml(profile.name || item.operator)}" aria-label="Nombre asignado al recurso ${escapeHtml(item.operator)}"></td>
        <td><div class="resource-cell"><strong title="Operador de la matriz de habilidades">${escapeHtml(item.operator)}</strong></div></td>
        ${loadCell}
      </tr>`;
    }).join("");
    return `<tbody class="resource-category-group" data-resource-category-drop="${category}"><tr class="load-area-heading"><th colspan="4">${escapeHtml(formatResourceCategoryLabel(category))}</th></tr>${categoryRows}</tbody>`;
  }).join("");
  els.loadList.innerHTML = `<thead><tr><th>ID</th><th>Nombre</th><th>Recurso</th><th>Carga</th></tr></thead>${groups}`;
  els.loadList.querySelectorAll(".resource-person-input").forEach((input) => {
    input.addEventListener("change", () => updateResourceProfile(input.dataset.resource, { name: input.value.trim() || input.dataset.resource }));
  });
  els.loadList.querySelectorAll("[data-resource-row]").forEach((row) => {
    row.addEventListener("dragstart", (event) => {
      resourceCategoryDrag = row.dataset.resourceRow;
      row.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", resourceCategoryDrag);
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      resourceCategoryDrag = null;
      clearResourceCategoryDropTargets();
    });
  });
  els.loadList.querySelectorAll("[data-resource-category-drop]").forEach((group) => {
    group.addEventListener("dragover", (event) => {
      if (!resourceCategoryDrag) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      clearResourceCategoryDropTargets();
      group.classList.add("drag-over");
    });
    group.addEventListener("dragleave", (event) => {
      if (!group.contains(event.relatedTarget)) group.classList.remove("drag-over");
    });
    group.addEventListener("drop", (event) => {
      event.preventDefault();
      const operator = event.dataTransfer.getData("text/plain") || resourceCategoryDrag;
      const category = group.dataset.resourceCategoryDrop;
      clearResourceCategoryDropTargets();
      resourceCategoryDrag = null;
      if (!state.operators.includes(operator) || resourceCategoryFor(operator) === category) return;
      updateResourceProfile(operator, { category });
    });
  });
}

function clearResourceCategoryDropTargets() {
  els.loadList.querySelectorAll(".resource-category-group.drag-over").forEach((group) => group.classList.remove("drag-over"));
}

function renderMatrix() {
  renderOperationCatalogSelect();
  const operators = state.operators;
  const capabilities = getCapabilityRows();
  const header = `<thead><tr>
      <th>Operacion / CT</th>
      <th>Capacidad</th>
      <th>Solapamiento %</th>
      <th>Eficiencia %</th>
      ${operators.map((operator) => `<th>
        <div class="operator-heading">
          <input class="operator-name-input" data-operator="${escapeHtml(operator)}" type="text" value="${escapeHtml(operator)}" aria-label="Nombre del operador ${escapeHtml(operator)}" title="Editar nombre del operador" spellcheck="false">
          <button class="matrix-delete operator-delete" type="button" data-remove-operator="${escapeHtml(operator)}" aria-label="Eliminar operador ${escapeHtml(operator)}" title="Eliminar operador">
            <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>
          </button>
        </div>
        <label class="operator-performance-field"><span>Rend. %</span><input class="operator-performance-input" type="number" min="1" max="300" step="5" data-operator="${escapeHtml(operator)}" value="${escapeHtml(operatorPerformanceForOperator(operator))}" aria-label="Rendimiento general de ${escapeHtml(operator)}"></label>
      </th>`).join("")}
    </tr></thead>`;
  const rows = [];

  for (const capability of capabilities) {
    const capacityMode = capacityModeForCapability(capability);
    const rule = state.operationRules[capability.key] || state.operationRules[capability.ct] || {};
    rows.push(`<tr>
      <td>
        <div class="capability-heading">
          <div><strong>${escapeHtml(capability.label)}</strong><span class="matrix-sub">CT ${escapeHtml(capability.ct)} - ${capability.count} ops en el plan</span></div>
          <button class="matrix-delete capability-delete" type="button" data-remove-capability="${escapeHtml(capability.key)}" aria-label="Eliminar operacion ${escapeHtml(capability.label)}" title="Eliminar de la matriz">
            <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>
          </button>
        </div>
      </td>
      <td class="capacity-mode-cell">
        <select class="capacity-mode-select" data-capacity-key="${escapeHtml(capability.key)}" aria-label="Capacidad de ${escapeHtml(capability.label)}">
          <option value="FINITA"${capacityMode === "FINITA" ? " selected" : ""}>Finita</option>
          <option value="NO_FINITA"${capacityMode === "NO_FINITA" ? " selected" : ""}>No finita</option>
        </select>
      </td>
      <td class="overlap-cell"><div class="percent-input"><input class="matrix-overlap-input" type="number" min="0" max="100" step="5" data-rule-key="${escapeHtml(capability.key)}" value="${escapeHtml(Math.round(Number(rule.overlap == null ? 1 : rule.overlap) * 100))}" aria-label="Solapamiento de ${escapeHtml(capability.label)} en porcentaje"><span>%</span></div></td>
      <td class="efficiency-cell"><div class="percent-input"><input class="matrix-efficiency-input" type="number" min="1" max="100" step="1" data-rule-key="${escapeHtml(capability.key)}" value="${escapeHtml(Math.max(1, Math.min(100, Number(rule.efficiency ?? rule.eficiencia) || 100)))}" aria-label="Eficiencia de ${escapeHtml(capability.label)} en porcentaje"><span>%</span></div></td>
      ${operators
      .map((operator) => {
        const enabled = isOperatorSkilledForCapability(capability, operator);
        return `<td class="skill-cell">
          <label class="matrix-skill-toggle" title="${enabled ? "Operador habilitado" : "Operador no habilitado"}">
            <input class="matrix-operator-check" type="checkbox" data-key="${escapeHtml(capability.key)}" data-operator="${escapeHtml(operator)}" aria-label="Habilitar ${escapeHtml(operator)} para ${escapeHtml(capability.label)}" aria-checked="${enabled ? "true" : "false"}"${enabled ? " checked" : ""}>
            <span class="matrix-checkmark" aria-hidden="true"></span>
          </label>
        </td>`;
      })
      .join("")}</tr>`);
  }

  els.matrixWrap.innerHTML = `<table class="matrix-table">${header}<tbody>${rows.join("")}</tbody></table>`;
  els.matrixWrap.querySelectorAll(".matrix-operator-check").forEach((input) => {
    input.addEventListener("change", () => {
      checkpointState();
      input.setAttribute("aria-checked", String(input.checked));
      const capability = getCapabilityRows().find((row) => row.key === input.dataset.key);
      toggleMatrix(input.dataset.key, input.dataset.operator, input.checked, capability);
      saveAndRender("Matriz actualizada", "matrix");
    });
  });
  els.matrixWrap.querySelectorAll(".matrix-overlap-input").forEach((input) => {
    input.addEventListener("change", () => {
      checkpointState();
      const percent = Math.max(0, Math.min(100, Number(input.value) || 0));
      updateOperationRule(input.dataset.ruleKey, { overlap: percent / 100 });
    });
  });
  els.matrixWrap.querySelectorAll(".matrix-efficiency-input").forEach((input) => {
    input.addEventListener("change", () => {
      checkpointState();
      const percent = Math.max(1, Math.min(100, Number(input.value) || 100));
      updateOperationRule(input.dataset.ruleKey, { efficiency: percent });
    });
  });
  els.matrixWrap.querySelectorAll(".operator-performance-input").forEach((input) => {
    input.addEventListener("change", () => {
      checkpointState();
      const percent = Math.max(1, Math.min(300, Number(input.value) || 100));
      state.operatorPerformance[input.dataset.operator] = percent;
      saveAndRender("Rendimiento del operador actualizado", "matrix");
    });
  });
  els.matrixWrap.querySelectorAll(".operator-name-input").forEach((input) => {
    input.addEventListener("change", () => renameOperator(input.dataset.operator, input.value));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
      if (event.key === "Escape") {
        input.value = input.dataset.operator;
        input.blur();
      }
    });
  });
  els.matrixWrap.querySelectorAll(".capacity-mode-select").forEach((select) => {
    select.addEventListener("change", () => {
      checkpointState();
      state.capacityModes[select.dataset.capacityKey] = normalizeCapacityMode(select.value);
      saveAndRender(`Capacidad ${select.value === "FINITA" ? "finita" : "no finita"} aplicada`, "matrix");
    });
  });
  els.matrixWrap.querySelectorAll("[data-remove-capability]").forEach((button) => {
    button.addEventListener("click", () => removeCapability(button.dataset.removeCapability));
  });
  els.matrixWrap.querySelectorAll("[data-remove-operator]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      removeOperator(button.dataset.removeOperator);
    });
  });
}

function renderOperationCatalogSelect() {
  const configured = new Set(getCapabilityRows().map((item) => capabilityKey(item.ct, item.label)));
  const available = (state.operationCatalog || []).filter((item) => (
    item.active !== false && !configured.has(capabilityKey(item.ct, item.label))
  ));
  els.newCtInput.innerHTML = [
    `<option value="">${available.length ? "Selecciona una operacion de NetSuite" : "No hay operaciones pendientes"}</option>`,
    ...available.map((item) => `<option value="${escapeHtml(item.key)}">CT ${escapeHtml(item.ct)} - ${escapeHtml(item.label)}</option>`),
  ].join("");
  els.newCtInput.disabled = available.length === 0;
  els.addCtBtn.disabled = available.length === 0;
}

function renderConfiguration() {
  renderToolCatalog();
  renderMachines();
  renderWorkSchedule();
  renderDailyBreaks();
  renderCalendarExceptions();
  renderSubcontracts();
  renderOtTypes();
  renderArticleConfigurations();
  renderWeeklyReleaseTarget();
}

function renderWeeklyReleaseTarget() {
  const target = Math.max(0, Number(state.settings?.weeklyReleaseTarget) || DEFAULT_WEEKLY_RELEASE_TARGET);
  els.weeklyReleaseTargetInput.value = target.toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function renderWorkSchedule() {
  const days = [
    ["MON", "Lunes"], ["TUE", "Martes"], ["WED", "Miercoles"], ["THU", "Jueves"],
    ["FRI", "Viernes"], ["SAT", "Sabado"], ["SUN", "Domingo"],
  ];
  els.workScheduleTable.innerHTML = `<thead><tr><th>Dia</th><th>Laboral</th><th>Inicio</th><th>Fin</th></tr></thead><tbody>${days.map(([key, label]) => {
    const item = state.workSchedule[key] || DEFAULT_WORK_SCHEDULE[key];
    return `<tr><td><strong>${label}</strong></td><td><input class="work-day-enabled" data-day="${key}" type="checkbox" aria-label="${label} laboral"${item.enabled !== false ? " checked" : ""}></td><td><input class="inline-edit work-day-start" data-day="${key}" type="time" value="${escapeHtml(item.start)}" aria-label="Inicio ${label}"${item.enabled === false ? " disabled" : ""}></td><td><input class="inline-edit work-day-end" data-day="${key}" type="time" value="${escapeHtml(item.end)}" aria-label="Fin ${label}"${item.enabled === false ? " disabled" : ""}></td></tr>`;
  }).join("")}</tbody>`;
  els.workScheduleTable.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      checkpointState();
      const key = input.dataset.day;
      const current = state.workSchedule[key] || deepClone(DEFAULT_WORK_SCHEDULE[key]);
      if (input.classList.contains("work-day-enabled")) current.enabled = input.checked;
      if (input.classList.contains("work-day-start")) current.start = input.value;
      if (input.classList.contains("work-day-end")) current.end = input.value;
      state.workSchedule[key] = current;
      saveAndRender("Horario laboral actualizado", "catalogs");
    });
  });
}

function renderDailyBreaks() {
  const rows = [
    ["MEAL", "Comida", "Detiene toda la planta diariamente"],
    ["PRODUCTION", "Pausa de produccion", "Evento diario para toda la planta"],
  ];
  els.dailyBreaksTable.innerHTML = `<thead><tr><th>Evento</th><th>Activo</th><th>Inicio</th><th>Fin</th></tr></thead><tbody>${rows.map(([key, label, note]) => {
    const item = state.dailyBreaks[key] || DEFAULT_DAILY_BREAKS[key];
    return `<tr><td><strong>${label}</strong><span class="status-note">${note}</span></td><td><input class="daily-break-enabled" data-break="${key}" type="checkbox" aria-label="Activar ${label}"${item.enabled ? " checked" : ""}></td><td><input class="inline-edit daily-break-start" data-break="${key}" type="time" value="${escapeHtml(item.start)}" aria-label="Inicio ${label}"></td><td><input class="inline-edit daily-break-end" data-break="${key}" type="time" value="${escapeHtml(item.end)}" aria-label="Fin ${label}"></td></tr>`;
  }).join("")}</tbody>`;
  els.dailyBreaksTable.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.break;
      const current = { ...(state.dailyBreaks[key] || DEFAULT_DAILY_BREAKS[key]) };
      if (input.classList.contains("daily-break-enabled")) current.enabled = input.checked;
      if (input.classList.contains("daily-break-start")) current.start = input.value;
      if (input.classList.contains("daily-break-end")) current.end = input.value;
      if (!current.start || !current.end || current.end <= current.start) {
        showToast("La hora final de la pausa debe ser posterior a la inicial");
        renderDailyBreaks();
        return;
      }
      checkpointState();
      state.dailyBreaks[key] = current;
      saveAndRender(`${key === "MEAL" ? "Horario de comida" : "Pausa de produccion"} actualizado`, "catalogs");
    });
  });
}

function toolCatalogValues(field, currentValue = "") {
  return uniq([
    ...state.toolCatalog
      .filter((item) => item.active !== false)
      .map((item) => cleanToolValue(item[field]))
      .filter(Boolean),
    cleanToolValue(currentValue),
  ].filter(Boolean)).sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
}

function catalogSelectOptions(values, currentValue, emptyLabel) {
  const current = cleanToolValue(currentValue);
  return `<option value="">${escapeHtml(emptyLabel)}</option>${values
    .map((value) => `<option value="${escapeHtml(value)}"${normalizeStatus(value) === normalizeStatus(current) ? " selected" : ""}>${escapeHtml(value)}</option>`)
    .join("")}<option value="${CUSTOM_CATALOG_VALUE}">+ Registrar nuevo</option>`;
}

function updateCatalogCustomInput(select, input) {
  const custom = select.value === CUSTOM_CATALOG_VALUE && !select.disabled;
  input.hidden = !custom;
  input.disabled = !custom;
  input.required = custom;
  if (!custom) input.value = "";
}

function selectedCatalogInputValue(select, input) {
  return cleanToolValue(select.value === CUSTOM_CATALOG_VALUE ? input.value : select.value);
}

function renderToolCatalog() {
  const currentPart = els.toolPartInput.value;
  const currentHerramental = els.toolHerrInput.value;
  const currentKit = els.toolKitInput.value;
  const assemblyItems = netSuiteAssemblyItems();
  els.toolPartInput.innerHTML = `<option value="">Selecciona un ensamble</option>${assemblyItems.map((item) => {
    const label = item.description ? `${item.part} - ${item.description}` : item.part;
    return `<option value="${escapeHtml(item.part)}">${escapeHtml(label)}</option>`;
  }).join("")}`;
  if (assemblyItems.some((item) => item.part === currentPart)) els.toolPartInput.value = currentPart;
  els.toolPartInput.disabled = assemblyItems.length === 0;
  const herramentales = toolCatalogValues("herramental");
  const kits = toolCatalogValues("kitHerramental");
  els.toolHerrInput.innerHTML = catalogSelectOptions(herramentales, currentHerramental, "Selecciona un herramental");
  els.toolKitInput.innerHTML = catalogSelectOptions(kits, currentKit, "Sin kit");
  if (currentHerramental === CUSTOM_CATALOG_VALUE) els.toolHerrInput.value = CUSTOM_CATALOG_VALUE;
  if (currentKit === CUSTOM_CATALOG_VALUE) els.toolKitInput.value = CUSTOM_CATALOG_VALUE;
  updateCatalogCustomInput(els.toolHerrInput, els.toolHerrNewInput);
  updateCatalogCustomInput(els.toolKitInput, els.toolKitNewInput);

  const rows = [...state.toolCatalog]
    .sort((a, b) => String(a.part || "").localeCompare(String(b.part || ""), "es", { numeric: true }))
    .map((item) => `<tr>
      <td>${escapeHtml(item.part)}</td>
      <td>${escapeHtml(item.herramental || "SIN HERRAMENTAL")}</td>
      <td>${escapeHtml(item.kitHerramental || "SIN KIT")}</td>
      <td>${escapeHtml(formatMinutes(item.toolSetupMinutes))}</td>
      <td>${escapeHtml(formatMinutes(item.kitSetupMinutes))}</td>
      <td><button class="table-action" type="button" data-delete-tool="${escapeHtml(item.id)}" aria-label="Eliminar configuracion">&times;</button></td>
    </tr>`).join("");
  els.toolCatalogTable.innerHTML = `<thead><tr><th>Parte</th><th>Herramental</th><th>Kit</th><th>Cambio herr.</th><th>Cambio kit</th><th></th></tr></thead><tbody>${rows || emptyTableRow(6, "Sin herramentales configurados")}</tbody>`;
  els.toolCatalogTable.querySelectorAll("[data-delete-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      state.toolCatalog = state.toolCatalog.filter((item) => item.id !== button.dataset.deleteTool);
      saveAndRender("Herramental retirado del catalogo", "catalogs");
    });
  });
}

function netSuiteAssemblyItems() {
  const items = new Map();
  for (const workOrder of state.workOrders) {
    const part = String(workOrder.item || "").trim();
    if (!part) continue;
    const key = normalizeStatus(part);
    if (!items.has(key)) items.set(key, { part, description: String(workOrder.description || "").trim() });
  }
  return [...items.values()].sort((a, b) => a.part.localeCompare(b.part, "es", { numeric: true }));
}

function renderMachines() {
  const rows = [...state.machines]
    .sort((a, b) => String(a.id || "").localeCompare(String(b.id || ""), "es", { numeric: true }))
    .map((item) => `<tr><td>${escapeHtml(item.id)}</td><td>${item.active === false ? "Inactiva" : "Activa"}</td><td><button class="table-action" type="button" data-delete-machine="${escapeHtml(item.id)}" aria-label="Eliminar maquina">&times;</button></td></tr>`)
    .join("");
  els.machineTable.innerHTML = `<thead><tr><th>Maquina</th><th>Estado</th><th></th></tr></thead><tbody>${rows || emptyTableRow(3, "Sin maquinas configuradas")}</tbody>`;
  els.machineTable.querySelectorAll("[data-delete-machine]").forEach((button) => {
    button.addEventListener("click", () => {
      state.machines = state.machines.filter((item) => item.id !== button.dataset.deleteMachine);
      saveAndRender("Maquina retirada del catalogo", "catalogs");
    });
  });
}

function renderCalendarExceptions() {
  const selectedMachine = els.calendarMachineInput.value;
  const machineIds = uniq(state.machines
    .filter((machine) => machine.active !== false)
    .map((machine) => String(machine.id || machine.machine || machine.maquina || "").trim().toUpperCase())
    .filter(Boolean))
    .sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
  els.calendarMachineInput.innerHTML = machineIds.length
    ? `<option value="">Selecciona una maquina</option>${machineIds.map((machine) => `<option value="${escapeHtml(machine)}">${escapeHtml(machine)}</option>`).join("")}`
    : `<option value="">Sin maquinas configuradas</option>`;
  if (machineIds.includes(selectedMachine)) els.calendarMachineInput.value = selectedMachine;
  updateCalendarForm(false);
  const rows = [...state.calendarExceptions]
    .sort((a, b) => String(a.startDate || "").localeCompare(String(b.startDate || "")) || String(a.machine || "").localeCompare(String(b.machine || "")))
    .map((item) => `<tr>
      <td>${escapeHtml(calendarConceptLabel(item.concept))}</td>
      <td>${escapeHtml(item.machine || "TODA LA PLANTA")}</td>
      <td>${escapeHtml(calendarPeriodLabel(item))}</td>
      <td>${escapeHtml(item.reason || "")}</td>
      <td><button class="table-action" type="button" data-delete-calendar="${escapeHtml(item.id)}" aria-label="Eliminar excepcion">&times;</button></td>
    </tr>`).join("");
  els.calendarTable.innerHTML = `<thead><tr><th>Concepto</th><th>Recurso</th><th>Periodo no laborable</th><th>Motivo</th><th></th></tr></thead><tbody>${rows || emptyTableRow(5, "Sin periodos no laborales")}</tbody>`;
  els.calendarTable.querySelectorAll("[data-delete-calendar]").forEach((button) => {
    button.addEventListener("click", () => {
      state.calendarExceptions = state.calendarExceptions.filter((item) => item.id !== button.dataset.deleteCalendar);
      saveAndRender("Excepcion retirada del calendario", "catalogs");
    });
  });
}

function updateCalendarForm(resetTimes = false) {
  const concept = els.calendarConceptInput.value;
  const usesMachine = concept === "MAQUINA";
  const usesPeriod = usesMachine || concept === "VACACIONES";
  const requiresTimes = concept === "GENERAL" || concept === "VACACIONES";
  els.calendarMachineField.hidden = !usesMachine;
  els.calendarMachineInput.required = usesMachine;
  els.calendarEndDateField.hidden = !usesPeriod;
  els.calendarEndDateInput.required = usesPeriod;
  els.calendarStartInput.required = requiresTimes;
  els.calendarEndInput.required = requiresTimes;
  els.calendarEndDateInput.min = els.calendarStartDateInput.value;
  if (!usesPeriod) els.calendarEndDateInput.value = els.calendarStartDateInput.value;
  if (usesPeriod && els.calendarStartDateInput.value && !els.calendarEndDateInput.value) els.calendarEndDateInput.value = els.calendarStartDateInput.value;
  if (resetTimes) {
    const defaultDay = state.workSchedule.MON || DEFAULT_WORK_SCHEDULE.MON;
    els.calendarStartInput.value = requiresTimes ? defaultDay.start : "";
    els.calendarEndInput.value = requiresTimes ? defaultDay.end : "";
  }
  const hints = {
    GENERAL: "Paro extraordinario de toda la planta en una fecha y horario definidos.",
    MAQUINA: "La maquina no estara disponible durante el intervalo; las horas son opcionales y, vacias, cubren los dias completos.",
    ASUETO: "Asueto de toda la planta; sin horas se considera el dia completo.",
    VACACIONES: "Periodo continuo que detiene operadores y maquinas desde la fecha y hora inicial hasta la final.",
  };
  els.calendarFormHint.textContent = hints[concept] || "";
}

function calendarConceptLabel(concept) {
  return ({ GENERAL: "General", MAQUINA: "Maquina", ASUETO: "Asueto", VACACIONES: "Periodo vacacional" })[concept] || concept;
}

function calendarPeriodLabel(item) {
  const start = item.start || "00:00";
  const end = item.end || "24:00";
  if (item.startDate === item.endDate) return `${item.startDate} ${start} - ${end}`;
  return `${item.startDate} ${start} a ${item.endDate} ${end}`;
}

function renderSubcontracts() {
  const rows = state.subcontracts.map((item) => `<tr><td>${escapeHtml(item.part || "*")}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.days)} dias</td><td><button class="table-action" type="button" data-delete-subcontract="${escapeHtml(item.id)}" aria-label="Eliminar subcontrato">&times;</button></td></tr>`).join("");
  els.subcontractTable.innerHTML = `<thead><tr><th>Parte</th><th>Tipo</th><th>Dias habiles</th><th></th></tr></thead><tbody>${rows || emptyTableRow(4, "Sin subcontratos configurados")}</tbody>`;
  els.subcontractTable.querySelectorAll("[data-delete-subcontract]").forEach((button) => {
    button.addEventListener("click", () => {
      state.subcontracts = state.subcontracts.filter((item) => item.id !== button.dataset.deleteSubcontract);
      saveAndRender("Regla de subcontrato eliminada", "catalogs");
    });
  });
}

function renderOtTypes() {
  const rows = state.otTypes.map((item) => `<tr>
    <td><strong>${escapeHtml(item.name)}</strong></td>
    <td>${item.active === false ? "Inactivo" : "Activo"}</td>
    <td><button class="button small secondary" type="button" data-toggle-ot-type="${escapeHtml(item.id)}">${item.active === false ? "Activar" : "Desactivar"}</button></td>
  </tr>`).join("");
  els.otTypeTable.innerHTML = `<thead><tr><th>Tipo</th><th>Estado</th><th></th></tr></thead><tbody>${rows || emptyTableRow(3, "Sin tipos de OT configurados")}</tbody>`;
  els.otTypeTable.querySelectorAll("[data-toggle-ot-type]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = state.otTypes.find((type) => type.id === button.dataset.toggleOtType);
      if (!item) return;
      item.active = item.active === false;
      saveAndRender(`Tipo ${item.name} ${item.active ? "activado" : "desactivado"}`, "catalogs");
    });
  });
}

function renderArticleConfigurations() {
  const selected = articleKeyForPart(els.articleConfigPartInput.value);
  const articles = netSuiteAssemblyItems();
  const configuredArticles = Object.values(state.articleConfigurations || {})
    .map((item) => ({ part: item.article, description: "" }));
  const allArticles = [...articles, ...configuredArticles]
    .filter((item) => item.part)
    .reduce((map, item) => {
      const key = articleKeyForPart(item.part);
      if (!map.has(key)) map.set(key, { part: key, description: item.description || "" });
      return map;
    }, new Map());
  els.articleConfigPartInput.innerHTML = `<option value="">Selecciona un articulo</option>${[...allArticles.values()]
    .sort((a, b) => a.part.localeCompare(b.part, "es", { numeric: true }))
    .map((item) => `<option value="${escapeHtml(item.part)}"${selected === item.part ? " selected" : ""}>${escapeHtml(item.part)}${item.description ? ` - ${escapeHtml(item.description)}` : ""}</option>`)
    .join("")}`;
  renderArticleTypeOptions();
  updateArticleConfigForm();
  const rows = Object.values(state.articleConfigurations || {})
    .sort((a, b) => String(a.article || "").localeCompare(String(b.article || ""), "es", { numeric: true }))
    .map((item) => `<tr>
      <td><strong>${escapeHtml(item.article)}</strong></td>
      <td>${escapeHtml(item.jobType || "")}</td>
      <td>${escapeHtml(item.planningType || "")}</td>
      <td><input class="article-temporary-price-input" data-article-price="${escapeHtml(item.article)}" type="number" min="0" step="0.01" value="${item.manualUnitPrice > 0 ? escapeHtml(item.manualUnitPrice) : ""}" aria-label="Precio temporal ${escapeHtml(item.article)}"></td>
      <td>${escapeHtml(item.updatedAt ? formatDateTime(new Date(item.updatedAt)) : "")}</td>
    </tr>`).join("");
  els.articleConfigTable.innerHTML = `<thead><tr><th>Articulo</th><th>Tipo comercial</th><th>Tipo trabajo</th><th>Precio temporal</th><th>Actualizado</th></tr></thead><tbody>${rows || emptyTableRow(5, "Sin configuracion de articulos")}</tbody>`;
  els.articleConfigTable.querySelectorAll("[data-article-price]").forEach((input) => {
    input.addEventListener("change", () => updateTemporaryArticlePrice(input.dataset.articlePrice, input.value));
  });
}

function ganttProductiveMinutes(op, start, end) {
  if (isSubcontractAppOperation(op)) return Math.max(MIN_OPERATION_MINUTES, diffMinutes(start, end));
  const configured = Number(op.tiempoSetup || 0) + adjustedProductionMinutes(op);
  return configured > 0 ? configured : Math.max(MIN_OPERATION_MINUTES, diffMinutes(start, end));
}

function updateTemporaryArticlePrice(article, value) {
  const config = articleConfigurationFor(article);
  const numeric = Number(value);
  config.manualUnitPrice = Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
  config.updatedAt = new Date().toISOString();
  saveAndRender(config.manualUnitPrice > 0 ? "Precio temporal actualizado" : "Precio temporal eliminado", "catalogs");
}

function renderArticleTypeOptions() {
  const commercialOptions = state.otTypes
    .filter((item) => item.active !== false)
    .map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`)
    .join("");
  els.articleConfigJobTypeInput.innerHTML = `<option value="">Selecciona</option>${commercialOptions}`;
  els.articleConfigPlanningTypeInput.innerHTML = `<option value="">Selecciona</option>${DEFAULT_PLANNING_TYPES
    .map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`)
    .join("")}`;
}

function updateArticleConfigForm() {
  const config = articleConfigurationValue(els.articleConfigPartInput.value);
  els.articleConfigJobTypeInput.value = config.jobType || "";
  els.articleConfigPlanningTypeInput.value = config.planningType || "";
  els.articleConfigPriceInput.value = config.manualUnitPrice > 0 ? String(config.manualUnitPrice) : "";
}

async function scheduleCurrentPlan() {
  if (planningActionsBusy) return showToast("La planificacion o sincronizacion ya esta en curso");
  setPlanningActionsBusy("schedule", true);
  try {
    return await scheduleCurrentPlanImpl();
  } finally {
    setPlanningActionsBusy("schedule", false);
  }
}

async function scheduleCurrentPlanImpl() {
  if (!window.PlannerCore?.schedulePlan) {
    showToast("El motor de programacion no esta disponible");
    return;
  }
  if (!state.selectedOts.length) {
    showToast("Agrega al menos una OT a la lista del plan");
    return;
  }
  const replannableOts = state.selectedOts.filter((ot) =>
    !isJobLocked(ot) && isMovablePlanningStatus(jobStatusForOt(ot)) && !hasClosedWorkOrderSyncWarning(ot)
  );
  if (!replannableOts.length) {
    showToast("No hay OTs desbloqueadas para programar");
    return;
  }
  const planningData = await ensurePlanningDataLoaded(true, { force: false });
  if (!planningData.ready) return;
  const readyOts = state.selectedOts.filter((ot) =>
    !isJobLocked(ot) && isMovablePlanningStatus(jobStatusForOt(ot)) && !hasClosedWorkOrderSyncWarning(ot)
  );
  if (!readyOts.length) {
    showToast("No hay OTs desbloqueadas para programar");
    return;
  }
  if (!await ensureSelectedJobsReadyForScheduling(readyOts)) return;
  const executionTime = new Date();
  const validation = validateScheduleConfiguration(executionTime);
  if (validation) {
    if (validation.operationId) state.selectedOperationId = validation.operationId;
    showToast(validation.message);
    showTab(validation.tab || "matrix");
    showWorkspaceView(validation.tab === "tools" ? "herramentales" : "matriz");
    return;
  }
  const originalSelectedOts = [...state.selectedOts];
  const engineSelectedOts = window.PlanningWorkflowCore.schedulingSelectedOts(state);
  checkpointState();
  state = window.PlanningWorkflowCore.prepareDraftForReschedule(state, readyOts);
  applyQueuePriorities();
  freezeElapsedOperations(executionTime);
  const label = els.scheduleBtn.querySelector("[data-schedule-label]");
  const originalLabel = label?.textContent || "Programar plan";
  els.scheduleBtn.disabled = true;
  els.scheduleBtn.classList.add("is-running");
  if (label) label.textContent = "Optimizando...";
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  const started = performance.now();
  try {
    const result = window.PlannerCore.schedulePlan({ ...state, selectedOts: engineSelectedOts }, {
      planStart: state.planStart,
      horizonDays: state.horizonDays,
      executionTime: executionTime.toISOString(),
    });
    const operatorConflicts = (result.lastSchedule?.diagnostics || [])
      .filter((item) => item.code === "OPERATOR_OVERLAP");
    if (operatorConflicts.length) {
      const conflict = operatorConflicts[0];
      throw new Error(`el operador ${conflict.operator} tiene operaciones simultaneas en OT ${conflict.relatedOt} y OT ${conflict.ot}`);
    }
    state = { ...result, selectedOts: originalSelectedOts };
    const summary = state.lastSchedule || {};
    const strategy = summary.optimization?.selectedStrategy || "balanced";
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    saveAndRender(`${summary.scheduled || 0} programadas; ${summary.unscheduled || 0} sin hueco; ${strategy} en ${seconds}s`);
    void persistPlanSnapshot().then((snapshot) => {
      if (!snapshot?.snapshotId) return;
      state.draftVersionId = snapshot.snapshotId;
      reportSnapshot = window.PlanningWorkflowCore.buildDraftSnapshot(state, snapshot.generatedAt || new Date().toISOString());
      renderPlanSnapshotSelect();
      renderReports();
      saveState("ui");
    }).catch((error) => showToast(`El plan se calculo, pero no se pudo guardar: ${error.message}`, 9000));
  } catch (error) {
    showToast(`No se pudo programar: ${error.message}`);
  } finally {
    els.scheduleBtn.disabled = false;
    els.scheduleBtn.classList.remove("is-running");
    if (label) label.textContent = originalLabel;
  }
}

async function ensureSelectedJobsReadyForScheduling(ots) {
  const jobs = new Map(getPriorityJobs().map((job) => [job.ot, job]));
  for (const ot of ots) {
    if (!window.PlanningWorkflowCore.isOtEligibleForDraft(state, ot)) continue;
    const job = jobs.get(ot);
    if (!job) continue;
    if (!job.ops.length) {
      showToast(`No se encontraron operaciones NetSuite para OT ${ot}`);
      return false;
    }
    const prepared = await prepareJobForPlanning(job);
    if (!prepared) return false;
    if (!window.PlanningWorkflowCore.isOtEligibleForDraft(state, ot)) continue;
  }
  return true;
}

async function ensureCommercialDataForPlan(ots) {
  const jobs = new Map(getPriorityJobs().map((job) => [job.ot, job]));
  for (const ot of ots) {
    const job = jobs.get(ot);
    if (!job) continue;
    const commercial = commercialPlanningRequirement(job);
    if (!commercial.needsType && !commercial.needsPlanningType) continue;
    const values = await showPlanningRequirements(job, [], commercial);
    if (!values) return false;
    checkpointState();
    applyCommercialPlanningRequirement(job, values, commercial);
  }
  return true;
}

async function persistPlanSnapshot() {
  const payload = window.PlanningWorkflowCore.buildDraftSnapshot(createAppSheetPayload(), new Date().toISOString());
  try {
    let saved;
    if (isAppsScriptRuntime()) {
      saved = await callAppsScript("saveDraftSnapshot", payload);
    } else {
      const response = await fetch(PLAN_SNAPSHOTS_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      saved = await response.json();
    }
    await loadPlanSnapshots(false);
    return saved;
  } catch (error) {
    if (window.PlanningWorkflowCore.isUnsupportedDraftSnapshotError(error)) {
      return payload;
    }
    showToast(`Plan generado; no se pudo guardar la instantanea: ${error.message}`);
    return null;
  }
}

async function publishCurrentPlan() {
  const scheduled = state.operations.filter((op) => isJobScheduled(op.ot) && !isPlanCompletedOperation(op));
  if (!scheduled.length) {
    showToast("Genera el plan antes de publicarlo");
    return;
  }
  els.publishPlanBtn.disabled = true;
  try {
    const payload = {
      ...createAppSheetPayload(),
      planStatus: "PUBLICADO",
      draftVersionId: state.draftVersionId || "",
      publishedAt: new Date().toISOString(),
    };
    const result = isAppsScriptRuntime()
      ? await callAppsScript("publishDraftPlan", payload)
      : { ok: true, activeVersion: await persistPlanSnapshot() };
    const active = result?.activeVersion || result;
    if (active?.snapshotId) {
      state.activePublishedVersionId = active.snapshotId;
      state.publishedVersions = [
        ...(state.publishedVersions || []).filter((item) => item.snapshotId !== active.snapshotId),
        { ...active, status: "PUBLICADO" },
      ];
      await loadPlanSnapshotById(active.snapshotId, { render: false, silent: true });
    }
    await saveAppSheet(false);
    saveAndRender("Plan publicado");
  } catch (error) {
    showToast(`No se pudo publicar: ${error.message}`);
  } finally {
    els.publishPlanBtn.disabled = false;
  }
}

async function generatePlanPdf() {
  const originalLabel = els.pdfBtn.innerHTML;
  els.pdfBtn.disabled = true;
  els.pdfBtn.setAttribute("aria-busy", "true");
  els.pdfBtn.textContent = "Generando...";
  try {
    const showLoadingToast = (message) => {
    showToast(message);
    document.querySelector("#toast")?.classList.add("toast-loading");
  };
    const hideLoadingToast = () => {
    document.querySelector("#toast")?.classList.remove("toast-loading");
  };
    const usingDraft = reportSnapshot?.snapshotId === "draft" || els.planSnapshotSelect.value === "draft";
    let snapshotId = usingDraft ? "" : reportSnapshot?.snapshotId;
  if (!usingDraft && !snapshotId && planSnapshots.length > 0) {
    const publishedIds = publishedSnapshotIds();
    const draftSnapshots = planSnapshots.filter((s) => !publishedIds.has(s.snapshotId));
    const publishedSnapshots = planSnapshots.filter((s) => publishedIds.has(s.snapshotId));
    if (draftSnapshots.length === 1 && publishedSnapshots.length === 0) {
      snapshotId = draftSnapshots[0].snapshotId;
    } else if (publishedSnapshots.length === 1 && draftSnapshots.length === 0) {
      snapshotId = publishedSnapshots[0].snapshotId;
    } else if (draftSnapshots.length > 0 && publishedSnapshots.length > 0) {
      const options = [...draftSnapshots, ...publishedSnapshots].map((s) => {
        const type = publishedIds.has(s.snapshotId) ? "PUBLICADO" : "BORRADOR";
        const gen = s.generatedAt ? formatDateTime(new Date(s.generatedAt)) : "Sin fecha";
        return { snapshotId: s.snapshotId, label: `${type} - ${gen} - ${s.planStart || "sin inicio"} - ${s.operations || 0} ops` };
      });
      const dialogOptions = options.map((o) => `<option value="${escapeHtml(o.snapshotId)}">${escapeHtml(o.label)}</option>`).join("");
      const result = await openPlanningDialog({
        title: "Generar PDF del plan",
        summary: "Hay varios planes guardados. Selecciona cual quieres usar para el PDF:",
        body: `<label>Plan disponible<select name="snapshot_id" required>${dialogOptions}</select></label>`,
        confirmLabel: "Generar PDF",
        cancelVisible: true,
      });
      if (!result) return;
      snapshotId = result.snapshot_id;
    }
  }
  if (!usingDraft && !snapshotId) {
    const scheduled = state.operations.filter((op) => isJobScheduled(op.ot) && !isPlanCompletedOperation(op));
    if (!scheduled.length) {
      showToast("Genera el plan antes de crear el PDF");
      return;
    }
    const snapshot = await persistPlanSnapshot();
    if (snapshot?.snapshotId) snapshotId = snapshot.snapshotId;
  }
  if (usingDraft) {
    reportSnapshot = { snapshotId: "draft", generatedAt: "", planStart: state.planStart, operations: window.PlanningWorkflowCore.draftScheduledOperations(state).map((op) => ({ ...op })) };
  } else if (snapshotId) await loadPlanSnapshotById(snapshotId, { render: false, silent: true });
  if (!reportSnapshot?.operations?.length) {
    reportSnapshot = { operations: state.operations.filter((op) => isJobScheduled(op.ot) && !isPlanCompletedOperation(op)).map((op, index) => ({ ...op, num: index + 1 })) };
    if (!reportSnapshot.operations.length) { showToast("No hay operaciones programadas para el PDF"); return; }
  }
  showWorkspaceView("reportes", "week");
  state.reportWeekStart = normalizeWeekStartValue(state.planStart || state.reportWeekStart);
  syncReportFilterDates(state.reportWeekStart);
  renderReports();
  document.body.dataset.printContext = "plan";
  showToast("Usa Guardar como PDF en la ventana de impresion");
  await new Promise((resolve) => window.setTimeout(resolve, 50));
  window.print();
  } catch (error) {
    showToast(`No se pudo generar el PDF: ${error.message}`);
  } finally {
    els.pdfBtn.disabled = false;
    els.pdfBtn.removeAttribute("aria-busy");
    els.pdfBtn.innerHTML = originalLabel;
  }
}

function validateScheduleConfiguration(executionTime) {
  const operations = state.operations.filter((op) =>
    isJobSelected(op.ot) &&
    !isPlanCompletedOperation(op) &&
    !isJobLocked(op.ot) &&
    !shouldAutoFreezeOperation(op, executionTime) &&
    op.tipoInsercion !== "CAMBIO_HERRAMENTAL"
  );
  const issues = window.PlannerCore?.planningConfigurationIssues
    ? window.PlannerCore.planningConfigurationIssues(state, operations)
    : [];
  if (issues.length) {
    const issue = issues[0];
    const capability = issue.capability || capabilityFromOperation(findOperation(issue.operationId) || {});
    const messages = {
      MISSING_CAPABILITY: `Falta agregar la operacion ${capability.label} (CT ${capability.ct}) a la matriz de habilidades`,
      MISSING_OPERATOR: `Falta habilitar un operador para ${capability.label} (CT ${capability.ct})`,
      MISSING_MACHINE: `Falta seleccionar maquina de doblado para OT ${issue.ot}, sec ${issue.sequence}`,
      MISSING_TOOL: `Falta herramental para OT ${issue.ot}, sec ${issue.sequence}`,
      MISSING_TOOL_CHANGE_CAPABILITY: "Falta agregar CAMBIO DE HERRAMENTAL a la matriz de habilidades",
      MISSING_TOOL_CHANGE_OPERATOR: "Falta habilitar un operador para CAMBIO DE HERRAMENTAL en la matriz de habilidades",
      MISSING_SUBCONTRACT_TYPE: `Falta seleccionar el tipo de subcontrato para OT ${issue.ot}, sec ${issue.sequence}`,
      MISSING_SUBCONTRACT_DAYS: `Falta definir dias de subcontrato para OT ${issue.ot}, sec ${issue.sequence}`,
    };
    return {
      operationId: issue.operationId,
      tab: ["MISSING_MACHINE", "MISSING_TOOL"].includes(issue.code) ? "tools" : "matrix",
      message: messages[issue.code] || "Falta completar la configuracion del plan",
    };
  }
  for (const op of operations) {
    const capability = capabilityFromOperation(op);
    const catalog = toolCatalogForAppOperation(op);
    const subcontractDays = subcontractDaysForAppOperation(op);
    const isSubcontract = isSubcontractAppOperation(op);
    if (isSubcontract && !String(op.subcontractType || "").trim()) {
      return { operationId: op.id, tab: "rules", message: `Define el tipo de subcontrato para ${capability.label}` };
    }
    if (isSubcontract && subcontractDays.days <= 0) {
      return { operationId: op.id, tab: "rules", message: `Define los dias de subcontrato para ${capability.label}` };
    }
  }
  return null;
}

function freezeElapsedOperations(executionTime) {
  for (const op of state.operations) {
    if (!isJobSelected(op.ot) || isPlanCompletedOperation(op) || isJobLocked(op.ot)) continue;
    if (!shouldAutoFreezeOperation(op, executionTime)) continue;
    op.autoFrozen = true;
    op.log = appendLog(op.log, "CONGELADA_AL_EJECUTAR_PLAN");
  }
}

function shouldAutoFreezeOperation(op, executionTime) {
  if (op.autoFrozen === true) return true;
  if (!executionTime || !String(op.log || "").includes("PROGRAMADO_PLANNER_CORE")) return false;
  const start = opStart(op);
  return Boolean(start && start <= executionTime);
}

function toolCatalogForAppOperation(op) {
  if (!isBendingAppOperation(op)) return null;
  const candidates = state.toolCatalog.filter((item) => item.active !== false && normalizeStatus(item.part || item.parte) === normalizeStatus(op.parte));
  const herramental = cleanToolValue(op.herramental);
  const kit = cleanToolValue(op.kitHerramental);
  return candidates.find((item) => cleanToolValue(item.herramental) === herramental && cleanToolValue(item.kitHerramental) === kit)
    || candidates.find((item) => herramental && cleanToolValue(item.herramental) === herramental)
    || candidates.find((item) => kit && cleanToolValue(item.kitHerramental) === kit)
    || candidates[0]
    || null;
}

function subcontractDaysForAppOperation(op) {
  const catalogRule = subcontractCatalogForAppOperation(op);
  return {
    days: Number(op.subcontractDays || 0),
    catalogRule,
  };
}

function subcontractCatalogForAppOperation(op) {
  const candidates = subcontractCatalogCandidatesForPart(op.parte);
  const selectedType = normalizeStatus(op.subcontractType);
  if (selectedType) {
    const selected = candidates.find((item) => normalizeStatus(item.name) === selectedType);
    if (selected) return selected;
  }
  const partKey = normalizeStatus(op.parte);
  const exact = candidates.filter((item) => normalizeStatus(item.part) === partKey);
  return exact.length === 1 ? exact[0] : null;
}

function subcontractCatalogCandidatesForPart(part) {
  const partKey = normalizeStatus(part);
  return state.subcontracts
    .filter((item) => item.active !== false && ["", "*", partKey].includes(normalizeStatus(item.part || "*")))
    .sort((a, b) => Number(normalizeStatus(b.part) === partKey) - Number(normalizeStatus(a.part) === partKey));
}

function subcontractCatalogForSelection(part, type) {
  const typeKey = normalizeStatus(type);
  return subcontractCatalogCandidatesForPart(part).find((item) => normalizeStatus(item.name) === typeKey) || null;
}

function subcontractTypesForPart(part) {
  const seen = new Set();
  return subcontractCatalogCandidatesForPart(part).filter((item) => {
    const key = normalizeStatus(item.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function subcontractRegistrationForJob(ot, operations = []) {
  const jobOperations = operations.length ? operations : state.operations.filter((op) => op.ot === ot);
  const subcontractOperations = jobOperations.filter(isSubcontractAppOperation);
  if (!subcontractOperations.length) return null;

  const configuration = state.otConfigurations?.[String(ot || "").trim()] || {};
  const configuredType = String(configuration.subcontractType || "").trim().toUpperCase();
  const configuredDays = Math.max(0, Math.round(Number(configuration.subcontractDays) || 0));
  if (configuredType && configuredDays > 0) return { name: configuredType, days: configuredDays, source: "OT" };

  const operationConfiguration = subcontractOperations.find((op) => op.subcontractType && Number(op.subcontractDays) > 0);
  if (operationConfiguration) {
    return {
      name: String(operationConfiguration.subcontractType).trim().toUpperCase(),
      days: Math.max(1, Math.round(Number(operationConfiguration.subcontractDays))),
      source: "OT",
    };
  }

  const part = String(subcontractOperations[0]?.parte || workOrderForOt(ot)?.item || "").trim();
  const partKey = normalizeStatus(part);
  const exact = state.subcontracts.filter((item) =>
    item.active !== false &&
    normalizeStatus(item.part) === partKey &&
    Number(item.days) > 0
  );
  if (!exact.length) return null;
  const selected = exact.length === 1 ? exact[0] : null;
  return selected ? { name: selected.name, days: Math.max(1, Math.round(Number(selected.days))), source: "ARTICULO" } : null;
}

function isSubcontractAppOperation(op) {
  const description = normalizeStatus(`${op.descripcion || ""} ${op.contenido || ""}`);
  const namedExternalOperation = ["SUBCONTRATO", "CROMADO", "METOKOTE", "MAKA", "GALVANIZADO"]
    .some((name) => description.includes(name));
  return String(op.tipoInsercion || "").toUpperCase() === "SUBCONTRATO" ||
    String(op.ct || "") === "6462" ||
    namedExternalOperation ||
    Boolean(window.PlannerCore?.isSubcontractOperation?.(state, op));
}

function checkpointState() {
  const snap = typeof structuredClone === "function" ? structuredClone(state) : JSON.parse(JSON.stringify(state));
  stateHistory.push(snap);
  if (stateHistory.length > 20) stateHistory.shift();
}

function undoLastChange() {
  const previous = stateHistory.pop();
  if (!previous) return;
  state = typeof previous === "string" ? JSON.parse(previous) : previous;
  normalizeState();
  saveAndRender("Ultimo cambio deshecho");
}

function addToolCatalogItem() {
  const part = els.toolPartInput.value.trim();
  const herramental = selectedCatalogInputValue(els.toolHerrInput, els.toolHerrNewInput);
  const kitHerramental = selectedCatalogInputValue(els.toolKitInput, els.toolKitNewInput);
  const toolSetupValue = els.toolSetupInput.value.trim();
  const kitSetupValue = els.kitSetupInput.value.trim();
  if (!part) return showToast("Selecciona un articulo de ensamble de NetSuite");
  if (!herramental) return showToast("Selecciona o registra el herramental");
  if (toolSetupValue === "" || kitSetupValue === "") return showToast("Captura ambos tiempos de cambio");
  const toolSetupMinutes = Number(toolSetupValue);
  const kitSetupMinutes = Number(kitSetupValue);
  if (!Number.isFinite(toolSetupMinutes) || toolSetupMinutes < 0 || !Number.isFinite(kitSetupMinutes) || kitSetupMinutes < 0) {
    return showToast("Los tiempos de cambio deben ser numeros mayores o iguales a cero");
  }
  const duplicate = state.toolCatalog.some((item) => item.active !== false
    && normalizeStatus(item.part || item.parte) === normalizeStatus(part)
    && normalizeStatus(item.herramental) === normalizeStatus(herramental)
    && normalizeStatus(item.kitHerramental) === normalizeStatus(kitHerramental));
  if (duplicate) return showToast("Esta combinacion de articulo, herramental y kit ya existe");
  const next = {
    id: uid("tool"),
    part,
    herramental,
    kitHerramental,
    toolSetupMinutes,
    kitSetupMinutes,
    active: true,
  };
  state.toolCatalog.push(next);
  [els.toolHerrInput, els.toolHerrNewInput, els.toolKitInput, els.toolKitNewInput, els.toolSetupInput, els.kitSetupInput].forEach((input) => { input.value = ""; });
  updateCatalogCustomInput(els.toolHerrInput, els.toolHerrNewInput);
  updateCatalogCustomInput(els.toolKitInput, els.toolKitNewInput);
  saveAndRender("Herramental y kit agregados", "catalogs");
}

function addMachine() {
  const id = els.machineNameInput.value.trim().toUpperCase();
  if (!id) return showToast("Captura la maquina");
  if (state.machines.some((item) => normalizeHeader(item.id) === normalizeHeader(id))) return showToast("La maquina ya existe");
  state.machines.push({ id, active: true });
  els.machineNameInput.value = "";
  saveAndRender("Maquina agregada", "catalogs");
}

function addCalendarException() {
  const concept = els.calendarConceptInput.value;
  const machine = concept === "MAQUINA" ? els.calendarMachineInput.value.trim().toUpperCase() : "";
  const reason = els.calendarReasonInput.value.trim();
  const startDate = els.calendarStartDateInput.value;
  const usesPeriod = concept === "MAQUINA" || concept === "VACACIONES";
  const endDate = usesPeriod ? els.calendarEndDateInput.value : startDate;
  const start = els.calendarStartInput.value || "00:00";
  const end = els.calendarEndInput.value || "24:00";
  if (!reason) return showToast("Captura el motivo del periodo no laborable");
  if (!startDate) return showToast("Selecciona la fecha inicial");
  if (usesPeriod && !endDate) return showToast("Selecciona la fecha final");
  if (endDate < startDate) return showToast("La fecha final no puede ser anterior a la inicial");
  if (concept === "MAQUINA" && !machine) return showToast("Selecciona una maquina del catalogo");
  if ((concept === "GENERAL" || concept === "VACACIONES") && (!els.calendarStartInput.value || !els.calendarEndInput.value)) {
    return showToast("Captura la hora inicial y final");
  }
  if (startDate === endDate && end <= start) return showToast("La hora final debe ser posterior a la inicial");
  checkpointState();
  state.calendarExceptions.push({
    id: uid("cal"), concept, machine, startDate, endDate, start, end, reason, active: true,
  });
  els.calendarReasonInput.value = "";
  els.calendarStartDateInput.value = "";
  els.calendarEndDateInput.value = "";
  updateCalendarForm(true);
  saveAndRender("Periodo no laborable agregado", "catalogs");
}

function addSubcontract() {
  const part = String(els.subcontractPartInput.value || "*").trim().toUpperCase() || "*";
  const name = els.subcontractNameInput.value.trim().toUpperCase();
  if (!name) return showToast("Captura el tipo de subcontrato");
  if (state.subcontracts.some((item) => normalizeStatus(item.part || "*") === normalizeStatus(part) && normalizeStatus(item.name) === normalizeStatus(name))) {
    return showToast("Ya existe ese tipo de subcontrato para la parte");
  }
  state.subcontracts.push({ id: uid("sub"), part, name, days: Math.max(1, Number(els.subcontractDaysInput.value) || 3), active: true });
  els.subcontractPartInput.value = "*";
  els.subcontractNameInput.value = "";
  saveAndRender("Subcontrato agregado", "catalogs");
}

function addOtType() {
  const name = String(els.otTypeNameInput.value || "").trim().toUpperCase();
  if (!name) return showToast("Captura el tipo de OT");
  const existing = state.otTypes.find((item) => normalizeStatus(item.name) === normalizeStatus(name));
  if (existing) {
    existing.active = true;
    els.otTypeNameInput.value = "";
    return saveAndRender(`Tipo ${name} activado`, "catalogs");
  }
  state.otTypes.push({ id: uid("tipo"), name, active: true });
  els.otTypeNameInput.value = "";
  saveAndRender(`Tipo ${name} agregado`, "catalogs");
}

function saveArticleConfiguration() {
  const article = articleKeyForPart(els.articleConfigPartInput.value);
  if (!article) return showToast("Selecciona un articulo");
  const jobType = String(els.articleConfigJobTypeInput.value || "").trim().toUpperCase();
  const planningType = String(els.articleConfigPlanningTypeInput.value || "").trim().toUpperCase();
  if (!jobType) return showToast("Selecciona el tipo comercial");
  if (!planningType) return showToast("Selecciona el tipo de trabajo");
  checkpointState();
  const config = articleConfigurationFor(article);
  config.jobType = jobType;
  config.planningType = planningType;
  config.manualUnitPrice = Math.max(0, Number(els.articleConfigPriceInput.value) || 0);
  config.updatedAt = new Date().toISOString();
  saveAndRender(`Configuracion de ${article} actualizada`, "catalogs");
}

function updateOperationRule(key, patch) {
  state.operationRules[key] = { ...(state.operationRules[key] || { overlap: 1, efficiency: 100, keywords: "" }), ...patch };
  saveAndRender("Regla de operacion actualizada", "matrix");
}

function emptyTableRow(columns, message) {
  return `<tr><td colspan="${columns}" class="status-note">${escapeHtml(message)}</td></tr>`;
}

async function openRestoreDraftDialog() {
  if (netSuiteSyncInFlight || netSuitePlanningSyncInFlight) return showToast("La sincronizacion de NetSuite ya esta en curso");
  if (planningActionsBusy) return showToast("La planificacion o sincronizacion ya esta en curso");
  setPlanningActionsBusy("restore", true);
  try {
    const snapshots = isAppsScriptRuntime()
      ? await callAppsScript("listPlanSnapshots")
      : await fetchJson(PLAN_SNAPSHOTS_API);
    planSnapshots = (Array.isArray(snapshots) ? snapshots : [])
      .sort((a, b) => String(b.publishedAt || b.generatedAt || "").localeCompare(String(a.publishedAt || a.generatedAt || "")));
  } catch (error) {
    showToast(`No se pudieron leer los planes publicados: ${error.message}`);
    return;
  } finally {
    setPlanningActionsBusy("restore", false);
  }
  const publishedIds = publishedSnapshotIds();
  const published = planSnapshots.filter((snapshot) => snapshot.snapshotId !== "draft" && publishedIds.has(snapshot.snapshotId));
  if (!published.length) return showToast("No hay planes publicados historicos para restaurar");
  const options = published.map((snapshot, index) => {
    const when = snapshot.publishedAt || snapshot.generatedAt;
    const user = snapshot.publishedBy || snapshot.createdBy || snapshot.user || "usuario";
    const operations = Array.isArray(snapshot.operations) ? snapshot.operations.length : Number(snapshot.operations || 0);
    return `<label class="restore-draft-option"><input type="radio" name="snapshot_id" value="${escapeHtml(snapshot.snapshotId)}" ${index === 0 ? "checked" : ""} required><span><strong>${escapeHtml(when ? formatDateTime(new Date(when)) : "Sin fecha")}</strong><small>${escapeHtml(user)} · Inicio ${escapeHtml(snapshot.planStart || "sin fecha")} · ${operations} operaciones</small></span></label>`;
  }).join("");
  const synced = state.syncedAt ? formatDateTime(new Date(state.syncedAt)) : "Sin sincronizacion registrada";
  const choice = await openPlanningDialog({
    title: "Restaurar borrador desde publicado",
    summary: `Ultima sincronizacion: ${synced}`,
    body: `<div class="restore-draft-list">${options}</div><fieldset><legend>Datos de NetSuite</legend><label><input type="radio" name="sync_choice" value="sync" checked> Sincronizar antes de restaurar</label><label><input type="radio" name="sync_choice" value="loaded"> Continuar con datos cargados</label></fieldset>`,
    confirmLabel: "Ver vista previa",
  });
  if (!choice) return;
  await previewDraftRestore(choice.snapshot_id, choice.sync_choice === "sync");
}

async function previewDraftRestore(snapshotId, syncBeforeRestore) {
  if (netSuiteSyncInFlight || netSuitePlanningSyncInFlight) return showToast("La sincronizacion de NetSuite ya esta en curso");
  if (planningActionsBusy) return showToast("La planificacion o sincronizacion ya esta en curso");
  setPlanningActionsBusy("restore", true);
  try {
    if (syncBeforeRestore) {
      const outcome = await syncNetSuiteTwoPhase({ persist: false });
      if (outcome?.status === "failed") throw new Error(outcome?.message || "No se pudo sincronizar NetSuite");
    }
    const snapshot = isAppsScriptRuntime()
      ? await callAppsScript("getPlanSnapshot", snapshotId)
      : await fetchJson(`${PLAN_SNAPSHOTS_API}/${encodeURIComponent(snapshotId)}`);
    const preview = window.PlanningWorkflowCore.reconcilePublishedPlan(snapshot, state);
    const summary = preview.summary;
    const confirmed = await openPlanningDialog({
      title: "Vista previa de restauracion",
      summary: "Confirma el reemplazo del borrador editable",
      body: `<div class="restore-preview-grid"><div>OTs restauradas<strong>${summary.restoredOts}</strong></div><div>OTs cerradas omitidas<strong>${summary.closedOts}</strong></div><div>Operaciones completadas<strong>${summary.completedOperations}</strong></div><div>Operaciones retiradas<strong>${summary.removedOperations}</strong></div><div>Operaciones nuevas<strong>${summary.newOperations}</strong></div><div>Configuraciones conservadas<strong>${summary.preservedConfigurations}</strong></div></div><p><strong>Confirmacion explicita:</strong> esta accion reemplaza el borrador actual, conserva un respaldo tecnico y el plan publicado permanece intacto. No programa ni publica automaticamente.</p>`,
      confirmLabel: "Restaurar borrador",
    });
    if (confirmed) await confirmDraftRestore(snapshotId);
  } catch (error) {
    showToast(`No se pudo preparar la restauracion: ${error.message}`, 9000);
  } finally {
    setPlanningActionsBusy("restore", false);
  }
}

async function confirmDraftRestore(snapshotId) {
  if (netSuiteSyncInFlight || netSuitePlanningSyncInFlight) return showToast("La sincronizacion de NetSuite ya esta en curso");
  const result = await callAppsScript("restorePublishedPlanAsDraft", snapshotId, createAppSheetPayload());
  if (!result?.state) throw new Error("El servidor no devolvio el borrador restaurado");
  state = result.state;
  normalizeState();
  await loadPlanSnapshots(false);
  reportSnapshot = null;
  showWorkspaceView("plan-semanal");
  saveAndRender("Borrador restaurado; revisa y genera nuevamente el plan");
}

async function loadPlanSnapshots(showMessage) {
  try {
    const snapshots = isAppsScriptRuntime()
      ? await callAppsScript("listPlanSnapshots")
      : await fetchJson(PLAN_SNAPSHOTS_API);
    planSnapshots = (Array.isArray(snapshots) ? snapshots : [])
      .sort((a, b) => String(b.generatedAt || "").localeCompare(String(a.generatedAt || "")));
    if (!reportSnapshot) {
      const publishedIds = publishedSnapshotIds();
      const source = window.PlanningWorkflowCore.defaultDailyPlanSource(planSnapshots.map((snapshot) => ({
        ...snapshot,
        status: publishedIds.has(snapshot.snapshotId) ? "PUBLICADO" : "GUARDADO",
      })), state);
      if (source.type === "published") await loadPlanSnapshotById(source.snapshotId, { render: false, silent: true });
      else if (planSnapshots.some((snapshot) => snapshot.snapshotId === "draft")) await loadPlanSnapshotById("draft", { render: false, silent: true });
      else reportSnapshot = { snapshotId: "draft", generatedAt: "", planStart: state.planStart, operations: window.PlanningWorkflowCore.draftScheduledOperations(state).map((op) => ({ ...op })) };
    }
    renderPlanSnapshotSelect();
    if (showMessage) showToast(`${planSnapshots.length} planes guardados disponibles`);
  } catch (error) {
    planSnapshots = [];
    renderPlanSnapshotSelect();
    if (showMessage) showToast(`No se pudieron cargar los planes guardados: ${error.message}`);
  }
}

async function loadSelectedPlanSnapshot(selectedSnapshotId) {
  const snapshotId = String(selectedSnapshotId ?? els.planSnapshotSelect.value);
  if (snapshotId === "draft") {
    if (planSnapshots.some((snapshot) => snapshot.snapshotId === "draft")) await loadPlanSnapshotById("draft");
    else {
      reportSnapshot = { snapshotId: "draft", generatedAt: "", planStart: state.planStart, operations: window.PlanningWorkflowCore.draftScheduledOperations(state).map((op) => ({ ...op })) };
      renderReports();
    }
    return;
  }
  if (!snapshotId) {
    const activeId = activePublishedSnapshotId();
    if (activeId) {
      await loadPlanSnapshotById(activeId);
      return;
    }
    reportSnapshot = null;
    renderReports();
    return;
  }
  await loadPlanSnapshotById(snapshotId);
}

async function loadPlanSnapshotById(snapshotId, options = {}) {
  if (!snapshotId) return;
  els.planSnapshotSelect.disabled = true;
  try {
    const snapshot = isAppsScriptRuntime()
      ? await callAppsScript("getPlanSnapshot", snapshotId)
      : await fetchJson(`${PLAN_SNAPSHOTS_API}/${encodeURIComponent(snapshotId)}`);
    reportSnapshot = {
      ...snapshot,
      snapshotId,
      operations: (snapshot.operations || []).map((op, index) => normalizeOperation({
        ...op,
        id: op.id || `snapshot-${snapshotId}-${index + 1}`,
      }, index)),
    };
    const firstStart = reportSnapshot.operations.map(opStart).filter(Boolean).sort((a, b) => a - b)[0];
    const reportStart = reportSnapshot.planStart || (firstStart ? formatDate(firstStart) : "");
    if (reportStart) {
      state.reportWeekStart = normalizeWeekStartValue(reportStart);
      syncReportFilterDates(reportStart);
    }
    if (options.render !== false) renderReports();
  } catch (error) {
    reportSnapshot = null;
    els.planSnapshotSelect.value = "";
    if (!options.silent) showToast(`No se pudo abrir el plan guardado: ${error.message}`);
    if (options.render !== false) renderReports();
  } finally {
    els.planSnapshotSelect.disabled = false;
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function renderPlanSnapshotSelect() {
  if (!els.planSnapshotSelect) return;
  const selectedId = reportSnapshot?.snapshotId || "";
  const publishedIds = publishedSnapshotIds();
  const allowedSnapshots = window.PlanningWorkflowCore.operationalPlanOptions(planSnapshots.map((snapshot) => ({
    ...snapshot,
    id: snapshot.snapshotId,
    status: publishedIds.has(snapshot.snapshotId) ? "PUBLICADO" : "GUARDADO",
  }))).filter((item) => item.id !== "draft");
  const options = allowedSnapshots.map((snapshot) => {
    const generated = snapshot.generatedAt ? formatDateTime(new Date(snapshot.generatedAt)) : "Sin fecha";
    const label = `Publicado - ${generated} - ${snapshot.planStart || "sin inicio"} - ${snapshot.operations || 0} ops`;
    return `<option value="${escapeHtml(snapshot.snapshotId)}">${escapeHtml(label)}</option>`;
  }).join("");
  els.planSnapshotSelect.innerHTML = `<option value="draft">Borrador</option>${options}`;
  els.planSnapshotSelect.value = selectedId === "draft" ? "draft" : (allowedSnapshots.some((item) => item.snapshotId === selectedId) ? selectedId : "draft");
  document.querySelectorAll("[data-report-source-select]").forEach((select) => {
    select.innerHTML = els.planSnapshotSelect.innerHTML;
    select.value = els.planSnapshotSelect.value;
  });
}

function publishedSnapshotIds() {
  return new Set([
    state.activePublishedVersionId,
    ...(state.publishedVersions || []).map((item) => item.snapshotId),
  ].filter(Boolean));
}

function activePublishedSnapshotId() {
  const publishedIds = publishedSnapshotIds();
  if (state.activePublishedVersionId && planSnapshots.some((item) => item.snapshotId === state.activePublishedVersionId)) {
    return state.activePublishedVersionId;
  }
  return planSnapshots.find((item) => publishedIds.has(item.snapshotId))?.snapshotId || "";
}

function reportOperationsSource() {
  return reportSnapshot?.operations || [];
}

function reportSourceLabel() {
  if (!reportSnapshot) return "Sin plan publicado";
  if (reportSnapshot.snapshotId === "draft") return "Borrador actual";
  const generated = reportSnapshot.generatedAt ? formatDateTime(new Date(reportSnapshot.generatedAt)) : "Sin fecha";
  return `Plan guardado ${generated}`;
}

function reportWeekLabel() {
  const range = selectedWeekRange(state.reportWeekStart);
  return `${formatShortDate(range.start)} - ${formatShortDate(addDays(range.end, -1))} ${range.start.getFullYear()}`;
}

function renderReports() {
  renderPlanSnapshotSelect();
  renderWeekReport();
  renderOperatorSelect();
  renderOperatorReport();
  renderAdjusterReport();
  renderSubcontractReport();
  const coverageIssues = window.PlanningWorkflowCore.reportCoverageDiagnostics(reportOperationsSource());
  els.reportSnapshotMeta.title = coverageIssues.map((issue) => issue.text).join("\n");
  if (coverageIssues.length) els.reportSnapshotMeta.textContent = `${reportSourceLabel()} · ${coverageIssues.length} diagnostico(s) de cobertura`;
}

function renderWeekReport() {
  els.weekReportStartInput.value = state.reportWeekStart;
  els.reportSnapshotMeta.textContent = reportSourceLabel();
  els.weekPrintContext.textContent = formatDateTime(new Date());
  const reportOps = reportOperationsSource();
  const summary = weeklyJobSummary(state.reportWeekStart, { operations: reportOps });
  els.weekExecutiveSummary.innerHTML = reportOps.length
    ? renderWeeklyExecutiveSummary(weeklyExecutiveSummary(summary, state.reportWeekStart, { operations: reportOps }))
    : `<div class="report-empty-state">No hay un plan publicado cargado para reportes.</div>`;
  els.weekReport.innerHTML = `
    <section class="weekly-job-panel"><header><h3>OT que inician</h3><span>Fecha de la primera operacion</span></header>${renderWeeklyJobDays(summary.starts, false)}</section>
    <section class="weekly-job-panel finish"><header><h3>Acabado / OT que terminan</h3><span>Fecha de la ultima operacion</span></header>${renderWeeklyJobDays(summary.finishes, true)}</section>
  `;
}

function weeklyExecutiveSummary(summary = weeklyJobSummary(), weekDate = state.reportWeekStart, options = {}) {
  const range = selectedWeekRange(weekDate);
  const sourceOperations = Array.isArray(options.operations) ? options.operations : reportOperationsSource();
  const allWeekOperations = operationsForWeekSource(sourceOperations, "", weekDate);
  const operations = allWeekOperations.filter((op) => !isToolChangeReportOperation(op));
  const toolChangeOps = allWeekOperations.filter(isToolChangeReportOperation);
  const finishingRows = summary.finishes || [];
  const finishingCost = window.PlanningWorkflowCore.weeklyFinishingCost(finishingRows);
  const finishingPieces = finishingCost.finishingPieces;
  const startingPieces = 0;
  const releaseAmount = finishingCost.totalCost;
  const releaseTarget = Math.max(0, Number(state.settings?.weeklyReleaseTarget) || DEFAULT_WEEKLY_RELEASE_TARGET);
  const releaseGap = Math.max(0, releaseTarget - releaseAmount);
  const laborDays = workingDaysInRange(range.start, range.end);
  const inPlanOperators = operatorLoadsForOperations(sourceOperations, weekDate)
    .filter((item) => Number(item.minutes || 0) > 0 && resourceIsInPlan(item.operator));
  const topOperator = inPlanOperators[0] || null;
  const topOperation = operations
    .map((op) => ({ op, minutes: operationDuration(op) }))
    .sort((a, b) => b.minutes - a.minutes)[0] || null;
  const finishingByType = groupFinishingRowsByType(finishingRows);
  const stale = stalePublishedPieces(range.start);
  const toolChangeMinutes = toolChangeOps.reduce((sum, op) => sum + operationDuration(op), 0);
  const targetFactors = releaseTargetFactors({
    releaseAmount,
    releaseTarget,
    releaseGap,
    finishingPieces,
    laborDays,
    topOperator,
    topOperation,
    toolChangeMinutes,
  });
  return {
    releaseAmount,
    releaseTarget,
    releaseGap,
    targetMet: releaseGap <= 0,
    targetFactors,
    costPerPiece: finishingCost.costPerPiece,
    peopleWithLoad: inPlanOperators.length,
    releasePerPerson: inPlanOperators.length ? releaseAmount / inPlanOperators.length : 0,
    startingPieces,
    finishingPieces,
    laborDays,
    dailyInitialCutPieces: laborDays ? startingPieces / laborDays : 0,
    dailyFinishingPieces: laborDays ? finishingPieces / laborDays : 0,
    staleInitialCutPieces: stale.initialCut,
    staleFinishingPieces: stale.finishing,
    topOperator,
    topOperation,
    finishingByType,
    toolChangeMinutes,
  };
}

function renderWeeklyExecutiveSummary(summary, options = {}) {
  const cards = [
    ["Meta semanal", formatCurrency(summary.releaseTarget)],
    ["Monto de liberacion", formatCurrency(summary.releaseAmount)],
    ["Brecha", formatCurrency(summary.releaseGap)],
    ["Costo p/p", formatCurrency(summary.costPerPiece)],
    ["Personas con carga", String(summary.peopleWithLoad)],
    ["Monto por persona", formatCurrency(summary.releasePerPerson)],
    ["Prom diario corte inicial", formatMaterialQuantity(summary.dailyInitialCutPieces)],
    ["Prom diario acabado", formatMaterialQuantity(summary.dailyFinishingPieces)],
    ["Ineficiencia corte inicial", formatMaterialQuantity(summary.staleInitialCutPieces)],
    ["Ineficiencia acabado", formatMaterialQuantity(summary.staleFinishingPieces)],
  ];
  const typeRows = summary.finishingByType.map((row) => `<tr>
    <td>${escapeHtml(row.type)}</td>
    <td>${escapeHtml(formatMaterialQuantity(row.pieces))}</td>
    <td>${escapeHtml(formatCurrency(row.amount))}</td>
    <td>${escapeHtml(formatCurrency(row.costPerPiece))}</td>
  </tr>`).join("");
  const topOperatorLabel = summary.topOperator
    ? `${summary.topOperator.operator} - ${Math.round(summary.topOperator.percent)}% (${formatHours(summary.topOperator.minutes)} / ${formatHours(summary.topOperator.available)})`
    : "Sin carga programada";
  const topOperationLabel = summary.topOperation
    ? `OT ${summary.topOperation.op.ot} - ${summary.topOperation.op.descripcion || `CT ${summary.topOperation.op.ct}`} (${formatHours(summary.topOperation.minutes)})`
    : "Sin operaciones programadas";
  const targetMessage = summary.targetMet
    ? `Meta semanal alcanzada: ${formatCurrency(summary.releaseAmount)} / ${formatCurrency(summary.releaseTarget)}`
    : `Meta semanal no alcanzada: ${formatCurrency(summary.releaseAmount)} / ${formatCurrency(summary.releaseTarget)}. Faltan ${formatCurrency(summary.releaseGap)}`;
  const factorRows = summary.targetMet
    ? ""
    : `<div class="executive-target-factors"><strong>Factores probables</strong><ul>${summary.targetFactors.map((factor) => `<li>${escapeHtml(factor)}</li>`).join("")}</ul></div>`;
  const subtitle = Object.prototype.hasOwnProperty.call(options, "subtitle")
    ? String(options.subtitle || "")
    : "Indicadores de liberacion, productividad y carga semanal";
  return `
    <header><h3>${escapeHtml(options.title || "Resumen ejecutivo")}</h3>${subtitle ? `<span>${escapeHtml(subtitle)}</span>` : ""}</header>
    <div class="executive-target ${summary.targetMet ? "executive-target--met" : "executive-target--miss"}">
      <strong>${escapeHtml(targetMessage)}</strong>
      ${factorRows}
    </div>
    <div class="executive-grid">${cards.map(([label, value]) => `<div class="executive-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div>
    <div class="executive-detail-grid">
      <table class="executive-load-table">
        <thead><tr><th>Tipo</th><th>Pzas acabado</th><th>Monto</th><th>Costo p/p</th></tr></thead>
        <tbody>${typeRows || emptyTableRow(4, "Sin piezas de acabado en la semana")}</tbody>
      </table>
      <div class="executive-critical">
        <h4>Puntos criticos</h4>
        <p><strong>Operador con mas carga:</strong> ${escapeHtml(topOperatorLabel)}</p>
        <p><strong>Operacion con mas tiempo:</strong> ${escapeHtml(topOperationLabel)}</p>
      </div>
    </div>
  `;
}

function releaseTargetFactors(summary) {
  const factors = [];
  if (Number(summary.finishingPieces || 0) <= 0) {
    factors.push("Pocas OTs terminando en Acabado durante la semana");
  } else if (summary.releaseGap > 0) {
    factors.push("Pocas OTs terminando en Acabado para cubrir la meta");
  }
  if (summary.topOperator && Number(summary.topOperator.percent || 0) >= 95) {
    factors.push(`Cuello de botella por operador ${summary.topOperator.operator}`);
  } else if (summary.topOperation) {
    factors.push(`Cuello de botella probable en OT ${summary.topOperation.op.ot} / ${summary.topOperation.op.descripcion || `CT ${summary.topOperation.op.ct}`}`);
  }
  if (Number(summary.toolChangeMinutes || 0) > 0) {
    factors.push(`Cambios de herramental consumen ${formatHours(summary.toolChangeMinutes)}`);
  }
  if (scheduledMaterialShortageCount() > 0) {
    factors.push("Materiales o subensambles faltantes en OTs del plan");
  }
  if (Number(summary.laborDays || 0) < 5) {
    factors.push(`Dias laborales efectivos reducidos (${summary.laborDays})`);
  }
  if (!factors.length) factors.push("Mezcla de OTs con menor monto o bajo precio por pieza");
  return factors.slice(0, 5);
}

function scheduledMaterialShortageCount() {
  const scheduled = new Set(getScheduledOts().map(materialOtKey));
  return state.materials.filter((item) => scheduled.has(materialOtKey(item.ot)) && Number(item.pending || 0) > 0).length;
}

function groupFinishingRowsByType(rows) {
  return window.PlanningWorkflowCore.weeklyFinishingRowsByType(rows);
}

function workingDaysInRange(start, end) {
  let days = 0;
  for (let cursor = new Date(start); cursor < end; cursor = addDays(cursor, 1)) {
    if (isGeneralWorkingDay(cursor)) days += 1;
  }
  return Math.max(1, days);
}

function stalePublishedPieces(currentWeekStart) {
  const result = { initialCut: 0, finishing: 0 };
  const source = reportSnapshot?.operations || state.operations;
  const seenInitial = new Set();
  const seenFinish = new Set();
  for (const op of source) {
    if (!isJobScheduled(op.ot) || isPlanCompletedOperation(op) || isClosedJobStatus(jobStatusForOt(op.ot))) continue;
    const start = opStart(op);
    const end = opEnd(op);
    if (!start || start >= currentWeekStart) continue;
    const sequenced = state.operations
      .filter((item) => item.ot === op.ot && item.tipoInsercion !== "CAMBIO_HERRAMENTAL")
      .sort((a, b) => sequenceSort(a, b));
    const first = sequenced[0];
    const last = sequenced[sequenced.length - 1];
    const pieces = Number(op.pendingPieces ?? op.cantPendiente ?? pendingPiecesForWorkOrder(workOrderForOt(op.ot)));
    if (first && op.id === first.id && !seenInitial.has(op.ot)) {
      result.initialCut += Math.max(0, pieces);
      seenInitial.add(op.ot);
    }
    if (last && op.id === last.id && end && end < currentWeekStart && !seenFinish.has(op.ot)) {
      result.finishing += Math.max(0, pieces);
      seenFinish.add(op.ot);
    }
  }
  return result;
}

function weeklyJobSummary(weekDate = state.reportWeekStart, options = {}) {
  const range = selectedWeekRange(weekDate);
  const grouped = new Map();
  const sourceOperations = Array.isArray(options.operations) ? options.operations : reportOperationsSource();
  for (const op of sourceOperations) {
    if (isToolChangeReportOperation(op)) continue;
    if (!grouped.has(op.ot)) grouped.set(op.ot, []);
    grouped.get(op.ot).push(op);
  }
  const starts = [];
  const finishes = [];
  for (const [ot, operations] of grouped.entries()) {
    const sequenced = operations.sort((a, b) => sequenceSort(a, b));
    const first = sequenced[0];
    const last = sequenced[sequenced.length - 1];
    const start = opStart(first);
    const finish = opEnd(last);
    const workOrder = workOrderForOt(ot);
    const configuration = articleConfigurationValue(first.parte || workOrder?.item || "");
    const pendingPiecesValue = Number(first.pendingPieces ?? last.pendingPieces ?? pendingPiecesForWorkOrder(workOrder));
    const pendingPieces = Number.isFinite(pendingPiecesValue) ? Math.max(0, pendingPiecesValue) : 0;
    const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== "";
    const unitPriceValue = [first.unitPrice, last.unitPrice, workOrder?.averageSalePrice, configuration.manualUnitPrice].find(hasValue);
    const unitPriceNumber = Number(unitPriceValue);
    const unitPrice = hasValue(unitPriceValue) ? (Number.isFinite(unitPriceNumber) ? Math.max(0, unitPriceNumber) : 0) : null;
    const amountValue = [first.amount, last.amount].find(hasValue);
    const amountNumber = Number(amountValue);
    const row = {
      ot,
      part: first.parte || workOrder?.item || "",
      pendingPieces,
      jobType: String(first.jobType || last.jobType || configuration.jobType || "").trim().toUpperCase(),
      planningType: String(first.planningType || last.planningType || configuration.planningType || "").trim().toUpperCase(),
      unitPrice,
      amount: amountValue == null ? null : (Number.isFinite(amountNumber) ? Math.max(0, amountNumber) : 0),
    };
    if (start && start >= range.start && start < range.end) starts.push({ ...row, date: start });
    if (finish && finish >= range.start && finish < range.end) finishes.push({ ...row, date: finish });
  }
  const sorter = (a, b) => a.date - b.date || String(a.ot).localeCompare(String(b.ot), "es", { numeric: true });
  return { starts: starts.sort(sorter), finishes: finishes.sort(sorter) };
}

function renderWeeklyJobDays(rows, finishing) {
  const byDate = new Map();
  for (const row of rows) {
    const dateKey = formatDate(row.date);
    if (!byDate.has(dateKey)) byDate.set(dateKey, []);
    byDate.get(dateKey).push(row);
  }
  if (!byDate.size) return `<div class="weekly-job-empty">Sin OTs para esta semana</div>`;
  return [...byDate.entries()].map(([dateKey, dayRows]) => {
    const date = parseDateOnlyValue(dateKey);
    const columns = finishing
      ? ["No.", "ORD", "PARTE", "PZAS", "MONTO", "TIPO"]
      : ["No.", "ORD", "PARTE", "PZAS"];
    const body = dayRows.map((row, index) => `<tr class="${window.PlanningWorkflowCore.weeklyPlanningTypeClass(row.planningType)}">
      <td>${index + 1}</td><td>${escapeHtml(row.ot)}</td><td>${escapeHtml(row.part)}</td><td>${escapeHtml(formatMaterialQuantity(row.pendingPieces))}</td>
      ${finishing ? `<td>${escapeHtml(formatCurrency(window.PlanningWorkflowCore.effectiveFinishingAmount(row)))}</td><td>${escapeHtml(row.jobType)}</td>` : ""}
    </tr>`).join("");
    const pieces = dayRows.reduce((sum, row) => sum + Number(row.pendingPieces || 0), 0);
    const amount = window.PlanningWorkflowCore.weeklyFinishingCost(dayRows).totalCost;
    return `<article class="weekly-day-block day-${date.getDay()}">
      <div class="weekly-day-ribbon"><strong>${escapeHtml(formatDate(date))}</strong><span>${escapeHtml(date.toLocaleDateString("es-MX", { weekday: "long" }))}</span></div>
      <div class="weekly-day-table"><table><thead><tr>${columns.map((column) => `<th>${column}</th>`).join("")}</tr></thead><tbody>${body}</tbody><tfoot><tr><td colspan="2">Total ${dayRows.length}</td><td></td><td>${escapeHtml(formatMaterialQuantity(pieces))}</td>${finishing ? `<td>${escapeHtml(formatCurrency(amount))}</td><td></td>` : ""}</tr></tfoot></table></div>
    </article>`;
  }).join("");
}

function renderOperatorSelect() {
  const operators = uniq([...state.operators, ...reportOperationsSource().map((op) => op.operador)])
    .filter(isLoadBearingOperator);
  const current = els.operatorReportSelect.value || operators[0] || "";
  els.operatorReportSelect.innerHTML = operators.map((op) => `<option value="${escapeHtml(op)}">${escapeHtml(op)}</option>`).join("");
  els.operatorReportSelect.value = operators.includes(current) ? current : operators[0] || "";
}

function renderOperatorReport() {
  const operator = els.operatorReportSelect.value || state.operators[0] || "";
  const filter = reportFilter("operator");
  const selection = filteredReportRows(operationsForReportWeek(operator, filter.date), "operator", opStart);
  els.operatorReportStatus.value = filter.status;
  renderReportFilterStatus("operator", els.operatorReportStartInput, els.operatorReportFutureDays, els.operatorReportCount, selection);
  els.operatorPrintContext.textContent = formatDateTime(new Date());
  els.operatorReport.classList.toggle("report-show-all-table", selection.showAll);
  els.operatorReport.innerHTML = renderProductionReportTable(selection.rows, { statusActions: isReportSnapshotEditable() });
  bindReportCommentInputs(els.operatorReport);
  bindPlanStatusActions(els.operatorReport);
}

function renderAdjusterReport() {
  const filter = reportFilter("adjuster");
  const selection = filteredReportRows(
    operationsForReportWeek("", filter.date).filter(isToolChangeReportOperation),
    "adjuster",
    opStart
  );
  els.adjusterReportStatus.value = filter.status;
  renderReportFilterStatus("adjuster", els.adjusterReportStartInput, els.adjusterReportFutureDays, els.adjusterReportCount, selection);
  els.adjusterPrintContext.textContent = formatDateTime(new Date());
  els.adjusterReport.classList.toggle("report-show-all-table", selection.showAll);
  const headers = ["OT", "Articulo", "Maquina", "Herramental", "Kit", "Fecha inicio", "Hora inicio", "Fecha fin", "Hora fin", "Comentarios", "Estado"];
  const body = selection.rows.map((op) => {
    const start = opStart(op);
    const end = opEnd(op);
    const workOrder = workOrderForOt(op.ot);
    const change = toolChangeReportData(op);
    const destinationHerramental = change.toHerramental || cleanToolValue(op.herramental);
    const destinationKit = change.toKit || cleanToolValue(op.kitHerramental);
    return `<tr>
      <td>${escapeHtml(op.ot)}</td>
      <td>${escapeHtml(op.parte || workOrder?.item || "")}</td>
      <td>${escapeHtml(cleanResourceValue(op.maquina))}</td>
      <td>${escapeHtml(destinationHerramental)}</td>
      <td>${escapeHtml(destinationKit)}</td>
      <td>${escapeHtml(start ? formatDate(start) : "")}</td>
      <td>${escapeHtml(start ? formatTime(start) : "")}</td>
      <td>${escapeHtml(end ? formatDate(end) : "")}</td>
      <td>${escapeHtml(end ? formatTime(end) : "")}</td>
      <td><span class="report-comment-fixed">${escapeHtml(toolChangeReportComment(op))}</span></td>
      <td class="report-status-action-column">${planStatusActionCell(op)}</td>
    </tr>`;
  }).join("");
  els.adjusterReport.innerHTML = `<thead><tr>${headers.map((header) => `<th class="${header === "Estado" ? "report-status-action-column" : ""}">${header}</th>`).join("")}</tr></thead><tbody>${body || emptyTableRow(headers.length, "Sin cambios de herramental para el filtro seleccionado")}</tbody>`;
  bindPlanStatusActions(els.adjusterReport);
}

function renderSubcontractReport() {
  const filter = reportFilter("subcontract");
  const selection = filteredReportRows(subcontractRowsForReportWeek(filter.date), "subcontract", (row) => row.start);
  els.subcontractReportStatus.value = filter.status;
  renderReportFilterStatus("subcontract", els.subcontractReportStartInput, els.subcontractReportFutureDays, els.subcontractReportCount, selection);
  els.subcontractPrintContext.textContent = formatDateTime(new Date());
  els.subcontractReport.classList.toggle("report-show-all-table", selection.showAll);
  const headers = ["OT", "Articulo", "Tipo de subcontrato", "Dias", "Fecha inicio", "Hora inicio", "Fecha fin", "Hora fin", "Comentarios"];
  const body = selection.rows.map((row) => {
    const missingType = !row.type;
    const missingDays = !(row.days > 0);
    return `<tr>
      <td>${escapeHtml(row.ot)}</td>
      <td>${escapeHtml(row.article)}</td>
      <td class="${missingType ? "report-warning" : ""}">${escapeHtml(row.type || "FALTA CONFIGURAR")}</td>
      <td class="${missingDays ? "report-warning" : ""}">${missingDays ? "FALTA CONFIGURAR" : escapeHtml(row.days)}</td>
      <td>${escapeHtml(formatDate(row.start))}</td>
      <td>${escapeHtml(formatTime(row.start))}</td>
      <td>${escapeHtml(formatDate(row.end))}</td>
      <td>${escapeHtml(formatTime(row.end))}</td>
      <td>${reportCommentEditor(row.operationIds, row.comment)}</td>
    </tr>`;
  }).join("");
  els.subcontractReport.innerHTML = `<thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead><tbody>${body || emptyTableRow(headers.length, "Sin subcontratos para el filtro seleccionado")}</tbody>`;
  bindReportCommentInputs(els.subcontractReport);
}

function subcontractRowsForReportWeek(weekDate = state.reportWeekStart) {
  const grouped = new Map();
  for (const op of reportOperationsSource()) {
    if (!reportSnapshot && !isJobScheduled(op.ot)) continue;
    if (!isSubcontractAppOperation(op) && !op.subcontractType && !(Number(op.subcontractDays) > 0)) continue;
    const start = opStart(op);
    const end = opEnd(op);
    if (!start || !end) continue;
    const current = grouped.get(op.ot) || { ot: op.ot, starts: [], ends: [], operations: [], operationIds: [], comments: [], types: [], days: [], statuses: [] };
    current.starts.push(start);
    current.ends.push(end);
    current.operations.push(op.descripcion || `CT ${op.ct}`);
    current.operationIds.push(op.id);
    current.statuses.push(isPlanCompletedOperation(op));
    if (op.comentario) current.comments.push(op.comentario);
    if (op.subcontractType) current.types.push(op.subcontractType);
    if (Number(op.subcontractDays) > 0) current.days.push(Number(op.subcontractDays));
    grouped.set(op.ot, current);
  }
  return [...grouped.values()].map((group) => {
    const configuration = reportSnapshot ? {} : (state.otConfigurations[group.ot] || {});
    const workOrder = workOrderForOt(group.ot);
    return {
      ot: group.ot,
      article: workOrder?.item || state.operations.find((op) => op.ot === group.ot)?.parte || "",
      type: String(configuration.subcontractType || group.types[0] || "").trim().toUpperCase(),
      days: Math.max(0, Math.round(Number(configuration.subcontractDays || group.days[0] || 0))),
      start: new Date(Math.min(...group.starts.map((date) => date.getTime()))),
      end: new Date(Math.max(...group.ends.map((date) => date.getTime()))),
      operations: uniq(group.operations),
      operationIds: uniq(group.operationIds),
      comment: group.comments[0] || "",
      planStatus: group.statuses.every(Boolean) ? "COMPLETADA_PLAN" : "PENDIENTE",
    };
  }).sort((a, b) => a.start - b.start || String(a.ot).localeCompare(String(b.ot), "es", { numeric: true }));
}

function toolChangeReportData(op) {
  const stored = {
    fromHerramental: reportToolValue(op.toolChangeFromHerramental),
    fromKit: reportToolValue(op.toolChangeFromKit),
    toHerramental: reportToolValue(op.toolChangeToHerramental),
    toKit: reportToolValue(op.toolChangeToKit),
  };
  if (stored.fromHerramental || stored.fromKit || stored.toHerramental || stored.toKit) return stored;
  const segment = String(op.log || "").split("|").map((item) => item.trim()).reverse().find((item) => item.includes("->")) || "";
  const parts = segment.split(/\s*->\s*/);
  const from = parseToolPair(parts[0]?.replace(/^.*?PLANIFICADOR_HEURISTICO\s+/i, ""));
  const to = parseToolPair(parts[1]);
  return { fromHerramental: from.herramental, fromKit: from.kit, toHerramental: to.herramental, toKit: to.kit };
}

function parseToolPair(value) {
  const [herramental, kit] = String(value || "").trim().split("/");
  return { herramental: reportToolValue(herramental), kit: reportToolValue(kit) };
}

function reportToolValue(value) {
  const text = cleanToolValue(value);
  const key = normalizeStatus(text);
  return ["SIN_HERR", "SIN_KIT", "SIN_ANTECEDENTE"].includes(key) ? "" : text;
}

function formatToolPair(herramental, kit) {
  return [reportToolValue(herramental), reportToolValue(kit)].filter(Boolean).join(", ") || "SIN HERRAMENTAL";
}

function toolChangeReportComment(op) {
  const change = toolChangeReportData(op);
  const destinationHerramental = change.toHerramental || cleanToolValue(op.herramental);
  const destinationKit = change.toKit || cleanToolValue(op.kitHerramental);
  return `Cambio de herramental de (${formatToolPair(change.fromHerramental, change.fromKit)} --> ${formatToolPair(destinationHerramental, destinationKit)})`;
}

function reportSelectionLabel(selection) {
  const range = window.PlanningWorkflowCore.reportDateRange(selection.date, selection.futureDays);
  return `Rango ${formatShortDate(parseDateOnlyValue(range.start))} - ${formatShortDate(parseDateOnlyValue(range.end))}`;
}

function reportWeekLabelForDate(value) {
  const range = selectedWeekRange(value);
  return `${formatShortDate(range.start)} - ${formatShortDate(addDays(range.end, -1))} ${range.start.getFullYear()}`;
}

function parseDateOnlyValue(value) {
  const parsed = parseDate(value);
  return parsed ? new Date(parsed.year, parsed.month - 1, parsed.day) : new Date();
}

function operationsForReportWeek(operator = "", weekDate = state.reportWeekStart) {
  return operationsForWeekSource(reportOperationsSource(), operator, weekDate);
}

function operationsForWeekSource(source, operator = "", weekDate = state.reportWeekStart) {
  const range = selectedWeekRange(weekDate);
  return (Array.isArray(source) ? source : [])
    .filter((op) => {
      if (operator && op.operador !== operator) return false;
      const start = opStart(op);
      const end = opEnd(op);
      return Boolean(start && end && start < range.end && end > range.start);
    })
    .sort((a, b) => opStart(a) - opStart(b) || Number(a.secuencia) - Number(b.secuencia));
}

function isToolChangeReportOperation(op) {
  return normalizeStatus(op.tipoInsercion) === "CAMBIO_HERRAMENTAL" ||
    /CAMBIO\s+(?:DE\s+)?HERRAMENTAL/.test(normalizeStatus(op.descripcion || op.log));
}

function reportOperationCommentCell(op) {
  if (isToolChangeReportOperation(op)) {
    return `<span class="report-comment-fixed">${escapeHtml(toolChangeReportComment(op))}</span>`;
  }
  return reportCommentEditor([op.id], op.comentario || "");
}

function reportCommentEditor(operationIds, value) {
  const comment = String(value || "").trim();
  if (!isReportSnapshotEditable()) return escapeHtml(comment);
  return `<input class="report-comment-input" type="text" maxlength="250" data-operation-ids="${escapeHtml((operationIds || []).join("|"))}" value="${escapeHtml(comment)}" placeholder="Comentario opcional" aria-label="Comentario opcional">`;
}

function bindReportCommentInputs(container) {
  container.querySelectorAll(".report-comment-input").forEach((input) => {
    input.addEventListener("change", () => {
      const ids = String(input.dataset.operationIds || "").split("|").filter(Boolean);
      const comment = String(input.value || "").trim();
      checkpointState();
      for (const op of state.operations) {
        if (ids.includes(op.id)) op.comentario = comment;
      }
      input.value = comment;
      saveState();
      showToast("Comentario guardado");
    });
  });
}

function isReportSnapshotEditable() {
  return !reportSnapshot || reportSnapshot.snapshotId === "draft";
}

function planStatusActionCell(op) {
  if (!isReportSnapshotEditable()) return escapeHtml(isPlanCompletedOperation(op) ? "Completada" : "Pendiente");
  const completed = isPlanCompletedOperation(op);
  const key = operationCompletionKey(op);
  return `<button class="plan-status-action ${completed ? "reopen" : "complete"}" type="button" data-plan-status-key="${escapeHtml(key)}" aria-label="${completed ? "Cambiar a pendiente" : "Marcar completada"}" title="${completed ? "Reabrir operacion" : "Marcar completada"}">${completed ? "Reabrir" : "Completar"}</button>`;
}

function bindPlanStatusActions(container) {
  container.querySelectorAll("[data-plan-status-key]").forEach((button) => {
    button.addEventListener("click", () => toggleOperationPlanStatus(button.dataset.planStatusKey));
  });
}

async function toggleOperationPlanStatus(key) {
  const operation = state.operations.find((op) => operationCompletionKey(op) === key);
  const current = state.operationPlanStatuses?.[key];
  const completed = current?.status === "COMPLETADA_PLAN" || isPlanCompletedOperation(operation);
  if (!operation && !current) return showToast("No se encontro la operacion");
  const previousStatus = current ? deepClone(current) : undefined;
  const previousOperation = operation ? deepClone(operation) : undefined;
  checkpointState();
  if (!state.operationPlanStatuses) state.operationPlanStatuses = {};
  if (completed) {
    state.operationPlanStatuses[key] = { ...(current || {}), key, status: "PENDIENTE", reopenedAt: new Date().toISOString() };
    if (operation) {
      operation.planStatus = "PENDIENTE";
      operation.needsReschedule = true;
      operation.autoFrozen = false;
      operation.fechaInicio = "";
      operation.horaInicio = "";
      operation.fechaFin = "";
      operation.horaFin = "";
      operation.log = appendLog(operation.log, "REABIERTA_PLAN_APP");
    }
    return persistOptimisticPlanStatus(key, operation, previousStatus, previousOperation,
      "Operacion reabierta; se incluira en la siguiente reprogramacion");
  }

  const type = isToolChangeReportOperation(operation) ? "TOOL_CHANGE" : "OPERATION";
  const workOrder = workOrderForOt(operation?.ot || current?.ot);
  const toToolKey = window.PlannerCore?.operationToolKey
    ? window.PlannerCore.operationToolKey(operation)
    : "";
  state.operationPlanStatuses[key] = {
    key,
    type,
    status: "COMPLETADA_PLAN",
    operationId: operation?.id || current?.operationId || "",
    ot: operation?.ot || current?.ot || "",
    sequence: Number(operation?.secuencia || current?.sequence || 0),
    ct: operation?.ct || current?.ct || "",
    operator: operation?.operador || current?.operator || "",
    machine: operation?.maquina || current?.machine || "",
    article: operation?.parte || workOrder?.item || current?.article || "",
    description: operation?.descripcion || current?.description || "",
    startDate: operation?.fechaInicio || current?.startDate || "",
    startTime: operation?.horaInicio || current?.startTime || "",
    endDate: operation?.fechaFin || current?.endDate || "",
    endTime: operation?.horaFin || current?.endTime || "",
    fromHerramental: operation?.toolChangeFromHerramental || "",
    fromKit: operation?.toolChangeFromKit || "",
    toHerramental: operation?.toolChangeToHerramental || operation?.herramental || "",
    toKit: operation?.toolChangeToKit || operation?.kitHerramental || "",
    toToolKey,
    completedAt: new Date().toISOString(),
  };
  if (operation) {
    operation.planStatus = "COMPLETADA_PLAN";
    operation.needsReschedule = false;
    operation.log = appendLog(operation.log, "COMPLETADA_PLAN_APP");
  }
  return persistOptimisticPlanStatus(key, operation, previousStatus, previousOperation,
    type === "TOOL_CHANGE" ? "Cambio de herramental completado" : "Operacion completada");
}

async function persistOptimisticPlanStatus(key, operation, previousStatus, previousOperation, message) {
  invalidateGanttCache();
  render();
  showToast(message);
  scheduleLocalStorageFlush();
  if (!appSheetAvailable) return true;
  appSheetMarkDirtyScope("plan");
  const saved = await saveAppSheet(false);
  if (saved) return true;
  if (previousStatus) state.operationPlanStatuses[key] = previousStatus;
  else delete state.operationPlanStatuses[key];
  if (operation && previousOperation) Object.assign(operation, previousOperation);
  invalidateGanttCache();
  render();
  scheduleLocalStorageFlush();
  showToast("No se pudo guardar el estado; se restauro el valor anterior");
  return false;
}

function renderProductionReportTable(operations, options = {}) {
  const headers = ["Num", "O.T.", "Parte", "OP", "Piezas", "Maq/Area", "Herramental", "TC (min)", "Tiempo setup", "Tiempo prod.", "F. inicio", "H. inicio", "F. fin", "H. fin", "Comentarios"];
  if (options.statusActions) headers.push("Estado");
  const body = operations.map((op, index) => {
    const start = opStart(op);
    const end = opEnd(op);
    const workOrder = workOrderForOt(op.ot);
    const machineArea = cleanResourceValue(op.maquina);
    const pieces = Number(op.cantidadPendiente || workOrder?.pendingQuantity || 0);
    return `<tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(op.ot)}</td>
      <td>${escapeHtml(op.parte || workOrder?.item || "")}</td>
      <td>${escapeHtml(op.descripcion || op.tipoInsercion || "")}</td>
      <td>${pieces > 0 ? formatReportNumber(pieces) : ""}</td>
      <td>${escapeHtml(machineArea)}</td>
      <td>${escapeHtml(cleanToolValue(op.herramental))}</td>
      <td>${formatReportNumber(op.tiempoCiclo)}</td>
      <td>${formatReportNumber(op.tiempoSetup)}</td>
      <td>${formatReportNumber(scheduledProductionMinutesForExport(op))}</td>
      <td>${escapeHtml(start ? formatDate(start) : "")}</td>
      <td>${escapeHtml(start ? formatTime(start) : "")}</td>
      <td>${escapeHtml(end ? formatDate(end) : "")}</td>
      <td>${escapeHtml(end ? formatTime(end) : "")}</td>
      <td>${reportOperationCommentCell(op)}</td>
      ${options.statusActions ? `<td class="report-status-action-column">${planStatusActionCell(op)}</td>` : ""}
    </tr>`;
  }).join("");
  return `<thead><tr>${headers.map((header) => `<th class="${header === "Estado" ? "report-status-action-column" : ""}">${header}</th>`).join("")}</tr></thead><tbody>${body || emptyTableRow(headers.length, "Sin operaciones programadas en esta semana")}</tbody>`;
}

function formatReportNumber(value) {
  const numeric = Number(value || 0);
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2).replace(/\.00$/, "");
}

function formatCurrency(value) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(Number(value || 0));
}

function showTab(tab) {
  document.querySelectorAll(".tabs button").forEach((button) => {
    button.classList.toggle("tab-active", button.dataset.tab === tab);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
  document.getElementById(`${tab}Tab`).classList.add("active");
}

function addOperator() {
  const value = els.newOperatorInput.value.trim().toUpperCase();
  if (!value) return;
  if (value === "SIN_OPERADOR") {
    showToast("SIN_OPERADOR es un estado reservado");
    return;
  }
  if (value === "SUBCONTRATO") {
    showToast("SUBCONTRATO es un recurso externo reservado");
    return;
  }
  if (state.operators.includes(value)) {
    showToast("El operador ya existe");
    return;
  }
  state.operators.push(value);
  state.operatorProfiles[value] = { name: value, category: "FUERA_DE_PLAN" };
  state.operatorPerformance[value] = 100;
  els.newOperatorInput.value = "";
  saveAndRender("Operador agregado", "matrix");
}

function updateResourceProfile(resource, patch) {
  if (!state.operators.includes(resource)) return;
  checkpointState();
  state.operatorProfiles[resource] = {
    ...(state.operatorProfiles[resource] || { name: resource, category: defaultResourceCategory(resource) }),
    ...patch,
  };
  state.operatorProfiles[resource].name = String(state.operatorProfiles[resource].name || resource).trim() || resource;
  state.operatorProfiles[resource].category = normalizeResourceCategory(state.operatorProfiles[resource].category);
  saveAndRender("Recurso actualizado", "matrix");
}

function formatResourceCategoryLabel(category) {
  if (category === "ACABADOS") return "ACABADOS";
  if (category === "FUERA_DE_PLAN") return "FUERA DE PLAN";
  return "TD";
}

function addCt() {
  const key = els.newCtInput.value.trim();
  if (!key) return showToast("Selecciona una operacion existente de NetSuite");
  const capability = state.operationCatalog.find((item) => item.key === key);
  if (!capability) return showToast("La operacion ya no existe en el catalogo de NetSuite");
  const identity = capabilityKey(capability.ct, capability.label);
  if (getCapabilityRows().some((item) => capabilityKey(item.ct, item.label) === identity)) {
    renderOperationCatalogSelect();
    return showToast("La operacion ya esta agregada a la matriz");
  }
  if (!state.cts.includes(capability.ct)) state.cts.push(capability.ct);
  if (!state.configuredCapabilities.includes(capability.key)) state.configuredCapabilities.push(capability.key);
  state.hiddenCapabilities = state.hiddenCapabilities.filter((key) => key !== capability.key);
  if (!state.matrix[capability.key]) state.matrix[capability.key] = [];
  if (!CAPACITY_MODES.includes(state.capacityModes[capability.key])) state.capacityModes[capability.key] = "FINITA";
  els.newCtInput.value = "";
  saveAndRender("Operacion agregada", "matrix");
}

function removeCapability(key) {
  if (key === TOOL_CHANGE_CAPABILITY.key) {
    showToast("CAMBIO DE HERRAMENTAL es obligatorio para OTs con doblado");
    return;
  }
  const capability = getCapabilityRows().find((row) => row.key === key);
  if (!capability) return;
  state.customCapabilities = state.customCapabilities.filter((row) => row.key !== key);
  state.configuredCapabilities = state.configuredCapabilities.filter((configuredKey) => configuredKey !== key);
  if (!state.hiddenCapabilities.includes(key)) state.hiddenCapabilities.push(key);
  delete state.matrix[key];
  delete state.capacityModes[key];
  const ctStillUsed = state.operations.some((op) => op.ct === capability.ct) ||
    state.customCapabilities.some((row) => row.ct === capability.ct);
  if (!ctStillUsed) {
    state.cts = state.cts.filter((ct) => ct !== capability.ct);
    delete state.matrix[capability.ct];
    delete state.capacityModes[capability.ct];
  }
  saveAndRender(`Operacion retirada de la matriz; ${capability.count} operaciones del plan se conservaron`, "matrix");
}

function removeOperator(operator) {
  if (!state.operators.includes(operator)) return;
  if (typeof window !== "undefined" && !window.confirm(`Eliminar operador ${operator} de la matriz de habilidades?`)) return;
  checkpointState();
  state.operators = state.operators.filter((name) => name !== operator);
  for (const key of Object.keys(state.matrix)) {
    state.matrix[key] = (state.matrix[key] || []).filter((name) => name !== operator);
  }
  delete state.operatorPerformance[operator];
  delete state.operatorProfiles[operator];
  let released = 0;
  for (const op of state.operations) {
    if (op.operador !== operator) continue;
    op.operador = "SIN_OPERADOR";
    op.log = appendLog(op.log, `OPERADOR_ELIMINADO_APP ${operator}`);
    released++;
  }
  saveAndRender(`Operador eliminado; ${released} operaciones quedaron sin asignar`);
}

function renameOperator(operator, requestedName) {
  if (!state.operators.includes(operator)) return;
  const nextName = String(requestedName || "").trim().toUpperCase();
  if (!nextName) {
    showToast("El nombre del operador no puede quedar vacio");
    renderMatrix();
    return;
  }
  if (nextName === "SIN_OPERADOR") {
    showToast("SIN_OPERADOR es un estado reservado");
    renderMatrix();
    return;
  }
  if (nextName === "SUBCONTRATO") {
    showToast("SUBCONTRATO es un recurso externo reservado");
    renderMatrix();
    return;
  }
  if (nextName === operator) return;
  if (state.operators.some((name) => name !== operator && normalizeStatus(name) === normalizeStatus(nextName))) {
    showToast("Ya existe un operador con ese nombre");
    renderMatrix();
    return;
  }

  checkpointState();
  state.operators = state.operators.map((name) => name === operator ? nextName : name);
  for (const key of Object.keys(state.matrix)) {
    state.matrix[key] = uniq((state.matrix[key] || []).map((name) => name === operator ? nextName : name));
  }

  const performance = Number(state.operatorPerformance?.[operator]) || 100;
  state.operatorPerformance[nextName] = performance;
  delete state.operatorPerformance[operator];
  if (state.operatorCapacity && typeof state.operatorCapacity === "object") {
    if (Object.prototype.hasOwnProperty.call(state.operatorCapacity, operator)) {
      state.operatorCapacity[nextName] = state.operatorCapacity[operator];
      delete state.operatorCapacity[operator];
    }
  }

  const currentProfile = state.operatorProfiles?.[operator] || { name: operator, category: defaultResourceCategory(operator) };
  const currentPersonName = String(currentProfile.name || operator).trim() || operator;
  state.operatorProfiles[nextName] = {
    ...currentProfile,
    name: normalizeStatus(currentPersonName) === normalizeStatus(operator) ? nextName : currentPersonName,
    category: normalizeResourceCategory(currentProfile.category),
  };
  delete state.operatorProfiles[operator];

  let reassigned = 0;
  for (const op of state.operations) {
    if (normalizeStatus(op.operador) !== normalizeStatus(operator)) continue;
    op.operador = nextName;
    op.log = appendLog(op.log, `OPERADOR_RENOMBRADO_APP ${operator} -> ${nextName}`);
    reassigned += 1;
  }
  if (normalizeStatus(state.settings?.toolChangeOperator) === normalizeStatus(operator)) {
    state.settings.toolChangeOperator = nextName;
  }

  saveAndRender(`Operador renombrado; ${reassigned} operaciones actualizadas`);
}

function toggleMatrix(key, operator, checked, capability) {
  if (!state.matrix[key]) {
    state.matrix[key] = capability ? [...baseAllowedOperatorsForCapability(capability)] : [];
  }
  if (checked && !state.matrix[key].includes(operator)) state.matrix[key].push(operator);
  if (!checked) state.matrix[key] = state.matrix[key].filter((name) => name !== operator);
}

function operatorPerformanceForOperator(operator) {
  const performance = Number(state.operatorPerformance?.[operator]);
  return Number.isFinite(performance) && performance > 0 ? performance : 100;
}

async function loadNetSuiteExercise() {
  if (planningActionsBusy) return showToast("La planificacion o sincronizacion ya esta en curso");
  setPlanningActionsBusy("sync", true);
  try {
    return await loadNetSuiteExerciseImpl();
  } finally {
    setNetSuiteSyncPhaseLabel("");
    setPlanningActionsBusy("sync", false);
  }
}

async function loadNetSuiteExerciseImpl() {
  const outcome = await syncNetSuiteTwoPhase();
  showToast(outcome.message, outcome.status === "complete" ? 3500 : 9000);
  return outcome;
}

async function syncBacklogWorkOrders() {
  if (planningActionsBusy || netSuiteSyncInFlight || netSuitePlanningSyncInFlight) {
    return showToast("La planificacion, sincronizacion o restauracion ya esta en curso");
  }
  setPlanningActionsBusy("backlog-sync", true);
  try {
    const payload = await window.PlanningWorkflowCore.withTimeout(
      callAppsScript("fetchNetSuiteWorkOrdersLite"),
      NETSUITE_PLANNING_TIMEOUT_MS
    );
    validateNetSuiteImportedData(payload, "workOrders");
    const incomingWorkOrders = payload.workOrders;
    const comparison = window.PlanningWorkflowCore.compareWorkOrderLite(state, incomingWorkOrders);
    const planned = [...comparison.plannedQuantityChanges, ...comparison.plannedClosed];
    let values = {};
    if (planned.length) {
      values = await openPlanningDialog({
        title: "Confirmar cambios de OTs planeadas",
        summary: `${comparison.plannedQuantityChanges.length} cantidades; ${comparison.plannedClosed.length} cerradas o ausentes`,
        confirmLabel: "Aplicar decisiones",
        body: `<div class="planning-fields">${comparison.plannedQuantityChanges.map((change, index) => `
          <label><input type="checkbox" name="quantity_${index}" value="${escapeHtml(change.ot)}"> Aceptar cantidad de OT ${escapeHtml(change.ot)} (${escapeHtml(change.current.quantity)} → ${escapeHtml(change.incoming.quantity)})</label>`).join("")}
          ${comparison.plannedClosed.map((change, index) => `
          <label><input type="checkbox" name="closed_${index}" value="${escapeHtml(change.ot)}"> Retirar OT ${escapeHtml(change.ot)} cerrada o ausente</label>`).join("")}</div>`,
      });
      if (!values) values = {};
    }
    const decisions = {
      acceptQuantityOts: Object.entries(values).filter(([key]) => key.startsWith("quantity_")).map(([, value]) => value),
      removeClosedOts: Object.entries(values).filter(([key]) => key.startsWith("closed_")).map(([, value]) => value),
      keepClosedOts: comparison.plannedClosed.map((item) => item.ot).filter((ot) => !Object.values(values).includes(ot)),
    };
    const currentKeys = new Set((state.workOrders || []).map((item) => normalizeKey(item.ot)));
    const incomingKeys = new Set(incomingWorkOrders.map((item) => normalizeKey(item.ot)));
    const newCount = comparison.direct.filter((item) => !item.current).length;
    const updatedCount = comparison.direct.length - newCount + decisions.acceptQuantityOts.length;
    const absentCount = [...currentKeys].filter((key) => !incomingKeys.has(key)).length;
    const removedCount = absentCount - decisions.keepClosedOts.length;
    const pendingCount = comparison.plannedQuantityChanges.length - decisions.acceptQuantityOts.length
      + comparison.plannedClosed.length - decisions.removeClosedOts.length;
    checkpointState();
    const reconciledOts = new Set([
      ...comparison.plannedQuantityChanges.map((item) => normalizeKey(item.ot)),
      ...comparison.plannedClosed.map((item) => normalizeKey(item.ot)),
    ]);
    state.workOrderSyncWarnings = (state.workOrderSyncWarnings || [])
      .filter((warning) => !reconciledOts.has(normalizeKey(warning.ot)));
    state = window.PlanningWorkflowCore.applyConfirmedWorkOrderChanges(state, comparison, decisions);
    state.syncedAt = payload.syncedAt || payload.savedAt || new Date().toISOString();
    const saved = await callAppsScript("savePlanningStateOptimized", createAppSheetPayload());
    state.revision = Number(saved?.revision || state.revision);
    saveAndRender(`${newCount} nuevas; ${updatedCount} actualizadas; ${removedCount} retiradas; ${pendingCount} pendientes`);
    await persistPlanSnapshot();
  } catch (error) {
    showToast(`No se pudieron sincronizar las OTs: ${error.message}`, 9000);
  } finally {
    setPlanningActionsBusy("backlog-sync", false);
  }
}

async function syncNetSuiteTwoPhase(options = {}) {
  let workOrdersResult;
  setNetSuiteSyncPhaseLabel("Sincronizando OTs...");
  try {
    const payload = await callAppsScript("fetchNetSuiteWorkOrdersLite");
    validateNetSuiteImportedData(payload, "workOrders");
    state.workOrders = Array.isArray(payload.workOrders) ? payload.workOrders : state.workOrders;
    if (Array.isArray(payload.selectedOts)) state.selectedOts = payload.selectedOts;
    Object.assign(state, window.PlanningWorkflowCore.pruneDraftToOpenWorkOrders(state, state.workOrders));
    if (payload.invoicePriceWindow) state.invoicePriceWindow = payload.invoicePriceWindow;
    if (payload.plant) state.plant = payload.plant;
    state.syncedAt = payload.syncedAt || payload.savedAt || new Date().toISOString();
    workOrdersResult = { ok: true };
    saveState("ui");
    render();
  } catch (error) {
    return window.PlanningWorkflowCore.netSuiteSyncOutcome({ ok: false, error: error.message }, null);
  }

  setNetSuiteSyncPhaseLabel("Sincronizando operaciones...");
  try {
    const planningPayload = await window.PlanningWorkflowCore.withTimeout(
      callAppsScript("syncNetSuitePlanningData"),
      NETSUITE_PLANNING_TIMEOUT_MS * 4
    );
    applyNetSuitePlanningPayload(planningPayload);
    saveState("plan");
    render();
    if (options.persist !== false) {
      const saved = await callAppsScript("savePlanningStateOptimized", createAppSheetPayload());
      state.revision = Number(saved?.revision || state.revision);
    }
    return window.PlanningWorkflowCore.netSuiteSyncOutcome(workOrdersResult, { ok: true });
  } catch (error) {
    return window.PlanningWorkflowCore.netSuiteSyncOutcome(workOrdersResult, { ok: false, error: error.message });
  } finally {
    setNetSuiteSyncPhaseLabel("");
  }
}

function applyNetSuitePlanningPayload(payload) {
  const selected = new Set((state.selectedOts || []).map(normalizeKey));
  const preservedDraft = state.operations.filter((op) => selected.has(normalizeKey(op.ot)));
  const refreshed = (payload?.operations || []).filter((op) => !selected.has(normalizeKey(op.ot)));
  if (Array.isArray(payload?.operations)) state.operations = [...preservedDraft, ...refreshed];
  if (Array.isArray(payload?.materials)) state.materials = payload.materials;
  if (Array.isArray(payload?.operationCatalog)) state.operationCatalog = payload.operationCatalog;
  if (payload?.syncedAt) state.syncedAt = payload.syncedAt;
}

function setNetSuiteSyncPhaseLabel(message) {
  const label = els.loadNsExerciseBtn?.querySelector("[data-sync-label]");
  if (label) label.textContent = message || "Sincronizar";
}

function syncNetSuiteInBackground(options = {}) {
  syncNetSuiteData(options.showMessage === true, { mode: "workOrders" }).then((loaded) => {
    if (!loaded) return;
    saveState("ui");
    render();
    applyInitialWorkspaceView();
  });
}

async function syncNetSuiteData(showMessage, options = {}) {
  if (netSuiteSyncInFlight) {
    if (showMessage) showToast("La sincronizacion de NetSuite ya esta en curso");
    return false;
  }
  netSuiteSyncInFlight = true;
  setNetSuiteSyncState(true);
  const mode = options.mode === "full" ? "full" : "workOrders";
  try {
    if (isAppsScriptRuntime()) {
      const imported = mode === "full"
        ? await callAppsScript("syncNetSuitePlant")
        : await callAppsScript("syncNetSuiteWorkOrders");
      validateNetSuiteImportedData(imported, mode);
      applyImported(imported, { detectNetSuiteChanges: true, preserveLocalPlanning: true });
    } else {
      const response = await fetchNetSuiteExercise();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const imported = importJson(await response.text());
      validateNetSuiteImportedData(imported, mode);
      applyImported(imported, { detectNetSuiteChanges: true, preserveLocalPlanning: true });
    }
    clearNetSuiteSyncAlert();
    if (showMessage) {
      const message = mode === "full"
        ? `${state.workOrders.length} OTs y ${state.operations.length} operaciones NetSuite actualizadas`
        : `${state.workOrders.length} OTs NetSuite cargadas`;
      saveState("plan");
      render({ parts: { normalize: false, top: true, alerts: true, priorityList: true, queue: true, gantt: true } });
      showToast(message);
    }
    return true;
  } catch (error) {
    setNetSuiteSyncAlert(error.message);
    render({ saveScope: "ui" });
    if (showMessage) showToast(`No se pudo cargar NetSuite: ${error.message}`, 9000);
    return false;
  } finally {
    netSuiteSyncInFlight = false;
    setNetSuiteSyncState(false);
  }
}

function validateNetSuiteImportedData(imported, mode) {
  const workOrders = Array.isArray(imported?.workOrders) ? imported.workOrders : [];
  if (!workOrders.length) {
    throw new Error("NetSuite no devolvio OTs para Planta MM del Llano. Revisa credenciales, permisos del deployment y ejecuta runProductionReadinessCheck({liveNetSuite:true}).");
  }
  if (mode === "full") {
    const operations = Array.isArray(imported?.operations) ? imported.operations : [];
    const catalog = Array.isArray(imported?.operationCatalog) ? imported.operationCatalog : [];
    if (!operations.length || !catalog.length) {
      throw new Error("NetSuite devolvio OTs pero no devolvio operaciones/catalogo. Revisa RESTlet 1762 deploy 17 y permisos del token.");
    }
  }
}

function setNetSuiteSyncAlert(message) {
  state.netSuiteSyncAlert = {
    message: String(message || "No se pudo sincronizar NetSuite").trim(),
    updatedAt: new Date().toISOString(),
  };
}

function clearNetSuiteSyncAlert() {
  state.netSuiteSyncAlert = null;
}

function normalizeNetSuiteSyncAlert(alert) {
  if (!alert || typeof alert !== "object") return null;
  const message = String(alert.message || alert.mensaje || "").trim();
  if (!message) return null;
  return { message, updatedAt: String(alert.updatedAt || alert.fecha || "") };
}

async function ensurePlanningDataLoaded(showMessage, { force = false } = {}) {
  const hasData = () => window.PlanningWorkflowCore.hasPlanningData(state, state.selectedOts);
  if (!isAppsScriptRuntime()) return { ready: hasData(), source: hasData() ? "cached" : "none", warning: "" };
  const syncedAt = Date.parse(state.syncedAt || "");
  if (!force && Number.isFinite(syncedAt) && Date.now() - syncedAt < NETSUITE_PLANNING_FRESH_MS && hasData()) {
    return { ready: true, source: "fresh", warning: "" };
  }
  if (netSuitePlanningSyncInFlight) {
    if (showMessage) showToast("La carga de operaciones ya esta en curso");
    return { ready: hasData(), source: hasData() ? "cached" : "none", warning: "Sincronizacion en curso" };
  }
  netSuitePlanningSyncInFlight = true;
  setNetSuitePlanningSyncState(true);
  try {
    if (showMessage) showToast("Cargando operaciones y materiales de NetSuite...");
    const imported = await window.PlanningWorkflowCore.withTimeout(
      callAppsScript("syncNetSuitePlanningData"),
      NETSUITE_PLANNING_TIMEOUT_MS
    );
    applyImported(imported, { detectNetSuiteChanges: true, preserveLocalPlanning: true });
    return { ready: hasData(), source: "fresh", warning: "" };
  } catch (error) {
    const ready = hasData();
    const warning = ready
      ? "NetSuite no respondio; se programara con los datos ya cargados"
      : `No se pudieron cargar operaciones: ${error.message}`;
    if (showMessage) showToast(warning, 9000);
    return { ready, source: ready ? "cached" : "none", warning };
  } finally {
    netSuitePlanningSyncInFlight = false;
    setNetSuitePlanningSyncState(false);
  }
}

function setNetSuiteSyncState(inProgress) {
  if (!els.loadNsExerciseBtn) return;
  els.loadNsExerciseBtn.disabled = inProgress || Boolean(planningActionsBusy);
  if (inProgress) els.loadNsExerciseBtn.setAttribute("aria-busy", "true");
  else els.loadNsExerciseBtn.removeAttribute("aria-busy");
  const label = els.loadNsExerciseBtn.querySelector("[data-sync-label]");
  if (label) label.textContent = inProgress ? "Sincronizando..." : "Sincronizar";
  if (els.restoreDraftBtn) els.restoreDraftBtn.disabled = inProgress || Boolean(planningActionsBusy);
}

function setPlanningActionsBusy(action, inProgress) {
  planningActionsBusy = inProgress ? action : "";
  const busy = Boolean(planningActionsBusy);
  if (els.scheduleBtn) {
    els.scheduleBtn.disabled = busy;
    if (busy) els.scheduleBtn.setAttribute("aria-busy", "true");
    else els.scheduleBtn.removeAttribute("aria-busy");
  }
  if (els.loadNsExerciseBtn) {
    els.loadNsExerciseBtn.disabled = busy;
    if (busy) els.loadNsExerciseBtn.setAttribute("aria-busy", "true");
    else els.loadNsExerciseBtn.removeAttribute("aria-busy");
  }
  if (els.syncBacklogOtsBtn) {
    els.syncBacklogOtsBtn.disabled = busy;
    if (busy) els.syncBacklogOtsBtn.setAttribute("aria-busy", "true");
    else els.syncBacklogOtsBtn.removeAttribute("aria-busy");
  }
  if (els.restoreDraftBtn) {
    els.restoreDraftBtn.disabled = busy;
    if (busy) els.restoreDraftBtn.setAttribute("aria-busy", "true");
    else els.restoreDraftBtn.removeAttribute("aria-busy");
  }
}

function setNetSuitePlanningSyncState(inProgress) {
  if (!els.scheduleBtn) return;
  els.scheduleBtn.disabled = inProgress || Boolean(planningActionsBusy);
  els.scheduleBtn.classList.toggle("is-running", inProgress);
  const label = els.scheduleBtn.querySelector("[data-schedule-label]");
  if (label) label.textContent = inProgress ? "Cargando operaciones..." : "Generar plan";
}

async function fetchNetSuiteExercise() {
  try {
    const response = await fetch(NETSUITE_EXERCISE_API, { cache: "no-store" });
    if (response.ok) return response;
  } catch {
    // Opening index.html directly has no API; use the static JSON fallback.
  }
  return fetch("data/netsuite-exercise.json", { cache: "no-store" });
}

async function loadAppSheetIfAvailable(showMessage) {
  try {
    const imported = isAppsScriptRuntime()
      ? await callAppsScript("getAppState")
      : importJson(await fetchAppSheetText());
    applyImported(imported, { preserveLocalPlanning: true, preferRemotePlanning: true });
    appSheetAvailable = true;
    if (showMessage) showToast(`Hoja app cargada: ${state.operations.length} operaciones`);
    return true;
  } catch (error) {
    appSheetAvailable = false;
    if (showMessage) showToast(`No se pudo cargar hoja app: ${error.message}`);
    return false;
  }
}

async function fetchAppSheetText() {
  const response = await fetch(APP_SHEET_API, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function applyImported(imported, options = {}) {
  const preserveLocalPlanning = options.preserveLocalPlanning === true;
  const preservedLocalPlanning = preserveLocalPlanning ? captureLocalPlanningState() : null;
  const detectedNetSuiteAlerts = options.detectNetSuiteChanges
    ? detectNetSuiteOtChanges(state, imported, { detectedAt: new Date().toISOString() })
    : null;
  if (Array.isArray(imported.operations)) state.operations = imported.operations;
  if (Number.isFinite(Number(imported.schemaVersion))) state.schemaVersion = Number(imported.schemaVersion);
  if (Number.isFinite(Number(imported.revision))) state.revision = Number(imported.revision);
  if (imported.operators) state.operators = imported.operators;
  if (imported.operatorProfiles) state.operatorProfiles = imported.operatorProfiles;
  if (imported.otConfigurations) state.otConfigurations = imported.otConfigurations;
  if (imported.articleConfigurations) state.articleConfigurations = imported.articleConfigurations;
  if (imported.cts) state.cts = imported.cts;
  if (imported.plant) state.plant = imported.plant;
  if (Array.isArray(imported.operationCatalog)) state.operationCatalog = imported.operationCatalog;
  if (Array.isArray(imported.configuredCapabilities)) state.configuredCapabilities = imported.configuredCapabilities;
  if (imported.customCapabilities) state.customCapabilities = imported.customCapabilities;
  if (imported.hiddenCapabilities) state.hiddenCapabilities = imported.hiddenCapabilities;
  if (imported.capacityModes) state.capacityModes = imported.capacityModes;
  if (imported.matrix) state.matrix = imported.matrix;
  if (imported.operatorPerformance) state.operatorPerformance = imported.operatorPerformance;
  if (imported.ganttView) state.ganttView = imported.ganttView;
  if (Number.isFinite(Number(imported.ganttDayWidth))) state.ganttDayWidth = Number(imported.ganttDayWidth);
  if (imported.selectedOperationId) state.selectedOperationId = imported.selectedOperationId;
  if (Number.isFinite(imported.capacityMinutes)) state.capacityMinutes = imported.capacityMinutes;
  if (imported.planStart) state.planStart = imported.planStart;
  if (Number.isFinite(Number(imported.horizonDays))) state.horizonDays = Number(imported.horizonDays);
  if (imported.loadWeekStart) state.loadWeekStart = imported.loadWeekStart;
  if (imported.reportWeekStart) state.reportWeekStart = imported.reportWeekStart;
  if (Array.isArray(imported.selectedOts)) state.selectedOts = imported.selectedOts;
  if (Array.isArray(imported.lockedOts)) state.lockedOts = imported.lockedOts;
  if (Array.isArray(imported.expandedOts)) state.expandedOts = imported.expandedOts;
  if (imported.workSchedule) state.workSchedule = imported.workSchedule;
  if (imported.dailyBreaks) state.dailyBreaks = imported.dailyBreaks;
  if (imported.settings) state.settings = imported.settings;
  if (imported.operationRules) state.operationRules = imported.operationRules;
  if (Array.isArray(imported.machines)) state.machines = imported.machines;
  if (Array.isArray(imported.toolCatalog)) state.toolCatalog = imported.toolCatalog;
  if (Array.isArray(imported.toolHistory)) state.toolHistory = imported.toolHistory;
  if (Array.isArray(imported.materials)) state.materials = imported.materials;
  if (Array.isArray(imported.calendarExceptions)) state.calendarExceptions = imported.calendarExceptions;
  if (Array.isArray(imported.subcontracts)) state.subcontracts = imported.subcontracts;
  if (Array.isArray(imported.netSuiteChangeAlerts)) state.netSuiteChangeAlerts = imported.netSuiteChangeAlerts;
  if (imported.lastSchedule) state.lastSchedule = imported.lastSchedule;
  if (preservedLocalPlanning) {
    const remotePlanning = captureLocalPlanningState();
    const coherent = options.preferRemotePlanning
      ? window.PlanningWorkflowCore.selectAuthoritativeRemoteDraft(preservedLocalPlanning, remotePlanning)
      : window.PlanningWorkflowCore.selectNewestCoherentDraft(preservedLocalPlanning, remotePlanning);
    restoreLocalPlanningState(coherent || preservedLocalPlanning);
  }
  invalidateGanttCache();
  normalizeState();
}

function captureLocalPlanningState() {
  const keys = [
    "revision",
    "savedAt",
    "operations",
    "workOrders",
    "operators",
    "operatorProfiles",
    "operatorPerformance",
    "operatorCapacity",
    "cts",
    "configuredCapabilities",
    "customCapabilities",
    "hiddenCapabilities",
    "capacityModes",
    "matrix",
    "operationRules",
    "otConfigurations",
    "articleConfigurations",
    "selectedOts",
    "lockedOts",
    "expandedOts",
    "selectedOperationId",
    "machines",
    "toolCatalog",
    "machineToolHistory",
    "calendarExceptions",
    "subcontracts",
    "otTypes",
    "operationPlanStatuses",
    "preparedPlanningByOt",
    "workSchedule",
    "dailyBreaks",
    "settings",
    "planStart",
    "horizonDays",
    "loadWeekStart",
    "reportWeekStart",
    "reportFilters",
    "lastSchedule",
    "ganttView",
    "ganttDayWidth",
    "capacityMinutes",
    "draftVersionId",
    "activePublishedVersionId",
    "publishedVersions",
  ];
  return keys.reduce((out, key) => {
    if (Object.prototype.hasOwnProperty.call(state, key)) out[key] = deepClone(state[key]);
    return out;
  }, {});
}

function restoreLocalPlanningState(snapshot) {
  for (const [key, value] of Object.entries(snapshot || {})) {
    state[key] = deepClone(value);
  }
}

function importJson(text) {
  const parsed = JSON.parse(text);
  const operations = Array.isArray(parsed) ? parsed : parsed.operations;
  if (!Array.isArray(operations)) throw new Error("JSON sin operations");
  return {
    operations: operations.map((op, index) => normalizeOperation(op, index)),
    operators: Array.isArray(parsed.operators) ? parsed.operators : null,
    operatorProfiles: parsed.operatorProfiles && typeof parsed.operatorProfiles === "object" ? parsed.operatorProfiles : null,
    otConfigurations: parsed.otConfigurations && typeof parsed.otConfigurations === "object" ? parsed.otConfigurations : null,
    articleConfigurations: parsed.articleConfigurations && typeof parsed.articleConfigurations === "object" ? parsed.articleConfigurations : null,
    cts: Array.isArray(parsed.cts) ? parsed.cts : null,
    plant: parsed.plant || null,
    operationCatalog: Array.isArray(parsed.operationCatalog) ? parsed.operationCatalog : null,
    configuredCapabilities: Array.isArray(parsed.configuredCapabilities) ? parsed.configuredCapabilities : null,
    customCapabilities: Array.isArray(parsed.customCapabilities) ? parsed.customCapabilities : null,
    hiddenCapabilities: Array.isArray(parsed.hiddenCapabilities) ? parsed.hiddenCapabilities : null,
    capacityModes: parsed.capacityModes,
    matrix: parsed.matrix,
    operatorPerformance: parsed.operatorPerformance,
    ganttView: parsed.ganttView,
    ganttDayWidth: Number(parsed.ganttDayWidth),
    selectedOperationId: parsed.selectedOperationId,
    capacityMinutes: Number(parsed.capacityMinutes),
    schemaVersion: Number(parsed.schemaVersion),
    revision: Number(parsed.revision),
    planStart: parsed.planStart,
    horizonDays: Number(parsed.horizonDays),
    loadWeekStart: parsed.loadWeekStart,
    reportWeekStart: parsed.reportWeekStart,
    selectedOts: Array.isArray(parsed.selectedOts) ? parsed.selectedOts : null,
    lockedOts: Array.isArray(parsed.lockedOts) ? parsed.lockedOts : null,
    expandedOts: Array.isArray(parsed.expandedOts) ? parsed.expandedOts : null,
    workSchedule: parsed.workSchedule,
    dailyBreaks: parsed.dailyBreaks,
    settings: parsed.settings,
    operationRules: parsed.operationRules,
    machines: Array.isArray(parsed.machines) ? parsed.machines : null,
    toolCatalog: Array.isArray(parsed.toolCatalog) ? parsed.toolCatalog : null,
    machineToolHistory: Array.isArray(parsed.machineToolHistory) ? parsed.machineToolHistory : null,
    workOrders: Array.isArray(parsed.workOrders) ? parsed.workOrders : null,
    materials: Array.isArray(parsed.materials) ? parsed.materials : null,
    calendarExceptions: Array.isArray(parsed.calendarExceptions) ? parsed.calendarExceptions : null,
    subcontracts: Array.isArray(parsed.subcontracts) ? parsed.subcontracts : null,
    netSuiteChangeAlerts: Array.isArray(parsed.netSuiteChangeAlerts) ? parsed.netSuiteChangeAlerts : null,
    lastSchedule: parsed.lastSchedule,
  };
}

function importCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("CSV sin filas");
  const headers = rows[0].map(normalizeHeader);
  const operations = rows.slice(1).filter((row) => row.some(Boolean)).map((row, index) => {
    const op = {};
    headers.forEach((header, col) => {
      const field = FIELD_MAP[header];
      if (field) op[field] = row[col] || "";
    });
    return normalizeOperation(op, index);
  });
  return { operations };
}

function exportCsv() {
  const operations = window.PlanningWorkflowCore.draftExportOperations(state);
  const rows = [PLAN_HEADERS, ...operations.map(operationToRow)];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  downloadBlob(csv, "plan-produccion.csv", "text/csv;charset=utf-8");
}

function operationToRow(op) {
  return PLAN_HEADERS.map((header) => {
    if (header === "TIEMPO_PROD") return scheduledProductionMinutesForExport(op);
    const field = FIELD_MAP[header];
    return op[field] ?? "";
  });
}

function scheduledProductionMinutesForExport(op) {
  if (window.PlannerCore?.productionMinutes) return window.PlannerCore.productionMinutes(op);
  return adjustedProductionMinutes(op);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (char === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  row.push(cell.trim());
  rows.push(row);
  return rows;
}

function getPlanWindow() {
  const configured = parseDate(state.planStart);
  const starts = state.operations.map(opStart).filter(Boolean);
  const base = scheduledPlanWindowStart() || (configured
    ? new Date(configured.year, configured.month - 1, configured.day)
    : (starts.length ? new Date(Math.min(...starts.map((date) => date.getTime()))) : weekStart(new Date())));
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  return { start, end: addDays(start, state.horizonDays - 1) };
}

function scheduledPlanWindowStart() {
  const starts = state.operations
    .filter((op) => isJobScheduled(op.ot) && !isPlanCompletedOperation(op))
    .map(opStart)
    .filter(Boolean);
  if (!starts.length) return null;
  return new Date(Math.min(...starts.map((date) => date.getTime())));
}

function getGanttGroups() {
  const visibleOperations = state.operations.filter((op) => isJobScheduled(op.ot) && !isPlanCompletedOperation(op));
  const cacheKey = `${visibleOperations.length}-${state.ganttView}-${GANTT_GROUPS_CACHE_VERSION}`;
  
  if (GANTT_GROUPS_CACHE.has(cacheKey)) {
    return GANTT_GROUPS_CACHE.get(cacheKey);
  }
  
  let groups;
  
  if (state.ganttView === "job") {
    const byOt = new Map();
    for (const op of visibleOperations) {
      if (!byOt.has(op.ot)) byOt.set(op.ot, []);
      byOt.get(op.ot).push(op);
    }
    groups = [];
    const ots = [...byOt.keys()].sort((a, b) => jobPriorityForOt(a) - jobPriorityForOt(b) || String(a).localeCompare(String(b), "es", { numeric: true }));
    for (const ot of ots) {
      const ops = byOt.get(ot).sort((a, b) => sequenceSort(a, b) || opStart(a) - opStart(b));
      const workOrder = workOrderForOt(ot);
      const expanded = state.expandedOts.includes(ot);
      const totalMinutes = ops.reduce((sum, op) => sum + operationDurationCached(op), 0);
      groups.push({
        key: `job:${ot}`,
        ot,
        type: "job-summary",
        ops,
        expanded,
        locked: isJobLocked(ot),
        minutes: totalMinutes,
        subtitle: `${workOrder?.item || ops[0]?.parte || "SIN ARTICULO"} - ${ops.length} ops - ${Math.round(totalMinutes / 60)} h`,
      });
      if (expanded) {
        for (const op of ops) {
          groups.push({
            key: `op:${op.id}`,
            ot,
            type: "operation-row",
            ops: [op],
            minutes: operationDurationCached(op),
            subtitle: `CT ${op.ct}`,
          });
        }
      }
    }
  } else if (state.ganttView === "operation") {
    const seen = new Set();
    groups = visibleOperations
      .filter((op) => opStart(op) && opEnd(op) && (seen.has(`${op.ot}-${op.secuencia}`) ? false : seen.add(`${op.ot}-${op.secuencia}`)))
      .sort((a, b) => opStart(a) - opStart(b) || jobPriorityForOt(a.ot) - jobPriorityForOt(b.ot) || sequenceSort(a, b))
      .map((op) => ({
        key: `operation:${op.ot}-${op.secuencia}`,
        label: `OT ${op.ot} / Sec ${op.secuencia}`,
        ot: op.ot,
        type: "operation-flat",
        ops: [op],
        minutes: operationDurationCached(op),
        subtitle: `${op.descripcion || "Operacion"} - ${op.articulo || ""} - CT ${op.ct}`,
      }));
  } else if (state.ganttView === "ct") {
    const byCt = new Map();
    for (const op of visibleOperations) {
      if (!opStart(op) || !opEnd(op)) continue;
      const ct = op.ct || "SIN CT";
      if (!byCt.has(ct)) byCt.set(ct, []);
      byCt.get(ct).push(op);
    }
    const ctDescMap = new Map();
    for (const item of state.operationCatalog || []) {
      if (item.ct && item.label && !ctDescMap.has(item.ct)) ctDescMap.set(item.ct, item.label);
    }
    const sortedCts = [...byCt.keys()].sort((a, b) => String(a).localeCompare(String(b), "es", { numeric: true }));
    groups = sortedCts.map((ct) => {
      const ops = byCt.get(ct).sort((a, b) => sequenceSort(a, b) || opStart(a) - opStart(b));
      const totalMinutes = ops.reduce((sum, op) => sum + operationDurationCached(op), 0);
      return {
        key: ct,
        label: ctDescMap.get(ct) || ct,
        ot: "",
        ops,
        minutes: totalMinutes,
        subtitle: ganttGroupSubtitle(ops),
      };
    });
  } else {
    const groupField = ganttGroupField();
    const resourceOperations = visibleOperations.filter((op) => {
      if (state.ganttView === "machine") return ganttOperationHasMachine(op);
      if (state.ganttView === "operator") return isLoadBearingOperator(op.operador);
      return true;
    });
    const keys = uniq(resourceOperations.map((op) => op[groupField]).filter(Boolean));
    const sortedKeys = keys.sort((a, b) => String(a).localeCompare(String(b), "es", { numeric: true }));
    groups = sortedKeys.map((key) => {
      const ops = resourceOperations
        .filter((op) => op[groupField] === key)
        .sort((a, b) => sequenceSort(a, b) || opStart(a) - opStart(b));
      const totalMinutes = ops.reduce((sum, op) => sum + operationDurationCached(op), 0);
      return {
        key,
        label: key,
        ot: "",
        ops,
        minutes: totalMinutes,
        subtitle: ganttGroupSubtitle(ops),
      };
    });
  }
  
  GANTT_GROUPS_CACHE.set(cacheKey, groups);
  return groups;
}

function ganttOperationHasMachine(op) {
  return globalThis.PlanningWorkflowCore.isMachineGanttOperation(op);
}

function ganttGroupField() {
  if (state.ganttView === "operator") return "operador";
  if (state.ganttView === "machine") return "maquina";
  if (state.ganttView === "ct") return "ct";
  return "ot";
}

function ganttHeaderLabel() {
  if (state.ganttView === "operation") return "OT / Operacion";
  if (state.ganttView === "operator") return "Operador";
  if (state.ganttView === "machine") return "Maquina";
  return "OT / Secuencia";
}

function ganttViewMessage(view) {
  if (view === "operator") return "Vista por operador";
  if (view === "machine") return "Vista por maquina";
  if (view === "ct") return "Vista por centro de trabajo";
  return "Vista por trabajo";
}

function ganttGroupSubtitle(ops) {
  if (!ops.length) return "0 ops";
  const first = ops[0];
  const base = state.ganttView === "job"
    ? (first.parte || first.descripcion || first.contenido || "")
    : `${ops.length} ops`;
  return `${base ? `${base} - ` : ""}${ops.length} ops - ${Math.round(ops.reduce((sum, op) => sum + operationDuration(op), 0) / 60)} h`;
}

function getOperatorLoads(weekStartValue = state.loadWeekStart, horizonDays = 7) {
  return operatorLoadsForOperations(
    state.operations.filter((op) => isJobScheduled(op.ot) && !isPlanCompletedOperation(op)),
    weekStartValue,
    horizonDays
  );
}

function operatorLoadsForOperations(sourceOperations, weekStartValue = state.loadWeekStart, horizonDays = 7) {
  const range = selectedWeekRange(weekStartValue);
  const scheduledOts = getScheduledOts();
  const loadState = { ...state, selectedOts: scheduledOts, planStart: formatDate(range.start), horizonDays };
  const loadOperators = uniq([...state.operators, ...(sourceOperations || []).map((op) => op.operador)])
    .filter(isLoadBearingOperator);
  return loadOperators
    .map((operator) => {
      const minutes = (sourceOperations || [])
        .filter((op) => op.operador === operator && isLoadBearingOperator(op.operador))
        .reduce((sum, op) => sum + operationMinutesInRange(op, range.start, range.end), 0);
      const available = window.PlannerCore?.availableMinutes
        ? window.PlannerCore.availableMinutes(state, operator, formatDate(range.start), horizonDays)
        : state.capacityMinutes;
      const nextAvailable = window.PlannerCore?.nextResourceAvailability
        ? window.PlannerCore.nextResourceAvailability(loadState, operator, "", formatDate(range.start))
        : null;
      return {
        operator,
        minutes,
        available,
        nextAvailable,
        percent: available ? (minutes / available) * 100 : 0,
      };
    })
    .sort((a, b) => b.percent - a.percent);
}

function operationMinutesInRange(op, rangeStart, rangeEnd) {
  const start = opStart(op);
  const end = opEnd(op);
  if (!start || !end || start >= rangeEnd || end <= rangeStart) return 0;
  const duration = operationDuration(op);
  const elapsed = Math.max(1, diffMinutes(start, end));
  const overlapStart = start > rangeStart ? start : rangeStart;
  const overlapEnd = end < rangeEnd ? end : rangeEnd;
  return duration * Math.max(0, diffMinutes(overlapStart, overlapEnd)) / elapsed;
}

function getCtLoads() {
  const selectedCts = uniq(state.operations.filter((op) => isJobScheduled(op.ot) && !isPlanCompletedOperation(op)).map((op) => op.ct));
  const maxMinutes = Math.max(1, ...selectedCts.map((ct) => state.operations
    .filter((op) => isJobScheduled(op.ot) && !isPlanCompletedOperation(op) && op.ct === ct && isFiniteCapacityOperation(op))
    .reduce((sum, op) => sum + operationDuration(op), 0)));
  return selectedCts
    .map((ct) => {
      const minutes = state.operations
        .filter((op) => isJobScheduled(op.ot) && !isPlanCompletedOperation(op) && op.ct === ct && isFiniteCapacityOperation(op))
        .reduce((sum, op) => sum + operationDuration(op), 0);
      return { ct, minutes, percent: (minutes / maxMinutes) * 100 };
    })
    .sort((a, b) => b.minutes - a.minutes);
}

function operationDuration(op) {
  if (!op) return MIN_OPERATION_MINUTES;
  const start = opStart(op);
  const end = opEnd(op);
  if (isSubcontractAppOperation(op)) {
    if (start && end) return Math.max(MIN_OPERATION_MINUTES, diffMinutes(start, end));
    const days = Number(op.subcontractDays || 0);
    if (days > 0) return Math.max(MIN_OPERATION_MINUTES, days * WORK_DAY_MINUTES);
    return MIN_OPERATION_MINUTES;
  }
  const explicit = Number(op.tiempoSetup || 0) + adjustedProductionMinutes(op);
  if (explicit > 0) return explicit;
  if (start && end) return Math.max(MIN_OPERATION_MINUTES, diffMinutes(start, end));
  return MIN_OPERATION_MINUTES;
}

const OPERATION_DURATION_CACHE = new Map();
const OPERATION_DURATION_CACHE_KEYS = new WeakMap();

function operationDurationCached(op) {
  if (!op) return MIN_OPERATION_MINUTES;
  const key = op.id || `${op.ot}-${op.secuencia}-${op.operador || ''}-${op.maquina || ''}`;
  if (OPERATION_DURATION_CACHE.has(key)) {
    return OPERATION_DURATION_CACHE.get(key);
  }
  const duration = operationDuration(op);
  OPERATION_DURATION_CACHE.set(key, duration);
  return duration;
}

function clearOperationDurationCache() {
  OPERATION_DURATION_CACHE.clear();
}

function adjustedProductionMinutes(op) {
  const performance = Math.max(1, operatorPerformanceForOperator(op.operador));
  const capability = capabilityFromOperation(op);
  const rule = state.operationRules[capability.key] || state.operationRules[capability.ct] || {};
  const efficiency = Math.max(1, Math.min(100, Number(rule.efficiency ?? rule.eficiencia) || 100));
  const production = window.PlannerCore?.productionMinutes?.(op) ?? Number(op.tiempoProd || 0);
  return Math.ceil(production * (2 - efficiency / 100) * 100 / performance);
}

function opStart(op) {
  if (!op) return null;
  return parseDateTime(op.fechaInicio, op.horaInicio);
}

function opEnd(op) {
  if (!op) return null;
  return parseDateTime(op.fechaFin, op.horaFin);
}

function setOperationStart(op, date) {
  op.fechaInicio = formatDate(date);
  op.horaInicio = formatTime(date);
}

function setOperationEnd(op, date) {
  op.fechaFin = formatDate(date);
  op.horaFin = formatTime(date);
}

function parseDateTime(dateText, timeText) {
  if (!dateText || !timeText) return null;
  const datePart = parseDate(dateText);
  const timePart = parseTime(timeText);
  if (!datePart || !timePart) return null;
  return new Date(datePart.year, datePart.month - 1, datePart.day, timePart.hour, timePart.minute, 0, 0);
}

function parseDate(value) {
  const text = String(value || "").trim();
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  const slash = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (slash) {
    const year = Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]);
    return { year, month: Number(slash[2]), day: Number(slash[1]) };
  }
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
  return null;
}

function parseTime(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function normalizeWeekStartValue(value) {
  const parsed = parseDate(value);
  const date = parsed
    ? new Date(parsed.year, parsed.month - 1, parsed.day)
    : new Date();
  return formatDate(weekStart(date));
}

function normalizeReportFilters(filters, fallbackDate) {
  const source = filters && typeof filters === "object" ? filters : {};
  return ["operator", "adjuster", "subcontract"].reduce((out, type) => {
    const current = source[type] && typeof source[type] === "object" ? source[type] : {};
    const parsed = parseDate(current.date || fallbackDate);
    out[type] = {
      date: parsed ? formatDate(new Date(parsed.year, parsed.month - 1, parsed.day)) : fallbackDate,
      showAll: current.showAll === true,
      futureDays: Math.max(1, Math.min(5, Number(current.futureDays) || 1)),
      status: ["PENDIENTES", "COMPLETADAS", "TODAS"].includes(String(current.status || "").toUpperCase())
        ? String(current.status).toUpperCase()
        : "PENDIENTES",
    };
    return out;
  }, {});
}

function reportFilter(type) {
  state.reportFilters = normalizeReportFilters(state.reportFilters, state.reportWeekStart);
  return state.reportFilters[type];
}

function updateReportFilter(type, patch) {
  const current = reportFilter(type);
  state.reportFilters[type] = normalizeReportFilters({ [type]: { ...current, ...patch } }, state.reportWeekStart)[type];
  renderReports();
  saveState();
}

function syncReportFilterDates(date) {
  state.reportFilters = normalizeReportFilters(state.reportFilters, state.reportWeekStart);
  for (const type of ["operator", "adjuster", "subcontract"]) {
    state.reportFilters[type].date = normalizeReportFilters({ [type]: { date } }, state.reportWeekStart)[type].date;
  }
}

function filteredReportRows(rows, type, dateGetter) {
  const filter = reportFilter(type);
  const statusRows = window.PlanningWorkflowCore.filterOperationsByPlanStatus(rows, filter.status);
  const range = window.PlanningWorkflowCore.reportDateRange(filter.date, filter.futureDays);
  const rangeRows = statusRows.filter((row) => {
    const date = dateGetter(row);
    const value = date && formatDate(date);
    return value && value >= range.start && value <= range.end;
  });
  const source = rangeRows.slice().sort((a, b) => Number(dateGetter(a)) - Number(dateGetter(b)));
  return {
    rows: source.slice(0, REPORT_ROW_LIMIT),
    total: source.length,
    showAll: false,
    date: filter.date,
    futureDays: filter.futureDays,
  };
}

function renderReportFilterStatus(type, input, futureDaysSelect, output, selection) {
  input.value = selection.date;
  futureDaysSelect.value = String(selection.futureDays);
  output.textContent = `${selection.rows.length} de ${selection.total} · max. ${REPORT_ROW_LIMIT}`;
  output.title = `Limitado a ${REPORT_ROW_LIMIT} filas para impresion`;
}

function selectedWeekRange(value) {
  const parsed = parseDate(normalizeWeekStartValue(value));
  const start = new Date(parsed.year, parsed.month - 1, parsed.day);
  return { start, end: addDays(start, 7) };
}

function cleanResourceValue(value) {
  const text = String(value || "").trim();
  return ["", "SIN_MAQUINA", "SIN MAQUINA", "N/A"].includes(normalizeStatus(text)) ? "" : text;
}

function weekStart(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  return result;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function workWindowMinutes() {
  return state.horizonDays * WORK_DAY_MINUTES;
}

function workMinuteOffset(date, windowStart) {
  const dayStart = new Date(windowStart);
  dayStart.setHours(0, 0, 0, 0);
  const current = new Date(date);
  const dayIndex = Math.max(0, Math.min(state.horizonDays - 1, Math.floor((current - dayStart) / 86400000)));
  const minuteOfDay = current.getHours() * 60 + current.getMinutes();
  const workMinute = Math.max(0, Math.min(WORK_DAY_MINUTES, minuteOfDay - WORK_START_HOUR * 60));
  return dayIndex * WORK_DAY_MINUTES + workMinute;
}

function dateFromWorkOffset(windowStart, offset, boundaryMode = "start") {
  const bounded = Math.max(0, Math.min(workWindowMinutes(), snap(offset, ganttSnapMinutes())));
  let dayIndex = Math.floor(bounded / WORK_DAY_MINUTES);
  let minuteInDay = bounded - dayIndex * WORK_DAY_MINUTES;
  if (boundaryMode === "end" && bounded > 0 && minuteInDay === 0) {
    dayIndex -= 1;
    minuteInDay = WORK_DAY_MINUTES;
  }
  dayIndex = Math.min(state.horizonDays - 1, dayIndex);
  minuteInDay = Math.min(WORK_DAY_MINUTES, minuteInDay);
  const result = addDays(windowStart, dayIndex);
  result.setHours(WORK_START_HOUR, 0, 0, 0);
  return addMinutes(result, minuteInDay);
}

function addWorkMinutes(date, minutes, windowStart) {
  const offset = workMinuteOffset(date, windowStart);
  return dateFromWorkOffset(windowStart, Math.min(workWindowMinutes(), offset + Math.max(0, minutes)), "end");
}

function isGeneralWorkingDay(date) {
  if (window.PlannerCore?.effectiveWindows) return window.PlannerCore.effectiveWindows(state, date, "", "").length > 0;
  return date.getDay() >= 1 && date.getDay() <= 5;
}

function diffMinutes(start, end) {
  return Math.round((end.getTime() - start.getTime()) / 60000);
}

function snap(value, increment) {
  return Math.round(value / increment) * increment;
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatTime(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatDateTime(date) {
  if (!date) return "";
  return `${formatDate(date)} ${formatTime(date)}`;
}

function formatMinutes(minutes) {
  const value = Number(minutes || 0);
  return `${Number.isInteger(value) ? value : value.toFixed(1)} min`;
}

function formatHours(minutes) {
  const hours = Number(minutes || 0) / 60;
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`;
}

function formatShortDate(date) {
  return date.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

function formatDayHeader(date) {
  return date.toLocaleDateString("es-MX", { weekday: "short", day: "2-digit", month: "short" });
}

function formatAvailability(date) {
  if (!date) return "Sin hueco";
  return `${formatShortDate(date)} ${formatTime(date)}`;
}

function compareOperations(a, b) {
  return (
    jobPriorityForOperation(a) - jobPriorityForOperation(b) ||
    String(a.ot).localeCompare(String(b.ot), "es", { numeric: true }) ||
    new Date(a.fechaReq || "9999-12-31") - new Date(b.fechaReq || "9999-12-31") ||
    sequenceSort(a, b)
  );
}

function sequenceSort(a, b) {
  return (
    Number(a.secuencia || 0) - Number(b.secuencia || 0) ||
    String(a.ct || "").localeCompare(String(b.ct || ""), "es", { numeric: true }) ||
    Number(a.num || 0) - Number(b.num || 0)
  );
}

function getJobSequence(op) {
  return state.operations
    .filter((item) => item.ot === op.ot && !isPlanCompletedOperation(item))
    .sort((a, b) => sequenceSort(a, b) || opStart(a) - opStart(b));
}

function getPriorityJobs() {
  const map = new Map();
  for (const op of state.operations) {
    const job = map.get(op.ot) || {
      ot: op.ot,
      ops: [],
    };
    job.ops.push(op);
    map.set(op.ot, job);
  }
  for (const workOrder of state.workOrders) {
    if (!workOrder.ot || map.has(workOrder.ot)) continue;
    map.set(workOrder.ot, {
      ot: workOrder.ot,
      ops: [],
      workOrderOnly: true,
    });
  }

  return [...map.values()]
    .map((job) => {
      const ops = job.ops.sort((a, b) => sequenceSort(a, b) || opStart(a) - opStart(b));
      const workOrder = workOrderForOt(job.ot);
      const firstOp = ops[0] || workOrderPlaceholderOperation(workOrder || { ot: job.ot });
      return {
        ...job,
        ops,
        firstOp,
        prioridad: jobPriority(ops),
        descripcion: workOrder?.description || "",
        parte: workOrder?.item || ops.find((op) => op.parte)?.parte || "",
        photoUrl: workOrder?.photoUrl || "",
        startDate: workOrder?.startDate || "",
        endDate: workOrder?.endDate || "",
        dueDate: effectiveWorkOrderDueDate(workOrder) || ops.find((op) => op.fechaReq)?.fechaReq || "",
        quantity: pendingPiecesForWorkOrder(workOrder),
        cts: uniq(ops.map((op) => op.ct).filter(Boolean)),
        operators: uniq(ops.map((op) => op.operador).filter(Boolean)),
        materials: materialsForOt(job.ot),
        materialBase: materialBaseForOt(job.ot),
        status: jobStatusForOt(job.ot),
        movable: isMovablePlanningStatus(jobStatusForOt(job.ot)),
        programmed: isProgrammedJobStatus(jobStatusForOt(job.ot)),
        closed: isClosedJobStatus(jobStatusForOt(job.ot)),
        locked: isJobLocked(job.ot),
        firstSequence: ops[0]?.secuencia ?? "",
        lastSequence: ops[ops.length - 1]?.secuencia ?? "",
        minutes: ops.reduce((sum, op) => sum + operationDuration(op), 0),
        firstStart: opStart(firstOp),
      };
    })
    .sort(compareJobs);
}

function getSelectedPriorityJob() {
  const selectedOp = findOperation(state.selectedOperationId);
  const jobs = getPriorityJobs();
  if (!jobs.length) return null;
  if (selectedOp) return jobs.find((job) => job.ot === selectedOp.ot) || null;
  return jobs.find((job) => job.firstOp?.id === state.selectedOperationId)
    || null;
}

function workOrderPlaceholderOperation(workOrder) {
  return {
    id: `wo-placeholder-${workOrder?.ot || "sin-ot"}`,
    ot: String(workOrder?.ot || "").trim(),
    parte: String(workOrder?.item || "").trim(),
    descripcion: "Operaciones pendientes de cargar",
    secuencia: "",
    ct: "",
    prioridad: 999,
    fechaReq: effectiveWorkOrderDueDate(workOrder),
    cantTotal: pendingPiecesForWorkOrder(workOrder),
    cantPendiente: pendingPiecesForWorkOrder(workOrder),
    tiempoCiclo: 0,
    tiempoSetup: 0,
    tiempoProd: 0,
    tipoInsercion: "PENDIENTE_NETSUITE",
    estatus: workOrder?.status || "",
  };
}

function getMachineOptions(ops) {
  return uniq(compatibleMachineOptionsForOps(ops))
    .filter(Boolean)
    .sort((a, b) => machineSortValue(a) - machineSortValue(b) || a.localeCompare(b, "es", { numeric: true }));
}

function compatibleMachineOptionsForOps(ops) {
  const bendingOps = ops.filter(isBendingAppOperation);
  if (!bendingOps.length) return [];
  const activeMachines = state.machines.filter((machine) => machine.active !== false);
  const machineIds = uniq(activeMachines
    .map((machine) => machine.id || machine.machine || machine.maquina)
    .filter(Boolean));
  return machineIds.filter((machineId) =>
    normalizeStatus(machineId) !== "SIN_MAQUINA" &&
    !(String(machineId) === "1" && bendingOps.some((op) => String(op.ct) === "5459"))
  );
}

function machineSortValue(machine) {
  return normalizeStatus(machine) === "SIN_MAQUINA" ? -1 : 0;
}

function machineLabel(machine) {
  return normalizeStatus(machine) === "SIN_MAQUINA" ? "" : machine;
}

function getBulkMachineValue(ops) {
  const machines = uniq(ops.filter(isBendingAppOperation).map((op) => normalizeMachineValue(op.maquina, op)));
  if (!machines.length) return "";
  return machines.length === 1 ? machines[0] : "__MULTIPLE__";
}

function applyMachineToJob(ot, machine) {
  const normalized = normalizeMachineValue(machine);
  const configuration = otConfigurationFor(ot);
  configuration.machine = normalized;
  configuration.updatedAt = new Date().toISOString();
  for (const op of state.operations.filter((item) => item.ot === ot && isBendingAppOperation(item))) {
    op.maquina = normalizeMachineValue(normalized, op);
    op.log = appendLog(op.log, "MAQUINA_OT_APP");
  }
}

function applyToolToJob(ot, tool) {
  const normalized = cleanToolValue(tool);
  const configuration = otConfigurationFor(ot);
  configuration.herramental = normalized;
  configuration.updatedAt = new Date().toISOString();
  state.operations = window.PlanningWorkflowCore.applyDraftToolSelection(state.operations, ot, normalized, ["5459", "5527"]);
  const bendingOps = state.operations.filter((item) => item.ot === ot && isBendingAppOperation(item));
  const part = String(bendingOps[0]?.parte || workOrderForOt(ot)?.item || "").trim().toUpperCase();
  if (part && normalized) {
    const existing = state.toolCatalog.find((item) => item.active !== false && normalizeStatus(item.part || item.parte) === normalizeStatus(part) && cleanToolValue(item.herramental) === normalized);
    if (!existing) state.toolCatalog.push({
      id: uid("tool"), part, herramental: normalized, kitHerramental: getOtKitValue(bendingOps),
      toolSetupMinutes: 0, kitSetupMinutes: 0, active: true,
    });
  }
  if (state.preparedPlanningByOt) delete state.preparedPlanningByOt[ot];
  for (const op of bendingOps) op.log = appendLog(op.log, "HERRAMENTAL_OT_APP");
}

function getOtKitValue(ops) {
  return ops.filter(operationUsesOtKit).map((op) => cleanToolValue(op.kitHerramental)).find(Boolean) || "";
}

function applyKitToJob(ot, kit, pending = false) {
  const normalized = cleanToolValue(kit);
  const configuration = otConfigurationFor(ot);
  configuration.kitHerramental = pending ? "" : normalized;
  configuration.kitPending = pending;
  configuration.updatedAt = new Date().toISOString();
  for (const op of state.operations.filter((item) => item.ot === ot && operationUsesOtKit(item))) {
    op.kitHerramental = pending ? "" : normalized;
    op.kitPending = pending;
    op.log = appendLog(op.log, "KIT_OT_APP");
  }
}

function isBendingAppOperation(op) {
  if (window.PlannerCore?.isBendingOperation) return window.PlannerCore.isBendingOperation(op);
  return ["5459", "5527"].includes(String(op.ct || ""));
}

function operationUsesOtKit(op) {
  return isBendingAppOperation(op);
}

function isBendingCapability(capability) {
  return ["5459", "5527"].includes(String(capability.ct || ""));
}

function otConfigurationFor(ot) {
  const key = String(ot || "").trim();
  if (!state.otConfigurations[key]) {
    state.otConfigurations[key] = {
      ot: key,
      machine: "",
      herramental: "",
      kitHerramental: "",
      kitPending: false,
      subcontractType: "",
      subcontractDays: 0,
      updatedAt: "",
    };
  }
  return state.otConfigurations[key];
}

function normalizeArticleConfigurations(source) {
  const out = {};
  if (!source || typeof source !== "object") return out;
  for (const [key, item] of Object.entries(source)) {
    const article = articleKeyForPart(item?.article || item?.articulo || key);
    if (!article) continue;
    out[article] = {
      article,
      jobType: String(item.jobType || item.tipoOt || "").trim().toUpperCase(),
      planningType: String(item.planningType || item.tipoTrabajo || "").trim().toUpperCase(),
      manualUnitPrice: Math.max(0, Number(item.manualUnitPrice || item.precioManual || 0)),
      updatedAt: String(item.updatedAt || item.actualizado || ""),
    };
  }
  return out;
}

function migrateLegacyCommercialOtConfigurations() {
  for (const [ot, configuration] of Object.entries(state.otConfigurations || {})) {
    if (!configuration || typeof configuration !== "object") continue;
    const hasCommercial = configuration.jobType || configuration.tipoOt || configuration.planningType || configuration.tipoTrabajo || Number(configuration.manualUnitPrice || configuration.precioManual) > 0;
    if (!hasCommercial) continue;
    const article = articleForOt(ot);
    if (!article) continue;
    const articleConfig = articleConfigurationFor(article);
    if (!articleConfig.jobType) articleConfig.jobType = String(configuration.jobType || configuration.tipoOt || "").trim().toUpperCase();
    if (!articleConfig.planningType) articleConfig.planningType = String(configuration.planningType || configuration.tipoTrabajo || "").trim().toUpperCase();
    if (!(articleConfig.manualUnitPrice > 0)) articleConfig.manualUnitPrice = Math.max(0, Number(configuration.manualUnitPrice || configuration.precioManual || 0));
    articleConfig.updatedAt = articleConfig.updatedAt || String(configuration.updatedAt || configuration.actualizado || new Date().toISOString());
    delete configuration.jobType;
    delete configuration.tipoOt;
    delete configuration.planningType;
    delete configuration.tipoTrabajo;
    delete configuration.manualUnitPrice;
    delete configuration.precioManual;
  }
}

function articleForOt(ot) {
  const operationPart = state.operations.find((op) => String(op.ot) === String(ot))?.parte;
  return articleKeyForPart(operationPart || workOrderForOt(ot)?.item || "");
}

function articleKeyForPart(part) {
  return String(part || "").trim().toUpperCase();
}

function articleConfigurationFor(part) {
  const article = articleKeyForPart(part);
  if (!article) {
    return { article: "", jobType: "", planningType: "", manualUnitPrice: 0, updatedAt: "" };
  }
  if (!state.articleConfigurations[article]) {
    state.articleConfigurations[article] = {
      article,
      jobType: "",
      planningType: "",
      manualUnitPrice: 0,
      updatedAt: "",
    };
  }
  return state.articleConfigurations[article];
}

function articleConfigurationValue(part) {
  const article = articleKeyForPart(part);
  return article ? (state.articleConfigurations?.[article] || {}) : {};
}

function applySubcontractToJob(ot, type, days) {
  const configuration = otConfigurationFor(ot);
  configuration.subcontractType = String(type || "").trim().toUpperCase();
  configuration.subcontractDays = Math.max(0, Math.min(90, Math.round(Number(days) || 0)));
  configuration.updatedAt = new Date().toISOString();
  const jobOperations = state.operations.filter((item) => item.ot === ot);
  const part = String(jobOperations[0]?.parte || workOrderForOt(ot)?.item || "").trim().toUpperCase();
  if (part && configuration.subcontractType && configuration.subcontractDays > 0) {
    const existing = state.subcontracts.find((item) =>
      item.active !== false &&
      normalizeStatus(item.part) === normalizeStatus(part) &&
      normalizeStatus(item.name) === normalizeStatus(configuration.subcontractType)
    );
    if (existing) {
      existing.days = configuration.subcontractDays;
      existing.active = true;
    } else {
      state.subcontracts.push({
        id: uid("sub"),
        part,
        name: configuration.subcontractType,
        days: configuration.subcontractDays,
        keywords: configuration.subcontractType,
        active: true,
      });
    }
  }
  for (const op of jobOperations) {
    if (!isSubcontractAppOperation(op)) continue;
    op.subcontractType = configuration.subcontractType;
    op.subcontractDays = configuration.subcontractDays;
    op.operador = "SUBCONTRATO";
    op.maquina = "";
    op.log = appendLog(op.log, "SUBCONTRATO_OT_APP");
  }
}

function normalizeOtResourceAssignments() {
  const sourceConfigurations = state.otConfigurations || {};
  const nextConfigurations = {};
  const operationsByOt = new Map();
  for (const op of state.operations) {
    if (!operationsByOt.has(op.ot)) operationsByOt.set(op.ot, []);
    operationsByOt.get(op.ot).push(op);
  }
  for (const [ot, operations] of operationsByOt.entries()) {
    const bendingOps = operations.filter(isBendingAppOperation);
    operations.filter((op) => !isBendingAppOperation(op)).forEach((op) => {
      op.herramental = "";
      op.kitHerramental = "";
      op.kitPending = false;
    });
    const storedKey = Object.keys(sourceConfigurations).find((key) => normalizeStatus(key) === normalizeStatus(ot));
    const stored = storedKey ? sourceConfigurations[storedKey] : null;
    const derivedMachine = bendingOps
      .map((op) => normalizeMachineValue(op.maquina, op))
      .find(Boolean) || "";

    const kitOps = operations.filter(operationUsesOtKit);
    const derivedKit = kitOps.map((op) => cleanToolValue(op.kitHerramental)).find(Boolean) || "";
    const derivedPending = !derivedKit && kitOps.some((op) => op.kitPending === true);
    const subcontractOps = operations.filter(isSubcontractAppOperation);
    const configuration = {
      ot,
      machine: stored ? normalizeMachineValue(stored.machine || stored.maquina) : derivedMachine,
      herramental: stored ? cleanToolValue(stored.herramental || stored.tool) : (bendingOps.map((op) => cleanToolValue(op.herramental)).find(Boolean) || ""),
      kitHerramental: stored ? cleanToolValue(stored.kitHerramental || stored.kit) : derivedKit,
      kitPending: stored ? stored.kitPending === true : derivedPending,
      subcontractType: stored
        ? String(stored.subcontractType || stored.tipoSubcontrato || "").trim().toUpperCase()
        : String(subcontractOps.find((op) => op.subcontractType)?.subcontractType || "").trim().toUpperCase(),
      subcontractDays: stored
        ? Math.max(0, Math.round(Number(stored.subcontractDays || stored.diasSubcontrato) || 0))
        : Math.max(0, Math.round(Number(subcontractOps.find((op) => Number(op.subcontractDays) > 0)?.subcontractDays || 0))),
      updatedAt: String(stored?.updatedAt || stored?.actualizado || ""),
    };
    if (configuration.kitPending) configuration.kitHerramental = "";
    nextConfigurations[ot] = configuration;
    bendingOps.forEach((op) => { op.maquina = normalizeMachineValue(configuration.machine, op); });
    bendingOps.forEach((op) => { op.herramental = configuration.herramental; });
    kitOps.forEach((op) => {
      op.kitHerramental = configuration.kitHerramental;
      op.kitPending = configuration.kitPending;
    });
    operations.filter((op) => !isBendingAppOperation(op) && op.tipoInsercion !== "CAMBIO_HERRAMENTAL").forEach((op) => {
      op.maquina = "";
    });
    subcontractOps.forEach((op) => {
      op.subcontractType = configuration.subcontractType;
      op.subcontractDays = configuration.subcontractDays;
      op.operador = "SUBCONTRATO";
      op.maquina = "";
    });
  }
  state.otConfigurations = nextConfigurations;
}

function normalizeMachineValue(value, op) {
  const machine = String(value || "").trim();
  if (!machine || normalizeStatus(machine) === "SIN_MAQUINA") return "";
  if (op && String(op.ct) === "5459" && machine === "1") return "";
  return machine;
}

function getJobToolGroups(ops) {
  const map = new Map();
  for (const op of ops) {
    const label = toolLabel(op);
    if (label === "SIN HERRAMENTAL") continue;
    const current = map.get(label) || { label, count: 0 };
    current.count += 1;
    map.set(label, current);
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, "es", { numeric: true }));
}

function materialsForOt(ot) {
  const key = materialOtKey(ot);
  return state.materials.filter((material) => materialOtKey(material.ot) === key);
}

function workOrderForOt(ot) {
  const key = materialOtKey(ot);
  return state.workOrders.find((item) => materialOtKey(item.ot) === key) || null;
}

function pendingPiecesForWorkOrder(workOrder) {
  if (!workOrder) return 0;
  if (Number.isFinite(Number(workOrder.pendingQuantity))) return Math.max(0, Number(workOrder.pendingQuantity));
  return Math.max(0, Number(workOrder.quantity || 0) - Number(workOrder.builtQuantity || 0));
}

function invoiceUnitPriceForOt(ot) {
  return Math.max(0, Number(workOrderForOt(ot)?.averageSalePrice || 0));
}

function effectiveUnitPriceForOt(ot) {
  const invoicePrice = invoiceUnitPriceForOt(ot);
  return invoicePrice > 0 ? invoicePrice : Math.max(0, Number(articleConfigurationValue(articleForOt(ot)).manualUnitPrice || 0));
}

function amountForOt(ot) {
  return effectiveUnitPriceForOt(ot) * pendingPiecesForWorkOrder(workOrderForOt(ot));
}

function effectiveWorkOrderDueDate(workOrder) {
  return normalizeOtDate(workOrder?.dueDateOverride || workOrder?.dueDate);
}

function applyWorkOrderDueDates() {
  const dueDateByOt = new Map(state.workOrders.map((item) => [materialOtKey(item.ot), effectiveWorkOrderDueDate(item)]));
  for (const op of state.operations) {
    if (String(op.tipoInsercion || "").toUpperCase() === "CAMBIO_HERRAMENTAL") continue;
    const dueDate = dueDateByOt.get(materialOtKey(op.ot));
    if (dueDate) op.fechaReq = dueDate;
  }
}

function mergeWorkOrderOverrides(incoming) {
  const existingByOt = new Map((state.workOrders || []).map((item) => [materialOtKey(item.ot), item]));
  return incoming.map((item) => {
    const existing = existingByOt.get(materialOtKey(item.ot));
    const hasImportedOverride = Object.prototype.hasOwnProperty.call(item, "dueDateOverride") || Object.prototype.hasOwnProperty.call(item, "fechaEntregaAjustada");
    return {
      ...item,
      dueDateOverride: hasImportedOverride
        ? (item.dueDateOverride || item.fechaEntregaAjustada || "")
        : (existing?.dueDateOverride || ""),
    };
  });
}

function updateWorkOrderDueDate(ot, value) {
  const workOrder = workOrderForOt(ot);
  if (!workOrder) return;
  checkpointState();
  const requestedDate = normalizeOtDate(value);
  const netSuiteDate = normalizeOtDate(workOrder.dueDate);
  workOrder.dueDateOverride = requestedDate && requestedDate !== netSuiteDate ? requestedDate : "";
  const effectiveDate = effectiveWorkOrderDueDate(workOrder);
  for (const op of state.operations.filter((item) => item.ot === ot && item.tipoInsercion !== "CAMBIO_HERRAMENTAL")) {
    if (effectiveDate) op.fechaReq = effectiveDate;
    op.log = appendLog(op.log, workOrder.dueDateOverride ? "FECHA_ENTREGA_AJUSTADA_APP" : "FECHA_ENTREGA_NETSUITE_APP");
  }
  saveAndRender(workOrder.dueDateOverride ? "Fecha de entrega ajustada" : "Fecha de entrega restaurada desde NetSuite", "ot-config");
}

function materialBaseForOt(ot) {
  return materialsForOt(ot)[0]?.component || "";
}

function materialOtKey(value) {
  return String(value || "").trim().toUpperCase();
}

function formatMaterialQuantity(value) {
  const numeric = Number(value || 0);
  return Number.isInteger(numeric) ? String(numeric) : numeric.toLocaleString("es-MX", { maximumFractionDigits: 3 });
}

function formatOtDateValue(value) {
  const parsed = parseDate(value);
  if (!parsed) return "SIN FECHA";
  return new Date(parsed.year, parsed.month - 1, parsed.day).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function toolLabel(op) {
  const herr = cleanToolValue(op.herramental);
  const kit = cleanToolValue(op.kitHerramental);
  if (!herr && !kit) return "SIN HERRAMENTAL";
  return `${herr || "SIN_HERR"} / ${kit || (op.kitPending ? "KIT_PENDIENTE" : "SIN_KIT")}`;
}

function jobToolMiniHtml(job) {
  const configuration = state.otConfigurations?.[String(job?.ot || "").trim()] || {};
  const bendingOps = (job?.ops || []).filter(isBendingAppOperation);
  if (!bendingOps.length) return "";
  const tool = cleanToolValue(configuration.herramental) || bendingOps.map((op) => cleanToolValue(op.herramental)).find(Boolean)
    || bendingOps.map((op) => cleanToolValue(toolCatalogForAppOperation(op)?.herramental)).find(Boolean) || "";
  if (!tool) return "";
  return `<span class="queue-tool-mini" title="Herramental seleccionado: ${escapeHtml(tool)}">Herr. <strong>${escapeHtml(tool)}</strong></span>`;
}

function cleanToolValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const upper = text.toUpperCase();
  if (["NO", "N/A", "NA", "-", "VACIO", "VACÍO"].includes(upper)) return "";
  return text;
}

function normalizeToolFields(maquina, herramental, kitHerramental) {
  const machine = String(maquina || "").trim();
  const herr = cleanToolValue(herramental);
  const kit = cleanToolValue(kitHerramental);
  const isNumber = (value) => /^\d+(?:\.\d+)?$/.test(String(value || "").trim());
  if (!machine && isNumber(herr) && kit) {
    return { maquina: herr, herramental: kit, kitHerramental: "" };
  }
  return { maquina: machine, herramental: herr, kitHerramental: kit };
}

function compareJobs(a, b) {
  const dueA = normalizeOtDate(a.dueDate || a.firstOp?.fechaReq) || "9999-12-31";
  const dueB = normalizeOtDate(b.dueDate || b.firstOp?.fechaReq) || "9999-12-31";
  return dueA.localeCompare(dueB) || String(a.ot).localeCompare(String(b.ot), "es", { numeric: true });
}

function jobMatchesSearch(job, query) {
  if (!query) return true;
  const haystack = [
    job.ot,
    job.parte,
    job.descripcion,
    job.materialBase,
    job.cts.join(" "),
    job.operators.join(" "),
  ].join(" ").toLowerCase();
  return haystack.includes(query);
}

function jobPriority(ops) {
  if (!ops.length) return 999;
  return Math.min(...ops.map((op) => normalizePriority(op.prioridad)), 999);
}

function jobPriorityForOperation(op) {
  return jobPriority(state.operations.filter((item) => item.ot === op.ot));
}

function jobPriorityForOt(ot) {
  const operations = state.operations.filter((item) => item.ot === ot);
  return operations.length ? jobPriority(operations) : 999;
}

function isJobSelected(ot) {
  return state.selectedOts.includes(ot);
}

function getScheduledOts() {
  const generated = Array.isArray(state.lastSchedule?.scheduledOts) ? state.lastSchedule.scheduledOts : [];
  return uniq(generated).filter((ot) => state.selectedOts.includes(ot));
}

function isJobScheduled(ot) {
  if (window.PlannerCore?.isOtScheduled) return window.PlannerCore.isOtScheduled(state, ot);
  if (!state.selectedOts.includes(ot)) return false;
  if (Array.isArray(state.lastSchedule?.scheduledOts) && state.lastSchedule.scheduledOts.includes(ot)) return true;
  return false;
}

function isJobLocked(ot) {
  return state.lockedOts.includes(ot);
}

function normalizeStatus(value) {
  return String(value || "PLAN").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeOperatorPerformance(source, operators) {
  const normalized = {};
  for (const [key, value] of Object.entries(source && typeof source === "object" ? source : {})) {
    const direct = Number(value);
    if (Number.isFinite(direct) && direct > 0) normalized[key] = Math.max(1, Math.min(300, direct));
  }
  for (const operator of operators || []) {
    if (!Number.isFinite(Number(normalized[operator]))) normalized[operator] = 100;
  }
  return normalized;
}

function normalizeOperatorProfiles(source, operators) {
  const profiles = {};
  const input = source && typeof source === "object" ? source : {};
  for (const resource of operators || []) {
    const current = input[resource] && typeof input[resource] === "object" ? input[resource] : {};
    profiles[resource] = {
      name: String(current.name || current.nombre || resource).trim() || resource,
      category: normalizeResourceCategory(current.category || current.categoria || defaultResourceCategory(resource)),
    };
  }
  return profiles;
}

function defaultResourceCategory(resource) {
  const normalized = normalizeStatus(resource);
  if (/AJUST/.test(normalized)) return "FUERA_DE_PLAN";
  return /PINTURA|ACABADO/.test(normalized) ? "ACABADOS" : "TD";
}

function normalizeResourceCategory(value) {
  const normalized = normalizeStatus(value).replace(/\s+/g, "_");
  return RESOURCE_CATEGORIES.includes(normalized) ? normalized : "TD";
}

function resourceCategoryFor(resource) {
  return normalizeResourceCategory(state.operatorProfiles?.[resource]?.category || defaultResourceCategory(resource));
}

function resourceIsInPlan(resource) {
  return resourceCategoryFor(resource) !== "FUERA_DE_PLAN";
}

function isClosedJobStatus(status) {
  const normalized = normalizeStatus(status);
  return ["CERRAD", "CLOSED", "COMPLETE", "COMPLETADO"].some((blocked) => normalized.includes(blocked));
}

function isProgrammedJobStatus(status) {
  const normalized = normalizeStatus(status);
  return normalized.includes("PROGRAMAD") || normalized.includes("SCHEDULED");
}

function isPlannedJobStatus(status) {
  const normalized = normalizeStatus(status);
  return normalized.includes("PLANIFICAD") || normalized.includes("PLANNED");
}

function isMovablePlanningStatus(status) {
  return PlannerCore.isMovablePlanningStatus(status);
}

function jobStatusForOt(ot) {
  const workOrderStatus = String(workOrderForOt(ot)?.status || "").trim();
  const statuses = [workOrderStatus, ...state.operations
    .filter((op) => op.ot === ot && op.tipoInsercion !== "CAMBIO_HERRAMENTAL")
    .map((op) => String(op.estatus || "PLAN").trim())
    .filter(Boolean)].filter(Boolean);
  return statuses.find(isClosedJobStatus) || statuses.find(isProgrammedJobStatus) || statuses.find(isPlannedJobStatus) || statuses[0] || "PLAN";
}

function matchesStatusFilter(job, filter) {
  if (filter === "TODOS") return true;
  return job.movable;
}

function selectedJobOt() {
  return findOperation(state.selectedOperationId)?.ot
    || getPriorityJobs().find((job) => job.firstOp?.id === state.selectedOperationId)?.ot
    || "";
}

function netSuiteChangeAlertForOt(ot) {
  const key = materialOtKey(ot);
  return (state.netSuiteChangeAlerts || []).find((alert) => materialOtKey(alert.ot) === key) || null;
}

function netSuiteChangeBadgeHtml(ot) {
  const alert = netSuiteChangeAlertForOt(ot);
  if (!alert) return "";
  const high = normalizeStatus(alert.severity) === "ALTA";
  return `<span class="netsuite-change-badge${high ? " high" : ""}" title="${escapeHtml(alert.summary)}">Cambio NS</span>`;
}

function workOrderSyncWarningForOt(ot) {
  const key = materialOtKey(ot);
  return (state.workOrderSyncWarnings || []).find((warning) => materialOtKey(warning.ot) === key) || null;
}

function hasClosedWorkOrderSyncWarning(ot) {
  return workOrderSyncWarningForOt(ot)?.type === "CLOSED_KEPT";
}

function workOrderSyncWarningHtml(ot) {
  const warning = workOrderSyncWarningForOt(ot);
  if (!warning) return "";
  const message = warning.type === "QUANTITY_REJECTED"
    ? "Cantidad diferente en NetSuite"
    : warning.type === "CLOSED_KEPT" ? "Cerrada o no encontrada en NetSuite" : "";
  return message ? `<span class="work-order-sync-warning">${message}</span>` : "";
}

function suggestedPlanningTypeForJob(job) {
  const text = [job?.parte, job?.descripcion, job?.materialBase, job?.status]
    .map((value) => normalizeStatus(value))
    .join(" ");
  if (text.includes("PROTOTIPO")) return "PROTOTIPO";
  if (text.includes("URGENTE") || text.includes("EXPEDIT") || text.includes("HOT")) return "EXPEDITADO";
  return "";
}

function jobDisplayType(job) {
  const config = articleConfigurationValue(job.parte);
  const configured = String(config.planningType || config.tipoTrabajo || "").trim().toUpperCase();
  const text = [configured, job.parte, job.descripcion, job.materialBase, job.status]
    .map((value) => normalizeStatus(value))
    .join(" ");
  if (text.includes("PROTOTIPO")) return "PROTOTIPO";
  if (text.includes("URGENTE") || text.includes("EXPEDIT") || text.includes("HOT")) return "EXPEDITADO";
  return configured === "NORMAL" ? "" : configured;
}

function jobTypeClass(type) {
  const key = normalizeStatus(type);
  if (key === "PROTOTIPO") return "job-type-tag--prototype";
  if (key === "URGENTE" || key === "EXPEDITADO" || key === "EXPEDITACION") return "job-type-tag--urgent";
  return "job-type-tag--line";
}

function jobTypeTagHtml(job) {
  const type = jobDisplayType(job);
  if (!type) return "";
  return `<span class="job-type-tag ${jobTypeClass(type)}">${escapeHtml(type)}</span>`;
}

function jobScheduledFinish(job) {
  const finishes = (job?.ops || [])
    .map(opEnd)
    .filter(Boolean)
    .sort((a, b) => b - a);
  return finishes[0] || null;
}

function jobRiskLevel(job) {
  const nsAlert = netSuiteChangeAlertForOt(job.ot);
  const finish = jobScheduledFinish(job);
  const due = parseDate(job.dueDate);
  if (due && finish) {
    const dueEnd = new Date(due.year, due.month - 1, due.day, 23, 59, 59);
    if (finish > dueEnd) return { level: "ROJO", label: "Termina despues de la necesidad" };
  }
  if (isJobSelected(job.ot) && !isJobScheduled(job.ot)) {
    return { level: "AMARILLO", label: "En planeado, pendiente de generar programa" };
  }
  if (nsAlert) {
    return { level: normalizeStatus(nsAlert.severity) === "ALTA" ? "ROJO" : "AMARILLO", label: nsAlert.summary || "Cambio detectado en NetSuite" };
  }
  if (finish && due) return { level: "VERDE", label: "Dentro de fecha" };
  return { level: "NEUTRO", label: "Sin riesgo calculado" };
}

function riskClass(level) {
  const key = normalizeStatus(level);
  if (key === "ROJO" || key === "CRITICAL") return "risk-dot--critical";
  if (key === "AMARILLO" || key === "WARNING") return "risk-dot--warning";
  if (key === "VERDE" || key === "OK") return "risk-dot--ok";
  return "risk-dot--neutral";
}

function jobRiskCardClass(job) {
  const level = jobRiskLevel(job).level;
  return level === "ROJO" ? "job-risk--critical" : level === "AMARILLO" ? "job-risk--warning" : "";
}

function jobRiskIndicatorHtml(job) {
  const risk = jobRiskLevel(job);
  if (risk.level === "NEUTRO") return "";
  return `<span class="risk-dot ${riskClass(risk.level)}" title="${escapeHtml(risk.label)}"></span>`;
}

function resequenceNums() {
  state.operations.forEach((op, index) => {
    op.num = index + 1;
  });
}

function normalizePriority(value) {
  const text = String(value ?? "").trim().toUpperCase();
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) return Math.max(1, Math.round(numeric));
  if (Object.prototype.hasOwnProperty.call(LEGACY_PRIORITY, text)) return LEGACY_PRIORITY[text];
  if (text.includes("ALT")) return 1;
  if (text.includes("BAJ")) return 100;
  if (text.includes("NOR") || text.includes("MED")) return 50;
  return 999;
}

function priorityClass(priority) {
  const numeric = normalizePriority(priority);
  if (numeric <= 10) return "urgent";
  if (numeric <= 50) return "standard";
  return "low";
}

function priorityLabel(priority) {
  return `P${normalizePriority(priority)}`;
}

function isAllowedOperatorForOperation(op, operator) {
  return isAllowedOperatorForCapability(capabilityFromOperation(op), operator);
}

function isAllowedOperatorForCapability(capability, operator) {
  return isOperatorSkilledForCapability(capability, operator);
}

function isOperatorSkilledForCapability(capability, operator) {
  return matrixAllowedForCapability(capability).includes(operator);
}

function getAllowedOperatorsForOperation(op) {
  const capability = capabilityFromOperation(op);
  return matrixAllowedForCapability(capability);
}

function baseAllowedOperatorsForCapability(capability) {
  return [...matrixAllowedForCapability(capability)];
}

function matrixAllowedForCapability(capability) {
  if (state.hiddenCapabilities.includes(capability.key)) return [];
  if (hasMatrixKey(capability.key)) return state.matrix[capability.key] || [];
  if (hasMatrixKey(capability.ct)) return state.matrix[capability.ct] || [];
  return [];
}

function hasMatrixKey(key) {
  return Object.prototype.hasOwnProperty.call(state.matrix, key);
}

function normalizeCapacityMode(value) {
  return String(value || "").trim().toUpperCase() === "NO_FINITA" ? "NO_FINITA" : "FINITA";
}

function capacityModeForCapability(capability) {
  if (state.hiddenCapabilities.includes(capability.key)) return "NO_FINITA";
  if (CAPACITY_MODES.includes(state.capacityModes[capability.key])) return state.capacityModes[capability.key];
  if (CAPACITY_MODES.includes(state.capacityModes[capability.ct])) return state.capacityModes[capability.ct];
  return "FINITA";
}

function isFiniteCapacityOperation(op) {
  if (window.PlannerCore?.isFiniteOperation) return window.PlannerCore.isFiniteOperation(state, op);
  if (String(op.tipoInsercion || "").toUpperCase() === "CAMBIO_HERRAMENTAL") return true;
  if (isSubcontractAppOperation(op)) return false;
  const capability = capabilityFromOperation(op);
  return capacityModeForCapability(capability) === "FINITA";
}

function isLoadBearingOperator(operator) {
  const key = normalizeStatus(operator);
  return Boolean(key) && key !== "SIN_OPERADOR" && key !== "SUBCONTRATO";
}

function getCapabilityRows() {
  const counts = new Map();
  const operationCapabilities = new Map();
  for (const op of state.operations) {
    const capability = capabilityFromOperation(op);
    operationCapabilities.set(capability.key, capability);
    counts.set(capability.key, (counts.get(capability.key) || 0) + 1);
  }
  const catalog = new Map((state.operationCatalog || []).map((item) => [item.key, item]));
  const custom = new Map((state.customCapabilities || []).map((item) => [item.key, item]));
  return (state.configuredCapabilities || [])
    .map((key) => catalog.get(key) || custom.get(key) || operationCapabilities.get(key) || capabilityFromKey(key))
    .filter(Boolean)
    .map((capability) => ({ ...capability, count: counts.get(capability.key) || 0 }))
    .filter((capability) => !state.hiddenCapabilities.includes(capability.key))
    .sort((a, b) => a.ct.localeCompare(b.ct, "es", { numeric: true }) || a.label.localeCompare(b.label, "es"));
}

function isCapabilityConfigured(capability) {
  return (state.configuredCapabilities || []).includes(capability.key) && !state.hiddenCapabilities.includes(capability.key);
}

function capabilityFromOperation(op) {
  const label = capabilityLabelForOperation(op);
  const ct = String(op.ct || "SIN_CT").trim();
  return { key: capabilityKey(ct, label), ct, label };
}

function capabilityLabelForOperation(op) {
  return String(op.descripcion || op.tipoInsercion || "OPERACION").trim() || "OPERACION";
}

function capabilityKey(ct, label) {
  return `${String(ct || "SIN_CT").trim()}::${normalizeHeader(label || "OPERACION")}`;
}

function parseManualCapability(value) {
  const parts = value.split("|").map((part) => part.trim()).filter(Boolean);
  const ct = parts.length > 1 ? parts[0] : ((value.match(/\b\d{3,}\b/) || ["MANUAL"])[0]);
  const label = parts.length > 1 ? parts.slice(1).join(" ") : value.replace(ct, "").trim() || value;
  return { key: capabilityKey(ct, label), ct, label };
}

function capabilityFromKey(key) {
  const text = String(key || "");
  const separator = text.indexOf("::");
  if (separator < 0) return null;
  return { key: text, ct: text.slice(0, separator), label: text.slice(separator + 2).replace(/_/g, " ") };
}

function findOperation(id) {
  return state.operations.find((op) => op.id === id);
}

function focusGanttBar(id) {
  const bar = document.querySelector(`.gantt-bar[data-id="${CSS.escape(id)}"]`);
  if (bar) bar.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
}

function saveAndRenderQueueChange(message, saveScope = "plan") {
  renderPriorityQueue();
  if (message) showToast(message);
  saveState(saveScope);
}

function saveAndRender(message, saveScope = "plan") {
  const scope = String(saveScope || "plan").trim().toLowerCase();
  const parts = {};
  if (scope === "catalogs") {
    parts.catalogs = true;
    parts.top = true;
  } else if (scope === "matrix") {
    parts.matrix = true;
    parts.loads = true;
    parts.top = true;
  } else if (scope === "gantt") {
    parts.gantt = true;
    parts.top = true;
  } else if (scope === "ot-config") {
    parts.top = true;
    parts.alerts = true;
    parts.gantt = true;
  }
  invalidateGanttCache();
  render({ parts, saveScope });
  if (message) showToast(message);
}

function saveState(saveScope = "plan") {
  scheduleLocalStorageFlush();
  queueAppSheetSave(saveScope);
}

let _flushTimer = null;
function scheduleLocalStorageFlush() {
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, 0);
}

function queueAppSheetSave(saveScope = "plan") {
  const scope = String(saveScope || "plan").trim().toLowerCase();
  if (scope === "local" || scope === "ui") return;
  if (!appSheetAvailable) return;
  appSheetMarkDirtyScope(scope);
  if (appSheetSaveInFlight) {
    appSheetSavePending = true;
    return;
  }
  window.clearTimeout(appSheetSaveTimer);
  appSheetSaveTimer = window.setTimeout(() => saveAppSheet(false), 900);
}

async function saveAppSheet(showMessage) {
  if (appSheetSaveInFlight) {
    appSheetSavePending = true;
    if (showMessage) showToast("Guardado en curso");
    return false;
  }
  appSheetSaveInFlight = true;
  const scopes = appSheetConsumeDirtyScopes();
  try {
    if (isAppsScriptRuntime()) {
      const method = appSheetSaveMethodForScopes(scopes);
      const saved = await callAppsScript(method, createAppSheetPayload());
      state.revision = Number(saved.revision || state.revision);
      state.savedAt = saved.savedAt || state.savedAt;
      if (saved.syncedAt) state.syncedAt = saved.syncedAt;
      if (saved.plant) state.plant = saved.plant;
      if (saved.invoicePriceWindow) state.invoicePriceWindow = saved.invoicePriceWindow;
    } else {
      const response = await fetch(APP_SHEET_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createAppSheetPayload()),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    }
    appSheetAvailable = true;
    delete state._pendingAddOt;
    delete state._pendingAddOtSnapshot;
    if (showMessage) showToast("Hoja app guardada");
    return true;
  } catch (error) {
    scopes.forEach((scope) => appSheetDirtyScopes.add(scope));
    appSheetAvailable = true;
    if (state._pendingAddOt) {
      const ot = state._pendingAddOt;
      const snapshot = state._pendingAddOtSnapshot;
      delete state._pendingAddOt;
      delete state._pendingAddOtSnapshot;
      state.selectedOts = snapshot || state.selectedOts.filter((item) => item !== ot);
      state.operations.filter((op) => op.ot === ot).forEach((op) => { op.locked = false; op.prioridad = 999; });
      saveState("ui");
      requestAnimationFrame(() => { renderTop(); renderPlanAlerts(); renderPriorityList(); renderPriorityQueue(); });
      showToast(`Error al guardar, OT ${ot} devuelta al backlog`);
    } else {
      if (showMessage) showToast(`No se pudo guardar hoja app: ${error.message}`);
    }
    return false;
  } finally {
    appSheetSaveInFlight = false;
    if (appSheetSavePending) {
      appSheetSavePending = false;
      queueAppSheetSave();
    }
  }
}

function appSheetMarkDirtyScope(saveScope) {
  const scope = String(saveScope || "plan").trim().toLowerCase();
  if (scope === "local" || scope === "ui") return;
  appSheetDirtyScopes.add(scope || "plan");
}

function appSheetConsumeDirtyScopes() {
  const scopes = appSheetDirtyScopes.size ? [...appSheetDirtyScopes] : ["plan"];
  appSheetDirtyScopes.clear();
  return scopes;
}

function appSheetSaveMethodForScopes(scopes) {
  const values = new Set(scopes || []);
  const onlyCatalogs = values.size > 0 && [...values].every((scope) => scope === "catalogs");
  const onlyMatrix = values.size > 0 && [...values].every((scope) => scope === "matrix");
  let method = "saveAppState";
  if (onlyCatalogs) method = "saveCatalogState";
  if (onlyMatrix) method = "saveSkillState";
  return method;
}

function createAppSheetPayload() {
  return {
    ...deepClone(state),
    source: "plan-app-sheet",
    savedAt: new Date().toISOString(),
  };
}

function isAppsScriptRuntime() {
  return typeof google !== "undefined" && Boolean(google.script?.run);
}

function callAppsScript(method, ...args) {
  return new Promise((resolve, reject) => {
    const runner = google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler((error) => reject(new Error(error?.message || String(error))));
    runner[method](...args);
  });
}

function showToast(message, duration = 2200) {
  if (!message) return;
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), duration);
}

function appendLog(log, message) {
  return [log, message].filter(Boolean).join(" | ");
}

function normalizeHeader(header) {
  return String(header || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function uniq(items) {
  return [...new Set(items.filter(Boolean))];
}

function uid(prefix) {
  if (window.crypto?.randomUUID) return `${prefix}-${window.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function range(count) {
  return Array.from({ length: count }, (_, index) => index);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
