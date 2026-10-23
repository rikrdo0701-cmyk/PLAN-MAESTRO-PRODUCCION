// Sonda de impresion de la hoja de inspeccion contra el sitio DESPLEGADO.
// Mide el alto de LAYOUT con media=print (emulateMedia) y genera el PDF para
// contar paginas. Uso: PROBE_N=40 node tmp-probe-print.mjs
import { chromium } from "playwright";

const BASE = process.env.PROBE_BASE || "http://127.0.0.1:4173/index.html";
const N = Number(process.env.PROBE_N || 40);
const OUT = `C:/Users/plane/AppData/Local/Temp/opencode/inspeccion-real-${N}.pdf`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(BASE, { waitUntil: "networkidle" });
await page.evaluate(() => { location.hash = "#hoja-inspeccion"; });
await page.waitForSelector("#inspectionDocument", { timeout: 20000 });
await page.waitForTimeout(800);

const built = await page.evaluate((N) => {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const cell = (span, html = "", classes = "") => `<div class="inspection-cell ${classes}" style="grid-column:span ${span}">${html}</div>`;
  const operationHeader = () =>
    cell(1, "", "inspection-br") + cell(2, "", "inspection-br") + cell(2, "", "inspection-br") + cell(1, "", "inspection-br") +
    cell(2, "SETUP", "inspection-gray") + cell(2, "INACTIVIDAD", "inspection-gray") + cell(2, "PRODUCCION", "inspection-gray inspection-br") +
    cell(2, "", "inspection-br") + cell(1, "", "inspection-br") + cell(2, "", "inspection-br") + cell(2, "", "inspection-br") +
    cell(1, "", "inspection-br") + cell(2, "PRODUCCION", "inspection-gray inspection-br") + cell(2, "");
  const operationSubheader = (label) =>
    cell(1, label, "inspection-head inspection-br") + cell(2, "No. Operador", "inspection-head inspection-br") +
    cell(2, "Fecha", "inspection-head inspection-br") + cell(1, "No.<br>Máquina", "inspection-head inspection-head-tight inspection-br") +
    cell(1, "Inicio", "inspection-gray") + cell(1, "Fin", "inspection-gray") + cell(1, "Inicio", "inspection-gray") +
    cell(1, "Fin", "inspection-gray") + cell(1, "Inicio", "inspection-gray") + cell(1, "Fin", "inspection-gray") +
    cell(2, "Cant.<br>Piezas", "inspection-head inspection-br") + cell(1, "Captura", "inspection-head inspection-br") +
    cell(2, "No. Operador", "inspection-head inspection-br") + cell(2, "Fecha", "inspection-head inspection-br") +
    cell(1, "No.<br>Máquina", "inspection-head inspection-head-tight inspection-br") +
    cell(1, "Inicio", "inspection-gray") + cell(1, "Fin", "inspection-gray") + cell(2, "Cant.", "inspection-head");
  const operationRow = (code) =>
    cell(1, esc(code), "inspection-op-line inspection-op inspection-br") + cell(2, "", "inspection-op-line inspection-br") +
    cell(2, "", "inspection-op-line inspection-br") + cell(1, "", "inspection-op-line inspection-br") +
    cell(1, "", "inspection-op-line") + cell(1, "", "inspection-op-line inspection-br") +
    cell(1, "", "inspection-op-line") + cell(1, "", "inspection-op-line inspection-br") +
    cell(1, "", "inspection-op-line") + cell(1, "", "inspection-op-line inspection-br") +
    cell(2, "", "inspection-op-line inspection-br") + cell(1, "", "inspection-op-line inspection-br") +
    cell(2, "", "inspection-op-line inspection-br") + cell(2, "", "inspection-op-line inspection-br") +
    cell(1, "", "inspection-op-line inspection-br") + cell(1, "", "inspection-op-line") +
    cell(1, "", "inspection-op-line inspection-br") + cell(2, "", "inspection-op-line");
  const materialRow = () =>
    cell(3, "", "inspection-br") + cell(3, "", "inspection-br") + cell(2, "", "inspection-br") + cell(2, "", "inspection-br") +
    cell(3, "", "inspection-br") + cell(3, "", "inspection-br") + cell(2, "", "inspection-br") + cell(2, "", "inspection-br") +
    cell(1, "", "inspection-br") + cell(1, "", "inspection-br") + cell(2, "");

  const rows = Array.from({ length: N }, (_, i) => operationRow(`OP ${String(i + 1).padStart(2, "0")}`)).join("");
  const grid = document.getElementById("inspectionSheetGrid");
  const second = document.getElementById("inspectionSecondCapture");
  const footer = document.getElementById("inspectionReleaseFooter");

  grid.innerHTML = `<div class="inspection-doc-code">MP FO 08 V23</div>
    ${cell(24, '<strong class="inspection-logo">MALDONADO</strong><span class="inspection-title-text">HOJA DE INSPECCION Y ESTADISTICAS DE TUBERIA DOBLADA</span>', "inspection-title")}
    ${cell(4, "", "inspection-br inspection-bb")}
    ${cell(2, "Trabajo:", "inspection-label inspection-bb inspection-strong")}
    ${cell(3, "WO-1234", "inspection-big inspection-bb inspection-strong")}
    ${cell(7, "M66-4482-001", "inspection-big inspection-br inspection-bb inspection-strong")}
    ${cell(2, "REV", "inspection-big inspection-bb inspection-strong")}
    ${cell(1, "A", "inspection-big inspection-br inspection-bb inspection-strong")}
    ${cell(1, "Cantidad:", "inspection-label inspection-bb inspection-strong")}
    ${cell(4, "50 Piezas", "inspection-big inspection-bb inspection-strong")}
    ${cell(7, "ORDEN DE VENTA", "inspection-label inspection-br inspection-bb inspection-strong")}
    ${materialRow()}${materialRow()}${materialRow()}
    <div class="inspection-section-title"></div>
    ${operationHeader()}${operationSubheader("OP")}${rows}`;

  second.innerHTML = `<div class="inspection-grid"><div class="inspection-section-title"></div>${operationHeader()}${operationSubheader("OPER.")}${operationRow("").repeat(3)}</div>`;

  const footerCell = (span, html, classes = "", rowSpan = 1) =>
    `<div class="inspection-footer-cell ${classes}" style="grid-column:span ${span}${rowSpan > 1 ? `;grid-row:span ${rowSpan}` : ""}">${html}</div>`;
  let footerHtml =
    footerCell(1, "Oper", "inspection-footer-head") + footerCell(1, "N°<br>OPER", "inspection-footer-head") +
    footerCell(2, "Cantidad NC", "inspection-footer-head") + footerCell(1, "Clave", "inspection-footer-head inspection-br") +
    footerCell(4, "FTY", "inspection-footer-head inspection-br") + footerCell(6, "SELLO LIBERACION", "inspection-footer-head inspection-br") +
    footerCell(5, "OBSERVACIONES:", "inspection-footer-head inspection-br") + footerCell(2, "ENTREGA", "inspection-footer-head inspection-br") +
    footerCell(1, "CANT.", "inspection-footer-head inspection-br") + footerCell(1, "RECIBE", "inspection-footer-head");
  for (let row = 0; row < 3; row++) {
    footerHtml += footerCell(1, "") + footerCell(1, "") + footerCell(2, "") + footerCell(1, "", "inspection-br") + footerCell(4, "", "inspection-br");
    if (row === 0) footerHtml += footerCell(6, "", "inspection-seal-box inspection-br", 3);
    footerHtml += footerCell(5, "", "inspection-br") + footerCell(2, "", "inspection-br") + footerCell(1, "", "inspection-br") + footerCell(1, "");
  }
  footer.innerHTML = footerHtml;
  return { filasOp: N };
}, N);

// Igual que printInspection: @page + clase, y medimos con media=print
await page.addStyleTag({ content: "@media print { @page { size: 297mm 210mm; margin: 3mm 8mm 5mm 9mm; } }" });
await page.emulateMedia({ media: "print" });
await page.evaluate(() => document.body.classList.add("printing-inspection"));
await page.waitForTimeout(300);

const measure = await page.evaluate(() => {
  const sheet = document.getElementById("inspectionDocument");
  const grid = document.getElementById("inspectionSheetGrid");
  const second = document.getElementById("inspectionSecondCapture");
  const footer = document.getElementById("inspectionReleaseFooter");
  const pageH = (210 - 3 - 5) * 96 / 25.4;
  const pageW = (297 - 9 - 8) * 96 / 25.4;
  const r = sheet.getBoundingClientRect();
  return {
    media: matchMedia("print").matches ? "print" : "screen",
    altoLayout: Math.round(sheet.scrollHeight * 10) / 10,
    anchoLayout: Math.round(sheet.scrollWidth * 10) / 10,
    altoPagina: Math.round(pageH * 10) / 10,
    anchoPagina: Math.round(pageW * 10) / 10,
    grid: Math.round(grid.getBoundingClientRect().height * 10) / 10,
    segunda: Math.round(second.getBoundingClientRect().height * 10) / 10,
    finFooter: Math.round((footer.getBoundingClientRect().bottom - r.top) * 10) / 10,
    cabeUnaPagina: sheet.scrollHeight <= pageH && sheet.scrollWidth <= pageW,
    transformAplicado: getComputedStyle(sheet).transform,
  };
});

if (process.env.PROBE_ZOOM === "1" && measure.altoLayout > measure.altoPagina) {
  const z = Math.max(0.55, (measure.altoPagina * 0.97) / measure.altoLayout);
  await page.evaluate((z) => {
    const s = document.getElementById("inspectionDocument");
    s.style.zoom = String(z);
  }, z);
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => {
    const s = document.getElementById("inspectionDocument");
    const zz = Number(getComputedStyle(s).zoom) || 1;
    return { zoom: zz, altoEfectivo: Math.round((s.scrollHeight * zz) * 10) / 10, transform: getComputedStyle(s).transform };
  });
  measure.zoomAplicado = Math.round(z * 1000) / 1000;
  measure.altoEfectivo = after.altoEfectivo;
  measure.cabeUnaPagina = after.altoEfectivo <= measure.altoPagina;
}

await page.pdf({ path: OUT, format: "A4", landscape: true, printBackground: true, preferCSSPageSize: true });
await browser.close();

const bytes = (await import("fs")).readFileSync(OUT).toString("latin1");
const m = bytes.match(/\/Count\s+(\d+)/);
console.log(JSON.stringify({ ...built, ...measure, paginasPdf: m ? Number(m[1]) : null, errores: errors.slice(0, 3) }, null, 2));
