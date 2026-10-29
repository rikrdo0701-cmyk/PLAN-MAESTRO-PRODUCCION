import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto("https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=367245a#planning", { waitUntil: "networkidle", timeout: 90000 });
await page.waitForFunction(() => {
  return typeof state !== "undefined" && state.planStart && state.operations && state.operations.length > 0;
}, null, { timeout: 240000, polling: 3000 }).catch(() => null);
await page.waitForTimeout(4000);

const out = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll("input")].map((i) => ({
    id: i.id, type: i.type, value: i.value, placeholder: i.placeholder,
    ariaLabel: i.getAttribute("aria-label"), name: i.getAttribute("name"),
    class: i.className.slice(0, 60),
  }));
  const selects = [...document.querySelectorAll("select")].map((s) => ({
    id: s.id, value: s.value, options: [...s.options].map((o) => ({ v: o.value, t: o.textContent.trim().slice(0, 60) })).slice(0, 12),
  }));
  const buttons = [...document.querySelectorAll("button")].map((b) => ({
    id: b.id, text: b.textContent.trim().slice(0, 80), class: b.className.slice(0, 60), disabled: b.disabled,
  })).filter((b) => /generar|guardar|publicar|plan|inicio/i.test(b.text + b.id || ""));
  const labels = [...document.querySelectorAll("label")].map((l) => (l.textContent.trim() + " -> " + (l.htmlFor || l.innerText.trim())).slice(0, 100));
  return {
    hash: location.hash,
    planStart: state?.planStart,
    opsCount: state?.operations?.length,
    inputs,
    selects,
    buttons,
    labels,
    bodySnippet: document.body.innerText.slice(0, 600),
  };
});
console.log(JSON.stringify(out, null, 2));
console.log("ERRORS", JSON.stringify(errors));
await browser.close();