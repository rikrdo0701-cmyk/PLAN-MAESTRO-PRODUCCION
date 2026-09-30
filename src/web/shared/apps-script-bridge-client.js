(function initAppsScriptBridge(root) {
  "use strict";

  const DEFAULT_WEB_APP_URL = "__PP_APPS_SCRIPT_WEB_APP_URL__";
  const CLIENT_SOURCE = "pp-github-client";
  const BRIDGE_SOURCE = "pp-appscript-bridge";
  const READY_TIMEOUT_MS = 30000;
  const CALL_TIMEOUT_MS = 120000;
  const METHOD_TIMEOUT_MS = {
    // MEDIDO 2026-09-29 abriendo la pagina de verdad en un navegador: getAppState AGOTA
    // el tiempo generico de 120 s y la app se queda con el cache local, que en un
    // navegador recien abierto esta vacio. La pagina aparece SIN operaciones, SIN OTs
    // y SIN catalogo, y el unico aviso es un console.warn que nadie ve.
    //
    // Cuanto tarda de verdad, medido con el techo quitado: getAppState 11,3 s y
    // getAppStateIfChanged 197 s en la misma corrida, o sea 3 min 17 s. Con eso, 120 s
    // no es un margen corto: es menos que el peor caso que se ha visto. Se suben a
    // 420 s, el mismo techo que ya usan los metodos de NetSuite.
    //
    // Esto NO arregla la lentitud, solo deja de cortar la llamada antes de que
    // responda. La lentitud de fondo es de Apps Script: 74 llamadas al puente en una
    // sola carga, cada una con arranque en frio. Lo que la quita de raiz es leer de
    // Supabase, donde las mismas once tablas tardan 239 ms.
    getAppState: 420000,
    getAppStateIfChanged: 420000,
    publishDraftPlan: 360000,
    saveDraftSnapshot: 300000,
    restorePublishedPlanAsDraft: 300000,
    savePlanningStateOptimized: 180000,
    saveAppState: 180000,
    syncNetSuitePlanningData: 360000,
    // La sincronizacion de OTs pagina el RESTlet 1766 REQ_FIFO y mide 43-73 s en produccion,
    // mas hasta 17 s por peticion que sufra el limite de solicitudes (2+5+10 s de espera).
    // Con el generico de 120 s el PUENTE cortaba antes que el cliente
    // (NETSUITE_BACKLOG_SYNC_TIMEOUT_MS) y el mensaje que veia el usuario era el del puente en
    // lugar del util. Estos dos metodos comparten el mismo fetch: 420 s cubren dos intentos del
    // cliente (2 x 180 + 5 s) y el puente sigue siendo el reloj mas externo, de modo que el
    // corte con mensaje accionable sea siempre el del cliente.
    fetchNetSuiteWorkOrdersLite: 420000,
    syncNetSuiteWorkOrdersLite: 420000,
    // El cliente envuelve getPlanningWorkOrderDataBatch en NETSUITE_PLANNING_TIMEOUT_MS (15 s).
    // Sin entrada propia hereda CALL_TIMEOUT_MS (120 s): el cliente aborta a los 15 s y el
    // puente sigue esperando 120 s, tirando el trabajo del servidor. 20 s deja que el
    // corte con mensaje accionable sea siempre el del cliente.
    getPlanningWorkOrderDataBatch: 20000,
  };

  let iframe = null;
  let bridgeWindow = null;
  let channel = "";
  let readyPromise = null;
  let resolveReady = null;
  let rejectReady = null;
  let sequence = 0;
  const pending = new Map();

  function nativeRuntimeAvailable() {
    return typeof google !== "undefined" && Boolean(google.script && google.script.run);
  }

  function configuredUrl() {
    const override = String(root.PP_APPS_SCRIPT_WEB_APP_URL || "").trim();
    return override || DEFAULT_WEB_APP_URL;
  }

  function isConfigured() {
    return nativeRuntimeAvailable() || /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec(?:[?#].*)?$/.test(configuredUrl());
  }

  function bridgeUrl() {
    const url = new URL(configuredUrl());
    url.searchParams.set("app", "bridge");
    // Solo cache-busting del iframe: el servidor NO lee este parametro (PP_isBridgeRequest_
    // solo mira app=bridge). Debe coincidir con PP_APP_VERSION de src/server/01-code.js y
    // con la version de package.json, que son el mismo numero en tres lugares (RULE-WEB-003).
    url.searchParams.set("v", "2.51.0");
    return url.toString();
  }

  function randomChannel() {
    if (root.crypto && typeof root.crypto.randomUUID === "function") return root.crypto.randomUUID();
    return `pp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function ensureBridge() {
    if (nativeRuntimeAvailable()) return Promise.resolve();
    if (!isConfigured()) return Promise.reject(new Error("La URL del backend de Apps Script no esta configurada"));
    if (readyPromise) return readyPromise;

    channel = randomChannel();
    readyPromise = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    iframe = document.createElement("iframe");
    iframe.id = "ppAppsScriptBridge";
    iframe.title = "Conexion segura con Apps Script";
    iframe.hidden = true;
    iframe.setAttribute("aria-hidden", "true");
    iframe.src = bridgeUrl();
    iframe.addEventListener("error", () => {
      rejectReady?.(new Error("No se pudo cargar el puente de Apps Script"));
    }, { once: true });
    (document.body || document.documentElement).appendChild(iframe);

    const timer = root.setTimeout(() => {
      rejectReady?.(new Error("Apps Script no respondio al iniciar la conexion"));
    }, READY_TIMEOUT_MS);
    readyPromise.then(() => root.clearTimeout(timer), () => root.clearTimeout(timer));
    return readyPromise;
  }

  function postInit(targetWindow) {
    const destination = targetWindow || bridgeWindow;
    if (!destination) return;
    destination.postMessage({
      source: CLIENT_SOURCE,
      type: "init",
      channel,
    }, "*");
  }

  function isTrustedBridgeOrigin(origin) {
    try {
      const host = new URL(origin).hostname;
      return host === "script.google.com" || host.endsWith(".googleusercontent.com");
    } catch (_) {
      return false;
    }
  }

  root.addEventListener("message", (event) => {
    if (!iframe) return;
    const message = event.data || {};
    if (message.source !== BRIDGE_SOURCE) return;

    if (message.type === "hello") {
      if (!isTrustedBridgeOrigin(event.origin)) return;
      bridgeWindow = event.source;
      postInit(bridgeWindow);
      return;
    }

    if (message.type === "ready" && message.channel === channel) {
      resolveReady?.();
      resolveReady = null;
      rejectReady = null;
      return;
    }

    if (message.type !== "result" || message.channel !== channel || !message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    root.clearTimeout(request.timer);
    if (message.ok) request.resolve(message.result);
    else request.reject(new Error(message.error || "Error desconocido de Apps Script"));
  });

  async function call(method, args) {
    return Promise.reject(new Error(`El puente de Apps Script esta deshabilitado. Metodo: ${method}`));
  }

  root.PPAppsScriptBridge = {
    call,
    ensureReady: ensureBridge,
    isConfigured,
    nativeRuntimeAvailable,
    getBackendUrl: configuredUrl,
  };

  function installGlobalAdapter() {
    root.isAppsScriptRuntime = function() {
      return false;
    };
    root.callAppsScript = function(method, ...args) {
      return Promise.reject(new Error(`El puente de Apps Script esta deshabilitado. Metodo: ${method}`));
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installGlobalAdapter, { once: true });
  } else {
    installGlobalAdapter();
  }
})(window);
