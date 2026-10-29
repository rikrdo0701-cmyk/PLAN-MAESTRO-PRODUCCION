import { chromium } from "playwright";

const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=bb02ab7#planning";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
await page.goto(SITE, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && typeof runPlanningPerformanceDryRun === "function" && (state.operations || []).length > 300, null, { timeout: 240000, polling: 2000 });

const out = await page.evaluate(() => {
  const matrix = state.matrix || {};
  const ops = state.operations || [];
  const kuOps = ops.filter(o => String(o.ct) === "5459");
  const machineVals = Object.values(state.machines || {}).slice(0, 12).map(m => ({ type: m.type, ct: m.ct, active: m.active, nombre: m.nombre }));
  const anyKuMachine = Object.entries(state.machines || {}).filter(([k,m]) => m && (String(m.type).toUpperCase()==="DOBLADO"||String(m.type).toUpperCase()==="BENDING"||(Array.isArray(m.ct)?m.ct.map(String):[String(m.ct||"")]).map(s=>s.toUpperCase()).includes("KU")||String(m.ct)==="5459"));
  return {
    matrixKeys: Object.keys(matrix),
    matrix5459: matrix["5459"],
    matrixKU: matrix["KU"],
    operators: (state.operators || []).slice(0, 10),
    operatorCount: (state.operators || []).length,
    machinesCount: Object.keys(state.machines || {}).length,
    machineValsSample: machineVals,
    anyKuMachineCount: anyKuMachine.length,
    anyKuMachines: anyKuMachine.slice(0, 8).map(([k,m]) => ({ k, type:m.type, ct:m.ct, active:m.active })),
    kuOpCount: kuOps.length,
    kuOpMaquinaValues: [...new Set(kuOps.map(o => o.maquina || ""))].slice(0, 15),
    kuOpSample: kuOps.slice(0, 3).map(o => ({ id:o.id, ot:o.ot, maquina:o.maquina, machine:o.machine })),
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
