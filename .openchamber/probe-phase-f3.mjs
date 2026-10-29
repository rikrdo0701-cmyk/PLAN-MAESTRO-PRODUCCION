import { chromium } from "playwright";
const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=d6a16c6";
const OUT_DIR = "C:/Users/plane/Downloads/plangit/.openchamber/screenshots";
const SNAP_ID = "8c14a62f-7fc8-419c-b9b8-2d88de977477";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
page.on("console", (m) => { const t = m.text(); if (m.type() === "error") console.log("[console]", t.slice(0, 200)); });

console.log("[F3] Cargando #reportes...");
await page.goto(SITE + "#reportes", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && (state.operations || []).length > 300 && typeof loadPlanSnapshotById === "function", null, { timeout: 240000, polling: 2000 });
await sleep(5000);

const t0 = Date.now();
const loaded = await page.evaluate(async (id) => {
  try {
    const snap = await loadPlanSnapshotById(id, { render: true });
    return { ok: true, rsId: snap?.snapshotId, ops: Array.isArray(snap?.operations) ? snap.operations.length : -1, planStart: snap?.planStart };
  } catch (e) { return { ok: false, err: String(e) }; }
}, SNAP_ID);
console.log(`[F3] loadPlanSnapshotById en ${Date.now() - t0}ms:`, JSON.stringify(loaded));
await sleep(4000);

const rsCheck = await page.evaluate(() => ({ rsId: typeof reportSnapshot !== "undefined" ? reportSnapshot?.snapshotId || "" : "n/a" }));
console.log("[F3] reportSnapshot tras load:", JSON.stringify(rsCheck));

// fijar semana 24/08
await page.evaluate(() => {
  const w = document.getElementById("weekReportStartInput");
  if (w) { w.value = "2026-08-24"; w.dispatchEvent(new Event("change")); }
});
await sleep(4000);

const report = await page.evaluate(() => {
  const text = document.body.innerText;
  const week = document.getElementById("weekReport")?.innerText || "";
  const summary = document.getElementById("weekExecutiveSummary")?.innerText || "";
  const hasSinOTs = text.includes("Sin OTs para esta semana");
  const ops = (reportSnapshot?.operations) ? reportSnapshot.operations : [];
  const minFi = ops.map((o) => o.fechaInicio).filter(Boolean).sort()[0] || null;
  const inWeek = ops.filter((o) => o.fechaInicio && String(o.fechaInicio).slice(0, 10) >= "2026-08-24" && String(o.fechaInicio).slice(0, 10) <= "2026-08-30");
  const otStart = new Set(inWeek.map((o) => o.ot));
  const startPanel = document.querySelector("#weekReport section.weekly-job-panel:nth-of-type(2)")?.innerText || week;
  return {
    rsId: reportSnapshot?.snapshotId || "", selectValue: document.querySelector("#planSnapshotSelect")?.value || "",
    weekInput: document.getElementById("weekReportStartInput")?.value || "",
    hasSinOTs, minFi: minFi ? String(minFi).slice(0, 10) : null,
    planStart: reportSnapshot?.planStart, opsCount: ops.length,
    opsInWeekCount: inWeek.length, distinctOtsInWeek: otStart.size,
    summarySample: summary.slice(0, 200),
    startPanelSample: startPanel.slice(0, 240),
    ot3143InWeek: inWeek.filter((o) => String(o.ot) === "3143").length,
  };
});
console.log("[F3] REPORT:", JSON.stringify(report, null, 2));
await page.screenshot({ path: OUT_DIR + "/e2e-report-week24-8c14.png", fullPage: true });

import fs from "node:fs";
fs.writeFileSync("C:/Users/plane/Downloads/plangit/.openchamber/report-result-f3.json", JSON.stringify({ loaded, rsCheck, report }, null, 2));

await browser.close();
console.log("PHASE-F3-DONE");
