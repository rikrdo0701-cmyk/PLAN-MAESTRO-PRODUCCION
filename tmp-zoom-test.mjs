// Prueba si `zoom` (a diferencia de transform:scale) reduce el alto de LAYOUT
// y por tanto el paginado del PDF. Reutiliza el documento sintetico de tmp-probe-print.mjs
// via import de su parte no ejecutable: aqui se repite lo minimo.
import { chromium } from "playwright";
import fs from "fs";

const BASE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/index.html";
const N = 100;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.goto(BASE, { waitUntil: "networkidle" });
await page.evaluate(() => { location.hash = "#hoja-inspeccion"; });
await page.waitForSelector("#inspectionDocument", { timeout: 20000 });
await page.waitForTimeout(600);

// documento sintetico simple: N filas de operacion con las clases reales
await page.evaluate((N) => {
  const cell = (span, cls) => `<div class="inspection-cell ${cls}" style="grid-column:span ${span}"></div>`;
  const opRow = (i) => Array.from({ length: 18 }, (_, k) => cell(k === 0 ? 1 : 1, `inspection-op-line inspection-br${k === 0 ? " inspection-op" : ""}`)).join("");
  const grid = document.getElementById("inspectionSheetGrid");
  grid.innerHTML = cell(24, "inspection-title") + cell(24, "inspection-section-title") +
    Array.from({ length: 4 }, () => cell(24, "inspection-br")).join("") +
    Array.from({ length: N }, (_, i) => `<div class="inspection-row-probe" style="display:contents">${opRow(i)}</div>`).join("");
  document.getElementById("inspectionSecondCapture").innerHTML = "";
  document.getElementById("inspectionReleaseFooter").innerHTML = "";
}, N);

await page.addStyleTag({ content: "@media print { @page { size: 297mm 210mm; margin: 3mm 8mm 5mm 9mm; } }" });
await page.emulateMedia({ media: "print" });
await page.evaluate(() => document.body.classList.add("printing-inspection"));
await page.waitForTimeout(200);

const pageH = (210 - 3 - 5) * 96 / 25.4;
const before = await page.evaluate(() => document.getElementById("inspectionDocument").scrollHeight);
console.log("alto sin zoom:", Math.round(before), "pagina:", Math.round(pageH));

// aplica zoom para que quepa
const zoom = Math.min(1, pageH / before);
await page.evaluate((z) => {
  const s = document.getElementById("inspectionDocument");
  s.style.zoom = String(z);
  s.style.width = `${280 / z}mm`;
  s.style.minHeight = `${202 / z}mm`;
}, zoom);
await page.waitForTimeout(200);
const after = await page.evaluate(() => {
  const s = document.getElementById("inspectionDocument");
  return { zoom: getComputedStyle(s).zoom, offsetHeight: s.offsetHeight, rectH: s.getBoundingClientRect().height * Number(getComputedStyle(s).zoom) };
});
console.log("zoom:", zoom.toFixed(4), JSON.stringify(after), "alto efectivo:", Math.round(after.rectH));

const OUT = "C:/Users/plane/AppData/Local/Temp/opencode/zoom-test.pdf";
await page.pdf({ path: OUT, format: "A4", landscape: true, printBackground: true, preferCSSPageSize: true });
await browser.close();
const m = fs.readFileSync(OUT).toString("latin1").match(/\/Count\s+(\d+)/);
console.log("paginas PDF con zoom:", m ? m[1] : "?");
