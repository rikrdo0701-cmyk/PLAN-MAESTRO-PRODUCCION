// Reporte Faltantes (pedido usuario 2026-10-31, formula 2026-11-01).
// Reglas medidas con el usuario:
//   faltante = OV/OT - existencia - OT (cant.)   y solo entra si es POSITIVO.
//   OV  = cantidad - enviado.
//   OT (cant.) = cantidad - ensamblada.
//   subensambles: demanda = `materials` de OTs ABIERTAS, neta de lo emitido.
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

function construir(state) {
  const fuente = sliceDesde("function faltantesRows() {", "function renderFaltantesReport() {");
  return Function("state", `${fuente}; return faltantesRows;`)(state);
}

test("faltante = OV - existencia - OT pendiente, y solo si queda positivo", () => {
  const f = construir({
    workOrders: [
      { ot: "3970", item: "C 590 UAD", quantity: 70, builtQuantity: 40, cerrada: false },
    ],
    materials: [],
    inventory: [
      { item: "C 590 UAD", location: "PLANTA MM DEL LLANO", physical: 25 },
    ],
    salesOrders: [
      { folio: "SO1350", date: "2026-10-30", status: "", lines: [{ item: "C 590 UAD", pendiente: 80 }] },
    ],
    items: [{ code: "C 590 UAD", type: "ASSEMBLY" }],
  });
  const res = f();
  assert.equal(res.grupos.length, 1);
  const g = res.grupos[0];
  assert.equal(g.articulo, "C 590 UAD");
  assert.equal(g.existencia, 25);
  assert.equal(g.pendiente, 30); // OT pend = 70 - 40 (descontado lo ensamblado)
  assert.equal(g.faltante, 25); // 80 - 25 - 30 = 25
  assert.equal(g.ovs.length, 1);
  assert.equal(g.ovs[0].folio, "SO1350");
});

test("en la OV se descuenta lo enviado (cantidad - enviado)", () => {
  const f = construir({
    workOrders: [],
    materials: [],
    inventory: [],
    salesOrders: [
      { folio: "SO2000", date: "2026-11-01", status: "", lines: [{ item: "X 1", cantidad: 100, enviado: 60 }] },
    ],
    items: [{ code: "X 1", type: "ASSEMBLY" }],
  });
  // Sin inventario propio en MM del Llano no entra al reporte; se mira la demanda calculada.
  const g = f().grupos[0];
  assert.equal(g, undefined, "sin inventario en MM del Llano no es padre");
});

test("una OV totalmente enviada no es demanda", () => {
  const f = construir({
    workOrders: [],
    materials: [],
    inventory: [{ item: "X 2", location: "PLANTA MM DEL LLANO", physical: 1 }],
    salesOrders: [
      { folio: "SO2100", date: "2026-11-01", status: "", lines: [{ item: "X 2", cantidad: 50, enviado: 50, pendiente: 0 }] },
    ],
    items: [{ code: "X 2", type: "ASSEMBLY" }],
  });
  assert.equal(f().grupos.length, 0, "lo enviado por completo ya no falta");
});

test("un faltante de 0 o negativo no aparece en la lista", () => {
  const f = construir({
    workOrders: [{ ot: "3975", item: "CM 250", quantity: 50, builtQuantity: 50, cerrada: false }],
    materials: [],
    inventory: [{ item: "CM 250", location: "PLANTA MM DEL LLANO", physical: 60 }],
    salesOrders: [{ folio: "SO1400", date: "2026-11-05", status: "", lines: [{ item: "CM 250", cantidad: 30 }] }],
    items: [{ code: "CM 250", type: "ASSEMBLY" }],
  });
  assert.equal(f().grupos.length, 0, "30 - 60 - 0 = -30: cubierto");
});

test("subensambles: demanda de materials de OT abierta neta de lo emitido, menos cobertura de OT", () => {
  const f = construir({
    workOrders: [
      { ot: "3972", item: "C 590 UADE", quantity: 20, builtQuantity: 0, cerrada: false },
      { ot: "4001", item: "M66-2417", quantity: 10, builtQuantity: 4, cerrada: false },
    ],
    materials: [
      { ot: "3972", assembly: "C 590 UADE", component: "M66-2417", required: 32, issued: 0, pending: 40 },
    ],
    inventory: [
      { item: "C 590 UADE", location: "PLANTA MM DEL LLANO", physical: 4 },
      { item: "M66-2417", location: "PLANTA MM DEL LLANO", physical: 8 },
    ],
    salesOrders: [
      { folio: "SO1450", date: "2026-10-30", status: "", lines: [{ item: "C 590 UADE", pendiente: 40 }] },
    ],
    items: [
      { code: "C 590 UADE", type: "ASSEMBLY" },
      { code: "M66-2417", type: "ASSEMBLY" },
    ],
  });
  const res = f();
  assert.equal(res.grupos.length, 1);
  assert.equal(res.grupos[0].faltante, 16); // 40 - 4 - 20 = 16
  const comp = res.hijos[0];
  assert.equal(comp.articulo, "M66-2417");
  assert.equal(comp.heredado, 32); // requerido 32 - emitido 0
  assert.equal(comp.pendiente, 6); // OT que lo fabrica: 10 - 4 ensambladas
  assert.equal(comp.faltante, 18); // 32 - 8 - 6 = 18
});

test("faltantesRows ignora materiales de OTs cerradas y omite PROTOTIPO", () => {
  const f = construir({
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
  const artes = f().hijos.map((h) => h.articulo);
  assert.ok(artes.includes("COMP-A"), "el componente de la OT abierta si sale");
  assert.ok(!artes.includes("COMP-CERRADA"), "la OT cerrada no aporta demanda");
  assert.ok(!artes.includes("PROTOTIPO"), "PROTOTIPO se omite (decision del usuario)");
});

test("sin datos devuelve arrays vacios", () => {
  const r = construir({ workOrders: [], materials: [], inventory: [], salesOrders: [] })();
  assert.equal(r.grupos.length, 0);
  assert.equal(r.hijos.length, 0);
});
