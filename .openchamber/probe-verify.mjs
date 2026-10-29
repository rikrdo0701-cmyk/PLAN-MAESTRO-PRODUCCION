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
  const validBend = (m, ct) => Boolean(m) && norm(m) !== "SIN_MAQUINA" && !(String(ct) === "5459" && String(m) === "1");
  const snap = {};
  for (const o of (state.operations || [])) if (isBend(o)) snap[o.id] = { ot: o.ot, sec: o.secuencia, ct: o.ct, pristine: String(o.maquina || "").trim(), catalogToolMachine: (typeof toolCatalogForOperation === "function" ? (toolCatalogForOperation(state, o) || {}).machine : "n/a") };

  const ots = [...new Set((state.operations || []).filter(o => o && o.ot && o.tipoInsercion !== "CAMBIO_HERRAMENTAL").map(o => String(o.ot).trim()).filter(Boolean))].slice(0, 140);
  state.selectedOts = ots;
  state.planStart = "2026-08-28";
  runPlanningPerformanceDryRun({ timeoutMs: 260000, collectStats: true, progressEveryMs: 20000 });

  const rows = [];
  for (const op of (state.operations || [])) {
    if (!isBend(op)) continue;
    const s = snap[op.id] || {};
    const finalM = String(op.maquina || "").trim();
    const scheduled = op.operador && op.operador !== "SIN_OPERADOR" && op.fechaInicio && op.fechaFin;
    const mc = (finalM && norm(finalM) !== "SIN_MAQUINA") ? (validBend(finalM, op.ct) ? [finalM] : []) : (state.machines || []).map(m => m.id || m.machine || m.maquina).filter(Boolean).filter(x => norm(x) !== "SIN_MAQUINA" && !(String(op.ct) === "5459" && String(x) === "1"));
    if (!mc.length) {
      rows.push({ ot: op.ot, sec: op.secuencia, ct: op.ct, pristineMaq: s.pristine, finalMaq: finalM, catalogToolMachine: s.catalogToolMachine, scheduled: !!scheduled, operador: op.operador });
    }
  }
  return { sinMaqCount: rows.length, sinMaqSample: rows.slice(0, 12) };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
