import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.goto("https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=367245a#planning", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && state.planStart, null, { timeout: 90000, polling: 2000 });
await page.waitForTimeout(1500);
const planning = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")].map((b) => ({ id: b.id, text: (b.innerText || "").trim().slice(0, 40), disabled: b.disabled, visible: b.offsetParent !== null }));
  const inputs = [...document.querySelectorAll("input,select")].map((i) => ({ tag: i.tagName, id: i.id, type: i.type || "", val: i.value }));
  return { btns: btns.filter((b) => b.visible).slice(0, 40), inputs: inputs.filter((i) => i.visible).slice(0, 40) };
});
console.log("PLANNING VIEW");
console.log(JSON.stringify(planning, null, 2));
await page.close();
const page2 = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page2.goto("https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=367245a#reportes", { waitUntil: "networkidle", timeout: 120000 });
await page2.waitForTimeout(3000);
const reportes = await page2.evaluate(() => {
  const btns = [...document.querySelectorAll("button")].map((b) => ({ id: b.id, text: (b.innerText || "").trim().slice(0, 40), disabled: b.disabled, visible: b.offsetParent !== null }));
  const inputs = [...document.querySelectorAll("input,select")].map((i) => ({ tag: i.tagName, id: i.id, type: i.type || "", val: i.value }));
  return { btns: btns.filter((b) => b.visible).slice(0, 40), inputs: inputs.filter((i) => i.visible).slice(0, 40) };
});
console.log("REPORTES VIEW");
console.log(JSON.stringify(reportes, null, 2));
await browser.close();