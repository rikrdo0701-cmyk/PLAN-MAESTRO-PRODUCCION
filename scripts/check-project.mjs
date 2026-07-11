import { execFileSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildProject } from "./build-appscript.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { distDir } = await buildProject();
const files = await readdir(distDir);
const required = ["Index.html", "IndexOperator.html", "IndexSkills.html", "appsscript.json"];
for (const file of required) {
  if (!files.includes(file)) throw new Error(`Falta ${file} en dist`);
}

for (const file of files.filter((name) => name.endsWith(".js"))) {
  execFileSync(process.execPath, ["--check", path.join(distDir, file)], { stdio: "inherit" });
}

const index = await readFile(path.join(distDir, "Index.html"), "utf8");
if (!index.includes("google.script.run")) throw new Error("Index.html no contiene el puente google.script.run");
if (!index.includes("PlannerCore")) throw new Error("Index.html no contiene PlannerCore");
if (index.includes("{{PLANNING_")) throw new Error("Index.html contiene marcadores de build");

const manifest = JSON.parse(await readFile(path.join(distDir, "appsscript.json"), "utf8"));
if (manifest.runtimeVersion !== "V8") throw new Error("El manifest no usa V8");

const size = (await stat(path.join(distDir, "Index.html"))).size;
console.log(`Validacion correcta. Index.html: ${Math.round(size / 1024)} KiB; archivos: ${files.length}.`);
