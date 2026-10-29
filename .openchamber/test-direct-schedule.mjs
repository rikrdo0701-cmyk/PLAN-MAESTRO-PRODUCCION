import { chromium } from "playwright";

const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=367245a";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("console", (m) => { const t = m.text(); if (m.type() === "error" || t.includes("[planner")) console.log("[console]", t.slice(0, 300)); });

console.log("[1] Cargando planning...");
await page.goto(SITE + "#planning", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && state.planStart && (state.operations || []).length > 300, null, { timeout: 180000, polling: 2000 });
await page.waitForTimeout(4000);
console.log("[1] planStart:", await page.evaluate(() => state.planStart));

console.log("[2] Llamando PlannerCore.schedulePlan (Inicio 2026-08-28, presupuesto 50s)...");
const out = await page.evaluate(async () => {
  const ops = state.operations || [];
  const otSet = new Set(ops.filter((o) => o.tipoInsercion !== "CAMBIO_HERRAMENTAL").map((o) => String(o.ot)));
  const selectedOts = [...otSet];
  const options = {
    planStart: "2026-08-28",
    horizonDays: Number(state.horizonDays) || 15,
    executionTime: new Date().toISOString(),
    respectPlanStart: true,
    timeBudgetMs: 50000,
    collectStats: true,
    progressEveryMs: 5000,
    onYield: () => new Promise((r) => setTimeout(r, 0)),
  };
  const t0 = performance.now();
  const result = await window.PlannerCore.schedulePlan({ ...state, selectedOts }, options);
  const elapsed = Math.round(performance.now() - t0);
  const rOps = result && result.operations ? result.operations : [];
  const iso = (d) => (d ? String(d).slice(0, 10) : "");
  const weekOf = (d) => {
    if (!d) return null;
    const [y, m, dd] = String(d).slice(0, 10).split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, dd));
    const mon = new Date(dt); mon.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
    return mon.toISOString().slice(0, 10);
  };
  const byWeek = {};
  for (const op of rOps) { const w = weekOf(op.fechaInicio); byWeek[w] = (byWeek[w] || 0) + 1; }
  const fi = rOps.map((o) => o.fechaInicio).filter(Boolean).sort();
  const ls = result.lastSchedule || {};
  const perf = ls.performance || {};
  return {
    selectedOtsCount: selectedOts.length,
    resultOpsCount: rOps.length,
    minFi: iso(fi[0]), maxFi: iso(fi[fi.length - 1]),
    opsOn0828: rOps.filter((o) => o.fechaInicio && o.fechaInicio >= "2026-08-28" && o.fechaInicio < "2026-08-29").length,
    opsBefore0828: rOps.filter((o) => o.fechaInicio && o.fechaInicio < "2026-08-28").length,
    byWeek: {
      "2026-08-17": byWeek["2026-08-17"], "2026-08-24": byWeek["2026-08-24"],
      "2026-08-28": byWeek["2026-08-28"], "2026-08-31": byWeek["2026-08-31"],
      "2026-09-07": byWeek["2026-09-07"], "2026-09-28": byWeek["2026-09-28"],
    },
    lastSchedule: {
      scheduled: ls.scheduled, unscheduled: ls.unscheduled, phase: perf.lastPhase,
      elapsedMs: perf.elapsedMs, wallElapsedMs: elapsed, aborted: perf.aborted, reason: perf.reason,
      strategiesStarted: perf.stats && perf.stats.strategiesStarted, mainLoopIterations: perf.stats && perf.stats.mainLoopIterations,
    },
    firstScheduled: rOps.filter((o) => o.fechaInicio && o.fechaInicio >= "2026-08-28").slice(0, 10).map((o) => ({ ot: o.ot, fi: o.fechaInicio, hi: o.horaInicio, desc: (o.descripcion || "").slice(0, 26) })),
  };
});
console.log("[2] RESULTADO:", JSON.stringify(out, null, 2));

await browser.close();
console.log("DONE (no se guardo ni publico nada)");