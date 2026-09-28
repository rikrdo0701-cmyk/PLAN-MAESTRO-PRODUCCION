/**
 * @NApiVersion 2.1
 * @NScriptType UserEvent
 *
 * User Event de `manufacturingoperationtask` (una operacion de la OT).
 *
 * Es el unico disparador de `operaciones` que mantiene al dia lo que la web lee: la
 * cantidad realizada (mot.completedquantity) y el estado (mot.status) SOLO cambian cuando
 * se guarda la operacion, no cuando se guarda la OT. Sin este User Event, el estatus de las
 * operaciones en Supabase se congelaria en la ultima vez que se toco la OT, y es
 * justamente el dato con el que la web decide que ya se termino una operacion.
 *
 * ---------------------------------------------------------------------------------
 * Script parameters: SCRIPT_ID_TAREA, DEPLOY_ID_TAREA, ACTIVO (igual que el User Event de
 * workorder; ver netsuite-user-event-workorder.js).
 *
 * Delega en el RESTlet la decision de si la fila cambio: el RESTlet lee lo que ya esta en
 * Supabase y omite la escritura si es identico, asi que encolar de mas no produce escrituras
 * de mas, solo llamadas de lectura (RULE-SUP-004).
 */
define(['N/record', 'N/task', 'N/runtime', 'N/log'], (record, task, runtime, log) => {
  const CAMPO_OT = 'workorder';

  function afterSubmit(context) {
    if (!activo()) return;
    if (context.type === context.UserEventType.DELETE) {
      // Una operacion borrada no se puede leer despues. Se encola la OT para que el RESTlet
      // relea su ruta completa y la fila que ya no existe se marque (ver docs).
      const viejo = context.oldRecord;
      if (!viejo) return;
      encolar(viejo);
      return;
    }
    const nuevo = context.newRecord;
    if (!nuevo) return;
    encolar(nuevo);
  }

  function encolar(registro) {
    if (!registro) return;
    let otId = '';
    try {
      const valor = registro.getValue({ fieldId: CAMPO_OT });
      const referencia = valor && valor.value ? valor.value : valor;
      otId = referencia == null ? '' : String(referencia);
    } catch (error) {
      registrar('SUPA_SYNC', 'No se pudo leer la OT de la operacion: ' + String((error && error.message) || error));
      return;
    }
    if (!otId) {
      registrar('SUPA_SYNC', 'La operacion no tiene OT: no se encola nada.');
      return;
    }
    const scriptId = parametro('SCRIPT_ID_TAREA');
    const deployId = parametro('DEPLOY_ID_TAREA');
    if (!scriptId || !deployId) {
      registrar('SUPA_SYNC', 'Faltan SCRIPT_ID_TAREA / DEPLOY_ID_TAREA en el deployment de este User Event.');
      return;
    }
    try {
      task.enqueue({
        taskType: task.Type.SUITELET,
        scriptId: scriptId,
        deploymentId: deployId,
        params: { accion: 'operaciones', ids: { workorderIds: [otId] } }
      });
    } catch (error) {
      registrar('SUPA_SYNC', 'No se pudo encolar operaciones: ' + String((error && error.message) || error));
    }
  }

  function activo() {
    const v = parametro('ACTIVO');
    return String(v || '').toUpperCase().indexOf('S') === 0;
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

  return { afterSubmit: afterSubmit };
});
