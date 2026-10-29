import { chromium } from "playwright";

const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=a3df386#planning";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
await page.goto(SITE, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && typeof runPlanningPerformanceDryRun === "function" && (state.operations || []).length > 300, null, { timeout: 240000, polling: 2000 });

const out = await page.evaluate(() => {
  const norm = (v) => String(v || "").trim().toUpperCase();
  const isBend = (o) => (o.ct === "5459" || o.ct === 5459 || o.ct === "5527" || o.ct === 5527);
  const ots = [...new Set((state.operations || []).filter(o => o && o.ot && o.tipoInsercion !== "CAMBIO_HERRAMENTAL").map(o => String(o.ot).trim()).filter(Boolean))].slice(0, 140);
  state.selectedOts = ots;
  state.planStart = "2026-08-28";
  const res = runPlanningPerformanceDryRun({ timeoutMs: 260000, collectStats: true, progressEveryMs: 20000 });

  // scheduled bending ops: their assigned machine
  const schedBend = [];
  const unschedBend = [];
  for (const op of (state.operations || [])) {
    if (!isBend(op)) continue;
    const scheduled = op.operador && op.operador !== "SIN_OPERADOR" && op.fechaInicio && op.fechaFin;
    (scheduled ? schedBend : unschedBend).push({ ot: op.ot, sec: op.secuencia, ct: op.ct, maquina: String(op.maquina || "").trim(), operador: op.operador, fechaInicio: op.fechaInicio });
  }
  // distribution of assigned machines among scheduled bending ops
  const schedByMach = {};
  for (const o of schedBend) { const m = o.maquina || "(empty)"; schedByMach[m] = (schedByMach[m] || 0) + 1; }
  const unschedByMach = {};
  for (const o of unschedBend) { const m = o.maquina || "(empty)"; unschedByMach[m] = (unschedByMach[m] || 0) + 1; }
  return {
    scheduledBend: schedBend.length,
    unscheduledBend: unschedBend.length,
    schedBendByMachine: schedByMach,
    unschedBendByMachine: unschedByMach,
    unschedBendSample: unschedBend.slice(0, 12),
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
