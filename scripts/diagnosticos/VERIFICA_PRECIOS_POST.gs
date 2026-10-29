/**
 * VERIFICA_PRECIOS_POST - comprueba en el backend REAL, ya desplegado el fix, que el precio
 * de venta dejo de multiplicarse por TIPO CAMBIO. Es la verificacion de RULE-REP-020 contra
 * el mismo criterio que tumbo a RULE-REP-018: un precio de factura, no la coherencia de la
 * formula.
 *
 * SOLO LECTURA. Llama a getDeploymentStatus, getAppStateIfChanged(0) y
 * fetchNetSuiteWorkOrdersLite, que no escriben nada. NO llama a syncNetSuiteWorkOrdersLite ni
 * a syncNetSuiteData: esas PODAN la cola del plan y escriben en la hoja.
 *
 * QUE COMPRUEBA:
 *   1. Que el deployment ya es 2.44.0 (o posterior). Si sigue en 2.43.0, el fix no esta
 *      desplegado y todo lo demas no significa nada.
 *   2. Los precios de venta que traen las OTs, y cuantos hay por encima de 20 000, que es
 *      donde estaban los precios inflados de ~17x (el maximo medido era 127 021.93).
 *   3. Los articulos de referencia que el usuario reporto: TR 350 (correcto antes y despues,
 *      porque TIPO CAMBIO es 1) y M66-8602 (el que estaba 17x). M66-8602 debe salir cerca
 *      de 1 378.71 y no cerca de 23 000.
 *   4. Que ningun precio con TIPO CAMBIO grande quedo sin convertir. Ojo: esto NO se puede
 *      comprobar desde el estado, porque ahi no llega TIPO CAMBIO. Lo que se comprueba es el
 *      precio final contra la referencia de factura, que es el unico dato verdadero.
 *
 * CUIDADO CON LA CUOTA: fetchNetSuiteWorkOrdersLite golpea el 1766 (7 llamadas) y el 2240
 * (1 llamada). El precio va cacheado 1 h (RULE-REP-017), asi que si corriste hace menos de
 * una hora el 1766 no se vuelve a pedir. Correr una vez.
 *
 * COMO CORRERLA: pega este archivo en el editor de Apps Script, guardalo y ejecuta
 * VERIFICA_PRECIOS_POST. Pega el registro completo.
 */

function VERIFICA_PRECIOS_POST() {
  var log = function (m) { Logger.log(String(m)); };
  var fallos = 0;

  // Precio real de factura, del modal de articulo. Referencia externa al 1766.
  // 'real' es el precio de FACTURA y se compara contra el PROMEDIO de 6 meses, que es el
  // numero que pesa en los reportes. La ultima venta NO se juzga contra una factura: es la
  // venta mas reciente y puede estar mas cara que cualquier factura que se tenga a mano
  // (en TR 350 la ultima fue a 369 y las facturas vistas eran de 273 y 304, y las dos cosas
  // son reales). Por eso solo se informa.
  var REFERENCIA = [
    { parte: 'M66-8602', real: 1378.71, inflado: 24606.67, nota: 'factura INV2244, 13 pzas por $17 923.23' },
    { parte: 'TR 350', real: 279.20, inflado: 280.65, nota: 'facturas a $273 y $304; el promedio real ronda 279.20' }
  ];
  var UMBRAL_INFLADO = 20000;  // por encima de esto, un tubo o una pieza no tiene sentido.

  // 1) El deployment: si no es 2.44.0, el fix no esta ahi y lo demas no proba nada.
  try {
    var status = getDeploymentStatus();
    log('1) deployment: appVersion=' + String(status && status.appVersion) +
      ' schemaVersion=' + String(status && status.schemaVersion) +
      ' netSuite=' + String(status && status.netSuiteConfigured));
    var major = parseInt(String(status && status.appVersion || '0').split('.')[0], 10);
    var minor = parseInt(String(status && status.appVersion || '0.0').split('.')[1], 10);
    if (!(major > 2 || (major === 2 && minor >= 44))) {
      log('   FALLA: el fix de RULE-REP-020 NO esta desplegado. Los precios de abajo todavia');
      log('          traen el tipo de cambio. Sube a 2.44.0 antes de concluir nada.');
      fallos += 1;
    }
  } catch (e1) {
    log('1) deployment -> EXCEPCION ' + String(e1 && e1.message || e1));
    return;
  }

  // 2) Los precios de venta de las OTs.
  var lite;
  try {
    lite = fetchNetSuiteWorkOrdersLite();
  } catch (e2) {
    log('2) fetchNetSuiteWorkOrdersLite -> EXCEPCION ' + String(e2 && e2.message || e2));
    return;
  }
  var ots = (lite && lite.workOrders) || [];
  log('2) OTs abiertas: ' + ots.length);

  var conPrecio = 0;
  var inflados = 0;
  var maximo = 0;
  var ejemploMax = null;
  ots.forEach(function (ot) {
    var last = Number(ot.lastSalePrice || 0);
    var avg = Number(ot.averageSalePrice || 0);
    var unit = Math.max(last, avg);
    if (unit > 0) {
      conPrecio += 1;
      if (unit > UMBRAL_INFLADO) inflados += 1;
      if (unit > maximo) {
        maximo = unit;
        ejemploMax = { ot: ot.ot, item: ot.item, last: last, avg: avg };
      }
    }
  });

  log('   con precio de venta: ' + conPrecio + ' de ' + ots.length);
  log('   precios sobre ' + UMBRAL_INFLADO + ': ' + inflados);
  log('   precio maximo: ' + Math.round(maximo) + '  ' + JSON.stringify(ejemploMax));
  if (inflados === 0) {
    log('   -> bien: ningun precio quedo por encima del umbral, o sea que ya no hay precios');
    log('      multiplicados por el tipo de cambio.');
  } else {
    log('   -> ATENCION: ' + inflados + ' precio(s) siguen por encima del umbral.');
    fallos += 1;
  }

  // 3) Los articulos de referencia del reporte del usuario.
  log('');
  log('3) ARTICULOS DE REFERENCIA (precio real de factura contra lo que trae la app):');
  var norm = function (v) {
    return String(v == null ? '' : v).trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  };
  REFERENCIA.forEach(function (ref) {
    var clave = norm(ref.parte);
    var propias = ots.filter(function (ot) { return norm(ot.item) === clave; });
    if (!propias.length) {
      log('   ' + ref.parte + ': ninguna OT abierta de esta parte ahora mismo.');
      log('      (puede haberse cerrado; su precio sigue en el promedio de la hoja)');
      return;
    }
    propias.forEach(function (ot) {
      var last = Number(ot.lastSalePrice || 0);
      var avg = Number(ot.averageSalePrice || 0);
      var errAvg = ref.real > 0 && avg > 0 ? Math.abs(avg - ref.real) / ref.real : null;
      log('   ' + ref.parte + '  OT ' + ot.ot + ': last=' + Math.round(last) + ' avg=' + Math.round(avg) +
        '  factura=' + ref.real +
        (errAvg === null ? '  (sin promedio)' : '  error del promedio=' + Math.round(errAvg * 100) + '%'));
      if (ref.inflado > 0) {
        log('      el promedio antes salia en ' + Math.round(ref.inflado) +
          ' (' + Math.round(ref.inflado / ref.real) + 'x la factura)');
      }
      // El criterio es sobre el PROMEDIO: es el numero que va a los reportes y el que se
      // compara de Apples con Apples contra una factura.
      if (errAvg !== null && errAvg > 0.10) {
        log('      FALLA: el promedio no coincide con la factura, el tipo de cambio sigue adentro.');
        fallos += 1;
      } else if (errAvg !== null) {
        log('      bien: el promedio coincide con la factura dentro del 10%.');
      }
      // La ultima venta se informa sin juzgar: puede ser una venta real mas cara.
      if (last > 0 && ref.real > 0) {
        var factorLast = last / ref.real;
        if (factorLast > 1.2) {
          log('      nota: la ultima venta esta ' + Math.round(factorLast * 100) + '% de la factura.');
          log('            Puede ser una venta real mas cara; revisalo a mano, no es un fallo');
          log('            automatico.');
        }
      }
    });
  });

  log('');
  if (fallos) {
    log('VERIFICA_PRECIOS_POST: ' + fallos + ' problema(s). Revisa el detalle.');
  } else {
    log('VERIFICA_PRECIOS_POST: OK. El precio ya no lleva tipo de cambio y coincide con las');
    log('facturas. RULE-REP-020 queda verificado contra dato externo.');
  }
  log('');
  log('LO QUE ESTA SONDA NO PUEDE COMPROBAR: que las 2 464 lineas con TIPO CAMBIO > 1');
  log('quedaran bien. Para eso haria falta leer el 1766 crudo otra vez (DIAG_PRECIOS_MONEDA)');
  log('y ahi el criterio es: el promedio de 6 meses de cada articulo debe acercarse al');
  log('precio de su factura, y no multiplicarse. El 1766 son 7 llamadas.');
}
