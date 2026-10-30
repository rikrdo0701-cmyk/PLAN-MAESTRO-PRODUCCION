// El reporte "Liberacion real" debe omitir los eventos de ensamble con 0 piezas
// (decision del usuario 2026-10-30). Este test fija el filtro en `releaseRealRows`
// (app.js) y que la numeracion cronologica "1.º/2.º de N" se recalcula sobre los que
// entran, no sobre el total bruto.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";

const app = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8").then((s) => s.replace(/\r\n/g, "\n"));

function lanzarReleaseRealRows(handlers = {}) {
  const desde = app.indexOf("function releaseRealUnitPrice(");
  const hasta = app.indexOf("function loadReleaseRealEvents(", desde);
  assert.ok(desde >= 0 && hasta > desde, "el bloque releaseRealRows debe existir en app.js");
  const body = app.slice(desde, hasta);
  const extra = handlers.extra || "";
  const ctx = {
    console,
    Math, Date, String, Number, Boolean, Array, Object, JSON, isNaN, parseInt, parseFloat,
    effectiveUnitPriceForOt: handlers.effectiveUnitPriceForOt || (() => 0),
    articleKeyForPart: handlers.articleKeyForPart || ((part) => String(part || "").trim().toUpperCase()),
    articleConfigurationValue: handlers.articleConfigurationValue || (() => ({})),
    materialOtKey: handlers.materialOtKey || ((v) => String(v || "").trim().toUpperCase()),
    articleForOt: handlers.articleForOt || (() => ""),
  };
  ctx.globalThis = ctx;
  createContext(ctx);
  runInContext(body + "\n" + extra + "\nglobalThis.__r = releaseRealRows;", ctx, { filename: "app.js:releaseReal" });
  return ctx.__r;
}

test("releaseRealRows omite los eventos con 0 piezas y conserva los demas", () => {
  const releaseRealRows = lanzarReleaseRealRows();
  const filas = releaseRealRows([
    { buildId: "A", date: "2026-10-26", ot: "4083", article: "C 590 UADE R8", quantity: 10 },
    { buildId: "B", date: "2026-10-26", ot: "4083", article: "C 590 UADE R8", quantity: 0 },
    { buildId: "C", date: "2026-10-24", ot: "4083", article: "C 590 UADE R8", quantity: 0 },
    { buildId: "D", date: "2026-10-22", ot: "4083", article: "C 590 UADE R8", quantity: 5 },
    { buildId: "E", date: "2026-10-20", ot: "4100", article: "OTRA", quantity: 0 },
    { buildId: "F", date: "2026-10-20", ot: "4100", article: "OTRA", quantity: 8 },
  ]);
  assert.equal(filas.length, 3, "solo entran los de cantidad > 0");
  const porOt4083 = filas.filter((f) => f.ot === "4083");
  assert.equal(porOt4083.length, 2, "la OT 4083 queda con sus eventos de > 0");
  // La numeracion se recalcula sobre los que quedan: los de 0 no participan del conteo.
  assert.deepEqual(porOt4083.map((f) => f.quantity).sort((a, b) => a - b), [5, 10]);
  const eventoViejo = porOt4083.find((f) => f.quantity === 5);
  assert.equal(eventoViejo.eventIndex, 1, "el de 5 pzs (mas viejo) es 1.º");
  assert.equal(eventoViejo.eventCount, 2, "y cuenta solo los 2 eventos visibles, no el de 0");
});

test("releaseRealRows conserva el orden de lo mas nuevo a lo mas viejo tras el filtro", () => {
  const releaseRealRows = lanzarReleaseRealRows();
  const filas = releaseRealRows([
    { buildId: "1", date: "2026-10-27", ot: "A", article: "P1", quantity: 2 },
    { buildId: "2", date: "2026-10-29", ot: "A", article: "P1", quantity: 0 },
    { buildId: "3", date: "2026-10-25", ot: "A", article: "P1", quantity: 3 },
  ]);
  assert.deepEqual(filas.map((f) => [f.quantity, f.eventIndex, f.eventCount]), [[2, 2, 2], [3, 1, 2]]);
  const fechas = filas.map((f) => f.date.getTime());
  assert.ok(fechas[0] >= fechas[1], "la primera fila es la mas nueva");
});