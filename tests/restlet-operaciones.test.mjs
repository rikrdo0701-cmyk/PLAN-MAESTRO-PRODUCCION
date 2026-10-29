import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../netsuite-restlet-operaciones.js", import.meta.url), "utf8");
// Sin comentarios: el archivo los menciona al explicar por que NO se usa algo, y las
// aserciones que buscarian una expresion prohibida darian falso positivo por el texto.
const codigo = source
  .slice(source.indexOf("define(['N/query']"))
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

/**
 * Harness del restlet 2240 (operaciones). El modulo AMD recibe N/query con un runSuiteQL falso
 * que devuelve el catalogo completo y deja que el restlet recorte, como hace el de verdad.
 *
 * `failOn` simula una consulta que el SuiteQL de la cuenta rechaza, que es como se reproducen
 * los fallos reales: no con una excepcion del codigo sino con un 400 "Failed to parse SQL".
 */
function loadRestlet({ rows = [], failWith = null, failOn = null, emptyWhen = null } = {}) {
  const calls = [];
  const query = {
    runSuiteQL(payload) {
      const sql = String(payload.query || "");
      calls.push({ sql, params: payload.params || [] });
      if (failWith) throw new Error(failWith);
      if (failOn && failOn.test(sql)) throw new Error("Failed to parse SQL");
      if (emptyWhen && emptyWhen.test(sql)) return { asMappedResults: () => [] };
      return { asMappedResults: () => rows };
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

// Las 2400 filas que devolvio el 2240 en produccion (sonda DIAG_operaciones2240).
const TOTAL = 2400;
const PAGE = 2500;

test("el SQL ejecutado no usa FETCH NEXT/OFFSET: esta cuenta no lo acepta", () => {
  // Verificado en produccion el 2026-09-26 08:00: 400 "Failed to parse SQL" en el 2240 y en
  // el 2244, cuyo unico cambio nuevo era ese. Se comprueba sobre el SQL que de verdad se manda,
  // no sobre el texto del archivo (que lo menciona al explicar por que no se usa).
  const { post, calls } = loadRestlet({ rows: makeRows(20) });

  post({ pageIndex: 0, pageSize: 200, locationId: 1 });

  assert.ok(calls.length > 0, "se ejecuto al menos una consulta");
  calls.forEach((call) => {
    assert.doesNotMatch(call.sql, /FETCH NEXT/, "ninguna consulta lleva FETCH NEXT");
    assert.doesNotMatch(call.sql, /OFFSET \d+ ROWS/, "ni OFFSET");
  });
});

test("mot.status se pide SIN BUILTIN.DF, como en el SQL que siempre funciono", () => {
  // Este fue EL bug que dejo la app sin operaciones: yo envolví mot.status en BUILTIN.DF y el
  // SuiteQL responde "Cannot build builtin function". El original lo pedia crudo, y
  // translateStatus_ espera justo el valor crudo (NOTSTART), no el nombre en espanol.
  // OJO: BUILTIN.DF(mot.manufacturingworkcenter) AS operation SI estaba en el original y si
  // funciona, porque es una referencia a entidad y no un campo estatico. No se toca.
  const { post, calls } = loadRestlet({ rows: makeRows(20) });

  post({ pageIndex: 0, pageSize: 200, locationId: 1 });

  const sql = calls[0].sql;
  assert.match(sql, /mot\.status\s+AS status_op/, "mot.status crudo");
  assert.doesNotMatch(sql, /BUILTIN\.DF\(mot\.status\)/, "nunca envuelto: es lo que rompia el parseo");
  assert.match(sql, /BUILTIN\.DF\(mot\.manufacturingworkcenter\)\s+AS operation/, "el de operation si va envuelto, como siempre");
  assert.match(sql, /mot\.manufacturingworkcenter\s+AS workcenter/, "y workcenter crudo, como siempre");
  assert.match(sql, /UPPER\(BUILTIN\.DF\(wo\.status\)\)/, "el filtro por estatus si usa BUILTIN.DF y funciona");
});

test("la columna location va dentro del SELECT, no despues del ORDER BY", () => {
  // Un despiste aqui produce 'Failed to parse SQL': la columna tiene que ir en la lista.
  const { post, calls } = loadRestlet({ rows: makeRows(20) });

  post({ pageIndex: 0, pageSize: 200, locationId: 1 });

  const sql = calls[0].sql;
  const select = sql.slice(sql.indexOf("SELECT"), sql.indexOf("FROM"));
  assert.match(select, /tl\.location\s+AS location/, "esta dentro del SELECT");
  const where = sql.slice(sql.indexOf("WHERE"), sql.indexOf("ORDER BY"));
  assert.match(where, /tl\.location = \?/, "y el filtro va en el WHERE, no en el SELECT");
  assert.equal(sql.split("tl.location").length - 1, 2, "aparece una vez en el SELECT y otra en el WHERE");
});

test("con la columna de ubicacion todo funciona y se recorta en memoria", () => {
  const { post, calls } = loadRestlet({ rows: makeRows(TOTAL) });

  const result = post({ pageIndex: 0, pageSize: PAGE, locationId: 1 });

  assert.equal(result.ok, true);
  assert.equal(result.rows.length, TOTAL, "con pageSize 2500 entran las 2400 filas en una llamada");
  assert.equal(result.hasMore, false);
  assert.equal(calls.length, 2, "una con filtro de ubicacion y otra sin el, para comparar el total");
  assert.equal(result.debug.estrategia, "con-ubicacion");
  assert.deepEqual(result.debug.degradaciones, []);
});

test("el clamp del pageSize se conserva en 50..5000", () => {
  const chico = loadRestlet({ rows: makeRows(10) });
  const r1 = chico.post({ pageIndex: 0, pageSize: 1 });
  assert.equal(r1.pageSize, 50, "abajo del minimo sube a 50");

  const grande = loadRestlet({ rows: makeRows(10) });
  const r2 = grande.post({ pageIndex: 0, pageSize: 99999 });
  assert.equal(r2.pageSize, 5000, "arriba del maximo baja a 5000");
});

test("el recorte en memoria reparte las paginas completas sin repetir ni perder", () => {
  const { post } = loadRestlet({ rows: makeRows(TOTAL) });

  const ids = [];
  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    const page = post({ pageIndex, pageSize: 500, locationId: 1 });
    page.rows.forEach((row) => ids.push(row.id));
    if (!page.hasMore) break;
  }

  assert.equal(ids.length, TOTAL, "cada fila aparece una vez");
  assert.equal(new Set(ids).size, TOTAL, "sin repetir ninguna");
  assert.equal(ids[0], "1");
  assert.equal(ids[TOTAL - 1], String(TOTAL), "sin perder la ultima");
});

test("si la columna de ubicacion no existe, degrada al SQL de produccion en vez de fallar", () => {
  // Este es el fallback que faltaba: la columna nueva hace fallar el PARSEO de toda la
  // consulta, y el fallback anterior solo cubria "FETCH NEXT falla" y "el filtro devuelve 0".
  const { post, calls } = loadRestlet({
    rows: makeRows(TOTAL),
    failOn: /tl\.location/,
  });

  const result = post({ pageIndex: 0, pageSize: PAGE, locationId: 1 });

  assert.equal(result.ok, true, "responde igual que antes del cambio");
  assert.equal(result.rows.length, TOTAL, "con las 2400 filas");
  assert.equal(result.debug.estrategia, "sql-de-produccion");
  assert.match(result.debug.filtroUbicacion, /sin filtro/);
  assert.ok(result.debug.degradaciones.some((d) => /tl\.location|con-ubicacion/.test(d)), "deja constancia");
  assert.ok(calls.some((call) => !/tl\.location/.test(call.sql)), "la estrategia de produccion no menciona la columna");
});

test("si el filtro por ubicacion devuelve 0 filas, degrada a sin filtro en vez de dejar la lista vacia", () => {
  const { post, calls } = loadRestlet({
    rows: makeRows(TOTAL),
    emptyWhen: /tl\.location = \?/,
  });

  const result = post({ pageIndex: 0, pageSize: PAGE, locationId: 1 });

  assert.equal(result.rows.length, TOTAL, "no devuelve la lista vacia");
  assert.equal(result.debug.filtroUbicacion, "sin filtro por ubicacion");
  assert.ok(calls.some((call) => call.sql.includes("tl.location = ?")), "primero intenta con filtro");
  assert.ok(calls.some((call) => !call.sql.includes("tl.location = ?")), "y compara contra el total sin filtro");
  assert.ok(result.debug.degradaciones.some((d) => /0 filas/.test(d)), "deja constancia de la degradacion");
});

test("el filtro de ubicación se manda como parametro ligado, no interpolado", () => {
  const { post, calls } = loadRestlet({ rows: makeRows(10) });

  post({ pageIndex: 0, pageSize: 100, locationId: 1 });

  const conFiltro = calls[0];
  assert.match(conFiltro.sql, /tl\.location = \?/, "el valor no va en el texto del SQL");
  assert.deepEqual(conFiltro.params, [1]);
});

test("sin locationId en el body no se filtra", () => {
  const { post, calls } = loadRestlet({ rows: makeRows(10) });

  const result = post({ pageIndex: 0, pageSize: 100 });

  assert.doesNotMatch(calls[0].sql, /tl\.location = \?/);
  assert.deepEqual(calls[0].params, []);
  assert.equal(result.rows.length, 10);
  assert.match(result.debug.filtroUbicacion, /sin filtro/);
});

test("el id estable de operacion y el mapeo no cambian", () => {
  const { post } = loadRestlet({ rows: makeRows(1) });

  const row = post({ pageIndex: 0, pageSize: 100, locationId: 1 }).rows[0];

  assert.equal(row.id, "1", "viene de mot.id, no del indice posicional");
  assert.equal(row.workorder_id, "wo-1");
  assert.equal(row.workorder_tranid, "3000");
  assert.equal(row.status_op, "No iniciado", "translateStatus_ convierte el valor crudo");
  assert.equal(row.remaining_min, "30", "el trabajo pendiente cae al estimado si no viene");
  assert.equal(row.start_actual, "");
});

test("un fallo de SuiteQL que no es la columna se propaga con los intentos", () => {
  const { post } = loadRestlet({ failWith: "sin permisos de SuiteQL" });

  assert.throws(() => post({ pageIndex: 0, pageSize: 100, locationId: 1 }), (error) => {
    assert.match(error.message, /Ninguna estrategia/);
    assert.match(error.message, /sql-de-produccion/, "y enumera los intentos");
    return true;
  });
});
