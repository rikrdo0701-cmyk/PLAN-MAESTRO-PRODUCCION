import { chromium } from "playwright";

const DEPLOYED = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/#plan";
const RUNS = Number(process.env.RUNS || 3);
const browser = await chromium.launch({ headless: true });
const results = [];
for (let run = 1; run <= RUNS; run++) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on("pageerror", (err) => console.log(`[run ${run} pageerror]`, String(err).slice(0, 200)));
  page.on("console", (msg) => {
    const t = msg.text();
    if (t.includes("maybeRestoreSavedDraftOnBoot")) console.log(`[run ${run} console]`, t.slice(0, 220));
  });
  await page.goto(DEPLOYED, { waitUntil: "load", timeout: 120000 });
  let stable = null;
  for (let i = 0; i < 70; i++) {
    await page.waitForTimeout(5000);
    const info = await page.evaluate(() => {
      const st = typeof state !== "undefined" ? state : null;
      const ops = (st && st.operations) || [];
      return {
        ops: ops.length,
        tool: ops.filter((o) => String(o.tipoInsercion || "").toUpperCase() === "CAMBIO_HERRAMENTAL").length,
        sel: (st && st.selectedOts || []).length,
        restoredFlag: globalThis.__planningRestoredFromServer === true,
        attempted: globalThis.__draftBootRestoreAttempted === true,
      };
    }).catch((e) => ({ ops: 0 }));
    if (info.ops > 300 && info.sel >= 100) { stable = info; break; }
  }
  const final = await page.evaluate(() => {
    const ops = (state.operations || []);
    const source = (typeof reportOperationsSource === "function") ? reportOperationsSource() : [];
    return {
      ops: ops.length,
      tool: ops.filter((o) => String(o.tipoInsercion || "").toUpperCase() === "CAMBIO_HERRAMENTAL").length,
      sel: (state.selectedOts || []).length,
      restoredFlag: globalThis.__planningRestoredFromServer === true,
      attempted: globalThis.__draftBootRestoreAttempted === true,
      sourceOps: source.length,
      toolInSource: source.filter((op) => (typeof isToolChangeReportOperation === "function") ? isToolChangeReportOperation(op) : false).length,
      reportSnapshot: reportSnapshot ? (reportSnapshot.snapshotId || reportSnapshot.id || "?") : "null",
    };
  });
  results.push({ run, stable, final });
  console.log(`[run ${run}]`, JSON.stringify(final));
  await page.close();
}
console.log("=== RESUMEN ===");
for (const r of results) console.log(`run ${r.run}: tool=${r.final.tool} sel=${r.final.sel} sourceOps=${r.final.sourceOps} toolInSource=${r.final.toolInSource} restoredFlag=${r.final.restoredFlag} attempted=${r.final.attempted}`);
await browser.close();