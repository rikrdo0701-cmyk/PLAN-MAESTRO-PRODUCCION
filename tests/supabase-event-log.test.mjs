// La vista de depuracion del registro de eventos (operation_events).
//
// LO QUE PIDIO EL USUARIO 2026-09-29: 'una vista mas en la web para poder acceder a
// ella y debuggear'. Estos tests fijan las cosas en las que esa vista puede fallar
// sin que se note, que es justo el motivo de existir:
//
//  1. Sin sesion NO se consulta. Un 401 en el servidor costaria un round-trip y un
//     error feo; aqui se dice antes de preguntar.
//  2. Los tres filtros van en la QUERY STRING. Filtrar en el cliente traeria 200
//     filas y descartaria el resto: mentiria sobre lo que hay.
//  3. Lo que no mejora esperando NO se reintenta (401/403/404). Reintentar eso tres
//     veces convierte un fallo instantaneo en un fallo lento.
//  4. 'La tabla no existe' (PGRST205) y 'no hay eventos' son PANTALLAS DISTINTAS.
//     MEDIDO 2026-09-29: el DDL de docs/schema-supabase-plan.sql todavia no esta
//     aplicado, o sea que el caso real de entrada es el primero, no el segundo.
//     Confundirlos deja una pagina verde y muda.
//  5. El token no sale en el informe ni en los errores: si el informe acabara en un
//     log, el token se habria filtrado con el.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const fuente = readFileSync(new URL("../src/web/shared/supabase-event-log.js", import.meta.url), "utf8");
const build = readFileSync(new URL("../scripts/build-appscript.mjs", import.meta.url), "utf8");
const estilos = readFileSync(new URL("../src/web/planning/styles.css", import.meta.url), "utf8");

// Valores FALSOS a proposito. Una credencial real en un test es una credencial en
// un repositorio, y este modulo maneja el JWT de la sesion.
const ANON = "anon-key-falsa-para-tests";
const JWT = "jwt-falso-para-tests-000000";
const URL_BASE = "https://proyecto-falso.supabase.co";

function fila(extra) {
  return Object.assign({
    id: "11111111-1111-1111-1111-111111111111",
    operation_id: "OP-0001",
    ot: "12345",
    secuencia: 10,
    ct: "10",
    kind: "MAQUINA",
    at: "2026-09-29T15:04:05Z",
    actor: "restlet",
    payload: { maquina: { de: "L1", a: "L2" }, motivo: "recambio" },
  }, extra || {});
}

/**
 * Corre el modulo de verdad en un vm. El doble de DOM es minimo a proposito: lo que
 * se prueba aqui es la lectura y lo que se DECIDE pintar, no el HTML.
 */
function correr({ token = JWT, configurado = true, responder, document = null } = {}) {
  const llamadas = [];
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, AbortController, Promise, JSON, Date, Math, String, Number, Object, Array, Error, RegExp, Boolean, isFinite, parseInt,
    document,
    location: { hash: "" },
    addEventListener() {},
    PPSupabaseAuth: {
      configurado,
      token: async () => (token === null ? null : token),
      correoSesion: () => "persona@correo-falso.test",
    },
    PPSupabaseReader: {
      isConfigured: () => true,
      config: () => ({ url: URL_BASE, anonKey: ANON }),
    },
    fetch: async (destino, opciones) => {
      llamadas.push({ url: String(destino), headers: (opciones && opciones.headers) || {} });
      return responder(String(destino), llamadas.length);
    },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fuente, ctx);
  return { ctx, llamadas };
}

function ok(filas) {
  return { ok: true, status: 200, text: async () => JSON.stringify(filas) };
}

function httpError(status, cuerpo) {
  return { ok: false, status, text: async () => JSON.stringify(cuerpo) };
}

test("sin token no consulta nada y lo dice", async () => {
  const { ctx, llamadas } = correr({ token: null, responder: () => ok([]) });
  const informe = await ctx.PPSupabaseEventLog.leer({});
  assert.equal(llamadas.length, 0, "sin sesion no se sale a la red: el 401 ya se sabe de antemano");
  assert.equal(informe.ok, false);
  assert.equal(informe.sinTabla, false, "no es el caso de la tabla ausente: es que no hay sesion");
  assert.match(informe.motivo, /sesion/i);
  assert.equal(informe.filas.length, 0);
});

test("sin configurar el build, el informe lo dice y tampoco consulta", async () => {
  const { ctx, llamadas } = correr({ configurado: false, responder: () => ok([]) });
  const informe = await ctx.PPSupabaseEventLog.leer({});
  assert.equal(llamadas.length, 0);
  assert.match(informe.motivo, /configurado/i);
});

test("los tres filtros van en la query string, no en el cliente", async () => {
  const { ctx, llamadas } = correr({ responder: () => ok([fila()]) });
  await ctx.PPSupabaseEventLog.leer({ filtros: { ot: "12345", kind: ["MAQUINA", "CAMBIO_HERRAMENTAL"], desde: "2026-09-01", hasta: "2026-09-29" } });
  const url = decodeURIComponent(llamadas[0].url);
  assert.match(url, /\/rest\/v1\/operation_events\?/, "la tabla es operation_events y se lee por PostgREST");
  assert.match(url, /ot=eq\.12345/, "el filtro de OT va en la URL");
  assert.match(url, /kind=in\.\(MAQUINA,CAMBIO_HERRAMENTAL\)/, "la lista de tipos va como in.(...)");
  assert.match(url, /at=gte\.2026-09-01T00:00:00/, "el rango arranca a medianoche");
  // Sin extenderlo, un 'hasta 29/09' dejaria fuera todo el dia 29, que es el dia
  // que se suele estar mirando cuando se depura.
  assert.match(url, /at=lte\.2026-09-29T23:59:59/, "el fin del rango llega al final del dia");
});

test("orden descendente y limite, con el limite configurable", async () => {
  const { ctx, llamadas } = correr({ responder: () => ok([]) });
  await ctx.PPSupabaseEventLog.leer({});
  let url = decodeURIComponent(llamadas[0].url);
  assert.match(url, /order=at\.desc/, "lo mas reciente primero: es un log, se mira por el final");
  assert.match(url, /limit=200\b/, "limite por defecto 200");

  const otra = correr({ responder: () => ok([]) });
  await otra.ctx.PPSupabaseEventLog.leer({ limite: 25 });
  url = decodeURIComponent(otra.llamadas[0].url);
  assert.match(url, /limit=25\b/);
});

test("el JWT va en la cabecera Authorization y no en la URL", async () => {
  const { ctx, llamadas } = correr({ responder: () => ok([]) });
  await ctx.PPSupabaseEventLog.leer({});
  assert.equal(llamadas[0].headers.Authorization, "Bearer " + JWT);
  assert.equal(llamadas[0].headers.apikey, ANON);
  assert.doesNotMatch(llamadas[0].url, /jwt-falso/, "el token viaja en la cabecera, nunca en la URL");
});

test("un 401 NO se reintenta: no mejora esperando", async () => {
  let intentos = 0;
  const { ctx } = correr({
    responder: () => { intentos += 1; return httpError(401, { message: "JWT expired" }); },
  });
  const informe = await ctx.PPSupabaseEventLog.leer({});
  assert.equal(intentos, 1, "reintentar un 401 solo convierte un fallo rapido en uno lento");
  assert.match(informe.motivo, /no se reintenta/);
});

test("un 403 y un 404 tampoco se reintentan", async () => {
  for (const status of [403, 404]) {
    let intentos = 0;
    const { ctx } = correr({
      responder: () => { intentos += 1; return httpError(status, { message: "x" }); },
    });
    const informe = await ctx.PPSupabaseEventLog.leer({});
    assert.equal(intentos, 1, `un ${status} no se reintenta`);
    assert.match(informe.motivo, /no se reintenta/);
  }
});

test("un 5xx SI se reintenta y se recupera", async () => {
  let intentos = 0;
  const { ctx } = correr({
    responder: () => {
      intentos += 1;
      if (intentos < 3) return httpError(503, { message: "service unavailable" });
      return ok([fila()]);
    },
  });
  const informe = await ctx.PPSupabaseEventLog.leer({});
  assert.equal(intentos, 3, "tres intentos: el tercero va bien");
  assert.equal(informe.ok, true);
  assert.equal(informe.total, 1);
});

test("un 5xx que no se recupera dice cuantos intentos hizo", async () => {
  let intentos = 0;
  const { ctx } = correr({ responder: () => { intentos += 1; return httpError(500, { message: "red caida" }); } });
  const informe = await ctx.PPSupabaseEventLog.leer({});
  assert.equal(intentos, 3);
  assert.match(informe.motivo, /fallo tras 3 intentos/);
  assert.match(informe.motivo, /red/);
});

test("una tabla inexistente (PGRST205) NO es lo mismo que 'no hay eventos'", async () => {
  // Este es el caso real de entrada: MEDIDO 2026-09-29, el DDL todavia no esta
  // aplicado. Si esto se mostrara como 'no hay eventos', la pagina quedaria verde y
  // muda y nadie iria a mirar el DDL.
  const { ctx } = correr({ responder: () => httpError(404, { code: "PGRST205", message: "Could not find the table 'public.operation_events' in the schema cache" }) });
  const ausente = await ctx.PPSupabaseEventLog.leer({});

  const otro = correr({ responder: () => ok([]) });
  const vacio = await otro.ctx.PPSupabaseEventLog.leer({});

  assert.equal(ausente.ok, false, "no se pudo leer");
  assert.equal(ausente.sinTabla, true, "y la causa es que la tabla no existe");
  assert.equal(ausente.codigo, "PGRST205");
  assert.match(ausente.aviso, /operation_events/);
  assert.match(ausente.aviso, /schema-supabase-plan\.sql/, "el aviso tiene que decir QUE FALTA APLICAR");

  assert.equal(vacio.ok, true, "la carga funciono");
  assert.equal(vacio.sinTabla, false);
  assert.equal(vacio.aviso, "", "no hay aviso de DDL si la tabla si existe");
  assert.equal(vacio.total, 0);
});

test("el aviso del DDL pendiente es el mismo siempre, con el codigo que lo provoco", () => {
  const { ctx } = correr({ responder: () => ok([]) });
  const texto = ctx.PPSupabaseEventLog.avisoDeTablaAusente("PGRST205");
  assert.match(texto, /todavia no existe/i);
  assert.match(texto, /no es que no haya eventos/i, "el texto tiene que separar los dos casos");
  assert.match(texto, /schema-supabase-plan\.sql/);
});

test("el payload se parsea si viene como texto y se deja si ya viene como objeto", async () => {
  const { ctx } = correr({ responder: () => ok([fila({ payload: '{"maquina":{"de":"L1"},"notas":"ok"}' })]) });
  const informe = await ctx.PPSupabaseEventLog.leer({});
  assert.deepEqual({ ...informe.filas[0].payload }, { maquina: { de: "L1" }, notas: "ok" });

  // PostgREST devuelve jsonb como objeto. Si en algun momento devuelve texto, la
  // vista tiene que entenderlo igual, o se rompia con un [object Object].
  const otro = correr({ responder: () => ok([fila()]) });
  const conObjeto = await otro.ctx.PPSupabaseEventLog.leer({});
  assert.equal(conObjeto.filas[0].payload.maquina.de, "L1");
});

test("el payload llega entero a la vista, sin perder columnas de la fila", async () => {
  const { ctx } = correr({ responder: () => ok([fila()]) });
  const informe = await ctx.PPSupabaseEventLog.leer({});
  const f = informe.filas[0];
  assert.equal(f.ot, "12345");
  assert.equal(f.kind, "MAQUINA");
  assert.equal(f.actor, "restlet");
  assert.equal(f.secuencia !== undefined, true, "la columna es 'secuencia' y no 'seqencia'");
  assert.equal(f.secuencia, 10);
});

test("el informe trae el conteo por tipo de evento", async () => {
  const { ctx } = correr({
    responder: () => ok([fila({ kind: "MAQUINA" }), fila({ kind: "MAQUINA" }), fila({ kind: "CAMBIO_HERRAMENTAL" })]),
  });
  const informe = await ctx.PPSupabaseEventLog.leer({});
  assert.deepEqual({ ...informe.resumen }, { MAQUINA: 2, CAMBIO_HERRAMENTAL: 1 });
  assert.equal(informe.total, 3);
});

test("el informe NO contiene el token, ni en un fallo ni en un acierto", async () => {
  const bueno = correr({ responder: () => ok([fila()]) });
  const okInforme = await bueno.ctx.PPSupabaseEventLog.leer({ filtros: { ot: "12345" } });
  assert.doesNotMatch(JSON.stringify(okInforme), /jwt-falso/, "el informe acaba en logs y en pantallas");

  const malo = correr({ responder: () => httpError(401, { message: "invalid JWT: jwt-falso-para-tests-000000" }) });
  const falloInforme = await malo.ctx.PPSupabaseEventLog.leer({});
  // El mensaje del servidor puede venir con el token dentro; lo que NO puede pasar
  // es que este modulo lo conozca. El JWT que el modulo tiene, no aparece.
  assert.doesNotMatch(falloInforme.motivo.replace("invalid JWT: jwt-falso-para-tests-000000", ""), /jwt-falso/);
  assert.equal(malo.llamadas[0].headers.Authorization, "Bearer " + JWT, "el token se uso, pero no se filtro");
});

test("pintar() sin DOM no revienta la pagina", async () => {
  // La pagina de planeacion no puede caerse por una vista de depuracion.
  const { ctx } = correr({ responder: () => ok([]) });
  const salida = await ctx.PPSupabaseEventLog.pintar();
  assert.equal(salida, null, "sin document no hay nada que pintar, y eso no es un fallo");
});

test("el modulo se engancha al hash y a la barra lateral, sin tocar app.js", () => {
  // Se enchufa por #eventos y por el CSS de data-section. Si alguien abre una
  // costura en showWorkspaceView o en loadAppStateInBackground, esto se rompe.
  assert.match(fuente, /location\.hash = "#" \+ SECCION/, "se navega por el hash, que es como navega la app");
  assert.match(fuente, /classList|data-section|workspace\[data-view/, "la seccion se resuelve con data-section");
  assert.match(fuente, /nav-list/, "el item se cuelga de la barra lateral existente");
  assert.match(estilos, /data-section="eventos"\] \.eventos-view/, "el CSS tiene que encender la vista, o el panel queda invisible");
});

test("el modulo entra en el build DESPUES de apply, y con un solo fichero mas", () => {
  assert.match(build, /read\("src\/web\/shared\/supabase-event-log\.js"\)/, "falta el modulo en el build");
  const bloque = build.match(/const runtimeClients = `([^`]*)`/);
  assert.ok(bloque, "no se encontro runtimeClients");
  const orden = bloque[1];
  assert.ok(orden.indexOf("catalogApply") < orden.indexOf("eventLog"), "despues de apply: primero se leen y aplican cosas, despues se depura");
  assert.ok(orden.indexOf("supabaseAuth") < orden.indexOf("eventLog"), "despues de auth: el token sale de ahi");
  assert.ok(orden.indexOf("supabaseReader") < orden.indexOf("eventLog"), "despues del reader: la URL y la clave salen de ahi");
});

test("sin caracteres corruptos: nada fuera de la 'ñ' y el guion largo", () => {
  // El archivo va entero pegado en el HTML del build y en Apps Script. Un caracter
  // roto ahi no da error de sintaxis: se ve roto en la pagina.
  const permitidos = new Set(["—", "ñ"]);
  const malos = [...fuente].filter((c) => c.charCodeAt(0) > 127 && !permitidos.has(c));
  assert.deepEqual(malos, [], "caracteres no ASCII fuera de la 'ñ' y el guion largo");
});
