import { chromium } from "playwright";
const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=d6a16c6";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
await page.goto(SITE + "#planning", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && (state.operations || []).length > 300, null, { timeout: 180000, polling: 2000 });
await page.waitForTimeout(5000);
const result = await page.evaluate(() => (async () => {
  const base = await callAppsScript("getPlanSnapshot", "1e0cc75b-ddb9-413b-8e4d-9e78add0aa8c");
  const out = { keys: Object.keys(base || {}).slice(0, 40) };
  out.hasFullState = !!base?.fullState;
  out.summaryOps = Array.isArray(base?.operations) ? base.operations.length : null;
  out.fullStateOps = (base?.fullState && Array.isArray(base.fullState.operations)) ? base.fullState.operations.length : null;
  const week = window.PlanningWorkflowCore.mondayIso("2026-08-28");
  out.week = week;
  const countIn = (ops) => (ops || []).reduce((c, o) => {
    const d = String(o.fechaInicio || "").slice(0, 10);
    return d && window.PlanningWorkflowCore.mondayIso(d) === week ? c + 1 : c;
  }, 0);
  out.summaryInWeek24 = countIn(base?.operations);
  out.fullStateInWeek24 = countIn(base?.fullState?.operations);
  out.operationsStartingInWeek_whole = window.PlanningWorkflowCore.operationsStartingInWeek(base, week);
  out.operationsStartingInWeek_summaryOps = window.PlanningWorkflowCore.operationsStartingInWeek({ operations: base?.operations }, week);
  out.operationsStartingInWeek_fullStateOps = window.PlanningWorkflowCore.operationsStartingInWeek({ fullState: base?.fullState }, week);
  // muestra de ops con mondayIso=08-24 en fullState
  const fsWeek24 = (base?.fullState?.operations || []).filter((o) => { const d = String(o.fechaInicio || "").slice(0, 10); return d && window.PlanningWorkflowCore.mondayIso(d) === week; });
  out.fullStateWeek24Sample = fsWeek24.slice(0, 10).map((o) => ({ ot: o.ot, fi: o.fechaInicio, hi: o.horaInicio, sec: o.secuencia, estatus: o.estatus }));
  out.fullStateMinFi = (base?.fullState?.operations || []).map((o) => String(o.fechaInicio || "").slice(0, 10)).filter(Boolean).sort()[0] || null;
  return out;
})());
console.log(JSON.stringify(result, null, 2));
await browser.close();
console.log("DONE");
