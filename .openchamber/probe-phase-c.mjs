import { chromium } from "playwright";

const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=d6a16c6";
const OUT_DIR = "C:/Users/plane/Downloads/plangit/.openchamber/screenshots";
const PLAN_START = "2026-08-28";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
page.on("console", (m) => { const t = m.text(); if (m.type() === "error" || /planner|DIRECT|PUB/i.test(t)) console.log("[console]", t.slice(0, 300)); });

console.log("[C] Cargando #planning...");
await page.goto(SITE + "#planning", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && state.planStart && (state.operations || []).length > 300, null, { timeout: 240000, polling: 2000 });
await sleep(3000);

// fijar planStart y derivar readyOts + engineSelectedOts
const prep = await page.evaluate((ps) => {
  state.planStart = ps;
  const ops = state.operations || [];
  const selected = [...new Set(ops.filter((o) => o.tipoInsercion !== "CAMBIO_HERRAMENTAL").map((o) => String(o.ot)))];
  state.selectedOts = selected;
  // try to use app helpers if available on window
  let ready = selected;
  try {
    if (typeof window.PlanningWorkflowCore !== "undefined" && typeof window.PlanningWorkflowCore.schedulingSelectedOts === "function") {
      ready = window.PlanningWorkflowCore.schedulingSelectedOts(state, []);
    }
  } catch (e) { console.log("schedulingSelectedOts err", String(e)); }
  const engineReady = ready.length;
  return {
    selectedOts: selected.length,
    readyOts: engineReady,
    planStart: state.planStart,
    horizonDays: Number(state.horizonDays) || 15,
  };
}, PLAN_START);
console.log("[C] prep:", JSON.stringify(prep));

// Pre-check del fix: operationsStartingInWeek de la base publicada 1e0cc75b
const fixPre = await page.evaluate(() => (async () => {
  if (typeof callAppsScript !== "function") return { fn: "no-global" };
  const base = await callAppsScript("getPlanSnapshot", "1e0cc75b-ddb9-413b-8e4d-9e78add0aa8c");
  const ops = Array.isArray(base?.operations) ? base.operations : [];
  const week = window.PlanningWorkflowCore.mondayIso("2026-08-28");
  const starting = window.PlanningWorkflowCore.operationsStartingInWeek(base, week);
  return { baseOps: ops.length, week, operationsStartingInWeek: starting, shouldTriggerFix: starting === 0 };
})());
console.log("[C] precheck fix (base 1e0cc75b):", JSON.stringify(fixPre));

// Llamada directa al motor (reproduccion exacta del fix: baseSnapshot null, affectedOts readyOts)
console.log("[C] Invocando schedulePlan (baseSnapshot:null, budget 120000)...");
const dir = await page.evaluate(async () => {
  const ops = state.operations || [];
  const engineSelectedOts = Array.isArray(window.PlanningWorkflowCore?.schedulingSelectedOts)
    ? []
    : [...new Set(ops.filter((o) => o.tipoInsercion !== "CAMBIO_HERRAMENTAL").map((o) => String(o.ot)))];
  let readyOts = state.selectedOts || [];
  try {
    readyOts = window.PlanningWorkflowCore.schedulingSelectedOts(state, []);
  } catch (e) { /* fallback all */ }
  const options = {
    planStart: state.planStart || "2026-08-28",
    horizonDays: Number(state.horizonDays) || 15,
    executionTime: new Date().toISOString(),
    respectPlanStart: true,
    baseSnapshot: null,
    affectedOts: readyOts,
    timeBudgetMs: 120000,
    collectStats: true,
    progressEveryMs: 300,
    onProgress: (ev) => { if ((ev?.scheduled || 0) % 500 === 0) console.log("DIRECT progress", ev.scheduled, "/", ev.total); },
    onYield: () => new Promise((r) => setTimeout(r, 0)),
  };
  const t0 = performance.now();
  const result = await window.PlannerCore.schedulePlan({ ...state, selectedOts: engineSelectedOts }, options);
  const elapsed = Math.round(performance.now() - t0);
  const rOps = result?.operations ? result.operations : [];
  const iso = (d) => (d ? String(d).slice(0, 10) : "");
  const fi = rOps.map((o) => o.fechaInicio).filter(Boolean).sort();
  const ot3143 = rOps.filter((o) => String(o.ot) === "3143").sort((a, b) => String(a.fechaInicio).localeCompare(String(b.fechaInicio))).slice(0, 3).map((o) => ({ fi: o.fechaInicio, hi: o.horaInicio, sec: o.secuencia, desc: (o.descripcion || "").slice(0, 26) }));
  const ls = result.lastSchedule || {};
  return {
    readyOts: options.affectedOts.length,
    engineSelectedOts: engineSelectedOts.length,
    resultOpsCount: rOps.length,
    scheduled: ls.scheduled, unscheduled: ls.unscheduled,
    minFi: iso(fi[0] || ""), maxFi: iso(fi[fi.length - 1] || ""),
    opsOn0828: rOps.filter((o) => o.fechaInicio && iso(o.fechaInicio) >= "2026-08-28" && iso(o.fechaInicio) < "2026-08-29").length,
    opsBefore0828: rOps.filter((o) => o.fechaInicio && iso(o.fechaInicio) < "2026-08-28").length,
    phase: ls.performance?.lastPhase, aborted: ls.performance?.aborted, reason: ls.performance?.reason,
    elapsedMs: Math.round(ls.performance?.elapsedMs || elapsed),
    stats: { started: ls.performance?.stats?.strategiesStarted, iterations: ls.performance?.stats?.mainLoopIterations },
    ot3143,
    lastScheduleOps: Array.isArray(ls.operations) ? ls.operations.length : "n/a",
  };
});
console.log("[C] DIRECT RESULT:", JSON.stringify(dir, null, 2));

await page.screenshot({ path: OUT_DIR + "/e2e-direct-result.png" });

// Guardar resultado en archivo para fase siguiente
import fs from "node:fs";
fs.writeFileSync("C:/Users/plane/Downloads/plangit/.openchamber/direct-result.json", JSON.stringify({ prep, fixPre, dir }, null, 2));

await browser.close();
console.log("PHASE-C-DONE");
