import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../netsuite-restlet-wo-inspeccion.js", import.meta.url), "utf8");

/**
 * Harness del restlet 2244 (WO_INSPECCION). El restlet es un modulo AMD: se captura la
 * factoria que recibe N/query y N/record y se le inyecta un query.runSuiteQL falso que
 * devuelve filas selon la pagina pedida, de modo que se pueda comprobar que la paginacion
 * se resuelve en la consulta y no recortando en memoria.
 */
function loadRestlet({ rows = [], failWith = null } = {}) {
  const calls = [];
  const query = {
    runSuiteQL(payload) {
      calls.push({ sql: String(payload.query || ""), params: payload.params || [] });
      if (failWith) throw new Error(failWith);
      const limit = Number((String(payload.query).match(/FETCH NEXT (\d+) ROWS ONLY/) || [])[1] || 0);
      const offset = Number((String(payload.query).match(/OFFSET (\d+) ROWS/) || [])[1] || 0);
      const size = limit || rows.length;
      const page = rows.slice(offset, offset + size);
      return { asMappedResults: () => page };
    },
  };
  let factory = null;
  const define = (_deps, callback) => { factory = callback; };
  // eslint-disable-next-line no-new-func
  new Function("define", source)(define);
  assert.equal(typeof factory, "function", "el restlet no llamo define()");
  // El modulo AMD exporta { post }.
  const exported = factory(query, {});
  assert.equal(typeof exported.post, "function", "el restlet no exporta post()");
  return { post: exported.post, calls };
}

function makeRows(count) {
  return Array.from({ length: count }, (_, index) => ({
    workorder_id: `id-${index + 1}`,
    wo: String(3000 + index),
    articulo: `ART-${index + 1}`,
    descripcion: `Pieza ${index + 1}`,
    cantidad: String(10 + index),
    fechaEntrega: "2026-09-30",
    estatus: "Open",
    revision: "",
    bomRevision: "",
  }));
}

test("el listado pagina en la consulta, no trayendo el catalogo completo", () => {
  const { post, calls } = loadRestlet({ rows: makeRows(5) });

  const result = post({ table: "WO_INSPECCION", action: "list", pageIndex: 1, pageSize: 2 });

  assert.equal(calls.length, 1, "una pagina debe costar una sola consulta");
  const sql = calls[0].sql;
  assert.match(sql, /FETCH NEXT 3 ROWS ONLY/, "pide pageSize + 1 filas para deducir hasMore");
  assert.match(sql, /OFFSET 2 ROWS/, "el OFFSET sale de pageIndex * pageSize");
  assert.doesNotMatch(sql, /SELECT DISTINCT/, "el DISTINCT sobra: la linea mainline ya es una por OT y costaba un sort extra");
  assert.equal(result.rows.length, 2, "devuelve la pagina, no la fila extra");
  assert.equal(result.hasMore, true);
  assert.equal(result.pageIndex, 1);
  assert.equal(result.pageSize, 2);
});

test("hasMore se deduce de la fila extra y la ultima pagina se cierra", () => {
  const rows = makeRows(5);
  const primera = loadRestlet({ rows });
  const segunda = loadRestlet({ rows });
  const tercera = loadRestlet({ rows });

  const page0 = primera.post({ table: "WO_INSPECCION", action: "list", pageIndex: 0, pageSize: 2 });
  const page1 = segunda.post({ table: "WO_INSPECCION", action: "list", pageIndex: 1, pageSize: 2 });
  const page2 = tercera.post({ table: "WO_INSPECCION", action: "list", pageIndex: 2, pageSize: 2 });

  assert.equal(page0.hasMore, true);
  assert.equal(page1.hasMore, true);
  assert.equal(page2.hasMore, false, "la ultima pagina debe cerrar el recorrido");
  const folios = [...page0.rows, ...page1.rows, ...page2.rows].map((row) => row.wo);
  assert.deepEqual(folios, rows.map((row) => row.wo), "recorrer las paginas entrega el catalogo completo sin repetir ni perder");
});

test("el listado ya no expone totalRows porque implicaba contar sobre el mismo JOIN", () => {
  const { post } = loadRestlet({ rows: makeRows(4) });

  const result = post({ table: "WO_INSPECCION", action: "list", pageIndex: 0, pageSize: 10 });

  assert.equal("totalRows" in result, false);
  assert.equal(result.hasMore, false);
});

test("el filtro de abiertas y de planta se sigue aplicando", () => {
  const { post, calls } = loadRestlet({ rows: makeRows(2) });

  post({ table: "WO_INSPECCION", action: "list", onlyOpen: true, locationId: 1, pageIndex: 0, pageSize: 5 });

  const sql = calls[0].sql;
  assert.match(sql, /NOT LIKE '%CERRAD%'/, "onlyOpen sigue excluyendo CERRAD");
  assert.match(sql, /tl\.location = \?/, "la planta sigue filtrando por lugar");
  assert.deepEqual(calls[0].params, [1]);
});

test("el contrato de validacion del payload no cambia", () => {
  const { post } = loadRestlet({ rows: makeRows(1) });

  assert.deepEqual({ ...post({ table: "OTRAS" }) }, { ok: false, error: "table debe ser WO_INSPECCION" });
  assert.deepEqual({ ...post({ table: "WO_INSPECCION", action: "inventada" }) }, { ok: false, error: "action no soportada: inventada" });
});

test("un fallo de SuiteQL se propaga para que el backend lo registre", () => {
  const { post } = loadRestlet({ failWith: "SuiteQL: campo no existe" });

  assert.throws(() => post({ table: "WO_INSPECCION", action: "list" }), /campo no existe/);
});
