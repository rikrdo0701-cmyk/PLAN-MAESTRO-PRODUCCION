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
