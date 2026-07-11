// parser_trabajos.gs — Parseo de 'Trabajos programados'

function parseTrabajos(data) {
  const headers = data.headers;
  const rows = data.rows || [];

  if (!headers || headers.length === 0) {
    throw new Error("❌ 'Trabajos programados' sin encabezados.");
  }

  const requeridas = [
    "Folio de trabajo (link)",
    "Artículo",
    "Cantidad",
    "Estado",
    "Fecha inicio de producción",
    "Fecha finalización de producción",
    "Ubicación",
    "ID Interno"
  ];

  requeridas.forEach(function (c) {
    if (headers.indexOf(c) === -1) {
      Logger.log("❌ Encabezados detectados en 'Trabajos programados': " + JSON.stringify(headers));
      throw new Error("❌ Falta columna '" + c + "' en 'Trabajos programados'");
    }
  });

  const out = rows
    .filter(function (r) {
      return r.join("").trim() !== "";
    })
    .map(function (r) {
      return filaAObjeto(r, headers);
    });

  Logger.log("🔥 parseTrabajos() retornó " + out.length + " filas.");
  return out;
}
