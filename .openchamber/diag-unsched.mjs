import { chromium } from "playwright";

const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=461a594#planning";
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
  const metrics = res?.metrics || {};
  const scheduledIds = new Set();
  for (const op of (state.operations || [])) {
    if (op.fechaInicio && op.operador && op.operador !== "SIN_OPERADOR" && op.fechaFin) scheduledIds.add(op.id);
  }
  const unscheduled = (state.operations || []).filter((op) => !scheduledIds.has(op.id));
  const byOt = {};
  for (const op of unscheduled) byOt[String(op.ot).trim()] = (byOt[String(op.ot).trim()] || 0) + 1;
  const topOts = Object.entries(byOt).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([ot]) => ot);
  const detail = [];
  for (const ot of topOts) {
    const ops = (state.operations || []).filter((op) => String(op.ot).trim() === ot && !scheduledIds.has(op.id));
    for (const op of ops.slice(0, 8)) {
      detail.push({
        ot, id: op.id, sec: op.secuencia, ct: op.ct, tipo: op.tipoInsercion,
        maquina: op.maquina, herramental: op.herramental,
        sub: op.subcontrato, subType: op.subcontractType, subDays: op.subcontractDays,
        pred: op.operacionPredecesora, suc: op.operacionSucesora,
        dur: op.duracion, fechaInicio: op.fechaInicio, finita: op.finita,
        cerrada: op.cerrada, cap: op.capacidad || op.capability,
      });
    }
  }
  return {
    scheduled: scheduledIds.size,
    unscheduled: unscheduled.length,
    topOtCounts: topOts.map((ot) => ({ ot, n: byOt[ot] })),
    detail,
  };
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
