import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/web/inspection/inspection-app.js", import.meta.url), "utf8");

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
    PPAppsScriptBridge: { call: callBackend },
    InspectionCore: {
      initialOperationSelection: (operations) => Object.fromEntries(operations.map((operation, index) => [operation.id || operation.code || String(index), true])),
      inspectionMaterials: (materials) => materials,
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

test("precarga solamente las primeras cinco WOs", async () => {
  const bundleCalls = [];
  const { app } = createHarness(async (method, args) => {
    if (method === "getInspectionWorkOrders") return { ok: true, data: Array.from({ length: 7 }, (_, index) => ({ wo: String(index + 1), article: "A", quantity: 1 })) };
    bundleCalls.push(args[0]);
    return bundle(args[0]);
  });

  await app.loadList();
  await flush();

  assert.deepEqual(bundleCalls, ["1", "2", "3", "4", "5"]);
});

test("limita a dos las precargas simultaneas", async () => {
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
  assert.equal(pending.length, 2);

  while (pending.length < 5) {
    const next = pending.find((entry) => !entry.resolved);
    next.resolved = true;
    next.request.resolve(bundle(next.wo));
    await flush();
    assert.ok(active <= 2);
  }
  pending.filter((entry) => !entry.resolved).forEach((entry) => entry.request.resolve(bundle(entry.wo)));
  await flush();

  assert.equal(maximumActive, 2);
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

  assert.equal(requests.length, 2);
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
  assert.equal(requests800.length, 1);
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
  assert.deepEqual(requests.map((entry) => entry.wo), ["1", "2"]);
  byId("inspectionWorkOrder").value = "4";
  const selectedLoad = app.loadDetail();

  assert.deepEqual(requests.map((entry) => entry.wo), ["1", "2"]);
  requests[0].request.resolve(bundle("1"));
  await flush();
  assert.deepEqual(requests.map((entry) => entry.wo), ["1", "2", "4"]);
  requests[2].request.resolve(bundle("4"));
  await selectedLoad;
  assert.match(byId("inspectionSheetGrid").innerHTML, />4</);
  assert.equal(maximumActive, 2);
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
  assert.equal(pending.length, 2);
  await firstList;
  await flush();
  assert.deepEqual(pending.map((entry) => entry.wo), ["6", "7"]);

  while (pending.length < 5) {
    const next = pending.find((entry) => !entry.resolved);
    next.resolved = true;
    next.request.resolve(bundle(next.wo));
    await flush();
    assert.ok(active <= 2);
  }
  pending.filter((entry) => !entry.resolved).forEach((entry) => entry.request.resolve(bundle(entry.wo)));
  await flush();

  assert.equal(maximumActive, 2);
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
  assert.deepEqual(bundleRequests.map((entry) => entry.wo), ["1", "2"]);

  const secondList = app.loadList();
  listRequests[1].resolve({ ok: true, data: ["2", "6", "7", "8", "9"].map((wo) => ({ wo, article: "B", quantity: 1 })) });
  await secondList;
  bundleRequests.find((entry) => entry.wo === "1").request.resolve(bundle("1"));
  await flush();
  assert.deepEqual(bundleRequests.map((entry) => entry.wo), ["1", "2", "6"]);
  bundleRequests.find((entry) => entry.wo === "2").request.resolve(bundle("2"));
  await flush();
  assert.deepEqual(bundleRequests.map((entry) => entry.wo), ["1", "2", "6", "7"]);
  assert.equal(bundleRequests.filter((entry) => entry.wo === "2").length, 1);

  while (bundleRequests.length < 6) {
    const next = bundleRequests.find((entry) => !entry.resolved && !["1", "2"].includes(entry.wo));
    next.resolved = true;
    next.request.resolve(bundle(next.wo));
    await flush();
  }
  bundleRequests.filter((entry) => !entry.resolved && !["1", "2"].includes(entry.wo)).forEach((entry) => entry.request.resolve(bundle(entry.wo)));
  await flush();
  assert.deepEqual(bundleRequests.map((entry) => entry.wo), ["1", "2", "6", "7", "8", "9"]);
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
