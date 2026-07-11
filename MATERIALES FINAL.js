function exportMaterials() {
  // ============================================================
  // 🔐 Inicialización de conexión con NetSuite vía OAuth1
  // ============================================================
  NetSuiteOAuthTest.init({
    accountId: '11103874',
    consumerKey: 'c2178cf81c17b74d187db8490b848042a4ed8c0ccb2f987e325723e0574e7b39',
    consumerSecret: '737123dfad89026db69b835eae32b1e8b0e8ae243522097d40b7e1f7ac2438a4',
    token: '033e065a47898ae2695f6f5a9bfb4d19618e59ebc767b5ca0a334bcea7530a12',
    tokenSecret: 'ca633e50878d1d459de4b6e0a60079f792b288a2609e5807f09543146850d15b'
  });

  // ============================================================
  // 📊 Configuración de hoja de cálculo
  // ============================================================
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = 'Materiales programados';
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  sheet.clear();

  const headers = ['ID', 'Artículo', 'Material', 'Descripción', 'Cantidad', 'Emitido', 'Pendiente por emitir'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // ============================================================
  // 📦 Obtener lista de Work Orders
  // ============================================================
  const listUrl = '/services/rest/record/v1/workorder';
  const listResult = NetSuiteOAuthTest.request('GET', listUrl);

  if (listResult.status !== 200) {
    Logger.log('❌ Error HTTP: ' + listResult.status);
    Logger.log(listResult.raw);
    return;
  }

  const listData = listResult.json;
  if (!listData.items || listData.items.length === 0) {
    Logger.log('❌ No se encontraron workorders.');
    return;
  }

  // ============================================================
  // 🔄 Procesamiento de materiales (componentes BOM)
  // ============================================================
  let batch = [];
  const batchSize = 100;
  let totalItems = 0;

  for (let i = 0; i < listData.items.length; i++) {
    try {
      const workorder = listData.items[i];
      const workorderHref = workorder.links?.find(l => l.rel === 'self')?.href;
      if (!workorderHref) continue;

      const detailResult = NetSuiteOAuthTest.request('GET', workorderHref);
      if (detailResult.status !== 200) continue;

      const workorderData = detailResult.json;
      const bomRevisionHref = workorderData.billOfMaterialsRevision?.links?.find(l => l.rel === 'self')?.href;
      if (!bomRevisionHref) continue;

      const bomRevisionResult = NetSuiteOAuthTest.request('GET', bomRevisionHref + '/component');
      if (bomRevisionResult.status !== 200) continue;

      const componentsData = bomRevisionResult.json;
      if (!componentsData.items || componentsData.items.length === 0) continue;

      for (const comp of componentsData.items) {
        const compDetailHref = comp.links?.find(l => l.rel === 'self')?.href;
        if (!compDetailHref) continue;

        const compResult = NetSuiteOAuthTest.request('GET', compDetailHref);
        if (compResult.status !== 200) continue;

        const compData = compResult.json;
        const itemId = compData.item?.id;
        let descripcion = '';
        let emitido = 0;

        // 🔹 Obtener descripción del ítem
        if (itemId) {
          const itemResult = NetSuiteOAuthTest.request('GET', `/services/rest/record/v1/inventoryItem/${itemId}`);
          if (itemResult.status === 200) {
            const itemData = itemResult.json;
            descripcion = itemData.purchaseDescription || '';
          }
        }

        // 🔹 Consultar cantidad emitida
        if (itemId && workorderData.id) {
          const sql = `
            SELECT SUM(tl.quantity) AS total_emitido
            FROM transactionline tl
            JOIN transaction t ON t.id = tl.transaction
            WHERE tl.createdfrom = ${workorderData.id}
              AND tl.item = ${itemId}
              AND tl.quantity > 0
              AND t.type IN ('WOIssue', 'InvAdjst')
          `;
          try {
            const qRes = NetSuiteOAuthTest.querySuiteQL(sql);
            if (qRes && qRes.length > 0 && qRes[0].total_emitido !== null) {
              emitido = qRes[0].total_emitido;
            }
          } catch (errQuery) {
            Logger.log(`⚠️ Error al obtener emitido para item ${itemId} en WO ${workorderData.id}: ${errQuery.message}`);
          }
        }

        // 🔹 Calcular pendiente
        const cantidad = compData.quantity || 0;
        emitido = Number(emitido) || 0;  // 👈 asegura que sea número
        const pendiente = cantidad - emitido;

        batch.push([
          workorderData.tranId || '',                   // 🆔 TranID
          workorderData.assemblyItem?.refName || '',    // Artículo
          compData.item?.refName || '',                 // Material
          descripcion,                                  // Descripción
          cantidad,                                     // Cantidad total
          emitido,                                      // Emitido
          pendiente                                     // Pendiente por emitir
        ]);

        if (batch.length >= batchSize) {
          sheet.getRange(sheet.getLastRow() + 1, 1, batch.length, headers.length).setValues(batch);
          totalItems += batch.length;
          batch = [];
        }
      }
    } catch (err) {
      Logger.log(`⚠️ Error en workorder ${listData.items[i].id}: ${err.message}`);
    }
  }

  // ============================================================
  // 💾 Guarda último bloque de registros
  // ============================================================
  if (batch.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, batch.length, headers.length).setValues(batch);
    totalItems += batch.length;
  }

  Logger.log(`✅ Exportación completada. Total de registros: ${totalItems}`);
}
