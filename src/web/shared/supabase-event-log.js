/**
 * Vista de depuracion del REGISTRO DE CAMBIOS POR OPERACION: la tabla
 * `operation_events` de Supabase.
 *
 * LO QUE PIDIO EL USUARIO 2026-09-29, textual: 'una vista mas en la web para poder
 * acceder a ella y debuggear'. Esta es esa vista: se llega por la barra lateral
 * (apartado "Eventos"), y no escribe NADA. Es de solo lectura.
 *
 * QUE HAY EN LA TABLA Y DONDE ESTA DEFINIDA. `operation_events` esta en
 * docs/schema-supabase-plan.sql, con id, operation_id, ot, secuencia, ct, kind,
 * at, actor, payload (jsonb) y created_at. MEDIDO 2026-09-29: ese DDL TODAVIA NO
 * ESTA APLICADO en la base. Por eso el caso PGRST205 (PostgREST responde
 * 'Could not find the table') NO es un fallo de red ni un fallo de permisos, y se
 * distingue de "no hay eventos": son dos pantallas distintas, porque una es 'el
 * log esta vacio' y la otra es 'el log no existe todavia'. Confundirlas dejaria
 * una pagina verde y muda, que es peor que una que avisa.
 *
 * POR QUE LOS FILTROS VAN EN LA QUERY STRING Y NO EN EL CLIENTE. Los tres
 * filtros que pide la vista (OT, lista de tipos y rango de fechas) van en la URL
 * de PostgREST porque la tabla solo crece y trae cuatro indices pensados para
 * esto (ot/kind/at, ver el DDL). Filtrar en el cliente traeria 200 filas y
 * descartaria el resto, o sea:aria mentir sobre lo que hay. `at.desc` y el limite
 * van tambien en la URL por lo mismo.
 *
 * REINTENTOS, Y QUE NO SE REINTENTA. Igual razonamiento que supabase-catalog-boot.js,
 * y por el mismo motivo: la sesion no esta o el JWT no sirve (401), RLS cerro la
 * puerta (403) o la tabla no existe (404). Reintentar eso tres veces convierte un
 * fallo instantaneo en un fallo lento y deja a la persona esperando algo que no va
 * a pasar. Lo transitorio (red, 5xx, 429) si se reintenta.
 *
 * EL TOKEN NO APARECE EN EL INFORME NI EN LOS ERRORES. Va en la cabecera
 * `Authorization` y solo se usa ahi. Si el informe de este modulo acabara en un
 * log o en una consola, el token se habria filtrado con el: por eso `consulta`
 * (la URL, que es lo util para reproducir el fallo) si se devuelve, y el JWT no.
 *
 * POR QUE NO SE TOCA app.js NI loadAppStateInBackground. El build guarda una COPIA
 * LITERAL de esa funcion (startupMarker en scripts/build-appscript.mjs) y anadir
 * una sola linea dentro rompe el build con 'No se encontro la carga inicial para
 * recuperar el borrador'. Ademas, la seccion se resuelve por data-view/data-section
 * en el CSS: con un panel propio y sus estilos aqui, la app ni se entera. Lo unico
 * que se engancha desde fuera es el hash, que es por donde la app ya navega.
 */
(function (root) {
  "use strict";

  const TABLA = "operation_events";
  const LIMITE_POR_DEFECTO = 200;
  const LIMITE_MAXIMO = 1000;
  const INTENTOS = 3;
  const ESPERAS_MS = [400, 1200, 3000];
  const TIMEOUT_POR_INTENTO_MS = 20000;

  // PostgREST responde esto cuando la tabla no esta en la base (o no esta en el
  // cache de esquema). Es el unico codigo que significa 'falta aplicar el DDL'.
  const CODIGO_TABLA_AUSENTE = "PGRST205";
  const DDL_PENDIENTE = "docs/schema-supabase-plan.sql";

  const SECCION = "eventos";
  const ICONO_EVENTOS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM8 9h8M8 13h8M8 17h5"/></svg>';

  const dormir = (ms) => new Promise((r) => root.setTimeout(r, ms));

  /** Lo que no se reintenta y por que esta en el comentario de la cabecera. */
  function noReintentar(status) {
    return status === 401 || status === 403 || status === 404;
  }

  // ---------------------------------------------------------------------------
  // Lectura
  // ---------------------------------------------------------------------------

  function texto(valor) {
    return String(valor == null ? "" : valor).trim();
  }

  /**
   * Los tipos llegan como lista o como texto separado por coma, porque en la UI
   * el campo es un input de texto. No se pasan a mayusculas: `kind` lo escribe la
   * app y esta vista no tiene por que decidir como se escribe.
   */
  function listaDeTipos(valor) {
    const crudo = Array.isArray(valor) ? valor : texto(valor).split(",");
    const out = [];
    for (const item of crudo) {
      const t = texto(item);
      if (t && !out.includes(t)) out.push(t);
    }
    return out;
  }

  function normalizaFiltros(filtros) {
    const f = filtros || {};
    return { ot: texto(f.ot), kind: listaDeTipos(f.kind), desde: texto(f.desde), hasta: texto(f.hasta) };
  }

  function normalizaLimite(valor) {
    const n = Number(valor);
    if (!Number.isFinite(n) || n <= 0) return LIMITE_POR_DEFECTO;
    return Math.min(LIMITE_MAXIMO, Math.round(n));
  }

  /**
   * Un `YYYY-MM-DD` solo llega a medianoche, asi que un rango 'hasta 29/09' dejaria
   * fuera todo el dia 29. Se extiende al final del dia; si ya viene una hora, se
   * respeta tal cual.
   */
  function instante(fecha, finDelDia) {
    const t = texto(fecha);
    if (!t) return "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    return t + (finDelDia ? "T23:59:59" : "T00:00:00");
  }

  /**
   * La URL de PostgREST con TODO lo que filtra. Se construye aqui y no dentro del
   * fetch para que los tests puedan assertar sobre ella sin interceptar la red, y
   * para que el error de fallo diga que se pidio exactamente.
   */
  function urlDeConsulta(url, filtros, limite) {
    const partes = ["select=*", "order=at.desc", "limit=" + encodeURIComponent(String(limite))];
    const f = normalizaFiltros(filtros);
    if (f.ot) partes.push("ot=eq." + encodeURIComponent(f.ot));
    if (f.kind.length) partes.push("kind=in.(" + f.kind.map((k) => encodeURIComponent(k)).join(",") + ")");
    const desde = instante(f.desde, false);
    const hasta = instante(f.hasta, true);
    if (desde) partes.push("at=gte." + encodeURIComponent(desde));
    if (hasta) partes.push("at=lte." + encodeURIComponent(hasta));
    return String(url).replace(/\/+$/, "") + "/rest/v1/" + TABLA + "?" + partes.join("&");
  }

  /**
   * Una peticion. Lanza con `status` y `codigo` puestos, que es lo que decide si
   * se reintenta y si la tabla falta. El mensaje lleva la URL y el status de
   * PostgREST, NUNCA el token: va en la cabecera y no tiene que salir de ahi.
   */
  async function pedir(url, jwt, anonKey) {
    const control = new AbortController();
    const temporizador = root.setTimeout(() => control.abort(), TIMEOUT_POR_INTENTO_MS);
    try {
      const r = await root.fetch(url, {
        headers: { apikey: anonKey, Authorization: "Bearer " + jwt, Accept: "application/json" },
        cache: "no-store",
        signal: control.signal,
      });
      const crudo = await r.text();
      let cuerpo = null;
      try { cuerpo = crudo ? JSON.parse(crudo) : null; } catch { cuerpo = null; }
      if (!r.ok) {
        const codigo = texto(cuerpo && (cuerpo.code || cuerpo.codigo));
        const detalle = texto(cuerpo && (cuerpo.message || cuerpo.msg || cuerpo.error));
        const e = new Error("PostgREST " + TABLA + ": HTTP " + r.status + (codigo ? " " + codigo : "") + (detalle ? " " + detalle : ""));
        e.status = r.status;
        e.codigo = codigo;
        throw e;
      }
      return Array.isArray(cuerpo) ? cuerpo : [];
    } finally {
      root.clearTimeout(temporizador);
    }
  }

  async function leerConReintentos(leer, etiqueta) {
    let ultimo = null;
    for (let intento = 0; intento < INTENTOS; intento += 1) {
      try {
        return await leer();
      } catch (error) {
        ultimo = error;
        const status = Number((error && (error.status || error.statusCode)) || 0);
        if (noReintentar(status)) {
          throw new Error(`${etiqueta}: HTTP ${status || "?"} (no se reintenta) ${String((error && error.message) || error)}`.trim());
        }
        if (intento === INTENTOS - 1) break;
        await dormir(ESPERAS_MS[intento] || ESPERAS_MS[ESPERAS_MS.length - 1]);
      }
    }
    throw new Error(`${etiqueta}: fallo tras ${INTENTOS} intentos (${String((ultimo && ultimo.message) || ultimo)})`);
  }

  /**
   * `payload` es jsonb, y jsonb llega como objeto. Se parsea igual si viene como
   * texto, porque el puente y PostgREST no siempre dan lo mismo y una vista que
   * rompe con '[object Object]' no sirve para depurar nada.
   */
  function normalizaFila(fila) {
    const f = fila && typeof fila === "object" ? fila : {};
    let payload = f.payload;
    if (typeof payload === "string") {
      try { payload = JSON.parse(payload); } catch { /* se deja el texto tal cual */ }
    }
    if (payload && typeof payload === "object" && !Array.isArray(payload)) return Object.assign({}, f, { payload });
    return Object.assign({}, f, { payload: payload == null ? null : payload });
  }

  function resumenPorTipo(filas) {
    const resumen = {};
    for (const fila of filas) {
      const kind = texto(fila && fila.kind) || "(sin tipo)";
      resumen[kind] = (resumen[kind] || 0) + 1;
    }
    return resumen;
  }

  function avisoDeTablaAusente(codigo) {
    return "La tabla " + TABLA + " todavia no existe en Supabase (" + (codigo || CODIGO_TABLA_AUSENTE) + "). "
      + "Falta aplicar " + DDL_PENDIENTE + ", que la crea con sus cuatro indices. "
      + "Hasta que se aplique, esta vista no puede mostrar nada: no es que no haya eventos, es que no hay donde registrarlos.";
  }

  /**
   * La lectura. Devuelve un informe con lo que se leyo, o por que no se pudo.
   * `ok:false` con `sinTabla:true` es el caso 'falta el DDL'; `ok:true` con cero
   * filas es 'no hay eventos'. Nunca se confunden, ni en el informe ni en la
   * pantalla.
   */
  async function leer(opciones) {
    const op = opciones || {};
    const filtros = normalizaFiltros(op.filtros);
    const limite = normalizaLimite(op.limite);
    const base = { ok: false, motivo: "", codigo: "", sinTabla: false, aviso: "", filas: [], resumen: {}, total: 0, limite, filtros, consulta: "", ms: 0 };

    const auth = root.PPSupabaseAuth;
    if (!auth || typeof auth.token !== "function" || !auth.configurado) {
      return Object.assign({}, base, { motivo: "Supabase no esta configurado en este build" });
    }
    // La URL y la clave publicable son del lector: un solo sitio las sabe. El JWT
    // es de la sesion, que es lo unico que el lector no tiene.
    const lector = root.PPSupabaseReader;
    const conf = lector && typeof lector.config === "function" ? lector.config() : null;
    const url = texto(conf && conf.url);
    const anonKey = texto(conf && conf.anonKey);
    if (!url || !anonKey) return Object.assign({}, base, { motivo: "El lector de Supabase no expone url/clave" });

    const jwt = await auth.token();
    // Sin sesion no se sale a la red. Un 401 equivalente en el servidor costaria
    // un round-trip y un error feo; aqui la vista lo dice antes de preguntar.
    if (!jwt) return Object.assign({}, base, { motivo: "No hay sesion de Supabase: entra para ver el registro de eventos" });

    const consulta = urlDeConsulta(url, filtros, limite);
    const t0 = Date.now();
    let filas = [];
    try {
      filas = await leerConReintentos(() => pedir(consulta, jwt, anonKey), "registro de eventos");
    } catch (error) {
      const codigo = texto(error && error.codigo) || texto(String((error && error.message) || "").match(/PGRST\d+/));
      const sinTabla = codigo === CODIGO_TABLA_AUSENTE;
      return Object.assign({}, base, {
        motivo: String((error && error.message) || error),
        codigo,
        sinTabla,
        aviso: sinTabla ? avisoDeTablaAusente(codigo) : "",
        consulta,
        ms: Date.now() - t0,
      });
    }
    const normalizadas = filas.map(normalizaFila);
    return {
      ok: true,
      motivo: "",
      codigo: "",
      sinTabla: false,
      aviso: "",
      filas: normalizadas,
      resumen: resumenPorTipo(normalizadas),
      total: normalizadas.length,
      limite,
      filtros,
      consulta,
      ms: Date.now() - t0,
    };
  }

  // ---------------------------------------------------------------------------
  // Pantalla
  // ---------------------------------------------------------------------------

  function nodo(doc, etiqueta, clase, textoInterno) {
    const el = doc.createElement(etiqueta);
    if (clase) el.className = clase;
    if (textoInterno != null) el.textContent = textoInterno;
    return el;
  }

  function dosDigitos(n) {
    return String(n).padStart(2, "0");
  }

  /** Fecha legible y local. A mano, sin toLocaleString: el formato no puede depender del equipo. */
  function fechaLegible(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return texto(iso);
    return d.getFullYear() + "-" + dosDigitos(d.getMonth() + 1) + "-" + dosDigitos(d.getDate())
      + " " + dosDigitos(d.getHours()) + ":" + dosDigitos(d.getMinutes()) + ":" + dosDigitos(d.getSeconds());
  }

  function valorLegible(valor) {
    if (valor == null) return "";
    if (typeof valor === "object") {
      try { return JSON.stringify(valor); } catch { return String(valor); }
    }
    return texto(valor);
  }

  /**
   * El payload, expandido. Se pinta con textContent NUNCA con innerHTML: `payload`
   * es jsonb escrito por la app y puede traer texto de un usuario. Ponerlo en el
   * DOM como HTML seria un XSS en la pagina de planeacion.
   */
  function pintarPayload(doc, payload) {
    const caja = nodo(doc, "div", "eventos-payload");
    if (payload == null) {
      caja.appendChild(nodo(doc, "span", "eventos-payload-vacio", "sin payload"));
      return caja;
    }
    if (typeof payload !== "object" || Array.isArray(payload)) {
      caja.appendChild(nodo(doc, "span", "eventos-payload-escalar", valorLegible(payload)));
      return caja;
    }
    const claves = Object.keys(payload);
    if (!claves.length) {
      caja.appendChild(nodo(doc, "span", "eventos-payload-vacio", "payload vacio"));
      return caja;
    }
    // Un objeto anidado se aplana a filas hermanas, no dentro de la fila del
    // padre: meterlas dentro haria que el texto de la celda mezclara 'de', 'a' y
    // los nombres de campo en una sola linea, y eso es justo lo que hay que evitar
    // en una vista para leer cambios.
    const par = (clave, valor, clase) => {
      const fila = nodo(doc, "div", "eventos-payload-fila" + (clase ? " " + clase : ""));
      fila.appendChild(nodo(doc, "span", "eventos-payload-clave", clave));
      fila.appendChild(nodo(doc, "span", "eventos-payload-valor", valorLegible(valor)));
      return fila;
    };
    // La fila del grupo solo lleva el nombre del campo: el valor son las filas
    // siguientes. Ponerlo aqui como texto vacio daria un hueco sin explicar nada.
    const grupo = (clave) => nodo(doc, "div", "eventos-payload-fila eventos-payload-grupo", clave);
    for (const clave of claves) {
      const valor = payload[clave];
      if (valor && typeof valor === "object" && !Array.isArray(valor)) {
        caja.appendChild(grupo(clave));
        for (const interior of Object.keys(valor)) caja.appendChild(par(interior, valor[interior], "eventos-payload-anidada"));
      } else {
        caja.appendChild(par(clave, valor));
      }
    }
    return caja;
  }

  function celda(doc, contenido, clase) {
    const td = nodo(doc, "td", clase || null);
    if (contenido instanceof Object && contenido && contenido.nodeType) td.appendChild(contenido);
    else td.textContent = contenido == null ? "" : texto(contenido);
    return td;
  }

  function cabecera(doc) {
    const thead = nodo(doc, "thead");
    const tr = nodo(doc, "tr");
    for (const titulo of ["Fecha", "OT", "Tipo", "Actor", "Operacion", "CT", "Sec.", "Payload"]) {
      tr.appendChild(nodo(doc, "th", null, titulo));
    }
    thead.appendChild(tr);
    return thead;
  }

  function filasDeTabla(doc, filas) {
    const tbody = nodo(doc, "tbody");
    for (const fila of filas) {
      const tr = nodo(doc, "tr", "eventos-fila");
      tr.appendChild(celda(doc, fechaLegible(fila.at), "eventos-celda eventos-celda-fecha"));
      tr.appendChild(celda(doc, fila.ot, "eventos-celda eventos-celda-ot"));
      tr.appendChild(celda(doc, fila.kind, "eventos-celda eventos-celda-tipo"));
      tr.appendChild(celda(doc, fila.actor, "eventos-celda eventos-celda-actor"));
      tr.appendChild(celda(doc, fila.operation_id, "eventos-celda eventos-celda-texto"));
      tr.appendChild(celda(doc, fila.ct, "eventos-celda eventos-celda-texto"));
      tr.appendChild(celda(doc, fila.secuencia == null ? "" : String(fila.secuencia), "eventos-celda eventos-celda-num"));
      tr.appendChild(celda(doc, pintarPayload(doc, fila.payload), "eventos-celda eventos-celda-payload"));
      tbody.appendChild(tr);
    }
    return tbody;
  }

  function seccionDeTabla(doc) {
    const tabla = nodo(doc, "table", "eventos-tabla");
    tabla.appendChild(cabecera(doc));
    tabla.appendChild(nodo(doc, "tbody"));
    return tabla;
  }

  /**
   * El panel y su boton en la barra lateral. Se crean desde aqui y no en el
   * template para no meter HTML de una vista de depuracion entre el de la app.
   * Se cuelgan de la barra lateral y de `main.workspace`, que es donde el CSS
   * por data-view decide que se ve.
   */
  function asegurarNodo() {
    const doc = root.document;
    if (!doc || !doc.body) return null;
    if (doc.getElementById(SECCION)) return doc.getElementById(SECCION);

    const nav = doc.querySelector ? doc.querySelector(".nav-list") : null;
    if (nav) {
      const item = doc.createElement("a");
      item.href = "#" + SECCION;
      item.className = "nav-item";
      item.dataset.section = SECCION;
      item.innerHTML = ICONO_EVENTOS + "<span>Eventos</span>";
      // El item se crea DESPUES de que app.js enganche sus clics, asi que el
      // cambio de hash se pone aqui. Con el hash puesto, el hashchange de la app
      // resuelve la seccion solo, sin tocar showWorkspaceView.
      item.addEventListener("click", (evento) => {
        if (evento && evento.preventDefault) evento.preventDefault();
        if (root.location && root.location.hash === "#" + SECCION) pintar();
        else if (root.location) root.location.hash = "#" + SECCION;
      });
      nav.appendChild(item);
    }

    const panel = doc.createElement("section");
    panel.id = SECCION;
    panel.className = "bottom-panel config-panel config-view eventos-view";
    panel.setAttribute("aria-labelledby", "eventos-titulo");

    const cabeceraPanel = nodo(doc, "div", "config-view-heading");
    const textos = nodo(doc, "div");
    const titulo = nodo(doc, "h2", null, "Registro de eventos");
    titulo.id = "eventos-titulo";
    textos.appendChild(titulo);
    textos.appendChild(nodo(doc, "span", null, "Cambios por operacion guardados en Supabase (" + TABLA + "). Solo lectura."));
    cabeceraPanel.appendChild(textos);
    panel.appendChild(cabeceraPanel);

    const cuerpo = nodo(doc, "div", "config-view-body eventos-body");

    const filtros = nodo(doc, "div", "eventos-filtros");
    const campo = (id, etiqueta, tipo, extra) => {
      const label = nodo(doc, "label", "compact-control");
      label.appendChild(nodo(doc, "span", null, etiqueta));
      const input = doc.createElement("input");
      input.id = id;
      input.type = tipo;
      if (extra && extra.placeholder) input.placeholder = extra.placeholder;
      if (extra && extra.value) input.value = extra.value;
      if (extra && extra.max) input.max = extra.max;
      label.appendChild(input);
      filtros.appendChild(label);
      return input;
    };
    campo("eventos-filtro-ot", "OT", "search", { placeholder: "Ej. 12345" });
    campo("eventos-filtro-tipos", "Tipos", "text", { placeholder: "MAQUINA, CAMBIO (coma)" });
    campo("eventos-filtro-desde", "Desde", "date");
    campo("eventos-filtro-hasta", "Hasta", "date");
    campo("eventos-limite", "Limite", "number", { value: String(LIMITE_POR_DEFECTO), max: String(LIMITE_MAXIMO) });
    const recargar = nodo(doc, "button", "button small eventos-recargar", "Recargar");
    recargar.type = "button";
    filtros.appendChild(recargar);
    cuerpo.appendChild(filtros);

    const avisos = nodo(doc, "div", "eventos-avisos");
    const avisoTabla = nodo(doc, "p", "eventos-aviso eventos-aviso-ddl");
    avisoTabla.id = "eventos-aviso-ddl";
    avisoTabla.hidden = true;
    avisos.appendChild(avisoTabla);
    const avisoFallo = nodo(doc, "p", "eventos-aviso eventos-aviso-error");
    avisoFallo.id = "eventos-aviso-error";
    avisoFallo.hidden = true;
    avisos.appendChild(avisoFallo);
    cuerpo.appendChild(avisos);

    const pie = nodo(doc, "div", "eventos-pie");
    const conteo = nodo(doc, "span", "eventos-conteo");
    conteo.id = "eventos-conteo";
    const resumen = nodo(doc, "span", "eventos-resumen");
    resumen.id = "eventos-resumen";
    pie.appendChild(conteo);
    pie.appendChild(resumen);
    cuerpo.appendChild(pie);

    const vacio = nodo(doc, "p", "eventos-vacio");
    vacio.id = "eventos-vacio";
    vacio.hidden = true;
    vacio.textContent = "Todavia no hay eventos con estos filtros. La carga funciono; lo que no hay son registros.";
    cuerpo.appendChild(vacio);

    const envoltura = nodo(doc, "div", "table-wrap eventos-tabla-wrap");
    envoltura.appendChild(seccionDeTabla(doc));
    cuerpo.appendChild(envoltura);

    panel.appendChild(cuerpo);

    const workspace = doc.querySelector ? doc.querySelector(".workspace") : null;
    const destino = workspace || doc.body;
    const despues = doc.querySelector ? doc.querySelector("#calendario") : null;
    if (despues && despues.parentNode === destino) destino.insertBefore(panel, despues.nextSibling);
    else destino.appendChild(panel);

    recargar.addEventListener("click", () => { pintar(); });
    for (const id of ["eventos-filtro-ot", "eventos-filtro-tipos", "eventos-filtro-desde", "eventos-filtro-hasta", "eventos-limite"]) {
      const input = doc.getElementById(id);
      if (input && input.addEventListener) input.addEventListener("change", () => { pintar(); });
    }
    return panel;
  }

  function valorDeCampo(doc, id) {
    const el = doc.getElementById(id);
    return el ? el.value : "";
  }

  function filtrosDePantalla(doc) {
    return {
      ot: valorDeCampo(doc, "eventos-filtro-ot"),
      kind: valorDeCampo(doc, "eventos-filtro-tipos"),
      desde: valorDeCampo(doc, "eventos-filtro-desde"),
      hasta: valorDeCampo(doc, "eventos-filtro-hasta"),
    };
  }

  function textoResumen(resumen) {
    const claves = Object.keys(resumen || {});
    if (!claves.length) return "";
    return claves
      .sort((a, b) => (resumen[b] - resumen[a]) || a.localeCompare(b))
      .map((k) => k + " " + resumen[k])
      .join(" / ");
  }

  /**
   * Pinta el resultado. El estado vacio y el fallo se distinguen por clase y por
   * texto: 'no hay eventos' no puede parecerse a 'no se pudo leer', porque lo
   * segundo necesita una accion (aplicar el DDL) y lo primero no.
   */
  function pintarInforme(doc, informe) {
    const ddl = doc.getElementById("eventos-aviso-ddl");
    const error = doc.getElementById("eventos-aviso-error");
    const vacio = doc.getElementById("eventos-vacio");
    const conteo = doc.getElementById("eventos-conteo");
    const resumen = doc.getElementById("eventos-resumen");
    const tabla = doc.querySelector ? doc.querySelector("#" + SECCION + " .eventos-tabla") : null;
    const cuerpo = tabla && tabla.querySelector ? tabla.querySelector("tbody") : null;

    if (ddl) { ddl.hidden = !informe.sinTabla; ddl.textContent = informe.sinTabla ? informe.aviso : ""; }
    if (error) {
      error.hidden = informe.sinTabla || informe.ok;
      error.textContent = (!informe.sinTabla && !informe.ok) ? "No se pudo leer el registro de eventos: " + informe.motivo : "";
    }
    if (vacio) vacio.hidden = !informe.ok || informe.total > 0;
    if (cuerpo) {
      while (cuerpo.firstChild) cuerpo.removeChild(cuerpo.firstChild);
      const nuevas = filasDeTabla(doc, informe.ok ? informe.filas : []);
      while (nuevas.firstChild) cuerpo.appendChild(nuevas.firstChild);
    }
    // Se oculta el ENVOLTORIO, no la tabla: el borde y el alto maximo los trae
    // .table-wrap, y esconder solo la tabla dejaba una franja vacia con borde, que
    // parece una tabla que no carga.
    const envoltura = tabla && tabla.parentNode ? tabla.parentNode : null;
    if (envoltura) envoltura.hidden = !informe.ok || informe.total === 0;
    if (conteo) {
      conteo.textContent = informe.ok
        ? informe.total + (informe.total === 1 ? " evento" : " eventos") + " - limite " + informe.limite + " - " + informe.ms + " ms"
        : "sin lectura";
    }
    if (resumen) resumen.textContent = textoResumen(informe.resumen);
  }

  let enMarcha = null;

  /**
   * Carga y pinta. No se solapan dos cargas: pulsar recargar cinco veces no puede
   * lanzar cinco lecturas y dejar en pantalla la que tarda mas.
   */
  function pintar() {
    const doc = root.document;
    if (!doc || !doc.body) return Promise.resolve(null);
    asegurarNodo();
    if (!enMarcha) {
      const carga = leer({ filtros: filtrosDePantalla(doc), limite: valorDeCampo(doc, "eventos-limite") })
        .then((informe) => { pintarInforme(doc, informe); return informe; })
        .finally(() => { enMarcha = null; });
      enMarcha = carga;
    }
    return enMarcha;
  }

  function tituloDeSeccion() {
    return "Registro de eventos";
  }

  /**
   * El titulo lo pone la app desde WORKSPACE_TITLES, que esta en app.js y no se
   * toca. Aqui se corrige DESPUES, en una tarea aparte y no dentro del propio
   * hashchange: showWorkspaceView corre de forma sincrona en otro listener del
   * mismo evento, y puesto aqui se lo pisaria con el titulo por defecto.
   * MEDIDO 2026-09-29 en el build: con el titulo puesto en el hashchange, la
   * cabecera se quedaba en 'Planeacion de Produccion'.
   */
  function ponerTitulo() {
    if (!root.setTimeout) return;
    root.setTimeout(() => {
      const doc = root.document;
      if (!doc || !doc.getElementById) return;
      if ((root.location ? root.location.hash : "") !== "#" + SECCION) return;
      const titulo = doc.getElementById("workspaceTitle");
      if (titulo) titulo.textContent = tituloDeSeccion();
    }, 0);
  }

  /** Se llama en el hashchange: si la seccion es esta, se pinta. */
  function alEntrar() {
    const hash = root.location ? root.location.hash : "";
    if (hash !== "#" + SECCION) return Promise.resolve(null);
    ponerTitulo();
    return pintar();
  }

  if (root.document) {
    const montar = () => {
      try {
        asegurarNodo();
        // Si la pagina se ABRIO con #eventos en la direccion, app.js ya corrio
        // applyInitialWorkspaceView y todavia no existia este item, asi que no
        // quedo nada a la vista. Se le pide que la vuelva a resolver.
        // showWorkspaceView es una funcion de primer nivel de app.js, o sea una
        // global de window: se llama, no se parchea.
        if ((root.location ? root.location.hash : "") === "#" + SECCION && typeof root.showWorkspaceView === "function") {
          root.showWorkspaceView(SECCION, "", { scrollToTop: false });
        }
        alEntrar();
      } catch (error) {
        console.warn("[pp-eventos] no se pudo montar la vista de eventos:", String((error && error.message) || error));
      }
    };
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", montar, { once: true });
    else montar();
    if (root.addEventListener) root.addEventListener("hashchange", alEntrar);
  }

  root.PPSupabaseEventLog = {
    leer,
    pintar,
    alEntrar,
    urlDeConsulta,
    avisoDeTablaAusente,
    TABLA,
    DDL_PENDIENTE,
    LIMITE_POR_DEFECTO,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
