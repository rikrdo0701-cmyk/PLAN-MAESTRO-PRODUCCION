import { chromium } from "playwright";
const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=d6a16c6";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
await page.goto(SITE + "#planning", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && (state.operations || []).length > 300, null, { timeout: 180000, polling: 2000 });
await page.waitForTimeout(6000);
const result = await page.evaluate(() => (async () => {
  const base = await callAppsScript("getPlanSnapshot", "1e0cc75b-ddb9-413b-8e4d-9e78add0aa8c");
  const week = window.PlanningWorkflowCore.mondayIso("2026-08-28");
  const ops = base?.operations || [];
  const withDates = ops.filter((o) => o.fechaInicio).map((o) => ({ ot: o.ot, fi: String(o.fechaInicio).slice(0, 10), hi: o.horaInicio, sec: o.secuencia, raw: String(o.fechaInicio) }));
  const inWeek24 = withDates.filter((o) => window.PlanningWorkflowCore.mondayIso(o.fi.slice(0, 10)) === "2026-08-24");
  // distinct fechaInicio in week 24
  const dist = {};
  for (const o of withDates) { const w = window.PlanningWorkflowCore.mondayIso(o.fi); dist[w] = (dist[w] || 0) + 1; }
  return {
    week,
    totalOps: ops.length,
    withFechas: withDates.length,
    byMondayWeek: dist,
    inWeek24_28_: inWeek24.slice(0, 20).map((o) => ({ ot: o.ot, fi: o.fi, hi: o.hi, sec: o.sec, raw: o.raw })),
    inWeek24Count: inWeek24.length,
  };
})());
console.log(JSON.stringify(result, null, 2));
await browser.close();
console.log("DONE");
