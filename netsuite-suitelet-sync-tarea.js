/**
 * @NApiVersion 2.1
 * @NScriptType suitelet
 *
 * Despachador de la ingesta NetSuite -> Supabase. Lo encolan los User Events
 * (netsuite-user-event-*.js) y lo puede ejecutar uno a mano desde
 * Customization > Maps > SuiteCloud Documents > Suitelets > Execute as Suitelet.
 *
 * POR QUE UN SUITELET Y NO LA LLAMADA DIRECTA: el User Event (afterSubmit) se ejecuta
 * DENTRO de la transaccion del usuario. Si el push a Supabase se hiciera ahi, cada
 * guardado de OT pagaria un viaje de ida y vuelta y, si Supabase se cayera, el guardado
 * de NetSuite se veria afectado. Encolando una tarea, NetSuite guarda igual y la ingesta
 * corre aparte. Ver RULE-SUP-003.
 *
 * ---------------------------------------------------------------------------------
 * Script parameters (en el deployment de ESTE Suitelet)
 *   RESTLET_SCRIPT_ID   customscript_supasync_restlet   (script id del RESTlet)
 *   RESTLET_DEPLOY_ID    customdeploy_supasync_restlet  (deployment id, el mismo que se
 *                       pone como Default en el Suitelet para poder probarlo a mano)
 *
 * Body de la tarea: lo que produce el User Event, sin cambios.
 *   { accion, ids: {...}, folios: [...], lote, modo, dryRun }
 *
 * NO reintenta solo. Si el RESTlet falla, devuelve el error y la tabla; el barrido
 * programado (netsuite-scheduled-sincronizacion.js) es quien reconcilia. Reintentar a
 * ciegas en una tarea sin espera solo gasta llamadas de gobierno (10,000/dia por cliente)
 * y llega al mismo sitio.
 */
define(['N/https', 'N/runtime', 'N/log'], (https, runtime, log) => {
  const RUTA = '/app/site/hosting/scriptlet.nl';

  function onRequest(context) {
    const body = (context && context.request && context.request.body) || {};
    return ejecutar(normalizar(body), 'SUITELET');
  }

  // onRequestGet permite probarlo desde el mapa de un Suitelet con parametros sueltos.
  function onRequestGet(context) {
    const q = (context && context.request && context.request.queryParameters) || {};
    return ejecutar(normalizar(q), 'SUITELET_GET');
  }

  function normalizar(entrada) {
    const o = entrada || {};
    let ids = o.ids;
    if (typeof ids === 'string') {
      try { ids = JSON.parse(ids); } catch (e) { ids = { folios: ids }; }
    }
    const salida = {
      accion: String(o.accion || o.action || '').trim().toLowerCase(),
      ids: ids || {},
      folios: o.folios || [],
      lote: o.lote,
      modo: o.modo,
      ubicacion: o.ubicacion,
      soloAbiertos: o.soloAbiertos,
      dryRun: o.dryRun === true
    };
    Object.keys(salida).forEach((k) => { if (salida[k] === undefined) delete salida[k]; });
    return salida;
  }

  function ejecutar(payload, origen) {
    if (!payload.accion) {
      return { ok: false, error: 'falta accion', origen: origen };
    }
    const scriptId = parametro('RESTLET_SCRIPT_ID');
    const deployId = parametro('RESTLET_DEPLOY_ID');
    if (!scriptId || !deployId) {
      return {
        ok: false,
        error: 'Faltan los script parameters RESTLET_SCRIPT_ID y RESTLET_DEPLOY_ID en el deployment de este Suitelet.',
        origen: origen
      };
    }

    const url = runtime.getCurrentScript() + RUTA + '?script=' + encodeURIComponent(scriptId) + '&deploy=' + encodeURIComponent(deployId);
    let respuesta = null;
    try {
      respuesta = https.request({
        url: url,
        method: 'POST',
        headers: { 'Content-Type': 'application/json;charset=UTF-8' },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      const texto = String((error && error.message) || error);
      registrar('SUPA_SYNC_ENCOLADO', origen + ' no pudo llamar al RESTlet: ' + texto);
      return { ok: false, accion: payload.accion, error: 'No se pudo llamar al RESTlet: ' + texto, origen: origen };
    }

    const status = Number(respuesta.code || 0);
    const cuerpo = String(respuesta.body || '');
    let json = null;
    try { json = JSON.parse(cuerpo || '{}'); } catch (e) { json = null; }
    if (status < 200 || status >= 300) {
      registrar('SUPA_SYNC_ENCOLADO', origen + ' ' + payload.accion + ': HTTP ' + status + ' ' + cuerpo.slice(0, 300));
      return { ok: false, accion: payload.accion, status: status, error: cuerpo.slice(0, 500), origen: origen };
    }
    if (!json) {
      return { ok: false, accion: payload.accion, status: status, error: 'El RESTlet respondio sin JSON: ' + cuerpo.slice(0, 300), origen: origen };
    }
    if (json.ok === false) {
      registrar('SUPA_SYNC_ENCOLADO', origen + ' ' + payload.accion + ' fallo: ' + String(json.error || '').slice(0, 300));
    }
    json.origen = origen;
    return json;
  }

  function parametro(nombre) {
    try {
      const v = runtime.getParameter({ name: nombre });
      return v == null ? '' : String(v).trim();
    } catch (e) {
      return '';
    }
  }

  function registrar(marca, texto) {
    try { log.error(marca, texto); } catch (e) { /* sin log */ }
  }

  return { onRequest: onRequest, onRequestGet: onRequestGet };
});
