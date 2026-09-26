/**
 * VERIFICA_CIERRE_OT - comprueba que la confirmacion de cierre contra NetSuite funciona de
 * verdad, folio por folio (RULE-OT-051).
 *
 * POR QUE HACE FALTA UNA SONDA Y NO BASTA CON MIRAR EL ESTADO. El mecanismo solo pregunta
 * cuando hay OTs por confirmar, y ahora mismo no hay ninguna: unconfirmedWorkOrders viene
 * vacio, asi que la app no gasta ni una llamada y no se puede observar nada. Un mecanismo que
 * no se ejercita no esta verificado, solo presente.
 *
 * QUE COMPRUEBA, Y POR QUE ES DECISIVO. La duda real es si el 2244 que se subio a NetSuite
 * devuelve el estatus de la OT. Si no lo devuelve, el servidor responde closed:false para
 * todo y no se poda nada: un estado degradado SEGURO, pero que no cumple la regla. Esta sonda
 * lo separan:
 *   1. Que la llamada al servidor exista y responda.
 *   2. Que las OTs del RESUMEN DE CERRADAS (las 17 del 2026-09-23) aparezcan como como
 *      found:true y closed:true, con un estatus real de NetSuite. Si NetSuite dice que estan
 *      cerradas, queda confirmado que la fuente funciona Y que esas 17 si estaban cerradas.
 *   3. Que unas cuantas OTs que hoy estan ABIERTAS en el plan aparezcan como found:true y
 *      closed:false. Esto es el control negativo: si tambien salieran closed:true, el
 *      clasificador estaria cerrando de mas, que es peor que no cerrar.
 *   4. Que el limite de 20 folios por pasada se respete.
 *
 * LO QUE NO HACE. No escribe ninguna celda, no poda ninguna OT, no toca CONFIG y NO llama a
 * syncNetSuiteWorkOrdersLite ni a syncNetSuiteData (que podan la cola del plan y escriben en
 * la hoja). Solo LEE de NetSuite a traves de confirmWorkOrderClosures.
 *
 * CUANTO GASTA. confirmWorkOrderClosures hace una llamada al 2244 por folio, con tope de 20 por
 * pasada. Esta sonda hace dos pasadas: una de hasta 5 folios y otra de 3, o sea hasta 8
 * llamadas, contra la cuota de 20 000/dia. Es poco, pero no es gratis: si NetSuite responde con
 * el limite de solicitudes, la sonda lo avisa en vez de reintentar.
 */
function VERIFICA_CIERRE_OT() {
  var log = function (m) { Logger.log(String(m)); };
  var fallos = 0;
  var norm = function (v) {
    return String(v === undefined || v === null ? '' : v).trim().toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  };

  // ------------------------------------------------------------ 1. que el fix esta desplegado
  try {
    var status = getDeploymentStatus();
    var v = String(status && status.appVersion || '0');
    var partes = v.split('.');
    var major = parseInt(partes[0], 10) || 0;
    var minor = parseInt(partes[1], 10) || 0;
    log('1) deployment: appVersion=' + v + ' schemaVersion=' + String(status && status.schemaVersion)
      + ' netSuite=' + String(status && status.netSuiteConfigured));
    if (!(major > 2 || (major === 2 && minor >= 49))) {
      log('   FALLA: RULE-OT-051 no esta desplegado (hace falta 2.49.0). Sin el, el 2244 no se');
      log('          consulta y la confirmacion no existe.');
      return;
    }
    log('   bien: el fix esta desplegado.');
  } catch (e1) {
    log('1) deployment -> EXCEPCION ' + String(e1 && e1.message || e1));
    return;
  }

  if (typeof confirmWorkOrderClosures !== 'function') {
    log('   FALLA: no existe la funcion confirmWorkOrderClosures en el servidor.');
    return;
  }

  // ------------------------------------- 2. los folios de las OTs que ya foram marcadas como cerradas
  var resumenes = {};
  try {
    var config = {};
    var filas = SpreadsheetApp.openById('1iLG8aRuVPhYQ9e-1SVrD79k22ZV5zo111MIC08hF8D0')
      .getSheetByName('CONFIG').getDataRange().getDisplayValues();
    for (var q = 1; q < filas.length; q += 1) {
      config[String(filas[q][0] || '').trim()] = String(filas[q][1] || '').trim();
    }
    resumenes = JSON.parse(config.closedWorkOrderSummaries || '{}');
  } catch (e2) {
    log('2) no se pudo leer closedWorkOrderSummaries de CONFIG: ' + String(e2 && e2.message || e2));
    log('   Sigo: la parte 3 no necesita esa lista.');
  }
  var cerradas = Object.keys(resumenes).map(function (k) {
    return String((resumenes[k] && resumenes[k].ot) || k).trim();
  }).filter(Boolean);
  log('');
  log('2) OTs EN closedWorkOrderSummaries (cerradas el 2026-09-23): ' + cerradas.length);
  if (cerradas.length) log('   ' + cerradas.slice(0, 8).join(', ') + (cerradas.length > 8 ? ' ...' : ''));

  // ------------------------------------------------------------------ 3. control negativo
  // unas cuantas OTs que el plan tiene ABIERTAS ahora. Deben salir closed:false.
  var estado = null;
  try {
    estado = getAppStateIfChanged(0, { includeMaterials: false });
  } catch (e3) {
    log('3) no se pudo leer el estado: ' + String(e3 && e3.message || e3));
  }
  var abiertas = [];
  if (estado && estado.workOrders) {
    var wos = estado.workOrders;
    for (var w = 0; w < wos.length && abiertas.length < 3; w += 1) {
      var ot = String((wos[w] && wos[w].ot) || '').trim();
      if (ot && cerradas.indexOf(ot) < 0) abiertas.push(ot);
    }
  }
  log('   OTs abiertas que se van a comprobar como control negativo: ' + (abiertas.length ? abiertas.join(', ') : '(ninguna)'));

  // ------------------------------------------------------------------- 4. la consulta
  var folios = cerradas.slice(0, 5).concat(abiertas.slice(0, 3));
  if (!folios.length) {
    log('');
    log('   FALLA: no hay ningun folio para comprobar. No se puede verificar nada.');
    return;
  }
  log('');
  log('3) PREGUNTANDO A NETSUITE, ' + folios.length + ' folios de uno en uno:');
  var respuesta = null;
  try {
    respuesta = confirmWorkOrderClosures(folios);
  } catch (e4) {
    log('   EXCEPCION ' + String(e4 && e4.message || e4));
    log('');
    log('   Si dice "Failed to parse SQL" o "Cannot build builtin function", el 2244 que se');
    log('   subio todavia no trae el estatus, o el BUILTIN.DF no funciona sobre transaction.');
    log('   Si dice lo del limite de solicitudes, la cuota de UrlFetch esta agotada.');
    return;
  }

  var results = (respuesta && respuesta.results) || {};
  var claves = Object.keys(results);
  log('   consulted=' + String(respuesta && respuesta.asked) + ' omitidos=' + String(respuesta && respuesta.omitted)
    + ' truncado=' + String(respuesta && respuesta.truncated));
  log('');
  log('   folio        encontrada  estatus de NetSuite              closed');
  var conEstatus = 0;
  var cerradasConfirmadas = 0;
  var abiertasConfirmadas = 0;
  var sinEstatus = 0;
  for (var i = 0; i < claves.length; i += 1) {
    var clave = claves[i];
    var item = results[clave] || {};
    var est = String(item.status || '').trim();
    if (est) conEstatus += 1; else sinEstatus += 1;
    if (item.closed) cerradasConfirmadas += 1;
    if (item.found && !item.closed) abiertasConfirmadas += 1;
    log('   ' + String(item.ot || clave).padEnd(13) + '  ' + String(Boolean(item.found)).padEnd(11)
      + (est || '(vacio)').padEnd(31) + '  ' + String(Boolean(item.closed))
      + (item.error ? '   ERROR: ' + String(item.error).slice(0, 60) : ''));
  }

  // ------------------------------------------------------------------ 5. el veredicto
  function resultadosPorFolio(ot) {
    var objetivo = norm(ot);
    for (var c = 0; c < claves.length; c += 1) {
      var item = results[claves[c]] || {};
      if (norm(item.ot || claves[c]) === objetivo) return item;
    }
    return null;
  }

  log('');
  log('4) VEREDICTO:');
  if (sinEstatus === claves.length && claves.length > 0) {
    log('   FALLA: NINGUNA OT volvio con estatus. O el 2244 que subiste todavia no devuelve');
    log('          resultados.estatus, o la columna no llega. Con esto la app NO puede podar');
    log('          ninguna OT, que es seguro pero incumple la regla.');
    fallos += 1;
  } else if (conEstatus === 0) {
    log('   FALLA: ningun estatus vino de NetSuite.');
    fallos += 1;
  } else {
    log('   bien: ' + conEstatus + ' de ' + claves.length + ' folio(s) volvieron con estatus REAL de NetSuite.');
  }

  if (cerradas.length) {
    // Cada OT del resumen se juzga por separado. Antes se daba el caso por bueno con una sola
    // confirmada, y las que NetSuite NO conocia quedaban sin reportar, que es justo lo que hay
    // que saber: una OT que el resumen da por cerrada y NetSuite no encuentra, o fue borrada o
    // esta en otra planta o el folio no es el que creiamos.
    var noEncontradas = [];
    var noCerradas = [];
    cerradas.forEach(function (ot) {
      var item = resultadosPorFolio(ot);
      if (!item) { noEncontradas.push(ot + ' (no vino en la respuesta)'); return; }
      if (!item.found) { noEncontradas.push(ot); return; }
      if (!item.closed) noCerradas.push(ot + ' (NetSuite dice "' + String(item.status || '?') + '")');
    });
    if (cerradasConfirmadas > 0) {
      log('   bien: ' + cerradasConfirmadas + ' de las ' + cerradas.length + ' OTs del resumen');
      log('         quedaron CONFIRMADAS como cerradas por NetSuite. La fuente funciona, y esas');
      log('         si estaban cerradas: no hay que resucitarlas.');
    }
    if (noEncontradas.length) {
      log('   FALLA: ' + noEncontradas.length + ' OT(s) del resumen de cerradas NetSuite NO las');
      log('   encuentra: ' + noEncontradas.join(', '));
      log('   found:false NO es cierre. Puede estar borrada, estar en otra planta, o el folio');
      log('   guardado no ser el de NetSuite. Hay que revisarlas a mano; la app NO las podaria.');
      fallos += 1;
    }
    if (noCerradas.length) {
      log('   ATENCION: ' + noCerradas.length + ' OT(s) del resumen NetSuite las encuentra pero NO');
      log('   las da por cerradas: ' + noCerradas.join(', '));
      log('   O el resumen se equivoco, o el estatus no es CERRAD/CLOSED/COMPLET/CANCELAD.');
      fallos += 1;
    }
    if (!cerradasConfirmadas && !noEncontradas.length && !noCerradas.length) {
      log('   ATENCION: de las ' + cerradas.length + ' OTs del resumen no volvio ninguna. No se');
      log('   puede afirmar nada de ellas.');
      fallos += 1;
    }
  }

  // El control negativo solo juzga a las OTs abiertas que VOLVIERON en la respuesta. Si el
  // servidor no trajo una, no es evidencia de que la haya cerrado: no se sabe nada de ella, y
  // contarla como fallo de "cierra de mas" seria un falso positivo que esconde el fallo real.
  var abiertasRespondidas = abiertas.filter(function (ot) {
    return claves.some(function (clave) { return norm(results[clave] && results[clave].ot) === norm(ot); });
  });
  var abiertasCerradasPorError = abiertasRespondidas.filter(function (ot) {
    var item = resultadosPorFolio(ot);
    return item && item.closed;
  });
  if (abiertasCerradasPorError.length) {
    log('   FALLA: ' + abiertasCerradasPorError.length + ' OT(s) que el plan tiene ABIERTAS');
    log('   salieron como cerradas: ' + abiertasCerradasPorError.join(', '));
    log('   Si NetSuite no dice CERRAD/CLOSED/COMPLET/CANCELAD, el clasificador esta CERRANDO');
    log('   DE MAS, que es peor que no cerrar.');
    fallos += 1;
  } else if (abiertasRespondidas.length) {
    log('   bien: las ' + abiertasRespondidas.length + ' OTs abiertas del plan salieron');
    log('         found:true y closed:false. Ese es el control negativo: el mecanismo no cierra');
    log('         lo que sigue abierto.');
    if (abiertasRespondidas.length < abiertas.length) {
      log('   nota: de las ' + abiertas.length + ' abiertas, ' + (abiertas.length - abiertasRespondidas.length)
        + ' no vinieron en la respuesta; de esas no se puede afirmar nada.');
    }
  } else if (abiertas.length) {
    log('   FALLA: se pidieron ' + abiertas.length + ' OTs abiertas y no vino NINGUNA en la');
    log('   respuesta. La fuente no esta contestando.');
    fallos += 1;
  }

  log('');
  log(fallos
    ? 'VERIFICA_CIERRE_OT: ' + fallos + ' problema(s). Revisa el punto 4.'
    : 'VERIFICA_CIERRE_OT: la confirmacion contra NetSuite funciona. RULE-OT-051 verificada.');
}
