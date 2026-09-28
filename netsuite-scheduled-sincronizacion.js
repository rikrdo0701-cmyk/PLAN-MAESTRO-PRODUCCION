/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 *
 * Barrido de la ingesta NetSuite -> Supabase. Cubre lo que los User Events NO pueden
 * cubrir y funciona como red de seguridad de los que si:
 *
 *  1. `inventario`: es un agregado (aggregateitemlocation) que se recalcula con cada
 *     movimiento. No existe ningun registro que "guardar", asi que no hay User Event posible.
 *     Este es su unico disparador (RULE-SUP-006).
 *  2. Reconciliacion: un User Event se puede perder (una tarea encolada que no corre, un
 *     despliegue mal puesto, una ingesta que fallo con Supabase caido). El barrido relee
 *     todo y vuelve a escribir solo lo que difiere, asi que la diferencia entre NetSuite y
 *     Supabase se cierra sola.
 *
 * ---------------------------------------------------------------------------------
 * Script parameters (en el deployment de ESTO)
 *   SCRIPT_ID_TAREA, DEPLOY_ID_TAREA   (el Suitelet, igual que en los User Events)
 *   ACCIONES    lista separada por comas. Vacio = TODAS. Ej: 'inventario' o
 *               'workorders,operaciones,materiales,items,centros,inventario,ordenes_venta'
 *   DRY_RUN     'S' encola todo con dryRun (no escribe): sirve para ver el tamano del
 *               barrido antes de dejarlo escribir solo.
 *
 * ESPERA_MS YA NO EXISTE, y el motivo es que no se podia garantizar. El espaciado se
 * intentaba pedir con task.submit({ taskType: task.Type.WAIT, functionName: 'continuar' })
 * nombrando una funcion de ESTE script; si esa llamada falla, las acciones restantes se
 * perdian en silencio, y eso es justo lo que un barrido no puede hacer: su trabajo ES la
 * red de seguridad de la ingesta por User Event. Ahora todas las acciones se encolan de
 * una vez y el conteo de lo que si se encolo queda en el log.
 *
 * Para no gastar las 10,000 llamadas externas/dia de golpe hay dos palancas que SI son
 * reales y medibles: correr el barrido con menos ACCIONES por corrida, o pedir
 * `modo:'upsert'`, que es una llamada por lote en vez de una por fila.
 *
 * NO escribe en NetSuite en ningun caso, y no borra de Supabase: solo upsert. Por eso es
 * seguro correrlo cada hora.
 */
define(['N/task', 'N/runtime', 'N/log'], (task, runtime, log) => {
  const TODAS = ['workorders', 'operaciones', 'materiales', 'items', 'centros', 'inventario', 'ordenes_venta'];

  function execute() {
    const scriptId = parametro('SCRIPT_ID_TAREA');
    const deployId = parametro('DEPLOY_ID_TAREA');
    if (!scriptId || !deployId) {
      registrar('SUPA_SYNC', 'Faltan SCRIPT_ID_TAREA / DEPLOY_ID_TAREA en el deployment de este script programado.');
      return;
    }
    if (parametro('ESPERA_MS')) {
      registrar('SUPA_SYNC', 'ESPERA_MS ya no se usa y se ignora. Para espaciar el barrido: fewer ACCIONES por corrida, o modo upsert.');
    }
    const acciones = listaAcciones();
    const dryRun = esSi(parametro('DRY_RUN'));

    let encoladas = 0;
    acciones.forEach(function (accion) {
      const params = { accion: accion, ids: {} };
      if (dryRun) params.dryRun = true;
      try {
        task.enqueue({ taskType: task.Type.SUITELET, scriptId: scriptId, deploymentId: deployId, params: params });
        encoladas += 1;
      } catch (error) {
        registrar('SUPA_SYNC', 'No se pudo encolar el barrido de ' + accion + ': ' + String((error && error.message) || error));
      }
    });
    registrar('SUPA_SYNC', 'Barrido: ' + encoladas + '/' + acciones.length + ' accion(es) encoladas, dryRun=' + dryRun + '.');
  }

  function listaAcciones() {
    const cruda = parametro('ACCIONES');
    if (!cruda) return TODAS.slice();
    return cruda.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  }

  function esSi(valor) {
    return String(valor || '').toUpperCase().indexOf('S') === 0;
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
    try { log.info(marca, texto); } catch (e) { /* sin log */ }
  }

  return { execute: execute };
});
