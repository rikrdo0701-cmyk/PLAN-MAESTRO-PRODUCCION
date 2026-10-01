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
// El DDL de cierre esta SIN APLICAR todavia: el test lo trata como la especificacion,
// no como el estado de la base.
const ddlCierre = await readFile(new URL("../docs/schema-supabase-cierre-catalogos.sql", import.meta.url), "utf8");

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

// ---------------------------------------------------------------------------
// RULE-SUP-017: la planificacion puede apartar una maquina que NetSuite da por
// activa. El flag vive en una TABLA APARTE, no en `machines`.
// ---------------------------------------------------------------------------

test("apartar una maquina se guarda en machine_planning_overrides, no en machines", () => {
  // `machines` la reescribe ENTERA el RESTlet 2246 cada 15 minutos (borra + inserta):
  // una columna de la app ahi se perderia en la siguiente corrida. Y el espejo de
  // catalogos no puede escribir `machines` porque seria un segundo escritor.
  const tablas = TABLAS.map((def) => def.tabla);
  assert.equal(tablas.includes("machines"), false, "el espejo no debe escribir machines");
  assert.equal(tablas.includes("machine_planning_overrides"), true, "falta la tabla del override");
  const def = TABLAS.find((item) => item.tabla === "machine_planning_overrides");
  assert.equal(def.hoja, "MAQUINAS", "el override se lee de la hoja MAQUINAS");
});

test("la columna EXCLUIDA existe en la hoja MAQUINAS", () => {
  assert.deepEqual(SHEETS.MAQUINAS, ["ID", "ACTIVA", "EXCLUIDA"]);
});

test("PP_mapMachine_ calcula la bandera efectiva en un solo lugar", () => {
  // `active` = lo que diga la hoja MENOS lo que la planificacion aparto. Se calcula en
  // PP_mapMachine_ (y en el lector de Supabase) para no tocar los ~6 filtros
  // `.filter(m => m.active !== false)` del frontend.
  const ctx = cargar();
  // PP_readRows_ entrega un objeto con una propiedad por encabezado, leida con
  // getDisplayValues(): por eso los booleanos vuelven como "TRUE"/"FALSE" y no como true.
  const casos = [
    [{ ID: "A1", ACTIVA: "TRUE", EXCLUIDA: "FALSE" }, true, false],
    [{ ID: "A1", ACTIVA: "TRUE", EXCLUIDA: "TRUE" }, false, true],
    [{ ID: "A1", ACTIVA: "FALSE", EXCLUIDA: "FALSE" }, false, false],
    [{ ID: "A1", ACTIVA: "FALSE", EXCLUIDA: "TRUE" }, false, true],
    // Si alguien escribe un booleano de verdad (getValues en vez de getDisplayValues).
    [{ ID: "A1", ACTIVA: true, EXCLUIDA: true }, false, true],
    // Columnas ausentes o vacias: el default de siempre (ACTIVA true, EXCLUIDA false).
    [{ ID: "A1" }, true, false],
    [{ ID: "A1", ACTIVA: "TRUE", EXCLUIDA: "" }, true, false],
  ];
  for (const [fila, activeEsperado, excludedEsperado] of casos) {
    const r = vm.runInContext(`PP_mapMachine_(${JSON.stringify(fila)})`, ctx);
    assert.equal(r.id, "A1");
    assert.equal(r.active, activeEsperado, `active con ${JSON.stringify(fila)}`);
    assert.equal(r.excluded, excludedEsperado, `excluded con ${JSON.stringify(fila)}`);
  }
});

test("el guardado de catalogos escribe las 3 columnas de la hoja MAQUINAS", () => {
  // Si se olvidara una, PP_writeTable_ la deja vacia y la exclusion se pierde al releer.
  const renglon = storageSource.match(
    /getSheetByName\('MAQUINAS'\).*?return \[([^\]]+)\]/
  );
  assert.ok(renglon, "no encontre el renglon de MAQUINAS");
  const partes = renglon[1].split(",");
  assert.equal(partes.length, 3, `se esperaban 3 columnas y hay ${partes.length}: ${renglon[1]}`);
  assert.match(partes[2], /excluded/);
});

test("el DDL de cierre crea el override con RLS de solo lectura y en la whitelist", () => {
  assert.match(ddlCierre, /create table if not exists public\.machine_planning_overrides/);
  assert.match(ddlCierre, /machine_nombre\s+text not null unique/);
  assert.match(ddlCierre, /excluida\s+boolean not null default false/);
  // Escritura para anon, ni aqui ni en ninguna otra tabla.
  assert.match(ddlCierre, /alter table public\.machine_planning_overrides enable row level security/);
  // MEDIDO 2026-10-01: esta asercion FUJABA el defecto, no lo cazaba. Fijaba que el DDL de cierre
// abriera machine_planning_overrides a anon, que es justo lo que el DDL de login habia cerrado, y
// como se aplico despues, la abrio otra vez: medido con la publicable y sin sesion, esa tabla
// devolvia sus 8 filas y las otras 24 devolvian 0. Un test que afirma el defecto lo convierte en
// requisito, y despues ya no hay forma de que la suite avise.
assert.match(ddlCierre, /create policy "lectura_app" on public\.machine_planning_overrides for select to authenticated using \(true\)/,
  "machine_planning_overrides se lee solo con sesion, como las demas");
assert.match(ddlCierre, /drop policy if exists lectura_app on public\.machine_planning_overrides/,
  "y se borran los dos nombres: si no, reaplicar el DDL de cierre tras el de login deja las dos politicas");
  assert.equal(/for (insert|update|delete)/i.test(ddlCierre), false, "el DDL no debe abrir escritura a anon");
  // Y el RPC puede espejarla.
  assert.match(ddlCierre, /'ot_configurations','article_configurations',\s*\n\s*'machine_planning_overrides'\)/);
  assert.match(ddlCierre, /revoke all on function public\.ingesta_mirror\(text, jsonb\) from public/);
});
