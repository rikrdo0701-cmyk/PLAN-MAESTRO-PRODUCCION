function exportarInventario() {
  NetSuiteOAuth.init({
    accountId: '11103874',
    consumerKey: 'c2178cf81c17b74d187db8490b848042a4ed8c0ccb2f987e325723e0574e7b39',
    consumerSecret: '737123dfad89026db69b835eae32b1e8b0e8ae243522097d40b7e1f7ac2438a4',
    token: '033e065a47898ae2695f6f5a9bfb4d19618e59ebc767b5ca0a334bcea7530a12',
    tokenSecret: 'ca633e50878d1d459de4b6e0a60079f792b288a2609e5807f09543146850d15b'
  });

  const url = 'https://11103874.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql';
  const body = {
    q: `SELECT item.itemid, item.purchaseDescription AS descripcion,
               item.location AS ubicacion,
               SUM(inventorybalance.quantityavailable) AS inventario_disponible_total, 
               SUM(inventorybalance.quantityonhand) AS inventario_fisico_total, 
               MAX(item.lastmodifieddate) AS lastmodifieddate
        FROM item 
        LEFT JOIN inventorybalance ON item.id = inventorybalance.item 
        WHERE item.isinactive = 'F' AND item.itemtype IN ('Assembly','InvtPart') 
        GROUP BY item.itemid, item.purchaseDescription, item.location
        ORDER BY item.itemid`
  };

  try {
    const response = NetSuiteOAuth.request('POST', url, null, body, { 'Prefer': 'transient' });

    if (!response.items || response.items.length === 0) {
      Logger.log('No se encontraron artículos.');
      return;
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    sheet.clear();

    const headers = ['itemid', 'descripcion', 'inventario_disponible_total', 'inventario_fisico_total', 'lastmodifieddate', 'ubicacion'];
    sheet.appendRow(headers);

    const data = response.items.map(item => {
      let fecha = '';
      if (item.lastmodifieddate) {
        const d = new Date(item.lastmodifieddate);
        if (!isNaN(d.getTime())) {
          fecha = ('0'+d.getDate()).slice(-2)+'/'+('0'+(d.getMonth()+1)).slice(-2)+'/'+d.getFullYear();
        }
      }
      return [
        item.itemid || '',
        item.descripcion || item.itemid || '',
        item.inventario_disponible_total || 0,
        item.inventario_fisico_total || 0,
        fecha,
        item.ubicacion || ''
      ];
    });

    sheet.getRange(2,1,data.length,headers.length).setValues(data);
    Logger.log('Importación completa. Artículos: ' + data.length);

  } catch(e) {
    Logger.log('Excepción: ' + e);
  }
}
