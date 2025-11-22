/**
 * ======================================================================
 * 🔹 NetSuite – SuiteQL → Google Sheets (Días Festivos de Calendario Laboral)
 * ======================================================================
 * Objetivo: Extraer la lista de días festivos (workcalendarholiday) para el Calendario Laboral ID 3.
 * Campos extraídos: exceptiondate (Fecha) y description (Motivo).
 */
function getWorkHolidays() {
  try {
    Logger.log("🚀 Iniciando extracción de días festivos para el Calendario 3...");

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

    // =====================================
    // 🧠 Consulta SuiteQL
    // =====================================
    const sql = `
      SELECT
        exceptiondate AS "fecha",
        description AS "motivo"
      FROM
        workcalendarholiday
      WHERE
        workcalendar = 3
      ORDER BY
        exceptiondate ASC
    `;

    const records = NetSuiteOAuthTest.querySuiteQL(sql);
    if (!records || records.length === 0) {
      Logger.log("⚠️ No se encontraron días festivos para el Calendario 3.");
      return;
    }
    
    // CRITICAL LOGGING CHECK: Muestra el primer registro tal como lo devuelve NetSuite
    Logger.log(`🔍 PRIMER REGISTRO RAW DE NETSUITE: ${JSON.stringify(records[0])}`);

    // =====================================
    // 🔄 Función de formato de fecha (MÁS ROBUSTA)
    // =====================================
    const fmt = (date) => {
      if (!date) return "";

      try {
        let d = null;
        let originalDate = date; // Para logging

        // Intentamos parsear específicamente el formato DD/MM/YYYY que devuelve NetSuite
        if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date)) {
            const parts = date.split('/'); // parts = [Día, Mes, Año]
            if (parts.length === 3) {
                // Construye la fecha usando new Date(Año, Mes-1, Día) para evitar problemas de localización
                d = new Date(parts[2], parts[1] - 1, parts[0]);
            }
        }
        
        // Si no se pudo construir, intenta el parseo estándar (como fallback)
        if (!d || isNaN(d.getTime())) {
            d = new Date(date);
        }
        
        // Verifica que sea una fecha válida y razonable
        if (isNaN(d.getTime())) { 
            Logger.log(`❌ FECHA INVÁLIDA DESPUÉS DE PARSEO: "${originalDate}"`);
            return "";
        }
        
        const formatted = Utilities.formatDate(d, Session.getScriptTimeZone(), "dd/MM/yyyy");
        // Log el resultado del formato para depuración
        Logger.log(`✅ FECHA PROCESADA: Entrada: ${originalDate}, Salida: ${formatted}`);
        
        return formatted;
      } catch (e) {
        Logger.log(`❌ ERROR DE FECHA AL PROCESAR: "${date}". Error: ${e.message}`);
        return ""; 
      }
    };

    // =====================================
    // 🧹 Limpiar / crear hoja
    // =====================================
    const sheetName = "Días Festivos";
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    // Guardamos la hoja activa para restaurarla al final
const activeSheet = ss.getActiveSheet();
    let sheet = ss.getSheetByName(sheetName);
if (!sheet) {
    // Si no existe la hoja, se crea
    sheet = ss.insertSheet(sheetName);
} else {
    // Si ya existe, solo limpiamos el contenido y formatos
    sheet.clear();
}

    // =====================================
    // 🧩 Preparación y Carga de datos
    // =====================================

    // Definimos los encabezados
    const headers = ["FECHA", "MOTIVO"];
    
    // Mapeo de datos (Añadiendo robustez con operadores nullish)
    const finalData = records.map(r => [
        fmt(r["fecha"] ?? ""),  
        r["motivo"] ?? ""       
    ]);
    
    // CRITICAL LOGGING CHECK: Muestra los datos finales antes de escribir
    Logger.log(`📝 DATOS FINALES A ESCRIBIR: ${JSON.stringify(finalData)}`);


    // Cargar encabezados
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);

    if (finalData.length > 0) {
        // Cargar los datos
        sheet.getRange(2, 1, finalData.length, headers.length).setValues(finalData);
    }

    // =====================================
    // ✨ Formato visual
    // =====================================
    headerRange.setFontWeight("bold").setBackground("#e6f3ff");
    sheet.autoResizeColumns(1, headers.length);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, sheet.getLastRow(), headers.length).setVerticalAlignment("middle");
    
    // Formato de columna A como fecha
    sheet.getRange("A2:A" + sheet.getLastRow()).setNumberFormat("dd/MM/yyyy");

    Logger.log(`✅ ${finalData.length} días festivos exportados correctamente a "${sheetName}".`);
    // Restauramos la hoja activa original para que el usuario no cambie de hoja
ss.setActiveSheet(activeSheet);
  } catch (err) {
    Logger.log(`❌ Error: ${err.message || err}`);
    if (err.stack) Logger.log(err.stack);

  }
  

}
