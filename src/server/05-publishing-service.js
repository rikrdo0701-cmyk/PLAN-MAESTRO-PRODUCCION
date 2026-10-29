function PP_publishDraftPlan_(payload) {
  if (!payload || !Array.isArray(payload.operations)) throw new Error('El plan no contiene operations');
  const lock = PP_acquireScriptLock_('publicar', 30000);
  try {
    const spreadsheet = PP_getWorkbook_();
    PP_ensureWorkbook_(spreadsheet);
    const snapshot = PP_appendPlanSnapshot_(spreadsheet, payload, Session.getActiveUser().getEmail() || 'usuario');
    const saved = PP_writeState_(spreadsheet, payload, Session.getActiveUser().getEmail() || 'usuario');
    const weekStart = String(snapshot.weekStart || snapshot.planStart || '');
    const pruned = PP_prunePublishedSnapshots_(spreadsheet, snapshot.snapshotId, weekStart);
    return { ok: true, activeVersion: snapshot, state: saved, retained: { weekStart: weekStart }, pruned: pruned };
  } finally {
    lock.releaseLock();
  }
}

function PP_prunePublishedSnapshots_(spreadsheet, keepSnapshotId, weekStart) {
  const week = String(weekStart || '');
  const pruned = [];
  let list = [];
  try { list = PP_listPlanSnapshots_(spreadsheet) || []; } catch (ignored) {}
  if (!Array.isArray(list) || !list.length) return pruned;
  list.forEach(function(record) {
    const id = String(record && record.snapshotId || '');
    if (!id || id === 'draft' || id === keepSnapshotId) return;
    if (week && String(record.weekStart || record.planStart || '') !== week) return;
    try { PP_deletePlanSnapshot_(spreadsheet, id); pruned.push(id); } catch (ignored) {}
  });
  return pruned;
}

// RETENCION POR ANTIGUEDAD. Decision de la persona (2026-09-27): "si ya paso 1 mes desde que se
// genero se puede borrar". Se apoya en generatedAt, que es lo que decia, y NO en weekStart: la
// medicion del 2026-09-26 dio 24 entradas SIN semana, y esas son justamente las que la poda
// anterior no puede borrar nunca, porque su linea `if (week && ... !== week) return;` sale sin
// borrar en cuanto la semana no coincide. Con generatedAt no hay que adivinar la semana.
//
// LO QUE ESTA FUNCION NO HACE, Y CADA COSA POR UNA RAZON:
//
//  1. NO BORRA EL BORRADOR. Ni por antiguedad ni por nada. El borrador es el plan de trabajo, y
//     borrarlo seria perder el plan en curso. Hay dos guardas: el chequeo explicito de abajo y el
//     que ya traia PP_deletePlanSnapshot_, que devuelve { skipped: true } para 'draft'. Se
//     comprueban las dos porque una sola podria fallar.
//
//  2. NO ADIVINA UNA FECHA. Un snapshot sin generatedAt NO se borra: se cuenta aparte y se
//     devuelve en sinFecha para que la persona decida. Ponerle "hoy" a un plan del que no se sabe
//     cuando se hizo es exactamente el error que haria que un corte por antiguedad borrara el
//     equivocado. La ausencia de fecha no es evidencia de antiguedad, igual que en RULE-OT-051.
//
//  3. NO BORRA EL MAS RECIENTE. El mas reciente por generatedAt se conserva siempre, aunque tenga
//     mas de un mes, porque es el plan que alguien podria estar revisando. Es una guarda de una
//     linea y evita el pie mas tonto: que al abrir un plan de hace dos meses te lo borren.
//
//  4. NO BORRA EN SILENCIO. Devuelve exactamente que borro, cuantas filas libera y que se dejo
//     fuera y por que. Si algo falla, el error se propaga: un catch (ignored) aqui seria repetir
//     el agujero que hizo que la poda anterior dejara 85 snapshots de una semana sin que nadie se
//     enterara.
//
// maxAgeDays tiene que ser un numero positivo. Sin numero no hay politica, y borrar todo porque
// no me dijeron cuantos dias es la peor forma de responder a una pregunta mal hecha.
//
// dryRun: true hace TODO el calculo y NO borra nada. Es lo que permite ver cuantos snapshots
// caerian y cuantas filas se liberarian antes de decidir, que es la diferencia entre una decision
// informada y una apuesta. El codigo es el mismo en los dos caminos: no hay dos versiones que
// puedan divergir.
function PP_pruneOldPlanSnapshots_(spreadsheet, maxAgeDays, options) {
  const dias = Number(maxAgeDays);
  const opts = options || {};
  if (!isFinite(dias) || dias <= 0) {
    throw new Error('PP_pruneOldPlanSnapshots_ necesita maxAgeDays numerico y mayor que 0. Received: ' + maxAgeDays);
  }
  const dryRun = opts.dryRun === true;
  const ahora = Number(opts.nowMs || Date.now());
  const proteger = {};
  (Array.isArray(opts.keepSnapshotIds) ? opts.keepSnapshotIds : []).forEach(function (id) {
    const k = String(id || '').trim();
    if (k) proteger[k] = true;
  });

  const list = PP_listPlanSnapshots_(spreadsheet) || [];
  // El mas reciente por fecha se protege siempre. Se elige sobre los que SI tienen fecha, porque
  // un snapshot sin fecha no puede ser "el mas reciente": no se sabe cuando se hizo.
  let masReciente = '';
  let masRecienteMs = -1;
  list.forEach(function (record) {
    const t = Date.parse(String((record && record.generatedAt) || ''));
    if (!isFinite(t)) return;
    if (t > masRecienteMs) { masRecienteMs = t; masReciente = String(record.snapshotId || ''); }
  });
  if (masReciente) proteger[masReciente] = true;

  const corte = ahora - dias * 24 * 60 * 60 * 1000;
  const dia = 24 * 60 * 60 * 1000;
  const borrados = [];
  const protegidos = [];
  const sinFecha = [];
  const cubetas = {
    '0-30 dias': { snapshots: 0, filas: 0 },
    '31-60 dias': { snapshots: 0, filas: 0 },
    '61-90 dias': { snapshots: 0, filas: 0 },
    'mas de 90 dias': { snapshots: 0, filas: 0 },
    'sin fecha': { snapshots: 0, filas: 0 },
  };
  list.forEach(function (record) {
    const id = String((record && record.snapshotId) || '').trim();
    if (!id || id === 'draft') return;                       // el borrador no se toca, punto
    const operaciones = Number((record && record.operations) || 0);
    const generatedAt = String((record && record.generatedAt) || '').trim();
    const t = Date.parse(generatedAt);

    // LAS CUBETAS SE CUENTAN ANTES DE PROTEGER, Y A PROPOSITO. Si se contaran despues, el
    // reporte omitiria los protegidos y la distribucion que se lee no seria la real: diria
    // "1 snapshot de 0 a 30 dias" cuando hay 2, porque uno estaria protegido. Un diagnostico que
    // miente por omision es peor que no dar el diagnostico, porque es el que se usa para decidir
    // el corte.
    if (!isFinite(t)) {
      sinFecha.push({ snapshotId: id, weekStart: String((record && record.weekStart) || ''), operations: operaciones });
      cubetas['sin fecha'].snapshots += 1;
      cubetas['sin fecha'].filas += operaciones;
      return;
    }
    const edad = Math.floor((ahora - t) / dia);
    const clave = edad <= 30 ? '0-30 dias' : edad <= 60 ? '31-60 dias' : edad <= 90 ? '61-90 dias' : 'mas de 90 dias';
    cubetas[clave].snapshots += 1;
    cubetas[clave].filas += operaciones;

    if (proteger[id]) { protegidos.push({ snapshotId: id, motivo: 'protegido', edadDias: edad }); return; }
    if (t >= corte) return;                                 // todavia no cumple la antiguedad
    if (!dryRun) {
      // SIN catch: si el borrado falla, que se sepa. Ver la nota 4.
      PP_deletePlanSnapshot_(spreadsheet, id);
    }
    borrados.push({ snapshotId: id, generatedAt: generatedAt, edadDias: edad, operations: operaciones });
  });

  const filas = borrados.reduce(function (sum, item) { return sum + (item.operations || 0); }, 0);
  return {
    dryRun: dryRun,
    maxAgeDays: dias,
    corteIso: new Date(corte).toISOString(),
    evaluados: list.length,
    borrados: borrados,
    filasLiberadas: filas,
    protegidos: protegidos,
    sinFecha: sinFecha,
    cubetas: cubetas,
    mensaje: (dryRun ? 'SIMULACION (no se borro nada). ' : '') + 'Se evaluaron ' + list.length
      + ' snapshots. ' + (dryRun ? 'Borrarian ' : 'Borrados ') + borrados.length
      + ' (liberan ' + filas + ' filas). Protegidos ' + protegidos.length
      + '. SIN FECHA (no se borran, los decide la persona): ' + sinFecha.length + '.',
  };
}

function PP_restoreNormalize_(value) {
  return String(value || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function PP_restoreOperationKey_(operation) {
  return [operation && operation.ot, operation && operation.secuencia, operation && operation.ct].map(PP_restoreNormalize_).join('|');
}

function PP_reconcilePublishedPlan_(snapshot, currentState) {
  const published = snapshot.fullState || snapshot;
  const current = currentState || {};
  const publishedOts = {};
  (published.selectedOts || (published.operations || []).map(function(item) { return item.ot; })).forEach(function(ot) {
    const key = PP_restoreNormalize_(ot); if (key) publishedOts[key] = true;
  });
  const workOrders = {};
  (current.workOrders || []).forEach(function(item) { workOrders[PP_restoreNormalize_(item.ot)] = item; });
  const restored = {};
  Object.keys(publishedOts).forEach(function(ot) {
    const item = workOrders[ot];
    const status = PP_restoreNormalize_(item && (item.status || item.estatus));
    if (item && item.exists !== false && ['CERRADA', 'CERRADO', 'CLOSED', 'CANCELADA', 'CANCELADO'].indexOf(status) < 0) restored[ot] = true;
  });
  const isToolChange = function(operation) {
    return PP_restoreNormalize_(operation.tipoInsercion) === 'CAMBIO_HERRAMENTAL' &&
      Boolean(operation.generatedBy || PP_restoreNormalize_(operation.ct) === 'TOOL_CHANGE');
  };
  const publishedOperations = (published.operations || []).filter(function(operation) {
    return restored[PP_restoreNormalize_(operation.ot)] && !isToolChange(operation);
  });
  const publishedByKey = {};
  publishedOperations.forEach(function(operation) { publishedByKey[PP_restoreOperationKey_(operation)] = operation; });
  let completedOperations = 0;
  let newOperations = 0;
  const currentKeys = {};
  const operations = (current.operations || []).filter(function(operation) {
    return !restored[PP_restoreNormalize_(operation.ot)] || !isToolChange(operation);
  }).map(function(operation) {
    if (!restored[PP_restoreNormalize_(operation.ot)]) return Object.assign({}, operation);
    const key = PP_restoreOperationKey_(operation);
    currentKeys[key] = true;
    const historical = publishedByKey[key];
    if (!historical) {
      newOperations += 1;
      return Object.assign({}, operation, { planStatus: 'PENDIENTE', completedAt: '', fechaInicio: '', horaInicio: '', fechaFin: '', horaFin: '', locked: false });
    }
    if (PP_restoreNormalize_(operation.planStatus) === 'COMPLETADA_PLAN') {
      completedOperations += 1;
      return Object.assign({}, operation);
    }
    const next = Object.assign({}, operation, historical, { id: operation.id, ot: operation.ot, secuencia: operation.secuencia, ct: operation.ct, planStatus: 'PENDIENTE', completedAt: '' });
    ['maquina', 'machine', 'herramental', 'kitHerramental', 'subcontractType', 'subcontractDays'].forEach(function(field) {
      if (operation[field] !== undefined && operation[field] !== null && operation[field] !== '') next[field] = operation[field];
    });
    return next;
  });
  const configurations = Object.assign({}, current.otConfigurations || {});
  let preservedConfigurations = 0;
  Object.keys(restored).forEach(function(ot) {
    const publishedKey = Object.keys(published.otConfigurations || {}).find(function(key) { return PP_restoreNormalize_(key) === ot; });
    const currentKey = Object.keys(current.otConfigurations || {}).find(function(key) { return PP_restoreNormalize_(key) === ot; });
    const active = currentKey ? current.otConfigurations[currentKey] || {} : {};
    if (Object.keys(active).some(function(field) { return active[field] !== undefined && active[field] !== null && active[field] !== ''; })) preservedConfigurations += 1;
    const merged = Object.assign({}, publishedKey ? published.otConfigurations[publishedKey] || {} : {});
    Object.keys(active).forEach(function(field) { if (active[field] !== undefined && active[field] !== null && active[field] !== '') merged[field] = active[field]; });
    configurations[currentKey || publishedKey || ot] = merged;
  });
  return {
    state: Object.assign({}, current, { selectedOts: Object.keys(restored), operations: operations, otConfigurations: configurations }),
    summary: {
      restoredOts: Object.keys(restored).length,
      closedOts: Object.keys(publishedOts).length - Object.keys(restored).length,
      completedOperations: completedOperations,
      removedOperations: publishedOperations.filter(function(operation) { return !currentKeys[PP_restoreOperationKey_(operation)]; }).length,
      newOperations: newOperations,
      preservedConfigurations: preservedConfigurations
    }
  };
}

function PP_restorePublishedPlanAsDraft_(snapshotId, currentPayload) {
  const key = String(snapshotId || '').trim();
  if (!key || key === 'draft') throw new Error('Selecciona una instantanea publicada valida');
  if (!currentPayload || !Array.isArray(currentPayload.operations)) throw new Error('El estado actual no contiene operations');
  const lock = PP_acquireScriptLock_('restaurar publicado', 30000);
  try {
    const spreadsheet = PP_getWorkbook_();
    PP_ensureWorkbook_(spreadsheet);
    const snapshot = PP_getPlanSnapshot_(spreadsheet, key);
    if (!snapshot.fullState) throw new Error('La instantanea publicada no contiene estado completo');
    const currentState = PP_readState_(spreadsheet);
    const payloadRevision = Number(currentPayload.revision || 0);
    const currentRevision = Number(currentState.revision || 0);
    const stalePayload = payloadRevision !== currentRevision;
    const reconciliationState = stalePayload ? currentState : currentPayload;
    let currentDraft = null;
    try { currentDraft = PP_getPlanSnapshot_(spreadsheet, 'draft'); } catch (ignored) {}
    const backupId = 'technical-' + Utilities.getUuid();
    PP_storePlanSnapshotPayload_(backupId, { state: currentState, draft: currentDraft });
    const reconciled = PP_reconcilePublishedPlan_(snapshot, reconciliationState);
    try {
      PP_replaceDraftSnapshot_(spreadsheet, reconciled.state, Session.getActiveUser().getEmail() || 'usuario');
      const state = PP_writeState_(spreadsheet, reconciled.state, Session.getActiveUser().getEmail() || 'usuario', true);
      return { ok: true, snapshotId: 'draft', backupId: backupId, stalePayload: stalePayload, state: state, summary: reconciled.summary };
    } catch (error) {
      let rollbackError = null;
      try { PP_writeState_(spreadsheet, currentState, Session.getActiveUser().getEmail() || 'rollback', true); }
      catch (stateRollbackError) { rollbackError = stateRollbackError; }
      try {
        if (currentDraft) PP_replaceDraftSnapshot_(spreadsheet, currentDraft.fullState || currentDraft, Session.getActiveUser().getEmail() || 'rollback');
        else PP_clearDraftSnapshot_(spreadsheet);
      } catch (draftRollbackError) { rollbackError = rollbackError || draftRollbackError; }
      if (rollbackError) error.message += ' | ROLLBACK_INCOMPLETO: ' + rollbackError.message;
      throw error;
    }
  } finally {
    lock.releaseLock();
  }
}
