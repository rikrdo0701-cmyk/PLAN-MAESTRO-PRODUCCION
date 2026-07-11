function PP_getPlanningBootstrap() {
  return PP_readPlanningState_();
}

function PP_generateDraftPlan(payload) {
  return PP_generateDraftPlan_(payload || {});
}

function PP_publishDraftPlan(payload) {
  return PP_publishDraftPlan_(payload || {});
}
