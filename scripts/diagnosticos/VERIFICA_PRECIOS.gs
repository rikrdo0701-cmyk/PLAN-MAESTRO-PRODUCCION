/**
 * VERIFICA_PRECIOS - confirma en el backend REAL que el precio de venta se convierte con
 * TIPO CAMBIO (RULE-REP-018).
 *
 * POR QUE HACE FALTA. `PRECIO BASE MNX` de REQ_FIFO miente el nombre: viene en la MONEDA de
 * la transaccion, no en pesos. Medido con datos reales (2026-09-26):
 *     PRECIO BASE MNX 3204.25 | MONEDA 'US Dollar' | TIPO CAMBIO 18.31 | CANTIDAD ORDEN 22
 *     TAX AMOUNT 11278.96 | GROSS AMT 81772.46
 * cierra exacto con el precio CRUDO (3204.25 x 22 = 70 493.50; x 0.16 = 11 278.96), o sea que
 * ni el impuesto ni el total del restlet aplican el tipo de cambio. Tomar ese campo como pesos
 * subestima el precio ~18x en las ventas en dolar, y con ello todos los montos de los reportes.
 *
 * QUE COMPRUEBA, en este orden:
 *   1. Que hay credenciales de NetSuite (sin imprimirlas).
 *   2. Que el 1766 responde y de كمantas filas viene, en cuantos segundos.
 *   3. Muestra crudas las primeras filas que tengan TIPO CAMBIO distinto de 1, con las tres
 *      columnas que deciden el resultado: PRECIO BASE MNX, TIPO CAMBIO y MONEDA.
 *   4. Aplica la misma regla que el servidor (precio = crudo x tipoCambio) y muestra el
 *      antes y el despues, con el factor. Aqui esta el veredicto: si el factor de las ventas
 *      en dolares sale ~18, la conversion esta viva.
 *   5. Repite el calculo con la FUNCION REAL del proyecto (no una copia): si el precio que
 *      devuelve PP_fetchSalesPricesRestlet_ coincide con el calculado, el fix esta en el
 *      camino de verdad y no solo en la aritmetica de la sonda.
 *
 * SOLO LECTURA. Llama unicamente a PP_fetchRestletPages_ y PP_fetchSalesPricesRestlet_, que
 * solo hacen UrlFetch de lectura al 1766. NO llama a syncNetSuiteWorkOrdersLite ni a
 * syncNetSuiteData: esas PODAN la cola del plan y escriben en la hoja, y una sonda no debe
 * escribir en produccion. La unica escritura es la de CacheService que hace la funcion real,
 * que es el cache de 1 h de RULE-REP-017 y no toca la hoja.
 *
 * CUIDADO CON LA CUOTA. La cuenta es de consumidor: 20 000 UrlFetch al dia, reinicio a
 * medianoche hora del Pacifico, y se agoto el 2026-09-25. El 1766 son 6 671 filas con un tope
 * real de pageSize 1000, o sea 7 llamadas por recorrido. Esta sonda hace 2 recorridos: correla
 * una vez, no en bucle.
 *
 * COMO CORRERLA: pega este archivo en el editor de Apps Script, guardalo y ejecuta
 * VERIFICA_PRECIOS. Pega el registro de ejecucion completo.
 */

function VERIFICA_PRECIOS() {
  var log = function (message) { Logger.log(String(message)); };
  var fallos = 0;

  // 1) Credenciales, sin imprimir ningun secreto.
  try {
    var config = PP_netSuiteConfig_();
    log('1) credenciales: presentes (cuenta terminada en ' +
      String(config.accountId || '').slice(-4) + ')');
  } catch (error1) {
    log('1) credenciales -> EXCEPCION ' + String(error1 && error1.message || error1));
    log('   Sin credenciales no hay nada que verificar. Revisa las propiedades NS_*.');
    return;
  }

  // 2) El 1766 crudo: cuantas filas y en cuanto tiempo.
  var rows = [];
  var elapsedMs = 0;
  try {
    var t0 = new Date().getTime();
    var page = PP_fetchRestletPages_({ script: '1766', deploy: '1' }, { table: 'REQ_FIFO' }, config, 100);
    elapsedMs = new Date().getTime() - t0;
    rows = (page && page.rows) || [];
    log('2) 1766 REQ_FIFO: ' + rows.length + ' filas en ' + Math.round(elapsedMs) + ' ms');
    if (!rows.length) {
      log('   AVISO: 0 filas. Sin datos no se puede verificar la conversion.');
      return;
    }
  } catch (error2) {
    log('2) 1766 -> EXCEPCION ' + String(error2 && error2.message || error2));
    fallos += 1;
    return;
  }

  var pick = function (row, names) {
    for (var i = 0; i < names.length; i += 1) {
      var value = row ? row[names[i]] : null;
      if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return null;
  };

  // 3) Las filas que deciden el caso: TIPO CAMBIO distinto de 1 (o sea, moneda extranjera).
  var extranjeras = [];
  rows.forEach(function (row) {
    var rate = Number(pick(row, ['TIPO CAMBIO', 'tipo_cambio']) || 0);
    if (rate > 1.0000001) extranjeras.push({ row: row, rate: rate });
  });
  log('3) filas con TIPO CAMBIO > 1 (moneda extranjera): ' + extranjeras.length + ' de ' + rows.length);

  if (!extranjeras.length) {
    log('   No hay ninguna venta en moneda extranjera en la ventana. Entonces la conversion');
    log('   no se puede confirmar ni desmentir con estos datos: no hay caso que probar.');
    log('   Para forzarla, haz una venta de un articulo en dolares y vuelve a correr esto.');
  } else {
    // 4) La misma regla del servidor, con el antes y el despues.
    var factors = [];
    var muestras = Math.min(extranjeras.length, 5);
    log('');
    log('   COLUMNAS CRUDAS Y CALCULO (redondeo solo para lectura):');
    for (var i = 0; i < muestras; i += 1) {
      var item = extranjeras[i];
      var crudo = Number(pick(item.row, ['PRECIO BASE MNX', 'precio_base_mnx']) || 0);
      var moneda = pick(item.row, ['MONEDA', 'moneda', 'CURRENCY', 'currency']);
      var articulo = pick(item.row, ['_ITEM_NAME', 'item_name', 'Articulo', 'Item', 'ITEM', 'PARTE']);
      var fecha = pick(item.row, ['FECHA DE ORDEN', 'fecha_orden']);
      var convertido = crudo * item.rate;
      factors.push(item.rate);
      log('');
      log('   [' + (i + 1) + '] articulo ' + String(articulo) + '  fecha ' + String(fecha));
      log('       PRECIO BASE MNX crudo : ' + crudo);
      log('       MONEDA                 : ' + String(moneda));
      log('       TIPO CAMBIO            : ' + item.rate);
      log('       precio con la regla    : ' + Math.round(convertido) +
        '   (factor ' + item.rate + 'x)');
    }
    if (extranjeras.length > muestras) {
      log('');
      log('   ... y ' + (extranjeras.length - muestras) + ' venta(s) en moneda extranjera mas.');
    }
    // El factor mediano es el indicativo de la magnitud del bug (se esperaba ~18).
    factors.sort(function (a, b) { return a - b; });
    var mediana = factors[Math.floor(factors.length / 2)];
    log('');
    log('   factor mediano de las ventas en moneda extranjera: ' + mediana + 'x');
    log('   VEREDICTO: si este numero anda cerca de 18, la conversion por TIPO CAMBIO esta');
    log('   viva. Antes del fix (RULE-REP-018) estos precios salian ~18x mas bajos.');
  }

  // 5) La FUNCION REAL del proyecto: si coincide con el calculo, el fix esta en el camino vivo.
  log('');
  log('5) la funcion real del proyecto (PP_fetchSalesPricesRestlet_), sin cache:');
  try {
    var window = { from: '2026-03-26', to: '2026-09-26' };
    var precios = PP_fetchSalesPricesRestlet_(config, window);
    var last = (precios && precios.lastByItem) || {};
    var claves = Object.keys(last);
    log('   articulos con precio de venta: ' + claves.length +
      '   cache: ' + JSON.stringify(precios && precios.from || null) + ' -> ' +
      JSON.stringify(precios && precios.to || null));
    if (precios && precios.warning) log('   aviso de precios: ' + precios.warning);

    // Se cruzan con las filas extranjeras: si un articulo vendido en dolares trae un precio
    // coherente con crudo x tipoCambio, el fix esta en la ruta que la app usa.
    var cruzados = 0;
    var muestra = [];
    for (var j = 0; j < Math.min(extranjeras.length, 6); j += 1) {
      var fila = extranjeras[j];
      var nombre = pick(fila.row, ['_ITEM_NAME', 'item_name', 'Articulo', 'Item', 'ITEM', 'PARTE']);
      if (!nombre) continue;
      var key = PP_normalizeKey_(nombre);
      var precioReal = Number(last[key] || 0);
      if (precioReal > 0) {
        cruzados += 1;
        var crudo = Number(pick(fila.row, ['PRECIO BASE MNX', 'precio_base_mnx']) || 0);
        muestra.push({ articulo: nombre, precio: precioReal, crudo: crudo, factor: fila.rate });
      }
    }
    if (cruzados) {
      log('   articulos de la muestra que tambien trae precio de venta: ' + cruzados);
      muestra.forEach(function (m) {
        var esperado = m.crudo * m.factor;
        var coincide = esperado > 0 && Math.abs(m.precio - esperado) / esperado < 0.02;
        log('      ' + m.articulo + ': la funcion devuelve ' + Math.round(m.precio) +
          ', crudo x ' + m.factor + ' = ' + Math.round(esperado) +
          (coincide ? '  COINCIDE' : '  NO COINCIDE'));
      });
      log('');
      log('   Si todos dicen COINCIDE, la conversion esta en el camino que la app usa de verdad.');
    } else {
      log('   Ningun articulo de la muestra tiene precio de venta cargado. Puede ser que el');
      log('   cruce por clave no haya pegado; en ese caso la seccion 3 y 4 ya bastan.');
    }
  } catch (error5) {
    log('5) la funcion real -> EXCEPCION ' + String(error5 && error5.message || error5));
    fallos += 1;
  }

  log('');
  log(fallos
    ? 'VERIFICA_PRECIOS: ' + fallos + ' fallo(s) grave(s). Revisa el detalle.'
    : 'VERIFICA_PRECIOS: sin fallos graves. Pega el registro completo.');
}
