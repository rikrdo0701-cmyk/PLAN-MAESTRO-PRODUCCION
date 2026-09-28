/**
 * @NApiVersion 2.1
 * @NScriptType scheduledscript
 *
 * Barrido de la ingesta NetSuite -> Supabase. Llama al RESTlet directamente por HTTP,
 * sin Suitelet. Cubre las 7 acciones en orden.
 *
 * NO escribe en NetSuite en ningun caso, y no borra de Supabase: solo upsert.
 */
define(['N/https', 'N/runtime', 'N/log'], (https, runtime, log) => {
  const TODAS = ['workorders', 'operaciones', 'materiales', 'items', 'centros', 'inventario', 'ordenes_venta'];
  const RESTLET_URL = 'https://11103874.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=2246&deploy=1';

  function execute() {
    // Solo horario laboral: lunes a viernes, 7am-5pm
    const ahora = new Date();
    const dia = ahora.getDay();
    const hora = ahora.getHours();
    if (dia === 0 || dia === 6 || hora < 7 || hora >= 17) {
      return;
    }

    const acciones = listaAcciones();
    const dryRun = esSi(parametro('DRY_RUN'));

    let completadas = 0;
    acciones.forEach(function (accion) {
      const body = JSON.stringify({ accion: accion, ids: {}, dryRun: dryRun });
      try {
        const res = https.request({
          method: 'POST',
          url: RESTLET_URL,
          body: body
        });
        completadas += 1;
        log.audit('SUPA_SYNC', accion + ': ' + res.code);
      } catch (error) {
        log.error('SUPA_SYNC', 'No se pudo llamar al RESTlet para ' + accion + ': ' + String((error && error.message) || error));
      }
    });
    log.audit('SUPA_SYNC', 'Barrido: ' + completadas + '/' + acciones.length + ' accion(es) completadas, dryRun=' + dryRun + '.');
  }

  function listaAcciones() {
    const cruda = parametro('ACCIONES');
    if (!cruda) return TODAS.slice();
    return cruda.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  }

  function parametro(nombre) {
    try {
      const v = runtime.getParameter({ name: nombre });
      return v == null ? '' : String(v).trim();
    } catch (e) {
      return '';
    }
  }

  function esSi(v) {
    return v === 'S' || v === 's' || v === 'Y' || v === 'y' || v === 'true';
  }

  function registrar(nombre, mensaje) {
    try { log.audit(nombre, mensaje); } catch (e) { /* sin log */ }
  }

  return { execute: execute };
});
