import { chromium } from "playwright";
const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=367245a";
const SNAP = "1e0cc75b-ddb9-413b-8e4d-9e78add0aa8c";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
await page.goto(SITE + "#reportes", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && (state.operations || []).length > 300, null, { timeout: 180000, polling: 2000 });
await sleep(6000);

const snap = await page.evaluate(() => (async () => {
  const raw = await callAppsScript("getPlanSnapshot", "1e0cc75b-ddb9-413b-8e4d-9e78add0aa8c");
  const ops = Array.isArray(raw?.operations) ? raw.operations : [];
  const iso = (d) => (d ? String(d).slice(0, 10) : "");
  const fi = ops.map((o) => o.fechaInicio).filter(Boolean).sort();
  const weekOf = (d) => { if (!d) return null; const [y, m, dd] = String(d).slice(0, 10).split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, dd)); const mon = new Date(dt); mon.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)); return mon.toISOString().slice(0, 10); };
  const byWeek = {}; for (const op of ops) { const w = weekOf(op.fechaInicio); byWeek[w] = (byWeek[w] || 0) + 1; }
  return {
    id: raw?.snapshotId, planStart: raw?.planStart, weekStart: raw?.weekStart, version: raw?.version, label: raw?.label,
    ops: ops.length, minFi: iso(fi[0]),
    recentSorted: ops.filter((o) => o.fechaInicio && iso(o.fechaInicio) >= "2026-08-28").sort((a, b) => String(a.fechaInicio).localeCompare(String(b.fechaInicio))).slice(0, 6).map((o) => ({ ot: o.ot, fi: iso(o.fechaInicio), hi: o.horaInicio, sec: o.secuencia, desc: (o.descripcion || "").slice(0, 26) })),
    countByWeek: { "2026-08-17": byWeek["2026-08-17"], "2026-08-24": byWeek["2026-08-24"], "2026-08-31": byWeek["2026-08-31"], "2026-09-07": byWeek["2026-09-07"] },
  };
})());
console.log("SNAPSHOT:", JSON.stringify(snap, null, 2));

// cargar en la UI del reporte
await page.evaluate((id) => {
  const s = document.querySelector("#planSnapshotSelect");
  if (!s) return;
  s.value = id;
  s.dispatchEvent(new Event("change"));
}, "1e0cc75b-ddb9-413b-8e4d-9e78add0aa8c");
let loaded = await page.waitForFunction((id) => typeof reportSnapshot !== "undefined" && reportSnapshot && reportSnapshot.snapshotId === id, "1e0cc75b-ddb9-413b-8e4d-9e78add0aa8c", { timeout: 420000, polling: 3000 }).then(() => true).catch(() => false);
console.log("reportSnapshot cargo:", loaded);
await sleep(6000);
const report = await page.evaluate(() => {
  const ops = (reportSnapshot && Array.isArray(reportSnapshot.operations)) ? reportSnapshot.operations : [];
  const iso = (d) => (d ? String(d).slice(0, 10) : "");
  const fi = ops.map((o) => o.fechaInicio).filter(Boolean).sort();
  const w = document.getElementById("weekReportStartInput");
  const text = document.body.innerText;
  const sinOTs = text.includes("Sin OTs para esta semana");
  const rows = [...document.querySelectorAll("[data-report-week] tr")].map((tr) => (tr.innerText || "").replace(/\s+/g, " ").trim().slice(0, 110)).filter(Boolean).slice(0, 12);
  return { reportSnapshotId: reportSnapshot?.snapshotId, ops: ops.length, minFi: iso(fi[0]), weekInput: w ? w.value : "", sinOTs, rows };
});
console.log("REPORT:", JSON.stringify(report, null, 2));
await page.screenshot({ path: "C:/Users/plane/Downloads/plangit/.openchamber/screenshots/report-1e0cc75b.png", fullPage: true });
await browser.close();
console.log("DONE");