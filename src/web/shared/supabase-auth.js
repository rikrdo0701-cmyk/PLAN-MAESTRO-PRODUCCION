/**
 * Sesion de Supabase: entrar, salir, y dar el token a quien lo necesite.
 *
 * POR QUE EXISTE Y POR QUE AHORA. La pagina tiene que dejar de depender de Apps
 * Script para leer y para guardar (RULE-SUP-019), y para escribir en Supabase
 * hace falta sesion. MEDIDO 2026-09-29 con GET /auth/v1/settings: el proveedor de
 * correo esta habilitado y la cuenta rikrdo.0701@gmail.com esta CONFIRMADA
 * (2026-09-29T17:52:10), o sea que la autenticacion YA FUNCIONA sin proveedor de
 * correo. Lo que no funciona todavia es el efecto: hasta que se aplique
 * docs/schema-supabase-login-correo.sql, RLS sigue diciendo `select to anon using
 * true` y la lectura no necesita sesion. Por eso este modulo se puede construir y
 * probar AHORA, y el dia que se aplique el DDL empieza a proteger sin tocar codigo.
 *
 * LA CONTRASENA NO SE TOCA EN ESTE ARCHIVO. Se teclea en el formulario, se manda
 * directo a Supabase, y no se guarda en ningun sitio: ni en localStorage, ni en el
 * log, ni en una variable global. Lo que se guarda es el JWT y el refresh_token,
 * que es lo unico que Supabase devuelve y lo que hace falta para no volver a
 * teclear. Ni el token ni la contrasena se imprimen nunca, ni en un error.
 *
 * DECISION QUE IMPORTA Y QUE SE LEE EN UNA LINEA: si Supabase no esta configurado
 * (faltan la URL o la clave publicable, o sea que el build corrio sin las
 * variables de entorno), este modulo NO bloquea la pagina. Muestra un aviso
 * visible y deja pasar. Lo contrario seria dejar inservible una app que funciona
 * por un fallo de configuracion del build, que es un fallo mio y no suyo. La
 * sesion es una puerta, no un requisito para arrancar.
 *
 * EL TOKEN SE RENUEVA SOLO. El JWT de Supabase dura una hora por omision. Antes de
 * cada uso se compara expires_at contra la hora actual y, si falta menos de un
 * minuto, se cambia por uno nuevo con el refresh_token. Sin esto, la sesion se
 * caeria a la hora de estar trabajando y el usuario veria un fallo en medio de una
 * operacion, que es la peor forma de fallar.
 */
(function (root) {
  "use strict";

  const DEFAULT_URL = "__PP_SUPABASE_URL__";
  const DEFAULT_ANON_KEY = "__PP_SUPABASE_ANON_KEY__";

  const CLAVE_ALMACEN = "pp_supabase_session";
  const REFRESCO_MARGEN_MS = 60 * 1000;
  const TIMEOUT_MS = 30 * 1000;

  const url = String(DEFAULT_URL || "").replace(/\/+$/, "");
  const anonKey = String(DEFAULT_ANON_KEY || "");
  const configurado = Boolean(url && anonKey && url.indexOf("__PP_") !== 0 && anonKey.indexOf("__PP_") !== 0);

  let refrescando = null;

  // ---------------------------------------------------------------------------
  // Red
  // ---------------------------------------------------------------------------

  /**
   * Una llamada a la API de Auth. NUNCA imprime la respuesta entera: puede
   * contener el token, y el token en un log es una credencial filtrada.
   */
  async function pedir(ruta, opciones) {
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), TIMEOUT_MS);
    try {
      const respuesta = await fetch(url + ruta, {
        method: (opciones && opciones.method) || "POST",
        headers: Object.assign(
          { "Content-Type": "application/json", apikey: anonKey },
          (opciones && opciones.headers) || {},
        ),
        body: opciones && opciones.body,
        signal: control.signal,
      });
      const texto = await respuesta.text();
      let cuerpo = null;
      try { cuerpo = texto ? JSON.parse(texto) : null; } catch { cuerpo = null; }
      return { ok: respuesta.ok, status: respuesta.status, cuerpo };
    } finally {
      clearTimeout(temporizador);
    }
  }

  function mensajeDeError(cuerpo, status) {
    const crudo = (cuerpo && (cuerpo.error_description || cuerpo.msg || cuerpo.message || cuerpo.error)) || "";
    const texto = String(crudo);
    // Sin SMTP no hay correo de recuperacion, asi que el caso mas probable es que
    // la cuenta exista pero no este confirmada. Se dice eso y no un codigo seco.
    if (/email not confirmed/i.test(texto)) return "La cuenta existe pero no esta confirmada. Cr\u00e9ala en Supabase con Auto Confirm User.";
    if (/invalid login credentials/i.test(texto)) return "Correo o contrasena incorrectos.";
    if (texto) return texto;
    return "No se pudo contacting Supabase (" + status + ")";
  }

  // ---------------------------------------------------------------------------
  // Sesion en disco
  // ---------------------------------------------------------------------------

  function leerSesion() {
    try {
      const crudo = root.localStorage.getItem(CLAVE_ALMACEN);
      if (!crudo) return null;
      const sesion = JSON.parse(crudo);
      return sesion && sesion.access_token ? sesion : null;
    } catch { return null; }
  }

  function guardarSesion(sesion) {
    try {
      if (sesion) root.localStorage.setItem(CLAVE_ALMACEN, JSON.stringify(sesion));
      else root.localStorage.removeItem(CLAVE_ALMACEN);
    } catch {
      // Modo privado o cuota llena: se sigue con la sesion en memoria, que
      // funciona igual mientras la pagina no se cierre. Es peor, no imposible.
    }
  }

  function normalizar(respuesta) {
    if (!respuesta || !respuesta.access_token) return null;
    return {
      access_token: respuesta.access_token,
      refresh_token: respuesta.refresh_token || "",
      expires_at: Date.now() + (Number(respuesta.expires_in || 3600) * 1000),
      correo: (respuesta.user && respuesta.user.email) || "",
    };
  }

  // ---------------------------------------------------------------------------
  // API publica
  // ---------------------------------------------------------------------------

  async function entrar(correo, contrasena) {
    if (!configurado) return { ok: false, error: "Supabase no esta configurado en este build" };
    const r = await pedir("/auth/v1/token?grant_type=password", {
      body: JSON.stringify({ email: String(correo || "").trim(), password: String(contrasena || "") }),
    });
    if (!r.ok || !r.cuerpo || !r.cuerpo.access_token) {
      return { ok: false, error: mensajeDeError(r.cuerpo, r.status) };
    }
    const sesion = normalizar(r.cuerpo);
    guardarSesion(sesion);
    notificar(sesion);
    return { ok: true, correo: sesion.correo };
  }

  /**
   * Recarga la pagina SI hay donde recargar. Que sea una funcion y no un `root.location.reload()`
   * en linea es por el modulo de pruebas, que corre este archivo con un DOM de mentira y sin
   * `location`: sin esta guarda el modulo revienta al entrar, en vez de fallar la prueba.
   */
  function recargar() {
    try {
      if (root.location && typeof root.location.reload === "function") root.location.reload();
    } catch (error) {
      console.warn("[pp-auth] no se pudo recargar tras cambiar la sesion:", String((error && error.message) || error));
    }
  }

  async function salir() {
    const sesion = leerSesion();
    guardarSesion(null);
    notificar(null);
    // MEDIDO 2026-10-01: sin esto, al salir la pagina sigue mostrando el plan que ya no puede
    // NI leer NI escribir, y el unico cambio visible es que vuelve el boton de entrar. Es el
    // mismo defecto que al entrar, por el otro lado: la pantalla no refleja lo que la sesion
    // permite. Un logout que no recarga deja datos en pantalla que ya no le pertenecen a nadie.
    recargar();
    if (sesion && sesion.refresh_token) {
      // Best effort. Si la red falla, la sesion local ya esta limpia, que es lo
      // que importa: que esta pagina deje de poder escribir.
      try { await pedir("/auth/v1/logout", { body: JSON.stringify({ refresh_token: sesion.refresh_token }) }); } catch { /* ya salimos */ }
    }
    return { ok: true };
  }

  async function renovar() {
    const sesion = leerSesion();
    if (!sesion || !sesion.refresh_token) return null;
    const r = await pedir("/auth/v1/token?grant_type=refresh_token", {
      body: JSON.stringify({ refresh_token: sesion.refresh_token }),
    });
    if (!r.ok || !r.cuerpo || !r.cuerpo.access_token) {
      // Un refresh fallido significa una de dos cosas: la sesion caduco de verdad,
      // o la contrasena se cambio desde la pagina de usuarios. En las dos, lo
      // unico que se puede hacer es pedir que entren otra vez.
      guardarSesion(null);
      notificar(null);
      return null;
    }
    const nueva = normalizar(Object.assign({}, r.cuerpo, { user: { email: sesion.correo } }));
    guardarSesion(nueva);
    return nueva;
  }

  /**
   * El token, renovado si toca. Unico punto de entrada: el lector y el escritor
   * tienen que pasar por aqui y no leer el almacenamiento ellos mismos, o se
   * quedarian con un token caducado sin enterarse.
   */
  async function token() {
    const sesion = leerSesion();
    if (!sesion) return null;
    if (sesion.expires_at - Date.now() > REFRESCO_MARGEN_MS) return sesion.access_token;
    // Una sola renovacion a la vez: si varias llamadas piden token a la vez y el
    // token esta a punto de caducar, sin esto cada una lanza su refresh y solo
    // uno sobrevive; los demas se quedan con un token viejo.
    if (!refrescando) {
      refrescando = renovar().finally(() => { refrescando = null; });
    }
    const nueva = await refrescando;
    return nueva ? nueva.access_token : null;
  }

  function notificar(sesion) {
    try {
      root.dispatchEvent(new CustomEvent("pp:sesion", { detail: { activo: Boolean(sesion), correo: sesion ? sesion.correo : "" } }));
    } catch { /* environments sin CustomEvent */ }
  }

  // ---------------------------------------------------------------------------
  // Pantalla
  // ---------------------------------------------------------------------------

  function estilos() {
    return `
#pp-login{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;
background:rgba(12,15,20,.96);color:#e8ecf1;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
#pp-login[hidden]{display:none}
#pp-login .pp-caja{width:min(380px,92vw);background:#171c24;border:1px solid #2b3442;border-radius:12px;padding:26px}
#pp-login h1{margin:0 0 4px;font-size:19px}
#pp-login p.sub{margin:0 0 20px;color:#9aa7b6;font-size:13px}
#pp-login label{display:block;margin:0 0 12px;font-size:12px;color:#9aa7b6;text-transform:uppercase;letter-spacing:.04em}
#pp-login input{width:100%;box-sizing:border-box;margin-top:5px;padding:10px 11px;border-radius:8px;
border:1px solid #2b3442;background:#0e1218;color:#e8ecf1;font-size:15px}
#pp-login input:focus{outline:2px solid #4b8cff;outline-offset:1px}
#pp-login button{width:100%;margin-top:6px;padding:11px;border:0;border-radius:8px;background:#2f6fed;
color:#fff;font-size:15px;font-weight:600;cursor:pointer}
#pp-login button:disabled{opacity:.6;cursor:progress}
#pp-login .pp-error{margin:14px 0 0;padding:10px;border-radius:8px;background:#3a1d22;border:1px solid #6b2b34;
color:#ffb4bd;font-size:13px;display:none}
#pp-login .pp-aviso{margin:14px 0 0;padding:10px;border-radius:8px;background:#3a3018;border:1px solid #6b5a2b;
color:#ffd68a;font-size:13px;display:none}
#pp-salir{position:fixed;right:12px;bottom:12px;z-index:9998;padding:6px 11px;border-radius:999px;
border:1px solid #2b3442;background:#171c24;color:#9aa7b6;font:12px system-ui,sans-serif;cursor:pointer}
#pp-salir[hidden]{display:none}
`.trim();
  }

  let nodo = null;

  function asegurarNodo() {
    if (nodo) return nodo;
    if (!root.document) return null;
    if (!root.document.getElementById("pp-login-estilos")) {
      const estilo = root.document.createElement("style");
      estilo.id = "pp-login-estilos";
      estilo.textContent = estilos();
      root.document.head.appendChild(estilo);
    }
    nodo = root.document.createElement("div");
    nodo.id = "pp-login";
    nodo.hidden = true;
    nodo.innerHTML =
      '<div class="pp-capa">' +
      '<div class="pp-caja">' +
      '<h1>Plan Maestro Producci&oacute;n</h1>' +
      '<p class="sub">Entra para ver y modificar la planificaci&oacute;n.</p>' +
      '<label>Correo<input id="pp-login-correo" type="email" autocomplete="username" spellcheck="false"></label>' +
      '<label>Contrase&ntilde;a<input id="pp-login-clave" type="password" autocomplete="current-password"></label>' +
      '<button id="pp-login-entrar" type="button">Entrar</button>' +
      '<p class="pp-error" id="pp-login-error"></p>' +
      '<p class="pp-aviso" id="pp-login-aviso"></p>' +
      "</div></div>";
    root.document.body.appendChild(nodo);
    return nodo;
  }

  function mostrarAviso(texto) {
    if (!nodo) return;
    const aviso = root.document.getElementById("pp-login-aviso");
    if (!aviso) return;
    aviso.textContent = texto;
    aviso.style.display = texto ? "block" : "none";
  }

  function mostrarError(texto) {
    if (!nodo) return;
    const caja = root.document.getElementById("pp-login-error");
    if (!caja) return;
    caja.textContent = texto;
    caja.style.display = texto ? "block" : "none";
  }

  function botonSalir() {
    if (!root.document) return null;
    if (root.document.getElementById("pp-salir")) return root.document.getElementById("pp-salir");
    const b = root.document.createElement("button");
    b.id = "pp-salir";
    b.type = "button";
    b.textContent = "Salir";
    b.title = "Cerrar la sesion";
    b.addEventListener("click", async () => { await salir(); });
    root.document.body.appendChild(b);
    return b;
  }

  function pintar(sesion) {
    const boton = botonSalir();
    if (boton) boton.hidden = !sesion;
    if (nodo) nodo.hidden = Boolean(sesion);
    if (!sesion) {
      const correo = root.document.getElementById("pp-login-correo");
      if (correo && root.document.activeElement !== correo) correo.focus();
    }
  }

  async function montar() {
    const activo = Boolean(leerSesion());
    if (activo) {
      // Hay sesion guardada. Se usa de entrada para no pedir la contrasena en cada
      // recarga, pero se RENUEVA igual: si el refresh falla, la sesion caduco y hay
      // que pedirla. Por eso el token() se llama y se espera antes de pintar.
      const t = await token();
      pintar(Boolean(t));
    } else if (!configurado) {
      // Fail open, y dicho en la pagina y no solo en la consola. Ver la cabecera.
      console.warn("[pp-auth] Supabase sin configurar en este build: no hay login, no hay JWT y con RLS `to authenticated` no se lee ni se escribe nada. No existe respaldo por puente (desde RULE-SUP-030): publica este build con credenciales.");
      return;
    } else {
      asegurarNodo();
      pintar(null);
    }
  }

  async function alEntrar() {
    const campoCorreo = root.document.getElementById("pp-login-correo");
    const campoClave = root.document.getElementById("pp-login-clave");
    const boton = root.document.getElementById("pp-login-entrar");
    if (!campoCorreo || !campoClave) return;
    const correo = campoCorreo.value;
    const clave = campoClave.value;
    mostrarError("");
    boton.disabled = true;
    boton.textContent = "Entrando...";
    const r = await entrar(correo, clave);
    boton.disabled = false;
    boton.textContent = "Entrar";
    if (!r.ok) { mostrarError(r.error); return; }
    // La clave se borra del formulario ya, antes de nada: que no quede escrita en
    // el DOM mas de lo que hace falta.
    campoClave.value = "";
    pintar(leerSesion());

    // MEDIDO 2026-10-01: ENTRAR NO RECARGABA LOS DATOS, y por eso la pagina se quedaba en ceros
    // con la sesion puesta. La cadena, medida en la pagina real:
    //   1. Al arrancar SIN sesion, la app lee work_orders, operations, materials y los catalogos
    //      UNA vez. Sin token, la Data API responde 200 con 0 filas (RULE-SUP-037), y la pagina
    //      pinta la app entera con ceros: "Backlog 0 OTs", "Planeado / No planeado 0 en el plan".
    //   2. `pintar` quita el velo de entrada. A partir de aqui la pagina PARECE viva.
    //   3. `notificar(sesion)` no tiene UN solo suscriptor: la API publica de este modulo no
    //      expone onChange, y nadie lo busca en ningun otro archivo de src/web.
    //   4. Nadie vuelve a leer. El resultado es una pagina con sesion valida que muestra los
    //      ceros del arranque, sin velo y sin aviso. Es el peor de los dos casos: el dato falso
    //      con la pagina presentable, que es cuando nadie va a mirar la consola.
    //
    // POR QUE RECARGAR Y NO UN onChange. Poner un onChange obligaria a poder volver a pedir
    // entero el arranque, y ese arranque esta repartido: lectura de catalogos, sync de OTs, sync
    // de operaciones, estado del plan y borradores. Cada uno con su propio camino, y el que se
    // olvide se queda en cero igual, pero sin que se note. La recarga no se puede dejar a medias:
    // lo que no se recarga, no se lee. Y no se pierde trabajo, porque el borrador esta en
    // localStorage y el arranque lo restaura.
    recargar();
  }

  if (root.document) {
    // NADA de esto puede lanzar. Este modulo corre en el mismo DOMContentLoaded que
    // el arranque de la app, y una excepcion ahi se lleva por delante una pagina que
    // funciona. MEDIDO 2026-09-29: un stub de DOM que devolvia null por getElementById
    // revento en esta linea, y el aviso es legitimo: si el div se creo pero sus hijos
    // todavia no estan (cuerpo anadido tarde, innerHTML sin parsear), el boton no
    // existe. Se comprueba uno por uno y se sigue.
    const empezar = () => {
      try {
        asegurarNodo();
        const alPulsar = (evento) => {
          if (evento && evento.key === "Enter") alEntrar();
        };
        for (const [id,fn] of [["pp-login-entrar", () => alEntrar()], ["pp-login-correo", alPulsar], ["pp-login-clave", alPulsar]]) {
          const el = nodo ? root.document.getElementById(id) : null;
          if (el && el.addEventListener) el.addEventListener(id === "pp-login-entrar" ? "click" : "keydown", fn);
        }
      } catch (error) {
        console.warn("[pp-auth] no se pudo montar la pantalla de entrada; la pagina sigue sin sesion:", String((error && error.message) || error));
      }
      montar().catch((error) => console.warn("[pp-auth] fallo al pintar la sesion:", String((error && error.message) || error)));
    };
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", empezar, { once: true });
    else empezar();
    root.addEventListener("pp:sesion", (e) => pintar(e && e.detail ? e.detail.activo : null));
  }

  root.PPSupabaseAuth = {
    configurado,
    entrar,
    salir,
    token,
    haySesion: () => Boolean(leerSesion()),
    correoSesion: () => (leerSesion() || {}).correo || "",
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
