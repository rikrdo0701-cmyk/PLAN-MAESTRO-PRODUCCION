import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(projectRoot, "dist");
const siteDir = path.join(projectRoot, "site");

// MEDIDO 2026-10-02: LA URL DEL DEPLOYMENT SE LEE DE .clasp.json, NO SE ESCRIBE AQUI.
//
// La URL estaba escrita en tres lugares distintos —este archivo, el workflow de Apps Script y el
// editor de Apps Script— y nadie comparaba las copias. Eso es lo que hace que un `clasp deploy`
// sin `--deploymentId` pase inadvertido: sube el codigo, dice "Deployed" y abre un deployment
// NUEVO, mientras la pagina sigue hablando con el viejo, que es el que esta horneado aqui. El
// sintoma es "no se arregla nada" y no dice de donde viene.
//
// Que el build falle si falta el campo es a proposito: un bundle con la URL vacia se sube igual y
// el error aparece en la pagina del usuario, no aqui.
const claspConfig = JSON.parse(await readFile(path.join(projectRoot, ".clasp.json"), "utf8"));
if (!claspConfig.deploymentId) {
  throw new Error(".clasp.json no trae deploymentId: no se sabe que URL hornear en el bundle.");
}
const appsScriptWebAppUrl = `https://script.google.com/macros/s/${claspConfig.deploymentId}/exec`;

async function read(relativePath) {
  const content = await readFile(path.join(projectRoot, relativePath), "utf8");
  return content.replace(/\r\n/g, "\n");
}

// LA CREDENCIAL DEL PORTAPAPELES, Y POR QUE EXISTE.
//
// MEDIDO 2026-10-02: el problema de siempre no es que falte la clave, es pegarla. La clave
// publishable vive en el panel de Supabase, se copia de ahi y se teclea en la consola; y lo que
// pasa al teclearla es lo que se vio: se pega la linea DE EJEMPLO del aviso, el build pasa las
// 1365 pruebas y "Validacion correcta", y sale un bundle con `DEFAULT_ANON_KEY =
// "<sb_publishable_...>"`, o sea el lector encendido con una clave que no existe y 401 en todo.
// Pegar la clave REAL es lo unico que hay que hacer, y por eso se acepta del portapapeles.
//
// ORDEN, Y POR QUE ESTE. 1) la variable de entorno, porque es la explicita y es la que usan CI y
// los despliegues. 2) el portapapeles, que es el atajo local. Nunca al reves: si el portapapeles
// llegara a ganarle a la variable, un `npm run check` de otra consola meteria una clave vieja sin
// que nadie lo pidiera.
//
// LO QUE NO HACE. No adivina el valor: si no hay variable y el portapapeles no trae una clave que
// se parezca a una, se deja vacio como antes, y avisa el gate de check-project.mjs. No escribe la
// clave en ningun archivo: solo la lee para los reemplazos de los marcadores, que es lo unico que
// el bundle necesita. Y no imprime la clave: dice DE DONDE salio, nunca el valor.
const CREDENCIAL_EJEMPLO = /(\.\.\.|<\s*sb_|sb_publishable_\.\.\.|<tu_|TU_SERVICE_ROLE|service_role)/i;
const ESQUEMA_SUPABASE = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i;
// MEDIDO 2026-10-02: con el portapapeles se corrigio un agujero que el entorno no tenia. Ahi la
// credencial venia de una variable con nombre, o sea que la llave era el dato. Del portapapeles
// puede venir CUALQUIER linea, y medido: una pagina de API Keys copiada entera trae lineas como
// "supabase" o "Project URL", y la primera que no era un ejemplo se colaba como clave. Medido de
// verdad: la clave del bundle quedo siendo la palabra "supabase". Con el filtro de FORMA de la URL
// eso no pasaba; con la clave, que no tenia filtro, si. Un filtro de forma, no de validez: decide
// si PARECE una clave de la API de Supabase, no si sirve.
const FORMA_CLAVE = /^(sb_publishable_[A-Za-z0-9_-]{10,}|sb_anon_[A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})$/;

function leerPortapapeles() {
  // MEDIDO 2026-10-02: el portapapeles no se lee con un modulo de Node (no hay API nativa) sino
  // con Get-Clipboard de PowerShell, que es lo que hay en Windows. Se usa `-Raw` para no perder el
  // texto si el portapapeles tiene saltos de linea.
  //
  // SE DEVUELVEN TODAS LAS LINEAS, no solo la primera, y eso es lo que hace util el atajo: la URL y
  // la clave son DOS valores y con una sola copia tienen que salir los dos. Copiar las dos lineas
  // (o la pagina entera del panel de API Keys) y copiar-pegar UNA vez es el caso real; quedarse con
  // la primera linea obligaba a copiar, construir, copiar y volver a construir.
  try {
    const salida = execFileSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Clipboard -Raw"],
      { encoding: "utf8", timeout: 5000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    return String(salida || "").split(/\r?\n/).map((linea) => linea.trim()).filter(Boolean);
  } catch (error) {
    // Sin portapapeles no hay nada que hacer: el build sigue como antes, con las variables de
    // entorno. Un error aqui jamas puede tumbar el build, porque un build sin credenciales es un
    // build legitimo (solo genera artefactos) y el aviso lo dice despues.
    return [];
  }
}

// Una credencial "de verdad" para este proposito: la URL tiene que ser la forma de un proyecto de
// Supabase, y la clave tiene que ser la de la API. El filtro es de FORMA, no de valor: no decide si
// la clave sirve, solo si es el texto de ejemplo que Rompio el build el 2026-10-02.
function credencialParecida(valor, tipo) {
  const texto = String(valor || "").trim();
  if (!texto || CREDENCIAL_EJEMPLO.test(texto)) return "";
  if (tipo === "url") return ESQUEMA_SUPABASE.test(texto) ? texto.replace(/\/+$/, "") : "";
  if (tipo === "anon") return FORMA_CLAVE.test(texto) ? texto : "";
  return texto;
}

function resolverCredencial(nombreVariable, tipo, lineas) {
  const delEntorno = credencialParecida(process.env[nombreVariable], tipo);
  if (delEntorno) return { valor: delEntorno, origen: `variable de entorno ${nombreVariable}` };
  // Se recorre el portapapeles ENTERO, no solo la primera linea, y se toma la primera linea que
  // tenga LA FORMA de esta credencial. Asi una sola copia con las dos sirve para las dos, y una
  // pagina copiada entera (que trae la URL, la clave y un monton de texto de la interfaz) tambien:
  // lo que no tiene la forma de una credencial se descarta solo.
  for (const linea of lineas) {
    const delPortapapeles = credencialParecida(linea, tipo);
    if (delPortapapeles) return { valor: delPortapapeles, origen: "portapapeles" };
  }
  return { valor: "", origen: "ninguno" };
}

// MEDIDO 2026-10-02: el portapapeles se lee UNA SOLA VEZ y se reparte entre las dos credenciales.
// Leerlo por credencial significaba dos llamadas a PowerShell, y ademas dos ventanas de 5s de
// espera si el portapapeles esta bloqueado por otra app.
// `opciones.portapapeles` INYECTA las lineas y evita llamar a PowerShell. MEDIDO 2026-10-02: sin
// esto las pruebas del build heredaban el portapapeles de quien las estuviera corriendo, o sea que
// el mismo `npm test` montaba el bundle con credenciales unas veces y sin ellas otras, y no habia
// forma de probar el filtro de forma. Se comprueba con `hasOwnProperty` y no con un `|| []` a
// proposito: `portapapeles: []` (bundle sin credenciales) tiene que ser un caso VALIDO, no un
// "no me pases nada" que acabe leyendo el portapapeles de verdad.
export function resolverCredencialesSupabase(opciones = {}) {
  const lineas = Object.prototype.hasOwnProperty.call(opciones, "portapapeles")
    ? opciones.portapapeles
    : leerPortapapeles();
  return {
    url: resolverCredencial("SUPABASE_URL", "url", lineas),
    anonKey: resolverCredencial("SUPABASE_ANON_KEY", "anon", lineas),
  };
}

function renderPlanningPage(template, styles, inspectionStyles, backendBridge, plannerCore, workflowCore, inspectionCore, app, inspectionApp, performanceClient, generatedComment, pwaHead = "") {
  const templateWithHead = pwaHead
    ? template.replace('    <link rel="icon" href="data:," />', '    <link rel="icon" href="data:," />\n' + pwaHead)
    : template;
  const templateWithBridge = templateWithHead.replace(
    "    <script>\n{{PLANNER_CORE}}\n</script>",
    `    <script>\n${backendBridge.trimEnd()}\n</script>\n    <script>\n{{PLANNER_CORE}}\n</script>`,
  );
  if (templateWithBridge === template) throw new Error("No se encontro el punto de insercion del puente de backend");

  const index = templateWithBridge
    .replace("{{PLANNING_STYLES}}", styles.trimEnd())
    .replace("{{INSPECTION_STYLES}}", inspectionStyles.trimEnd())
    .replace("{{PLANNER_CORE}}", plannerCore.trimEnd())
    .replace("{{PLANNING_WORKFLOW_CORE}}", workflowCore.trimEnd())
    .replace("{{INSPECTION_CORE}}", inspectionCore.trimEnd())
    .replace("{{PLANNING_APP}}", `${app.trimEnd()}\n</script>\n    <script>\n${performanceClient.trimEnd()}`)
    .replace("{{INSPECTION_APP}}", inspectionApp.trimEnd())
    .replace("<!-- Archivo generado. Edita src/web/planning y ejecuta npm run build. -->", generatedComment);

  if (/{{[A-Z0-9_]+}}/.test(index)) throw new Error("Quedaron marcadores sin reemplazar en Index.html");
  return index;
}

function patchPlanningApp(app) {
  const collectionMarker = "  if (Array.isArray(imported.operationCatalog)) state.operationCatalog = imported.operationCatalog;";
  const collectionReplacement = `${collectionMarker}
  if (Array.isArray(imported.workOrders)) state.workOrders = imported.workOrders;
  if (Array.isArray(imported.otTypes)) state.otTypes = imported.otTypes;
  if (imported.operationPlanStatuses) state.operationPlanStatuses = imported.operationPlanStatuses;
  if (Array.isArray(imported.machineToolHistory)) state.machineToolHistory = imported.machineToolHistory;
  if (imported.invoicePriceWindow) state.invoicePriceWindow = imported.invoicePriceWindow;
  if (imported.syncedAt) state.syncedAt = imported.syncedAt;`;
  let patched = app.replace(collectionMarker, collectionReplacement);
  if (patched === app) throw new Error("No se encontro el punto de importacion de colecciones del backend");

  const sharedStateMarker = `applyImported(imported, {
      preserveLocalPlanning: true,
      preferRemotePlanning: true,
      confirmStaleLocalRefresh: confirmLatestModificationRefresh,
    });`;
  const sharedStateReplacement = "applyImported(imported, { preserveLocalPlanning: false });";
  const sharedStatePatched = patched.replace(sharedStateMarker, sharedStateReplacement);
  if (sharedStatePatched === patched) throw new Error("No se encontro la carga inicial del estado compartido");
  patched = sharedStatePatched;

  // MEDIDO 2026-09-30: el marcador de abajo es copia LITERAL de app.js, y por eso no puede
  // llevar comentarios propios: si se le anade uno, el texto deja de coincidir con el fuente,
  // el patch no aplica y el throw de mas abajo lo dice. Por eso la razon de que la linea
  // `const bootSync = ...` ya no este compuerteada por isAppsScriptRuntime() vive en app.js y
  // en RULE-SUP-030, no aqui. Le pasa a cualquier parche por texto: el marcador es una
  // fotografia del fuente, y se rompe en cuanto el fuente cambia.
  const startupMarker = `async function loadAppStateInBackground() {
  const snapshotsRequest = loadPlanSnapshots(false, { deferPublishedLoad: true }).catch((error) => {
    console.warn("No se pudieron cargar los historicos:", error);
    return null;
  });
  const selectedDetailOt = state.selectedDetailOt;
  const selectedOperationId = state.selectedOperationId;
  const loaded = await loadAppSheetIfAvailable(false);
  if (loaded) await new Promise((resolve) => requestAnimationFrame(resolve));
  purgeClosedWorkOrderRetention();
  syncReportFiltersToPlanWeekOrToday();
  if (selectedDetailOt) state.selectedDetailOt = selectedDetailOt;
  if (selectedOperationId) state.selectedOperationId = selectedOperationId;
  saveState("ui");
  render({ save: false });
  applyInitialWorkspaceView({ scrollToTop: false });
  const bootSync = syncNetSuiteInBackground({ showMessage: state.workOrders.length === 0, background: true });
  // Los dos .catch NO son cosmeticos. Este Promise.all es UNO de los dos disparadores de
  // maybeRestoreSavedDraftOnBoot; el otro es la cadena de reintentos de scheduleDraftBootRestoreRetry.
  // Un Promise.all SIN catch se rechaza entero si UNA de las dos ramas falla, y entonces el .then de
  // abajo no corre nunca. snapshotsRequest es una lectura de red: si esa falla, el borrador no se
  // restauraba nunca aunque la sincronizacion hubiera terminado bien. Y al reventar el sync, la
  // red de seguridad se caia justo cuando se necesitaba: que es el escenario entero del rescate.
  void Promise.all([
    Promise.resolve(bootSync).catch(() => false),
    Promise.resolve(snapshotsRequest).catch(() => null),
  ]).then(([bootResult]) => {
    void Promise.resolve(bootResult);
    if (typeof maybeRestoreSavedDraftOnBoot === "function") return maybeRestoreSavedDraftOnBoot();
    return null;
  });
  void snapshotsRequest.then(() => {
    if (typeof maybeLoadDefaultPublishedReportSnapshot === "function") return maybeLoadDefaultPublishedReportSnapshot();
    return null;
  });
}`;
  const startupReplacement = `async function loadAppStateInBackground() {
  const snapshotsRequest = loadPlanSnapshots(false, { deferPublishedLoad: true }).catch((error) => {
    console.warn("No se pudieron cargar los historicos:", error);
    return null;
  });
  const selectedDetailOt = state.selectedDetailOt;
  const selectedOperationId = state.selectedOperationId;
  const loaded = await loadAppSheetIfAvailable(false);
  if (loaded) await new Promise((resolve) => requestAnimationFrame(resolve));
  await snapshotsRequest;
  const restoredDraft = loaded ? await restoreDraftPlanFromSharedState() : false;
  purgeClosedWorkOrderRetention();
  syncReportFiltersToPlanWeekOrToday();
  if (selectedDetailOt) state.selectedDetailOt = selectedDetailOt;
  if (selectedOperationId) state.selectedOperationId = selectedOperationId;
  saveState("ui");
  render({ save: false });
  applyInitialWorkspaceView({ scrollToTop: false });
  if (restoredDraft) showToast("Se cargo el plan guardado desde Google Sheets");
  const bootSync = syncNetSuiteInBackground({ showMessage: state.workOrders.length === 0, background: true });
  // Los dos .catch NO son cosmeticos. Este Promise.all es UNO de los dos disparadores de
  // maybeRestoreSavedDraftOnBoot; el otro es la cadena de reintentos de scheduleDraftBootRestoreRetry.
  // Un Promise.all SIN catch se rechaza entero si UNA de las dos ramas falla, y entonces el .then de
  // abajo no corre nunca. snapshotsRequest es una lectura de red: si esa falla, el borrador no se
  // restauraba nunca aunque la sincronizacion hubiera terminado bien. Y al reventar el sync, la
  // red de seguridad se caia justo cuando se necesitaba: que es el escenario entero del rescate.
  void Promise.all([
    Promise.resolve(bootSync).catch(() => false),
    Promise.resolve(snapshotsRequest).catch(() => null),
  ]).then(([bootResult]) => {
    void Promise.resolve(bootResult);
    if (typeof maybeRestoreSavedDraftOnBoot === "function") return maybeRestoreSavedDraftOnBoot();
    return null;
  });
  if (typeof maybeLoadDefaultPublishedReportSnapshot === "function") {
    void maybeLoadDefaultPublishedReportSnapshot();
  }
}

function planningStateHasDemoOnly() {
  const ops = Array.isArray(state.operations) ? state.operations : [];
  return !ops.filter((op) => String(op.log || "") !== "Demo").length;
}

function planningNormalizeKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function planningLoadSnapshotIntoState(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.operations) || !snapshot.operations.length) return false;
  const snapshotOps = snapshot.operations.map((op, index) => normalizeOperation({
    ...op,
    schemaVersion: op.schemaVersion != null ? op.schemaVersion : state.schemaVersion,
    id: op.id || ("snapshot-" + snapshot.snapshotId + "-" + (index + 1)),
  }, index));
  const ots = uniq(snapshotOps.map((op) => String(op.ot || "").trim()).filter(Boolean));
  if (!ots.length) return false;

  const keys = new Set(ots.map(planningNormalizeKey));
  state.operations = [
    ...(state.operations || []).filter((op) => !keys.has(planningNormalizeKey(op.ot))),
    ...snapshotOps,
  ];
  state.selectedOts = ots;
  state.lockedOts = uniq([
    ...(state.lockedOts || []),
    ...snapshotOps.filter((op) => op.locked === true).map((op) => op.ot),
  ].filter(Boolean));
  state.expandedOts = uniq([...(state.expandedOts || []), ...ots]);

  const fullState = snapshot.fullState || snapshot;
  if (snapshot.planStart) state.planStart = snapshot.planStart;
  if (fullState.plant && fullState.plant !== "Demo") state.plant = fullState.plant;
  if (snapshot.weekStart) state.weekStart = snapshot.weekStart;
  if (fullState.weekStart) state.weekStart = fullState.weekStart;
  if (state.planStart) {
    state.loadWeekStart = state.planStart;
    state.reportWeekStart = normalizeWeekStartValue(state.planStart);
  }
  state.draftVersionId = snapshot.snapshotId;
  state.lastSchedule = {
    ...(state.lastSchedule || {}),
    generatedAt: snapshot.generatedAt || "",
    scheduled: snapshotOps.filter((op) => op.tipoInsercion !== "CAMBIO_HERRAMENTAL").length,
    scheduledOts: ots,
    changes: snapshotOps.filter((op) => op.tipoInsercion === "CAMBIO_HERRAMENTAL").length,
    unscheduled: 0,
    restoredFromSnapshot: true,
  };
  window.__planningRestoredFromServer = true;
  return true;
}

async function planningFetchSnapshotById(snapshotId) {
  if (!snapshotId) return null;
  // MEDIDO 2026-09-30: esto era isAppsScriptRuntime() ? callAppsScript("getPlanSnapshotLight", id)
  // : fetchJson(PLAN_SNAPSHOTS_API + "/" + id). Las dos ramas estan muertas: el puente
  // quedo deshabilitado y PLAN_SNAPSHOTS_API es la URL del web app de Apps Script, que
  // en el sitio estatico da 404 (es el mismo 404 que ya se midio en syncNetSuiteData). El
  // unico destino real es Supabase, asi que queda una sola rama (RULE-SUP-030).
  return PPSupabaseBridgeReplacement.getPlanSnapshotLight(snapshotId);
}

async function restoreDraftPlanFromSharedState() {
  const hasPlanData = (Array.isArray(state.selectedOts) && state.selectedOts.length)
    || ((state.operations || []).length && !planningStateHasDemoOnly());
  const currentGeneratedAtMs = Date.parse(state.lastSchedule?.generatedAt || "") || 0;
  const draftPlanMeta = (Array.isArray(planSnapshots) ? planSnapshots : [])
    .find((item) => item.snapshotId === "draft");
  const metaDraftGeneratedAtMs = draftPlanMeta ? (Date.parse(draftPlanMeta.generatedAt || "") || 0) : 0;
  if (hasPlanData && metaDraftGeneratedAtMs > 0 && !(metaDraftGeneratedAtMs > currentGeneratedAtMs)) return false;

  try {
    const draftSnapshot = await planningFetchSnapshotById("draft");
    if (draftSnapshot) {
      const snapshotGeneratedAtMs = draftSnapshot.generatedAt ? (Date.parse(draftSnapshot.generatedAt) || 0) : 0;
      if (hasPlanData && snapshotGeneratedAtMs > 0 && !(snapshotGeneratedAtMs > currentGeneratedAtMs)) return false;
      if (planningLoadSnapshotIntoState(draftSnapshot)) return true;
    }
  } catch (error) {
    console.warn("No se pudo recuperar el borrador directamente:", error);
  }

  const availableSnapshots = (Array.isArray(planSnapshots) ? planSnapshots : [])
    .slice()
    .sort((a, b) => String(b.generatedAt || "").localeCompare(String(a.generatedAt || "")));
  if (!availableSnapshots.length) return false;

  const publishedId = publishedSnapshotIds();
  const byVersion = state.draftVersionId ? availableSnapshots.find((item) => item.snapshotId === state.draftVersionId) : null;
  const draft = availableSnapshots.find((item) => item.snapshotId === "draft") ||
    availableSnapshots.find((item) => item.snapshotId && item.snapshotId !== "draft" && !publishedId.has(item.snapshotId));
  const published = publishedPlanSnapshots()[0];
  const preferredSnapshot = (byVersion && byVersion !== published) ? byVersion : (draft || published || availableSnapshots[0]);
  if (!preferredSnapshot || !preferredSnapshot.snapshotId) return false;

  try {
    const snapshot = await planningFetchSnapshotById(preferredSnapshot.snapshotId);
    if (!snapshot) return false;
    if (!planningLoadSnapshotIntoState(snapshot)) return false;
    return true;
  } catch (error) {
    console.warn("No se pudo recuperar el plan guardado", error);
    return false;
  }
}

async function planningRescueStateFromBackups() {
  return restoreDraftPlanFromSharedState();
}

function planningHydrateLocalCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const cached = JSON.parse(raw);
    if (!cached || typeof cached !== "object" || Array.isArray(cached)) return false;
    if (!Array.isArray(cached.operations) || !cached.operations.length) return false;
    if (!(Number(cached.revision) > 0)) return false;
    if ((state.operations || []).length) return false;
    if (String(cached.plant && cached.plant.name || "").toLowerCase() === "demo") return false;
    if (Number(cached.schemaVersion) !== Number(state.schemaVersion || APP_SCHEMA_VERSION)) return false;
    state.operations = cached.operations;
    if (Array.isArray(cached.workOrders)) state.workOrders = cached.workOrders;
    if (cached.plant) state.plant = cached.plant;
    if (cached.planStart) state.planStart = cached.planStart;
    if (Array.isArray(cached.selectedOts) && cached.selectedOts.length) {
      state.selectedOts = cached.selectedOts;
      state.expandedOts = (Array.isArray(cached.expandedOts) && cached.expandedOts.length) ? cached.expandedOts : cached.selectedOts.slice();
    }
    if (state.planStart) {
      state.loadWeekStart = state.planStart;
      state.reportWeekStart = normalizeWeekStartValue(state.planStart);
    }
    if (cached.lastSchedule) state.lastSchedule = cached.lastSchedule;
    if (cached.draftVersionId) state.draftVersionId = cached.draftVersionId;
    if (cached.activePublishedVersionId) state.activePublishedVersionId = cached.activePublishedVersionId;
    if (cached.operators) state.operators = cached.operators;
    if (cached.operatorProfiles) state.operatorProfiles = cached.operatorProfiles;
    if (cached.matrix) state.matrix = cached.matrix;
    if (cached.capacityModes) state.capacityModes = cached.capacityModes;
    if (cached.cts) state.cts = cached.cts;
    state.revision = Number(cached.revision || 0);
    normalizeState();
    return true;
  } catch (_) {
    return false;
  }
}`;
  const startupPatched = patched.replace(startupMarker, startupReplacement);
  if (startupPatched === patched) throw new Error("No se encontro la carga inicial para recuperar el borrador");
  patched = startupPatched;

  const demoSelectedIdMarker = 'selectedOperationId: "op-1",';
  const demoSelectedIdReplacement = 'selectedOperationId: "",';
  const demoSelectedIdPatched = patched.replace(demoSelectedIdMarker, demoSelectedIdReplacement);
  if (demoSelectedIdPatched === patched) throw new Error("No se encontro el id de operacion demo en sampleState");
  patched = demoSelectedIdPatched;

  const demoPlantMarker = 'plant: { name: "Demo", locationId: null },';
  const demoPlantReplacement = 'plant: { name: "", locationId: null },';
  const demoPlantPatched = patched.replace(demoPlantMarker, demoPlantReplacement);
  if (demoPlantPatched === patched) throw new Error("No se encontro la planta demo en sampleState");
  patched = demoPlantPatched;

  const demoOpsMarker = /\n  operations: \[\n\s*\{\n\s*id: "op-1",[\s\S]*?\n  \],\n\};/;
  const demoOpsReplacement = "\n  operations: [],\n};";
  const demoOpsPatched = patched.replace(demoOpsMarker, demoOpsReplacement);
  if (demoOpsPatched === patched) throw new Error("No se encontraron las operaciones demo en sampleState");
  patched = demoOpsPatched;

  const initializeMarker = `function initializePlanningApp() {
  bindElements();
  bindEvents();
  purgeClosedWorkOrderRetention();
  resetDailyReportFiltersToToday();
  render({ save: false });
  bindBacklogLoadMoreObserver();`;
  const initializeReplacement = `function initializePlanningApp() {
  bindElements();
  bindEvents();
  purgeClosedWorkOrderRetention();
  resetDailyReportFiltersToToday();
  planningHydrateLocalCache();
  render({ save: false });
  bindBacklogLoadMoreObserver();`;
  const initializePatched = patched.replace(initializeMarker, initializeReplacement);
  if (initializePatched === patched) throw new Error("No se encontro initializePlanningApp para hidratar el cache local");
  patched = initializePatched;

  return patched;
}

function patchPerformanceClient(performanceClient) {
  // MEDIDO 2026-09-30: este marcador incluia la linea ensureReady de PPAppsScriptBridge, que
  // se quito de performance-client.js porque montaba el iframe del web app de Apps Script en
  // cada carga de pagina. El marcador se ajusta al fuente REAL: si el build afirmara sobre una
  // linea que ya no existe, el patch no aplicaria, el build lo diria, y el arranque desplegado
  // seria el viejo, sin el rescate rapido del borrador.
  const startupMarker = `        snapshotsRequest = loadPlanSnapshots(false, { deferPublishedLoad: true }).catch((error) => {
          console.warn("No se pudieron cargar los historicos:", error);
          return null;
        });
        const result = await loadInitialStateConditionally(resolveInitialLocalCache());`;
  const startupReplacement = `        snapshotsRequest = loadPlanSnapshots(false, { deferPublishedLoad: true }).catch((error) => {
          console.warn("No se pudieron cargar los historicos:", error);
          return null;
        });
        const fastDraftRescue = (typeof planningRescueStateFromBackups === "function")
          ? planningRescueStateFromBackups().then((ok) => {
              if (ok) {
                saveState("ui");
                root.requestAnimationFrame(() => render({ save: false }));
              }
              return ok;
            }).catch((error) => {
              console.warn("No se pudo cargar el plan guardado de forma rapida:", error);
              return false;
            })
          : Promise.resolve(false);
        void fastDraftRescue;
        const result = await loadInitialStateConditionally(resolveInitialLocalCache());
        loaded = result.loaded;
        if (loaded) scheduleLocalStorageFlush();`;
  const startupPatched = performanceClient.replace(startupMarker, startupReplacement);
  if (startupPatched === performanceClient) {
    throw new Error("No se encontro el arranque optimizado en performance-client");
  }

  const modalMarker = `    if (typeof captureLocalPlanningState === "function"
      && typeof confirmLatestModificationRefresh === "function"
      && Number(imported?.revision || 0) > Number(state.revision || 0)) {
      const refreshWithLatest = await confirmLatestModificationRefresh(captureLocalPlanningState(), imported);
      if (refreshWithLatest === false) {
        deferredRevision = Number(state.revision || 0);
        writeMeta({ syncedAt: state.syncedAt || "" });
        return { loaded: false, unchanged: false, keptLocal: true };
      }
    }
    applyImported(imported, { preserveLocalPlanning: false });`;
  const modalReplacement = `    const planningRestoredFromServer = root.__planningRestoredFromServer === true;
    if (typeof captureLocalPlanningState === "function"
      && typeof confirmLatestModificationRefresh === "function"
      && !planningRestoredFromServer
      && Number(imported?.revision || 0) > Number(state.revision || 0)) {
      const refreshWithLatest = await confirmLatestModificationRefresh(captureLocalPlanningState(), imported);
      if (refreshWithLatest === false) {
        root.__planningRestoredFromServer = false;
        deferredRevision = Number(state.revision || 0);
        writeMeta({ syncedAt: state.syncedAt || "" });
        return { loaded: false, unchanged: false, keptLocal: true };
      }
    }
    applyImported(imported, { preserveLocalPlanning: false });
    root.__planningRestoredFromServer = false;`;
  const modalPatched = startupPatched.replace(modalMarker, modalReplacement);
  if (modalPatched === startupPatched) {
    throw new Error("No se encontro el dialogo de confirmacion en performance-client");
  }

  const unchangedMarker = `    if (imported?.unchanged) {
      const currentRevision = Number(imported.revision || revision);
      deferredMaterials = localCache.deferredMaterials === true;
      if (deferredMaterials) loadedMaterialOts.clear();
      state.revision = currentRevision;`;
  const unchangedReplacement = `    if (imported?.unchanged) {
      const currentRevision = Number(imported.revision || revision);
      deferredMaterials = localCache.deferredMaterials === true;
      if (deferredMaterials) loadedMaterialOts.clear();
      root.__planningRestoredFromServer = false;
      state.revision = currentRevision;`;
  const unchangedPatched = modalPatched.replace(unchangedMarker, unchangedReplacement);
  if (unchangedPatched === modalPatched) {
    throw new Error("No se encontro la rama unchanged en performance-client");
  }

  return unchangedPatched;
}

// MEDIDO 2026-10-02: `opciones.portapapeles` existe para que las pruebas no dependan del
// portapapeles de quien las corre. Ver `resolverCredencialesSupabase`.
export async function buildProject(opciones = {}) {
  await Promise.all([
    rm(distDir, { recursive: true, force: true }),
    rm(siteDir, { recursive: true, force: true }),
  ]);
  await Promise.all([
    mkdir(distDir, { recursive: true }),
    mkdir(siteDir, { recursive: true }),
  ]);

  const [template, styles, bridgeSource, plannerCore, workflowCore, inspectionCore, appSource, inspectionApp, performanceClient, fluidClient, inspectionStyles, skillsSource, supabaseReaderRaw, supabaseAuthRaw, catalogBootRaw, catalogApplyRaw, supabaseWriterRaw, eventLogRaw, supabaseBridgeReplacementRaw, ingestaTriggerRaw] = await Promise.all([
    read("src/web/planning/index.template.html"),
    read("src/web/planning/styles.css"),
    read("src/web/shared/apps-script-bridge-client.js"),
    read("src/web/planning/planner-core.js"),
    read("src/web/planning/planning-workflow-core.js"),
    read("src/web/inspection/inspection-core.js"),
    read("src/web/planning/app.js"),
    read("src/web/inspection/inspection-app.js"),
    read("src/web/shared/performance-client.js"),
    read("src/web/shared/fluid-client.js"),
    read("src/web/inspection/inspection.css"),
    read("src/web/skills/IndexSkills.html"),
    read("src/web/shared/supabase-reader.js"),
    read("src/web/shared/supabase-auth.js"),
    read("src/web/shared/supabase-catalog-boot.js"),
    read("src/web/shared/supabase-catalog-apply.js"),
    read("src/web/shared/supabase-writer.js"),
    read("src/web/shared/supabase-event-log.js"),
    read("src/web/shared/supabase-bridge-replacement.js"),
    read("src/web/shared/apps-script-ingesta-trigger.js"),
  ]);
  const backendBridge = bridgeSource.replace("__PP_APPS_SCRIPT_WEB_APP_URL__", appsScriptWebAppUrl);
  // La URL y la clave PUBLICABLE (cliente) de Supabase nunca estan en el repo. Se resuelven UNA sola
  // vez aqui (variable de entorno, y si no hay, portapapeles) y de ahi salen los cuatro clientes que
  // las necesitan, y MEDIDO 2026-10-02 son TRES modulos, no cuatro: lector, auth y escritor.
  // `catalog-boot` NO lleva marcador: pide la url y la clave a `PPSupabaseReader.config()`
  // (supabase-catalog-boot.js:200), o sea que hereda la credencial en vez de duplicarla. Por eso las
  // sustituciones son cuatro (dos marcadores x tres modulos) pero el bundle trae la URL y la clave
  // tres veces cada una, y ese conteo es el que la prueba cuenta. Sin ellas el lector queda apagado
  // (isConfigured() false) y el aviso de check-project.mjs lo dice.
  const credenciales = resolverCredencialesSupabase(opciones);
  const supabaseUrl = credenciales.url;
  const supabaseAnonKey = credenciales.anonKey;
  const supabaseReader = supabaseReaderRaw
    .replace("__PP_SUPABASE_URL__", supabaseUrl.valor)
    .replace("__PP_SUPABASE_ANON_KEY__", supabaseAnonKey.valor);
  let skillsHtml = skillsSource
    .replace("{{BRIDGE_CLIENT}}", () => backendBridge.trimEnd())
    .replace("{{PLANNER_CORE}}", () => plannerCore.trimEnd());
  if (/{{[A-Z0-9_]+}}/.test(skillsHtml)) {
    throw new Error("Quedaron marcadores sin reemplazar en IndexSkills.html");
  }
  const app = patchPlanningApp(appSource);
  const appRuntimeClient = patchPerformanceClient(performanceClient);
  // MEDIDO 2026-09-29: la pagina sigue arrancando por el puente, asi que la sesion
  // no bloquea nada todavia. supabase-auth.js entra PRIMERO de los runtime clients
  // para que, cuando exista, la pantalla de entrada este puesta antes de que la
  // app pida nada. Va antes que el lector a proposito: el lector va a necesitar el
  // token, y este modulo es quien lo tiene.
  const supabaseAuth = supabaseAuthRaw
    .replace("__PP_SUPABASE_URL__", supabaseUrl.valor)
    .replace("__PP_SUPABASE_ANON_KEY__", supabaseAnonKey.valor);
  // Orden de los runtime clients, y por que es este:
  //   auth  -> pantalla de entrada y token
  //   reader-> sabe leer de Supabase
  //   boot  -> reintentos y avisos, sin los cuales el reader se traga los fallos
  //   apply -> envuelve applyImported y aplica DESPUES de que el puente cargue
  //   eventos-> la vista de depuracion de operation_events; usa el token de auth y
  //            la url/clave del reader, asi que va detras de los dos
  // apply va antes que eventos a proposito: envuelve window.applyImported, que la
  // app declara como funcion de primer nivel, o sea que es una global de window. No
  // se toca app.js porque el build guarda una COPIA LITERAL de
  // loadAppStateInBackground para parchearla (startupMarker) y una sola linea de mas
  // ahi rompe el build. Se intento y MEDIDO 2026-09-29: 'No se encontro la carga
  // inicial para recuperar el borrador'. Envolver applyImported no depende de ese
  // texto, y la vista de eventos tampoco: se engancha al hash y al DOM.
  const catalogBoot = catalogBootRaw
    .replace("__PP_SUPABASE_URL__", supabaseUrl.valor)
    .replace("__PP_SUPABASE_ANON_KEY__", supabaseAnonKey.valor);
  const catalogApply = catalogApplyRaw;
  // El escritor entra DESPUES de reader y boot, y antes del registro de eventos: usa el
  // token de supabase-auth y la url de supabase-reader, y el registro lee lo que el
  // escritor produjo. MEDIDO 2026-09-29: sin esto, PPSupabaseWriter existe pero
  // ninguna pagina lo puede llamar, que es la forma de tener codigo muerto que
  // parece funcionar.
  const catalogWrite = supabaseWriterRaw
    .replace("__PP_SUPABASE_URL__", supabaseUrl.valor)
    .replace("__PP_SUPABASE_ANON_KEY__", supabaseAnonKey.valor);
  // La vista de eventos no trae marcadores de configuracion: la URL y la clave las
  // pide al lector (un solo sitio las sabe) y el JWT a la sesion.
  const eventLog = eventLogRaw;
  // El disparador de la ingesta entra entre el reemplazo del puente y el registro de eventos.
  // MEDIDO 2026-09-30: sin esto los botones Sincronizar y Sincronizar OTs siguen funcionando y
  // NO hacen nada nuevo, porque el boton no puede pedir la ingesta si PPIngestaTrigger no esta
  // en el bundle. No es un fallo visible: el boton sigue leyendo Supabase y sigue "sincronizando".
  const ingestaTrigger = ingestaTriggerRaw;
  const runtimeClients = `${supabaseAuth.trimEnd()}\n${supabaseReader.trimEnd()}\n${catalogBoot.trimEnd()}\n${catalogApply.trimEnd()}\n${catalogWrite.trimEnd()}\n${supabaseBridgeReplacementRaw.trimEnd()}\n${ingestaTrigger.trimEnd()}\n${eventLog.trimEnd()}\n${appRuntimeClient.trimEnd()}\n${fluidClient.trimEnd()}`;

  const appsScriptIndex = renderPlanningPage(
    template,
    styles,
    inspectionStyles,
    backendBridge,
    plannerCore,
    workflowCore,
    inspectionCore,
    app,
    inspectionApp,
    runtimeClients,
    "<!-- Generado para Apps Script por npm run build. No editar directamente. -->",
    "",
  );
  const pagesIndex = renderPlanningPage(
    template,
    styles,
    inspectionStyles,
    backendBridge,
    plannerCore,
    workflowCore,
    inspectionCore,
    app,
    inspectionApp,
    runtimeClients,
    "<!-- Generado para GitHub Pages por npm run build. No editar directamente. -->",
    '    <link rel="manifest" href="./manifest.webmanifest" />',
  );
  const pagesBuildId = createHash("sha256").update(pagesIndex).digest("hex").slice(0, 12);

  // ---- generar version.json para detección de actualizaciones ----
await writeFile(path.join(siteDir, "version.json"), JSON.stringify({
  commit: process.env.GIT_SHA || "dev",
  built: new Date().toISOString()
}), "utf8");
await Promise.all([
    writeFile(path.join(distDir, "Index.html"), appsScriptIndex, "utf8"),
    writeFile(path.join(siteDir, "index.html"), pagesIndex, "utf8"),
    writeFile(path.join(siteDir, ".nojekyll"), "", "utf8"),
    writeFile(path.join(siteDir, "manifest.webmanifest"), JSON.stringify({
      name: "Plan Maestro de Produccion",
      short_name: "Plan Maestro",
      description: "Planeacion y control de produccion",
      start_url: "./",
      scope: "./",
      display: "standalone",
      background_color: "#eef1f4",
      theme_color: "#087f7a",
      lang: "es-MX"
    }, null, 2), "utf8"),
    writeFile(path.join(siteDir, "sw.js"), `const CACHE_NAME = "plan-maestro-${pagesBuildId}";
const APP_SHELL = ["./", "./index.html", "./operator.html", "./skills.html", "./manifest.webmanifest"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  const navigation = event.request.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith("/index.html");
  if (navigation) {
    event.respondWith(fetch(event.request, { cache: "no-store" }).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", response.clone()));
      return response;
    }).catch(() => caches.match("./index.html").then((cached) => cached || caches.match("./"))));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => {
    const network = fetch(event.request).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
      return response;
    }).catch(() => cached);
    return cached || network;
  }));
});
`, "utf8"),
    cp(path.join(projectRoot, "src/web/operator/IndexOperator.html"), path.join(distDir, "IndexOperator.html")),
    writeFile(path.join(distDir, "IndexSkills.html"), skillsHtml, "utf8"),
    cp(path.join(projectRoot, "src/web/operator/IndexOperator.html"), path.join(siteDir, "operator.html")),
    writeFile(path.join(siteDir, "skills.html"), skillsHtml, "utf8"),
    cp(path.join(projectRoot, "src/web/bridge/Bridge.html"), path.join(distDir, "Bridge.html")),
    cp(path.join(projectRoot, "appsscript.json"), path.join(distDir, "appsscript.json")),
  ]);

  const serverDir = path.join(projectRoot, "src/server");
  const serverFiles = (await readdir(serverDir)).filter((name) => name.endsWith(".js")).sort();
  for (const file of serverFiles) await cp(path.join(serverDir, file), path.join(distDir, file));

  return {
    distDir,
    siteDir,
    serverFiles,
    htmlFiles: ["Index.html", "IndexOperator.html", "IndexSkills.html", "Bridge.html"],
    pagesFiles: ["index.html", "operator.html", "skills.html", "manifest.webmanifest", "sw.js"],
    // MEDIDO 2026-10-02: el build dice DE DONDE salio cada credencial al terminar, porque el aviso
    // de check-project.mjs dice si falto una, y sin esto la unica forma de saber si el bundle va
    // con la clave del portapapeles o con una variable vieja de otra consola es abrir el HTML.
    // Los VALORES no se imprimen, solo el origen.
    credenciales: [
      { nombre: "SUPABASE_URL", origen: supabaseUrl.origen, vacia: !supabaseUrl.valor },
      { nombre: "SUPABASE_ANON_KEY", origen: supabaseAnonKey.origen, vacia: !supabaseAnonKey.valor },
    ],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildProject();
  console.log(`Apps Script generado en ${result.distDir}`);
  console.log(`GitHub Pages generado en ${result.siteDir}`);
  console.log(`${result.serverFiles.length} archivos de servidor, ${result.htmlFiles.length} vistas Apps Script y ${result.pagesFiles.length} paginas estaticas.`);
for (const credencial of result.credenciales) {
    console.log(`  ${credencial.nombre}: ${credencial.vacia ? "SIN CREDENCIAL (lector apagado)" : credencial.origen}`);
  }
}
