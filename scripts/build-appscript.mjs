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
  if (isAppsScriptRuntime()) syncNetSuiteInBackground({ showMessage: state.workOrders.length === 0 });
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
  if (isAppsScriptRuntime()) syncNetSuiteInBackground({ showMessage: state.workOrders.length === 0 });
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
    ? await callAppsScript("getPlanSnapshot", snapshotId)
    : await fetchJson(PLAN_SNAPSHOTS_API + "/" + encodeURIComponent(snapshotId));
}

async function restoreDraftPlanFromSharedState() {
  if (Array.isArray(state.selectedOts) && state.selectedOts.length) return false;
  if ((state.operations || []).length && !planningStateHasDemoOnly()) return false;

  try {
    const draftSnapshot = await planningFetchSnapshotById("draft");
    if (draftSnapshot && planningLoadSnapshotIntoState(draftSnapshot)) return true;
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
        const result = await loadInitialStateConditionally(initialLocalCache);`;
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
        const result = await loadInitialStateConditionally(initialLocalCache);
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

  const [template, styles, bridgeSource, plannerCore, workflowCore, inspectionCore, appSource, inspectionApp, performanceClient, fluidClient, inspectionStyles] = await Promise.all([
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
  ]);
  const backendBridge = bridgeSource.replace("__PP_APPS_SCRIPT_WEB_APP_URL__", appsScriptWebAppUrl);
  const app = patchPlanningApp(appSource);
  const appRuntimeClient = patchPerformanceClient(performanceClient);
  const runtimeClients = `${appRuntimeClient.trimEnd()}\n${fluidClient.trimEnd()}`;

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
    cp(path.join(projectRoot, "src/web/skills/IndexSkills.html"), path.join(distDir, "IndexSkills.html")),
    cp(path.join(projectRoot, "src/web/operator/IndexOperator.html"), path.join(siteDir, "operator.html")),
    cp(path.join(projectRoot, "src/web/skills/IndexSkills.html"), path.join(siteDir, "skills.html")),
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
