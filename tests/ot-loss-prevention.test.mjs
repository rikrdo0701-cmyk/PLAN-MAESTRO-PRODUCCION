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

test("la segunda ausencia consecutively SÍ confirma el cierre", () => {
  let estado = estadoConOts(["3000", "3001", "3002", "3003"]);
  const payload = [{ ot: "3000", item: "ART-0", status: "EN PROCESO" }];

  // Pasada 1: por confirmar, no se pierde nada.
  estado = reconcileActiveWorkOrders(estado, payload, T);
  assert.deepEqual(estado.selectedOts, ["3000", "3001", "3002", "3003"]);

  // Pasada 2, con OTRO payload igual: ahora si es cierre.
  const r = reconcileActiveWorkOrders(estado, payload, "2026-09-26T21:00:00.000Z");
  assert.deepEqual(r.selectedOts, ["3000"], "la que falta dos veces sale de la cola");
  assert.equal(r.workOrders.length, 1);
  assert.deepEqual(Object.keys(r.unconfirmedWorkOrders), [], "ya no queda por confirmar");
  assert.ok(r.closedWorkOrderSummaries["3001"], "y queda con su resumen de cerrada");
  assert.equal(r.lastWorkOrderReconcile.confirmedClosed, 3);
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
  assert.match(bloque, /misses >= 2/, "capa 2: segunda ausencia confirma");
  assert.match(bloque, /merged\.unconfirmedWorkOrders = porConfirmar/);
  assert.match(bloque, /merged\.lastWorkOrderReconcile = \{/);
  assert.match(bloque, /sigueViva = function\(ot\) \{ return !confirmadas/, "la poda se decide por evidencia, no por openOts");
  // Y ya no puede quedar la poda cruda por openOts, que es la que perdia OTs.
  assert.doesNotMatch(bloque, /filter\(function\(ot\) \{ return openOts\[PP_normalizeKey_\(ot\)\]; \}\)/,
    "no debe quedar la poda por openOts: eso es 'ausente = cerrada'");
});
