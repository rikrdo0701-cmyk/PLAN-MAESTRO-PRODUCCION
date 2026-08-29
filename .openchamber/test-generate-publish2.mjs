import { chromium } from "playwright";

const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=367245a";
const OUT_DIR = "C:/Users/plane/Downloads/plangit/.openchamber/screenshots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" || t.includes("planner-budget") || t.includes("[planner")) console.log("[console]", t.slice(0, 300));
});

const probe = () => page.evaluate(() => {
  const btn = document.querySelector("#generatePlanBtn");
  const labelEl = btn?.querySelector("[data-schedule-label]");
  const label = labelEl ? labelEl.textContent.trim() : (btn ? btn.textContent.trim().slice(0, 30) : "");
  const ls = (typeof state !== "undefined" && state.lastSchedule) ? state.lastSchedule : null;
  const perf = ls?.performance || null;
  return {
    planStart: state?.planStart || "",
    opsCount: (state?.operations || []).length,
    genDisabled: btn ? btn.disabled : null,
    label,
    uid: typeof state !== "undefined" ? (state.lastSchedule ? "LS" + (ls.scheduled ?? "x") + "/" + (ls.unscheduled ?? "x") : "noLS") : "noState",
    phase: perf ? perf.lastPhase : "",
    elapsedMs: perf ? perf.elapsedMs : 0,
    aborted: perf ? perf.aborted : null,
    reason: perf ? perf.reason : "",
  };
});

console.log("[1] Cargando planning...");
await page.goto(SITE + "#planning", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && state.planStart, null, { timeout: 90000, polling: 2000 });
console.log("[1] planStart:", await page.evaluate(() => state.planStart));
console.log("[2] Esperando sincronizacion (boton habilitado)...");
await page.waitForFunction(() => !document.querySelector("#generatePlanBtn")?.disabled, null, { timeout: 180000, polling: 2000 });
console.log("[2] ok. Generar click.");
await page.screenshot({ path: OUT_DIR + "/gen-plan-before.png" });
await page.evaluate(() => document.querySelector("#generatePlanBtn").click());

const t0 = Date.now();
let done = false;
while (Date.now() - t0 < 820000) {
  await sleep(20000);
  const p = await probe();
  console.log(`[3] +${Math.round((Date.now() - t0) / 1000)}s ${JSON.stringify(p)}`);
  if (p.genDisabled === false) { done = true; break; }
}
if (done) console.log("[3] Generacion terminada (boton habilitado de nuevo).");
else console.log("[3] ATENCION: aun ocupado tras 820s.");

// wait a few seconds for final render/save
await sleep(12000);
const after = await page.evaluate(() => {
  const ops = (typeof state !== "undefined" && state.operations) ? state.operations : [];
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
  const before0828 = ops.filter((o) => o.fechaInicio && o.fechaInicio < "2026-08-28");
  const ls = state.lastSchedule || {};
  return {
    planStart: state.planStart,
    opsCount: ops.length,
    minFi: iso(fi[0]), maxFi: iso(fi[fi.length - 1]),
    opsBefore0828: before0828.length,
    opsOn0828: ops.filter((o) => o.fechaInicio && o.fechaInicio >= "2026-08-28" && o.fechaInicio < "2026-08-29").length,
    byWeek: {
      "2026-08-17": byWeek["2026-08-17"], "2026-08-24": byWeek["2026-08-24"], "2026-08-28": byWeek["2026-08-28"],
      "2026-08-31": byWeek["2026-08-31"], "2026-09-07": byWeek["2026-09-07"], "2026-09-28": byWeek["2026-09-28"],
    },
    lastSchedule: {
      scheduled: ls.scheduled, unscheduled: ls.unscheduled, strategy: ls.optimization?.selectedStrategy,
      phase: ls.performance?.lastPhase, elapsedMs: ls.performance?.elapsedMs,
      aborted: ls.performance?.aborted, reason: ls.performance?.reason, budgetChecks: ls.performance?.budgetCheckCount,
      stats: ls.performance?.stats ? { strategiesStarted: ls.performance.stats.strategiesStarted, mainLoopIterations: ls.performance.stats.mainLoopIterations, slotProbes: ls.performance.stats.slotProbes } : null,
    },
    firstScheduled: ops.filter((o) => o.fechaInicio && o.fechaInicio >= "2026-08-28").slice(0, 6).map((o) => ({ ot: o.ot, fi: o.fechaInicio, hi: o.horaInicio, desc: (o.descripcion || "").slice(0, 26) })),
  };
});
console.log("[3] AFTER-GENERATE:", JSON.stringify(after, null, 2));
await page.screenshot({ path: OUT_DIR + "/gen-plan-after-board.png" });

// ---- PUBLISH ----
console.log("[4] Publicando...");
await page.waitForFunction(() => !document.querySelector("#publishPlanBtn")?.disabled, null, { timeout: 60000, polling: 2000 });
await page.evaluate(() => document.querySelector("#publishPlanBtn").click());
const t1 = Date.now();
let newSnap = null;
while (Date.now() - t1 < 300000) {
  await sleep(5000);
  newSnap = await page.evaluate(() => {
    const s = typeof planSnapshots !== "undefined" ? planSnapshots : [];
    return s.find((x) => String(x.planStart) === "2026-08-28") || null;
  });
  if (newSnap) break;
}
console.log("[4] snapshot:", JSON.stringify(newSnap && { id: newSnap.snapshotId, week: newSnap.weekStart, start: newSnap.planStart, ops: newSnap.operations, gen: newSnap.generatedAt }));

// ---- LOAD + REPORT ----
console.log("[5] Cargando snapshot y leyendo reporte...");
if (newSnap) {
  await page.evaluate((id) => {
    const s = document.querySelector("#planSnapshotSelect");
    if (s) { const o = [...s.options].find((opt) => opt.value === id); if (o) { s.value = id; s.dispatchEvent(new Event("change")); } }
  }, newSnap.snapshotId);
  await page.waitForFunction((snapId) => typeof reportSnapshot !== "undefined" && reportSnapshot && reportSnapshot.snapshotId === snapId, newSnap.snapshotId, { timeout: 420000, polling: 3000 }).catch(() => console.log("[5] snapshot no cargo en cap"));
}
await sleep(6000);
const report = await page.evaluate(() => {
  const ops = (reportSnapshot && reportSnapshot.operations) ? reportSnapshot.operations : [];
  const iso = (d) => (d ? String(d).slice(0, 10) : "");
  const fi = ops.map((o) => o.fechaInicio).filter(Boolean).sort();
  const w = document.getElementById("weekReportStartInput");
  const text = document.body.innerText;
  const sinOTs = text.includes("Sin OTs para esta semana");
  const zero = (text.match(/\$0\.00/g) || []).length;
  const semanaSection = (text.split("Plan de la semana")[1] || "").slice(0, 500);
  return {
    reportSnapshotId: reportSnapshot?.snapshotId,
    opsCount: ops.length,
    minFi: iso(fi[0]), maxFi: iso(fi[fi.length - 1]),
    first6: ops.slice(0, 6).map((o) => ({ ot: o.ot, fi: o.fechaInicio, hi: o.horaInicio, desc: (o.descripcion || "").slice(0, 24) })),
    weekReportStartInput: w ? w.value : "",
    reportWeekStart: state?.reportWeekStart || "",
    sinOTs, zeroCount: zero,
    semanaSection,
  };
});
console.log("[5] REPORT:", JSON.stringify(report, null, 2));
await page.screenshot({ path: OUT_DIR + "/report-week.png", fullPage: true });

await browser.close();
console.log("DONE");