// LO QUE FALLA Y QUE ESTAS PRUEBAS VIGILAN. MEDIDO 2026-10-01 con sesion en la pagina real de
// produccion: las 175 OT del Backlog decian `qty:0`, las 10 de la cola igual, y el detalle de la
// misma OT si mostraba la cantidad. Tres defectos distintos, en tres archivos, y ninguno se
// anunciaba como lo que era.
//
//   1. `mapMaterials` NO ESTABA PUBLICADO. La funcion existe en el lector (supabase-reader.js:851)
//      y se usa internamente en readCatalogs, pero el reemplazo la pide por `r.mapMaterials(...)`
//      en getPlanningWorkOrderData. MEDIDO: el toast de la tarjeta del Backlog decia literalmente
//      `r.mapMaterials is not a function`. Como getPlanningWorkOrderData es el camino que trae
//      operaciones, materiales y ficha de UNA OT, toda la carga por OT caia: la funcion de la OT
//      no llegaba nunca desde Supabase.
//
//   2. LA RAMA DE "AUSENTE" DEL LECTOR ERA CODIGO MUERTO. mapWorkOrders computaba
//      `cantidad - cant_ensamblada` solo cuando `cant_pendiente` llegaba VACIA, y la columna es
//      `integer not null default 0` (schema-supabase.sql:182-183), o sea que nunca llega vacia.
//      El `else` ganaba siempre y pendingQuantity era 0 para todas las OT.
//
//   3. EL 0 SE CONSERVABA EN CIRCULO. normalizeWorkOrders (app.js:1805) tiene el respaldo
//      `pendingQuantity ?? cantidad - ensamblada`, pero `??` solo cae en null/undefined, no en 0; y
//      pendingPiecesForWorkOrder (app.js:13098) lo acepta porque `Number.isFinite(Number(0))` es
//      true. Al guardar, filasWorkOrders (supabase-writer.js:1291) volvia a escribir ese 0.
//
// POR QUE EL ARNES USA vm Y NO require. MEDIDO 2026-10-01: `require(...)` de este archivo devuelve
// un objeto SIN PROPIEDADES, y `typeof require.cache[...].exports` da `[object Module]`, o sea el
// namespace de un modulo ES. La causa es que el paquete es `"type": "module"`: parsed como ES,
// `module` no existe, `typeof module === "object"` es false, y la linea
// `if (typeof module === "object" && module.exports) module.exports = api;` NO SE EJECUTA. Lo
// unico que publica el archivo es `root.PPSupabaseReader = api`. O sea que la rama de
// `module.exports` es codigo muerto en ESTE repositorio, y en el navegador tambien: ahi `module`
// tampoco existe. Una prueba que use require estaria probando un objeto vacio y pasaria sin
// mirar nada. Se levanta el archivo en un contexto, como ya hace supabase-reader-mapeo.test.mjs,
// y se lee lo que la pagina lee de verdad.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";

const readerSource = await readFile(new URL("../src/web/shared/supabase-reader.js", import.meta.url), "utf8");
const reemplazo = await readFile(new URL("../src/web/shared/supabase-bridge-replacement.js", import.meta.url), "utf8");

/** Levanta el LECTOR REAL y devuelve la API que la pagina ve en `PPSupabaseReader`. */
function lector() {
  const contexto = { console, JSON, Object, Array, Promise, Date, String, Number, Boolean, Error, Math, encodeURIComponent };
  contexto.globalThis = contexto;
  createContext(contexto);
  runInContext(readerSource, contexto, { filename: "supabase-reader.js" });
  return contexto.PPSupabaseReader;
}

const reader = lector();

// Una fila de work_orders tal como llega de la tabla. `cant_ensamblada` y `cant_pendiente` en 0
// NO es un caso inventado: es lo que hay, porque nadie las escribe (MAPPING_GAPS.work_orders).
const filaSinAvance = {
  id: "w1", ot: "2121", articulo: "20241152", descripcion: "TUBO SALIDA TURBO CONJ",
  cantidad: 500, cant_ensamblada: 0, cant_pendiente: 0, estatus: "EN CURSO", cliente: "ACME",
};

test("mapMaterials esta PUBLICADA: sin esto getPlanningWorkOrderData tira TypeError", () => {
  assert.equal(typeof reader.mapMaterials, "function",
    "mapMaterials tiene que estar en la API que ve PPSupabaseReader: el reemplazo la llama y sin esto toda la carga por OT se cae");
  const r = reader.mapMaterials([{ id: "m1", ot: "2121", componente: "TUBO", requerido: 4, emitido: 4, pendiente: 0 }]);
  assert.equal(r.length, 1);
  assert.equal(r[0].component, "TUBO");
  assert.equal(r[0].required, 4);
});

test("el reemplazo NO llama ninguna funcion que el lector no publique", () => {
  // MEDIDO: el fallo fue `r.mapMaterials is not a function`, o sea un metodo pedido y no
  // publicado. Este recorre TODOS los `r.<metodo>` del reemplazo y los compara contra la API
  // que la pagina ve de verdad, para que el siguiente metodo que se agregue sin publicar caiga
  // aqui y no en produccion. No comprueba el texto del archivo: comprueba que el objeto exista.
  const pedidas = [...new Set([...reemplazo.matchAll(/\br\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))];
  const faltantes = pedidas.filter((m) => typeof reader[m] === "undefined");
  assert.deepEqual(faltantes, [],
    "el reemplazo llama metodos del lector que no estan en PPSupabaseReader: " + faltantes.join(", "));
});

test("una OT de 500 piezas con las dos columnas en 0 NO se queda en pendiente 0", () => {
  const [wo] = reader.mapWorkOrders([filaSinAvance]);
  assert.equal(wo.quantity, 500);
  // Este es el numero que ve la persona en la tarjeta. Antes salia 0.
  assert.equal(wo.pendingQuantity, 500,
    "con cant_ensamblada y cant_pendiente en 0, lo unico que se sabe es que nadie las escribio: el pendiente es la cantidad de la orden");
});

test("una OT SURTIDA de verdad sigue mostrando pendiente 0", () => {
  // El otro lado, que es el que no hay que romper: si hay avance escrito, el 0 es un dato y se
  // respeta. Si esto cediera, una OT cerrada se presentaria como pendiente y habria que ir a
  // revisarla a mano, que es el costo que no se quiere.
  const [wo] = reader.mapWorkOrders([{ ...filaSinAvance, cant_ensamblada: 500, cant_pendiente: 0 }]);
  assert.equal(wo.pendingQuantity, 0, "500 de 500 surtados es pendiente 0, y es un 0 de verdad");
  assert.equal(wo.builtQuantity, 500);
});

test("una OT a medio surtur usa el pendiente escrito y la cantidad no se pierde", () => {
  const [wo] = reader.mapWorkOrders([{ ...filaSinAvance, cant_ensamblada: 200, cant_pendiente: 300 }]);
  assert.equal(wo.pendingQuantity, 300);
  assert.equal(wo.quantity, 500);
});

test("una OT sin cantidad tampoco se queda en pendiente 0", () => {
  // Sin `cantidad` tampoco hay nada escrito: lo unico que hay es un 0 que no significa nada.
  const [wo] = reader.mapWorkOrders([{ ...filaSinAvance, cantidad: 0 }]);
  assert.equal(wo.pendingQuantity, 0, "sin cantidad y sin avance no hay de donde sacar un pendiente, y 0 es la respuesta honesta");
});

test("el hueco DECLARADO sigue en MAPPING_GAPS: no se absorbe en silencio", () => {
  // El codigo de arriba resuelve el 0, y esa es la parte peligrosa: si la regla se queda solo en
  // el codigo, el dia que el RESTlet traiga las columnas nadie se acuerda de que hubo un hueco.
  // MAPPING_GAPS es donde este proyecto declara lo que no sabe, asi que el arreglo tiene que
  // aparecer ahi y no solo en el codigo que lo calcula.
  const bloque = reader.MAPPING_GAPS.work_orders.join(" | ");
  assert.ok(bloque.includes("cant_ensamblada") && bloque.includes("cant_pendiente"),
    "el hueco de cant_ensamblada/cant_pendiente tiene que estar declarado en MAPPING_GAPS.work_orders");
  assert.ok(bloque.includes("src/server/"),
    "y tiene que decir DONDE se midio que nadie las escribe, no solo que faltan");
});