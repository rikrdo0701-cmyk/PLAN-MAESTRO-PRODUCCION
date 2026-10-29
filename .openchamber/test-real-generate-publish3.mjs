import { chromium } from "playwright";

const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=367245a";
const OUT_DIR = "C:/Users/plane/Downloads/plangit/.openchamber/screenshots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
page.on("console", (m) => { if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 260)); });

const toastText = () => page.evaluate(() => {
  const els2 = [...document.querySelectorAll('[id*="toast" i], [class*="toast" i]')];
  return els2.map((e) => (e.innerText || "").trim()).filter(Boolean).slice(-3);
});
const probe = () => page.evaluate(() => {
  const btn = document.querySelector("#generatePlanBtn");
  const labelEl = btn?.querySelector("[data-schedule-label]");
  const ls = (typeof state !== "undefined" && state.lastSchedule) ? state.lastSchedule : null;
  return {
    planStart: state?.planStart || "",
    selectedOts: Array.isArray(state?.selectedOts) ? state.selectedOts.length : -1,
    ops: (state?.operations || []).length,
    genDisabled: btn ? btn.disabled : null,
    label: labelEl ? labelEl.textContent.trim() : (btn ? btn.textContent.trim().slice(0, 26) : ""),
    scheduled: ls ? ls.scheduled : null, aborted: ls?.performance?.aborted ?? null, phase: ls?.performance?.lastPhase || "",
  };
});

console.log("[1] Cargando planning...");
await page.goto(SITE + "#planning", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && state.planStart && (state.operations || []).length > 300, null, { timeout: 180000, polling: 2000 });
let p = await probe();
console.log("[1] estado inicial:", JSON.stringify(p));

// [2] Esperar que Generar quede habilitado (fin de sync de fondo)
const tW = Date.now();
while (Date.now() - tW < 780000) {
  p = await probe();
  if (p.genDisabled === false) { console.log(`[2] Generar habilitado tras ${Math.round((Date.now() - tW) / 1000)}s`); console.log("[2]", JSON.stringify(p)); break; }
  await sleep(8000);
}
if (p.genDisabled !== false) { console.log("[2] Generar nunca se habilito; label =", p.label); await page.screenshot({ path: OUT_DIR + "/gen-plan-blocked.png" }); await browser.close(); process.exit(1); }

// [3] Asegurar selectedOts (viene vacio en sesion fresca)
if (p.selectedOts === 0) {
  const n = await page.evaluate(() => {
    const ops = state.operations || [];
    const set = new Set(ops.filter((o) => o.tipoInsercion !== "CAMBIO_HERRAMENTAL").map((o) => String(o.ot)));
    state.selectedOts = [...set];
    return state.selectedOts.length;
  });
  console.log("[3] selectedOts sembrado:", n);
}

// [4] Click Generar y verificar arranque
await page.evaluate(() => document.querySelector("#generatePlanBtn").click());
await sleep(12000);
p = await probe();
const t = await toastText();
console.log("[4] tras clic:", JSON.stringify(p), "toasts:", JSON.stringify(t));
if (p.genDisabled !== true) {
  console.log("[4] la generacion no arranco; diagnostico...");
  const diag = await page.evaluate(() => ({
    busyState: (typeof planningActionsBusyHelper !== "undefined") ? "?" : null,
    syncInFlight: typeof netSuiteSyncInFlight !== "undefined" ? netSuiteSyncInFlight : "n/a",
    readyCheck: (() => { try { const state2 = state; const ops = state2.operations || []; const sel = new Set(state2.selectedOts); const ots = ops.filter((o) => sel.has(String(o.ot))); return { selectedOps: ots.length, uniqueOts: sel.size }; } catch (e) { return String(e); } })(),
  }));
  console.log("[4] diag:", JSON.stringify(diag));
  await page.screenshot({ path: OUT_DIR + "/gen-plan-blocked.png" });
  await browser.close(); process.exit(1);
}
console.log("[4] generacion ARRANCO");

// [5] Esperar finalizacion del solver (cap ~12 min)
const t0 = Date.now();
let lastLabel = "";
while (Date.now() - t0 < 720000) {
  await sleep(25000);
  p = await probe();
  if (p.label && p.label !== lastLabel) { lastLabel = p.label; if (Date.now() - t0 > 60000) console.log(`[5] +${Math.round((Date.now() - t0) / 1000)}s "${p.label}" scheduled=${p.scheduled} aborted=${p.aborted}`); }
  if (p.genDisabled === false && p.scheduled != null) { console.log(`[5] +${Math.round((Date.now() - t0) / 1000)}s TERMINO scheduled=${p.scheduled} aborted=${p.aborted} phase=${p.phase}`); break; }
}
await sleep(8000);
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
    opsBefore0828: ops.filter((o) => o.fechaInicio && String(o.fechaInicio).slice(0, 10) < "2026-08-28").length,
    opsOn0828: ops.filter((o) => o.fechaInicio && String(o.fechaInicio).slice(0, 10) >= "2026-08-28" && String(o.fechaInicio).slice(0, 10) < "2026-08-29").length,
    byWeek: { "2026-08-17": byWeek["2026-08-17"], "2026-08-24": byWeek["2026-08-24"], "2026-08-31": byWeek["2026-08-31"], "2026-09-07": byWeek["2026-09-07"] },
    lastSchedule: { scheduled: ls.scheduled, unscheduled: ls.unscheduled, aborted: ls.performance?.aborted, reason: ls.performance?.reason, phase: ls.performance?.lastPhase, elapsedMs: ls.performance?.elapsedMs },
    firstScheduled: ops.filter((o) => o.fechaInicio && String(o.fechaInicio).slice(0, 10) >= "2026-08-28").slice(0, 8).map((o) => ({ ot: o.ot, fi: o.fechaInicio, hi: o.horaInicio, desc: (o.descripcion || "").slice(0, 26) })),
  };
});
console.log("[5] AFTER-GENERATE:", JSON.stringify(after, null, 2));
await page.screenshot({ path: OUT_DIR + "/gen-plan-after-board.png" });

// [6] Publicar
console.log("[6] Publicando...");
await page.waitForFunction(() => !document.querySelector("#publishPlanBtn")?.disabled, null, { timeout: 90000, polling: 2000 });
await page.evaluate(() => document.querySelector("#publishPlanBtn").click());
const t1 = Date.now();
let newSnap = null;
while (Date.now() - t1 < 300000) {
  await sleep(5000);
  newSnap = await page.evaluate(() => {
    const s = typeof planSnapshots !== "undefined" ? planSnapshots : [];
    const fresh = s.filter((x) => x.snapshotId !== "draft" && Date.parse(x.generatedAt) > Date.now() - 15 * 60000).sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt));
    return fresh[0] || null;
  });
  if (newSnap) break;
}
if (!newSnap) {
  await page.click("#refreshSnapshotsBtn").catch(() => {});
  await sleep(25000);
  newSnap = await page.evaluate(() => { const s = typeof planSnapshots !== "undefined" ? planSnapshots : []; return s.filter((x) => x.snapshotId !== "draft" && Date.parse(x.generatedAt) > Date.now() - 15 * 60000).sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))[0] || null; });
}
console.log("[6] nuevo snapshot:", JSON.stringify(newSnap && { id: newSnap.snapshotId, week: newSnap.weekStart, start: newSnap.planStart, ops: newSnap.operations, gen: newSnap.generatedAt }));

// [7] Cargar snapshot y validar reporte
console.log("[7] Cargando snapshot y reporte...");
if (newSnap) {
  await page.evaluate((id) => { const s = document.querySelector("#planSnapshotSelect"); if (s) { const o = [...s.options].find((opt) => opt.value === id); if (o) { s.value = id; s.dispatchEvent(new Event("change")); } } }, newSnap.snapshotId);
  await page.waitForFunction((snapId) => typeof reportSnapshot !== "undefined" && reportSnapshot && reportSnapshot.snapshotId === snapId, newSnap.snapshotId, { timeout: 420000, polling: 3000 }).catch(() => console.log("[7] snapshot no cargo en cap"));
}
await sleep(6000);
const report = await page.evaluate(() => {
  const ops = (reportSnapshot && reportSnapshot.operations) ? reportSnapshot.operations : [];
  const iso = (d) => (d ? String(d).slice(0, 10) : "");
  const fi = ops.map((o) => o.fechaInicio).filter(Boolean).sort();
  const weekOf = (d) => { if (!d) return null; const [y, m, dd] = String(d).slice(0, 10).split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, dd)); const mon = new Date(dt); mon.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)); return mon.toISOString().slice(0, 10); };
  const byWeek = {}; for (const op of ops) { const w = weekOf(op.fechaInicio); byWeek[w] = (byWeek[w] || 0) + 1; }
  const w = document.getElementById("weekReportStartInput");
  const text = document.body.innerText;
  const sinOTs = text.includes("Sin OTs para esta semana");
  return {
    reportSnapshotId: reportSnapshot?.snapshotId, opsCount: ops.length, minFi: iso(fi[0]),
    first6: ops.filter((o) => o.fechaInicio && String(o.fechaInicio).slice(0, 10) >= "2026-08-28").slice(0, 6).map((o) => ({ ot: o.ot, fi: o.fechaInicio, hi: o.horaInicio, desc: (o.descripcion || "").slice(0, 22) })),
    byWeek24: byWeek["2026-08-24"],
    weekReportStartInput: w ? w.value : "", reportWeekStart: state?.reportWeekStart || "",
    sinOTs,
  };
});
console.log("[7] REPORT:", JSON.stringify(report, null, 2));
await page.screenshot({ path: OUT_DIR + "/report-week.png", fullPage: true });

await browser.close();
console.log("DONE");