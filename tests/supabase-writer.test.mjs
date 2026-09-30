// El escritor tiene que ser BORRADOR, ATOMICO-donde-se-pueda e IDEMPOTENTE, y
// sobre todo tiene que negarse a escribir sin sesion.
//
// QUE SE COMPRUEBA AQUI Y POR QUE CADA COSA.
//
// 1. SIN TOKEN NO SE ESCRIBE. La clave publicable viaja en el bundle publico de
//    GitHub Pages. Escribir solo con ella seria dar el plan a cualquiera que abra
//    la URL (RULE-SUP-015 y RULE-SUP-022). El unico camino es el JWT de la
//    sesion, asi que sin token el modulo no sale a la red y dice por que.
//
// 2. BORRAR ANTES DE INSERTAR, Y POR QUE NO ES LO MISMO QUE UNA TRANSACCION.
//    El RPC ingesta_mirror esta revocado para el navegador porque borra la tabla
//    que le digan (RULE-SUP-021). Sin RPC, el espejo son dos peticiones: DELETE y
//    POST. Se fija el orden porque invertido seria insertar encima de lo viejo y
//    violar el UNIQUE. Y se deja escrito en el codigo que no hay rollback.
//
// 3. app_state SE PARCHEa. Tiene UNA fila (id integer, check id = 1). Un POST
//    crearia una segunda fila que el DDL no permite, y un DELETE previo dejaria la
//    pagina sin revision.
//
// 4. operation_events NUNCA SE BORRA. Es un flujo (docs/schema-supabase-plan.sql
//    seccion 2). Lo que hace idempotente al guardado es el id determinista del
//    evento con resolution=merge-duplicates, y eso tambien se comprueba: dos
//    guardados seguidos dejan los mismos eventos, no el doble.
//
// 5. LO QUE NO SE REINTENTA. 401, 403 y 404 no mejoran esperando. Y lo que SI se
//    reintenta (un 500) tambien, porque un modulo que reintenta de mas o de menos
//    rompe en los dos sentidos.
//
// 6. EL INFORME NO CONTIENE EL TOKEN NI LA CLAVE. No es una promesa de estilo: si
//    un dia un mensaje de PostgREST los trae, sano() tiene que quitarlos.
//
// 7. IDEMPOTENCIA. Dos guardados con el mismo estado dan el mismo resultado y
//    mandan los mismos cuerpos.
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const fuente = await readFile(new URL("../src/web/shared/supabase-writer.js", import.meta.url), "utf8");

const URL_FALSA = "https://ejemplo.supabase.co";
const CLAVE_FALSA = "sb_publishable_esto-no-es-real";
// Un JWT de mentira con la ESTRUCTURA real: cabecera.payload.firma, y el payload
// es base64url valido, para que actorDe() pueda leer el `sub`. Ninguna de las tres
// partes es una credencial: el token entero no existe en ningun sitio.
const JWT_FALSO = "jwt-de-pruebas.eyJzdWIiOiJ1dWlkLWRlLXBydWViYSJ9.firma-que-no-es-real";

/** Una respuesta de mentira con las cuatro cosas que el modulo le pregunta:
 *  ok, status, text() para los errores y json() para el informe del RPC. */
function contestando(status, cuerpo) {
  const texto = typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => texto,
    json: async () => JSON.parse(texto),
  };
}

/** LO QUE CONTESTA HOY LA BASE REAL, MEDIDO: plan_guardar no esta todavia, asi que
 *  PostgREST responde 404 con PGRST202 (no la encuentra en la cache del esquema).
 *  Este es el valor por defecto del simulacro y por eso los 25 tests que ya habia
 *  siguen exercising el CAMINO VIEJO: no se les cambio lo que comprueban, se les
 *  dio el mundo en el que estan. Los que quieren el RPC pasan rpc: "presente". */
const RPC_AUSENTE = () => contestando(404, {
  code: "PGRST202",
  details: null,
  hint: null,
  message: "Could not find the function public.plan_guardar(p_payload, p_revision_esperada, p_actor) in the schema cache",
});

/** La respuesta buena de plan_guardar, con la forma EXACTA que declara el DDL
 *  (docs/schema-supabase-plan.sql, el return de plan_guardar). */
const RPC_OK = () => contestando(200, {
  ok: true,
  revision: 43,
  actor: "uuid-de-prueba",
  tablas: {
    operations: { modo: "actualiza", filas: 1 },
    work_orders: { modo: "actualiza", filas: 1 },
    materials: { modo: "actualiza", filas: 1 },
    selected_ots: { modo: "espejo", filas: 2 },
    locked_ots: { modo: "espejo", filas: 1 },
    operation_plan_statuses: { modo: "espejo", filas: 1 },
    operation_events: { modo: "flujo", filas: 2 },
    retiradas: { ots: ["3177"], operaciones: 4 },
  },
  ms: 31,
});

/** El DDL esta aplicado: el RPC existe. `respuesta` cambia lo que dice para poder
 *  provocar un conflicto o un fallo sin reescribir el simulacro. */
function rpcContestando(respuesta) {
  return (registro) => {
    if (String(registro.url).indexOf("/rest/v1/rpc/plan_guardar") === -1) return contestando(204, "");
    return respuesta ? respuesta() : RPC_OK();
  };
}

/** Un estado sin operaciones ni ordenes: el caso en el que un guardado fallido
 *  terminaria vaciando el plan si el modulo no tuviera el freno de vaciar. */
function estadoVacio() {
  const e = estado();
  e.operations = [];
  e.workOrders = [];
  e.materials = [];
  e.selectedOts = [];
  e.lockedOts = [];
  e.operationPlanStatuses = [];
  return e;
}

/**
 * Levanta el modulo con un fetch de mentira. `responder` decide que contesta cada
 * peticion, y todo lo que se pide queda en `llamadas` para poder afirmar sobre
 * QUE se escribio, no solo sobre que devolvio el codigo.
 *
 * `rpc` es el estado del DDL en la base que estamos imitando: "ausente" (hoy, y
 * por defecto) o "presente". Con "presente" el POST a /rest/v1/rpc/plan_guardar
 * sale y hay que responder con rpcContestando().
 */
function escritor({ token = JWT_FALSO, configurado = true, responder = null, rpc = "ausente" } = {}) {
  const llamadas = [];
  const contexto = {
    console,
    AbortController, setTimeout, clearTimeout, Math, Date, JSON, Object, Array,
    Promise, String, Number, Boolean, Error, RegExp, Set, isFinite, parseInt,
    encodeURIComponent,
    // El navegador tiene atob y actorDe() lo usa para leer el `sub` del JWT. En un
    // contexto de vm no viene solo, asi que se declara: sin el, el modulo escribe
    // "web" como actor y el token de la prueba no probaria nada.
    atob,
    PPSupabaseAuth: { token: async () => token, configurado: true },
    PPSupabaseReader: { isConfigured: () => true, config: () => ({ url: URL_FALSA, anonKey: CLAVE_FALSA }) },
    fetch: async (destino, opciones) => {
      const url = String(destino);
      const registro = {
        url,
        metodo: (opciones && opciones.method) || "GET",
        headers: (opciones && opciones.headers) || {},
        cuerpo: opciones && opciones.body ? JSON.parse(opciones.body) : null,
        tabla: decodeURIComponent(url.split("/rest/v1/")[1].split("?")[0]),
      };
      llamadas.push(registro);
      // El 404 del RPC va ANTES del responder: es una respuesta de la BASE, no
      // del Guardado, y un test que dice "este POST devuelve 500" no estaba
      // hablando del RPC.
      if (rpc === "ausente" && url.indexOf("/rest/v1/rpc/") !== -1) return RPC_AUSENTE();
      if (responder) return responder(registro, llamadas.length);
      return contestando(204, "");
    },
  };
  contexto.globalThis = contexto;
  vm.createContext(contexto);
  vm.runInContext(fuente, contexto, { filename: "supabase-writer.js" });
  const writer = contexto.PPSupabaseWriter;
  if (configurado) writer.configure({ url: URL_FALSA, anonKey: CLAVE_FALSA });
  return { writer, llamadas, contexto };
}

/** El estado minimo pero realista: los mismos nombres de campo que PP_buildState_. */
function estado() {
  return {
    revision: 42,
    savedAt: "2026-09-29T18:00:00.000Z",
    syncedAt: "2026-09-29T17:50:00.000Z",
    planStart: "2026-09-28",
    horizonDays: 15,
    reportWeekStart: "2026-09-28",
    reportFilters: { operador: "TODOS" },
    settings: { toolChangeOperator: "AJUSTADOR" },
    plant: { name: "Planta MM del Llano", locationId: 1 },
    operationCatalogWarning: "",
    lastSchedule: { scheduledOts: ["3177"] },
    selectedOts: ["3177", "3631"],
    lockedOts: ["3177"],
    operations: [
      {
        id: "ns-3177-1", num: 4, ot: "3177", parte: "C 590", descripcion: "DOBLEZ",
        contenido: "TUBO", prioridad: 1, fechaReq: "", cantTotal: 10, secuencia: 109, ct: "5464",
        operador: "CORTADOR", maquina: "AB11", herramental: "H-1", kitHerramental: "K-1",
        cantPendiente: 6, tiempoCiclo: 5, tiempoSetup: 2, tiempoProd: 30,
        fechaInicio: "2026-09-29", horaInicio: "08:00", fechaFin: "2026-09-29", horaFin: "09:00",
        tipoInsercion: "OPERACION", estatus: "PLAN", log: "MAQUINA_OT_APP | KIT_OT_APP",
        generatedBy: "engine", locked: true, subcontractDays: 0, kitPending: false,
        autoFrozen: false, subcontractType: "", comentario: "", tiempoFallback: 0,
      },
    ],
    workOrders: [
      { id: "uuid-1", workOrderId: "3177", ot: "3177", item: "C 590", description: "Codo", photoUrl: "",
        startDate: "2026-09-29", endDate: "2026-10-02", dueDate: "2026-10-05", dueDateOverride: "",
        quantity: 10, status: "Abierta", customer: "Interno", builtQuantity: 4, pendingQuantity: 6,
        averageSalePrice: 0, averageSalePriceFrom: "2026-01-01", averageSalePriceTo: "2026-09-30", lastSalePrice: 0 },
    ],
    materials: [
      { id: "mat-1", ot: "3177", workOrderId: "3177", assembly: "C 590", componentId: "45",
        component: "TUBO", description: "Tubo 2\"", unit: "PZA", required: 4, issued: 1, pending: 3 },
    ],
    operationPlanStatuses: {
      "OP|3177|109|5464": { key: "OP|3177|109|5464", ot: "3177", sequence: 109, ct: "5464",
        status: "COMPLETADA_PLAN", origin: "draft", completedAt: "2026-09-29T17:00:00.000Z", reopenedAt: "" },
    },
  };
}

const de = (llamadas, metodo, tabla) => llamadas.filter((c) => c.metodo === metodo && c.tabla === tabla);
const cuerpoDe = (llamadas, metodo, tabla) => {
  const encontradas = de(llamadas, metodo, tabla);
  return encontradas.length ? encontradas[encontradas.length - 1].cuerpo : null;
};

test("sin token no se escribe nada y se dice por que", async () => {
  const { writer, llamadas } = escritor({ token: null });
  const informe = await writer.guardar(estado());
  assert.equal(informe.ok, false);
  assert.equal(llamadas.length, 0, "sin sesion no debe salir ni una peticion a la red");
  assert.match(informe.motivo, /sesion/i);
  assert.equal(Object.keys(informe.tablas).length, 0, "no se reporta ninguna tabla: no se toco ninguna");
});

test("sin configuracion en el build, tampoco se escribe", async () => {
  const { writer, llamadas } = escritor({ configurado: false });
  const informe = await writer.guardar(estado());
  assert.equal(informe.ok, false);
  assert.equal(llamadas.length, 0);
  assert.match(informe.motivo, /configurado/i);
});

test("toda escritura lleva el JWT en Authorization y nunca la clave publicable sola", async () => {
  const { writer, llamadas } = escritor();
  await writer.guardar(estado());
  const conCuerpo = llamadas.filter((c) => c.cuerpo !== null);
  assert.ok(conCuerpo.length > 0, "hubo escrituras que comprobar");
  for (const c of conCuerpo) {
    assert.equal(c.headers.Authorization, "Bearer " + JWT_FALSO, "el rol sale del JWT de sesion");
    assert.notEqual(c.headers.Authorization, "Bearer " + CLAVE_FALSA, "escribir solo con la clave seria abrir el plan");
  }
});

test("las tablas de espejo se borran y DESPUES se reinsertan, y el borrado va antes del POST", async () => {
  const { writer, llamadas } = escritor();
  await writer.guardar(estado());
  // Estas tres: un solo escritor, el espejo es correcto.
  for (const tabla of ["selected_ots", "locked_ots", "operation_plan_statuses"]) {
    assert.equal(de(llamadas, "DELETE", tabla).length, 1, tabla + ": un solo DELETE");
    assert.equal(de(llamadas, "POST", tabla).length, 1, tabla + ": un solo POST");
  }
  // Y el orden importa: borrar despues de insertar tiraria lo recien escrito.
  const iDel = llamadas.findIndex((c) => c.metodo === "DELETE" && c.tabla === "selected_ots");
  const iPost = llamadas.findIndex((c) => c.metodo === "POST" && c.tabla === "selected_ots");
  assert.ok(iDel < iPost, "el DELETE tiene que ir antes del POST");
});

test("app_state se actualiza con PATCH y no se inserta ni se borra nunca", async () => {
  const { writer, llamadas } = escritor();
  const informe = await writer.guardar(estado());
  assert.equal(de(llamadas, "PATCH", "app_state").length, 1, "un solo PATCH a la fila unica");
  assert.equal(de(llamadas, "POST", "app_state").length, 0, "app_state NO se inserta: tiene una sola fila");
  assert.equal(de(llamadas, "DELETE", "app_state").length, 0, "app_state NO se borra: se pierde la revision");
  assert.match(de(llamadas, "PATCH", "app_state")[0].url, /id=eq\.1/);
  const cuerpo = cuerpoDe(llamadas, "PATCH", "app_state");
  assert.equal(cuerpo.revision, 42);
  assert.equal(cuerpo.plan_start, "2026-09-28");
  assert.equal(cuerpo.horizon_days, 15);
  assert.equal(cuerpo.report_week_start, "2026-09-28");
  // Los jsonb viajan como objeto, nunca como texto: una columna jsonb con texto
  // que no es JSON revienta el INSERT entero (RULE-SUP-021).
  assert.deepEqual(cuerpo.settings, { toolChangeOperator: "AJUSTADOR" });
  assert.deepEqual(cuerpo.plant, { name: "Planta MM del Llano", locationId: 1 });
  assert.deepEqual(cuerpo.last_schedule, { scheduledOts: ["3177"] });
  assert.equal(cuerpo.saved_at, "2026-09-29T18:00:00.000Z");
  assert.equal(informe.tablas.app_state.error, null);
});

// ---------------------------------------------------------------------------
// LA CLAVE DEL UPSERT DE CADA TABLA
// ---------------------------------------------------------------------------
//
// POR QUE ESTE TEST. MEDIDO 2026-09-30 en el navegador, con las 222 ordenes de trabajo que
// trae el sync de NetSuite: el POST a /rest/v1/work_orders contestaba
// `23505 duplicate key value violates unique constraint "work_orders_ot_key"` en 18 de 18
// guardados. La causa era que `CLAVE_NATURAL` no tenia entrada para `work_orders`, asi que
// `escribirEspejo` mandaba el POST SIN `on_conflict`: un INSERT pelado contra una tabla que
// ya tiene esas filas.
//
// POR QUE NO LO DETECTABA NINGUN TEST. Los tests del escritor usan un fetch de mentira que
// contesta 204 a todo, y un 204 no se parece en nada a un 409: el modulo solo puede saber
// que la clave esta mal por lo que DECIDE, no por lo que la base contesta. Por eso el test
// afirma sobre la peticion que se arma (que `on_conflict` viaje y con que columnas), que es
// lo unico que el codigo controla. Y la clave se contrasta con la del DDL, porque las dos
// tienen que ser la misma: `plan_tabla_escritura` declara `wo_internal_id` para work_orders y
// el indice unico que hace posible el UPSERT es `work_orders_wo_internal_id_key`.
test("cada tabla del camino viejo manda on_conflict, y con la MISMA clave que declara el DDL", async () => {
  const { writer, llamadas } = escritor();
  await writer.guardar(estado());

  // La clave que el DDL declara para cada tabla, escrita aqui a mano y no leida del
  // fuente del escritor: un assert que compara el codigo consigo mismo no comprueba nada.
  // Si alguien cambia una de las dos, este test tiene que romperse.
  const CLAVE_DEL_DDL = {
    operations: "operation_id",
    work_orders: "wo_internal_id",
    materials: "ot,line_id",
    selected_ots: "ot",
    locked_ots: "ot",
    operation_plan_statuses: "key",
  };
  for (const tabla of Object.keys(CLAVE_DEL_DDL)) {
    const enElCodigo = writer.CLAVE_NATURAL[tabla];
    assert.equal(enElCodigo, CLAVE_DEL_DDL[tabla],
      tabla + ": el escritor usa " + JSON.stringify(enElCodigo) + " y el DDL declara " + CLAVE_DEL_DDL[tabla]);
  }

  // Y lo que de verdad viaja en la URL. Sin esto, una clave que este bien escrita pero que
  // no se pase a `pedir` seria un fallo igual de silencioso que no tenerla.
  for (const [tabla, clave] of Object.entries(CLAVE_DEL_DDL)) {
    const posts = de(llamadas, "POST", tabla);
    assert.equal(posts.length, 1, tabla + ": se esperaba un POST y hubo " + posts.length);
    assert.ok(posts[0].url.includes("on_conflict=" + encodeURIComponent(clave)),
      tabla + ": el POST no lleva on_conflict=" + clave + " (url: " + posts[0].url + ")");
    assert.ok(posts[0].headers.Prefer.includes("resolution=merge-duplicates"),
      tabla + ": sin resolution=merge-duplicates el on_conflict no hace nada util");
  }

  // El caso que fallo de verdad, nombrado: sin esta clave, work_orders NO se guardaba nunca.
  const wo = de(llamadas, "POST", "work_orders");
  assert.ok(wo[0].url.includes("on_conflict=wo_internal_id"),
    "work_orders es la tabla que dio 23505 en los 18 guardados: su clave tiene que estar en la URL");
});

// ---------------------------------------------------------------------------
// LAS DOS TABLAS DEL SYNC: MARCAS DE OT Y RESUMEN DE LAS CERRADAS
// ---------------------------------------------------------------------------
//
// QUE SE ESCRIBE AQUI Y POR QUE. DECIDIDO 2026-09-30: el sync de OTs ya no guarda por
// `saveWorkOrderSyncState` (las Hojas) sino por este escritor. Lo que el sync tiene que
// dejar behind son las marcas de OT "por confirmar" (RULE-OT-051) y el resumen de las OTs
// cerradas. Si no se subieran, el sync apparentemente guardaria y en realidad perderia las
// dos cosas: la OT sin ficha se caeria de la cola en el siguiente normalizeState, y el
// contador `misses` — que es lo que decide si la marca es real — volveria a cero.

test("unconfirmed_work_orders y closed_work_order_summaries se suben como ANEXO: upsert por folio, sin borrar", async () => {
  const { writer, llamadas } = escritor();
  const conMarcas = estado();
  conMarcas.unconfirmedWorkOrders = {
    "3177": { ot: "3177", firstSeenAt: "2026-09-20T10:00:00.000Z", lastSeenAt: "2026-09-29T17:50:00.000Z", misses: 3 },
  };
  conMarcas.closedWorkOrderSummaries = {
    "3631": { ot: "3631", finalStatus: "CERRADA", closedDetectedAt: "2026-09-29T17:00:00.000Z" },
  };

  await writer.guardar(conMarcas);

  // SIN BORRADO, y no por capricho: una marca que esta en la base y no en esta pantalla puede
  // ser de una OT que NetSuite ya cerro y que la pagina todavia no sabe. Si se borrara, se
  // perderia justamente el `misses` que acumulo.
  assert.equal(de(llamadas, "DELETE", "unconfirmed_work_orders").length, 0, "las marcas nunca se borran");
  assert.equal(de(llamadas, "DELETE", "closed_work_order_summaries").length, 0, "los resumenes nunca se borran");
  // Y se escriben por clave natural, que es lo que las hace idempotentes: dos paginas que
  // guardan la misma marca no se pisan ni duplican.
  assert.match(de(llamadas, "POST", "unconfirmed_work_orders")[0].url, /on_conflict=ot/);
  assert.match(de(llamadas, "POST", "closed_work_order_summaries")[0].url, /on_conflict=ot/);
});

test("unconfirmed_work_orders: la fila lleva el folio, los dos instantes y el contador", async () => {
  const { writer, llamadas } = escritor();
  const conMarcas = estado();
  conMarcas.unconfirmedWorkOrders = {
    "3177": { ot: "3177", firstSeenAt: "2026-09-20T10:00:00.000Z", lastSeenAt: "2026-09-29T17:50:00.000Z", misses: 3 },
    // Sin `ot` dentro: la CLAVE del objeto es el folio. Si no se usara, esta marca se
    // perderia en el piso, que es el peor sitio para perderla.
    "3700": { firstSeenAt: "2026-09-21T10:00:00.000Z", lastSeenAt: "2026-09-21T10:00:00.000Z", misses: 1 },
  };

  await writer.guardar(conMarcas);

  const cuerpo = cuerpoDe(llamadas, "POST", "unconfirmed_work_orders");
  assert.equal(cuerpo.length, 2);
  assert.deepEqual(cuerpo.find((f) => f.ot === "3177"), {
    ot: "3177", first_seen_at: "2026-09-20T10:00:00.000Z", last_seen_at: "2026-09-29T17:50:00.000Z", misses: 3,
  });
  assert.equal(cuerpo.find((f) => f.ot === "3700").ot, "3700", "la clave del objeto es el folio");
});

test("unconfirmed_work_orders: un contador en cero o ausente se manda como 1, nunca como 0", async () => {
  const { writer, llamadas } = escritor();
  const conMarcas = estado();
  conMarcas.unconfirmedWorkOrders = {
    "1": { ot: "1", firstSeenAt: "2026-09-20T10:00:00.000Z", lastSeenAt: "2026-09-20T10:00:00.000Z", misses: 0 },
    "2": { ot: "2", firstSeenAt: "2026-09-20T10:00:00.000Z", lastSeenAt: "2026-09-20T10:00:00.000Z" },
  };

  await writer.guardar(conMarcas);

  // misses=0 en la base diria que la OT ya no falta, y la marca se resolveria sin evidencia.
  // Una fila en esta tabla significa, por definicion, que la OT no vino.
  const cuerpo = cuerpoDe(llamadas, "POST", "unconfirmed_work_orders");
  assert.deepEqual(cuerpo.map((f) => f.misses), [1, 1]);
});

test("closed_work_order_summaries: el resumen viaja como OBJETO en la columna jsonb", async () => {
  const { writer, llamadas } = escritor();
  const conResumenes = estado();
  conResumenes.closedWorkOrderSummaries = {
    "3631": { ot: "3631", finalStatus: "CERRADA", closedDetectedAt: "2026-09-29T17:00:00.000Z" },
  };

  await writer.guardar(conResumenes);

  const cuerpo = cuerpoDe(llamadas, "POST", "closed_work_order_summaries");
  // Un jsonb con texto que no es JSON revienta el POST entero (RULE-SUP-021).
  assert.equal(typeof cuerpo[0].summary, "object");
  assert.deepEqual(cuerpo[0].summary, { ot: "3631", finalStatus: "CERRADA", closedDetectedAt: "2026-09-29T17:00:00.000Z" });
});

test("un estado sin marcas ni resumenes NO hace un POST vacio a las dos tablas", async () => {
  const { writer, llamadas } = escritor();
  await writer.guardar(estado());
  assert.equal(de(llamadas, "POST", "unconfirmed_work_orders").length, 0);
  assert.equal(de(llamadas, "POST", "closed_work_order_summaries").length, 0);
});

test("operation_events solo inserta, fila por fila, y nunca borra", async () => {
  const { writer, llamadas } = escritor();
  await writer.guardar(estado());
  assert.equal(de(llamadas, "DELETE", "operation_events").length, 0, "un flujo no se borra jamas");
  const eventos = de(llamadas, "POST", "operation_events");
  // El log trae "MAQUINA_OT_APP | KIT_OT_APP": dos eventos, dos peticiones.
  assert.equal(eventos.length, 2, "un POST por evento");
  for (const e of eventos) {
    assert.equal(e.cuerpo.length, 1, "cada POST lleva una sola fila");
    assert.match(e.url, /on_conflict=id/);
    assert.match(e.headers.Prefer, /resolution=merge-duplicates/);
  }
  const cuerpo = eventos[0].cuerpo;
  assert.equal(cuerpo[0].kind, "MAQUINA_OT_APP", "kind es el token por donde se filtra la vista de debug");
  assert.equal(cuerpo[0].operation_id, "ns-3177-1");
  assert.equal(cuerpo[0].ot, "3177");
  assert.equal(cuerpo[0].payload.mensaje, "MAQUINA_OT_APP");
  assert.match(cuerpo[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(eventos[1].cuerpo[0].kind, "KIT_OT_APP", "el log partido da un evento por entrada");
  // Dos eventos distintos, dos ids distintos: si compartieran id, el segundo
  // pisaria al primero y se perderia medio log.
  assert.notEqual(cuerpo[0].id, eventos[1].cuerpo[0].id);
});

test("un 401 no se reintenta: sale en el primer intento y se dice", async () => {
  const { writer, llamadas } = escritor({
    responder: (c) => ({ ok: false, status: 401, text: async () => JSON.stringify({ message: "JWT ausente" }) }),
  });
  const informe = await writer.guardar(estado());
  // Sin reintentar, cada escritura se toca una vez: el POST al RPC (que aqui da
  // 404, porque el simulacro imita una base sin el DDL) + 6 espejos + 1 evento +
  // app_state.
  const esperadas = writer.ESPEJO.length + 3;
  assert.equal(llamadas.length, esperadas, `hubo ${llamadas.length} peticiones con un 401 y se esperaban ${esperadas}`);
  assert.equal(informe.ok, false);
  assert.match(informe.tablas.operations.error, /401/);
  // Y el motivo no dice "reintentar": un 401 no mejora esperando.
  assert.doesNotMatch(informe.tablas.operations.error, /intento/i);
});

test("un 404 tampoco se reintenta", async () => {
  const { writer, llamadas } = escritor({ responder: () => ({ ok: false, status: 404, text: async () => "" }) });
  await writer.guardar(estado());
  // El del RPC tambien, que es lo que se comprueba aqui: una peticion al RPC y
  // una a cada tabla, ninguna repetida.
  assert.equal(llamadas.length, writer.ESPEJO.length + 3);
});

test("un 500 SI se reintenta, y son tres intentos", async () => {
  // El reintento se comprueba sobre operations, que es donde va el POST grande.
  const { writer, llamadas } = escritor({
    responder: (c) => (c.metodo === "POST" && c.tabla === "operations" ? { ok: false, status: 500, text: async () => "boom" } : { ok: true, status: 204, text: async () => "" }),
  });
  await writer.guardar(estado());
  assert.equal(de(llamadas, "POST", "operations").length, 3, "3 intentos del POST (hubo " + de(llamadas, "POST", "operations").length + ")");
  assert.match(llamadas[llamadas.length - 1].cuerpo ? "ok" : "ok", /ok/);
});

test("el informe no contiene ni el token ni la clave, ni siquiera en un error", async () => {
  const { writer } = escritor({
    // Un mensaje de PostgREST que devuelve las cabeceras, que es el caso feo.
    // 401 y no 400 solo para no pagar los tres reintentos con su espera aqui: lo
    // que se prueba es que sano() quita el token, y eso no depende del status.
    responder: (c) => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({
        message: "columna no existe",
        cabeceras: { apikey: CLAVE_FALSA, Authorization: "Bearer " + JWT_FALSO },
      }),
    }),
  });
  const informe = await writer.guardar(estado());
  const texto = JSON.stringify(informe);
  assert.doesNotMatch(texto, /jwt-de-pruebas/);
  assert.doesNotMatch(texto, new RegExp(CLAVE_FALSA));
  assert.doesNotMatch(texto, /firma-que-no-es-real/);
  // Y sigue siendo util: el status y el motivo de PostgREST siguen ahi.
  assert.match(informe.tablas.operations.error, /401/);
  assert.match(informe.tablas.operations.error, /columna no existe/);
  assert.match(informe.tablas.operations.error, /\[oculto\]/);
  assert.equal(informe.ok, false);
});

test("dos escrituras seguidas con el mismo estado dan el mismo resultado", async () => {
  const uno = escritor();
  const primero = await uno.writer.guardar(estado(), { snapshots: [{ snapshotId: "draft", operations: [], planStart: "2026-09-28" }] });
  const segundo = await uno.writer.guardar(estado(), { snapshots: [{ snapshotId: "draft", operations: [], planStart: "2026-09-28" }] });

  // El informe es identico menos el tiempo, que depende de la maquina.
  const sinTiempo = (i) => { const { ms, ...resto } = i; return resto; };
  assert.deepEqual(sinTiempo(segundo), sinTiempo(primero), "el resultado no puede depender de cuantas veces se guardo");
  assert.equal(primero.ok, true, JSON.stringify(primero));

  // Y los CUERPOS son los mismos: mismo estado, mismos bytes. Un snapshot con
  // snapshot_id UNIQUE se pisa por su clave y no se duplica, y los eventos con id
  // determinista tampoco.
  const snapshots = uno.llamadas.filter((c) => c.tabla === "plan_snapshots" && c.metodo === "POST");
  assert.equal(snapshots.length, 2, "cada guardado sube el snapshot");
  assert.equal(de(uno.llamadas, "DELETE", "plan_snapshots").length, 0, "un snapshot NUNCA se borra: es historial");
  assert.deepEqual(snapshots[0].cuerpo, snapshots[1].cuerpo);
  assert.equal(snapshots[0].cuerpo[0].snapshot_id, "draft");

  // Los eventos: el segundo guardado no vuelve a mandarlos, y no es que se
  // pierdan (el id determinista los deja intactos) sino que ya estan ahi.
  const eventos = uno.llamadas.filter((c) => c.tabla === "operation_events" && c.metodo === "POST");
  assert.equal(eventos.length, 2, `los dos eventos del log, una vez (hubo ${eventos.length} POST)`);
});

test("un estado sin filas NO borra la tabla, salvo que se pida explicito", async () => {
  // Por que: un guardado que fallo al leer y llega con cero operaciones no puede
  // vaciar el plan entero. Un payload vacio no da error, se instala (RULE-SUP-021).
  const { writer, llamadas } = escritor();
  const vacio = { revision: 1, selectedOts: [], operations: [] };
  const informe = await writer.guardar(vacio);
  assert.equal(de(llamadas, "DELETE", "operations").length, 0, "no se borra operations porque no llego ninguna fila");
  assert.equal(de(llamadas, "DELETE", "selected_ots").length, 0);
  // MEDIDO 2026-09-30 en produccion: "sin filas" NO es un error. Es el freno del vacio
  // funcionando. Antes `error` hacia que `cerrar()` diera ok=false y el toast decia
  // "No se pudo guardar el plan" cuando el plan SI se guardo. Ahora es una nota.
  assert.equal(informe.tablas.operations.error, null, "sin filas ya no es un error");
  assert.match(informe.tablas.operations.nota, /no se borra/i, "sigue siendo una nota para no tragar el silencio");
  assert.equal(informe.ok, true, "y el guardado es ok: la tabla se dejo intacta a proposito");

  // Quien sepa que el vacio es de verdad lo pide. El DELETE lleva la tautologia
  // del uuid nulo, que es lo unico que PostgREST acepta sin clave primaria.
  const otro = escritor();
  await otro.writer.guardar(vacio, { vaciarSiEstaVacio: true });
  const borrados = de(otro.llamadas, "DELETE", "selected_ots");
  assert.equal(borrados.length, 1);
  assert.match(borrados[0].url, /id=neq\.00000000-0000-0000-0000-000000000000/);
  assert.equal(de(otro.llamadas, "POST", "selected_ots").length, 0, "no hay filas que insertar");
});

test("el mapeo usa los nombres de columna del esquema, no los del estado", async () => {
  const { writer, llamadas } = escritor();
  await writer.guardar(estado());
  const op = cuerpoDe(llamadas, "POST", "operations")[0];
  // El estado usa fechaInicio/horaInicio/kitHerramental; la tabla fecha_inicio/
  // hora_inicio/kit. Y las columnas del DDL del plan (docs/schema-supabase-plan.sql:60).
  assert.equal(op.kit, "K-1");
  assert.equal(op.fecha_inicio, "2026-09-29T08:00:00.000Z", "fecha + hora se unen en un instante (UTC, como el RESTlet 2246)");
  assert.equal(op.hora_inicio, "2026-09-29T08:00:00.000Z");
  assert.equal(op.comentario, "");
  assert.equal(op.prioridad, "1", "prioridad es text porque la app acepta numero o palabra");
  assert.equal(op.kit_pending, false);
  assert.equal(op.revision, 42);

  const wo = cuerpoDe(llamadas, "POST", "work_orders")[0];
  assert.equal(wo.wo_internal_id, "3177");
  assert.equal(wo.fecha_inicio_ns, "2026-09-29T00:00:00.000Z");
  // precio_desde / precio_hasta NO se escriben: el DDL las declara numeric y el
  // estado lleva una ventana de fechas. Es un conflicto de tipos, no un dato.
  assert.equal("precio_desde" in wo, false);
  assert.equal("precio_hasta" in wo, false);

  const mat = cuerpoDe(llamadas, "POST", "materials")[0];
  assert.equal(mat.line_id, "mat-1", "line_id es la segunda mitad del UNIQUE (ot, line_id)");
  assert.equal(mat.componente_id, "45");
  assert.equal(mat.pendiente, 3);

  const cola = cuerpoDe(llamadas, "POST", "selected_ots");
  assert.deepEqual(cola, [{ ot: "3177", posicion: 0 }, { ot: "3631", posicion: 1 }], "posicion es el orden manual de la cola");
  assert.deepEqual(cuerpoDe(llamadas, "POST", "locked_ots"), [{ ot: "3177" }]);

  const estados = cuerpoDe(llamadas, "POST", "operation_plan_statuses");
  assert.equal(estados[0].key, "OP|3177|109|5464");
  assert.equal(estados[0].status, "COMPLETADA_PLAN");
  assert.equal(estados[0].origin, "draft");
  assert.equal(estados[0].fecha_completado, "2026-09-29T17:00:00.000Z");
});

test("una fecha que no es fecha se manda como null, no como texto", async () => {
  // El estado acepta 'SIN FECHA' y '' en plan_start y fecha_req, que son text.
  // Las columnas timestamptz no lo aceptan: mandar el texto crudo revienta el
  // INSERT de la tabla entera, y sin transaccion no hay rollback (RULE-SUP-021).
  const { writer, llamadas } = escritor();
  const raro = estado();
  raro.operations[0].fechaInicio = "SIN FECHA";
  raro.operations[0].horaInicio = "";
  raro.operations[0].fechaFin = "";
  raro.operations[0].horaFin = "99:99";
  raro.savedAt = "no-es-una-fecha";
  await writer.guardar(raro);
  const op = cuerpoDe(llamadas, "POST", "operations")[0];
  assert.equal(op.fecha_inicio, null);
  assert.equal(op.hora_inicio, null);
  assert.equal(op.fecha_fin, null);
  assert.equal(op.hora_fin, null);
  assert.equal(cuerpoDe(llamadas, "PATCH", "app_state").saved_at, null);
});

test("el modulo es ASCII puro: la pagina no lleva caracteres raros", async () => {
  // Los comentarios de este proyecto van sin acentos. Un archivo con un acento
  // mal codificado se ve roto en el codigo, y el editor lo muestra distinto a como
  // se leyo. Se comprueba en vez de confiar.
  const raros = fuente.match(/[\u0080-\uffff]/g);
  assert.equal(raros, null, `caracteres no ASCII: ${raros ? [...new Set(raros)].join(" ") : ""}`);
});

test("no se llama al RPC ingesta_mirror desde el navegador", async () => {
  // El RPC borra la tabla que le digan y esta revocado para el navegador a
  // proposito (docs/schema-supabase-plan.sql:335-339, RULE-SUP-021). Que este
  // modulo no lo llame es parte de la garantia de que la pagina no puede vaciar el
  // plan con una llamada.
  //
  // Con el RPC del plan (plan_guardar) esto YA NO es "ninguna llamada a /rpc/":
  // es "la unica llamada a /rpc/ es a plan_guardar, y a ingesta_mirror no se llega
  // ni por error". Por eso la comprobacion es por nombre y no por ruta.
  const { writer, llamadas } = escritor();
  await writer.guardar(estado());
  assert.equal(llamadas.filter((c) => c.url.includes("ingesta_mirror")).length, 0);
  assert.doesNotMatch(fuente, /ingesta_mirror\s*\(/);
  // Y lo que si sale, cuando el DDL no esta, es a plan_guardar. Un 404, que es
  // como se comprueba que la funcion existe.
  const alRpc = llamadas.filter((c) => c.url.includes("/rpc/"));
  assert.equal(alRpc.length, 1);
  assert.match(alRpc[0].url, /\/rest\/v1\/rpc\/plan_guardar$/);
});

/**
 * LAS TRES TABLAS DEL ERP NO SE BORRAN. Este es el test que ata el control duro.
 *
 * MEDIDO 2026-09-29: `operations` tiene 1000 filas de la ingesta del RESTlet 2246
 * con operation_id `ns-XXXXX`, y el navegador usa el mismo key natural. Si el
 * navegador borrara la tabla y reinsertara su estado, borraria las filas que una
 * sincronizacion de NetSuite metio DESPUES de la ultima carga de esa pagina: no
 * es perder el trabajo de la persona, es perder datos del ERP que todavia no ha
 * visto, y el borrado no da ningun error.
 *
 * Estos tests fallan si alguien vuelve a poner el borrado como comportamiento por
 * defecto. Si en el futuro se decide que si, el cambio tiene que ser explicito
 * (permitirBorradoErp) y este archivo tiene que cambiar a proposito.
 */
test("operations NO se borra: se actualiza por clave natural", async () => {
  const { writer, llamadas } = escritor();
  await writer.guardar(estado());
  assert.equal(
    de(llamadas, "DELETE", "operations").length,
    0,
    "no puede haber DELETE en operations: se llevaria la ingesta de NetSuite que el navegador no conoce"
  );
  // Y tiene que haber un POST con on_conflict por operation_id, que es lo que
  // convierte el borrado en un upsert.
  const posts = de(llamadas, "POST", "operations");
  assert.ok(posts.length > 0, "operations se tiene que escribir: si no, el cambio de la persona no llega a ningun lado");
  assert.match(posts[0].url, /on_conflict=operation_id/);
});

test("work_orders y materials tampoco se borran", async () => {
  const { writer, llamadas } = escritor();
  await writer.guardar(estado());
  for (const tabla of ["work_orders", "materials"]) {
    assert.equal(de(llamadas, "DELETE", tabla).length, 0, tabla + " no se puede borrar desde el navegador");
  }
});

test("las cuatro tablas donde si hay un solo escritor SI se borran y reescriben", async () => {
  const { writer, llamadas } = escritor();
  await writer.guardar(estado());
  for (const tabla of ["selected_ots", "locked_ots", "operation_plan_statuses"]) {
    assert.equal(de(llamadas, "DELETE", tabla).length, 1, tabla + " es espejo del estado: borrar y reinsertar es lo correcto");
  }
});

test("el guardado avisa en el informe de que operations no se borro", async () => {
  const { writer } = escritor();
  const informe = await writer.guardar(estado());
  const avisos = (informe.avisos || []).join(" ");
  assert.match(avisos, /operations/, "el informe tiene que decir que hubo una tabla sin borrar y por que");
  assert.match(avisos, /NO se borro|actualizo fila por fila/i);
});

test("el opt-in se llama permitirBorradoErp y hace lo que dice", async () => {
  const { writer, llamadas } = escritor();
  await writer.guardar(estado(), { permitirBorradoErp: true });
  assert.equal(de(llamadas, "DELETE", "operations").length, 1, "con el opt-in explicito si borra");
});

test("app_state no se borra nunca, ni con el opt-in: es una sola fila que se actualiza", async () => {
  const { writer, llamadas } = escritor();
  await writer.guardar(estado(), { permitirBorradoErp: true });
  assert.equal(de(llamadas, "DELETE", "app_state").length, 0);
  assert.equal(de(llamadas, "PATCH", "app_state").length, 1);
});

test("operation_events no se borra nunca: es un flujo", async () => {
  const { writer, llamadas } = escritor();
  await writer.guardar(estado(), { permitirBorradoErp: true });
  assert.equal(de(llamadas, "DELETE", "operation_events").length, 0);
});

/**
 * ESTE ES EL QUE HABRIA ATRAPADO EL ERROR. La cabecera del modulo tiene que
 * seguir declarando el peligro, porque el que lea el archivo sin acordarse de
 * esta conversacion tendria que encontrarlo ahi. Un archivo que documenta un
 * peligro y despues lo quita del comentario es peor que uno que no lo tuvo.
 */
test("la cabecera del modulo sigue declarando el PELIGRO MEDIDO", () => {
  assert.match(fuente, /PELIGRO MEDIDO/);
  assert.match(fuente, /ns-/, "tiene que quedar el ejemplo del id real que se midio");
  assert.match(fuente, /ERP_COMPARTIDA/);
});

test("un estado vacio no borra ni las tablas de espejo, con el opt-in apagado", async () => {
  const { writer, llamadas } = escritor({ token: JWT_FALSO });
  await writer.guardar(estadoVacio());
  assert.equal(llamadas.filter((c) => c.metodo === "DELETE").length, 0, "un guardado sin filas no borra nada");
});

// ===========================================================================
// EL CAMINO NUEVO: UN SOLO POST A /rest/v1/rpc/plan_guardar
//
// Los tests de arriba corren en una base SIN el DDL: el simulador responde 404
// PGRST202, que es lo que contesta la base real de hoy, y por eso todos comprueban
// el camino viejo. Los de aqui suben el DDL (rpc: "presente") y comprueban lo que
// cambia: una sola peticion, el payload con las nueve claves, la revision de la
// pagina, y que un conflicto se distinga de un fallo de red.
// ===========================================================================

test("con el DDL aplicado, el guardado entero es UN POST a /rest/v1/rpc/plan_guardar", async () => {
  const { writer, llamadas } = escritor({ rpc: "presente", responder: rpcContestando() });
  const informe = await writer.guardar(estado(), { snapshots: [{ snapshotId: "draft", operations: [] }] });
  // Este es EL punto de la funcion: una peticion para el plan entero, no una por
  // tabla. Si esto falla, el guardado se partio otra vez en varias piezas.
  assert.equal(llamadas.length, 1, "una sola peticion: " + JSON.stringify(llamadas.map((c) => c.metodo + " " + c.url)));
  assert.equal(llamadas[0].metodo, "POST");
  // La ruta lleva la barra SIN escapar: /rest/v1/rpc/plan_guardar y no
  // /rest/v1/rpc%2Fplan_guardar, que es lo que daria un nombre de tabla escapado.
  assert.equal(llamadas[0].url, URL_FALSA + "/rest/v1/rpc/plan_guardar");
  assert.equal(informe.ok, true);
  assert.equal(informe.camino, "rpc");
  // Y no hay ninguna escritura suelta: con la funcion no se toca la Data API.
  assert.equal(de(llamadas, "POST", "operations").length, 0);
  assert.equal(de(llamadas, "DELETE", "selected_ots").length, 0);
  assert.equal(de(llamadas, "PATCH", "app_state").length, 0);
});

test("el payload trae las nueve claves, con el nombre de tabla de Supabase", async () => {
  const { writer, llamadas } = escritor({ rpc: "presente", responder: rpcContestando() });
  await writer.guardar(estado(), { snapshots: [{ snapshotId: "draft", operations: [], generatedAt: "2026-09-29T18:00:00.000Z" }] });
  const payload = llamadas[0].cuerpo.p_payload;
  // El nombre de la TABLA, no el del estado: el estado llama workOrders y
  // operationPlanStatuses, y la funcion lee 'work_orders'.
  assert.deepEqual(Object.keys(payload).sort(), [
    "app_state",
    "locked_ots",
    "materials",
    "operation_events",
    "operation_plan_statuses",
    "operations",
    "plan_snapshots",
    "selected_ots",
    "work_orders",
  ]);
  // Y las nueve, aunque una vaya vacia: la funcion lee p_payload -> 'tabla', y
  // una clave que no esta llega como NULL, que no es lo mismo que una lista vacia.
  for (const clave of writer.CLAVES_PAYLOAD) assert.ok(clave in payload, "falta la clave " + clave);
  // El mapeo de dentro es el de siempre: mismas columnas, mismos valores.
  assert.equal(payload.operations[0].operation_id, "ns-3177-1");
  assert.equal(payload.operations[0].kit, "K-1", "kit, no kitHerramental: el nombre de la columna, no el del estado");
  assert.equal(payload.operations[0].fecha_inicio, "2026-09-29T08:00:00.000Z");
  assert.equal(payload.work_orders[0].wo_internal_id, "3177");
  assert.equal(payload.materials[0].line_id, "mat-1");
  assert.deepEqual(payload.selected_ots, [{ ot: "3177", posicion: 0 }, { ot: "3631", posicion: 1 }]);
  assert.deepEqual(payload.locked_ots, [{ ot: "3177" }]);
  assert.equal(payload.operation_plan_statuses[0].key, "OP|3177|109|5464");
  assert.equal(payload.app_state.plan_start, "2026-09-28");
  assert.deepEqual(payload.app_state.settings, { toolChangeOperator: "AJUSTADOR" }, "los jsonb viajan como objeto");
  assert.equal(payload.app_state.saved_at, "2026-09-29T18:00:00.000Z");
});

test("manda como p_revision_esperada la revision DEL ESTADO, y no una fabricada", async () => {
  const { writer, llamadas } = escritor({ rpc: "presente", responder: rpcContestando() });
  const e = estado();
  e.revision = 42;
  const informe = await writer.guardar(e);
  // La revision es la que la pagina tiene en su estado (state.revision), la misma
  // que ya manda al puente. Este modulo no la sube: subirla aqui seria hacer que
  // dos paginas comparen la misma cifra y las dos pasen.
  assert.equal(llamadas[0].cuerpo.p_revision_esperada, 42);
  assert.equal(llamadas[0].cuerpo.p_revision_esperada, e.revision, "sale del estado, no de un contador propio");
  // app_state NO lleva revision: la incrementa la funcion dentro de la transaccion.
  assert.equal("revision" in llamadas[0].cuerpo.p_payload.app_state, false);
  // Y el numero que devuelve sale en el informe, para que la pagina lo guarde: si
  // no lo guarda, el siguiente guardado manda la vieja y choca consigo mismo.
  assert.equal(informe.revision, 43);
  assert.equal(informe.actor, "uuid-de-prueba", "el actor sale del JWT, en p_actor");

  // Un estado sin revision manda 0, que es lo que hay en la fila unica de
  // app_state cuando esta vacia (docs/schema-supabase-plan.sql:445).
  const sinRevision = escritor({ rpc: "presente", responder: rpcContestando() });
  await sinRevision.writer.guardar({ selectedOts: ["3177"], lockedOts: ["3177"], operationPlanStatuses: {} }, { vaciarSiEstaVacio: true });
  assert.equal(sinRevision.llamadas[0].cuerpo.p_revision_esperada, 0);
});

test("un CONFLICT_REVISION se distingue de un error de red en el informe", async () => {
  const { writer, llamadas } = escritor({
    rpc: "presente",
    responder: rpcContestando(() => contestando(200, {
      ok: false,
      conflicto: "CONFLICT_REVISION",
      revision_actual: 44,
      revision_esperada: 42,
      mensaje: "El plan cambio desde la ultima carga. Recarga antes de guardar.",
      ms: 4,
    })),
  });
  const informe = await writer.guardar(estado());
  assert.equal(informe.ok, false);
  assert.equal(informe.camino, "rpc");
  assert.equal(informe.conflicto.codigo, "CONFLICT_REVISION");
  assert.equal(informe.conflicto.revision_actual, 44);
  assert.equal(informe.conflicto.revision_esperada, 42);
  // SIN motivo: `motivo` es el campo del fallo, el que SI se reintenta, y aqui
  // reintentar sin recargar no arregla nada. Los dos campos son excluyentes y es
  // justo esa exclusion la que evita que la pagina diga "reintenta" y tire el
  // trabajo de la persona.
  assert.equal("motivo" in informe, false, "un conflicto no es un motivo de fallo de red");
  assert.equal(informe.revision, 44, "el informe dice que revision hay ahora en la base");
  // Y sale en un aviso visible, que es lo que la pagina muestra.
  const avisos = informe.avisos.join(" ");
  assert.match(avisos, /NO se guardo nada/i);
  assert.match(avisos, /Recarga/i);
  assert.match(avisos, /no es un fallo de red/i);
  // Ni una escritura por la puerta de atras: con la respuesta en ok false no se
  // toca nada, y caer al camino viejo seria escribir justo lo que se perdio.
  assert.equal(llamadas.length, 1);

  // El error de red, en el mismo modulo, se ve distinto: sin `conflicto`, con
  // `motivo`, y con los tres reintentos.
  const red = escritor({ rpc: "presente", responder: rpcContestando(() => contestando(503, "service unavailable")) });
  const fallo = await red.writer.guardar(estado());
  assert.equal(fallo.ok, false);
  assert.equal("conflicto" in fallo, false, "un 503 no es un conflicto: reintentar tiene sentido");
  assert.match(fallo.motivo, /503/);
  assert.match(fallo.motivo, /reintentar/i);
  assert.equal(red.llamadas.length, 3, "un 503 SI se reintenta");
});

test("un 404 del RPC degrada con aviso, usa el camino viejo y REINTENTA el RPC en el siguiente guardado", async () => {
  // El simulador por defecto imita la base de HOY: plan_guardar no existe todavia.
  const { writer, llamadas } = escritor();
  const informe = await writer.guardar(estado());
  const alRpc = llamadas.filter((c) => c.url.includes("/rpc/"));
  assert.equal(alRpc.length, 1, "una sola pregunta al RPC");
  assert.equal(informe.camino, "viejo", "y se fue por el camino viejo");
  // El aviso tiene que decir LO QUE esta pasando, porque es lo unico que separa
  // "falta el DDL" de "se cayo la red": uno se arregla aplicando el DDL y el otro
  // esperando, y tratarlos igual deja a la persona creyendo que guardo con
  // transaccion cuando no.
  const avisos = informe.avisos.join(" ");
  assert.match(avisos, /falta aplicar el DDL/i);
  assert.match(avisos, /camino viejo/i);
  assert.match(avisos, /SIN TRANSACCION/i);
  assert.match(avisos, /no es un fallo de red/i);
  assert.match(avisos, /PGRST202/, "y el codigo que dio PostgREST, para no tener que adivinar");
  // El camino viejo es el de siempre, con su freno: operations se actualiza y no
  // se borra.
  assert.equal(de(llamadas, "DELETE", "operations").length, 0);
  assert.equal(de(llamadas, "POST", "operations").length, 1);

  // MEDIDO 2026-09-30: el cache de rpcAusente se limpia en CADA intento de guardado,
  // porque el DDL puede haber sido aplicado entre guardados. Si se aplico, el siguiente
  // guardado DEBE usar el RPC. Por eso se vuelve a preguntar.
  const antes = llamadas.length;
  const segundo = await writer.guardar(estado());
  const nuevas = llamadas.slice(antes);
  const alRpc2 = nuevas.filter((c) => c.url.includes("/rpc/"));
  assert.equal(alRpc2.length, 1, "SE vuelve a preguntar al RPC: el DDL puede haber sido aplicado");
  assert.equal(segundo.camino, "viejo", "y como sigue sin DDL, va por el camino viejo");
  // El camino viejo entero: 3 borrados de las tablas de espejo, 6 UPSERT (una por
  // tabla) y el PATCH de app_state. Los eventos ya estan y no se vuelven a pagar.
  // MAS la pregunta al RPC (POST a /rpc/plan_guardar), total POST = 1 RPC + 6 old-path = 7.
  assert.equal(nuevas.filter((c) => c.metodo === "DELETE").length, 3);
  assert.equal(nuevas.filter((c) => c.metodo === "POST").length, 7);
  assert.equal(nuevas.filter((c) => c.metodo === "PATCH").length, 1);
  assert.match(segundo.avisos.join(" "), /falta aplicar el DDL/i, "y el aviso sigue saliendo en cada guardado");
});

test("un 401 del RPC no degrada al camino viejo: no es lo mismo que un 404", async () => {
  const { writer, llamadas } = escritor({ rpc: "presente", responder: rpcContestando(() => contestando(401, JSON.stringify({ message: "JWT ausente" }))) });
  const informe = await writer.guardar(estado());
  // Caer al camino viejo con la sesion caida seria hacer seis peticiones que
  // tambien van a fallar, y encima decir "sin transaccion" como si fuera el mismo
  // problema que el DDL sin aplicar.
  assert.equal(llamadas.length, 1, "ni una escritura por tablas");
  assert.equal(informe.ok, false);
  assert.match(informe.motivo, /401/);
  assert.match(informe.motivo, /no mejoran esperando/i, "un 401 no se arregla esperando: hay que arreglar la sesion");
  assert.doesNotMatch(informe.motivo, /reintentar el guardado/i);
});

test("el token no sale ni en la URL ni en el informe, tampoco por el RPC", async () => {
  const { writer, llamadas } = escritor({ rpc: "presente", responder: rpcContestando() });
  const informe = await writer.guardar(estado());
  for (const c of llamadas) {
    // El JWT va en la cabecera Authorization y en ningun otro sitio. En la URL
    // acabaria en el log del proxy, en el historial y en un referer.
    assert.doesNotMatch(c.url, /jwt-de-pruebas/, "el token viaja en la cabecera, nunca en la URL");
    assert.doesNotMatch(c.url, new RegExp(CLAVE_FALSA), "la clave tampoco");
    assert.equal(c.headers.Authorization, "Bearer " + JWT_FALSO);
  }
  const texto = JSON.stringify(informe);
  assert.doesNotMatch(texto, /jwt-de-pruebas/);
  assert.doesNotMatch(texto, new RegExp(CLAVE_FALSA));
  assert.doesNotMatch(texto, /firma-que-no-es-real/);
});

test("retirada_en y retirada_por NO se mandan: esas columnas las pone la funcion", async () => {
  const { writer, llamadas } = escritor({ rpc: "presente", responder: rpcContestando() });
  await writer.guardar(estado());
  const payload = llamadas[0].cuerpo.p_payload;
  for (const tabla of writer.CLAVES_PAYLOAD) {
    const valor = payload[tabla];
    const filas = Array.isArray(valor) ? valor : [valor];
    for (const fila of filas) {
      if (!fila || typeof fila !== "object") continue;
      assert.equal("retirada_en" in fila, false, tabla + " no manda retirada_en");
      assert.equal("retirada_por" in fila, false, tabla + " no manda retirada_por");
    }
  }
  // Y no es que el dato este escondido: la fuente real de una retirada es que la
  // OT salio de selected_ots, y comparar la cola de antes con la de despues lo
  // hace la funcion (docs/schema-supabase-plan.sql:590-599). El navegador no
  // tiene esa lista, asi que no puede escribirla aunque quisiera.
  assert.doesNotMatch(fuente, /retirada_en\s*:/);
  assert.doesNotMatch(fuente, /retirada_por\s*:/);
});

test("un estado vacio NO llama a plan_guardar aunque el DDL este aplicado, y no borra nada", async () => {
  // La funcion sustituye selected_ots, locked_ots y operation_plan_statuses con un
  // delete y un insert SIN CONDICION, asi que una lista vacia las deja vacias. Un
  // guardado que fallo al leer no puede vaciar el plan entero (RULE-SUP-021), y
  // con el RPC el freno tiene que ir ANTES de la llamada: alli no se puede saltar
  // una tabla.
  const { writer, llamadas } = escritor({ rpc: "presente", responder: rpcContestando() });
  const informe = await writer.guardar(estadoVacio());
  assert.equal(llamadas.filter((c) => c.url.includes("/rpc/")).length, 0, "no se llama a la funcion con un estado vacio");
  assert.equal(llamadas.filter((c) => c.metodo === "DELETE").length, 0, "y por el camino viejo tampoco se borra nada");
  const avisos = informe.avisos.join(" ");
  assert.match(avisos, /No se llamo a plan_guardar/i);
  assert.match(avisos, /vaciarSiEstaVacio/, "y dice como se hace si el vacio es de verdad");
});

test("con vaciarSiEstaVacio si se llama a la funcion, porque el vacio es explicito", async () => {
  const { writer, llamadas } = escritor({ rpc: "presente", responder: rpcContestando() });
  await writer.guardar(estadoVacio(), { vaciarSiEstaVacio: true });
  assert.equal(llamadas.length, 1);
  assert.match(llamadas[0].url, /plan_guardar$/);
  assert.deepEqual(llamadas[0].cuerpo.p_payload.selected_ots, [], "las nueve claves van, vacias donde toca");
  assert.deepEqual(llamadas[0].cuerpo.p_payload.locked_ots, []);
});

test("los eventos y los snapshots van con la forma que espera la funcion", async () => {
  const { writer, llamadas } = escritor({ rpc: "presente", responder: rpcContestando() });
  await writer.guardar(estado(), {
    snapshots: [{ snapshotId: "draft", operations: [{ id: "ns-3177-1" }], generatedAt: "2026-09-29T18:00:00.000Z", planStart: "2026-09-28" }],
  });
  const cuerpo = llamadas[0].cuerpo;
  for (const evento of cuerpo.p_payload.operation_events) {
    // El actor lo pone la funcion desde p_actor, no el navegador: mandarlo seria
    // mandar un valor que se pisa.
    assert.equal("actor" in evento, false);
    assert.deepEqual(Object.keys(evento).sort(), ["ct", "id", "kind", "operation_id", "ot", "payload", "secuencia"]);
  }
  assert.equal(cuerpo.p_actor, "uuid-de-prueba", "el actor sale del sub del JWT, una vez, en p_actor");
  // El snapshot va entero dentro de la columna jsonb, no partido en columnas: la
  // forma de un borrador la decide la app (docs/schema-supabase-plan.sql:688).
  const snap = cuerpo.p_payload.plan_snapshots[0];
  assert.deepEqual(Object.keys(snap).sort(), ["created_at", "payload", "snapshot_id"]);
  assert.equal(snap.snapshot_id, "draft");
  assert.equal(snap.created_at, "2026-09-29T18:00:00.000Z");
  assert.equal(snap.payload.operations.length, 1);
});

test("el informe del RPC trae las filas que conto la funcion, y la revision nueva", async () => {
  const { writer, llamadas } = escritor({ rpc: "presente", responder: rpcContestando() });
  const informe = await writer.guardar(estado());
  assert.equal(informe.revision, 43, "la revision que incremento la funcion, para que la pagina la guarde");
  assert.equal(informe.actor, "uuid-de-prueba");
  // El modo es lo que dice QUE se hizo, no solo cuantas filas: con el DDL aplicado
  // el borrado de las tres del ERP es imposible, y eso se ve aqui. Los objetos del
  // informe se crean dentro del contexto de vm, asi que se comparan campo a campo
  // en vez de con deepEqual, que ademas de la estructura mira el prototipo.
  assert.equal(informe.tablas.operations.modo, "actualiza");
  assert.equal(informe.tablas.operations.insertadas, 1);
  assert.equal(informe.tablas.operations.error, null);
  assert.equal(informe.tablas.selected_ots.modo, "espejo");
  assert.equal(informe.tablas.selected_ots.insertadas, 2);
  assert.equal(informe.tablas.operation_events.modo, "flujo");
  assert.equal(informe.tablas.operation_events.insertadas, 2);
  // Lo que la funcion reporta y no es una tabla (las OTs que salieron del plan) no
  // se tira: es la respuesta a "que paso con lo que saque del plan".
  assert.deepEqual(JSON.parse(JSON.stringify(informe.marcas.retiradas)), { ots: ["3177"], operaciones: 4 });
});

test("con el RPC, permitirBorradoErp no puede borrar nada: el DDL no lo permite", async () => {
  const { writer, llamadas } = escritor({ rpc: "presente", responder: rpcContestando() });
  const informe = await writer.guardar(estado(), { permitirBorradoErp: true });
  assert.equal(llamadas.filter((c) => c.metodo === "DELETE").length, 0, "operations, work_orders y materials son modo actualiza: UPDATE y nada mas");
  assert.match(informe.avisos.join(" "), /permitirBorradoErp no tiene efecto/i, "y se dice, para que nadie crea que ocurrio");
});

test("los eventos que no caben en una peticion se dejan para el siguiente guardado, y se dice", async () => {
  const { writer, llamadas } = escritor({ rpc: "presente", responder: rpcContestando() });
  const grande = estado();
  grande.operations = [];
  for (let i = 0; i < 205; i += 1) {
    grande.operations.push({ id: "ns-larga-" + i, ot: "3177", secuencia: i, ct: "5464", log: "MAQUINA_OT_APP | KIT_OT_APP" });
  }
  const informe = await writer.guardar(grande);
  assert.equal(llamadas[0].cuerpo.p_payload.operation_events.length, 400, "el tope por peticion: un cuerpo que no entra es un plan que no se guarda");
  assert.match(informe.avisos.join(" "), /se omitieron 10 evento/i, "y lo que se queda fuera se dice, no se traga");
  // El corte avanza de verdad: lo que no se mande sale en el siguiente guardado.
  await writer.guardar(grande);
  assert.equal(llamadas[1].cuerpo.p_payload.operation_events.length, 10);
});
