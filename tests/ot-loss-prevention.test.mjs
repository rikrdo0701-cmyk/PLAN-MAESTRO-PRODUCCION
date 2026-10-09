/**
 * RULE-OT-049: una OT no debe perderse de Backlog ni de Planeado/No planeado por nada que no
 * sea un cierre comprobado.
 *
 * QUE PASABA. reconcileActiveWorkOrders armaba el conjunto de cerradas como
 * `candidates.filter(ot => !active.has(ot))`: toda OT que no venía en el payload se declaraba
 * cerrada y se podaba de workOrders, selectedOts, lockedOts, operations, otConfigurations,
 * preparedPlanningByOt y lastSchedule, en silencio. El payload es un RESTlet con onlyOpen:true
 * y con filtros que descartan filas, así que "no vino" no es evidencia de nada. Medido el
 * 2026-09-26: 17 OTs salieron el 23-sep a las 15:32:40, las 17 en el MISMO SEGUNDO, y 14 de
 * las 17 seguían con operaciones vivas.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const core = await readFile(new URL("../src/web/planning/planning-workflow-core.js", import.meta.url), "utf8");
const app = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");
const netsuite = await readFile(new URL("../src/server/08-netsuite.js", import.meta.url), "utf8");

// Se carga el modulo real, no una reimplementacion.
const contexto = { window: {}, console, Math, JSON, Date, Object, Array, Number, String, Set, Map, isFinite, isNaN, parseInt, parseFloat };
contexto.globalThis = contexto;
vm.createContext(contexto);
vm.runInContext(core, contexto, { filename: "planning-workflow-core.js" });
const { reconcileActiveWorkOrders, normalizeState } = contexto.window.PlanningWorkflowCore;

/** Estado con n OTs vivas, todas con la misma forma. */
function estadoConOts(ots, extra = {}) {
  const workOrders = ots.map((ot, i) => ({ ot, item: `ART-${i}`, status: "EN PROCESO", exists: true, quantity: 10, pendingQuantity: 10 }));
  const operations = ots.flatMap((ot, i) => [
    { id: `${ot}-1`, ot, ct: "5458", tipoInsercion: "PROCESO", cantPendiente: 5, lock: false, planStatus: "PLAN" },
    { id: `${ot}-2`, ot, ct: "5464", tipoInsercion: "PROCESO", cantPendiente: 5, lock: false, planStatus: "PLAN" },
  ]);
  return {
    workOrders,
    operations,
    selectedOts: [...ots],
    lockedOts: [],
    expandedOts: [],
    operationPlanStatuses: {},
    publishedPlanStatuses: {},
    materials: [],
    otConfigurations: {},
    planningConfigByOt: {},
    preparedPlanningByOt: {},
    closedWorkOrderSummaries: {},
    lastSchedule: { scheduledOts: [...ots] },
    selectedDetailOt: "",
    selectedOperationId: "",
    ...extra,
  };
}

const ots = (n) => Array.from({ length: n }, (_, i) => String(3000 + i));
const T = "2026-09-26T20:00:00.000Z";

test("una OT que no viene en el payload NO se pierde en la primera pasada", () => {
  const estado = estadoConOts(["3000", "3001", "3002", "3003"]);
  // Solo vuelve una: las otras tres no vienen. Antes esto las borraba.
  const r = reconcileActiveWorkOrders(estado, [{ ot: "3000", item: "ART-0", status: "EN PROCESO" }], T);

  assert.deepEqual(r.selectedOts, ["3000", "3001", "3002", "3003"], "la cola no pierde ninguna");
  assert.equal(r.workOrders.length, 4, "las cuatro siguen con ficha");
  assert.ok(r.operations.length === 8, "las operaciones se conservan");
  assert.deepEqual(r.lastSchedule.scheduledOts, ["3000", "3001", "3002", "3003"]);
  assert.deepEqual(Object.keys(r.closedWorkOrderSummaries), [], "no se marcan como cerradas");
  assert.deepEqual(Object.keys(r.unconfirmedWorkOrders).sort(), ["3001", "3002", "3003"],
    "las tres quedan POR CONFIRMAR, no cerradas");
  assert.equal(r.unconfirmedWorkOrders["3001"].misses, 1);
  assert.equal(r.lastWorkOrderReconcile.missing, 3);
  assert.equal(r.lastWorkOrderReconcile.confirmedClosed, 0);
});

test("la segunda ausencia YA NO poda: hace falta que NetSuite lo confirme (RULE-OT-051)", () => {
  // ANTES este test afirmaba que la segunda ausencia cerraba la OT. El usuario lo cambio el
  // 2026-09-26: la OT tiene que quedarse hasta que NetSuite DIGA que esta cerrada, y dos
  // ausencias no son un "digo". La regla que se cumple ahora esta dos tests mas abajo.
  let estado = estadoConOts(["3000", "3001", "3002", "3003"]);
  const payload = [{ ot: "3000", item: "ART-0", status: "EN PROCESO" }];

  estado = reconcileActiveWorkOrders(estado, payload, T);
  assert.deepEqual(estado.selectedOts, ["3000", "3001", "3002", "3003"]);

  const r = reconcileActiveWorkOrders(estado, payload, "2026-09-26T21:00:00.000Z");
  assert.deepEqual(r.selectedOts, ["3000", "3001", "3002", "3003"],
    "la que falta dos veces SIGUE en la cola: nadie confirmo que este cerrada");
  assert.equal(r.workOrders.length, 4);
  assert.deepEqual(Object.keys(r.unconfirmedWorkOrders).sort(), ["3001", "3002", "3003"],
    "siguen por confirmar, con misses = 2");
  assert.equal(r.unconfirmedWorkOrders["3001"].misses, 2, "se lleva la cuenta, pero la cuenta no poda");
  assert.deepEqual(Object.keys(r.closedWorkOrderSummaries), []);
  assert.equal(r.lastWorkOrderReconcile.confirmedClosed, 0);

  // Cuando NetSuite confirma, ahi si sale.
  const confirmada = reconcileActiveWorkOrders(r, payload, "2026-09-26T22:00:00.000Z", {
    confirmedBySource: new Set(["3001", "3002", "3003"]),
  });
  assert.deepEqual(confirmada.selectedOts, ["3000"], "confirmadas, si salen");
  assert.ok(confirmada.closedWorkOrderSummaries["3001"]);
});

test("si la OT vuelve a aparecer, la marca se borra sola (payload truncado se autocura)", () => {
  let estado = estadoConOts(["3000", "3001", "3002"]);
  const completo = ["3000", "3001", "3002"].map((ot, i) => ({ ot, item: `ART-${i}`, status: "EN PROCESO" }));

  estado = reconcileActiveWorkOrders(estado, [completo[0]], T);
  assert.deepEqual(Object.keys(estado.unconfirmedWorkOrders).sort(), ["3001", "3002"]);

  // El siguiente sync trae todo: se limpia y no se pierde nada.
  estado = reconcileActiveWorkOrders(estado, completo, "2026-09-26T21:00:00.000Z");
  assert.deepEqual(estado.selectedOts, ["3000", "3001", "3002"]);
  assert.deepEqual(Object.keys(estado.unconfirmedWorkOrders), [], "las marcas se borran");
  assert.deepEqual(Object.keys(estado.closedWorkOrderSummaries), []);
});

test("evidencia positiva: exists === false cierra en la primera pasada", () => {
  const estado = estadoConOts(["3000", "3001", "3002"]);
  // El payload sabe que 3001 ya no existe. Eso SI es evidencia.
  const r = reconcileActiveWorkOrders(estado, [
    { ot: "3000", item: "ART-0", status: "EN PROCESO" },
    { ot: "3001", item: "ART-1", status: "BORRADA", exists: false },
    { ot: "3002", item: "ART-2", status: "EN PROCESO" },
  ], T);
  assert.deepEqual(r.selectedOts, ["3000", "3002"], "la que dice exists:false sale de inmediato");
  assert.equal(r.workOrders.length, 2);
});

test("evidencia positiva: estatus cerrado en la ficha previa cierra en la primera pasada", () => {
  const estado = estadoConOts(["3000", "3001", "3002"]);
  estado.workOrders[1].status = "CERRADA";
  const r = reconcileActiveWorkOrders(estado, [
    { ot: "3000", item: "ART-0", status: "EN PROCESO" },
    { ot: "3002", item: "ART-2", status: "EN PROCESO" },
  ], T);
  assert.deepEqual(r.selectedOts, ["3000", "3002"], "una ficha que ya decia CERRADA no se revalida");
  assert.ok(r.closedWorkOrderSummaries["3001"]);
});

test("caida masiva: el payload incompleto no marca NADA", () => {
  // 100 OTs vivas y solo vuelven 50. Eso no es que se cerraran 50: es una lectura a medias.
  const estado = estadoConOts(ots(100));
  const vuelven = ots(100).slice(0, 50).map((ot, i) => ({ ot, item: `ART-${i}`, status: "EN PROCESO" }));
  const r = reconcileActiveWorkOrders(estado, vuelven, T);

  assert.equal(r.workOrders.length, 100, "no se pierde ninguna de las 100");
  assert.equal(r.selectedOts.length, 100);
  assert.equal(r.lastWorkOrderReconcile.massDrop, true, "la caida se detecta");
  assert.equal(r.lastWorkOrderReconcile.missing, 50);
  assert.deepEqual(Object.keys(r.unconfirmedWorkOrders), [], "y no se marca ninguna, para no ensuciar la lista");
  assert.deepEqual(Object.keys(r.closedWorkOrderSummaries), []);
});

test("caida masiva respeta la evidencia positiva: lo que SI dice cerrado, se poda", () => {
  const estado = estadoConOts(ots(100));
  const vuelven = [];
  for (let i = 0; i < 50; i += 1) {
    vuelven.push({ ot: ots(100)[i], item: `ART-${i}`, status: i === 0 ? "CERRADA" : "EN PROCESO" });
  }
  const r = reconcileActiveWorkOrders(estado, vuelven, T);
  assert.equal(r.lastWorkOrderReconcile.massDrop, true);
  assert.ok(r.closedWorkOrderSummaries[ots(100)[0]], "la que venia con estatus CERRADA si se podo");
  assert.equal(r.workOrders.length, 99, "solo se perdio la que traia evidencia");
});

test("una caida normal NO dispara el guardia de masa", () => {
  // 17 de 222 es 7.6%: el caso real medido. Debe pasar por el camino de confirmar en dos pasos.
  const estado = estadoConOts(ots(222));
  const vuelven = ots(222).slice(0, 205).map((ot) => ({ ot, item: "ART", status: "EN PROCESO" }));
  const r = reconcileActiveWorkOrders(estado, vuelven, T);
  assert.equal(r.lastWorkOrderReconcile.massDrop, false, "17 de 222 no es una lectura a medias");
  assert.equal(r.unconfirmedWorkOrders && Object.keys(r.unconfirmedWorkOrders).length, 17, "las 17 a confirmar");
  assert.equal(r.workOrders.length, 222, "y ninguna se pierde todavia");
});

test("con pocas OTs el ratio no aplica (poco hay que perder)", () => {
  const estado = estadoConOts(ots(5));
  const vuelven = [{ ot: ots(5)[0], item: "A", status: "EN PROCESO" }];
  const r = reconcileActiveWorkOrders(estado, vuelven, T);
  assert.equal(r.lastWorkOrderReconcile.massDrop, false);
  assert.equal(Object.keys(r.unconfirmedWorkOrders).length, 4, "4 ausentes a confirmar");
  assert.equal(r.workOrders.length, 5);
});

test("el renderPriorityQueue ya NO reescribe state.selectedOts", () => {
  // La mutacion estaba en un render: una ruta de lectura que borra datos. Se busca en el CODIGO
  // sin comentarios, porque el comentario que explica el cambio menciona la linea vieja.
  const sinComentarios = app.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
  assert.doesNotMatch(sinComentarios, /state\.selectedOts = ordered\.map\(\(job\) => job\.ot\)/,
    "el render no puede reescribir la cola");
  const i = app.indexOf("function renderPriorityQueue(");
  const bloque = app.slice(i, i + 1400);
  assert.match(bloque, /const sinJob = \[\]/, "las OTs sin job se separan en vez de desaparecer");
  assert.match(bloque, /ordered\.push\(job\)/);
  assert.match(bloque, /sinJob\.map\(\(ot\) => String\(ot\)\)/, "y se conservan al final de la lista");
  // Ninguna asignacion a selectedOts dentro del render, en codigo.
  const codigo = bloque.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
  assert.doesNotMatch(codigo, /state\.selectedOts\s*=/, "ninguna asignacion a selectedOts en el render");
});

test("normalizeState no poda una OT por confirmar solo por falta de datos", () => {
  // Se usa la misma logica del codigo real, aislada.
  const isClosedJobStatus = (status) => {
    const n = String(status || "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return ["CERRAD", "CLOSED", "COMPLETE", "COMPLETADO"].some((b) => n.includes(b));
  };
  const isMovablePlanningStatus = (status) => {
    const n = String(status || "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return !n || !["CERRAD", "CLOSED", "COMPLET", "CANCELAD", "CANCELED", "CANCELLED"].some((b) => n.includes(b));
  };
  const materialOtKey = (v) => String(v ?? "").trim().toUpperCase();
  const uniq = (arr) => [...new Set(arr)];

  // El bloque tiene que incluir desde operationOts hasta DESPUES de la asignacion a
  // state.selectedOts. Si se corta en el indice de esa linea, la asignacion queda fuera y el
  // test no estaria probando nada: devolveria el selectedOts de entrada.
  const ini = app.indexOf("const operationOts = state.operations.filter");
  const fin = app.indexOf("if (state.lastSchedule", ini);
  const codigo = app.slice(ini, fin);
  assert.ok(codigo.includes("operationOts"), "el bloque empieza en operationOts");
  assert.ok(codigo.includes("state.selectedOts = uniq(configuredSelectedOts)"), "y contiene la asignacion");
  const f2 = new Function("selectedOts", "workOrders", "operations", "unconfirmedWorkOrders", "materialOtKey", "isClosedJobStatus", "isMovablePlanningStatus", "jobStatusForOt", "uniq",
    `const state = { selectedOts, workOrders, operations, unconfirmedWorkOrders };
     const jobStatusParaTarjeta = (ot) => {
       const ficha = state.workOrders.find((item) => materialOtKey(item?.ot) === materialOtKey(ot));
       const s = String(ficha?.status || "").trim();
       return s && !isClosedJobStatus(s) ? s : jobStatusForOt(ot);
     };
     ${codigo}
     return state.selectedOts;`);

  const ops = [{ ot: "3000", tipoInsercion: "PROCESO" }];
  // 3001 esta en la cola y por confirmar, pero sin ficha ni operaciones.
  const base = ["3000", "3001"];
  const sinMarca = f2(base, [{ ot: "3000" }], ops, {}, materialOtKey, isClosedJobStatus, isMovablePlanningStatus, () => "EN PROCESO", uniq);
  assert.deepEqual(sinMarca, ["3000"], "sin la marca, una OT sin datos se cae (comportamiento viejo)");

  const conMarca = f2(base, [{ ot: "3000" }], ops, { "3001": { misses: 1 } }, materialOtKey, isClosedJobStatus, isMovablePlanningStatus, () => "EN PROCESO", uniq);
  assert.deepEqual(conMarca, ["3000", "3001"], "con la marca de por-confirmar, se CONSERVA");

  // Y si su estatus dice cerrada, ah sí se va, porque eso es evidencia. El stub de estatus es
  // POR OT: si dijera CERRADA para todas, caerian las dos y el caso no probaria nada.
  const porOt = (ot) => (String(ot) === "3001" ? "CERRADA" : "EN PROCESO");
  const cerrada = f2(base, [{ ot: "3000" }], ops, { "3001": { misses: 1 } }, materialOtKey, isClosedJobStatus, isMovablePlanningStatus, porOt, uniq);
  assert.deepEqual(cerrada, ["3000"], "pero si dice CERRADA, se poda igual");
});

test("el servidor tampoco persiste la poda por inferencia, y avisa de la caida masiva", () => {
  // Guardas de estructura: el codigo del servidor tiene las tres capas.
  const i = netsuite.indexOf("function PP_applyNetSuiteWorkOrdersData_(");
  assert.ok(i > 0, "no se encontro PP_applyNetSuiteWorkOrdersData_");
  const bloque = netsuite.slice(i, i + 6000);
  assert.match(bloque, /item\.exists === false \|\| item\.existe === false/, "capa 1: exists === false");
  assert.match(bloque, /function estatusCerrado\(item\)/, "capa 1: estatus cerrado");
  assert.match(bloque, /caidaMasiva/, "capa 3: guardia de caida masiva");
  assert.doesNotMatch(bloque, /misses >= 2/, "capa 2: segunda ausencia NO confirma (solo evidencia positiva)");
  assert.match(bloque, /merged\.unconfirmedWorkOrders = porConfirmar/);
  assert.match(bloque, /merged\.lastWorkOrderReconcile = \{/);
  assert.match(bloque, /sigueViva = function\(ot\) \{ return !confirmadas/, "la poda se decide por evidencia, no por openOts");
  // Y ya no puede quedar la poda cruda por openOts, que es la que perdia OTs.
  assert.doesNotMatch(bloque, /filter\(function\(ot\) \{ return openOts\[PP_normalizeKey_\(ot\)\]; \}\)/,
    "no debe quedar la poda por openOts: eso es 'ausente = cerrada'");
});

test("RULE-OT-051: la segunda ausencia YA NO poda; solo la confirmacion de NetSuite", () => {
  // Este es el cambio de fondo que pidio el usuario: la OT se queda hasta que NetSuite DIGA que
  // esta cerrada. Dos ausencias no son confirmacion.
  const estado = {
    selectedOts: ["100", "200"],
    lockedOts: [], expandedOts: [],
    workOrders: [
      { ot: "100", item: "A", status: "EN PROCESO", quantity: 1 },
      { ot: "200", item: "B", status: "EN PROCESO", quantity: 2 },
    ],
    operations: [{ id: "200-1", ot: "200", planStatus: "PENDIENTE" }],
    operationPlanStatuses: {}, materials: [], otConfigurations: {},
    planningConfigByOt: {}, preparedPlanningByOt: {},
    lastSchedule: { scheduledOts: ["100", "200"] },
    selectedDetailOt: "", selectedOperationId: "", closedWorkOrderSummaries: {},
  };
  const payload = [{ ot: "100", item: "A", status: "EN PROCESO" }];

  // Diez syncs seguidos, siempre con el mismo payload incompleto.
  let s = estado;
  for (let i = 0; i < 10; i += 1) {
    s = reconcileActiveWorkOrders(s, payload, `2026-09-26T1${i}:00:00Z`);
  }
  assert.deepEqual(structuredClone(s.selectedOts), ["100", "200"],
    "diez ausencias y la OT sigue en la cola: no hay confirmacion de que este cerrada");
  assert.equal(s.workOrders.length, 2, "y con su ficha");
  assert.equal(s.operations.length, 1, "y con sus operaciones");
  assert.deepEqual(Object.keys(structuredClone(s.closedWorkOrderSummaries)), [],
    "no se marca como cerrada: nadie lo dijo");

  // Ahora NetSuite CONFIRMA que esta cerrada, y ahi si sale.
  const confirmada = reconcileActiveWorkOrders(s, payload, "2026-09-26T20:00:00Z", {
    confirmedBySource: new Set(["200"]),
  });
  assert.deepEqual(structuredClone(confirmada.selectedOts), ["100"], "confirmada, si sale");
  assert.equal(confirmada.workOrders.length, 1);
  assert.ok(confirmada.closedWorkOrderSummaries["200"], "y queda con su resumen de cerrada");
});

test("RULE-OT-051: confirmWorkOrderClosures solo confirma con estatus cerrado y real", async () => {
  const src = await readFile(new URL("../src/server/16-inspection-service.js", import.meta.url), "utf8");
  const i = src.indexOf("function confirmWorkOrderClosures(");
  assert.ok(i > 0, "no se encontro confirmWorkOrderClosures");
  const cuerpo = src.slice(i, i + 2600);

  // found:false NO es cierre: NetSuite puede no conocer la OT (borrada, otra planta).
  assert.match(cuerpo, /found: encontrado/, "hay que distinguir encontrada de no encontrada");
  assert.match(cuerpo, /closed: encontrado && PP_confirmedClosedStatus_\(estatus\)/,
    "cerrada exige QUE SE HAYA ENCONTRADO y que el estatus lo diga");
  // Un error de red jamas puede cerrar.
  assert.match(cuerpo, /closed: false, error:/, "un fallo de la llamada no cierra nada");
  // Tope de gasto: la cuota de UrlFetch es de 20 000/dia y ya se agoto una vez.
  assert.match(cuerpo, /var TOPE = 20;/, "debe haber un tope de folios por pasada");
  assert.match(cuerpo, /truncated: recortada/, "y avisar cuando se recorta");
  // Y el sin-nombre de NetSuite tiene que ser una palabra de verdad.
  assert.match(src, /var PP_CONFIRMED_CLOSED_WORDS_ = \['CERRAD', 'CLOSED', 'COMPLET', 'CANCELAD'/);
});

test("RULE-OT-051: confirmUnconfirmedWorkOrderClosures no pregunta si no hay pendientes", async () => {
  const app = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");
  const i = app.indexOf("async function confirmUnconfirmedWorkOrderClosures(");
  assert.ok(i > 0, "no se encontro confirmUnconfirmedWorkOrderClosures");
  const cuerpo = app.slice(i, i + 2200);
  // El caso normal es que no haya nada pendiente, y ahi no se debe gastar una sola llamada.
  assert.match(cuerpo, /if \(!pendientes\.length\) return \{ asked: 0 \};/,
    "sin OTs por confirmar no se pregunta nada");
  // Un fallo al preguntar deja todo como esta.
  assert.match(cuerpo, /catch \(error\) \{[\s\S]{0,320}Un fallo al preguntar NUNCA cierra una OT/);
  // Y solo se re-reconcilia si hay confirmadas de verdad.
  assert.match(cuerpo, /if \(confirmed\.size\) \{/);
  assert.match(cuerpo, /\{ confirmedBySource: confirmed \}/,
    "la confirmacion se pasa al reconciliador, que es el unico que puede podar");
});

test("RULE-OT-051: 'Generar plan' no quita una OT porque una operacion diga cerrada", async () => {
  const app = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");
  // La puerta que se uso antes y que se cambio.
  assert.doesNotMatch(app, /const closedOts = state\.selectedOts\.filter\(\(ot\) => !isMovablePlanningStatus\(jobStatusForOt\(ot\)\)\);/,
    "ya no se puede decidir el cierre con el estatus agregado de la OT");
  assert.match(app, /const closedOts = state\.selectedOts\.filter\(\(ot\) => isConfirmedClosedWorkOrder\(ot\)\);/,
    "el cierre se decide con la FICHA de la OT o con lo que NetSuite confirmo");
  assert.match(app, /soloOperacionDiceCerrada/, "y el caso 'solo dice cerrada la operacion' se avisa, no se borra");
  // El helper tiene que usar la ficha, no las operaciones.
  const i = app.indexOf("function isConfirmedClosedWorkOrder(");
  const cuerpo = app.slice(i, i + 600);
  assert.match(cuerpo, /state\.workOrders\.find\(/, "busca la ficha de la OT");
  assert.match(cuerpo, /isClosedJobStatus\(ficha\.status\)/, "y mira su estatus");
  assert.doesNotMatch(cuerpo, /jobStatusForOt/, "NO debe usar el estatus agregado, que cae a las operaciones");
});

// ---------------------------------------------------------------------------------------------
// EL CLIENTE NO DESHACIA LA PROTECCION. Pedido de la persona el 2026-09-27: "lo que ponga en
// Planeado / No planeado no se mueva de ahi, y al refrescar la pagina siga como lo deje".
//
// QUE PASABA, Y SON DOS PASOS QUE SE REFUERZAN. applyNetSuiteWorkOrdersPayload (app.js:9841):
//   1. corria reconcileActiveWorkOrders, que deja en workOrders las OTs que solo faltan y NO
//      tienen evidencia de cierre (planning-workflow-core.js:1075-1077). Proteccion correcta.
//   2. state.workOrders = payload.workOrders.map(...) SUSTITUIA esa lista reconciliada por el
//      payload crudo, y con ello se perdian las OTs conservadas en el paso 1.
//   3. y despues corria pruneDraftToOpenWorkOrders(state, state.workOrders), que poda por SIMPLE
//      AUSENCIA: keep = items.filter(ot => open.has(normalize(ot))). Sin evidencia, sin marcas de
//      por confirmar, sin guarda de caida masiva.
// Con 2 y 3, una OT que solo faltaba en un listado de NetSuite perdia su ficha Y salia de la cola,
// sin que nadie confirmara nada. Y el resultado se persistia. Medido esa noche: 25 seleccionadas
// contra 222 fichas, 0 perdidas; la via estaba abierta y no habia descargado.
//
// QUE NO SE TOCA, Y POR QUE. pruneDraftToOpenWorkOrders no se borra: queda como red para cuando
// PlanningWorkflowCore no trae la routine. Y estos tests comprueban que las TRES formas de cierre
// legitimo siguen podando, que es por donde se podria romper algo al corregir.
function extraerFuncion(fuente, nombre) {
  const inicio = fuente.indexOf(`function ${nombre}(`);
  if (inicio < 0) throw new Error(`no se encontro ${nombre}`);
  // Se cuentan llaves sin contar las que hay en comentarios: un "{ /* } */ " descuadra el conteo.
  const sinComentarios = fuente
    .slice(inicio)
    .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
  let nivel = 0, abierto = false;
  for (let i = 0; i < sinComentarios.length; i += 1) {
    if (sinComentarios[i] === "{") { nivel += 1; abierto = true; }
    else if (sinComentarios[i] === "}") {
      nivel -= 1;
      if (abierto && nivel === 0) return fuente.slice(inicio, inicio + i + 1);
    }
  }
  throw new Error(`no se cerro la llave de ${nombre}`);
}

/** Corre el applyNetSuiteWorkOrdersPayload REAL de app.js contra el core REAL. */
function harness() {
  const ctx = {
    window: { PlanningWorkflowCore: contexto.window.PlanningWorkflowCore },
    console, Math, JSON, Date, Object, Array, Number, String, Boolean, Set, Map, RegExp,
    isFinite, isNaN, parseInt, parseFloat, structuredClone,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(`
    let state = null;
    function invalidateCurrentPlanOperationsCache() {}
    function resetBacklogWindow() {}
    ${extraerFuncion(app, "materialOtKey")}
    ${extraerFuncion(app, "mergeWorkOrderLocalOverrides")}
    ${extraerFuncion(app, "applyNetSuiteWorkOrdersPayload")}
    this.__aplicar = (payload) => { applyNetSuiteWorkOrdersPayload(payload); return state; };
    this.__poner = (s) => { state = s; };
  `, ctx, { filename: "applyNetSuiteWorkOrdersPayload" });
  return {
    aplicar: (estado, payload) => { ctx.__poner(structuredClone(estado)); return ctx.__aplicar(payload); },
  };
}

test("RULE-OT-051: el cliente NO saca de la cola una OT que solo falta en el listado", () => {
  const { aplicar } = harness();
  const estado = estadoConOts(["3000", "3001", "3002"]);
  // Solo vuelve 3000. Las otras dos no vienen, y NADIE dijo que esten cerradas.
  const r = aplicar(estado, { workOrders: [{ ot: "3000", item: "ART-0", status: "EN PROCESO" }] });

  // structuredClone en las comparaciones: lo que sale del vm es un Array de otro realm y
  // deepEqual estricto compara prototipos. Es el mismo cuidado que ya usa este archivo mas abajo.
  assert.deepEqual(structuredClone(r.selectedOts), ["3000", "3001", "3002"],
    "lo que la persona puso en Planeado se queda: ausencia no es cierre");
  assert.deepEqual(structuredClone(r.workOrders.map((w) => w.ot)), ["3000", "3001", "3002"],
    "y las tres conservan su ficha, que es lo que prueba que la OT existe");
  assert.ok(r.workOrders.some((w) => w.ot === "3001"), "incluida la que no vino en el payload");
});

test("RULE-OT-051: pero una OT con evidencia POSITIVA si sale de la cola", () => {
  const { aplicar } = harness();
  const base = estadoConOts(["3000", "3001", "3002"]);

  // exists === false: el payload dice que ya no existe.
  const porExists = aplicar(base, { workOrders: [
    { ot: "3000", item: "ART-0", status: "EN PROCESO" },
    { ot: "3001", item: "ART-1", status: "BORRADA", exists: false },
    { ot: "3002", item: "ART-2", status: "EN PROCESO" },
  ] });
  assert.deepEqual(structuredClone(porExists.selectedOts), ["3000", "3002"], "exists:false es evidencia y poda");
  assert.equal(porExists.workOrders.length, 2, "y su ficha tambien se va");

  // Y la ficha previa que YA decia CERRADA, sin necesidad de que vuelva a venir.
  const cerradaAntes = estadoConOts(["3000", "3001", "3002"]);
  cerradaAntes.workOrders[1].status = "CERRADA";
  const porEstatus = aplicar(cerradaAntes, { workOrders: [
    { ot: "3000", item: "ART-0", status: "EN PROCESO" },
    { ot: "3002", item: "ART-2", status: "EN PROCESO" },
  ] });
  assert.deepEqual(structuredClone(porEstatus.selectedOts), ["3000", "3002"], "una ficha que ya decia CERRADA no se revalida");
  assert.ok(porEstatus.closedWorkOrderSummaries["3001"], "y queda con su resumen de cerrada");
});

test("RULE-OT-051: caida masiva en el cliente tampoco se lleva la cola", () => {
  const { aplicar } = harness();
  const estado = estadoConOts(ots(222));
  const vuelven = ots(222).slice(0, 205).map((ot) => ({ ot, item: "ART", status: "EN PROCESO" }));
  const r = aplicar(estado, { workOrders: vuelven });

  assert.equal(r.selectedOts.length, 222, "17 de 222 ausentes no es una lectura a medias");
  assert.equal(r.workOrders.length, 222, "y ninguna ficha se pierde");
  assert.equal(r.lastWorkOrderReconcile.massDrop, false);
  assert.equal(Object.keys(r.closedWorkOrderSummaries).length, 0, "nadie dijo que estuvieran cerradas");
});

test("RULE-OT-051: la poda por ausencia queda solo como red, nunca como camino normal", () => {
  // Guarda estructural sobre el CODIGO, sin comentarios: mientras reconcileActiveWorkOrders este
  // disponible, la poda desnuda no puede ser la ultima palabra.
  const sinComentarios = app
    .slice(app.indexOf("function applyNetSuiteWorkOrdersPayload("), app.indexOf("function persistReferencePricesFromSync("))
    .split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
  assert.match(sinComentarios, /huboReconciliacion = true/, "se marca que hubo reconciliacion");
  assert.match(sinComentarios, /if \(!huboReconciliacion\) \{[\s\S]{0,200}pruneDraftToOpenWorkOrders/,
    "la poda por ausencia solo corre cuando NO hubo reconciliacion");
  assert.doesNotMatch(sinComentarios, /state\.workOrders = payload\.workOrders\.map/,
    "la lista reconciliada no se sustituye por el payload crudo: ahi se perdian las OTs conservadas");
});

test("RULE-OT-051: el 2244 expone el estatus que hace posible la confirmacion", async () => {
  const restlet = await readFile(new URL("../netsuite-restlet-wo-inspeccion.js", import.meta.url), "utf8");
  // El action detail es el que ignora onlyOpen, o sea el unico que ve las OTs cerradas.
  assert.match(restlet, /SELECT id, tranid, BUILTIN\.DF\(status\) AS estatus FROM transaction/,
    "detail tiene que traer el estatus real de la OT");
  assert.match(restlet, /resultados\.estatus =/);
  assert.match(restlet, /SELECT BUILTIN\.DF\(status\) AS estatus FROM transaction WHERE id = \?/,
    "y confirmarlo con una segunda consulta por id, que es la que no depende del lookup");
  // Y la lista debe seguir filtrando las cerradas: no vamos a traer toda la historia.
  assert.match(restlet, /if \(payload\.onlyOpen !== false\) \{[\s\S]{0,400}NOT LIKE '%CLOSED%'/,
    "list sigue con onlyOpen: traer todas las cerradas seria un masturbation de cuota");
});