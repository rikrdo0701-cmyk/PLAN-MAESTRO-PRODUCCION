import { chromium } from "playwright";

const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=924cca2#planning";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
await page.goto(SITE, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && (state.operations || []).length > 300, null, { timeout: 240000, polling: 2000 });

const out = await page.evaluate(() => {
  const ops = (state.operations || []).filter(o => o && o.tipoInsercion !== "CAMBIO_HERRAMENTAL");
  const bend = ops.filter(o => (o.ct === "5459" || o.ct === 5459 || o.ct === "5527" || o.ct === 5527));
  const byMaq = {};
  for (const o of bend) {
    const m = String(o.maquina || "").trim() || "(empty)";
    byMaq[m] = (byMaq[m] || 0) + 1;
  }
  const byTipo = {};
  for (const o of bend) {
    const t = String(o.tipoInsercion || "").trim() || "(none)";
    byTipo[t] = (byTipo[t] || 0) + 1;
  }
  const sample = bend.slice(0, 8).map(o => ({
    id: o.id, ot: o.ot, sec: o.secuencia, ct: o.ct,
    maquina: o.maquina, operador: o.operador, tipoInsercion: o.tipoInsercion,
    descripcion: o.descripcion || o.contenido || "",
  }));
  // capability name for 5459 if available
  let cap5459 = null;
  const capList = state.capabilities || state.capabilityList || [];
  const hit = capList.find(c => String(c.ct || c.CT || "") === "5459" || String(c.key || "") === "5459");
  if (hit) cap5459 = hit;
  return {
    totalOps: ops.length,
    bendCount: bend.length,
    bendByMaquina: byMaq,
    bendByTipoInsercion: byTipo,
    sample,
    cap5459,
    machineKeys: (state.machines || []).map(m => m.id || m.machine || m.maquina || JSON.stringify(m)).slice(0, 20),
    capKeys: Object.keys(state.capabilities || state.capabilityList || {}).slice(0, 40),
    matrixKeys: Object.keys(state.matrix || {}).slice(0, 40),
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
