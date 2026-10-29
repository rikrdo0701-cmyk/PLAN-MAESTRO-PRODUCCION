import { chromium } from "playwright";

const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=924cca2#planning";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
await page.goto(SITE, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && typeof runPlanningPerformanceDryRun === "function" && (state.operations || []).length > 300, null, { timeout: 240000, polling: 2000 });

const out = await page.evaluate(() => {
  // pristine snapshot of bending ops
  const bend = (state.operations || []).filter(o => (o.ct === "5459" || o.ct === 5459 || o.ct === "5527" || o.ct === 5527) && o.tipoInsercion !== "CAMBIO_HERRAMENTAL");
  const snap = {};
  for (const o of bend) {
    snap[o.id] = { ot: o.ot, sec: o.secuencia, ct: o.ct, maquina: String(o.maquina || "").trim(), operador: o.operador };
  }
  const machinesAtStart = (state.machines || []).map(m => m.id || m.machine || m.maquina).filter(Boolean);
  const matrix5459AtStart = (state.matrix || {})["5459"] || [];

  // run dry-run
  const ots = [...new Set((state.operations || []).filter(o => o && o.ot && o.tipoInsercion !== "CAMBIO_HERRAMENTAL").map(o => String(o.ot).trim()).filter(Boolean))].slice(0, 140);
  state.selectedOts = ots;
  state.planStart = "2026-08-28";
  const res = runPlanningPerformanceDryRun({ timeoutMs: 260000, collectStats: true, progressEveryMs: 20000 });

  // which bending ops ended unscheduled?
  const scheduledIds = new Set();
  for (const op of (state.operations || [])) {
    if (op.operador && op.operador !== "SIN_OPERADOR" && op.fechaInicio && op.fechaFin) scheduledIds.add(op.id);
  }
  const unschedBend = [];
  for (const o of bend) {
    if (!scheduledIds.has(o.id)) {
      const s = snap[o.id] || {};
      unschedBend.push({ id: o.id, ot: s.ot, ct: s.ct, pristineMaquina: s.maquina, pristineOperador: s.operador, finalMaquina: String(o.maquina || "").trim() });
    }
  }
  const byMaq = {};
  for (const u of unschedBend) { const m = u.pristineMaquina || "(empty)"; byMaq[m] = (byMaq[m] || 0) + 1; }
  return {
    totalBend: bend.length,
    unschedBendCount: unschedBend.length,
    unschedBendByPristineMaquina: byMaq,
    machinesAtStart,
    matrix5459AtStart,
    sampleUnsched: unschedBend.slice(0, 12),
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
