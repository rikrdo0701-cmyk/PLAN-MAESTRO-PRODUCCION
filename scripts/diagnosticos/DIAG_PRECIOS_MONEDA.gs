/**
 * DIAG_PRECIOS_MONEDA - averigua, con las filas CRUDAS del 1766, en que moneda viene
 * PRECIO BASE MNX para cada articulo. Es la unica forma de saber si la multiplicacion por
 * TIPO CAMBIO toca o duplica.
 *
 * POR QUE HACE FALTA. El 2026-09-26 el usuario reporto montos inflados. Con los datos del
 * estado: TR 350 sale en 280.65 contra un precio real de factura de 273-304, o sea CORRECTO
 * (su TIPO CAMBIO debe estar cerca de 1 o el crudo viene en dolares). M66-8602 sale en
 * 24 606.67 contra un precio real de 1 378.71: 17.85x, o sea el crudo venia YA EN PESOS y
 * la multiplicacion lo duplico. Los dos pasan por la misma formula, asi que la columna no
 * significa lo mismo en las dos filas.
 *
 * QUE HACE, por cada ARTICULO que se le pida:
 *   1. Volca las columnas crudas de las filas de REQ_FIFO de ese articulo: PARTE,
 *      _ITEM_ID, PRECIO BASE MNX, MONEDA, TIPO CAMBIO, CANTIDAD ORDEN, FECHA DE ORDEN,
 *      TAX AMOUNT y GROSS AMT.
 *   2. Cierra la cuenta del renglon: PRECIO x CANTIDAD, y PRECIO x CANTIDAD x 1.16 contra
 *      TAX AMOUNT y GROSS AMT. Si cierra con el CRUDO, los tres campos vienen en la misma
 *      moneda entre si; eso NO dice cual, asi que se contrasta contra el precio real.
 *   3. Hace la prueba que decide: si el CRUDO por TIPO CAMBIO se parece al PRECIO REAL DE
 *      FACTURA que se le pasa por parametro, el crudo viene en dolares y multiplicar es
 *      correcto. Si lo que se parece al precio real es el CRUDO SIN multiplicar, entonces el
 *      crudo ya venia en pesos y multiplicar lo duplica.
 *   4. Dice cuantas filas del articulo tienen TIPO CAMBIO > 1 y de que fecha es la ultima
 *      venta, que es la fila que gana para lastSalePrice.
 *
 * SOLO LECTURA: llama unicamente a PP_fetchRestletPages_ sobre el 1766, que es un UrlFetch
 * de lectura. NO llama a syncNetSuiteWorkOrdersLite ni a syncNetSuiteData, que podan la cola
 * del plan y escriben en la hoja. Costo: el 1766 son 6671 filas con tope real de pageSize
 * 1000, o sea 7 llamadas, y la cuenta es de consumidor con 20 000 UrlFetch/dia. Correla una
 * vez, no en bucle.
 *
 * COMO CORRERLA: pega este archivo en el editor de Apps Script, guardalo y ejecuta
 * DIAG_PRECIOS_MONEDA. Pega el registro completo.
 */

function DIAG_PRECIOS_MONEDA() {
  var log = function (m) { Logger.log(String(m)); };
  var fallos = 0;

  // PRECIO REAL DE FACTURA, deducido de las pantallas del usuario. Es la unica referencia
  // externa: el 1766 no trae facturas, solo ordenes de venta.
  var REFERENCIA = [
    { parte: 'TR 350', real: 273.00, nota: 'facturas INV2563/2501/2454 a $273.00 y INV2420/2399/2398 a $304.00; promedio mostrado $279.20' },
    { parte: 'M66-8602', real: 1378.71, nota: 'factura INV2244, 13 pzas, $17 923.23, o sea $1 378.71 por pieza' }
  ];

  var config;
  try {
    config = PP_netSuiteConfig_();
    log('1) credenciales: presentes (cuenta terminada en ' + String(config.accountId || '').slice(-4) + ')');
  } catch (e1) {
    log('1) credenciales -> EXCEPCION ' + String(e1 && e1.message || e1));
    return;
  }

  var rows = [];
  try {
    var t0 = new Date().getTime();
    var page = PP_fetchRestletPages_({ script: '1766', deploy: '1' }, { table: 'REQ_FIFO' }, config, 100);
    rows = (page && page.rows) || [];
    log('2) 1766 REQ_FIFO: ' + rows.length + ' filas en ' + Math.round((new Date().getTime() - t0)) + ' ms');
    if (!rows.length) { log('   0 filas: nada que verificar.'); return; }
  } catch (e2) {
    log('2) 1766 -> EXCEPCION ' + String(e2 && e2.message || e2));
    return;
  }

  var pick = function (row, names) {
    for (var i = 0; i < names.length; i += 1) {
      var v = row ? row[names[i]] : null;
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return null;
  };
  var norm = function (v) {
    return String(v == null ? '' : v).trim().toUpperCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
  };
  var dosDec = function (v) { return Math.round(Number(v) * 100) / 100; };

  REFERENCIA.forEach(function (ref) {
    var clave = norm(ref.parte);
    var propias = rows.filter(function (row) {
      return norm(pick(row, ['PARTE', '_ITEM_NAME', 'item_name', 'Articulo', 'Item', 'ITEM'])) === clave;
    });

    log('');
    log('================================================================');
    log('ARTICULO ' + ref.parte + '   precio real de factura: ' + ref.real);
    log('  ' + ref.nota);
    log('  filas en REQ_FIFO: ' + propias.length);

    if (!propias.length) {
      log('  AVISO: ninguna fila de este articulo. Puede que el nombre en REQ_FIFO sea otro;');
      log('          busca la parte en el catalogo de operaciones para ver como viene escrita.');
      return;
    }

    var conCambio = propias.filter(function (row) {
      return Number(pick(row, ['TIPO CAMBIO', 'tipo_cambio']) || 0) > 1.0000001;
    });
    log('  filas con TIPO CAMBIO > 1: ' + conCambio.length + ' de ' + propias.length);

    // Se ordenan por fecha, de la mas nueva a la mas vieja, que es como gana lastSalePrice.
    var conFecha = propias.map(function (row) {
      return {
        row: row,
        fecha: PP_parseRestletDate_(pick(row, ['FECHA DE ORDEN', 'fecha_orden'])),
        crudo: Number(pick(row, ['PRECIO BASE MNX', 'precio_base_mnx']) || 0),
        rate: Number(pick(row, ['TIPO CAMBIO', 'tipo_cambio']) || 0),
        qty: Number(pick(row, ['CANTIDAD ORDEN', 'cantidad_orden']) || 0),
        tax: Number(pick(row, ['TAX AMOUNT', 'tax_amount']) || 0),
        gross: Number(pick(row, ['GROSS AMT', 'gross_amt']) || 0),
        moneda: String(pick(row, ['MONEDA', 'moneda', 'CURRENCY', 'currency']) || '')
      };
    }).filter(function (x) { return x.fecha && !isNaN(x.fecha.getTime()) && x.crudo > 0; });
    conFecha.sort(function (a, b) { return b.fecha.getTime() - a.fecha.getTime(); });

    if (!conFecha.length) {
      log('  AVISO: ninguna fila con fecha legible y precio mayor a 0.');
      return;
    }

    var ultima = conFecha[0];
    var multiplicado = ultima.crudo * ultima.rate;

    log('');
    log('  ULTIMA VENTA (la fila que gana para lastSalePrice):');
    log('    fecha              : ' + ultima.fecha);
    log('    MONEDA             : ' + ultima.moneda);
    log('    PRECIO BASE MNX    : ' + ultima.crudo);
    log('    TIPO CAMBIO        : ' + ultima.rate);
    log('    CANTIDAD ORDEN     : ' + ultima.qty);
    log('    TAX AMOUNT         : ' + ultima.tax);
    log('    GROSS AMT          : ' + ultima.gross);

    // Cierre de la cuenta del renglon: si el 16% cuadra contra el CRUDO, los tres campos
    // vienen en la misma moneda entre si. No dice cual, por eso hace falta la referencia.
    if (ultima.qty > 0) {
      var base = ultima.crudo * ultima.qty;
      var conImpuesto = base * 1.16;
      log('');
      log('    CIERRE DEL RENGLON (IVA 16%):');
      log('      PRECIO x CANTIDAD           = ' + dosDec(base));
      log('      PRECIO x CANTIDAD x 1.16    = ' + dosDec(conImpuesto));
      log('      TAX AMOUNT que trae el 1766 = ' + dosDec(ultima.tax));
      log('      GROSS AMT que trae el 1766  = ' + dosDec(ultima.gross));
      var difTax = ultima.tax > 0 ? Math.abs(ultima.tax - conImpuesto) / ultima.tax : 1;
      var difGross = ultima.gross > 0 ? Math.abs(ultima.gross - conImpuesto) / ultima.gross : 1;
      log('      diferencia relativa contra TAX : ' + Math.round(difTax * 100) + '%');
      log('      diferencia relativa contra GROSS: ' + Math.round(difGross * 100) + '%');
      if (difTax < 0.01 && difGross < 0.01) {
        log('      -> CIERRA con el CRUDO sin multiplicar: las tres columnas vienen en la');
        log('         misma moneda. Falta deciding cual, y eso lo decide la prueba de abajo.');
      } else if (ultima.rate > 1 && ultima.gross > 0
        && Math.abs(ultima.gross - conImpuesto * ultima.rate) / ultima.gross < 0.01) {
        log('      -> CIERRA con el CRUDO MULTIPLICADO por TIPO CAMBIO.');
      } else {
        log('      -> NO cierra ni con el crudo ni con el crudo multiplicado. El renglon tiene');
        log('         otra cosa (descuentos, flete u otro impuesto): NO saques conclusiones');
        log('         de este renglon, usa el promedio de las filas de abajo.');
      }
    }

    // LA PRUEBA QUE DECIDE, con las dos monedas candidatas contra el precio real.
    log('');
    log('    PRUEBA DECISIVA (contra el precio real de factura ' + ref.real + '):');
    var candidatoMult = multiplicado;
    var candidatoCrado = ultima.crudo;
    var errMult = Math.abs(candidatoMult - ref.real) / ref.real;
    var errCrado = Math.abs(candidatoCrado - ref.real) / ref.real;
    log('      A) CRUDO x TIPO CAMBIO = ' + dosDec(candidatoMult) +
      '   error ' + Math.round(errMult * 100) + '%');
    log('      B) CRUDO sin multiplicar = ' + dosDec(candidatoCrado) +
      '   error ' + Math.round(errCrado * 100) + '%');
    if (errMult < 0.10 && errCrado < 0.10) {
      log('      -> inconcluyente con una sola venta: los dos candidatos son parecidos.');
      log('         Mira el promedio de 6 meses de abajo antes de concluir.');
    } else if (errMult < 0.10) {
      log('      -> VEREDICTO: el crudo viene en MONEDA EXTRANJERA y multiplicar por');
      log('         TIPO CAMBIO es lo correcto para este articulo.');
    } else if (errCrado < 0.10) {
      log('      -> VEREDICTO: el crudo YA VENIA EN PESOS. Multiplicar por TIPO CAMBIO lo');
      log('         DUPLICA. El precio que la app usaria es ' + dosDec(candidatoMult) +
        ', o sea ' + Math.round(candidatoMult / ref.real) + 'x el precio real de ' + ref.real + '.');
      fallos += 1;
    } else {
      log('      -> NINGUNO de los dos candidatos coincide. O el precio real que se paso no');
      log('         es de este articulo, o hay una tercera fuente. NO concluyas todavia.');
    }

    // Promedio de 6 meses, que es lo que va a los reportes.
    var ventana = '2026-03-26';
    var corte = new Date(ventana + 'T00:00:00');
    var enVentana = conFecha.filter(function (x) { return x.fecha.getTime() >= corte.getTime() && x.qty > 0; });
    if (enVentana.length) {
      var sumC = 0; var sumM = 0; var sumQ = 0;
      enVentana.forEach(function (x) {
        sumC += x.crudo * x.qty; sumM += x.crudo * x.rate * x.qty; sumQ += x.qty;
      });
      var promC = sumC / sumQ;
      var promM = sumM / sumQ;
      log('');
      log('    PROMEDIO de ' + enVentana.length + ' venta(s) en la ventana (lo que va a los reportes):');
      log('      sin multiplicar : ' + dosDec(promC) + '   error ' + Math.round(Math.abs(promC - ref.real) / ref.real * 100) + '%');
      log('      multiplicado    : ' + dosDec(promM) + '   error ' + Math.round(Math.abs(promM - ref.real) / ref.real * 100) + '%');
    } else {
      log('');
      log('    No hay ventas en la ventana de 6 meses.');
    }

    // Las 6 ventas mas recientes, para que se vea si el patron es consistente.
    log('');
    log('    LAS 6 VENTAS MAS RECIENTES:');
    conFecha.slice(0, 6).forEach(function (x) {
      var eM = Math.abs(x.crudo * x.rate - ref.real) / ref.real;
      var eC = Math.abs(x.crudo - ref.real) / ref.real;
      log('      ' + x.fecha + '  ' + String(x.moneda).padEnd(12) +
        '  crudo ' + dosDec(x.crudo) + '  cambio ' + x.rate +
        '  -> multiplicado ' + dosDec(x.crudo * x.rate) +
        '   (cerca del real: mult ' + Math.round(eM * 100) + '%, crudo ' + Math.round(eC * 100) + '%)');
    });
  });

  log('');
  log(fallos
    ? 'DIAG_PRECIOS_MONEDA: ' + fallos + ' articulo(s) con el crudo YA EN PESOS. La multiplicacion por TIPO CAMBIO los duplica.'
    : 'DIAG_PRECIOS_MONEDA: ningun articulo con el crudo en pesos. Pega el registro completo igual.');
}
