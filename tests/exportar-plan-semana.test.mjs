// "Exportar" del Plan de la semana (pedido del usuario 2026-10-31): el boton "Generar PDF" pasa a
// llamarse "Exportar" y exporta el reporte en PDF o Excel. Este test fija:
//  1. El boton del HTML se llama "Exportar".
//  2. El handler siempre pide fuente (choosePdfSource sin el atajo de una sola opcion).
//  3. buildMultiSheetXlsxBytes produce un .xlsx con N hojas (no rompe buildXlsxBytes).
//  4. weeklyDayRowsForXlsx agrupa por dia como en pantalla.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8").then((s) => s.replace(/\r\n/g, "\n"));
const template = await readFile(new URL("../src/web/planning/index.template.html", import.meta.url), "utf8");

function sliceDesde(inicio, fin, fuente = app) {
  const start = fuente.indexOf(inicio);
  const end = fuente.indexOf(fin, start);
  assert.ok(start >= 0 && end > start, `Falta ${inicio} en la fuente`);
  return fuente.slice(start, end);
}

test("el boton de la barra se llama Exportar y apunta a handleExportPlan", () => {
  const boton = template.slice(template.indexOf('<button id="pdfBtn"'), template.indexOf("</button>", template.indexOf('<button id="pdfBtn"')));
  assert.match(boton, />\s*Exportar/, "la etiqueta del boton es 'Exportar'");
  assert.match(app, /els\.pdfBtn\.addEventListener\("click", \(\) => handleExportPlan\(\)\)/);
});

test("choosePdfSource SIEMPRE pregunta la fuente (sin atajo de una sola opcion)", () => {
  const fuente = sliceDesde("async function choosePdfSource()", "async function handleExportPlan()");
  assert.doesNotMatch(fuente, /if \(options\.length <= 1\) return "draft"/, "no debe saltarse el dialogo");
});

test("handleExportPlan ofrece PDF y Excel, y Excel llama a exportPlanWeeklyXlsx", () => {
  const fuente = sliceDesde("async function handleExportPlan()", "async function generatePlanPdf(");
  assert.match(fuente, /name="export_format" value="pdf"/);
  assert.match(fuente, /name="export_format" value="xlsx"/);
  assert.match(fuente, /if \(result\.export_format === "xlsx"\)/);
  assert.match(fuente, /return exportPlanWeeklyXlsx\(sourceId\)/);
  assert.match(fuente, /return generatePlanPdf\(sourceId\)/);
});

test("buildMultiSheetXlsxBytes genera un zip con una worksheet por hoja", () => {
  const fuente = sliceDesde("function buildMultiSheetXlsxBytes(sheets) {", "function buildSheetXml(");
  assert.match(fuente, /buildSheetXml\(sheet\.headers, sheet\.rows\)/, "reutiliza el constructor de hojas");
  assert.match(fuente, /worksheets\/sheet\$\{index \+ 1\}\.xml/, "una worksheet xml por hoja");
  const xlsx = sliceDesde("function buildXlsxBytes(headers, rows, sheetName) {", "function buildMultiSheetXlsxBytes(sheets) {");
  assert.ok(xlsx.includes("sheets><sheet name=\"${xmlEscape(sheetName)}\""), "buildXlsxBytes intacto (una hoja)");
});

test("weeklyDayRowsForXlsx agrupa por dia con encabezado, filas y total", () => {
  const fuente = sliceDesde("function weeklyDayRowsForXlsx(rows, finishing) {", "function weeklyResumenRowsForXlsx");
  const formatReportDate = (d) => String(d);
  const formatMaterialQuantity = (v) => String(Number(v) || 0);
  const parseDateOnlyValue = (v) => v;
  const rows = [
    { date: "27", ot: "A", part: "P1", pendingPieces: 10 },
    { date: "27", ot: "B", part: "P2", pendingPieces: 5 },
    { date: "28", ot: "C", part: "P3", pendingPieces: 20 },
  ];
  const period = Function(
    "formatDate", "parseDateOnlyValue", "formatReportDate", "formatMaterialQuantity", "formatCurrency", "window",
    `${fuente}; return weeklyDayRowsForXlsx;`,
  )((d) => d, parseDateOnlyValue, formatReportDate, formatMaterialQuantity, (v) => `$${v}`, { PlanningWorkflowCore: { effectiveFinishingAmount: () => 0, weeklyFinishingCost: () => ({ totalCost: 0 }) } });
  const salida = period(rows, false);
  assert.deepEqual(salida[0], ["27"], "primera fila del dia es el encabezado");
  assert.deepEqual(salida[1], ["27", "1", "A", "P1", "10"]);
  assert.deepEqual(salida[2], ["27", "2", "B", "P2", "5"]);
  assert.deepEqual(salida[3], ["Total 2", "", "", "", "15"], "total del dia");
  assert.deepEqual(salida[4], ["28"], "siguiente dia");
  assert.deepEqual(salida[5], ["28", "1", "C", "P3", "20"]);
});

test("weeklyResumenRowsForXlsx incluye indicadores y desglose por tipo", () => {
  const fuente = sliceDesde("function weeklyResumenRowsForXlsx(summary) {", "async function exportPlanWeeklyXlsx(");
  const formatCurrency = (v) => `$${v}`;
  const formatMaterialQuantity = (v) => String(Number(v) || 0);
  const summary = {
    releaseTarget: 1000, releaseAmount: 500, releaseGap: 500, costPerPiece: 2,
    peopleWithLoad: 3, releasePerPerson: 20, dailyInitialCutPieces: 30, dailyFinishingPieces: 10,
    staleInitialCutPieces: 1, staleFinishingPieces: 2,
    finishingByType: [{ type: "LINEA", pieces: 5, amount: 100, costPerPiece: 20 }],
  };
  const rows = Function("formatCurrency", "formatMaterialQuantity", `${fuente}; return weeklyResumenRowsForXlsx;`)(formatCurrency, formatMaterialQuantity)(summary);
  assert.equal(rows.length, 11, "10 indicadores + 1 fila de tipo");
  assert.deepEqual(rows[0], ["Meta semanal", "$1000"]);
  assert.deepEqual(rows[10], ["Tipo LINEA: piezas", "5", "Tipo LINEA: monto", "$100", "Tipo LINEA: costo p/p", "$20"]);
});