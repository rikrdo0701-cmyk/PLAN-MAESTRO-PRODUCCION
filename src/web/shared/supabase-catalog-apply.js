/**
 * El estado de la pagina sale de Supabase. No del puente de Apps Script.
 *
 * QUE CAMBIO Y POR QUE. Antes este modulo envolvia a `applyImported` y esperaba a que
 * el puente cargara, para aplicar los catalogos encima. Eso seguia siendo un
 * respaldo: la pagina primero se llenaba con las Hojas y luego se le ponian encima
 * los catalogos, y si el puente tardaba 25 s (el rescate) o no venia, la persona
 * veía el estado de las Hojas. El 2026-09-29 el usuario lo pidio textual: 'no quiero
 * que la web use appscript de fallback'.
 *
 * QUE HACE AHORA. Arranca por su cuenta en cuanto hay sesion, lee de Supabase y mete
 * TODO lo leido por la puerta que abre app.js (`aplicarEstadoDesdeSupabase`), que a
 * su vez lo pasa por `applyImported`. Si la lectura falla, avisa en pantalla y NO
 * inventa nada: una pagina vacia que lo dice es mejor que una pagina con la matriz
 * de ayer que parece la de hoy.
 *
 * POR QUE UNA PUERTA EN app.js Y NO ESCRIBIR `state` DESDE AQUI. MEDIDO 2026-09-29:
 * este modulo hacia `root.state = {...}` y la pagina NO cambiaba. `state` es un `let`
 * de primer nivel (app.js:504), o sea que vive en el entorno LEXICO global y no es
 * una propiedad de window: `window.state` era `undefined` y lo que se escribia ahi
 * era un objeto que nadie leia. Los catalogos se perdian enteros. Por eso lo unico
 * que se hace desde fuera es llamar a `aplicarEstadoDesdeSupabase`, que es una
 * funcion declarada en el primer nivel de app.js y si es una propiedad de window, y
 * que es la que sabe de `state`.
 *
 * QUE SE APLICA, Y POR QUE PASA TODO POR applyImported. Los catalogos (los 11 de la
 * pestana Catalogos y la matriz) se aplican tal cual. El PLAN y la COLA tambien, pero
 * por `applyImported`, que es la funcion que ya sabe reconciliar el estado viejo con
 * el nuevo (tombstones de OTs quitadas, fichas de OTs marcadas, precios) y que llama
 * a normalizeState(). Duplicar esa reconciliacion aqui seria el error mas caro
 * posible en un arranque: no fallaria de forma visible, fallaria al siguiente
 * guardado. Se manda TODO en un solo objeto y en un solo llamado, para que el orden
 * quede escrito en un sitio.
 *
 * LO QUE NO SE PASA, Y POR QUE. `excludedCapabilities` no viene del lector (no hay
 * tabla) y se deja como esta; lo mismo con el borrador local: la puerta lo aplica con
 * preserveLocalPlanning en false, o sea que lo que esta en Supabase gana. Si no, una
 * pestaña con el localStorage de ayer ensenaria un plan que la base no tiene.
 *
 * POR QUE `applyImported` SIGUE ENVUELTO, Y POR QUE NO ES UN RESPALDO. En el runtime
 * de Apps Script (HtmlService) `loadAppStateInBackground` sigue trayendo el estado
 * del servidor, y sin esta envoltura esa carga pisaria lo que Supabase acaba de
 * aplicar. Envolverlo deja el orden explicito: primero el estado que sea, despues
 * Supabase encima. Es el orden que hace que Supabase sea la ultima palabra, que es
 * lo que se pidio.
 */
(function (root) {
  "use strict";

  // Las llaves del plan y de la cola. Van a UN solo applyImported, asi que no hace
  // falta separarlas: la lista esta para que se vea que son las cuatro de persona y
  // las tres del ERP, y para que anadir una quinta sea tocar un sitio.
  const CLAVES_PERSONA = ["selectedOts", "lockedOts", "operationPlanStatuses"];

  /**
   * Las rebanadas que el lector puede devolver como objeto indexado y que la pagina
   * usa como array. Se normaliza aqui y no en el lector, que es de donde las leen
   * otras sondas. Si alguna falta, se pierde: su `undefined` no se pasa y la pagina
   * conserva lo que tenia, que es lo que significa `undefined` en el contrato.
   */
  const COMO_ARRAY = ["operators", "otTypes", "subcontracts", "calendarExceptions", "toolCatalog", "operationCatalog", "machines"];

  let aplicado = false;
  let enMarcha = null;

  /**
   * Copia las rebanadas del informe al objeto de entrada, sin los `undefined`.
   *
   * undefined significa 'el lector no trajo esta rebanada' (la tabla fallo, o no
   * existe). Pasarlo a la puerta lo BORRARIA en vez de conservarlo: la entrada se
   * pasa tal cual a `applyImported`, que asigna lo que viene. MEDIDO 2026-09-29 al
   * reescribir este modulo: el `Object.assign({}, catalogs)` de la version anterior
   * a esta si conservaba la clave con valor undefined, y la prueba que lo fijaba
   * (undefined no puede borrar la matriz) se rompio. Un array VACIO si se pasa:
   * eso significa 'no hay', y es un dato, no una ausencia.
   */
  function normaliza(catalogs) {
    const out = {};
    for (const [clave, valor] of Object.entries(catalogs || {})) {
      if (valor === undefined) continue;
      out[clave] = valor;
    }
    for (const clave of COMO_ARRAY) {
      const v = out[clave];
      if (v && typeof v === "object" && !Array.isArray(v)) out[clave] = Object.values(v);
    }
    return out;
  }

  /**
   * LAS CLAVES NATURALES DE LO QUE SE LEYO, que es lo unico que permite borrar
   * despues. Se piden al ESCRITOR con el mismo objeto que se le va a aplicar, para
   * que la clave que se compara sea la MISMA funcion que genera la del INSERT: dos
   * copias de esa regla (una aqui y otra alla) se separan en el primer cambio de
   * nombre de columna y el borrado empieza a fallar en silencio.
   */
  function clavesLeidas(estado) {
    const writer = root.PPSupabaseWriter;
    if (!writer || typeof writer.armarCatalogos !== "function") return null;
    let armado;
    try { armado = writer.armarCatalogos(estado); } catch { return null; }
    const out = {};
    Object.keys(armado || {}).forEach(function (tabla) {
      out[tabla] = Object.keys(armado[tabla].claves || {});
    });
    return out;
  }

  /**
   * La fila unica de app_state, partida en los campos del estado. Se pasan de uno en
   * uno y no con un merge ciego: un campo vacio en la base significa 'no guardado
   * todavia', y pisar con eso la ventana del plan de la persona seria borrarle su
   * plan. Los que la puerta de app.js pone despues (savedAt, syncedAt,
   * reportFilters, otTypes) se calculan aqui igual, con la misma regla de 'vacio no
   * se aplica'.
   */
  function camposDeAppState(appState) {
    if (!appState || typeof appState !== "object") return null;
    const out = { revision: Number(appState.revision || 0) };
    if (appState.planStart) out.planStart = appState.planStart;
    if (appState.horizonDays != null && Number.isFinite(Number(appState.horizonDays))) {
      out.horizonDays = Number(appState.horizonDays);
    }
    if (appState.reportWeekStart) out.reportWeekStart = appState.reportWeekStart;
    if (appState.savedAt) out.savedAt = appState.savedAt;
    if (appState.syncedAt) out.syncedAt = appState.syncedAt;
    if (appState.lastSchedule) out.lastSchedule = appState.lastSchedule;
    if (appState.settings && Object.keys(appState.settings).length) out.settings = appState.settings;
    if (appState.plant && Object.keys(appState.plant).length) out.plant = appState.plant;
    if (appState.reportFilters && Object.keys(appState.reportFilters).length) out.reportFilters = appState.reportFilters;
    if (appState.operationCatalogWarning) out.operationCatalogWarning = appState.operationCatalogWarning;
    return out;
  }

  async function trabajar() {
    const boot = root.PPCatalogBoot;
    if (!boot || typeof boot.correr !== "function") return { aplicado: false, motivo: "modulo de catalogos ausente" };
    const informe = await boot.correr();
    boot.aviso(informe);
    if (!informe.activo) return { aplicado: false, motivo: informe.motivo };
    if (informe.fallo) return { aplicado: false, motivo: informe.fallo };

    const entrada = normaliza(informe.catalogs);
    // El plan y las tablas de la persona, al lado de los catalogos y en el MISMO
    // objeto: una sola pasada por applyImported, que es la que reconcilia.
    entrada.operations = informe.operations;
    entrada.workOrders = informe.workOrders;
    entrada.materials = informe.materials;
    for (const clave of CLAVES_PERSONA) {
      // SIN RESPALDO AL PUENTE. Si el lector no trajo la tabla, la clave NO se pone:
      // la pagina se muestra sin cola, sin bloqueos o sin historial, y el aviso del
      // boot lo dice, en vez de fingir que el estado vacio es el bueno.
      if (informe[clave] !== undefined) entrada[clave] = informe[clave];
    }
    const appState = camposDeAppState(informe.appState);
    if (appState) Object.assign(entrada, appState);

    // Las claves de lo leido, para que un "quitar del catalogo" sepa QUE fila hay
    // que borrar. Se calculan de lo que se acaba de leer, no del estado guardado en
    // el navegador, y se dejan en PPCatalogApply.claves para que quien guarda las
    // use (app.js, guardarCatalogosEnSupabase).
    const leidas = clavesLeidas(entrada);
    if (leidas) root.PPCatalogApply.claves = leidas;

    const puerta = root.aplicarEstadoDesdeSupabase;
    if (typeof puerta !== "function") {
      // Sin la puerta no se escribe `state` desde aqui (ver la cabecera): seria
      // escribir en un objeto que nadie lee. Se dice y no se finge que se aplico.
      return { aplicado: false, motivo: "app.js no expone aplicarEstadoDesdeSupabase" };
    }
    const r = await puerta(entrada);
    aplicado = true;
    return {
      aplicado: true,
      claves: (r && r.claves) || [],
      ms: informe.ms,
      viejo: informe.viejo,
      vacias: informe.vacias,
    };
  }

  /** No se solapan dos lecturas: si ya hay una en marcha, se espera esa. */
  function unaVez() {
    if (!enMarcha) {
      enMarcha = trabajar().finally(() => { enMarcha = null; });
    }
    return enMarcha;
  }

  function envolver() {
    const original = root.applyImported;
    if (typeof original !== "function" || original.__ppEnvoltura) return false;
    const envoltura = async function (imported, opciones) {
      const salida = await original.call(this, imported, opciones);
      if (!aplicado) unaVez();
      return salida;
    };
    envoltura.__ppEnvoltura = true;
    root.applyImported = envoltura;
    return true;
  }

  function instalar() {
    envolver();
    // La lectura arranca aqui, sin esperar a nadie. Si todavia no hay sesion, el
    // aviso de "entra con tu correo" es lo que se ve, y en cuanto entra (pp:sesion)
    // se reintenta una vez. Un solo reintento, porque entrar dos veces no es un caso.
    unaVez().then((r) => {
      if (r && r.aplicado) return;
      const esperar = (e) => {
        const activo = e && e.detail ? e.detail.activo : true;
        if (!activo) return;
        unaVez();
      };
      root.addEventListener("pp:sesion", esperar, { once: true });
    });
  }

  if (root.document) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", instalar, { once: true });
    else instalar();
  }

  root.PPCatalogApply = {
    aplicarUnaVez: unaVez,
    estado: () => ({ aplicado, hayClaves: Boolean(root.PPCatalogApply.claves) }),
    // { tabla: [claves naturales] } de lo que se leyo al arrancar. Lo usa
    // guardarCatalogosEnSupabase (app.js) para borrar SOLO lo que la persona quito.
    claves: null,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
