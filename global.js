// GLOBAL.gs — Constantes y lectura de hojas base

// Nombres de hojas (respetando exactamente como están en tu archivo)
const HOJA_OPERACIONES_PROGRAMADAS = 'Operaciones Programadas';
const HOJA_TRABAJOS_PROGRAMADOS    = 'Trabajos programados';
const HOJA_CONTROL_TRABAJOS        = 'Control de trabajos';
const HOJA_PLAN_MAESTRO            = 'Plan Maestro';

const HOJA_HERRAMENTALES           = 'HERRAMENTALES';
const HOJA_DIAS_FESTIVOS           = 'Días festivos';
const HOJA_BALANCE_OPERADORES      = 'BALANCE DE CARGAS';
const HOJA_SUBCONTRATOS            = 'SUBCONTRATOS';
const HOJA_INVENTARIO              = 'Inventario Total';
const HOJA_EXCEPCIONES_DIA         = 'Excepciones de dia';

/**
 * Lee una hoja estándar:
 * - Encabezados en fila 1
 * - Datos desde fila 2
 * Retorna: { sheet, headers, rows }
 */
function leerHojaEstandar(nombreHoja) {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = libro.getSheetByName(nombreHoja);
  if (!hoja) {
    throw new Error("❌ No se encontró la hoja '" + nombreHoja + "'");
  }

  const lastRow = hoja.getLastRow();
  const lastCol = hoja.getLastColumn();

  if (lastRow < 1 || lastCol < 1) {
    Logger.log("⚠ Hoja '" + nombreHoja + "' vacía.");
    return { sheet: hoja, headers: [], rows: [] };
  }

  const headers = hoja.getRange(1, 1, 1, lastCol).getValues()[0];
  const rows = lastRow > 1
    ? hoja.getRange(2, 1, lastRow - 1, lastCol).getValues()
    : [];

  Logger.log("📄 Hoja '" + nombreHoja + "' encontrada. Filas: " + lastRow + ", Columnas: " + lastCol);
  return { sheet: hoja, headers: headers, rows: rows };
}

/**
 * Construye mapa de operadores por centro de trabajo
 * desde la hoja BALANCE DE CARGAS
 */
function construirMapaOperadores(balanceData) {
  const headers = balanceData.headers;
  const rows = balanceData.rows;

  if (!headers || headers.length === 0) {
    throw new Error("❌ BALANCE DE CARGAS sin encabezados.");
  }

  const idxOperador = headers.indexOf("OPERADOR");
  const idxCT       = headers.indexOf("ID CENTRO DE TRABAJO");

  if (idxOperador === -1 || idxCT === -1) {
    throw new Error("❌ Encabezados inválidos en 'BALANCE DE CARGAS'. Se esperan 'OPERADOR' y 'ID CENTRO DE TRABAJO'.");
  }

  const map = {};

  rows.forEach(function (r) {
    const operador = r[idxOperador];
    const ctRaw = r[idxCT];
    if (!operador || !ctRaw) return;

    String(ctRaw)
      .split(",")
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s; })
      .forEach(function (ct) {
        if (!map[ct]) map[ct] = [];
        if (map[ct].indexOf(operador) === -1) {
          map[ct].push(operador);
        }
      });
  });

  Logger.log("👥 operadorMap generado: " + JSON.stringify(map, null, 2));
  return map;
}

/**
 * Lee todas las hojas base y regresa estructura global
 * {
 *   hojas: { ... },
 *   operadorMap: {...}
 * }
 */
function leerDatosGlobales() {
  try {
    Logger.log("🔍 Iniciando carga de hojas...");

    const hojas = {};

    hojas[HOJA_CONTROL_TRABAJOS]        = leerHojaEstandar(HOJA_CONTROL_TRABAJOS);
    hojas[HOJA_TRABAJOS_PROGRAMADOS]    = leerHojaEstandar(HOJA_TRABAJOS_PROGRAMADOS);
    hojas[HOJA_OPERACIONES_PROGRAMADAS] = leerHojaEstandar(HOJA_OPERACIONES_PROGRAMADAS);
    hojas[HOJA_HERRAMENTALES]           = leerHojaEstandar(HOJA_HERRAMENTALES);
    hojas[HOJA_SUBCONTRATOS]            = leerHojaEstandar(HOJA_SUBCONTRATOS);
    hojas[HOJA_INVENTARIO]              = leerHojaEstandar(HOJA_INVENTARIO);
    hojas[HOJA_BALANCE_OPERADORES]      = leerHojaEstandar(HOJA_BALANCE_OPERADORES);
    hojas[HOJA_DIAS_FESTIVOS]           = leerHojaEstandar(HOJA_DIAS_FESTIVOS);

    // Hoja excepcional de horarios por día
    try {
      hojas[HOJA_EXCEPCIONES_DIA] = leerHojaEstandar(HOJA_EXCEPCIONES_DIA);
    } catch (e) {
      Logger.log("⚠ Hoja '" + HOJA_EXCEPCIONES_DIA + "' no encontrada. Se asumirá sólo horario estándar por defecto.");
      hojas[HOJA_EXCEPCIONES_DIA] = { sheet: null, headers: [], rows: [] };
    }

    // Plan Maestro (solo para asegurar que existe)
    try {
      hojas[HOJA_PLAN_MAESTRO] = leerHojaEstandar(HOJA_PLAN_MAESTRO);
    } catch (e) {
      Logger.log("⚠ Hoja '" + HOJA_PLAN_MAESTRO + "' no encontrada, se creará al escribir el plan.");
      hojas[HOJA_PLAN_MAESTRO] = { sheet: null, headers: [], rows: [] };
    }

    Logger.log("📌 Todas las hojas cargadas correctamente.");

    const operadorMap = construirMapaOperadores(hojas[HOJA_BALANCE_OPERADORES]);

    return {
      hojas: hojas,
      operadorMap: operadorMap
    };

  } catch (err) {
    Logger.log("❌ Error en leerDatosGlobales(): " + err);
    throw err;
  }
}
