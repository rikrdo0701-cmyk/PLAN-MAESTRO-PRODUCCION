import { chromium } from "playwright";
const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=367245a";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
await page.goto(SITE + "#planning", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && (state.operations || []).length > 300, null, { timeout: 180000, polling: 2000 });
await page.waitForTimeout(8000);
const result = await page.evaluate(() => (async () => {
  const out = {};
  if (typeof callAppsScript !== "function") { out.fn = "no-global"; return out; }
  try {
    const t0 = Date.now();
    const res = await callAppsScript("listPlanSnapshots");
    out.elapsedMs = Date.now() - t0;
    out.result = Array.isArray(res) ? res.map((s) => ({ id: s.snapshotId, week: s.weekStart, start: s.planStart, ops: s.operations, gen: s.generatedAt, label: s.label })) : res;
  } catch (e) { out.error = String(e); }
  return out;
})());
console.log(JSON.stringify(result, null, 2));
await browser.close();
console.log("DONE");