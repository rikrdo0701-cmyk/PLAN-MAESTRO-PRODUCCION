import { chromium } from "playwright";

const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=a3df386#planning";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
await page.goto(SITE, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && (state.operations || []).length > 300, null, { timeout: 240000, polling: 2000 });

const out = await page.evaluate(() => {
  const norm = (v) => String(v || "").trim().toUpperCase();
  const isBend = (o) => (o.ct === "5459" || o.ct === 5459 || o.ct === "5527" || o.ct === 5527);
  const validBend = (m, ct) => Boolean(m) && norm(m) !== "SIN_MAQUINA" && !(String(ct) === "5459" && String(m) === "1");
  const capFor = (o) => {
    const ct = String(o.ct || "SIN_CT").trim();
    const label = String(o.descripcion || o.tipoInsercion || "OPERACION").trim();
    return { ct, key: `${ct}::${norm(label).replace(/\s+/g, "_")}` };
  };
  const bend = (state.operations || []).filter(o => isBend(o) && o.tipoInsercion !== "CAMBIO_HERRAMENTAL");
  const machines = (state.machines || []).filter(m => m.active !== false).map(m => m.id || m.machine || m.maquina).filter(Boolean);
  const matrix = state.matrix || {};
  const operators = new Set((state.operators || []).map(norm));
  const byCause = {};
  const sinMaq = [];
  for (const o of bend) {
    const cap = capFor(o);
    const allowed = matrix[cap.key] || matrix[cap.ct] || [];
    const opCands = allowed.filter((name) => (!operators.size || operators.has(norm(name))));
    let cause;
    if (!opCands.length) cause = "SIN_OPERADOR";
    else {
      const m = String(o.maquina || "").trim();
      let mc;
      if (m && norm(m) !== "SIN_MAQUINA") mc = validBend(m, o.ct) ? [m] : [];
      else mc = machines.filter(x => norm(x) !== "SIN_MAQUINA" && !(String(o.ct) === "5459" && String(x) === "1"));
      if (!mc.length) { cause = "SIN_MAQUINA"; sinMaq.push({ ot: o.ot, sec: o.secuencia, ct: o.ct, maquina: m || "(empty)", capKey: cap.key }); }
      else cause = "OK_OR_CAP";
    }
    byCause[cause] = (byCause[cause] || 0) + 1;
  }
  return { bendCount: bend.length, machinesLoaded: machines, byCause, sinMaqSample: sinMaq.slice(0, 12), sinMaqCount: sinMaq.length };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
