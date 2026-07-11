function syncArticulosCadaHora() {
  const idArchivo = "1brP0QF92KVvU7BfF2CDrMlucfErH6JcdTPZ1Yy6TVG8";
  const ss = SpreadsheetApp.openById(idArchivo);

  // Ajusta nombres si en tu libro la pestaña destino se llama "Herramentales" u otro
  const hojaOrigen = ss.getSheetByName("trabajos programados");
  const hojaDestino = ss.getSheetByName("Herramentales"); // <-- si tu hoja se llama "Herramentales" cámbialo aquí

  if (!hojaOrigen) {
    throw new Error('❌ No se encontró la hoja "trabajos programados". Verifica el nombre exacto.');
  }
  if (!hojaDestino) {
    throw new Error('❌ No se encontró la hoja destino. Verifica el nombre (ej. "Herramienta" o "Herramentales").');
  }

  const colArticulos = 2; // Col B en trabajos programados (omitimos encabezado fila 1)
  const colParte = 1;     // Col A en hoja destino (omitimos encabezado fila 1)

  // Calcula número de filas a leer (proteger contra getLastRow() <= 1)
  const lastRowOrigen = hojaOrigen.getLastRow();
  const rowsOrigen = Math.max(0, lastRowOrigen - 1);

  const lastRowDestino = hojaDestino.getLastRow();
  const rowsDestino = Math.max(0, lastRowDestino - 1);

  // Leer datos (si no hay filas útiles, producimos arrays vacíos)
  const articulos = rowsOrigen > 0
    ? hojaOrigen.getRange(2, colArticulos, rowsOrigen, 1).getValues().flat()
    : [];

  const partesExistentesRaw = rowsDestino > 0
    ? hojaDestino.getRange(2, colParte, rowsDestino, 1).getValues().flat()
    : [];

  // Normalización para comparación: trim + toLowerCase (pero preservamos el texto original para escribir)
  const normalize = v => (v === null || v === undefined) ? "" : String(v).trim().toLowerCase();

  // Construir un set con las partes ya existentes (normalizadas)
  const existingSet = new Set();
  for (let p of partesExistentesRaw) {
    const n = normalize(p);
    if (n) existingSet.add(n);
  }

  // Recorremos articulos, filtramos vacíos y aseguramos unicidad:
  const seenInBatch = new Set();
  const nuevosParaAgregar = [];

  for (let a of articulos) {
    // omitir celdas vacías
    if (a === "" || a === null || a === undefined) continue;

    const original = String(a);
    const n = normalize(original);
    if (!n) continue;

    // si ya existe en destino, ignorar
    if (existingSet.has(n)) continue;

    // si ya fue agregado en este batch (duplicado en origen), ignorar
    if (seenInBatch.has(n)) continue;

    // marcar y preparar para agregar (preservamos original tal cual)
    seenInBatch.add(n);
    nuevosParaAgregar.push([original]);
  }

  if (nuevosParaAgregar.length === 0) {
    Logger.log("ℹ️ No hay artículos nuevos únicos para agregar.");
    return;
  }

  // Determinar la fila de inicio para escribir (si la hoja solo tiene encabezado, getLastRow puede ser 1)
  const filaInicio = Math.max(hojaDestino.getLastRow(), 1) + 1;
  hojaDestino.getRange(filaInicio, colParte, nuevosParaAgregar.length, 1).setValues(nuevosParaAgregar);

  Logger.log(`✅ Se agregaron ${nuevosParaAgregar.length} artículos únicos en "Herramienta".`);
}