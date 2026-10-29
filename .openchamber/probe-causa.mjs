import { chromium } from "playwright";

const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=bb02ab7#planning";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
await page.goto(SITE, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && typeof runPlanningPerformanceDryRun === "function" && (state.operations || []).length > 300, null, { timeout: 240000, polling: 2000 });

const out = await page.evaluate(async () => {
  const ots = [...new Set((state.operations || []).filter(o => o && o.ot && o.tipoInsercion !== "CAMBIO_HERRAMENTAL").map(o => String(o.ot).trim()).filter(Boolean))].slice(0, 140);
  state.selectedOts = ots;
  state.planStart = "2026-08-28";
  const res = await runPlanningPerformanceDryRun({ timeoutMs: 300000, collectStats: true, progressEveryMs: 20000 });
  const analysis = (res && res.metrics && res.metrics.unscheduledAnalysis) || {};
  const details = analysis.details || [];
  const sinMaq = details.filter(d => d.cause === "SIN_MAQUINA_O_HERRAMENTAL_VALIDO");
  // For each, find the op in state and evaluate machineCandidates
  const opsById = new Map((state.operations || []).map(o => [String(o.id), o]));
  return {
    total: analysis.total,
    sinMaqCount: sinMaq.length,
    sinMaq: sinMaq.slice(0, 15).map(d => {
      const op = opsById.get(String(d.operationId)) || {};
      return {
        operationId: d.operationId, ot: d.ot, seq: d.sequence, ct: d.ct,
        machineInDiag: d.machine,
        opMaquina: op.maquina, opMachine: op.machine,
        bending: (typeof isBendingOperation === "function" ? isBendingOperation(op) : "?"),
        cands: (typeof machineCandidates === "function" ? machineCandidates(state, op) : "?"),
        machKeys: Object.keys(state.machines || {}),
        tipoInsercion: op.tipoInsercion, family: op.family, tipoPlan: op.tipoPlan,
      };
    }),
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
