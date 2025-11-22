function getWorkOrdersTable() {
  try {
    Logger.log("🚀 Iniciando extracción de Órdenes de Trabajo (REST Record API)...");

    // 1️⃣ Inicializar credenciales NetSuite OAuth
    NetSuiteOAuthTest.init({
      accountId: '11103874',
      consumerKey: 'c2178cf81c17b74d187db8490b848042a4ed8c0ccb2f987e325723e0574e7b39',
      consumerSecret: '737123dfad89026db69b835eae32b1e8b0e8ae243522097d40b7e1f7ac2438a4',
      token: '033e065a47898ae2695f6f5a9bfb4d19618e59ebc767b5ca0a334bcea7530a12',
      tokenSecret: 'ca633e50878d1d459de4b6e0a60079f792b288a2609e5807f09543146850d15b'
    });

    // 2️⃣ Obtener lista de Work Orders
    const endpoint = '/services/rest/record/v1/workorder';
    const resp = NetSuiteOAuthTest.request('GET', endpoint);
    if (resp.status !== 200) throw new Error(`❌ Error ${resp.status}: ${resp.raw}`);

    const workOrders = resp.json.items || [];
    if (workOrders.length === 0) {
      Logger.log('⚠️ No se encontraron órdenes de trabajo.');
      return;
    }

    // 3️⃣ Preparar hoja
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Trabajos programados') || ss.insertSheet('Trabajos programados');
    sheet.clearContents();
    const headers = [
      'Folio de trabajo (link)',
      'Artículo',
      'Cantidad',
      'Estado',
      'Fecha inicio de producción',
      'Fecha finalización de producción',
      'Ubicación',
      'ID Interno'
    ];
    sheet.appendRow(headers);

    // 4️⃣ Recorrer cada WorkOrder
    workOrders.forEach((wo) => {
      const href = wo.links && wo.links[0] ? wo.links[0].href : null;
      if (!href) return;

      const detail = NetSuiteOAuthTest.request('GET', href);
      if (detail.status !== 200) {
        Logger.log(`⚠️ Error obteniendo detalle de WO ${wo.id}: ${detail.status}`);
        return;
      }

      const d = detail.json;
      const ubicacion = d.location?.refName || '';
      const estado = d.status?.refName || '';

      // 🔍 FILTRO: solo "PLANTA : Planta MM del Llano" y estado distinto a "cerrada"
      if (ubicacion === 'PLANTA : Planta MM del Llano' && estado.toLowerCase() !== 'cerrada') {
        const uiLink = `https://11103874.app.netsuite.com/app/accounting/transactions/transaction.nl?id=${d.id}`;
        const numeroOrden = d.tranId || `WO-${d.id}`; // usar tranId o id como respaldo

        const row = [
          `=HYPERLINK("${uiLink}","${numeroOrden}")`,
          d.assemblyItem?.refName || 'Desconocido',
          d.quantity || '',
          estado,
          d.actualProductionStartDate || '',
          d.endDate || '',
          ubicacion,
          d.id || '' // ✅ ID Interno
        ];
        sheet.appendRow(row);
      }

      Utilities.sleep(300); // evitar throttling
    });

    Logger.log('✅ Extracción completada con filtro, enlaces UI y columna de ID interno.');

  } catch (err) {
    Logger.log(`❌ Error ejecutando extracción: ${err.message}`);
  }
}
