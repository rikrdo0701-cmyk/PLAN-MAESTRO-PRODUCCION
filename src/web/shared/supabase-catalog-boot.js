/**
 * Los catalogos se leen de Supabase y de nada mas.
 *
 * LO QUE PIDIO EL USUARIO 2026-09-29, textual: 'sin respaldo a las hojas directo
 * todo a supabase con reintentos'. O sea: sin alternativa a las Hojas, y con
 * reintentos. Este modulo es el que hace las dos cosas.
 *
 * POR QUE LOS REINTENTOS NO SON UN ADORNO. MEDIDO 2026-09-29: la lectura directa de
 * las 11 tablas de catalogo en paralelo tarda 239 ms de mediana, contra 1311 ms del
 * puente. Son once peticiones HTTP a la vez: cualquiera puede fallar sola, y un 5xx
 * puntual de PostgREST o un corte de red deja la pagina sin catalogo. Con respaldo
 * a las Hojas eso habria sido un susto; SIN respaldo es la pagina entera sin
 * operadores ni matriz, y sin aviso de por que. Por eso reintenta y por eso avisa.
 *
 * QUE NO SE REINTENTA, Y POR QUE. Un 401 o un 403 no mejora esperando: la sesion
 * no esta, o el JWT no sirve, o RLS cerro la puerta. Reintentar eso tres veces solo
 * convierte un fallo instantaneo en un fallo lento, y deja a la persona mirando la
 * pantalla esperando algo que no va a pasar. Un 404 tampoco: la tabla no existe.
 * Lo que SI se reintenta es lo transitorio: red, 5xx, 429.
 *
 * SIN RESPALDO, Y QUE PASA SI FALLA. No hay alternativa a las Hojas, segun lo pedido.
 * La consecuencia es que un fallo de red deja la pagina con el catalogo que ya
 * tenia en memoria, que puede ser del arranque anterior, y eso no se puede
 * distinguir de un catalogo correcto. Por eso el modulo NO se traga el fallo: pinta
 * un aviso visible con que tablas fallaron, porque una pagina que parece correcta y
 * esta vacia de matriz es peor que una que avisa.
 *
 * LO QUE SE ESCRIBE Y LO QUE NO, QUE NO ES LO MISMO. MEDIDO 2026-09-29 17:09, de las
 * 11 tablas de catalogo solo 7 estaban al dia. AL 2026-09-30 la escritura se partio en
 * dos, y el conteo de la pagina ha crecido desde entonces; esto es lo que vale hoy:
 *   - La pagina escribe NUEVE tablas por PPSupabaseWriter.guardarCatalogos (anexo, sin
 *     borrado): las seis de la pestana CATALOGOS (tools, subcontracts, calendar_exceptions,
 *     ot_configurations, article_configurations y machine_planning_overrides), mas operators
 *     y matrix de la pestana MATRIZ (que la pagina SI escribe) y machine_catalog, unica de
 *     la pagina (RULE-MAQ-004). Antes ambas pestanas escribian las Hojas con
 *     `saveCatalogState` y el espejo las subia.
 *   - capabilities, operation_catalog y ot_types NO se escriben desde la pagina: siguen
 *     viniendo del ESPEJO de las Hojas (16-supabase-catalogo.js), que corre cuando un
 *     guardado llega al despliegue de Apps Script. Por eso el escritor mete un aviso
 *     explicito cuando el ambito es `matrix`.
 *   - RIESGO ABIERTO (decision del usuario 2026-10-03, documentado en Project Memory):
 *     las OCHO tablas de catalogo que la pagina escribe (todas menos machine_catalog) las
 *     escribe TAMBIEN el espejo, que borra-e-inserta desde las Hojas congeladas: dos
 *     escritoras por tabla, una violacion de RULE-SUP-015 que se documenta y se vigila,
 *     y que mientras el puente este deshabilitado (RULE-SUP-030) solo puede correrla un
 *     cliente viejo o una llamada directa al despliegue.
 * Leer SIN RESPALDO una tabla que no se escribe significa mostrar la de ayer, y por eso este
 * modulo avisa de la antiguedad de lo que leyo, no solo de los fallos. (El conteo de 7 de
 * 11 hay que volverlo a medir si se quiere saber que tan al dia esta hoy.)
 *
 * Y EL PLAN, que antes venia del puente y ya NO. DECIDIDO 2026-09-30 (RULE-SUP-024): el plan
 * se lee y se escribe en Supabase, sin rama de Apps Script. Este modulo sigue siendo el
 * que lee los catalogos al arrancar, pero `readCatalogs` ya trae tambien work_orders,
 * operations y materials, y el plan se arma con eso. Lo que NO se cierra solo es
 * MAPPING_GAPS en supabase-reader.js: a `operations` le faltan num, parte, contenido,
 * prioridad, fechaReq y log; a `work_orders` le faltan dueDateOverride y los precios; a
 * `article_configurations` le falta precio_ref_venta. No son datos viejos, son columnas que
 * NO EXISTEN, y por eso el arranque avisa en vez de inventarlos.
 *
 * LO QUE SIGUE SIENDO DEL PUENTE, Y ES SOLO LECTURA: NetSuite. El puente no aporta ni un
 * dato de plan ni de catalogo a esta pagina; queda para preguntar a NetSuite, que no se
 * puede leer desde el navegador porque el OAuth lo tiene el RESTlet 2246.
 */
(function (root) {
  "use strict";

  const INTENTOS = 3;
  // Espera entre intentos. Corta a proposito: con once tablas en paralelo, un
  // reintento largo se nota como pagina congelada. Peor congelada que sin matrices.
  const ESPERAS_MS = [400, 1200, 3000];
  const TIMEOUT_POR_INTENTO_MS = 20000;

  /** Lo que no se reintenta y por que esta en el comentario de la cabecera. */
  function noReintentar(status) {
    if (status === 401 || status === 403 || status === 404) return true;
    return false;
  }

  const dormir = (ms) => new Promise((r) => root.setTimeout(r, ms));

  /**
   * Una lectura de tabla con reintentos. Devuelve las filas; lanza con un mensaje
   * que dice cuantos intentos se hicieron y por que se paro, no solo el status.
   */
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
   * Que columna de fecha usar para la antiguedad, y por que no es created_at.
   *
   * MEDIDO 2026-09-30: esto pedia created_at, y los catalogos se escriben con UPSERT, que no
   * toca created_at. O sea que la antiguedad media el primer insert de la historia de la tabla
   * y no la ultima escritura: operatorm se escribio hace minutos y su aviso seguia diciendo
   * 70 h. El disparador de updated_at (public.tocar_updated_at) ya estaba puesto y probado, y
   * no servia de nada porque nadie leia la columna. Un arreglo correcto al que no le falta el
   * LECTOR es lo mas dificil de notar, porque el codigo que escribe esta bien.
   *
   * El orden: updated_at si existe, luego actualizado (machine_planning_overrides usaba esa),
   * y created_at solo como ultimo recurso, para una tabla que no tenga ninguna de las dos.
   */
  const COLUMNA_DE_ANTIGUEDAD = ["updated_at", "actualizado", "created_at"];

  /**
   * Antiguedad de lo leido: cuando se escribio por ULTIMA VEZ. Sin esto, una tabla con
   * datos de hace dos dias y una de hace un minuto se ven igual.
   *
   * Se prueban las columnas en orden y se usa la primera que la tabla tenga. No se puede
   * hacer en una sola consulta porque no todas las tablas tienen las tres, y pedir una que no
   * existe es un 400 que no dice nada.
   */
  async function antiguedadDe(url, clave, table, token) {
    // Una peticion por columna, y se para en la primera que la tabla tenga. El
    // `order=...&limit=1` con la columna correcta es lo que da la escritura mas reciente.
    for (const columna of COLUMNA_DE_ANTIGUEDAD) {
      const info = await antiguedadConColumna(url, clave, table, columna, token);
      if (info) return info;
    }
    return null;
  }

  async function antiguedadConColumna(url, clave, table, columna, token) {
    const control = new AbortController();
    const t = root.setTimeout(() => control.abort(), TIMEOUT_POR_INTENTO_MS);
    try {
      const r = await fetch(`${url}/rest/v1/${table}?select=${columna}&order=${columna}.desc&limit=1`, {
        // El token va con la clave, igual que en la lectura: la politica es
        // `select to authenticated` y sin el no se ve ni una fila.
        headers: { apikey: clave, Authorization: "Bearer " + (token || clave), "cache-control": "no-cache" },
        cache: "no-store",
        signal: control.signal,
      });
      // Una columna que la tabla no tiene es un 400. No es un fallo: es que esta tabla usa
      const j = await r.json();
      if (!r.ok) return null;
      const fila = Array.isArray(j) ? j[0] : null;
      const iso = fila && fila[columna] ? String(fila[columna]) : "";
      if (!iso) return null;
      const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
      return { minutos, iso };
    } catch {
      return null;
    } finally {
      root.clearTimeout(t);
    }
  }

  // ---------------------------------------------------------------------------
  // ANTIQUEDAD EN HORAS LABORALES (decisión del usuario 2026-10-03).
  //
  // El umbral viejo (20 h de RELOJ) era más corto que la cadencia real de
  // guardados, así que el aviso SÍEMPRE aparecía en un fin de semana sin
  // guardar: falso positivo por diseño. MEDIDO 2026-10-03 contra updated_at por
  // tabla (ver RULE-SUP-044): el toast decía la verdad de la base, y lo que
  // estaba rota era la escala. Ahora la escala es la del trabajo: solo cuentan
  // las horas del horario laboral de la planta, día por día, y se restan los
  // periodos no laborables del calendario (asueto, vacaciones, paros generales).
  //
  // LA FUENTE DEL CALENDARIO, en orden: (1) el catálogo de Supabase que acabo de
  // leer (calendar_exceptions, la misma tabla que mide), que gana porque es la
  // fuente; (2) el cache local del navegador, que trae el horario laboral y los
  // descansa diarios que la persona configuro (STORAGE_KEY de app.js), porque
  // workSchedule no vive en ninguna tabla Supabase; (3) los valores de
  // fabrica, idénticos a DEFAULT_WORK_SCHEDULE/DEFAULT_DAILY_BREAKS de app.js.
  // Ninguna de las tres fuentes es crítica: si una falta, la medición sigue
  // funcionando con la siguiente.
  const CLAVE_CACHE_LOCAL = "plan-produccion-app-v1";
  const CLAVES_SEMANA = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  // El umbral, en horas LABORALES, no de reloj: un finde entero suma 0 h
  // laborales y nunca dispara; 24 h laborales son ~2-3 dias habiles sin
  // guardar, que es lo que se avisa.
  const UMBRAL_MINUTOS_LABORALES = 24 * 60;
  const TOPE_DIAS_LABORALES = 400;
  const HORARIO_LABORAL_POR_DEFECTO = {
    MON: { enabled: true, start: "07:00", end: "17:00" },
    TUE: { enabled: true, start: "07:00", end: "17:00" },
    WED: { enabled: true, start: "07:00", end: "17:00" },
    THU: { enabled: true, start: "07:00", end: "17:00" },
    FRI: { enabled: true, start: "07:00", end: "17:00" },
    SAT: { enabled: false, start: "07:00", end: "17:00" },
    SUN: { enabled: false, start: "07:00", end: "17:00" },
  };
  const DESCANSOS_DIARIOS_POR_DEFECTO = {};

  function minutosDeReloj(texto, porDefecto) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(texto == null ? "" : texto).trim());
    if (!m) return porDefecto;
    const minutos = Number(m[1]) * 60 + Number(m[2]);
    return Number.isFinite(minutos) ? Math.min(minutos, 24 * 60) : porDefecto;
  }

  /** El horario de un dia, con los por defecto de fabrica por debajo. */
  function diaDelHorario(horario, clave) {
    const dia = horario && typeof horario === "object" ? horario[clave] : null;
    if (!dia || typeof dia !== "object") return HORARIO_LABORAL_POR_DEFECTO[clave];
    return {
      enabled: dia.enabled !== false,
      start: String(dia.start || HORARIO_LABORAL_POR_DEFECTO[clave].start),
      end: String(dia.end || HORARIO_LABORAL_POR_DEFECTO[clave].end),
    };
  }

  /**
   * El calendario para medir la antiguedad. Se resuelve UNA sola vez por aviso
   * y se cuelga del informe para que el test lo pueda inyectar: informe.calendario
   * tiene prioridad sobre el localStorage del vm.
   */
  function calendarioDelAviso(informe) {
    const base = {};
    if (informe && typeof informe === "object") {
      const c = informe.catalogs || {};
      if (Array.isArray(c.calendarExceptions)) base.calendarExceptions = c.calendarExceptions;
    }
    let local = null;
    try {
      if (root.localStorage && typeof root.localStorage.getItem === "function") {
        local = root.localStorage.getItem(CLAVE_CACHE_LOCAL);
      }
    } catch {
      local = null;
    }
    if (local) {
      try {
        const parseado = JSON.parse(local);
        if (parseado && typeof parseado === "object") {
          if (parseado.workSchedule && typeof parseado.workSchedule === "object") base.workSchedule = parseado.workSchedule;
          if (parseado.dailyBreaks && typeof parseado.dailyBreaks === "object") base.dailyBreaks = parseado.dailyBreaks;
          if (!base.calendarExceptions && Array.isArray(parseado.calendarExceptions)) base.calendarExceptions = parseado.calendarExceptions;
        }
      } catch {
        // El cache local roto no puede matar la medicion: se sigue con lo que hay.
      }
    }
    const inyectado = (informe && typeof informe === "object" && informe.calendario) || {};
    return {
      workSchedule: inyectado.workSchedule || base.workSchedule || HORARIO_LABORAL_POR_DEFECTO,
      dailyBreaks: inyectado.dailyBreaks || base.dailyBreaks || DESCANSOS_DIARIOS_POR_DEFECTO,
      calendarExceptions: inyectado.calendarExceptions || base.calendarExceptions || [],
    };
  }

  function claveDeFecha(dia) {
    const y = dia.getFullYear();
    const m = String(dia.getMonth() + 1).padStart(2, "0");
    const d = String(dia.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  /**
   * Minutos LABORALES transcurridos entre dos instantes, mirando el calendario
   * de la planta día a día: solo las horas del horario laboral (el fin de
   * semana y las horas fuera de turno suman 0), restando los descansa diarios
   * activos y los periodos no laborables del calendario (los conceptos que son
   * de toda la planta: GENERAL, ASUETO y VACACIONES; los de maquina u operador
   * no frenan un guardado de catalogos y no se restan). La regla de ventana por
   * día replica a effectiveWindows de planner-core.js (planner-core.js:1800):
   * el primer día usa la hora de inicio del periodo, el último la de fin, y los
   * ASUETO/VACACIONES sin horas válidas bloquean el día completo.
   *
   * `ahora` es inyectable (timestamp en ms) para que el test mida contra
   * instantes fijos en vez del reloj del sistema.
   */
  function minutosLaborales(isoDesde, ahora, calendario) {
    const desde = new Date(isoDesde).getTime();
    if (!Number.isFinite(desde)) return 0;
    const hasta = typeof ahora === "number" ? ahora : Date.now();
    if (!Number.isFinite(hasta) || hasta <= desde) return 0;
    const cal = calendario || {};
    const dias = (cal.workSchedule || HORARIO_LABORAL_POR_DEFECTO);
    const descansa = cal.dailyBreaks || {};
    const excepciones = Array.isArray(cal.calendarExceptions) ? cal.calendarExceptions : [];
    const dia0 = new Date(desde);
    dia0.setHours(0, 0, 0, 0);
    let total = 0;
    for (let i = 0; i < TOPE_DIAS_LABORALES; i += 1) {
      const punto = new Date(dia0.getTime() + i * 86400000);
      const inicioDia = punto.getTime();
      const finDia = inicioDia + 86400000;
      if (inicioDia > hasta) break;
      const dia = dias[CLAVES_SEMANA[punto.getDay()]] || {};
      if (dia.enabled === false) continue;
      const horaInicio = minutosDeReloj(dia.start, 7 * 60);
      const horaFin = minutosDeReloj(dia.end, 17 * 60);
      if (horaFin <= horaInicio) continue;
      // El lapso que se mide es el cruce de [desde, hasta] con el DIA y con la
      // VENTANA LABORAL: las horas antes del turno y despues no suman, que es la
      // razon misma de que el umbral sea en horas laborales.
      let desdeMin = Math.max((Math.max(desde, inicioDia) - inicioDia) / 60000, horaInicio);
      let hastaMin = Math.min((Math.min(hasta, finDia) - inicioDia) / 60000, horaFin);
      if (hastaMin <= desdeMin) continue;
      for (const clave of Object.keys(descansa)) {
        const d = descansa[clave];
        if (!d || d.enabled !== true) continue;
        const bInicio = minutosDeReloj(d.start, 0);
        const bFin = minutosDeReloj(d.end, 0);
        if (bFin <= bInicio) continue;
        const traslapo = Math.min(hastaMin, bFin) - Math.max(desdeMin, bInicio);
        if (traslapo > 0) hastaMin -= traslapo;
      }
      if (hastaMin <= desdeMin) continue;
      const claveFecha = claveDeFecha(punto);
      for (const e of excepciones) {
        if (!e || e.active === false) continue;
        const concepto = String(e.concept || e.concepto || "GENERAL").toUpperCase();
        if (concepto !== "GENERAL" && concepto !== "ASUETO" && concepto !== "VACACIONES") continue;
        const inicioPeriodo = String(e.startDate || e.fechaInicio || e.fecha || "").trim();
        const finPeriodo = String(e.endDate || e.fechaFin || e.fecha || "").trim() || inicioPeriodo;
        if (!inicioPeriodo || claveFecha < inicioPeriodo || claveFecha > finPeriodo) continue;
        let bInicio = claveFecha === inicioPeriodo ? minutosDeReloj(e.start || e.horaInicio, 0) : 0;
        let bFin = claveFecha === finPeriodo ? minutosDeReloj(e.end || e.horaFin, 24 * 60) : 24 * 60;
        const todoElDia = concepto === "ASUETO" || concepto === "VACACIONES";
        if (todoElDia && bFin <= bInicio) { bInicio = 0; bFin = 24 * 60; }
        if (bFin <= bInicio) continue;
        const traslapo = Math.min(hastaMin, bFin) - Math.max(desdeMin, bInicio);
        if (traslapo > 0) hastaMin -= traslapo;
      }
      if (hastaMin > desdeMin) total += Math.round(hastaMin - desdeMin);
    }
    return total;
  }

  /** El aviso. A proposito vive fuera del flujo de la app: no la detiene. */
  function avisar(lineas, tono) {
    if (!root.document || !root.document.body) return;
    if (root.document.getElementById("pp-catalogo-aviso")) return;
    const caja = root.document.createElement("div");
    caja.id = "pp-catalogo-aviso";
    const estilo = root.document.createElement("style");
    estilo.textContent =
      "#pp-catalogo-aviso{position:fixed;left:12px;right:12px;top:12px;z-index:9997;padding:12px 14px;" +
      "border-radius:10px;font:13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35)}" +
      "#pp-catalogo-aviso.err{background:#3a1d22;border:1px solid #6b2b34;color:#ffb4bd}" +
      "#pp-catalogo-aviso.warn{background:#3a3018;border:1px solid #6b5a2b;color:#ffd68a}" +
      "#pp-catalogo-aviso b{display:block;margin-bottom:4px}" +
      "#pp-catalogo-aviso button{float:right;margin-left:10px;border:1px solid currentColor;background:transparent;color:inherit;border-radius:6px;padding:3px 9px;cursor:pointer}";
    root.document.head.appendChild(estilo);
    caja.className = tono;
    const cerrar = root.document.createElement("button");
    cerrar.type = "button";
    cerrar.textContent = "X";
    cerrar.addEventListener("click", () => { if (caja.parentNode) caja.parentNode.removeChild(caja); });
    caja.appendChild(cerrar);
    const texto = root.document.createElement("div");
    texto.innerHTML = lineas;
    caja.appendChild(texto);
    root.document.body.appendChild(caja);
  }

  /**
   * Corre la lectura. Devuelve un informe con lo que se leyo, lo que fallo y lo
   * viejo que esta, para que quien llame decida sin tener que adivinar.
   */
  async function correr() {
    const lector = root.PPSupabaseReader;
    if (!lector || typeof lector.isConfigured !== "function" || !lector.isConfigured()) {
      return { activo: false, motivo: "Supabase no configurado" };
    }
    // SIN SESION NO SE LEE NADA, Y NO SE REINTENTA NI UNA VEZ. MEDIDO 2026-09-29: sin
    // sesion la Data API responde HTTP 200 con CERO filas en las 22 tablas, porque
    // docs/schema-supabase-login-correo.sql dejo la lectura en `select to
    // authenticated`. O sea que el fallo de sesion NO es un error: es una respuesta
    // vacia que parece una base vacia. Por eso se comprueba la sesion ANTES de la
    // lectura y se sale con un motivo, en vez de leer 22 veces para no traer nada.
    const auth = root.PPSupabaseAuth;
    const token = auth && typeof auth.token === "function" ? await auth.token().catch(() => null) : null;
    if (!token) return { activo: false, motivo: "sin sesion de Supabase: entra con tu correo para leer los catalogos" };
    const conf = typeof lector.config === "function" ? lector.config() : (lector.config || {});
    const url = String(conf.url || "").replace(/\/+$/, "");
    const clave = String(conf.anonKey || "");

    const t0 = Date.now();
    let resultado = null;
    let fallo = null;
    try {
      resultado = await leerConReintentos(() => lector.readCatalogs(), "catalogos de Supabase");
    } catch (error) {
      fallo = String((error && error.message) || error);
    }

    const informe = {
      activo: true,
      ms: Date.now() - t0,
      fallo,
      applied: false,
      tablas: {},
      viejo: {},
      vacias: [],
    };
    if (!resultado) return informe;

    for (const t of (resultado.missing || [])) informe.vacias.push(t);
    for (const [t, e] of Object.entries(resultado.errors || {})) informe.fallo = `${t}: ${e}`;

    // Antiguedad por tabla, en paralelo y sin reintentos: es informacion, no el
    // camino critico, y no tiene por que retrasar la pantalla. Va con el MISMO token
    // de la lectura: sin el, `created_at` no se ve (0 filas) y la antiguedad salia
    // siempre como "sin datos" en vez de como "vieja".
    const tablas = Object.keys(resultado.catalogs || {});
    await Promise.all(tablas.map(async (t) => {
      const info = await antiguedadDe(url, clave, t, token);
      if (info) informe.viejo[t] = info;
    }));

    informe.catalogs = resultado.catalogs;
    informe.gaps = resultado.gaps || {};
    // Las cuatro de persona, para que el arranque pueda aplicarlas. Van al lado de
    // operations/work_orders/materials porque son el mismo tipo de dato: estado que la
    // pagina necesita para funcionar, no una tabla de consulta.
    informe.selectedOts = resultado.selectedOts;
    informe.lockedOts = resultado.lockedOts;
    informe.operationPlanStatuses = resultado.operationPlanStatuses;
    informe.appState = resultado.appState;
    // operations, workOrders y materials: el plan. El lector ya los mapea
    // (mapOperations, mapWorkOrders, mapMaterials) y el apply los necesita para
    // aplicarlos encima del estado. Sin esto el apply no puede hacer su trabajo.
    informe.operations = resultado.operations;
    informe.workOrders = resultado.workOrders;
    informe.materials = resultado.materials;
    return informe;
  }

  function lineasDelAviso(informe, ahora) {
    const partes = [];
    if (informe.fallo) partes.push(`<b>No se pudieron leer los catalogos de Supabase</b>${informe.fallo}<br>Se conserva lo que ya tenia la pagina.`);
    if (informe.vacias && informe.vacias.length) {
      partes.push(`<b>Tablas vacias en Supabase</b>${informe.vacias.join(", ")}. Sin respaldo, la pagina se queda sin eso.`);
    }
    // La decision se toma en horas LABORALES, no en horas de reloj: un finde
    // entero sin guardar suma 0 h laborales y no dispara (ver la regla de umbral
    // arriba y RULE-SUP-044, donde esta la medicion que mostro el falso positivo).
    // El texto sigue mostrando horas de reloj, que es lo que la persona conoce.
    const calendario = calendarioDelAviso(informe);
    const viejas = Object.entries(informe.viejo || {}).filter(([, v]) => v && minutosLaborales(v.iso, ahora, calendario) > UMBRAL_MINUTOS_LABORALES);
    if (viejas.length) {
      partes.push(`<b>Datos viejos en Supabase</b>${viejas.map(([t, v]) => `${t}: ${Math.round(v.minutos / 60)} h`).join(" · ")}. Sin respaldo, la pagina muestra eso.`);
    }
    return partes.join("<br><br>");
  }

  root.PPCatalogBoot = {
    correr,
    aviso: (informe, ahora) => {
      const html = lineasDelAviso(informe, ahora);
      if (!html) return false;
      avisar([html], "warn");
      return true;
    },
    // La funcion de medición, expuesta para el test: minutos laborales entre dos
    // instantes mirando el calendario de la planta.
    minutosLaborales,
    UMBRAL_MINUTOS_LABORALES,
    // El resolutor del calendario, por la misma razon: el test tiene que poder
    // comprobar la cascada (informe inyectado > cache local > de fabrica) sin
    // reimplementarla.
    resolverCalendario: calendarioDelAviso,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
