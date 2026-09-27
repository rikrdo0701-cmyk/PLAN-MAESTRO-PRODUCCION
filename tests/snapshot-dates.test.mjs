/**
 * PP_listPlanSnapshots_ tiene que devolver la FECHA REAL de cada snapshot publicado.
 *
 * EL BUG. grouped se arma desde PLANES_HISTORICOS con `generatedAt: ''` (la funcion no lee la
 * columna FECHA_GENERACION), y despues se combinaba con Object.assign({}, metadata, grouped, {...})
 * — el objeto de la hoja DESPUES del metadata del manifiesto. O sea que el vacio de la hoja pisaba
 * la fecha buena del manifiesto. weekStart no lo sufria porque se reasignaba explicitamente en el
 * tercer objeto; generatedAt no. Medido el 2026-09-26: los 123 snapshots publicados salian con
 * "(sin fecha)" y solo draft traia fecha.
 *
 * POR QUE NO ES COSMETICO, Y POR QUE ESTE TEST MIRA TRES COSAS Y NO UNA.
 *  1. La fecha es lo que hace falta para un corte por antiguedad ("lo de mas de un mes atras se
 *     borra"), que es decision de la persona y tiene que ser auditable por fecha, no por cantidad.
 *  2. El selector se ordena por generatedAt al final de la funcion. Con todas vacias, esa
 *     comparacion no decidia nada y el orden que veia el usuario era el de insercion de la hoja
 *     por casualidad. Este test comprueba que el orden sea el correcto.
 *  3. El conteo de operaciones viene de la hoja y es mas exacto que el del manifiesto, asi que NO
 *     se debe perder: el arreglo del orden no puede pisar operations.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const src = await readFile(new URL("../src/server/02-storage.js", import.meta.url), "utf8");

function extraer(nombre) {
  const i = src.search(new RegExp(`^function ${nombre}\\(`, "m"));
  assert.notEqual(i, -1, `no encontre ${nombre}`);
  const abre = src.indexOf("{", i);
  let nivel = 0, comillas = null;
  for (let k = abre; k < src.length; k += 1) {
    const c = src[k];
    if (comillas) { if (c === "\\") { k += 1; continue; } if (c === comillas) comillas = null; continue; }
    if (c === '"' || c === "'" || c === "`") { comillas = c; continue; }
    if (c === "{") nivel += 1;
    if (c === "}") { nivel -= 1; if (nivel === 0) return src.slice(i, k + 1); }
  }
  throw new Error(`sin cerrar en ${nombre}`);
}

const FN = extraer("PP_listPlanSnapshots_");
const ROWS = extraer("PP_readRows_");

/** propertyValues: lo que devuelve PP_readManifestIndex_. */
function correr({ filas, propertyValues }) {
  const props = { getProperty: (k) => (k === "idx" ? propertyValues : null), setProperty: () => {} };
  const propsService = { getScriptProperties: () => props };
  const hoja = (filas) => ({
    getLastRow: () => filas.length + 1,
    getLastColumn: () => 3,
    getRange(f, c, nf, nc) {
      const vals = [];
      for (let r = f; r < f + nf; r += 1) {
        if (r === 1) { vals.push(["SNAPSHOT_ID", "FECHA_GENERACION", "PLAN_INICIO"]); continue; }
        vals.push(filas[r - 2] || []);
      }
      return { getDisplayValues: () => vals, getValues: () => vals };
    },
    // PP_readRows_ lo usa para BORRADOR_PLAN, que aqui va vacia.
    getDataRange() {
      const vals = [["SNAPSHOT_ID", "FECHA_GENERACION", "PLAN_INICIO"]].concat(filas);
      return { getDisplayValues: () => vals, getValues: () => vals };
    },
  });
  const vacia = hoja([]);
  const ctx = { console, JSON, Math, String, Number, Object, Array, isFinite, isNaN, PropertiesService: propsService, MANIFIESTO: propertyValues };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(
    `${ROWS}\n${FN}\nthis.PP_ensureManifestIndex_=function(){return JSON.parse(MANIFIESTO||'[]');};this.run=PP_listPlanSnapshots_;`,
    ctx,
  );
  // BORRADOR_PLAN va vacia a proposito: el borrador tiene su propia rama en la funcion y aqui se
  // quiere aislar la del historial, que es la que tiene el bug del orden.
  return ctx.run({ getSheetByName: (n) => (n === "BORRADOR_PLAN" ? vacia : hoja(filas)) });
}

const ISO = (d) => `2026-09-${String(d).padStart(2, "0")}T10:00:00.000Z`;

test("el snapshot publicado trae la FECHA REAL del manifiesto, no la vacia de la hoja", () => {
  const r = correr({
    // La hoja NO tiene columna FECHA_GENERACION con datos: la funcion no la lee.
    filas: [["viejo-a", "", ""], ["viejo-a", "", ""], ["viejo-b", "", ""]],
    propertyValues: JSON.stringify([
      { snapshotId: "viejo-a", generatedAt: ISO(1), user: "ana", planStart: "2026-08-31", weekStart: "2026-08-31", operations: 2 },
      { snapshotId: "viejo-b", generatedAt: ISO(5), user: "ana", planStart: "2026-09-07", weekStart: "2026-09-07", operations: 1 },
    ]),
  });
  const a = r.find((x) => x.snapshotId === "viejo-a");
  const b = r.find((x) => x.snapshotId === "viejo-b");
  assert.equal(a.generatedAt, ISO(1), "la fecha del manifiesto tiene que llegar al selector");
  assert.equal(b.generatedAt, ISO(5));
  assert.equal(a.user, "ana", "el usuario tambien viene del manifiesto");
});

test("el conteo de operaciones lo gana la HOJA, que es mas exacto que el del manifiesto", () => {
  // Este es el riesgo del arreglo: si se invirtiera el orden del Object.assign, operations
  // pasaria a valer lo que dice el manifiesto, que se queda viejo. La hoja se cuenta ahora.
  const r = correr({
    filas: [["x", "", ""], ["x", "", ""], ["x", "", ""], ["x", "", ""], ["x", "", ""]],
    propertyValues: JSON.stringify([{ snapshotId: "x", generatedAt: ISO(1), weekStart: "2026-08-31", operations: 99 }]),
  });
  const x = r.find((item) => item.snapshotId === "x");
  assert.equal(x.operations, 5, "la hoja tiene 5 filas, el manifiesto dice 99: gana la hoja");
  assert.equal(x.generatedAt, ISO(1), "y la fecha sigue viniendo del manifiesto");
});

test("el selector queda ORDENADO por fecha, y no por casualidad", () => {
  // Con todas las fechas vacias, el sort final no decidia nada y el orden era el de insercion de
  // la hoja. Este test mete las filas en orden contrario al de las fechas y exige el orden por fecha.
  const r = correr({
    filas: [
      ["c", "", ""],                      // la mas nueva, primera en la hoja
      ["a", "", ""], ["a", "", ""],        // la mas vieja, segunda
      ["b", "", ""],                      // la del medio, tercera
    ],
    propertyValues: JSON.stringify([
      { snapshotId: "a", generatedAt: ISO(1), weekStart: "2026-08-31" },
      { snapshotId: "b", generatedAt: ISO(5), weekStart: "2026-09-07" },
      { snapshotId: "c", generatedAt: ISO(20), weekStart: "2026-09-21" },
    ]),
  });
  assert.deepEqual(r.map((x) => x.snapshotId), ["c", "b", "a"],
    "de la mas nueva a la mas vieja. Si esto falla, el orden del selector es el de la hoja por casualidad.");
});

test("un snapshot que NO esta en el manifiesto sigue apareciendo, y sin fecha inventada", () => {
  // Dos casos opuestos y los dos tienen que funcionar:
  //  (a) una fila en la hoja cuyo snapshot no quedo en el manifiesto: se lista, sin fecha, porque
  //      no hay de donde sacarla. Inventar una seria peor que dejarla vacia.
  //  (b) una entrada del manifiesto cuyas filas ya no estan: TAMBIEN se lista. Si no, el
  //      selector esconderia un plan publicado, que es peor que mostrar uno vacio.
  const r = correr({
    filas: [["sin-manifiesto", "", ""]],
    propertyValues: JSON.stringify([{ snapshotId: "otro", generatedAt: ISO(1), weekStart: "2026-08-31" }]),
  });
  assert.equal(r.length, 2, "los dos se listan: el de la hoja y el del manifiesto");
  const sinManifiesto = r.find((x) => x.snapshotId === "sin-manifiesto");
  const otro = r.find((x) => x.snapshotId === "otro");
  assert.equal(sinManifiesto.generatedAt, "", "sin manifiesto no hay fecha, y se dice vacio en vez de inventar una");
  assert.equal(otro.generatedAt, ISO(1), "y el del manifiesto conserva su fecha");
  assert.equal(otro.operations, 0, "el del manifiesto sin filas tiene 0 operaciones, no un numero inventado");
});

test("una entrada del manifiesto SIN fecha NO recibe una fecha inventada", () => {
  // Este es el caso que importa para un corte por antiguedad. Si un snapshot sin fecha real
  // recibiera la fecha de hoy, un "borrar lo de mas de un mes atras" lo trataria como recien
  // hecho y no lo borraria, y al reves: si la fecha se inventa con cualquier regla, el criterio
  // por antiguedad deja de ser auditable. Lo que no se puede es inventar. Un plan sin fecha se
  // queda sin fecha, y quien decida que hacer con el lo tiene que ver asi en la cara.
  const r = correr({
    filas: [["sin-fecha", "", ""]],
    propertyValues: JSON.stringify([{ snapshotId: "sin-fecha", generatedAt: "", weekStart: "2026-08-24" }]),
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].generatedAt, "", "sin fecha real,generatedAt queda vacio: no se inventa ninguna");
  assert.equal(r[0].weekStart, "2026-08-24", "y la semana si se conserva, porque esa si vino del manifiesto");
});

test("sin manifiesto: sigue funcionando, solo sin fechas", () => {
  const r = correr({ filas: [["a", "", ""], ["b", "", ""]], propertyValues: null });
  assert.equal(r.length, 2, "los dos se listan");
  assert.ok(r.every((x) => x.generatedAt === ""), "pero sin fecha, porque no hay de donde sacarla");
});
