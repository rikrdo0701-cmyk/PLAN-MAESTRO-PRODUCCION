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
      { ot: "3970", item: "C 590 UAD", quantity: 70, builtQuantity: 0, cerrada: false },
    ],
    materials: [],
    inventory: [
      { item: "C 590 UAD", location: "PLANTA MM DEL LLANO", available: 25 },
    ],
    salesOrders: [
      {
        folio: "SO1350", date: "2026-10-30", status: "", lines: [{ item: "C 590 UAD", cantidad: 40 }],
      },
    ],
  });
  const res = faltantesRows();
  assert.equal(res.grupos.length, 1);
  const g = res.grupos[0];
  assert.equal(g.articulo, "C 590 UAD");
  assert.equal(g.existencia, 25);
  assert.equal(g.pendiente, 70);
  assert.equal(g.faltante, 45); // max(40, 70) - 25 = 45
  assert.equal(g.ovs.length, 1);
  assert.equal(g.ovs[0].folio, "SO1350");
});

test("faltantesRows excluye artículos con faltante <= 0", () => {
  const fuente = sliceDesde("function faltantesRows() {", "function renderFaltantesReport() {");
  const faltantesRows = Function("state", `${fuente}; return faltantesRows;`)({
    workOrders: [{ ot: "3975", item: "CM 250", quantity: 50, builtQuantity: 0, cerrada: false }],
    materials: [],
    inventory: [{ item: "CM 250", location: "PLANTA MM DEL LLANO", available: 60 }],
    salesOrders: [{ folio: "SO1400", date: "2026-11-05", status: "", lines: [{ item: "CM 250", cantidad: 30 }] }],
  });
  assert.equal(faltantesRows().grupos.length, 0, "la existencia (60) >= max(30,50) no da falta");
});

test("faltantesRows agrega componentes como filas planas con herencia", () => {
  const fuente = sliceDesde("function faltantesRows() {", "function renderFaltantesReport() {");
  const faltantesRows = Function("state", `${fuente}; return faltantesRows;`)({
    workOrders: [
      { ot: "3972", item: "C 590 UADE", quantity: 20, builtQuantity: 0, cerrada: false },
    ],
    materials: [
      { assembly: "C 590 UADE", component: "M66-2417", required: 2 },
    ],
    inventory: [
      { item: "C 590 UADE", location: "PLANTA MM DEL LLANO", available: 4 },
      { item: "M66-2417", location: "PLANTA MM DEL LLANO", available: 8 },
    ],
    salesOrders: [
      { folio: "SO1450", date: "2026-10-30", status: "", lines: [{ item: "C 590 UADE", cantidad: 20 }] },
    ],
  });
  const res = faltantesRows();
  assert.equal(res.grupos.length, 1);
  const g = res.grupos[0];
  assert.equal(g.articulo, "C 590 UADE");
  assert.equal(g.faltante, 16); // max(20, 20) - 4 = 16
  // debe haber un componente M66-2417 en hijos
  assert.ok(res.hijos.length >= 1, "hay al menos un subensamble");
  const comp = res.hijos[0];
  assert.equal(comp.articulo, "M66-2417");
  assert.equal(comp.padre, "C 590 UADE");
  assert.equal(comp.heredado, 32); // 16 * 2
  assert.equal(comp.faltante, 24); // (0+32) - 8 = 24
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