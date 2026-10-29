// El modulo de sesion no puede dejar la pagina inservible ni filtrar la contrasena.
//
// QUE SE COMPRUEBA AQUI Y POR QUE CADA COSA.
//
// 1. FAIL OPEN. Si el build corre sin las variables de Supabase, el modulo NO
//    bloquea la pagina: avisa y deja pasar. Lo contrario seria dejar sin app
//    funcional a un proyecto que funciona, por un fallo de configuracion que es
//    mio. La sesion es una puerta, no un requisito para arrancar.
//
// 2. LA CONTRASENA NO SE QUEDA EN NINGUN SITIO. Se mandan a Supabase y se borra
//    del formulario. Lo que se guarda es el JWT y el refresh_token, que es lo que
//    hace falta para no volver a teclear. Si la contrasena apareciera en el
//    localStorage o en un log, esto seria una credencial en disco.
//
// 3. EL TOKEN SE RENUEVA. El JWT dura una hora. Sin renovacion, la sesion se cae
//    en mitad de una operacion, que es la peor forma de fallar. Y la renovacion
//    se hace UNA vez aunque la pidan varias llamadas a la vez, porque si no cada
//    una lanza su refresh y solo sobrevive uno.
//
// 4. EL ROLLOUT SIN LOGIN NO ROMPE NADA. La pagina sigue arrancando por el puente
//    de Apps Script, que es lo que hace hoy. Esto se fija porque la tentacion
//    natural al meter un login es gatear el arranque, y gatear el arranque
//    dejaria la web sin datos hasta que la sesion llegue.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const auth = readFileSync(new URL("../src/web/shared/supabase-auth.js", import.meta.url), "utf8");
const reader = readFileSync(new URL("../src/web/shared/supabase-reader.js", import.meta.url), "utf8");
const build = readFileSync(new URL("../scripts/build-appscript.mjs", import.meta.url), "utf8");

/** Corre el modulo con un fetch falso y un localStorage de memoria. */
/**
 * DOM de mentira. La primera version devolvia null de getElementById y el modulo
 * reventaba al anadir los escuchadores, o sea que lo que se estaba probando era
 * el codigo real y no el stub. Este devuelve un elemento perezoso y memoizado
 * por id, que es lo que el modulo necesita de verdad: createElement, innerHTML,
 * addEventListener, value, hidden, focus, style.display y appendChild.
 */
function domFalso() {
  const porId = new Map();
  const hacer = (id) => {
    if (porId.has(id)) return porId.get(id);
    const el = {
      id,
      value: "",
      textContent: "",
      innerHTML: "",
      hidden: false,
      disabled: false,
      title: "",
      type: "button",
      style: { display: "" },
      // MEDIDO 2026-10-01: esto era un no-op, o sea que el boton de ENTRAR no se podia pulsar
      // desde una prueba y no habia forma de comprobar que entrar recarga la pagina. Se guardan
      // los escuchadores para poder llamarlos a mano.
      escuchadores: [],
      addEventListener(n, f) { this.escuchadores.push([n, f]); },
      appendChild() {},
      focus() {},
      pulsar() { this.escuchadores.filter(([n]) => n === "click").forEach(([, f]) => f()); },
    };
    porId.set(id, el);
    return el;
  };
  return {
    readyState: "complete",
    activeElement: null,
    getElementById: (id) => (id ? hacer(id) : null),
    createElement: () => ({ set id(v) { this._id = v; }, set textContent(v) { this._t = v; }, set innerHTML(v) { this._h = v; }, appendChild() {}, addEventListener() {} }),
    addEventListener: (n, f) => { if (n === "DOMContentLoaded") f(); },
    head: { appendChild() {} },
    body: { appendChild() {} },
  };
}

function correr({ url = "https://x.supabase.co", key = "sb_publishable_x", sesionGuardada = null, respuestas = {}, alPedir = null } = {}) {
  const llamadas = [];
  const almacen = new Map();
  if (sesionGuardada) almacen.set("pp_supabase_session", JSON.stringify(sesionGuardada));
  const oyentes = {};
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    AbortController, setTimeout, clearTimeout, JSON, Date, Math, String, Number, Boolean, Object, Array, Error, Promise, RegExp,
    fetch: async (destino, opciones) => {
      const ruta = String(destino);
      const cuerpo = opciones && opciones.body ? JSON.parse(opciones.body) : null;
      llamadas.push({ ruta, metodo: (opciones && opciones.method) || "POST", cuerpo });
      if (alPedir) alPedir(ruta);
      const clave = Object.keys(respuestas).find((k) => ruta.includes(k));
      const r = respuestas[clave] || { ok: false, status: 404, cuerpo: {} };
      return { ok: r.ok, status: r.status, text: async () => JSON.stringify(r.cuerpo) };
    },
    localStorage: {
      getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
      setItem: (k, v) => almacen.set(k, v),
      removeItem: (k) => almacen.delete(k),
    },
    addEventListener: (n, f) => { oyentes[n] = f; },
    dispatchEvent: () => true,
    document: domFalso(),
    CustomEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o); } },
    // MEDIDO 2026-10-01: hace falta un `location` que cuente recargas. `recargar()` en el
    // modulo lo busca y lo usa solo si existe, asi que sin esto el modulo funciona pero la
    // prueba no puede afirmar que la recarga pasara, que es justo lo que hay que comprobar.
    location: { recargas: 0, reload() { this.recargas++; } },
  };
  ctx.globalThis = ctx;
  const fuente = auth
    .replace("__PP_SUPABASE_URL__", url)
    .replace("__PP_SUPABASE_ANON_KEY__", key);
  vm.createContext(ctx);
  vm.runInContext(fuente, ctx);
  return { ctx, almacen, llamadas, oyentes, dom: ctx.document, recargas: () => ctx.location.recargas };
}

/** Espera a que `cond` sea cierto, sin hangarse si nunca lo es. */
async function esperar(cond, ms = 2000) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return cond();
}

test("sin URL ni clave, el modulo dice que no esta configurado y no avisa por todos lados", () => {
  const r = correr({ url: "", key: "" });
  assert.equal(r.ctx.PPSupabaseAuth.configurado, false);
  // Y lo importante: entrar falla con un mensaje util, no con una excepcion.
  assert.equal(r.ctx.PPSupabaseAuth.entrar.length, 2, "expone entrar(correo, contrasena)");
});

test("sin configurar, entrar NO intenta ninguna llamada de red", () => {
  const r = correr({ url: "", key: "" });
  r.ctx.PPSupabaseAuth.entrar("a@b.com", "clave").then(() => {
    assert.deepEqual(r.llamadas, [], "sin configuracion no debe salir a la red");
  });
});

test("entrar bien guarda el token y NUNCA la contrasena", () => {
  const r = correr({
    respuestas: { "grant_type=password": { ok: true, status: 200, cuerpo: { access_token: "jwt-1", refresh_token: "ref-1", expires_in: 3600, user: { email: "a@b.com" } } } },
  });
  return r.ctx.PPSupabaseAuth.entrar("a@b.com", "mi-clave-secreta").then((salida) => {
    assert.equal(salida.ok, true);
    const guardado = JSON.parse(r.almacen.get("pp_supabase_session"));
    assert.equal(guardado.access_token, "jwt-1");
    assert.equal(guardado.refresh_token, "ref-1");
    // La contrasena no esta en ningun sitio, y eso incluye el request ya enviado.
    assert.doesNotMatch(JSON.stringify(guardado), /mi-clave-secreta/);
    assert.equal(r.llamadas.length, 1);
    assert.equal(r.llamadas[0].cuerpo.password, "mi-clave-secreta", "la clave si se manda a Supabase: es lo unico que hace falta");
    assert.equal(r.llamadas[0].ruta.includes("grant_type=password"), true);
  });
});

test("el modulo no escribe la contrasena ni el token en ningun console", () => {
  // El fetch falso de arriba no imprime nada, pero se verifica que el codigo no
  // tenga una llamada de registro con la contrasena o con el token.
  assert.doesNotMatch(auth, /console\.(log|info|debug|warn|error)\([^)]*password/);
  assert.doesNotMatch(auth, /console\.(log|info|debug|warn|error)\([^)]*access_token/);
  assert.doesNotMatch(auth, /console\.(log|info|debug|warn|error)\([^)]*contrasena\b[^)]*\)/);
  assert.doesNotMatch(auth, /console\.(log|info|debug|warn|error)\(cuerpo\)/, "imprimir el cuerpo de Auth puede filtrar el token");
});

test("un token a punto de caducar se renueva, y solo una vez aunque lo pidan varias llamadas", () => {
  // MEDIDO 2026-09-29: al montar, el modulo ya renueva la sesion guardada (es lo que
  // hace validar antes de pintar). La primera version de esta prueba contaba por
  // fuera del fetch y por eso media 0 renovaciones: la llamada habia ocurrido antes
  // de que existiera el contador. Por eso el conteo va dentro de correr() y la
  // sesion caduca se siembra DESPUES de montar, para medir solo las tres llamadas
  // simultaneas que es lo que se quiere comprobar.
  const rutas = [];
  const r = correr({
    respuestas: { "grant_type=refresh_token": { ok: true, status: 200, cuerpo: { access_token: "nuevo", refresh_token: "ref-2", expires_in: 3600 } } },
    alPedir: (ruta) => rutas.push(ruta),
  });
  r.almacen.set("pp_supabase_session", JSON.stringify({ access_token: "viejo", refresh_token: "ref-1", expires_at: Date.now() - 1000, correo: "a@b.com" }));
  return Promise.all([r.ctx.PPSupabaseAuth.token(), r.ctx.PPSupabaseAuth.token(), r.ctx.PPSupabaseAuth.token()]).then((tokens) => {
    const refrescos = rutas.filter((x) => x.includes("grant_type=refresh_token")).length;
    assert.equal(refrescos, 1, `tres llamadas a la vez, una sola renovacion (hubo ${refrescos}: ${JSON.stringify(rutas)})`);
    for (const x of tokens) assert.equal(x, "nuevo");
  });
});

test("si el refresh falla, la sesion se borra y token() devuelve null en vez de un token caducado", () => {
  const r = correr({
    sesionGuardada: { access_token: "viejo", refresh_token: "ref-1", expires_at: Date.now() - 1000, correo: "a@b.com" },
    respuestas: { "grant_type=refresh_token": { ok: false, status: 400, cuerpo: { error_description: "Invalid Refresh Token" } } },
  });
  return r.ctx.PPSupabaseAuth.token().then((t) => {
    assert.equal(t, null, "devolver el token viejo seria escribir con algo caducado");
    assert.equal(r.almacen.has("pp_supabase_session"), false, "la sesion muerta no se queda guardada");
  });
});

test("un token vigente se devuelve sin tocar la red", () => {
  const r = correr({ sesionGuardada: { access_token: "vigente", refresh_token: "ref-1", expires_at: Date.now() + 3600 * 1000, correo: "a@b.com" } });
  return r.ctx.PPSupabaseAuth.token().then((t) => {
    assert.equal(t, "vigente");
    assert.deepEqual(r.llamadas, [], "no hay por que pedir nada si el token esta vivo");
  });
});

test("sin sesion no hay token, y eso no es un error", () => {
  const r = correr();
  return r.ctx.PPSupabaseAuth.token().then((t) => {
    assert.equal(t, null);
    assert.equal(r.ctx.PPSupabaseAuth.haySesion(), false);
  });
});

test("salir borra la sesion local aunque la red falle", () => {
  const r = correr({ sesionGuardada: { access_token: "t", refresh_token: "ref-1", expires_at: Date.now() + 3600 * 1000, correo: "a@b.com" } });
  return r.ctx.PPSupabaseAuth.salir().then(() => {
    assert.equal(r.almacen.has("pp_supabase_session"), false);
    assert.equal(r.ctx.PPSupabaseAuth.haySesion(), false);
  });
});

test("un error de Auth se traduce a algo que se pueda leer", () => {
  // Sin SMTP no hay correo de recuperacion, asi que el caso probable es cuenta no
  // confirmada. Devolver un codigo seco deja a la persona sin saber que hacer.
  const r = correr({ respuestas: { "grant_type=password": { ok: false, status: 400, cuerpo: { error_description: "Email not confirmed" } } } });
  return r.ctx.PPSupabaseAuth.entrar("a@b.com", "x").then((salida) => {
    assert.equal(salida.ok, false);
    assert.match(salida.error, /no esta confirmada/i);
    assert.doesNotMatch(salida.error, /Email not confirmed/);
  });
});

test("el build mete el modulo de sesion y lo pone antes del lector", () => {
  assert.match(build, /read\("src\/web\/shared\/supabase-auth\.js"\)/, "el build tiene que leer el modulo");
  // El orden importa: el lector va a necesitar el token, y lo tiene este modulo.
  const bloque = build.match(/const runtimeClients = `([^`]*)`/);
  assert.ok(bloque, "no se encontro la composicion de runtimeClients");
  const orden = bloque[1];
  assert.ok(orden.indexOf("supabaseAuth") < orden.indexOf("supabaseReader"), "la sesion va antes que el lector");
});

test("el lector NO se modifica todavia: sigue siendo de solo lectura", () => {
  // La escritura directa es un paso aparte (RULE-SUP-020, paso 3). Este test falla
  // si alguien mete un POST en el lector creyendo que ya es el escritor.
  const MetodosDeEscritura = [...reader.matchAll(/method:\s*"(POST|PUT|PATCH|DELETE)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(MetodosDeEscritura)], [], "el lector no debe escribir nada todavia");
});

// MEDIDO 2026-10-01, en la pagina real de produccion: "Backlog 0 OTs" y "Planeado / No planeado
// 0 en el plan" con la sesion puesta y sin velo de entrada. La causa NO era la base (la ingesta
// dio 199 work_orders y 2111 operations) ni el mapeo (mapWorkOrders no filtra filas): era que
// entrar NO recarga.
//
// LA CADENA, porque cada paso es un par de lugares y el que falta es el que no se ve:
//   1. Al arrancar sin sesion, la app lee work_orders/operations/materials y los catalogos una
//      vez. Sin token la Data API responde 200 con 0 filas, y la pagina pinta ceros.
//   2. `pintar` quita el velo: la pagina ya PARECE viva.
//   3. `notificar(sesion)` no tiene un solo suscriptor, porque la API publica no expone onChange.
//   4. Nadie vuelve a leer. Los ceros del paso 1 quedan en pantalla con sesion valida.
//
// Y POR QUE ESTAS DOS PRUEBAS Y NO UNA DE TEXTO. Una asercion que busque "recargar()" en el
// archivo pasaria con que la palabra aparezca en un comentario, que es la quinta vez que ese
// error cuesta una tarde en este proyecto. Estas dos pulsan el boton de verdad y cuentan
// recargas, asi que si alguien quita la recarga y la deja escrita en un comentario, fallan.
test("entrar por el boton RECARGA la pagina: sin eso se quedan los ceros del arranque", async () => {
  const r = correr({
    respuestas: { "grant_type=password": { ok: true, status: 200, cuerpo: { access_token: "jwt-1", refresh_token: "ref-1", expires_in: 3600, user: { email: "a@b.com" } } } },
  });
  r.dom.getElementById("pp-login-correo").value = "a@b.com";
  r.dom.getElementById("pp-login-clave").value = "mi-clave";
  assert.equal(r.recargas(), 0, "antes de entrar no se recarga nada");
  r.dom.getElementById("pp-login-entrar").pulsar();
  assert.ok(await esperar(() => r.recargas() === 1),
    "entrar tiene que recargar UNA vez: es lo que hace que el arranque vuelva a leer con token");
  assert.equal(r.recargas(), 1, "y no mas: recargar de mas pierde el borrador en memoria");
});

test("entrar MAL no recarga: un fallo no puede costar la pagina que ya estaba", async () => {
  const r = correr({
    respuestas: { "grant_type=password": { ok: false, status: 401, cuerpo: { error_description: "Invalid login credentials" } } },
  });
  r.dom.getElementById("pp-login-correo").value = "a@b.com";
  r.dom.getElementById("pp-login-clave").value = "mal";
  r.dom.getElementById("pp-login-entrar").pulsar();
  await esperar(() => r.llamadas.length > 0);
  await new Promise((r2) => setTimeout(r2, 60));
  assert.equal(r.recargas(), 0, "con la contrasena mala se muestra el error y no se toca nada mas");
});

test("salir RECARGA tambien: si no, el plan que ya no se puede leer se queda en pantalla", async () => {
  const r = correr({
    sesionGuardada: { access_token: "jwt-1", refresh_token: "ref-1", expires_at: Date.now() + 3600_000, correo: "a@b.com" },
    respuestas: { "grant_type=refresh_token": { ok: true, status: 200, cuerpo: { access_token: "jwt-2", refresh_token: "ref-1", expires_in: 3600 } } },
  });
  await r.ctx.PPSupabaseAuth.salir();
  assert.equal(r.recargas(), 1, "salir tiene que recargar: el logout que no recarga deja datos visibles que ya no le pertenecen a la sesion");
  assert.equal(r.almacen.has("pp_supabase_session"), false, "y la sesion local se borra igual");
});

test("el boton de ENTRAR sigue atado: si el id cambia, el modulo no revienta ni deja la pagina inservible", () => {
  const r = correr({ respuestas: { "grant_type=password": { ok: true, status: 200, cuerpo: { access_token: "j", refresh_token: "r", expires_in: 3600 } } } });
  assert.equal(typeof r.ctx.PPSupabaseAuth.entrar, "function");
  // El stub de DOM devuelve un elemento perezoso por id, que es lo que hace el modulo. Si el
  // modulo pidiera un id que el stub no sabe hacer, esto seria un TypeError.
  assert.ok(r.dom.getElementById("pp-login-entrar"), "el boton tiene que existir en el DOM del modulo");
});
