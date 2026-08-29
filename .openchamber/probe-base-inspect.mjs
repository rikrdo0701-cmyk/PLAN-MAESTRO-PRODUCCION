import { chromium } from "playwright";
const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=d6a16c6";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
await page.goto(SITE + "#planning", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && (state.operations || []).length > 300, null, { timeout: 180000, polling: 2000 });
await page.waitForTimeout(8000);

const result = await page.evaluate(() => (async () => {
  const out = {};
  await loadPlanSnapshots(false).catch(() => {});
  await new Promise((r) => setTimeout(r, 3000));
  const snaps = typeof planSnapshots !== "undefined" ? planSnapshots : [];
  const draftMeta = snaps.find((s) => s.snapshotId === "draft") || null;
  out.snapshotCount = snaps.length;
  out.hasDraft = !!draftMeta;
  const week = window.PlanningWorkflowCore.mondayIso("2026-08-28");
  let candidate;
  try {
    candidate = window.PlanningWorkflowCore.selectIncrementalBase(snaps, week, draftMeta);
  } catch (e) { out.selectErr = String(e); }
  out.week = week;
  out.candidate = candidate ? { id: candidate.snapshotId, week: candidate.weekStart, start: candidate.planStart, ops: candidate.operations, hasFullState: !!candidate.fullState, hasOps: Array.isArray(candidate.operations) } : null;

  // cargar base completa
  let base = null;
  if (candidate?.snapshotId && candidate.snapshotId !== "draft") {
    base = await callAppsScript("getPlanSnapshot", candidate.snapshotId).catch((e) => ({ err: String(e) }));
  }
  out.baseLoaded = base && !base.err ? { id: base.snapshotId, ops: Array.isArray(base.operations) ? base.operations.length : -1 } : base;
  if (base && Array.isArray(base.operations)) {
    const weekOps = base.operations.filter((o) => {
      const d = String(o.fechaInicio || "").slice(0, 10);
      return d >= "2026-08-24" && d <= "2026-08-30";
    });
    out.baseWeek24_30Ops = weekOps.map((o) => ({ ot: o.ot, fi: o.fechaInicio, hi: o.horaInicio, sec: o.secuencia, estatus: o.estatus, planStatus: String(o.planStatus || "") }));
    const minFis = base.operations.map((o) => String(o.fechaInicio || "").slice(0, 10)).filter(Boolean).sort();
    out.baseMinFi = minFis[0] || null;
    out.baseMaxFi = minFis[minFis.length - 1] || null;
    const startCount = window.PlanningWorkflowCore.operationsStartingInWeek(base, week);
    out.baseOperationsStartingInWeek = startCount;
    out.fixWouldTrigger = startCount === 0;
  }
  return out;
})());
console.log(JSON.stringify(result, null, 2));
await browser.close();
console.log("DONE");
