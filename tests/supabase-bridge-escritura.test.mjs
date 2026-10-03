// EL CAMINO REAL DEL BOTON COMPLETAR/REABRIR DEL DETALLE DE OT.
//
// POR QUE EXISTEN ESTAS PRUEBAS Y POR QUE NO ALCANZA CON LAS DE ARRIBA.
//
// MEDIDO 2026-10-02. Al pulsar Completar o Reabrir en el detalle de una OT,
// `persistOptimisticPlanStatus` (src/web/planning/app.js:9352) hace
// `await PPSupabaseBridgeReplacement.saveOperationPlanStatus(...)`. Ese metodo pedia
// `writer.guardarPlan`, y `PPSupabaseWriter` exporta `guardar`: no existe. O sea que la
// llamada rechazaba con "PPSupabaseWriter no esta disponible" ANTES de escribir nada, el
// catch de app.js:9369 revertia el estado optimista y la persona veia el estado cambiar y
// volver, sin haberse guardado nunca.
//
// POR QUE LA SUITE NO LO TAPA. `tests/supabase-writer-app.test.mjs:119-126` reemplaza
// `PPSupabaseBridgeReplacement.saveOperationPlanStatus` por un falso que llama a
// `writer.guardar(...)`. O sea que el metodo real NUNCA se ejercita contra el escritor
// real: la suite podia estar en verde con el boton roto en produccion, y lo estaba.
//
// ESTAS PRUEBAS CARGAN LOS DOS MODULOS DE VERDAD, sin falsos y sin red, y comprueban dos
// cosas distintas:
//
//   A. QUE NO SE INVENTA UN METODO QUE EL ESCRITOR NO EXPORTA. Es la puerta que se
//      rompio. Se recorre TODA la superficie de escritura del reemplazo y se mira que
//      ninguna pida algo que el escritor no tenga, para que el proximo metodo nuevo no
//      repita el mismo fallo por copiar el nombre de al lado.
//
//   B. QUE LA ESCRITURA DE `operation_plan_statuses` ES UN UPSERT POR `key` Y NO UN
//      BORRADO. Esto es lo que hace peligroso al camino: `operation_plan_statuses` es
//      modo `espejo` (docs/schema-supabase-plan.sql:608) y `plan_guardar` hace `delete` +
//      `insert`. Un UPSERT por `key` no puede tocar las filas que no le dieron; un espejo
//      con el payload parcial se llevaria por delante todos los estados de las demas
//      operaciones. Se comprueba mirando el POST que sale, no el resultado.

import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const raiz = new URL("../", import.meta.url);
const escritorSrc = await readFile(new URL("src/web/shared/supabase-writer.js", raiz), "utf8");
const puenteSrc = await readFile(new URL("src/web/shared/supabase-bridge-replacement.js", raiz), "utf8");

const CLAVE_OPERACIONES = "https://ejemplo.supabase.co";
const CLAVE_PUBLICA = "sb_publishable_prueba";

/**
 * Levanta los dos modulos de verdad en un contexto con la redRecording, para poder ver
 * exactamente que POST sale. `fetch` NO responde de verdad: devuelve lo que se le pidio,
 * y solo falla cuando el test lo pide.
 *
 * El orden importa y no es negociable: el reemplazo captura `root.PPSupabaseWriter` al
 * cargarse (supabase-bridge-replacement.js:19-20), asi que el escritor tiene que existir
 * ANTES. Ese orden es el del bundle.
 */
function levantar({ status = 201, cuerpoRespuesta = "", token = "token-de-sesion" } = {}) {
  const peticiones = [];
  const root = {};
  const contexto = {
    console,
    JSON,
    Object,
    Array,
    Promise,
    Date,
    String,
    Number,
    Boolean,
    Error,
    TypeError,
    RegExp,
    Math,
    isFinite,
    isNaN,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    URL,
    URLSearchParams,
    Set,
    Map,
    Symbol,
    WeakMap,
    Promise,
    TextEncoder,
    TextDecoder,
    AbortController,
    structuredClone,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  contexto.globalThis = contexto;
  contexto.window = contexto;
  contexto.self = contexto;
  contexto.PPSupabaseWriter = undefined;
  contexto.fetch = async (destino, opciones) => {
    peticiones.push({ url: String(destino), metodo: opciones?.method, cuerpo: opciones?.body, cabeceras: opciones?.headers });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => cuerpoRespuesta,
      json: async () => JSON.parse(cuerpoRespuesta || "[]"),
    };
  };
  // Lo que el escritor necesita para NO frenar en la puerta antes de escribir:
  // configurado y con sesion. Las dos comprobaciones son reales; el token tambien.
  contexto.PPSupabaseAuth = { token: async () => token };
  vm.createContext(contexto);
  vm.runInContext(escritorSrc, contexto, { filename: "supabase-writer.js" });
  // El escritor lee su configuracion del sitio donde se cargo. Se declara antes de
  // cargarlo porque `configure` se lee en el momento de usar, no al cerrar el modulo.
  contexto.PPSupabaseWriter.configure({ url: CLAVE_OPERACIONES, anonKey: CLAVE_PUBLICA });
  vm.runInContext(puenteSrc, contexto, { filename: "supabase-bridge-replacement.js" });
  return { root: contexto, escritor: contexto.PPSupabaseWriter, puente: contexto.PPSupabaseBridgeReplacement, peticiones };
}

const ESTADO_UNA_OPERACION = {
  key: "OP|3478|1|CORTE",
  ot: "3478",
  sequence: 1,
  ct: "CORTE",
  status: "COMPLETADA_PLAN",
  origin: "draft",
  completedAt: "2026-10-02T14:03:11.000Z",
  reopenedAt: null,
};

test("A1. el escritor REAL exporta guardarPlanStatuses, que es lo que el boton necesita", () => {
  const { escritor } = levantar();
  assert.equal(typeof escritor, "object");
  assert.equal(typeof escritor.guardarPlanStatuses, "function",
    "saveOperationPlanStatus llama a guardarPlanStatuses: si el escritor no lo tiene, el boton rejecta antes de escribir");
});

// Metodos que el reemplazo pide y el escritor todavia NO tiene. Cada uno esta en la
// lista a proposito y con su razon escrita en el codigo (supabase-writer.js, bloque "NO
// HAY UN `guardarPlanSnapshot`"): son los tres caminos de instantanea, que no se pueden
// escribir sin medir antes que columnas tiene la fila en la base.
//
// MEDIDO 2026-10-02: `guardarPlan` NO esta en esta lista y por eso la puerta `exigirMetodo`
// lo atrapa. Si alguien lo vuelve a escribir, esta prueba falla.
const PENDIENTES_A_MEDIR = new Set(["guardarPlanSnapshot"]);

// El codigo sin comentarios: los comentarios citan a proposito nombres que ya no existen
// (`guardarPlan`, `w.algo is not a function`) para explicar el fallo, y un recorrido de
// texto plano los contaria como llamadas.
const codigoSinComentarios = puenteSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

test("A2. ningun metodo del reemplazo pide un metodo que el escritor no exporta", () => {
  const { escritor } = levantar();
  const pedidos = new Set();
  const patron = /\bw\.([A-Za-z_][A-Za-z0-9_]*)/g;
  let coincidencia = patron.exec(codigoSinComentarios);
  while (coincidencia) {
    pedidos.add(coincidencia[1]);
    coincidencia = patron.exec(codigoSinComentarios);
  }
  const faltan = [...pedidos]
    .filter((nombre) => !PENDIENTES_A_MEDIR.has(nombre))
    .filter((nombre) => typeof escritor[nombre] !== "function");
  assert.deepEqual(faltan, [],
    `el reemplazo llama a metodos que PPSupabaseWriter no exporta y que no estan en `
    + `PENDIENTES_A_MEDIR: ${faltan.join(", ")}. Cada uno es un rechazo ANTES de escribir nada`);
});

test("A3. la puerta del escritor pregunta por `guardar`, que es el metodo que existe", () => {
  // El mensaje original decia "PPSupabaseWriter no esta disponible" con el escritor
  // CARGADO: senalaba al modulo cuando el modulo estaba ahi y lo que faltaba era el
  // metodo. Estas dos comprobaciones son el contrato de la puerta.
  const desde = codigoSinComentarios.indexOf("function getWriter(");
  const hasta = codigoSinComentarios.indexOf("function exigirMetodo(");
  assert.ok(desde >= 0 && hasta > desde, "no se encontro la puerta del escritor en el reemplazo");
  const puerta = codigoSinComentarios.slice(desde, hasta);
  assert.match(puerta, /writer\.guardar\b/,
    "la puerta tiene que exigir el metodo que el escritor REALMENTE exporta (`guardar`), no uno inventado");
  assert.equal(/typeof writer\.guardarPlan\b/.test(puerta), false,
    "`guardarPlan` no existe en el escritor: exigirlo es el defecto medido el 2026-10-02");
});

test("A4. exigirMetodo dice el metodo que falta, no que el escritor no esta", async () => {
  // El camino de instantanea sigue sin poder escribir (no se puede decidir sin medir la
  // base), pero el aviso tiene que ser elUtil: decir que falta el metodo y para que se
  // usa. Es lo que hace que el fallo sea diagnosticable sin abrir el codigo.
  const { puente } = levantar();
  await assert.rejects(
    () => puente.saveDraftSnapshot({ snapshotId: "draft" }),
    /no trae `guardarPlanSnapshot`/,
  );
  await assert.rejects(
    () => puente.saveDraftSnapshot({ snapshotId: "draft" }),
    /no se escribio nada/,
  );
});

test("B1. Completar una operacion hace UN UPSERT por key y no borra nada", async () => {
  const { puente, peticiones } = levantar();
  await puente.saveOperationPlanStatus({ revision: 7, status: ESTADO_UNA_OPERACION, statuses: [ESTADO_UNA_OPERACION] });

  assert.equal(peticiones.length, 1, `se esperaba una sola peticion y salio ${peticiones.length}: ${JSON.stringify(peticiones.map((p) => p.url))}`);
  const [peticion] = peticiones;
  assert.equal(peticion.metodo, "POST");
  assert.match(peticion.url, /\/rest\/v1\/operation_plan_statuses/);
  // El `on_conflict=key` es lo que convierte esto en un UPSERT. Sin el, PostgREST usa la
  // primary key, que en esta tabla es un uuid que la pagina nunca manda, y cada guardado
  // entraria como fila nueva.
  assert.match(peticion.url, /on_conflict=key/);
  // Y no puede haber un DELETE por ningun lado: esta tabla es espejo de TODOS los estados
  // de operacion y el payload solo trae los tocados.
  assert.doesNotMatch(peticion.url, /DELETE/i);

  const filas = JSON.parse(peticion.cuerpo);
  assert.equal(Array.isArray(filas), true);
  assert.equal(filas.length, 1);
  assert.deepEqual(Object.keys(filas[0]).sort(), ["ct", "fecha_completado", "fecha_reapertura", "key", "origin", "ot", "secuencia", "status"].sort(),
    "las columnas tienen que ser las que declara plan_tabla_escritura para operation_plan_statuses (docs/schema-supabase-plan.sql:608-609)");
  assert.equal(filas[0].key, "OP|3478|1|CORTE");
  assert.equal(filas[0].status, "COMPLETADA_PLAN");
  assert.equal(filas[0].secuencia, 1);
  assert.equal(filas[0].fecha_completado, "2026-10-02T14:03:11.000Z");
});

test("B2. la fila NO lleva revision: esa la pone la funcion del RPC, no la pagina", async () => {
  const { puente, peticiones } = levantar();
  await puente.saveOperationPlanStatus({ revision: 7, statuses: [ESTADO_UNA_OPERACION] });
  const filas = JSON.parse(peticiones[0].cuerpo);
  assert.equal("revision" in filas[0], false,
    "plan_tabla_escritura no lista revision entre las columnas de operation_plan_statuses y su nota dice que la pone la funcion "
    + "(docs/schema-supabase-plan.sql:608-610). Mandarla seria atribuir el cambio a un guardado que todavia no ha pasado");
});

test("B3. Reabrir escribe la MISMA fila con PENDIENTE y la fecha de reapertura", async () => {
  const { puente, peticiones } = levantar();
  const reabierta = Object.assign({}, ESTADO_UNA_OPERACION, {
    status: "PENDIENTE",
    reopenedAt: "2026-10-02T14:07:02.000Z",
    completedAt: null,
  });
  await puente.saveOperationPlanStatus({ revision: 8, statuses: [reabierta] });
  const filas = JSON.parse(peticiones[0].cuerpo);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].status, "PENDIENTE");
  assert.equal(filas[0].fecha_reapertura, "2026-10-02T14:07:02.000Z");
  assert.equal(filas[0].fecha_completado, null);
  // Reabrir es un UPSERT de la misma clave, no un INSERT de una fila nueva: si saliera
  // una fila mas, la operacion tendria dos estados y el lector no sabria cual gana.
  assert.match(peticiones[0].url, /on_conflict=key/);
});

test("B4. la cascada se escribe en UNA sola peticion, con todas las operacion tocadas", async () => {
  // Completar una operacion completa tambien las anteriores de la secuencia. Van en el
  // mismo `statuses`, o sea en un unico UPSERT: si salieran en peticiones separadas, la
  // base podria quedar con la cascada a medias si la segunda falla.
  const { puente, peticiones } = levantar();
  const cascada = [
    Object.assign({}, ESTADO_UNA_OPERACION, { key: "OP|3478|1|CORTE", sequence: 1 }),
    Object.assign({}, ESTADO_UNA_OPERACION, { key: "OP|3478|2|DOBLEZ", sequence: 2, ct: "DOBLEZ", status: "PENDIENTE" }),
  ];
  await puente.saveOperationPlanStatus({ revision: 9, statuses: cascada });
  assert.equal(peticiones.length, 1);
  const filas = JSON.parse(peticiones[0].cuerpo);
  assert.deepEqual(filas.map((f) => f.key), ["OP|3478|1|CORTE", "OP|3478|2|DOBLEZ"]);
});

test("B5. sin sesion no sale NADA, y el motivo lo dice el escritor", async () => {
  const { root, puente, peticiones } = levantar();
  root.PPSupabaseAuth = { token: async () => null };
  const informe = await puente.saveOperationPlanStatus({ revision: 10, statuses: [ESTADO_UNA_OPERACION] });
  assert.equal(peticiones.length, 0,
    `sin sesion no puede salir una escritura; salieron ${peticiones.length}: ${JSON.stringify(peticiones.map((p) => p.url))}`);
  assert.equal(informe.ok, false);
  assert.match(String(informe.motivo || ""), /sesion/i);
});