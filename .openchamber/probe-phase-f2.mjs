import { chromium } from "playwright";
const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=d6a16c6";
const OUT_DIR = "C:/Users/plane/Downloads/plangit/.openchamber/screenshots";
const SNAP_ID = "8c14a62f-7fc8-419c-b9b8-2d88de977477";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
page.on("console", (m) => { const t = m.text(); if (m.type() === "error" || /carg|snapshot|report/i.test(t) && m.type() !== "log") console.log("[console]", t.slice(0, 200)); });

console.log("[F2] Cargando #reportes...");
await page.goto(SITE + "#reportes", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && (state.operations || []).length > 300, null, { timeout: 240000, polling: 2000 });
await sleep(8000);

// asegurar planSnapshots cargado y contiene mi snapshot
const hasIt = await page.evaluate(async (id) => {
  let snaps = typeof planSnapshots !== "undefined" ? planSnapshots : [];
  if (!snaps.length && typeof loadPlanSnapshots === "function") { await loadPlanSnapshots(false).catch(() => {}); }
  snaps = typeof planSnapshots !== "undefined" ? planSnapshots : [];
  const sel = document.querySelector("#planSnapshotSelect");
  const opts = sel ? [...sel.options].map((o) => o.value) : [];
  return { inList: snaps.some((s) => s.snapshotId === id), inSelect: opts.includes(id), total: snaps.length };
}, SNAP_ID);
console.log("[F2] snapshot en lista/select:", JSON.stringify(hasIt));

// seleccionar via select nativo
await page.evaluate((id) => {
  const s = document.querySelector("#planSnapshotSelect");
  if (!s) return { ok: false, reason: "no select" };
  s.value = id;
  s.dispatchEvent(new Event("change"));
  return { ok: true, value: s.value };
}, SNAP_ID);
await sleep(2000);
const selNow = await page.evaluate(() => ({ value: document.querySelector("#planSnapshotSelect")?.value || "", rsId: typeof reportSnapshot !== "undefined" ? reportSnapshot?.snapshotId || "" : "n/a" }));
console.log("[F2] select tras change:", JSON.stringify(selNow));

// esperar reportSnapshot a mi id (hasta 8 min)
let loaded = await page.waitForFunction((id) => typeof reportSnapshot !== "undefined" && reportSnapshot && reportSnapshot.snapshotId === id, SNAP_ID, { timeout: 480000, polling: 4000 }).then(() => true).catch(() => false);
console.log("[F2] reportSnapshot cargado (id coincide)?", loaded);

// fijar semana 24/08
const w = await page.evaluate(() => ({ id: "weekReportStartInput", v: document.getElementById("weekReportStartInput")?.value || "" }));
console.log("[F2] week input:", JSON.stringify(w));
await page.fill("#weekReportStartInput", "2026-08-24");
await page.dispatchEvent("#weekReportStartInput", "change");
await sleep(5000);

const report = await page.evaluate(() => {
  const text = document.body.innerText;
  const week = document.getElementById("weekReport")?.innerText || "";
  const summary = document.getElementById("weekExecutiveSummary")?.innerText || "";
  const hasSinOTs = text.includes("Sin OTs para esta semana");
  const rsId = typeof reportSnapshot !== "undefined" ? reportSnapshot?.snapshotId || "" : "n/a";
  const ops = (reportSnapshot?.operations) ? reportSnapshot.operations : [];
  const minFi = ops.map((o) => o.fechaInicio).filter(Boolean).sort()[0] || null;
  const startPanel = document.querySelector("#weekReport section.weekly-job-panel:nth-of-type(2)")?.innerText || week;
  return {
    rsId, selectValue: document.querySelector("#planSnapshotSelect")?.value || "",
    weekInput: document.getElementById("weekReportStartInput")?.value || "",
    hasSinOTs, minFi: minFi ? String(minFi).slice(0, 10) : null,
    opsCount: ops.length, planStart: reportSnapshot?.planStart,
    summarySample: summary.slice(0, 180),
    startPanelSample: startPanel.slice(0, 220),
  };
});
console.log("[F2] REPORT:", JSON.stringify(report, null, 2));
await page.screenshot({ path: OUT_DIR + "/e2e-report-week24-mysnapshot.png", fullPage: true });

import fs from "node:fs";
fs.writeFileSync("C:/Users/plane/Downloads/plangit/.openchamber/report-result-f2.json", JSON.stringify({ hasIt, selNow, loaded, report }, null, 2));

await browser.close();
console.log("PHASE-F2-DONE");
