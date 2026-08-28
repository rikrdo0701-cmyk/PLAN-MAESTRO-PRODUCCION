import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildProject } from "../scripts/build-appscript.mjs";

test("la identidad del detalle es UI local y no se envia al estado compartido", async () => {
  const planningApp = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");
  assert.match(planningApp, /selectedDetailOt:\s*""/);
  assert.match(planningApp, /queueMoveOt:\s*""/);
  const persistableSource = planningApp.slice(
    planningApp.indexOf("function persistableState("),
    planningApp.indexOf("function createAppSheetPayload("),
  );
  assert.match(persistableSource, /\{\s*matrixSearch,\s*selectedDetailOt,\s*queueMoveOt,\s*\.\.\.persisted\s*\}/);
});

test("cola de planeacion expone mover sin flechas y modal de preparacion sin textos removidos", async () => {
  const planningApp = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");
  const planningStyles = await readFile(new URL("../src/web/planning/styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(planningApp, /data-move-direction="up"/);
  assert.doesNotMatch(planningApp, /data-move-direction="down"/);
  assert.doesNotMatch(planningApp, /data-move-queue-ot=/);
  assert.match(planningApp, /data-start-queue-move/);
  assert.match(planningApp, /data-place-queue-ot/);
  assert.match(planningApp, /queue-move-actions/);
  assert.match(planningApp, /`qty:\$\{formatMaterialQuantity\(Number\.isFinite\(quantity\) \? quantity : 0\)\}`/);
  assert.match(planningApp, /Moviendo OT/);
  assert.match(planningApp, /Cancelar/);
  assert.match(planningApp, /Poner aqui/);
  assert.match(planningApp, /event\.preventDefault\(\);\s*\n\s*event\.stopPropagation\(\);\s*\n\s*startQueueMove/);
  assert.match(planningApp, /event\.preventDefault\(\);\s*\n\s*event\.stopPropagation\(\);\s*\n\s*reorderSelectedJobs\(state\.queueMoveOt, button\.dataset\.placeQueueOt\)/);
  assert.match(planningStyles, /\.queue-move-actions \{ position: absolute; right: 10px; bottom: 10px;/);
  assert.match(planningApp, /function canReorderSelectedJobs\(sourceOt, targetOt, options = \{\}\)/);
  assert.doesNotMatch(planningApp, /<span>Cantidad<\/span><strong>\$\{escapeHtml\(quantityLabel\)\}<\/strong>/);
  assert.doesNotMatch(planningApp, /Los datos comerciales se guardan por articulo/);
  assert.doesNotMatch(planningApp, /Una asignacion para toda la orden/);
  assert.doesNotMatch(planningApp, /<span>CT \$\{escapeHtml\(op\.ct\)\}<\/span>/);
});

test("el boton devuelve a backlog solo trabajos no bloqueados con confirmacion", async () => {
  const planningApp = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");
  const planningTemplate = await readFile(new URL("../src/web/planning/index.template.html", import.meta.url), "utf8");
  const start = planningApp.indexOf("function returnUnlockedJobsToBacklog()");
  const end = planningApp.indexOf("function reorderSelectedJobs(", start);
  const source = planningApp.slice(start, end);
  const createHandler = (state, options = {}) => {
    const calls = { confirm: 0, checkpoint: 0, tombstones: [], invalidate: 0, priorities: 0, list: 0, queue: 0, gantt: 0, save: 0, toasts: [] };
    const handler = Function(
      "state", "window", "isProgrammedJobStatus", "jobStatusForOt", "showToast", "checkpointState",
      "rememberDraftRemovedOts", "invalidatePriorityJobsCache", "applyQueuePriorities", "renderPriorityList", "renderPriorityQueue", "renderGantt", "saveState",
      `${source}; return returnUnlockedJobsToBacklog;`,
    )(
      state,
      {
        confirm(message) { calls.confirm += 1; calls.confirmMessage = message; return options.confirm !== false; },
        PlanningWorkflowCore: {
          canRemoveSelectedOt(current, ot) {
            return (current.lockedOts || []).includes(ot)
              ? { allowed: false, reason: "Desbloquea la OT antes de retirarla del plan" }
              : { allowed: true, reason: "" };
          },
          removeOtFromDraft(current, ot) {
            const keep = (items) => (items || []).filter((item) => item !== ot);
            const preparedPlanningByOt = { ...(current.preparedPlanningByOt || {}) };
            delete preparedPlanningByOt[ot];
            return { ...current, selectedOts: keep(current.selectedOts), lockedOts: keep(current.lockedOts), preparedPlanningByOt };
          },
        },
      },
      (status) => String(status || "").toUpperCase() === "PROGRAMADO",
      (ot) => options.programmedOts?.includes(ot) ? "PROGRAMADO" : "PENDIENTE",
      (message) => calls.toasts.push(message),
      () => { calls.checkpoint += 1; },
      (ots) => { calls.tombstones.push(...ots); },
      () => { calls.invalidate += 1; },
      () => { calls.priorities += 1; },
      () => { calls.list += 1; },
      () => { calls.queue += 1; },
      () => { calls.gantt += 1; },
      () => { calls.save += 1; },
    );
    return { handler, calls };
  };

  assert.match(planningTemplate, /id="returnUnlockedToBacklogBtn"/);
  assert.match(planningApp, /returnUnlockedToBacklogBtn\.addEventListener\("click", returnUnlockedJobsToBacklog\)/);

  const state = { selectedOts: ["100", "200", "300"], lockedOts: ["200"], preparedPlanningByOt: { 100: "a", 200: "b", 300: "c" } };
  const { handler, calls } = createHandler(state);
  handler();
  assert.equal(calls.confirmMessage, "esta seguro de enviar todos los trabajos no bloqueados a backlog?");
  assert.deepEqual(state.selectedOts, ["200"]);
  assert.deepEqual(state.lockedOts, ["200"]);
  assert.deepEqual(state.preparedPlanningByOt, { 200: "b" });
  assert.deepEqual(calls.tombstones, ["100", "300"]);
  assert.equal(calls.save, 1);
  assert.equal(calls.toasts.at(-1), "2 trabajos devueltos al backlog");

  const cancelled = { selectedOts: ["100", "200"], lockedOts: ["200"] };
  const cancelledFlow = createHandler(cancelled, { confirm: false });
  cancelledFlow.handler();
  assert.deepEqual(cancelled.selectedOts, ["100", "200"]);
  assert.equal(cancelledFlow.calls.confirm, 1);
  assert.equal(cancelledFlow.calls.save, 0);

  const none = { selectedOts: ["200", "300"], lockedOts: ["200"] };
  const noneFlow = createHandler(none, { programmedOts: ["300"] });
  noneFlow.handler();
  assert.equal(noneFlow.calls.confirm, 0);
  assert.equal(noneFlow.calls.save, 0);
  assert.equal(noneFlow.calls.toasts.at(-1), "No hay trabajos no bloqueados para enviar a backlog");
});

test("la configuracion de flujo expone controles y diagnostico sin render global", async () => {
  const planningApp = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");
  const planningTemplate = await readFile(new URL("../src/web/planning/index.template.html", import.meta.url), "utf8");
  const flowEventSource = planningApp.slice(
    planningApp.indexOf('els.flowBalancedEnabledInput.addEventListener("change"'),
    planningApp.indexOf("els.closeDetailPanelBtn.addEventListener", planningApp.indexOf('els.flowBalancedEnabledInput.addEventListener("change"')),
  );

  assert.match(planningTemplate, /id="flowBalancedEnabledInput"/);
  assert.match(planningTemplate, /id="flowWipTargetInput"[^>]*min="1"[^>]*max="50"/);
  assert.match(planningTemplate, /id="flowOptimizationDiagnostics"/);
  assert.match(planningApp, /flowBalancedEnabled:\s*true/);
  assert.match(planningApp, /flowWipTarget:\s*10/);
  assert.match(planningApp, /state\.settings\.flowBalancedEnabled\s*=\s*state\.settings\.flowBalancedEnabled\s*!==\s*false/);
  assert.match(planningApp, /state\.settings\.flowWipTarget\s*=\s*Number\.isFinite\(flowWipTarget\)/);
  assert.match(flowEventSource, /renderFlowBalanceConfiguration\(\)/);
  assert.doesNotMatch(flowEventSource, /saveAndRender\(/);
  assert.match(planningApp, /Flujo promedio/);
  assert.match(planningApp, /WIP maximo/);
  assert.match(planningApp, /Huecos evitables/);
  assert.match(planningApp, /Cambios de herramental/);
  assert.match(planningApp, /Utilizacion/);
  assert.match(planningApp, /Estrategia:/);
});

test("dry-run de rendimiento de planeacion esta expuesto y no persiste resultados", async () => {
  const planningApp = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");
  const dryRunStart = planningApp.indexOf("async function dryRunCurrentPlanPerformance(options = {})");
  const dryRunEnd = planningApp.indexOf("function dryRunNowMs()", dryRunStart);
  const dryRunSource = planningApp.slice(dryRunStart, dryRunEnd);
  const scheduleStart = planningApp.indexOf("async function scheduleCurrentPlanImpl()");
  const scheduleEnd = planningApp.indexOf("async function dryRunCurrentPlanPerformance()", scheduleStart);
  const scheduleSource = planningApp.slice(scheduleStart, scheduleEnd);

  assert.match(planningApp, /window\.runPlanningPerformanceDryRun\s*=\s*dryRunCurrentPlanPerformance/);
  assert.match(dryRunSource, /console\.table\(metrics\)/);
  assert.match(dryRunSource, /console\.info\("\[planning dry-run\]", result\)/);
  assert.match(dryRunSource, /dryRunOptions/);
  assert.match(planningApp, /PLANNING_DRY_RUN_DEFAULT_TIMEOUT_MS\s*=\s*60000/);
  assert.match(dryRunSource, /configuredTimeoutMs/);
  assert.match(dryRunSource, /plannerOptions\.timeBudgetMs\s*=\s*configuredTimeoutMs/);
  assert.match(dryRunSource, /skipScheduler/);
  assert.match(dryRunSource, /profileOnly/);
  assert.match(dryRunSource, /SCHEDULER_SKIPPED/);
  assert.match(dryRunSource, /yieldToBrowser/);
  assert.match(dryRunSource, /await yieldToBrowser\(\)/);
  assert.match(dryRunSource, /timeBudgetMs/);
  assert.match(dryRunSource, /collectStats/);
  assert.match(dryRunSource, /progressEveryMs/);
  assert.match(dryRunSource, /lastPhase/);
  assert.match(dryRunSource, /startedAt/);
  assert.match(dryRunSource, /elapsedMs/);
  assert.match(dryRunSource, /aborted/);
  assert.match(dryRunSource, /TIME_BUDGET_EXCEEDED/);
  assert.match(dryRunSource, /markPhase\("incremental-base"/);
  assert.match(dryRunSource, /markPhase\("readiness"/);
  assert.match(dryRunSource, /markPhase\("prepare-draft"/);
  assert.match(dryRunSource, /markPhase\("scheduler-start"/);
  assert.match(dryRunSource, /markPhase\("scheduler-end"/);
  assert.match(dryRunSource, /selectedOtsCount/);
  assert.match(dryRunSource, /engineSelectedOtsCount/);
  assert.match(dryRunSource, /affectedOtsCount/);
  assert.match(dryRunSource, /readyOtsCount/);
  assert.match(dryRunSource, /lockedOtsCount/);
  assert.match(dryRunSource, /closedKeptCount/);
  assert.match(dryRunSource, /inputOperationsCount/);
  assert.match(dryRunSource, /includedOperationsCount/);
  assert.match(dryRunSource, /scheduledOperationsCount/);
  assert.match(dryRunSource, /unscheduledOperationsCount/);
  assert.match(dryRunSource, /scheduledOtsCount/);
  assert.match(dryRunSource, /unscheduledOtsCount/);
  assert.match(dryRunSource, /diagnosticsCount/);
  assert.match(dryRunSource, /diagnosticsByCode/);
  assert.match(dryRunSource, /selectedStrategy/);
  assert.match(dryRunSource, /planStart/);
  assert.match(dryRunSource, /horizonDays/);
  assert.match(dryRunSource, /incrementalBaseSnapshotId/);
  assert.match(dryRunSource, /totalMs/);
  assert.match(dryRunSource, /incrementalBaseMs/);
  assert.match(dryRunSource, /readinessMs/);
  assert.match(dryRunSource, /prepareDraftMs/);
  assert.match(dryRunSource, /schedulePlanMs/);
  assert.match(dryRunSource, /resultBuildMs/);
  assert.match(dryRunSource, /plannerStrategiesStarted/);
  assert.match(dryRunSource, /plannerMainLoopIterations/);
  assert.match(dryRunSource, /plannerFindBestAssignmentCalls/);
  assert.match(dryRunSource, /plannerAssignmentCandidateEvaluations/);
  assert.match(dryRunSource, /plannerSlotProbes/);
  assert.match(dryRunSource, /plannerBusyConflictScans/);
  assert.match(dryRunSource, /plannerBusySegmentSorts/);
  assert.match(dryRunSource, /plannerToolCatalogLookups/);
  assert.match(dryRunSource, /plannerOtConfigurationLookups/);
  assert.doesNotMatch(dryRunSource, /\bsaveState\s*\(/);
  assert.doesNotMatch(dryRunSource, /\bqueueAppSheetSave\s*\(/);
  assert.doesNotMatch(dryRunSource, /\bpersistPlanSnapshot\s*\(/);
  assert.doesNotMatch(dryRunSource, /\bsaveDraftSnapshot\s*\(/);
  assert.doesNotMatch(dryRunSource, /\bsaveAndRender\s*\(/);
  assert.doesNotMatch(dryRunSource, /\brender\s*\(/);
  assert.doesNotMatch(dryRunSource, /\bensurePlanningDataLoaded\s*\(/);
  assert.match(scheduleSource, /saveAndRender\(`\$\{summary\.scheduled \|\| 0\} programadas/);
  assert.match(scheduleSource, /persistPlanSnapshot\(\)/);
  assert.match(scheduleSource, /state = \{ \.\.\.result, selectedOts: originalSelectedOts \}/);
});

test("todos los workflows usan acciones compatibles con Node.js 24", async () => {
  const workflowNames = ["ci.yml", "deploy-appscript.yml", "deploy-pages.yml", "npm-publish-github-packages.yml"];
  const workflows = await Promise.all(workflowNames.map((name) =>
    readFile(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8")
  ));
  const expectedActionCounts = [1, 1, 1, 2];
  for (const [index, workflow] of workflows.entries()) {
    assert.equal((workflow.match(/actions\/checkout@v6\b/g) || []).length, expectedActionCounts[index], `${workflowNames[index]} debe usar actions/checkout@v6`);
    assert.equal((workflow.match(/actions\/setup-node@v6\b/g) || []).length, expectedActionCounts[index], `${workflowNames[index]} debe usar actions/setup-node@v6`);
  }
  assert.match(workflows[2], /actions\/configure-pages@v6\b/);
  assert.match(workflows[2], /actions\/upload-pages-artifact@v5\b/);
  assert.match(workflows[2], /actions\/deploy-pages@v5\b/);
});

test("el build genera Apps Script y GitHub Pages", async () => {
  const result = await buildProject();
  assert.deepEqual(result.htmlFiles, ["Index.html", "IndexOperator.html", "IndexSkills.html", "Bridge.html"]);
  assert.deepEqual(result.pagesFiles, ["index.html", "operator.html", "skills.html", "manifest.webmanifest", "sw.js"]);
  const index = await readFile(path.join(result.distDir, "Index.html"), "utf8");
  const performanceService = await readFile(path.join(result.distDir, "15-performance-service.js"), "utf8");
  const inspectionService = await readFile(path.join(result.distDir, "16-inspection-service.js"), "utf8");
  const inspectionDrawingService = await readFile(path.join(result.distDir, "17-inspection-drawing-service.js"), "utf8");
  const planningWorkOrderService = await readFile(path.join(result.distDir, "18-planning-work-order-service.js"), "utf8");
  const storageService = await readFile(path.join(result.distDir, "02-storage.js"), "utf8");
  const codeService = await readFile(path.join(result.distDir, "01-code.js"), "utf8");
  const bridge = await readFile(path.join(result.distDir, "Bridge.html"), "utf8");
  const appScriptWorkflow = await readFile(path.join(process.cwd(), ".github/workflows/deploy-appscript.yml"), "utf8");
  const claspConfig = JSON.parse(await readFile(path.join(process.cwd(), ".clasp.json"), "utf8"));
  assert.equal(claspConfig.rootDir, "dist");
  assert.equal(claspConfig.scriptId, "1HFWb7JgrmhUb6bp8W-cztQHnQgFYX7-4K3d0nqen-008lqdnD1amb3l_");
  assert.match(index, /<title>Planeacion de Produccion<\/title>/);
  assert.match(index, /google\.script\.run/);
  assert.match(index, /PPAppsScriptBridge/);
  assert.match(index, /getAppState/);
  assert.match(index, /savePlanningStateOptimized/);
  assert.match(codeService, /function saveWorkOrderSyncState\(payload\)/);
  assert.match(performanceService, /function getAppStateIfChanged\(clientRevision, options\)/);
  assert.match(performanceService, /knownRevision > 0 && knownRevision === metadata\.revision[\s\S]*unchanged: true/);
  assert.match(bridge, /getAppStateIfChanged: true/);
  assert.match(bridge, /saveOperationPlanStatus: true/);
  assert.match(bridge, /saveWorkOrderSyncState: true/);
  assert.match(bridge, /getPlanningWorkOrderData: true/);
  assert.match(planningWorkOrderService, /function getPlanningWorkOrderData\(ot\)/);
  assert.match(appScriptWorkflow, /clasp deploy --deploymentId/);
  assert.match(appScriptWorkflow, /CLASPRC_JSON no esta configurado/);
  assert.match(appScriptWorkflow, /CLASP_JSON no esta configurado/);
  assert.match(appScriptWorkflow, /config\.rootDir = 'dist'/);
  assert.match(appScriptWorkflow, /EXPECTED_SCRIPT_ID/);
  assert.match(appScriptWorkflow, /1HFWb7JgrmhUb6bp8W-cztQHnQgFYX7-4K3d0nqen-008lqdnD1amb3l_/);
  assert.match(appScriptWorkflow, /1ew3Nqi0e8SHid_zWv1z5cl6ATCZzqVLqc2lkbfox5CMNsh8FH5tL8zKx/);
  assert.match(appScriptWorkflow, /\^AKfy/);
  assert.match(appScriptWorkflow, /error title=clasp push/);
  assert.match(appScriptWorkflow, /JSON\.parse\(fs\.readFileSync/);
  const pagesIndex = await readFile(path.join(result.siteDir, "index.html"), "utf8");
  const serviceWorker = await readFile(path.join(result.siteDir, "sw.js"), "utf8");
  assert.match(serviceWorker, /const CACHE_NAME = "plan-maestro-[a-f0-9]{12}";/);
  assert.doesNotMatch(serviceWorker, /plan-maestro-v2\.41\.4/);
  assert.match(pagesIndex, /script\.google\.com\/macros\/s\//);
  assert.match(pagesIndex, /manifest\.webmanifest/);
  assert.match(pagesIndex, /serviceWorker\.register/);
  assert.match(pagesIndex, /PlannerCore/);
  assert.match(pagesIndex, /PlanningWorkflowCore/);
  assert.match(pagesIndex, /state\.planStart = formatDate\(parseDateOnlyValue\(state\.planStart\) \|\| new Date\(\)\)/);
  assert.match(pagesIndex, /loadIncrementalPlanningBase\(planningWeekStart\)/);
  assert.match(pagesIndex, /respectPlanStart: true/);
  const planWindowSource = pagesIndex.slice(pagesIndex.indexOf("function getPlanWindow()"), pagesIndex.indexOf("function scheduledPlanWindowStart()"));
  assert.match(planWindowSource, /const configured = parseDate\(state\.planStart\)/);
  assert.doesNotMatch(planWindowSource, /scheduledPlanWindowStart\(\)/);
  assert.match(pagesIndex, /incrementalScope\(\{ base: incrementalBase, current: state/);
  assert.match(pagesIndex, /PlanningWorkflowCore\.weeklyFinishingCost\(finishingRows\)/);
  assert.match(pagesIndex, /function formatReportDuration\(minutes\)[\s\S]*min[\s\S]*s/);
  assert.match(pagesIndex, /function formatReportDate\(date\)[\s\S]*\$\{d\}\/\$\{m\}\/\$\{y\}/);
  assert.match(pagesIndex, /function resetDailyReportFiltersToToday\(\)[\s\S]*const today = formatDate\(new Date\(\)\)[\s\S]*operator[\s\S]*adjuster[\s\S]*subcontract/);
  assert.match(pagesIndex, /function initializePlanningApp\(\)[\s\S]*resetDailyReportFiltersToToday\(\)[\s\S]*render\(\)/);
  const dailyReportFilterSource = pagesIndex.slice(pagesIndex.indexOf("function filteredReportRows("), pagesIndex.indexOf("function renderReportFilterStatus("));
  assert.match(dailyReportFilterSource, /value && value <= range\.end/);
  assert.doesNotMatch(dailyReportFilterSource, /value >= range\.start/);
  assert.match(pagesIndex, /operatorPrintContext\.textContent = formatReportDateTime\(new Date\(\)\)/);
  assert.match(pagesIndex, /adjusterPrintContext\.textContent = formatReportDateTime\(new Date\(\)\)/);
  assert.match(pagesIndex, /subcontractPrintContext\.textContent = formatReportDateTime\(new Date\(\)\)/);
  assert.match(pagesIndex, /<td>\$\{formatReportDuration\(op\.tiempoCiclo\)\}<\/td>[\s\S]*<td>\$\{formatReportDuration\(op\.tiempoSetup\)\}<\/td>[\s\S]*<td>\$\{formatReportDuration\(scheduledProductionMinutesForExport\(op\)\)\}<\/td>/);
  assert.match(pagesIndex, /@media print[\s\S]*\.report-comment-input::placeholder\s*\{[^}]*opacity:\s*0/);
  assert.match(pagesIndex, /@media print[\s\S]*\.production-report-table th:nth-child\(1\)[\s\S]*width:\s*8mm/);
  assert.match(pagesIndex, /formatCurrency\(window\.PlanningWorkflowCore\.effectiveFinishingAmount\(row\)\)/);
  assert.match(pagesIndex, /return window\.PlanningWorkflowCore\.weeklyFinishingRowsByType\(rows\);/);
  assert.match(pagesIndex, /const finishingRows = summary\.finishes \|\| \[\];/);
  assert.doesNotMatch(pagesIndex, /const startingRows = summary\.starts \|\| \[\];/);
  assert.doesNotMatch(pagesIndex, /Number\(row\.amount \|\| 0\)/);
  assert.match(pagesIndex, /Number\.isFinite\(amountNumber\)/);
  assert.match(pagesIndex, /Number\.isFinite\(unitPriceNumber\)/);
  assert.match(pagesIndex, /Number\.isFinite\(pendingPiecesValue\)/);
  assert.match(pagesIndex, /window\.PlanningWorkflowCore = api/);
  assert.doesNotMatch(pagesIndex, /const window = getPlanWindow\(\);[\s\S]{0,1800}window\.PlanningWorkflowCore\.isActiveGanttView/);
  assert.doesNotMatch(pagesIndex, /createPlanningWorkflowCore[\s\S]*?<\/script>\s*<script>\s*"use strict";\s*const STORAGE_KEY/);
  assert.match(pagesIndex, /scheduleCurrentPlan/);
  assert.match(pagesIndex, /NETSUITE_PLANNING_TIMEOUT_MS = 15000/);
  assert.match(pagesIndex, /PlanningWorkflowCore\.withTimeout/);
  assert.match(pagesIndex, /const removal = window\.PlanningWorkflowCore\.canRemoveSelectedOt\(state, ot\);[\s\S]{0,180}if \(!removal\.allowed\)[\s\S]{0,180}showToast\(removal\.reason\)/);
  assert.match(pagesIndex, /if \(!selected && alreadySelected\) \{\s*Object\.assign\(state, window\.PlanningWorkflowCore\.removeOtFromDraft\(state, ot\)\);\s*if \(typeof rememberDraftRemovedOts === "function"\) rememberDraftRemovedOts\(\[ot\]\);\s*\}/);
  assert.match(pagesIndex, /prepareDraftForReschedule/);
  assert.match(pagesIndex, /const engineSelectedOts = window\.PlanningWorkflowCore\.schedulingSelectedOts\(state, closedOts\);[\s\S]{0,1200}PlannerCore\.schedulePlan\(\{ \.\.\.state, selectedOts: engineSelectedOts \}, \{/);
  assert.match(pagesIndex, /state = \{ \.\.\.result, selectedOts: originalSelectedOts \};/);
  assert.match(pagesIndex, /NetSuite no respondio; se programara con los datos ya cargados/);
  assert.match(pagesIndex, /originalEnsurePlanningDataLoaded\(showMessage, options\)/);
  assert.match(pagesIndex, /return \{ ready: true, source: "fresh", readyOts: selectedOts, missingOts: \[\], warning: "" \}/);
  assert.match(pagesIndex, /netSuiteSyncOutcome/);
  assert.match(pagesIndex, /subcontractWindowEnd/);
  assert.match(pagesIndex, /name="ot_manual_price" type="number" min="0"/);
  assert.match(pagesIndex, /function planningPreparationTitle\(job\)/);
  assert.match(pagesIndex, /const description = String\(job\?\.descripcion \|\| workOrderForOt\(ot\)\?\.description \|\| ""\)\.trim\(\);/);
  assert.match(pagesIndex, /const detail = \[article, description, quantity \? `\$\{formatMaterialQuantity\(quantity\)\} pzas` : ""\]\.filter\(Boolean\)\.join\(" - "\);/);
  assert.match(pagesIndex, /name="tool_\$\{escapeHtml\(index\)\}_extra_machine_\$\{escapeHtml\(extraIndex\)\}"/);
  assert.match(pagesIndex, /data-job-tool-extra-machine/);
  assert.doesNotMatch(pagesIndex, /Piezas pendientes/);
  assert.doesNotMatch(pagesIndex, /Monto estimado/);
  assert.match(pagesIndex, /configuration\.subcontractType \|\| registeredSubcontract/);
  assert.match(pagesIndex, /configuration\.machine/);
  assert.match(storageService, /CONFIGURACION_OT:\s*\['OT', 'MAQUINA', 'KIT_HERRAMENTAL'[\s\S]*'ACTUALIZADO', 'HERRAMENTAL', 'HERRAMENTALES_EXTRA_JSON'\]/);
  assert.match(storageService, /PP_additionalToolList_\(item\.additionalHerramentales \|\| item\.herramentalesExtra \|\| \[\]\)/);
  assert.match(storageService, /herramental:\s*String\(row\.HERRAMENTAL \|\| ''\)\.trim\(\)/);
  assert.match(storageService, /preparedPlanningByOt:\s*config\.preparedPlanningByOt \|\| \{\}/);
  assert.match(storageService, /\['preparedPlanningByOt', JSON\.stringify\(payload\.preparedPlanningByOt \|\| \{\}\)\]/);
  assert.match(performanceService, /preparedPlanningByOt:\s*payload\.preparedPlanningByOt \|\| \{\}/);
  assert.match(performanceService, /CONFIGURACION_ARTICULO[\s\S]{0,180}PP_articleConfigurationRows_\(payload\)/);
  assert.match(pagesIndex, /preparedPlanningByOt:\s*clone\(state\.preparedPlanningByOt \|\| \{\}\)/);
  assert.match(pagesIndex, /articleConfigurations:\s*clone\(state\.articleConfigurations \|\| \{\}\)/);
  assert.match(pagesIndex, /if \(imported\.preparedPlanningByOt\) state\.preparedPlanningByOt = imported\.preparedPlanningByOt;/);
  assert.match(pagesIndex, /function setPlanningActionsBusy/);
  assert.match(pagesIndex, /setPlanningActionsBusy\("schedule", true\)/);
  assert.match(pagesIndex, /setPlanningActionsBusy\("sync", true\)/);
  assert.match(pagesIndex, /id="syncBacklogOtsBtn"[^>]*>Sincronizar OTs<\/button>/);
  assert.match(pagesIndex, /async function syncBacklogWorkOrders\(\)/);
  assert.match(pagesIndex, /const NETSUITE_BACKLOG_SYNC_TIMEOUT_MS = 60000;/);
  assert.match(pagesIndex, /PlanningWorkflowCore\.reconcileActiveWorkOrders\(state, payload\.workOrders, nowIso\)/);
  assert.match(pagesIndex, /PlanningWorkflowCore\.purgeClosedWorkOrderRetention\(/);
  assert.match(pagesIndex, /setBacklogSyncInFlight\(true\)/);
  assert.match(pagesIndex, /setBacklogSyncInFlight\(false\)/);
  assert.match(pagesIndex, /id="restoreDraftBtn"[^>]*>Restaurar borrador<\/button>/);
  assert.equal((pagesIndex.match(/id="restoreDraftBtn"/g) || []).length, 1);
  assert.match(pagesIndex, /async function openRestoreDraftDialog\(\)/);
  assert.match(pagesIndex, /async function previewDraftRestore\(snapshotId, syncBeforeRestore\)/);
  assert.match(pagesIndex, /async function confirmDraftRestore\(snapshotId, previewState\)/);
  assert.match(pagesIndex, /PlanningWorkflowCore\.reconcilePublishedPlan\(snapshot, previewState\)/);
  assert.match(pagesIndex, /restoredOts[\s\S]*closedOts[\s\S]*completedOperations[\s\S]*removedOperations[\s\S]*newOperations[\s\S]*preservedConfigurations/);
  assert.match(pagesIndex, /Sincronizar antes de restaurar/);
  assert.match(pagesIndex, /Continuar con datos cargados/);
  assert.match(pagesIndex, /reemplaza el borrador[\s\S]*conserva un respaldo[\s\S]*publicado permanece intacto/i);
  assert.match(pagesIndex, /setPlanningActionsBusy\("restore", true\)/);
  assert.match(pagesIndex, /setPlanningActionsBusy\("restore", false\)/);
  assert.match(pagesIndex, /callAppsScript\("restorePublishedPlanAsDraft", snapshotId, previewState\)/);
  assert.match(pagesIndex, /reportSnapshot = null;[\s\S]*Borrador restaurado; revisa y genera nuevamente el plan/);
  const restoreOpenSource = pagesIndex.slice(pagesIndex.indexOf("async function openRestoreDraftDialog()"), pagesIndex.indexOf("async function previewDraftRestore("));
  const restorePreviewSource = pagesIndex.slice(pagesIndex.indexOf("async function previewDraftRestore("), pagesIndex.indexOf("async function confirmDraftRestore("));
  const restoreReadOnlySyncSource = pagesIndex.slice(pagesIndex.indexOf("async function refreshRestorePreviewData("), pagesIndex.indexOf("async function previewDraftRestore("));
  const restoreConfirmSource = pagesIndex.slice(pagesIndex.indexOf("async function confirmDraftRestore("), pagesIndex.indexOf("async function loadPlanSnapshots("));
  [restoreOpenSource, restorePreviewSource, restoreConfirmSource].forEach((source) => {
    assert.match(source, /netSuiteSyncInFlight \|\| netSuitePlanningSyncInFlight/);
  });
  assert.match(restorePreviewSource, /if \(outcome\?\.status !== "complete"\)[\s\S]*Continuar con datos cargados[\s\S]*if \(!continueWithLoaded\) return/);
  assert.doesNotMatch(restorePreviewSource, /outcome\?\.ready/);
  assert.match(restoreReadOnlySyncSource, /callAppsScript\("fetchNetSuiteWorkOrdersLite"\)/);
  assert.doesNotMatch(restoreReadOnlySyncSource, /syncNetSuitePlanningData|saveState|savePlanningStateOptimized|persistPlanSnapshot|render\(/);
  assert.doesNotMatch(restorePreviewSource, /syncNetSuiteTwoPhase|syncNetSuitePlanningData|saveState/);
  assert.match(restorePreviewSource, /let previewState = createAppSheetPayload\(\);/);
  assert.doesNotMatch(restorePreviewSource, /\bstate\s*=/);
  assert.match(restorePreviewSource, /confirmDraftRestore\(snapshotId, previewState\)/);
  assert.match(pagesIndex, /function refreshPlanningActionControls\(\)[\s\S]*planningActionsBusy \|\| netSuiteSyncInFlight \|\| netSuitePlanningSyncInFlight[\s\S]*setPlanningControlBusy\(els\.restoreDraftBtn, busy\)/);
  assert.match(pagesIndex, /function setNetSuiteSyncState\(inProgress\)[\s\S]*refreshPlanningActionControls\(\)/);
  assert.ok(restoreConfirmSource.indexOf("await loadPlanSnapshots(false)") < restoreConfirmSource.indexOf("reportSnapshot = null"));
  assert.match(restoreConfirmSource, /showWorkspaceView\("plan-semanal", "", \{ scrollToTop: true \}\)/);
  assert.match(pagesIndex, /Cantidad diferente en NetSuite/);
  assert.match(pagesIndex, /Cerrada o no encontrada en NetSuite/);
  const backlogSyncSource = pagesIndex.slice(
    pagesIndex.indexOf("async function syncBacklogWorkOrders()"),
    pagesIndex.indexOf("async function syncNetSuiteTwoPhase(options = {})"),
  );
  assert.match(backlogSyncSource, /callAppsScript\("fetchNetSuiteWorkOrdersLite"\)/);
  assert.match(backlogSyncSource, /NETSUITE_BACKLOG_SYNC_TIMEOUT_MS/);
  assert.match(backlogSyncSource, /callAppsScript\("saveWorkOrderSyncState", syncPayload\)/);
  assert.doesNotMatch(backlogSyncSource, /saveAppState|createAppSheetPayload\(nextState\)/);
  assert.doesNotMatch(backlogSyncSource, /openPlanningDialog|compareWorkOrderLite|applyConfirmedWorkOrderChanges|persistPlanSnapshot/);
  assert.doesNotMatch(backlogSyncSource, /syncNetSuitePlanningData|syncNetSuitePlant|syncNetSuiteWorkOrders|fetchNetSuiteWorkOrdersLiteCompat/);
  assert.doesNotMatch(pagesIndex, /function fetchNetSuiteWorkOrdersLiteCompat/);
  assert.doesNotMatch(pagesIndex, /id="balanceBtn"/);
  assert.doesNotMatch(pagesIndex, /els\.balanceBtn\.addEventListener/);
  assert.match(pagesIndex, /if \(isSubcontractAppOperation\(op\)\) requirement\.codes\.add\("OT_SUBCONTRACT"\)/);
  assert.match(pagesIndex, /if \(window\.PlannerCore\?\.isBendingOperation\?\.\(op\)\)[\s\S]*requirement\.codes\.add\("OT_TOOL"\)[\s\S]*requirement\.codes\.add\("OPTIONAL_KIT"\)/);
  assert.match(pagesIndex, /const result = await openPlanningDialog\([\s\S]*confirmLabel: "Ir a matriz"[\s\S]*if \(result\) showWorkspaceView\("matriz", "", \{ scrollToTop: true \}\)/);
  const builtStartupSource = pagesIndex.slice(
    pagesIndex.indexOf("async function loadAppStateInBackground()"),
    pagesIndex.indexOf("async function restoreDraftPlanFromSharedState()"),
  );
  assert.ok(
    builtStartupSource.indexOf("await restoreDraftPlanFromSharedState()") < builtStartupSource.indexOf("purgeClosedWorkOrderRetention()"),
    "la purga debe ejecutarse despues de restaurar el borrador compartido",
  );
  const startupState = { operations: [] };
  let operationsSeenByPurge = [];
  const workspaceOptions = [];
  const generatedStartup = Function(
    "state", "loadAppSheetIfAvailable", "requestAnimationFrame", "loadPlanSnapshots", "restoreDraftPlanFromSharedState",
    "purgeClosedWorkOrderRetention", "resetDailyReportFiltersToToday", "saveState", "render", "applyInitialWorkspaceView",
    "showToast", "isAppsScriptRuntime", "syncNetSuiteInBackground",
    `${builtStartupSource}; return loadAppStateInBackground;`,
  )(
    startupState, async () => true, (callback) => callback(), async () => {},
    async () => { startupState.operations = [{ ot: "OT-CERRADA" }]; return true; },
    () => { operationsSeenByPurge = [...startupState.operations]; startupState.operations = []; },
    () => {}, () => {}, () => {}, (options) => workspaceOptions.push(options), () => {}, () => false, () => {},
  );
  await generatedStartup();
  assert.deepEqual(operationsSeenByPurge, [{ ot: "OT-CERRADA" }]);
  assert.deepEqual(workspaceOptions, [{ scrollToTop: false }]);
  assert.doesNotMatch(pagesIndex, /Plan Maestro de Producción — GitHub Pages \+ Google Apps Script/);
  assert.match(pagesIndex, /<option value="draft">Borrador<\/option>/);
  assert.match(pagesIndex, /function isReportSnapshotEditable\(\)/);
  assert.match(pagesIndex, /statusActions: isReportSnapshotEditable\(\)/);
  assert.match(pagesIndex, /if \(!isReportSnapshotEditable\(\)\) return escapeHtml/);
  assert.match(pagesIndex, /const mustConfirmPlanning =[^;]+\|\| commercial\.needsType \|\| commercial\.needsPlanningType;/);
  assert.doesNotMatch(pagesIndex, /machine === currentMachine \? " selected"/);
  assert.match(pagesIndex, /function confirmZeroManualPrice\(form\)[\s\S]*ot_manual_price[\s\S]*Number\(input\.value \|\| 0\)[\s\S]*Seguro que desea dejar el precio unitario en \$0\.00/);
  assert.match(pagesIndex, /if \(!confirmZeroManualPrice\(els\.planningDialogForm\)\) return;[\s\S]*closePlanningDialog/);
  assert.match(pagesIndex, /commercialPlanningRequirement\(job, \{ alwaysPlanningType: options\.forceConfirm === true \}\)/);
  assert.match(pagesIndex, /needsPlanningType: options\.alwaysPlanningType === true \|\| !planningType/);
  assert.match(pagesIndex, /class="article-temporary-price-input"/);
  assert.match(pagesIndex, /function updateTemporaryArticlePrice\(article, value\)/);
  assert.match(pagesIndex, /\.weekly-day-table \.weekly-row--prototype td/);
  assert.match(pagesIndex, /\.weekly-day-table \.weekly-row--expedited td/);
  assert.match(pagesIndex, /function printPlanHeader\(title\)/);
  assert.match(pagesIndex, /class="individual-print-header"/);
  assert.match(pagesIndex, /class="individual-print-logo">MALDONADO/);
  assert.match(pagesIndex, /class="individual-print-code">MP CD 28-02 V02/);
  assert.match(pagesIndex, /PLAN DE PRODUCCI(?:O|Ó)N DIARIO INDIVIDUAL/);
  assert.match(pagesIndex, /PLAN DE PRODUCCI(?:O|Ó)N SEMANAL/);
  assert.match(pagesIndex, /function prepareIndividualPrint\(target\)/);
  assert.match(pagesIndex, /querySelector\("\.individual-print-date"\)/);
  assert.match(pagesIndex, /document\.body\.classList\.add\("printing-individual-plan"\)/);
  assert.match(pagesIndex, /document\.body\.classList\.remove\("printing-individual-plan"\)/);
  assert.match(pagesIndex, /grid-template-columns:\s*1fr 2fr 1fr/);
  assert.match(pagesIndex, /body\.printing-individual-plan \.report-page-table th,[\s\S]*text-align:\s*center/);
  assert.match(pagesIndex, /body\.printing-individual-plan \.executive-summary[\s\S]*display:\s*none !important/);
  assert.match(pagesIndex, /if \(!commercial\.needsType && !commercial\.needsPlanningType\) continue/);
  assert.doesNotMatch(pagesIndex, /function balanceOperators\(\)/);
  assert.match(pagesIndex, /pdfBtn\.setAttribute\("aria-busy", "true"\)/);
  assert.match(pagesIndex, /@page \{ size: A4 landscape/);
  assert.match(pagesIndex, /function formatReportTime\(date\)/);
  assert.match(pagesIndex, /body\.printing-individual-plan \.report-status-action-column[\s\S]*display:\s*none/);
  assert.match(pagesIndex, /body\.printing-individual-plan \.report-page-table[\s\S]*width:\s*100%/);
  assert.equal((pagesIndex.match(/@page \{/g) || []).length, 1);
  assert.match(pagesIndex, /id="operatorReportFutureDays"/);
  assert.match(pagesIndex, /id="adjusterReportFutureDays"/);
  assert.match(pagesIndex, /id="subcontractReportFutureDays"/);
  assert.match(pagesIndex, /id="subcontractReportStatus"/);
  assert.match(pagesIndex, /reportCoverageDiagnostics\(reportOperationsSource\(\)\)/);
  assert.match(pagesIndex, /weekPrintContext\.textContent = formatReportDateTime\(new Date\(\)\)/);
  assert.match(pagesIndex, /await new Promise\(\(resolve\) => window\.setTimeout\(resolve, 50\)\);\s*window\.print\(\)/);
  assert.doesNotMatch(pagesIndex, /ReportShowAll/);
  assert.match(pagesIndex, /function setGanttView\(view\)/);
  assert.match(pagesIndex, /id="hoja-inspeccion"/);
  assert.match(pagesIndex, /id="inspectionPrintCheck"/);
  assert.match(pagesIndex, /id="inspectionSecondCapture"/);
  assert.match(pagesIndex, /id="inspectionReleaseFooter"/);
  assert.match(pagesIndex, /MP FO 08 V23/);
  assert.match(pagesIndex, /Fechas de entrega:/);
  assert.match(pagesIndex, /job\.dueDate/);
  assert.match(pagesIndex, /Tubo\/pzas/);
  assert.match(pagesIndex, /materialRow\(materials\[index\], materials\[index \+ 1\]/);
  assert.match(pagesIndex, /second\?\.route[\s\S]*second\?\.required/);
  assert.match(pagesIndex, />Hoja de inspección</);
  assert.match(pagesIndex, /Seleccionar operaciones/);
  assert.match(pagesIndex, /InspectionCore\.printableOperations/);
  assert.match(pagesIndex, /\.inspection-grid[^}]*grid-template-columns:\s*repeat\(24,\s*1fr\)/);
  assert.match(pagesIndex, /inspection-time-head/);
  assert.match(pagesIndex, /SETUP[\s\S]*INACTIVIDAD[\s\S]*PRODUCCI[^<]*/);
  assert.match(pagesIndex, /--inspection-print-scale/);
  assert.match(pagesIndex, /Math\.min\(1, widthRatio, heightRatio\)/);
  assert.match(pagesIndex, /addEventListener\("afterprint"/);
  assert.match(pagesIndex, /call\("getInspectionWorkOrderBundle", task\.wo/);
  assert.doesNotMatch(pagesIndex, /call\("getInspectionWorkOrder", wo\)/);
  assert.doesNotMatch(pagesIndex, /call\("getInspectionDrawingRoutes"/);
  assert.doesNotMatch(pagesIndex, /call\("getInspectionHistory"/);
  assert.match(pagesIndex, /id="inspectionRouteCatalogSearch"/);
  assert.match(pagesIndex, /id="inspectionRouteCatalogTable"/);
  assert.match(pagesIndex, /id="inspectionRouteCatalogError"[^>]*role="alert"[^>]*hidden/);
  assert.match(pagesIndex, /id="retryInspectionRouteCatalogBtn"[^>]*>Reintentar</);
  assert.match(pagesIndex, /callAppsScript\("getInspectionDrawingRoutes", ""\)/);
  assert.match(pagesIndex, /function editInspectionRouteCatalogRow\(index/);
  assert.match(pagesIndex, /InspectionCore\.inspectionRouteSavePayload\(row,/);
  assert.match(pagesIndex, /callAppsScript\("saveInspectionLink", payload\)/);
  const inspectionRouteEditorSource = pagesIndex.slice(
    pagesIndex.indexOf("async function editInspectionRouteCatalogRow("),
    pagesIndex.indexOf("function renderWeeklyReleaseTarget("),
  );
  assert.match(inspectionRouteEditorSource, /submit:\s*async \(values\) =>/);
  assert.match(inspectionRouteEditorSource, /id="inspectionRouteDialogError" class="planning-error" role="alert" hidden/);
  assert.match(inspectionRouteEditorSource, /InspectionCore\.applyInspectionRouteSave\(/);
  assert.match(inspectionRouteEditorSource, /errorElement\.hidden = false;[\s\S]*return false;/);
  assert.doesNotMatch(inspectionRouteEditorSource, /while \(true\)/);
  assert.match(pagesIndex, /planningDialogConfirm\.disabled = true;[\s\S]*await submit\(values\)/);
  assert.match(pagesIndex, /state\.detail = bundle\.detail;[\s\S]*renderDetail\(\);[\s\S]*renderHistory\(bundle\.history/);
  assert.match(pagesIndex, /\["Tramos"[\s\S]*\["Dibujo"[\s\S]*\["Material"[\s\S]*\["Pendientes"/);
  assert.match(pagesIndex, /Total:[\s\S]*ltima impresi[^:]*:[\s\S]*Folio\/fecha:/);
  assert.match(pagesIndex, /inspection-check-pill/);
  assert.match(pagesIndex, /El dibujo se guarda por art[^<]*fabricado/);
  assert.match(pagesIndex, /inspection-action-icon/);
  assert.match(pagesIndex, /missingRoutes[\s\S]*root\.alert[\s\S]*editMaterialLink/);
  assert.match(pagesIndex, /diagnostic\.alerts[\s\S]*root\.confirm/);
  assert.match(pagesIndex, /No se pudo guardar el historial[\s\S]*root\.confirm/);
  assert.match(pagesIndex, /materials\.length <= 2[\s\S]*materialRow\(\{\}, \{\}/);
  for (const footerHeading of ["Oper", "Cantidad NC", "Clave", "FTY", "SELLO LIBERACI", "OBSERVACIONES", "ENTREGA", "CANT.", "RECIBE"]) {
    assert.match(pagesIndex, new RegExp(footerHeading));
  }
  assert.match(pagesIndex, /N[^<]*<br>OPER/);
  assert.match(pagesIndex, /footerCell\(6, "", "inspection-seal-box inspection-br", 3\)/);
  assert.match(pagesIndex, /for \(let row = 0; row < 3; row \+= 1\)/);
  assert.match(pagesIndex, /\.inspection-actions \.primary\s*\{[^}]*grid-column:\s*auto/);
  assert.match(pagesIndex, /\.inspection-actions \.secondary\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
  assert.match(pagesIndex, /id="inspectionReload"[\s\S]*id="inspectionDrawing"[\s\S]*id="inspectionEditLink"[\s\S]*id="inspectionPrint"[\s\S]*id="inspectionSelectOps"/);
  assert.match(pagesIndex, /function initializePlanningApp\(\)\s*\{[\s\S]*applyInitialWorkspaceView\(\);[\s\S]*loadAppStateInBackground\(\);/);
  const optimizedStartupSource = pagesIndex.slice(
    pagesIndex.indexOf("async function loadInitialStateConditionally(localCache)"),
    pagesIndex.indexOf("const originalLoadPlanSnapshots =", pagesIndex.indexOf("async function loadInitialStateConditionally(localCache)")),
  );
  assert.match(optimizedStartupSource, /callAppsScript\("getAppStateIfChanged", revision, \{ includeMaterials: false \}\)/);
  assert.doesNotMatch(optimizedStartupSource, /loadPlanSnapshots|loadPlanSnapshotById|restoreDraftPlanFromSharedState/);
  const initialCacheCaptureIndex = pagesIndex.indexOf("const initialLocalCache = readUsableLocalStateCache(initialPerformanceMeta)");
  assert.ok(
    initialCacheCaptureIndex >= 0 &&
      initialCacheCaptureIndex < pagesIndex.indexOf("await root.PPAppsScriptBridge.ensureReady()"),
    "la cache inicial debe capturarse antes de esperar al bridge",
  );
  assert.match(optimizedStartupSource, /loadInitialStateConditionally\(initialLocalCache\)/);
  assert.match(optimizedStartupSource, /applyInitialWorkspaceView\(\{ scrollToTop: false \}\)/);
  assert.doesNotMatch(optimizedStartupSource, /state\.selectedDetailOt = ""|state\.selectedOperationId = ""/);
  assert.match(pagesIndex, /function showWorkspaceView\(section, tab = "", \{ scrollToTop = false \} = \{\}\)[\s\S]*if \(scrollToTop\) window\.scrollTo\(\{ top: 0, behavior: "auto" \}\)/);
  assert.match(pagesIndex, /showWorkspaceView = function optimizedShowWorkspaceView[\s\S]*section === "reportes"[\s\S]*loadSnapshotsOnce\(false\)/);
  assert.match(pagesIndex, /const activeCalls = new Map\(\)/);
  assert.match(pagesIndex, /loadSnapshotsOnce = function optimizedLoadSnapshotsOnce[\s\S]*requestPlanSnapshots\(showMessage\)/);
  assert.match(pagesIndex, /async function openRestoreDraftDialog\(\)[\s\S]*await loadSnapshotsOnce\(false\)/);
  assert.match(pagesIndex, /function loadPlanSnapshots\(showMessage\)[\s\S]*if \(!reportSnapshot\) \{[\s\S]*syncDraftReportWeek\(\);[\s\S]*reportSnapshot = currentDraftReportSnapshot\(\);[\s\S]*return \{ ok: true, count: planSnapshots\.length \}/);
  assert.match(pagesIndex, /catch \(error\)[\s\S]*return \{ ok: false, count: 0, error:/);
  assert.match(pagesIndex, /@page\s+inspection\s*\{\s*size:\s*A4 landscape;\s*margin:\s*3mm 8mm 5mm 9mm/);
  assert.match(pagesIndex, /body\.printing-inspection \.inspection-sheet\s*\{[^}]*page:\s*inspection/);
  assert.match(pagesIndex, /const printableWidthMm = 297 - 9 - 8;[\s\S]*const printableHeightMm = 210 - 3 - 5/);
  assert.match(pagesIndex, /classList\.add\("printing-inspection"\)[\s\S]*setTimeout\(resolve, 0\)[\s\S]*sheet\.scrollWidth/);
  assert.match(pagesIndex, /finally\s*\{[^}]*removeProperty\("--inspection-print-scale"\)[^}]*classList\.remove\("printing-inspection"\)/);
  assert.match(pagesIndex, /addEventListener\("afterprint",\s*clearInspectionPrintState\)/);
  assert.match(pagesIndex, /InspectionCore\.inspectionRows\(detail\.operations \|\| \[\], state\.selection\)/);
  assert.match(pagesIndex, /function inspectionOperationLayout\(count\)/);
  const inspectionPublicFunctions = `${inspectionService}\n${inspectionDrawingService}`;
  for (const inspectionFunction of ["getInspectionWorkOrders", "getInspectionWorkOrder", "getInspectionWorkOrderBundle", "saveInspectionLink", "getInspectionHistory", "recordInspectionPrint", "getInspectionDrawingRoutes"]) {
    assert.match(inspectionPublicFunctions, new RegExp(`function ${inspectionFunction}\\(`));
  }
  assert.match(inspectionService, /requeridoOriginal/);
  assert.match(inspectionService, /deficitNeto/);
  assert.match(inspectionService, /deficit/);
  assert.match(pagesIndex, /InspectionCore\.inspectionMaterials\(detail\.materials \|\| \[\]\)/);
  assert.match(pagesIndex, /function firstInspectionMaterialIndex\(\)[\s\S]*inspectionMaterials\(materials\)[\s\S]*materials\.indexOf\(first\)/);
  assert.match(pagesIndex, /inspectionEditLink"\)\.addEventListener\("click", \(\) => editMaterialLink\(firstInspectionMaterialIndex\(\)\)/);
  assert.doesNotMatch(inspectionService, /credenciales\.txt|netsuiteauth\.txt/i);
  assert.match(pagesIndex, /PlanningWorkflowCore\.ganttOperationTiming/);
  assert.match(pagesIndex, /PlanningWorkflowCore\.isMachineGanttOperation\(op\)/);
  assert.match(pagesIndex, /gantt-bar--tool-change/);
  const toolChangeStyleIndex = pagesIndex.lastIndexOf(".gantt-bar.gantt-bar--tool-change {");
  assert.ok(toolChangeStyleIndex > pagesIndex.lastIndexOf(".gantt-bar.job-type-tag--urgent,"), "el fondo de cambio debe prevalecer sobre los tipos de OT");
  assert.ok(toolChangeStyleIndex > pagesIndex.lastIndexOf(".gantt-bar.risk-dot--ok,"), "el borde de cambio debe prevalecer sobre los niveles de riesgo");
  const toolChangeStyle = pagesIndex.slice(toolChangeStyleIndex, pagesIndex.indexOf("}", toolChangeStyleIndex));
  assert.match(toolChangeStyle, /repeating-linear-gradient/);
  assert.match(toolChangeStyle, /border-left-color:/);
  assert.match(pagesIndex, /Cambio de herramental/);
  assert.match(pagesIndex, /Origen:/);
  assert.match(pagesIndex, /Destino:/);
  assert.match(pagesIndex, /Maquina:/);
  assert.match(pagesIndex, /Ajustador:/);
  assert.match(pagesIndex, /Duracion:/);
  assert.match(pagesIndex, /Minutos productivos/);
  assert.match(pagesIndex, /Minutos no operativos/);
  assert.match(pagesIndex, /Causa de espera/);
  assert.match(pagesIndex, /window\.PlannerCore\?\.productionMinutes\?\.\(op\)/);
  const operationDurationSource = pagesIndex.slice(pagesIndex.indexOf("function operationDuration(op)"), pagesIndex.indexOf("const OPERATION_DURATION_CACHE"));
  assert.match(
    operationDurationSource,
    /const explicit[\s\S]*if \(explicit > 0\) return explicit;[\s\S]*if \(start && end\)/,
    "operationDuration debe preferir la duracion productiva al intervalo calendario salvo subcontratos",
  );
  assert.equal((pagesIndex.match(/aria-selected="(?:true|false)" data-view="(?:job|operator|machine|ct)"/g) || []).length, 4);
  assert.equal((pagesIndex.match(/onclick="setGanttView\('(?:job|operator|machine|ct)'\)"/g) || []).length, 4);
  assert.match(pagesIndex, /async function syncNetSuiteTwoPhase\(options = \{\}\)/);
  assert.match(pagesIndex, /callAppsScript\("fetchNetSuiteWorkOrdersLite"\)/);
  assert.match(pagesIndex, /callAppsScript\("syncNetSuitePlanningData"\)/);
  assert.match(pagesIndex, /callAppsScript\("saveDraftSnapshot", payload\)/);
  assert.match(pagesIndex, /snapshotId: "draft"/);
  assert.match(pagesIndex, /if \(snapshotId === "draft"\) \{[\s\S]*reportSnapshot = currentDraftReportSnapshot\(\);[\s\S]*renderReports\(\);/);
  assert.match(pagesIndex, /class="job-detail-operations-scroll"/);
  assert.match(pagesIndex, /id="jobToolInput"/);
  assert.match(pagesIndex, /data-add-job-tool/);
  assert.match(pagesIndex, /applyToolToJob\(job\.ot, toolInput\.value, currentJobAdditionalTools\(\)\)/);
  assert.match(pagesIndex, /class="queue-tool-mini"/);
  assert.match(pagesIndex, /"Maq\/Area", "Herramental", "TC \(min\)"/);
  assert.match(pagesIndex, /effectiveJobTool\(state, \{ ot: op\.ot, parte: op\.parte \|\| workOrder\?\.item \|\| "", ops: \[op\] \}, \["5459", "5527"\]\)/);
  const detailBinding = pagesIndex.slice(pagesIndex.indexOf('const toolInput = els.selectedJobPanel.querySelector("#jobToolInput")'), pagesIndex.indexOf("function renderGantt()"));
  assert.match(detailBinding, /applyToolToJob\(job\.ot, toolInput\.value, currentJobAdditionalTools\(\)\)/, "el editor de herramental debe enlazarse dentro del detalle de OT");
  assert.match(pagesIndex, /<details class="job-resource-section/);
  assert.doesNotMatch(pagesIndex, /class="job-photo/);
  assert.doesNotMatch(pagesIndex, />Inicio NetSuite</);
  assert.doesNotMatch(pagesIndex, />Fin NetSuite</);
  assert.match(bridge, /saveDraftSnapshot: true/);
  assert.match(bridge, /restorePublishedPlanAsDraft: true/);
  assert.match(bridge, /fetchNetSuiteWorkOrdersLite: true/);
  assert.match(bridge, /getInspectionWorkOrderBundle: true/);
  assert.match(storageService, /PLAN_SNAPSHOT_PAYLOAD::/);
  assert.match(storageService, /fullState/);
  assert.match(storageService, /PLAN_SNAPSHOT_PAYLOAD::[\s\S]*getProperties\(\)/);
  assert.match(storageService, /snapshotId\.indexOf\('technical-'\) === 0/);
  assert.match(storageService, /const fullState = PP_readPlanSnapshotPayload_\(key\);[\s\S]*if \(!rows\.length && !fullState\)/);
  assert.match(storageService, /stagingKey[\s\S]*setProperties\([\s\S]*setProperty\(key, JSON\.stringify\(manifest\)\)/);
  assert.match(storageService, /catch \(error\)[\s\S]*PP_deletePlanSnapshotPayloadGeneration_/);
  assert.match(storageService, /keepPreviousPayload[\s\S]*SpreadsheetApp\.flush\(\);[\s\S]*PP_finalizePlanSnapshotPayload_/);
  assert.match(storageService, /function PP_rollbackPlanSnapshotPayload_[\s\S]*setProperty\(transaction\.key, transaction\.previousValue\)[\s\S]*PP_deletePlanSnapshotPayloadGeneration_\([^;]+transaction\.newManifest/);
  const replaceDraftSource = storageService.slice(storageService.indexOf("function PP_replaceDraftSnapshot_"), storageService.indexOf("function PP_listPlanSnapshots_"));
  assert.match(replaceDraftSource, /PP_rollbackPlanSnapshotPayload_\(payloadTransaction\.value\)/);
  assert.doesNotMatch(replaceDraftSource, /PP_storePlanSnapshotPayload_\('draft', previousPayload\)/);
  assert.match(codeService, /function restorePublishedPlanAsDraft\(snapshotId, currentPayload\)/);
  const publishingService = await readFile(path.join(result.distDir, "05-publishing-service.js"), "utf8");
  assert.match(publishingService, /PP_acquireScriptLock_\('restaurar publicado'/);
  assert.match(publishingService, /payloadRevision[\s\S]*currentRevision[\s\S]*stalePayload[\s\S]*const reconciliationState = stalePayload \? currentState : currentPayload/);
  assert.match(publishingService, /PP_reconcilePublishedPlan_\(snapshot, reconciliationState\)/);
  assert.doesNotMatch(publishingService, /PP_reconcilePublishedPlan_\(snapshot, currentPayload\)/);
  assert.match(publishingService, /catch \(error\)[\s\S]*PP_writeState_\([\s\S]*PP_replaceDraftSnapshot_\([\s\S]*throw error/);
  assert.match(publishingService, /snapshotId: 'draft'[\s\S]*backupId: backupId[\s\S]*summary:/);
  assert.match(performanceService.replace(/\s+/g, " "), /selectedOts/);
  assert.ok((pagesIndex.match(/data-report-source-select/g) || []).length >= 3);
  assert.match(pagesIndex, /syncDraftReportWeek\(\);[\s\S]*reportSnapshot = currentDraftReportSnapshot\(\);[\s\S]*renderReports\(\);/);
  assert.doesNotMatch(pagesIndex, /if \(Array\.isArray\(payload\?\.selectedOts\)\) state\.selectedOts = payload\.selectedOts;/);
  assert.match(pagesIndex, /Sincronizando OTs/);
  assert.match(pagesIndex, /Sincronizando operaciones/);
  assert.match(performanceService, /selectedOts: Array\.isArray\(config\.selectedOts\) \? config\.selectedOts : \[\]/);
  assert.match(storageService, /BORRADOR_PLAN/);
});

test("el detalle de OT muestra carga de operaciones mientras espera una ruta valida", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const renderStart = app.indexOf("function renderSelectedJobPanel()");
  const renderEnd = app.indexOf("function renderGantt()", renderStart);
  const renderSelected = app.slice(renderStart, renderEnd);
  assert.match(renderSelected, /Cargando operaciones\.\.\./);
  assert.match(renderSelected, /selectedJobDetailOperationLoads\.has\(materialOtKey\(job\.ot\)\)/);
});

test("el detalle de OT incluye el boton Actualizar OT bloqueado cuando la OT esta fija", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const renderStart = app.indexOf("function renderSelectedJobPanel()");
  const renderEnd = app.indexOf("function renderGantt()", renderStart);
  const renderSelected = app.slice(renderStart, renderEnd);
  assert.match(renderSelected, /data-detail-ot-refresh/);
  assert.match(renderSelected, /OT bloqueada: no se actualizan tiempos porque esta fija/);
  assert.match(renderSelected, /updateSelectedOtFromNetSuite\(job\.ot\)/);
  assert.match(app, /async function updateSelectedOtFromNetSuite\(ot\)/);
});

test("la sincronizacion ligera clasifica cambios, refresca tiempos y resume sin helpers prohibidos", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const start = app.indexOf("async function syncBacklogWorkOrders()");
  const end = app.indexOf("async function syncNetSuiteTwoPhase(options = {})");
  const source = app.slice(start, end);
  assert.match(source, /classifySmartSyncChange\(state, payload\.workOrders\)/);
  assert.match(source, /refreshSmartSyncOtTimes\(smartSync\.updateCandidates\)/);
  assert.match(source, /finalizeSmartSyncSummary\(smartSync, refreshResults\)/);
  assert.match(source, /smartSyncSummaryMessage\(smartSyncCounts\)/);
  assert.doesNotMatch(source, /saveAppState|createAppSheetPayload\(nextState\)|compareWorkOrderLite|applyConfirmedWorkOrderChanges|syncNetSuitePlanningData|syncNetSuitePlant|syncNetSuiteWorkOrders|fetchNetSuiteWorkOrdersLiteCompat/);
});

test("las filas de inspeccion no imprimen descripcion ni centro en No. Maquina", async () => {
  const inspectionApp = await readFile(path.join(process.cwd(), "src", "web", "inspection", "inspection-app.js"), "utf8");
  const start = inspectionApp.indexOf("function operationRow(operation)");
  const end = inspectionApp.indexOf("function printDiagnostic", start);
  const operationRow = inspectionApp.slice(start, end);
  assert.match(operationRow, /operation\?\.code/);
  assert.doesNotMatch(operationRow, /operation\?\.workCenter/);
  assert.doesNotMatch(operationRow, /operation\?\.operation/);
});

test("el editor de tramo usa un panel compacto sin prompts", async () => {
  const inspectionApp = await readFile(path.join(process.cwd(), "src", "web", "inspection", "inspection-app.js"), "utf8");
  const inspectionCss = await readFile(path.join(process.cwd(), "src", "web", "inspection", "inspection.css"), "utf8");
  const start = inspectionApp.indexOf("function openEditModal(focusIndex)");
  const end = inspectionApp.indexOf("async function saveEditModal", start);
  const editor = inspectionApp.slice(start, end);

  assert.match(editor, /class="inspection-link-context"/);
  assert.match(editor, /class="inspection-link-body"/);
  assert.match(editor, /class="inspection-link-material-head"/);
  assert.match(editor, /class="inspection-link-material-row/);
  assert.match(editor, /inspection-link-material-status/);
  assert.match(editor, /El tramo se guarda por articulo \+ material\./);
  assert.match(inspectionApp, /dialog\.setAttribute\("aria-labelledby", "inspectionLinkDialogTitle"\)/);
  assert.match(editor, /<h2 id="inspectionLinkDialogTitle">Editar tramo\/dibujo<\/h2>/);
  assert.doesNotMatch(editor, /(?:root\.|window\.)?prompt\s*\(/);
  assert.match(inspectionCss, /\.inspection-link-form\{[^}]*grid-template-rows:auto minmax\(0,1fr\) auto/);
  assert.match(inspectionCss, /\.inspection-link-body\{[^}]*overflow:auto/);
  assert.match(inspectionCss, /\.inspection-link-material-row\{[^}]*grid-template-columns:/);
  assert.match(inspectionCss, /\.inspection-link-dialog[^}]*:focus-visible/);
  assert.match(inspectionCss, /@media \(max-width:\d+px\)/);
});

test("el editor apila materiales en el borde responsive", async () => {
  const inspectionCss = await readFile(path.join(process.cwd(), "src", "web", "inspection", "inspection.css"), "utf8");
  const responsiveRule = inspectionCss.match(/@media \(max-width:(\d+)px\)\{\.inspection-link-dialog/);

  assert.ok(responsiveRule, "debe existir el breakpoint del editor");
  assert.ok(Number(responsiveRule[1]) >= 801, "el breakpoint debe cubrir de 760 a 801 px");
  assert.match(responsiveRule[0], /inspection-link-dialog/);
});

test("el foco del editor contrasta sobre sus fondos", async () => {
  const inspectionCss = await readFile(path.join(process.cwd(), "src", "web", "inspection", "inspection.css"), "utf8");
  const focusRule = inspectionCss.match(/\.inspection-link-dialog input:focus-visible,[^{]+\{[^}]*outline:3px solid (#[\da-f]{6})/i);
  const closeRule = inspectionCss.match(/\.inspection-link-close\{[^}]*background:(#[\da-f]{6})/i);
  const relativeLuminance = (hex) => {
    const channels = hex.slice(1).match(/.{2}/g).map((value) => Number.parseInt(value, 16) / 255);
    const [red, green, blue] = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const contrast = (first, second) => {
    const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
    const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
    return (lighter + 0.05) / (darker + 0.05);
  };

  assert.ok(focusRule, "debe declarar un outline de foco explícito");
  assert.ok(closeRule, "debe declarar el fondo del botón cerrar");
  assert.ok(contrast(focusRule[1], "#ffffff") >= 3, "el foco debe contrastar al menos 3:1 sobre blanco");
  assert.ok(contrast(focusRule[1], closeRule[1]) >= 3, "el foco debe contrastar al menos 3:1 sobre el botón cerrar");
});

test("el estado de tramo se sincroniza mientras se edita", async () => {
  const inspectionApp = await readFile(path.join(process.cwd(), "src", "web", "inspection", "inspection-app.js"), "utf8");
  const helperStart = inspectionApp.indexOf("function updateInspectionRouteStatus(input)");
  const helperEnd = inspectionApp.indexOf("function openEditModal", helperStart);
  const helper = inspectionApp.slice(helperStart, helperEnd);
  const editorStart = inspectionApp.indexOf("function openEditModal(focusIndex)");
  const editorEnd = inspectionApp.indexOf("async function saveEditModal", editorStart);
  const editor = inspectionApp.slice(editorStart, editorEnd);

  assert.ok(helperStart >= 0, "debe existir el sincronizador del estado");
  assert.match(helper, /status\.textContent = hasRoute \? "Tramo capturado" : "Falta tramo"/);
  assert.match(helper, /status\.classList\.toggle\("is-ready", hasRoute\)/);
  assert.match(helper, /status\.classList\.toggle\("is-pending", !hasRoute\)/);
  assert.match(editor, /addEventListener\("input", \(\) => updateInspectionRouteStatus\(input\)\)/);
});

test("la matriz ofrece busqueda compacta y controles de exclusion accesibles", async () => {
  const template = await readFile(path.join(process.cwd(), "src", "web", "planning", "index.template.html"), "utf8");
  const styles = await readFile(path.join(process.cwd(), "src", "web", "planning", "styles.css"), "utf8");

  assert.match(template, /id="matrixSearchInput"[^>]*placeholder="Buscar operación o CT…"/);
  assert.match(template, /id="matrixSearchCount"[^>]*aria-live="polite"/);
  assert.match(template, /id="clearMatrixSearchBtn"[^>]*>Limpiar<\/button>/);
  assert.match(styles, /\.matrix-search\s*\{[^}]*display:\s*(?:flex|grid)/);
  assert.match(styles, /\.matrix-search-input:focus-visible[\s\S]*outline:/);
  assert.match(styles, /\.capability-plan-state:focus-visible[\s\S]*outline:/);
  assert.match(styles, /\.matrix-row-excluded[\s\S]*opacity:/);
  assert.match(styles, /\.matrix-excluded-badge\s*\{/);
  assert.match(styles, /\.matrix-empty\s*\{/);
});

test("la matriz filtra, conserva la consulta al rerenderizar y cambia exclusiones", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const renderStart = app.indexOf("function renderMatrix()");
  const renderEnd = app.indexOf("function renderOperationCatalogSelect()", renderStart);
  const renderMatrix = app.slice(renderStart, renderEnd);
  const bindStart = app.indexOf("function bindEvents()");
  const bindEnd = app.indexOf("function showWorkspaceView(", bindStart);
  const bindings = app.slice(bindStart, bindEnd);
  const persistStart = app.indexOf("function persistableState(");
  const persistEnd = app.indexOf("function isAppsScriptRuntime()", persistStart);
  const persistence = app.slice(persistStart, persistEnd);

  assert.match(app, /let state = loadState\(\);\s*state\.matrixSearch = "";/);
  assert.match(app, /state\.excludedCapabilities = normalizeCapabilityKeys\(state\.excludedCapabilities\);/);
  assert.match(renderMatrix, /window\.PlannerCore\.filterCapabilities\(capabilities, state\.matrixSearch\)/);
  assert.match(renderMatrix, /matrixSearchInput\.value = state\.matrixSearch/);
  assert.match(renderMatrix, /matrixSearchCount\.textContent = `\$\{filteredCapabilities\.length\} de \$\{capabilities\.length\} operaciones`/);
  assert.match(renderMatrix, /Sin operaciones que coincidan/);
  assert.match(renderMatrix, /data-capability-plan-state=/);
  assert.match(renderMatrix, />Usar en el plan<\/option>/);
  assert.match(renderMatrix, />Excluir del plan<\/option>/);
  assert.match(renderMatrix, /matrix-row-excluded/);
  assert.match(renderMatrix, /matrix-excluded-badge[^>]*>Excluida</);
  assert.match(renderMatrix, /state\.excludedCapabilities = excluded[\s\S]*filter\(\(item\) => item !== key\)/);
  assert.match(renderMatrix, /saveAndRender\([^;]+,\s*"matrix"\)/);
  assert.match(bindings, /matrixSearchInput\.addEventListener\("input"[\s\S]*state\.matrixSearch = els\.matrixSearchInput\.value[\s\S]*renderMatrix\(\)/);
  assert.match(bindings, /clearMatrixSearchBtn\.addEventListener\("click"[\s\S]*state\.matrixSearch = ""[\s\S]*renderMatrix\(\)[\s\S]*matrixSearchInput\.focus\(\)/);
  assert.match(persistence, /const \{ matrixSearch, selectedDetailOt, queueMoveOt, \.\.\.persisted \} = source;/);
  assert.match(app, /localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(persistableState\(\)\)\)/);
  assert.match(persistence, /\.\.\.deepClone\(persistableState\(source\)\)/);
});

test("el guardado local optimizado mantiene matrixSearch efimero", async () => {
  const performanceClient = await readFile(path.join(process.cwd(), "src", "web", "shared", "performance-client.js"), "utf8");
  const compactStart = performanceClient.indexOf("function compactLocalState()");
  const compactEnd = performanceClient.indexOf("scheduleLocalStorageFlush =", compactStart);
  const compactSource = performanceClient.slice(compactStart, compactEnd);
  const compactLocalState = Function("state", "LOCAL_CACHE_IDENTITY", `${compactSource}; return compactLocalState;`)({
    revision: 7,
    matrixSearch: "soldadura",
    excludedCapabilities: ["5527::SOLDADURA_SOPORTE"],
    materials: [{ ot: "WO-1" }],
  }, "plan-produccion-cache-v2");

  const persisted = compactLocalState();

  assert.equal(persisted.matrixSearch, undefined);
  assert.deepEqual(persisted.excludedCapabilities, ["5527::SOLDADURA_SOPORTE"]);
  assert.deepEqual(persisted.materials, []);
  assert.match(compactSource, /performanceCache:\s*\{[\s\S]*identity: LOCAL_CACHE_IDENTITY[\s\S]*revision[,:\s]/);
  assert.match(performanceClient, /const compacted = compactLocalState\(\);[\s\S]*localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(compacted\)\);[\s\S]*writeMeta\(\{[\s\S]*deferredMaterials: true/);
});

test("las exclusiones sobreviven importacion, restauracion y guardado diferido", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const performanceClient = await readFile(path.join(process.cwd(), "src", "web", "shared", "performance-client.js"), "utf8");
  const normalizeStart = app.indexOf("function normalizeState()");
  const normalizeEnd = app.indexOf("function bindEvents()", normalizeStart);
  const normalizeState = app.slice(normalizeStart, normalizeEnd);
  const importStart = app.indexOf("function applyImported(");
  const importEnd = app.indexOf("function importCsv(", importStart);
  const importFlow = app.slice(importStart, importEnd);
  const removalStart = app.indexOf("function removeCapability(");
  const removalEnd = app.indexOf("function removeOperator(", removalStart);
  const removal = app.slice(removalStart, removalEnd);
  const deferredStart = performanceClient.indexOf("function baseSavePayload()");
  const deferredEnd = performanceClient.indexOf("function saveJobsForScopes(", deferredStart);
  const deferredPayloads = performanceClient.slice(deferredStart, deferredEnd);
  const basePayload = deferredPayloads.slice(0, deferredPayloads.indexOf("function planningSavePayload()"));
  const matrixPayload = deferredPayloads.slice(deferredPayloads.indexOf("function matrixSavePayload()"));

  assert.match(normalizeState, /state\.excludedCapabilities = normalizeCapabilityKeys\(state\.excludedCapabilities\)/);
  assert.match(importFlow, /if \(Array\.isArray\(imported\.excludedCapabilities\)\) state\.excludedCapabilities = normalizeCapabilityKeys\(imported\.excludedCapabilities\)/);
  assert.match(importFlow, /"excludedCapabilities"/);
  assert.match(importFlow, /excludedCapabilities:\s*Array\.isArray\(parsed\.excludedCapabilities\)/);
  assert.match(removal, /state\.excludedCapabilities = state\.excludedCapabilities\.filter\(\(excludedKey\) => excludedKey !== key\)/);
  assert.doesNotMatch(basePayload, /excludedCapabilities/);
  assert.match(matrixPayload, /excludedCapabilities:\s*normalizeCapabilityKeys\(state\.excludedCapabilities\)/);
  assert.doesNotMatch(deferredPayloads, /matrixSearch/);
});

test("cambiar la exclusion restaura el foco al control de la misma capacidad", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const focusStart = app.indexOf("function focusCapabilityPlanState(key)");
  const focusEnd = app.indexOf("function renderMatrix()", focusStart);
  const renderStart = app.indexOf("function renderMatrix()");
  const renderEnd = app.indexOf("function renderOperationCatalogSelect()", renderStart);
  const renderMatrix = app.slice(renderStart, renderEnd);

  assert.ok(focusStart >= 0, "debe existir el restaurador de foco por capacidad");
  const focusSource = app.slice(focusStart, focusEnd);
  const focused = [];
  const controls = ["5459::DOBLADO", "5527::SOLDADURA_SOPORTE"].map((key) => ({
    dataset: { capabilityPlanState: key },
    focus: () => focused.push(key),
  }));
  const focusCapabilityPlanState = Function("els", `${focusSource}; return focusCapabilityPlanState;`)({
    matrixWrap: { querySelectorAll: () => controls },
  });

  focusCapabilityPlanState("5527::SOLDADURA_SOPORTE");

  assert.deepEqual(focused, ["5527::SOLDADURA_SOPORTE"]);
  assert.match(renderMatrix, /saveAndRender\([^;]+,\s*"matrix"\);\s*focusCapabilityPlanState\(key\);/);
});

test("el cliente conserva y muestra operationCatalogWarning", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const applyStart = app.indexOf("function applyNetSuitePlanningPayload(payload)");
  const applyEnd = app.indexOf("function setNetSuiteSyncPhaseLabel(", applyStart);
  const applySource = app.slice(applyStart, applyEnd);
  const alertsStart = app.indexOf("function planAlertItems()");
  const alertsEnd = app.indexOf("function renderPriorityList()", alertsStart);
  const alertsSource = app.slice(alertsStart, alertsEnd);
  const state = {
    operations: [],
    materials: [],
    operationCatalog: [],
    operationCatalogWarning: "",
    selectedOts: [],
    netSuiteSyncAlert: null,
    netSuiteChangeAlerts: [],
    planStart: "2026-07-26",
  };
  let backlogResetCount = 0;
  const applyPayload = Function("state", "normalizeKey", "selectedJobOt", "resetBacklogWindow", `${applySource}; return applyNetSuitePlanningPayload;`)(
    state,
    (value) => String(value || "").trim().toUpperCase(),
    () => "",
    () => { backlogResetCount += 1; },
  );
  const planAlertItems = Function(
    "state",
    "normalizeStatus",
    "getPriorityJobs",
    "isJobSelected",
    "jobRiskLevel",
    "weeklyExecutiveSummary",
    "weeklyJobSummary",
    "currentDraftScheduledOperations",
    `${alertsSource}; return planAlertItems;`,
  )(
    state,
    (value) => String(value || "").trim().toUpperCase(),
    () => [],
    () => false,
    () => ({ level: "VERDE", label: "" }),
    () => ({ targetMet: true }),
    () => [],
    () => [],
  );

  applyPayload({ operationCatalogWarning: "Catalogo NetSuite no disponible" });

  assert.equal(state.operationCatalogWarning, "Catalogo NetSuite no disponible");
  assert.equal(backlogResetCount, 0);
  applyPayload({ operations: [] });
  assert.equal(backlogResetCount, 1);
  assert.deepEqual(planAlertItems().find((alert) => alert.title === "Catalogo de operaciones NetSuite"), {
    level: "warning",
    title: "Catalogo de operaciones NetSuite",
    message: "Catalogo NetSuite no disponible",
  });
});

test("el backlog renderiza una ventana inicial de 30 trabajos con controles progresivos", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const template = await readFile(path.join(process.cwd(), "src", "web", "planning", "index.template.html"), "utf8");
  const renderStart = app.indexOf("function renderPriorityList()");
  const renderEnd = app.indexOf("function renderPriorityQueue()", renderStart);
  const renderPriorityList = app.slice(renderStart, renderEnd);

  assert.match(app, /const BACKLOG_PAGE_SIZE = 30/);
  assert.match(renderPriorityList, /jobs\.slice\(0,\s*backlogVisibleLimit\)/);
  assert.match(renderPriorityList, /\$\{visibleJobs\.length\} de \$\{jobs\.length\}/);
  assert.match(template, /id="priorityLoadMore"/);
  assert.match(template, /id="priorityLoadMoreSentinel"/);
});

test("la ventana del backlog avanza exactamente 30 y puede reiniciarse sin render adicional", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const progressiveStart = app.indexOf("const BACKLOG_PAGE_SIZE = 30;");
  const progressiveEnd = app.indexOf("let state = loadState()", progressiveStart);
  assert.ok(progressiveStart >= 0 && progressiveEnd > progressiveStart, "debe existir el controlador de ventana progresiva");
  const progressiveSource = app.slice(progressiveStart, progressiveEnd);
  let renderCount = 0;
  const backlog = Function(
    "renderPriorityList",
    "els",
    "window",
    `${progressiveSource}; return {
      resetBacklogWindow,
      showMoreBacklogJobs,
      get limit() { return backlogVisibleLimit; },
    };`,
  )(
    () => { renderCount += 1; },
    {},
    {},
  );

  assert.equal(backlog.limit, 30);
  backlog.showMoreBacklogJobs();
  assert.equal(backlog.limit, 60);
  assert.equal(renderCount, 1);
  backlog.resetBacklogWindow();
  assert.equal(backlog.limit, 30);
  assert.equal(renderCount, 1);
});

test("buscar y filtrar reinician el backlog; el boton carga mas", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const bindStart = app.indexOf("function bindEvents()");
  const bindEnd = app.indexOf("function setActiveTab(", bindStart);
  const bindEvents = app.slice(bindStart, bindEnd);

  assert.match(bindEvents, /searchInput\.addEventListener\("input",\s*debounce\(\(\) => \{\s*resetBacklogWindow\(\);\s*renderPriorityList\(\);\s*\},\s*120\)\)/);
  assert.match(bindEvents, /statusFilter\.addEventListener\("change",\s*\(\) => \{\s*resetBacklogWindow\(\);\s*renderPriorityList\(\);\s*\}\)/);
  assert.match(bindEvents, /priorityLoadMore\.addEventListener\("click",\s*showMoreBacklogJobs\)/);
});

test("el observer del backlog es unico, no carga en cascada y conserva el fallback", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const progressiveStart = app.indexOf("const BACKLOG_PAGE_SIZE = 30;");
  const progressiveEnd = app.indexOf("let state = loadState()", progressiveStart);
  assert.ok(progressiveStart >= 0 && progressiveEnd > progressiveStart, "debe existir el controlador de ventana progresiva");
  const progressiveSource = app.slice(progressiveStart, progressiveEnd);
  let observed = 0;
  let observerCallback;
  let renderCount = 0;
  const backlog = Function(
    "renderPriorityList",
    "els",
    "window",
    `${progressiveSource}; return {
      bindBacklogLoadMoreObserver,
      get limit() { return backlogVisibleLimit; },
    };`,
  )(
    () => { renderCount += 1; },
    {
      priorityLoadMore: { hidden: false },
      priorityLoadMoreSentinel: {},
    },
    {
      IntersectionObserver: class {
        constructor(callback) { observerCallback = callback; }
        observe() { observed += 1; }
      },
    },
  );

  backlog.bindBacklogLoadMoreObserver();
  backlog.bindBacklogLoadMoreObserver();
  assert.equal(observed, 1);
  observerCallback([{ isIntersecting: true }]);
  observerCallback([{ isIntersecting: true }]);
  assert.equal(backlog.limit, 60);
  assert.equal(renderCount, 1);
  observerCallback([{ isIntersecting: false }]);
  observerCallback([{ isIntersecting: true }]);
  assert.equal(backlog.limit, 90);
  assert.equal(renderCount, 2);
});

test("el backlog conserva el foco de fecha visible y reinicia al cambiar el dataset", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const renderStart = app.indexOf("function renderPriorityList()");
  const renderEnd = app.indexOf("function renderPriorityQueue()", renderStart);
  const renderPriorityList = app.slice(renderStart, renderEnd);
  const payloadStart = app.indexOf("function applyNetSuitePlanningPayload(payload)");
  const payloadEnd = app.indexOf("function setNetSuiteSyncPhaseLabel(", payloadStart);
  const applyPayload = app.slice(payloadStart, payloadEnd);
  const importedStart = app.indexOf("function applyImported(imported, options = {})");
  const importedEnd = app.indexOf("function captureLocalPlanningState()", importedStart);
  const applyImported = app.slice(importedStart, importedEnd);
  const backlogSyncStart = app.indexOf("async function syncBacklogWorkOrders()");
  const backlogSyncEnd = app.indexOf("async function syncNetSuiteTwoPhase(", backlogSyncStart);
  const syncBacklog = app.slice(backlogSyncStart, backlogSyncEnd);
  const twoPhaseStart = backlogSyncEnd;
  const twoPhaseEnd = app.indexOf("function applyNetSuitePlanningPayload(payload)", twoPhaseStart);
  const syncTwoPhase = app.slice(twoPhaseStart, twoPhaseEnd);

  assert.match(renderPriorityList, /document\.activeElement\?\.dataset\?\.dueOt/);
  assert.match(renderPriorityList, /dataset\.dueOt === focusedDueOt[\s\S]*\.focus\(\)/);
  assert.match(applyPayload, /Array\.isArray\(payload\?\.operations\)[\s\S]*if \(backlogDatasetChanged\) resetBacklogWindow\(\)/);
  assert.match(applyImported, /Array\.isArray\(imported\.operations\)[\s\S]*if \(backlogDatasetChanged\) resetBacklogWindow\(\)/);
  assert.match(syncBacklog, /resetBacklogWindow\(\)[\s\S]*render\(\{ save: false \}\)/);
  assert.match(syncTwoPhase, /syncWorkOrdersOnce\(\{ showMessage: false, manual: true \}\)/);
});

test("tombstones locales evitan que import remoto o snapshot stale reviva OTs retiradas", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const importStart = app.indexOf("function applyImported(imported, options = {})");
  const importEnd = app.indexOf("function captureLocalPlanningState()", importStart);
  const importFlow = app.slice(importStart, importEnd);
  const payloadStart = app.indexOf("function createAppSheetPayload(source = state)");
  const payloadEnd = app.indexOf("function isAppsScriptRuntime()", payloadStart);
  const createPayloadSource = app.slice(payloadStart, payloadEnd);

  assert.match(importFlow, /const locallyRemovedDraftOts = \[\.\.\.\(state\._locallyRemovedDraftOts \|\| \[\]\)\];/);
  assert.match(importFlow, /normalizeState\(\);\s*applyLocalDraftRemovalTombstones\(locallyRemovedDraftOts\);/);
  assert.match(importFlow, /function rememberDraftRemovedOts\(ots\)/);
  assert.match(importFlow, /function forgetDraftRemovedOt\(ot\)/);
  assert.match(createPayloadSource, /delete payload\._locallyRemovedDraftOts;/);
  assert.match(createPayloadSource, /delete payload\._pendingAddOt;/);
  assert.match(createPayloadSource, /delete payload\._pendingAddOtSnapshot;/);

  const state = {
    selectedOts: ["100", "200"],
    lockedOts: ["100"],
    expandedOts: ["100", "200"],
    lastSchedule: { scheduledOts: ["100", "200"] },
    preparedPlanningByOt: { 100: "a", 200: "b" },
    operations: [
      { id: "100-op", ot: "100", fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "08:00", locked: true },
      { id: "200-op", ot: "200", fechaInicio: "2026-07-13", horaInicio: "08:00", fechaFin: "2026-07-13", horaFin: "09:00" },
    ],
  };
  let invalidations = 0;
  const api = Function(
    "state",
    "window",
    "materialOtKey",
    "invalidateCurrentPlanOperationsCache",
    `${importFlow}; return { applyLocalDraftRemovalTombstones, rememberDraftRemovedOts, forgetDraftRemovedOt };`,
  )(
    state,
    { PlanningWorkflowCore: { removeOtFromDraft(current, ot) {
      const key = String(ot || "").trim().toUpperCase();
      const keep = (items) => (items || []).filter((item) => String(item || "").trim().toUpperCase() !== key);
      const preparedPlanningByOt = { ...(current.preparedPlanningByOt || {}) };
      Object.keys(preparedPlanningByOt).forEach((item) => { if (String(item).trim().toUpperCase() === key) delete preparedPlanningByOt[item]; });
      return {
        ...current,
        selectedOts: keep(current.selectedOts),
        lockedOts: keep(current.lockedOts),
        expandedOts: keep(current.expandedOts),
        preparedPlanningByOt,
        operations: (current.operations || []).map((operation) => String(operation.ot || "").trim().toUpperCase() === key
          ? { ...operation, locked: false, fechaInicio: "", horaInicio: "", fechaFin: "", horaFin: "" }
          : operation),
        lastSchedule: { ...current.lastSchedule, scheduledOts: keep(current.lastSchedule.scheduledOts) },
      };
    } } },
    (value) => String(value || "").trim().toUpperCase(),
    () => { invalidations += 1; },
  );

  api.rememberDraftRemovedOts(["100"]);
  assert.deepEqual(state._locallyRemovedDraftOts, ["100"]);
  const removed = api.applyLocalDraftRemovalTombstones(["100"]);

  assert.equal(removed, 1);
  assert.deepEqual(state.selectedOts, ["200"]);
  assert.deepEqual(state.lockedOts, []);
  assert.deepEqual(state.expandedOts, ["200"]);
  assert.deepEqual(state.lastSchedule.scheduledOts, ["200"]);
  assert.equal(state.preparedPlanningByOt[100], undefined);
  assert.equal(state.operations.find((op) => op.id === "100-op").fechaInicio, "");
  assert.equal(invalidations, 1);
  api.forgetDraftRemovedOt("100");
  assert.equal(state._locallyRemovedDraftOts, undefined);
});

test("el arranque optimizado aplica tombstones aun cuando getAppStateIfChanged responde unchanged", async () => {
  const performanceClient = await readFile(path.join(process.cwd(), "src", "web", "shared", "performance-client.js"), "utf8");
  const loadStart = performanceClient.indexOf("async function loadInitialStateConditionally(localCache)");
  const loadEnd = performanceClient.indexOf("loadAppStateInBackground = function optimizedLoadAppStateInBackground", loadStart);
  const loadFlow = performanceClient.slice(loadStart, loadEnd);

  assert.match(loadFlow, /if \(imported\?\.unchanged\) \{[\s\S]*applyLocalDraftRemovalTombstones\(state\._locallyRemovedDraftOts \|\| \[\]\);[\s\S]*return \{ loaded: false, unchanged: true \};/);
});

test("el selector de matriz excluye subcontratos con la clasificacion compartida", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const renderStart = app.indexOf("function renderOperationCatalogSelect()");
  const renderEnd = app.indexOf("function renderConfiguration()", renderStart);
  const renderSource = app.slice(renderStart, renderEnd);
  const newCtInput = { innerHTML: "", disabled: false };
  const addCtBtn = { disabled: false };
  const state = {
    operationCatalog: [
      { key: "5467::CORTE", ct: "5467", label: "CORTE", active: true },
      { key: "6462::CROMADO_ESPECIAL", ct: "6462", label: "CROMADO ESPECIAL", active: true },
    ],
  };
  const renderOperationCatalogSelect = Function(
    "state",
    "getCapabilityRows",
    "capabilityKey",
    "els",
    "escapeHtml",
    "window",
    `${renderSource}; return renderOperationCatalogSelect;`,
  )(
    state,
    () => [],
    (ct, label) => `${ct}::${String(label).replace(/ /g, "_")}`,
    { newCtInput, addCtBtn },
    (value) => String(value),
    {
      PlannerCore: {
        isSpecialSubcontractCapability: (item) => /CROMADO/.test(item.label),
      },
    },
  );

  renderOperationCatalogSelect();

  assert.match(newCtInput.innerHTML, /5467::CORTE/);
  assert.doesNotMatch(newCtInput.innerHTML, /CROMADO/);
});

test("Gantt, cargas, metricas y borradores omiten capacidades excluidas", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const sliceFunction = (name, nextName) => {
    const start = app.indexOf(`function ${name}`);
    const end = app.indexOf(`function ${nextName}`, start);
    assert.ok(start >= 0 && end > start, `debe existir ${name}`);
    return app.slice(start, end);
  };
  const helper = sliceFunction("currentPlanOperations(", "currentDraftScheduledOperations(");
  const currentPlanOperations = Function(
    "state",
    "window",
    `${helper}; return currentPlanOperations;`,
  )(
    { excludedCapabilities: ["5527::SOLDADURA"], operations: [{ id: "keep" }, { id: "drop" }] },
    { PlannerCore: { filterExcludedOperations: (_state, operations) => operations.filter((op) => op.id !== "drop") } },
  );

  assert.deepEqual(currentPlanOperations().map((op) => op.id), ["keep"]);
  assert.match(sliceFunction("currentDraftScheduledOperations(", "renderDraftExecutiveSummary("), /operations:\s*currentPlanOperations\(\)/);
  assert.match(sliceFunction("renderDraftExecutiveSummary(", "renderTop("), /currentPlanOperations\(\)/);
  assert.match(sliceFunction("renderTop(", "renderPlanAlerts("), /currentPlanOperations\(\)/);
  assert.match(sliceFunction("renderLoads(", "renderOperationCatalogSelect("), /currentDraftScheduledOperations\(\)/);
  assert.match(sliceFunction("persistPlanSnapshot(", "publishCurrentPlan("), /operations:\s*currentPlanOperations\(\)/);
  assert.match(sliceFunction("publishCurrentPlan(", "generatePlanPdf("), /operations:\s*currentPlanOperations\(\)/);
  assert.match(sliceFunction("getGanttGroups(", "ganttOperationHasMachine("), /currentPlanOperations\(\)/);
  assert.match(sliceFunction("getOperatorLoads(", "operatorLoadsForOperations("), /currentPlanOperations\(\)/);
  assert.match(sliceFunction("getCtLoads(", "operationDuration("), /currentPlanOperations\(\)/);
});

test("preparacion y validacion ignoran operaciones excluidas", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const preparation = app.slice(
    app.indexOf("async function prepareJobForPlanning("),
    app.indexOf("function setGanttView(", app.indexOf("async function prepareJobForPlanning(")),
  );
  const validation = app.slice(
    app.indexOf("function validateScheduleConfiguration("),
    app.indexOf("function freezeElapsedOperations(", app.indexOf("function validateScheduleConfiguration(")),
  );
  const excluded = { id: "excluded", ot: "100", ct: "5459", tipoInsercion: "OPERACION" };
  const state = { excludedCapabilities: ["5459::DOBLADO"], preparedPlanningByOt: {} };
  const currentPlanOperations = () => [];
  let preparedOperations = null;
  let validatedOperations = null;
  let dialogs = 0;
  const window = {
    PlannerCore: {
      planningConfigurationIssues: (_state, operations) => {
        validatedOperations = operations;
        return [];
      },
    },
    PlanningWorkflowCore: {
      canReusePlanningPreparation: () => false,
      needsPlanningPreparation: () => true,
      markPlanningPrepared: () => ({}),
    },
  };
  const prepareJobForPlanning = Function(
    "state", "window", "currentPlanOperations", "jobPlanningOperations", "showPlanningBlockers", "buildPlanningRequirements",
    "commercialPlanningRequirement", "planningPreparationSignature", "isSubcontractAppOperation",
    "isBendingAppOperation", "showPlanningRequirements", "applyPlanningRequirements",
    "applyCommercialPlanningRequirement", "assignPlanningOperators",
    `${preparation}; return prepareJobForPlanning;`,
  )(
    state, window, currentPlanOperations, () => [], async () => { dialogs += 1; },
    (_issues, operations) => { preparedOperations = operations; return []; },
    () => ({ needsType: false, needsPlanningType: false }),
    () => "signature", () => true, () => true,
    async () => { dialogs += 1; return null; }, () => {}, () => {}, () => {},
  );
  const validateScheduleConfiguration = Function(
    "state", "window", "currentPlanOperations", "isJobSelected", "isPlanCompletedOperation",
    "isJobLocked", "shouldAutoFreezeOperation", "capabilityFromOperation", "findOperation",
    "toolCatalogForAppOperation", "subcontractDaysForAppOperation", "isSubcontractAppOperation",
    "normalizeStatus",
    `${validation}; return validateScheduleConfiguration;`,
  )(
    { ...state, operations: [excluded] }, window, currentPlanOperations,
    () => true, () => false, () => false, () => false,
    () => ({ label: "DOBLADO", ct: "5459" }), () => excluded,
    () => null, () => ({ days: 0 }), () => true,
    (value) => String(value || "").trim().toUpperCase(),
  );

  assert.equal(await prepareJobForPlanning({ ot: "100", ops: [excluded], parte: "P" }), true);
  assert.deepEqual(preparedOperations, []);
  assert.equal(dialogs, 0);
  assert.equal(validateScheduleConfiguration(new Date()), null);
  assert.deepEqual(validatedOperations, []);
});

test("generar plan no pide datos de OTs fuera del alcance y reutiliza configuracion OT persistida", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const preparation = app.slice(
    app.indexOf("async function prepareJobForPlanning("),
    app.indexOf("function setGanttView(", app.indexOf("async function prepareJobForPlanning(")),
  );
  const validation = app.slice(
    app.indexOf("function validateScheduleConfiguration("),
    app.indexOf("function freezeElapsedOperations(", app.indexOf("function validateScheduleConfiguration(")),
  );
  const scoped = { id: "scoped", ot: "200", ct: "3000", tipoInsercion: "OPERACION", subcontractType: "", subcontractDays: 0 };
  const unaffected = { id: "unaffected", ot: "100", ct: "3000", tipoInsercion: "OPERACION", subcontractType: "", subcontractDays: 0 };
  const state = {
    selectedOts: ["100", "200"],
    preparedPlanningByOt: {},
    otConfigurations: { 200: { ot: "200", subcontractType: "MAKA", subcontractDays: 3 } },
  };
  let dialogs = 0;
  let validatedOperations = null;
  const window = {
    PlannerCore: {
      planningConfigurationIssues: (_state, operations) => {
        validatedOperations = operations;
        return [];
      },
    },
    PlanningWorkflowCore: {
      canReusePlanningPreparation: () => false,
      needsPlanningPreparation: () => true,
      markPlanningPrepared: (source, ot, signature) => ({ preparedPlanningByOt: { ...(source.preparedPlanningByOt || {}), [ot]: signature } }),
    },
  };
  const prepareJobForPlanning = Function(
    "state", "window", "currentPlanOperations", "jobPlanningOperations", "showPlanningBlockers", "buildPlanningRequirements",
    "commercialPlanningRequirement", "planningPreparationSignature", "isSubcontractAppOperation",
    "isBendingAppOperation", "showPlanningRequirements", "applyPlanningRequirements",
    "applyCommercialPlanningRequirement", "assignPlanningOperators",
    `${preparation}; return prepareJobForPlanning;`,
  )(
    state, window, (operations) => operations, (job) => job.ops,
    async () => { dialogs += 1; }, () => [],
    () => ({ needsType: false, needsPlanningType: false }),
    () => "signature", () => true, () => false,
    async () => { dialogs += 1; return null; }, () => {}, () => {}, () => {},
  );
  const validateScheduleConfiguration = Function(
    "state", "window", "currentPlanOperations", "isJobSelected", "isPlanCompletedOperation",
    "isJobLocked", "shouldAutoFreezeOperation", "capabilityFromOperation", "findOperation",
    "toolCatalogForAppOperation", "subcontractDaysForAppOperation", "isSubcontractAppOperation",
    "normalizeStatus",
    `${validation}; return validateScheduleConfiguration;`,
  )(
    state, window, () => [unaffected, scoped],
    () => true, () => false, () => false, () => false,
    () => ({ label: "SUBCONTRATO", ct: "3000" }), (id) => [unaffected, scoped].find((op) => op.id === id),
    () => null, () => ({ days: 0 }), () => true,
    (value) => String(value || "").trim().toUpperCase(),
  );

  assert.equal(await prepareJobForPlanning({ ot: "200", ops: [scoped], parte: "P" }, { reuseConfirmed: true }), true);
  assert.equal(dialogs, 0);
  assert.equal(state.preparedPlanningByOt[200], "signature");
  assert.equal(validateScheduleConfiguration(new Date(), ["200"]), null);
  assert.deepEqual(validatedOperations, [scoped]);
});

test("agregar o arrastrar una OT consulta su ruta directa una vez por sesion antes de planearla", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const selection = app.slice(
    app.indexOf("function selectJob("),
    app.indexOf("async function prepareJobForPlanning(", app.indexOf("function selectJob(")),
  );
  const backlog = app.slice(
    app.indexOf("function renderPriorityList()"),
    app.indexOf("function renderPriorityQueue()", app.indexOf("function renderPriorityList()")),
  );
  const drag = app.slice(
    app.indexOf("function finishBacklogDrag("),
    app.indexOf("function jobPlanningOperations()", app.indexOf("function finishBacklogDrag(")),
  );

  assert.match(selection, /if \(selected && !alreadySelected\) \{/);
  assert.match(selection, /await ensureWorkOrderPlanningData\(ot\)/);
  assert.doesNotMatch(selection, /ensurePlanningDataLoaded\(true, \{ force: true \}\)/);
  assert.match(selection, /setIndividualPlanningBusy\(ot, true\)/);
  assert.match(selection, /finally[\s\S]*setIndividualPlanningBusy\(ot, false\)/);
  assert.match(selection, /job = getPriorityJobs\(\)\.find\(\(item\) => materialOtKey\(item\.ot\) === otKey\)/);
  assert.match(selection, /if \(!hasIndividualPlanningOperations\(ot\) \|\| !jobPlanningOperations\(job\)\.length\)[\s\S]*return;/);
  assert.match(backlog, /selectJob\(job\.ot, true\)/);
  assert.match(drag, /selectJob\(sourceOt, true\)/);
});

test("completar una operacion usa guardado atomico y render parcial", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const persistence = app.slice(
    app.indexOf("async function persistOptimisticPlanStatus("),
    app.indexOf("function renderProductionReportTable(", app.indexOf("async function persistOptimisticPlanStatus(")),
  );

  assert.match(persistence, /callAppsScript\("saveOperationPlanStatus"/);
  assert.match(persistence, /renderPlanStatusChange\(\)/);
  assert.doesNotMatch(persistence, /\brender\(\)/);
});

test("reportes de borrador usan operaciones actuales y publicado permanece inmutable", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const reportSource = app.slice(
    app.indexOf("function currentDraftReportSnapshot()"),
    app.indexOf("function reportSourceLabel()", app.indexOf("function reportOperationsSource()")),
  );
  const staleSource = app.slice(
    app.indexOf("function stalePublishedPieces("),
    app.indexOf("function weeklyJobSummary(", app.indexOf("function stalePublishedPieces(")),
  );
  const included = { id: "included", ot: "100", secuencia: 2, pendingPieces: 5 };
  const excluded = { id: "excluded", ot: "100", secuencia: 1, pendingPieces: 5 };
  const state = { planStart: "2026-07-20", operations: [excluded, included] };
  const currentDraftScheduledOperations = () => [included];
  const makeReportOperationsSource = (reportSnapshot) => Function(
    "state", "reportSnapshot", "window", "currentDraftScheduledOperations",
    `${reportSource}; return reportOperationsSource;`,
  )(state, reportSnapshot, { PlanningWorkflowCore: { mondayIso: () => "2026-07-20" } }, currentDraftScheduledOperations);

  const draftSource = makeReportOperationsSource({
    snapshotId: "draft",
    excludedCapabilities: [],
    operations: [excluded, included],
  });
  const defaultSource = makeReportOperationsSource(null);
  const publishedSource = makeReportOperationsSource({
    snapshotId: "published-1",
    operations: [excluded, included],
  });

  assert.deepEqual(draftSource().map((op) => op.id), ["included"]);
  assert.deepEqual(defaultSource().map((op) => op.id), ["included"]);
  assert.deepEqual(publishedSource().map((op) => op.id), ["excluded", "included"]);

  const stalePublishedPieces = Function(
    "state", "reportOperationsSource", "isJobScheduled", "isPlanCompletedOperation",
    "isClosedJobStatus", "jobStatusForOt", "opStart", "opEnd", "sequenceSort",
    "pendingPiecesForWorkOrder", "workOrderForOt", "window", "jobStatusFromOperations",
    "materialOtKey",
    `${staleSource}; return stalePublishedPieces;`,
  )(
    state, draftSource, () => true, () => false, () => false, () => "",
    () => new Date("2026-07-01T07:00:00"), () => new Date("2026-07-01T08:00:00"),
    (a, b) => a.secuencia - b.secuencia, () => 0, () => null,
    { PlannerCore: { isPlanCompletedOperation: () => false } },
    () => "PLAN",
    (value) => String(value || "").trim().toUpperCase(),
  );

  assert.deepEqual(stalePublishedPieces(new Date("2026-07-20T00:00:00"), draftSource(), state), {
    initialCut: 5,
    finishing: 5,
  });
});

test("exportCsv omite capacidades excluidas del borrador", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const exportSource = app.slice(
    app.indexOf("async function exportCsv()"),
    app.indexOf("async function exportSourceOperations("),
  );
  const state = { operations: [{ id: "keep" }, { id: "drop" }] };
  let exported = "";
  const exportCsv = Function(
    "state", "window", "currentPlanOperations", "PLAN_HEADERS", "operationToRow",
    "csvCell", "downloadBlob", "els", "exportSourceOperations",
    `${exportSource}; return exportCsv;`,
  )(
    state,
    { PlanningWorkflowCore: { draftExportOperations: (value) => value.operations } },
    () => [state.operations[0]],
    ["ID"],
    (op) => [op.id],
    (value) => String(value),
    (value) => { exported = value; },
    { exportSnapshotSelect: { value: "draft" } },
    () => [state.operations[0]],
  );

  await exportCsv();

  assert.match(exported, /keep/);
  assert.doesNotMatch(exported, /drop/);
});

test("exportCsv exporta las operaciones del plan publicado seleccionado", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const exportSource = app.slice(
    app.indexOf("async function exportCsv()"),
    app.indexOf("async function exportSourceOperations("),
  );
  let exported = "";
  const exportCsv = Function(
    "state", "window", "currentPlanOperations", "PLAN_HEADERS", "operationToRow",
    "csvCell", "downloadBlob", "els", "exportSourceOperations",
    `${exportSource}; return exportCsv;`,
  )(
    {},
    { PlanningWorkflowCore: {} },
    () => [],
    ["OT"],
    (op) => [op.ot],
    (value) => String(value),
    (value) => { exported = value; },
    { exportSnapshotSelect: { value: "snap-1" } },
    () => [{ ot: "200" }, { ot: "300" }],
  );

  await exportCsv();

  assert.match(exported, /200/);
  assert.match(exported, /300/);
});

test("PLAN_HEADERS documenta las columnas del CSV exportado", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const headersSource = app.slice(app.indexOf("const PLAN_HEADERS = ["), app.indexOf("const FIELD_MAP =", app.indexOf("const PLAN_HEADERS = [")));
  const PLAN_HEADERS = Function(`${headersSource}; return PLAN_HEADERS;`)();

assert.deepEqual(PLAN_HEADERS, [
    "NUM", "OT", "PARTE", "DESCRIPCION", "CONTENIDO", "PRIORIDAD", "FECHA_REQ",
    "CANT_TOTAL", "SECUENCIA", "CT", "OPERADOR", "MAQUINA", "HERRAMENTAL",
    "KIT_HERRAMENTAL", "CANT_PENDIENTE", "TIEMPO_CICLO", "TIEMPO_SETUP", "TIEMPO_PROD",
    "FECHA_INICIO", "HORA_INICIO", "FECHA_FIN", "HORA_FIN", "TIPO_INSERCION", "ESTATUS",
    "LOG", "DIAS_SUBCONTRATO", "KIT_PENDIENTE", "AUTO_FROZEN", "HERRAMENTAL_ORIGEN",
    "KIT_ORIGEN", "HERRAMENTAL_DESTINO", "KIT_DESTINO", "COMENTARIO", "PRECIO", "MONTO",
  ]);
});

test("operationToRow calcula PRECIO y MONTO desde la OT cuando la operacion no los trae", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const rowSource = app.slice(
    app.indexOf("function operationToRow("),
    app.indexOf("function scheduledProductionMinutesForExport(", app.indexOf("function operationToRow(")),
  );
  const operationToRow = Function(
    "PLAN_HEADERS", "FIELD_MAP", "scheduledProductionMinutesForExport",
    "effectiveUnitPriceForOt", "amountForOt",
    `${rowSource}; return operationToRow;`,
  )(
    ["PRECIO", "MONTO"],
    { PRECIO: "unitPrice", MONTO: "amount" },
    () => 0,
    () => 12.5,
    () => 250,
  );

  const row = operationToRow({ ot: "100", unitPrice: 10, amount: 200 });
  assert.deepEqual(row, [10, 200]);

  const computed = operationToRow({ ot: "200" });
  assert.deepEqual(computed, [12.5, 250]);
});

test("importJson adopta y limpia operationCatalogWarning", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const importSource = app.slice(
    app.indexOf("function importJson("),
    app.indexOf("function importCsv(", app.indexOf("function importJson(")),
  );
  const importJson = Function(
    "normalizeOperation", "normalizeCapabilityKeys",
    `${importSource}; return importJson;`,
  )((op) => op, (values) => values);

  assert.equal(importJson(JSON.stringify({
    operations: [],
    operationCatalogWarning: "Catalogo no disponible",
  })).operationCatalogWarning, "Catalogo no disponible");
  assert.equal(importJson(JSON.stringify({
    operations: [],
    operationCatalogWarning: "",
  })).operationCatalogWarning, "");
});

test("renderWeekReport ya no incluye el panel de cargas de operadores", async () => {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const reportSource = app.slice(
    app.indexOf("function renderWeekReport()"),
    app.indexOf("function weeklyExecutiveSummary("),
  );

  assert.match(reportSource, /OT que inician/);
  assert.match(reportSource, /Acabado \/ OT que terminan/);
  assert.doesNotMatch(reportSource, /Cargas de operadores/);
  assert.doesNotMatch(reportSource, /weekly-job-panel loads/);
  assert.doesNotMatch(reportSource, /renderReportOperatorLoads/);
  assert.doesNotMatch(reportSource, /loads-table/);
});
