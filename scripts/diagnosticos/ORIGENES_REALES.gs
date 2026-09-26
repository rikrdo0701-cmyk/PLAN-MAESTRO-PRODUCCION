/**
 * ORIGENES_REALES - el manifiesto NO es la fuente de verdad. ESTA SONDA USA LAS HOJAS.
 *
 * POR QUE HACE FALTA, Y QUE ERROR CORRIGE. CUENTA_ORIGINS clsifico un origin como VIVO si su
 * snapshotId aparecia en PP_listPlanSnapshots_. Con esa unica fuente, la corrida del 2026-09-26
 * dio "0 huerfanos", y mi conclusion de que los origins eran filas sin plan detras resulto
 * ser la lectura de un manifiesto que hay que verificar, no una verdad.
 *
 * LO QUE LA CORRIDA DESTAPO, Y NO SE CONOCIA:
 *   - ESTADOS_OPERACION_PLAN tiene 1181 filas y solo 4 origins: draft (556 filas), f98ffa66
 *     (437), c6530ce6 (161) y 07aca22c (27). O sea 625 filas de plan publicado, que es
 *     exactamente el "625 filas" de RULE-PERF-012. Los 308 KB son REALES y son de 3 planes
 *     publicados que existen.
 *   - PERO el manifiesto tiene 124 entradas, y muchas dicen "(sin semana, sin fecha)". Con la
 *     politica declarada de "un plan publicado por semana" (PP_prunePublishedSnapshots_), 124
 *     es muchisimo mas de uno por semana. O la poda no esta podando, o el manifiesto esta lleno
 *     de entradas que ya no corresponden a nada.
 *   - Y hay una linea en la poda que puede explicar la segunda: PP_prunePublishedSnapshots_
 *     (05-publishing-service.js:26) dice
 *         if (week && String(record.weekStart || record.planStart || '') !== week) return;
 *     o sea que SALE sin borrar cuando el registro NO tiene semana. Un registro sin semana
 *     nunca se compara bien contra una semana con valor, asi que NUNCA se borra. Y ademas el
 *     borrado esta dentro de un try/catch con catch (ignored) {}: si PP_deletePlanSnapshot_
 *     falla, el fallo se traga y nadie se entera. Eso es dos rutas por las que la poda puede
 *     dejar de podar sin decir nada.
 *
 * LO QUE MIDE ESTA SONDA, EN ORDEN DE FUERZA:
 *   1. VERDAD DE TIERRA: para cada origin de ESTADOS_OPERACION_PLAN, cuantas filas hay REALES
 *      en PLANES_HISTORICOS y en BORRADOR_PLAN con ese SNAPSHOT_ID. Esta es la fuente de verdad,
 *      porque un snapshot sin filas no existe aunque el manifiesto lo liste.
 *   2. Si el manifiesto lista snapshots SIN filas: eso es manifiesto rancio, y entonces el
 *      "0 huerfanos" de CUENTA_ORIGINS era un falso verde.
 *   3. Cuantas entradas del manifiesto hay por semana, para ver si la poda de una por semana
 *      se esta cumpliendo o no. Y cuantas son "sin semana", que son las que la linea de la
 *      poda nunca puede borrar.
 *   4. Cuanto pesan los snapshots viejos: cuantas filas de PLANES_HISTORICOS tienen el
 *      SNAPSHOT_ID de una entrada que no es el draft ni el activo. Eso es lo que se pagaria por
 *      guardar planes publicados que nadie va a volver a abrir.
 *
 * LO QUE NO HACE. No escribe celdas, no borra nada, no llama a PP_deletePlanSnapshot_, no toca
 * CONFIG y no llama a syncNetSuiteWorkOrdersLite ni a syncNetSuiteData. Solo lee con SpreadsheetApp
 * (nativo, no gasta UrlFetch).
 */
function ORIGENES_REALES() {
  var log = function (m) { Logger.log(String(m)); };
  var texto = function (v) { return String(v === undefined || v === null ? '' : v).trim(); };

  log('ORIGENES_REALES: los origins de ESTADOS_OPERACION_PLAN, contra las hojas y no contra el manifiesto');
  log('');

  // ------------------------------------------------------------ 1. los origins y sus conteos
  var hojaEstados;
  try {
    hojaEstados = PP_getWorkbook_().getSheetByName('ESTADOS_OPERACION_PLAN');
  } catch (e1) {
    log('   no se pudo abrir ESTADOS_OPERACION_PLAN: ' + String(e1 && e1.message || e1));
    log('');
    log('ORIGENES_REALES: sin la hoja de estados no hay nada que verificar.');
    return;
  }
  if (!hojaEstados) {
    log('   ESTADOS_OPERACION_PLAN no existe.');
    log('');
    log('ORIGENES_REALES: sin hoja no hay veredicto.');
    return;
  }
  var filasEstados = PP_readRows_(hojaEstados);
  if (!filasEstados.length) {
    log('   ESTADOS_OPERACION_PLAN tiene 0 filas. SIN FILAS NO HAY NADA QUE VERIFICAR.');
    log('');
    log('ORIGENES_REALES: sin datos no hay veredicto. No se afirma nada.');
    return;
  }

  var porOrigin = {};
  filasEstados.forEach(function (row) {
    var o = texto(row.ORIGEN) || 'draft';
    if (!porOrigin[o]) porOrigin[o] = { filas: 0, completadas: 0 };
    porOrigin[o].filas += 1;
    if (/COMPLET/.test(texto(row.ESTATUS_PLAN).toUpperCase())) porOrigin[o].completadas += 1;
  });
  log('1) ORIGINS EN ESTADOS_OPERACION_PLAN: ' + Object.keys(porOrigin).length
    + '  (' + filasEstados.length + ' filas en total)');

  // ------------------------------------------- 2. VERDAD DE TIERRA: filas por snapshot en las hojas
  var historicos = [];
  var borrador = [];
  try {
    historicos = PP_readRows_(PP_getWorkbook_().getSheetByName('PLANES_HISTORICOS'));
  } catch (e2) { log('   AVISO: no se pudo leer PLANES_HISTORICOS: ' + String(e2 && e2.message || e2)); }
  try {
    borrador = PP_readRows_(PP_getWorkbook_().getSheetByName('BORRADOR_PLAN'));
  } catch (e3) { log('   AVISO: no se pudo leer BORRADOR_PLAN: ' + String(e3 && e3.message || e3)); }

  var filasPorSnapshot = function (rows) {
    var out = {};
    rows.forEach(function (row) {
      var id = texto(row.SNAPSHOT_ID);
      if (!id) return;
      if (!out[id]) out[id] = 0;
      out[id] += 1;
    });
    return out;
  };
  var enHistoricos = filasPorSnapshot(historicos);
  var enBorrador = filasPorSnapshot(borrador);
  log('   PLANES_HISTORICOS: ' + historicos.length + ' filas, ' + Object.keys(enHistoricos).length + ' snapshots distintos');
  log('   BORRADOR_PLAN:    ' + borrador.length + ' filas, ' + Object.keys(enBorrador).length + ' snapshots distintos');
  log('');

  log('2) CADA ORIGEN, CONTRA LAS HOJAS. ESTA ES LA VERDAD DE TIERRA:');
  var sinFilas = [];
  Object.keys(porOrigin).sort().forEach(function (o) {
    var d = porOrigin[o];
    var h = enHistoricos[o] || 0;
    var b = enBorrador[o] || 0;
    var existe = (h + b) > 0;
    if (!existe) sinFilas.push(o);
    log('   ' + texto(o).slice(0, 40));
    log('      estados=' + d.filas + ' (completadas ' + d.completadas + ')  PLANES_HISTORICOS=' + h + '  BORRADOR_PLAN=' + b);
    log('      -> ' + (existe ? 'TIENE PLAN REAL' : 'SIN PLAN REAL: filas de estado sin snapshot debajo'));
  });
  log('');

  // ------------------------------------------- 3. el manifiesto, y si esta rancio
  var manifiesto = [];
  try {
    manifiesto = PP_listPlanSnapshots_(PP_getWorkbook_()) || [];
  } catch (e4) {
    log('   AVISO: no se pudo leer el manifiesto: ' + String(e4 && e4.message || e4));
    log('   SIN EL MANIFIESTO no se puede decir si el manifiesto esta rancio. Se sigue con lo de las hojas.');
  }
  var enManifiesto = {};
  (Array.isArray(manifiesto) ? manifiesto : []).forEach(function (s) {
    var id = texto(s && s.snapshotId);
    if (id) enManifiesto[id] = s;
  });
  log('3) EL MANIFIESTO, CONTRA LAS HOJAS:');
  log('   entradas en el manifiesto: ' + Object.keys(enManifiesto).length);
  var rancio = Object.keys(enManifiesto).filter(function (id) {
    return id !== 'draft' && !((enHistoricos[id] || 0) + (enBorrador[id] || 0));
  });
  log('   entradas SIN filas en PLANES_HISTORICOS ni BORRADOR_PLAN (manifiesto rancio): ' + rancio.length);
  if (rancio.length) {
    log('   OJO: si el manifiesto lista snapshots que no tienen ni una fila, entonces el manifiesto');
    log('   esta RANCIO, y clasificar un origin como vivo "porque esta en el manifiesto" NO');
    log('   prueba que exista el plan. Los primeros 20:');
    rancio.slice(0, 20).forEach(function (id) { log('     ' + id); });
  }
  log('');

  // ------------------------------------------- 4. cuantas por semana, y cuantas sin semana
  log('4) EL MANIFIESTO POR SEMANA (la poda declara UN plan publicado por semana):');
  var porSemana = {};
  var sinSemana = 0;
  Object.keys(enManifiesto).forEach(function (id) {
    if (id === 'draft') return;
    var s = enManifiesto[id];
    var w = texto(s.weekStart || s.planStart);
    if (!w) { sinSemana += 1; return; }
    if (!porSemana[w]) porSemana[w] = 0;
    porSemana[w] += 1;
  });
  var semanas = Object.keys(porSemana).sort();
  log('   semanas distintas: ' + semanas.length + '   entradas SIN semana: ' + sinSemana);
  log('   esas ' + sinSemana + ' sin semana son las que PP_prunePublishedSnapshots_ NUNCA borra:');
  log('   su linea dice "if (week && String(record.weekStart||record.planStart) !== week) return;",');
  log('   o sea que sale sin borrar en cuanto la semana no coincide, y un registro sin semana no');
  log('   puede coincidir con ninguna.');
  semanas.forEach(function (w) {
    log('   ' + w + ': ' + porSemana[w] + (porSemana[w] > 1 ? '   <- MAS DE UNO: la poda no esta podando' : ''));
  });
  log('');

  // ------------------------------------------- 5. lo que pesan los snapshots viejos
  log('5) LO QUE PESAN LOS SNAPSHOTS VIEJOS EN PLANES_HISTORICOS:');
  var totalHistoricas = historicos.length;
  var filasViejas = 0;
  var snapshotsViejos = 0;
  Object.keys(enHistoricos).forEach(function (id) {
    if (id === 'draft') return;
    var esNuevo = Object.keys(enManifiesto).indexOf(id) >= 0;
    if (esNuevo) return;
    snapshotsViejos += 1;
    filasViejas += enHistoricos[id];
  });
  log('   filas totales en PLANES_HISTORICOS: ' + totalHistoricas);
  log('   snapshots en la hoja que NO estan en el manifiesto: ' + snapshotsViejos
    + '  (' + filasViejas + ' filas)');
  if (snapshotsViejos) {
    log('   Esas filas no se ven desde el selector de versiones, porque ahi solo llegan los del');
    log('   manifiesto. No se propone borrarlas: son la unica traza de un plan que se publico.');
    log('   Solo se mide para saber cuanto pesan.');
  }
  log('');

  // ------------------------------------------------------------------------- 6. veredicto
  log('6) VEREDICTO:');
  if (sinFilas.length) {
    log('   HAY ' + sinFilas.length + ' ORIGEN(S) SIN PLAN REAL DEBAJO. Si tambien estan en el');
    log('   manifiesto, el manifiesto esta rancio y el "0 huerfanos" de CUENTA_ORIGINS fue un');
    log('   falso verde. Esos origins son filas de estado sin plan: se pueden podar.');
  } else {
    log('   Los ' + Object.keys(porOrigin).length + ' origins tienen plan real debajo. Los 308 KB son');
    log('   de planes que EXISTEN, y podarlos SI perderia el registro de que operaciones se');
    log('   completaron en cada plan publicado. Esa es una decision de negocio, no un bug.');
  }
  if (rancio.length) {
    log('');
    log('   ADEMAS: el manifiesto lista ' + rancio.length + ' snapshot(s) sin una sola fila. Eso es');
    log('   basura acumulada y explica por que hay 124 entradas. No es lo que pido la pregunta');
    log('   original, pero es la razon de que 124 no cuadre con "uno por semana".');
  }
  if (sinSemana) {
    log('');
    log('   Y hay ' + sinSemana + ' entradas SIN semana, que la poda no puede borrar por la linea');
    log('   que tiene. Es un agujero concrete, no una hipotesis: se lee en el codigo.');
  }
  log('');
  log('   LO QUE ESTA SONDA NO DICE, Y HAY QUE DECIRLO: no propone borrar nada. Medir el peso');
  log('   de un snapshot viejo no es una razon para borrarlo, y borrar un plan publicado es una');
  log('   decision de la persona, no del codigo.');
}
