// Filtro EN VIVO del reporte "Liberacion real" (pedido del usuario 2026-10-30): al escribir en
// la barra de busqueda se filtran las filas por OT o articulo, sin pulsar ningun boton.
// Este test fija `filterReleaseRealRows`: busca por palabras sueltas, sin distinguir mayusculas,
// acentos ni espacios internos, y un filtro vacio deja todo.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");

function cargarFilter() {
  const start = app.indexOf("function releaseRealSearchKey(");
  const end = app.indexOf("function releaseRealRows(", start);
  assert.ok(start >= 0 && end > start, "el bloque del filtro de liberacion real debe existir");
  return Function(`${app.slice(start, end)}; return filterReleaseRealRows;`)();
}

const rows = [
  { ot: "4111", article: "CM 400 E" },
  { ot: "4083", article: "C 590 UADE R8" },
  { ot: "3786", article: "AM M66-6542-0320" },
  { ot: "2846", article: "AM M66-6541-0335" },
];

test("sin texto devuelve todas las filas", () => {
  const filterReleaseRealRows = cargarFilter();
  assert.equal(filterReleaseRealRows(rows, "").length, 4);
  assert.equal(filterReleaseRealRows(rows, "   ").length, 4);
});

test("busca por OT, con o sin ceros y sin pulsar nada", () => {
  const filterReleaseRealRows = cargarFilter();
  assert.deepEqual(filterReleaseRealRows(rows, "4111").map((r) => r.ot), ["4111"]);
  assert.deepEqual(filterReleaseRealRows(rows, " 4083 ").map((r) => r.ot), ["4083"]);
});

test("busca por articulo sin distinguir mayusculas, acentos ni espacios internos", () => {
  const filterReleaseRealRows = cargarFilter();
  assert.deepEqual(filterReleaseRealRows(rows, "c590uade").map((r) => r.ot), ["4083"]);
  assert.deepEqual(filterReleaseRealRows(rows, "C  590 UADE").map((r) => r.ot), ["4083"]);
  assert.deepEqual(filterReleaseRealRows(rows, "cm400e").map((r) => r.ot), ["4111"]);
});

test("varias palabras: tienen que estar TODAS en la OT o el articulo", () => {
  const filterReleaseRealRows = cargarFilter();
  assert.deepEqual(filterReleaseRealRows(rows, "am m66-6542").map((r) => r.ot), ["3786"]);
  assert.equal(filterReleaseRealRows(rows, "am 4111").length, 0, "dos palabras de filas distintas no mezclan");
});

test("un texto que no existe deja la lista vacia, y no toca el original", () => {
  const filterReleaseRealRows = cargarFilter();
  const copia = rows.slice();
  assert.equal(filterReleaseRealRows(rows, "zzz").length, 0);
  assert.equal(rows.length, 4, "el arreglo original no se modifica");
  assert.deepEqual(rows, copia);
});
