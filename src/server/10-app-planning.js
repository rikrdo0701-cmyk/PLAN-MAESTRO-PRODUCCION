function PP_getPlanningBootstrap() {
  return PP_readPlanningState_();
}

function PP_generateDraftPlan(payload) {
  if (payload && payload.operations) {
    payload.operations = payload.operations.map((op) => {
      if (op.dueDate) op.dueDate = PP_dateToIso_(op.dueDate);
      if (op.fechaEntrega) op.fechaEntrega = PP_dateToIso_(op.fechaEntrega);
      if (op.fechaVencimiento) op.fechaVencimiento = PP_dateToIso_(op.fechaVencimiento);
      if (op.startDate) op.startDate = PP_dateToIso_(op.startDate);
      if (op.endDate) op.endDate = PP_dateToIso_(op.endDate);
      if (op.fechaInicio) op.fechaInicio = PP_dateToIso_(op.fechaInicio);
      if (op.fechaFin) op.fechaFin = PP_dateToIso_(op.fechaFin);
      return op;
    });
  }
  return PP_generateDraftPlan_(payload || {});
}

function PP_publishDraftPlan(payload) {
  return PP_publishDraftPlan_(payload || {});
}
