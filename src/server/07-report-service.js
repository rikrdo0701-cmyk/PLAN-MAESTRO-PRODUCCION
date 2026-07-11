function PP_getDraftReport_(payload) {
  payload = payload || {};
  return {
    ok: true,
    status: 'BORRADOR',
    summary: payload.summary || {},
    loads: payload.loads || [],
    lateJobs: payload.lateJobs || []
  };
}

function PP_getPublishedReport_(snapshotId) {
  const spreadsheet = PP_getWorkbook_();
  PP_ensureWorkbook_(spreadsheet);
  if (snapshotId) return PP_getPlanSnapshot_(spreadsheet, snapshotId);
  return PP_readLatestPublishedPlan_();
}
