/**
 * LISTA_TODAS_2244 - responde si el 2244 puede ser la fuente del estado de la OT, que es la otra
 * mitad de lo que pidio el usuario: "para estado de OT esta el restlet 2244 y para operaciones el
 * 2240, o sea ellos te dicen si esta abierto o cerrado".
 *
 * POR QUE ESTA SONDA, Y POR QUE NO SE CAMBIO EL CODIGO A ciegas.
 *
 * HOY EL ESTADO DE LA OT LO MANDA EL 1764, NO EL 2244. En 08-netsuite.js la linea 996 lee el
 * estatus de la fila del 1764 (`PP_pick_(row, ['Estatus', 'Estado', 'Status'])`) y la linea 54
 * pide esa llamada con `onlyOpen: true`. O sea que el filtro de "solo abiertas" se aplica DENTRO
 * de NetSuite: una OT cerrada no llega con estatus cerrado, llega con TODAS LAS DEMAS LINEAS DEL
 * ARCHIVO. Y "no vino en la respuesta" se parece mucho a "se cerro" y a "no existe", y el codigo
 * no puede distinguirlas. De ahi viene TODO el trabajo de RULE-OT-051: las tres capas, las
 * marcas de por confirmar, el guardia de caida masiva y la confirmacion folio por folio. Todo eso
 * existe para protegerse de una ambiguedad que, con la fuente correcta, no hace falta.
 *
 * EL 2244 YA SABE DAR EL ESTADO REAL. Su action `list` (netsuite-restlet-wo-inspeccion.js:117)
 * arma el filtro asi:
 *     if (payload.onlyOpen !== false) { where += " AND UPPER(BUILTIN.DF(t.status)) NOT LIKE '%CLOSED%' ..." }
 * O sea que con `onlyOpen: false` NO mete ese filtro, y entonces devuelve tambien las cerradas.
 * Ademas trae `BUILTIN.DF(t.status) AS estatus`, que es el nombre completo del estatus. Si eso
 * se confirma, el payload de OTs deja de tener ausencias y la ausencia deja de ser un problema.
 *
 * LO QUE ESTA SONDA MIDE, Y POR QUE CADA COSA IMPORTA:
 *   1. Con onlyOpen:false, cuantas filas devuelve y cuantas OTs DISTINTAS son. Si son muchas mas
 *      que las 222 abiertas de ahora, la paginacion tiene que cambiar y hay que saber el numero
 *      antes de tocar PP_RESTLET_PAGE_SIZE_.
 *   2. Que folio conoMOS que esta cerrado aparezca con estatus real. Una sola muestra que el
 *      filtro se apaga de verdad, no que se apagó a medias.
 *   3. Que las ABIERTAS de hoy sigan apareciendo. Si el cambio de solo-abiertas a todas las
 *      filtrara mal, se perderian OTs vivas: ese es el fallo que hay que buscar.
 *   4. Que los campos que el catalogo necesita y el 2244 NO trae (foto, cantidad ensamblada,
 *      fecha de inicio, fecha de vencimiento) se puedan seguir sacando del 1764. Si el 2244
 *      pagara con ellos, se podria dejar de pedir el 1764 para el estado; si no, hacen falta
 *      los dos y hay que unir las listas por folio.
 *   5. Costo: cuantas llamadas hace, porque la cuota es de 20 000 al dia.
 *
 * LO QUE NO HACE. No escribe ninguna celda, no poda ninguna OT, no toca CONFIG, y NO llama a
 * syncNetSuiteWorkOrdersLite ni a syncNetSuiteData. Solo hace `action: 'list'` contra el 2244,
 * que es una lectura. Ademas compara contra lo que el servidor YA tiene, para no depender de
 * ningun numero mio: si la hoja esta vacia, dice que esta vacia y no inventa un total.
 */
function LISTA_TODAS_2244() {
  var log = function (m) { Logger.log(String(m)); };
  var fallos = 0;
  var norm = function (v) {
    return String(v === undefined || v === null ? '' : v).trim().toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  };
  var texto = function (v) { return String(v === undefined || v === null ? '' : v).trim(); };

  // El veredicto vive en una funcion para que TODAS las salidas lo impriman, incluidas las que
  // cortan antes de terminar. Una sonda que muere en la mitad sin decir si sirvio es peor que no
  // tener sonda: quien la corre no sabe si lo que falta es un dato o un fallo.
  var veredicto = function (fallos, llamadas) {
    log('');
    log('COSTO: ' + llamadas + ' llamadas al 2244, contra la cuota de 20 000 al dia.');
    log('');
    if (fallos) {
      log('LISTA_TODAS_2244: HAY ' + fallos + ' cosa(s) que resolver antes de cambiar el origen del estado.');
    } else {
      log('LISTA_TODAS_2244: el 2244 con onlyOpen:false DEVUELVE TODAS LAS OTs CON SU ESTATUS REAL.');
      log('Se puede usar como autoridad del estado de la OT, junto al 2240 para las operaciones.');
      log('Aun asi, hay que leer bien que las abiertas no se pierda ninguna y que las cerradas traigan estatus.');
    }
  };

  log('LISTA_TODAS_2244: el 2244 con onlyOpen:false puede ser la fuente del estado de la OT?');
  log('');

  // ------------------------------------------------------- 1. la llamada, tal cual la haria el servidor
  // Se usa PP_Inspection_restlet_ porque es la MISMA ruta que usa el servidor para el 2244: si
  // esta ruta no funciona, no funciona la del servidor tampoco, y no tiene sentido medir nada mas.
  var soloAbiertas = null;
  var todas = null;
  var llamadas = 0;
  try {
    soloAbiertas = PP_Inspection_restlet_({ action: 'list', pageIndex: 0, pageSize: 2000 });
    llamadas += 1;
    log('1) LISTA CON onlyOpen:true (la de hoy):');
    log('   ok=' + soloAbiertas.ok + '  filas en esta pagina=' + ((soloAbiertas.wos || soloAbiertas.rows || []).length)
      + '  totalRows=' + soloAbiertas.totalRows + '  hasMore=' + soloAbiertas.hasMore);
  } catch (e1) {
    log('   EXCEPCION: ' + String(e1 && e1.message || e1));
    log('');
    log('   FALLA: sin la ruta del servidor no hay nada que medir. Revisa que el 2244 siga');
    log('   desplegado y que el token tenga permiso.');
    return;
  }

  try {
    todas = PP_Inspection_restlet_({ action: 'list', onlyOpen: false, pageIndex: 0, pageSize: 2000 });
    llamadas += 1;
    log('');
    log('2) LISTA CON onlyOpen:false (la que se quiere para el estado):');
    log('   ok=' + todas.ok + '  filas en esta pagina=' + ((todas.wos || todas.rows || []).length)
      + '  totalRows=' + todas.totalRows + '  hasMore=' + todas.hasMore);
  } catch (e2) {
    log('   EXCEPCION: ' + String(e2 && e2.message || e2));
    log('');
    log('   FALLA: el 2244 no acepto onlyOpen:false. Puede ser que la version de NetSuite tenga');
    log('   el 2244 viejo, sin ese camino. En ese caso hay que volver a subirlo.');
    fallos += 1;
    // Se imprime el VEREDICTO igual. Un return temprano sin veredicto es la peor forma de
    // terminar una sonda: el que la corre tiene que leer siSirvió o no, y si la Corrida muere
    // antes del final no hay forma de saber si lo que falta es un dato o un fallo.
    veredicto(fallos, llamadas);
    return;
  }

  var filasTodas = todas.wos || todas.rows || [];
  var filasAbiertas = soloAbiertas.wos || soloAbiertas.rows || [];

  // --------------------------------------------------------------------- 3. cuantas OTs son
  var foliosTodas = {};
  filasTodas.forEach(function (r) { var k = texto(r.wo || r.tranid || r['WO Folio']); if (k) foliosTodas[k] = true; });
  var foliosAbiertas = {};
  filasAbiertas.forEach(function (r) { var k = texto(r.wo || r.tranid || r['WO Folio']); if (k) foliosAbiertas[k] = true; });
  var nTodas = Object.keys(foliosTodas).length;
  var nAbiertas = Object.keys(foliosAbiertas).length;

  log('');
  log('3) CUANTAS OTs DISTINTAS VIENEN:');
  log('   solo abiertas (onlyOpen:true)  : ' + nAbiertas);
  log('   todas (onlyOpen:false)          : ' + nTodas);
  log('   la diferencia son CERRADAS O CANCELADAS: ' + (nTodas - nAbiertas));
  if (todas.hasMore) {
    log('   AVISO: hay mas paginas (hasMore=true). Este numero es un MINIMO, no el total.');
    log('   Para el codigo habria que paginar hasta el final y medir cuantas paginas son.');
  }

  // ------------------------------------------------------------- 4. los estatus que trae cada una
  var conteo = {};
  filasTodas.forEach(function (r) {
    var e = norm(r.estatus || r.status || r.estado);
    if (!e) e = '(VACIO)';
    conteo[e] = (conteo[e] || 0) + 1;
  });
  log('');
  log('4) ESTATUS QUE DEVUELVE CADA FILA, CON CUANTAS SON:');
  Object.keys(conteo).sort(function (a, b) { return conteo[b] - conteo[a]; }).forEach(function (e) {
    log('   ' + String(conteo[e]).padStart(4) + '  ' + e);
  });
  var sinEstatus = conteo['(VACIO)'] || 0;
  if (sinEstatus > 0) {
    log('');
    log('   ATENCION: ' + sinEstatus + ' filas SIN estatus. Con un estatus vacio el catalogo');
    log('   no puede decir abierta ni cerrada, y vuelve el problema de la ausencia.');
    fallos += 1;
  } else {
    log('');
    log('   bien: NINGUNA fila vino sin estatus. Eso es lo que hace falta para que el estado de');
    log('   la OT sea un dato y no una ausencia.');
  }

  // ------------------------------------------- 5. el control negativo: las abiertas siguen ahi
  log('');
  log('5) CONTROL NEGATIVO: LAS ABIERTAS DE HOY SIGUEN ESTANDO?');
  var perdidas = [];
  Object.keys(foliosAbiertas).forEach(function (k) { if (!foliosTodas[k]) perdidas.push(k); });
  if (!nAbiertas) {
    log('   no hay OTs abiertas en la pagina 1 del 2244, asi que no hay control que hacer.');
    log('   Si la hoja tampoco las tiene, la planta puede estar en Cierre y no hay nada abierto.');
  } else if (perdidas.length) {
    log('   FALLA: ' + perdidas.length + ' OTs que salian con onlyOpen:true NO salen con');
    log('   onlyOpen:false: ' + perdidas.slice(0, 20).join(', ') + (perdidas.length > 20 ? ' ...' : ''));
    log('   Eso seria un filtro mal construido: se perderian OTs VIVAS. Es el fallo que hay que');
    log('   buscar antes de cambiar nada, y el unico modo de encontrarlo es medirlo.');
    fallos += 1;
  } else {
    log('   bien: las ' + nAbiertas + ' OTs abiertas de onlyOpen:true estan TODAS en onlyOpen:false.');
  }

  // ------------------------------------- 6. una cerrada conocida, con su estatus real
  log('');
  log('6) UNA CERRADA CONOCIDA, PARA VER QUE EL FILTRO SE APAGO DE VERDAD:');
  var estadoCerrado = null;
  Object.keys(foliosTodas).forEach(function (k) {
    if (estadoCerrado) return;
    var e = norm((filasTodas.filter(function (r) { return texto(r.wo || r.tranid) === k; })[0] || {}).estatus);
    if (/CERRAD|CLOSED|COMPLET|CANCELAD/.test(e)) estadoCerrado = { folio: k, estatus: e };
  });
  if (estadoCerrado) {
    log('   ' + estadoCerrado.folio + ' -> "' + estadoCerrado.estatus + '"');
    log('   bien: hay filas cerradas CON estatus. El filtro se apaga y el estatus es real.');
  } else {
    log('   ninguna fila cerrada en esta pagina. Puede ser que solo haya abiertas, o que el');
    log('   filtro siga puesto. No se puede distinguir con una pagina: mira el punto 3 y el 4.');
    if (nTodas === nAbiertas) {
      log('   Y ojo: onlyOpen:false trae EXACTAMENTE las mismas que onlyOpen:true. Eso');
      log('   significa que el filtro sigue activo y la version de NetSuite es la vieja.');
      fallos += 1;
    }
  }

  // --------------------------------- 7. los campos que el catalogo necesita y el 2244 no trae
  log('');
  log('7) CAMPOS QUE EL 2244 TRAE, Y QUE LE FALTAN AL CATALOGO:');
  var ej = filasTodas[0] || {};
  log('   el 2244 trae: ' + Object.keys(ej).join(', '));
  var faltan = [];
  if (!('fotoUrl' in ej) && !('Foto URL' in ej)) faltan.push('fotoUrl (hoy sale de Drive, PP_enrichWorkOrderPhotos_)');
  if (!('builtQuantity' in ej) && !('Cantidad ensamblada' in ej)) faltan.push('builtQuantity / pendingQuantity (saldrian del 1764)');
  if (!('startDate' in ej) && !('Fecha inicio programada' in ej)) faltan.push('startDate (saldria del 1764 o de las operaciones del 2240)');
  if (!('dueDate' in ej) && !('Fecha de vencimiento' in ej)) faltan.push('dueDate (saldria del 1764)');
  if (faltan.length) {
    log('   FALTAN:');
    faltan.forEach(function (f) { log('     - ' + f); });
    log('   O sea que el 2244 no puede REEMPLAZAR al 1764 para el catalogo completo. Se puede');
    log('   usar como AUTORIDAD DEL ESTADO (cuales existen y cuales estan cerradas) y seguir');
    log('   Sacando del 1764 los campos que solo el tiene, unidos por folio.');
  } else {
    log('   bien: el 2244 trae todos los campos del catalogo. Se podria dejar de pedir el 1764.');
  }

  // ---------------------------------------------------------------------- 8. contra la hoja
  log('');
  log('8) CONTRA LO QUE EL SERVIDOR YA TIENE EN ORDENES_TRABAJO:');
  var hoja = null;
  try {
    hoja = PP_getWorkbook_().getSheetByName('ORDENES_TRABAJO');
  } catch (e3) {
    log('   no se pudo abrir la hoja: ' + String(e3 && e3.message || e3));
  }
  if (hoja) {
    var enHoja = {};
    PP_readRows_(hoja).forEach(function (row) {
      var k = texto(row.OT);
      if (k) enHoja[k] = true;
    });
    var nHoja = Object.keys(enHoja).length;
    log('   ORDENES_TRABAJO tiene ' + nHoja + ' OTs.');
    if (!nHoja) {
      log('   AVISO: la hoja esta vacia. No hay contra que comparar; los numeros de arriba son');
      log('   la unica medida y hay que leerlos con cuidado.');
    } else {
      var noEnHoja = [];
      Object.keys(foliosAbiertas).forEach(function (k) { if (!enHoja[k]) noEnHoja.push(k); });
      log('   del 2244 (onlyOpen:true) ausentes de la hoja: ' + noEnHoja.length);
      if (noEnHoja.length) {
        log('     ' + noEnHoja.slice(0, 20).join(', ') + (noEnHoja.length > 20 ? ' ...' : ''));
        log('   Si son pocas y la hoja se acaba de guardar, es el retraso normal. Si son muchas,');
        log('   hay que ver POR QUE antes de cambiar el origen del estado.');
      }
    }
  }

  veredicto(fallos, llamadas);
}
