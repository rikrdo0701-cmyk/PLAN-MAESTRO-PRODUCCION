import { chromium } from "playwright";
const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=367245a";
const SNAP = "1e0cc75b-ddb9-413b-8e4d-9e78add0aa8c";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
await page.goto(SITE + "#reportes", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && (state.operations || []).length > 300, null, { timeout: 180000, polling: 2000 });
const stats = await page.evaluate(() => (async () => {
  const raw = await callAppsScript("getPlanSnapshot", "1e0cc75b-ddb9-413b-8e4d-9e78add0aa8c");
  const ops = Array.isArray(raw?.operations) ? raw.operations : [];
  const iso = (d) => (d ? String(d).slice(0, 10) : "");
  const dated = ops.filter((o) => o.fechaInicio);
  const undated = ops.length - dated.length;
  const byOt = {};
  for (const o of ops) byOt[String(o.ot)] = (byOt[String(o.ot)] || 0) + 1;
  const datedByOt = {};
  for (const o of dated) datedByOt[String(o.ot)] = (datedByOt[String(o.ot)] || 0) + 1;
  const weekOf = (d) => { if (!d) return null; const [y, m, dd] = String(d).slice(0, 10).split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, dd)); const mon = new Date(dt); mon.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)); return mon.toISOString().slice(0, 10); };
  const byWeek = {}; for (const o of dated) { const w = weekOf(o.fechaInicio); byWeek[w] = (byWeek[w] || 0) + 1; }
  const byWeekAll = {}; for (const o of ops) { if (!o.fechaInicio) continue; const w = weekOf(o.fechaInicio); byWeekAll[w] = (byWeekAll[w] || 0) + 1; }
  const ot3143 = ops.filter((o) => String(o.ot) === "3143").map((o) => ({ fi: iso(o.fechaInicio), hi: o.horaInicio, seq: o.secuencia, desc: (o.descripcion || "").slice(0, 30) }));
  const topOts = Object.entries(byOt).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([ot, n]) => ({ ot, n, dated: datedByOt[ot] || 0 }));
  return { ops: ops.length, dated, undated, topOts, byWeekAll, ot3143 };
})());
console.log(JSON.stringify(stats, null, 2));
await browser.close();
console.log("DONE");