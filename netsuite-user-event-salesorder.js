/**
 * @NApiVersion 2.1
 * @NScriptType usereventscript
 *
 * User Event de `salesorder` (orden de venta) -> `sales_orders` en Supabase.
 *
 * La orden de venta es de donde sale `work_orders.cliente`: una OT se crea desde un pedido,
 * y es el pedido el que sabe a quien se le entrega. Push separado del de la OT (no se saca
 * el cliente de la linea de la OT, porque alli no esta), y con clave propia (`folio`).
 *
 * ---------------------------------------------------------------------------------
 * Script parameters: SCRIPT_ID_TAREA, DEPLOY_ID_TAREA, ACTIVO.
 *
 * Se manda la orden COMPLETA con sus lineas en `lineas` (jsonb) y no una fila por linea:
 * asi la escritura es una por orden. Si mas adelante hacen falta consultas o filtros por
 * linea, se parte en `sales_order_lines`; el RESTlet es el unico lugar que hay que tocar.
 */
define(['N/task', 'N/runtime', 'N/log'], (task, runtime, log) => {
  function afterSubmit(context) {
    if (!activo()) return;
    if (context.type === context.UserEventType.DELETE) {
      registrar('SUPA_SYNC', 'Se borro una orden de venta: no se encola nada, en Supabase queda la ultima version leida.');
      return;
    }
    const nuevo = context.newRecord;
    if (!nuevo || !nuevo.id) return;
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
        params: { accion: 'ordenes_venta', ids: { salesOrderIds: [String(nuevo.id)] } }
      });
    } catch (error) {
      registrar('SUPA_SYNC', 'No se pudo encolar ordenes_venta: ' + String((error && error.message) || error));
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
