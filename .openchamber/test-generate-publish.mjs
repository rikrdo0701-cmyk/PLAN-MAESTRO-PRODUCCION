import { chromium } from "playwright";

const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=367245a";
const OUT_DIR = "C:/Users/plane/Downloads/plangit/.openchamber/screenshots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
page.on("console", (m) => { if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 200)); });

const opsInfo = () => page.evaluate(() => {
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
  return {
    planStart: state?.planStart || "",
    opsCount: ops.length,
    minFi: iso(fi[0]), maxFi: iso(fi[fi.length - 1]),
    opsOn0828: ops.filter((o) => o.fechaInicio && o.fechaInicio >= "2026-08-28" && o.fechaInicio < "2026-08-29").length,
    opsBefore0828: ops.filter((o) => o.fechaInicio && o.fechaInicio < "2026-08-28").length,
    byWeek: { "2026-08-17": byWeek["2026-08-17"], "2026-08-24": byWeek["2026-08-24"], "2026-08-31": byWeek["2026-08-31"], "2026-09-07": byWeek["2026-09-07"] },
    genDisabled: document.querySelector("#generatePlanBtn")?.disabled,
    genText: document.querySelector("#generatePlanBtn")?.textContent?.trim().slice(0, 30),
  };
});

// ---- PHASE 1: load + BEFORE ----
console.log("[1] Cargando vista planning...");
await page.goto(SITE + "#planning", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && state.planStart, null, { timeout: 90000, polling: 2000 });
console.log("[1] planStart inicial:", await page.evaluate(() => state.planStart));
const before = await opsInfo();
console.log("[1] BEFORE:", JSON.stringify(before));

// ensure planStart = today (2026-08-28)
if (before.planStart !== "2026-08-28") {
  console.log("[1] PlanStart distinto, intentando fijar 2026-08-28...");
  const setOk = await page.evaluate(() => {
    const setPlanStart = async (d) => { try { if (state && typeof state.planStart !== "undefined") { state.planStart = d; } } catch (e) {} return state?.planStart; };
    return setPlanStart("2026-08-28");
  });
  console.log("[1] state.planStart despues:", setOk);
}

// wait for generate button enabled (sync ends)
console.log("[2] Esperando sincronizacion (generatePlanBtn habilitado)...");
await page.waitForFunction(() => !document.querySelector("#generatePlanBtn")?.disabled, null, { timeout: 180000, polling: 2000 });
console.log("[2] generatePlanBtn habilitado.");

// ---- PHASE 2: GENERATE ----
await page.screenshot({ path: OUT_DIR + "/gen-plan-before.png", fullPage: false });
console.log("[3] Generando plan...");
await page.evaluate(() => document.querySelector("#generatePlanBtn").click());
const t0 = Date.now();
let lastMin = before.minFi;
let stablePolls = 0;
let generated = false;
while (Date.now() - t0 < 480000) {
  await sleep(15000);
  const now = await opsInfo();
  console.log(`[3] +${Math.round((Date.now() - t0) / 1000)}s genDisabled=${now.genDisabled} genText=${now.genText} ops=${now.opsCount} minFi=${now.minFi} before0828=${now.opsBefore0828}`);
  if (now.opsBefore0828 === 0 && now.minFi >= "2026-08-28" && now.genDisabled === false) {
    if (now.minFi === lastMin) { stablePolls++; } else { stablePolls = 0; lastMin = now.minFi; }
    if (stablePolls >= 2) { generated = true; break; }
  }
}
if (!generated) console.log("[3] ATENCION: no se confirmo terminacion de generacion dentro del cap; continuo con estado actual.");
const afterGen = await opsInfo();
console.log("[3] AFTER-GENERATE:", JSON.stringify(afterGen));
await page.screenshot({ path: OUT_DIR + "/gen-plan-after-board.png", fullPage: false });

// ---- PHASE 3: PUBLISH ----
console.log("[4] Publicando plan...");
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
if (!newSnap) console.log("[4] No se detecto nuevo snapshot con planStart 2026-08-28 aun; listando ultimos:");
console.log("[4] nuevo snapshot:", JSON.stringify(newSnap && { id: newSnap.snapshotId, week: newSnap.weekStart, start: newSnap.planStart, ops: newSnap.operations, gen: newSnap.generatedAt }));
await page.screenshot({ path: OUT_DIR + "/published-snapshot-loaded.png", fullPage: false });

// ---- PHASE 4: LOAD SNAPSHOT + REPORT ----
console.log("[5] Cargando snapshot publicado y leyendo reporte...");
if (newSnap) {
  await page.evaluate((id) => {
    const s = document.querySelector("#planSnapshotSelect");
    if (s) { const opts = [...s.options]; const o = opts.find((opt) => opt.value === id); if (o) { s.value = id; s.dispatchEvent(new Event("change")); } }
  }, newSnap.snapshotId);
  await page.waitForFunction((snapId) => typeof reportSnapshot !== "undefined" && reportSnapshot.snapshotId === snapId, newSnap.snapshotId, { timeout: 420000, polling: 3000 }).catch(() => console.log("[5] snapshot no cargo en cap"));
}
await sleep(5000);
const report = await page.evaluate(() => {
  const iso = (d) => (d ? String(d).slice(0, 10) : "");
  const ops = (typeof reportSnapshot !== "undefined" && reportSnapshot.operations) ? reportSnapshot.operations : [];
  const fi = ops.map((o) => o.fechaInicio).filter(Boolean).sort();
  const w = document.getElementById("weekReportStartInput");
  const weekLabel = w ? w.value : "";
  const text = document.body.innerText;
  const sinOTs = text.includes("Sin OTs para esta semana");
  const zero = (text.match(/\$0\.00/g) || []).length;
  const semanaSection = (text.split("Plan de la semana")[1] || "").slice(0, 600);
  return {
    reportSnapshotId: reportSnapshot?.snapshotId,
    opsCount: ops.length,
    minFi: iso(fi[0]), maxFi: iso(fi[fi.length - 1]),
    first6: ops.slice(0, 6).map((o) => ({ ot: o.ot, fi: o.fechaInicio, hi: o.horaInicio, desc: (o.descripcion || "").slice(0, 24) })),
    weekReportStartInput: weekLabel,
    reportWeekStart: state?.reportWeekStart || "",
    sinOTs, zeroCount: zero,
    semanaSection,
  };
});
console.log("[5] REPORT:", JSON.stringify(report, null, 2));
await page.screenshot({ path: OUT_DIR + "/report-week.png", fullPage: true });

await browser.close();
console.log("DONE");