import { chromium } from "playwright";
const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=367245a";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
await page.goto(SITE + "#reportes", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForTimeout(15000);
const info = await page.evaluate(() => {
  const sel = document.querySelector("#planSnapshotSelect");
  const opts = sel ? [...sel.options].map((o) => ({ v: o.value, t: o.textContent.trim().slice(0, 60) })) : [];
  const ws = (typeof state !== "undefined" && state) ? { planStart: state.planStart, ops: (state.operations || []).length } : null;
  const snaps = typeof planSnapshots !== "undefined" ? planSnapshots.map((s) => ({ id: s.snapshotId, week: s.weekStart, start: s.planStart, ops: s.operations, gen: s.generatedAt })) : null;
  return { opts, snaps, ws };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
console.log("DONE");