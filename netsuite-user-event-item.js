/**
 * @NApiVersion 2.1
 * @NScriptType UserEvent
 *
 * User Event de `item` -> catalogo de articulos en Supabase (`items`).
 *
 * El catalogo de articulos es la tabla de la que salen las columnas articulo/descripcion de
 * `work_orders` y de `operations`, y la de la que cuelgan herramentales y configuraciones
 * por articulo. Si el articulo se renombra en NetSuite y no se empuja, la web sigue viendo
 * el nombre viejo.
 *
 * ---------------------------------------------------------------------------------
 * Script parameters: SCRIPT_ID_TAREA, DEPLOY_ID_TAREA, ACTIVO.
 *
 * OJO CON EL ALCANCE: aqui NO se encola `inventario`. El inventario no es un registro que se
 * guarde, es un agregado (aggregateitemlocation) que se recalcula solo con cada movimiento;
 * no tiene User Event posible. Lo lee el barrido programado
 * (netsuite-scheduled-sincronizacion.js). Ver RULE-SUP-006.
 */
define(['N/task', 'N/runtime', 'N/log'], (task, runtime, log) => {
  function afterSubmit(context) {
    if (!activo()) return;
    if (context.type === context.UserEventType.DELETE) {
      registrar('SUPA_SYNC', 'Se borro un articulo: no se encola nada, en Supabase queda el ultima version leida.');
      return;
    }
    const nuevo = context.newRecord;
    if (!nuevo || !nuevo.id) return;
    const itemId = idDeItem(nuevo);
    if (!itemId) {
      registrar('SUPA_SYNC', 'El articulo no tiene id legible: no se encola nada.');
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
        params: { accion: 'items', ids: { itemIds: [itemId] } }
      });
    } catch (error) {
      registrar('SUPA_SYNC', 'No se pudo encolar items: ' + String((error && error.message) || error));
    }
  }

  function idDeItem(registro) {
    try {
      const valor = registro.getValue({ fieldId: 'itemid' });
      return valor == null ? '' : String(valor).trim();
    } catch (e) {
      return '';
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
