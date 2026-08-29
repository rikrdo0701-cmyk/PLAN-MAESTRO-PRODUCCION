import { chromium } from "playwright";

const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=1ac4b2d#planning";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));

await page.goto(SITE, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && typeof runPlanningPerformanceDryRun === "function" && (state.operations || []).length > 300, null, { timeout: 180000, polling: 2000 });

const result = await page.evaluate(async () => {
  const ots = [...new Set((state.operations || [])
    .filter((op) => op && op.ot && op.tipoInsercion !== "CAMBIO_HERRAMENTAL")
    .map((op) => String(op.ot).trim())
    .filter(Boolean))].slice(0, 140);
  state.selectedOts = ots;
  state.planStart = "2026-08-28";
  const res = await runPlanningPerformanceDryRun({ timeoutMs: 300000, collectStats: true, progressEveryMs: 15000 });
  const schedSet = new Set((res?.summary?.scheduledOts || []).map((x) => String(x).trim()));
  const unscheduled = (state.operations || []).filter((op) => op && !schedSet.has(String(op.ot).trim()));
  const bend = unscheduled.filter((op) => String(op.ct) === "5459" || String(op.ct) === "5527");
  const emptyBend = bend.filter((op) => !String(op.maquina || "").trim() || String(op.maquina).trim().toUpperCase() === "SIN_MAQUINA");

  const out = {
    machinesCount: (state.machines || []).length,
    machinesSample: (state.machines || []).slice(0, 6).map((m) => ({ id: m.id || m.machine || m.maquina, active: m.active })),
    fnExists: typeof machineCandidates === "function",
    validBendingFn: typeof validBendingMachine === "function",
    tests: [],
  };
  // test machineCandidates on a few empty bending ops
  for (const op of emptyBend.slice(0, 6)) {
    let mc = [];
    try { mc = machineCandidates(state, op); } catch (e) { mc = ["ERR:" + e.message]; }
    let vb = "n/a";
    try { vb = validBendingMachine(op.maquina, op.ct); } catch (e) { vb = "ERR:" + e.message; }
    out.tests.push({ ot: op.ot, ct: op.ct, maquina: op.maquina, machineCandidates: mc, validBendingMachine: vb });
  }
  return out;
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
