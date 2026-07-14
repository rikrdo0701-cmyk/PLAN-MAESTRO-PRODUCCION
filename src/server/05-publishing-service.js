function PP_publishDraftPlan_(payload) {
  if (!payload || !Array.isArray(payload.operations)) throw new Error('El plan no contiene operations');
  const lock = PP_acquireScriptLock_('publicar', 30000);
  try {
    const spreadsheet = PP_getWorkbook_();
    PP_ensureWorkbook_(spreadsheet);
    const snapshot = PP_appendPlanSnapshot_(spreadsheet, payload, Session.getActiveUser().getEmail() || 'usuario');
    const saved = PP_writeState_(spreadsheet, payload, Session.getActiveUser().getEmail() || 'usuario');
    return { ok: true, activeVersion: snapshot, state: saved };
  } finally {
    lock.releaseLock();
  }
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
