import { chromium } from "playwright";

const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=495afaf#planning";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));

const pick = (result) => ({
  ok: result?.ok,
  aborted: result?.aborted,
  reason: result?.reason || "",
  lastPhase: result?.lastPhase || "",
  elapsedMs: result?.elapsedMs,
  metrics: result?.metrics ? {
    planStart: result.metrics.planStart,
    selectedOtsCount: result.metrics.selectedOtsCount,
    readyOtsCount: result.metrics.readyOtsCount,
    inputOperationsCount: result.metrics.inputOperationsCount,
    includedOperationsCount: result.metrics.includedOperationsCount,
    scheduledOperationsCount: result.metrics.scheduledOperationsCount,
    unscheduledOperationsCount: result.metrics.unscheduledOperationsCount,
    scheduledOtsCount: result.metrics.scheduledOtsCount,
    unscheduledOtsCount: result.metrics.unscheduledOtsCount,
    selectedStrategy: result.metrics.selectedStrategy,
    totalMs: result.metrics.totalMs,
    schedulePlanMs: result.metrics.schedulePlanMs,
    plannerElapsedMs: result.metrics.plannerElapsedMs,
    plannerLastPhase: result.metrics.plannerLastPhase,
    plannerStrategiesStarted: result.metrics.plannerStrategiesStarted,
    plannerMainLoopIterations: result.metrics.plannerMainLoopIterations,
    plannerAssignmentCandidateEvaluations: result.metrics.plannerAssignmentCandidateEvaluations,
    plannerSlotProbes: result.metrics.plannerSlotProbes,
    plannerBusyOverlapScans: result.metrics.plannerBusyOverlapScans,
    plannerBusyConflictScans: result.metrics.plannerBusyConflictScans,
    plannerBusyConflictSorts: result.metrics.plannerBusyConflictSorts,
    plannerBusySegmentSorts: result.metrics.plannerBusySegmentSorts,
    plannerToolCatalogLookups: result.metrics.plannerToolCatalogLookups,
    plannerToolCatalogScans: result.metrics.plannerToolCatalogScans,
    plannerOtConfigurationLookups: result.metrics.plannerOtConfigurationLookups,
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
  await page.goto(SITE, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForFunction(() => typeof window.runPlanningPerformanceDryRun === "function" && typeof state !== "undefined" && (state.operations || []).length > 300, null, { timeout: 180000, polling: 2000 });
  await page.waitForTimeout(5000);
  const initial = await page.evaluate(() => {
    state.planStart = "2026-08-28";
    if (!Array.isArray(state.selectedOts) || state.selectedOts.length === 0) {
      state.selectedOts = [...new Set((state.operations || [])
        .filter((op) => op.tipoInsercion !== "CAMBIO_HERRAMENTAL")
        .map((op) => String(op.ot || "").trim())
        .filter(Boolean))];
    }
    return { planStart: state.planStart, selectedOts: state.selectedOts.length, operations: (state.operations || []).length };
  });
  console.log("[initial]", JSON.stringify(initial));
  const result = await page.evaluate(() => window.runPlanningPerformanceDryRun({ timeoutMs: 600000, collectStats: true, progressEveryMs: 60000 }));
  console.log("[result]", JSON.stringify(pick(result), null, 2));
} catch (error) {
  console.log("[blocked]", String(error?.stack || error?.message || error));
} finally {
  await browser.close();
}
