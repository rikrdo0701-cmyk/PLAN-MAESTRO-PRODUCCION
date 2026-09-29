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
 * LO QUE ESTA MEDIDO Y SIGUE SIN ESTAR LISTO. MEDIDO 2026-09-29 17:09, de las 11
 * tablas de catalogo solo 7 estan al dia. operators, capabilities, operation_catalog
 * y matrix siguen con la fecha del 2026-09-28, porque las escribe el guardado de la
 * pestana de Matriz (saveSkillState), que es un camino distinto del de Catalogos.
 * Leerlas de aqui SIN RESPALDO significa mostrar la matriz de ayer. Por eso este
 * modulo avisa de la antiguedad de lo que leyó, no solo de los fallos.
 *
 * Y el limite grande, que no es de este modulo: esto son los CATALOGOS. El plan
 * sigue viniendo del puente, y no por pereza sino porque el esquema de Supabase no
 * puede representarlo. MAPPING_GAPS en supabase-reader.js: a `operations` le faltan
 * num, parte, contenido, prioridad, fechaReq y log; a `work_orders` le faltan
 * dueDateOverride y los precios; a `article_configurations` le falta precio_ref_venta.
 * No son datos viejos, son columnas que NO EXISTEN. Sin el DDL que las agregue, y sin
 * las politicas de escritura, el plan no tiene donde vivir.
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
   * Antiguedad de lo leido, desde el created_at de la propia tabla. Sin esto, una
   * tabla con datos de hace dos dias y una de hace un minuto se ven igual.
   */
  async function antiguedadDe(url, clave, table) {
    const control = new AbortController();
    const t = root.setTimeout(() => control.abort(), TIMEOUT_POR_INTENTO_MS);
    try {
      const r = await fetch(`${url}/rest/v1/${table}?select=created_at&order=created_at.desc&limit=1`, {
        headers: { apikey: clave, "cache-control": "no-cache" },
        cache: "no-store",
        signal: control.signal,
      });
      if (!r.ok) return null;
      const j = await r.json();
      const iso = Array.isArray(j) && j[0] && j[0].created_at ? String(j[0].created_at) : "";
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
    if (!lector || !lector.configured || !lector.configured()) {
      return { activo: false, motivo: "Supabase no configurado" };
    }
    const url = (lector.config || {}).url || "";
    const clave = (lector.config || {}).anonKey || "";

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
    // camino critico, y no tiene por que retrasar la pantalla.
    const tablas = Object.keys(resultado.catalogs || {});
    await Promise.all(tablas.map(async (t) => {
      const info = await antiguedadDe(url, clave, t);
      if (info) informe.viejo[t] = info;
    }));

    informe.catalogs = resultado.catalogs;
    informe.gaps = resultado.gaps || {};
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
