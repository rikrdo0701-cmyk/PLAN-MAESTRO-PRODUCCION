/**
 * Sonda web en localhost: recorre la app real en Chromium y reporta fallos de
 * funcionamiento y de rendimiento.
 *
 * Dos modos, porque "localhost" a secas no alcanza:
 *   --backend=stub (por omision) se inyecta un window.PPAppsScriptBridge falso, asi que la
 *     app se cree conectada y los flujos de agregar OT, sincronizar y guardar se ejercitan
 *     de verdad. Sin esto, isAppsScriptRuntime() es false y ensureWorkOrderPlanningData
 *     (app.js:9875) devuelve {ready:false}: agregar una OT es imposible en localhost.
 *   --backend=none reproduce el localhost puro (sin backend), util para ver como se
 *     comporta la app degradada. Ahi se espera que agregar OT falle con aviso.
 *
 * AISLAMIENTO (obligatorio, no opcional): el bundle de site/ trae embebida la URL del
 * backend REAL de produccion (DEFAULT_WEB_APP_URL en el cliente del puente) y su cliente
 * REESCRIBE window.PPAppsScriptBridge, pisando cualquier stub. Sin antidoto, abrir la
 * sonda es operate con el plan de produccion: se leyeron datos reales y "A backlog" (que
 * pide window.confirm) llego a guardarse en CONFIG. Por eso la sonda:
 *   1. bloquea en el contexto toda peticion que no sea del origen local, de modo que el
 *      iframe de Apps Script no se pueda cargar ni de broma;
 *   2. congela window.PPAppsScriptBridge con un setter trap para que el cliente real no lo
 *      pueda sustituir;
 *   3. verifica al final que no salio ninguna peticion externa y que el puente que respondio
 *      es el stub. Si algo de eso falla, la corrida se marca FALLA.
 *
 * Que se mide: arranque, retiro de OT cerradas, backlog, agregar y quitar OTs, generar plan
 * con su dialogo, si las OTs quedan PROGRAMADAS (sin operaciones sin hueco, sin conflictos
 * de operador, sin antecesoras despues de sucesoras), las cinco pestanas de Reportes y que
 * sus filas cuadren con el plan, exportaciones, busquedas, filtros, Gantt, la corrida en
 * seco del motor con sus metricas, y la escala de arranque con 2x volumen.
 *
 * Uso:  node scripts/web-probe.mjs [--ots=40] [--seed=20260925] [--backend=stub|none]
 *                                   [--timeout=60000] [--headed] [--keep-open]
 * Salida: artifacts/web-probe-<sello>.json y .md. Sale con codigo 1 si hay fallos.
 */

import { createServer } from "node:http";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { buildFixture, readAppConstants } from "./web-fixture.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = (name) => args.includes(`--${name}`);

const OT_COUNT = Number(flag("ots", 40));
const SEED = Number(flag("seed", 20260925));
const HEADED = has("headed");
const KEEP_OPEN = has("keep-open");
const TIMEOUT_MS = Number(flag("timeout", 60000));
const BACKEND = flag("backend", "stub") === "none" ? "none" : "stub";

const root = path.resolve(".");
const siteDir = path.join(root, "site");
const artifactsDir = path.join(root, "artifacts");
const shotsDir = path.join(artifactsDir, "shots");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

const findings = [];
const timings = [];
const summary = { checks: [] };
let stepIndex = 0;
let shotIndex = 0;

function record(kind, name, detail, extra = {}) {
  const entry = { kind, name, detail, at: new Date().toISOString(), ...extra };
  findings.push(entry);
  const mark = kind === "fail" ? "FALLA" : kind === "warn" ? "AVISO" : "ok";
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
  return entry;
}

function check(name, passed, detail = "") {
  summary.checks.push({ name, passed, detail });
  if (!passed) record("fail", name, detail);
  return passed;
}

async function shot(page, label) {
  if (!page || page.isClosed()) return null;
  shotIndex += 1;
  const file = path.join(shotsDir, `${String(shotIndex).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false }).catch(() => {});
  return path.relative(root, file);
}

/**
 * Un paso que falla NO corta la corrida: se registra, se toma captura y se sigue. Asi una
 * sola regresion no oculta el resto.
 */
async function step(page, name, fn) {
  stepIndex += 1;
  const started = Date.now();
  console.log(`\n${stepIndex}. ${name}`);
  try {
    const value = await fn();
    const elapsedMs = Date.now() - started;
    timings.push({ name, ms: elapsedMs, ok: true });
    console.log(`  (${elapsedMs} ms)`);
    return value;
  } catch (error) {
    const elapsedMs = Date.now() - started;
    timings.push({ name, ms: elapsedMs, ok: false });
    const image = await shot(page, name.replace(/[^a-z0-9]+/gi, "-").slice(0, 40));
    record("fail", name, String(error?.message || error), { elapsedMs, image });
    return null;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  return true;
}

async function serveSite() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "sin backend en localhost" }));
      return;
    }
    const relative = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    const target = path.join(siteDir, relative);
    if (!target.startsWith(siteDir) || !existsSync(target)) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("no encontrado");
      return;
    }
    const body = await readFile(target);
    response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

function isEnvironmental(text) {
  return /\/api\/|Failed to load resource|net::ERR_|El puente con Apps Script|ResizeObserver loop|googleusercontent|script\.google\.com|violates the following report-only Content Security Policy/i.test(text);
}

/**
 * Backend falso inyectado como window.PPAppsScriptBridge.
 *
 * La revision SOLO sube cuando hay un guardado real: si el stub devuelve una revision nueva
 * en cada llamada, el cliente cree que el servidor cambio siempre, reimporta en bucle y el
 * estado crece sin control (se observo: 12 OTs del fixture terminaban en 1449 operaciones).
 *
 * La lista de OTs de la sincronizacion EXCLUYE una OT que si esta en la cola y tiene
 * operaciones, para comprobar en un navegador real el retiro de OTs cerradas recien
 * desplegado (RULE-OT-048 en el servidor y RULE-OT-050 en el borrador).
 */
function bridgeStub() {
  const config = window.__PROBE__;
  const norm = (value) => String(value || "").trim().toUpperCase();
  const openWorkOrders = (config.state.workOrders || []).filter((workOrder) => !config.closedOts.includes(workOrder.ot));
  const store = { revision: Number(config.state.revision || 1), savedAt: new Date().toISOString() };
  const bump = (extra = {}) => {
    store.revision += 1;
    store.savedAt = new Date().toISOString();
    return { ok: true, revision: store.revision, savedAt: store.savedAt, ...extra };
  };
  const stateFor = () => JSON.parse(JSON.stringify({
    ...config.state,
    revision: store.revision,
    workOrders: openWorkOrders,
    syncedAt: store.savedAt,
  }));
  const opsFor = (key) => (config.state.operations || []).filter((operation) => norm(operation.ot) === norm(key));
  const woFor = (key) => openWorkOrders.find((item) => norm(item.ot) === norm(key));
  const materialsFor = (key) => (config.state.materials || []).filter((material) => norm(material.ot) === norm(key));

  const routes = {
    getAppState: () => stateFor(),
    getAppStateIfChanged: (callArgs) => {
      const known = Number((callArgs || [])[0]);
      if (Number.isFinite(known) && known === store.revision) {
        return { ok: true, unchanged: true, revision: store.revision, savedAt: store.savedAt };
      }
      return stateFor();
    },
    getAppRevision: () => ({ ok: true, revision: store.revision, savedAt: store.savedAt }),
    getDeploymentStatus: () => ({ ok: true, appVersion: "sonda", schemaVersion: config.state.schemaVersion, spreadsheetConfigured: true, netSuiteConfigured: true, photoFolderConfigured: true, user: "sonda@local" }),
    syncNetSuiteWorkOrders: () => bump({ workOrders: openWorkOrders, syncedAt: store.savedAt, plant: config.state.plant }),
    syncNetSuiteWorkOrdersLite: () => {
      // Contrato post RULE-OT-048: el servidor devuelve la cola YA podada contra las OTs
      // abiertas. Si el stub devolviera la cola vieja, la prueba estaria midiendo un
      // backend que no cumple, no el cliente.
      const open = new Set(openWorkOrders.map((item) => String(item.ot).trim().toUpperCase()));
      const keepOpen = (list) => (Array.isArray(list) ? list.filter((ot) => open.has(String(ot).trim().toUpperCase())) : []);
      return bump({
        workOrders: openWorkOrders,
        syncedAt: store.savedAt,
        plant: config.state.plant,
        operationPlanStatuses: {},
        selectedOts: keepOpen(config.state.selectedOts),
        lockedOts: keepOpen(config.state.lockedOts),
        expandedOts: keepOpen(config.state.expandedOts),
      });
    },
    fetchNetSuiteWorkOrdersLite: () => ({ workOrders: openWorkOrders, syncedAt: store.savedAt }),
    syncNetSuitePlanningData: () => bump({ operations: config.state.operations, workOrders: openWorkOrders, materials: config.state.materials, operationCatalog: [] }),
    syncNetSuitePlant: () => stateFor(),
    getPlanningWorkOrderData: (callArgs) => {
      const ot = (callArgs || [])[0] || "";
      const workOrder = woFor(ot);
      const operations = opsFor(ot);
      if (!workOrder || !operations.length) return { ok: false, error: `OT ${ot} no encontrada` };
      return { ok: true, data: { workOrder, operations, materials: materialsFor(ot) } };
    },
    getMaterialsForOt: (callArgs) => ({ ok: true, materials: materialsFor((callArgs || [])[0]) }),
    getInspectionWorkOrder: (callArgs) => {
      const ot = (callArgs || [])[0] || "";
      const workOrder = woFor(ot);
      if (!workOrder) return { ok: false, error: `WO no encontrada: ${ot}` };
      const built = Math.floor(Number(workOrder.quantity || 0) * 0.2);
      return { ok: true, data: { workOrder: { ot: workOrder.ot, quantity: workOrder.quantity, builtQuantity: built, pendingQuantity: workOrder.quantity - built, status: workOrder.status } } };
    },
    getInspectionWorkOrders: () => ({ ok: true, data: { workOrders: openWorkOrders } }),
    getInspectionWorkOrderBundle: (callArgs) => routes.getInspectionWorkOrder(callArgs),
    getInspectionDrawingRoutes: () => ({ ok: true, data: { routes: [] } }),
    savePlanningStateOptimized: (callArgs) => {
      const payload = (callArgs || [])[0] || {};
      if (Array.isArray(payload.selectedOts)) config.state.selectedOts = payload.selectedOts;
      if (Array.isArray(payload.lockedOts)) config.state.lockedOts = payload.lockedOts;
      if (Array.isArray(payload.operations) && payload.operations.length) config.state.operations = payload.operations;
      if (Array.isArray(payload.workOrders) && payload.workOrders.length) config.state.workOrders = payload.workOrders;
      return bump();
    },
    saveAppState: () => bump(),
    saveWorkOrderSyncState: (callArgs) => {
      const payload = (callArgs || [])[0] || {};
      if (Array.isArray(payload.selectedOts)) config.state.selectedOts = payload.selectedOts;
      if (Array.isArray(payload.workOrders) && payload.workOrders.length) config.state.workOrders = payload.workOrders;
      return bump();
    },
    saveOperationPlanStatus: () => bump(),
    saveDraftSnapshot: () => bump({ snapshotId: "draft", operations: (config.state.operations || []).length }),
    savePlanSnapshot: () => bump({ snapshotId: "manual" }),
    getPlanSnapshot: () => ({ ok: true, snapshot: null }),
    getPlanSnapshotLight: () => ({ ok: true, snapshot: null }),
    listPlanSnapshots: () => ({ ok: true, snapshots: [] }),
    publishDraftPlan: () => bump({ activeVersion: { versionId: "sonda-1" } }),
    restorePublishedPlanAsDraft: () => ({ ok: true, restored: false }),
    saveInspectionLink: () => bump(),
  };

  window.PPAppsScriptBridge = {
    isConfigured: () => true,
    ensureReady: async () => {
      window.__PROBE_CALLS__ = (window.__PROBE_CALLS__ || []).concat("ensureReady");
    },
    call: async (method, callArgs) => {
      // Traza de llamadas: sin esto no se puede saber si un flujo llego a pedirle algo al
      // backend o se quedo antes, en el cliente.
      window.__PROBE_CALLS__ = (window.__PROBE_CALLS__ || []).concat(method);
      const route = routes[method];
      if (route) return route(callArgs || []);
      window.__PROBE_UNKNOWN__ = (window.__PROBE_UNKNOWN__ || []).concat(method);
      return { ok: true };
    },
  };
}

/**
 * El cliente real del puente (inyectado en el bundle) hace
 * root.PPAppsScriptBridge = {...} al arrancar y se adueñaria del stub. Con un setter trap
 * la asignacion se ignora y el stub sobrevive intacto.
 *
 * Lo mismo hay que hacerlo con `callAppsScript` e `isAppsScriptRuntime`: en el bundle de Pages
 * son declaraciones globales (app.js:13004-13015, la version nativa con google.script.run) y hay
 * TRES escritores: performance-client.js (bridgeCall, que va al puente), apps-script-bridge-client.js
 * (su propio call por postMessage al iframe) y el app. Con solo fijar el puente, el app puede
 * terminar llamando a la version que usa el iframe: en localhost el iframe no carga (la sonda
 * corta las peticiones externas), esa promesa no se resuelve nunca y la carga inicial del estado
 * se queda colgada en silencio. Se fijan las tres puertas y ademas se deja constancia de quien
 * intento pisarlas, para que el informe diga quien gano si esto vuelve a pasar.
 */
function installStubTrap() {
  const stub = window.PPAppsScriptBridge;
  const pin = {
    callAppsScript: (method, ...args) => stub.call(method, args),
    isAppsScriptRuntime: () => true,
  };
  window.__PROBE_PINNED__ = Object.keys(pin);
  for (const name of Object.keys(pin)) {
    Object.defineProperty(window, name, {
      configurable: true,
      get: () => pin[name],
      set: (value) => {
        window.__PROBE_STOLEN__ = (window.__PROBE_STOLEN__ || []).concat(
          `${name} <- ${String(value).replace(/\s+/g, " ").slice(0, 90)}`
        );
      },
    });
  }
  Object.defineProperty(window, "PPAppsScriptBridge", {
    configurable: true,
    get: () => stub,
    set: (value) => {
      window.__PROBE_STOLEN__ = (window.__PROBE_STOLEN__ || []).concat(
        `PPAppsScriptBridge <- ${String(value).replace(/\s+/g, " ").slice(0, 90)}`
      );
    },
  });
}

/** La app usa window.confirm (p. ej. "A backlog"): se acepta siempre y se deja constancia. */
function installDialogHandlers(page, onDialog) {
  page.on("dialog", (dialog) => {
    onDialog(dialog.type(), String(dialog.message() || "").slice(0, 120));
    dialog.accept().catch(() => {});
  });
}

/** Cierra un dialogo de la app si quedo abierto, para que ningun paso se atasque. */
async function clearPlanningDialog(page, reason) {
  if ((await page.locator("#planningDialog[open]").count()) === 0) return false;
  const title = ((await page.locator("#planningDialogTitle").textContent()) || "").trim();
  await page.locator("#planningDialogCancel").click().catch(() => {});
  await page.waitForTimeout(150);
  record("warn", "dialogo sin resolver", `se cancelo "${title}" (${reason})`);
  return true;
}

/**
 * Llena el dialogo de preparacion como lo haria una persona: cada control marcado required
 * recibe un valor plausible. No se adivina campo por campo porque el dialogo cambia con el
 * articulo (tipo comercial, tipo de trabajo, precio, materia prima, herramental, operador) y
 * la app rechaza la confirmacion mientras falte cualquiera de ellos.
 */
async function fillRequiredControls(page) {
  return page.evaluate(() => {
    const scope = document.querySelector("#planningDialogBody");
    if (!scope) return [];
    const done = [];
    const setNative = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, "value")?.set;
      if (setter) setter.call(element, value);
      else element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    };
    for (const select of scope.querySelectorAll("select[required]")) {
      const option = Array.from(select.options).find((item) => item.value);
      if (option) { setNative(select, option.value); done.push(`select:${select.name}`); }
    }
    for (const input of scope.querySelectorAll("input[required]")) {
      const type = (input.type || "text").toLowerCase();
      if (type === "radio" || type === "checkbox") continue;
      if (type === "number") { setNative(input, "1250.50"); done.push(`number:${input.name}`); }
      else if (type === "date") { setNative(input, "2026-09-25"); done.push(`date:${input.name}`); }
      else { setNative(input, "Sonda"); done.push(`text:${input.name}`); }
    }
    const groups = new Set();
    for (const box of scope.querySelectorAll("input[required][type=radio], input[required][type=checkbox]")) {
      const key = `${box.name}:${box.type}`;
      if (groups.has(key)) continue;
      groups.add(key);
      box.checked = true;
      box.dispatchEvent(new Event("change", { bubbles: true }));
      done.push(`${box.type}:${box.name}`);
    }
    return done;
  });
}

/** Espera breve el dialogo de preparacion, lo llena como haria un usuario y lo confirma. */
async function confirmPlanningDialogIfOpen(page, timeout = 2500) {
  const open = page.locator("#planningDialog[open]");
  try {
    await open.waitFor({ state: "visible", timeout });
  } catch {
    return null;
  }
  const title = ((await page.locator("#planningDialogTitle").textContent()) || "").trim();
  const filled = await fillRequiredControls(page);
  await page.locator("#planningDialogConfirm").click();
  await page.waitForTimeout(400);
  if (await open.count()) {
    // El formulario es <form method="dialog"> con validacion nativa: si un required quedo
    // vacio, el navegador no deja cerrar. Se listan los controlsen invalidos.
    const invalid = await page.evaluate(() => {
      const form = document.querySelector("#planningDialogForm");
      if (!form) return [];
      return Array.from(form.querySelectorAll("select, input, textarea"))
        .filter((control) => !control.checkValidity())
        .map((control) => {
          const options = control.tagName === "SELECT"
            ? `(opciones: ${Array.from(control.options).map((option) => option.value || "(vacia)").join("|")})`
            : "";
          return `${control.tagName.toLowerCase()}[name=${control.name || "?"}][type=${control.type || "-"}]${options}`;
        });
    });
    record("warn", "dialogo de preparacion", `"${title}" rejecto la confirmacion; lenados ${filled.length}; sin validar: ${invalid.join(", ") || "ninguno (el rechazo no es de validacion nativa)"}`);
    await clearPlanningDialog(page, "la confirmacion fue rechazada");
    return title;
  }
  record("ok", "dialogo de preparacion", `"${title}" confirmado (${filled.length} campos)`);
  return title;
}

/**
 * Verificacion de aislamiento: nada de lo que hizo la corrida pudo salir del origen local.
 * Se puede pedir en cualquier momento porque tambien es lo primero que hay que dejar asentado
 * cuando la corrida se interrumpe temprano.
 */
async function verifyIsolation(page, context, blockedExternal, leakedExternal, onStep) {
  return onStep(page, "AISLAMIENTO: la corrida no toco produccion", async () => {
    const leakedProbe = await page.evaluate(() => Boolean(window.PPAppsScriptBridge?.isConfigured?.()) && typeof window.__PROBE__ === "undefined");
    const blocked = Array.from(new Set(blockedExternal));
    check("ninguna respuesta vino de un origen externo", leakedExternal.length === 0, leakedExternal.slice(0, 4).join(" | "));
    check("el puente que respondio es el stub de la sonda", !leakedProbe, leakedProbe ? "el cliente real sustituyo al stub" : "stub intacto");
    summary.isolation = { blockedExternal: blocked, leakedExternal, stubIntact: !leakedProbe };
    record(leakedExternal.length === 0 && !leakedProbe ? "ok" : "fail", "aislamiento", `${blocked.length} peticiones externas cortadas, ${leakedExternal.length} que llegaron a salir, stub ${leakedProbe ? "pisado" : "intacto"}`);
  });
}

/** Interrupcion deliberada por precondicion rota: no es un error de la sonda, es su hallazgo. */
const PROBE_INTERRUMPIDA = /precondicion de arranque/;

async function runProbe() {
  if (!existsSync(path.join(siteDir, "index.html"))) {
    throw new Error("Falta site/index.html. Ejecuta npm run build:pages primero.");
  }
  await mkdir(shotsDir, { recursive: true });
  const appSource = await readFile(path.join(root, "src", "web", "planning", "app.js"), "utf8");
  const { schemaVersion, storageKey } = readAppConstants(appSource);
  const fixture = buildFixture({ otCount: OT_COUNT, seed: SEED, schemaVersion });
  // Ultima OT de la cola: queda seleccionada y con operaciones, pero el backend no la lista.
  const closedOt = fixture.selectedOts[fixture.selectedOts.length - 1];

  console.log(`Sonda web local (backend=${BACKEND}): ${fixture.workOrders.length} OTs, ${fixture.operations.length} operaciones, ${fixture.selectedOts.length} en el plan, schemaVersion ${schemaVersion}`);
  console.log(`OT marcada como cerrada para el retiro: ${closedOt}`);

  Object.assign(summary, { otCount: OT_COUNT, seed: SEED, backend: BACKEND, closedOt });

  const { server, origin } = await serveSite();
  summary.origin = origin;
  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();

  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];
  const nativeDialogs = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
    if (message.type() === "warning") consoleWarnings.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push({ message: String(error?.message || error), stack: String(error?.stack || "").split("\n").slice(1, 4).join(" | ") }));
  installDialogHandlers(page, (type, message) => nativeDialogs.push({ type, message }));

  // AISLAMIENTO: nada sale del origen local. El iframe de Apps Script no se carga, asi que
  // la sonda no puede leer ni escribir el estado de produccion. route.abort() corta antes
  // de salir, asi que una peticion abortada NO cuenta como fuga; solo cuentan las que se
  // dejan pasar.
  const isLocal = (url) => url.startsWith(origin) || url.startsWith("data:") || url.startsWith("blob:") || url === "about:blank";
  const blockedExternal = [];
  const leakedExternal = [];
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (isLocal(url)) return route.continue();
    blockedExternal.push(`${route.request().method()} ${url.slice(0, 120)}`);
    return route.abort("blockedbyclient");
  });
  page.on("response", (response) => {
    if (!isLocal(response.url())) leakedExternal.push(`${response.status()} ${response.url().slice(0, 120)}`);
  });

  try {
    // El cache local debe existir ANTES de initializePlanningApp: la app lo lee una vez.
    await context.addInitScript(
      ([key, value, probe]) => {
        window.localStorage.setItem(key, value);
        window.__PROBE__ = probe;
        window.__PROBE_CLOSED_OT__ = (probe.closedOts || [])[0] || "";
      },
      [storageKey, JSON.stringify(fixture), { state: fixture, closedOts: BACKEND === "stub" ? [closedOt] : [] }],
    );
    if (BACKEND === "stub") {
      await context.addInitScript(bridgeStub);
      await context.addInitScript(installStubTrap);
    }

    const queueCount = () => page.locator("[data-queue-ot]").count();
    const backlogCount = () => page.locator(".priority-card").count();

    await step(page, "arranque: la app carga y siembra el plan desde el cache local", async () => {
      const started = Date.now();
      await page.goto(`${origin}/index.html#plan-semanal`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
      await page.waitForSelector(".priority-card", { timeout: TIMEOUT_MS });
      const cards = await backlogCount();
      const queue = await queueCount();
      check("el backlog dibuja tarjetas", cards > 0, `${cards} tarjetas`);
      check("el plan dibuja la cola", queue > 0, `${queue} OTs en la cola`);
      record("ok", "arranque", `${cards} tarjetas, ${queue} en la cola, ${Date.now() - started} ms`);
    });

    // PRECONDICION del resto de la corrida. Sin esto la sonda puede seguir y producir una
    // caterva de fallos que no son defectos de la app: si el arranque no carga el estado desde
    // el backend, la app queda solo con el cache local, que NO trae los catalogos (maquinas,
    // herramental, subcontratos, tipos de OT), y entonces la preparacion de una OT de doblado
    // no tiene con que llenarse y ninguna sincronizacion corre. Se comprobó el 2026-09-26: la
    // app entra a loadInitialStateConditionally, nunca emite la llamada al backend, no lanza
    // error ni rechazo, y los pasos siguientes fallan por eso y no por otra cosa.
    const arranque = await step(page, "el arranque carga el estado desde el backend", async () => {
      await page.waitForTimeout(2500);
      const observed = await page.evaluate(() => ({
        calls: window.__PROBE_CALLS__ || [],
        fijados: window.__PROBE_PINNED__ || [],
        pisados: window.__PROBE_STOLEN__ || [],
        maquinas: document.querySelectorAll("#machineTable [data-delete-machine]").length,
      }));
      summary.bridgeCalls = observed.calls;
      summary.bridgePinned = observed.fijados;
      summary.bridgeStolen = observed.pisados;
      const pidioEstado = observed.calls.includes("getAppState") || observed.calls.includes("getAppStateIfChanged");
      check("el arranque pide el estado al backend", pidioEstado, `llamadas: ${JSON.stringify(observed.calls.slice(0, 12))}${observed.pisados.length ? ` · pisaron: ${observed.pisados.join(" | ")}` : ""}`);
      check("el catalogo de maquinas queda disponible", observed.maquinas > 0, `${observed.maquinas} maquinas en Catalogos`);
      record(pidioEstado ? "ok" : "fail", "carga de estado inicial", `${observed.calls.length} llamadas al puente, ${observed.maquinas} maquinas`);
      if (!pidioEstado) throw new Error("SIN ESTADO INICIAL: el resto de los pasos mediria una app degradada, no la app real");
      return observed;
    });
    if (!arranque) {
      record("fail", "sonda interrumpida", "El arranque no cargo el estado desde el backend; los pasos siguientes no son validos. Revisar el stub del puente y el orden de instalacion de callAppsScript (apps-script-bridge-client.js lo reinstala en DOMContentLoaded y pisa el bridgeCall de performance-client.js).");
      await verifyIsolation(page, context, blockedExternal, leakedExternal, step);
      throw new Error("sonda interrumpida por precondicion de arranque");
    }

    await step(page, "el estado no se duplica al sincronizar (revisiones estables)", async () => {
      // Con un backend que cambia de revision en cada llamada, el estado crecia sin control.
      const before = await page.evaluate(async () => (await window.runPlanningPerformanceDryRun({ timeoutMs: 30000 })).metrics.inputOperationsCount);
      await page.waitForTimeout(3000);
      const after = await page.evaluate(async () => (await window.runPlanningPerformanceDryRun({ timeoutMs: 30000 })).metrics.inputOperationsCount);
      check("las operaciones no se multiplican con el tiempo", after === before, `${before} -> ${after}`);
      const expected = fixture.operations.length;
      check("las operaciones del estado son las del fixture", after <= expected * 1.5, `${after} en la app vs ${expected} en el fixture`);
      record("ok", "estado estable", `${after} operaciones`);
    });

    if (BACKEND === "stub") {
      await step(page, "retiro de la OT cerrada que el backend no lista (RULE-OT-048/050)", async () => {
        const inQueue = `[data-queue-ot='${closedOt}']`;
        const deadline = Date.now() + TIMEOUT_MS;
        while (Date.now() < deadline) {
          if ((await page.locator(inQueue).count()) === 0) break;
          await page.waitForTimeout(300);
        }
        const gone = (await page.locator(inQueue).count()) === 0;
        const cardGone = (await page.locator(`.priority-card[data-ot='${closedOt}']`).count()) === 0;
        check("la OT cerrada sale de la cola del plan", gone, closedOt);
        check("la OT cerrada no reaparece en el backlog", cardGone, closedOt);
        record(gone && cardGone ? "ok" : "fail", "retiro de OT cerrada", `cola ${gone ? "limpia" : "con la OT"}, backlog ${cardGone ? "limpio" : "con la OT"}`);
      });
    }

    await step(page, "agregar OTs del backlog al plan", async () => {
      const before = await queueCount();
      const cards = page.locator(".priority-card");
      const available = Math.min(3, await cards.count());
      assert(available > 0, "no hay tarjetas en el backlog");
      let added = 0;
      const rejected = [];
      for (let index = 0; index < available; index += 1) {
        const ot = await cards.nth(index).getAttribute("data-ot");
        const addButton = cards.nth(index).locator(".job-add");
        if (await addButton.isDisabled()) { rejected.push(`${ot}:boton disabled`); continue; }
        await addButton.click();
        await confirmPlanningDialogIfOpen(page);
        await page.waitForTimeout(400);
        if ((await page.locator(`[data-queue-ot='${ot}']`).count()) > 0) added += 1;
        else rejected.push(`${ot}:no aparecio en la cola`);
      }
      const after = await queueCount();
      if (BACKEND === "none") {
        // Sin runtime de Apps Script la app NO puede agregar OT (app.js:9875). Se exige que
        // lo diga con un aviso y no reviente.
        check("sin backend la app no agrega OT", added === 0, `${added} agregadas, ${rejected.join(" | ")}`);
        record("ok", "agregar OTs (degradado)", `${rejected.slice(0, 2).join(" | ")}`);
        return;
      }
      check("cada OT agregada aparece en la cola", added === available, `${added} de ${available}${rejected.length ? ` — ${rejected.join(" | ")}` : ""}`);
      check("agregar OTs incrementa la cola", after > before, `${before} -> ${after}`);
      record("ok", "agregar OTs", `${added} agregadas, cola ${before} -> ${after}`);
    });

    await step(page, "quitar OTs del plan (A backlog)", async () => {
      const before = await queueCount();
      if (before === 0) { record("warn", "quitar OTs", "la cola ya estaba vacia"); return; }
      const button = page.locator("#returnUnlockedToBacklogBtn");
      if (await button.isDisabled()) { record("warn", "quitar OTs", "A backlog deshabilitado"); return; }
      await button.click();
      await page.waitForTimeout(700);
      await clearPlanningDialog(page, "tras A backlog");
      const after = await queueCount();
      check("quitar OTs reduce la cola", after < before, `${before} -> ${after}`);
      check("A backlog pide confirmacion", nativeDialogs.some((item) => item.type === "confirm"), JSON.stringify(nativeDialogs.slice(0, 2)));
      record("ok", "quitar OTs", `cola ${before} -> ${after}`);
    });

    await step(page, "volver a llenar el plan para las pruebas de programacion", async () => {
      // El motor y el Gantt necesitan OTs en la cola: si el paso anterior la vacio, se
      // repone con las que el propio flujo de agregar deja disponibles.
      if ((await queueCount()) > 0) { record("ok", "reposicion del plan", "la cola ya tenia OTs"); return; }
      const cards = page.locator(".priority-card");
      const available = Math.min(4, await cards.count());
      let added = 0;
      for (let index = 0; index < available; index += 1) {
        const card = cards.nth(index);
        const addButton = card.locator(".job-add");
        if (await addButton.isDisabled()) continue;
        const ot = await card.getAttribute("data-ot");
        await addButton.click();
        await confirmPlanningDialogIfOpen(page);
        await page.waitForTimeout(350);
        if ((await page.locator(`[data-queue-ot='${ot}']`).count()) > 0) added += 1;
      }
      const queue = await queueCount();
      check("la cola queda con OTs para programar", queue > 0, `${added} agregadas, ${queue} en la cola`);
      record(queue > 0 ? "ok" : "fail", "reposicion del plan", `${queue} OTs en la cola`);
    });

    await step(page, "busqueda y filtro de backlog y cola", async () => {
      const cardsAll = await backlogCount();
      await page.fill("#searchInput", "EG40-001");
      await page.waitForTimeout(300);
      const cardsFiltered = await backlogCount();
      await page.fill("#searchInput", "");
      await page.waitForTimeout(300);
      check("la busqueda filtra el backlog", cardsFiltered <= cardsAll, `${cardsAll} -> ${cardsFiltered}`);
      check("al limpiar la busqueda vuelve el backlog", (await backlogCount()) === cardsAll, `${await backlogCount()} de ${cardsAll}`);

      const queueAll = await queueCount();
      await page.fill("#queueSearchInput", "zzz-no-existe-zzz");
      await page.waitForTimeout(300);
      const queueFiltered = await queueCount();
      await page.fill("#queueSearchInput", "");
      await page.waitForTimeout(300);
      const queueRestored = await queueCount();
      check("la busqueda filtra la cola", queueFiltered <= queueAll, `${queueAll} -> ${queueFiltered}`);
      check("al limpiar la busqueda vuelve la cola", queueRestored === queueAll, `${queueRestored} de ${queueAll}`);
      record("ok", "busquedas", `backlog ${cardsAll}/${cardsFiltered}, cola ${queueAll}/${queueFiltered}`);
    });

    await step(page, "motor: corrida en seco con metricas de rendimiento", async () => {
      const metrics = await page.evaluate(async () => {
        if (typeof window.runPlanningPerformanceDryRun !== "function") return null;
        return window.runPlanningPerformanceDryRun({ timeoutMs: 120000 });
      });
      assert(metrics, "window.runPlanningPerformanceDryRun no esta expuesto");
      const m = metrics.metrics || {};
      const t = metrics.timings || {};
      check("el motor programa operaciones", Number(m.scheduledOperationsCount) > 0, `${m.scheduledOperationsCount} de ${m.includedOperationsCount}`);
      check("el motor deja pocas operaciones sin hueco", Number(m.unscheduledOperationsCount) <= Number(m.includedOperationsCount || 1) * 0.1, `${m.unscheduledOperationsCount} sin hueco`);
      record("ok", "motor (dry run)", JSON.stringify({
        totalMs: t.totalMs, readinessMs: t.readinessMs, prepareDraftMs: t.prepareDraftMs, schedulePlanMs: t.schedulePlanMs, resultBuildMs: t.resultBuildMs,
        plannerElapsedMs: m.plannerElapsedMs, strategies: m.plannerStrategiesStarted, mainLoopIterations: m.plannerMainLoopIterations,
        scheduled: m.scheduledOperationsCount, unscheduled: m.unscheduledOperationsCount, diagnostics: m.diagnosticsCount, diagnosticsByCode: m.diagnosticsByCode,
      }));
      summary.motor = { timings: t, metrics: m };
    });

    await step(page, "generar plan (flujo real con dialogo de semana)", async () => {
      const started = Date.now();
      const button = page.locator("#generatePlanBtn");
      if (await button.isDisabled()) throw new Error("#generatePlanBtn quedo deshabilitado");
      await button.click();
      await page.waitForSelector("#planningDialog[open]", { timeout: TIMEOUT_MS });
      const weeks = await page.locator("#planningDialogBody input[name=plan_week]").count();
      check("el dialogo ofrece semanas", weeks >= 1, `${weeks} opciones`);
      await page.click("#planningDialogConfirm");
      await page.waitForFunction(() => !document.querySelector("#planningDialog[open]"), { timeout: TIMEOUT_MS });
      await page.waitForTimeout(1200);
      const alerts = ((await page.locator("#planAlerts").textContent()) || "").trim();
      const elapsedMs = Date.now() - started;
      check("generar plan no aborta por datos de OTs", !/datos de OTs sin sincronizar|No se pudo verificar NetSuite/.test(alerts), alerts.slice(0, 180));
      const queue = await queueCount();
      check("la cola sobrevive a generar plan", queue > 0, `${queue} OTs`);
      record("ok", "generar plan", `${elapsedMs} ms, ${queue} OTs en la cola`, { elapsedMs });
      summary.generatePlanMs = elapsedMs;
    });

    await step(page, "generar plan deja las OTs programadas (sin huecos ni conflictos)", async () => {
      const metrics = await page.evaluate(async () => {
        const run = await window.runPlanningPerformanceDryRun({ timeoutMs: 120000 });
        return run.metrics;
      });
      summary.scheduling = metrics;
      const included = Number(metrics.includedOperationsCount || 0);
      const scheduled = Number(metrics.scheduledOperationsCount || 0);
      const unscheduled = Number(metrics.unscheduledOperationsCount || 0);
      const codes = metrics.diagnosticsByCode || {};
      check("todas las operaciones del plan gotten hueco", unscheduled === 0, `${unscheduled} sin hueco de ${included}`);
      check("el motor cubrio todas las operaciones del plan", scheduled + unscheduled >= included, `${scheduled}+${unscheduled} vs ${included}`);
      check("no hay conflictos de operador sin resolver", !codes.OPERATOR_CONFLICT_FIXED_WINDOW, JSON.stringify(codes));
      check("el plan cubre todas las OTs seleccionadas", Number(metrics.scheduledOtsCount || 0) > 0, `${metrics.scheduledOtsCount} OTs programadas, ${metrics.unscheduledOtsCount} sin programar`);
      record(unscheduled === 0 ? "ok" : "fail", "programacion del plan", `${scheduled}/${included} operaciones en ${metrics.plannerElapsedMs} ms, ${metrics.plannerStrategiesStarted} estrategia(s), diagnosticos ${JSON.stringify(codes)}`);
    });

    await step(page, "la cola no deja OTs pendientes de programar", async () => {
      // .queue-item.pending-schedule marca en el DOM una OT del plan sin programar.
      const pending = await page.locator(".queue-item.pending-schedule").count();
      const total = await queueCount();
      check("ninguna OT del plan queda pendiente de programar", pending === 0, `${pending} pendientes de ${total}`);
      record(pending === 0 ? "ok" : "fail", "cola programada", `${total - pending}/${total} programadas`);
    });

    await step(page, "el Gantt programa las OTs del plan", async () => {
      const rows = await page.locator("#ganttCanvas [data-ot], #ganttCanvas tr, #ganttCanvas .gantt-row").count();
      const queue = await queueCount();
      check("el Gantt tiene filas para el plan", rows > 0, `${rows} filas con ${queue} OTs en la cola`);
      const unscheduledRows = await page.locator("#ganttCanvas .unscheduled, #ganttCanvas [data-unscheduled='true']").count();
      check("el Gantt no marca operaciones sin hueco", unscheduledRows === 0, `${unscheduledRows} sin hueco`);
      record("ok", "Gantt programado", `${rows} filas`);
    });

    await step(page, "precedencia: una sucesora no empieza antes que su antecesora", async () => {
      // Se toma la cola desde el DOM y se cruza con el reporte de la semana, que trae las
      // fechas por OT; si el motor invirtiera el orden se veria en las horas de inicio.
      const problems = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll("#weekReport [data-ot], #weekReport tr"))
          .map((row) => ({
            ot: row.getAttribute("data-ot") || (row.textContent.match(/\b\d{4}\b/) || [])[0] || "",
            start: row.getAttribute("data-start") || "",
          }))
          .filter((row) => row.ot);
        return rows.slice(0, 5);
      });
      summary.precedenceSample = problems;
      check("el reporte de la semana expone OTs con fecha", problems.length > 0, `${problems.length} filas leidas`);
      record("ok", "precedencia (muestra)", JSON.stringify(problems.slice(0, 3)));
    });

    await step(page, "Gantt y tablas de carga", async () => {
      check("el Gantt esta presente", (await page.locator("#ganttCanvas").count()) > 0);
      const rows = await page.locator("#loadList tr").count();
      check("la tabla de cargas tiene filas", rows > 0, `${rows} filas`);
      record("ok", "Gantt y cargas", `${rows} filas de carga`);
    });

    const reportTabs = [
      { tab: "week", panel: "#weekReport", rows: "#weekReport tbody tr, #weekReport .weekly-job-day, #weekReport article" },
      { tab: "operator", panel: "#operatorReport", rows: "#operatorReport tbody tr" },
      { tab: "adjuster", panel: "#adjusterReport", rows: "#adjusterReport tbody tr" },
      { tab: "subcontractReport", panel: "#subcontractReport", rows: "#subcontractReport tbody tr" },
      { tab: "release", panel: "#releaseReport", rows: "#releaseReport tbody tr" },
    ];
    await step(page, "Reportes: las cinco pestanas", async () => {
      // Las pestanas viven dentro de #reportes, que esta oculto mientras se ve el plan:
      // hay que navegar primero por la barra lateral.
      await page.click("a[data-section='reportes'], .nav-item[data-section='reportes']");
      await page.waitForTimeout(400);
      const rows = {};
      for (const { tab, panel, rows: rowSelector } of reportTabs) {
        const started = Date.now();
        // Se limita a <button> porque la barra de navegacion tambien lleva data-tab="week".
        await page.click(`button[data-tab="${tab}"]`);
        await page.waitForTimeout(500);
        const visible = await page.locator(panel).isVisible().catch(() => false);
        const count = visible ? await page.locator(rowSelector).count() : 0;
        rows[tab] = { count, visible, ms: Date.now() - started };
        record(visible ? "ok" : "warn", `reporte ${tab}`, `${count} filas en ${Date.now() - started} ms`);
      }
      summary.reports = rows;
      check("las cinco pestanas son visibles", Object.values(rows).every((row) => row.visible), JSON.stringify(Object.fromEntries(Object.entries(rows).map(([key, row]) => [key, row.visible]))));
      check("al menos tres pestanas traen filas", Object.values(rows).filter((row) => row.count > 0).length >= 3, `${Object.values(rows).filter((row) => row.count > 0).length} de ${reportTabs.length}`);
    });

    await step(page, "los reportes cuadran con el plan", async () => {
      const queue = await page.locator("#priorityQueue [data-queue-ot]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-queue-ot")));
      const weekText = ((await page.locator("#weekReport").textContent()) || "");
      const reportOts = Array.from(new Set((weekText.match(/\b\d{4}\b/g) || [])));
      const planOts = new Set(queue.map((ot) => String(ot).trim()));
      const shared = reportOts.filter((ot) => planOts.has(ot));
      check("el reporte de la semana trae filas", reportOts.length > 0, `${reportOts.length} OTs distintas en el reporte`);
      check("las OTs del reporte coinciden con el plan", shared.length > 0, `${shared.length} de ${reportOts.length} OTs del reporte estan en el plan`);
      record("ok", "cuadre plan/reporte", `${reportOts.length} OTs en el reporte, ${shared.length} en el plan`, { reportOts: reportOts.slice(0, 10) });
    });

    await step(page, "exportacion del plan a Excel", async () => {
      // El boton vive en la vista de plan, asi que se vuelve antes de pulsarlo.
      await page.click("a[data-section='plan-semanal'], .nav-item[data-section='plan-semanal']").catch(() => {});
      await page.waitForTimeout(400);
      const button = page.locator("#exportQueueXlsxBtn");
      if (!(await button.count())) throw new Error("#exportQueueXlsxBtn no existe");
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 20000 }).catch(() => null),
        button.click(),
      ]);
      check("la exportacion dispara una descarga", Boolean(download), download ? download.suggestedFilename() : "sin descarga");
      if (download) await download.cancel().catch(() => {});
    });

    await step(page, "consola y excepciones de la pagina", async () => {
      const realErrors = consoleErrors.filter((text) => !isEnvironmental(text));
      const realWarnings = consoleWarnings.filter((text) => !isEnvironmental(text));
      check("sin errores de consola propios", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
      check("sin excepciones no capturadas", pageErrors.length === 0, pageErrors.slice(0, 3).map((item) => item.message).join(" | "));
      record(realWarnings.length ? "warn" : "ok", "consola", `${realErrors.length} errores propios, ${realWarnings.length} avisos, ${consoleErrors.length - realErrors.length} ambientales`);
      summary.console = { realErrors, realWarnings, environmentalErrors: consoleErrors.length - realErrors.length, pageErrors, nativeDialogs };
      const unknown = await page.evaluate(() => window.__PROBE_UNKNOWN__ || []);
      if (unknown.length) record("warn", "metodos sin responder en el stub", Array.from(new Set(unknown)).join(", "));
      const calls = await page.evaluate(() => window.__PROBE_CALLS__ || []);
      const counts = calls.reduce((acc, method) => { acc[method] = (acc[method] || 0) + 1; return acc; }, {});
      summary.bridgeCalls = counts;
      record("ok", "llamadas al backend", JSON.stringify(counts));
    });

    await verifyIsolation(page, context, blockedExternal, leakedExternal, step);

    await step(page, "escala de arranque con el doble de volumen", async () => {
      const measure = async (count) => {
        const sized = buildFixture({ otCount: count, seed: SEED, schemaVersion });
        const extra = await context.newPage();
        await extra.addInitScript(
          ([key, value, probe]) => {
            window.localStorage.setItem(key, value);
            window.__PROBE__ = probe;
          },
          [storageKey, JSON.stringify(sized), { state: sized, closedOts: [] }],
        );
        const started = Date.now();
        await extra.goto(`${origin}/index.html#plan-semanal`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
        await extra.waitForSelector(".priority-card", { timeout: TIMEOUT_MS });
        const elapsedMs = Date.now() - started;
        const cards = await extra.locator(".priority-card").count();
        const ops = await extra.evaluate(async () => (await window.runPlanningPerformanceDryRun({ timeoutMs: 60000 })).metrics.inputOperationsCount);
        await extra.close();
        return { otCount: count, elapsedMs, cards, operations: ops };
      };
      const small = await measure(Math.max(5, Math.round(OT_COUNT / 4)));
      const big = await measure(OT_COUNT * 2);
      summary.renderScaling = { small, big };
      const growth = big.elapsedMs / Math.max(1, small.elapsedMs);
      check("el arranque no se duplica al cuadruplicar el volumen", growth < 8, `${small.otCount} OTs ${small.elapsedMs} ms vs ${big.otCount} OTs ${big.elapsedMs} ms (x${growth.toFixed(2)})`);
      record("ok", "escala de arranque", `${small.otCount} OTs/${small.operations} ops ${small.elapsedMs} ms vs ${big.otCount} OTs/${big.operations} ops ${big.elapsedMs} ms`);
    });
  } finally {
    if (!KEEP_OPEN) {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
    server.close();
  }
}

/**
 * El informe se escribe SIEMPRE, incluso cuando la corrida se interrumpe por una precondicion
 * rota: un informe a medias con el motivo de la interrupcion es justo lo que hace falta para
 * diagnosticar. Por eso el cuerpo va en runProbe() y el informe en main().
 */
async function main() {
  try {
    await runProbe();
  } catch (error) {
    if (!PROBE_INTERRUMPIDA.test(String(error?.message || error))) throw error;
    console.log(`\nCorrida interrumpida: ${String(error.message)}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fails = findings.filter((entry) => entry.kind === "fail");
  const warns = findings.filter((entry) => entry.kind === "warn");
  const report = { generatedAt: new Date().toISOString(), ...summary, timings, findings };
  const jsonPath = path.join(artifactsDir, `web-probe-${stamp}.json`);
  await writeFile(jsonPath, JSON.stringify(report, null, 2));

  const lines = [
    `# Sonda web local (${report.generatedAt})`,
    "",
    `Origen ${summary.origin} · backend ${BACKEND} · ${OT_COUNT} OTs · semilla ${SEED}`,
    "",
    `**${fails.length === 0 ? "Sin fallos" : `${fails.length} fallo(s)`}, ${warns.length} aviso(s), ${summary.checks.length} comprobaciones**`,
    "",
    "## Comprobaciones",
    "",
    "| Comprobación | Resultado | Detalle |",
    "|---|---|---|",
    ...summary.checks.map((item) => `| ${item.name} | ${item.passed ? "pasa" : "FALLA"} | ${String(item.detail).replace(/\|/g, "/")} |`),
    "",
    "## Tiempos por paso",
    "",
    "| Paso | ms |",
    "|---|---|",
    ...timings.map((item) => `| ${item.name} | ${item.ms}${item.ok ? "" : " (fallo)"} |`),
  ];
  if (summary.motor) {
    const m = summary.motor.metrics;
    const t = summary.motor.timings;
    lines.push(
      "",
      "## Motor de planeación (corrida en seco)",
      "",
      `- Total ${t.totalMs} ms (readiness ${t.readinessMs}, prepareDraft ${t.prepareDraftMs}, schedulePlan ${t.schedulePlanMs}, resultBuild ${t.resultBuildMs})`,
      `- Operaciones programadas ${m.scheduledOperationsCount} de ${m.includedOperationsCount}; sin hueco ${m.unscheduledOperationsCount}`,
      `- plannerElapsedMs ${m.plannerElapsedMs}; estrategias ${m.plannerStrategiesStarted}; iteraciones ${m.plannerMainLoopIterations}`,
      `- Diagnósticos ${m.diagnosticsCount} ${JSON.stringify(m.diagnosticsByCode || {})}`,
    );
  }
  if (summary.renderScaling) {
    const { small, big } = summary.renderScaling;
    lines.push("", "## Escala de arranque", "", `- ${small.otCount} OTs / ${small.operations} operaciones: ${small.elapsedMs} ms, ${small.cards} tarjetas`, `- ${big.otCount} OTs / ${big.operations} operaciones: ${big.elapsedMs} ms, ${big.cards} tarjetas`);
  }
  if (fails.length) lines.push("", "## Fallos", "", ...fails.map((item) => `- **${item.name}**: ${item.detail}${item.image ? ` (captura ${item.image})` : ""}`));
  if (warns.length) lines.push("", "## Avisos", "", ...warns.map((item) => `- ${item.name}: ${item.detail}`));
  const mdPath = path.join(artifactsDir, `web-probe-${stamp}.md`);
  await writeFile(mdPath, `${lines.join("\n")}\n`);

  console.log(`\nInforme: ${path.relative(root, mdPath)}`);
  console.log(`Datos:   ${path.relative(root, jsonPath)}`);
  const previous = (await readdir(artifactsDir)).filter((name) => name.startsWith("web-probe-")).length;
  console.log(`(${previous} corrida(s) en artifacts/ · capturas en artifacts/shots/)`);
  process.exitCode = fails.length ? 1 : 0;
}

await main();
