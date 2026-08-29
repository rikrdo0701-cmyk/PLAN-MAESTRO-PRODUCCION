import { chromium } from "playwright";
const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=367245a";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
await page.goto(SITE + "#planning", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && (state.operations || []).length > 300, null, { timeout: 180000, polling: 2000 });
await page.waitForTimeout(10000);
const raw = await page.evaluate(() => (async () => {
  const candidates = [typeof PLAN_SNAPSHOTS_API !== "undefined" ? PLAN_SNAPSHOTS_API : null];
  const out = [];
  for (const url of candidates.filter(Boolean)) {
    try { const r = await fetch(url, { headers: { Accept: "application/json" } }); const t = await r.text(); out.push({ url, status: r.status, body: t.slice(0, 700) }); } catch (e) { out.push({ url, error: String(e) }); }
  }
  return out;
})());
console.log(JSON.stringify(raw, null, 2));
// tambien el listado de la app
const ls = await page.evaluate(() => (typeof loadPlanSnapshots === "function") ? "clave-existe" : "no-existe");
console.log("loadPlanSnapshots:", ls);
await browser.close();
console.log("DONE");