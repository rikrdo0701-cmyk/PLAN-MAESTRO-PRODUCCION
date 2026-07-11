// writer_plan_maestro.gs — Escritura del Plan Maestro

/**
 * Devuelve los encabezados oficiales del Plan Maestro (25 columnas)
 */
function obtenerEncabezadosPlanMaestro() {
  return [
    "NUM",
    "OT",
    "PARTE",
    "DESCRIPCION",
    "CONTENIDO",
    "PRIORIDAD",
    "FECHA_REQ",
    "CANT_TOTAL",
    "SECUENCIA",
    "CT",
    "OPERADOR",
    "MAQUINA",
    "HERRAMENTAL",
    "KIT_HERRAMENTAL",
    "CANT_PENDIENTE",
    "TIEMPO_CICLO",
    "TIEMPO_SETUP",
    "TIEMPO_PROD",
    "FECHA_INICIO",
    "HORA_INICIO",
    "FECHA_FIN",
    "HORA_FIN",
    "TIPO_INSERCION",
    "ESTATUS",
    "LOG"
  ];
}

/**
 * Limpia la hoja Plan Maestro y escribe el nuevo plan completo
 */
function escribirPlanMaestro(plan) {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = libro.getSheetByName(HOJA_PLAN_MAESTRO);

  if (!hoja) {
    hoja = libro.insertSheet(HOJA_PLAN_MAESTRO);
  }

  hoja.clearContents();

  const headers = obtenerEncabezadosPlanMaestro();
  hoja.getRange(1, 1, 1, headers.length).setValues([headers]);

  if (!plan || plan.length === 0) {
    Logger.log("⚠ escribirPlanMaestro(): plan vacío, sólo se escriben encabezados.");
    return;
  }

  const data = plan.map(function (reg, idx) {
    return [
      idx + 1,
      reg.OT || "",
      reg.PARTE || "",
      reg.DESCRIPCION || "",
      reg.CONTENIDO || "",
      reg.PRIORIDAD || "",
      reg.FECHA_REQ || "",
      reg.CANT_TOTAL || "",
      reg.SECUENCIA || "",
      reg.CT || "",
      reg.OPERADOR || "",
      reg.MAQUINA || "",
      reg.HERRAMENTAL || "",
      reg.KIT_HERRAMENTAL || "",
      reg.CANT_PENDIENTE || "",
      reg.TIEMPO_CICLO || "",
      reg.TIEMPO_SETUP || "",
      reg.TIEMPO_PROD || "",
      reg.FECHA_INICIO || "",
      reg.HORA_INICIO || "",
      reg.FECHA_FIN || "",
      reg.HORA_FIN || "",
      reg.TIPO_INSERCION || "",
      reg.ESTATUS || "",
      reg.LOG || ""
    ];
  });

  hoja.getRange(2, 1, data.length, headers.length).setValues(data);
  Logger.log("✅ Plan Maestro escrito con " + data.length + " filas.");
}
