/**
 * Fixture determinista para la sonda web en localhost.
 *
 * La app se siembra por localStorage["plan-produccion-app-v1"], que es lo que lee
 * planningHydrateLocalCache() (inyectada por scripts/build-appscript.mjs en
 * initializePlanningApp). Exige: operations con contenido, revision > 0, plant.name
 * distinto de "demo" y schemaVersion igual a APP_SCHEMA_VERSION.
 *
 * Los nombres de campo NO son inventados: salen del sampleState de src/web/planning/app.js
 * (matrix por CT, operations con id/num/ot/parte/ct/operador/tiempoProd/estatus, etc.).
 */

const DEFAULT_OT_COUNT = 40;
const OPERATORS = ["DOBLADOR 1", "DOBLADOR 2", "SOLDADOR 1", "PINTURA 1", "AJUSTADOR"];
// La matriz se indexa por "CT::DESCRIPCION" normalizada, no por CT pelado: asi la
// construye capabilityFromOperation (app.js / performance-client). Con la matriz mal
// armamentada la app abre el dialogo "Completar operadores" en cada alta, que es
// correcto de su parte pero deja la sonda atascada en un dialogo.
const TOOL_CHANGE = { key: "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL", ct: "TOOL_CHANGE", label: "CAMBIO DE HERRAMENTAL" };
// NO se usa el CT de doblado a proposito. Con operaciones de doblado, agregar una OT abre
// el dialogo de preparacion con un <select name="ot_machine" required> cuyas opciones salen
// de state.machines (compatibleMachineOptionsForOps, app.js:11785), y el catalogo de
// maquinas solo llega del servidor: planningHydrateLocalCache (inyectado por el build) no lo
// restaura desde el cache local, asi que en una arranque en frio el select queda sin
// opciones y el alta es imposible. Ese camino se ejercita mejor contra el backend real.
const CAPABILITIES = [
  { ct: "5527", descripcion: "Soldadura", labels: ["Soldadura soporte", "Soldadura costura"], operadores: ["SOLDADOR 1"], maquina: "SOL-02" },
  { ct: "5495", descripcion: "Pintura", labels: ["Pintura base", "Pintura acabado"], operadores: ["PINTURA 1"], maquina: "PIN-01" },
  { ct: "122", descripcion: "Ajuste", labels: ["Ajuste dimension"], operadores: ["AJUSTADOR"], maquina: "AJU-01" },
];

/** Igual que normalizeCapabilityKey del cliente: sin acentos, mayusculas y _ por espacios. */
export function capabilityKey(ct, label) {
  return `${ct}::${String(label || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")}`;
}

/** PRNG determinista: dos corridas con la misma semilla dan el mismo fixture. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pad(value, size = 2) {
  return String(value).padStart(size, "0");
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function mondayOf(date) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = copy.getDay();
  const delta = weekday === 0 ? -6 : 1 - weekday;
  copy.setDate(copy.getDate() + delta);
  return copy;
}

function addDays(date, days) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function readAppConstants(appSource) {
  const schema = appSource.match(/const APP_SCHEMA_VERSION = (\d+);/);
  const storage = appSource.match(/const STORAGE_KEY = "([^"]+)";/);
  return {
    schemaVersion: schema ? Number(schema[1]) : 29,
    storageKey: storage ? storage[1] : "plan-produccion-app-v1",
  };
}

/**
 * @param {object} options
 * @param {number} [options.otCount]         OTs a generar.
 * @param {number} [options.selectedRatio]   fraccion de OTs que arranca en el plan.
 * @param {number} [options.seed]            semilla del PRNG.
 * @param {Date}   [options.today]           referencia para las fechas.
 * @param {number} [options.schemaVersion]   APP_SCHEMA_VERSION leido del source.
 */
export function buildFixture(options = {}) {
  const {
    otCount = DEFAULT_OT_COUNT,
    selectedRatio = 0.35,
    seed = 20260925,
    today = new Date(),
    schemaVersion = 29,
  } = options;

  const random = mulberry32(seed);
  const planStart = mondayOf(today);
  const matrix = {};
  const capacityModes = {};
  const cts = [];
  for (const capability of CAPABILITIES) {
    for (const label of capability.labels) {
      matrix[capabilityKey(capability.ct, label)] = [...capability.operadores];
    }
    capacityModes[capability.ct] = "FINITA";
    cts.push(capability.ct);
  }
  // Sin esta entrada, cada cambio de herramental entre operaciones de la misma OT abre
  // el dialogo de "cambio de herramental" sin operador.
  matrix[TOOL_CHANGE.key] = ["AJUSTADOR"];
  capacityModes[TOOL_CHANGE.ct] = "FINITA";
  cts.push(TOOL_CHANGE.ct);

  const workOrders = [];
  const operations = [];
  const materials = [];

  for (let index = 0; index < otCount; index += 1) {
    const ot = String(3000 + index * 7 + (index % 3));
    const opCount = 3 + Math.floor(random() * 4);
    const quantity = 20 + Math.floor(random() * 180);
    const parte = `EG40-${pad(index % 40 + 1, 3)}`;
    workOrders.push({
      ot,
      item: parte,
      description: `Muffler EG40 variante ${index + 1}`,
      quantity,
      builtQuantity: Math.floor(quantity * random() * 0.4),
      pendingQuantity: 0,
      status: "En curso",
      dueDate: formatDate(addDays(planStart, 3 + Math.floor(random() * 12))),
      lastSalePrice: 0,
      averageSalePrice: 0,
      photoUrl: "",
    });
    for (let opIndex = 0; opIndex < opCount; opIndex += 1) {
      const capability = CAPABILITIES[opIndex % CAPABILITIES.length];
      const label = capability.labels[Math.floor(random() * capability.labels.length)];
      const pieces = Math.max(1, quantity - opIndex * 3);
      const cycle = 2 + Math.floor(random() * 6);
      const setup = 15 + Math.floor(random() * 45);
      const production = Math.round(pieces * cycle);
      operations.push({
        id: `${ot}-${opIndex + 1}`,
        num: index * 10 + opIndex + 1,
        ot,
        parte,
        descripcion: label,
        contenido: "PZA",
        prioridad: index + 1,
        fechaReq: formatDate(addDays(planStart, 2 + Math.floor(random() * 10))),
        cantTotal: pieces,
        secuencia: opIndex + 1,
        ct: capability.ct,
        operador: capability.operadores[0],
        maquina: capability.maquina,
        herramental: `H-${10 + (opIndex % 2)}`,
        kitHerramental: "",
        cantPendiente: pieces,
        tiempoCiclo: cycle,
        tiempoSetup: setup,
        tiempoProd: production,
        fechaInicio: "",
        horaInicio: "",
        fechaFin: "",
        horaFin: "",
        tipoInsercion: "OPERACION",
        estatus: "LIBERADO",
        log: "",
      });
    }
    for (let materialIndex = 0; materialIndex < 2; materialIndex += 1) {
      materials.push({
        ot,
        item: parte,
        component: `TUBO-${pad(materialIndex + 1)}`,
        required: 10 + Math.floor(random() * 50),
        issued: 0,
        pending: 0,
      });
    }
  }

  const selectedCount = Math.max(1, Math.round(otCount * selectedRatio));
  const selectedOts = workOrders.slice(0, selectedCount).map((workOrder) => workOrder.ot);
  const lockedOts = selectedOts.slice(0, Math.max(1, Math.floor(selectedCount / 4)));
  const weekStartIso = formatDate(planStart);

  // Clasificacion, precio y herramental ya dados de alta. Sin esto commercialPlanningRequirement
  // (app.js:3049) pide tipo comercial, tipo de trabajo y precio, y el alta de cada OT abre el
  // dialogo de preparacion: la sonda ejercitaria el camino de primera vez, no el normal.
  const articleConfigurations = {};
  const toolCatalog = [];
  const otConfigurations = {};
  for (const workOrder of workOrders) {
    articleConfigurations[workOrder.item] = {
      part: workOrder.item,
      jobType: "OEM",
      planningType: "NORMAL",
      manualUnitPrice: 1250.5,
      updatedAt: new Date().toISOString(),
    };
    const tools = Array.from(new Set(operations.filter((operation) => operation.ot === workOrder.ot).map((operation) => operation.herramental))).filter(Boolean);
    for (const tool of tools) {
      toolCatalog.push({ part: workOrder.item, parte: workOrder.item, herramental: tool, machine: "DOB-01", active: true });
    }
    otConfigurations[workOrder.ot] = { ot: workOrder.ot, machine: "DOB-01", updatedAt: new Date().toISOString() };
  }

  return {
    schemaVersion,
    // syncedAt reciente: el gate de frescura (ensureNetSuiteWorkOrdersFresh) no debe
    // intentar sincronizar, porque en localhost no hay backend de Apps Script.
    revision: 7,
    syncedAt: new Date().toISOString(),
    ganttView: "job",
    selectedOperationId: "",
    selectedDetailOt: "",
    queueMoveOt: "",
    capacityMinutes: 480,
    planStart: weekStartIso,
    horizonDays: 7,
    loadWeekStart: weekStartIso,
    reportWeekStart: weekStartIso,
    draftVersionId: "",
    activePublishedVersionId: "",
    publishedVersions: [],
    reportFilters: {
      operator: { date: weekStartIso, showAll: false, status: "PENDIENTES" },
      adjuster: { date: weekStartIso, showAll: false, status: "PENDIENTES" },
      subcontract: { date: weekStartIso, showAll: false },
    },
    dailyBreaks: {
      MEAL: { enabled: false, start: "13:00", end: "13:30" },
      PRODUCTION: { enabled: false, start: "10:00", end: "10:10" },
    },
    lockedOts,
    expandedOts: selectedOts.slice(),
    plant: { name: "Planta MM del Llano", locationId: 1 },
    settings: {
      defaultSubcontractDays: 3,
      toolChangeCt: "122",
      toolChangeMinutes: 120,
      toolChangeOperator: "AJUSTADOR",
      weeklyReleaseTarget: 1110000,
      flowBalancedEnabled: true,
      flowWipTarget: 10,
      optimizationPasses: 4,
    },
    operators: [...OPERATORS],
    operatorProfiles: Object.fromEntries(OPERATORS.map((name) => [name, { name, category: name.startsWith("DOBLADOR") ? "TD" : "ACABADOS" }])),
    cts,
    customCapabilities: [{ ...TOOL_CHANGE, source: "SISTEMA", active: true }],
    hiddenCapabilities: [],
    excludedCapabilities: [],
    operationRules: {
      5527: { overlap: 0.6, keywords: "SOLDADURA" },
      5495: { overlap: 0.6, keywords: "PINTURA" },
    },
    machines: [{ machine: "DOB-01", name: "DOB-01" }, { machine: "SOL-02", name: "SOL-02" }, { machine: "PIN-01", name: "PIN-01" }, { machine: "AJU-01", name: "AJU-01" }],
    toolCatalog,
    machineToolHistory: [],
    workOrders,
    closedWorkOrderSummaries: {},
    otConfigurations,
    articleConfigurations,
    toolCatalog,
    materials,
    calendarExceptions: [],
    operationPlanStatuses: {},
    publishedPlanStatuses: {},
    netSuiteChangeAlerts: [],
    netSuiteSyncAlert: null,
    operationCatalogWarning: "",
    syncWarnings: [],
    capacityModes,
    matrix,
    operations,
    selectedOts,
    lastSchedule: null,
    workSchedule: {
      MON: { enabled: true, start: "07:00", end: "17:00" },
      TUE: { enabled: true, start: "07:00", end: "17:00" },
      WED: { enabled: true, start: "07:00", end: "17:00" },
      THU: { enabled: true, start: "07:00", end: "17:00" },
      FRI: { enabled: true, start: "07:00", end: "17:00" },
      SAT: { enabled: false, start: "07:00", end: "13:00" },
      SUN: { enabled: false, start: "07:00", end: "13:00" },
    },
  };
}

export { readAppConstants, CAPABILITIES, OPERATORS };
