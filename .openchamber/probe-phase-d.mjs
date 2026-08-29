import { chromium } from "playwright";
const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=d6a16c6";
const OUT_DIR = "C:/Users/plane/Downloads/plangit/.openchamber/screenshots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", async (d) => { console.log("[DIALOG]", d.message().slice(0, 120)); await d.accept().catch(() => null); });
page.on("console", (m) => { const t = m.text(); if (/PUB|planner|guardado|publicad/i.test(t) && m.type() !== "log") console.log("[console]", t.slice(0, 200)); });

console.log("[D] Cargando #planning...");
await page.goto(SITE + "#planning", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && (state.operations || []).length > 300, null, { timeout: 240000, polling: 2000 });
await sleep(3000);

// seed + direct schedule ONCE + aplicar a state
const run = await page.evaluate(async () => {
  const ops = state.operations || [];
  const originalSelectedOts = [...new Set(ops.filter((o) => o.tipoInsercion !== "CAMBIO_HERRAMENTAL").map((o) => String(o.ot)))];
  state.selectedOts = originalSelectedOts;
  state.planStart = "2026-08-28";
  const readyOts = originalSelectedOts;
  const result = await window.PlannerCore.schedulePlan({ ...state, selectedOts: readyOts }, {
    planStart: "2026-08-28",
    horizonDays: Number(state.horizonDays) || 5,
    executionTime: new Date().toISOString(),
    respectPlanStart: true,
    baseSnapshot: null,
    affectedOts: readyOts,
    timeBudgetMs: 120000,
    collectStats: true,
    progressEveryMs: 300,
    onProgress: () => {},
    onYield: () => new Promise((r) => setTimeout(r, 0)),
  });
  const rOps = result?.operations ? result.operations : [];
  const minFi = rOps.map((o) => o.fechaInicio).filter(Boolean).sort()[0] || null;
  const on0828 = rOps.filter((o) => o.fechaInicio && String(o.fechaInicio).slice(0, 10) >= "2026-08-28" && String(o.fechaInicio).slice(0, 10) < "2026-08-29").length;
  const ot3143 = rOps.filter((o) => String(o.ot) === "3143" && String(o.fechaInicio).slice(0, 10) === "2026-08-28").map((o) => ({ fi: o.fechaInicio, hi: o.horaInicio, sec: o.secuencia }));
  // aplicar a state
  Object.assign(state, result);
  state.selectedOts = originalSelectedOts;
  if (typeof invalidateCurrentPlanOperationsCache === "function") invalidateCurrentPlanOperationsCache();
  const current = (typeof currentPlanOperations === "function") ? currentPlanOperations() : [];
  const cOps = Array.isArray(current) ? current : [];
  const cMinFi = cOps.map((o) => o.fechaInicio).filter(Boolean).sort()[0] || null;
  const cOn0828 = cOps.filter((o) => o.fechaInicio && String(o.fechaInicio).slice(0, 10) >= "2026-08-28" && String(o.fechaInicio).slice(0, 10) < "2026-08-29").length;
  return {
    readyOts: readyOts.length,
    resultOps: rOps.length,
    scheduled: result.lastSchedule?.scheduled,
    unscheduled: result.lastSchedule?.unscheduled,
    minFi: minFi ? String(minFi).slice(0, 10) : null,
    on0828, ot3143,
    stateOps: state.operations.length,
    currentPlanOps: cOps.length,
    cMinFi: cMinFi ? String(cMinFi).slice(0, 10) : null,
    cOn0828,
    draftVersion: state.draftVersionId,
  };
});
console.log("[D] run:", JSON.stringify(run, null, 2));
await page.screenshot({ path: OUT_DIR + "/e2e-direct-applied.png" });

// Publicar via boton real
console.log("[D] esperando boton Publicar habilitado...");
await page.waitForFunction(() => { const b = document.querySelector("#publishPlanBtn"); return b && !b.disabled; }, null, { timeout: 90000, polling: 2000 }).catch(() => {});
const pubState = await page.evaluate(() => ({ disabled: document.querySelector("#publishPlanBtn")?.disabled, text: document.querySelector("#publishPlanBtn")?.textContent.trim().slice(0, 40) }));
console.log("[D] publicar btn:", JSON.stringify(pubState));

console.log("[D] click en Publicar...");
await page.evaluate(() => document.querySelector("#publishPlanBtn").click());
await sleep(2500);
let dlg = await page.evaluate(() => {
  const d = document.querySelector("#planningDialog");
  return d ? { open: d.open, title: document.querySelector("#planningDialogTitle")?.textContent, confirm: document.querySelector("#planningDialogConfirm")?.textContent, hasTextarea: !!d.querySelector("textarea[name='publication_reason']") } : null;
});
console.log("[D] dialog:", JSON.stringify(dlg));

if (dlg && dlg.open) {
  const hasTextarea = await page.evaluate(() => !!document.querySelector("#planningDialog textarea[name='publication_reason']"));
  if (hasTextarea) {
    await page.fill("#planningDialog textarea[name='publication_reason']", "E2E post-fix d6a16c6: validar re-ancla planStart=2026-08-28 y reporte semana 24/08");
  }
  await page.click("#planningDialogConfirm");
  console.log("[D] confirm clickeado");
} else {
  console.log("[D] no dialog de motivo; verificando toast");
}

console.log("[D] esperando publicacion en backend...");
let newSnap = null;
const t0 = Date.now();
while (Date.now() - t0 < 300000) {
  await sleep(6000);
  newSnap = await page.evaluate(() => {
    const snaps = typeof planSnapshots !== "undefined" ? planSnapshots : [];
    const fresh = snaps.filter((x) => x.snapshotId !== "draft" && Date.parse(x.generatedAt) > Date.now() - 30 * 60000).sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt));
    return fresh[0] || null;
  });
  if (newSnap) break;
}
if (!newSnap) {
  await page.click("#refreshSnapshotsBtn").catch(() => {});
  await sleep(20000);
  newSnap = await page.evaluate(() => { const s = typeof planSnapshots !== "undefined" ? planSnapshots : []; return s.filter((x) => x.snapshotId !== "draft" && Date.parse(x.generatedAt) > Date.now() - 30 * 60000).sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))[0] || null; });
}
const toast = await page.evaluate(() => document.querySelector("#toast")?.textContent || "");
console.log("[D] toast:", JSON.stringify(toast));
console.log("[D] nuevo snapshot:", JSON.stringify(newSnap && { id: newSnap.snapshotId, week: newSnap.weekStart, start: newSnap.planStart, ops: newSnap.operations, gen: newSnap.generatedAt, status: newSnap.status }));
await page.screenshot({ path: OUT_DIR + "/e2e-published.png" });

const listed = await page.evaluate(async () => {
  if (typeof callAppsScript !== "function") return { fn: "no-global" };
  const res = await callAppsScript("listPlanSnapshots");
  const arr = Array.isArray(res) ? res : [];
  const recent = arr.filter((s) => /^[a-f0-9-]{36}$/i.test(String(s.snapshotId || "")) && Date.parse(s.generatedAt) > Date.now() - 30 * 60000).sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt)).slice(0, 3).map((s) => ({ id: s.snapshotId, week: s.weekStart, start: s.planStart, ops: s.operations, gen: s.generatedAt }));
  return { total: arr.length, recent };
});
console.log("[D] listPlanSnapshots confirmacion:", JSON.stringify(listed, null, 2));

import fs from "node:fs";
fs.writeFileSync("C:/Users/plane/Downloads/plangit/.openchamber/publish-result.json", JSON.stringify({ run, pubState, toast, newSnap, listed }, null, 2));

await browser.close();
console.log("PHASE-D-DONE");
