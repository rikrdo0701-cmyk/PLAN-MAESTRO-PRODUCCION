import { chromium } from "playwright";
import crypto from "node:crypto";
const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=d6a16c6";
const OUT_DIR = "C:/Users/plane/Downloads/plangit/.openchamber/screenshots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NEW_UUID = crypto.randomUUID();
console.log("[E] nuevo snapshotId a crear:", NEW_UUID);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
page.on("console", (m) => { const t = m.text(); if (m.type() === "error") console.log("[console]", t.slice(0, 200)); });

console.log("[E] Cargando #planning...");
await page.goto(SITE + "#planning", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && (state.operations || []).length > 300, null, { timeout: 240000, polling: 2000 });
await sleep(3000);

// generar plan + aplicar a state
const gen = await page.evaluate(async () => {
  const ops = state.operations || [];
  const originalSelectedOts = [...new Set(ops.filter((o) => o.tipoInsercion !== "CAMBIO_HERRAMENTAL").map((o) => String(o.ot)))];
  state.selectedOts = originalSelectedOts;
  state.planStart = "2026-08-28";
  const result = await window.PlannerCore.schedulePlan({ ...state, selectedOts: originalSelectedOts }, {
    planStart: "2026-08-28", horizonDays: Number(state.horizonDays) || 5,
    executionTime: new Date().toISOString(), respectPlanStart: true, baseSnapshot: null,
    affectedOts: originalSelectedOts, timeBudgetMs: 120000, collectStats: true,
    progressEveryMs: 300, onProgress: () => {}, onYield: () => new Promise((r) => setTimeout(r, 0)),
  });
  Object.assign(state, result);
  state.selectedOts = originalSelectedOts;
  if (typeof invalidateCurrentPlanOperationsCache === "function") invalidateCurrentPlanOperationsCache();
  const cur = (typeof currentPlanOperations === "function") ? currentPlanOperations() : [];
  const cOps = Array.isArray(cur) ? cur : [];
  const minFi = cOps.map((o) => o.fechaInicio).filter(Boolean).sort()[0] || null;
  const ot3143 = cOps.filter((o) => String(o.ot) === "3143" && String(o.fechaInicio).slice(0, 10) === "2026-08-28").map((o) => ({ fi: o.fechaInicio, hi: o.horaInicio, sec: o.secuencia }));
  return {
    selectedOts: state.selectedOts.length,
    currentPlanOps: cOps.length,
    scheduled: state.lastSchedule?.scheduled,
    minFi: minFi ? String(minFi).slice(0, 10) : null,
    opsCount: state.operations.length,
    ot3143,
  };
});
console.log("[E] plan generado:", JSON.stringify(gen));

// construir payload y savePlanSnapshot
const saved = await page.evaluate(async (uuid) => {
  const payload = {
    snapshotId: uuid,
    planStart: state.planStart,
    weekStart: "2026-08-24",
    horizonDays: Number(state.horizonDays) || 5,
    selectedOts: (state.selectedOts || []),
    operations: (typeof currentPlanOperations === "function") ? currentPlanOperations() : (state.operations || []),
    workOrders: state.workOrders || [],
    articleConfigurations: state.articleConfigurations || {},
    lastSchedule: state.lastSchedule || null,
    planStatus: "PUBLICADO",
    revision: Number(state.revision || 0),
    generatedAt: new Date().toISOString(),
  };
  let res;
  let err = null;
  try {
    res = await callAppsScript("savePlanSnapshot", payload);
  } catch (e) { err = String(e); }
  return { result: res || null, error: err, payloadOps: Array.isArray(payload.operations) ? payload.operations.length : -1 };
}, NEW_UUID);
console.log("[E] savePlanSnapshot:", JSON.stringify(saved, null, 2));
await page.screenshot({ path: OUT_DIR + "/e2e-snapshot-saved.png" });

if (!saved.result && saved.error) {
  await browser.close();
  console.log("PHASE-E-FAILED-SAVE");
  process.exit(3);
}

// confirmar en listPlanSnapshots
const listed = await page.evaluate(async (uuid) => {
  const res = await callAppsScript("listPlanSnapshots");
  const arr = Array.isArray(res) ? res : [];
  const mine = arr.find((s) => s.snapshotId === uuid) || null;
  const recent = arr.filter((s) => /^[a-f0-9-]{36}$/i.test(String(s.snapshotId || "")) && Date.parse(s.generatedAt) > Date.now() - 10 * 60000).sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt)).slice(0, 3);
  return {
    total: arr.length,
    mine: mine ? { id: mine.snapshotId, week: mine.weekStart, start: mine.planStart, ops: mine.operations, gen: mine.generatedAt } : null,
    recent: recent.map((s) => ({ id: s.snapshotId, week: s.weekStart, start: s.planStart, ops: s.operations, gen: s.generatedAt })),
  };
}, NEW_UUID);
console.log("[E] confirmado en listPlanSnapshots:", JSON.stringify(listed, null, 2));

import fs from "node:fs";
fs.writeFileSync("C:/Users/plane/Downloads/plangit/.openchamber/save-result.json", JSON.stringify({ uuid: NEW_UUID, gen, saved, listed }, null, 2));

await browser.close();
console.log("PHASE-E-DONE");
