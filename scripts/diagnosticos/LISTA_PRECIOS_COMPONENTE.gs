/**
 * LISTA_PRECIOS_COMPONENTE - lista los articulos de tipo comercial COMPONENTE que tienen un
 * PRECIO_MANUAL, y dice de donde salio cada numero.
 *
 * POR QUE EXISTE. Un COMPONENTE es una pieza que se COMPRA, no un articulo que la planta
 * vende: no tiene precio de venta y no deberia valorarse. Pero el dialogo de "preparar trabajo"
 * le exigia un precio unitario de al menos $1.00 (el piso de RULE-FIN-001) para poder
 * continuar, y como no habia de donde sacarlo se terminaba escribiendo 1.00 a mano. Ese 1.00
 * es un numero inventado. Y el ratchet viejo de RULE-REP-021, que escribia el precio de venta
 * en PRECIO_MANUAL, todavia habia alcanzado a estos articulos.
 *
 * CON RULE-REP-022 (2.46.0) el dialogo ya no pide precio para un COMPONENTE y ya no escribe
 * uno. Los valores que quedaron atrapados NO se borran solos: se listan, con su origen, para
 * que la limpieza sea una decision y no un efecto secundario.
 *
 * DE DONDE SALIO CADA NUMERO. Se mide contra el precio de venta VIVO que trae el 1766, que
 * llega en getAppStateIfChanged como lastSalePrice y averageSalePrice:
 *   [piso de $1.00]      vale exactamente 1.00: el minimo que exigia el dialogo.
 *   [precio de venta]    coincide con max(ultima venta, promedio) al 0.1%: lo grabo el
 *                        ratchet viejo. Nadie escribe 150.764375 a mano.
 *   [precio de persona]  no coincide con ninguna de las dos: hay que preguntar quien lo puso
 *                        antes de borrarlo.
 * Solo el tercero justifica una pregunta. Los otros dos son artefactos.
 *
 * MEDIDO EL 2026-09-26 en produccion, con el estado estabilizado (dos lecturas iguales): 33
 * articulos COMPONENTE, 24 sin precio manual y sin precio de venta (a esos les pedia precio
 * el dialogo), 9 con precio manual: 4 del piso y 5 del ratchet. Ninguno de persona. Ademas
 * los 9 tenian 0 piezas vivas, asi que hoy no inflan ningun monto: el dano es prospectivo,
 * la proxima vez que se prepare una pieza de COMP 4434.
 *
 * SOLO LECTURA. No escribe ninguna celda, no borra nada y NO llama a syncNetSuiteWorkOrdersLite
 * ni a syncNetSuiteData (que podan la cola del plan y escriben en la hoja). La limpieza se hace
 * a mano en la hoja, celda por celda, y se documenta en el commit.
 *
 * NO GASTA UrlFetch: lee con SpreadsheetApp, que es nativo de Apps Script.
 */
function LISTA_PRECIOS_COMPONENTE() {
  var log = function (m) { Logger.log(String(m)); };
  var fallos = 0;
  var TOLERANCIA = 0.001;   // 0.1%: el ratchet copiaba el numero, no lo aproximaba.
  var norm = function (v) {
    return String(v === undefined || v === null ? '' : v).trim().toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  };

  // ------------------------------------------------------------ 1. el fix esta desplegado
  try {
    var status = getDeploymentStatus();
    var v = String(status && status.appVersion || '0');
    var partes = v.split('.');
    var major = parseInt(partes[0], 10) || 0;
    var minor = parseInt(partes[1], 10) || 0;
    log('1) deployment: appVersion=' + v);
    if (!(major > 2 || (major === 2 && minor >= 46))) {
      log('   AVISO: RULE-REP-022 no esta desplegado (hace falta 2.46.0). El dialogo todavia');
      log('          le pedira precio a un COMPONENTE y esta lista CRECERA cada vez que se');
      log('          prepare una pieza. Sincroniza y vuelve a correr esto.');
      fallos += 1;
    } else {
      log('   bien: el dialogo ya no pide precio a un COMPONENTE.');
    }
  } catch (e1) {
    log('1) deployment -> EXCEPCION ' + String(e1 && e1.message || e1));
    return;
  }

  // ----------------------------------------------- 2. los COMPONENTE con precio manual
  var sheet = null;
  try {
    var ss = SpreadsheetApp.openById('1iLG8aRuVPhYQ9e-1SVrD79k22ZV5zo111MIC08hF8D0');
    sheet = ss.getSheetByName('CONFIGURACION_ARTICULO');
  } catch (e2) {
    log('2) no se pudo abrir la hoja: ' + String(e2 && e2.message || e2));
    return;
  }
  if (!sheet) { log('2) la hoja no tiene CONFIGURACION_ARTICULO.'); return; }

  var encabezados = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (c) { return norm(c); });
  var iArt = encabezados.indexOf('ARTICULO');
  var iTipo = encabezados.indexOf('TIPO_OT');
  var iManual = encabezados.indexOf('PRECIO_MANUAL');
  var iRef = encabezados.indexOf('PRECIO_REF_VENTA');
  var iAct = encabezados.indexOf('ACTUALIZADO');
  log('2) CONFIGURACION_ARTICULO: ' + Math.max(0, sheet.getLastRow() - 1) + ' filas');
  log('   ARTICULO=' + (iArt + 1) + ' TIPO_OT=' + (iTipo + 1) + ' PRECIO_MANUAL=' + (iManual + 1) +
    ' PRECIO_REF_VENTA=' + (iRef + 1) + ' ACTUALIZADO=' + (iAct + 1));
  if (iArt < 0 || iTipo < 0 || iManual < 0) {
    log('   FALLA: faltan columnas necesarias (ARTICULO, TIPO_OT, PRECIO_MANUAL).');
    return;
  }

  // --------------------------------- 3. precio de venta vivo, contra el estado del navegador
  // El 1766 llega por getAppStateIfChanged como lastSalePrice y averageSalePrice. La regla del
  // sync es max de los dos, que es lo que el ratchet copiaba a PRECIO_MANUAL.
  var venta = {};
  var estado = null;
  try {
    estado = getAppStateIfChanged(0, { includeMaterials: false });
  } catch (e3) {
    log('3) no se pudo leer el estado (sigo, pero sin clasificar el origen): ' + String(e3 && e3.message || e3));
  }
  if (estado && estado.workOrders) {
    var wos = estado.workOrders;
    for (var w = 0; w < wos.length; w += 1) {
      var art = norm(wos[w] && wos[w].item);
      if (!art) continue;
      var actual = Math.max(Math.max(0, Number(wos[w].lastSalePrice || 0)), Math.max(0, Number(wos[w].averageSalePrice || 0)));
      if (!(actual >= 1)) continue;
      if (!venta[art] || actual > venta[art]) venta[art] = actual;
    }
  }
  log('3) precio de venta vivo disponible para ' + Object.keys(venta).length + ' articulos del 1766' +
    (estado ? '' : '  (sin estado: no se puede decir de donde salio cada numero)'));

  // --------------------------------------------------------- 4. la lista, clasificada
  var valores = sheet.getRange(2, 1, Math.max(0, sheet.getLastRow() - 1), sheet.getLastColumn()).getValues();
  var totalComp = 0;
  var conPrecio = 0;
  var delPiso = 0;
  var delRatchet = 0;
  var dePersona = 0;
  var sinNada = 0;
  var conRef = 0;
  var lista = [];

  for (var f = 0; f < valores.length; f += 1) {
    var fila = valores[f] || [];
    if (norm(fila[iTipo]) !== 'COMPONENTE') continue;
    totalComp += 1;
    var manual = Number(fila[iManual] || 0);
    var ref = iRef >= 0 ? Number(fila[iRef] || 0) : 0;
    if (ref >= 1) conRef += 1;
    if (!(manual >= 1)) {
      if (ref < 1) sinNada += 1;
      continue;
    }
    conPrecio += 1;
    var origen;
    if (Math.abs(manual - 1) < 0.005) {
      origen = 'piso';
      delPiso += 1;
    } else {
      var vivo = venta[norm(fila[iArt])];
      if (vivo >= 1 && Math.abs(manual - vivo) / vivo <= TOLERANCIA) {
        origen = 'ratchet';
        delRatchet += 1;
      } else {
        origen = 'persona';
        dePersona += 1;
      }
    }
    lista.push({
      art: String(fila[iArt] || '').trim(),
      manual: manual,
      vivo: venta[norm(fila[iArt])] || 0,
      ref: ref,
      origen: origen,
      act: iAct >= 0 ? String(fila[iAct] || '') : '',
    });
  }

  log('');
  log('4) COMPONENTE EN CONFIGURACION_ARTICULO:');
  log('   articulos con TIPO_OT = COMPONENTE        : ' + totalComp);
  log('   sin precio manual ni precio de venta      : ' + sinNada + '   <- a estos les pedia precio el dialogo');
  log('   con PRECIO_MANUAL >= 1                   : ' + conPrecio);
  log('      [piso de $1.00]                       : ' + delPiso);
  log('      [precio de venta, lo grabo el ratchet] : ' + delRatchet);
  log('      [precio de persona]                    : ' + dePersona + '   <- unico grupo que hay que preguntar');
  log('   con PRECIO_REF_VENTA >= 1                 : ' + conRef +
    (conRef ? '   <- un COMPONENTE con precio de venta tambien es raro, revisalo' : ''));

  if (!lista.length) {
    log('');
    log('   No hay ningun COMPONENTE con precio manual. No hay nada que limpiar.');
    log('   Con RULE-REP-022 desplegado, la lista se queda vacia sola.');
  } else {
    log('');
    log('   LISTA DE ARTICULOS (para limpiar a mano en PRECIO_MANUAL):');
    lista.sort(function (a, b) { return a.art.localeCompare(b.art); });
    var etiquetas = { piso: '[piso de $1.00]', ratchet: '[precio de venta]', persona: '[precio de persona]' };
    lista.forEach(function (item, n) {
      log('   ' + String(n + 1) + '. ' + item.art +
        '   PRECIO_MANUAL=' + item.manual +
        (item.vivo >= 1 ? '   precio de venta vivo=' + item.vivo : '') +
        '   ' + etiquetas[item.origen] +
        (item.act ? '   ACTUALIZADO=' + item.act : ''));
    });
    log('');
    log('   QUE HACER CON ESTA LISTA. [piso de $1.00] y [precio de venta] son artefactos:');
    log('   el primero es el minimo que exigia el dialogo, el segundo lo copio el ratchet');
    log('   viejo. Ninguno de los dos es un precio. Ponerlos en 0 es lo correcto, porque hoy');
    log('   hacen que un componente que no se vende entre al maximo del reporte. Los marcados');
    log('   [precio de persona] NO se tocan hasta que alguien confirme que ese numero');
    log('   significa algo.');
    log('   La limpieza es una decision de datos, no de codigo: esta sonda no escribe nada.');
  }

  log('');
  log(fallos
    ? 'LISTA_PRECIOS_COMPONENTE: ' + fallos + ' aviso(s). Revisa el punto 1.'
    : 'LISTA_PRECIOS_COMPONENTE: RULE-REP-022 desplegado.');
}
