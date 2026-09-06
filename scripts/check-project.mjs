import { execFileSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildProject } from "./build-appscript.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

const [index, bridge, pagesIndex] = await Promise.all([
  readFile(path.join(distDir, "Index.html"), "utf8"),
  readFile(path.join(distDir, "Bridge.html"), "utf8"),
  readFile(path.join(siteDir, "index.html"), "utf8"),
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

const manifest = JSON.parse(await readFile(path.join(distDir, "appsscript.json"), "utf8"));
if (manifest.runtimeVersion !== "V8") throw new Error("El manifest no usa V8");
if (manifest.webapp?.access !== "ANYONE_ANONYMOUS" || manifest.webapp?.executeAs !== "USER_DEPLOYING") {
  throw new Error("El manifest no conserva la implementacion web publica");
}

const rules = await readRules();
const ruleWarnings = await verifyRuleOverlaps(rules);

const size = (await stat(path.join(distDir, "Index.html"))).size;
console.log(`Validacion correcta. Index.html: ${Math.round(size / 1024)} KiB; Apps Script: ${files.length} archivos; Pages listo.`);
for (const warning of ruleWarnings) console.log(`aviso: ${warning}`);

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
