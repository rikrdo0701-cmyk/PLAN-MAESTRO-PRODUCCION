import { execFileSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildProject } from "./build-appscript.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// La cuenta de pruebas vive aqui, no en las reglas, y `check` corre la suite completa a
// proposito: `npm run push` y `npm run deploy` hacen `check && clasp ...`, asi que un cambio de
// servidor sin sus pruebas no puede llegar a NetSuite. Con solo el `npm test` separado, un
// `clasp push` a mano se lleva un fetch que rompio la sincronizacion.
//
// Los archivos se ENUMERAN en vez de pasar el glob tests/*.test.mjs: execFileSync no pasa por
// shell, asi que el glob llega literal a node --test. En Windows el propio Node lo expande y
// en Linux no, que es exactamente lo que rompio CI el 2026-09-26: el runner (Node 20) reporto
// "Could not find .../tests/*.test.mjs", la suite dio 0 pruebas y `check` aborto, dejando sin
// desplegar tres commits. Enumerar funciona igual en cualquier sistema y version de Node.
const testFiles = (await readdir(path.join(root, "tests")))
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => path.join(root, "tests", name));
if (!testFiles.length) throw new Error("No hay pruebas en tests/ (*.test.mjs)");

const { distDir, siteDir } = await buildProject();
const files = await readdir(distDir);
const required = ["Index.html", "IndexOperator.html", "IndexSkills.html", "Bridge.html", "appsscript.json"];
for (const file of required) {
  if (!files.includes(file)) throw new Error(`Falta ${file} en dist`);
}

for (const file of files.filter((name) => name.endsWith(".js"))) {
  execFileSync(process.execPath, ["--check", path.join(distDir, file)], { stdio: "inherit" });
}
execFileSync(process.execPath, ["--check", path.join(root, "src/web/shared/apps-script-bridge-client.js")], { stdio: "inherit" });
execFileSync(process.execPath, ["--check", path.join(root, "src/web/shared/performance-client.js")], { stdio: "inherit" });
execFileSync(process.execPath, ["--check", path.join(root, "src/web/shared/supabase-reader.js")], { stdio: "inherit" });

const suite = runTestSuite();

const [index, bridge, pagesIndex, distSkills, pagesSkills] = await Promise.all([
  readFile(path.join(distDir, "Index.html"), "utf8"),
  readFile(path.join(distDir, "Bridge.html"), "utf8"),
  readFile(path.join(siteDir, "index.html"), "utf8"),
  readFile(path.join(distDir, "IndexSkills.html"), "utf8"),
  readFile(path.join(siteDir, "skills.html"), "utf8"),
]);
if (!index.includes("google.script.run")) throw new Error("Index.html no contiene compatibilidad con google.script.run");
if (!index.includes("PPAppsScriptBridge")) throw new Error("Index.html no contiene el cliente del puente remoto");
if (!index.includes("PlannerCore")) throw new Error("Index.html no contiene PlannerCore");
if (!index.includes("getAppState")) throw new Error("Index.html no contiene carga del estado de la aplicacion");
if (!index.includes("savePlanningStateOptimized")) throw new Error("Index.html no contiene guardado parcial optimizado");
if (!bridge.includes("ALLOWED_ORIGIN")) throw new Error("Bridge.html no valida el origen del frontend");
if (!bridge.includes("google.script.run")) throw new Error("Bridge.html no contiene google.script.run");
if (!pagesIndex.includes("AKfycbzom44gOrh7KQWkeroVHHtQfH6osAFdBUN-NHJ_T1g13cQlEKhCpMP8lcHDrH-PzOzB5Q")) {
  throw new Error("El frontend de Pages no contiene la URL del backend configurada");
}
if (!pagesIndex.includes("manifest.webmanifest") || !pagesIndex.includes("serviceWorker.register")) {
  throw new Error("El frontend de Pages no contiene PWA/cache estatico");
}
if (/{{[A-Z0-9_]+}}/.test(index) || /__PP_APPS_SCRIPT_WEB_APP_URL__/.test(pagesIndex)) {
  throw new Error("El build contiene marcadores sin reemplazar");
}
if (!pagesIndex.includes("PPSupabaseReader")) {
  throw new Error("El frontend de Pages no contiene el lector de Supabase");
}
if (pagesIndex.includes("__PP_SUPABASE_URL__") || pagesIndex.includes("__PP_SUPABASE_ANON_KEY__")) {
  throw new Error("El build no reemplazo los marcadores de configuracion de Supabase");
}

// QUE FALTA ESTA COMPROBACION, Y POR QUE. MEDIDO 2026-10-01: `npm run push` (que es
// `check && clasp push`) se corrio SIN SUPABASE_URL ni SUPABASE_ANON_KEY en el entorno.
// build-appscript.mjs:464-465 sustituyo los marcadores con "", el build paso todas las
// comprobaciones de arriba (un marcador VACIO no contiene el marcador, asi que la de la
// linea 67 no lo ve) y se subieron 26 archivos a Apps Script con el lector de Supabase
// apagado: `const DEFAULT_ANON_KEY = ""` -> `configurado === false` en supabase-auth.js:45
// -> sin login, sin JWT, y con las politicas RLS `to authenticated` no se lee NADA.
// Para la pagina de inspeccion eso no es una degradacion: el puente de Apps Script ya no
// esta (se borro el `call`), asi que no hay plan B.
//
// O sea: el build puede quedar SIN credenciales sin que nada se queje. Eso se dice aqui,
// en el gate que corre antes de cada push, y no en un comentario que nadie lee.
//
// MEDIDO 2026-10-02, EL AGUJERO QUE QUEDABA EN ESTE MISMO GATE: una credencial VACIA se
// detecta, una credencial COPIADA DEL EJEMPLO no. Pegando la linea de ayuda tal cual,
// `$env:SUPABASE_ANON_KEY = '<sb_publishable_...>'`, el build paso las 1365 pruebas y
// "Validacion correcta", y el bundle salio con `const DEFAULT_ANON_KEY =
// "<sb_publishable_...>"`. Eso es peor que vacio: vacio apaga el lector y el aviso lo dice;
// un placeholder lo ENCIENDE (isConfigured() da true, porque es un string no vacio), el
// lector sale a pedir las 24 tablas y vuelve con 401 en todas, y la pagina se queda sin datos
// sin que ningun cartel diga por que. El texto de ejemplo del aviso de este mismo archivo es
// el que se copio, o sea que el aviso se estaba contradiciendo a si mismo.
// Un placeholder se reconoce por los tres puntos y por los angulos: `...` y `sb_publishable_`.
// Se mira el BUNDLE y no el entorno, porque el bundle es lo que se publica.
const CREDENCIAL_EJEMPLO = /(\.\.\.|<\s*sb_|sb_publishable_\.\.\.|<tu_|TU_SERVICE_ROLE)/i;
const credencialesVacias = [];
const credencialesEjemplo = [];
for (const [nombre, texto] of [["dist/Index.html", index], ["site/index.html", pagesIndex]]) {
  for (const [etiqueta, patron] of [["DEFAULT_ANON_KEY", /DEFAULT_ANON_KEY\s*=\s*"([^"]*)"/], ["DEFAULT_URL", /DEFAULT_URL\s*=\s*"([^"]*)"/]]) {
    const valor = (texto.match(patron) || [])[1];
    if (valor == null) continue;
    if (CREDENCIAL_EJEMPLO.test(valor)) credencialesEjemplo.push(`${nombre}: ${etiqueta} es el TEXTO DE EJEMPLO ("${valor}"), no una clave`);
    else if (!valor.trim()) credencialesVacias.push(`${nombre}: ${etiqueta} vacio`);
  }
}
for (const skills of [distSkills, pagesSkills]) {
  if (!skills.includes("PPAppsScriptBridge")) throw new Error("skills.html no contiene el cliente del puente remoto");
  if (!skills.includes("getAppState")) throw new Error("skills.html no contiene carga del estado");
  if (!skills.includes("saveSkillState")) throw new Error("skills.html no contiene guardado de la matriz");
  if (!skills.includes("matrix-row-no-operator")) throw new Error("skills.html no resalta operaciones sin operador");
  if (/{{[A-Z0-9_]+}}/.test(skills) || /__PP_APPS_SCRIPT_WEB_APP_URL__/.test(skills)) {
    throw new Error("skills.html contiene marcadores sin reemplazar");
  }
}
if (!pagesSkills.includes("AKfycbzom44gOrh7KQWkeroVHHtQfH6osAFdBUN-NHJ_T1g13cQlEKhCpMP8lcHDrH-PzOzB5Q")) {
  throw new Error("skills.html de Pages no contiene la URL del backend configurada");
}

const manifest = JSON.parse(await readFile(path.join(distDir, "appsscript.json"), "utf8"));
if (manifest.runtimeVersion !== "V8") throw new Error("El manifest no usa V8");
if (manifest.webapp?.access !== "ANYONE_ANONYMOUS" || manifest.webapp?.executeAs !== "USER_DEPLOYING") {
  throw new Error("El manifest no conserva la implementacion web publica");
}

const rules = await readRules();
const ruleWarnings = await verifyRuleOverlaps(rules);

const size = (await stat(path.join(distDir, "Index.html"))).size;
console.log(`Validacion correcta. Index.html: ${Math.round(size / 1024)} KiB; Apps Script: ${files.length} archivos; Pages listo. Suite ${suite.passed}/${suite.total}.`);
for (const warning of ruleWarnings) console.log(`aviso: ${warning}`);
if (credencialesVacias.length) {
  // Aviso, no error: `npm run build` a secas es legitimo (solo genera artefactos), y romper
  // `npm run check` obligaria a tener credenciales para cualquier otra comprobacion. Lo que NO
  // puede es ser silencioso: este texto nombra la credencial que falta y el costo de subirlo.
  console.log("");
  console.log("AVISO: el build salio SIN credenciales de Supabase. El lector queda APAGADO.");
  for (const falta of credencialesVacias) console.log(`  - ${falta}`);
  console.log("  supabase-auth.js isConfigured() da false: no hay login, no hay JWT, y con RLS");
  console.log("  `to authenticated` no se lee ninguna tabla. La pagina de inspeccion no tiene");
  console.log("  puente de Apps Script, asi que se queda vacia sin avisar.");
  console.log("");
  console.log("  Antes de `clasp push` o `clasp deploy`, exportar en ESTA consola:");
  console.log("    $env:SUPABASE_URL = 'https://xtgtfjcwxcoxvixholpj.supabase.co'");
  console.log("    $env:SUPABASE_ANON_KEY = 'sb_publishable_...'");
  console.log("  y volver a correr. La clave publishable es publica: va en el JavaScript del cliente.");
  console.log("");
}
if (credencialesEjemplo.length) {
  // Esto SI es error y no aviso, y la diferencia con el caso de arriba es la que importa: una
  // credencial vacia APAGA el lector (isConfigured() false) y la pagina avisa; un placeholder lo
  // ENCIENDE con una clave que no existe, o sea que el lector sale a pedir las 24 tablas y vuelve
  // con 401 en todas. Fallar es mejor que publicar un bundle que parece configurado y no lo esta.
  throw new Error("El build se llevo el TEXTO DE EJEMPLO de una credencial de Supabase, no la credencial:\n  - "
    + credencialesEjemplo.join("\n  - ")
    + "\nEl lector queda ENCENDIDO con una clave invalida: sale a leer y vuelve 401 en todo, sin aviso."
    + "\nExporta la clave publishable real de Supabase (Settings > API Keys) y vuelve a correr.");
}

function runTestSuite() {
  // --test-reporter=tap es explicito: el reporter por defecto (spec) cambia entre versiones de
  // Node y su resumen no es parseable de forma estable.
  let output = "";
  let failed = 0;
  try {
    output = execFileSync(process.execPath, ["--test", "--test-reporter=tap", ...testFiles], { encoding: "utf8" });
  } catch (error) {
    output = String(error?.stdout || "") + String(error?.stderr || "");
    failed = readCount(output, /^#\s*fail\s+(\d+)$/m);
  }
  const total = readCount(output, /^#\s*tests\s+(\d+)$/m);
  const passed = readCount(output, /^#\s*pass\s+(\d+)$/m);
  if (failed) {
    process.stdout.write(reportFailures(output, failed, total));
    throw new Error(`La suite fallo: ${failed} de ${total} pruebas`);
  }
  if (!total) {
    process.stdout.write(output);
    throw new Error("No se pudo leer el conteo de pruebas de la salida de node --test");
  }
  return { total, passed };
}

/**
 * Volcar la salida TAP entera no sirve de nada (son cientos de `ok N`), asi que se conserva
 * solo el bloque de cada prueba que fallo mas el resumen. Cada bloque empieza en `not ok` y
 * termina en la siguiente linea de caso (`ok N`/`not ok N`) o de comentario (`# `).
 */
function reportFailures(output, failed, total) {
  const lines = String(output || "").split(/\r?\n/);
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^not ok \d+ - /.test(lines[i])) continue;
    const block = [lines[i]];
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^(not )?ok \d+ - /.test(lines[j]) || /^# \S/.test(lines[j])) break;
      block.push(lines[j]);
    }
    blocks.push(block.join("\n"));
    i += block.length;
  }
  const resumen = lines.filter((line) => /^#\s*(tests|pass|fail|duration_ms)\b/.test(line)).join("\n");
  return `${blocks.join("\n\n")}\n\n${resumen}\n`;
}

function readCount(output, pattern) {
  const match = String(output || "").match(pattern);
  return match ? Number(match[1]) : 0;
}

async function readRules() {
  let content;
  try {
    content = await readFile(path.join(root, ".project-memory/rules.json"), "utf8");
  } catch {
    return [];
  }
  // Un BOM al principio rompe JSON.parse, y como npm run check va primero en push y deploy,
  // un BOM en rules.json dejaba el proyecto SIN PODER DESPLEGAR. Se quita en la lectura.
  const parsed = JSON.parse(content.replace(/^\uFEFF/, ""));
  const list = Array.isArray(parsed) ? parsed : parsed?.rules;
  if (!Array.isArray(list)) throw new Error("rules.json no contiene una lista de reglas valida");
  return list;
}

async function verifyRuleOverlaps(list) {
  const warnings = [];
  const seenIds = new Map();
  for (const rule of list) {
    const id = String(rule?.rule_id || "").trim();
    if (!id) throw new Error(`rules.json contiene una regla sin rule_id: ${JSON.stringify(rule?.name || "")}`);
    if (seenIds.has(id)) throw new Error(`rules.json tiene rule_id duplicado: ${id}`);
    seenIds.set(id, rule);
  }
  const tokenize = (value) =>
    String(value || "").toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ").filter(Boolean);
  const stop = new Set(["de", "del", "la", "las", "el", "los", "en", "y", "no", "con", "para", "una", "un", "entre", "por", "que", "a", "al", "se", "su", "sus"]);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (String(a?.domain || "").trim().toUpperCase() !== String(b?.domain || "").trim().toUpperCase()) continue;
      const ta = tokenize(a?.name).filter((token) => !stop.has(token));
      const tb = tokenize(b?.name).filter((token) => !stop.has(token));
      const setA = new Set(ta);
      let intersection = 0;
      tb.forEach((token) => { if (setA.has(token)) intersection += 1; });
      const union = new Set([...setA, ...tb]).size;
      const similarity = union ? intersection / union : 0;
      if (similarity >= 0.65) {
        warnings.push(`posible solape entre ${a.rule_id} y ${b.rule_id} (similitud ${Math.round(similarity * 100)}%); revisarlo y decidir cual regla permanece`);
      }
    }
  }
  return warnings;
}
