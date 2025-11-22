/**
 * ======================================================================
 * 🔹 NetSuite – SuiteQL → Google Sheets (Versión FINAL con LÓGICA DE ESTADO)
 * ======================================================================
 * - FIX DE LÓGICA DE NEGOCIO: La columna "fecha_inicio_real_orden" ahora se filtra 
 * por el estado de la operación (mot.status). Si la operación está en 'NOTSTART', 
 * la fecha real se establece como NULL (vacía).
 * - Mantiene el FIX CRÍTICO de parseo de fecha.
 */
function getManufacturingOperationTasks() {
  try {
    Logger.log("🚀 Iniciando extracción de operaciones programadas...");

    // =====================================
    // 🔐 Inicializa autenticación NetSuite
    // =====================================
    // ATENCIÓN: Las credenciales son de EJEMPLO. Se deben usar las credenciales reales
    // de la biblioteca NetSuiteOAuthTest en tu entorno de Apps Script.
    NetSuiteOAuthTest.init({
      accountId: '11103874',
      consumerKey: 'c2178cf81c17b74d187db8490b848042a4ed8c0ccb2f987e325723e0574e7b39',
      consumerSecret: '737123dfad89026db69b835eae32b1e8b0e8ae243522097d40b7e1f7ac2438a4',
      token: '033e065a47898ae2695f6f5a9bfb4d19618e59ebc767b5ca0a334bcea7530a12',
      tokenSecret: 'ca633e50878d1d459de4b6e0a60079f792b288a2609e5807f09543146850d15b'
    });

    const accountId = '11103874'; // Usado para construir los hipervínculos

    // =====================================
    // 🧠 Consulta SuiteQL (Última versión estable con CASE)
    // =====================================
    const sql = `
      SELECT
        mot.workorder AS "workorder_id",
        wo.tranid AS "orden_trabajo",
        -- LÓGICA DE NEGOCIO: Si el estado es 'NOTSTART', la fecha real debe ser NULL.
        CASE
            WHEN mot.status = 'NOTSTART' THEN NULL
            ELSE COALESCE(
                wo.actualproductionstartdate, -- 1. Fecha real de inicio (cabecera WO)
                wo.startdate,                 -- 2. Fecha de inicio planificada (fallback de WO)
                wo.trandate,                  -- 3. Fecha de la transacción (fallback de WO)
                mot.startdatetime             -- 4. FALLBACK FINAL: Fecha de inicio de la Tarea de Operación
            )
        END AS "fecha_inicio_real_orden", 
        mot.id AS "id_operacion",
        mot.title AS "operacion",
        i.itemid AS "codigo_articulo",
        COALESCE(i.purchasedescription, i.displayname) AS "descripcion_articulo",
        mot.operationsequence AS "secuencia",
        mot.inputquantity AS "cantidad_planificada",
        mot.completedquantity AS "cantidad_completada",
        mot.status AS "estado",
        mot.actualsetuptime AS "tiempo_setup_real",
        mot.actualwork AS "tiempo_trabajo_real",
        mot.startdatetime AS "fecha_inicio",
        mot.enddate AS "fecha_final"
      FROM
        manufacturingoperationtask mot
        LEFT JOIN transaction wo ON wo.id = mot.workorder
        LEFT JOIN transactionline tl ON tl.transaction = mot.workorder AND tl.mainline = 'T'
        LEFT JOIN item i ON i.id = tl.item
      WHERE
        mot.workorder IS NOT NULL
      ORDER BY
        mot.startdatetime DESC,
        mot.operationsequence ASC
    `;

    const records = NetSuiteOAuthTest.querySuiteQL(sql);
    if (!records || records.length === 0) {
      Logger.log("⚠️ No se encontraron registros.");
      return;
    }

    // =====================================
    // 🧹 Limpiar / crear hoja
    // =====================================
    const sheetName = "Operaciones Programadas";
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(sheetName);
    if (sheet) ss.deleteSheet(sheet);
    sheet = ss.insertSheet(sheetName);

    // =====================================
    // 🔄 Preparación de datos y Hipervínculo
    // =====================================

    // Definimos los encabezados finales en el orden deseado
    const headers = [
      "orden de trabajo",
      "articulo",
      "descripcion articulo",
      "estado",
      "fecha inicio",
      "fecha inicio real orden", 
      "fecha final",
      "cantidad planificada",
      "cantidad completada",
      "secuencia",
      "operacion",
      "tiempo setup real",
      "tiempo trabajo real",
      "id operacion"
    ];

    // Función de formato de fecha
    const fmt = (date, columnName) => {
      if (!date) return "";

      let dateToParse = date;
      
      // FIX CRÍTICO: Si la fecha viene en formato local DD/MM/YYYY, JavaScript no la parseará.
      // La reordenamos a MM/DD/YYYY para una conversión segura.
      // Patrón: D(D)/M(M)/YYYY
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date)) {
          const parts = date.split('/');
          // parts[0] es Día, parts[1] es Mes, parts[2] es Año
          if (parts.length === 3) {
              dateToParse = `${parts[1]}/${parts[0]}/${parts[2]}`;
          }
      }

      try {
        const d = new Date(dateToParse);
        
        // Solo verifica si es una fecha válida (no NaN) y no una fecha Unix Epoch (1970)
        if (isNaN(d) || d.getFullYear() < 1971) {
              // Eliminamos el logging que ya no es necesario ya que el problema está resuelto
              return "";
        }
        
        return Utilities.formatDate(d, Session.getScriptTimeZone(), "dd/MM/yyyy");
      } catch (e) {
        Logger.log(`❌ ERROR FATAL DE FECHA para "${columnName || 'Fecha'}": "${date}". Error: ${e.message}`);
        return ""; 
      }
    };

    // Mapeo de datos para crear la matriz final (incluyendo el hipervínculo)
    const finalData = records.map(r => {
        // Generar URL para el hipervínculo
        const workorderLink = `https://${accountId}.app.netsuite.com/app/accounting/transactions/workord.nl?id=${r["workorder_id"]}`;
        
        // Crear la fórmula de Google Sheets para el hipervínculo
        // =HYPERLINK("URL", "Texto a mostrar")
        const linkedWorkorder = `=HYPERLINK("${workorderLink}", "${r["orden_trabajo"]}")`;

        // Crear fila en el orden de los 'headers'
        return [
            linkedWorkorder,
            r["codigo_articulo"] ?? "",
            r["descripcion_articulo"] ?? "",
            r["estado"] ?? "",
            // Pasamos el nombre de la columna para logging de depuración.
            fmt(r["fecha_inicio"], "fecha_inicio"), 
            fmt(r["fecha_inicio_real_orden"], "fecha_inicio_real_orden"), 
            fmt(r["fecha_final"], "fecha_final"),
            r["cantidad_planificada"] ?? "",
            r["cantidad_completada"] ?? "",
            r["secuencia"] ?? "",
            r["operacion"] ?? "",
            r["tiempo_setup_real"] ?? "",
            r["tiempo_trabajo_real"] ?? "",
            r["id_operacion"] ?? ""
        ];
    });

    // =====================================
    // 🧩 Cargar datos
    // =====================================
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);

    if (finalData.length > 0) {
        // Cargar la data con los hipervínculos (fórmulas)
        sheet.getRange(2, 1, finalData.length, headers.length).setValues(finalData);
    }

    // =====================================
    // ✨ Formato visual
    // =====================================
    headerRange.setFontWeight("bold").setBackground("#e6f3ff");
    sheet.autoResizeColumns(1, headers.length);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, sheet.getLastRow(), headers.length).setVerticalAlignment("middle");

    Logger.log(`✅ ${finalData.length} operaciones exportadas y optimizadas correctamente a "${sheetName}".`);

  } catch (err) {
    Logger.log(`❌ Error: ${err.message || err}`);
    if (err.stack) Logger.log(err.stack);
  }
}
