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
 * QUE APLICA. Los catalogos Y el plan: operations, work_orders y materials.
 * El DDL docs/schema-supabase-plan.sql esta APLICADO y las 11 columnas nuevas
 * existen. El lector ya mapea las tres tablas (mapOperations, mapWorkOrders,
 * mapMaterials en supabase-reader.js) y el boot las pasa en el informe.
 *
 * SI SUPABASE NO TRAE DATOS. Si el informe trae undefined (la tabla no se pudo
 * leer), NO se toca lo que el puente ya trajo. Si trae un array vacio, se aplica:
 * significa "no hay", que es informacion real.
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
    // El plan: operations, workOrders y materials. El boot ya los trae mapeados
    // por el lector (mapOperations, mapWorkOrders, mapMaterials). Se aplican
    // encima del estado del puente: Supabase es la fuente ahora.
    //
    // undefined se descarta a proposito: significa 'el lector no trajo esto', y
    // sobrescribir con undefined borraria lo que el puente si habia traido. Un
    // array VACIO si se aplica: significa 'no hay', que es informacion real.
    let planAplicado = 0;
    for (const clave of ["operations", "workOrders", "materials"]) {
      const valor = informe[clave];
      if (valor === undefined) continue;
      root.state[clave] = valor;
      planAplicado += 1;
    }
    try {
      if (typeof render === "function") render({ save: false });
    } catch (error) {
      // El dato ya esta en el estado aunque no se pinte. Un fallo de pintado no
      // puede hacer que se repita la lectura.
      console.warn("Catalogos aplicados pero no se pudo pintar:", String((error && error.message) || error));
    }
    aplicado = true;
    return { aplicado: true, claves: r.claves, planAplicado, ms: informe.ms, viejo: informe.viejo, vacias: informe.vacias };
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
