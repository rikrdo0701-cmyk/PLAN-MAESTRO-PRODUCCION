/**
 * @NApiVersion 2.1
 * @NScriptType usereventscript
 *
 * User Event de `workcenter` (centro de trabajo) -> `machines` en Supabase.
 *
 * `machines` es el catalogo contra el que se resuelven las operaciones: el CT de la
 * operacion (los digitos del nombre del centro) tiene que existir en `machines` para que la
 * web pueda asignarle maquina. Si un centro nuevo se queda solo en NetSuite, sus
 * operaciones llegan a Supabase sin maquina resoluble.
 *
 * ---------------------------------------------------------------------------------
 * Script parameters: SCRIPT_ID_TAREA, DEPLOY_ID_TAREA, ACTIVO.
 *
 * No hay filtro por `workcentertype`: el usuario decidio (2026-09-28) que `machines.tipo`
 * no se necesita porque la maquina se captura en el plan, y `workcentertype` no existe en
 * ninguna fuente medible (SuiteQL ni REST Record API). El RESTlet guarda todos los
 * entitygroup marcados como centro de trabajo, sin descartar a nadie.
 */
define(['N/task', 'N/runtime', 'N/log'], (task, runtime, log) => {
  function afterSubmit(context) {
    if (!activo()) return;
    if (context.type === context.UserEventType.DELETE) {
      registrar('SUPA_SYNC', 'Se borro un centro de trabajo: no se encola nada, en Supabase queda con el ultimo estado leido.');
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
        params: { accion: 'centros', ids: { workcenterIds: [String(nuevo.id)] } }
      });
    } catch (error) {
      registrar('SUPA_SYNC', 'No se pudo encolar centros: ' + String((error && error.message) || error));
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
