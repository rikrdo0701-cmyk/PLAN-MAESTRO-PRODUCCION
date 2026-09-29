import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

/**
 * El espejo de catalogos (src/server/16-supabase-catalogo.js) traduce cada hoja a
 * una tabla de Supabase. Un encabezado mal escrito NO da error: sale undefined, el
 * mapper lo convierte en '' y la fila llega a Supabase con el campo vacio. Eso es
 * perdida silenciosa de un dato de catalogo, y ya paso una vez (TIPO_TRABJO en vez
 * de TIPO_TRABAJO, 02-storage.js:21 lo tiene bien). Este test es la red.
 *
 * La verdad de los encabezados es PP_SHEETS (src/server/02-storage.js:1-34), no el
 * mapeador: aqui se lee cada propiedad que el mapeador toca con un Proxy que
 * anota los nombres, y se exige que todos existan en la hoja de la que dice venir.
 */

const storageSource = await readFile(new URL("../src/server/02-storage.js", import.meta.url), "utf8");
const catalogoSource = await readFile(new URL("../src/server/16-supabase-catalogo.js", import.meta.url), "utf8");

function cargar() {
  const context = {
    Date,
    JSON,
    Math,
    String,
    Number,
    Object,
    Array,
    Error,
    isFinite,
    isNaN,
    PP_SCHEMA_VERSION: 1,
    PP_APP_VERSION: "test",
    SpreadsheetApp: { flush: () => {} },
    Session: { getScriptTimeZone: () => "America/Mexico_City", getActiveUser: () => ({ getEmail: () => "pruebas" }) },
    Utilities: { formatDate: (date) => String(date) },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(storageSource, context, { filename: "02-storage.js" });
  vm.runInContext(catalogoSource, context, { filename: "16-supabase-catalogo.js" });
  return context;
}

const context = cargar();
const SHEETS = vm.runInContext("JSON.parse(JSON.stringify(PP_SHEETS))", context);
const TABLAS = vm.runInContext(
  "PP_CATALOGO_TABLAS_.map(function (d) { return { tabla: d.tabla, hoja: d.hoja }; })",
  context
);

// Los encabezados de hoja son MAYUSCULAS; los metodos que el motor busca al
// aplicar String()/Number() sobre el Proxy (toString, valueOf,
// Symbol.toPrimitive) quedan fuera con este filtro.
const ES_ENCABEZADO = /^[A-Z][A-Z0-9_]*$/;

function propiedadesQueToca(fn) {
  const tocadas = new Set();
  const fila = new Proxy(
    {},
    {
      get(objeto, propiedad) {
        if (typeof propiedad === "string" && ES_ENCABEZADO.test(propiedad)) tocadas.add(propiedad);
        return "X";
      },
      has() {
        return true;
      },
    }
  );
  fn(fila);
  return [...tocadas];
}

test("cada tabla del espejo declara una hoja que existe", () => {
  assert.ok(TABLAS.length >= 10, `se esperaban al menos 10 tablas, hay ${TABLAS.length}`);
  for (const def of TABLAS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(SHEETS, def.hoja),
      `${def.tabla} dice venir de la hoja "${def.hoja}", que no esta en PP_SHEETS`
    );
  }
});

test("cada encabezado que lee el mapeador existe en su hoja", () => {
  const problemas = [];
  vm.runInContext(
    TABLAS.map(
      (def) =>
        `(function () {
          var d = PP_CATALOGO_TABLAS_.filter(function (x) { return x.tabla === ${JSON.stringify(def.tabla)}; })[0];
          var tocadas = {};
          var fila = new Proxy({}, {
            get: function (o, p) { if (typeof p === 'string' && /^[A-Z][A-Z0-9_]*$/.test(p)) tocadas[p] = true; return 'X'; },
            has: function () { return true; }
          });
          try { d.mapear(fila); } catch (e) {}
          try { d.clave(fila); } catch (e) {}
          tocadas.__hoja = true;
          globalThis.__tocadas[${JSON.stringify(def.tabla)}] = Object.keys(tocadas).filter(function (k) { return k !== '__hoja'; });
        })();`
    ).join("\n"),
    Object.assign(context, { __tocadas: {} })
  );
  const tocadasPorTabla = context.__tocadas;
  for (const def of TABLAS) {
    const headers = new Set(SHEETS[def.hoja]);
    for (const encabezado of tocadasPorTabla[def.tabla] || []) {
      if (!headers.has(encabezado)) problemas.push(`${def.tabla} lee "${encabezado}", que no existe en la hoja ${def.hoja}`);
    }
  }
  assert.deepEqual(problemas, [], problemas.join("\n"));
});

test("el espejo NO escribe machines: la escribe el RESTlet 2246 (un solo escritor)", () => {
  // Si machines llegara aqui, el RESTlet (cada 15 min, espejo atomico) y el
  // guardado de la pagina se pelearian la misma tabla y alternarian su
  // contenido. RULE-SUP-010.
  assert.equal(
    TABLAS.some((def) => def.tabla === "machines"),
    false
  );
});

test("las listas por guardado son subconjuntos y no incluyen machines", () => {
  const subsets = vm.runInContext(
    "JSON.stringify({ catalogos: PP_CATALOGO_TABLAS_CATALOGOS_, matriz: PP_CATALOGO_TABLAS_MATRIZ_, sync: PP_CATALOGO_TABLAS_SYNC_ })",
    context
  );
  const known = new Set(TABLAS.map((def) => def.tabla));
  for (const [nombre, lista] of Object.entries(JSON.parse(subsets))) {
    assert.ok(lista.length > 0, `${nombre} esta vacia`);
    for (const tabla of lista) {
      assert.ok(known.has(tabla), `${nombre} nombra ${tabla}, que no esta en PP_CATALOGO_TABLAS_`);
      assert.notEqual(tabla, "machines", `${nombre} incluye machines`);
    }
  }
  // El guardado de catalogos no toca la matriz y el de matriz no toca las
  // herramientas: cada guardado paga solo sus tablas.
  assert.equal(JSON.parse(subsets).matriz.includes("tools"), false);
  assert.equal(JSON.parse(subsets).catalogos.includes("matrix"), false);
});

test("los tres caminos de guardado llaman al espejo", () => {
  // PP_finishPartialWrite_ (catalogos y matriz), PP_writeNetSuiteSyncState_ y
  // PP_writeState_. Si uno se queda sin espejo, su tabla envejece en silencio.
  const llamadas = storageSource.match(/PP_logCatalogoSupabase_\(/g) || [];
  assert.equal(llamadas.length, 3, `se esperaban 3 llamadas al espejo y hay ${llamadas.length}`);
});

test("el espejo nunca puede romper un guardado: va en try/catch y despues del flush", () => {
  const finish = storageSource.slice(
    storageSource.indexOf("function PP_finishPartialWrite_"),
    storageSource.indexOf("function PP_assertCurrentRevision_")
  );
  const flush = finish.indexOf("SpreadsheetApp.flush()");
  const espejo = finish.indexOf("PP_logCatalogoSupabase_");
  assert.ok(flush >= 0 && espejo > flush, "el espejo tiene que ir DESPUES del flush: la hoja es la autoridad");
  assert.match(catalogoSource, /function PP_supabaseMirrorCatalogo_[\s\S]*muteHttpExceptions: true/);
  assert.match(catalogoSource, /if \(code !== 200\) \{\s*\n\s*throw new Error/);
  // El try/catch por tabla: una tabla que falla no puede tirar las demas.
  assert.match(catalogoSource, /\} catch \(e\) \{\s*\n\s*resumen\.ok = false;/);
});

test("el espejo se apaga sin credencial en vez de fallar", () => {
  // En los tests y en cualquier despliegue sin SUPABASE_URL/SUPABASE_KEY el
  // espejo no hace nada y el guardado sigue; sin esto, guardar el plan
  // dependeria de que Supabase este disponible.
  assert.match(catalogoSource, /if \(!url \|\| !key\) return null;/);
  assert.match(catalogoSource, /motivo: 'sin configuracion de Supabase'/);
});
