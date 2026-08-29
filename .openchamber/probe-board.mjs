import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.goto("https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=367245a#planning", { waitUntil: "networkidle", timeout: 90000 });
await page.waitForFunction(() => {
  return typeof state !== "undefined" && state.planStart && state.operations && state.operations.length > 0;
}, null, { timeout: 240000, polling: 3000 }).catch(() => null);
await page.waitForTimeout(4000);
const out = await page.evaluate(() => {
  const ops = (typeof state !== "undefined" && state.operations) ? state.operations : [];
  const iso = (d) => (d ? String(d).slice(0, 10) : "");
  const weekOf = (d) => {
    if (!d) return null;
    const [y, m, dd] = String(d).slice(0, 10).split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, dd));
    const day = (dt.getUTCDay() + 6) % 7;
    const mon = new Date(dt);
    mon.setUTCDate(dt.getUTCDate() - day);
    return mon.toISOString().slice(0, 10);
  };
  const byWeek = {};
  for (const op of ops) {
    const w = weekOf(op.fechaInicio);
    byWeek[w] = (byWeek[w] || 0) + 1;
  }
  const fi = ops.map((o) => o.fechaInicio).filter(Boolean).sort();
  const ff = ops.map((o) => o.fechaFin).filter(Boolean).sort();
  const csvOts = ["3143", "3144", "3108", "3112", "3124", "3202", "2958"];
  const otProbe = {};
  for (const ot of csvOts) {
    const hits = ops.filter((o) => String(o.ot) === ot && o.fechaInicio);
    otProbe[ot] = {
      count: hits.length,
      minFi: iso(hits.length ? hits.map((h) => h.fechaInicio).sort()[0] : null),
      maxFi: iso(hits.length ? hits.map((h) => h.fechaInicio).sort().slice(-1)[0] : null),
    };
  }
  const inWindow = ops.filter((o) => o.fechaInicio && o.fechaInicio >= "2026-08-28" && o.fechaInicio <= "2026-09-09").length;
  return {
    planStart: state.planStart,
    planEnd: state.planEnd || "",
    reportWeekStart: state.reportWeekStart || "",
    opsCount: ops.length,
    scheduledOtsSize: state.scheduledOts ? state.scheduledOts.size : "n/a",
    excludedOtsSize: state.excludedOts ? state.excludedOts.size : "n/a",
    minFechaInicio: iso(fi[0]),
    maxFechaInicio: iso(fi.slice(-1)[0]),
    minFechaFin: iso(ff[0]),
    maxFechaFin: iso(ff.slice(-1)[0]),
    opsInCsvWindow28ago_09sep: inWindow,
    byWeek,
    otProbe,
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();