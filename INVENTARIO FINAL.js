// ======================================================================
//  🔐 CONFIGURAR AUTENTICACIÓN
// ======================================================================
NetSuiteOAuthTest.init({
  accountId: '11103874',
  consumerKey: 'c2178cf81c17b74d187db8490b848042a4ed8c0ccb2f987e325723e0574e7b39',
  consumerSecret: '737123dfad89026db69b835eae32b1e8b0e8ae243522097d40b7e1f7ac2438a4',
  token: '033e065a47898ae2695f6f5a9bfb4d19618e59ebc767b5ca0a334bcea7530a12',
  tokenSecret: 'ca633e50878d1d459de4b6e0a60079f792b288a2609e5807f09543146850d15b'
});

// ======================================================================
//  📦 FUNCIÓN: EXPORTAR INVENTARIO A GOOGLE SHEETS
// ======================================================================
function exportarInventarioTotal() {
  try {
    const sql = `
      SELECT
        ib.item AS id_articulo,
        i.itemid AS articulo,
        COALESCE(i.displayname, i.purchasedescription, i.description) AS descripcion,
        l.name AS ubicacion,
        ib.quantityavailable AS cantidad_disponible,
        ib.quantityonhand AS cantidad_fisica,
        ib.committedqtyperlocation AS cantidad_comprometida,
        ib.quantitypicked AS cantidad_pickeada,
        0 AS cantidad_en_transito,
        TO_CHAR(ib.lastmodifieddate, 'DD/MM/YYYY') AS ultima_modificacion,
        (
          SELECT MAX(iph.price)
          FROM invtitempricehistory iph
          WHERE iph.item = i.id
        ) AS precio
      FROM inventorybalance ib
      JOIN item i ON i.id = ib.item
      JOIN location l ON l.id = ib.location
      WHERE l.name = 'Planta MM del Llano'
      ORDER BY i.itemid
    `;

    // Ejecutar consulta SuiteQL con el módulo OAuth
    const resultados = NetSuiteOAuthTest.querySuiteQL(sql);

    if (!resultados || resultados.length === 0) {
      Logger.log('⚠️ No se encontraron datos para exportar.');
      return;
    }

    // Crear o limpiar hoja
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = 'Inventario Total';
    const sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
    sheet.clear();

    // Encabezados
    const headers = [
      'ID Artículo', 'Artículo', 'Descripción', 'Ubicación',
      'Disponible', 'Física', 'Comprometida', 'Pickeada',
      'En Tránsito', 'Última Modificación', 'Precio'
    ];
    sheet.appendRow(headers);

    // Filas
    resultados.forEach(r => {
      sheet.appendRow([
        r.id_articulo || '',
        r.articulo || '',
        r.descripcion || '',
        r.ubicacion || '',
        r.cantidad_disponible || 0,
        r.cantidad_fisica || 0,
        r.cantidad_comprometida || 0,
        r.cantidad_pickeada || 0,
        r.cantidad_en_transito || 0,
        r.ultima_modificacion || '',
        r.precio || 0
      ]);
    });

    // Dar formato de tabla
    const range = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn());
    range.setFontFamily('Arial');
    range.setFontSize(10);
    range.setBorder(true, true, true, true, true, true);
    range.setHorizontalAlignment('center');
    sheet.getRange('A1:K1').setFontWeight('bold').setBackground('#d9e1f2');

    // Formato moneda a la columna Precio
    const lastRow = sheet.getLastRow();
    sheet.getRange(`K2:K${lastRow}`).setNumberFormat('$#,##0.00');

    Logger.log(`✅ Exportación completada (${resultados.length} registros).`);
  } catch (err) {
    Logger.log('❌ Error en exportarInventarioTotal: ' + err);
  }
}

  function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('📦 NetSuite')
    .addItem('OPERACIONES ACT', 'getManufacturingOperationsToSheet')
    .addItem('Actualizar INVENTARIO', 'exportarInventarioTotal')
    .addItem('Actualizar TRABAJOS', 'getWorkOrdersTable')
    .addItem('Actualizar MATERIALES', 'exportMaterials')
    .addItem('Actualizar FESTIVOS', 'getWorkHolidays')
    .addSeparator()
    .addItem('🧩 Actualizar TODO', 'actualizarTodo')
    .addToUi();
}
function actualizarTodo() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  ui.alert("🚀 Iniciando actualización completa desde NetSuite...");

  try {
    ss.toast("🔧 Actualizando operaciones...", "Progreso");
    getManufacturingOperationsToSheet();

    ss.toast("📦 Actualizando inventario...", "Progreso");
    exportarInventarioTotal();

    ss.toast("🧾 Actualizando trabajos...", "Progreso");
    getWorkOrdersTable();

    ss.toast("⚙️ Actualizando materiales...", "Progreso");
    exportMaterials();

    ss.toast("⚙️ Actualizando FESTIVOS...", "Progreso");
    getWorkHolidays()
    ss.toast("⚙️ Actualizando materiales...", "Progreso");
    exportMaterials();

    ss.toast("✅ Actualización completa", "Finalizado", 5);
    ui.alert("✅ Todo actualizado correctamente.");
  } catch (e) {
    ss.toast("❌ Error en la actualización", "Error", 5);
    ui.alert("❌ Error durante la actualización:\n" + e.message);
  }
}
