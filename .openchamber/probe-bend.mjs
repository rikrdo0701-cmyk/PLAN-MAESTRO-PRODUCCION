import { chromium } from "playwright";

const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=bb02ab7#planning";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
await page.goto(SITE, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && typeof runPlanningPerformanceDryRun === "function" && (state.operations || []).length > 300, null, { timeout: 240000, polling: 2000 });

const out = await page.evaluate(async () => {
  const ids = ["ns-71","ns-104","ns-118","ns-132","ns-297","ns-328","ns-379","ns-531","ns-566","ns-699","ns-772","ns-850"];
  const opsById = new Map((state.operations || []).map(o => [String(o.id), o]));
  const samples = ids.map(id => {
    const op = opsById.get(id) || {};
    return {
      id, ot: op.ot, sec: op.secuencia, ct: op.ct, tipoInsercion: op.tipoInsercion,
      maquina: op.maquina, machine: op.machine, tipoPlan: op.tipoPlan, family: op.family,
      bending: (typeof isBendingOperation === "function" ? isBendingOperation(op) : "?"),
      ct5459: op.ct === "5459",
      matrixKu: (state.matrix && state.matrix["5459"]) ? state.matrix["5459"].slice(0, 12) : "n/a",
      matrixCap: (state.matrix && state.matrix.KU) ? state.matrix.KU.slice(0, 12) : "n/a",
      machinesSample: Object.keys(state.machines || {}).slice(0, 10),
      KU_machines: Object.entries(state.machines || {}).filter(([k,m]) => m && (String(m.ct).toUpperCase() === "KU" || (Array.isArray(m.ct) && m.ct.map(String).includes("KU")) || (m.type && m.type.toUpperCase()==="DOBLADO") || (m.type && m.type.toUpperCase()==="BENDING"))).map(([k,m]) => ({k, type:m.type, ct:m.ct, active:m.active})).slice(0, 12),
    };
  });
  return { samples };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
