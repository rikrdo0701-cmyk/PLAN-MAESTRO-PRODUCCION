import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.goto("https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=367245a#reportes", { waitUntil: "networkidle", timeout: 90000 });
await page.locator("#refreshSnapshotsBtn").click();
await page.waitForFunction(() => {
  const s = document.querySelector("#planSnapshotSelect");
  return s && s.options.length > 1 && s.value !== "draft";
}, null, { timeout: 240000, polling: 3000 }).catch(() => null);
await page.waitForTimeout(6000);

const grab = () => page.evaluate(() => {
  const startPanel = document.querySelector("#weekReport section.weekly-job-panel:nth-of-type(2)")?.innerText || "";
  const finishPanel = document.querySelector("#weekReport section.weekly-job-panel.finish")?.innerText || "";
  const loadsPanel = document.querySelector("#weekReport section.weekly-job-panel.loads")?.innerText || "";
  const opRows = document.querySelector("#operatorReport tbody")?.children.length || 0;
  const weekStart = document.querySelector("#weekReportStartInput")?.value;
  return { weekStart, opRows, startPanel: startPanel.slice(0, 220), finishPanel: finishPanel.slice(0, 220), loadsPanel: loadsPanel.slice(0, 160) };
});

const results = {};
results.currentWeek = await grab();
await page.fill("#weekReportStartInput", "2026-08-17");
await page.dispatchEvent("#weekReportStartInput", "change");
await page.waitForTimeout(1500);
results.week1708 = await grab();
await page.fill("#weekReportStartInput", "2026-09-28");
await page.dispatchEvent("#weekReportStartInput", "change");
await page.waitForTimeout(1500);
results.week2809 = await grab();

console.log(JSON.stringify(results, null, 2));
await browser.close();