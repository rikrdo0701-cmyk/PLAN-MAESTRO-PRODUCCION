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
  // Build the dry-run draft WITHOUT running the scheduler, to inspect autofill.
  const draft = (typeof buildPlanningDraft === "function") ? buildPlanningDraft({ isDryRun: true }) : null;
  const ops = (draft && draft.operations) ? draft.operations : (state.operations || []);
  const bending = ops.filter(o => (typeof isBendingOperation === "function" ? isBendingOperation(o) : o.ct === "5459"));
  const sinMaq = bending.filter(o => (typeof machineCandidates === "function" ? machineCandidates(state, o).length === 0 : false));
  return {
    draftOps: ops.length,
    bendingCount: bending.length,
    sinMaqCount: sinMaq.length,
    sinMaqSample: sinMaq.slice(0, 12).map(o => ({
      id: o.id, ot: o.ot, sec: o.secuencia, ct: o.ct,
      maquina: o.maquina, herramental: o.herramental, tool: o.tool,
      cands: (typeof machineCandidates === "function" ? machineCandidates(state, o) : "?"),
      validBend: (typeof validBendingMachine === "function" ? validBendingMachine(o.maquina, o.ct) : "n/a"),
      confMach: (typeof getOtConfiguration === "function" ? (getOtConfiguration(state, String(o.ot).trim()) || {}).machine : "n/a"),
    })),
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
