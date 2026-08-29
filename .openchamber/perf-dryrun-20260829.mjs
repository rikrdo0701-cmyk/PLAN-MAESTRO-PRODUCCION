import { chromium } from "playwright";

const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=495afaf#planning";
const budgets = [120000, 300000, 600000];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));
page.on("console", (message) => {
  const text = message.text();
  if (message.type() === "error" || text.includes("[planning dry-run]") || text.includes("[planner-budget")) {
    console.log(`[console.${message.type()}]`, text.slice(0, 1200));
  }
});

const summarize = (result) => ({
  ok: result?.ok,
  aborted: result?.aborted,
  reason: result?.reason || "",
  lastPhase: result?.lastPhase || "",
  elapsedMs: result?.elapsedMs,
  blockers: (result?.blockers || []).map((item) => ({ code: item.code, phase: item.phase || "", message: item.message || "" })).slice(0, 8),
  metrics: result?.metrics ? {
    planStart: result.metrics.planStart,
    selectedOtsCount: result.metrics.selectedOtsCount,
    engineSelectedOtsCount: result.metrics.engineSelectedOtsCount,
    affectedOtsCount: result.metrics.affectedOtsCount,
    readyOtsCount: result.metrics.readyOtsCount,
    inputOperationsCount: result.metrics.inputOperationsCount,
    includedOperationsCount: result.metrics.includedOperationsCount,
    scheduledOperationsCount: result.metrics.scheduledOperationsCount,
    unscheduledOperationsCount: result.metrics.unscheduledOperationsCount,
    scheduledOtsCount: result.metrics.scheduledOtsCount,
    unscheduledOtsCount: result.metrics.unscheduledOtsCount,
    selectedStrategy: result.metrics.selectedStrategy,
    incrementalBaseSnapshotId: result.metrics.incrementalBaseSnapshotId,
    totalMs: result.metrics.totalMs,
    incrementalBaseMs: result.metrics.incrementalBaseMs,
    readinessMs: result.metrics.readinessMs,
    prepareDraftMs: result.metrics.prepareDraftMs,
    schedulePlanMs: result.metrics.schedulePlanMs,
    resultBuildMs: result.metrics.resultBuildMs,
    plannerElapsedMs: result.metrics.plannerElapsedMs,
    plannerLastPhase: result.metrics.plannerLastPhase,
    plannerStrategiesStarted: result.metrics.plannerStrategiesStarted,
    plannerMainLoopIterations: result.metrics.plannerMainLoopIterations,
    plannerAssignmentCandidateEvaluations: result.metrics.plannerAssignmentCandidateEvaluations,
    plannerSlotProbes: result.metrics.plannerSlotProbes,
    plannerSlotProbeSkips: result.metrics.plannerSlotProbeSkips,
    plannerBusyOverlapScans: result.metrics.plannerBusyOverlapScans,
    plannerBusyConflictScans: result.metrics.plannerBusyConflictScans,
    plannerBusyConflictSorts: result.metrics.plannerBusyConflictSorts,
    plannerBusySegmentSorts: result.metrics.plannerBusySegmentSorts,
    plannerToolCatalogLookups: result.metrics.plannerToolCatalogLookups,
    plannerToolCatalogScans: result.metrics.plannerToolCatalogScans,
    plannerOtConfigurationLookups: result.metrics.plannerOtConfigurationLookups,
    plannerBudgetCheckCount: result.metrics.plannerBudgetCheckCount,
    plannerBudgetCheckLimit: result.metrics.plannerBudgetCheckLimit,
    diagnosticsByCode: result.metrics.diagnosticsByCode,
    unscheduledAnalysis: result.metrics.unscheduledAnalysis ? {
      total: result.metrics.unscheduledAnalysis.total,
      byCause: result.metrics.unscheduledAnalysis.byCause,
      capacityOps: result.metrics.unscheduledAnalysis.capacityOps,
      configOps: result.metrics.unscheduledAnalysis.configOps,
    } : undefined,
  } : null,
});

try {
  console.log("[load]", SITE);
  await page.goto(SITE, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForFunction(() => typeof window.runPlanningPerformanceDryRun === "function" && typeof state !== "undefined" && (state.operations || []).length > 300, null, { timeout: 180000, polling: 2000 });
  await page.waitForTimeout(5000);

  const initial = await page.evaluate(() => {
    state.planStart = "2026-08-28";
    if (!Array.isArray(state.selectedOts) || state.selectedOts.length === 0) {
      const selected = new Set((state.operations || [])
        .filter((op) => op.tipoInsercion !== "CAMBIO_HERRAMENTAL")
        .map((op) => String(op.ot || "").trim())
        .filter(Boolean));
      state.selectedOts = [...selected];
    }
    return {
      planStart: state.planStart,
      selectedOts: state.selectedOts.length,
      operations: (state.operations || []).length,
      snapshots: (typeof planSnapshots !== "undefined" && Array.isArray(planSnapshots)) ? planSnapshots.length : null,
    };
  });
  console.log("[initial]", JSON.stringify(initial));

  const results = [];
  for (const timeoutMs of budgets) {
    console.log(`[run] budget=${timeoutMs}`);
    const result = await page.evaluate((budget) => window.runPlanningPerformanceDryRun({
      timeoutMs: budget,
      collectStats: true,
      progressEveryMs: 1000,
    }), timeoutMs);
    const summary = { budgetMs: timeoutMs, ...summarize(result) };
    results.push(summary);
    console.log(`[result ${timeoutMs}]`, JSON.stringify(summary, null, 2));
  }
  console.log("[all-results]", JSON.stringify(results, null, 2));
} catch (error) {
  console.log("[blocked]", String(error?.stack || error?.message || error));
} finally {
  await browser.close();
}
