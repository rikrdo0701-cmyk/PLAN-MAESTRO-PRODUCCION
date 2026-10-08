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

test("locked_ots vacia no se reporta como tabla vacia del arranque (RULE-SUP-064)", async () => {
  const ctx = correrBoot({
    lecturas: async () => ({ catalogs: {}, missing: ["locked_ots", "matrix", "tools"], errors: {} }),
  });
  const informe = await ctx.PPCatalogBoot.correr();
  // El lector la sigue marcando como missing: es un hecho de la lectura (0 filas).
  // La politica de RULE-SUP-064 es que su vacio es legitimo, asi que el aviso del
  // arranque ("Tablas vacias en Supabase ... sin respaldo") no la puede nombrar.
  assert.deepEqual([...informe.vacias].sort(), ["matrix", "tools"]);
});

test("selected_ots y operation_plan_statuses vacias no se reportan como tabla vacia del arranque (RULE-SUP-067)", async () => {
  // MEDIDO 2026-10-08 en produccion tras RULE-SUP-066 (el retiro manual de la
  // ultima OT SI persiste): con la cola genuinamente vacia en la base, CADA
  // recarga salia "Tablas vacias en Supabase: selected_ots. Sin respaldo", mientras
  // la base y la pagina concuerdan en que no hay cola. El vacio del plan es un
  // estado real, igual que locked_ots (RULE-SUP-064).
  const ctx = correrBoot({
    lecturas: async () => ({
      catalogs: {},
      missing: ["selected_ots", "operation_plan_statuses", "matrix"],
      // Si la lectura FALLO, la informacion no se pierde por el veto: la linea de
      // fallo del MISMO aviso nombra la tabla con su error (informe.fallo).
      errors: { selected_ots: "401 unauthorized" },
    }),
  });
  const informe = await ctx.PPCatalogBoot.correr();
  assert.deepEqual([...informe.vacias].sort(), ["matrix"],
    "el vacio legitimo del plan no alarma; las demas tablas vacias siguen nombradas");
  assert.match(String(informe.fallo), /selected_ots: 401 unauthorized/,
    "una lectura FALLIDA de selected_ots si se dice, por la linea de fallo");
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

// ---------------------------------------------------------------------------
// El umbral del aviso de antiguedad, en horas LABORALES.
//
// El umbral viejo (20 h de reloj) era mas corto que la cadencia real de
// guardados y por eso el aviso SIEMPRE aparecia en un fin de semana sin
// guardar: falso positivo por diseño. MEDIDO 2026-10-03 contra updated_at por
// tabla (RULE-SUP-044): el toast decia la verdad de la base, y lo que estaba
// rota era la escala. Ahora solo cuentan las horas del horario laboral de la
// planta: un finde entero suma 0 y no dispara; 24 h laborales (~2-3 dias
// habiles sin guardar) si. La fuente del calendario es, en orden: el catalogo
// de Supabase (calendar_exceptions), el cache local (workSchedule/dailyBreaks)
// y los valores de fabrica (DEFAULT_WORK_SCHEDULE/DEFAULT_DAILY_BREAKS de
// app.js, que se replican aqui a proposito para no importar 5 MB de app.js).
function calendarioDePrueba(overrides = {}) {
  return {
    workSchedule: {
      MON: { enabled: true, start: "07:00", end: "17:00" },
      TUE: { enabled: true, start: "07:00", end: "17:00" },
      WED: { enabled: true, start: "07:00", end: "17:00" },
      THU: { enabled: true, start: "07:00", end: "17:00" },
      FRI: { enabled: true, start: "07:00", end: "17:00" },
      SAT: { enabled: false, start: "07:00", end: "13:00" },
      SUN: { enabled: false, start: "07:00", end: "13:00" },
    },
    dailyBreaks: {},
    calendarExceptions: [],
    ...overrides,
  };
}

// LA MAQUINA CORRE EN AMERICA/MEXICO_CITY (UTC-6, sin DST). Por eso NINGUN
// instante de esta seccion usa Z con zona implícita: se construye todo desde la
// hora LOCAL con new Date(a, m-1, d, h, min), que es determinista sin importar
// donde se corra la suite. El horario de prueba es 07:00-17:00 local, igual que
// el de la planta (medido, DEFAULT_WORK_SCHEDULE).
function L(a, m, d, h, min) {
  return new Date(a, m - 1, d, h, min || 0).getTime();
}
function minutosDe(calendario) {
  const ctx = correrBoot({ lecturas: async () => ({ catalogs: {}, missing: [], errors: {} }) });
  return (desde, hasta) => ctx.PPCatalogBoot.minutosLaborales(new Date(desde).toISOString(), hasta, calendario);
}

test("un fin de semana entero sin guardar suma 0 horas laborales y no dispara", () => {
  // 2026-10-02 es viernes y 2026-10-03 sábado.
  const f = minutosDe(calendarioDePrueba());
  // Guardado al fin del turno del viernes, medido el sábado: 20 h de reloj, 0 laborales.
  assert.equal(f(L(2026, 10, 2, 17), L(2026, 10, 3, 13)), 0, "viernes 17:00 -> sábado 13:00 no cuenta nada");
  // Ni al lunes antes de que abra el turno: el finde completo no existe para el umbral.
  assert.equal(f(L(2026, 10, 2, 17), L(2026, 10, 5, 6)), 0, "lunes 06:00: el turno aun no abre, sigue 0");
  // Y que no sea 'todo suma cero': guardado al INICIO del turno del viernes, la
  // jornada entera del viernes si cuenta (10 h = 600 min) hasta el sábado.
  assert.equal(f(L(2026, 10, 2, 7), L(2026, 10, 3, 13)), 600, "la jornada completa del viernes si suma");
});

test("24 h laborales si disparan: ~2 dias habiles completos sin guardar", () => {
  const f = minutosDe(calendarioDePrueba());
  const desde = L(2026, 10, 2, 7); // viernes 07:00, inicio de turno
  assert.equal(f(desde, L(2026, 10, 5, 17)), 1200, "viernes 10 h + lunes 10 h");
  assert.equal(f(desde, L(2026, 10, 6, 17)), 1800, "y + martes 10 h");
  // 600 + 600 + 600 + 540 = 2340 min: 39 h laborales, lejos por encima del
  // umbral de 24 h (1440 min) que dispara el aviso.
  assert.equal(f(desde, L(2026, 10, 7, 16)), 2340, "viernes + lunes + martes + 9 h del miércoles: sobra el umbral de 24 h");
});

test("el horario de la planta manda: dia deshabilitado suma 0, dias a medida se respetan", () => {
  const fDefecto = minutosDe(calendarioDePrueba());
  // Sábado HABILITADO de 07:00 a 17:00: una hora del sábado si cuenta.
  const fSabHabilitado = minutosDe(calendarioDePrueba({
    workSchedule: { ...calendarioDePrueba().workSchedule, SAT: { enabled: true, start: "07:00", end: "17:00" } },
  }));
  assert.equal(fSabHabilitado(L(2026, 10, 3, 7), L(2026, 10, 3, 8)), 60, "con sábado habilitado, la hora del sábado cuenta");
  assert.equal(fDefecto(L(2026, 10, 3, 7), L(2026, 10, 3, 8)), 0, "con el por defecto (sábado no), no");
  // Lunes DESHABILITADO: una jornada entera de lunes no suma nada.
  const fLunesFuera = minutosDe(calendarioDePrueba({
    workSchedule: { ...calendarioDePrueba().workSchedule, MON: { enabled: false, start: "07:00", end: "17:00" } },
  }));
  assert.equal(fLunesFuera(L(2026, 10, 5, 7), L(2026, 10, 5, 16)), 0, "lunes deshabilitado: la jornada no suma");
  assert.equal(fDefecto(L(2026, 10, 5, 7), L(2026, 10, 5, 16)), 540, "lunes normal 07:00-16:00 = 540 min");
});

test("los descansa diarios activos restan, y los inactivos no", () => {
  const fActivo = minutosDe(calendarioDePrueba({ dailyBreaks: { MEAL: { enabled: true, start: "12:00", end: "13:00" } } }));
  const fInactivo = minutosDe(calendarioDePrueba({ dailyBreaks: { MEAL: { enabled: false, start: "12:00", end: "13:00" } } }));
  // 07:00-14:00 = 420 min; con la hora de comida activa (12:00-13:00) quedan 360.
  assert.equal(fActivo(L(2026, 10, 5, 7), L(2026, 10, 5, 14)), 360, "420 menos la hora de comida = 360");
  assert.equal(fInactivo(L(2026, 10, 5, 7), L(2026, 10, 5, 14)), 420, "con el descanso inactivo no se resta nada");
});

test("el calendario de la planta (asueto/vacaciones) resta horas; lo de maquina u operador no", () => {
  // Un paro GENERAL de medio día el viernes: del viernes solo cuentan 07:00-12:00.
  const fParo = minutosDe(calendarioDePrueba({
    calendarExceptions: [{ concept: "GENERAL", startDate: "2026-10-02", endDate: "2026-10-02", start: "12:00", end: "", active: true }],
  }));
  assert.equal(fParo(L(2026, 10, 2, 7), L(2026, 10, 5, 17)), 300 + 600, "viernes 5 h (tras el paro) + lunes 10 h");
  // Un asueto sin horas bloquea el día completo (la misma regla de effectiveWindows).
  const fAsueto = minutosDe(calendarioDePrueba({
    calendarExceptions: [{ concept: "ASUETO", startDate: "2026-10-07", endDate: "2026-10-07", start: "", end: "", active: true }],
  }));
  assert.equal(fAsueto(L(2026, 10, 2, 7), L(2026, 10, 7, 17)), 1800, "el miércoles en asueto no suma sus 10 h");
  // Vacaciones multi-día: todo el bloque resta.
  const fVacaciones = minutosDe(calendarioDePrueba({
    calendarExceptions: [{ concept: "VACACIONES", startDate: "2026-10-05", endDate: "2026-10-06", start: "", end: "", active: true }],
  }));
  assert.equal(fVacaciones(L(2026, 10, 2, 7), L(2026, 10, 6, 17)), 600, "solo el viernes: lunes y martes en vacaciones");
  // Un asueto INACTIVO no cuenta.
  const fInactivo = minutosDe(calendarioDePrueba({
    calendarExceptions: [{ concept: "ASUETO", startDate: "2026-10-07", endDate: "2026-10-07", start: "", end: "", active: false }],
  }));
  assert.equal(fInactivo(L(2026, 10, 2, 7), L(2026, 10, 7, 17)), 2400, "inactivo: se mide como si no existiera");
  // Un evento de MAQUINA no frena un guardado de catalogos: no se resta.
  const fMaquina = minutosDe(calendarioDePrueba({
    calendarExceptions: [{ concept: "MAQUINA", machine: "MP0001", startDate: "2026-10-05", endDate: "2026-10-05", start: "", end: "", active: true }],
  }));
  assert.equal(fMaquina(L(2026, 10, 2, 7), L(2026, 10, 5, 17)), 1200, "lo de maquina no resta horas laborales de planta");
});

test("el aviso dispara solo con horas laborales: el escenario real medido el 2026-10-03", () => {
  // El escenario exacto de la medicion (RULE-SUP-044): el usuario abrió la pagina el
  // sábado 10/03 y el umbral viejo de 20 h de reloj disparaba para operadores y
  // subcontracts, escritos el jueves 10/01 13:04Z (~52 h antes). En horas laborales,
  // del jueves 07:04 local al sábado solo caben ~20 h (jueves tarde + viernes),
  // por debajo del umbral de 24, y el aviso NO sale. La matriz, de la siembra del
  // domingo 09/27, SI lleva ~5 jornadas laborables y sigue avisando.
  const ctx = correrBoot({ lecturas: async () => ({ catalogs: {}, missing: [], errors: {} }) });
  const SABADO_MEDICION = L(2026, 10, 3, 15); // sábado 10/03 15:00 local
  // operadores/subcontracts: jueves 10/01 13:04Z = 07:04 local -> ~12 h laborales.
  const fJueves = minutosDe(calendarioDePrueba());
  assert.ok(
    fJueves(new Date("2026-10-01T13:04:00Z").toISOString(), SABADO_MEDICION) < ctx.PPCatalogBoot.UMBRAL_MINUTOS_LABORALES,
    "del jueves al sábado solo hay ~20 h laborales, por debajo del umbral",
  );
  // El aviso con esos dos y la matriz vieja: SI se pinta, porque la matriz cuenta.
  let avisos = 0;
  ctx.document.body.appendChild = () => { avisos += 1; };
  assert.equal(
    ctx.PPCatalogBoot.aviso({
      activo: true, fallo: null, catalogs: {}, vacias: [],
      viejo: {
        operators: { minutos: 51 * 60, iso: "2026-10-01T13:04:00Z" },
        subcontracts: { minutos: 51 * 60, iso: "2026-10-01T13:04:00Z" },
        matrix: { minutos: 131 * 60, iso: "2026-09-28T05:11:00Z" },
      },
      calendario: calendarioDePrueba(),
    }, SABADO_MEDICION),
    true,
    "con la matriz de hace 5 dias laborables SI hay aviso",
  );
  assert.equal(avisos, 1, "el aviso se pinta una sola vez");
  // Y con SOLO el lote del jueves (el que disparaba el falso positivo): no se pinta.
  assert.equal(
    ctx.PPCatalogBoot.aviso({
      activo: true, fallo: null, catalogs: {}, vacias: [],
      viejo: {
        operators: { minutos: 51 * 60, iso: "2026-10-01T13:04:00Z" },
        subcontracts: { minutos: 51 * 60, iso: "2026-10-01T13:04:00Z" },
      },
      calendario: calendarioDePrueba(),
    }, SABADO_MEDICION),
    false,
    "un finde sin guardar ya no dispara: solo cuenta el tiempo laboral",
  );
});

test("el aviso respeta los asuetos de la planta: si el periodo viejo es solo finde + asueto, no dispara", () => {
  const f = minutosDe(calendarioDePrueba());
  const fConAsueto = minutosDe(calendarioDePrueba({
    calendarExceptions: [{ concept: "ASUETO", startDate: "2026-10-05", endDate: "2026-10-05", start: "", end: "", active: true }],
  }));
  const desde = L(2026, 10, 2, 7); // viernes 07:00
  const hasta = L(2026, 10, 5, 17); // lunes 17:00
  assert.equal(f(desde, hasta), 1200, "sin asueto: viernes + lunes = 20 h laborales (bajo el umbral de 24)");
  assert.equal(fConAsueto(desde, hasta), 600, "con asueto el lunes entero: quedan 10 h del viernes, lejos del umbral");
});

test("el horario laboral del cache local manda sobre el de fabrica", () => {
  // El workSchedule no vive en Supabase (ver la regla del módulo): la pagina lo
  // trae del cache local, y la medición tiene que respetarlo. Se inyecta uno con
  // 08:00-16:00 en TODOS los dias habiles, para que la diferencia contra el de
  // fabrica (07:00-17:00) sea de una hora.
  const horarioLocal = {};
  for (const clave of Object.keys(calendarioDePrueba().workSchedule)) {
    horarioLocal[clave] = { ...calendarioDePrueba().workSchedule[clave], start: "08:00", end: "16:00" };
  }
  const ctx = correrBoot({ lecturas: async () => ({ catalogs: {}, missing: [], errors: {} }) });
  ctx.localStorage = {
    getItem: (clave) => (clave === "plan-produccion-app-v1" ? JSON.stringify({ workSchedule: horarioLocal }) : null),
    setItem() {},
  };
  // Sin cache local: el resolutor cae en el de fabrica (07:00-17:00).
  const ctxVacio = correrBoot({ lecturas: async () => ({ catalogs: {}, missing: [], errors: {} }) });
  assert.equal(
    ctxVacio.PPCatalogBoot.resolverCalendario({}).workSchedule.MON.start,
    "07:00",
    "sin cache local, el horario es el de fabrica",
  );
  // Con el cache local: el horario de 08:00 del cache manda.
  const resuelto = ctx.PPCatalogBoot.resolverCalendario({});
  assert.equal(resuelto.workSchedule.MON.start, "08:00", "el cache local manda sobre fabrica");
  // .length, no deepEqual: el [] lo creó el módulo DENTRO del realm del vm, y
  // deepStrictEqual exige el Array.prototype del realm del test.
  assert.equal(resuelto.calendarExceptions.length, 0, "no hay excepciones: queda la lista vacia");
  // El efecto se nota en la medicion: lunes 07:30 -> 13:00. Con fabrica (07-17)
  // cuenta desde las 07:30 = 330 min; con el local (08-16), desde las 08:00 = 300.
  const desde = L(2026, 10, 5, 7, 30);
  const hasta = L(2026, 10, 5, 13);
  const fLocal = (d, h) => ctx.PPCatalogBoot.minutosLaborales(new Date(d).toISOString(), h, resuelto);
  assert.equal(fLocal(desde, hasta), 300, "con el horario local 08:00-16:00, el lunes 07:30-13:00 suma 300");
  const fFabrica = (d, h) => ctxVacio.PPCatalogBoot.minutosLaborales(new Date(d).toISOString(), h, ctxVacio.PPCatalogBoot.resolverCalendario({}));
  assert.equal(fFabrica(desde, hasta), 330, "con el de fabrica 07:00-17:00, suma 330");
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
