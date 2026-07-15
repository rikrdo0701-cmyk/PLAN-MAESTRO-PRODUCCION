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
if (!pagesIndex.includes("AKfycbzI4pxkYSVAulRhlQC6WbtaMTQodqVMjGtK1v4HREi7Yoxq4yaWdbtOivXj3uMv623Dvw")) {
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

const size = (await stat(path.join(distDir, "Index.html"))).size;
console.log(`Validacion correcta. Index.html: ${Math.round(size / 1024)} KiB; Apps Script: ${files.length} archivos; Pages listo.`);
