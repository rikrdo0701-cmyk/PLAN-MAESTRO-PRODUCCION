// parser_operaciones.gs — Parseo de 'Operaciones Programadas'

function parseOperaciones(data) {
  const headers = data.headers;
  const rows = data.rows || [];

  if (!headers || headers.length === 0) {
    throw new Error("❌ 'Operaciones Programadas' sin encabezados.");
  }

  const requeridas = [
    "ID (link)",
    "Operación",
    "Orden de trabajo",
    "Secuencia",
    "Fecha inicio programada",
    "Fecha fin programada",
    "Estado",
    "Centro de trabajo",
    "Tiempo preparación (min)",
    "Tiempo estimado (min)",
    "Tiempo real (min)",
    "Trabajo restante (min)",
    "Tasa producción",
    "Recurso humano",
    "Recurso máquina",
    "Fecha inicio real",
    "Fecha fin real",
    "Cantidad realizada"
  ];

  requeridas.forEach(function (c) {
    if (headers.indexOf(c) === -1) {
      Logger.log("❌ Encabezados detectados en 'Operaciones Programadas': " + JSON.stringify(headers));
      throw new Error("❌ Falta columna '" + c + "' en 'Operaciones Programadas'");
    }
  });

  const out = rows
    .filter(function (r) {
      return r.join("").trim() !== "";
    })
    .map(function (r) {
      return filaAObjeto(r, headers);
    });

  Logger.log("🔥 parseOperaciones() — Encabezados detectados: " + JSON.stringify(headers));
  Logger.log("🔥 parseOperaciones() — Filas normalizadas: " + out.length);
  return out;
}
