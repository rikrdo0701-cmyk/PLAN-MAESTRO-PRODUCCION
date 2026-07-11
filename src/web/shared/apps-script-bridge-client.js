(function initAppsScriptBridge(root) {
  "use strict";

  const DEFAULT_WEB_APP_URL = "__PP_APPS_SCRIPT_WEB_APP_URL__";
  const CLIENT_SOURCE = "pp-github-client";
  const BRIDGE_SOURCE = "pp-appscript-bridge";
  const READY_TIMEOUT_MS = 30000;
  const CALL_TIMEOUT_MS = 120000;

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
    url.searchParams.set("v", "2.41.1");
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
    if (nativeRuntimeAvailable()) {
      return new Promise((resolve, reject) => {
        const runner = google.script.run
          .withSuccessHandler(resolve)
          .withFailureHandler((error) => reject(new Error(error && error.message ? error.message : String(error))));
        runner[method](...(Array.isArray(args) ? args : []));
      });
    }

    await ensureBridge();
    const id = `rpc-${Date.now()}-${++sequence}`;
    return new Promise((resolve, reject) => {
      if (!bridgeWindow) {
        reject(new Error("El puente de Apps Script no esta disponible"));
        return;
      }
      const timer = root.setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Tiempo agotado al ejecutar ${method}`));
      }, CALL_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      bridgeWindow.postMessage({
        source: CLIENT_SOURCE,
        type: "call",
        channel,
        id,
        method,
        args: Array.isArray(args) ? args : [],
      }, "*");
    });
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
      return nativeRuntimeAvailable() || isConfigured();
    };
    root.callAppsScript = function(method, ...args) {
      return call(method, args);
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installGlobalAdapter, { once: true });
  } else {
    installGlobalAdapter();
  }
})(window);
