// UTILITY.gs — Utilidades generales

/**
 * Convierte una fila + encabezados en objeto {columna: valor}
 */
function filaAObjeto(row, headers) {
  const obj = {};
  headers.forEach(function (h, i) {
    obj[h] = row[i];
  });
  return obj;
}

/**
 * Crea un mapa OT visible (TRABAJO) → ID Interno (Trabajos programados)
 * trabajos: array de objetos parseados de 'Trabajos programados'
 */
function mapOTtoIDinterno(trabajos) {
  const map = {};
  trabajos.forEach(function (t) {
    const folio = String(t["Folio de trabajo (link)"]);
    const idInt = t["ID Interno"];
    if (!folio || !idInt) return;
    map[folio] = String(idInt);
  });
  Logger.log("🔗 Mapa OT → ID Interno: " + JSON.stringify(map));
  return map;
}

/**
 * Construye mapa ID Interno → OT visible (TRABAJO)
 */
function mapIDinternoToOT(trabajos) {
  const map = {};
  trabajos.forEach(function (t) {
    const folio = String(t["Folio de trabajo (link)"]);
    const idInt = t["ID Interno"];
    if (!folio || !idInt) return;
    map[String(idInt)] = folio;
  });
  return map;
}
