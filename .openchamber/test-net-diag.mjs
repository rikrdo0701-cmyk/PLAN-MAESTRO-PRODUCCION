import { chromium } from "playwright";

const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=367245a";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("dialog", (d) => d.accept().catch(() => {}));

const reqs = new Map();
const doneReq = [];
page.on("request", (r) => { if (r.url().includes("script.google")) reqs.set(r.url() + "|" + r.headers()["x-requested-with"] + Date.now() + Math.random(), { url: r.url(), start: Date.now() }); });
page.on("response", async (res) => {
  if (!res.url().includes("script.google")) return;
  const elapsed = Date.now() - (reqs.get(res.url())?.start || Date.now());
  let ok = res.status();
  let body = "";
  try { body = (await res.text()).slice(0, 300); } catch (e) { body = "<no body>"; }
  doneReq.push({ url: res.url().slice(0, 110), status: ok, ms: elapsed, body: body.slice(0, 120) });
});
page.on("console", (m) => { const t = m.text(); if (t.includes("[PATCH]")) console.log("[console]", t.slice(0, 220)); });

await page.goto(SITE + "#planning", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && state.planStart && (state.operations || []).length > 300, null, { timeout: 180000, polling: 2000 });
await page.waitForFunction(() => document.querySelector("#generatePlanBtn") && !document.querySelector("#generatePlanBtn").disabled, null, { timeout: 780000, polling: 8000 }).catch(() => console.log("wait enabled: timeout"));

if (await page.evaluate(() => Array.isArray(state.selectedOts) ? state.selectedOts.length : -1) === 0) {
  await page.evaluate(() => { const ops = state.operations || []; state.selectedOts = [...new Set(ops.filter((o) => o.tipoInsercion !== "CAMBIO_HERRAMENTAL").map((o) => String(o.ot)))]; });
}
await page.evaluate(() => {
  window.__schedulePlanReal = window.PlannerCore.schedulePlan.bind(window.PlannerCore);
  window.PlannerCore.schedulePlan = async (stateArg, options) => { console.log("[PATCH] schedulePlan LLAMADO", JSON.stringify({ budget: options?.timeBudgetMs })); const res = await window.__schedulePlanReal(stateArg, options); console.log("[PATCH] schedulePlan OK", JSON.stringify({ sched: res?.stats?.scheduled })); return res; };
});
doneReq.length = 0;
const snapsBefore = await page.evaluate(() => typeof planSnapshots !== "undefined" ? planSnapshots.length : -1);
console.log("[0] snapshots antes:", snapsBefore);
await page.evaluate(() => document.querySelector("#generatePlanBtn").click());
const t0 = Date.now();
for (let i = 0; i < 10; i++) {
  await sleep(15000);
  const st = await page.evaluate(() => { const b = document.querySelector("#generatePlanBtn"); const ls = state.lastSchedule; return { disabled: b.disabled, ops: state.operations.length, scheduled: ls?.scheduled ?? null, draft: typeof planSnapshots !== "undefined" ? (planSnapshots.find((s) => s.snapshotId === "draft") ? "Y" : "N") : "?" }; });
  const slow = doneReq.filter((d) => d.ms > 5000).sort((a, b) => b.ms - a.ms).slice(0, 3);
  console.log(`[1] +${Math.round((Date.now() - t0) / 1000)}s btn=${st.disabled} ops=${st.ops} sched=${st.scheduled} draft=${st.draft} reqs=${doneReq.length} slow(top3):`, JSON.stringify(slow.map((s) => ({ ms: s.ms, st: s.status, u: s.url.slice(-60), b: s.body }))));
  if (st.disabled === false && i > 0) break;
}
const summary = await page.evaluate(() => {
  const rs = [];
  for (const d of doneReq) {
    const msKey = d.url + "|" + d.body;
    const m = rs.find((x) => x.key === msKey);
    if (m) { m.count++; m.total += d.ms; } else rs.push({ key: msKey, count: 1, total: d.ms });
  }
  rs.sort((a, b) => b.total - a.total);
  return rs.slice(0, 8).map((r) => ({ url: r.key.slice(0, 90), count: r.count, totalMs: Math.round(r.total), avgMs: Math.round(r.total / r.count) }));
});
console.log("[2] por url:", JSON.stringify(summary, null, 2));
await browser.close();
console.log("DONE");