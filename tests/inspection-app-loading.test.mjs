import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/web/inspection/inspection-app.js", import.meta.url), "utf8");

// MEDIDO 2026-10-04: el harness carga el INSPECTION CORE REAL para `inspectionMaterialsUnicos`.
// La hoja llama a esa funcion en `renderDetail` (para que una MP no salga dos veces) y este
// archivo, antes de que existiera, tendria un `TypeError` al pintar. Poner un mock trivial
// ("devuelve el arreglo tal cual") dejaria en verde justo el defecto que se quiere cazar:
// aqui la deduplicacion tiene que ser la de verdad, la que decide que fila es del BOM.
const coreContext = { window: {} };
vm.runInNewContext(await readFile(new URL("../src/web/inspection/inspection-core.js", import.meta.url), "utf8"), coreContext);
const coreReal = coreContext.window.InspectionCore;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

function createElement(id) {
  const listeners = new Map();
  return {
    id,
    value: "",
    innerHTML: "",
    hidden: false,
    disabled: false,
    style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatch(type) { return listeners.get(type)?.({ target: this, preventDefault() {} }); },
    querySelectorAll() { return []; },
    querySelector() { return null; },
  };
}

/**
 * MEDIDO 2026-10-01: el harness ya NO expone `PPAppsScriptBridge`. Antes si, y la app
 * pedia las cuatro funciones de la hoja de inspeccion (`getInspectionWorkOrders`,
 * `getInspectionWorkOrderBundle`, `getInspectionHistory`, `recordInspectionPrint`) por
 * `call(...)`, o sea por Apps Script, que esta deshabilitado (RULE-SUP-030). Con el
 * puente en el harness, estos tests pasaban mientras la pagina en produccion no podia
 * ni hacer la lista de OTs: el mock era mas fiel que el codigo.
 *
 * Ahora el harness expone `PPSupabaseBridgeReplacement`, que es la unica fuente de
 * datos, y `callBackend` sigue recibiendo el nombre del metodo como primer argumento
 * para que los asserts de este archivo no cambien.
 */
function createHarness(callBackend, now = { value: 0 }) {
  const elements = new Map();
  const byId = (id) => {
    if (!elements.has(id)) elements.set(id, createElement(id));
    return elements.get(id);
  };
  [
    "inspectionWorkOrder", "inspectionSearch", "inspectionJobStatus", "inspectionHistory",
    "inspectionReload", "inspectionSelectOps", "inspectionDrawing", "inspectionEditLink",
    "inspectionPrint", "inspectionSheetGrid", "inspectionSecondCapture",
    "inspectionReleaseFooter", "inspectionOperationChoices", "inspectionPrintCheck",
  ].forEach(byId);
  const document = {
    readyState: "loading",
    body: { classList: { add() {}, remove() {} }, appendChild() {} },
    getElementById: byId,
    addEventListener() {},
    createElement: (tag) => createElement(tag),
  };
  const window = {
    document,
    location: { hash: "" },
    PPSupabaseBridgeReplacement: Object.fromEntries(
      [
        "getInspectionWorkOrders",
        "getInspectionWorkOrderBundle",
        "getInspectionHistory",
        "recordInspectionPrint",
      ].map((metodo) => [metodo, (...args) => callBackend(metodo, args)]),
    ),
    InspectionCore: {
      initialOperationSelection: (operations) => Object.fromEntries(operations.map((operation, index) => [operation.id || operation.code || String(index), true])),
      inspectionMaterials: (materials) => materials,
      // La deduplicacion de verdad, no una de mentira (ver la nota de `coreReal` arriba).
      inspectionMaterialsUnicos: (materials) => coreReal.inspectionMaterialsUnicos(materials),
      inspectionRows: () => [],
      inspectionPrintDiagnostic: () => ({ status: "ok", label: "Listo", missingRoutes: [], deficit: [], pending: [], alerts: [], materials: [] }),
      operationKey: (operation, index) => operation.id || operation.code || String(index),
      printableOperations: (operations) => operations,
    },
    addEventListener() {},
    requestAnimationFrame: (callback) => callback(),
    setTimeout,
    alert() {},
    confirm: () => true,
    open() {},
    print() {},
  };
  const context = {
    window,
    document,
    Date: { now: () => now.value },
    Promise,
    Map,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Math,
    RegExp,
    Error,
    console,
  };
  vm.runInNewContext(source, context);
  window.InspectionApp.initialize();
  return { app: window.InspectionApp, byId, now };
}

function bundle(wo) {
  return {
    ok: true,
    data: {
      detail: { workOrder: { wo, article: `ART-${wo}`, status: `Estado ${wo}` }, operations: [], materials: [] },
      history: { count: 1, history: [{ WO: wo, FECHA_HORA: `Fecha ${wo}` }] },
    },
  };
}

test("precarga las primeras ocho WOs", async () => {
  const bundleCalls = [];
  const { app } = createHarness(async (method, args) => {
    if (method === "getInspectionWorkOrders") return { ok: true, data: Array.from({ length: 10 }, (_, index) => ({ wo: String(index + 1), article: "A", quantity: 1 })) };
    bundleCalls.push(args[0]);
    return bundle(args[0]);
  });

  await app.loadList();
  await flush();

  assert.deepEqual(bundleCalls, ["1", "2", "3", "4", "5", "6", "7", "8"]);
});

test("limita a tres las precargas simultaneas", async () => {
  const pending = [];
  let active = 0;
  let maximumActive = 0;
  const { app } = createHarness((method, args) => {
    if (method === "getInspectionWorkOrders") return Promise.resolve({ ok: true, data: Array.from({ length: 5 }, (_, index) => ({ wo: String(index + 1), article: "A", quantity: 1 })) });
    const request = deferred();
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    pending.push({ wo: args[0], request });
    return request.promise.finally(() => { active -= 1; });
  });

  await app.loadList();
  await flush();
  assert.equal(pending.length, 3);

  while (pending.length < 5) {
    const next = pending.find((entry) => !entry.resolved);
    next.resolved = true;
    next.request.resolve(bundle(next.wo));
    await flush();
    assert.ok(active <= 3);
  }
  pending.filter((entry) => !entry.resolved).forEach((entry) => entry.request.resolve(bundle(entry.wo)));
  await flush();

  assert.equal(maximumActive, 3);
});

test("seleccionar una WO que se precarga comparte la misma promesa", async () => {
  const requests = new Map();
  const calls = [];
  const { app, byId } = createHarness((method, args) => {
    if (method === "getInspectionWorkOrders") return Promise.resolve({ ok: true, data: [{ wo: "100", article: "A", quantity: 1 }] });
    calls.push({ method, wo: args[0] });
    const request = deferred();
    requests.set(args[0], request);
    return request.promise;
  });

  await app.loadList();
  await flush();
  byId("inspectionWorkOrder").value = "100";
  const selected = app.loadDetail();

  assert.deepEqual(calls, [{ method: "getInspectionWorkOrderBundle", wo: "100" }]);
  requests.get("100").resolve(bundle("100"));
  await selected;
  assert.match(byId("inspectionSheetGrid").innerHTML, />100</);
});

test("la recarga fuerza otra llamada aunque exista una carga normal pendiente", async () => {
  const requests = [];
  const { app, byId } = createHarness((method, args) => {
    const request = deferred();
    requests.push({ method, args, request });
    return request.promise;
  });
  byId("inspectionWorkOrder").value = "200";

  const normalLoad = app.loadDetail();
  const forcedLoad = byId("inspectionReload").dispatch("click");

  assert.equal(requests.length, 2);
  assert.equal(requests[0].method, "getInspectionWorkOrderBundle");
  assert.equal(requests[1].method, "getInspectionWorkOrderBundle");
  assert.deepEqual(structuredClone(requests[0].args), ["200"]);
  assert.deepEqual(structuredClone(requests[1].args), ["200", { forceRefresh: true }]);
  requests[1].request.resolve(bundle("200-forzada"));
  await forcedLoad;
  requests[0].request.resolve(bundle("200-normal"));
  await normalLoad;
  assert.match(byId("inspectionSheetGrid").innerHTML, />200-forzada</);
});

test("una reseleccion posterior a forceRefresh no adopta la promesa normal anterior", async () => {
  const requests = [];
  const { app, byId } = createHarness((method, args) => {
    const request = deferred();
    requests.push({ args, request });
    return request.promise;
  });
  byId("inspectionWorkOrder").value = "210";

  const oldNormalLoad = app.loadDetail();
  const forcedLoad = app.loadDetail({ forceRefresh: true });
  const reselectedLoad = app.loadDetail();

  assert.equal(requests.length, 3);
  assert.deepEqual(structuredClone(requests[1].args), ["210", { forceRefresh: true }]);
  requests[0].request.resolve(bundle("210-antigua"));
  await oldNormalLoad;
  await flush();
  assert.equal(requests.length, 3);
  assert.doesNotMatch(byId("inspectionSheetGrid").innerHTML, /210-antigua/);
  requests[1].request.resolve(bundle("210-forzada"));
  await forcedLoad;
  assert.doesNotMatch(byId("inspectionSheetGrid").innerHTML, /210-forzada/);
  requests[2].request.resolve(bundle("210-vigente"));
  await reselectedLoad;
  assert.match(byId("inspectionSheetGrid").innerHTML, /210-vigente/);
});

test("filtrar la WO seleccionada invalida su solicitud normal antes de reseleccionarla", async () => {
  const requests = [];
  const { app, byId } = createHarness((method, args) => {
    if (method === "getInspectionWorkOrders") return Promise.resolve({ ok: true, data: [
      { wo: "800", article: "ALFA", quantity: 1 },
      { wo: "900", article: "BETA", quantity: 1 },
    ] });
    const request = deferred();
    requests.push({ wo: args[0], request });
    return request.promise;
  });

  await app.loadList();
  await flush();
  byId("inspectionWorkOrder").value = "800";
  const oldLoad = app.loadDetail();
  byId("inspectionSearch").value = "900";
  byId("inspectionSearch").dispatch("input");
  assert.equal(byId("inspectionWorkOrder").value, "");
  byId("inspectionSearch").value = "";
  byId("inspectionSearch").dispatch("input");
  byId("inspectionWorkOrder").value = "800";
  const reselectedLoad = app.loadDetail();

  let requests800 = requests.filter((entry) => entry.wo === "800");
  assert.equal(requests800.length, 2);
  requests800[0].request.resolve(bundle("800-antigua"));
  await oldLoad;
  await flush();
  requests800 = requests.filter((entry) => entry.wo === "800");
  assert.equal(requests800.length, 2);
  assert.doesNotMatch(byId("inspectionSheetGrid").innerHTML, /800-antigua/);
  requests800[1].request.resolve(bundle("800-vigente"));
  await reselectedLoad;
  assert.match(byId("inspectionSheetGrid").innerHTML, /800-vigente/);
  requests.find((entry) => entry.wo === "900")?.request.resolve(bundle("900"));
  await flush();
});

test("un fallo posterior al filtro no reemplaza el estado con un error obsoleto", async () => {
  let request;
  const { app, byId } = createHarness((method) => {
    if (method === "getInspectionWorkOrders") return Promise.resolve({ ok: true, data: [{ wo: "810", article: "ALFA", quantity: 1 }] });
    request = deferred();
    return request.promise;
  });

  await app.loadList();
  await flush();
  byId("inspectionWorkOrder").value = "810";
  const selectedLoad = byId("inspectionWorkOrder").dispatch("change");
  byId("inspectionSearch").value = "sin coincidencias";
  byId("inspectionSearch").dispatch("input");
  request.reject(new Error("respuesta antigua"));
  await selectedLoad;
  await flush();

  assert.doesNotMatch(byId("inspectionJobStatus").innerHTML, /Error|respuesta antigua/);
});

test("la seleccion manual respeta el limite total y ocupa el siguiente hueco antes de otra precarga", async () => {
  const requests = [];
  let active = 0;
  let maximumActive = 0;
  const { app, byId } = createHarness((method, args) => {
    if (method === "getInspectionWorkOrders") return Promise.resolve({ ok: true, data: ["1", "2", "3", "4"].map((wo) => ({ wo, article: "A", quantity: 1 })) });
    const request = deferred();
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    requests.push({ wo: args[0], request });
    return request.promise.finally(() => { active -= 1; });
  });

  await app.loadList();
  await flush();
  assert.deepEqual(requests.map((entry) => entry.wo), ["1", "2", "3"]);
  byId("inspectionWorkOrder").value = "4";
  const selectedLoad = app.loadDetail();

  assert.deepEqual(requests.map((entry) => entry.wo), ["1", "2", "3"]);
  requests[0].request.resolve(bundle("1"));
  await flush();
  assert.deepEqual(requests.map((entry) => entry.wo), ["1", "2", "3", "4"]);
  requests.find((entry) => entry.wo === "4").request.resolve(bundle("4"));
  await selectedLoad;
  assert.match(byId("inspectionSheetGrid").innerHTML, />4</);
  assert.equal(maximumActive, 3);
  requests[1].request.resolve(bundle("2"));
  await flush();
  requests.find((entry) => entry.wo === "3")?.request.resolve(bundle("3"));
  await flush();
});

test("una respuesta loadList obsoleta no reemplaza ni encola sobre la lista vigente", async () => {
  const listRequests = [];
  const pending = [];
  let active = 0;
  let maximumActive = 0;
  const { app } = createHarness((method, args) => {
    if (method === "getInspectionWorkOrders") {
      const request = deferred();
      listRequests.push(request);
      return request.promise;
    }
    const request = deferred();
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    pending.push({ wo: args[0], request });
    return request.promise.finally(() => { active -= 1; });
  });

  const firstList = app.loadList();
  const secondList = app.loadList();
  listRequests[0].resolve({ ok: true, data: ["1", "2", "3", "4", "5"].map((wo) => ({ wo, article: "A", quantity: 1 })) });
  listRequests[1].resolve({ ok: true, data: ["6", "7", "8", "9", "10"].map((wo) => ({ wo, article: "B", quantity: 1 })) });
  await secondList;
  await flush();
  assert.equal(pending.length, 3);
  await firstList;
  await flush();
  assert.deepEqual(pending.map((entry) => entry.wo), ["6", "7", "8"]);

  while (pending.length < 5) {
    const next = pending.find((entry) => !entry.resolved);
    next.resolved = true;
    next.request.resolve(bundle(next.wo));
    await flush();
    assert.ok(active <= 3);
  }
  pending.filter((entry) => !entry.resolved).forEach((entry) => entry.request.resolve(bundle(entry.wo)));
  await flush();

  assert.equal(maximumActive, 3);
  assert.deepEqual(pending.map((entry) => entry.wo), ["6", "7", "8", "9", "10"]);
});

test("la lista vigente elimina precargas pendientes obsoletas y conserva activas compartidas", async () => {
  const listRequests = [];
  const bundleRequests = [];
  const { app } = createHarness((method, args) => {
    if (method === "getInspectionWorkOrders") {
      const request = deferred();
      listRequests.push(request);
      return request.promise;
    }
    const request = deferred();
    bundleRequests.push({ wo: args[0], request });
    return request.promise;
  });

  const firstList = app.loadList();
  listRequests[0].resolve({ ok: true, data: ["1", "2", "3", "4", "5"].map((wo) => ({ wo, article: "A", quantity: 1 })) });
  await firstList;
  await flush();
  assert.deepEqual(bundleRequests.map((entry) => entry.wo), ["1", "2", "3"]);

  const secondList = app.loadList();
  listRequests[1].resolve({ ok: true, data: ["2", "6", "7", "8", "9"].map((wo) => ({ wo, article: "B", quantity: 1 })) });
  await secondList;
  bundleRequests.find((entry) => entry.wo === "1").request.resolve(bundle("1"));
  await flush();
  assert.deepEqual(bundleRequests.map((entry) => entry.wo), ["1", "2", "3", "6"]);
  bundleRequests.find((entry) => entry.wo === "2").request.resolve(bundle("2"));
  await flush();
  assert.deepEqual(bundleRequests.map((entry) => entry.wo), ["1", "2", "3", "6", "7"]);
  assert.equal(bundleRequests.filter((entry) => entry.wo === "2").length, 1);

  while (bundleRequests.length < 6) {
    const next = bundleRequests.find((entry) => !entry.resolved && !["1", "2"].includes(entry.wo));
    next.resolved = true;
    next.request.resolve(bundle(next.wo));
    await flush();
  }
  bundleRequests.filter((entry) => !entry.resolved && !["1", "2"].includes(entry.wo)).forEach((entry) => entry.request.resolve(bundle(entry.wo)));
  await flush();
  assert.deepEqual(bundleRequests.map((entry) => entry.wo), ["1", "2", "3", "6", "7", "8", "9"]);
});

test("un fallo de precarga es silencioso y la seleccion vuelve a intentar", async () => {
  let bundleCalls = 0;
  const { app, byId } = createHarness(async (method, args) => {
    if (method === "getInspectionWorkOrders") return { ok: true, data: [{ wo: "300", article: "A", quantity: 1 }] };
    bundleCalls += 1;
    return bundleCalls === 1 ? { ok: false, error: "fallo de precarga" } : bundle(args[0]);
  });

  await app.loadList();
  await flush();
  assert.equal(bundleCalls, 1);
  assert.doesNotMatch(byId("inspectionJobStatus").innerHTML, /Error|fallo de precarga/);

  byId("inspectionWorkOrder").value = "300";
  await app.loadDetail();

  assert.equal(bundleCalls, 2);
  assert.match(byId("inspectionSheetGrid").innerHTML, />300</);
});

test("una respuesta atrasada no reemplaza la WO seleccionada", async () => {
  const requests = new Map();
  const methods = [];
  const { app, byId } = createHarness((method, args) => {
    methods.push(method);
    const request = deferred();
    requests.set(args[0], request);
    return request.promise;
  });

  byId("inspectionWorkOrder").value = "400";
  const firstLoad = app.loadDetail();
  byId("inspectionWorkOrder").value = "500";
  const secondLoad = app.loadDetail();
  assert.deepEqual(methods, ["getInspectionWorkOrderBundle", "getInspectionWorkOrderBundle"]);
  requests.get("500").resolve(bundle("500"));
  await secondLoad;
  requests.get("400").resolve(bundle("400"));
  await firstLoad;

  assert.match(byId("inspectionSheetGrid").innerHTML, />500</);
  assert.match(byId("inspectionHistory").innerHTML, /Fecha 500/);
  assert.doesNotMatch(byId("inspectionSheetGrid").innerHTML, />400</);
});

test("la cache local vence exactamente a los cinco minutos", async () => {
  let calls = 0;
  const now = { value: 1_000 };
  const { app, byId } = createHarness(async (method, args) => {
    assert.equal(method, "getInspectionWorkOrderBundle");
    calls += 1;
    return bundle(args[0]);
  }, now);
  byId("inspectionWorkOrder").value = "600";

  await app.loadDetail();
  now.value += (5 * 60 * 1000) - 1;
  await app.loadDetail();
  assert.equal(calls, 1);

  now.value += 1;
  await app.loadDetail();
  assert.equal(calls, 2);
});
/**
 * MEDIDO 2026-10-04: la banda de MP de la hoja son las celdas que van entre el ULTIMO
 * encabezado de la banda y el titulo de seccion que la cierra; antes esta el membrete de la
 * OT y despues vienen las filas de operacion, asi que ese recorte es el unico que no cuenta
 * celdas de otro bloque. `materialRow` mete 10 celdas por renglon: 2 de "Fechas de entrega",
 * 5 de la MP IZQUIERDA (insignia, descripcion, tramo, cantidad) y... las que siguen.
 */
function bandaDeMateriales(html) {
  const piezas = html.split('<div class="inspection-cell').slice(1);
  const seccion = piezas.findIndex((pieza) => pieza.includes("inspection-section-title"));
  // El titulo de seccion va PEGADO a la ultima celda de la banda (no abre `<div
  // class="inspection-cell`), asi que el corte es DESPUES de esa pieza, no en ella: si se
  // corta en ella se pierde la ultima celda y un renglon entero.
  const hasta = seccion === -1 ? piezas.length : seccion + 1;
  let ultimoEncabezado = -1;
  piezas.slice(0, hasta).forEach((pieza, indice) => { if (pieza.includes("inspection-head")) ultimoEncabezado = indice; });
  const contenido = (pieza) => (pieza.indexOf("</div>") === -1 ? pieza : pieza.slice(0, pieza.indexOf("</div>")));
  const banda = piezas.slice(ultimoEncabezado + 1, hasta).map(contenido);
  const filas = [];
  for (let indice = 0; indice + 9 < banda.length; indice += 10) {
    const celdas = banda.slice(indice, indice + 10);
    // Las posiciones 2 y 6 son las insignias de MP (izquierda y derecha) y la 5 y la 9 las
    // cantidades: eso es lo que dice `materialRow` (inspection-app.js:407).
    filas.push({ celdas, izquierda: celdas[2], derecha: celdas[6] });
  }
  return filas;
}

/**
 * El nombre de la MP que se ve en una celda de la banda. `materialBadge` pinta
 * `<span class="inspection-mat ..." title="...">NOMBRE</span>`, y el `title` va con el texto
 * dentro del mismo elemento: por eso el patron salta hasta el primer `>` en vez de terminar
 * la clase con `"`.
 */
function mpDe(celda) {
  const insignia = /<span class="inspection-mat[^>]*>([^<]*)<\/span>/.exec(celda || "");
  return insignia ? insignia[1] : "";
}

/** Levanta la hoja con una OT que trae estos materiales y la deja pintada. */
async function hojaCon(materials, wo = "3374") {
  const { app, byId } = createHarness(async (method, args) => {
    assert.equal(method, "getInspectionWorkOrderBundle");
    return {
      ok: true,
      data: {
        detail: {
          workOrder: { wo, article: `ART-${wo}`, status: "En curso", quantity: 20, dueDate: "2026-10-10" },
          operations: [],
          materials,
        },
        history: { count: 0, history: [] },
      },
    };
  });
  byId("inspectionWorkOrder").value = wo;
  await app.loadDetail();
  return { byId, html: byId("inspectionSheetGrid").innerHTML };
}

test("la banda de MP se llena con ceil(MP/2) renglones, IZQUIERDA y luego DERECHA", async () => {
  // Decision del usuario 2026-10-04: "empieza a poblar con las MP segun el catalogo y la tabla
  // materiales desde la izq. a la der.; si faltan filas para mostrar materiales se deben
  // agregar primero izquierda luego derecha, pero no se deben duplicar".
  //   - El orden es el de la TABLA DE MATERIALES: no se reordena nada.
  //   - Cada renglon toma dos MP del DATO, asi que hacen falta ceil(MP/2) renglones.
  //   - Con 2 MP o menos se agrega DESPUES un renglon en blanco para escribir a mano, que NO
  //     es un renglon de materiales (por eso va fuera del ciclo y no cuenta como MP).
  for (let total = 1; total <= 6; total += 1) {
    const materials = Array.from({ length: total }, (_, indice) => ({
      material: `MP${String(indice + 1).padStart(5, "0")}`,
      description: `Descripcion ${indice + 1}`,
      required: indice + 1,
      lineId: String(indice + 1),
    }));
    const { byId, html } = await hojaCon(materials, `OT-${total}`);
    const filas = bandaDeMateriales(html);
    const esperados = Math.ceil(total / 2) + (total <= 2 ? 1 : 0);
    assert.equal(filas.length, esperados, `${total} MP: ceil(${total}/2) renglones${total <= 2 ? " + 1 en blanco" : ""}`);
    const enHoja = filas.flatMap((fila) => [mpDe(fila.izquierda), mpDe(fila.derecha)]).filter(Boolean);
    // De izquierda a derecha y de arriba abajo sale el orden de la tabla, cada MP UNA vez.
    assert.deepEqual(enHoja, materials.map((material) => material.material), `${total} MP en el orden del dato`);
    assert.equal(new Set(enHoja).size, total, `${total} MP distintas: ninguna repetida`);
    // Y la hoja dice cuantas son, con la misma cuenta: el contador no puede mentir sobre la banda.
    assert.match(byId("inspectionJobStatus").innerHTML, new RegExp(`· ${total} materiales`), `${total} MP en el contador`);
  }
});

test("UNA MP, UNA VEZ: la hoja NO repite la MP aunque la base le mande la COPIA", async () => {
  // MEDIDO 2026-10-04 en la OT 3374: `materials` traia DOS filas de MP00153 (la del ERP con
  // `line_id` '2' y la COPIA con `line_id` = UUID, porque la pagina escribia el UUID de la fila
  // leida), y al pintarse en pares la MP salia DOS VECES lado a lado. Este test mete esa misma
  // pareja tal cual: la hoja tiene que mostrar una sola vez aunque la base este sucia.
  const { html } = await hojaCon([
    { material: "MP00153", description: "Tornillo", required: 4, lineId: "2" },
    { material: "MP00153", description: "Tornillo", required: 4, lineId: "68d0519a-c1f3421a" },
    { material: "MP00094", description: "Tubo", required: 6.27, lineId: "3" },
  ]);
  const filas = bandaDeMateriales(html);

  // 3 filas de tabla con una repetida son 2 MP: un renglon con las dos y el renglon en blanco.
  assert.equal(filas.length, 2, "3 filas de tabla con una repetida: un renglon con dos MP y el en blanco");
  assert.deepEqual([mpDe(filas[0].izquierda), mpDe(filas[0].derecha)], ["MP00153", "MP00094"]);
  assert.equal((html.match(/>MP00153<\/span>/g) || []).length, 1, "una sola insignia de MP00153 en toda la hoja");
  // Las CANTIDADES no se suman ni se eligen: cada renglon del BOM se queda con la suya, y la
  // MP00094 conserva su 6.27 (medido: es la del renglon 3, no la del 2).
  assert.match(filas[0].celdas[5], />4$/, "la MP00153 conserva su cantidad");
  assert.match(filas[0].celdas[9], />6\.27$/, "la MP00094 conserva su cantidad");
  assert.equal((html.match(/>4<\/div>/g) || []).length, 1, "y el 4 no sale dos veces porque la MP se repitio");
});

test("el ORDEN de la banda es el del Detalle OT, no el alfabetico (OT 3747)", async () => {
  // MEDIDO 2026-10-04, lo que reporto el usuario de la OT 3747: el Detalle OT empieza con
  // MP00070 y la hoja arrancaba con COMP-6076. La banda no se reordena NADA: se pinta en el
  // orden en que llegan los materiales, que es el orden del Detalle OT.
  // Y el llenado es el que pidio el usuario, textual: "izq. el primero, derecha el segundo,
  // luego izq. abajo de el el tercero y derecha el cuarto", o sea POR RENGLONES de dos.
  // Con cuatro MP son dos renglones, y ninguno en blanco (el renglon en blanco solo se agrega
  // cuando sobran celdas, o sea con dos MP o menos, para poder escribir a mano).
  const { html } = await hojaCon([
    { material: "MP00070", description: 'Tubo de 1" x 6mts Cal. 16', required: 0.25, lineId: "2" },
    { material: "D88-6076A", description: "BRACKET CAL. 10", required: 5, lineId: "3" },
    { material: "D88-6076B", description: "BRACKET CAL. 10", required: 5, lineId: "4" },
    { material: "COMP-6076", description: "COMPONENTE PARA EL D88-6076", required: 5, lineId: "1" },
  ], "3747");
  const filas = bandaDeMateriales(html);

  assert.equal(filas.length, 2, "cuatro MP: ceil(4/2) = 2 renglones, sin renglon en blanco");
  // IZQ el primero (MP00070), DER el segundo (D88-6076A).
  assert.equal(mpDe(filas[0].izquierda), "MP00070", "renglon 1 izq: el primero del Detalle");
  assert.equal(mpDe(filas[0].derecha), "D88-6076A", "renglon 1 der: el segundo del Detalle");
  // Abajo del primero el tercero, a la derecha el cuarto.
  assert.equal(mpDe(filas[1].izquierda), "D88-6076B", "renglon 2 izq: el tercero del Detalle");
  assert.equal(mpDe(filas[1].derecha), "COMP-6076", "renglon 2 der: el cuarto del Detalle");
  // Y el orden ALFABETico es el que salia antes (COMP, D88-A, D88-B, MP), o sea que este test
  // no pasa por casualidad: si alguien vuelve a ordenar, las cuatro aserciones de arriba caEN.
  assert.notDeepEqual(mpDe(filas[0].izquierda), "COMP-6076", "la banda no puede arrancar en alfabetico");
});

test("una OT sin MP imprime la banda vacia con la fecha de entrega, y no es un fallo", async () => {
  const { html } = await hojaCon([], "9999");
  const filas = bandaDeMateriales(html);
  assert.equal(filas.length, 2, "una fila con la etiqueta de fecha y una en blanco para escribir a mano");
  assert.deepEqual([mpDe(filas[0].izquierda), mpDe(filas[0].derecha)], ["", ""]);
  assert.match(filas[0].celdas[0], /Fechas de entrega:/);
  assert.match(filas[0].celdas[1], /2026-10-10/, "la fecha de entrega va en la PRIMERA fila");
});
