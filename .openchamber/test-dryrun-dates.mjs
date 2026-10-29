import { chromium } from "playwright";

const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=367245a";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" || t.includes("[planner") || t.includes("dry-run")) console.log("[console]", t.slice(0, 320));
});

console.log("[1] Cargando planning...");
await page.goto(SITE + "#planning", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && state.planStart, null, { timeout: 90000, polling: 2000 });
console.log("[1] planStart:", await page.evaluate(() => state.planStart));

console.log("[2] Esperando sincronizacion en reposo (syncBtn idle)...");
await page.waitForFunction(() => {
  const s = document.querySelector("#syncBtn");
  const g = document.querySelector("#generatePlanBtn");
  if (!s || !g) return false;
  const text = (s.textContent || "").toLowerCase();
  return s.disabled === false && g.disabled === false && !text.includes("sincronizando") && !text.includes("syncing");
}, null, { timeout: 300000, polling: 2000 }).catch(() => console.log("[2] sync no quedo idle en cap, continuo."));
await sleep(3000);
console.log("[2] syncBtn:", await page.evaluate(() => { const s = document.querySelector("#syncBtn"); return { text: (s?.textContent || "").trim(), disabled: s?.disabled }; }));

console.log("[3] Hookeando schedulePlan para capturar fechas...");
await page.evaluate(() => {
  window.__dryCap = null;
  const real = window.PlannerCore.schedulePlan.bind(window.PlannerCore);
  window.PlannerCore.schedulePlan = async function (...args) {
    const r = await real(...args);
    const ops = (r && r.operations) ? r.operations : [];
    const iso = (d) => (d ? String(d).slice(0, 10) : "");
    const weekOf = (d) => {
      if (!d) return null;
      const [y, m, dd] = String(d).slice(0, 10).split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, dd));
      const mon = new Date(dt); mon.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
      return mon.toISOString().slice(0, 10);
    };
    const byWeek = {};
    for (const op of ops) { const w = weekOf(op.fechaInicio); byWeek[w] = (byWeek[w] || 0) + 1; }
    const fi = ops.map((o) => o.fechaInicio).filter(Boolean).sort();
    const ls = r.lastSchedule || {};
    window.__dryCap = {
      opsCount: ops.length,
      minFi: iso(fi[0]), maxFi: iso(fi[fi.length - 1]),
      opsOn0828: ops.filter((o) => o.fechaInicio && o.fechaInicio >= "2026-08-28" && o.fechaInicio < "2026-08-29").length,
      byWeek: {
        "2026-08-17": byWeek["2026-08-17"], "2026-08-24": byWeek["2026-08-24"],
        "2026-08-28": byWeek["2026-08-28"], "2026-08-31": byWeek["2026-08-31"],
        "2026-09-07": byWeek["2026-09-07"], "2026-09-28": byWeek["2026-09-28"],
      },
      lastSchedule: {
        scheduled: ls.scheduled, unscheduled: ls.unscheduled,
        phase: ls.performance?.lastPhase, elapsedMs: ls.performance?.elapsedMs,
        aborted: ls.performance?.aborted, reason: ls.performance?.reason,
        strategiesStarted: ls.performance?.stats?.strategiesStarted, mainLoopIterations: ls.performance?.stats?.mainLoopIterations,
      },
      firstScheduled: ops.filter((o) => o.fechaInicio && o.fechaInicio >= "2026-08-28").slice(0, 8).map((o) => ({ ot: o.ot, fi: o.fechaInicio, hi: o.horaInicio, desc: (o.descripcion || "").slice(0, 26) })),
    };
    return r;
  };
});

console.log("[4] Dry-run con Inicio 2026-08-28 (presupuesto 45s)...");
const dry = await page.evaluate(async () => {
  // asegurar planStart hoy
  try { state.planStart = "2026-08-28"; } catch (e) {}
  return await window.runPlanningPerformanceDryRun({ timeoutMs: 45000, collectStats: true, progressEveryMs: 5000 });
});
console.log("[4] DRY-RUN RESULT:", JSON.stringify({
  ok: dry.ok, aborted: dry.aborted, reason: dry.reason, lastPhase: dry.lastPhase,
  elapsedMs: dry.elapsedMs, blockers: dry.blockers,
  metrics: {
    readyOtsCount: dry.metrics?.readyOtsCount, selectedOtsCount: dry.metrics?.selectedOtsCount,
    includedOperationsCount: dry.metrics?.includedOperationsCount,
    scheduledOperationsCount: dry.metrics?.scheduledOperationsCount, unscheduledOperationsCount: dry.metrics?.unscheduledOperationsCount,
    selectedStrategy: dry.metrics?.selectedStrategy, schedulerPhase: dry.metrics?.plannerLastPhase,
    mainLoopIterations: dry.metrics?.plannerMainLoopIterations, strategiesStarted: dry.metrics?.plannerStrategiesStarted,
    unscheduledAnalysis: dry.metrics?.unscheduledAnalysis,
  },
}, null, 2));
const cap = await page.evaluate(() => window.__dryCap);
console.log("[4] SCHEDULE CAPTURE:", JSON.stringify(cap, null, 2));

await browser.close();
console.log("DONE (nada se guardo ni publico)");