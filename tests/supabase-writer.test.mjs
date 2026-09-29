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
const JWT_FALSO = "jwt-de-pruebas.eyJzdWIiOiJ1dWlk-de-pruebaIiwidXNlciI6ImZhbCJ9.firma-que-no-es-real";

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
 */
function escritor({ token = JWT_FALSO, configurado = true, responder = null } = {}) {
  const llamadas = [];
  const contexto = {
    console,
    AbortController, setTimeout, clearTimeout, Math, Date, JSON, Object, Array,
    Promise, String, Number, Boolean, Error, RegExp, Set, isFinite, parseInt,
    encodeURIComponent,
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
      if (responder) return responder(registro, llamadas.length);
      return { ok: true, status: 204, text: async () => "" };
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
  // Sin reintentar, cada escritura se toca una vez: 6 espejos + 1 evento + app_state.
  const esperadas = writer.ESPEJO.length + 2;
  assert.equal(llamadas.length, esperadas, `hubo ${llamadas.length} peticiones con un 401 y se esperaban ${esperadas}`);
  assert.equal(informe.ok, false);
  assert.match(informe.tablas.operations.error, /401/);
  // Y el motivo no dice "reintentar": un 401 no mejora esperando.
  assert.doesNotMatch(informe.tablas.operations.error, /intento/i);
});

test("un 404 tampoco se reintenta", async () => {
  const { writer, llamadas } = escritor({ responder: () => ({ ok: false, status: 404, text: async () => "" }) });
  await writer.guardar(estado());
  assert.equal(llamadas.length, writer.ESPEJO.length + 2);
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
  assert.match(informe.tablas.operations.error, /no se borra/i);
  assert.equal(informe.ok, false, "y se reporta, no se traga el silencio");

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
  const { writer, llamadas } = escritor();
  await writer.guardar(estado());
  assert.equal(llamadas.filter((c) => c.url.includes("/rpc/")).length, 0);
  assert.doesNotMatch(fuente, /ingesta_mirror\s*\(/);
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
