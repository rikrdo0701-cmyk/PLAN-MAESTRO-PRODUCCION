function PP_completeOperation_(payload) {
  payload = payload || {};
  if (!payload.key && !payload.operationId) throw new Error('Falta operacion a completar');
  return { ok: true, status: 'COMPLETADA', payload: payload };
}

function PP_registerSubassemblyPicking_(payload) {
  payload = payload || {};
  if (!payload.ot || !payload.subassembly) throw new Error('Falta OT o subensamble');
  const quantity = Number(payload.quantity || 0);
  if (!(quantity > 0)) throw new Error('La cantidad surtida debe ser mayor a cero');
  return { ok: true, status: 'SURTIDO_REGISTRADO', payload: payload };
}
