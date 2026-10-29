// Un solo ambito global en Apps Script: este test vigila que dos archivos de
// src/server/ no declaren la misma funcion.
//
// QUE PASA REALMENTE (MEDIDO, y no es lo que parece). Una funcion declarada dos
// veces en JavaScript es LEGAL: no es error de parse, no rompe el despliegue y no
// se ve ningun aviso. Gana la ULTIMA que se carga, que en Apps Script es el orden
// alfabetico del proyecto. Este repo lo demuestra sin inventar nada:
// 16-inspection-service.js y 17-inspection-drawing-service.js declaran los dos
// getInspectionWorkOrder y getInspectionDrawingRoutes, y el proyecto desplegado
// expone 63 funciones y carga bien. Los que pierden son los de 16-, que quedan
// como codigo muerto: se editan creyendo que se cambia el comportamiento y no
// cambia nada.
//
// Un error de parse de verdad viene de `const`/`let`/`class` repetidos, o de
// llamar a un global que no existe. Eso si tumba el proyecto entero.
//
// POR QUE EXISTE. MEDIDO 2026-09-29: al integrar la ingesta periodica
// (src/server/19-appscript-ingesta-supabase.js, que antes vivia en un .gs en la
// raiz y nunca llego a production) traia sus propias PP_oauthHeader_ y
// PP_oauthEncode_, que ya estan en 08-netsuite.js. No habria roto nada (eran
// identicas y la ultima gana), pero deja dos copias que divergen sin que nadie lo
// note. Nada en la suite anterior lo detectaba: los tests miran comportamiento, y
// dos copias identicas se comportan igual de bien por separado. El fallo es de
// composicion, no de logica.
import { readdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../src/server/", import.meta.url));

// Duplicados que YA existen y son conocidos. Documentarlos aqui es lo que evita
// que el test se vuelva la excusa para ignorarlos: si uno se resuelve, se borra
// de esta lista en el mismo commit que lo resuelve.
//
// MEDIDO 2026-09-29: 17-inspection-drawing-service.js es un reescrito V2 de esas
// dos funciones de 16-inspection-service.js y, al cargarse despues, las pisa. Las
// de 16- no se ejecutan. Se deja constancia, no se "arregla" aqui: es codigo de
// inspeccion en produccion y decidir cual version vale es del dueno del dominio.
const DUPLICADOS_CONOCIDOS = {
  getInspectionWorkOrder: ["16-inspection-service.js", "17-inspection-drawing-service.js"],
  getInspectionDrawingRoutes: ["16-inspection-service.js", "17-inspection-drawing-service.js"],
};

const archivos = (await readdir(SERVER)).filter((f) => f.endsWith(".js")).sort();

/** Funciones de primer nivel. No se miran las de dentro de una clase u objeto. */
function funciones(txt) {
  const fuera = new Set();
  for (const m of txt.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) fuera.add(m[1]);
  return fuera;
}

/** Nombres declarados en el ambito global del archivo: funciones, const, let, var. */
function declarados(txt) {
  const fuera = new Set(funciones(txt));
  for (const m of txt.matchAll(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) fuera.add(m[1]);
  return fuera;
}

/** Identificadores que el archivo USA. Se quitan los que declara y los de objeto. */
function identificadoresUsados(txt) {
  const sinComentarios = txt
    .split(/\r?\n/)
    .map((l) => (/^\s*(\*|\/\*|\/\/)/.test(l) ? "" : l))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const usados = new Set();
  for (const m of sinComentarios.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) usados.add(m[1]);
  return usados;
}

// Globals de Apps Script que no hay que declarar, y los que aporta el archivo de
// credenciales que pega el usuario (supabase-config.gs), que no se despliega.
const GLOBALS_APPS_SCRIPT = new Set([
  "console", "JSON", "Math", "Date", "Object", "Array", "String", "Number", "Boolean", "RegExp", "Error", "Promise",
  "Utilities", "PropertiesService", "ScriptApp", "UrlFetchApp", "SpreadsheetApp", "Logger", "Session", "CacheService",
  "LockService", "HtmlService", "MailApp", "DriveApp", "JSON2", "encodeURIComponent", "decodeURIComponent", "isNaN", "parseInt", "parseFloat", "undefined",
]);
const GLOBALS_DE_CONFIG = new Set(["SUPABASE_URL", "SUPABASE_KEY", "UBICACION"]);
// Palabras clave y nombres de la biblioteca estandar: no son declaraciones.
const PALABRAS = new Set(["function", "const", "let", "var", "return", "if", "else", "for", "while", "of", "in", "new", "try", "catch", "finally", "throw", "typeof", "null", "undefined", "true", "false", "this", "delete", "void", "do", "switch", "case", "break", "continue", "default", "class", "extends", "yield", "await", "async", "instanceof"]);

test("hay archivos que mirar", () => {
  assert.ok(archivos.length >= 19, `solo ${archivos.length} archivos en src/server/`);
});

test("no hay funciones duplicadas NUEVAS entre archivos de src/server/", async () => {
  const duenas = new Map();
  for (const f of archivos) {
    const txt = await readFile(path.join(SERVER, f), "utf8");
    for (const n of funciones(txt)) {
      if (!duenas.has(n)) duenas.set(n, []);
      duenas.get(n).push(f);
    }
  }
  const choca = [...duenas].filter(([n, fs]) => fs.length > 1);

  // Los conocidos se listan, no se fallan: son codigo muerto documentado, y hacer
  // fallar el check por ellos taparia los duplicados nuevos, que son el problema.
  const nuevos = choca.filter(([n]) => !DUPLICADOS_CONOCIDOS[n]);
  assert.deepEqual(
    nuevos,
    [],
    "funciones declaradas en mas de un archivo (gana la ultima en silencio, la otra queda muerta):\n" +
      nuevos.map(([n, fs]) => `  ${n}: ${fs.join(" + ")}`).join("\n")
  );

  // Y los conocidos tienen que seguir siendo los de la lista: si uno se resuelve,
  // esta asercion falla y obliga a borrar la entrada en el mismo commit.
  const ahora = Object.fromEntries(choca.map(([n, fs]) => [n, fs]));
  assert.deepEqual(ahora, DUPLICADOS_CONOCIDOS, "la lista de duplicados conocidos cambio: actualizala con el motivo");
});

test("las copias duplicadas son de verdad el mismo punto de entrada, no dos servicios", async () => {
  // No basta con que se llamen igual: si 16- y 17-UVieran a ser dos servicios
  // distintos con el mismo nombre, la lista de 'conocidos' estaria escondiendo un
  // fallo de verdad. Se comprueba que 17- es un reescrito (usa los helpers V2) y
  // que su carga es posterior, o sea que gana el.
  const b = await readFile(path.join(SERVER, "17-inspection-drawing-service.js"), "utf8");
  const a = await readFile(path.join(SERVER, "16-inspection-service.js"), "utf8");
  assert.match(b, /PP_Inspection_routeIndexV2_\(\)/, "17- deberia ser el reescrito V2");
  assert.match(a, /PP_Inspection_routeIndex_\(\)/, "16- usa el indice V1");
  assert.ok(
    archivos.indexOf("17-inspection-drawing-service.js") > archivos.indexOf("16-inspection-service.js"),
    "17- tiene que cargarse despues de 16- para que sea el que gana"
  );
});

test("la ingesta no USA nada que este sin declarar", async () => {
  // El bug que casi se sube a produccion. El archivo usaba RESTLET_URL,
  // RESTLET_SCRIPT y RESTLET_DEPLOY sin declararlos, porque eran const del .gs de
  // la raiz, que no se despliega. Referenciar un global inexistente NO es error de
  // parse: el proyecto compila, el puente web responde, el workflow sale verde y
  // solo revienta cuando alguien ejecuta ingesta(), que es la unica prueba que no
  // se puede hacer desde aqui. Por eso se comprueba estaticamente.
  const ingesta = await readFile(new URL("../src/server/19-appscript-ingesta-supabase.js", import.meta.url), "utf8");

  // Lo declarado en cualquier archivo que SI se despliega.
  const enProyecto = new Set();
  for (const f of archivos) {
    if (f === "19-appscript-ingesta-supabase.js") continue;
    for (const n of declarados(await readFile(path.join(SERVER, f), "utf8"))) enProyecto.add(n);
  }
  const propios = declarados(ingesta);
  const conocidos = new Set([...GLOBALS_APPS_SCRIPT, ...GLOBALS_DE_CONFIG, ...PALABRAS, ...enProyecto, ...propios]);

  // Solo interesan los que parecen del proyecto: PP_*, o los de la ingesta. Los
  // identificadores de propiedades (objeto.metodo) y los literales se filtran
  // porque no son declaraciones.
  const sospechosos = [...identificadoresUsados(ingesta)]
    .filter((n) => !conocidos.has(n))
    .filter((n) => /^PP_/.test(n) || ["ingesta", "deduplicar_", "RESTLET_URL", "RESTLET_SCRIPT", "RESTLET_DEPLOY"].includes(n))
    .sort();

  assert.deepEqual(
    sospechosos,
    [],
    "identificadores usados y no declarados ni en src/server/ ni como global de Apps Script:\n" +
      sospechosos.map((n) => `  ${n}`).join("\n")
  );
});

test("la ingesta no redeclara las funciones OAuth que ya da 08-netsuite.js", async () => {
  // Es el duplicado que se iba a subir. No habria roto el despliegue (son
  // identicas y la ultima gana), pero deja dos copias que divergen sin que nadie
  // lo note. Se fija por nombre para que, si alguien copia el archivo suelto otra
  // vez, el test lo diga con el motivo.
  const ingesta = await readFile(new URL("../src/server/19-appscript-ingesta-supabase.js", import.meta.url), "utf8");
  for (const n of ["PP_oauthHeader_", "PP_oauthEncode_"]) {
    assert.ok(
      !new RegExp(`^\\s*function\\s+${n}\\s*\\(`, "m").test(ingesta),
      `${n} ya existe en 08-netsuite.js y es identica: duplicarla deja codigo muerto que diverge en silencio`
    );
  }
  // Pero las USA, que es lo que hace falta para que funcione.
  assert.match(ingesta, /PP_oauthHeader_\('POST'/);
  assert.match(ingesta, /PP_oauthEncode_\(key\)/);
});

test("la ingesta NO declara ninguna credencial ni una URL de Supabase", async () => {
  // El build copia todo src/server/ a dist/ y el CI sube dist/ en cada push. Una
  // clave aqui acabaria publicada, y ademas se volveria a subir en cada despliegue.
  const ingesta = await readFile(new URL("../src/server/19-appscript-ingesta-supabase.js", import.meta.url), "utf8");
  const codigo = ingesta.split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("/*") && !l.trim().startsWith("//"));
  const cuerpo = codigo.join("\n");
  assert.doesNotMatch(cuerpo, /sb_secret_[A-Za-z0-9_-]{8,}/, "la service key real no puede estar en el repo");
  assert.doesNotMatch(cuerpo, /sb_publishable_[A-Za-z0-9_-]{8,}/);
  assert.doesNotMatch(cuerpo, /const\s+SUPABASE_KEY\s*=/, "SUPABASE_KEY va en supabase-config.gs, que pega el usuario");
  assert.doesNotMatch(cuerpo, /supabase\.co/, "la URL tampoco: sale de SUPABASE_URL en ese archivo aparte");
  // Y si el archivo no existe o sigue con el ejemplo, ingestion() lo dice claro.
  assert.match(ingesta, /PP_verificaConfigIngesta_\(config\)/);
  assert.match(ingesta, /TU_SERVICE_ROLE_KEY|sigue con el valor de ejemplo/);
});

test("la ingesta declara el punto de entrada y el creador de activadores", async () => {
  const ingesta = await readFile(new URL("../src/server/19-appscript-ingesta-supabase.js", import.meta.url), "utf8");
  const f = funciones(ingesta);
  for (const n of ["ingesta", "PP_creaTriggerIngesta_", "PP_borraTriggerIngesta_", "PP_config_", "PP_restletUnificado_", "PP_supabaseMirror_"]) {
    assert.ok(f.has(n), `falta ${n} en 19-appscript-ingesta-supabase.js`);
  }
  // El horario del header tiene que estar de verdad en el codigo, no solo escrito.
  assert.match(ingesta, /dia === 0 \|\| dia === 6 \|\| hora < 7 \|\| hora >= 17/);
  // El activador no se puede crear desde fuera: se crea con esta funcion, a mano.
  assert.match(ingesta, /ScriptApp\.newTrigger\('ingesta'\)/);
  assert.match(ingesta, /ScriptApp\.deleteTrigger/);
  // Y las 7 tablas, las mismas que escribe el RESTlet y SOLO esas.
  for (const t of ["work_orders", "operations", "materials", "items", "machines", "inventory", "sales_orders"]) {
    assert.ok(ingesta.includes(`tabla: '${t}'`), `falta la tabla ${t}`);
  }
  assert.doesNotMatch(ingesta, /machine_planning_overrides|tabla: 'capabilities'|tabla: 'operators'/,
    "esta es la ingesta de NetSuite; los catalogos los escribe 16-supabase-catalogo.js (un solo escritor por tabla)");
});
