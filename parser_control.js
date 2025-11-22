/**
 * ================================================================
 *  parser_control.gs — Parseo de 'Control de trabajos'
 *  Encabezados están en FILA 2.
 * ================================================================
 */

function parseControlDeTrabajos(data) {
  try {
    Logger.log("🔥 parseControlDeTrabajos() — Iniciando parseo...");

    if (!data || !data.rows || data.rows.length < 2) {
      throw new Error("❌ La hoja 'Control de trabajos' no tiene suficientes filas.");
    }

    // ------------------------------------------------------------
    // 📌 Encabezados están en la FILA 2 → data.rows[1]
    // ------------------------------------------------------------
    const headers = data.rows[1];
    const rawRows = data.rows.slice(2); // datos a partir de la fila 3

    Logger.log("🔥 parseControlDeTrabajos() — Encabezados detectados: " + JSON.stringify(headers));

    // ------------------------------------------------------------
    // 📌 Validar columnas requeridas
    // ------------------------------------------------------------
    const requeridas = [
      "STATUS","TRABAJO","PARTE","REVISION","CANTIDAD","PRIORIDAD",
      "FECHA REQUERIMIENTO","FECHA FIN ORACLE","CLIENTE","MAQUINA",
      "MEDIDA","HERRAMENTAL","KIT HERRAMENTAL","CONTENIDO",
      "SUBCONTRATO","COSTO DE PIEZA","COSTO TOTAL","% AVANCE"
    ];

    requeridas.forEach(col => {
      if (headers.indexOf(col) === -1) {
        throw new Error("❌ Falta columna '" + col + "' en 'Control de trabajos'");
      }
    });

    // ------------------------------------------------------------
    // 📌 Convertir cada fila en objeto basado en encabezados
    // ------------------------------------------------------------
    const parsed = rawRows
      .filter(r => r.join("").trim() !== "") // eliminar filas vacías
      .map(row => {
        const obj = {};
        headers.forEach((h, i) => {
          obj[h] = row[i];
        });
        return obj;
      });

    Logger.log("🔥 parseControlDeTrabajos() — Filas procesadas: " + parsed.length);
    return parsed;

  } catch (e) {
    Logger.log("❌ ERROR en parseControlDeTrabajos(): " + e);
    throw e;
  }
}
