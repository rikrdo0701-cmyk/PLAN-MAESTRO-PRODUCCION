/**
 * DESALINEA_ARTICULO - lee las CELDAS CRUDAS de CONFIGURACION_ARTICULO para confirmar si la
 * fila de datos quedo desalineada respecto al encabezado.
 *
 * POR QUE. PP_SHEETS.CONFIGURACION_ARTICULO tiene 6 columnas
 * (ARTICULO, TIPO_OT, TIPO_TRABAJO, PRECIO_MANUAL, PRECIO_REF_VENTA, ACTUALIZADO) desde
 * RULE-REP-021 (2.45.0). PP_ensureWorkbook_ (02-storage.js:71-76) compara el encabezado
 * existente con PP_SHEETS y, si no cuadra, reescribe SOLO la fila 1 con
 * sheet.getRange(1,1,1,headers.length).setValues([headers]): no hace clearContents y no
 * toca las filas de datos. Al crecer el encabezado de 5 a 6 columnas, la fila de datos
 * conservo su ACTUALIZADO viejo en la columna E, que paso a llamarse PRECIO_REF_VENTA, y la
 * columna F, que ahora es ACTUALIZADO, quedo vacia.
 *
 * PP_readRows_ (02-storage.js:855-862) mapea por indice de encabezado, asi que ese corrimiento
 * se propaga: PRECIO_REF_VENTA lee una fecha y ACTUALIZADO lee vacio. Eso explica que
 * VERIFICA_REFERENCIAS reporte 0 de 230 con PRECIO_REF_VENTA y 0 de 230 con ACTUALIZADO.
 *
 * QUE DEVUELVE. Las 8 celdas crudas del encabezado y de las primeras filas de datos, tal
 * cual, sin interpretar. Con eso se ve el corrimiento sin tener que creerle a nadie.
 * Ademas devuelve la revision de CONFIG y la del cache de estado, para saber si el estado que
 * lee la app puede estar viejos.
 *
 * SOLO LECTURA. No escribe ninguna celda, no toca CONFIG y NO llama a syncNetSuiteWorkOrdersLite
 * ni a syncNetSuiteData (que podan la cola y escriben en la hoja). NO gasta UrlFetch: usa
 * SpreadsheetApp, que es nativo.
 */
function DESALINEA_ARTICULO() {
  var log = function (m) { Logger.log(String(m)); };
  var fallos = 0;

  var NOMBRE = 'CONFIGURACION_ARTICULO';
  var sheet = null;
  try {
    sheet = SpreadsheetApp.openById('1iLG8aRuVPhYQ9e-1SVrD79k22ZV5zo111MIC08hF8D0').getSheetByName(NOMBRE);
  } catch (e1) {
    log('no se pudo abrir la hoja: ' + String(e1 && e1.message || e1));
    return;
  }
  if (!sheet) { log('la hoja no tiene ' + NOMBRE); return; }

  var columnas = sheet.getLastColumn();
  var filas = sheet.getLastRow();
  log('1) ' + NOMBRE + ': ' + Math.max(0, filas - 1) + ' filas de datos, ' + columnas + ' columnas usadas');
  log('');

  // Encabezado crudo, celda por celda. getDisplayValues da texto, que es lo que ve un humano.
  var encabezado = sheet.getRange(1, 1, 1, columnas).getDisplayValues()[0];
  log('   COL  ENCABEZADO (lo que cree el codigo que hay en cada columna)');
  for (var c = 0; c < columnas; c += 1) {
    var letra = c < 26 ? String.fromCharCode(65 + c) : ('A' + String.fromCharCode(65 + c - 26));
    log('   ' + letra + '   ' + (encabezado[c] === '' ? '(vacia)' : encabezado[c]));
  }

  // Primeras filas crudas. Se muestran todas las columnas, para que se vea donde esta cada
  // valor de verdad.
  var n = Math.min(5, Math.max(0, filas - 1));
  log('');
  log('2) LAS ' + n + ' PRIMERAS FILAS DE DATOS, celda por celda:');
  var datos = n > 0 ? sheet.getRange(2, 1, n, columnas).getDisplayValues() : [];
  for (var f = 0; f < datos.length; f += 1) {
    log('   fila ' + (f + 2) + ':');
    for (var c2 = 0; c2 < columnas; c2 += 1) {
      var v = datos[f][c2];
      log('      ' + (String.fromCharCode(65 + c2)) + ' (' + (encabezado[c2] || '?') + ') = ' + (v === '' ? '(vacia)' : v));
    }
  }

  // El diagnostico: donde hay una fecha que deberia ser ACTUALIZADO y donde hay un ACTUALIZADO
  // que quedo vacio.
  log('');
  log('3) DIAGNOSTICO DE CORRIMIENTO:');
  var iRef = -1;
  var iAct = -1;
  for (var c3 = 0; c3 < columnas; c3 += 1) {
    var h = String(encabezado[c3] || '').trim().toUpperCase();
    if (h === 'PRECIO_REF_VENTA') iRef = c3;
    if (h === 'ACTUALIZADO') iAct = c3;
  }
  log('   PRECIO_REF_VENTA esta en la indice ' + iRef + ' (columna ' + String.fromCharCode(65 + (iRef < 0 ? 0 : iRef)) + ')');
  log('   ACTUALIZADO esta en el indice ' + iAct + ' (columna ' + String.fromCharCode(65 + (iAct < 0 ? 0 : iAct)) + ')');

  var fechasEnRef = 0;
  var fechasEnAct = 0;
  var conActVacia = 0;
  var filasTotales = 0;
  if (n > 0) {
    var todas = sheet.getRange(2, 1, filas - 1, columnas).getDisplayValues();
    for (var f2 = 0; f2 < todas.length; f2 += 1) {
      var fila = todas[f2] || [];
      if (!fila.join('')) continue;   // fila totalmente vacia: no cuenta
      filasTotales += 1;
      var vRef = iRef >= 0 ? String(fila[iRef] || '').trim() : '';
      var vAct = iAct >= 0 ? String(fila[iAct] || '').trim() : '';
      if (/\d{4}-\d{2}-\d{2}/.test(vRef)) fechasEnRef += 1;
      if (/\d{4}-\d{2}-\d{2}/.test(vAct)) fechasEnAct += 1;
      if (!vAct) conActVacia += 1;
    }
  }
  log('   filas con datos: ' + filasTotales);
  log('   fechas en la columna PRECIO_REF_VENTA : ' + fechasEnRef + '   <- si > 0, hay un corrimiento');
  log('   fechas en la columna ACTUALIZADO      : ' + fechasEnAct);
  log('   filas con ACTUALIZADO vacio           : ' + conActVacia);

  if (fechasEnRef > 0 && fechasEnAct === 0) {
    log('');
    log('   CONFIRMADO: hay fechas donde deberia haber PRECIO_REF_VENTA y ninguna donde deberia');
    log('   estar ACTUALIZADO. El encabezado sereescribio (PP_ensureWorkbook_ solo toca la fila 1)');
    log('   pero las filas de datos no se movieron. La columna nueva NULO es un desplazamiento.');
    log('   Lo que el codigo lee hoy: PRECIO_REF_VENTA = Number(fecha) = NaN -> 0, y');
    log('   ACTUALIZADO = vacio. Las fechas NO estan perdidas: siguen ahi, en la columna');
    log('   equivocada, y se pueden recuperar antes de que un guardado las pise.');
    fallos += 1;
  } else if (fechasEnAct > 0) {
    log('');
    log('   BIEN: las fechas estan en la columna ACTUALIZADO, o sea que no hay corrimiento.');
    log('   Si PRECIO_REF_VENTA esta en 0, la causa es otra: el sync no ha escrito todavia.');
  } else {
    log('');
    log('   INCONCLUYENTE: no hay fechas en ninguna de las dos columnas. Puede que la columna');
    log('   ACTUALIZADO nunca haya tenido dato, o que este shiftado a una columna mayor.');
    log('   Revisa a mano el punto 2.');
  }

  // Estado de la revision: si el estado que lee la app puede estar viejo.
  log('');
  log('4) REVISION (para saber si el estado que lee la app puede estar atrasado):');
  try {
    var config = {};
    var filasConfig = SpreadsheetApp.openById('1iLG8aRuVPhYQ9e-1SVrD79k22ZV5zo111MIC08hF8D0')
      .getSheetByName('CONFIG').getDataRange().getDisplayValues();
    for (var q = 1; q < filasConfig.length; q += 1) {
      config[String(filasConfig[q][0] || '').trim()] = String(filasConfig[q][1] || '').trim();
    }
    log('   CONFIG.revision                   = ' + config.revision);
    log('   CONFIG.savedAt                    = ' + config.savedAt);
    log('   CONFIG.PP_STATE_CACHE_REVISION    = ' + config.PP_STATE_CACHE_REVISION);
    if (config.PP_STATE_CACHE_REVISION === config.revision) {
      log('   -> el cache de estado esta AL DIA con la revision.');
    } else {
      log('   -> el cache de estado esta DESFASADO. La app lee un estado viejo hasta que algo');
      log('      lo regenere. Eso puede explicar que veas 0 donde la hoja si tiene dato.');
    }
  } catch (e4) {
    log('   no se pudo leer CONFIG: ' + String(e4 && e4.message || e4));
  }

  log('');
  if (fallos) {
    log('DESALINEA_ARTICULO: CORRIMIENTO CONFIRMADO. Revisa el punto 3.');
  } else if (fechasEnAct > 0) {
    log('DESALINEA_ARTICULO: NO hay corrimiento. Las columnas estan alineadas.');
  } else {
    log('DESALINEA_ARTICULO: no se pudo determinar. Revisa el punto 2 a mano.');
  }
}
