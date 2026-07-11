function PP_getActiveOperatorPlan() {
  return PP_readLatestPublishedPlan_();
}

function PP_completeOperation(payload) {
  return PP_completeOperation_(payload || {});
}

function PP_registerSubassemblyPicking(payload) {
  return PP_registerSubassemblyPicking_(payload || {});
}
