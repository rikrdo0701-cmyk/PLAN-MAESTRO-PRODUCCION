/**
 * VERIFICA_PRODUCCION - comprobacion posterior al deploy, contra el backend REAL.
 *
 * Por que: el deploy es automatico (.github/workflows/deploy-appscript.yml corre `clasp push`
 * y luego `clasp deploy --deploymentId` sobre el deployment de produccion), asi que no basta
 * con que el commit este en main: hay que confirmar que la version publicada ya trae los
 * cambios. Esta sonda se pega en el editor de Apps Script y llama a las funciones del mismo
 * proyecto, que es la unica forma de pegarle al backend real.
 *
 * SOLO LECTURA: llama unicamente a getDeploymentStatus, getAppStateIfChanged(0) y
 * fetchNetSuiteWorkOrdersLite, que no escriben nada. NO llama a syncNetSuiteWorkOrdersLite ni a
 * syncNetSuiteData: esas PODAN la cola del plan y guardan en la hoja, y una sonda no debe
 * escribir en produccion.
 *
 * QUE COMPRUEBA:
 *   1. Que el deployment responde.
 *   2. Que el estado trae catalogo de operaciones y maquinas (los que la app usa para abrir el
 *      dialogo de preparacion). Antes de RULE-REP-017/019 esto se reviso en el arranque; aqui
 *      se confirma que el backend los entrega.
 *   3. Que el 2240 responde con filas y que las OTs ya traen PRECIO en la respuesta.
 *   4. Si el precio en otra moneda ya se convierte: se buscan precios sospechosamente altos
 *      (arriba de un millon de pesos), que solo pueden venir de una venta en dolares YA
 *      convertida con TIPO CAMBIO. Antes llegaban ~18x mas bajos (RULE-REP-018).
 *
 * COMO CORRERLA: pega este archivo en el editor de Apps Script, guardalo y ejecuta
 * VERIFICA_PRODUCCION. Pega el registro de ejecucion completo.
 */

function VERIFICA_PRODUCCION() {
  var log = function (message) { Logger.log(String(message)); };
  var fallos = 0;

  // 1) El deployment.
  try {
    var status = getDeploymentStatus();
    log('1) deployment: appVersion=' + String(status && status.appVersion) +
      ' schemaVersion=' + String(status && status.schemaVersion) +
      ' netSuite=' + String(status && status.netSuiteConfigured) +
      ' spreadsheet=' + String(status && status.spreadsheetConfigured));
  } catch (error1) {
    log('1) deployment -> EXCEPCION ' + String(error1 && error1.message || error1));
    fallos += 1;
  }

  // 2) El estado completo: debe traer operacionCatalog y machines, que son los catalogos que
  //    la app necesita para abrir la preparacion de una OT de doblado.
  var estado = null;
  try {
    estado = getAppStateIfChanged(0, { includeMaterials: false });
    log('2) estado: revision=' + String(estado && estado.revision) +
      ' operaciones=' + ((estado && estado.operations) || []).length +
      ' OTs=' + ((estado && estado.workOrders) || []).length +
      ' enPlan=' + ((estado && estado.selectedOts) || []).length);
    log('   catalogo de operaciones=' + ((estado && estado.operationCatalog) || []).length +
      '  maquinas=' + ((estado && estado.machines) || []).length +
      '  herramental=' + ((estado && estado.toolCatalog) || []).length +
      '  subcontratos=' + ((estado && estado.subcontracts) || []).length);
    if (!((estado && estado.machines) || []).length) {
      log('   AVISO: el backend no trae maquinas. Si ademas se ve "Sin maquinas');
      log('          configuradas" en Catalogos, el dialogo de doblado no se puede llenar.');
    }
  } catch (error2) {
    log('2) estado -> EXCEPCION ' + String(error2 && error2.message || error2));
    fallos += 1;
  }

  // 3) El 2240 en vivo: filas y precios.
  try {
    var lite = fetchNetSuiteWorkOrdersLite();
    var ots = (lite && lite.workOrders) || [];
    log('3) 2240 en vivo: ' + ots.length + ' OTs abiertas');
    var conPrecio = 0;
    var muyAltos = 0;
    var maximo = 0;
    var ejemplo = null;
    ots.forEach(function (ot) {
      var precio = Number(ot.lastSalePrice || 0);
      if (precio > 0) {
        conPrecio += 1;
        if (precio > maximo) {
          maximo = precio;
          ejemplo = { ot: ot.ot, item: ot.item, precio: precio, promedio: Number(ot.averageSalePrice || 0) };
        }
        if (precio > 1000000) muyAltos += 1;
      }
    });
    log('   con precio de venta: ' + conPrecio + ' de ' + ots.length);
    log('   precio maximo: ' + Math.round(maximo) + '  ejemplo: ' + JSON.stringify(ejemplo));
    if (muyAltos > 0) {
      log('   -> ' + muyAltos + ' precio(s) arriba de 1,000,000: el TIPO CAMBIO parece aplicado');
    } else {
      log('   AVISO: ningun precio supera el millon. Puede ser que no haya ventas en otra');
      log('          moneda entre las OTs abiertas, o que la venta en dolares todavia no haya');
      log('          entrado. Para confirmarlo, toma un articulo que se vendio en dolares y');
      log('          compara su precio contra el real.');
    }
  } catch (error3) {
    log('3) 2240 en vivo -> EXCEPCION ' + String(error3 && error3.message || error3));
    fallos += 1;
  }

  log('');
  log(fallos
    ? 'VERIFICA_PRODUCCION: ' + fallos + ' fallo(s) grave(s). Revisa el detalle de arriba.'
    : 'VERIFICA_PRODUCCION: sin fallos graves. Pega el registro completo.');
}
