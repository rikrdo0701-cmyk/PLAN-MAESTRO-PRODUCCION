// SCHEDULER.gs — Scheduler completo con Excepciones de dia + Días festivos

/**
 * Convierte HH:MM a minutos desde 00:00
 */
function hmToMin(hm) {
  if (!hm || typeof hm !== "string") return null;
  if (hm.indexOf(":") === -1) return null;
  var p = hm.split(":");
  var h = Number(p[0]);
  var m = Number(p[1]);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

/**
 * Lee horarios desde la hoja 'Excepciones de dia'
 * Estructura esperada:
 * TIPO | FECHA | INICIO TURNO | COMIDA INICIO | COMIDA FIN | BREAK INICIO | BREAK FIN | FIN DE TURNO | MOTIVO
 *
 * Reglas:
 * - Una fila con TIPO='ESTANDAR' define el horario base (FECHA puede ir vacía).
 * - Filas con TIPO='ESPECIAL' y FECHA definen un horario específico para ese día.
 *
 * Retorna:
 * {
 *   estandar: { intervals: [...], totalMinutes: n },
 *   especiales: { "2025-11-25": { intervals:[...], totalMinutes:n }, ... }
 * }
 */
function cargarHorariosDesdeExcepciones(exData) {
  const headers = exData.headers || [];
  const rows = exData.rows || [];

  if (!headers.length) {
    throw new Error("❌ 'Excepciones de dia' sin encabezados.");
  }

  const idxTipo  = headers.indexOf("TIPO");
  const idxFecha = headers.indexOf("FECHA");
  const idxIni   = headers.indexOf("INICIO TURNO");
  const idxCIni  = headers.indexOf("COMIDA INICIO");
  const idxCFin  = headers.indexOf("COMIDA FIN");
  const idxBIni  = headers.indexOf("BREAK INICIO");
  const idxBFin  = headers.indexOf("BREAK FIN");
  const idxFin   = headers.indexOf("FIN DE TURNO");

  if (idxTipo === -1 || idxIni === -1 || idxFin === -1) {
    throw new Error("❌ 'Excepciones de dia' debe contener al menos TIPO, INICIO TURNO y FIN DE TURNO.");
  }

  let estandar = null;
  const especiales = {};

  rows.forEach(function (r) {
    const tipo = String(r[idxTipo] || "").toUpperCase();
    if (!tipo) return;

    if (tipo === "ESTANDAR") {
      // Horario estándar del día
      const intervals = [];

      const ini = hmToMin(r[idxIni]);
      const finTurno = hmToMin(r[idxFin]);

      if (ini === null || finTurno === null) {
        Logger.log("⚠ Fila ESTANDAR con horas inválidas, se ignora.");
        return;
      }

      // Tramo 1: inicio → comida inicio (opcional)
      const cIni = hmToMin(r[idxCIni]);
      const cFin = hmToMin(r[idxCFin]);
      const bIni = hmToMin(r[idxBIni]);
      const bFin = hmToMin(r[idxBFin]);

      if (cIni !== null && cIni > ini) {
        intervals.push({ start: ini, end: cIni });
      } else {
        // Sin comida definida, tramo completo hasta finTurno
        intervals.push({ start: ini, end: finTurno });
      }

      // Tramo 2: comida fin → break inicio
      if (cFin !== null && bIni !== null && cFin < bIni) {
        intervals.push({ start: cFin, end: bIni });
      }

      // Tramo 3: break fin → finTurno
      if (bFin !== null && bFin < finTurno) {
        intervals.push({ start: bFin, end: finTurno });
      }

      const total = intervals.reduce(function (acc, it) {
        return acc + (it.end - it.start);
      }, 0);

      estandar = {
        intervals: intervals,
        totalMinutes: total
      };
    }

    if (tipo === "ESPECIAL") {
      const fechaCell = r[idxFecha];
      const fechaObj = fechaCell ? new Date(fechaCell) : null;
      if (!fechaObj || fechaObj.toString() === "Invalid Date") {
        Logger.log("⚠ Fila ESPECIAL sin fecha válida, se ignora.");
        return;
      }

      const key = fechaObj.toISOString().split("T")[0];

      const ini = hmToMin(r[idxIni]);
      const finTurno = hmToMin(r[idxFin]);

      if (ini === null || finTurno === null) {
        Logger.log("⚠ Fila ESPECIAL sin INICIO/FIN válidos para fecha " + key + ", se ignora.");
        return;
      }

      const intervals = [{ start: ini, end: finTurno }];
      const total = finTurno - ini;

      especiales[key] = {
        intervals: intervals,
        totalMinutes: total
      };
    }
  });

  if (!estandar) {
    throw new Error("❌ No se encontró fila ESTANDAR en 'Excepciones de dia'.");
  }

  Logger.log("📌 Horario ESTANDAR: " + JSON.stringify(estandar));
  Logger.log("📌 Horarios ESPECIALES: " + JSON.stringify(especiales));
  return { estandar: estandar, especiales: especiales };
}

/**
 * Scheduler principal
 * modelo: array de registros lógicos (sin fechas)
 * hojasScheduler: {
 *   "Días festivos": { headers, rows },
 *   "Excepciones de dia": { headers, rows }
 * }
 */
function schedulerProgramar(modelo, hojasScheduler) {
  if (!modelo || !modelo.length) {
    Logger.log("⚠ schedulerProgramar(): modelo vacío.");
    return [];
  }

  const festivosData = hojasScheduler["Días festivos"] || { rows: [] };
  const excepcionesData = hojasScheduler["Excepciones de dia"] || { headers: [], rows: [] };

  // Días festivos (ISO yyyy-mm-dd)
  const diasFestivos = (festivosData.rows || []).map(function (r) {
    const d = r[0];
    const dd = d ? new Date(d) : null;
    return dd ? dd.toISOString().split("T")[0] : null;
  }).filter(function (s) { return !!s; });

  Logger.log("📌 Días festivos: " + JSON.stringify(diasFestivos));

  // Horarios estándar + especiales
  const horarios = cargarHorariosDesdeExcepciones(excepcionesData);
  const estandar = horarios.estandar;
  const especiales = horarios.especiales;

  // Fecha/hora inicial global de programación
  const ahora = new Date();
  // Usamos la fecha de hoy, pero colocamos la hora al primer intervalo estándar
  const primeraHoraMin = estandar.intervals[0].start;
  const startHour = Math.floor(primeraHoraMin / 60);
  const startMin  = primeraHoraMin % 60;

  let reloj = new Date(
    ahora.getFullYear(),
    ahora.getMonth(),
    ahora.getDate(),
    startHour,
    startMin,
    0,
    0
  );

  Logger.log("🕒 Inicio global de programación: " + reloj.toISOString());

  function esFestivo(fechaISO) {
    return diasFestivos.indexOf(fechaISO) !== -1;
  }

  function esFinDeSemana(fecha) {
    const dow = fecha.getDay(); // 0=Dom, 6=Sab
    return dow === 0 || dow === 6;
  }

  function obtenerHorarioParaFecha(fecha) {
    const fechaISO = fecha.toISOString().split("T")[0];

    // 1) Festivo manda: no se trabaja
    if (esFestivo(fechaISO)) return null;

    // 2) Especial (puede incluso habilitar sábado/domingo)
    if (especiales[fechaISO]) return especiales[fechaISO];

    // 3) Finde: no se trabaja
    if (esFinDeSemana(fecha)) return null;

    // 4) Estándar
    return estandar;
  }

  const resultados = [];

  modelo.forEach(function (op) {
    let fechaCursor = new Date(reloj);
    let minutosRestantes = Number(op.TIEMPO_PROD) || 0;

    if (minutosRestantes <= 0) {
      Logger.log("⚠ Operación con TIEMPO_PROD <= 0, se marca inicio/fin iguales.");
      const fechaISO = fechaCursor.toISOString().split("T")[0];
      op.FECHA_INICIO = fechaISO;
      op.HORA_INICIO  = "00:00";
      op.FECHA_FIN    = fechaISO;
      op.HORA_FIN     = "00:00";
      resultados.push(op);
      return;
    }

    let fechaInicioOp = null;
    let horaInicioOp  = null;

    let programada = false;

    while (!programada) {
      const horarioDia = obtenerHorarioParaFecha(fechaCursor);

      if (!horarioDia) {
        // Día no laborable → pasar al siguiente día laborable
        fechaCursor.setDate(fechaCursor.getDate() + 1);
        fechaCursor.setHours(startHour, startMin, 0, 0);
        continue;
      }

      let minutosActuales = fechaCursor.getHours() * 60 + fechaCursor.getMinutes();

      for (let i = 0; i < horarioDia.intervals.length && minutosRestantes > 0; i++) {
        const intervalo = horarioDia.intervals[i];
        const inicioIntervalo = intervalo.start;
        const finIntervalo    = intervalo.end;

        // Si ya estamos después del final del intervalo, seguir al siguiente
        if (minutosActuales >= finIntervalo) {
          continue;
        }

        const inicioBloque = Math.max(minutosActuales, inicioIntervalo);
        const capacidad    = finIntervalo - inicioBloque;

        if (capacidad <= 0) {
          continue;
        }

        if (!fechaInicioOp) {
          // Marcar inicio de la operación
          fechaInicioOp = fechaCursor.toISOString().split("T")[0];
          const hIni = Math.floor(inicioBloque / 60);
          const mIni = inicioBloque % 60;
          horaInicioOp = String(hIni).padStart(2, "0") + ":" + String(mIni).padStart(2, "0");
        }

        if (capacidad >= minutosRestantes) {
          // Cabe completo en este intervalo
          const finMinAbs = inicioBloque + minutosRestantes;
          const hFin = Math.floor(finMinAbs / 60);
          const mFin = finMinAbs % 60;

          const fechaFinOp = new Date(fechaCursor);
          fechaFinOp.setHours(hFin, mFin, 0, 0);

          op.FECHA_INICIO = fechaInicioOp;
          op.HORA_INICIO  = horaInicioOp;
          op.FECHA_FIN    = fechaFinOp.toISOString().split("T")[0];
          op.HORA_FIN     = String(hFin).padStart(2, "0") + ":" + String(mFin).padStart(2, "0");

          resultados.push(op);

          // Avanzar reloj global a fin de esta operación
          reloj = new Date(fechaFinOp);
          programada = true;
          minutosRestantes = 0;
          break;
        } else {
          // No cabe completo → consumimos todo el intervalo y seguimos al siguiente día
          minutosRestantes -= capacidad;
          // Mover fechaCursor al siguiente día laboral al inicio del primer intervalo
          fechaCursor.setDate(fechaCursor.getDate() + 1);
          fechaCursor.setHours(startHour, startMin, 0, 0);
          break;
        }
      }

      // Si ya recorrimos todos los intervalos del día y no se programó completa,
      // se iterará y caerá en el siguiente día.
    }
  });

  Logger.log("📌 Scheduler completado. Operaciones programadas: " + resultados.length);
  return resultados;
}
