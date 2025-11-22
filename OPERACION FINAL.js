function getManufacturingOperationsToSheet() {
  try {
    // ----------------------------------------------------------
    // CONFIGURACIÓN DE AUTENTICACIÓN
    // ----------------------------------------------------------
    NetSuiteOAuthTest.init({
      accountId: '11103874',
      consumerKey: 'c2178cf81c17b74d187db8490b848042a4ed8c0ccb2f987e325723e0574e7b39',
      consumerSecret: '737123dfad89026db69b835eae32b1e8b0e8ae243522097d40b7e1f7ac2438a4',
      token: '033e065a47898ae2695f6f5a9bfb4d19618e59ebc767b5ca0a334bcea7530a12',
      tokenSecret: 'ca633e50878d1d459de4b6e0a60079f792b288a2609e5807f09543146850d15b'
    });

    // ----------------------------------------------------------
    // CONSULTA SUITEQL
    // ----------------------------------------------------------
    const sql = `
      SELECT
        mot.id AS id,
        mot.title AS operacion,
        mot.workorder AS orden_trabajo,
        mot.operationsequence AS secuencia,
        mot.startdatetime AS fecha_inicio_programada,
        mot.enddate AS fecha_fin_programada,
        mot.status AS estado,
        mot.manufacturingworkcenter AS centro_trabajo,
        mot.setuptime AS tiempo_preparacion,
        mot.estimatedwork AS tiempo_estimado,
        mot.actualwork AS tiempo_real,
        mot.remainingwork AS trabajo_restante,
        mot.runrate AS tasa_produccion,
        mot.laborresources AS recurso_humano,
        mot.machineresources AS recurso_maquina,
        mot.startdatetime AS fecha_inicio_real,
        mot.enddate AS fecha_fin_real,
        mot.completedquantity AS cantidad_realizada
      FROM manufacturingOperationTask mot
      ORDER BY mot.workorder, mot.operationsequence
    `;

    const resultados = NetSuiteOAuthTest.querySuiteQL(sql);

    if (!resultados || resultados.length === 0) {
      Logger.log('⚠️ No se encontraron operaciones.');
      return;
    }

    // ----------------------------------------------------------
    // PREPARAR HOJA DE CÁLCULO
    // ----------------------------------------------------------
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = 'Operaciones programadas';
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);
    sheet.clearContents();

    const headers = [
      'ID (link)',
      'Operación',
      'Orden de trabajo',
      'Secuencia',
      'Fecha inicio programada',
      'Fecha fin programada',
      'Estado',
      'Centro de trabajo',
      'Tiempo preparación (min)',
      'Tiempo estimado (min)',
      'Tiempo real (min)',
      'Trabajo restante (min)',
      'Tasa producción',
      'Recurso humano',
      'Recurso máquina',
      'Fecha inicio real',
      'Fecha fin real',
      'Cantidad realizada'
    ];

    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');

    // ----------------------------------------------------------
    // MAPEO DE DATOS CON AJUSTES
    // ----------------------------------------------------------
    const data = resultados.map(r => {
      const estado = (r.estado || '').toUpperCase();

      // ✅ Hipervínculo con número de orden de trabajo como texto
      const link = r.orden_trabajo
        ? `=HYPERLINK("https://11103874.app.netsuite.com/app/accounting/transactions/workord.nl?id=${r.orden_trabajo}","${r.orden_trabajo}")`
        : '';

      // ✅ Solo mostrar fecha real si el estado es PROGRESS o COMPLETE
      const fechaInicioReal =
        estado === 'PROGRESS' || estado === 'COMPLETE' ? (r.fecha_inicio_real || '') : '';
      const fechaFinReal =
        estado === 'COMPLETE' ? (r.fecha_fin_real || '') : '';

      return [
        link,
        r.operacion || '',
        r.orden_trabajo || '',
        r.secuencia || '',
        r.fecha_inicio_programada || '',
        r.fecha_fin_programada || '',
        estado,
        r.centro_trabajo || '',
        r.tiempo_preparacion || '',
        r.tiempo_estimado || '',
        r.tiempo_real || '',
        r.trabajo_restante || '',
        r.tasa_produccion || '',
        r.recurso_humano || '',
        r.recurso_maquina || '',
        fechaInicioReal,
        fechaFinReal,
        r.cantidad_realizada || ''
      ];
    });

    sheet.getRange(2, 1, data.length, headers.length).setValues(data);
    sheet.autoResizeColumns(1, headers.length);
    sheet.setFrozenRows(1);

    Logger.log(`✅ ${data.length} operaciones exportadas a "${sheetName}".`);

  } catch (error) {
    Logger.log(`❌ Error exportando a Sheets: ${error}`);
  }
}
