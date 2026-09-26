import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/server/08-netsuite.js", import.meta.url), "utf8");

test("el filtro conserva variantes activas y excluye solo estados terminales", () => {
  const context = load().context;

  assert.equal(context.PP_isSchedulable_({ Estado: "No iniciada" }), true);
  assert.equal(context.PP_isSchedulable_({ Estado: "In Process" }), true);
  assert.equal(context.PP_isSchedulable_({ Estado: "Pendiente de liberación" }), true);
  assert.equal(context.PP_isSchedulable_({ Estado: "Completado" }), false);
  assert.equal(context.PP_isSchedulable_({ Estado: "Completar" }), false);
  assert.equal(context.PP_isSchedulable_({ status_op: "COMPLETED" }), false);
  assert.equal(context.PP_isSchedulable_({ Estado: "Closed" }), false);
});

function load(responses = [], cacheOptions = {}) {
  const requests = [];
  const sleeps = [];
  const cacheEntries = new Map(Object.entries(cacheOptions.entries || {}));
  const propertyEntries = new Map(Object.entries(cacheOptions.propertyEntries || {}));
  const cachePuts = [];
  let lockHeld = false;
  let lockAttempts = 0;
  const context = {
    console,
    Date,
    JSON,
    Math,
    Object,
    String,
    Number,
    Array,
    encodeURIComponent,
    Utilities: {
      getUuid: () => "test-uuid",
      computeHmacSha256Signature: () => [1, 2, 3],
      base64Encode: () => "signature",
      formatDate: () => "2026-07-26",
      sleep: (ms) => sleeps.push(ms),
    },
    // PP_invoiceAverageWindow_ formatea la ventana de 6 meses con la zona del script.
    Session: { getScriptTimeZone: () => "America/Mexico_City" },
    UrlFetchApp: {
      fetch(url, options) {
        requests.push({ url, options });
        if (cacheOptions.onFetch) cacheOptions.onFetch();
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return {
          getResponseCode: () => response?.status ?? 200,
          getContentText: () => response?.body ?? "{}",
        };
      },
    },
    CacheService: {
      getScriptCache() {
        if (cacheOptions.cacheServiceError) throw cacheOptions.cacheServiceError;
        return {
          get(key) {
            if (cacheOptions.getError) throw cacheOptions.getError;
            return cacheEntries.get(key) || null;
          },
          put(key, value, ttl) {
            cachePuts.push({ key, value, ttl });
            if (cacheOptions.putError) throw cacheOptions.putError;
            cacheEntries.set(key, value);
          },
        };
      },
    },
    PropertiesService: {
      getScriptProperties() {
        if (cacheOptions.propertiesServiceError) throw cacheOptions.propertiesServiceError;
        return {
          getProperty(key) {
            if (cacheOptions.propertyGetError) throw cacheOptions.propertyGetError;
            return propertyEntries.get(key) || null;
          },
          setProperty(key, value) {
            if (cacheOptions.propertySetError) throw cacheOptions.propertySetError;
            propertyEntries.set(key, value);
          },
        };
      },
    },
    LockService: {
      getScriptLock() {
        if (cacheOptions.lockServiceError) throw cacheOptions.lockServiceError;
        return {
          tryLock() {
            lockAttempts += 1;
            if (cacheOptions.onTryLock) cacheOptions.onTryLock(cacheEntries);
            if (lockHeld || cacheOptions.lockUnavailable) return false;
            lockHeld = true;
            return true;
          },
          releaseLock() {
            lockHeld = false;
          },
        };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "08-netsuite.js" });
  context.PP_normalizeKey_ = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
  // PP_enrichWorkOrderPhotos_ vive en otro archivo de servidor y solo agrega la foto; este
  // contexto corre 08-netsuite.js solo, asi que se sustituye por la identidad.
  context.PP_enrichWorkOrderPhotos_ = (items) => items;
  return { context, requests, sleeps, cachePuts, propertyEntries, getLockAttempts: () => lockAttempts };
}

const config = {
  accountId: "ACME_SB1",
  consumerKey: "consumer",
  consumerSecret: "consumer-secret",
  token: "token",
  tokenSecret: "token-secret",
  locationId: 1,
};

const catalogPage = {
  body: JSON.stringify({
    items: [{ work_center: "CT 5467 - Corte", operation_name: "Corte final" }],
    hasMore: false,
  }),
};

const salesPricesPage = {
  body: JSON.stringify({
    ok: true,
    headers: ["_ITEM_ID", "PARTE", "PRECIO BASE MNX", "CANTIDAD ORDEN", "FECHA DE ORDEN", "MONEDA", "TIPO CAMBIO"],
    rows: [
      [1001, "D66-2896", 40, 10, "10/01/2026 10:00 AM", "Peso Mexicano", 1],
      [1001, "D66-2896", 100, 5, "10/06/2026 10:00 AM", "Peso Mexicano", 1],
      [1001, "D66-2896", 200, 1, "10/09/2026 10:00 AM", "Peso Mexicano", 1],
      [2425, "C 490 UADE PN", 725.19, 15, "2026-09-02 10:40:08", "US Dollar", 16.9755],
    ],
    hasMore: false,
  }),
};

test("precios de venta salen del restlet 1766 REQ_FIFO (ultima venta y promedio ponderado 6m)", () => {
  const { context, requests } = load([salesPricesPage]);

  const prices = context.PP_fetchSalesPricesRestlet_(config, { from: "2026-03-05", to: "2026-09-10" });

  assert.match(requests[0].url, /script=1766/);
  assert.match(requests[0].options.payload, /"table":"REQ_FIFO"/);
  assert.equal(prices.lastByItem["1001"], 200);
  assert.equal(prices.lastByItem["D66-2896"], 200);
  assert.ok(Math.abs(prices.avgByItem["1001"] - (100 * 5 + 200 * 1) / 6) < 1e-9);
  assert.equal(prices.lastByItem["C 490 UADE PN"], 725.19);
  assert.equal(prices.lastByItem["2425"], 725.19);
  assert.equal(prices.from, "2026-03-05");
  assert.equal(prices.to, "2026-09-10");
});

test("PP_buildWorkOrderCatalog_ lee Articulo acentuado de WO_LISTA y matchea precio por nombre", () => {
  const { context } = load([salesPricesPage]);
  const prices = context.PP_fetchSalesPricesRestlet_(config, { from: "2026-03-05", to: "2026-09-10" });

  const catalog = context.PP_buildWorkOrderCatalog_([
    {
      "WO Internal ID": "22983",
      "WO Folio": "3386",
      "Artículo": "C 490 UADE PN",
      "Descripción": "C 490",
      "Cantidad": "15",
      "Fecha de vencimiento": "14/08/2026",
      "Estatus": "En curso",
      "Cliente": "",
    },
  ], []);

  assert.equal(catalog[0].ot, "3386");
  assert.equal(catalog[0].item, "C 490 UADE PN");
  assert.equal(catalog[0].itemId, "");

  const applied = context.PP_applySalesPrices_(catalog, prices);
  assert.equal(applied[0].lastSalePrice, 725.19);
  assert.ok(applied[0].averageSalePrice > 0);
});

const pricePage = (rows, hasMore = false) => ({
  // ok: true es obligatorio: PP_netSuiteRestletRequest_ solo acepta un 2xx cuyo cuerpo trae
  // ok === true, y sin eso la pagina se toma por fallo y PP_fetchRestletPages_ lanza.
  body: JSON.stringify({
    ok: true,
    headers: ["_ITEM_ID", "PARTE", "PRECIO BASE MNX", "CANTIDAD ORDEN", "FECHA DE ORDEN"],
    rows,
    hasMore,
  }),
  status: 200,
});
const priceRow = (id, price, qty, date) => ({
  _ITEM_ID: id, PARTE: `ART-${id}`, "PRECIO BASE MNX": String(price), "CANTIDAD ORDEN": String(qty), "FECHA DE ORDEN": date,
});
const invoiceWindow = { from: "2026-03-26", to: "2026-09-26" };
// PP_netSuiteConfig_ lee las credenciales de Script Properties; el harness las trae vacias.
const nsCredentials = {
  NS_ACCOUNT_ID: config.accountId,
  NS_CONSUMER_KEY: config.consumerKey,
  NS_CONSUMER_SECRET: config.consumerSecret,
  NS_TOKEN: config.token,
  NS_TOKEN_SECRET: config.tokenSecret,
};

test("los precios de venta se cachean una hora y no vuelven a pedir el 1766", () => {
  const pages = [pricePage([priceRow("1001", 500, 10, "26/03/2026")], false)];
  const { context, requests, cachePuts } = load(pages);

  const first = context.PP_fetchSalesPricesRestletCached_(config, invoiceWindow);
  const second = context.PP_fetchSalesPricesRestletCached_(config, invoiceWindow);

  assert.equal(first.ok, true);
  assert.equal(first.prices.lastByItem["1001"], 500);
  assert.equal(second.ok, true, "la segunda llamada se resuelve desde el cache");
  assert.equal(second.prices.lastByItem["1001"], 500, "y entrega el mismo precio");
  assert.equal(requests.length, 1, "el 1766 solo se consulta una vez");
  assert.equal(cachePuts.length, 1);
  assert.equal(cachePuts[0].ttl, 3600, "una hora: el precio no manda en la frescura del plan");
  assert.match(cachePuts[0].key, /^NS_SALES_PRICES_V1_/);
  assert.match(cachePuts[0].key, /2026-03-26_2026-09-26$/, "la ventana de 6 meses va en la clave");
});

test("un cambio de ventana de precios invalida el promedio cacheado", () => {
  const { context, requests } = load([
    pricePage([priceRow("1001", 500, 10, "26/03/2026")], false),
    pricePage([priceRow("1001", 800, 10, "26/04/2026")], false),
  ]);

  const primera = context.PP_fetchSalesPricesRestletCached_(config, invoiceWindow);
  const otraVentana = context.PP_fetchSalesPricesRestletCached_(config, { from: "2026-04-26", to: "2026-10-26" });

  assert.equal(primera.prices.lastByItem["1001"], 500);
  assert.equal(otraVentana.ok, true, "una ventana distinta no puede servirse desde el cache viejo");
  assert.equal(otraVentana.prices.lastByItem["1001"], 800);
  assert.equal(requests.length, 2, "y se vuelve a consultar el 1766");
});

test("un cache corrupto o de otra forma se descarta y se vuelve a consultar", () => {
  const entradas = {
    NS_SALES_PRICES_V1_ACME_SB1_1_2026_03_26_2026_09_26: JSON.stringify({ source: "OTRO", from: "2026-03-26", to: "2026-09-26", lastByItem: { 1001: 1 }, avgByItem: {} }),
  };
  const { context, requests } = load([pricePage([priceRow("1001", 777, 10, "26/03/2026")], false)], { entries: entradas });

  const result = context.PP_fetchSalesPricesRestletCached_(config, invoiceWindow);

  assert.equal(result.prices.lastByItem["1001"], 777, "el precio viene de NetSuite, no del cache invalido");
  assert.equal(requests.length, 1);
});

test("si el lock no se puede tomar se degrada sin error y sin golpear el 1766", () => {
  const { context, requests } = load([pricePage([], false)], { lockUnavailable: true });

  const result = context.PP_fetchSalesPricesRestletCached_(config, invoiceWindow);

  assert.equal(result.ok, false);
  assert.match(result.prices.warning, /actualizacion en curso/);
  assert.equal(requests.length, 0, "sin lock no se consulta: asi no se gastan llamadas en paralelo");
});

test("un fallo del 1766 no se cachea y el cooldown evita la tormenta de reintentos", () => {
  const { context, requests, propertyEntries } = load([pricePage([], false)], {
    onFetch: () => { throw new Error("NetSuite no respondio"); },
  });

  const fallido = context.PP_fetchSalesPricesRestletCached_(config, invoiceWindow);
  const duranteCooldown = load([], { propertyEntries: Object.fromEntries(propertyEntries) }).context
    .PP_fetchSalesPricesRestletCached_(config, invoiceWindow);

  assert.equal(fallido.ok, false);
  assert.match(fallido.prices.warning, /NetSuite no respondio/);
  assert.equal(duranteCooldown.ok, false);
  assert.match(duranteCooldown.prices.warning, /cooldown/);
  assert.ok([...propertyEntries.keys()].some((key) => key.includes("NS_SALES_PRICES_ATTEMPT_V1_")));
  assert.equal(requests.length, 1, "el cooldown evita volver a gastar la llamada");
});

test("un fallo al guardar el cache no rompe la respuesta", () => {
  const { context } = load([pricePage([priceRow("1001", 500, 10, "26/03/2026")], false)], { putError: new Error("cache.put fallo") });

  const result = context.PP_fetchSalesPricesRestletCached_(config, invoiceWindow);

  assert.equal(result.ok, true, "el precio se entrega aunque no se pueda cachear");
  assert.equal(result.prices.lastByItem["1001"], 500);
});

test("fetchNetSuiteWorkOrdersData_ usa el precio cacheado pero la lista de OTs se lee viva", () => {
  const { context, requests } = load([
    { body: JSON.stringify({ ok: true, headers: ["WO Folio", "Artículo", "Cantidad"], rows: [{ "WO Folio": "3483", "Artículo": "ART-1", "Cantidad": "10" }], hasMore: false }), status: 200 },
    pricePage([priceRow("ART-1", 900, 10, "26/03/2026")], false),
    { body: JSON.stringify({ ok: true, headers: ["WO Folio", "Artículo", "Cantidad"], rows: [{ "WO Folio": "3483", "Artículo": "ART-1", "Cantidad": "10" }], hasMore: false }), status: 200 },
  ], { propertyEntries: nsCredentials });

  const primero = context.PP_fetchNetSuiteWorkOrdersData_();
  const segundo = context.PP_fetchNetSuiteWorkOrdersData_();

  assert.equal(primero.workOrders[0].lastSalePrice, 900);
  assert.equal(segundo.workOrders[0].lastSalePrice, 900, "el precio sale del cache");
  const llamadasOTs = requests.filter((request) => /WO_LISTA/.test(request.options.payload));
  assert.equal(llamadasOTs.length, 2, "pero la lista de OTs se vuelve a leer en cada sincronizacion");
  const llamadasPrecios = requests.filter((request) => /REQ_FIFO/.test(request.options.payload));
  assert.equal(llamadasPrecios.length, 1, "el 1766 solo se golpea una vez: ese es el ahorro de cuota");
  assert.ok(primero.fetchedAt, "fetchedAt sigue reflejando la lectura viva, no la del cache");
});

test("PP_fetchRestletPages_ pide 1000 filas al 1766 y 200 al resto", () => {
  const page1 = {
    ok: true,
    headers: ["_ITEM_ID", "PRECIO BASE MNX"],
    rows: [{ _ITEM_ID: "1001", "PRECIO BASE MNX": "500" }],
    hasMore: true,
  };
  const page2 = { ok: true, headers: ["_ITEM_ID"], rows: [], hasMore: false };
  const precios = load([{ status: 200, body: JSON.stringify(page1) }, { status: 200, body: JSON.stringify(page2) }]);
  const config = { accountId: "ACME_SB1", consumerKey: "c", consumerSecret: "cs", token: "t", tokenSecret: "ts", locationId: 1 };

  precios.context.PP_fetchRestletPages_({ script: "1766", deploy: "1" }, { table: "REQ_FIFO" }, config, 5);

  const pedidos = precios.requests.map((request) => JSON.parse(request.options.payload).pageSize);
  assert.deepEqual(pedidos, [1000, 1000], "el 1766 admite 1000 y se usa en produccion con ese tamano");

  const otros = load([{ status: 200, body: JSON.stringify(page1) }, { status: 200, body: JSON.stringify(page2) }]);
  otros.context.PP_fetchRestletPages_({ script: "1764", deploy: "1" }, { table: "WO_LISTA" }, config, 5);
  const pedidosOtros = otros.requests.map((request) => JSON.parse(request.options.payload).pageSize);
  assert.deepEqual(pedidosOtros, [200, 200], "los demas restlets se quedan en el valor historico");
});

test("PP_applySalesPrices_ matchea por id o nombre y expone last/avg por OT", () => {
  const { context } = load();
  const prices = {
    lastByItem: { "1001": 500, "D66-2896": 500, "SOLO-NOMBRE": 40 },
    avgByItem: { "1001": 784.5, "D66-2896": 784.5, "SOLO-NOMBRE": 700 },
    from: "2026-03-05",
    to: "2026-09-10",
  };

  const applied = context.PP_applySalesPrices_([
    { itemId: "1001", item: "D66-2896" },
    { item: "SOLO-NOMBRE" },
    { item: "SIN-PRECIO" },
  ], prices);

  assert.equal(applied[0].lastSalePrice, 500);
  assert.equal(applied[0].averageSalePrice, 784.5);
  assert.equal(applied[1].lastSalePrice, 40);
  assert.equal(applied[1].averageSalePrice, 700);
  assert.equal(applied[2].lastSalePrice, 0);
  assert.equal(applied[2].averageSalePrice, 0);
  assert.equal(applied[0].averageSalePriceFrom, "2026-03-05");
  assert.equal(applied[0].averageSalePriceTo, "2026-09-10");
});

test("PP_applyNetSuiteWorkOrdersData_ retira de la cola del plan las OTs que NetSuite ya no lista abiertas", () => {
  const { context } = load();
  const current = {
    workOrders: [{ ot: "3483" }, { ot: "1905" }],
    selectedOts: ["3483", "1905", " 3483 "],
    lockedOts: ["3483", "1905"],
    expandedOts: ["1905", "2999"],
    operationPlanStatuses: { a: { ot: "3483" }, b: { ot: "1905" } },
    lastSchedule: { scheduledOts: ["3483", "1905"], generatedAt: "2026-09-25T10:00:00.000Z" },
    plant: {},
  };
  const snapshot = { workOrders: [{ ot: "1905" }], invoicePriceWindow: null };

  const merged = context.PP_applyNetSuiteWorkOrdersData_(current, snapshot);

  // 3483 esta cerrada en NetSuite: no puede seguir en la cola ni en el ultimo plan.
  assert.deepEqual(merged.selectedOts, ["1905"]);
  assert.deepEqual(merged.lockedOts, ["1905"]);
  assert.deepEqual(merged.expandedOts, ["1905"]);
  assert.deepEqual(merged.lastSchedule.scheduledOts, ["1905"]);
  assert.equal(merged.lastSchedule.generatedAt, "2026-09-25T10:00:00.000Z");
  assert.deepEqual(Object.keys(merged.operationPlanStatuses), ["b"]);
  assert.deepEqual(merged.workOrders.map((item) => item.ot), ["1905"]);
});

test("PP_applyNetSuiteWorkOrdersData_ no inventa la cola cuando el estado venia vacio", () => {
  const { context } = load();
  const snapshot = { workOrders: [{ ot: "1905" }], invoicePriceWindow: null };

  const merged = context.PP_applyNetSuiteWorkOrdersData_({ workOrders: [] }, snapshot);

  assert.deepEqual([...merged.selectedOts], []);
  assert.deepEqual([...merged.lockedOts], []);
  assert.deepEqual([...merged.expandedOts], []);
});

test("PP_applyNetSuiteWorkOrdersData_ conserva precios y foto locales cuando el snapshot llega en 0", () => {
  const { context } = load();
  const current = {
    workOrders: [
      { ot: "3424", lastSalePrice: 320, averageSalePrice: 410, averageSalePriceFrom: "2026-03-05", averageSalePriceTo: "2026-09-10", photoUrl: "local.jpg", dueDateOverride: "2026-08-01" },
    ],
    operationPlanStatuses: {},
    plant: {},
  };
  const snapshot = {
    workOrders: [
      { ot: "3424", item: "TR 350", lastSalePrice: 0, averageSalePrice: 0, photoUrl: "" },
      { ot: "3607", item: "TRA 500", lastSalePrice: 1935, averageSalePrice: 1800 },
    ],
    invoicePriceWindow: null,
  };
  const merged = context.PP_applyNetSuiteWorkOrdersData_(current, snapshot);
  const ot3424 = merged.workOrders.find((item) => item.ot === "3424");
  const ot3607 = merged.workOrders.find((item) => item.ot === "3607");

  assert.equal(ot3424.lastSalePrice, 320);
  assert.equal(ot3424.averageSalePrice, 410);
  assert.equal(ot3424.averageSalePriceFrom, "2026-03-05");
  assert.equal(ot3424.averageSalePriceTo, "2026-09-10");
  assert.equal(ot3424.photoUrl, "local.jpg");
  assert.equal(ot3424.dueDateOverride, "2026-08-01");
  assert.equal(ot3607.lastSalePrice, 1935);
});

test("catálogo maestro reutiliza caché por una hora", () => {
  const { context, requests, cachePuts } = load([catalogPage]);

  const first = context.PP_fetchNetSuiteOperationCatalogCached_(config);
  const second = context.PP_fetchNetSuiteOperationCatalogCached_(config);

  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(second.items)), JSON.parse(JSON.stringify(first.items)));
  assert.equal(cachePuts.length, 1);
  assert.equal(cachePuts[0].key, "NS_OPERATION_CATALOG_V1_ACME_SB1_1");
  assert.equal(cachePuts[0].ttl, 3600);
});

test("caché corrupto provoca una consulta real y se reemplaza", () => {
  const key = "NS_OPERATION_CATALOG_V1_ACME_SB1_1";
  const { context, requests, cachePuts } = load([catalogPage], {
    entries: { [key]: "{json-corrupto" },
  });

  const result = context.PP_fetchNetSuiteOperationCatalogCached_(config);

  assert.equal(result.warning, "");
  assert.equal(result.items.length, 1);
  assert.equal(requests.length, 1);
  assert.equal(cachePuts.length, 1);
  assert.doesNotThrow(() => JSON.parse(cachePuts[0].value));
});

test("error HTTP conserva el catálogo anterior mediante fallback no destructivo", () => {
  const { context } = load([{ status: 500, body: "falló" }]);
  const previous = [{ key: "1::CORTE", ct: "1", label: "Corte", source: "NETSUITE_MASTER", active: true }];

  const fetched = context.PP_fetchNetSuiteOperationCatalogCached_(config);
  const resolved = context.PP_resolveOperationCatalog_(
    { operationCatalog: previous },
    { operationCatalog: fetched.items },
    [],
  );

  assert.match(fetched.warning, /catálogo.*NetSuite/i);
  assert.deepEqual(JSON.parse(JSON.stringify(resolved)), previous);
});

test("errores de lectura o escritura del caché no bloquean un catálogo válido", () => {
  for (const cacheOptions of [
    { getError: new Error("cache get no disponible") },
    { putError: new Error("payload supera límite") },
  ]) {
    const { context, requests } = load([catalogPage], cacheOptions);

    const result = context.PP_fetchNetSuiteOperationCatalogCached_(config);

    assert.equal(result.warning, "");
    assert.equal(result.items.length, 1);
    assert.equal(requests.length, 1);
  }
});

test("miss concurrente se serializa y evita una segunda consulta SuiteQL", () => {
  let concurrentResult;
  let loaded;
  let triggered = false;
  loaded = load([catalogPage], {
    onFetch() {
      if (triggered) return;
      triggered = true;
      concurrentResult = loaded.context.PP_fetchNetSuiteOperationCatalogCached_(config);
    },
  });

  const first = loaded.context.PP_fetchNetSuiteOperationCatalogCached_(config);

  assert.equal(first.items.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(concurrentResult.items)), []);
  assert.match(concurrentResult.warning, /catálogo.*NetSuite/i);
  assert.equal(loaded.requests.length, 1);
  assert.equal(loaded.getLockAttempts(), 2);
});

test("relee el caché dentro del lock antes de consultar SuiteQL", () => {
  const key = "NS_OPERATION_CATALOG_V1_ACME_SB1_1";
  const cached = [{ key: "5467::CORTE FINAL", ct: "5467", label: "Corte final", source: "NETSUITE_MASTER", active: true }];
  const { context, requests } = load([catalogPage], {
    onTryLock(entries) {
      entries.set(key, JSON.stringify(cached));
    },
  });

  const result = context.PP_fetchNetSuiteOperationCatalogCached_(config);

  assert.deepEqual(JSON.parse(JSON.stringify(result.items)), cached);
  assert.equal(requests.length, 0);
});

test("error HTTP activa cooldown por una hora y evita reconsultar", () => {
  const { context, requests, propertyEntries } = load([
    { status: 500, body: "falló" },
    catalogPage,
  ]);

  const first = context.PP_fetchNetSuiteOperationCatalogCached_(config);
  const second = context.PP_fetchNetSuiteOperationCatalogCached_(config);

  assert.deepEqual(JSON.parse(JSON.stringify(first.items)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(second.items)), []);
  assert.match(first.warning, /catálogo.*NetSuite/i);
  assert.match(second.warning, /catálogo.*NetSuite/i);
  assert.equal(requests.length, 1);
  const marker = propertyEntries.get("NS_OPERATION_CATALOG_ATTEMPT_V1_ACME_SB1_1");
  assert.match(marker, /^\d{13}$/);
  assert.ok(marker.length < 20);
});

test("cooldown aísla intentos por cuenta y ubicación", () => {
  const { context, requests } = load([
    { status: 500, body: "falló" },
    { status: 500, body: "falló" },
    { status: 500, body: "falló" },
  ]);

  context.PP_fetchNetSuiteOperationCatalogCached_(config);
  context.PP_fetchNetSuiteOperationCatalogCached_(config);
  context.PP_fetchNetSuiteOperationCatalogCached_({ ...config, accountId: "OTHER_SB1" });
  context.PP_fetchNetSuiteOperationCatalogCached_({ ...config, locationId: 2 });

  assert.equal(requests.length, 3);
});

test("fallo de cache.put activa cooldown sin descartar el primer catálogo válido", () => {
  const { context, requests } = load([catalogPage, catalogPage], {
    putError: new Error("payload supera límite"),
  });

  const first = context.PP_fetchNetSuiteOperationCatalogCached_(config);
  const second = context.PP_fetchNetSuiteOperationCatalogCached_(config);

  assert.equal(first.items.length, 1);
  assert.equal(first.warning, "");
  assert.deepEqual(JSON.parse(JSON.stringify(second.items)), []);
  assert.match(second.warning, /catálogo.*NetSuite/i);
  assert.equal(requests.length, 1);
});

test("fallo al adquirir CacheService no bloquea la consulta ni el resultado", () => {
  const { context, requests } = load([catalogPage], {
    cacheServiceError: new Error("CacheService no disponible"),
  });

  const result = context.PP_fetchNetSuiteOperationCatalogCached_(config);

  assert.equal(result.items.length, 1);
  assert.equal(result.warning, "");
  assert.equal(requests.length, 1);
});

test("fallos de lectura o escritura del cooldown aplican fail-closed sin consultar SuiteQL", () => {
  for (const cacheOptions of [
    { propertiesServiceError: new Error("properties no disponible") },
    { propertyGetError: new Error("properties get no disponible") },
    { propertySetError: new Error("properties set no disponible") },
  ]) {
    const { context, requests } = load([catalogPage], cacheOptions);

    const result = context.PP_fetchNetSuiteOperationCatalogCached_(config);

    assert.deepEqual(JSON.parse(JSON.stringify(result.items)), []);
    assert.match(result.warning, /catálogo.*NetSuite/i);
    assert.equal(requests.length, 0);
  }
});

test("fallo de LockService aplica fail-closed sin consultar SuiteQL", () => {
  const { context, requests } = load([catalogPage], {
    lockServiceError: new Error("lock no disponible"),
  });

  const result = context.PP_fetchNetSuiteOperationCatalogCached_(config);

  assert.deepEqual(JSON.parse(JSON.stringify(result.items)), []);
  assert.match(result.warning, /catálogo.*NetSuite/i);
  assert.equal(requests.length, 0);
});

test("hit con esquema, source o key inválidos se descarta y consulta SuiteQL", () => {
  const key = "NS_OPERATION_CATALOG_V1_ACME_SB1_1";
  for (const cached of [
    [{ key: "5467::CORTE", ct: "5467", label: "Corte", source: "OTRO", active: true }],
    [{ key: "5467::OTRA", ct: "5467", label: "Corte", source: "NETSUITE_MASTER", active: true }],
    [{ key: "5467::CORTE", ct: "5467", label: "Corte", source: "NETSUITE_MASTER" }],
  ]) {
    const { context, requests } = load([catalogPage], {
      entries: { [key]: JSON.stringify(cached) },
    });

    const result = context.PP_fetchNetSuiteOperationCatalogCached_(config);

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].label, "Corte final");
    assert.equal(requests.length, 1);
  }
});

test("hit válido deduplica y vuelve a excluir operaciones especiales", () => {
  const key = "NS_OPERATION_CATALOG_V1_ACME_SB1_1";
  const corte = { key: "5467::CORTE FINAL", ct: "5467", label: "Corte final", source: "NETSUITE_MASTER", active: true };
  const special = { key: "7000::CROMADO EXTERNO", ct: "7000", label: "Cromado externo", source: "NETSUITE_MASTER", active: true };
  const { context, requests } = load([], {
    entries: { [key]: JSON.stringify([corte, corte, special]) },
  });

  const result = context.PP_fetchNetSuiteOperationCatalogCached_(config);

  assert.deepEqual(JSON.parse(JSON.stringify(result.items)), [corte]);
  assert.equal(requests.length, 0);
});

test("caché aísla catálogos por cuenta y ubicación", () => {
  const { context, requests, cachePuts } = load([catalogPage, catalogPage, catalogPage]);

  context.PP_fetchNetSuiteOperationCatalogCached_(config);
  context.PP_fetchNetSuiteOperationCatalogCached_({ ...config, accountId: "OTHER_SB1" });
  context.PP_fetchNetSuiteOperationCatalogCached_({ ...config, locationId: 2 });

  assert.equal(requests.length, 3);
  assert.equal(new Set(cachePuts.map((entry) => entry.key)).size, 3);
});

test("sincronizaciones completa y de planeación usan el catálogo cacheado", () => {
  const { context } = load();
  let cachedCalls = 0;
  let uncachedCalls = 0;
  context.PP_netSuiteConfig_ = () => config;
  context.PP_fetchNetSuiteOperationCatalogCached_ = () => {
    cachedCalls += 1;
    return { items: [{ key: "5467::CORTE", ct: "5467", label: "Corte", source: "NETSUITE_MASTER", active: true }], warning: "" };
  };
  context.PP_fetchNetSuiteOperationCatalog_ = () => {
    uncachedCalls += 1;
    return { items: [], warning: "sin caché" };
  };
  context.PP_fetchRestletPages_ = () => ({ rows: [] });
  context.PP_buildPlantFilter_ = () => ({});
  context.PP_buildPlantFilterFromWorkOrders_ = () => ({});
  context.PP_belongsToPlant_ = () => true;
  context.PP_invoiceAverageWindow_ = () => ({ from: "2026-02-01", to: "2026-07-26" });
  context.PP_fetchSalesPricesRestlet_ = () => ({ lastByItem: {}, avgByItem: {}, from: "2026-02-01", to: "2026-07-26", warning: "" });
  context.PP_buildWorkOrderCatalog_ = () => [];
  context.PP_applySalesPrices_ = (items) => items;
  context.PP_enrichWorkOrderPhotos_ = (items) => items;
  context.PP_assertNetSuiteRows_ = () => {};

  context.PP_fetchNetSuitePlantData_();
  context.PP_fetchNetSuitePlanningData_({ workOrders: [{ ot: "OT-1" }] });

  assert.equal(cachedCalls, 2);
  assert.equal(uncachedCalls, 0);
});

test("catálogo maestro pagina SuiteQL, normaliza CT, deduplica y excluye subcontratos", () => {
  const first = {
    items: [
      { work_center: "CT 5467 - Soldadura", operation_name: "Soldadura de piezas" },
      { work_center: "5467 Soldadura", operation_name: "  SOLDADURA DE PIEZAS " },
      { work_center: "CT 7000", operation_name: "Cromádo externo" },
    ],
    hasMore: true,
  };
  const second = {
    items: [
      { work_center: "CT 5527 - Doblez", operation_name: "Doblez final" },
      { work_center: "CT 8000", operation_name: "Sub-contrato Maka" },
    ],
    hasMore: false,
  };
  const { context, requests } = load([
    { body: JSON.stringify(first) },
    { body: JSON.stringify(second) },
  ]);

  const result = context.PP_fetchNetSuiteOperationCatalog_(config);

  assert.equal(result.warning, "");
  assert.deepEqual(JSON.parse(JSON.stringify(result.items)), [
    { key: "5467::SOLDADURA DE PIEZAS", ct: "5467", label: "Soldadura de piezas", source: "NETSUITE_MASTER", active: true },
    { key: "5527::DOBLEZ FINAL", ct: "5527", label: "Doblez final", source: "NETSUITE_MASTER", active: true },
  ]);
  assert.match(requests[0].url, /suiteql\?limit=1000&offset=0$/);
  assert.match(requests[1].url, /suiteql\?limit=1000&offset=1000$/);
  const sql = JSON.parse(requests[0].options.payload).q;
  assert.match(sql, /manufacturingroutingstep/i);
  assert.match(sql, /manufacturingrouting/i);
  assert.match(sql, /entitygroup/i);
  assert.match(sql, /routing\.isinactive/i);
  assert.match(sql, /center\.isinactive/i);
  assert.match(sql, /routing\.id\s+AS\s+routing_id/i);
  assert.match(sql, /step\.operationsequence\s+AS\s+operation_sequence/i);
  assert.match(sql, /step\.id\s+AS\s+step_id/i);
  assert.match(sql, /ORDER BY\s+routing_id,\s*operation_sequence,\s*step_id/i);
});

test("catálogo maestro devuelve aviso breve ante HTTP, JSON o esquema inválido", () => {
  for (const response of [
    { status: 500, body: "falló" },
    { status: 200, body: "no-json" },
    { status: 200, body: JSON.stringify({ items: [{ unexpected: true }], hasMore: false }) },
  ]) {
    const { context } = load([response]);
    const result = context.PP_fetchNetSuiteOperationCatalog_(config);
    assert.deepEqual(JSON.parse(JSON.stringify(result.items)), []);
    assert.match(result.warning, /catálogo.*NetSuite/i);
    assert.ok(result.warning.length < 180);
  }
});

test("catálogo maestro rechaza hasMore ausente o con tipo distinto de boolean", () => {
  for (const page of [
    { items: [{ work_center: "CT 5467", operation_name: "Corte" }] },
    { items: [{ work_center: "CT 5467", operation_name: "Corte" }], hasMore: "false" },
  ]) {
    const { context } = load([{ body: JSON.stringify(page) }]);
    const result = context.PP_fetchNetSuiteOperationCatalog_(config);
    assert.deepEqual(JSON.parse(JSON.stringify(result.items)), []);
    assert.match(result.warning, /catálogo.*NetSuite/i);
  }
});

test("catálogo maestro rechaza toda la captura si una fila está parcialmente malformada", () => {
  const { context } = load([{
    body: JSON.stringify({
      items: [
        { work_center: "CT 5467", operation_name: "Corte" },
        { work_center: "CT 5527" },
      ],
      hasMore: false,
    }),
  }]);

  const result = context.PP_fetchNetSuiteOperationCatalog_(config);

  assert.deepEqual(JSON.parse(JSON.stringify(result.items)), []);
  assert.match(result.warning, /catálogo.*NetSuite/i);
});

test("sincronizaciones completa y de planeación conservan el catálogo anterior cuando el maestro falla", () => {
  const { context } = load();
  const previous = [{ key: "1::CORTE", ct: "1", label: "Corte", source: "NETSUITE_MASTER", active: true }];
  const current = { operations: [], workOrders: [], operationCatalog: previous };
  const snapshot = {
    workOrders: [],
    plantOperations: [],
    materials: [],
    operationCatalog: [],
    operationCatalogWarning: "Catálogo NetSuite no disponible",
  };
  const planning = context.PP_applyNetSuitePlanningData_(
    current,
    { ...snapshot, workOrders: undefined },
  );
  const complete = context.PP_applyNetSuitePlantData_(
    current,
    snapshot,
  );

  assert.deepEqual(JSON.parse(JSON.stringify(planning.operationCatalog)), previous);
  assert.equal(planning.operationCatalogWarning, "Catálogo NetSuite no disponible");
  assert.deepEqual(JSON.parse(JSON.stringify(complete.operationCatalog)), previous);
  assert.equal(complete.operationCatalogWarning, "Catálogo NetSuite no disponible");
});

test("si no existe catálogo previo el fallback conserva operaciones de las OT", () => {
  const { context } = load();
  const merged = context.PP_applyNetSuitePlanningData_(
    { operations: [], operationCatalog: [] },
    {
      plantOperations: [{ "Centro de trabajo": "5467", Operacion: "Corte" }],
      materials: [],
      operationCatalog: [],
      operationCatalogWarning: "Catálogo NetSuite no disponible",
    },
  );

  assert.equal(merged.operationCatalog.length, 1);
});

test("cantidad de operación sin columna usa el pendiente del catálogo de OTs", () => {
  const { context } = load();
  const current = {
    workOrders: [
      { ot: "2476", pendingQuantity: 3 },
      { ot: "2474", pendingQuantity: 4 },
    ],
  };
  const row = {
    "Orden de trabajo": "2476",
    Secuencia: 1,
    "Centro de trabajo": "5467",
    "Trabajo restante (min)": 7.02,
  };
  const operation = context.PP_mapNetSuiteOperation_(row, 0, current);

  assert.equal(operation.cantTotal, 3);
  assert.equal(operation.cantPendiente, 3);
});

test("mapea headers reales de ruta NetSuite (velocidad/configuracion/cantidades)", () => {
  const { context } = load();
  const current = { operations: [], workOrders: [{ ot: "2748", pendingQuantity: 100 }] };
  const row = {
    "Orden de trabajo": "2748",
    Secuencia: 96,
    "Centro de trabajo": "3OTD",
    "Operación": "3OTD",
    "Cantidad de entrada": 52,
    "Cantidad completada": 0,
    "Tiempo de configuración (minutos)": 6,
    "Velocidad de ejecución (minutos/unidad)": 1.02,
    "Trabajo restante (min)": 59.033,
  };
  const operation = context.PP_mapNetSuiteOperation_(row, 0, current);

  assert.equal(operation.cantTotal, 52);
  assert.equal(operation.cantPendiente, 52);
  assert.equal(operation.tiempoSetup, 6);
  assert.equal(operation.tiempoCiclo, 1.02);
  assert.equal(operation.tiempoProd, 53.04);
  const setupReal = context.PP_mapNetSuiteOperation_(
    { ...row, "Tiempo de configuración (minutos)": 34.8 },
    0,
    current,
  );
  assert.equal(setupReal.tiempoSetup, 34.8);
});

test("ruta directa por OT: el setuptime de manufacturingoperationtask puebla tiempoSetup", () => {
  const { context } = load();
  const current = { operations: [], workOrders: [{ ot: "1556", pendingQuantity: 15 }] };
  const row = {
    "Orden de trabajo": "1556",
    Operacion: "1OC : CORTE DE DIMENSIÓN",
    Secuencia: 1,
    "Centro de trabajo": "1OC",
    Estado: "No iniciado",
    "Cantidad a procesar": 15,
    "Tiempo estimado (min)": 19,
    "Tiempo de configuracion (minutos)": 4,
  };
  const operation = context.PP_mapNetSuiteOperation_(row, 0, current);
  assert.equal(operation.tiempoSetup, 4);
  assert.equal(operation.tiempoProd, 19);
  assert.equal(operation.maquina, "");
  assert.equal(operation.operador, "SIN_OPERADOR");
  const op2 = context.PP_mapNetSuiteOperation_(
    { ...row, Secuencia: 2, "Tiempo de configuracion (minutos)": 10, "Tiempo estimado (min)": 10 },
    1,
    current,
  );
  assert.equal(op2.tiempoSetup, 10);
});

test("nombres placeholder se detectan y los legitimos no", () => {
  const { context } = load();
  const placeholder = ["delete2", "xxx", "TEST", "test 1", "prueba", "42", "DelEtE7"];
  const legitimas = ["1OC : CORTE DE DIMENSIÓN", "test pieza 1", "delete2 op", "PROTOTIPO", "32OTD : INSPECCIÓN DE PUNTEADO", "x"];

  for (const name of placeholder) {
    assert.ok(context.PP_placeholderOperationReason_({ Operacion: name }), `se esperaba detectar ${name}`);
  }
  for (const name of legitimas) {
    assert.equal(context.PP_placeholderOperationReason_({ Operacion: name }), null, `no deberia detectar ${name}`);
  }
});

test("sync de planeación excluye operaciones placeholder y registra syncWarnings", () => {
  const { context } = load();
  const rows = [
    { "Orden de trabajo": "1905", Operacion: "delete2", Secuencia: 4, "Centro de trabajo": "5463", Estado: "No iniciado", "Cantidad a procesar": 480, "Tiempo estimado (min)": 4.8 },
    { "Orden de trabajo": "1905", Operacion: "12OTD : CORTE DE EXTREMOS", Secuencia: 5, "Centro de trabajo": "5461", Estado: "No iniciado", "Cantidad a procesar": 480, "Tiempo estimado (min)": 374.4 }
  ];
  const current = { operations: [], workOrders: [{ ot: "1905", pendingQuantity: 480 }] };
  const merged = context.PP_applyNetSuitePlanningData_(current, { plantOperations: rows, materials: [], operationCatalog: [] });

  assert.deepEqual(merged.operations.map((op) => op.descripcion), ["12OTD : CORTE DE EXTREMOS"]);
  assert.ok(merged.syncWarnings.some((warning) => warning.indexOf("delete2") >= 0 && warning.indexOf("1905") >= 0));
});

test("normaliza al operador activo y rechaza el operador foraneo inexistente", () => {
  const { context } = load();
  const base = {
    "Orden de trabajo": "2476",
    Secuencia: 1,
    "Centro de trabajo": "5467",
    "Trabajo restante (min)": 7.02,
  };
  const current = {
    operations: [],
    workOrders: [],
    operators: ["CORTADOR INICIAL", "DOBLADOR 1"],
  };

  assert.equal(
    context.PP_mapNetSuiteOperation_({ ...base, "Recurso humano": "1" }, 0, current).operador,
    "SIN_OPERADOR",
  );
  assert.equal(
    context.PP_mapNetSuiteOperation_({ ...base, "Recurso humano": "CORTADOR INICIAL" }, 0, current).operador,
    "CORTADOR INICIAL",
  );
});

test("no preserva un operador invalido ya persistido y conserva el valido", () => {
  const { context } = load();
  const base = {
    "Orden de trabajo": "2476",
    Secuencia: 1,
    "Centro de trabajo": "5467",
    "Trabajo restante (min)": 7.02,
  };
  const current = {
    operations: [
      { ot: "2476", secuencia: 1, ct: "5467", operador: "1" },
    ],
    workOrders: [],
    operators: ["CORTADOR INICIAL"],
  };

  assert.equal(
    context.PP_mapNetSuiteOperation_(base, 0, current).operador,
    "SIN_OPERADOR",
  );

  const planned = {
    operations: [
      { ot: "2476", secuencia: 1, ct: "5467", operador: "DOBLADOR 1" },
    ],
    workOrders: [],
    operators: ["CORTADOR INICIAL", "DOBLADOR 1"],
  };
  assert.equal(
    context.PP_mapNetSuiteOperation_(base, 0, planned).operador,
    "DOBLADOR 1",
  );
});

test("sin lista de operadores conserva el valor de origen", () => {
  const { context } = load();
  const base = {
    "Orden de trabajo": "2476",
    Secuencia: 1,
    "Centro de trabajo": "5467",
    "Recurso humano": "1",
  };

  assert.equal(
    context.PP_mapNetSuiteOperation_(base, 0, { workOrders: [] }).operador,
    "1",
  );
});

test("operación de OT cerrada o eliminada desaparece del sync completo", () => {
  const { context } = load();
  const current = {
    operations: [],
    workOrders: [
      { ot: "2476", workOrderId: "1001", pendingQuantity: 3 },
      { ot: "2474", workOrderId: "1002", pendingQuantity: 4 },
    ],
    operationCatalog: [],
  };
  const snapshot = {
    workOrders: current.workOrders,
    plantOperations: [
      {
        "Orden de trabajo": "2476",
        "WO Internal ID": "1001",
        Secuencia: 1,
        "Centro de trabajo": "5467",
        "Trabajo restante (min)": 7.02,
      },
      {
        "Orden de trabajo": "2499",
        "WO Internal ID": "1099",
        Secuencia: 1,
        "Centro de trabajo": "5467",
      },
    ],
    materials: [],
    operationCatalog: [],
    operationCatalogWarning: "",
  };
  const merged = context.PP_applyNetSuitePlantData_(current, snapshot);

  assert.equal(merged.operations.length, 1);
  assert.equal(merged.operations[0].ot, "2476");
  assert.equal(merged.operations[0].cantTotal, 3);
});

test("operación de OT cerrada o eliminada desaparece del sync de planeación", () => {
  const { context } = load();
  const current = {
    operations: [],
    workOrders: [
      { ot: "2476", pendingQuantity: 3 },
      { ot: "2474", pendingQuantity: 4 },
    ],
    operationCatalog: [],
  };
  const snapshot = {
    plantOperations: [
      {
        "Orden de trabajo": "2476",
        Secuencia: 1,
        "Centro de trabajo": "5467",
        "Trabajo restante (min)": 7.02,
      },
      {
        "Orden de trabajo": "2499",
        Secuencia: 1,
        "Centro de trabajo": "5467",
      },
    ],
    materials: [],
    operationCatalog: [],
    operationCatalogWarning: "",
  };
  const merged = context.PP_applyNetSuitePlanningData_(current, snapshot);

  assert.equal(merged.operations.length, 1);
  assert.equal(merged.operations[0].ot, "2476");
  assert.equal(merged.operations[0].cantTotal, 3);
});

test("RESTlet 2240: la fila con id emite operationId estable ns-<id> (no posicional)", () => {
  const { context } = load();
  const current = { operations: [], workOrders: [{ ot: "3427", pendingQuantity: 10 }] };
  const row = {
    id: "5507",
    workorder_id: "981",
    workorder_tranid: "3427",
    item_name: "CCA 419 A",
    operation: "FORMADO",
    sequence: "1",
    qty_to_process: "10",
    start_planned: "2026-09-30",
    end_planned: "2026-09-30",
    status_op: "NOTSTART",
    workcenter: "5507",
    setup_min: "0.2",
    est_min: "200",
    real_min: "0",
    remaining_min: "200",
    production_rate: "20",
    human_resource: "FORMADOR 1",
    machine_resource: "",
    start_actual: "",
    end_actual: "",
    qty_completed: "0",
  };
  const operation = context.PP_mapNetSuiteOperation_(row, 0, current);

  assert.equal(operation.id, "ns-5507", "el id real debe reemplazar al indice");
  assert.equal(operation.ot, "3427");
  assert.equal(operation.secuencia, 1);
  assert.equal(operation.ct, "5507");
  assert.equal(operation.cantTotal, 10);
  assert.equal(operation.tiempoProd, 200);
});

test("PP_operationsRestlet_ apunta al RESTlet exclusivo 2240/1", () => {
  const { context } = load();
  assert.deepEqual(
    { script: context.PP_operationsRestlet_().script, deploy: context.PP_operationsRestlet_().deploy },
    { script: "2240", deploy: "1" }
  );
});

test("RESTlet 2240: sin columna id la operacion vuelve al indice posicional ns-<index+1>", () => {
  const { context } = load();
  const current = { operations: [], workOrders: [{ ot: "3427", pendingQuantity: 10 }] };
  const row = {
    workorder_id: "981",
    workorder_tranid: "3427",
    operation: "FORMADO",
    sequence: "1",
    workcenter: "5507",
    qty_to_process: "10",
  };
  const operation = context.PP_mapNetSuiteOperation_(row, 3, current);

  assert.equal(operation.id, "ns-4", "sin id el mapper cae a index + 1");
});

test("RESTlet 2240: PP_fetchRestletPages_ no altera filas objeto y respeta paginacion hasMore", () => {
  const page1 = {
    ok: true,
    headers: ["ID (link)", "Operacion"],
    rows: [
      { id: "100", workorder_tranid: "3427", operation: "FORMADO", sequence: "1", workcenter: "5507", qty_to_process: "10" },
    ],
    totalRows: 2,
    hasMore: true,
  };
  const page2 = {
    ok: true,
    headers: ["ID (link)", "Operacion"],
    rows: [
      { id: "101", workorder_tranid: "3427", operation: "CORTE", sequence: "2", workcenter: "5461", qty_to_process: "10" },
    ],
    totalRows: 2,
    hasMore: false,
  };
  const { context, requests } = load([
    { status: 200, body: JSON.stringify(page1) },
    { status: 200, body: JSON.stringify(page2) },
  ]);
  const config = { accountId: "ACME_SB1", consumerKey: "c", consumerSecret: "cs", token: "t", tokenSecret: "ts", locationId: 1 };

  const results = context.PP_fetchRestletPages_(context.PP_operationsRestlet_(), { locationId: 1, onlyOpen: true }, config, 20);

  assert.equal(results.rows.length, 2);
  assert.equal(results.rows[0].id, "100");
  assert.equal(results.rows[1].id, "101");
  assert.equal(requests.length, 2);
  assert.match(requests[0].options.payload, /"pageIndex":0/);
  assert.match(requests[1].options.payload, /"pageIndex":1/);
  assert.equal(results.rows[0].operation, "FORMADO");
});

test("PP_netSuiteRestletRequest_ reintenta con espera cuando NetSuite responde 400 SSS_REQUEST_LIMIT_EXCEEDED", () => {
  const { context, requests, sleeps } = load([
    { status: 400, body: JSON.stringify({ error: { code: "SSS_REQUEST_LIMIT_EXCEEDED", message: "Se excedió el límite de solicitudes." } }) },
    { status: 400, body: JSON.stringify({ error: { code: "SSS_REQUEST_LIMIT_EXCEEDED", message: "Se excedió el límite de solicitudes." } }) },
    { status: 200, body: JSON.stringify({ ok: true, headers: ["ID"], rows: [{ id: "1" }], hasMore: false }) },
  ]);

  const result = context.PP_netSuiteRestletRequest_({ script: "1764", deploy: "1" }, { table: "WO_LISTA" }, config);

  assert.equal(result.ok, true, "el tercer intento debe salir bien");
  assert.equal(requests.length, 3, "dos reintentos sobre el intento inicial");
  assert.deepEqual(sleeps, [2000, 5000], "esperas crecientes: 2 s y 5 s");
});

test("PP_netSuiteRestletRequest_ no reintenta otros errores 400 ni un limite que no se recupera", () => {
  const distinto = load([
    { status: 400, body: JSON.stringify({ error: { code: "SS4K_INVALID_KEY_OR_VALUE", message: "Clave invalida" } }) },
  ]);
  const first = distinto.context.PP_netSuiteRestletRequest_({ script: "1764", deploy: "1" }, {}, config);
  assert.equal(first.ok, false);
  assert.equal(distinto.requests.length, 1, "un error distinto al limite no se reintenta");
  assert.deepEqual(distinto.sleeps, []);

  const persistente = load([
    { status: 400, body: JSON.stringify({ error: { code: "SSS_REQUEST_LIMIT_EXCEEDED", message: "Se excedió el límite de solicitudes." } }) },
    { status: 400, body: JSON.stringify({ error: { code: "SSS_REQUEST_LIMIT_EXCEEDED", message: "Se excedió el límite de solicitudes." } }) },
    { status: 400, body: JSON.stringify({ error: { code: "SSS_REQUEST_LIMIT_EXCEEDED", message: "Se excedió el límite de solicitudes." } }) },
    { status: 400, body: JSON.stringify({ error: { code: "SSS_REQUEST_LIMIT_EXCEEDED", message: "Se excedió el límite de solicitudes." } }) },
  ]);
  const last = persistente.context.PP_netSuiteRestletRequest_({ script: "1764", deploy: "1" }, {}, config);
  assert.equal(last.ok, false, "tras agotar los reintentos sigue devolviendo el error");
  assert.equal(persistente.requests.length, 4, "intento inicial + 3 reintentos como maximo");
  assert.deepEqual(persistente.sleeps, [2000, 5000, 10000]);
});
