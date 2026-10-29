import { chromium } from "playwright";

const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=1ac4b2d#planning";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
page.on("console", (msg) => {
  const text = msg.text();
  if (text.includes("planning dry-run") || text.includes("planner-budget")) console.log(text.slice(0, 500));
});

await page.goto(SITE, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && typeof runPlanningPerformanceDryRun === "function" && (state.operations || []).length > 300, null, { timeout: 180000, polling: 2000 });

const result = await page.evaluate(async () => {
  const ots = [...new Set((state.operations || [])
    .filter((op) => op && op.ot && op.tipoInsercion !== "CAMBIO_HERRAMENTAL")
    .map((op) => String(op.ot).trim())
    .filter(Boolean))].slice(0, 140);
  state.selectedOts = ots;
  state.planStart = "2026-08-28";
  const started = Date.now();
  const res = await runPlanningPerformanceDryRun({ timeoutMs: 300000, collectStats: true, progressEveryMs: 15000 });
  const metrics = res?.metrics || {};
  const schedSet = new Set((res?.summary?.scheduledOts || []).map((x) => String(x).trim()));
  const unsOts = {};
  for (const op of (state.operations || [])) {
    if (!schedSet.has(String(op.ot).trim())) {
      unsOts[String(op.ot).trim()] = (unsOts[String(op.ot).trim()] || 0) + 1;
    }
  }
  const unscheduledOtBreakdown = Object.entries(unsOts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([ot, n]) => ({ ot, ops: n }));
  return {
    selectedOts: ots.length,
    elapsedMs: res?.elapsedMs || (Date.now() - started),
    ok: res?.ok,
    readyOts: metrics.readyOtsCount,
    scheduled: metrics.scheduledOperationsCount,
    unscheduled: metrics.unscheduledOperationsCount,
    strategy: metrics.selectedStrategy,
    strategiesStarted: metrics.plannerStrategiesStarted,
    aborted: res?.aborted,
    reason: res?.reason,
    lastPhase: metrics.plannerLastPhase || res?.lastPhase,
    plannerElapsedMs: metrics.plannerElapsedMs,
    slotProbes: metrics.plannerSlotProbes,
    candidateEvals: metrics.plannerAssignmentCandidateEvaluations,
    busyScans: metrics.plannerBusyConflictScans,
    toolScans: metrics.plannerToolCatalogScans,
    blockers: res?.blockers,
    unscheduledByCause: metrics.unscheduledAnalysis?.byCause || {},
    diagnosticsByCode: metrics.diagnosticsByCode || {},
    unscheduledAnalysisCount: metrics.unscheduledAnalysis?.total || 0,
    unscheduledSample: Array.isArray(metrics.unscheduledAnalysis?.capacityOps) ? metrics.unscheduledAnalysis.capacityOps.slice(0, 5) : [],
    unscheduledOts: (res?.summary?.unscheduledOts || []).slice(0, 30),
    unscheduledOtsCount: metrics.unscheduledOtsCount,
    unscheduledOtBreakdown,
  };
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
