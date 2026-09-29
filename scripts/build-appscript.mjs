import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(projectRoot, "dist");
const siteDir = path.join(projectRoot, "site");
const appsScriptWebAppUrl = "https://script.google.com/macros/s/AKfycbzom44gOrh7KQWkeroVHHtQfH6osAFdBUN-NHJ_T1g13cQlEKhCpMP8lcHDrH-PzOzB5Q/exec";

async function read(relativePath) {
  const content = await readFile(path.join(projectRoot, relativePath), "utf8");
  return content.replace(/\r\n/g, "\n");
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
  const bootSync = isAppsScriptRuntime()
    ? syncNetSuiteInBackground({ showMessage: state.workOrders.length === 0, background: true })
    : Promise.resolve(false);
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
  const bootSync = isAppsScriptRuntime()
    ? syncNetSuiteInBackground({ showMessage: state.workOrders.length === 0, background: true })
    : Promise.resolve(false);
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
  return isAppsScriptRuntime()
    ? await callAppsScript("getPlanSnapshotLight", snapshotId)
    : await fetchJson(PLAN_SNAPSHOTS_API + "/" + encodeURIComponent(snapshotId));
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
  const startupMarker = `        await root.PPAppsScriptBridge.ensureReady();
        snapshotsRequest = loadPlanSnapshots(false, { deferPublishedLoad: true }).catch((error) => {
          console.warn("No se pudieron cargar los historicos:", error);
          return null;
        });
        const result = await loadInitialStateConditionally(resolveInitialLocalCache());`;
  const startupReplacement = `        await root.PPAppsScriptBridge.ensureReady();
        snapshotsRequest = loadPlanSnapshots(false, { deferPublishedLoad: true }).catch((error) => {
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

export async function buildProject() {
  await Promise.all([
    rm(distDir, { recursive: true, force: true }),
    rm(siteDir, { recursive: true, force: true }),
  ]);
  await Promise.all([
    mkdir(distDir, { recursive: true }),
    mkdir(siteDir, { recursive: true }),
  ]);

  const [template, styles, bridgeSource, plannerCore, workflowCore, inspectionCore, appSource, inspectionApp, performanceClient, fluidClient, inspectionStyles, skillsSource, supabaseReaderRaw, supabaseAuthRaw, catalogBootRaw, catalogApplyRaw, supabaseWriterRaw, eventLogRaw] = await Promise.all([
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
  ]);
  const backendBridge = bridgeSource.replace("__PP_APPS_SCRIPT_WEB_APP_URL__", appsScriptWebAppUrl);
  // La URL y la clave PUBLICABLE (cliente) de Supabase vienen del entorno del build, nunca del repo.
  // Sin ellas, el lector queda apagado (isConfigured() false) y la pagina sigue por el puente.
  const supabaseReader = supabaseReaderRaw
    .replace("__PP_SUPABASE_URL__", String(process.env.SUPABASE_URL || "").replace(/\/+$/, ""))
    .replace("__PP_SUPABASE_ANON_KEY__", String(process.env.SUPABASE_ANON_KEY || ""));
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
    .replace("__PP_SUPABASE_URL__", String(process.env.SUPABASE_URL || "").replace(/\/+$/, ""))
    .replace("__PP_SUPABASE_ANON_KEY__", String(process.env.SUPABASE_ANON_KEY || ""));
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
    .replace("__PP_SUPABASE_URL__", String(process.env.SUPABASE_URL || "").replace(/\/+$/, ""))
    .replace("__PP_SUPABASE_ANON_KEY__", String(process.env.SUPABASE_ANON_KEY || ""));
  const catalogApply = catalogApplyRaw;
  // El escritor entra DESPUES de reader y boot, y antes del registro de eventos: usa el
  // token de supabase-auth y la url de supabase-reader, y el registro lee lo que el
  // escritor produjo. MEDIDO 2026-09-29: sin esto, PPSupabaseWriter existe pero
  // ninguna pagina lo puede llamar, que es la forma de tener codigo muerto que
  // parece funcionar.
  const catalogWrite = supabaseWriterRaw
    .replace("__PP_SUPABASE_URL__", String(process.env.SUPABASE_URL || "").replace(/\/+$/, ""))
    .replace("__PP_SUPABASE_ANON_KEY__", String(process.env.SUPABASE_ANON_KEY || ""));
  // La vista de eventos no trae marcadores de configuracion: la URL y la clave las
  // pide al lector (un solo sitio las sabe) y el JWT a la sesion.
  const eventLog = eventLogRaw;
  const runtimeClients = `${supabaseAuth.trimEnd()}\n${supabaseReader.trimEnd()}\n${catalogBoot.trimEnd()}\n${catalogApply.trimEnd()}\n${catalogWrite.trimEnd()}\n${eventLog.trimEnd()}\n${appRuntimeClient.trimEnd()}\n${fluidClient.trimEnd()}`;

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
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildProject();
  console.log(`Apps Script generado en ${result.distDir}`);
  console.log(`GitHub Pages generado en ${result.siteDir}`);
  console.log(`${result.serverFiles.length} archivos de servidor, ${result.htmlFiles.length} vistas Apps Script y ${result.pagesFiles.length} paginas estaticas.`);
}
