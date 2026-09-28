/**
 * @NApiVersion 2.1
 * @NScriptType UserEvent
 *
 * User Event de `workorder`: el disparador principal de la ingesta a Supabase.
 *
 * ---------------------------------------------------------------------------------
 * Script parameters (en el deployment de ESTE User Event)
 *   SCRIPT_ID_TAREA   customscript_supasync_suitelet  (script id del Suitelet)
 *   DEPLOY_ID_TAREA   customdeploy_supasync_suitelet (deployment id del Suitelet)
 *   ACTIVO            'S' encola la ingesta. Con cualquier otra cosa NO encola nada, que es
 *                     la forma de apagar la ingesta sin redesplegar los User Events.
 *
 * ---------------------------------------------------------------------------------
 * QUE SE ENCOLA Y POR QUE UNA sola OT dispara TRES acciones:
 *
 *   workorders  -> la ficha de la OT (work_orders)
 *   operaciones -> su ruta (operations). Un User Event de workorder NO la dispara: las
 *                  operaciones son manufacturingoperationtask, otro registro.
 *   materiales  -> sus componentes de BOM (materials)
 *
 * Se encolan por separado y no en una sola llamada, porque la clave de escritura de cada
 * tabla es distinta y porque así un fallo de materiales no tumba la de la OT
 * (RULE-SUP-002: una tabla por llamada, sin efectos de cascada entre ellas).
 *
 * En el BORRADO no se manda la OT a Supabase: se manda el folio con `eliminado`, y el
 * RESTlet escribe estatus='BORRADA'. Borrar la fila perderia el rastro de que existio, y
 * RULE-OT-051 trata el cierre de OT como informacion de tres capas, no de una fila que
 * desaparece.
 */
define(['N/task', 'N/runtime', 'N/log'], (task, runtime, log) => {
  function afterSubmit(context) {
    if (!activo()) return;
    if (context.type === context.UserEventType.DELETE) {
      // El afterSubmit de un borrado llega con newRecord nulo: el folio solo esta en el viejo.
      const viejo = context.oldRecord;
      const folio = viejo ? String(viejo.getValue({ fieldId: 'tranid' }) || '').trim() : '';
      if (!folio) {
        registrar('SUPA_SYNC', 'Se borro una OT y no se pudo leer su folio: no se encola nada.');
        return;
      }
      encolar('workorders', { folios: [folio], eliminado: true });
      return;
    }
    const nuevo = context.newRecord;
    if (!nuevo || !nuevo.id) return;
    encolar('workorders', { workorderIds: [String(nuevo.id)] });
    encolar('operaciones', { workorderIds: [String(nuevo.id)] });
    encolar('materiales', { workorderIds: [String(nuevo.id)] });
  }

  function encolar(accion, params) {
    const scriptId = parametro('SCRIPT_ID_TAREA');
    const deployId = parametro('DEPLOY_ID_TAREA');
    if (!scriptId || !deployId) {
      registrar('SUPA_SYNC', 'Faltan SCRIPT_ID_TAREA / DEPLOY_ID_TAREA en el deployment de este User Event: no se encola ' + accion + '.');
      return;
    }
    const cuerpo = { accion: accion, ids: {} };
    Object.keys(params || {}).forEach((k) => { cuerpo.ids[k] = params[k]; });
    if (params && params.folios) cuerpo.folios = params.folios;
    try {
      task.enqueue({
        taskType: task.Type.SUITELET,
        scriptId: scriptId,
        deploymentId: deployId,
        params: cuerpo
      });
    } catch (error) {
      registrar('SUPA_SYNC', 'No se pudo encolar ' + accion + ': ' + String((error && error.message) || error));
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
