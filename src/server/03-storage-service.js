function PP_readPlanningState_() {
  const spreadsheet = PP_getWorkbook_();
  PP_ensureWorkbook_(spreadsheet);
  return PP_readState_(spreadsheet);
}

function PP_writePlanningState_(payload, action) {
  if (!payload || !Array.isArray(payload.operations)) throw new Error('El plan no contiene operations');
  const lock = PP_acquireScriptLock_(action || 'guardar', 30000);
  try {
    const spreadsheet = PP_getWorkbook_();
    PP_ensureWorkbook_(spreadsheet);
    return PP_writeState_(spreadsheet, payload, Session.getActiveUser().getEmail() || 'usuario');
  } finally {
    lock.releaseLock();
  }
}

function PP_writeSkillMatrixState_(payload) {
  if (!payload) throw new Error('La matriz no contiene datos');
  const lock = PP_acquireScriptLock_('guardar matriz', 15000);
  try {
    const spreadsheet = PP_getWorkbook_();
    PP_ensureWorkbook_(spreadsheet);
    return PP_writeSkillState_(spreadsheet, payload, Session.getActiveUser().getEmail() || 'usuario');
  } finally {
    lock.releaseLock();
  }
}

function PP_readLatestPublishedPlan_() {
  const spreadsheet = PP_getWorkbook_();
  PP_ensureWorkbook_(spreadsheet);
  const versions = PP_listPlanSnapshots_(spreadsheet);
  if (!versions.length) return { ok: true, snapshotId: '', operations: [], subassemblyNeeds: [] };
  return PP_getPlanSnapshot_(spreadsheet, versions[0].snapshotId);
}
