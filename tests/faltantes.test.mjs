// Reporte Faltantes (pedido usuario 2026-10-31).
// Prueba el calculo, la exclusion de faltante <= 0, la agrupacion por OV y la recursión
// de subensambles con herencia oculta.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8").then((s) => s.replace(/\r\n/g, "\n"));

function sliceDesde(inicio, fin) {
  const start = app.indexOf(inicio);
  const end = app.indexOf(fin, start);
  assert.ok(start >= 0 && end > start, `Falta ${inicio}`);
  return app.slice(start, end);
}

test("faltantesRows calcula faltante = max(OV, pend OTs) - existencia", () => {
  const fuente = sliceDesde("function faltantesRows() {", "function renderFaltantesReport() {");
  const faltantesRows = Function(
    "state",
    `${fuente}; return faltantesRows;`,
  )({
    workOrders: [
      { ot: "3970", item: "C 590 UAD", quantity: 70, builtQuantity: 40, cerrada: false },
    ],
    materials: [],
    inventory: [
      { item: "C 590 UAD", location: "PLANTA MM DEL LLANO", physical: 25 },
    ],
    salesOrders: [
      {
        folio: "SO1350", date: "2026-10-30", status: "", lines: [{ item: "C 590 UAD", cantidad: 80 }],
      },
    ],
    items: [
      { code: "C 590 UAD", type: "ASSEMBLY" },
    ],
  });
  const res = faltantesRows();
  assert.equal(res.grupos.length, 1);
  const g = res.grupos[0];
  assert.equal(g.articulo, "C 590 UAD");
  assert.equal(g.existencia, 25);
  assert.equal(g.pendiente, 30); // OT pend = 70-40
  assert.equal(g.faltante, 25); // max(0, OV 80 - inv 25 - OT pend 30) = 25
  assert.equal(g.ovs.length, 1);
  assert.equal(g.ovs[0].folio, "SO1350");
});

test("faltantesRows excluye artículos con faltante <= 0", () => {
  const fuente = sliceDesde("function faltantesRows() {", "function renderFaltantesReport() {");
  const faltantesRows = Function("state", `${fuente}; return faltantesRows;`)({
    workOrders: [{ ot: "3975", item: "CM 250", quantity: 50, builtQuantity: 0, cerrada: false }],
    materials: [],
    inventory: [{ item: "CM 250", location: "PLANTA MM DEL LLANO", physical: 60 }],
    salesOrders: [{ folio: "SO1400", date: "2026-11-05", status: "", lines: [{ item: "CM 250", cantidad: 30 }] }],
    items: [
      { code: "CM 250", type: "ASSEMBLY" },
    ],
  });
  assert.equal(faltantesRows().grupos.length, 0, "la existencia (60) >= max(30,50) no da falta");
});

test("faltantesRows toma subensambles de las OTs ABIERTAS (pendiente - existencia)", () => {
  const fuente = sliceDesde("function faltantesRows() {", "function renderFaltantesReport() {");
  const faltantesRows = Function("state", `${fuente}; return faltantesRows;`)({
    workOrders: [
      { ot: "3972", item: "C 590 UADE", quantity: 20, builtQuantity: 0, cerrada: false },
    ],
    // materials NO es el BOM del articulo: es la lista de materiales de CADA OT.
    // MEDIDO 2026-11-01: los padres del reporte no tienen BOM, asi que la herencia por padre
    // daba siempre 0. La demanda del componente viene de lo que la OT todavia debe consumir.
    materials: [
      { ot: "3972", assembly: "C 590 UADE", component: "M66-2417", required: 32, issued: 0, pending: 40 },
    ],
    inventory: [
      { item: "C 590 UADE", location: "PLANTA MM DEL LLANO", physical: 4 },
      { item: "M66-2417", location: "PLANTA MM DEL LLANO", physical: 8 },
    ],
    salesOrders: [
      { folio: "SO1450", date: "2026-10-30", status: "", lines: [{ item: "C 590 UADE", cantidad: 40 }] },
    ],
    items: [
      { code: "C 590 UADE", type: "ASSEMBLY" },
      { code: "M66-2417", type: "ASSEMBLY" },
    ],
  });
  const res = faltantesRows();
  assert.equal(res.grupos.length, 1);
  const g = res.grupos[0];
  assert.equal(g.articulo, "C 590 UADE");
  assert.equal(g.faltante, 16); // max(0, OV 40 - inv 4 - OT pend 20) = 16
  assert.ok(res.hijos.length >= 1, "hay al menos un subensamble");
  const comp = res.hijos[0];
  assert.equal(comp.articulo, "M66-2417");
  assert.equal(comp.heredado, 32); // requerido 32 - emitido 0 (NO `pendiente` 40)
  assert.equal(comp.faltante, 24); // 32 - 8 = 24
});

test("faltantesRows usa requerido - emitido y NO pendiente (COMP-4017 en OT 4056)", () => {
  const fuente = sliceDesde("function faltantesRows() {", "function renderFaltantesReport() {");
  const faltantesRows = Function("state", `${fuente}; return faltantesRows;`)({
    workOrders: [{ ot: "4056", item: "AM M66-4017", quantity: 15, builtQuantity: 0, cerrada: false }],
    // MEDIDO 2026-11-01: `materials.pendiente` venia en 20 para una fila de 15 y el reporte
    // pintaba "OT 4056 (15)" con "Pend. 20". La cantidad de la fila es requerido - emitido.
    materials: [{ ot: "4056", component: "COMP-4017", required: 15, issued: 0, pending: 20 }],
    inventory: [],
    salesOrders: [],
    items: [{ code: "AM M66-4017", type: "ASSEMBLY" }],
  });
  const res = faltantesRows();
  assert.equal(res.hijos.length, 1);
  assert.equal(res.hijos[0].articulo, "COMP-4017");
  assert.equal(res.hijos[0].heredado, 15, "la demanda es requerido - emitido, no pendiente");
  assert.equal(res.hijos[0].faltante, 15);
});

test("faltantesRows ignora materiales de OTs cerradas y omite PROTOTIPO", () => {
  const fuente = sliceDesde("function faltantesRows() {", "function renderFaltantesReport() {");
  const faltantesRows = Function("state", `${fuente}; return faltantesRows;`)({
    workOrders: [
      { ot: "4100", item: "X 100", quantity: 10, builtQuantity: 0, cerrada: false },
      { ot: "4101", item: "X 200", quantity: 5, builtQuantity: 5, cerrada: true },
    ],
    materials: [
      { ot: "4100", component: "COMP-A", required: 5, issued: 0, pending: 5 },
      { ot: "4101", component: "COMP-CERRADA", required: 9, issued: 0, pending: 9 },
      { ot: "4100", component: "PROTOTIPO", required: 1000, issued: 0, pending: 1000 },
    ],
    inventory: [],
    salesOrders: [],
    items: [{ code: "X 100", type: "ASSEMBLY" }],
  });
  const res = faltantesRows();
  const arts = res.hijos.map((h) => h.articulo);
  assert.ok(arts.includes("COMP-A"), "el componente de la OT abierta si sale");
  assert.ok(!arts.includes("COMP-CERRADA"), "la OT cerrada no aporta demanda");
  assert.ok(!arts.includes("PROTOTIPO"), "PROTOTIPO se omite (decision del usuario)");
});

test("faltantesRows sin datos devuelve arrays vacios", () => {
  const fuente = sliceDesde("function faltantesRows() {", "function renderFaltantesReport() {");
  const f = Function("state", `${fuente}; return faltantesRows;`)({
    workOrders: [], materials: [], inventory: [], salesOrders: [],
  });
  var r = f();
  assert.ok(r.grupos.length === 0, "sin datos no hay grupos");
  assert.ok(r.hijos.length === 0, "sin datos no hay subensambles");
});