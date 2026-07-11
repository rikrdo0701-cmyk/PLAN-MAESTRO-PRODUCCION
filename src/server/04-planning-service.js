function PP_generateDraftPlan_(payload) {
  const draft = payload || {};
  draft.planLifecycleStatus = 'BORRADOR';
  draft.draftGeneratedAt = new Date().toISOString();
  return PP_writePlanningState_(draft, 'generar borrador');
}
