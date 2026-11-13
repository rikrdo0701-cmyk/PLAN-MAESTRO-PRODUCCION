/**
 * LOGICA PURA DE LA PAGINA DE PISO (/prd.html).
 *
 * POR QUE ESTE ARCHIVO EXISTE SEPARADO DE prd-app.js. Todo lo que se puede probar sin
 * camara ni red vive aqui: leer el codigo del lector, armar los cuerpos de las tres
 * llamadas, calcular el ciclo por pieza, decidir el color y redactar los mensajes. La
 * pagina solo mueve cosas y pinta; si una regla se equivoca, se ve en la prueba y no
 * en el piso.
 *
 * LAS TRES REGLAS QUE NO SE PUEDEN MOVER DE AQUI, y por que:
 *
 * 1. EL CICLO POR PIEZA ES EL MISMO QUE CALCULA LA BASE. `prdtiempo_finalizar`
 *    (docs/schema-prdtiempo.sql) hace round(segundos / 60 / cantidad, 2). Aqui se
 *    calcula igual para poder ensenar el numero EN VIVO mientras se teclea la
 *    cantidad. Despues de guardar manda el numero que devuelve la funcion, no este:
 *    el de aqui es una vista previa y puede diferir en el ultimo centesimo por el
 *    redondeo de punto flotante.
 *
 * 2. EL COLOR COMPARA EL CICLO REAL CONTRA `operations.tiempo_ciclo`, que esta en
 *    MINUTOS POR PIEZA (el plan hace ciclo x piezas). Verde cuando el real es igual o
 *    menor al objetivo, ambar hasta 10% arriba, rojo arriba de eso, y gris cuando la
 *    operacion no trae objetivo (tiempo_ciclo en 0). El 10% es una decision del
 *    usuario: un 2% arriba de rojo pintaria todo de rojo y el color dejaria de decir
 *    algo.
 *
 * 3. LA HORA ES LA DEL TELEFONO, por decision del usuario, y viaja como instante ISO
 *    (con zona). No se convierte a hora local ni se recorta: la base la guarda como
 *    timestamptz y el ciclo sale de la diferencia de instantes, no de la hora de
 *    pared.
 *
 * NO HACE RED. No conoce fetch, ni Supabase, ni el DOM: recibe datos y devuelve
 * datos. Es lo que permite probarla con `node --test` sin navegador.
 */
(function prdCoreFactory(root) {
  "use strict";

  /** Las cuatro salidas del semaforo. `sin-referencia` no es un color de alerta:
   *  es "no hay con que comparar" y se pinta gris. */
  const TONOS = Object.freeze({
    VERDE: "verde",
    AMBAR: "ambar",
    ROJO: "rojo",
    SIN_REFERENCIA: "sin-referencia",
  });

  /** Margen sobre el objetivo que todavia se considera "casi". Decision del usuario. */
  const MARGEN_AMBAR = 0.10;

  /** El codigo Code 128 de la OT imprime solo digitos. Se acepta hasta 20 por si el
   *  folio crece; mas que eso es ruido de lectura o un codigo de otro documento. */
  const FORMATO_OT = /^[0-9]{1,20}$/;

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** Los motivos que devuelven las funciones de la base. Se nombran aqui para que la
   *  pagina no escriba cadenas sueltas: si el SQL cambia un motivo, esta lista es el
   *  unico lugar que hay que tocar. */
  const MOTIVOS = Object.freeze({
    OT_INVALIDA: "ot_invalida",
    NO_ENCONTRADA: "no_encontrada",
    CERRADA: "cerrada",
    OPERACION_INVALIDA: "operacion_invalida",
    HORA_INVALIDA: "hora_invalida",
    CANTIDAD_INVALIDA: "cantidad_invalida",
    ID_INVALIDA: "id_invalida",
    YA_FINALIZADA: "ya_finalizada",
  });

  function texto(valor) {
    return String(valor == null ? "" : valor).trim();
  }

  function numero(valor) {
    const n = Number(valor);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * El codigo que entrego el lector, con lo que sobra quitado.
   *
   * Code 128 puede venir con espacios o saltos de linea al final, y el lector a veces
   * entrega el texto con relleno. Se recorta; NO se quitan caracteres de en medio ni
   * se "corrige" O por 0: si el codigo trae letras es otro documento o una lectura
   * mala, y adivinar produce una OT equivocada con datos de otra.
   */
  function leerOt(codigo) {
    const ot = texto(codigo);
    if (!FORMATO_OT.test(ot)) {
      return { ok: false, motivo: MOTIVOS.OT_INVALIDA, ot };
    }
    return { ok: true, ot };
  }

  function esOtValida(codigo) {
    return FORMATO_OT.test(texto(codigo));
  }

  /** La hora del telefono como instante ISO, que es lo que acepta `timestamptz`. */
  function horaISO(fecha) {
    const valor = fecha instanceof Date ? fecha : new Date(fecha);
    if (!(valor instanceof Date) || Number.isNaN(valor.getTime())) return "";
    return valor.toISOString();
  }

  // ---------------------------------------------------------------------------
  // Cuerpos de las tres llamadas.
  //
  // Se arman aqui y no en la pagina por una razon concreta: probar que el nombre del
  // parametro coincide con el de la funcion en SQL (`p_ot`, `p_operacion_id`,
  // `p_hora_inicio`, `p_dispositivo`, `p_id`, `p_cantidad`, `p_hora_fin`) es barato
  // en una prueba y caro en el piso: PostgREST responde 404 "function not found" y
  // desde el telefono eso se ve igual que "no hay red".
  // ---------------------------------------------------------------------------

  function cuerpoEscanear(codigo) {
    const lectura = leerOt(codigo);
    if (!lectura.ok) return { ok: false, motivo: lectura.motivo };
    return { ok: true, cuerpo: { p_ot: lectura.ot } };
  }

  function cuerpoIniciar(partes) {
    const datos = partes || {};
    const lectura = leerOt(datos.ot);
    if (!lectura.ok) return { ok: false, motivo: lectura.motivo };

    const operacionId = texto(datos.operacionId);
    if (!operacionId) return { ok: false, motivo: MOTIVOS.OPERACION_INVALIDA };

    const hora = horaISO(datos.horaInicio);
    if (!hora) return { ok: false, motivo: MOTIVOS.HORA_INVALIDA };

    return {
      ok: true,
      cuerpo: {
        p_ot: lectura.ot,
        p_operacion_id: operacionId,
        p_hora_inicio: hora,
        p_dispositivo: texto(datos.dispositivo).slice(0, 80),
      },
    };
  }

  function esCantidadValida(cantidad) {
    const n = Number(cantidad);
    return Number.isInteger(n) && n > 0;
  }

  function cuerpoFinalizar(partes) {
    const datos = partes || {};

    const id = texto(datos.id);
    if (!UUID.test(id)) return { ok: false, motivo: MOTIVOS.ID_INVALIDA };

    if (!esCantidadValida(datos.cantidad)) return { ok: false, motivo: MOTIVOS.CANTIDAD_INVALIDA };

    const hora = horaISO(datos.horaFin);
    if (!hora) return { ok: false, motivo: MOTIVOS.HORA_INVALIDA };

    return {
      ok: true,
      cuerpo: {
        p_id: id,
        p_cantidad: Number(datos.cantidad),
        p_hora_fin: hora,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Ciclo por pieza.
  // ---------------------------------------------------------------------------

  /** Redondeo a 2 decimales, el mismo que hace `round(..., 2)` en la base. */
  function redondear2(valor) {
    return Math.round((valor + Number.EPSILON) * 100) / 100;
  }

  /**
   * Minutos por pieza a partir de los segundos de la corrida.
   *
   * Devuelve null cuando no hay con que calcular (cantidad no positiva o tiempo
   * negativo): null se pinta "sin ciclo", no 0, para no ensenar un ciclo perfecto que
   * nadie midio.
   */
  function cicloPorPiezaMin(segundos, cantidad) {
    const s = Number(segundos);
    const piezas = Number(cantidad);
    if (!Number.isFinite(s) || s < 0) return null;
    if (!Number.isInteger(piezas) || piezas <= 0) return null;
    return redondear2(s / 60 / piezas);
  }

  /** Lo mismo, recibiendo las dos horas. Sirve para refrescar el ciclo del reloj. */
  function cicloEntreFechas(inicio, fin, cantidad) {
    const desde = inicio instanceof Date ? inicio : new Date(inicio);
    const hasta = fin instanceof Date ? fin : new Date(fin);
    if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) return null;
    return cicloPorPiezaMin((hasta.getTime() - desde.getTime()) / 1000, cantidad);
  }

  /** Segundos transcurridos entre dos instantes, nunca negativos. */
  function segundosEntre(inicio, fin) {
    const desde = inicio instanceof Date ? inicio : new Date(inicio);
    const hasta = fin instanceof Date ? fin : new Date(fin);
    if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) return 0;
    return Math.max(0, Math.floor((hasta.getTime() - desde.getTime()) / 1000));
  }

  // ---------------------------------------------------------------------------
  // El semaforo del ciclo.
  // ---------------------------------------------------------------------------

  /**
   * Color del ciclo real contra el objetivo de la operacion.
   *
   * Devuelve { tono, etiqueta, desviacion }:
   *   tono        verde | ambar | rojo | sin-referencia (ver TONOS)
   *   etiqueta    texto corto para el numero grande
   *   desviacion  porcentaje entero arriba (+) o abajo (-) del objetivo, o null
   *
   * Un objetivo de 0 (o vacio) significa que la operacion no tiene tiempo de ciclo
   * capturado: se pinta gris y se dice, en vez de comparar contra 0 y salir siempre
   * rojo.
   */
  function colorCiclo(real, objetivo) {
    const meta = Number(objetivo);

    if (!(meta > 0)) {
      return { tono: TONOS.SIN_REFERENCIA, etiqueta: "sin ciclo de referencia", desviacion: null };
    }
    // `Number(null)` es 0: sin este rodeo, un ciclo que todavia no existe (null) se
    // pintaria VERDE por "0 min/pza", que es el mejor tiempo posible y una mentira.
    if (real == null || real === "") {
      return { tono: TONOS.SIN_REFERENCIA, etiqueta: "sin ciclo de referencia", desviacion: null };
    }
    const ciclo = Number(real);
    if (!Number.isFinite(ciclo) || ciclo < 0) {
      return { tono: TONOS.SIN_REFERENCIA, etiqueta: "sin ciclo de referencia", desviacion: null };
    }

    const razon = ciclo / meta;
    const desviacion = Math.round((razon - 1) * 100);

    if (razon <= 1) return { tono: TONOS.VERDE, etiqueta: "en objetivo", desviacion };
    if (razon <= 1 + MARGEN_AMBAR) return { tono: TONOS.AMBAR, etiqueta: "cerca del límite", desviacion };
    return { tono: TONOS.ROJO, etiqueta: "arriba del objetivo", desviacion };
  }

  /** El texto del objetivo debajo del ciclo: "1.50 min/pza" o el aviso de que no hay. */
  function etiquetaObjetivo(objetivo) {
    const meta = Number(objetivo);
    if (!(meta > 0)) return "sin ciclo de referencia";
    return formatearCiclo(meta) + " min/pza";
  }

  // ---------------------------------------------------------------------------
  // Lo que se ensena y lo que se avisa.
  // ---------------------------------------------------------------------------

  function formatearCiclo(minutos) {
    if (minutos == null || !Number.isFinite(Number(minutos))) return "-";
    return Number(minutos).toFixed(2);
  }

  /** Reloj de la corrida: mm:ss y, si pasa de una hora, hh:mm:ss. */
  function textoDuracion(segundos) {
    const total = Math.max(0, Math.floor(Number(segundos) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const dos = (n) => String(n).padStart(2, "0");
    return h > 0 ? dos(h) + ":" + dos(m) + ":" + dos(s) : dos(m) + ":" + dos(s);
  }

  /** Aviso NO bloqueante cuando se capturan mas piezas de las que pide la OT. */
  function avisoCantidad(cantidad, cantidadOt) {
    if (!esCantidadValida(cantidad)) return "";
    const pedidas = Number(cantidadOt);
    if (!Number.isInteger(pedidas) || pedidas <= 0) return "";
    if (Number(cantidad) <= pedidas) return "";
    return "Capturaste " + cantidad + " piezas y la OT pide " + pedidas + ". Se puede guardar igual.";
  }

  /**
   * Que pantalla sigue despues de escanear.
   *
   *   escanear   no se puede seguir (OT invalida, no encontrada o cerrada) y hay un
   *              mensaje que decir
   *   finalizar  la OT ya tiene una corrida abierta: se captura la cantidad de ESA
   *              corrida. Si hay varias (varias operaciones abiertas), la primera es
   *              la mas reciente: el SQL las devuelve ordenadas por hora de inicio
   *              de la mas nueva a la mas vieja
   *   verificar  OT abierta sin corridas: se elige operacion e inicia
   */
  function decidirPantalla(escaneo) {
    if (!escaneo || escaneo.ok !== true) {
      return { pantalla: "escanear", mensaje: mensajeEscaneo(escaneo) };
    }
    const abiertas = Array.isArray(escaneo.abiertas) ? escaneo.abiertas : [];
    if (abiertas.length > 0) {
      return { pantalla: "finalizar", corrida: abiertas[0], abiertas };
    }
    return { pantalla: "verificar", operaciones: Array.isArray(escaneo.operaciones) ? escaneo.operaciones : [] };
  }

  /** El mensaje de un escaneo que no deja seguir. Nunca inventa datos de la OT. */
  function mensajeEscaneo(escaneo) {
    const motivo = texto(escaneo && escaneo.motivo);
    const ot = texto(escaneo && escaneo.ot);

    if (motivo === MOTIVOS.OT_INVALIDA) return "Ese código no es una OT.";
    if (motivo === MOTIVOS.NO_ENCONTRADA) return "La OT " + ot + " no está en el sistema.";
    if (motivo === MOTIVOS.CERRADA) {
      const estatus = texto(escaneo && escaneo.estatus);
      return "La OT " + ot + " ya está cerrada" + (estatus ? " (" + estatus + ")" : "") + ".";
    }
    return "No se pudo leer la OT. Intenta otra vez.";
  }

  /** El mensaje cuando la llamada de iniciar o finalizar falla del lado de la base. */
  function mensajeError(motivo, contexto) {
    const datos = contexto || {};
    switch (texto(motivo)) {
      case MOTIVOS.NO_ENCONTRADA:
        return "La OT " + texto(datos.ot) + " ya no está en el sistema.";
      case MOTIVOS.CERRADA:
        return "La OT " + texto(datos.ot) + " se cerró mientras trabajabas.";
      case MOTIVOS.OPERACION_INVALIDA:
        return "Esa operación no pertenece a la OT. Elige otra.";
      case MOTIVOS.YA_FINALIZADA:
        return "Esta corrida ya se había finalizado desde otro teléfono.";
      case MOTIVOS.CANTIDAD_INVALIDA:
        return "La cantidad tiene que ser un número entero mayor que cero.";
      case MOTIVOS.HORA_INVALIDA:
        return "La hora del teléfono no sirve para esta corrida. Revisa la fecha y la hora del equipo.";
      case MOTIVOS.ID_INVALIDA:
        return "No se encontró la corrida que se quiere finalizar.";
      case MOTIVOS.OT_INVALIDA:
        return "Ese código no es una OT.";
      default:
        return "No se pudo guardar. Intenta otra vez.";
    }
  }

  /** Una operacion del desplegable, en una linea: "10 - DOBLADO (DOBLADORA 1)". */
  function resumenOperacion(operacion) {
    const op = operacion || {};
    const secuencia = texto(op.secuencia);
    const descripcion = texto(op.descripcion);
    const maquina = texto(op.maquina);
    const base = (secuencia ? secuencia + " - " : "") + (descripcion || texto(op.operation_id));
    return maquina ? base + " (" + maquina + ")" : base;
  }

  /** El texto del aviso despues de guardar, con el ciclo que quedo en la base. */
  function mensajeFinalizada(resultado) {
    const datos = resultado || {};
    const ciclo = formatearCiclo(datos.tiempo_ciclo_min);
    const color = colorCiclo(datos.tiempo_ciclo_min, datos.ciclo_objetivo_min);
    return {
      ciclo,
      tono: color.tono,
      etiqueta: color.etiqueta,
      desviacion: color.desviacion,
      texto: "Guardado: " + ciclo + " min/pza",
    };
  }

  const api = {
    TONOS,
    MARGEN_AMBAR,
    MOTIVOS,
    leerOt,
    esOtValida,
    horaISO,
    cuerpoEscanear,
    cuerpoIniciar,
    cuerpoFinalizar,
    esCantidadValida,
    redondear2,
    cicloPorPiezaMin,
    cicloEntreFechas,
    segundosEntre,
    colorCiclo,
    etiquetaObjetivo,
    formatearCiclo,
    textoDuracion,
    avisoCantidad,
    decidirPantalla,
    mensajeEscaneo,
    mensajeError,
    resumenOperacion,
    mensajeFinalizada,
  };

  root.PrdCore = api;
})(typeof window !== "undefined" ? window : globalThis);
