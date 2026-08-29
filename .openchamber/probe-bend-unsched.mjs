import { chromium } from "playwright";

const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=1ac4b2d#planning";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));

await page.goto(SITE, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && typeof runPlanningPerformanceDryRun === "function" && (state.operations || []).length > 300, null, { timeout: 180000, polling: 2000 });

const result = await page.evaluate(async () => {
  const ots = [...new Set((state.operations || [])
    .filter((op) => op && op.ot && op.tipoInsercion !== "CAMBIO_HERRAMENTAL")
    .map((op) => String(op.ot).trim())
    .filter(Boolean))].slice(0, 140);
  state.selectedOts = ots;
  state.planStart = "2026-08-28";
  const res = await runPlanningPerformanceDryRun({ timeoutMs: 300000, collectStats: true, progressEveryMs: 15000 });
  const schedSet = new Set((res?.summary?.scheduledOts || []).map((x) => String(x).trim()));
  const unscheduled = (state.operations || []).filter((op) => op && !schedSet.has(String(op.ot).trim()));
  const bend = unscheduled.filter((op) => String(op.ct) === "5459" || String(op.ct) === "5527");
  const byMachine = {};
  for (const op of bend) {
    const m = String(op.maquina || "").trim() || "(empty)";
    byMachine[m] = (byMachine[m] || 0) + 1;
  }
  const sample = bend.slice(0, 8).map((op) => ({
    ot: op.ot, ct: op.ct, maquina: op.maquina,
    tool: op.herramental || op.tool,
    cats: (typeof toolCatalogForOperation === "function") ? toolCatalogForOperation(state, op) : null,
  }));
  return {
    totalUnscheduled: unscheduled.length,
    bendUnscheduled: bend.length,
    byMachine,
    sample,
    metricUnscheduledByCause: res?.metrics?.unscheduledAnalysis?.byCause || {},
  };
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
