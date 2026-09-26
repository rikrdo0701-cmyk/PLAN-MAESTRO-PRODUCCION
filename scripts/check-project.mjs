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
  const parsed = JSON.parse(content);
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
