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
  const noMach = ops.filter(o => (typeof machineCandidates === "function" ? machineCandidates(state, o).length === 0 : false));
  return {
    totalOps: ops.length,
    noMachCount: noMach.length,
    sample: noMach.slice(0, 15).map(o => ({
      id: o.id, ot: o.ot, sec: o.secuencia, ct: o.ct, tipo: o.tipoInsercion,
      maquina: o.maquina, herramental: o.herramental,
      bending: (typeof isBendingOperation === "function" ? isBendingOperation(o) : false),
      cands: (typeof machineCandidates === "function" ? machineCandidates(state, o) : "?"),
      cap: o.capacidad || o.capability, assignedMach: o.machine,
      machType: (state.machines && state.machines[o.maquina]) ? (state.machines[o.maquina].type || (state.machines[o.maquina].ct ? "has-ct" : "?")) : "NOT_IN_STATE",
    })),
    machKeysSample: Object.keys(state.machines || {}).slice(0, 25),
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
