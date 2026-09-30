// Los catalogos se leen de Supabase, con reintentos y SIN respaldo a las Hojas.
//
// LO QUE PIDIO EL USUARIO 2026-09-29: 'sin respaldo a las hojas directo todo a
// supabase con reintentos'. Estos tests fijan las tres cosas que implican, porque
// cada una es la forma en que esto puede salir mal sin que se note.
//
//  1. Los reintentos tienen que pasar. Sin ellos, once peticiones HTTP en paralelo
//     y un 5xx puntual de PostgREST dejan la pagina sin matriz.
//  2. NO se reintenta lo que no mejora esperando. Un 401 o un 403 reintentado tres
//     veces convierte un fallo instantaneo en un fallo lento, y deja a la persona
//     mirando la pantalla esperando algo que no va a pasar.
//  3. Un fallo NO se traga. Sin respaldo, quedarse con el catalogo viejo del
//     arranque anterior es indistinguible de un catalogo correcto, y eso es peor
//     que avisar. Por eso tiene que haber aviso.
//
// Y una cuarta, que es la que no se ve: el orden. Los catalogos se aplican DESPUES
// de que el puente cargue, porque al reves la carga del puente los pisa y se acaba
// leyendo de las Hojas sin querer. 'Sin respaldo' solo es verdad si el orden es el
// correcto.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const boot = readFileSync(new URL("../src/web/shared/supabase-catalog-boot.js", import.meta.url), "utf8");
const apply = readFileSync(new URL("../src/web/shared/supabase-catalog-apply.js", import.meta.url), "utf8");
const build = readFileSync(new URL("../scripts/build-appscript.mjs", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/web/planning/app.js", import.meta.url), "utf8");

function correrBoot({ lecturas = null, config = true, sesion = "buena" } = {}) {
  const fechas = {};
  let pendientes = null;
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, AbortController, Promise, JSON, Date, Math, String, Number, Object, Array, Error, RegExp, Boolean,
    document: { readyState: "complete", getElementById: () => null, createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }), head: { appendChild() {} }, body: { appendChild() {} } },
    fetch: async (destino) => {
      const ruta = String(destino);
      if (ruta.includes("created_at")) {
        const tabla = ruta.match(/rest\/v1\/(\w+)\?/)[1];
        return { ok: true, status: 200, json: async () => (fechas[tabla] ? [{ created_at: fechas[tabla] }] : []) };
      }
      return { ok: true, status: 200, json: async () => [] };
    },
    // MEDIDO 2026-09-29: este doble usaba 'configured' y 'config', que el lector
    // NUNCA exporto. El arranque se apagaba siempre y el test pasaba igual, porque el
    // doble estaba escrito a la medida de la suposicion equivocada. Se corrige a la
    // API real, y tests/lector-supabase-real.test.mjs corre los dos modulos de verdad
    // para que un desajuste futuro no pueda volver a esconderse aqui.
    PPSupabaseReader: config
      ? {
          isConfigured: () => true,
          config: () => ({ url: "https://x.supabase.co", anonKey: "k" }),
          readCatalogs: lecturas || (async () => ({ catalogs: { operators: [1], matrix: { a: 1 } }, missing: [], errors: {} })),
        }
      : { isConfigured: () => false, config: () => ({ url: "", anonKey: "" }) },
    // MEDIDO 2026-09-29: el arranque exige sesion ANTES de leer. Sin este doble
    // `correr` salia con "sin sesion de Supabase" y los siete tests de reintentos
    // pasaban sin haber reintentado nunca: leian cero veces y comparaban el informe
    // de una salida temprana. El token va en la cabecera Authorization de la lectura
    // de antiguedad, asi que tambien se comprueba ahi.
    PPSupabaseAuth: sesion ? { token: async () => (sesion === "expirada" ? Promise.reject(new Error("JWT expirado")) : "jwt-de-prueba") } : null,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(boot, ctx);
  return ctx;
}

test("sin configuracion, el modulo dice que no esta activo y no sale a la red", async () => {
  const ctx = correrBoot({ config: false });
  const informe = await ctx.PPCatalogBoot.correr();
  assert.equal(informe.activo, false);
  assert.equal(informe.fallo, undefined);
});

test("sin sesion se sale con un motivo y NO se lee ninguna tabla", async () => {
  // MEDIDO 2026-09-29: sin sesion la Data API responde HTTP 200 con CERO filas en
  // las 22 tablas, porque la lectura quedo en `select to authenticated`. O sea que
  // sin esta comprobacion la pagina creeria que la base esta vacia. Y leer 22 veces
  // para no traer nada es peor: son 22 viajes por una respuesta que ya se sabe.
  let lecturas = 0;
  const ctx = correrBoot({ sesion: null, lecturas: async () => { lecturas += 1; return { catalogs: {}, missing: [], errors: {} }; } });

  const informe = await ctx.PPCatalogBoot.correr();

  assert.equal(informe.activo, false);
  assert.match(informe.motivo, /sesion/);
  assert.equal(lecturas, 0, "no puede leer sin sesion: vendria vacio y pareceria que la base esta vacia");
});

test("con una sesion caducada se sale con un motivo, sin leer", async () => {
  let lecturas = 0;
  const ctx = correrBoot({ sesion: "expirada", lecturas: async () => { lecturas += 1; return { catalogs: {}, missing: [], errors: {} }; } });

  const informe = await ctx.PPCatalogBoot.correr();

  assert.equal(informe.activo, false);
  assert.match(informe.motivo, /sesion/);
  assert.equal(lecturas, 0);
});

test("una lectura buena se devuelve sin reintentar", async () => {
  let intentos = 0;
  const ctx = correrBoot({ lecturas: async () => { intentos += 1; return { catalogs: { operators: [1] }, missing: [], errors: {} }; } });
  await ctx.PPCatalogBoot.correr();
  assert.equal(intentos, 1, "no hay nada que reintentar si la primera va bien");
});

test("un fallo transitorio se reintenta y se recupera", async () => {
  let intentos = 0;
  const ctx = correrBoot({
    lecturas: async () => {
      intentos += 1;
      if (intentos < 3) { const e = new Error("boom"); e.status = 503; throw e; }
      return { catalogs: { operators: [1] }, missing: [], errors: {} };
    },
    // El arranque duerme 400 ms y 1200 ms entre intentos: sin esto el test tardaria
  });
  const informe = await ctx.PPCatalogBoot.correr();
  assert.equal(intentos, 3, "tres intentos: el tercero va bien");
  // El modulo inicializa fallo a null, no a undefined: se comprueba la falsedad, no la palabra.
  assert.ok(!informe.fallo, "no debe reportar fallo si se acabo recuperando");
  assert.equal(informe.applied !== true, true, "el modulo de lectura no aplica; eso es del otro");
  assert.deepEqual([...informe.catalogs.operators], [1], "lo que se leyo tambien viaja en el informe");
});

test("el reintento espera entre intentos, para no gastar los tres de golpe", async () => {
  // MEDIDO 2026-09-29: PostgREST devuelve 503 y 429 de verdad cuando hay un cold start
  // o demasiadas conexiones. Tres intentos sin pausa son tres golpes al mismo muro.
  const esperas = [];
  let intentos = 0;
  const ctx = correrBoot({
    lecturas: async () => {
      intentos += 1;
      if (intentos < 3) { const e = new Error("429"); e.status = 429; throw e; }
      return { catalogs: { operators: [1] }, missing: [], errors: {} };
    },
  });
  ctx.setTimeout = (fn, ms) => { esperas.push(ms); return setTimeout(fn, 0); };

  await ctx.PPCatalogBoot.correr();

  assert.equal(intentos, 3);
  assert.equal(esperas.length >= 2, true, "tiene que esperar entre intentos");
});

test("un 401 NO se reintenta: no mejora esperando", async () => {
  let intentos = 0;
  const ctx = correrBoot({
    lecturas: async () => { intentos += 1; const e = new Error("JWT"); e.status = 401; throw e; },
  });
  const informe = await ctx.PPCatalogBoot.correr();
  assert.equal(intentos, 1, "reintentar un 401 solo convierte un fallo rapido en uno lento");
  assert.match(informe.fallo, /no se reintenta/);
});

test("un 403 y un 404 tampoco se reintentan", async () => {
  for (const status of [403, 404]) {
    let intentos = 0;
    const ctx = correrBoot({ lecturas: async () => { intentos += 1; const e = new Error("x"); e.status = status; throw e; } });
    const informe = await ctx.PPCatalogBoot.correr();
    assert.equal(intentos, 1, `un ${status} no se reintenta`);
    assert.match(informe.fallo, /no se reintenta/);
  }
});

test("un fallo que no se recupera dice cuantos intentos hizo", async () => {
  let intentos = 0;
  const ctx = correrBoot({ lecturas: async () => { intentos += 1; const e = new Error("red caída"); e.status = 500; throw e; } });
  const informe = await ctx.PPCatalogBoot.correr();
  assert.equal(intentos, 3);
  assert.match(informe.fallo, /fallo tras 3 intentos/);
  assert.match(informe.fallo, /red/);
});

test("tablas vacias y datos viejos llegan en el informe, para que el aviso los pueda decir", async () => {
  const ctx = correrBoot({
    lecturas: async () => ({ catalogs: { operators: [] }, missing: ["tools", "matrix"], errors: {} }),
  });
  const informe = await ctx.PPCatalogBoot.correr();
  // El array lo creo el modulo DENTRO del vm, o sea en otro realm: con assert/strict
  // deepEqual compara prototipos y dos Arrays de realms distintos no son iguales ni
  // teniendo lo mismo. Se copia al realm del test.
  assert.deepEqual([...informe.vacias].sort(), ["matrix", "tools"]);
});

/**
 * Monta el modulo de apply con una PUERTA de doble, y devuelve lo que la puerta
 * recibio. La puerta es `aplicarEstadoDesdeSupabase` de app.js: desde el modulo no
 * se escribe `state` (ver la cabecera de supabase-catalog-apply.js), asi que el
 * contrato que se puede comprobar es el objeto que llega a la puerta.
 */
function correrApply({ catalogs = {}, plan = {}, boot = null } = {}) {
  const recibido = { valor: null };
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, Promise, JSON, Date, Math, String, Number, Object, Array, Error, RegExp, Boolean, Set, Map,
    document: { readyState: "complete", getElementById: () => null, createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }), head: { appendChild() {} }, body: { appendChild() {} } },
    addEventListener: () => {},
    PPCatalogBoot: boot || {
      correr: async () => ({ activo: true, catalogs, fallo: null, ms: 5, viejo: {}, vacias: [], ...plan }),
      aviso: () => false,
    },
    aplicarEstadoDesdeSupabase: async (entrada) => {
      recibido.valor = entrada;
      return { aplicado: true, claves: Object.keys(entrada || {}) };
    },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  // instalar() corre al cargar el modulo (readyState "complete"), o sea que la PRIMERA
  // lectura es la suya. Estos tests esperan esa antes de preguntar nada, para no
  // medirse contra una lectura que el propio test todavia no habia pedido.
  vm.runInContext(apply, ctx);
  return { ctx, recibido, primeraLectura: ctx.PPCatalogApply.aplicarUnaVez() };
}

test("aplicar NUNCA pasa undefined a la puerta", async () => {
  // undefined significa 'el lector no traia esta rebanada'. Pasarlo a la puerta
  // BORRARIA el dato que la pagina ya tenia, y el sintoma seria 'la pagina perdio
  // operadores' sin ningun error de red de por medio.
  const { ctx, recibido, primeraLectura } = correrApply({ catalogs: { operators: [], matrix: undefined, toolCatalog: ["nuevo"] } });
  const r = await primeraLectura;

  assert.equal(r.aplicado, true);
  const entrada = recibido.valor;
  assert.deepEqual([...entrada.operators], [], "un array vacio SI se aplica: significa 'no hay'");
  assert.equal("matrix" in entrada, false, "undefined no puede borrar la matriz que ya estaba");
  // El nombre de la TABLA en Supabase es tools; la rebanada del ESTADO es toolCatalog,
  // que es como lo llama la app. Si aceptara el nombre de la tabla, pondria tools
  // en el estado donde nadie lo lee.
  assert.equal(entrada.tools, undefined, "el nombre de la tabla no se cuela en el estado");
  assert.deepEqual([...entrada.toolCatalog], ["nuevo"], "una rebanada nueva si se aplica");
});

test("los objetos indexados se normalizan a array antes de llegar a la puerta", async () => {
  // El lector devuelve algunas rebanadas como objeto y la app las usa como array.
  // Sin normalizar, operators llegaria como {a:1} y el bucle de operadores no veria
  // nada, sin ningun error visible.
  const { ctx, recibido, primeraLectura } = correrApply({ catalogs: { operators: { a: { nombre: "A" }, b: { nombre: "B" } } } });

  await primeraLectura;

  assert.ok(Array.isArray(recibido.valor.operators), "operators tiene que llegar como array");
  assert.equal(recibido.valor.operators.length, 2);
});

test("el plan, la cola y app_state viajan en el MISMO objeto que los catalogos", async () => {
  // Un solo applyImported, un solo orden. Si el plan fuera por otro lado, el orden
  // de aplicacion quedaria repartido entre dos funciones y cualquier cambio futuro
  // podria pisar la cola con la carga del borrador.
  const { ctx, recibido, primeraLectura } = correrApply({
    catalogs: { operators: ["A"] },
    plan: {
      operations: [{ ot: "1" }],
      workOrders: [{ ot: "1" }],
      materials: [{ ot: "1" }],
      selectedOts: ["1"],
      lockedOts: ["1"],
      operationPlanStatuses: { k: { status: "COMPLETADA_PLAN" } },
      appState: { revision: 4, planStart: "2026-09-28", savedAt: "2026-09-28T10:00:00.000Z", settings: { a: 1 } },
    },
  });

  await primeraLectura;

  const entrada = recibido.valor;
  for (const clave of ["operators", "operations", "workOrders", "materials", "selectedOts", "lockedOts", "operationPlanStatuses"]) {
    assert.ok(clave in entrada, `${clave} tiene que ir en el mismo objeto`);
  }
  assert.equal(entrada.revision, 4, "la revision de app_state viaja con el resto");
  assert.equal(entrada.settings.a, 1);
  assert.equal(entrada.savedAt, "2026-09-28T10:00:00.000Z");
});

test("app_state vacio no borra la ventana del plan de la persona", async () => {
  // Un campo vacio en la base significa 'no guardado todavia'. Pasarlo como
  // undefined o como null le borraria el plan a quien ya lo tenia.
  const { ctx, recibido, primeraLectura } = correrApply({ catalogs: {}, plan: { appState: { revision: 0, planStart: null, settings: {} } } });

  await primeraLectura;

  const entrada = recibido.valor;
  assert.equal(entrada.revision, 0, "la revision si se aplica: es un numero");
  assert.equal("planStart" in entrada, false, "un planStart vacio no puede pisar el de la pagina");
  assert.equal("settings" in entrada, false, "unos settings vacios no pueden pisar los de la pagina");
});

test("las claves que se leen se calculan con el escritor, no con una copia de la regla", async () => {
  // Dos copias de la clave natural se separan en el primer cambio de columna y el
  // borrado empieza a fallar en silencio: el escritor sube filas nuevas y nunca
  // borra las viejas.
  let armado = null;
  const { ctx, primeraLectura } = correrApply({
    catalogs: { operators: ["A"] },
    boot: {
      correr: async () => ({ activo: true, catalogs: { operators: ["A"] }, fallo: null, ms: 5, viejo: {}, vacias: [] }),
      aviso: () => false,
    },
  });
  ctx.PPSupabaseWriter = {
    armarCatalogos: (estado) => { armado = estado; return { operators: { claves: { A: {}, B: {} } } }; },
  };

  await primeraLectura;

  assert.ok(armado, "tiene que preguntar al escritor por las claves");
  assert.ok(armado.operators, "y con el mismo objeto que va a la puerta");
  assert.deepEqual([...ctx.PPCatalogApply.claves.operators], ["A", "B"]);
});

test("si la lectura falla, no se aplica nada y se dice por que", async () => {
  const { ctx, recibido, primeraLectura } = correrApply({
    boot: { correr: async () => ({ activo: true, fallo: "red caida", catalogs: null }), aviso: () => true },
  });

  const r = await primeraLectura;

  assert.equal(r.aplicado, false);
  assert.match(r.motivo, /red/);
  assert.equal(recibido.valor, null, "un fallo de lectura NO puede llegar a la puerta: vaciaria el estado");
});

test("sin la puerta de app.js no se escribe nada y se dice", async () => {
  // MEDIDO 2026-09-29: sin esta comprobacion el modulo escribia `root.state = {...}`,
  // que es un objeto que nadie lee, y la pagina seguia con los valores de muestra
  // sin decir nada. O sea: fallo silencioso con la forma de un exito.
  const { ctx, recibido, primeraLectura } = correrApply({ catalogs: { operators: ["A"] } });
  delete ctx.aplicarEstadoDesdeSupabase;
  // La lectura de arranque ya habia corrido con la puerta puesta; esta es la que
  // importa, la que se queda sin ella.
  await primeraLectura;
  recibido.valor = null;

  const r = await ctx.PPCatalogApply.aplicarUnaVez();

  assert.equal(r.aplicado, false);
  assert.match(r.motivo, /aplicarEstadoDesdeSupabase/);
  assert.equal(recibido.valor, null);
});

test("el arranque lee una vez, y si no hay sesion no aplica nada", async () => {
  // MEDIDO 2026-09-29: el arranque pide sesion y sale con un motivo. Si no
  // reintentara al entrar, quien carga la pagina sin sesion se quedaria con los
  // valores de muestra para siempre, y con un aviso que ya no miraria nadie.
  //
  // MEDIDO 2026-09-29 (por que el contador NO es una `let`): con `let corridas`
  // V8 (Node 24.11.1) lanza `ReferenceError: corridas is not defined` al leerla
  // como argumento directo de `assert.equal`, en un archivo donde el binding SI
  // existe: `eval("corridas")` en la MISMA linea devuelve el valor, y la lectura
  // falla igual con `--jitless` y con `--no-opt`, o sea que no es el optimizador.
  // Pasa cuando la `let` la captura un closure que se cruza a un contexto `vm` y
  // la lectura es desnuda como argumento de una funcion que declara parametros
  // (`corridas === 1`, la sentencia suelta y `console.log` si funcionan). El
  // contador va en un objeto externo y el problema desaparece.
  const ctl = { corridas: 0 };
  const { ctx, primeraLectura } = correrApply({
    boot: {
      correr: async () => {
        ctl.corridas += 1;
        if (ctl.corridas === 1) return { activo: false, motivo: "sin sesion de Supabase: entra con tu correo" };
        return { activo: true, catalogs: { operators: ["A"] }, fallo: null, ms: 1, viejo: {}, vacias: [] };
      },
      aviso: () => false,
    },
  });

  const primera = await primeraLectura;
  assert.equal(primera.aplicado, false, "sin sesion no hay nada que aplicar");
  assert.match(primera.motivo, /sesion/);
  assert.equal(ctl.corridas, 1, "el arranque lee una vez");
  assert.equal(ctx.PPCatalogApply.estado().aplicado, false);

  // Cuando ya hay sesion, la misma llamada si aplica.
  const segunda = await ctx.PPCatalogApply.aplicarUnaVez();
  assert.equal(segunda.aplicado, true, "con sesion ya si aplica");
  assert.equal(ctl.corridas, 2);
  assert.equal(ctx.PPCatalogApply.estado().aplicado, true);
});

test("el aviso se pinta cuando hay algo que avisar, y el modulo lo pide", async () => {
  let aviso = 0;
  const { primeraLectura } = correrApply({
    boot: {
      correr: async () => ({ activo: true, fallo: null, catalogs: {}, ms: 1, viejo: { matrix: { minutos: 3000 } }, vacias: ["tools"] }),
      aviso: () => { aviso += 1; return true; },
    },
  });

  await primeraLectura;

  assert.equal(aviso, 1, "con tabla vacia y datos viejos tiene que haber aviso: sin respaldo no se puede fallar en silencio");
});

test("app.js NO se toca, y el build lo exige", () => {
  // MEDIDO 2026-09-29: se intento abrir la costura en loadAppStateInBackground y el
  // build rompio con 'No se encontro la carga inicial para recuperar el borrador',
  // porque startupMarker es una COPIA LITERAL de esa funcion. Este test falla si
  // alguien vuelve a meter la costura ahi, que es la forma facil de seguir.
  assert.doesNotMatch(app, /PPAfterAppStateLoaded/, "la costura va en supabase-catalog-apply.js, no en app.js");
  assert.match(build, /startupMarker/, "el build sigue guardando la copia literal: este test existe para que no se rompa en silencio");
});

test("el modulo se instala solo al cargar la pagina, sin que nadie lo llame", async () => {
  // MEDIDO 2026-09-29: el arranque de Supabase estaba metido dentro de una envoltura
  // de applyImported, o sea que solo corria si el puente llamaba a applyImported. En
  // una pagina donde el puente no carga, la lectura no pasaba. Esto exige que el
  // modulo arranque por su cuenta.
  const { ctx, recibido, primeraLectura } = correrApply({ catalogs: { operators: ["A"] } });
  await primeraLectura;

  assert.ok(recibido.valor, "sin que nadie llame a aplicarUnaVez, tiene que haber leido y aplicado");
  assert.deepEqual([...recibido.valor.operators], ["A"]);
});

test("el modulo espera al DOMContentLoaded si la pagina aun esta cargando", () => {
  let registrado = null;
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, Promise, JSON, Date, Math, String, Number, Object, Array, Error, RegExp, Boolean, Set, Map,
    document: {
      readyState: "loading",
      addEventListener: (evento, fn) => { if (evento === "DOMContentLoaded") registrado = fn; },
      getElementById: () => null,
      createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }),
      head: { appendChild() {} },
      body: { appendChild() {} },
    },
    addEventListener: () => {},
    PPCatalogBoot: { correr: async () => ({ activo: false, motivo: "sin sesion" }), aviso: () => false },
    aplicarEstadoDesdeSupabase: async () => ({ aplicado: true, claves: [] }),
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(apply, ctx);

  assert.equal(typeof registrado, "function", "tiene que quedarse esperando al DOMContentLoaded");
  assert.equal(ctx.PPCatalogApply.estado().aplicado, false, "antes del DOMContentLoaded no lee nada");
});

test("los tres modulos van en el build, y apply va despues de reader", () => {
  for (const f of ["supabase-auth.js", "supabase-catalog-boot.js", "supabase-catalog-apply.js"]) {
    assert.match(build, new RegExp(`read\\("src/web/shared/${f.replace(/\./g, "\\.")}"\\)`), `falta ${f} en el build`);
  }
  const bloque = build.match(/const runtimeClients = `([^`]*)`/);
  assert.ok(bloque, "no se encontro runtimeClients");
  const orden = bloque[1];
  assert.ok(orden.indexOf("catalogBoot") < orden.indexOf("catalogApply"), "boot antes que apply: apply usa el informe de boot");
  assert.ok(orden.indexOf("supabaseReader") < orden.indexOf("catalogBoot"), "reader antes que boot: boot envuelve al reader");
});
