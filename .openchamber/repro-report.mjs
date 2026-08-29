import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto("https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=367245a#reportes", { waitUntil: "networkidle", timeout: 90000 });
await page.locator("#refreshSnapshotsBtn").click();

const options = await page.waitForFunction(() => {
  const sel = document.querySelector("#planSnapshotSelect");
  return sel && sel.options.length > 1 ? sel.value : false;
}, null, { timeout: 240000, polling: 3000 }).catch(() => null);

function grab() {
  return page.evaluate(() => {
    const meta = document.querySelector("#reportSnapshotMeta")?.textContent || "";
    const summary = document.querySelector("#weekExecutiveSummary")?.innerText || "";
    const week = document.querySelector("#weekReport")?.innerText || "";
    const operatorRows = document.querySelector("#operatorReport tbody")?.children.length || 0;
    const operatorText = document.querySelector("#operatorReport")?.innerText || "";
    const startPanel = document.querySelector("#weekReport section.weekly-job-panel:nth-of-type(2)")?.innerText || "";
    const finishPanel = document.querySelector("#weekReport section.weekly-job-panel.finish")?.innerText || "";
    const loadsPanel = document.querySelector("#weekReport section.weekly-job-panel.loads")?.innerText || "";
    return {
      selectValue: document.querySelector("#planSnapshotSelect")?.value,
      meta,
      summaryHead: summary.slice(0, 240),
      weekEmptyState: week.includes("No hay un plan publicado cargado para reportes."),
      startPanel: startPanel.slice(0, 300),
      finishPanel: finishPanel.slice(0, 300),
      loadsPanel: loadsPanel.slice(0, 300),
      operatorRows,
      operatorText: operatorText.slice(0, 120),
    };
  });
}

const before = await grab();
let after = null;
if (options) {
  const value = await options.jsonValue();
  const publishedId = await page.evaluate(() => {
    const sel = document.querySelector("#planSnapshotSelect");
    return [...sel.options].find((o) => o.value !== "draft")?.value || "";
  });
  if (publishedId && publishedId !== value) {
    await page.selectOption("#planSnapshotSelect", publishedId);
    await page.waitForTimeout(4000);
  }
  after = await grab();
}

console.log(JSON.stringify({ autoSelected: options ? await options.jsonValue() : null, before, after, errors }, null, 2));
await browser.close();