import { chromium } from "playwright";

const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=d6a16c6";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
page.on("console", (m) => { if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 260)); });

const probe = () => page.evaluate(() => {
  const btn = document.querySelector("#generatePlanBtn");
  const pubBtn = document.querySelector("#publishPlanBtn");
  const labelEl = btn?.querySelector("[data-schedule-label]");
  return {
    planStart: state?.planStart || "",
    planStartInput: document.querySelector("#planStartInput")?.value || "",
    selectedOts: Array.isArray(state?.selectedOts) ? state.selectedOts.length : -1,
    ops: (state?.operations || []).length,
    workOrders: (state?.workOrders || []).length,
    genDisabled: btn ? btn.disabled : null,
    pubDisabled: pubBtn ? pubBtn.disabled : null,
    genLabel: labelEl ? labelEl.textContent.trim() : (btn ? btn.textContent.trim().slice(0, 26) : ""),
    scheduled: state?.lastSchedule?.scheduled ?? null,
    aborted: state?.lastSchedule?.performance?.aborted ?? null,
    phase: state?.lastSchedule?.performance?.lastPhase || "",
    hash: location.hash,
    netSuiteSyncInFlight: typeof netSuiteSyncInFlight !== "undefined" ? netSuiteSyncInFlight : "n/a",
  };
});

const toastText = () => page.evaluate(() => {
  const els = [...document.querySelectorAll('[id*="toast" i], [class*="toast" i]')];
  return els.map((e) => (e.innerText || "").trim()).filter(Boolean).slice(-3);
});

console.log("[A1] Confirmar fix en bundle bundle...");
const bundleInfo = await page.evaluate(() => ({}));
try {
  const resp = await fetch(window.location.href);
  // alternativamente buscar el literal ya confirmado en html descargado
  console.log("[A1] (fix literal ya confirmado en index-live.html, no-se-minifica)");
} catch (e) { console.log("[A1]", String(e)); }

console.log("[A2] Cargando #planning...");
await page.goto(SITE + "#planning", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && state.planStart && (state.operations || []).length > 300, null, { timeout: 240000, polling: 2000 });
await sleep(4000);
let p = await probe();
console.log("[A2] estado inicial:", JSON.stringify(p, null, 2));

console.log("[A3] Contando OTs con operaciones y snapshots...");
const counts = await page.evaluate(() => {
  const ops = state.operations || [];
  const otSet = new Set(ops.map((o) => String(o.ot)));
  const otNoCambio = new Set(ops.filter((o) => o.tipoInsercion !== "CAMBIO_HERRAMENTAL").map((o) => String(o.ot)));
  const snaps = typeof planSnapshots !== "undefined" ? planSnapshots : [];
  const sel = document.querySelector("#planSnapshotSelect");
  const opts = sel ? [...sel.options].map((o) => ({ v: o.value, t: o.textContent.trim().slice(0, 50) })) : [];
  return {
    uniqueOts: otSet.size,
    uniqueOtsNoCambioHerramiental: otNoCambio.size,
    opsWithFechaInicio: ops.filter((o) => o.fechaInicio).length,
    minFi: ops.filter((o) => o.fechaInicio).map((o) => String(o.fechaInicio).slice(0, 10)).sort()[0] || null,
    snapshotsGlobal: snaps.length,
    snapshotSelectOpts: opts.length,
    backend: (window.PPAppsScriptBridge ? (window.PPAppsScriptBridge.defaultWebAppUrl || window.PPAppsScriptBridge.DEFAULT_WEB_APP_URL || "?") : "n/a"),
  };
});
console.log("[A3] counts:", JSON.stringify(counts, null, 2));

const t = await toastText();
console.log("[A3] toasts:", JSON.stringify(t));
await page.screenshot({ path: "C:/Users/plane/Downloads/plangit/.openchamber/screenshots/e2e-step2-initial.png" });

await browser.close();
console.log("PHASE-A-DONE");
