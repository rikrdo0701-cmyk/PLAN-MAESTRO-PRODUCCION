/**
 * LA PAGINA DE PISO: camara, tres pantallas y las tres llamadas a Supabase.
 *
 * QUE HACE Y QUE NO. Aqui vive todo lo que toca el telefono (video, DOM, fetch). Las
 * reglas (leer el codigo, armar la llamada, calcular el ciclo, elegir el color, decir
 * el mensaje) estan en prd-core.js y se prueban sin navegador. Si una regla se
 * equivoca, la prueba lo dice; si esto se equivoca, se ve en el telefono.
 *
 * POR QUE UNA SOLA PAGINA Y NO TRES. El video no se apaga entre pantallas: las tres
 * viven en el mismo documento y solo se muestra una. Cambiar de pantalla es quitar un
 * `hidden`; no hay navegacion, no hay recarga, no hay permiso de camara otra vez.
 * Solo se pausa el bucle de reconocimiento, que es lo que gasta bateria.
 *
 * POR QUE NO HAY CAPTURA MANUAL DE LA OT. Decision del usuario: si la camara no lee o
 * el permiso esta negado, la pagina lo dice y no avanza. Teclear el folio a mano abre
 * la puerta a una OT equivocada con datos de otra orden.
 *
 * POR QUE TODO PASA POR `rpc()`. Iniciar y finalizar son las dos unicas escrituras, y
 * estan juntas a proposito: cuando se agregue la cola offline o el token del operador,
 * se mete debajo de esta funcion y las pantallas no cambian.
 *
 * LA HORA ES LA DEL TELEFONO (decision del usuario). Se manda como instante ISO. No se
 * guarda la hora del servidor en la fila; el escaneo ya devuelve `servidor_ahora` por
 * si despues se quiere avisar de un reloj desfasado.
 */
(function prdAppFactory(root, doc) {
  "use strict";

  const CORE = root.PrdCore;
  const URL_SUPABASE = "__PP_SUPABASE_URL__";
  const CLAVE_SUPABASE = "__PP_SUPABASE_ANON_KEY__";

  const CLAVE_DISPOSITIVO = "pp_prd_dispositivo";
  const FORMATOS = ["code_128"];

  /** Cada cuanto se mira un cuadro. 140 ms son ~7 lecturas por segundo: suficiente
   *  para que se sienta instantaneo y no tanto como para calentar el telefono. */
  const ESPERA_ENTRE_LECTURAS = 140;

  /** El mismo codigo leido otra vez dentro de esta ventana se ignora. Sin esto, al
   *  volver a la camara con la hoja todavia enfrente, la pagina entraria sola al
   *  mismo flujo una y otra vez. */
  const ENFRIAMIENTO_MISMO_CODIGO = 5000;

  /** Tope de espera de una llamada. Con mala senal, `fetch` puede quedarse colgado
   *  minutos y el operador no sabe si apreto. */
  const ESPERA_MAXIMA_MS = 15000;

  const $ = (id) => doc.getElementById(id);

  const estado = {
    escaneo: null,        // respuesta de prdtiempo_escanear
    operaciones: [],      // operaciones de la OT, como las devolvio la base
    corrida: null,        // corrida abierta que se esta finalizando
    abiertas: [],         // todas las corridas abiertas de la OT
    procesando: false,
    detector: null,
    pista: null,
    bucle: 0,
    reloj: 0,
    ultimoCodigo: "",
    ultimoCodigoEn: 0,
    linterna: false,
    avisoTimer: 0,
  };

  // ---------------------------------------------------------------------------
  // Utilidades de pantalla.
  // ---------------------------------------------------------------------------

  function mostrarPantalla(cual) {
    ["escanear", "verificar", "finalizar"].forEach((nombre) => {
      const seccion = $("pantalla-" + nombre);
      if (seccion) seccion.hidden = nombre !== cual;
    });
  }

  function ponerEstado(texto) {
    const nodo = $("estado-escanear");
    if (nodo) nodo.textContent = texto || "";
  }

  function ponerError(cual, texto) {
    const nodo = $("error-" + cual);
    if (nodo) nodo.textContent = texto || "";
  }

  function avisar(texto, tono, ms) {
    const nodo = $("toast");
    if (!nodo) return;
    root.clearTimeout(estado.avisoTimer);
    nodo.textContent = texto;
    nodo.dataset.tono = tono || "neutral";
    nodo.hidden = false;
    estado.avisoTimer = root.setTimeout(() => { nodo.hidden = true; }, ms || 2400);
  }

  function ocultarAviso() {
    root.clearTimeout(estado.avisoTimer);
    const nodo = $("toast");
    if (nodo) nodo.hidden = true;
  }

  function vibrar(patron) {
    try {
      if (root.navigator && typeof root.navigator.vibrate === "function") root.navigator.vibrate(patron);
    } catch (error) {
      // Un telefono sin vibracion no puede romper el flujo.
    }
  }

  function bloquearBoton(boton, bloqueado, textoOcupado) {
    if (!boton) return;
    if (bloqueado) {
      boton.dataset.texto = boton.textContent;
      boton.dataset.procesando = "true";
      boton.disabled = true;
      if (textoOcupado) boton.setAttribute("aria-label", textoOcupado);
    } else {
      boton.dataset.procesando = "false";
      boton.disabled = false;
      if (boton.dataset.texto) boton.textContent = boton.dataset.texto;
      boton.removeAttribute("aria-label");
    }
  }

  function sinCamara(mensaje) {
    const nodo = $("sin-camara");
    if (!nodo) return;
    nodo.textContent = mensaje;
    nodo.hidden = false;
    ponerEstado("");
    const marco = doc.querySelector(".marco");
    if (marco) marco.hidden = true;
    const pista = $("pista");
    if (pista) pista.hidden = true;
  }

  // ---------------------------------------------------------------------------
  // Red. Un solo camino para todas las llamadas.
  // ---------------------------------------------------------------------------

  function errorDeRed(mensaje) {
    const error = new Error(mensaje);
    error.sinRed = true;
    return error;
  }

  async function rpc(nombre, cuerpo) {
    // Sin red no se intenta: `fetch` tardaria en fallar y el operador no sabria si
    // apreto. Decision del usuario: avisar y NO guardar nada en el telefono (la cola
    // offline viene en otra etapa).
    if (root.navigator && root.navigator.onLine === false) throw errorDeRed("sin_red");

    const control = typeof root.AbortController === "function" ? new root.AbortController() : null;
    const reloj = control ? root.setTimeout(() => control.abort(), ESPERA_MAXIMA_MS) : 0;

    try {
      let respuesta;
      try {
        respuesta = await root.fetch(URL_SUPABASE + "/rest/v1/rpc/" + nombre, {
          method: "POST",
          headers: {
            apikey: CLAVE_SUPABASE,
            Authorization: "Bearer " + CLAVE_SUPABASE,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(cuerpo),
          cache: "no-store",
          signal: control ? control.signal : undefined,
        });
      } catch (error) {
        throw errorDeRed("sin_red");
      }

      if (!respuesta.ok) {
        const detalle = await respuesta.text().catch(() => "");
        const error = new Error("http_" + respuesta.status);
        error.status = respuesta.status;
        error.detalle = String(detalle || "").slice(0, 300);
        throw error;
      }

      return await respuesta.json();
    } finally {
      if (reloj) root.clearTimeout(reloj);
    }
  }

  function mensajeDeError(error) {
    if (error && error.sinRed) return "Sin conexión. No se guardó nada.";
    const status = error && error.status;
    if (status === 401 || status === 403) return "La página no tiene permiso para guardar. Avisa a sistemas.";
    if (status === 404) return "Falta una función en el servidor. Avisa a sistemas.";
    if (status >= 500) return "El servidor no respondió. Intenta otra vez.";
    return "No se pudo conectar. Intenta otra vez.";
  }

  function dispositivoId() {
    try {
      let id = root.localStorage.getItem(CLAVE_DISPOSITIVO);
      if (!id) {
        id = typeof root.crypto !== "undefined" && typeof root.crypto.randomUUID === "function"
          ? root.crypto.randomUUID()
          : "tel-" + Date.now().toString(36) + "-" + Math.random().toString(16).slice(2, 10);
        root.localStorage.setItem(CLAVE_DISPOSITIVO, id);
      }
      return id;
    } catch (error) {
      // Modo privado o almacenamiento bloqueado: el registro se guarda igual, sin
      // identificar el telefono. No es motivo para impedir el trabajo.
      return "";
    }
  }

  // ---------------------------------------------------------------------------
  // Camara y reconocimiento.
  // ---------------------------------------------------------------------------

  function mensajeCamara(error) {
    const nombre = String((error && error.name) || "");
    if (nombre === "NotAllowedError" || nombre === "SecurityError") {
      return "No diste permiso de cámara. Ábrelo desde el candado de la barra de direcciones y recarga la página.";
    }
    if (nombre === "NotFoundError" || nombre === "OverconstrainedError") return "Este teléfono no tiene una cámara que la página pueda usar.";
    if (nombre === "NotReadableError") return "Otra aplicación está usando la cámara. Ciérrala y recarga la página.";
    return "No se pudo abrir la cámara. Recarga la página e intenta otra vez.";
  }

  async function iniciarCamara() {
    if (typeof root.BarcodeDetector !== "function") {
      sinCamara("Este navegador no trae lector de códigos de barras. Abre la página con Chrome en Android.");
      return;
    }

    try {
      const soportados = await root.BarcodeDetector.getSupportedFormats();
      if (!soportados || soportados.indexOf("code_128") === -1) {
        sinCamara("Este navegador no puede leer el código Code 128 de la hoja. Abre la página con Chrome en Android.");
        return;
      }
      estado.detector = new root.BarcodeDetector({ formats: FORMATOS });
    } catch (error) {
      sinCamara("No se pudo preparar el lector de códigos. Recarga la página.");
      return;
    }

    let flujo = null;
    try {
      flujo = await root.navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch (error) {
      sinCamara(mensajeCamara(error));
      return;
    }

    const video = $("video");
    video.srcObject = flujo;
    try {
      await video.play();
    } catch (error) {
      // Chrome a veces rechaza el play inicial; el video arranca al primer toque.
    }

    estado.pista = flujo.getVideoTracks()[0] || null;
    prepararLinterna();
    reanudarReconocimiento(250);
  }

  function prepararLinterna() {
    const boton = $("boton-linterna");
    if (!boton || !estado.pista) return;
    const capacidades = typeof estado.pista.getCapabilities === "function" ? estado.pista.getCapabilities() : {};
    boton.hidden = !capacidades || !capacidades.torch;
  }

  async function alternarLinterna() {
    const boton = $("boton-linterna");
    if (!boton || !estado.pista) return;
    estado.linterna = !estado.linterna;
    boton.setAttribute("aria-pressed", estado.linterna ? "true" : "false");
    try {
      await estado.pista.applyConstraints({ advanced: [{ torch: estado.linterna }] });
    } catch (error) {
      estado.linterna = false;
      boton.setAttribute("aria-pressed", "false");
    }
  }

  function pausarReconocimiento() {
    root.clearTimeout(estado.bucle);
    estado.bucle = 0;
  }

  function reanudarReconocimiento(espera) {
    pausarReconocimiento();
    if (!estado.detector || doc.hidden) return;
    estado.bucle = root.setTimeout(bucle, espera || 0);
  }

  async function bucle() {
    if (!estado.detector || estado.procesando || doc.hidden) return;

    const video = $("video");
    if (!video || video.readyState < 2) {
      estado.bucle = root.setTimeout(bucle, ESPERA_ENTRE_LECTURAS);
      return;
    }

    let codigos = [];
    try {
      codigos = await estado.detector.detect(video);
    } catch (error) {
      // Un cuadro que no se puede decodificar no es un fallo: se sigue mirando.
      codigos = [];
    }

    const leido = (codigos || []).map((c) => String((c && c.rawValue) || "").trim()).find(Boolean);
    if (leido) {
      // `alEscanear` decide cuando se reanuda; no se agenda otro cuadro aqui para no
      // procesar dos lecturas del mismo codigo en paralelo.
      await alEscanear(leido);
      return;
    }

    estado.bucle = root.setTimeout(bucle, ESPERA_ENTRE_LECTURAS);
  }

  // ---------------------------------------------------------------------------
  // Escanear -> verificar o finalizar.
  // ---------------------------------------------------------------------------

  function codigoRepetido(codigo) {
    const ahora = Date.now();
    if (codigo === estado.ultimoCodigo && ahora - estado.ultimoCodigoEn < ENFRIAMIENTO_MISMO_CODIGO) return true;
    estado.ultimoCodigo = codigo;
    estado.ultimoCodigoEn = ahora;
    return false;
  }

  async function alEscanear(texto) {
    if (estado.procesando) {
      reanudarReconocimiento(ESPERA_ENTRE_LECTURAS);
      return;
    }
    if (codigoRepetido(texto)) {
      reanudarReconocimiento(ESPERA_ENTRE_LECTURAS);
      return;
    }

    const lectura = CORE.leerOt(texto);
    if (!lectura.ok) {
      avisar(CORE.mensajeEscaneo({ motivo: lectura.motivo }), "error", 2200);
      reanudarReconocimiento(600);
      return;
    }

    estado.procesando = true;
    pausarReconocimiento();
    vibrar(25);
    ponerEstado("Buscando la OT " + lectura.ot + "…");
    ocultarAviso();

    try {
      const respuesta = await rpc("prdtiempo_escanear", { p_ot: lectura.ot });
      const decision = CORE.decidirPantalla(respuesta);

      if (decision.pantalla === "escanear") {
        // Primero se vuelve a la camara y despues se avisa: `volverAEscanear` limpia
        // el aviso, asi que al reves el mensaje no se alcanzaria a leer.
        volverAEscanear(1400);
        avisar(decision.mensaje, "error", 3200);
        return;
      }

      estado.escaneo = respuesta;
      if (decision.pantalla === "finalizar") abrirFinalizar(decision.corrida, decision.abiertas);
      else abrirVerificar(decision.operaciones);
      ponerEstado("");
    } catch (error) {
      volverAEscanear(1600);
      avisar(mensajeDeError(error), "error", 3200);
    } finally {
      estado.procesando = false;
    }
  }

  function texto(valor) {
    return String(valor == null ? "" : valor).trim();
  }

  function abrirVerificar(operaciones) {
    const datos = estado.escaneo || {};
    $("verificar-ot").textContent = texto(datos.ot) || "—";
    $("verificar-articulo").textContent = texto(datos.articulo) || "—";
    $("verificar-descripcion").textContent = texto(datos.descripcion) || "—";
    $("verificar-cantidad").textContent = texto(datos.cantidad) || "0";

    estado.operaciones = Array.isArray(operaciones) ? operaciones : [];

    const selector = $("selector-operacion");
    selector.innerHTML = "";
    const inicial = doc.createElement("option");
    inicial.value = "";
    inicial.textContent = estado.operaciones.length ? "Elegir operación…" : "Esta OT no tiene operaciones";
    selector.appendChild(inicial);

    estado.operaciones.forEach((operacion) => {
      const opcion = doc.createElement("option");
      opcion.value = texto(operacion.operation_id);
      opcion.textContent = CORE.resumenOperacion(operacion);
      selector.appendChild(opcion);
    });

    $("verificar-objetivo").textContent = "";
    ponerError("verificar", "");
    const iniciar = $("boton-iniciar");
    iniciar.disabled = true;
    iniciar.dataset.procesando = "false";

    mostrarPantalla("verificar");
  }

  function abrirFinalizar(corrida, abiertas) {
    const datos = estado.escaneo || {};
    estado.corrida = corrida;
    estado.abiertas = Array.isArray(abiertas) ? abiertas : [corrida];

    $("finalizar-ot").textContent = texto(datos.ot) || "—";

    pintarCorrida(corrida);
    pintarCorridas();

    const enlace = $("boton-otra-operacion");
    const operaciones = Array.isArray(datos.operaciones) ? datos.operaciones : [];
    enlace.hidden = operaciones.length === 0;

    const cantidad = $("cantidad");
    cantidad.value = "";
    $("aviso-cantidad").hidden = true;
    $("aviso-cantidad").textContent = "";
    ponerError("finalizar", "");

    const finalizar = $("boton-finalizar");
    finalizar.disabled = true;
    finalizar.dataset.procesando = "false";

    ponerCiclo(null, Number(corrida.ciclo_objetivo_min) || 0);
    mostrarPantalla("finalizar");
    actualizarReloj();
    arrancarReloj();
  }

  function pintarCorrida(corrida) {
    estado.corrida = corrida;
    $("finalizar-operacion").textContent = CORE.resumenOperacion({
      secuencia: corrida.secuencia,
      descripcion: corrida.descripcion,
      maquina: corrida.maquina,
    });
    $("ciclo-objetivo").textContent = CORE.etiquetaObjetivo(corrida.ciclo_objetivo_min);
  }

  function pintarCorridas() {
    const contenedor = $("corridas");
    contenedor.innerHTML = "";
    if (estado.abiertas.length < 2) {
      contenedor.hidden = true;
      return;
    }
    contenedor.hidden = false;
    estado.abiertas.forEach((corrida) => {
      const boton = doc.createElement("button");
      boton.type = "button";
      boton.className = "corrida";
      boton.textContent = texto(corrida.secuencia) + " · " + texto(corrida.descripcion);
      boton.setAttribute("aria-pressed", corrida.id === estado.corrida.id ? "true" : "false");
      boton.addEventListener("click", () => {
        if (corrida.id === estado.corrida.id) return;
        pintarCorrida(corrida);
        pintarCorridas();
        actualizarReloj();
        actualizarCiclo();
      });
      contenedor.appendChild(boton);
    });
  }

  // ---------------------------------------------------------------------------
  // Reloj y ciclo en vivo.
  // ---------------------------------------------------------------------------

  function arrancarReloj() {
    root.clearInterval(estado.reloj);
    estado.reloj = root.setInterval(() => {
      actualizarReloj();
      actualizarCiclo();
    }, 1000);
  }

  function pararReloj() {
    root.clearInterval(estado.reloj);
    estado.reloj = 0;
  }

  function actualizarReloj() {
    if (!estado.corrida) return;
    const segundos = CORE.segundosEntre(estado.corrida.hora_inicio, new Date());
    $("reloj").textContent = CORE.textoDuracion(segundos);
  }

  function ponerCiclo(ciclo, objetivo) {
    const color = CORE.colorCiclo(ciclo, objetivo);
    const contenedor = $("ciclo");
    contenedor.dataset.tono = color.tono;

    $("ciclo-valor").textContent = ciclo == null ? "—" : CORE.formatearCiclo(ciclo);
    $("ciclo-objetivo").textContent = Number(objetivo) > 0
      ? "objetivo " + CORE.etiquetaObjetivo(objetivo)
      : "sin ciclo de referencia";

    $("ciclo-desviacion").textContent = color.desviacion == null
      ? ""
      : (color.desviacion > 0 ? "+" : "") + color.desviacion + "%";

    const barra = $("ciclo-barra");
    if (!(Number(objetivo) > 0) || ciclo == null) {
      barra.style.width = "0%";
    } else {
      // La barra llena al llegar al objetivo y se queda llena cuando se pasa: lo que
      // dice si se paso es el color, no el largo.
      barra.style.width = Math.max(4, Math.min(100, (ciclo / Number(objetivo)) * 100)) + "%";
    }
  }

  function actualizarCiclo() {
    if (!estado.corrida) return;

    const campo = $("cantidad");
    const cantidad = campo.value;
    const valida = CORE.esCantidadValida(cantidad);
    const objetivo = Number(estado.corrida.ciclo_objetivo_min) || 0;

    $("boton-finalizar").disabled = !valida || estado.procesando;

    const aviso = $("aviso-cantidad");
    const textoAviso = CORE.avisoCantidad(cantidad, estado.corrida.cantidad_ot || (estado.escaneo && estado.escaneo.cantidad));
    aviso.textContent = textoAviso;
    aviso.hidden = !textoAviso;

    if (!valida) {
      ponerCiclo(null, objetivo);
      return;
    }

    const segundos = CORE.segundosEntre(estado.corrida.hora_inicio, new Date());
    ponerCiclo(CORE.cicloPorPiezaMin(segundos, cantidad), objetivo);
  }

  // ---------------------------------------------------------------------------
  // Acciones.
  // ---------------------------------------------------------------------------

  async function iniciarOperacion() {
    if (!estado.escaneo) return;
    const boton = $("boton-iniciar");
    ponerError("verificar", "");

    const armado = CORE.cuerpoIniciar({
      ot: estado.escaneo.ot,
      operacionId: $("selector-operacion").value,
      horaInicio: new Date(),
      dispositivo: dispositivoId(),
    });

    if (!armado.ok) {
      ponerError("verificar", CORE.mensajeError(armado.motivo, { ot: estado.escaneo.ot }));
      return;
    }

    estado.procesando = true;
    bloquearBoton(boton, true, "Iniciando");
    try {
      const resultado = await rpc("prdtiempo_iniciar", armado.cuerpo);
      if (resultado && resultado.ok === true) {
        vibrar(45);
        volverAEscanear(0);
        avisar(resultado.ya_iniciada === true ? "Esa operación ya estaba iniciada" : "OT iniciada", "verde", 2000);
      } else {
        ponerError("verificar", CORE.mensajeError(resultado && resultado.motivo, { ot: estado.escaneo.ot }));
      }
    } catch (error) {
      ponerError("verificar", mensajeDeError(error));
    } finally {
      estado.procesando = false;
      bloquearBoton(boton, false);
      actualizarBotonIniciar();
    }
  }

  async function finalizarCorrida() {
    if (!estado.corrida) return;
    const boton = $("boton-finalizar");
    ponerError("finalizar", "");

    const armado = CORE.cuerpoFinalizar({
      id: estado.corrida.id,
      cantidad: $("cantidad").value,
      horaFin: new Date(),
    });

    if (!armado.ok) {
      ponerError("finalizar", CORE.mensajeError(armado.motivo, { ot: estado.escaneo && estado.escaneo.ot }));
      return;
    }

    estado.procesando = true;
    bloquearBoton(boton, true, "Finalizando");
    try {
      const resultado = await rpc("prdtiempo_finalizar", armado.cuerpo);

      if (resultado && resultado.ok === true) {
        const resumen = CORE.mensajeFinalizada(resultado);
        vibrar([30, 40, 60]);
        volverAEscanear(0);
        avisar(resumen.texto, resumen.tono, 2800);
        return;
      }

      if (resultado && resultado.motivo === CORE.MOTIVOS.YA_FINALIZADA) {
        volverAEscanear(0);
        avisar(CORE.mensajeError("ya_finalizada"), "ambar", 3200);
        return;
      }

      ponerError("finalizar", CORE.mensajeError(resultado && resultado.motivo, { ot: estado.escaneo && estado.escaneo.ot }));
    } catch (error) {
      ponerError("finalizar", mensajeDeError(error));
    } finally {
      estado.procesando = false;
      bloquearBoton(boton, false);
      actualizarCiclo();
    }
  }

  function actualizarBotonIniciar() {
    const boton = $("boton-iniciar");
    if (!boton) return;
    boton.disabled = estado.procesando || !$("selector-operacion").value;
  }

  /**
   * Regresa a la camara. NO cancela nada en la base: "Cancelar" solo cierra la hoja.
   * Una corrida ya iniciada se finaliza desde la pantalla de finalizar, no aqui.
   */
  function volverAEscanear(espera) {
    pararReloj();
    estado.corrida = null;
    estado.abiertas = [];
    estado.operaciones = [];
    ponerEstado("");
    mostrarPantalla("escanear");
    ocultarAviso();
    reanudarReconocimiento(espera || 0);
  }

  // ---------------------------------------------------------------------------
  // Arranque y eventos.
  // ---------------------------------------------------------------------------

  /**
   * La pagina se guarda en el telefono para poder ABRIRLA sin senal.
   *
   * Ojo con la diferencia: abrir la camara sin red si funciona (el lector es del
   * navegador), pero GUARDAR no, y `rpc` lo dice en vez de fingir que guardo. Lo que se
   * gana con esto es que un telefono sin datos no se quede en la pantalla en blanco de
   * "no hay conexion" y pueda al menos leer la OT.
   *
   * Solo en GitHub Pages: en local un service worker viejo sirve la version anterior y
   * hace perder una tarde persiguiendo un cambio que "no se aplica".
   */
  function registrarServiceWorker() {
    if (!root.location || !root.location.hostname.endsWith("github.io")) return;
    if (!root.navigator || !("serviceWorker" in root.navigator)) return;
    root.addEventListener("load", () => {
      root.navigator.serviceWorker.register("./sw.js").catch(() => {
        // Sin service worker la pagina funciona igual, solo que necesita red al abrir.
      });
    }, { once: true });
  }

  function conectarEventos() {
    $("boton-linterna").addEventListener("click", alternarLinterna);
    $("boton-cancelar-verificar").addEventListener("click", () => volverAEscanear(400));
    $("boton-cancelar-finalizar").addEventListener("click", () => volverAEscanear(400));
    $("boton-iniciar").addEventListener("click", iniciarOperacion);
    $("boton-finalizar").addEventListener("click", finalizarCorrida);

    $("selector-operacion").addEventListener("change", () => {
      const id = $("selector-operacion").value;
      const operacion = estado.operaciones.find((op) => texto(op.operation_id) === id);
      $("verificar-objetivo").textContent = operacion
        ? "Ciclo objetivo: " + CORE.etiquetaObjetivo(operacion.ciclo_objetivo_min)
        : "";
      ponerError("verificar", "");
      actualizarBotonIniciar();
    });

    $("cantidad").addEventListener("input", actualizarCiclo);
    $("cantidad").addEventListener("keydown", (evento) => {
      if (evento.key === "Enter" && !$("boton-finalizar").disabled) {
        evento.preventDefault();
        finalizarCorrida();
      }
    });

    $("boton-otra-operacion").addEventListener("click", () => {
      if (!estado.escaneo) return;
      pararReloj();
      estado.corrida = null;
      abrirVerificar(estado.escaneo.operaciones || []);
    });

    doc.addEventListener("visibilitychange", () => {
      if (doc.hidden) {
        pausarReconocimiento();
        return;
      }
      // Al volver de apagar la pantalla, el reloj y el ciclo se ponen al dia de una vez.
      if (estado.corrida) {
        actualizarReloj();
        actualizarCiclo();
      }
      reanudarReconocimiento(400);
    });

    // La pagina no tiene formularios, pero un Enter en el selector no debe recargar.
    doc.addEventListener("submit", (evento) => evento.preventDefault());
  }

  function arrancar() {
    if (!CORE) {
      sinCamara("Falta la lógica de la página. Recarga o avisa a sistemas.");
      return;
    }
    conectarEventos();
    mostrarPantalla("escanear");
    iniciarCamara();
    registrarServiceWorker();
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", arrancar);
  else arrancar();
})(typeof window !== "undefined" ? window : globalThis, typeof document !== "undefined" ? document : null);
