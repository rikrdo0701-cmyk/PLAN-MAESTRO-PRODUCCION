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

function correrBoot({ lecturas = null, config = true } = {}) {
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
  });
  const informe = await ctx.PPCatalogBoot.correr();
  assert.equal(intentos, 3, "tres intentos: el tercero va bien");
  // El modulo inicializa fallo a null, no a undefined: se comprueba la falsedad, no la palabra.
  assert.ok(!informe.fallo, "no debe reportar fallo si se acabo recuperando");
  assert.equal(informe.applied !== true, true, "el modulo de lectura no aplica; eso es del otro");
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

test("aplicar NUNCA escribe undefined encima de lo que el puente trajo", async () => {
  // undefined significa 'el lector no traia esta rebanada'. Sobrescribir con
  // undefined BORRARIA el dato que el puente si habia traido, y el sintoma seria
  // 'la pagina perdio operadores' sin ningun error de red de por medio.
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, Promise, JSON, Date, Math, String, Number, Object, Array, Error, RegExp, Boolean,
    document: { readyState: "complete", getElementById: () => null, createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }), head: { appendChild() {} }, body: { appendChild() {} } },
    state: { operators: ["del puente"], matrix: { a: 1 } },
    PPCatalogBoot: { correr: async () => ({ activo: true, catalogs: { operators: [], matrix: undefined, toolCatalog: ["nuevo"] }, fallo: null, ms: 5, viejo: {}, vacias: [] }), aviso: () => false },
    render: () => { ctx.pintado = true; },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(apply, ctx);
  const r = await ctx.PPCatalogApply.aplicarUnaVez();
  assert.equal(r.aplicado, true);
  assert.deepEqual([...ctx.state.operators], [], "un array vacio SI se aplica: significa 'no hay'");
  assert.equal(ctx.state.matrix && ctx.state.matrix.a, 1, "undefined no puede borrar lo del puente");
  // El nombre de la TABLA en Supabase es tools; la rebanada del ESTADO es toolCatalog,
  // que es como lo llama la app. Por eso el modulo solo acepta las claves del estado:
  // si aceptara el nombre de la tabla, pondria tools en el estado donde nadie lo lee.
  assert.equal(ctx.state.tools, undefined, "el nombre de la tabla no se cuela en el estado");
  assert.deepEqual([...ctx.state.toolCatalog], ["nuevo"], "una rebanada nueva si se aplica");
  assert.equal(ctx.pintado, true, "se repinta despues de aplicar");
});

test("los objetos indexados se normalizan a array antes de aplicarse", () => {
  // El lector devuelve algunas rebanadas como objeto y la app las usa como array.
  // Sin normalizar, operators llegaria como {a:1} y el bucle de operadores no veria
  // nada, sin ningun error visible.
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, Promise, JSON, Date, Math, String, Number, Object, Array, Error, RegExp, Boolean,
    document: { readyState: "complete", getElementById: () => null, createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }), head: { appendChild() {} }, body: { appendChild() {} } },
    state: {},
    PPCatalogBoot: { correr: async () => ({ activo: true, catalogs: { operators: { a: { nombre: "A" }, b: { nombre: "B" } } }, fallo: null, ms: 1, viejo: {}, vacias: [] }), aviso: () => false },
    render: () => {},
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(apply, ctx);
  return ctx.PPCatalogApply.aplicarUnaVez().then(() => {
    assert.ok(Array.isArray(ctx.state.operators), "operators tiene que quedar como array");
    assert.equal(ctx.state.operators.length, 2);
  });
});

test("si la lectura falla, no se aplica nada y se dice por que", async () => {
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, Promise, JSON, Date, Math, String, Number, Object, Array, Error, RegExp, Boolean,
    document: { readyState: "complete", getElementById: () => null, createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }), head: { appendChild() {} }, body: { appendChild() {} } },
    state: { operators: ["del puente"] },
    PPCatalogBoot: { correr: async () => ({ activo: true, fallo: "red caida", catalogs: null }), aviso: () => true },
    render: () => {},
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(apply, ctx);
  const r = await ctx.PPCatalogApply.aplicarUnaVez();
  assert.equal(r.aplicado, false);
  assert.match(r.motivo, /red/);
  assert.deepEqual([...ctx.state.operators], ["del puente"], "un fallo de lectura NO puede vaciar el estado");
});

test("el aviso se pinta cuando hay algo que avisar, y el modulo lo pide", async () => {
  let aviso = 0;
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, Promise, JSON, Date, Math, String, Number, Object, Array, Error, RegExp, Boolean,
    document: { readyState: "complete", getElementById: () => null, createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }), head: { appendChild() {} }, body: { appendChild() {} } },
    state: {},
    PPCatalogBoot: { correr: async () => ({ activo: true, fallo: null, catalogs: {}, ms: 1, viejo: { matrix: { minutos: 3000 } }, vacias: ["tools"] }), aviso: () => { aviso += 1; return true; } },
    render: () => {},
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(apply, ctx);
  await ctx.PPCatalogApply.aplicarUnaVez();
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
