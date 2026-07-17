import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/server/16-inspection-service.js", import.meta.url), "utf8");

function loadService(overrides = {}) {
  const context = {
    Date,
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => "" }) },
    SpreadsheetApp: { openById: () => ({}) },
    PP_normalizeKey_: (value) => String(value ?? "").trim().toUpperCase(),
    PP_readRows_: () => [],
    Session: { getScriptTimeZone: () => "America/Mexico_City" },
    Utilities: { formatDate: () => "15/07/2026 17:04:03" },
    ...overrides
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

test("usa el libro y las hojas originales de Hoja Inspec", () => {
  const opened = [];
  const context = loadService({ SpreadsheetApp: { openById: (id) => { opened.push(id); return {}; } } });
  context.PP_Inspection_book_();
  assert.deepEqual(opened, ["1X0jtJBgxcD8jIKYVhuw76OTVLP74Lv2yZsbPA_WpG9M"]);
  assert.equal(vm.runInContext("PP_INSPECTION_ROUTES_SHEET", context), "Tramos");
  assert.equal(vm.runInContext("PP_INSPECTION_HISTORY_SHEET", context), "HISTORIAL_IMPRESION_INSPEC");
});

test("normaliza Tramos sin reescribir ni desalinear columnas existentes", () => {
  const rows = [["bf", "Materia prima", "AUX", "Tramo"], ["COMP UADA A", "MP00086", "basura", "102 MM"]];
  const range = (row, column, rowCount, columnCount) => ({
    getValues: () => rows.slice(row - 1, row - 1 + rowCount).map((values) => values.slice(column - 1, column - 1 + columnCount)),
    setValues: (values) => values.forEach((valueRow, offset) => { rows[row - 1 + offset] = valueRow.slice(); }),
    setValue: (value) => { while (rows[0].length < column) rows[0].push(""); rows[row - 1][column - 1] = value; }
  });
  const sheet = {
    getLastRow: () => rows.length,
    getLastColumn: () => rows[0].length,
    getRange: range,
    deleteColumn: (column) => rows.forEach((row) => row.splice(column - 1, 1)),
    setFrozenRows: () => {}
  };
  const context = loadService();
  context.PP_Inspection_normalizeSheet_(sheet, ["Articulo", "Materia prima", "Tramo", "DIBUJO", "Ultima modificacion"], true);

  assert.deepEqual(rows[0], ["Articulo", "Materia prima", "Tramo", "DIBUJO", "Ultima modificacion"]);
  assert.deepEqual(rows[1].slice(0, 3), ["COMP UADA A", "MP00086", "102 MM"]);
});

test("guarda tramo y dibujo por nombre de columna aunque el orden sea distinto", () => {
  const rows = [["Tramo", "Articulo", "DIBUJO", "Materia prima", "Ultima modificacion"], ["Anterior", "COMP UADA A", "viejo.pdf", "MP00086", "ayer"]];
  const sheet = {
    getDataRange: () => ({ getValues: () => rows.map((row) => row.slice()) }),
    getRange: (row, column, rowCount, columnCount) => ({
      setValue: (value) => { rows[row - 1][column - 1] = value; },
      setValues: (values) => values.forEach((valueRow, offset) => { rows[row - 1 + offset].splice(column - 1, columnCount, ...valueRow); })
    }),
    appendRow: (row) => rows.push(row),
    getLastRow: () => rows.length
  };
  const context = loadService();
  context.PP_Inspection_sheet_ = () => sheet;
  const result = context.saveInspectionLink({ article: "COMP UADA A", material: "MP00086", route: "102 MM", drawing: "nuevo.pdf" });

  assert.equal(result.ok, true);
  assert.deepEqual(rows[1].slice(0, 4), ["102 MM", "COMP UADA A", "nuevo.pdf", "MP00086"]);
});

test("lista todo el catalogo de tramos sin filtro y conserva dibujo", () => {
  const context = loadService();
  let routeIndexCalls = 0;
  const routes = {
    "A-100|MP-1": { ARTICULO: "A-100", MATERIAL: "MP-1", TRAMO: "650 mm", DIBUJO: "a100.pdf" },
    "B-200|MP-2": { ARTICULO: "B-200", MATERIAL: "MP-2", TRAMO: "420 mm", DIBUJO: "b200.pdf" }
  };
  context.PP_Inspection_routeIndex_ = () => { routeIndexCalls += 1; return routes; };

  const result = context.getInspectionDrawingRoutes("");

  assert.equal(result.ok, true);
  assert.equal(routeIndexCalls, 1);
  assert.deepEqual(structuredClone(result.data), [
    { ARTICULO: "A-100", MATERIAL: "MP-1", TRAMO: "650 mm", DIBUJO: "a100.pdf" },
    { ARTICULO: "B-200", MATERIAL: "MP-2", TRAMO: "420 mm", DIBUJO: "b200.pdf" }
  ]);
});

test("adapta OT 2001 con cantidad pendiente, tramo, dibujo y fecha larga", () => {
  const context = loadService();
  context.PP_Inspection_restlet_ = () => ({
    trabajo: { Articulo: "COMP UADA A", cantidad: 10, fechaEntrega: "2026-06-05", estatus: "En curso" },
    materiales: [
      { componente: "MP00086", requerido: 0.085, pendiente: 0.085, emitido: 0 },
      { componente: "MP00135", requerido: 10, pendiente: 1, usadoEnsamblaje: 9 }
    ],
    operaciones: [{ Operacion: "10C: CORTE DE DIMENSION", secuencia: 1, centro: "10C: CORTE DE DIMENSION" }]
  });
  context.PP_Inspection_routeIndex_ = () => ({
    "COMP UADA A|MP00086": { TRAMO: "102 MM (PARA 2 PIEZAS)", DIBUJO: "" },
    "COMP UADA A|": { TRAMO: "", DIBUJO: "\\\\srv\\dibujos\\COMP UADA A.pdf" }
  });
  const result = context.getInspectionWorkOrder("2001");
  assert.equal(result.ok, true);
  assert.equal(result.data.materials[0].route, "102 MM (PARA 2 PIEZAS)");
  assert.equal(result.data.materials[1].required, 1);
  assert.equal(result.data.materials[1].requiredOriginal, 10);
  assert.equal(result.data.materials[1].issued, 9);
  assert.equal(result.data.workOrder.drawing, "\\\\srv\\dibujos\\COMP UADA A.pdf");
  assert.equal(result.data.workOrder.dueDate, "viernes, 5 de junio de 2026");
  assert.equal(result.data.operations[0].code, "10C");
});

test("lee historial con el contrato original y conserva conteo y folio", () => {
  const rows = [
    { FECHA_HORA: "15/07/2026 15:56:20", WO: "2001", SEMAFORO: "Revisar" },
    { FECHA_HORA: "15/07/2026 16:00:00", WO: "9999", SEMAFORO: "OK" }
  ];
  const context = loadService({ PP_readRows_: () => rows });
  context.PP_Inspection_historySheet_ = () => ({});
  const result = context.getInspectionHistory("2001");
  assert.equal(result.ok, true);
  assert.equal(result.data.count, 1);
  assert.equal(result.data.conteo, 1);
  assert.equal(result.data.history[0].number, 1);
  assert.equal(result.data.historial[0].numero, 1);
  assert.equal(result.data.historial[0].fechaHora, "15/07/2026 15:56:20");
  assert.equal(result.data.history[0].printedAt, "15/07/2026 15:56:20");
  assert.equal(result.data.history[0].folio, "2001");
});

test("registra historial con todos los campos del contrato original", () => {
  let appended;
  const context = loadService();
  context.PP_Inspection_historySheet_ = () => ({ appendRow: (row) => { appended = row; } });
  const result = context.recordInspectionPrint({
    wo: "2001", article: "COMP UADA A", quantity: 10, status: "En curso", semaphore: "Revisar",
    alerts: ["Déficit material"], withoutDrawing: false, missingRoutes: true,
    pendingMaterials: [{ material: "MP00135", quantity: 1 }],
    deficitMaterials: [{ material: "MP00132", deficit: 52 }],
    detail: { materials: [{ material: "MP00135", pending: 1 }] }, operations: ["10C"]
  });

  assert.equal(result.ok, true);
  assert.equal(appended[0], "15/07/2026 17:04:03");
  assert.deepEqual(structuredClone(appended.slice(1, 11)), ["2001", "COMP UADA A", 10, "En curso", "Revisar", "Déficit material", "MP00135:1", "MP00132:52", "NO", "SI"]);
  assert.deepEqual(JSON.parse(appended[11]), { materials: [{ material: "MP00135", pending: 1 }], operations: ["10C"] });
});
