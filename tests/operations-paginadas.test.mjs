// `operations` LLEGABA TRUNCADA A LA PAGINA, Y NO POR UNA FALLA DE LA CONSULTA.
//
// MEDIDO 2026-10-05 en produccion: `operations` tiene 2275 filas. La lectura de arranque no traia
// `limit`, y PostgREST (Supabase) aplica `db-max-rows` (1000 por defecto) cuando la peticion no trae
// limite: la pagina recibia SILENCIOSAMENTE las primeras 1000, sin error y sin aviso. El efecto
// medido en pantalla: la OT 2624 tenia 8 operaciones y la 3562 tenia 11, que es exactamente lo que
// pintaba el Gantt (19 ops, 509 h) y lo que usaban las dos listas de la cola. El Gantt no mintia:
// lo que llegaba era menos. Es la misma falla que ya se corrigio para `inspection_routes`
// (readInspectionRoutes pagina a mano; ver reader 659) y que aqui se resuelve una vez para
// cualquier tabla con `readTableEntero`.
//
// POR QUE ESTA PRUEBA NO ES "LEER 2275 FILAS DE VERDAD". Monta un `fetch` de mentira que hace
// EXACTAMENTE lo que hace PostgREST con y sin `limit`: sin limite, corta a 1000; con `limit` y
// `offset`, respeta la ventana. Si el corte no se reprodujera, la prueba passaria sin estar
// probando el defecto.
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const readerSource = await readFile(new URL("../src/web/shared/supabase-reader.js", import.meta.url), "utf8");

const MAX_ROWS = 1000;

/**
 * Levanta el LECTOR REAL contra un PostgREST de mentira que aplica `db-max-rows`.
 * `peticiones` sale con una entrada por peticion, para poder afirmar como se leyo.
 */
function lectorConDbMaxRows(filasPorTabla, { maxRows = MAX_ROWS } = {}) {
  const peticiones = [];
  const contexto = {
    console, JSON, Object, Array, Promise, Date, String, Number, Boolean, Error, encodeURIComponent,
    fetch: async (url) => {
      const partes = String(url).split("/rest/v1/")[1].split("?");
      const tabla = decodeURIComponent(partes[0]);
      const params = new URLSearchParams(partes[1] || "");
      const orden = params.get("order") || "";
      const limite = params.has("limit") ? Number(params.get("limit")) : null;
      const offset = params.has("offset") ? Number(params.get("offset")) : 0;
      peticiones.push({ tabla, orden, limite, offset });

      let filas = [...(filasPorTabla[tabla] || [])];
      // PostgREST ordena cuando se le pide; para estas pruebas el orden de la tabla ya es el
      // final, asi que solo se registra que se pidio.
      // PostgREST ordena cuando se le pide. La comparacion es la cruda a proposito (no
      // `localeCompare`): en la prueba de 50000 filas esa diferencia es la mayor parte del tiempo.
      if (orden) {
        filas = [...filas].sort((a, b) => {
          const x = String(a.ot == null ? "" : a.ot);
          const y = String(b.ot == null ? "" : b.ot);
          return x < y ? -1 : x > y ? 1 : 0;
        });
      }
      // ESTE es el defecto que hay que reproducir: sin `limit` PostgREST corta y no avisa.
      const tope = limite == null ? maxRows : limite;
      const ventana = filas.slice(offset, offset + tope);
      return {
        ok: true,
        status: 200,
        headers: { get: () => `0-${ventana.length - 1}/${filas.length}` },
        json: async () => ventana,
      };
    },
  };
  contexto.globalThis = contexto;
  vm.createContext(contexto);
  vm.runInContext(readerSource, contexto, { filename: "supabase-reader.js" });
  const reader = contexto.PPSupabaseReader;
  reader.configure({ url: "https://ejemplo.supabase.co", anonKey: "publicable-de-pruebas" });
  return { reader, peticiones };
}

function operaciones(n, desde = 0) {
  return Array.from({ length: n }, (_, i) => ({
    operation_id: `OT-${desde + i + 1}-1`,
    ot: String(1000 + desde + i),
    secuencia: 1,
    ct: "CORTE",
    descripcion: "OP",
    tiempo_ciclo: 10,
  }));
}

test("sin `limit`, la lectura de `operations` se corta en 1000 y NO avisa (el defecto medido)", async () => {
  const { reader, peticiones } = lectorConDbMaxRows({ operations: operaciones(2275) });
  const filas = await reader.readTable("operations");

  assert.equal(filas.length, 1000);
  assert.equal(peticiones.length, 1);
  assert.equal(peticiones[0].limite, null, "la lectura cruda no lleva `limit`: por eso PostgREST corta");
  assert.equal(peticiones[0].offset, 0);
});

test("`readTableEntero` pagina con `limit` + `offset` y trae las 2275 filas", async () => {
  const { reader, peticiones } = lectorConDbMaxRows({ operations: operaciones(2275) });
  const filas = await reader.readTableEntero("operations", { order: reader.ORDEN_PAGINADO.operations });

  assert.equal(filas.length, 2275);
  assert.equal(peticiones.length, 3, "2275 filas son tres viajes de 1000");
  assert.deepEqual(peticiones.map((p) => [p.limite, p.offset]), [[1000, 0], [1000, 1000], [1000, 2000]]);
  // Sin `order` el `offset` puede saltarse filas entre viajes, asi que se exige uno.
  assert.ok(peticiones.every((p) => p.orden), "cada viaje lleva el orden estable");
});

test("`readTableEntero` ignora el `limit` del llamador: para eso existe", async () => {
  const { reader } = lectorConDbMaxRows({ operations: operaciones(2275) });
  const filas = await reader.readTableEntero("operations", { limit: 10, order: "ot.asc" });

  assert.equal(filas.length, 2275);
});

test("el arranque lee `operations` paginadas: el estado ya no llega truncado", async () => {
  const { reader, peticiones } = lectorConDbMaxRows({
    operations: operaciones(2275),
    work_orders: [{ ot: "1001" }],
  });
  const leido = await reader.readCatalogs();

  assert.equal(leido.operations.length, 2275);
  // La lectura pide `order=ot.asc,secuencia.asc`, y el arranque lo respeta: la primera OT es la
  // menor y la ultima la mayor de las 2275.
  assert.equal(leido.operations[0].ot, "1000");
  assert.equal(leido.operations[2274].ot, "3274");
  // `missing` es la lista de tablas que llegaron vacias: `operations` ya no esta, porque ahora si
  // se lee entera. Antes de este fix se reportaba como leida de mas, con 1000 de 2275.
  assert.equal(leido.missing.includes("operations"), false);
  const lecturasDeOperations = peticiones.filter((p) => p.tabla === "operations");
  assert.equal(lecturasDeOperations.length, 3);
  assert.ok(lecturasDeOperations.every((p) => p.limite === 1000));
});

test("una tabla de mas de 50000 filas no entra en ciclo sin fin: el tope corta en 50 viajes", async () => {
  // Un servidor que devuelva `limit` filas para siempre seria un ciclo sin fin. El tope de viajes
  // es la red; aqui se prueba que existe y que el total que sale es el del tope.
  const { reader, peticiones } = lectorConDbMaxRows({ operations: operaciones(60000) });
  const filas = await reader.readTableEntero("operations", { order: "ot.asc" });

  assert.equal(peticiones.length, 50);
  assert.equal(filas.length, 50 * MAX_ROWS);
});

test("`ORDEN_PAGINADO` declara `operations`, que es la tabla que rebasa `db-max-rows`", async () => {
  const { reader } = lectorConDbMaxRows({});
  // La lista es manual a proposito: cuando otra tabla crezca de 1000 hay que AGREGARLA aqui, y una
  // prueba que la leyera sola no dejaria ver el olvido.
  assert.deepEqual(Object.keys(reader.ORDEN_PAGINADO), ["operations"]);
  assert.match(reader.ORDEN_PAGINADO.operations, /^ot\.asc/);
});
