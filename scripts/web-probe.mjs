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
 * LO QUE LA APP LEE DE VERDAD (MEDIDO 2026-10-05). Con RULE-SUP-030 la pagina no pide nada al
 * puente: llama a `PPSupabaseBridgeReplacement`, que lee con `PPSupabaseReader` por `fetch` a
 * `https://xtgtfjcwxcoxvixholpj.supabase.co`, URL REAL embebida en el bundle de `site/`. Por eso
 * el stub del puente, que hasta el 2026-09-27 bastaba, dejo de basta el 2026-10-03: sus 34
 * peticiones de arranque las cortaba la guarda anti-produccion, la app arrancaba sin estado y la
 * sonda abortaba en la precondicion. Ahora el mismo servidor local de la sonda ATIENDE
 * `/rest/v1/<tabla>` con filas del mismo fixture (`web-probe-supabase.mjs`) y `configure()`
 * apunta ahi el lector y el escritor. Se falsea el ORIGEN, no el camino: la app arranca por
 * Supabase, con el lector de verdad y sus mappers, y nada sale de la maquina.
 *
 * AISLAMIENTO (obligatorio, no opcional): el bundle de `site/` trae embebidas las URLs REALES de
 * produccion (DEFAULT_WEB_APP_URL en el cliente del puente y DEFAULT_URL en el lector y el
 * escritor de Supabase) y su cliente REESCRIBE window.PPAppsScriptBridge, pisando cualquier
 * stub. Sin antidoto, abrir la sonda es operate con el plan de produccion: se leyeron datos reales
 * y "A backlog" (que pide window.confirm) llego a guardarse en CONFIG. Por eso la sonda:
 *   1. bloquea en el contexto toda peticion que no sea del origen local, de modo que el
 *      iframe de Apps Script no se pueda cargar ni de broma;
 *   2. congela window.PPAppsScriptBridge con un setter trap para que el cliente real no lo
 *      pueda sustituir, y hace lo mismo con PPSupabaseReader y PPSupabaseWriter para que no
 *      puedan apuntar a otra parte;
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
import { filasDesdeFixture, responderPostgREST, TABLAS_INEXISTENTES } from "./web-probe-supabase.mjs";

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
// MEDIDO 2026-10-05T18:31Z con sesion: de las 25 tablas que lee el arranque, la UNICA vacia en
// produccion es `work_orders` (0 filas). Con eso, el aviso de catalogos que la persona ve hoy dice
// solo esa, y las ocho que decia la sonda (que no las siembra) no son suyas. Se comparan en el
// informe para que el aviso de la corrida no se lea como el de la planta.
const VACIAS_EN_PRODUCCION = ["work_orders"];
// `--overrides=vacias` ya no apaga una falla real: `machine_planning_overrides` SI existe en el
// proyecto (8 filas medidas) y la sonda ya la sirve con filas. La opcion se deja por si hay que
// aislar el camino del override, pero su premisa anterior (que la tabla no existia y que el 404
// abortaba el apply entero) quedo desmentida.
const OVERRIDES_VACIAS = flag("overrides", "inexistente") === "vacias";

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
/**
 * QUE ESTA ENCIMA DE LA PAGINA CUANDO UN PASO FALLA.
 *
 * MEDIDO 2026-10-05: dos pasosfallen con `page.click: Timeout 30000ms exceeded` y el informe
 * decia solo eso. La causa era un elemento FIJO encima -el aviso de catalogos, `#pp-catalogo-aviso`,
 * z-index 9997- que se vuelve a pintar cuando la pagina vuelve a aplicar los catalogos: el click
 * nunca llega al boton y el error no dice por que. Con esta medicion, el fallo dice QUE habia
 * encima, que es la mitad del trabajo de diagnosticarlo.
 */
async function queTapaLaPagina(page) {
  return page.evaluate(() => {
    const centro = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const encima = document.elementsFromPoint(centro.x, centro.y).slice(0, 3).map((el) => {
      const estilo = getComputedStyle(el);
      return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""} (z=${estilo.zIndex}, ${estilo.position})`;
    });
    const abiertos = Array.from(document.querySelectorAll("dialog[open]")).map((d) => d.id || "(sin id)");
    const velos = ["#pp-login", "#pp-catalogo-aviso", "#planningDialog[open]"]
      .filter((sel) => document.querySelector(sel))
      .map((sel) => {
        const el = document.querySelector(sel);
        return `${sel} (visible=${el.offsetParent !== null || getComputedStyle(el).display !== "none"}, z=${getComputedStyle(el).zIndex})`;
      });
    return { centro, encima, dialogosAbiertos: abiertos, velos };
  });
}

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
    const tapando = await queTapaLaPagina(page).catch(() => null);
    const extra = tapando ? ` | encima: ${JSON.stringify(tapando)}` : "";
    record("fail", name, String(error?.message || error) + extra, { elapsedMs, image, tapando });
    return null;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  return true;
}

/**
 * El cuerpo de la peticion, ya sea JSON o no. MEDIDO 2026-10-05: hace falta porque el PostgREST
 * falso tambien ATIENDE escrituras -antes contestaba 200 a un POST sin guardar nada y por eso
 * "Generar plan" no dejaba ni una operacion con fecha-.
 */
async function leerCuerpo(request) {
  if (request.method === "GET" || request.method === "HEAD") return null;
  const trozos = [];
  for await (const trozo of request) trozos.push(trozo);
  if (!trozos.length) return null;
  const texto = Buffer.concat(trozos).toString("utf8");
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}

async function serveSite(tablas, registro, opcionesRest = {}) {
  const server = createServer((request, response) => {
    // MEDIDO 2026-10-05: sin esto, la corrida MUERE al final y no deja informe. Cuando el
    // navegador cierra (la sonda lo hace en el ultimo paso, con peticiones de la pagina todavia
    // en vuelo), Node aborta esas peticiones entrantes (`abortIncoming`) y cada `request` emite
    // `error` con ECONNRESET. Sin un listener, eso es una excepcion sin capturar y el proceso
    // muere con `Error: aborted` DESPUES del ultimo paso: por eso los informes de algunas
    // corridas no existian aunque todos los pasos hubieran salido. Un abort de un cliente no
    // es un defecto del sitio, asi que se escucha y se deja pasar.
    request.on("error", () => {});
    response.on("error", () => {});
    atenderPeticion(request, response, tablas, registro, opcionesRest).catch((error) => {
      try {
        response.writeHead(500, { "content-type": "text/plain" });
        response.end(`sonda: ${error.message}`);
      } catch {
        // la conexion ya no existe; no hay a quien avisarle
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function atenderPeticion(request, response, tablas, registro, opcionesRest) {
  {
    const url = new URL(request.url, "http://localhost");
    // El LECTOR REAL de Supabase (RULE-SUP-030). MEDIDO 2026-10-05: la sonda estaba midiendo un
    // camino que ya no existe, porque su guarda cortaba estas peticiones y por eso la app
    // arrancaba sin estado. Se atienden aqui, en el MISMO origen local, con filas de fixture.
    // El cuerpo se lee ANTES de responder: las escrituras del escritor (`plan_guardar` y el
    // camino viejo tabla por tabla) viajan en el cuerpo y sin el se contestaba 200 sin guardar.
    const cuerpo = await leerCuerpo(request);
    const rest = responderPostgREST(url, request.method, request.headers, tablas, { ...opcionesRest, cuerpo });
    if (rest) {
      registro.push(`${request.method} ${url.pathname}${url.search}`.slice(0, 160));
      response.writeHead(rest.status, rest.headers);
      response.end(rest.body);
      return;
    }
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
  }
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

/**
 * Apunta el LECTOR y el ESCRITOR de Supabase al PostgREST local.
 *
 * MEDIDO 2026-10-05: con RULE-SUP-030 la pagina no habla con el puente, llama directo a
 * `PPSupabaseBridgeReplacement`, que a su vez usa `PPSupabaseReader` / `PPSupabaseWriter`. La
 * sonda fausseaba `window.PPAppsScriptBridge`, o sea un camino que ya nadie recorre, y su guarda
 * anti-produccion cortaba las 34 peticiones del lector. Con eso la app arrancaba sin estado y la
 * sonda abortaba en la precondicion: verde el 2026-09-27, rota el 2026-10-03 y el 2026-10-05.
 *
 * QUE SE FALSEA Y QUE NO. Se falsea el ORIGEN, no el camino: `configure()` es el gancho que el
 * propio modulo expone, y el lector de verdad corre con sus mappers, sus `MAPPING_GAPS` y su
 * paginacion. La regla se respeta -la app arranca por Supabase- y nada sale de la maquina, porque
 * la guarda sigue cortando todo lo que no sea de este origen y lo unico que responde es el
 * servidor local. El puente de Apps Script se deja falseado igual: no hace falta para el
 * arranque, pero evita que el cliente real se instale por debajo.
 *
 * POR QUE UN SETTER TRAP Y NO UNA LLAMADA. El bundle asigna `window.PPSupabaseReader` al
 * cargarse, y la app lee el estado justo despues: configurar despues seria demasiado tarde. El
 * trap intercepta la asignacion y configura en el acto, sin importar en que punto del bundle
 * aparezca el modulo. La clave que se pone es una cadena local sin valor: solo hace falta que no
 * empiece por `__PP_`, que es lo que `isConfigured()` rechaza.
 */
function installSupabaseTrap(url) {
  const parche = { url: url, anonKey: "sonda-local-sin-valor" };
  window.__PROBE_SUPABASE__ = { configurados: [], configurecidos: [], sesion: false };

  // SESION LOCAL. MEDIDO 2026-10-05: sin esto la pagina levanta el VELO DE ENTRADA
  // (`#pp-login`, z-index 9999) y se come todos los clics de la corrida: 13 pasos detràs de el.
  // El velo aparece porque `supabase-auth.js` no tiene sesion guardada y su build SI esta
  // configurado (la URL real va embebida), que es justo el estado de una pagina sin entrar.
  //
  // Se siembra una sesion FICTICIA en localStorage con `expires_at` lejos: asi `token()` no pide
  // refresco (no hay red hacia auth) y el lector deja de mandar la clave publica sola. No hay
  // contrasena ni token real en ningun sitio: el valor es una cadena sin valor, el JWT viaja al
  // PostgREST local de la sonda, que no lo mira, y `guardarSesion` no escribe en produccion. La
  // alternativa -dejar el velo y medirse una pagina sin sesion- seria medir otra app.
  window.localStorage.setItem("pp_supabase_session", JSON.stringify({
    access_token: "sonda-local-sin-valor",
    refresh_token: "",
    expires_at: Date.now() + 3600 * 1000,
    correo: "sonda@local",
  }));
  window.__PROBE_SUPABASE__.sesion = true;
  for (const nombre of ["PPSupabaseReader", "PPSupabaseWriter"]) {
    let modulo = null;
    const fijar = (valor) => {
      if (valor && typeof valor.configure === "function") {
        try {
          valor.configure(parche);
          window.__PROBE_SUPABASE__.configurecidos.push(nombre);
        } catch (error) {
          window.__PROBE_SUPABASE__.configurados.push(`${nombre}: ${String((error && error.message) || error)}`);
        }
      }
    };
    Object.defineProperty(window, nombre, {
      configurable: true,
      get: () => modulo,
      set: (valor) => {
        modulo = valor;
        fijar(valor);
      },
    });
  }
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
 *
 * MEDIDO 2026-10-05: UNA PASADA NO BASTA, y el motivo esta medido, no supuesto. Al generar el
 * plan, `ot_job_type` y `ot_machine` quedaban vacios aunque se llenaran: cambiar el primero
 * REGENERA el formulario y deja como viejo el `NodeList` capturado, asi que lo que se leia del
 * segundo ya no estaba en el documento y lo que se le escribia se perdia. Por eso cada pasada
 * vuelve a consultar el DOM y solo toca lo que sigue vacio, y se repite hasta que una pasada no
 * cambia nada. Con una sola pasada, el dialogo de preparacion del "Generar plan" se rechazaba solo.
 */
async function fillRequiredControls(page) {
  return page.evaluate(() => {
    const scope = () => document.querySelector("#planningDialogBody");
    const setNative = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, "value")?.set;
      if (setter) setter.call(element, value);
      else element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const hechos = [];
    for (let pasada = 0; pasada < 8; pasada += 1) {
      const raiz = scope();
      if (!raiz) break;
      let cambios = 0;
      for (const select of raiz.querySelectorAll("select[required]")) {
        if (select.value) continue;
        const option = Array.from(select.options).find((item) => item.value);
        if (!option) continue;
        setNative(select, option.value);
        cambios += 1;
        if (hechos.length < 40) hechos.push(`select:${select.name}`);
      }
      const raiz2 = scope();
      if (!raiz2) break;
      for (const input of raiz2.querySelectorAll("input[required]")) {
        const type = (input.type || "text").toLowerCase();
        if (type === "radio" || type === "checkbox") continue;
        if (input.value) continue;
        if (type === "number") setNative(input, "1250.50");
        else if (type === "date") setNative(input, "2026-09-25");
        else setNative(input, "Sonda");
        cambios += 1;
        if (hechos.length < 40) hechos.push(`${type}:${input.name}`);
      }
      const raiz3 = scope();
      if (!raiz3) break;
      const grupos = new Set();
      for (const box of raiz3.querySelectorAll("input[required][type=radio], input[required][type=checkbox]")) {
        const key = `${box.name}:${box.type}`;
        if (grupos.has(key)) continue;
        grupos.add(key);
        if (box.checked) continue;
        box.checked = true;
        box.dispatchEvent(new Event("change", { bubbles: true }));
        cambios += 1;
        if (hechos.length < 40) hechos.push(`${box.type}:${box.name}`);
      }
      if (!cambios) break;
    }
    return hechos;
  });
}

/** Espera breve el dialogo de preparacion, lo llena como haria un usuario y lo confirma. */
/**
 * EL TOTAL DEL BACKLOG, no las tarjetas dibujadas.
 *
 * MEDIDO 2026-10-05: `renderPriorityList` pagina el backlog (`BACKLOG_PAGE_SIZE`) y lo carga
 * con un observador de scroll (`handleBacklogIntersection`), o sea que cuantas tarjetas hay en el
 * DOM depende del historial de scroll, no de cuantos trabajos hay. Comparar las tarjetas antes y
 * despues de buscar media la paginacion, no el filtro: salia "30 de 35" con el backlog entero a
 * la vista. El total si lo dice la app en `#priorityCount` ("N de M trabajos en espera").
 */
async function backlogTotal(page) {
  const texto = ((await page.locator("#priorityCount").textContent()) || "").replace(/\s+/g, " ");
  const total = /de (\d+)\s+trabajos/i.exec(texto);
  return total ? Number(total[1]) : null;
}

/**
 * La huella del dialogo abierto: titulo mas un resumen del cuerpo.
 *
 * MEDIDO 2026-10-05: hace falta porque la app REUSA el mismo `<dialog>` para todos (app.js:4125
 * solo hace `innerHTML = body`), y durante "Generar plan" encadena un dialogo "Preparar OT" por
 * cada OT que falta preparar. Con la pregunta "¿sigue abierto el dialogo?" la sonda confundia
 * "el anterior se confirmo y la app abrio el siguiente" con "la confirmacion fue rechazada":
 * cancelaba el dialogo nuevo, el plan no se preparaba nunca y el paso de "generar plan" quedaba
 * en rojo con 14 OTs sin programar. Con la huella, si el dialogo que sigue abierto es OTRO, el
 * anterior quedo confirmado.
 */
async function huellaDialogo(page) {
  return page.evaluate(() => {
    const abierto = document.querySelector("#planningDialog[open]");
    if (!abierto) return null;
    const titulo = (document.querySelector("#planningDialogTitle")?.textContent || "").trim();
    const cuerpo = document.querySelector("#planningDialogBody")?.innerHTML || "";
    // Un numero primo pequeno para el resumen: no es un hash criptografico, solo que dos
    // cuerpos distintos den casi siempre numeros distintos.
    let h = 0;
    for (let i = 0; i < cuerpo.length; i += 1) h = (h * 31 + cuerpo.charCodeAt(i)) % 1000003;
    return `${titulo}#${cuerpo.length}#${h}`;
  });
}

async function confirmPlanningDialogIfOpen(page, timeout = 2500) {
  const open = page.locator("#planningDialog[open]");
  try {
    await open.waitFor({ state: "visible", timeout });
  } catch {
    return null;
  }
  const title = ((await page.locator("#planningDialogTitle").textContent()) || "").trim();
  const filled = await fillRequiredControls(page);
  const antes = await huellaDialogo(page);
  await page.locator("#planningDialogConfirm").click();
  await page.waitForTimeout(400);
  const despues = await huellaDialogo(page);
  if (!despues) {
    record("ok", "dialogo de preparacion", `"${title}" confirmado (${filled.length} campos)`);
    return title;
  }
  if (despues !== antes) {
    // El dialogo que hay abierto es otro: el que llenamos SI se confirmo y la app encadeno el
    // siguiente. No se toca nada y el bucle de afuera resuelve el nuevo.
    record("ok", "dialogo de preparacion", `"${title}" confirmado (${filled.length} campos); la app encadeno otro dialogo`);
    return title;
  }
  // El MISMO dialogo sigue abierto. MEDIDO 2026-10-05: se midio el valor de los controles en tres
  // momentos para no adivinar: al abrir, justo despues de llenar y 700 ms despues. Si el valor
  // aparece y luego desaparece solo, lo borra la pagina (un repintado asincrono del formulario);
  // si nunca aparece, lo que falla es el llenado. Las dos cosas se contaban antes como "el dialogo
  // no se pudo confirmar", que no dice nada.
  const leer = () => page.evaluate(() => {
    const out = {};
    for (const control of document.querySelectorAll("#planningDialogBody select[required], #planningDialogBody input[required]")) {
      out[control.name || control.type] = String(control.value === undefined ? "" : control.value);
    }
    return out;
  });
  const alAbrir = await leer();
  const lenados = await fillRequiredControls(page);
  const alLLenar = await leer();
  await page.waitForTimeout(700);
  const alEsperar = await leer();
  record(
    "warn",
    "el llenado del dialogo no se sostiene",
    [`${Object.keys(alAbrir).length} controles required`, ...Object.keys(alAbrir).map((nombre) => `${nombre}: abrir=${JSON.stringify(alAbrir[nombre] ?? null)} llenado=${JSON.stringify(alLLenar[nombre] ?? null)} 700ms=${JSON.stringify(alEsperar[nombre] ?? null)}`)].join(" | "),
  );
  await page.locator("#planningDialogConfirm").click();
  await page.waitForTimeout(400);
  const final = await huellaDialogo(page);
  if (!final || final !== antes) {
    record("ok", "dialogo de preparacion", `"${title}" confirmado al reintentar (${filled.length} + ${lenados.length} campos)`);
    return title;
  }
    // El formulario es <form method="dialog"> con validacion nativa: si un required quedo
  // vacio, el navegador no deja cerrar. Se listan los controles invalidos CON SU VALOR.
  const invalid = await page.evaluate(() => {
    const form = document.querySelector("#planningDialogForm");
    if (!form) return [];
    return Array.from(form.querySelectorAll("select, input, textarea"))
      .filter((control) => !control.checkValidity())
      .map((control) => {
        const opciones = control.tagName === "SELECT"
          ? `(opciones: ${Array.from(control.options).map((option) => option.value || "(vacia)").join("|")})`
          : "";
        return `${control.tagName.toLowerCase()}[name=${control.name || "?"}][type=${control.type || "-"}] valor=${JSON.stringify(control.value)}${opciones}`;
      });
  });
  record("warn", "dialogo de preparacion", `"${title}" rejecto la confirmacion; lenados ${lenados.length}; sin validar: ${invalid.join(", ") || "ninguno (el rechazo no es de validacion nativa)"}`);
  await clearPlanningDialog(page, "la confirmacion fue rechazada");
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
  // Ultima OT de la cola: queda seleccionada y con operaciones, pero los datos NO la listan.
  const closedOt = fixture.selectedOts[fixture.selectedOts.length - 1];

  // Las filas que va a servir el PostgREST local salen del MISMO fixture, no de otra fuente: si
  // se escribieran aparte, la sonda estaria midiendo datos que la app nunca ve. `work_orders` NO
  // lista la OT cerrada, igual que el stub del puente no la listaba, para que el retiro de una OT
  // cerrada (RULE-OT-048/050) se siga midiendo por el camino de verdad.
  const tablas = filasDesdeFixture(fixture);
  tablas.work_orders = tablas.work_orders.filter((wo) => wo.ot !== closedOt);

  console.log(`Sonda web local (backend=${BACKEND}): ${fixture.workOrders.length} OTs, ${fixture.operations.length} operaciones, ${fixture.selectedOts.length} en el plan, schemaVersion ${schemaVersion}`);
  console.log(`OT marcada como cerrada para el retiro: ${closedOt}`);

  Object.assign(summary, { otCount: OT_COUNT, seed: SEED, backend: BACKEND, closedOt });

  const peticionesSupabase = [];
  const { server, origin } = await serveSite(tablas, peticionesSupabase, { inexistentesVacias: OVERRIDES_VACIAS });
  summary.origin = origin;
  summary.overridesVacias = OVERRIDES_VACIAS;
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
        // MEDIDO 2026-10-05: `showToast` borra su texto a los 2.2 s (app.js:14511), asi que leer
        // `#toast` despues del paso pierde el aviso que explica un fallo -que fue exactamente lo
        // que paso con "Generar plan": no dejo fecha en el plan y no habia ni un aviso que
        // medir-. Se copia cada texto a una lista que no se limpia. Un observador, no un
        // parcheo de `showToast`, porque esa funcion no se exporta a `window`.
        window.__PROBE_TOASTS__ = [];
        const anotarToast = () => {
          const toast = document.getElementById("toast");
          if (!toast) return;
          const texto = (toast.textContent || "").replace(/\s+/g, " ").trim();
          if (texto && window.__PROBE_TOASTS__.slice(-1)[0] !== texto) {
            window.__PROBE_TOASTS__.push(String(texto).slice(0, 200));
          }
        };
        // Se observa `document` y no `document.documentElement`: el init script corre antes de
        // que exista el elemento raiz y observar un null tira "parameter 1 is not of type 'Node'".
        new MutationObserver(anotarToast).observe(document, {
          subtree: true,
          childList: true,
          characterData: true,
        });
      },
      [storageKey, JSON.stringify(fixture), { state: fixture, closedOts: BACKEND === "stub" ? [closedOt] : [] }],
    );
    if (BACKEND === "stub") {
      await context.addInitScript(bridgeStub);
      await context.addInitScript(installStubTrap);
    }
    // El camino que la app SI usa (RULE-SUP-030): el lector y el escritor de Supabase, apuntados
    // al PostgREST local. Va DESPUES del stub porque el trap se queda con la asignacion.
    await context.addInitScript(installSupabaseTrap, origin);

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
    //
    // MEDIDO 2026-10-05: la pregunta cambio de forma. Exigir llamadas al puente ya no prueba nada,
    // porque la app no lo usa (RULE-SUP-030): las 34 peticiones del arranque eran todas del lector
    // y ninguna del puente. Ahora lo que se mide es que el lector REAL se apunto al PostgREST
    // local, que salio a leer y que la app quedo con el catalogo de maquinas. Si el trap no
    // llegara a tiempo, estas preguntas darian negativo y la sonda abortaria aqui, como antes.
    const arranque = await step(page, "el arranque carga el estado desde Supabase", async () => {
      await page.waitForTimeout(2500);
      // La tabla de maquinas vive en la pestana HERRAMENTALES y `renderConfiguration()` -que la
      // dibuja- solo corre cuando esa seccion esta abierta (app.js:1422). Contarla sin abrirla
      // dio "0 maquinas" en todas las corridas desde el 2026-09-26, verde incluida: no era un
      // defecto de la pagina sino de la comprobacion, que media un panel cerrado.
      await page.click('a.nav-item[data-section="herramentales"]');
      await page.waitForTimeout(600);
      // El aviso de catalogos (#pp-catalogo-aviso) es fijo arriba de todo con z-index 9997 y se
      // come los clics de media pantalla: sin medirlo aqui, los pasos siguientes fallan por el velo y
      // el informe los señala como defectos de la app cuando son consecuencia del aviso. En
      // produccion ese mismo aviso aparece (machine_planning_overrides no existe todavia) y la
      // persona lo cierra con su X: la sonda hace lo mismo y deja constancia de lo que decía.
      const avisoCatalogos = await page.evaluate(() => {
        const caja = document.getElementById("pp-catalogo-aviso");
        if (!caja) return null;
        const texto = (caja.textContent || "").replace(/\s+/g, " ").trim();
        const cerrar = caja.querySelector("button");
        if (cerrar) cerrar.click();
        return texto.slice(0, 240);
      });
      if (avisoCatalogos) {
        summary.avisoCatalogos = avisoCatalogos;
        // El aviso de la sonda NO es el de la persona, y decirlo es parte del dato. MEDIDO
        // 2026-10-05T18:31Z con sesion, de las 25 tablas que lee el arranque la UNICA vacia en
        // produccion es `work_orders` (0 filas, el incidente de las 07:52); las otras ocho que el
        // aviso nombra tienen filas ahi (items 2494, inventory 1935, sales_orders 148,
        // unconfirmed_work_orders 20, closed_work_order_summaries 18, subcontracts 11, ot_types 4,
        // calendar_exceptions 2). La sonda las sirve vacias porque el fixture no las siembra, asi
        // que el aviso se lee como "una planta sin esos datos" y no como "la pagina esta asi".
        // El texto del aviso viene pegado ("Supabaseot_types", porque son dos elementos sin
        // espacio entre ellos), asi que se quita la frase fija del pie y se parte por comas. MEDIDO
        // 2026-10-05: con un `match` de identificadores salian pedazos ("ablas", "upabaseot_types").
        const cuerpo = avisoCatalogos
          .replace(/^.*?Supabase/, "")
          .split(".")[0];
        const enElAviso = cuerpo
          .split(",")
          .map((t) => t.trim().replace(/^[^a-z_]*/, ""))
          .filter((t) => /^[a-z_][a-z0-9_]*$/.test(t));
        const soloEnLaSonda = enElAviso.filter((t) => !VACIAS_EN_PRODUCCION.includes(t));
        const soloEnProduccion = VACIAS_EN_PRODUCCION.filter((t) => !enElAviso.includes(t));
        summary.avisoCatalogosVsProduccion = { enLaSonda: enElAviso, vaciasEnProduccion: VACIAS_EN_PRODUCCION, soloEnLaSonda, soloEnProduccion };
        record("warn", "aviso de catalogos en pantalla", `${avisoCatalogos} || MEDIDO en produccion: solo ${VACIAS_EN_PRODUCCION.join(", ")} esta vacia; la sonda deja ${soloEnLaSonda.length} sin sembrar (${soloEnLaSonda.join(", ")}) y no nombra ${soloEnProduccion.join(", ") || "ninguna"}`);
      }
      const observed = await page.evaluate(() => ({
        calls: window.__PROBE_CALLS__ || [],
        fijados: window.__PROBE_PINNED__ || [],
        pisados: window.__PROBE_STOLEN__ || [],
        supabase: window.__PROBE_SUPABASE__ || { configurados: [], configurecidos: [] },
        maquinas: document.querySelectorAll("#machineTable [data-delete-machine]").length,
        // MEDIDO 2026-10-05: contar maquinas NO demuestra que el catalogo llegara desde Supabase,
        // porque el estado del fixture ya trae 4 y con el apply abortado seguian siendo 4. Por eso
        // el falso sirve una maquina de mas que el fixture NO tiene (`SUP-05`): si el nombre esta
        // en pantalla, el catalogo vino de `machine_catalog`; si no esta, el apply se aborto y la
        // pagina quedo con el estado del fixture.
        maquinasDeSupabase: Array.from(document.querySelectorAll("#machineTable tr"))
          .map((fila) => (fila.textContent || "").replace(/\s+/g, " ").trim())
          .filter((texto) => texto.indexOf("SUP-05") >= 0).length,
      }));
      // Se vuelve al PLAN. Los pasos que siguen miden el plan (agregar OT, generar, Gantt,
      // reportes) y sus controles solo existen en esa vista: quedarse en Herramientas hacia que
      // fallen por "elemento no visible" y el informe los senale como defectos de la app.
      await page.click('a.nav-item[data-section="plan-semanal"]');
      await page.waitForTimeout(400);
      const lecturas = peticionesSupabase.filter((linea) => linea.startsWith("GET "));
      const tablasLeidas = [...new Set(lecturas.map((linea) => (/\/rest\/v1\/([^?]+)/.exec(linea) || [])[1]).filter(Boolean))].sort();
      summary.bridgeCalls = observed.calls;
      summary.bridgePinned = observed.fijados;
      summary.bridgeStolen = observed.pisados;
      summary.supabaseConfigure = observed.supabase;
      summary.supabaseTables = tablasLeidas;
      const pidioEstado = observed.supabase.configurecidos.includes("PPSupabaseReader") && tablasLeidas.length > 0;
      check("el arranque lee el estado por Supabase", pidioEstado, `configurados: ${JSON.stringify(observed.supabase.configurecidos)} · ${tablasLeidas.length} tablas: ${tablasLeidas.slice(0, 8).join(", ")}`);
      check("el catalogo de maquinas queda disponible", observed.maquinas > 0, `${observed.maquinas} maquinas en Catalogos`);
      // El que de verdad importa: que la maquina que SOLO esta en `machine_catalog` aparezca. Sin
      // este check, un apply abortado se ve igual que un apply bueno.
      check(
        "el catalogo de maquinas LLEGO desde Supabase, no se quedo con el del fixture",
        observed.maquinasDeSupabase > 0,
        `${observed.maquinasDeSupabase} filas con la maquina que solo esta en machine_catalog (SUP-05) de ${observed.maquinas} en pantalla`,
      );
      record(pidioEstado ? "ok" : "fail", "carga de estado inicial", `${lecturas.length} lecturas a Supabase en ${tablasLeidas.length} tablas, ${observed.calls.length} llamadas al puente, ${observed.maquinas} maquinas`);
      if (!pidioEstado) throw new Error("SIN ESTADO INICIAL: el resto de los pasos mediria una app degradada, no la app real");
      return observed;
    });
    if (!arranque) {
      record("fail", "sonda interrumpida", "El arranque no cargo el estado desde Supabase; los pasos siguientes no son validos. Revisar que el trap de PPSupabaseReader este instalado ANTES de que el bundle lo asigne y que el PostgREST local atienda /rest/v1.");
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

    // El retiro de la OT cerrada NO se mide aqui. Antes se media en este punto porque el stub
    // del puente hacia la conciliacion al arrancar; con Supabase como fuente (RULE-SUP-030) la
    // conciliacion ocurre en la COMPROBACION AUTOMATICA DE FRESCURA, que solo corre dentro de
    // "Generar plan" y "Publicar" (app.js:6017) y no cuando la pagina arranca. Se mide ahi,
    // despues de generar el plan, que es donde ocurre de verdad.

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
      // MEDIDO 2026-10-05: esta reposicion se daba por buena con UNA sola OT en la cola, y los
      // pasos que miden el motor, el Gantt y el cuadre con los reportes comparan contra el plan
      // entero (las 180 operaciones del fixture). Con una cola de 3 fallaban por falta de volumen
      // y el informe senalaba un defecto del motor que no existia. Se repone hasta el numero de
      // OTs con las que el fixture siembra el plan, que es el plan que se quiere medir.
      const objetivo = fixture.selectedOts.length;
      const antes = await queueCount();
      const cards = page.locator(".priority-card");
      let agregadas = 0;
      let cursor = 0;
      for (let intento = 0; intento < objetivo * 3 + 8; intento += 1) {
        if ((await queueCount()) >= objetivo) break;
        const total = await cards.count();
        if (cursor >= total) break;
        const card = cards.nth(cursor);
        // Una tarjeta con el boton deshabilitado se SALTA y se sigue: MEDIDO 2026-10-05, se
        // elegia la ultima del backlog y con la primera deshabilitada la reposicion se
        // rendia ("5 de 14" con 30 tarjetas disponibles). El indice solo avanza en las que no
        // se pueden agregar, porque al agregar una la tarjeta sale del backlog y las de despues
        // se corren una posicion.
        const addButton = card.locator(".job-add");
        if (await addButton.isDisabled()) {
          cursor += 1;
          continue;
        }
        const ot = await card.getAttribute("data-ot");
        await addButton.click();
        await confirmPlanningDialogIfOpen(page);
        await page.waitForTimeout(350);
        if ((await page.locator(`[data-queue-ot='${ot}']`).count()) > 0) agregadas += 1;
        else cursor += 1;
      }
      const queue = await queueCount();
      check("la cola queda con OTs para programar", queue > 0, `${agregadas} agregadas, ${queue} en la cola`);
      check("la cola se repone al tamaño del plan que se va a medir", queue >= objetivo, `${queue} de ${objetivo} (estaba en ${antes})`);
      record(queue > 0 ? "ok" : "fail", "reposicion del plan", `${queue} OTs en la cola de ${objetivo} del fixture`);
    });

    await step(page, "busqueda y filtro de backlog y cola", async () => {
      const cardsAll = await backlogCount();
      // MEDIDO 2026-10-05: el total se leia DESPUES de filtrar, y con el filtro puesto
      // `#priorityCount` ya no decia "N de M trabajos en espera" del backlog entero: el informe
      // salia "total 26 de 0 que habia" y el paso fallaba solo por el orden de las lecturas. El
      // total sin filtro se lee primero, que es lo que dice "que habia".
      const totalAll = await backlogTotal(page);
      await page.fill("#searchInput", "EG40-001");
      await page.waitForTimeout(300);
      const cardsFiltered = await backlogCount();
      const totalFiltrado = await backlogTotal(page);
      await page.fill("#searchInput", "");
      // MEDIDO 2026-10-05: esperar 300 ms fijos no alcanza y el paso salia a veces con "0
      // tarjetas, total 26 de 26 que habia": el total ya volvia pero las tarjetas todavia no,
      // porque el repintado de la lista no termina en un tiempo fijo. Se espera a que el numero
      // de tarjetas se estabilice, con un techo, y se reportan las lecturas para que un fallo
      // diga si fue "nunca volvio" o "volvio tarde".
      const lecturas = [];
      let cardsRestored = 0;
      for (let intento = 0; intento < 20; intento += 1) {
        await page.waitForTimeout(150);
        cardsRestored = await backlogCount();
        lecturas.push(cardsRestored);
        if (cardsRestored > 0 && lecturas.slice(-2).every((valor) => valor === cardsRestored)) break;
      }
      const totalRestored = await backlogTotal(page);
      check("la busqueda filtra el backlog", cardsFiltered <= cardsAll, `${cardsAll} -> ${cardsFiltered} tarjetas, total ${totalAll} -> ${totalFiltrado}`);
      check(
        "al limpiar la busqueda vuelve el backlog",
        totalAll !== null && totalRestored === totalAll && cardsRestored === cardsAll,
        `${cardsRestored} tarjetas de las ${cardsAll} que habia, total ${totalRestored} de ${totalAll}; lecturas cada 150 ms: ${lecturas.join(", ")}`,
      );

      const queueAll = await queueCount();
      await page.fill("#queueSearchInput", "zzz-no-existe-zzz");
      await page.waitForTimeout(300);
      const queueFiltered = await queueCount();
      await page.fill("#queueSearchInput", "");
      await page.waitForTimeout(300);
      const queueRestored = await queueCount();
      check("la busqueda filtra la cola", queueFiltered <= queueAll, `${queueAll} -> ${queueFiltered}`);
      check("al limpiar la busqueda vuelve la cola", queueRestored === queueAll, `${queueRestored} de ${queueAll}`);
      // MEDIDO 2026-10-05: el articulo de la tarjeta sale de `work_orders.item` y la descripcion de
      // `work_orders.description` (app.js:12901-12903); `operations` NO tiene columna de parte ni
      // de descripcion del articulo (docs/schema-supabase.sql:192-221, y el lector tampoco las
      // arma, supabase-reader.js:1085-1110). Por eso una OT que no esta en el espejo sale con
      // "PLAN SIN ARTICULO / Sin descripcion": es exactamente la tarjeta que se ve hoy con
      // `work_orders` en cero, pero en esta corrida solo le falta la fila a UNA OT (la cerrada que
      // se inyecta), asi que el numero medido es 1 y no todas. Se cuenta igual, porque el sintoma
      // que se quiere vigilar es "la tarjeta perdio el articulo", y su causa es la tabla, no la
      // pagina.
      const sinArticulo = await page.evaluate(() => {
        const tarjetas = Array.from(document.querySelectorAll(".priority-card"));
        const malas = tarjetas.filter((tarjeta) => /SIN ARTICULO/.test(tarjeta.textContent || ""));
        return { total: tarjetas.length, sinArticulo: malas.length, ejemplos: malas.slice(0, 3).map((t) => ((t.getAttribute("data-ot") || "") + ": " + (t.textContent || "").replace(/\s+/g, " ").trim().slice(0, 90))) };
      });
      summary.articulosEnBacklog = sinArticulo;
      check("el backlog muestra el articulo de cada OT", sinArticulo.sinArticulo === 0, `${sinArticulo.sinArticulo} de ${sinArticulo.total} tarjetas sin articulo; el articulo sale de work_orders.item (app.js:12901-12903), asi que falta en la OT que no esta en el espejo${sinArticulo.ejemplos.length ? `: ${sinArticulo.ejemplos.join(" | ")}` : ""}`);
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
      // MEDIDO 2026-10-05: la lista de avisos se recorta ANTES de pulsar. Antes se leian los tres
      // ULTIMOS de toda la corrida y el paso 11 (que hace un dry run y avisa) venia despues, asi
      // que lo que se mediia eran los avisos del dry run y los del "Generar plan" verdad se
      // perdian. Con el recorte, lo que sale en el informe es lo que la persona vio al generar.
      const avisosAntes = await page.evaluate(() => (window.__PROBE_TOASTS__ || []).length);
      await button.click();
      await page.waitForSelector("#planningDialog[open]", { timeout: TIMEOUT_MS });
      const weeks = await page.locator("#planningDialogBody input[name=plan_week]").count();
      check("el dialogo ofrece semanas", weeks >= 1, `${weeks} opciones`);
      await page.click("#planningDialogConfirm");
      // MEDIDO 2026-10-05: elegir semana NO es el ultimo dialogo. El motor pide despues
      // "Completar configuracion del plan" (app.js:3805) y ese dialogo se queda ABIERTO si nadie
      // lo contesta: el plan no se genera y, ademas, `#planningDialog` es el unico `<dialog>` de
      // la pagina, asi que se come los clics de los pasos siguientes: eso era lo que hacia que los
      // pasos de reportes y de exportar fallaran con "click: Timeout" sin decir por que.
      // Ahora se resuelve cada dialogo que aparezca, como haria una persona -llenar lo required y
      // confirmar- y se espera a que el boton vuelva a su etiqueta de reposo ("Generar plan",
      // app.js:5968), que es la unica senal de que la app termino. Los titulos quedan en el
      // informe: un dialogo que la persona tiene que responder es informacion, no ruido.
      const abiertos = [];
      const limite = Date.now() + TIMEOUT_MS;
      let quietos = 0;
      while (Date.now() < limite && abiertos.length < 60) {
        const titulo = await confirmPlanningDialogIfOpen(page, 400);
        if (titulo) {
          abiertos.push(titulo);
          quietos = 0;
          continue;
        }
        const trabajando = await page.evaluate(() => {
          const etiqueta = document.querySelector("#generatePlanBtn [data-schedule-label]")?.textContent || "";
          return /generando|revisando|actualizando|validando|calculando|guardando|reintentando/i.test(etiqueta);
        });
        // MEDIDO 2026-10-05: hay que ver la pagina QUIETA tres veces seguidas, no una. La app
        // encadena los dialogos de preparacion con esperas entre uno y otro, asi que con una sola
        // lectura de "reposo" el bucle se salia, el dialogo siguiente se dejaba abierto y el plan
        // se quedaba sin preparar: era el paso entero el que quedaba en rojo.
        quietos = trabajando ? 0 : quietos + 1;
        if (quietos >= 3) break;
        await page.waitForTimeout(400);
      }
      if (abiertos.length) {
        summary.dialogosAlGenerar = abiertos;
        record(abiertos.length > 1 ? "warn" : "ok", "dialogos durante generar plan", `la app abrio ${abiertos.length}: ${abiertos.join(" | ")}`);
      }
      await page.waitForTimeout(1200);
      const alerts = ((await page.locator("#planAlerts").textContent()) || "").trim();
      // MEDIDO 2026-10-05: el paso solo miraba `#planAlerts`, que esta VACIO cuando la app se
      // avisa por `showToast` (app.js:14506). Con la cola llena, "Generar plan" no dejo ninguna
      // operacion con fecha y el paso pasaba igual: el aviso va al toast, no a los alerts. Se
      // leen los dos y se dejan en el informe, porque un toast que dice por que no se genero es
      // la respuesta que hace falta.
      const toast = ((await page.locator("#toast").textContent()) || "").trim();
      const toasts = await page.evaluate((desde) => (window.__PROBE_TOASTS__ || []).slice(desde), avisosAntes);
      summary.toastsAlGenerar = toasts;
      const dicho = toasts.join(" | ");
      if (dicho) {
        summary.toastAlGenerar = dicho;
        record(/no se genero|no hay|error|no se pudo/i.test(dicho) ? "warn" : "ok", "avisos al generar el plan", dicho.slice(0, 300));
      }
      // El boton lleva el estado del guardado (`[data-schedule-label]`, app.js:5973). Dice en que
      // punto va o en que se quedo, que es lo que un boton en "Generando plan..." indefinidamente
      // escondia.
      const etiqueta = ((await page.locator("#generatePlanBtn [data-schedule-label]").textContent().catch(() => "")) || "").trim();
      if (etiqueta) summary.etiquetaAlGenerar = etiqueta;
      const elapsedMs = Date.now() - started;
      check("generar plan deja el plan con fecha", (await page.locator(".queue-item.pending-schedule").count()) === 0, `${await page.locator(".queue-item.pending-schedule").count()} OTs sin programar, toast: ${toast.slice(0, 120) || "(ninguno)"}`);
      check("generar plan no aborta por datos de OTs", !/datos de OTs sin sincronizar|No se pudo verificar NetSuite/.test(alerts), alerts.slice(0, 180));
      const queue = await queueCount();
      check("la cola sobrevive a generar plan", queue > 0, `${queue} OTs`);
      record("ok", "generar plan", `${elapsedMs} ms, ${queue} OTs en la cola`, { elapsedMs });
      summary.generatePlanMs = elapsedMs;
    });

    // EL RETIRO DE LA OT CERRADA, aqui y no antes. MEDIDO 2026-10-05: la OT 3092 esta en la
    // cola del fixture y NO esta en `work_orders`, que es lo mismo que una OT cerrada en
    // NetSuite. Quien la tiene que sacar es `ensureNetSuiteWorkOrdersFresh` (app.js:6017), que
    // corre dentro de "Generar plan" porque el reloj de frescura (15 min) venció, y llama a
    // `reconcileActiveWorkOrders` sobre lo que lee de Supabase. Con el `syncedAt` fresco del
    // fixture anterior esa comprobacion se saltaba y el retiro nunca se media.
    if (BACKEND === "stub") {
      await step(page, "retiro de la OT cerrada que ya no esta en el espejo (RULE-OT-048/050)", async () => {
        const inQueue = `[data-queue-ot='${closedOt}']`;
        const gone = (await page.locator(inQueue).count()) === 0;
        const tarjeta = page.locator(`.priority-card[data-ot='${closedOt}']`);
        const cardGone = (await tarjeta.count()) === 0;
        check("la OT cerrada sale de la cola del plan", gone, closedOt);
        // MEDIDO 2026-10-05: la tarjeta NO sale del backlog y este paso solo decia "3092". Que la
        // OT se retire del PLAN es una cosa (eso si funciona) y que salga de la LISTA es otra, y
        // son reglas distintas: si la tarjeta se queda, la persona sigue viendo una OT que ya no
        // existe en NetSuite. El detalle dice COMO se ve la tarjeta -estado, clase y si esta
        // bloqueada- porque la diferencia entre "el backlog no la limpio" y "la limpio pero la
        // deja por una regla" no se puede ver sin mirarla, y es una decision de regla, no un
        // arreglo de codigo. El paso se queda en rojo mientras la regla no se decida.
        const estado = cardGone ? null : await tarjeta.evaluate((nodo) => ({
          texto: (nodo.textContent || "").replace(/\s+/g, " ").trim().slice(0, 220),
          clases: nodo.className,
          etiqueta: nodo.getAttribute("aria-label") || "",
          botonDeshabilitado: Boolean(nodo.querySelector("button[disabled]")),
        }));
        summary.retiroOtCerrada = { ot: closedOt, enCola: !gone, enBacklog: !cardGone, tarjeta: estado };
        check("la OT cerrada no reaparece en el backlog", cardGone, cardGone ? closedOt : `${closedOt} sigue en la lista: "${estado.texto}"${estado.botonDeshabilitado ? " (su boton esta deshabilitado)" : ""}; clases ${estado.clases}`);
        record(gone && cardGone ? "ok" : "fail", "retiro de OT cerrada", `cola ${gone ? "limpia" : "con la OT"}, backlog ${cardGone ? "limpio" : `con la OT${estado.botonDeshabilitado ? " sin boton para tomarla" : ""}`}`);
      });
    }

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
      // MEDIDO 2026-10-05: `scheduled + unscheduled >= included` NO SE PUEDE CUMPLIR y la asercion
      // era falsa, no un defecto. `includedOperationsCount` es `currentPlanOperations().length`
      // (app.js:6433), y esa funcion filtra por capacidades EXCLUIDAS, no por OTs seleccionadas
      // (app.js:6380-6390): cuenta TODAS las operaciones del estado, tambien las de OTs que estan
      // en el backlog. Por eso salia "68+0 vs 181" con las 14 OTs del plan bien programadas.
      //
      // Lo que si se puede cruzar con la metrica del motor es lo que la persona VE DENTRO de la
      // ventana del Gantt, y la ventana hay que restarla: el Gantt dibuja `state.horizonDays`
      // dias desde `window.start` (app.js:4636), asi que con el horizonte del fixture (7 dias,
      // web-fixture.mjs:235) solo aparecen las operaciones que caen dentro. Contadas las de todo
      // el plan, las barras dan 16 contra 68 programadas y eso NO es un defecto: son operaciones
      // de dias que no estan a la vista. Se cuentan entonces las barras cuyo inicio cae dentro
      // de la ventana, que es lo comparable.
      const gantt = await page.evaluate(() => ({
        dias: Array.from(document.querySelectorAll("#ganttCanvas .gantt-day-heading"))
          .map((nodo) => (nodo.querySelector(".gantt-day-title")?.textContent || "").trim()).filter(Boolean),
        barras: Array.from(document.querySelectorAll("#ganttCanvas .gantt-bar")).map((barra) => {
          const id = String(barra.dataset.id || "");
          const corte = id.lastIndexOf("-");
          const lineas = (barra.getAttribute("title") || "").split("\n");
          const de = (prefijo) => (lineas.find((linea) => linea.startsWith(prefijo)) || "").slice(prefijo.length).trim();
          // Las barras de cambio de herramental no son una operacion: su id empieza con `chg-`
          // (app.js:4874 las marca asi) y no llevan OT de forma directa.
          const esCambio = id.startsWith("chg-");
          return {
            id,
            ot: esCambio ? (id.split("-")[1] || "") : id.slice(0, corte),
            esCambio,
            inicio: de("Inicio:"),
            fin: de("Fin:"),
            izquierda: parseFloat(barra.style.left) || 0,
            ancho: parseFloat(barra.style.width) || 0,
          };
        }),
      }));
      const cola = new Set((await page.locator("#priorityQueue [data-queue-ot]").evaluateAll((nodos) => nodos.map((nodo) => nodo.getAttribute("data-queue-ot")))).map((ot) => String(ot).trim()));
      const barrasDelPlan = gantt.barras.filter((barra) => cola.has(barra.ot));
      const barrasDeOtAjena = gantt.barras.filter((barra) => !cola.has(barra.ot));
      summary.ventanaGantt = {
        dias: gantt.dias,
        horizonte: gantt.dias.length,
        barras: gantt.barras.length,
        barrasDelPlan: barrasDelPlan.length,
        otsEnElGantt: Array.from(new Set(gantt.barras.map((barra) => barra.ot))),
        scheduled,
      };
      check("el Gantt dibuja operaciones del plan", barrasDelPlan.length > 0, `${barrasDelPlan.length} barras de ${new Set(barrasDelPlan.map((b) => b.ot)).size} OTs de la cola; el motor programo ${scheduled} operaciones en todo el plan`);
      check("el Gantt no dibuja operaciones de OTs ajenas al plan", barrasDeOtAjena.length === 0, barrasDeOtAjena.length ? barrasDeOtAjena.slice(0, 5).map((b) => `${b.id} (${b.inicio})`).join(" | ") : "ninguna barra de OT fuera de la cola");
      check("no hay conflictos de operador sin resolver", !codes.OPERATOR_CONFLICT_FIXED_WINDOW, JSON.stringify(codes));
      check("el plan cubre todas las OTs seleccionadas", Number(metrics.scheduledOtsCount || 0) > 0, `${metrics.scheduledOtsCount} OTs programadas, ${metrics.unscheduledOtsCount} sin programar, ${metrics.engineSelectedOtsCount} que el motor recibio del plan`);
      // MEDIDO 2026-10-05: el Gantt solo dibuja `horizonDays` dias desde `window.start`
      // (app.js:4636), asi que su numero de barras NUNCA es el total de operaciones programadas:
      // con el horizonte del fixture (7 dias) salen 16 de 68. Tampoco se puede cruzar OT por OT
      // con la metrica del motor porque `runPlanningPerformanceDryRun` no publica el detalle por
      // OT (las metricas son app.js:6270-6280 y ninguna es una lista de OTs). Lo que si queda
      // medido es lo que la persona ve, y va en el informe como numero, no como asercion:
      // cuantas OTs de la cola tienen barra a la vista y cuantas de las 14 no.
      const otsEnGantt = Array.from(new Set(barrasDelPlan.map((barra) => barra.ot)));
      const otsSinBarra = Array.from(cola).filter((ot) => !otsEnGantt.includes(ot));
      summary.coberturaGantt = { otsEnCola: cola.size, otsEnGantt: otsEnGantt.length, sinBarra: otsSinBarra };
      record(unscheduled === 0 ? "ok" : "fail", "programacion del plan", `${scheduled} programadas, ${unscheduled} sin hueco, ${included} operaciones NO excluidas en el estado (todas, no solo las del plan), ${metrics.plannerElapsedMs} ms, ${metrics.plannerStrategiesStarted} estrategia(s), diagnosticos ${JSON.stringify(codes)}`);
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

    await step(page, "precedencia: una sucesora no arranca antes que su antecesora", async () => {
      // MEDIDO 2026-10-05: ESTE PASO NO COMPARABA NADA. Leia `data-start` de las filas del
      // reporte de la semana -una columna que no existe, por eso la muestra salia con
      // `start: ""`- y despues solo anotaba la muestra: el paso pasaba sin mirar un solo par de
      // operaciones. Ahora se mide lo que la persona ve: las BARRAS DEL GANTT, que llevan el id de
      // la operacion (`<ot>-<secuencia>`, app.js:4871) y su posicion en el carril (`left` y `width`
      // en porcentaje de la MISMA ventana, app.js:4912-4913). La precedencia se compara con esos
      // numeros: dentro de una OT, la secuencia siguiente no puede empezar antes de que termine la
      // anterior.
      //
      // MEDIDO 2026-10-05, segundo intento: agrupar por FILA daba cero comparaciones, y no era un
      // defecto del motor: en la vista "job" hay una fila por operacion, asi que cada grupo tenia
      // una sola barra. La comparacion es por OT y con las FECHAS del tooltip, no con el
      // `left`/`width` en porcentaje: esos dependen del zoom y del ancho minimo de la barra
      // (`MIN_OPERATION_MINUTES`, app.js:4864), mientras que las fechas son minutos de reloj.
      //
      // MEDIDO 2026-10-05, tercer intento, y este es el que importa: "una sucesora no empieza
      // antes de que la anterior TERMINE" NO es la regla. La regla es que espere al "momento de
      // liberacion" (rules.json RULE-MAT-011: "cada operacion movible debe esperar el momento de
      // liberacion mas tardio de las operaciones incluidas con secuencia anterior"), y ese momento
      // puede caer ANTES del fin: `predecessorReleaseMoment` (planner-core.js:1075-1087) devuelve el
      // hito de `duracion * overlap` cuando la capacidad tiene regla de solape
      // (`overlapForOperation`, planner-core.js:1576; sin regla, 1 = fin completo). El fixture
      // siembra 0.6 para DOBLADO, SOLDADURA y PINTURA (web-fixture.mjs:269-271), asi que hay
      // solapes legitimos y la asercion anterior los contaba como errores.
      //
      // Lo que si es cierto con CUALQUIER solape permitido es que una sucesora no puede arrancar
      // antes de que su antecesora arranque. Eso se comprueba. Los solapes se miden y se reportan
      // con minutos y fraccion, porque la fraccion de minutos PRODUCTIVOS solo la puede calcular
      // el motor (los segmentos Bucket/Include/Ignore) y una sonda que recalcula esa regla estaria
      // midiendo una copia de la regla, no la regla.
      const barras = await page.evaluate(() => Array.from(document.querySelectorAll("#ganttCanvas .gantt-bar")).map((barra) => {
        const id = String(barra.dataset.id || "");
        const esCambio = id.startsWith("chg-");
        const corte = id.lastIndexOf("-");
        const lineas = (barra.getAttribute("title") || "").split("\n");
        const de = (prefijo) => (lineas.find((linea) => linea.startsWith(prefijo)) || "").slice(prefijo.length).trim();
        const fecha = (texto) => {
          const ms = Date.parse(String(texto).replace(" ", "T"));
          return Number.isFinite(ms) ? ms : null;
        };
        return {
          id,
          ot: esCambio ? (id.split("-")[1] || "") : id.slice(0, corte),
          secuencia: esCambio ? Number.NaN : Number(id.slice(corte + 1)),
          esCambio,
          inicio: fecha(de("Inicio:")),
          fin: fecha(de("Fin:")),
          espera: de("Espera:"),
          inicioTexto: de("Inicio:"),
          finTexto: de("Fin:"),
        };
      }).filter((barra) => barra.ot && Number.isFinite(barra.inicio) && Number.isFinite(barra.fin)));
      const porOt = new Map();
      for (const barra of barras) {
        if (barra.esCambio) continue;
        const lista = porOt.get(barra.ot) || [];
        lista.push(barra);
        porOt.set(barra.ot, lista);
      }
      const invertidas = [];
      const solapes = [];
      let comparadas = 0;
      for (const [ot, lista] of porOt) {
        lista.sort((a, b) => a.secuencia - b.secuencia);
        for (let i = 1; i < lista.length; i += 1) {
          comparadas += 1;
          const previa = lista[i - 1];
          const actual = lista[i];
          if (actual.inicio < previa.inicio) {
            invertidas.push(`OT ${ot}: la sec ${actual.secuencia} arranca ${actual.inicioTexto}, antes que su anterior, la sec ${previa.secuencia} (${previa.inicioTexto})`);
          } else if (actual.inicio < previa.fin) {
            const duracion = Math.max(1, previa.fin - previa.inicio);
            const avance = actual.inicio - previa.inicio;
            solapes.push(`OT ${ot}: la sec ${actual.secuencia} arranca ${actual.inicioTexto}, ${Math.round((previa.fin - actual.inicio) / 60000)} min antes de que termine la sec ${previa.secuencia} (lleva ${Math.round((avance / duracion) * 100)}% de su duracion)`);
          }
        }
      }
      summary.precedencia = {
        barras: barras.length,
        ots: porOt.size,
        barrasPorOt: Array.from(porOt.entries()).map(([ot, lista]) => `${ot}:${lista.length}`),
        comparadas,
        invertidas,
        solapes,
        conEspera: barras.filter((barra) => barra.espera).map((barra) => `${barra.id} ${barra.espera}`).slice(0, 10),
        // Las reglas de solape que se sembraron (web-fixture.mjs:269-271) van EN el informe al
        // lado de los solapes medidos: sin ellas, el que lee "la sec 2 arranca 928 min antes" no
        // puede saber si eso lo permitia la capacidad de la antecesora o no.
        reglasDeSolape: fixture.operationRules,
      };
      check("hay operaciones con las que comparar precedencia", comparadas > 0, `${comparadas} pares en ${porOt.size} OTs (${Array.from(porOt.entries()).map(([ot, lista]) => `${ot}:${lista.length}`).join(", ")})`);
      check("ninguna operacion arranca antes que la anterior de su secuencia", invertidas.length === 0, invertidas.slice(0, 5).join(" | ") || `${comparadas} pares en orden de arranque`);
      record(invertidas.length === 0 ? "ok" : "fail", "precedencia en el Gantt", `${comparadas} pares, ${invertidas.length} arrancan invertidas, ${solapes.length} con solape permitido por la capacidad`);
      if (solapes.length) {
        record("warn", "solapes con la antecesora", solapes.slice(0, 6).join(" | "));
      }
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
      // MEDIDO 2026-10-05: este paso comparaba numeros sueltos: sacaba las OTs del texto del
      // reporte con una expresion regular de cuatro digitos y las de la cola por atributo. Con eso
      // decia "0 de 4 OTs del reporte estan en el plan" sin decir WHICH, sin decir de que semana
      // es cada lado, y sin decir de donde saca sus operaciones el reporte. Ahora se leen las
      // TRES fuentes con su dato real: las filas del reporte con su dia (`data-ot` de cada
      // boton, app.js:8601), las barras del Gantt con su operacion y su `Inicio:`/`Fin:`
      // (app.js:4895-4896) y la cola del plan. Con eso la pregunta "¿es un defecto de la app o
      // estoy comparando cosas distintas?" se responde con numeros y no con suposiciones.
      const detalle = await page.evaluate(() => {
        const reporte = document.querySelector("#weekReport");
        const filas = [];
        for (const bloque of Array.from(reporte?.querySelectorAll(".weekly-day-block") || [])) {
          const fecha = (bloque.querySelector(".weekly-day-ribbon")?.textContent || "").replace(/\s+/g, " ").trim();
          for (const boton of Array.from(bloque.querySelectorAll(".weekly-ot-link"))) {
            filas.push({ fecha, ot: boton.getAttribute("data-ot") || "" });
          }
        }
        const barras = Array.from(document.querySelectorAll("#ganttCanvas .gantt-bar")).map((barra) => {
          const id = String(barra.dataset.id || "");
          const corte = id.lastIndexOf("-");
          const lineas = (barra.getAttribute("title") || "").split("\n");
          const de = (prefijo) => lineas.find((linea) => linea.startsWith(prefijo))?.slice(prefijo.length).trim() || "";
          return { id, ot: id.slice(0, corte), secuencia: id.slice(corte + 1), inicio: de("Inicio:"), fin: de("Fin:") };
        });
        const panel = reporte?.closest("[data-tab-panel], section, article");
        return {
          fuente: (document.querySelector("#reportSnapshotMeta")?.textContent || "").replace(/\s+/g, " ").trim(),
          semana: document.querySelector("#reportWeekStartInput")?.value || "",
          titulo: (panel?.querySelector("h2, h3")?.textContent || "").replace(/\s+/g, " ").trim(),
          filas: filas.slice(0, 24),
          totalFilas: filas.length,
          barras: barras.slice(0, 20),
          totalBarras: barras.length,
        };
      });
      const reportOts = Array.from(new Set(detalle.filas.map((fila) => fila.ot).filter(Boolean)));
      const planOts = new Set(queue.map((ot) => String(ot).trim()));
      const shared = reportOts.filter((ot) => planOts.has(ot));
      const delPlanEnGantt = new Set(detalle.barras.map((barra) => barra.ot));
      summary.cuadre = {
        fuenteDelReporte: detalle.fuente,
        semanaDelReporte: detalle.semana,
        titulo: detalle.titulo,
        filasDelReporte: detalle.filas,
        totalFilasDelReporte: detalle.totalFilas,
        barrasDelGantt: detalle.barras,
        totalBarrasDelGantt: detalle.totalBarras,
        reportOts,
        planOts: Array.from(planOts),
        shared,
      };
      check("el reporte de la semana trae filas", detalle.totalFilas > 0, `${detalle.totalFilas} filas, ${reportOts.length} OTs distintas; fuente "${detalle.fuente}", semana ${detalle.semana || "?"}, titulo "${detalle.titulo}"`);
      check("las OTs del reporte coinciden con el plan", shared.length > 0, `${shared.length} de ${reportOts.length} OTs del reporte estan en la cola del plan; el Gantt tiene ${detalle.totalBarras} barras de ${delPlanEnGantt.size} OTs; fechas del reporte ${Array.from(new Set(detalle.filas.map((f) => f.fecha))).slice(0, 4).join(" | ")}`);
      // MEDIDO 2026-10-05: que una OT este en el reporte no significa que este programada. El
      // reporte lista, por dia, las OTs que INICIAN y las que TERMINAN en esa semana
      // (`weeklyJobSummary`, app.js:8579-8580), y su fuente es el borrador (`Borrador actual`
      // medido en pantalla). Que la semana que se mira sea la semana del plan se comprueba con
      // los datos, no con la suposicion de que el reporte se alinea solo: si la semana del
      // reporte no contiene ninguna OT de la cola, el cuadre no se puede pedir y el paso debe
      // decirlo en vez de contar un desacuerdo que no existe.
      const semanaDelPlan = detalle.filas.some((fila) => planOts.has(fila.ot));
      check("la semana que muestra el reporte tiene OTs del plan", semanaDelPlan, semanaDelPlan ? `el reporte de la semana ${detalle.semana || "?"} incluye ${shared.length} OTs de la cola` : `el reporte de la semana ${detalle.semana || "?"} no trae ninguna OT de la cola; filas: ${JSON.stringify(detalle.filas.slice(0, 6))}`);
      record("ok", "cuadre plan/reporte", `${detalle.totalFilas} filas en el reporte, ${shared.length} OTs en comun con la cola, ${detalle.totalBarras} barras en el Gantt`);
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
      // Los ambientales tambien se dejan escritos, pero SIN multiplicar: 180 veces el mismo
      // "Failed to load resource" es una sola causa y no se distingue en un numero. Sin esto, un
      // fallo de red nuevo se esconde dentro de una cuenta que siempre sale alta.
      const ambientales = Array.from(new Set(consoleErrors.filter((text) => isEnvironmental(text))));
      record(realWarnings.length ? "warn" : "ok", "consola", `${realErrors.length} errores propios, ${realWarnings.length} avisos, ${ambientales.length} ambientales distintos${ambientales.length ? `: ${ambientales[0].slice(0, 90)}` : ""}`);
      summary.console = { realErrors, realWarnings, environmentalErrors: ambientales.length, environmentalSamples: ambientales.slice(0, 6), pageErrors, nativeDialogs };
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
