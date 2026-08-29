import { chromium } from "playwright";

const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=bb02ab7#planning";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
await page.goto(SITE, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && typeof runPlanningPerformanceDryRun === "function" && (state.operations || []).length > 300, null, { timeout: 240000, polling: 2000 });

const out = await page.evaluate(() => {
  const ots = [...new Set((state.operations || []).filter(o => o && o.ot && o.tipoInsercion !== "CAMBIO_HERRAMENTAL").map(o => String(o.ot).trim()).filter(Boolean))].slice(0, 140);
  state.selectedOts = ots;
  state.planStart = "2026-08-28";
  const draft = (typeof buildPlanningDraft === "function") ? buildPlanningDraft({ isDryRun: true }) : null;
  const ops = (draft && draft.operations) ? draft.operations : (state.operations || []);
  const bad = ops.filter(o => (o.maquina || o.machine) && (typeof validateMachine === "function" ? !validateMachine(o.maquina || o.machine) : false));
  return {
    totalOps: ops.length,
    badMachCount: bad.length,
    sample: bad.slice(0, 15).map(o => ({
      id: o.id, ot: o.ot, sec: o.secuencia, ct: o.ct, tipo: o.tipoInsercion,
      maquina: o.maquina, machine: o.machine,
      bending: (typeof isBendingOperation === "function" ? isBendingOperation(o) : false),
      validate: (typeof validateMachine === "function" ? validateMachine(o.maquina || o.machine) : "n/a"),
      machEntry: (state.machines && state.machines[o.maquina || o.machine]) ? JSON.stringify(state.machines[o.maquina || o.machine]).slice(0, 120) : "NOT_IN_STATE",
    })),
    machKeys: Object.keys(state.machines || {}).slice(0, 30),
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
