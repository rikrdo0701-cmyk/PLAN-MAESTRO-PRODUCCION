import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(projectRoot, "dist");

async function read(relativePath) {
  return readFile(path.join(projectRoot, relativePath), "utf8");
}

export async function buildProject() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  const [template, styles, plannerCore, app] = await Promise.all([
    read("src/web/planning/index.template.html"),
    read("src/web/planning/styles.css"),
    read("src/web/planning/planner-core.js"),
    read("src/web/planning/app.js"),
  ]);

  const index = template
    .replace("{{PLANNING_STYLES}}", styles.trimEnd())
    .replace("{{PLANNER_CORE}}", plannerCore.trimEnd())
    .replace("{{PLANNING_APP}}", app.trimEnd())
    .replace("<!-- Archivo generado. Edita src/web/planning y ejecuta npm run build. -->",
      "<!-- Generado por npm run build. No editar directamente. -->");

  if (/{{[A-Z0-9_]+}}/.test(index)) {
    throw new Error("Quedaron marcadores sin reemplazar en Index.html");
  }

  await writeFile(path.join(distDir, "Index.html"), index, "utf8");
  await cp(path.join(projectRoot, "src/web/operator/IndexOperator.html"), path.join(distDir, "IndexOperator.html"));
  await cp(path.join(projectRoot, "src/web/skills/IndexSkills.html"), path.join(distDir, "IndexSkills.html"));
  await cp(path.join(projectRoot, "appsscript.json"), path.join(distDir, "appsscript.json"));

  const serverDir = path.join(projectRoot, "src/server");
  const serverFiles = (await readdir(serverDir)).filter((name) => name.endsWith(".js")).sort();
  for (const file of serverFiles) {
    await cp(path.join(serverDir, file), path.join(distDir, file));
  }

  return { distDir, serverFiles, htmlFiles: ["Index.html", "IndexOperator.html", "IndexSkills.html"] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildProject();
  console.log(`Apps Script generado en ${result.distDir}`);
  console.log(`${result.serverFiles.length} archivos de servidor y ${result.htmlFiles.length} vistas HTML.`);
}
