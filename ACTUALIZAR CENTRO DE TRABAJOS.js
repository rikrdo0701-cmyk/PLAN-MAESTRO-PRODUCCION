function actualizarControlDeTrabajos() {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  const hojaControl = libro.getSheetByName("Control de trabajos");
  if (!hojaControl) throw new Error("❌ No se encontró la hoja 'Control de trabajos'.");

  const filaEncabezados = 2;
  const encabezados = hojaControl.getRange(filaEncabezados, 1, 1, hojaControl.getLastColumn()).getValues()[0];
  const colPrioridad = encabezados.indexOf("PRIORIDAD") + 1; // Columna PRIORIDAD

  // Datos existentes
  const datosExistentes = hojaControl.getRange(
    filaEncabezados + 1,
    1,
    Math.max(hojaControl.getLastRow() - filaEncabezados, 1),
    encabezados.length
  ).getValues();
  const mapControl = Object.fromEntries(datosExistentes.map((r, i) => [r[1], i]));

  const limpiar = v => (v == null ? "" : v);
  const normalizar = v => (v || "").toString().trim().toUpperCase();
  const formatearFecha = f =>
    f && f instanceof Date
      ? Utilities.formatDate(f, Session.getScriptTimeZone(), "dd/MM/yyyy")
      : (f || "");

  // === Hojas fuente ===
  const hojaTP = libro.getSheetByName("Trabajos Programados");
  const hojaH = libro.getSheetByName("Herramentales");
  const hojaC = libro.getSheetByName("Contenido");
  const hojaS = libro.getSheetByName("Subcontratos");
  const hojaCost = libro.getSheetByName("Costo de piezas");
  const hojaOp = libro.getSheetByName("Operaciones Programadas");

  const datosTP = hojaTP?.getDataRange().getValues().slice(1) || [];
  const datosH = hojaH?.getDataRange().getValues().slice(1) || [];
  const datosC = hojaC?.getDataRange().getValues().slice(1) || [];
  const datosS = hojaS?.getDataRange().getValues().slice(1) || [];
  const datosCost = hojaCost?.getDataRange().getValues().slice(1) || [];
  const datosOp = hojaOp?.getDataRange().getValues().slice(1) || [];

  if (datosTP.length === 0) {
    Logger.log("⚠️ No hay registros en 'Trabajos Programados'.");
    return;
  }

  // === Mapas por clave ===
  const mapaHerr = {};
  datosH.forEach(f => {
    mapaHerr[normalizar(f[0])] = {
      diametro: limpiar(f[1]),
      herramental: limpiar(f[2]),
      kit: limpiar(f[3]),
    };
  });

  const mapaContenido = Object.fromEntries(datosC.map(f => [normalizar(f[0]), limpiar(f[1] || "")]));
  const mapaSub = Object.fromEntries(datosS.map(f => [normalizar(f[0]), limpiar(f[1] || "")]));
  const mapaCost = Object.fromEntries(datosCost.map(f => [normalizar(f[0]), Number(f[1] || 0)]));

  // === Calcular % Avance solo COMPLETED ===
  const progresoPorTrabajo = {};
  datosOp.forEach(op => {
    const idInterno = op[2]; // Orden de trabajo
    const estado = normalizar(op[6]);
    if (!idInterno) return;
    if (!progresoPorTrabajo[idInterno]) progresoPorTrabajo[idInterno] = { total: 0, done: 0 };
    progresoPorTrabajo[idInterno].total++;
    if (estado === "COMPLETED") progresoPorTrabajo[idInterno].done++;
  });

  const getAvance = id => {
    const p = progresoPorTrabajo[id];
    return p ? Math.round((p.done / p.total) * 100) : 0;
  };

  // === Preparar datos para hoja ===
  const nuevosDatos = [];
  const hipervinculosExistentes = [];
  const hipervinculosNuevos = [];

  datosTP.forEach(t => {
    const trabajo = t[0];
    const articulo = t[1];
    const cantidad = Number(t[2] || 0);
    const estado = t[3];
    const fechaFinOracle = t[5];
    const cliente = limpiar(t[6]);
    const idInterno = t[7];

    const claveParte = normalizar(articulo);
    const herr = mapaHerr[claveParte] || { diametro: "", herramental: "", kit: "" };
    const contenido = mapaContenido[claveParte] || "";
    const subcontrato = mapaSub[claveParte] || "";
    const costoPieza = mapaCost[claveParte] || 0;
    const avance = getAvance(idInterno);

    const filaExistente = mapControl[trabajo];
    const fechaFinNueva = formatearFecha(fechaFinOracle);

    if (filaExistente != null) {
      const fila = datosExistentes[filaExistente];
      const fechaPrev = fila[7]; // FECHA FIN ORACLE

      // Si cambia Fecha fin Oracle → borrar Cliente, Maquina y Prioridad
      if (fechaPrev !== fechaFinNueva) {
        fila[6] = ""; // FECHA REQUERIMIENTO
        fila[5] = ""; // PRIORIDAD
        fila[8] = ""; // CLIENTE
        fila[9] = ""; // MAQUINA
      }

      fila[0] = estado;
      fila[2] = articulo;
      fila[4] = cantidad;
      fila[7] = fechaFinNueva;
      fila[10] = herr.diametro;
      fila[11] = herr.herramental;
      fila[12] = herr.kit;
      fila[13] = contenido;
      fila[14] = subcontrato;
      fila[15] = costoPieza;
      fila[16] = costoPieza * cantidad;
      fila[17] = avance;

      datosExistentes[filaExistente] = fila;
      hipervinculosExistentes.push({
        fila: filaEncabezados + 1 + filaExistente,
        idInterno,
        trabajo,
      });
    } else {
      // Nuevo registro (18 columnas)
      nuevosDatos.push([
        estado, "", articulo, "", cantidad, "NORMAL", "", formatearFecha(fechaFinOracle), "",
        "", // MAQUINA vacía
        herr.diametro, herr.herramental, herr.kit,
        contenido, subcontrato, costoPieza, costoPieza * cantidad, avance
      ]);
      hipervinculosNuevos.push({ idInterno, trabajo });
    }
  });

  // === Escribir datos ===
  if (datosExistentes.length > 0)
    hojaControl
      .getRange(filaEncabezados + 1, 1, datosExistentes.length, encabezados.length)
      .setValues(datosExistentes);

  let filaInicioNuevos = hojaControl.getLastRow() + 1;
  if (nuevosDatos.length > 0) {
    hojaControl
      .getRange(filaInicioNuevos, 1, nuevosDatos.length, encabezados.length)
      .setValues(nuevosDatos);

    // ✅ Agregar validación desplegable PRIORIDAD
    const rangoPrioridades = hojaControl.getRange(filaInicioNuevos, colPrioridad, nuevosDatos.length, 1);
    const regla = SpreadsheetApp.newDataValidation()
      .requireValueInList(["ALTO", "NORMAL", "BAJO"], true)
      .setAllowInvalid(false)
      .build();
    rangoPrioridades.setDataValidation(regla);
  }

  // === Crear hipervínculos RichTextValue ===
  const crearHipervinculo = (celda, texto, url) => {
    if (!url) return celda.setValue(texto);
    const richText = SpreadsheetApp.newRichTextValue().setText(texto).setLinkUrl(url).build();
    celda.setRichTextValue(richText);
  };

  hipervinculosExistentes.forEach(fh => {
    const celda = hojaControl.getRange(fh.fila, 2);
    const url = fh.idInterno
      ? `https://11103874.app.netsuite.com/app/accounting/transactions/transaction.nl?id=${fh.idInterno}`
      : null;
    crearHipervinculo(celda, fh.trabajo.toString(), url);
  });

  if (nuevosDatos.length > 0) {
    hipervinculosNuevos.forEach((fh, i) => {
      const filaReal = filaInicioNuevos + i;
      const celda = hojaControl.getRange(filaReal, 2);
      const url = fh.idInterno
        ? `https://11103874.app.netsuite.com/app/accounting/transactions/transaction.nl?id=${fh.idInterno}`
        : null;
      crearHipervinculo(celda, fh.trabajo.toString(), url);
    });
  }

  Logger.log("✅ Actualización completada con menú PRIORIDAD (ALTO, NORMAL, BAJO).");
}
