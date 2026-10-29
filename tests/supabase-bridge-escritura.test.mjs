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
/** El contexto comun: lo que los tres modulos necesitan del navegador. */
function construirContexto({ token = "token-de-sesion" } = {}) {
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
  // Lo que el escritor necesita para NO frenar en la puerta antes de escribir:
  // configurado y con sesion. Las dos comprobaciones son reales; el token tambien.
  contexto.PPSupabaseAuth = { token: async () => token };
  return contexto;
}

function levantar({ status = 201, cuerpoRespuesta = "", token = "token-de-sesion" } = {}) {
  const peticiones = [];
  const contexto = construirContexto({ token });
  contexto.fetch = async (destino, opciones) => {
    peticiones.push({ url: String(destino), metodo: opciones?.method, cuerpo: opciones?.body, cabeceras: opciones?.headers });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => cuerpoRespuesta,
      json: async () => JSON.parse(cuerpoRespuesta || "[]"),
    };
  };
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

// Metodos que el reemplazo pide y el escritor todavia NO tiene.
//
// MEDIDO 2026-10-02: `guardarPlan` NO esta en esta lista y por eso la puerta `exigirMetodo`
// lo atrapa. Si alguien lo vuelve a escribir, esta prueba falla. Cuando estaba `draft`,
// `plan_snapshots` SI se podia arreglar, despues de medir las columnas reales: quedo vacio.
const PENDIENTES_A_MEDIR = new Set();

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

test("A4. exigirMetodo nombra el metodo que falta, no el modulo", () => {
  // Con el escritor real ningun metodo del reemplazo falla por puerta, asi que la puerta
  // se mira por el otro lado: en su texto. El aviso viejo decia "PPSupabaseWriter no esta
  // disponible" con el escritor CARGADO, y eso es lo que hacia el fallo indepurable: senalaba
  // al modulo cuando el problema era el metodo.
  const desde = codigoSinComentarios.indexOf("function exigirMetodo(");
  assert.ok(desde >= 0, "no se encontro exigirMetodo en el reemplazo");
  const cuerpo = codigoSinComentarios.slice(desde, desde + 700);
  // El aviso se comprueba por las tres piezas que lo hacen util, no por una expresion
  // regular sobre el texto: dentro del mensaje el nombre va interpolado, y una regex
  // sobre la fuente tendria que distinguir el acento grave del delimitador del literal.
  assert.ok(cuerpo.includes("no trae"), "el aviso tiene que decir el metodo que falta");
  assert.ok(cuerpo.includes("${nombre}"), "con el nombre del metodo interpolado, no uno fijo");
  assert.ok(cuerpo.includes("${paraQue}"), "y para que se usa ese metodo");
  assert.ok(cuerpo.includes("no se escribio nada"),
    "y tiene que decir que no se escribio nada, que es lo que la persona necesita saber");
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

// =============================================================================
// C. LAS INSTANEAS DEL PLAN: LO QUE SE MIDIO Y LO QUE SE ARREGLO
// =============================================================================
//
// MEDIDO 2026-10-02 contra el schema cache de PostgREST (son solo GETs):
//
//   plan_snapshots tiene 12 columnas: id, snapshot_id, operations, generated_at,
//   plan_start, version, usuario, change_summary, published_at, publication_reason,
//   created_at, payload. NO HAY columna `status`.
//
//   La unica NOT NULL SIN default es `snapshot_id`. `operations`, `plan_start`,
//   `version`, `usuario` y `publication_reason` tienen default; `id` y `created_at` tambien.
//
//   La fila real es una sola: `snapshot_id='draft'`, `created_at` 2026-10-02T01:38:40.191Z,
//   `operations='[]'`, y `payload` con 447375 caracteres de jsonb.
//
// QUE SE ROMPIA. Los tres metodos de instantanea pedian `writer.guardarPlan` (que no
// existe), y ademas mandaban `status` como COLUMNA y `payload` como TEXTO. Los dos
// segundos fallos no se venian porque el primero cortaba antes.
//
// QUE SE COMPRUEBA AQUI. Que la fila que sale es la que la pagina sabe leer, que no lleva
// columnas que no existen, y que el borrador no se borra a si mismo en un merge.

const LECTOR_SRC = await readFile(new URL("src/web/shared/supabase-reader.js", raiz), "utf8");

/**
 * Levanta escritor, LECTOR y reemplazo, y guarda en memoria lo que se escribe.
 *
 * EL ORDEN ES EL DEL BUNDLE Y NO ES UN DETALLE: el reemplazo captura
 * `root.PPSupabaseReader` y `root.PPSupabaseWriter` al cargarse
 * (supabase-bridge-replacement.js:19-20), asi que los dos tienen que existir ANTES que el.
 * Con el lector despues, `getReader()` lanza "PPSupabaseReader no esta disponible" y la
 * lectura se prueba sin lector, que es como se cuelan los fallos de mapeo.
 */
function levantarConMemoria({ filaInicial = null } = {}) {
  const memoria = { plan_snapshots: filaInicial ? [filaInicial] : [] };
  const peticiones = [];
  const contexto = construirContexto();
  contexto.fetch = async (destino, opciones) => {
    const url = String(destino);
    const metodo = opciones?.method || "GET";
    peticiones.push({ url, metodo, cuerpo: opciones?.body });
    if (url.includes("/plan_snapshots") && metodo === "GET") {
      return { ok: true, status: 200, text: async () => JSON.stringify(memoria.plan_snapshots), json: async () => memoria.plan_snapshots };
    }
    if (url.includes("/plan_snapshots") && metodo === "POST") {
      const filas = JSON.parse(opciones.body);
      filas.forEach((fila) => {
        const i = memoria.plan_snapshots.findIndex((f) => f.snapshot_id === fila.snapshot_id);
        // `resolution=merge-duplicates`: la fila existente se actualiza con lo que venga.
        if (i >= 0) memoria.plan_snapshots[i] = Object.assign({}, memoria.plan_snapshots[i], fila);
        else memoria.plan_snapshots.push(fila);
      });
      return { ok: true, status: 201, text: async () => "", json: async () => [] };
    }
    return { ok: true, status: 200, text: async () => "[]", json: async () => [] };
  };
  vm.createContext(contexto);
  vm.runInContext(escritorSrc, contexto, { filename: "supabase-writer.js" });
  vm.runInContext(LECTOR_SRC, contexto, { filename: "supabase-reader.js" });
  // El LECTOR tambien necesita configuracion, y es una puerta distinta: sin esto
  // `readTable` lanza "Supabase sin configurar" y la lectura no se esta probando.
  contexto.PPSupabaseWriter.configure({ url: CLAVE_OPERACIONES, anonKey: CLAVE_PUBLICA });
  contexto.PPSupabaseReader.configure({ url: CLAVE_OPERACIONES, anonKey: CLAVE_PUBLICA });
  vm.runInContext(puenteSrc, contexto, { filename: "supabase-bridge-replacement.js" });
  return { memoria, peticiones, puente: contexto.PPSupabaseBridgeReplacement, escritor: contexto.PPSupabaseWriter };
}

const PLAN_DE_EJEMPLO = {
  snapshotId: "draft",
  status: "BORRADOR",
  planStart: "2026-09-28",
  generatedAt: "2026-10-02T01:38:40.191Z",
  operations: [{ id: "op-1", ot: "3478", ct: "CORTE" }, { id: "op-2", ot: "3478", ct: "DOBLEZ" }],
  settings: { reportWeekStart: "2026-09-28" },
};

test("C1. el borrador se escribe con UPSERT por snapshot_id y sin columna 'status'", async () => {
  const { puente, peticiones } = levantarConMemoria();
  await puente.saveDraftSnapshot(PLAN_DE_EJEMPLO);
  const escritura = peticiones.find((p) => p.metodo === "POST");
  assert.ok(escritura, "no se escribio nada");
  assert.match(escritura.url, /\/rest\/v1\/plan_snapshots/);
  assert.match(escritura.url, /on_conflict=snapshot_id/);
  assert.doesNotMatch(escritura.url, /DELETE/i);

  const [fila] = JSON.parse(escritura.cuerpo);
  assert.equal(fila.snapshot_id, "draft");
  // `status` como columna es HTTP 400 42703: la tabla no la tiene.
  assert.equal("status" in fila, false,
    "plan_snapshots NO tiene columna status (medido contra el schema cache); mandarla es un 400 column not found");
  // El cuerpo del plan viaja en `payload` como OBJETO.
  assert.equal(typeof fila.payload, "object");
  assert.equal(Array.isArray(fila.payload), false);
  assert.equal(fila.payload.operations.length, 2);
  // Y el estado del borrador va DENTRO del payload, que es donde la pagina lo lee.
  assert.equal(fila.payload.status, "BORRADOR");
  // `created_at` con el instante del snapshot: recargar y volver a guardar no le cambia
  // la hora a un borrador que ya estaba.
  assert.match(String(fila.created_at), /2026-10-02/);
});

test("C2. lo que se escribe, el LECTOR REAL lo devuelve igual", async () => {
  // Esta es la prueba que importa: que la pagina pueda leer su propio borrador. Un UPSERT
  // con las columnas equivocadas se guarda sin error y se lee vacio.
  const { puente, memoria } = levantarConMemoria();
  await puente.saveDraftSnapshot(PLAN_DE_EJEMPLO);
  assert.equal(memoria.plan_snapshots.length, 1);

  const leida = await puente.getPlanSnapshot("draft");
  assert.ok(leida, "el lector no devolvio la instantanea");
  assert.equal(leida.snapshotId, "draft");
  assert.equal(leida.status, "BORRADOR");
  assert.equal(leida.planStart, "2026-09-28");
  assert.equal(leida.operations.length, 2, "las operaciones tienen que volver como arreglo, no como conteo");
  assert.equal(leida.operations[0].ot, "3478");
});

test("C3. guardar el borrador dos veces ACTUALIZA la fila, no crea otra", async () => {
  const { puente, memoria, peticiones } = levantarConMemoria();
  await puente.saveDraftSnapshot(PLAN_DE_EJEMPLO);
  await puente.saveDraftSnapshot(Object.assign({}, PLAN_DE_EJEMPLO, {
    planStart: "2026-10-05",
    operations: PLAN_DE_EJEMPLO.operations.concat([{ id: "op-3", ot: "3478", ct: "CORTE" }]),
  }));
  assert.equal(peticiones.filter((p) => p.metodo === "POST").length, 2, "cada guardado es una peticion");
  assert.equal(memoria.plan_snapshots.length, 1,
    "el borrador es UNA fila que se reemplaza: si creciera, 'el borrador' seria la ultima de N y las anteriores serian basura");
  const leida = await puente.getPlanSnapshot("draft");
  assert.equal(leida.planStart, "2026-10-05");
  assert.equal(leida.operations.length, 3);
});

test("C4. publicar deja el estado DENTRO del payload y la fecha en la fila", async () => {
  const { puente, memoria } = levantarConMemoria();
  const publicado = await puente.publishDraftPlan(Object.assign({}, PLAN_DE_EJEMPLO, {
    snapshotId: "pub-2026-10-02",
    generatedAt: "2026-10-02T15:00:00.000Z",
    publishedAt: "2026-10-02T15:00:00.000Z",
  }));
  assert.equal(publicado.ok, true);
  assert.equal(publicado.activeVersion.status, "PUBLICADO");

  const [fila] = memoria.plan_snapshots;
  assert.equal(fila.snapshot_id, "pub-2026-10-02");
  assert.equal(fila.payload.status, "PUBLICADO");
  // `published_at` SI existe en la fila (medido), y `planSnapshotFromRow` la usa de
  // respaldo cuando el payload no trae `publishedAt`.
  assert.match(String(fila.published_at), /2026-10-02/);
  assert.equal("status" in fila, false);

  const leida = await puente.getPlanSnapshot("pub-2026-10-02");
  assert.equal(leida.status, "PUBLICADO");
  assert.equal(leida.publishedAt, "2026-10-02T15:00:00.000Z");
});

test("C5. guardar la copia del plan la numera aparte del borrador", async () => {
  const { puente, memoria } = levantarConMemoria();
  // Sin `snapshotId` y sin `status`: una copia del plan NO es el borrador y no puede
  // reemplazar su fila. Sin `status` tampoco, para comprobar el default.
  const { snapshotId: _omitido, status: _estado, ...resto } = PLAN_DE_EJEMPLO;
  const copia = await puente.savePlanSnapshot(resto);
  assert.match(copia.snapshotId, /^snap-/);
  assert.notEqual(copia.snapshotId, "draft",
    "si la copia cayera sobre 'draft' reemplazaria el borrador: se perderia el plan en edicion");
  const leida = await puente.getPlanSnapshot(copia.snapshotId);
  assert.equal(leida.status, "RESPALDO", "una copia que no sea el borrador tiene su propio estado");
  // Y solo existe la copia: guardar una copia no crea ni pisa la fila del borrador.
  assert.deepEqual(memoria.plan_snapshots.map((f) => f.snapshot_id), [copia.snapshotId]);
});

test("C6. sin snapshot_id no sale NADA: es la unica NOT NULL sin default", async () => {
  // Se llama al ESCRITOR directo, que es donde vive la puerta: el reemplazo le pone un id
  // por su cuenta, y lo que se comprueba aqui es que el que decide es el escritor.
  const { escritor, peticiones } = levantarConMemoria();
  const informe = await escritor.guardarPlanSnapshot({ payload: PLAN_DE_EJEMPLO });
  assert.equal(peticiones.filter((p) => p.metodo === "POST").length, 0,
    "una instantanea sin clave no puede tener UPSERT: mandarla seria un 400 not_null_violation");
  assert.equal(informe.ok, false);
  assert.match(String(informe.motivo || ""), /snapshot_id/);
});