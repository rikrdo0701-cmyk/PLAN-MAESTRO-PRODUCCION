import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.goto("https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=367245a#reportes", { waitUntil: "networkidle", timeout: 90000 });
await page.locator("#refreshSnapshotsBtn").click();
await page.waitForFunction(() => {
  const s = document.querySelector("#planSnapshotSelect");
  return s && s.options.length > 1 && s.value !== "draft";
}, null, { timeout: 240000, polling: 3000 }).catch(() => null);
await page.waitForTimeout(6000);
const out = await page.evaluate(() => {
  const ops = typeof reportSnapshot !== "undefined" && reportSnapshot.operations ? reportSnapshot.operations : [];
  const weekOf = (iso) => {
    if (!iso) return "?";
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const day = dt.getDay() || 7;
    dt.setDate(dt.getDate() - day + 1);
    return dt.toISOString().slice(0, 10);
  };
  const byWeek = {};
  let min = null, max = null, inCurrentWeek = 0, inWeek18 = 0;
  for (const op of ops) {
    const fi = op.fechaInicio || "";
    if (fi) {
      const w = weekOf(fi);
      byWeek[w] = (byWeek[w] || 0) + 1;
      if (!min || fi < min) min = fi;
      if (!max || fi > max) max = fi;
      const ww = weekOf("2026-08-24");
      if (fi >= "2026-08-24" && fi <= "2026-08-30") inCurrentWeek++;
      if (fi >= "2026-08-17" && fi <= "2026-08-23") inWeek18++;
    }
  }
  const filters = typeof state !== "undefined" ? state.reportFilters : null;
  const draftOps = (typeof currentDraftScheduledOperations !== "undefined" ? currentDraftScheduledOperations() : []).map((o) => o.fechaInicio || "");
  const draftWeek = {};
  for (const fi of draftOps) { const w = weekOf(fi); draftWeek[w] = (draftWeek[w] || 0) + 1; }
  return {
    ops: ops.length,
    minFechaInicio: min,
    maxFechaInicio: max,
    byWeek,
    inWeek2026_08_17: inWeek18,
    inWeek2026_08_24: inCurrentWeek,
    reportFilters: filters,
    draftScheduleCount: draftOps.length,
    draftByWeek: draftWeek,
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();