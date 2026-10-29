(function initAppsScriptBridge(root) {
  "use strict";

  /**
   * EL PUENTE DE APPS SCRIPT ESTA DESHABILITADO. NetSuite ya carga a Supabase y Supabase
   * es la fuente; la app habla con Supabase por PPSupabaseReader, PPSupabaseWriter y
   * PPSupabaseBridgeReplacement (RULE-SUP-030).
   *
   * POR QUE ESTE ARCHIVO SIGUE EXISTIENDO, siendo que ya no hace nada. Porque varios lugares
   * leen `window.PPAppsScriptBridge.isConfigured` / `.nativeRuntimeAvailable` /
   * `.getBackendUrl` para decidir COMO behaves, y borrarlos de golpe haria fallar la pagina
   * con un TypeError en vez de con un motivo. Lo que hay aqui son solo las PUERTAS, y todas
   * rechazan con un motivo que dice que mas.
   *
   * LO QUE SE BORRO, y por que no se puede volver a colar. Este archivo montaba un iframe
   * oculto contra el web app de Apps Script y hablaba por postMessage. MEDIDO 2026-09-30 en
   * la pagina real: con `call` ya rechazando todo, la consola seguia mostrando
   *   script.google.com/macros/s/AKfy.../exec?app=bridge&v=2.51.0
   * porque `ensureReady` seguia siendo `ensureBridge` y `loadAppStateInBackground` lo llamaba
   * en cada arranque. O sea que el sitio ya no tenia un camino de DATOS hacia Apps Script,
   * pero si una dependencia VIVA: se descargaba el script de Google entero en cada carga, y
   * mientras ese codigo siga en el bundle, cualquier llamada futura a `ensureBridge` lo
   * reactiva sin que nadie se entere. Por eso no se deja: la maqueria del iframe, los
   * timeouts y el listener de `message` desaparecieron de verdad, no quedaron ahi.
   *
   * LO QUE SE GANO CON QUITARLO, que es el motivo de fondo y la cifra que hay que recordar.
   * MEDIDO 2026-09-29 con el techo de tiempo quitado, en la misma corrida: getAppState tardaba
   * 11,3 s y getAppStateIfChanged 197 s, o sea 3 minutos 17 segundos. Y no era una vez: eran
   * 74 llamadas al puente en una sola carga de pagina, cada una con su arranque en frio. Los
   * presupuestos por metodo (420 s para los lentos, 120 s generico) existian solo para no
   * cortar esas respuestas antes de que llegaran: con getAppStateIfChanged en 197 s, 120 s no
   * era un margen corto, era MENOS que el peor caso, y cortarlo producia una pagina vacia
   * (0 operaciones, 0 OTs, 0 catalogo) con un unico rastro en un console.warn. Lo que lo quita
   * de raiz no es un timeout mas alto: es que las mismas once tablas tardan 239 ms en Supabase.
   */

  const DEFAULT_WEB_APP_URL = "__PP_APPS_SCRIPT_WEB_APP_URL__";

  function nativeRuntimeAvailable() {
    return typeof google !== "undefined" && Boolean(google.script && google.script.run);
  }

  function configuredUrl() {
    const override = String(root.PP_APPS_SCRIPT_WEB_APP_URL || "").trim();
    return override || DEFAULT_WEB_APP_URL;
  }

  /**
   * Que se lea `false` es lo HONESTO: no hay puente, y decir `true` porque la URL este
   * embebida en el bundle fue exactamente lo que hacia que el sitio creyera que tenia
   * backend (MEDIDO 2026-09-29: `isConfigured` decia "esta configurado" en el sitio
   * estatico y por eso el guardado del plan se iba por el puente).
   */
  function isConfigured() {
    return false;
  }

  const MOTIVO = "El puente de Apps Script esta deshabilitado: NetSuite ya carga a Supabase y la app lee y escribe en Supabase (RULE-SUP-030)";

  async function call(method) {
    return Promise.reject(new Error(`${MOTIVO}. Metodo: ${method}`));
  }

  async function ensureReady() {
    return Promise.reject(new Error(`${MOTIVO}. No se monta ningun iframe`));
  }

  root.PPAppsScriptBridge = {
    call,
    ensureReady,
    isConfigured,
    nativeRuntimeAvailable,
    getBackendUrl: configuredUrl,
  };

  function installGlobalAdapter() {
    root.isAppsScriptRuntime = function() {
      return false;
    };
    root.callAppsScript = function(method, ...args) {
      return Promise.reject(new Error(`${MOTIVO}. Metodo: ${method}`));
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installGlobalAdapter, { once: true });
  } else {
    installGlobalAdapter();
  }
})(window);
