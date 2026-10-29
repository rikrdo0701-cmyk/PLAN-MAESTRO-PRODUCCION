import { chromium } from "playwright";
const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=d6a16c6";
const OUT_DIR = "C:/Users/plane/Downloads/plangit/.openchamber/screenshots";
const SNAP_ID = "8c14a62f-7fc8-419c-b9b8-2d88de977477";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
page.on("console", (m) => { const t = m.text(); if (m.type() === "error") console.log("[console]", t.slice(0, 200)); });

console.log("[F] Cargando #reportes...");
await page.goto(SITE + "#reportes", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && (state.operations || []).length > 300, null, { timeout: 240000, polling: 2000 });
await sleep(6000);

// Cargar snapshot
const loadInfo = await page.evaluate(async (id) => {
  if (typeof callAppsScript !== "function") return { fn: "no-global" };
  const raw = await callAppsScript("getPlanSnapshot", id);
  const ops = Array.isArray(raw?.operations) ? raw.operations : [];
  const minFi = ops.map((o) => o.fechaInicio).filter(Boolean).sort()[0] || null;
  const weekOf = (d) => { if (!d) return null; const [y, m, dd] = String(d).slice(0, 10).split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, dd)); const mon = new Date(dt); mon.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)); return mon.toISOString().slice(0, 10); };
  const byWeek = {}; for (const op of ops) { const w = weekOf(op.fechaInicio); byWeek[w] = (byWeek[w] || 0) + 1; }
  return {
    id: raw?.snapshotId, planStart: raw?.planStart, weekStart: raw?.weekStart,
    ops: ops.length, minFi: minFi ? String(minFi).slice(0, 10) : null,
    byWeek: { "2026-08-17": byWeek["2026-08-17"], "2026-08-24": byWeek["2026-08-24"], "2026-08-28": byWeek["2026-08-28"], "2026-08-31": byWeek["2026-08-31"], "2026-09-07": byWeek["2026-09-07"] },
    opsInWeek24_30: ops.filter((o) => o.fechaInicio && String(o.fechaInicio).slice(0, 10) >= "2026-08-24" && String(o.fechaInicio).slice(0, 10) <= "2026-08-30").length,
  };
}, SNAP_ID);
console.log("[F] snapshot cargado (getPlanSnapshot):", JSON.stringify(loadInfo, null, 2));

// cargar en la UI del reporte via select
await page.evaluate((id) => {
  const s = document.querySelector("#planSnapshotSelect");
  if (!s) return;
  s.value = id;
  s.dispatchEvent(new Event("change"));
}, SNAP_ID);
let loaded = await page.waitForFunction((id) => typeof reportSnapshot !== "undefined" && reportSnapshot && reportSnapshot.snapshotId === id, SNAP_ID, { timeout: 420000, polling: 3000 }).then(() => true).catch(() => false);
console.log("[F] reportSnapshot cargo via select:", loaded);
await sleep(8000);

// fijar semana del reporte a lunes 24/08
const weekSet = await page.evaluate(() => {
  const w = document.getElementById("weekReportStartInput") || document.querySelector("input[type='date']");
  if (!w) return { ok: false, reason: "no week input" };
  const id = w.id;
  return { ok: true, id, value: w.value };
});
console.log("[F] week input:", JSON.stringify(weekSet));
if (weekSet.ok) {
  await page.fill(`#${weekSet.id}`, "2026-08-24");
  await page.dispatchEvent(`#${weekSet.id}`, "change");
  await sleep(4000);
}

// renderizar y leer reporte
const report = await page.evaluate(() => {
  const text = document.body.innerText;
  const week = document.getElementById("weekReport")?.innerText || "";
  const summary = document.getElementById("weekExecutiveSummary")?.innerText || "";
  const hasSinOTs = text.includes("Sin OTs para esta semana");
  const hasNoPlan = text.includes("No hay un plan publicado cargado");
  // filas de OT que inician
  const startPanelSel = [document.querySelector("#weekReport section.weekly-job-panel:nth-of-type(2)"), document.querySelector("#weekReport")];
  const startPanel = (startPanelSel.find(Boolean)?.innerText || "");
  const startRows = [...document.querySelectorAll("#weekReport tr")].map((tr) => (tr.innerText || "").replace(/\s+/g, " ").trim().slice(0, 100)).filter(Boolean);
  // conteo por tipo (aproximado por paneles/etiquetas)
  const ops = (reportSnapshot?.operations) ? reportSnapshot.operations : [];
  const inWeek = ops.filter((o) => o.fechaInicio && String(o.fechaInicio).slice(0, 10) >= "2026-08-24" && String(o.fechaInicio).slice(0, 10) <= "2026-08-30");
  const otStart = new Set(inWeek.map((o) => o.ot));
  const operatorText = document.getElementById("operatorReport")?.innerText || "";
  const operatorRows = document.querySelector("#operatorReport tbody")?.children.length || 0;
  return {
    reportSnapshotId: reportSnapshot?.snapshotId,
    selectValue: document.querySelector("#planSnapshotSelect")?.value || "",
    weekInputValue: document.getElementById("weekReportStartInput")?.value || "",
    hasSinOTs, hasNoPlan,
    summarySample: summary.slice(0, 300),
    weekSample: week.slice(0, 300),
    startPanelSample: startPanel.slice(0, 300),
    startRowsSample: startRows.slice(0, 10),
    opsInWeekCount: inWeek.length,
    distinctOtsInWeek: otStart.size,
    operatorRows, operatorSample: operatorText.slice(0, 200),
  };
});
console.log("[F] REPORT:", JSON.stringify(report, null, 2));

await page.screenshot({ path: OUT_DIR + "/e2e-report-week24.png", fullPage: true });

import fs from "node:fs";
fs.writeFileSync("C:/Users/plane/Downloads/plangit/.openchamber/report-result.json", JSON.stringify({ loadInfo, report }, null, 2));

await browser.close();
console.log("PHASE-F-DONE");
