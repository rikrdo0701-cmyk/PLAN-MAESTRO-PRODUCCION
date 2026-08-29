import { chromium } from "playwright";

const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=ea24050#planning";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));

await page.goto(SITE, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && typeof runPlanningPerformanceDryRun === "function" && (state.operations || []).length > 300, null, { timeout: 180000, polling: 2000 });

const result = await page.evaluate(async () => {
  const probeOts = ["3295", "3098", "3186"];
  const out = {};
  for (const ot of probeOts) {
    const ops = (state.operations || []).filter((op) => String(op.ot).trim() === ot);
    out[ot] = ops.slice(0, 12).map((op) => ({
      id: op.id,
      ct: op.ct,
      tipo: op.tipoInsercion,
      maquina: op.maquina,
      herramental: op.herramental,
      subcontrato: op.subcontrato,
      subDays: op.subcontratoDias || op.diasSubcontrato,
      duracion: op.duracion,
      fechaInicio: op.fechaInicio,
      predecesora: op.operacionPredecesora,
      sucesora: op.operacionSucesora,
      cerrada: op.cerrada,
    }));
  }
  const machines = (state.machines || []).map((m) => ({ id: m.id || m.machine || m.maquina, active: m.active, ct: m.ct || m.codigoTrabajo }));
  return { out, machineCount: machines.length, machines: machines.slice(0, 30) };
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
