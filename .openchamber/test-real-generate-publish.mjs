import { chromium } from "playwright";

const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=367245a";
const OUT_DIR = "C:/Users/plane/Downloads/plangit/.openchamber/screenshots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
page.on("console", (m) => { const t = m.text(); if (m.type() === "error") console.log("[console.error]", t.slice(0, 260)); });

const probe = () => page.evaluate(() => {
  const btn = document.querySelector("#generatePlanBtn");
  const labelEl = btn?.querySelector("[data-schedule-label]");
  const ls = (typeof state !== "undefined" && state.lastSchedule) ? state.lastSchedule : null;
  return {
    planStart: state?.planStart || "",
    ops: (state?.operations || []).length,
    genDisabled: btn ? btn.disabled : null,
    label: labelEl ? labelEl.textContent.trim() : "",
    scheduled: ls ? ls.scheduled : null,
    aborted: ls?.performance?.aborted ?? null,
    phase: ls?.performance?.lastPhase || "",
  };
});

console.log("[1] Cargando planning...");
await page.goto(SITE + "#planning", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && state.planStart && (state.operations || []).length > 300, null, { timeout: 180000, polling: 2000 });

console.log("[2] Esperando sync en reposo...");
await page.waitForFunction(() => {
  const s = document.querySelector("#syncBtn"); const g = document.querySelector("#generatePlanBtn");
  if (!s || !g) return false;
  return s.disabled === false && g.disabled === false && !(s.textContent || "").toLowerCase().includes("sincronizando");
}, null, { timeout: 300000, polling: 2000 }).catch(() => console.log("[2] aviso: sync no entro en reposo"));
await sleep(5000);

const before = await probe();
console.log("[2] BEFORE:", JSON.stringify(before));
if (before.planStart !== "2026-08-28") { await page.evaluate(() => { state.planStart = "2026-08-28"; }); console.log("[2] planStart forzado a 2026-08-28"); }
await page.screenshot({ path: OUT_DIR + "/gen-plan-before.png" });

console.log("[3] Click Generar plan...");
let started = false;
for (let attempt = 1; attempt <= 3; attempt++) {
  const wasEnabled = await page.evaluate(() => !document.querySelector("#generatePlanBtn").disabled);
  if (!wasEnabled) { await sleep(10000); continue; }
  await page.evaluate(() => document.querySelector("#generatePlanBtn").click());
  await sleep(4000);
  const p = await probe();
  if (p.genDisabled === true) { started = true; console.log(`[3] intento ${attempt}: generacion en curso.`); break; }
  console.log(`[3] intento ${attempt}: no arranco (posible 'ya esta en curso'), reintento. probe=${JSON.stringify(p)}`);
  await page.waitForFunction(() => !document.querySelector("#syncBtn")?.disabled || !(document.querySelector("#syncBtn")?.textContent || "").toLowerCase().includes("sincronizando"), null, { timeout: 120000, polling: 2000 }).catch(() => {});
  await sleep(5000);
}
if (!started) console.log("[3] no pude arrancar la generacion.");

const t0 = Date.now();
let lastLabel = "";
while (Date.now() - t0 < 730000) {
  await sleep(25000);
  const p = await probe();
  if (p.label && p.label !== lastLabel) { lastLabel = p.label; console.log(`[3] +${Math.round((Date.now() - t0) / 1000)}s label="${p.label}" scheduled=${p.scheduled}`); }
  if (p.genDisabled === false && p.scheduled != null) { console.log(`[3] +${Math.round((Date.now() - t0) / 1000)}s TERMINO scheduled=${p.scheduled} aborted=${p.aborted} phase=${p.phase}`); break; }
  if (p.genDisabled === false) { console.log(`[3] +${Math.round((Date.now() - t0) / 1000)}s boton habilitado (sin lastSchedule aun)`); await sleep(6000); const p2 = await probe(); console.log(`[3]     recheck: ${JSON.stringify(p2)}`); if (p2.scheduled != null) break; }
}
await sleep(10000);

const after = await page.evaluate(() => {
  const ops = (state?.operations || []);
  const iso = (d) => (d ? String(d).slice(0, 10) : "");
  const weekOf = (d) => { if (!d) return null; const [y, m, dd] = String(d).slice(0, 10).split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, dd)); const mon = new Date(dt); mon.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)); return mon.toISOString().slice(0, 10); };
  const byWeek = {}; for (const op of ops) { const w = weekOf(op.fechaInicio); byWeek[w] = (byWeek[w] || 0) + 1; }
  const fi = ops.map((o) => o.fechaInicio).filter(Boolean).sort();
  const ls = state.lastSchedule || {};
  return {
    planStart: state.planStart, opsCount: ops.length,
    minFi: iso(fi[0]), maxFi: iso(fi[fi.length - 1]),
    opsBefore0828: ops.filter((o) => o.fechaInicio && o.fechaInicio < "2026-08-28").length,
    opsOn0828: ops.filter((o) => o.fechaInicio && o.fechaInicio >= "2026-08-28" && o.fechaInicio < "2026-08-29").length,
    byWeek: { "2026-08-17": byWeek["2026-08-17"], "2026-08-24": byWeek["2026-08-24"], "2026-08-31": byWeek["2026-08-31"], "2026-09-07": byWeek["2026-09-07"] },
    lastSchedule: { scheduled: ls.scheduled, unscheduled: ls.unscheduled, aborted: ls.performance?.aborted, reason: ls.performance?.reason, phase: ls.performance?.lastPhase, elapsedMs: ls.performance?.elapsedMs },
  };
});
console.log("[3] AFTER-GENERATE:", JSON.stringify(after, null, 2));
await page.screenshot({ path: OUT_DIR + "/gen-plan-after-board.png" });

console.log("[4] Publicando...");
await page.waitForFunction(() => !document.querySelector("#publishPlanBtn")?.disabled, null, { timeout: 60000, polling: 2000 });
await page.evaluate(() => document.querySelector("#publishPlanBtn").click());
const t1 = Date.now();
let newSnap = null;
while (Date.now() - t1 < 300000) {
  await sleep(5000);
  newSnap = await page.evaluate(() => {
    const s = typeof planSnapshots !== "undefined" ? planSnapshots : [];
    const fresh = s.filter((x) => x.snapshotId !== "draft" && Date.parse(x.generatedAt) > Date.now() - 12 * 60000);
    return fresh.length ? fresh[0] : null;
  });
  if (newSnap) break;
}
console.log("[4] nuevo snapshot:", JSON.stringify(newSnap && { id: newSnap.snapshotId, week: newSnap.weekStart, start: newSnap.planStart, ops: newSnap.operations, gen: newSnap.generatedAt }));
if (!newSnap) {
  console.log("[4] no detectado; fuerza refreshSnapshotsBtn.");
  await page.click("#refreshSnapshotsBtn").catch(() => {});
  await sleep(20000);
  newSnap = await page.evaluate(() => { const s = typeof planSnapshots !== "undefined" ? planSnapshots : []; const fresh = s.filter((x) => x.snapshotId !== "draft" && Date.parse(x.generatedAt) > Date.now() - 12 * 60000); return fresh.length ? fresh[0] : null; });
  console.log("[4] tras refresh:", newSnap ? newSnap.snapshotId : null);
}

console.log("[5] Cargando snapshot y reporte...");
if (newSnap) {
  await page.evaluate((id) => { const s = document.querySelector("#planSnapshotSelect"); if (s) { const o = [...s.options].find((opt) => opt.value === id); if (o) { s.value = id; s.dispatchEvent(new Event("change")); } } }, newSnap.snapshotId);
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
  const section = (text.split("Plan de la semana")[1] || "").slice(0, 700);
  return {
    reportSnapshotId: reportSnapshot?.snapshotId, opsCount: ops.length,
    minFi: iso(fi[0]), maxFi: iso(fi[fi.length - 1]),
    weekReportStartInput: w ? w.value : "", reportWeekStart: state?.reportWeekStart || "",
    sinOTs, section,
  };
});
console.log("[5] REPORT:", JSON.stringify(report, null, 2));
await page.screenshot({ path: OUT_DIR + "/report-week.png", fullPage: true });

await browser.close();
console.log("DONE");