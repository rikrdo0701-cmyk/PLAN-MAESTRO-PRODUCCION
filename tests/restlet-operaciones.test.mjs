import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../netsuite-restlet-operaciones.js", import.meta.url), "utf8");

/**
 * Harness del restlet 2240 (operaciones). El restlet es un modulo AMD: se captura la
 * factoria que recibe N/query y se le inyecta un query.runSuiteQL falso que devuelve filas
 * segun la pagina pedida, de modo que se pueda comprobar que la paginacion se resuelve en
 * la consulta y no recortando en memoria, y que el filtro de ubicacion baja al SQL.
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
  const exported = factory(query);
  assert.equal(typeof exported.post, "function", "el restlet no exporta post()");
  return { post: exported.post, calls };
}

function makeRows(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    workorder_id: `wo-${index + 1}`,
    workorder_tranid: String(3000 + index),
    item_id: "5109",
    item_name: `ART-${index + 1}`,
    operation: "Corte",
    sequence: String((index % 5) + 1),
    qty_to_process: "10",
    start_planned: "03/04/2026",
    end_planned: "03/04/2026",
    status_op: "NOTSTART",
    workcenter: "6679",
    setup_min: "0",
    est_min: "30",
    real_min: "0",
    remaining_min: "30",
    production_rate: "0",
    human_resource: "1",
    machine_resource: "1",
    qty_completed: "",
    location: "1",
  }));
}

// El clamp del 2240 es 50..5000, asi que una pagina de 2 filas se sube a 50: los tests usan
// 50 o mas para no medir el clamp, y el clamp se prueba aparte.
const PAGE = 50;

test("la pagina se resuelve en la consulta, no trayendo el catalogo completo", () => {
  const { post, calls } = loadRestlet({ rows: makeRows(120) });

  post({ pageIndex: 1, pageSize: PAGE, locationId: 1 });

  assert.equal(calls.length, 1, "una pagina debe costar una sola consulta");
  const sql = calls[0].sql;
  assert.match(sql, new RegExp(`FETCH NEXT ${PAGE + 1} ROWS ONLY`), "pide pageSize + 1 filas para deducir hasMore");
  assert.match(sql, new RegExp(`OFFSET ${PAGE} ROWS`), "el OFFSET sale de pageIndex * pageSize");
  assert.doesNotMatch(sql, /SELECT DISTINCT/, "");
});

test("no hay slice en memoria ni totalRows", () => {
  const { post, calls } = loadRestlet({ rows: makeRows(120) });

  const result = post({ pageIndex: 0, pageSize: PAGE, locationId: 1 });

  assert.doesNotMatch(calls[0].sql, /totalRows/);
  // El recorte en memoria era `const all = runSuiteQL_(sql)` + `all.slice(from, to)` sobre el
  // catalogo completo. La cabecera del archivo lo describe historicamente, asi que la
  // asercion mira el codigo ejecutable y no el comentario.
  const codigo = source.slice(source.indexOf("define(['N/query']"));
  assert.doesNotMatch(codigo, /const all = runSuiteQL_/, "ya no se trae el catalogo completo para recortar");
  assert.match(calls[0].sql, /FETCH NEXT \d+ ROWS ONLY/, "la pagina se resuelve en la consulta");
  assert.equal("totalRows" in result, false, "totalRows implicaba recorrer el mismo JOIN para contar");
});

test("hasMore se deduce de la fila extra y la ultima pagina se cierra", () => {
  const conMas = loadRestlet({ rows: makeRows(120) });
  const primera = conMas.post({ pageIndex: 0, pageSize: PAGE, locationId: 1 });
  assert.equal(primera.hasMore, true, "pedimos 51 filas y hay 120: hay mas");
  assert.equal(primera.rows.length, PAGE, "y la fila extra no se cuela en la respuesta");

  const ultima = loadRestlet({ rows: makeRows(PAGE) });
  const sola = ultima.post({ pageIndex: 0, pageSize: PAGE, locationId: 1 });
  assert.equal(sola.hasMore, false, "la ultima pagina no inventa que hay mas");
  assert.equal(sola.rows.length, PAGE);
});

test("recorrer las paginas entrega el catalogo completo sin repetir ni perder", () => {
  const { post } = loadRestlet({ rows: makeRows(120) });

  const ids = [];
  for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
    const page = post({ pageIndex, pageSize: PAGE, locationId: 1 });
    page.rows.forEach((row) => ids.push(row.id));
    if (!page.hasMore) break;
  }

  assert.equal(ids.length, 120, "cada fila aparece una vez");
  assert.deepEqual(ids.slice(0, 3), ["1", "2", "3"], "y en orden");
  assert.equal(ids[119], "120", "sin perder la ultima");
  assert.equal(new Set(ids).size, 120, "sin repetir ninguna");
});

test("el filtro de ubicacion baja al SQL y se envia como parametro ligado", () => {
  const { post, calls } = loadRestlet({ rows: makeRows(3) });

  post({ pageIndex: 0, pageSize: 100, locationId: 1 });

  const sql = calls[0].sql;
  assert.match(sql, /tl\.location = \?/, "la ubicacion se filtra en la consulta, no despues en memoria");
  assert.deepEqual(calls[0].params, [1], "y el valor viaja como parametro, no interpolado");
});

test("la columna location sale en la fila y en los headers", () => {
  const { post } = loadRestlet({ rows: makeRows(2) });

  const result = post({ pageIndex: 0, pageSize: 100, locationId: 1 });

  assert.equal(result.rows[0].location, "1", "la operacion dice de que ubicacion viene");
  assert.ok(result.headers.includes("Ubicacion"), "y el encabezado la anuncia");
  assert.match(result.debug.locationFilter, /tl\.location = 1/);
});

test("sin locationId en el body no se filtra, para no dejar fuera toda la lista", () => {
  const { post, calls } = loadRestlet({ rows: makeRows(2) });

  const result = post({ pageIndex: 0, pageSize: 100 });

  assert.doesNotMatch(calls[0].sql, /tl\.location = \?/, "sin ubicacion no se inventa el filtro");
  assert.deepEqual(calls[0].params, []);
  assert.equal(result.rows.length, 2);
  assert.match(result.debug.locationFilter, /sin filtro/);
});

test("el filtro de abiertas y el orden estable siguen igual", () => {
  const { post, calls } = loadRestlet({ rows: makeRows(1) });

  post({ pageIndex: 0, pageSize: 100, locationId: 1 });

  const sql = calls[0].sql;
  assert.match(sql, /NOT LIKE '%CERRAD%'/, "");
  assert.match(sql, /NOT LIKE '%CLOSED%'/, "");
  assert.match(sql, /NOT LIKE '%COMPLET%'/, "");
  // Sin un desempate por id, OFFSET puede repetir o saltar filas entre paginas.
  assert.match(sql, /ORDER BY wo\.id, mot\.operationsequence, mot\.id/);
});

test("el id estable de operacion y el mapeo no cambian", () => {
  const { post } = loadRestlet({ rows: makeRows(1) });

  const row = post({ pageIndex: 0, pageSize: 100, locationId: 1 }).rows[0];

  assert.equal(row.id, "1", "viene de mot.id, no del indice posicional");
  assert.equal(row.workorder_id, "wo-1");
  assert.equal(row.workorder_tranid, "3000");
  assert.equal(row.status_op, "No iniciado", "el estatus se traduce igual que antes");
  assert.equal(row.remaining_min, "30", "y el trabajo pendiente cae al estimado si no viene");
  assert.equal(row.start_actual, "");
});

test("el clamp del pageSize se conserva en 50..5000", () => {
  const chico = loadRestlet({ rows: makeRows(1) });
  chico.post({ pageIndex: 0, pageSize: 1 });
  assert.match(chico.calls[0].sql, /FETCH NEXT 51 ROWS ONLY/, "abajo del minimo sube a 50");

  const grande = loadRestlet({ rows: makeRows(1) });
  grande.post({ pageIndex: 0, pageSize: 99999 });
  assert.match(grande.calls[0].sql, /FETCH NEXT 5001 ROWS ONLY/, "arriba del maximo baja a 5000");
});

test("un fallo de SuiteQL se propaga para que el backend lo registre", () => {
  const { post } = loadRestlet({ failWith: "SuiteQL no soporta FETCH NEXT" });

  assert.throws(() => post({ pageIndex: 0, pageSize: 100, locationId: 1 }), /FETCH NEXT/);
});
