// PRINCIPAL.gs — Flujo principal del Plan Maestro de Producción

function mainRunPlanner() {
  try {
    Logger.log("====================================================");
    Logger.log("🚀 INICIO Plan Maestro");

    Logger.log("📥 Leyendo hojas base...");
    const datos = leerDatosGlobales();

    if (!datos || !datos.hojas) {
      throw new Error("❌ leerDatosGlobales() no retornó 'hojas'");
    }

    const hojas = datos.hojas;

    // ===== PARSEAR TABLAS BASE =====
    const control     = parseControlDeTrabajos(hojas[HOJA_CONTROL_TRABAJOS]);
    const trabajos    = parseTrabajos(hojas[HOJA_TRABAJOS_PROGRAMADOS]);
    const operaciones = parseOperaciones(hojas[HOJA_OPERACIONES_PROGRAMADAS]);

    Logger.log("📦 Datos parseados: control=" + control.length +
               ", trabajos=" + trabajos.length +
               ", operaciones=" + operaciones.length);

    // ===== CONSTRUIR MODELO LOGICO =====
    const modelo = construirModeloLogico(
      control,
      trabajos,
      operaciones,
      hojas[HOJA_HERRAMENTALES],
      hojas[HOJA_SUBCONTRATOS],
      hojas[HOJA_INVENTARIO],
      datos.operadorMap
    );

    Logger.log("📌 Modelo lógico generado: " + modelo.length + " operaciones.");

    // ===== PROGRAMAR TIEMPOS (SCHEDULER) =====
    const planConTiempos = schedulerProgramar(modelo, {
      "Días festivos": hojas[HOJA_DIAS_FESTIVOS],
      "Excepciones de dia": hojas[HOJA_EXCEPCIONES_DIA]
    });

    // ===== ESCRIBIR PLAN MAESTRO =====
    escribirPlanMaestro(planConTiempos);

    Logger.log("✅ Plan Maestro generado correctamente.");

  } catch (err) {
    Logger.log("❌ ERROR FATAL en mainRunPlanner: " + err);
    throw err;
  }
}
