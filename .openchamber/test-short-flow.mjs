import { chromium } from "playwright";

const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=367245a";
const OUT_DIR = "C:/Users/plane/Downloads/plangit/.openchamber/screenshots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
page.on("console", (m) => { if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 300)); });

const toastText = () => page.evaluate(() => {
  const els2 = [...document.querySelectorAll('[id*="toast" i], [class*="toast" i]')];
  return els2.map((e) => (e.innerText || "").trim()).filter(Boolean).slice(-4);
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
    label: labelEl ? labelEl.textContent.trim() : null,
    publishedSnapshots: (typeof planSnapshots !== "undefined") ? planSnapshots.filter((s) => s.snapshotId !== "draft").length : -1,
    draft: (typeof planSnapshots !== "undefined") ? (() => { const d = planSnapshots.find((s) => s.snapshotId === "draft"); return d ? { gen: d.generatedAt, ops: d.operations } : null; })() : null,
    scheduled: ls ? ls.scheduled : null, aborted: ls?.performance?.aborted ?? null, total: ls?.performance?.total ?? null, phase: ls?.performance?.lastPhase || "", elapsedMs: ls?.performance?.elapsedMs ?? null,
  };
});

console.log("[1] Cargando planning...");
await page.goto(SITE + "#planning", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && state.planStart && (state.operations || []).length > 300, null, { timeout: 180000, polling: 2000 });
// esperar Generar habilitado
await page.waitForFunction(() => document.querySelector("#generatePlanBtn") && !document.querySelector("#generatePlanBtn").disabled, null, { timeout: 780000, polling: 8000 });
let p = await probe();
console.log("[1]", JSON.stringify(p));

// patchear schedulePlan para acotar presupuesto a 30s
await page.evaluate(() => {
  window.__schedulePlanReal = window.PlannerCore.schedulePlan.bind(window.PlannerCore);
  const start = Date.now();
  window.PlannerCore.schedulePlan = async (stateArg, options) => {
    const opts = { ...options, timeBudgetMs: Math.min(options.timeBudgetMs || 600000, 30000) };
    console.log("[PATCH] schedulePlan llamado con budget", opts.timeBudgetMs);
    const res = await window.__schedulePlanReal(stateArg, opts);
    console.log("[PATCH] schedulePlan OK", JSON.stringify({ scheduled: res?.stats?.scheduled, unscheduled: res?.stats?.unscheduled, aborted: !!res?.performance?.aborted, phase: res?.performance?.lastPhase, elapsed: Date.now() - start }));
    return res;
  };
});

// sembrar selectedOts si vacio
p = await probe();
if (p.selectedOts === 0) {
  const n = await page.evaluate(() => {
    const ops = state.operations || [];
    const set = new Set(ops.filter((o) => o.tipoInsercion !== "CAMBIO_HERRAMENTAL").map((o) => String(o.ot)));
    state.selectedOts = [...set];
    return state.selectedOts.length;
  });
  console.log("[2] selectedOts sembrado:", n);
}

console.log("[2] Click Generar (budget 30s)...");
await page.evaluate(() => document.querySelector("#generatePlanBtn").click());
const t0 = Date.now();
for (let i = 0; i < 40; i++) {
  await sleep(15000);
  p = await probe();
  const toasts = await toastText();
  if (i % 2 === 0 || p.scheduled != null || p.genDisabled === false) console.log(`[3] +${Math.round((Date.now() - t0) / 1000)}s`, JSON.stringify(p), "toasts:", JSON.stringify(toasts));
  if (p.genDisabled === false) { console.log("[3] boton liberado (fin o error)"); break; }
}
p = await probe();
const t = await toastText();
console.log("[3] FINAL:", JSON.stringify(p), "toasts:", JSON.stringify(t));
await page.screenshot({ path: OUT_DIR + "/gen-plan-short-budget.png" });

await browser.close();
console.log("DONE");