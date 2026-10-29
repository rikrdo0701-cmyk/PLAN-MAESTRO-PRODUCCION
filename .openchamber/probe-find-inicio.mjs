import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.goto("https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=367245a#planning", { waitUntil: "networkidle", timeout: 90000 });
await page.waitForFunction(() => typeof state !== "undefined" && state.planStart && state.operations && state.operations.length > 0, null, { timeout: 240000, polling: 3000 }).catch(() => null);
await page.waitForTimeout(3000);

const out = await page.evaluate(() => {
  const planStart = state?.planStart;
  const r = [];
  const matches = [];
  const inputs = [...document.querySelectorAll("input")];
  for (const el of inputs) {
    const probe = {
      id: el.id,
      type: el.type,
      value: el.value,
      placeholder: el.placeholder,
      label: el.closest("label")?.textContent.trim().slice(0, 30),
      name: el.getAttribute("name"),
    };
    if (/inicio|planstart/i.test(el.id + " " + (probe.label || "") + " " + el.className)) r.push(probe);
    if (el.type === "date" && el.value) matches.push(probe);
  }
  // search for the input whose label or associated text contains INICIO
  const iniInputs = inputs.filter((i) => {
    const l = i.closest("label");
    const prev = i.previousElementSibling?.textContent || "";
    const wrap = i.parentElement?.parentElement?.textContent || "";
    return /inicio/i.test((l?.textContent || "") + " " + prev + " " + wrap.slice(0, 40)) && i.type === "date";
  }).map((i) => ({ id: i.id, value: i.value, type: i.type }));
  return {
    planStart,
    header: document.querySelector(".plan-header")?.textContent || document.querySelector(".card-header")?.textContent || "",
    r,
    iniInputs,
    dateInputs: matches.slice(0, 12),
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();