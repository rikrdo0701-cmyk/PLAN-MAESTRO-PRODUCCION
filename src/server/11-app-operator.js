function PP_getActiveOperatorPlan() {
  const result = PP_readLatestPublishedPlan_();
  if (result.operations) {
    result.operations = result.operations.map((op) => {
      if (op.dueDate) op.dueDate = PP_dateToIso_(op.dueDate);
      if (op.fechaEntrega) op.fechaEntrega = PP_dateToIso_(op.fechaEntrega);
      if (op.fechaInicio) op.fechaInicio = PP_dateToIso_(op.fechaInicio);
      if (op.fechaFin) op.fechaFin = PP_dateToIso_(op.fechaFin);
      return op;
    });
  }
  return result;
}

function PP_completeOperation(payload) {
  if (payload) {
    if (payload.dueDate) payload.dueDate = PP_dateToIso_(payload.dueDate);
    if (payload.fechaEntrega) payload.fechaEntrega = PP_dateToIso_(payload.fechaEntrega);
  }
  return PP_completeOperation_(payload || {});
}

function PP_registerSubassemblyPicking(payload) {
  if (payload) {
    if (payload.dueDate) payload.dueDate = PP_dateToIso_(payload.dueDate);
    if (payload.fechaEntrega) payload.fechaEntrega = PP_dateToIso_(payload.fechaEntrega);
  }
  return PP_registerSubassemblyPicking_(payload || {});
}
