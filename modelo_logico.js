// modelo_logico.gs — Construcción del modelo lógico para el Plan Maestro

/**
 * Agrupa operaciones por Orden de trabajo (ID Interno)
 */
function agruparOperacionesPorOT(operaciones) {
  const map = {};
  operaciones.forEach(function (op) {
    const ot = String(op["Orden de trabajo"]);
    if (!map[ot]) map[ot] = [];
    map[ot].push(op);
  });
  return map;
}

/**
 * Genera mapa de subcontratos por PARTE
 */
function construirMapaSubcontratos(subcontratosData) {
  const headers = subcontratosData.headers;
  const rows = subcontratosData.rows || [];

  if (!headers || headers.length === 0) return {};

  const idxParte = headers.indexOf("PARTE");
  const idxTipo  = headers.indexOf("TIPO");
  const idxDias  = headers.indexOf("DIAS");

  if (idxParte === -1 || idxTipo === -1 || idxDias === -1) return {};

  const map = {};
  rows.forEach(function (r) {
    const parte = r[idxParte];
    const tipo  = r[idxTipo];
    const dias  = r[idxDias];

    if (!parte || tipo === "NO APLICA") return;

    map[String(parte)] = {
      tipo: tipo,
      dias: Number(dias) || 0
    };
  });

  return map;
}

/**
 * Genera mapa de descripción de artículo desde 'Inventario Total'
 */
function construirMapaDescripcionArticulo(invData) {
  const headers = invData.headers;
  const rows = invData.rows || [];
  if (!headers || headers.length === 0) return {};

  const idxArticulo = headers.indexOf("Artículo");
  const idxDesc     = headers.indexOf("Descripción");

  if (idxArticulo === -1 || idxDesc === -1) return {};

  const map = {};
  rows.forEach(function (r) {
    const art = r[idxArticulo];
    const desc = r[idxDesc];
    if (!art) return;
    map[String(art)] = desc;
  });
  return map;
}

/**
 * Genera mapa de herramental por PARTE
 */
function construirMapaHerramentales(hData) {
  const headers = hData.headers;
  const rows = hData.rows || [];
  if (!headers || headers.length === 0) return {};

  const idxParte = headers.indexOf("PARTE");
  const idxHerr  = headers.indexOf("HERRAMENTAL");
  const idxKit   = headers.indexOf("KIT HERRAMENTAL");
  const idxTAH   = headers.indexOf("TIEMPO DE AJUSTE HERRAMENTAL");
  const idxTAK   = headers.indexOf("TIEMPO DE AJUSTE KIT");

  const map = {};
  rows.forEach(function (r) {
    const parte = r[idxParte];
    if (!parte) return;
    map[String(parte)] = {
      herramental: r[idxHerr],
      kit: r[idxKit],
      tAjusteHerr: Number(r[idxTAH]) || 0,
      tAjusteKit: Number(r[idxTAK]) || 0
    };
  });
  return map;
}

/**
 * Normaliza una operación en un registro del modelo lógico
 */
function normalizarOperacion(infoControl, op, operadorMap, mapaHerr, mapaDesc) {
  const ct = String(op["Centro de trabajo"]);
  const operadoresCT = operadorMap[ct];

  if (!operadoresCT || operadoresCT.length === 0) {
    throw new Error("❌ No hay operador asignado para CT: " + ct);
  }

  const parte = infoControl["PARTE"];
  const herrInfo = mapaHerr[String(parte)] || {};

  const tiempoEstimado = Number(op["Tiempo estimado (min)"]) || 0;
  const cantidadRealizada = Number(op["Cantidad realizada"]) || 0;
  const cantidadTotal = Number(infoControl["CANTIDAD"]) || 0;
  const cantPendiente = Math.max(cantidadTotal - cantidadRealizada, 0);

  const registro = {
    OT: infoControl["TRABAJO"],
    PARTE: parte,
    DESCRIPCION: mapaDesc[String(parte)] || "",
    CONTENIDO: infoControl["CONTENIDO"],
    PRIORIDAD: infoControl["PRIORIDAD"] || "NORMAL",
    FECHA_REQ: infoControl["FECHA FIN ORACLE"],
    CANT_TOTAL: cantidadTotal,
    SECUENCIA: op["Secuencia"],
    CT: ct,
    OPERADOR: operadoresCT[0],
    MAQUINA: infoControl["MAQUINA"],
    HERRAMENTAL: herrInfo.herramental || infoControl["HERRAMENTAL"],
    KIT_HERRAMENTAL: herrInfo.kit || infoControl["KIT HERRAMENTAL"],
    CANT_PENDIENTE: cantPendiente,
    TIEMPO_CICLO: tiempoEstimado,
    TIEMPO_SETUP: 0, // pendiente: se podría usar tAjusteHerr/tAjusteKit según reglas
    TIEMPO_PROD: tiempoEstimado, // en tu caso viene ya como tiempo total de operación
    FECHA_INICIO: null,
    HORA_INICIO: null,
    FECHA_FIN: null,
    HORA_FIN: null,
    TIPO_INSERCION: "NORMAL",
    ESTATUS: op["Estado"],
    LOG: "OK"
  };

  Logger.log("DEBUG CT → OT=" + registro.OT + " | Sec=" + registro.SECUENCIA + " | CT=" + ct);
  return registro;
}

/**
 * Inserta subcontratos en el modelo (antes de CT 137)
 */
function insertarSubcontratosEnModelo(modelo, mapaSubc) {
  const resultado = [];

  modelo.forEach(function (reg) {
    // Insertar operación de subcontrato ANTES de CT 137
    if (String(reg.CT) === "137") {
      const subc = mapaSubc[String(reg.PARTE)];
      if (subc && subc.dias > 0) {
        const regSub = Object.assign({}, reg);
        regSub.CT = "SUBC";
        regSub.TIPO_INSERCION = "SUBCONTRATO";
        regSub.OPERADOR = "SUBCONTRATO";
        regSub.TIEMPO_PROD = subc.dias * 24 * 60;
        regSub.LOG = "Subcontrato: " + subc.tipo;
        resultado.push(regSub);
      }
    }

    resultado.push(reg);
  });

  modelo.length = 0;
  Array.prototype.push.apply(modelo, resultado);
}

/**
 * Construye el modelo lógico completo del Plan Maestro
 */
function construirModeloLogico(control, trabajos, operaciones, herramentalesData, subcontratosData, inventarioData, operadorMap) {

  const mapaOTtoID = mapOTtoIDinterno(trabajos);
  const mapaIDtoOT = mapIDinternoToOT(trabajos);
  const opsPorOT   = agruparOperacionesPorOT(operaciones);
  const mapaSubc   = construirMapaSubcontratos(subcontratosData);
  const mapaDesc   = construirMapaDescripcionArticulo(inventarioData);
  const mapaHerr   = construirMapaHerramentales(herramentalesData);

  // Identificar trabajos con operaciones iniciadas (PROGRESS/COMPLETED)
  const otsProtegidas = new Set();
  operaciones.forEach(function (op) {
    const estado = String(op["Estado"]).toUpperCase();
    if (estado === "PROGRESS" || estado === "COMPLETED") {
      const idReal = String(op["Orden de trabajo"]);
      otsProtegidas.add(idReal);
    }
  });

  otsProtegidas.forEach(function (idReal) {
    const otVisible = mapaIDtoOT[idReal] || "(desconocido)";
    Logger.log("🔒 OT protegida (ya iniciada): " + otVisible + " (ID Interno " + idReal + ")");
  });

  const modelo = [];

  control.forEach(function (info) {
    const otVisible = String(info["TRABAJO"]);
    const idReal = mapaOTtoID[otVisible];

    if (!idReal) {
      Logger.log("⚠ OT sin ID Interno en Trabajos programados: " + otVisible);
      return;
    }

    // Si está protegida, no la reprogramamos
    if (otsProtegidas.has(String(idReal))) {
      Logger.log("⚠ OT protegida, se omite del modelo: " + otVisible + " (ID Interno " + idReal + ")");
      return;
    }

    const ops = opsPorOT[String(idReal)] || [];

    if (!ops.length) {
      Logger.log("⚠ OT sin operaciones programadas: " + otVisible + " (ID Interno " + idReal + ")");
      return;
    }

    ops.forEach(function (op) {
      const reg = normalizarOperacion(info, op, operadorMap, mapaHerr, mapaDesc);
      modelo.push(reg);
    });
  });

  // Insertar subcontratos
  insertarSubcontratosEnModelo(modelo, mapaSubc);

  Logger.log("📌 Modelo lógico listo. Registros: " + modelo.length);
  return modelo;
}
