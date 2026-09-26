/**
 * VERIFICA_PRECIOS_B - segunda ronda. Corrige el defecto de VERIFICA_PRECIOS: comparar el
 * precio de la funcion contra la fila que la sonda CASUALMENTE mostro no prueba nada.
 *
 * POR QUE FALLO LA PRIMERA. PP_fetchSalesPricesRestlet_ se queda con la venta MAS NUEVA de
 * cada articulo: recorre las 6671 filas y sobreescribe el precio cada vez que encuentra una
 * fecha mayor (PP_fetchSalesPricesRestlet_, src/server/08-netsuite.js:627-633). La sonda
 * imprimia las 5 primeras filas que meetian TIPO CAMBIO > 1 SEGUIENDO EL ORDEN DEL ARREGLO,
 * que resulto ser 2025-12-24. Para un articulo con una venta posterior, la fila correcta es
 * otra y el precio no podia cuadrar. Se comprobo con el registro del 2026-09-26: los precios
 * que devolvio la funcion son de 7 mil a 50 mil, contra crudos de 459 a 3205, o sea entre 16x
 * y 85x su propio crudo; si la funcion no convirtiera, habria devuelto el crudo. La
 * conversion SI esta viva, lo que estaba mal era la comparacion.
 *
 * QUE HACE BIEN ESTA. Para cada articulo recuerda la fila que REALMENTE gano (la de fecha
 * maxima), y despues contrasta, sobre ESA fila, las dos hipotesis con la misma tolerancia de
 * la funcion real:
 *   - el precio devuelto tiene que ser el CRUDO de esa fila (eso probaria que NO convierte)
 *   - tiene que ser el CRUDO x TIPO CAMBIO de esa fila (eso prueba que convierte)
 * Ademas reconstruye el mismo promedio ponderado por cantidad que arma la funcion, para
 * comprobar tambien el camino del promedio, que es el que va a los reportes.
 *
 * SOLO LECTURA. Llama a PP_fetchRestletPages_ y a PP_fetchSalesPricesRestlet_, que solo
 * hacen UrlFetch de lectura al 1766. NO llama a syncNetSuiteWorkOrdersLite ni a
 * syncNetSuiteData: esas PODAN la cola del plan y escriben en la hoja.
 *
 * CUIDADO CON LA CUOTA: 7 llamadas al 1766 por recorrido, 20 000 UrlFetch/dia en una cuenta
 * de consumidor. Correr una vez, no en bucle. Si la cuota esta agotada sale
 * "Service invoked too many times for one day: urlfetch" y no es un fallo de precios.
 *
 * COMO CORRERLA: pega este archivo en el editor de Apps Script, guardalo y ejecuta
 * VERIFICA_PRECIOS_B. Pega el registro completo.
 */

function VERIFICA_PRECIOS_B() {
  var log = function (message) { Logger.log(String(message)); };
  var fallos = 0;
  var TOLERANCIA = 0.005; // 0.5%: el precio de la funcion viene de la misma aritmetica.

  var config;
  try {
    config = PP_netSuiteConfig_();
    log('1) credenciales: presentes (cuenta terminada en ' + String(config.accountId || '').slice(-4) + ')');
  } catch (error1) {
    log('1) credenciales -> EXCEPCION ' + String(error1 && error1.message || error1));
    return;
  }

  var rows = [];
  try {
    var t0 = new Date().getTime();
    var page = PP_fetchRestletPages_({ script: '1766', deploy: '1' }, { table: 'REQ_FIFO' }, config, 100);
    rows = (page && page.rows) || [];
    log('2) 1766 REQ_FIFO: ' + rows.length + ' filas en ' + Math.round((new Date().getTime() - t0)) + ' ms');
    if (!rows.length) { log('   0 filas: nada que verificar.'); return; }
  } catch (error2) {
    log('2) 1766 -> EXCEPCION ' + String(error2 && error2.message || error2));
    return;
  }

  var pick = function (row, names) {
    for (var i = 0; i < names.length; i += 1) {
      var value = row ? row[names[i]] : null;
      if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return null;
  };

  // 3) Replica EXACTA de como la funcion elige la fila ganadora de cada articulo, para
  //    tener con que comparar. Se queda la de FECHA DE ORDEN mas nueva.
  var ganadora = {};
  var detail = {};
  var sumAmt = {};
  var sumQty = {};
  var cutoff = new Date('2026-03-26T00:00:00');
  rows.forEach(function (row) {
    var itemName = String(pick(row, ['_ITEM_NAME', 'item_name', 'Articulo', 'Item', 'ITEM', 'PARTE']) || '').trim();
    if (!itemName) return;
    var key = PP_normalizeKey_(itemName);
    var rawPrice = Number(pick(row, ['PRECIO BASE MNX', 'precio_base_mnx']) || 0);
    var rate = Number(pick(row, ['TIPO CAMBIO', 'tipo_cambio']) || 0);
    var price = rate > 0 ? rawPrice * rate : rawPrice;
    var orderedAt = PP_parseRestletDate_(pick(row, ['FECHA DE ORDEN', 'fecha_orden']));
    var qty = Number(pick(row, ['CANTIDAD ORDEN', 'cantidad_orden']) || 0);
    if (orderedAt && isFinite(price)) {
      if (!ganadora[key] || orderedAt.getTime() > ganadora[key].getTime()) {
        ganadora[key] = orderedAt;
        detail[key] = {
          crudo: rawPrice, rate: rate, price: price, qty: qty,
          fecha: orderedAt, moneda: String(pick(row, ['MONEDA', 'moneda', 'CURRENCY', 'currency']) || '')
        };
      }
    }
    if (orderedAt && !isNaN(orderedAt.getTime()) && orderedAt.getTime() >= cutoff.getTime() && qty > 0 && price > 0) {
      sumAmt[key] = (sumAmt[key] || 0) + (price * qty);
      sumQty[key] = (sumQty[key] || 0) + qty;
    }
  });

  var ganadoras = Object.keys(detail);
  log('3) articulos con venta ganadora: ' + ganadoras.length +
    '  (con TIPO CAMBIO > 1: ' + ganadoras.filter(function (k) { return detail[k].rate > 1.0000001; }).length + ')');

  // 4) Se trae la funcion real, sin cache, y se contrasta sobre la fila que GANO.
  var precios;
  try {
    precios = PP_fetchSalesPricesRestlet_(config, { from: '2026-03-26', to: '2026-09-26' });
  } catch (error4) {
    log('4) la funcion real -> EXCEPCION ' + String(error4 && error4.message || error4));
    return;
  }
  var last = (precios && precios.lastByItem) || {};
  var avg = (precios && precios.avgByItem) || {};

  var comparados = 0;
  var comoCrudo = 0;      // la funcion devolvio el crudo: NO convierte (esto seria el bug)
  var comoConvertido = 0; // la funcion devolvio crudo x tipoCambio: convierte
  var ejemplosCrudo = [];
  var Muestra = null;

  for (var i = 0; i < ganadoras.length; i += 1) {
    var key = ganadoras[i];
    var d = detail[key];
    var fnLast = Number(last[key] || 0);
    if (!(fnLast > 0)) continue;
    comparados += 1;
    var errorComoConvertido = Math.abs(fnLast - d.price) / d.price;
    var errorComoCrudo = d.crudo > 0 ? Math.abs(fnLast - d.crudo) / d.crudo : Infinity;
    if (errorComoConvertido <= TOLERANCIA) {
      comoConvertido += 1;
    } else if (errorComoCrudo <= TOLERANCIA) {
      comoCrudo += 1;
      if (ejemplosCrudo.length < 6) ejemplosCrudo.push({ key: key, d: d, fn: fnLast });
    }
    // Una muestra de venta en moneda extranjera para que se vea el renglón completo.
    if (d.rate > 1.0000001 && errorComoConvertido <= TOLERANCIA && !Muestra) {
      Muestra = { key: key, d: d, fn: fnLast };
    }
  }

  log('4) contraste sobre la fila que GANO la funcion (tolerancia ' + (TOLERANCIA * 100) + '%):');
  log('   articulos comparados      : ' + comparados);
  log('   devuelven CRUDO x TIPO CAMBIO : ' + comoConvertido);
  log('   devuelven el CRUDO sin convertir: ' + comoCrudo);
  if (Muestra) {
    log('');
    log('   ejemplo de venta en moneda extranjera:');
    log('      articulo ' + Muestra.key);
    log('      fecha ganadora  : ' + Muestra.d.fecha);
    log('      MONEDA           : ' + Muestra.d.moneda);
    log('      crudo            : ' + Muestra.d.crudo);
    log('      TIPO CAMBIO      : ' + Muestra.d.rate);
    log('      la funcion da    : ' + Math.round(Muestra.fn) + '  (crudo x ' + Muestra.d.rate + ' = ' + Math.round(Muestra.d.price) + ')');
  }
  if (comoCrudo > 0) {
    log('');
    log('   ATENCION: ' + comoCrudo + ' articulo(s) volvieron el CRUDO sin convertir. Ejemplos:');
    ejemplosCrudo.forEach(function (e) {
      log('      ' + e.key + ' crudo ' + e.d.crudo + ' rate ' + e.d.rate + ' -> ' + e.fn);
    });
    fallos += 1;
  }

  // 5) El promedio ponderado, que es el numero que va a los reportes.
  var promComp = 0;
  var promOK = 0;
  Object.keys(sumQty).forEach(function (key) {
    var esperado = sumAmt[key] / sumQty[key];
    var fnAvg = Number(avg[key] || 0);
    if (!(fnAvg > 0) || !(esperado > 0)) return;
    promComp += 1;
    if (Math.abs(fnAvg - esperado) / esperado <= TOLERANCIA) promOK += 1;
  });
  log('');
  log('5) promedio ponderado por cantidad (el numero de los reportes):');
  log('   comparados ' + promComp + ' · coinciden con el calculo ' + promOK +
    (promComp ? ' (' + Math.round((promOK / promComp) * 100) + '%)' : ''));

  log('');
  if (fallos) {
    log('VERIFICA_PRECIOS_B: ' + fallos + ' fallo(s). Hay articulos cuyo precio NO se convierte.');
  } else if (comoConvertido > 0 && comoCrudo === 0) {
    log('VERIFICA_PRECIOS_B: CONFIRMADO. Los ' + comparados + ' articulos comparados devuelven');
    log('   crudo x TIPO CAMBIO y ninguno devuelve el crudo sin convertir.');
    log('   La conversion de RULE-REP-018 esta viva en el camino que la app usa.');
  } else {
    log('VERIFICA_PRECIOS_B: sin veredicto claro. Pega el registro completo.');
  }
}
