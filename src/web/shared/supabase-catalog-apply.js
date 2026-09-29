/**
 * Aplica los catalogos de Supabase encima del estado, DESPUES de que el puente cargue.
 *
 * POR QUE NO SE TOCA app.js, Y ES LO MAS IMPORTANTE DE ESTE ARCHIVO. La idea
 * inicial era abrir una costura en loadAppStateInBackground. MEDIDO 2026-09-29:
 * el build guarda una COPIA LITERAL de esa funcion entera (startupMarker en
 * scripts/build-appscript.mjs) para parchearla, y añadir una sola linea ahi rompe
 * el build entero con "No se encontro la carga inicial para recuperar el borrador".
 * Se probo y fallo. Un build que se rompe con un comentario es una trampa para
 * quien venga despues, asi que este modulo no depende de ese texto.
 *
 * QUE HACE EN SU LUGAR. app.js declara applyImported como funcion de primer nivel
 * de un script clasico, o sea que es una global de window. Este modulo la
 * envuelve: la deja correr, espera a que termine, y ENTONCES lee los catalogos de
 * Supabase y los aplica encima. El orden que importa sale solo de ahi: primero el
 * puente, despues Supabase. Al reves, la carga del puente pisaria los catalogos y
 * se acabaria leyendo de las Hojas sin querer.
 *
 * SOLO UNA VEZ. La primera importacion dispara la lectura; las siguientes no. Sin
 * ese cierre, cada importacion de la sesion (cada sincronizacion de NetSuite, cada
 * guardado) seria una lectura de once tablas, y eso no es un refresco de
 * catalogos, es una funcion de red escondida.
 *
 * SI EL PUENTE NO RESPONDE. Ni applyImported se llama ni los catalogos se aplican.
 * Con reintentos y sin respaldo (que es lo que pidio el usuario el 2026-09-29),
 * eso deja la pagina sin operadores ni matriz. Por eso hay un temporizador de
 * rescate: si en este tiempo no ha pasado nada, se aplica igual lo que haya
 * llegado. Peor con matriz de ayer que sin matriz y sin aviso.
 *
 * QUE APLICA Y QUE NO. Solo los catalogos. NO toca operations, work_orders ni
 * materials: el plan sigue viniendo del puente porque el esquema de Supabase no
 * tiene columnas para representarlo (MAPPING_GAPS en supabase-reader.js: a
 * operations le faltan num, parte, contenido, prioridad, fechaReq y log) y porque
 * su escritura necesita politicas que todavia no existen.
 */
(function (root) {
  "use strict";

  const RESCATE_MS = 25000;
  const CATALOGOS = [
    "operators", "operatorCapacity", "operatorPerformance", "operatorProfiles",
    "configuredCapabilities", "hiddenCapabilities", "capabilityByKey", "cts",
    "customCapabilities", "capacityModes", "operationCatalog",
    "matrix", "otTypes", "otConfigurations", "articleConfigurations",
    "toolCatalog", "subcontracts", "calendarExceptions", "machines", "machineOverrides",
  ];

  let aplicado = false;
  let enMarcha = null;
  let temporizador = null;

  function normaliza(catalogs) {
    const out = Object.assign({}, catalogs || {});
    // El lector devuelve algunas rebanadas como objeto indexado y otras como
    // array. La app las usa como array, asi que se normaliza aqui y no en el
    // lector, que es de donde lo leen otras sondas.
    for (const clave of ["operators", "otTypes", "subcontracts", "calendarExceptions", "toolCatalog", "operationCatalog"]) {
      const v = out[clave];
      if (v && typeof v === "object" && !Array.isArray(v)) out[clave] = Object.values(v);
    }
    return out;
  }

  function aplicar(state, catalogs) {
    const cambios = {};
    let aplicados = 0;
    for (const clave of CATALOGOS) {
      const valor = catalogs[clave];
      // undefined se descarta a proposito: significa 'el lector no traia esto', y
      // sobrescribir con undefined borraria lo que el puente si habia traido. Un
      // array VACIO si se aplica: significa 'no hay', que es informacion real.
      if (valor === undefined) continue;
      cambios[clave] = valor;
      aplicados += 1;
    }
    return { estado: Object.assign({}, state, cambios), aplicados, claves: Object.keys(cambios) };
  }

  async function trabajar() {
    const boot = root.PPCatalogBoot;
    if (!boot || typeof boot.correr !== "function") return { aplicado: false, motivo: "modulo de catalogos ausente" };
    const informe = await boot.correr();
    boot.aviso(informe);
    if (!informe.activo) return { aplicado: false, motivo: informe.motivo };
    if (informe.fallo) return { aplicado: false, motivo: informe.fallo };

    const r = aplicar(root.state || {}, normaliza(informe.catalogs));
    root.state = r.estado;
    try {
      if (typeof render === "function") render({ save: false });
    } catch (error) {
      // El dato ya esta en el estado aunque no se pinte. Un fallo de pintado no
      // puede hacer que se repita la lectura.
      console.warn("Catalogos aplicados pero no se pudo pintar:", String((error && error.message) || error));
    }
    aplicado = true;
    return { aplicado: true, claves: r.claves, ms: informe.ms, viejo: informe.viejo, vacias: informe.vacias };
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

  if (root.document) {
    const instalar = () => {
      if (!envolver()) return;
      // Rescate: si el puente no llamo a applyImported (esta caido, o respondio
      // unchanged y no habia estado local), los catalogos se aplican igual.
      temporizador = root.setTimeout(() => { if (!aplicado) unaVez(); }, RESCATE_MS);
    };
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", instalar, { once: true });
    else instalar();
  }

  root.PPCatalogApply = { aplicarUnaVez: unaVez, estado: () => ({ aplicado, hayTemporizador: Boolean(temporizador) }) };
})(typeof globalThis !== "undefined" ? globalThis : this);
