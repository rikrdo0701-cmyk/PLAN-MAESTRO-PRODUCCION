import { chromium } from 'playwright';

const url = 'https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=4e870ff';
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
page.setDefaultTimeout(420000);

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.runPlanningPerformanceDryRun === 'function', null, { timeout: 60000 });
await page.waitForTimeout(15000);

const result = await page.evaluate(async () => {
  const dry = await window.runPlanningPerformanceDryRun({ timeoutMs: 300000, collectStats: true, progressEveryMs: 30000 });
  const analysis = dry?.metrics?.unscheduledAnalysis || {};
  const details = Array.isArray(analysis.details) ? analysis.details : [];
  const byCt = {};
  const byMachine = {};
  const byCapability = {};
  const byCause = analysis.byCause || {};
  const topOps = details.slice(0, 20).map((d) => ({
    cause: d.cause,
    ct: d.ct,
    machine: d.machine,
    operators: d.operators,
    effectiveMinutes: d.effectiveMinutes,
    totalAvailableMinutes: d.totalAvailableMinutes,
    capability: d.capability,
  }));
  for (const d of details) {
    byCt[d.ct || ''] = (byCt[d.ct || ''] || 0) + 1;
    byMachine[d.machine || ''] = (byMachine[d.machine || ''] || 0) + 1;
    byCapability[d.capability || ''] = (byCapability[d.capability || ''] || 0) + 1;
  }
  const sortEntries = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 15);
  return {
    ok: dry?.ok,
    aborted: dry?.aborted,
    reason: dry?.reason,
    elapsedMs: dry?.elapsedMs,
    blockersByCode: (dry?.blockers || []).reduce((acc, item) => { acc[item.code || ''] = (acc[item.code || ''] || 0) + 1; return acc; }, {}),
    metrics: {
      selectedOtsCount: dry?.metrics?.selectedOtsCount,
      readyOtsCount: dry?.metrics?.readyOtsCount,
      scheduledOperationsCount: dry?.metrics?.scheduledOperationsCount,
      unscheduledOperationsCount: dry?.metrics?.unscheduledOperationsCount,
      diagnosticsByCode: dry?.metrics?.diagnosticsByCode,
      selectedStrategy: dry?.metrics?.selectedStrategy,
      horizonDays: dry?.metrics?.horizonDays,
      plannerElapsedMs: dry?.metrics?.plannerElapsedMs,
      plannerStrategiesStarted: dry?.metrics?.plannerStrategiesStarted,
      plannerSlotProbes: dry?.metrics?.plannerSlotProbes,
      plannerBusyConflictScans: dry?.metrics?.plannerBusyConflictScans,
      plannerBudgetCheckCount: dry?.metrics?.plannerBudgetCheckCount,
    },
    unscheduled: {
      total: analysis.total,
      byCause,
      capacityOps: analysis.capacityOps,
      configOps: analysis.configOps,
      engineSuspicionCount: Array.isArray(analysis.engineSuspicion) ? analysis.engineSuspicion.length : 0,
      engineSuspicionSample: Array.isArray(analysis.engineSuspicion) ? analysis.engineSuspicion.slice(0, 10) : [],
      byCt: sortEntries(byCt),
      byMachine: sortEntries(byMachine),
      byCapability: sortEntries(byCapability),
      topOps,
    },
  };
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
