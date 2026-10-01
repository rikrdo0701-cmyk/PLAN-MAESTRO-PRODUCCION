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
 * 11 tablas de catalogo solo 7 estaban al dia. Y AL 2026-09-30 la escritura se partio en
 * dos, asi que ese conteo ya no describe una sola cosa:
 *   - La pestana CATALOGOS si se escribe desde la pagina, por PPSupabaseWriter
 *     (`guardarCatalogos`, seis tablas: tools, subcontracts, calendar_exceptions,
 *     ot_configurations, article_configurations y machine_planning_overrides). Antes esa
 *     pestana escribia las Hojas con `saveCatalogState` y el espejo las subia.
 *   - La pestana MATRIZ NO se escribe desde la pagina. operators, capabilities,
 *     operation_catalog y matrix siguen viniendo del ESPEJO de las Hojas (16-supabase-
 *     catalogo.js), que corre cuando el despliegue guarda la pagina de Habilidades. Por
 *     eso el escritor mete un aviso explicito cuando el ambito es `matrix`: el cambio se ve
 *     en esta pagina y no se pierde al recargar, pero todavia no es la fuente.
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

  function lineasDelAviso(informe) {
    const partes = [];
    if (informe.fallo) partes.push(`<b>No se pudieron leer los catalogos de Supabase</b>${informe.fallo}<br>Se conserva lo que ya tenia la pagina.`);
    if (informe.vacias && informe.vacias.length) {
      partes.push(`<b>Tablas vacias en Supabase</b>${informe.vacias.join(", ")}. Sin respaldo, la pagina se queda sin eso.`);
    }
    const viejas = Object.entries(informe.viejo || {}).filter(([, v]) => v && v.minutos > 60 * 20);
    if (viejas.length) {
      partes.push(`<b>Datos viejos en Supabase</b>${viejas.map(([t, v]) => `${t}: ${Math.round(v.minutos / 60)} h`).join(" · ")}. Sin respaldo, la pagina muestra eso.`);
    }
    return partes.join("<br><br>");
  }

  root.PPCatalogBoot = {
    correr,
    aviso: (informe) => {
      const html = lineasDelAviso(informe);
      if (!html) return false;
      avisar([html], "warn");
      return true;
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
