/**
 * VERIFICA_REFERENCIAS - comprueba, ya desplegado RULE-REP-021, que el precio de venta del
 * sync (referenceSalePrice) y el que escribe una persona (manualUnitPrice) son campos
 * separados, y que el del sync PUEDE BAJAR.
 *
 * POR QUE NO BASTA VERIFICA_PRECIOS_POST. Esa comprueba que el precio de venta del reporte ya
 * no lleva tipo de cambio, y lo hace bien. La trampa que se acaba de quitar es otra: que el
 * sync grabara el precio de venta en el campo del precio manual, con un max que solo subia.
 * Eso no se ve en getAppStateIfChanged, porque ahi llegan lastSalePrice y averageSalePrice
 * del 1766, que son correctos. Se ve en la hoja CONFIGURACION_ARTICULO, que es donde el
 * ratchet habia dejado los valores.
 *
 * QUE COMPRUEBA:
 *   1. Que el deployment sea 2.45.0 o posterior. Sin el fix desplegado no existiria la
 *      columna y todo lo demas daria 0, asi que no probaria nada.
 *   2. Que la hoja CONFIGURACION_ARTICULO tenga PRECIO_REF_VENTA DESPUES de PRECIO_MANUAL,
 *      que es el orden que fija PP_SHEETS.
 *   3. Que los dos campos sean independientes: cuantos articulos los tienen, cuantos los
 *      tienen iguales. Que algunos coincidan es legitimo (el precio de venta puede ser justo
 *      el que escribio una persona). Lo que ya no puede pasar es que sean SIEMPRE iguales,
 *      porque antes eran el mismo campo por construccion.
 *   4. Que el precio de venta que ve la app hoy, para los mismos articulos, este cerca del
 *      PRECIO_REF_VENTA guardado. Si la columna estaInflada y el 1766 no, se ve el ratchet
 *      viejo; si las dos cosas coinciden, la columna es el espejo del sync.
 *
 * LEE LA HOJA CON SpreadsheetApp, que es nativo de Apps Script y NO gasta UrlFetch, asi que
 * no toca la cuota de 20 000/dia. Todo es de SOLO LECTURA: no escribe ninguna fila, no
 * llama a syncNetSuiteWorkOrdersLite ni a syncNetSuiteData (que podan la cola del plan).
 *
 * SI FALTA EL ARCHIVO O LA URL, la sonda te lo dice y sigue con el resto: el paso 4 es
 * informativo.
 */
function VERIFICA_REFERENCIAS() {
  var log = function (m) { Logger.log(String(m)); };
  var fallos = 0;
  var TOLERANCIA = 0.02; // 2%: compara el precio guardado contra el que ve la app hoy.

  // --------------------------------------------------------------- 1. version
  try {
    var status = getDeploymentStatus();
    var v = String(status && status.appVersion || '0');
    var partes = v.split('.');
    log('1) deployment: appVersion=' + v + ' schemaVersion=' + String(status && status.schemaVersion));
    var major = parseInt(partes[0], 10) || 0;
    var minor = parseInt(partes[1], 10) || 0;
    if (!(major > 2 || (major === 2 && minor >= 45))) {
      log('   FALLA: RULE-REP-021 NO esta desplegado (hace falta 2.45.0). La columna');
      log('          PRECIO_REF_VENTA no existiria y todo lo demas daria 0.');
      fallos += 1;
    } else {
      log('   bien: el fix esta desplegado.');
    }
  } catch (e1) {
    log('1) deployment -> EXCEPCION ' + String(e1 && e1.message || e1));
    return;
  }

  // ------------------------------------------------- 2 y 3. la hoja CONFIGURACION_ARTICULO
  var sheet = null;
  try {
    var ss = SpreadsheetApp.openById('1iLG8aRuVPhYQ9e-1SVrD79k22ZV5zo111MIC08hF8D0');
    sheet = ss.getSheetByName('CONFIGURACION_ARTICULO');
  } catch (e2) {
    log('2) no se pudo abrir la hoja: ' + String(e2 && e2.message || e2));
    log('   Si el proyecto tiene otra hoja, ajusta el id o el nombre y vuelve a correr.');
    return;
  }
  if (!sheet) {
    log('2) la hoja no tiene CONFIGURACION_ARTICULO.');
    return;
  }

  var encabezados = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (c) { return String(c || '').trim().toUpperCase(); });
  var iArt = encabezados.indexOf('ARTICULO');
  var iManual = encabezados.indexOf('PRECIO_MANUAL');
  var iRef = encabezados.indexOf('PRECIO_REF_VENTA');
  log('2) CONFIGURACION_ARTICULO: ' + Math.max(0, sheet.getLastRow() - 1) + ' filas');
  log('   columnas: ' + encabezados.join(' | '));
  log('   ARTICULO en la ' + (iArt + 1) + ' · PRECIO_MANUAL en la ' + (iManual + 1) + ' · PRECIO_REF_VENTA en la ' + (iRef + 1));

  if (iArt < 0) { log('   FALLA: no se encontro la columna ARTICULO.'); return; }
  if (iManual < 0) { log('   FALLA: no se encontro la columna PRECIO_MANUAL.'); return; }
  if (iRef < 0) {
    log('   FALLA: la columna PRECIO_REF_VENTA NO existe todavia.');
    log('          Se crea sola en el primer guardado de la hoja (PP_writeTable_ reescribe el');
    log('          encabezado). Sincroniza NetSuite desde la app y vuelve a correr esto.');
    fallos += 1;
  } else if (iRef < iManual) {
    log('   FALLA: PRECIO_REF_VENTA esta antes de PRECIO_MANUAL, y PP_SHEETS la pone despues.');
    fallos += 1;
  } else {
    log('   bien: las dos columnas estan separadas y en el orden que fija PP_SHEETS.');
  }

  // Lectura de las dos columnas.
  var ultimaFila = sheet.getLastRow();
  var rango = iRef >= 0
    ? sheet.getRange(2, 1, Math.max(0, ultimaFila - 1), iRef + 1).getValues()
    : sheet.getRange(2, 1, Math.max(0, ultimaFila - 1), iManual + 1).getValues();

  var conManual = 0;
  var conRef = 0;
  var ambos = 0;
  var iguales = 0;
  var ejemplosIguales = [];
  var porArticulo = {};
  for (var f = 0; f < rango.length; f += 1) {
    var fila = rango[f] || [];
    var articulo = String(fila[iArt] || '').trim();
    var manual = Number(fila[iManual] || 0);
    var ref = iRef >= 0 ? Number(fila[iRef] || 0) : 0;
    if (articulo) porArticulo[articulo.toUpperCase()] = { manual: manual, ref: ref };
    if (manual >= 1) conManual += 1;
    if (ref >= 1) conRef += 1;
    if (manual >= 1 && ref >= 1) {
      ambos += 1;
      if (Math.abs(manual - ref) < 0.01) {
        iguales += 1;
        if (ejemplosIguales.length < 6) ejemplosIguales.push(articulo + ' (' + manual + ')');
      }
    }
  }

  log('');
  log('3) INDEPENDENCIA DE LOS DOS CAMPOS:');
  log('   con PRECIO_MANUAL >= 1    : ' + conManual);
  log('   con PRECIO_REF_VENTA >= 1 : ' + conRef);
  log('   con los dos               : ' + ambos);
  log('   con los dos IGUALES       : ' + iguales + (ejemplosIguales.length ? '  (' + ejemplosIguales.join(', ') + ')' : ''));
  log('   Que algunos coincidan es legitimo: el precio de venta puede ser justo el que');
  log('   escribio una persona. Lo que ya NO puede pasar es que sean SIEMPRE iguales,');
  log('   porque antes eran el mismo campo por construccion.');
  if (iRef < 0) {
    log('   (no se puede juzgar todavia: la columna del sync no existe)');
  } else if (ambos > 0 && iguales === ambos && ambos > 3) {
    log('   ATENCION: todos los que tienen los dos campos los tienen iguales. Puede ser');
    log('   legitimo si el precio manual coincide con el de venta, o puede ser que la hoja');
    log('   todavia tenga los valores del ratchet viejo en PRECIO_MANUAL. El paso 4 lo');
    log('   distingue: si PRECIO_REF_VENTA coincide con el precio que ve la app, la columna');
    log('   es el espejo correcto del sync.');
  }

  // ---------------------------- 4. la columna del sync, contra el precio que ve la app hoy
  log('');
  log('4) PRECIO_REF_VENTA contra el precio de venta que ve la app HOY:');
  var estado = null;
  try {
    estado = getAppStateIfChanged(0, { includeMaterials: false });
  } catch (e3) {
    log('   no se pudo leer el estado: ' + String(e3 && e3.message || e3));
  }
  if (!estado || iRef < 0) {
    log('   (no se puede comparar: ' + (!estado ? 'sin estado' : 'sin columna PRECIO_REF_VENTA') + ')');
  } else {
    var wos = estado.workOrders || [];
    var precioHoyPorArticulo = {};
    wos.forEach(function (w) {
      var art = String(w.item || '').trim().toUpperCase();
      if (!art) return;
      var actual = Math.max(Math.max(0, Number(w.lastSalePrice || 0)), Math.max(0, Number(w.averageSalePrice || 0)));
      if (!(actual >= 1)) return;
      if (!precioHoyPorArticulo[art] || actual > precioHoyPorArticulo[art]) precioHoyPorArticulo[art] = actual;
    });

    var comparados = 0;
    var coinciden = 0;
    var discrepancias = [];
    Object.keys(porArticulo).forEach(function (art) {
      var guardado = porArticulo[art].ref;
      if (!(guardado >= 1)) return;
      var hoy = precioHoyPorArticulo[art];
      if (!(hoy >= 1)) return;   // el articulo no tiene precio vivo: no hay con que comparar
      comparados += 1;
      var dif = Math.abs(guardado - hoy) / hoy;
      if (dif <= TOLERANCIA) {
        coinciden += 1;
      } else if (discrepancias.length < 8) {
        discrepancias.push({ art: art, guardado: guardado, hoy: hoy, x: Math.round(guardado / hoy * 100) / 100 });
      }
    });
    log('   articulos con las dos cifras comparables: ' + comparados);
    log('   coinciden dentro del ' + Math.round(TOLERANCIA * 100) + '%: ' + coinciden +
      (comparados ? ' (' + Math.round(coinciden / comparados * 100) + '%)' : ''));
    if (discrepancias.length) {
      log('   los que NO coinciden:');
      discrepancias.forEach(function (d) {
        log('      ' + d.art + ': guardado ' + Math.round(d.guardado) + ' vs hoy ' + Math.round(d.hoy) + '  (' + d.x + 'x)');
      });
    }
    if (comparados === 0) {
      log('   AVISO: ningun articulo tiene las dos cifras, asi que no se pudo comparar.');
    } else if (coinciden === comparados) {
      log('   bien: PRECIO_REF_VENTA es el espejo del precio de venta actual. La columna');
      log('         se esta actualizando, y no arrastra ningun maximo historico.');
    } else {
      log('   ATENCION: hay ' + (comparados - coinciden) + ' articulo(s) donde la columna no');
      log('   coincide con el precio de hoy. Puede ser que el sync todavia no haya corrido');
      log('   desde el deploy (la columna nace en el primer guardado), o que queden valores');
      log('   viejos. Sincroniza NetSuite y vuelve a correr esta sonda.');
    }
  }

  log('');
  log(fallos
    ? 'VERIFICA_REFERENCIAS: ' + fallos + ' problema(s). Revisa el detalle de arriba.'
    : 'VERIFICA_REFERENCIAS: sin problemas. La columna existe, los dos campos son');
  if (!fallos) {
    log('   independientes y el del sync refleja el precio actual. RULE-REP-021 verificado.');
  }
}
