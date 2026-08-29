import { chromium } from "playwright";

const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=d6a16c6";
const OUT_DIR = "C:/Users/plane/Downloads/plangit/.openchamber/screenshots";
const PLAN_START = "2026-08-28";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" || /OPS-INVOKE|OPS-CALLER|planning-actions|planner/i.test(t)) console.log("[console]", t.slice(0, 400));
});
const logs = [];
page.on("console", (m) => { if (/OPS-/.test(m.text())) logs.push(m.text().slice(0, 500)); });

const probe = () => page.evaluate(() => {
  const btn = document.querySelector("#generatePlanBtn");
  const pubBtn = document.querySelector("#publishPlanBtn");
  const labelEl = btn?.querySelector("[data-schedule-label]");
  return {
    planStart: state?.planStart || "", selectedOts: Array.isArray(state?.selectedOts) ? state.selectedOts.length : -1,
    ops: (state?.operations || []).length,
    genDisabled: btn ? btn.disabled : null, pubDisabled: pubBtn ? pubBtn.disabled : null,
    genLabel: labelEl ? labelEl.textContent.trim() : (btn ? btn.textContent.trim().slice(0, 26) : ""),
    scheduled: state?.lastSchedule?.scheduled ?? null, aborted: state?.lastSchedule?.performance?.aborted ?? null,
    phase: state?.lastSchedule?.performance?.lastPhase || "",
    sync: (typeof netSuiteSyncInFlight !== "undefined" ? netSuiteSyncInFlight : "n/a"),
  };
});
const toastText = () => page.evaluate(() => {
  const els = [...document.querySelectorAll('[id*="toast" i], [class*="toast" i]')];
  return els.map((e) => (e.innerText || "").trim()).filter(Boolean).slice(-4);
});

console.log("[L] Cargando #planning...");
await page.goto(SITE + "#planning", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && state.planStart && (state.operations || []).length > 300, null, { timeout: 240000, polling: 2000 });
await sleep(3000);

// fijar planStart
await page.evaluate((ps) => { state.planStart = ps; }, PLAN_START);

// Instalar sentinel en window.PlannerCore.schedulePlan
await page.evaluate(() => {
  const core = window.PlannerCore;
  if (!core) { window.__OPS_ERR__ = "no PlannerCore"; return; }
  const orig = core.schedulePlan;
  window.__OPS_ORIG__ = orig;
  window.__OPS_INVOKED__ = null;
  core.schedulePlan = function (s, o) {
    window.__OPS_INVOKED__ = {
      t: new Date().toISOString(),
      selectedOts: Array.isArray(s?.selectedOts) ? s.selectedOts.length : (s.selectedOts ? "obj" : null),
      planStart: o?.planStart || s?.planStart,
      baseSnapshot: o?.baseSnapshot === null ? "null" : (o?.baseSnapshot ? typeof o.baseSnapshot : "missing"),
      affectedOts: Array.isArray(o?.affectedOts) ? o.affectedOts.length : (o?.affectedOts ? "obj" : "missing"),
      respectPlanStart: o?.respectPlanStart,
      hasOperationsInPlanStart: o?.baseSnapshot === null,
    };
    console.log("OPS-INVOKE", JSON.stringify(window.__OPS_INVOKED__));
    return orig.call(this, s, o);
  };
  console.log("OPS-CALLER wrapper installed");
});
const wrapperErr = await page.evaluate(() => window.__OPS_ERR__ || "ok");
console.log("[L] wrapper:", wrapperErr);

// sembrar selectedOts (si vacio)
let p = await probe();
if (p.selectedOts === 0) {
  const n = await page.evaluate(() => {
    const ops = state.operations || [];
    const set = new Set(ops.filter((o) => o.tipoInsercion !== "CAMBIO_HERRAMENTAL").map((o) => String(o.ot)));
    state.selectedOts = [...set];
    return state.selectedOts.length;
  });
  console.log("[L] selectedOts sembrado:", n);
}

// esperar boton habilitado (fin sync) max ~13 min
console.log("[L] esperando boton Generar habilitado (fin de sync NetSuite)...");
const tW = Date.now();
let waitedEnabled = false;
while (Date.now() - tW < 780000) {
  p = await probe();
  if (p.genDisabled === false) { waitedEnabled = true; console.log(`[L] Generar habilitado tras ${Math.round((Date.now() - tW) / 1000)}s`, JSON.stringify(p)); break; }
  await sleep(8000);
}
if (!waitedEnabled) {
  console.log("[L] Generar nunca se habilito; label =", p.genLabel, "scheduled =", p.scheduled);
  await page.screenshot({ path: OUT_DIR + "/gen-plan-blocked-enabled.png" });
  console.log("LOGS:", JSON.stringify(logs, null, 1));
  await browser.close(); process.exit(2);
}

// Click Boton Generar
console.log("[B] Pulsando boton Generar...");
await page.evaluate(() => document.querySelector("#generatePlanBtn").click());
const tClick = Date.now();
await sleep(3000);
let inv = await page.evaluate(() => window.__OPS_INVOKED__);
console.log("[B] invocacion tras clic? ", inv ? JSON.stringify(inv) : "AUN NO");
const tR = await toastText();
console.log("[B] toasts:", JSON.stringify(tR));

// Centinela: esperar invocacion del motor hasta 90s
let engineInvoked = false;
while (Date.now() - tClick < 90000) {
  inv = await page.evaluate(() => window.__OPS_INVOKED__);
  if (inv) { engineInvoked = true; break; }
  await sleep(2000);
}
console.log("[B] motor invocado dentro de 90s?", engineInvoked, engineInvoked ? JSON.stringify(inv) : "");
await page.screenshot({ path: OUT_DIR + "/e2e-after-generar-click.png" });

// Determinar via
const VIA = engineInvoked ? "boton" : "directa";
console.log("[B] VIA =", VIA);
console.log("LOGS (OPS-):", JSON.stringify(logs.slice(-20), null, 1));

// Esperar finalizacion (si via boton) — hasta ~12 min
let finished = false;
if (engineInvoked) {
  const t0 = Date.now();
  let lastLabel = "";
  while (Date.now() - t0 < 720000) {
    await sleep(20000);
    p = await probe();
    if (p.genLabel && p.genLabel !== lastLabel) { lastLabel = p.genLabel; console.log(`[W] +${Math.round((Date.now() - t0) / 1000)}s "${p.genLabel}" scheduled=${p.scheduled} aborted=${p.aborted} phase=${p.phase}`); }
    if (p.genDisabled === false && p.scheduled != null) { finished = true; console.log(`[W] +${Math.round((Date.now() - t0) / 1000)}s TERMINO scheduled=${p.scheduled} aborted=${p.aborted} phase=${p.phase}`); break; }
    if (p.genDisabled === true && p.scheduled != null && /^Generar plan$/i.test(p.genLabel.trim()) === false && /gestionar|plan/i.test(p.genLabel)) { /* still running */ }
  }
}

// Analisis final del estado
await sleep(5000);
const after = await page.evaluate(() => {
  const ops = state?.operations || [];
  const iso = (d) => (d ? String(d).slice(0, 10) : "");
  const weekOf = (d) => { if (!d) return null; const [y, m, dd] = String(d).slice(0, 10).split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, dd)); const mon = new Date(dt); mon.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)); return mon.toISOString().slice(0, 10); };
  const byWeek = {}; for (const op of ops) { const w = weekOf(op.fechaInicio); byWeek[w] = (byWeek[w] || 0) + 1; }
  const fi = ops.map((o) => o.fechaInicio).filter(Boolean).sort();
  const ls = state.lastSchedule || {};
  const ot3143 = ops.filter((o) => String(o.ot) === "3143").map((o) => ({ fi: o.fechaInicio, hi: o.horaInicio, desc: (o.descripcion || "").slice(0, 30) }));
  return {
    planStart: state.planStart,
    selectedOts: Array.isArray(state.selectedOts) ? state.selectedOts.length : -1,
    opsCount: ops.length,
    minFi: iso(fi[0]), maxFi: iso(fi[fi.length - 1]),
    opsBefore0828: ops.filter((o) => o.fechaInicio && iso(o.fechaInicio) < "2026-08-28").length,
    opsOn0828: ops.filter((o) => o.fechaInicio && iso(o.fechaInicio) >= "2026-08-28" && iso(o.fechaInicio) < "2026-08-29").length,
    opsInWeek24_30: ops.filter((o) => o.fechaInicio && iso(o.fechaInicio) >= "2026-08-24" && iso(o.fechaInicio) <= "2026-08-30").length,
    byWeek: { "2026-08-17": byWeek["2026-08-17"], "2026-08-24": byWeek["2026-08-24"], "2026-08-31": byWeek["2026-08-31"], "2026-09-07": byWeek["2026-09-07"] },
    lastSchedule: { scheduled: ls.scheduled, unscheduled: ls.unscheduled, aborted: ls.performance?.aborted, reason: ls.performance?.reason, phase: ls.performance?.lastPhase, elapsedMs: ls.performance?.elapsedMs },
    minFiCheck: { min: iso(fi[0]), expectedStart: "2026-08-28", okMinIsStart: iso(fi[0]) === "2026-08-28" },
    ot3143,
    wrapperIndex: { snapshotId: state?.draftVersionId || "", scheduled: ls.scheduled },
  };
});
console.log("[AFTER]", JSON.stringify(after, null, 2));
await page.screenshot({ path: OUT_DIR + "/e2e-after-generate.png" });
console.log("INVOKE:", JSON.stringify(inv));
console.log("FINAL VIA_BOTON_FINISHED:", finished);

await browser.close();
console.log("PHASE-B-DONE via=", VIA);

process.exit(0);
