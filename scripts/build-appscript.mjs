import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(projectRoot, "dist");
const siteDir = path.join(projectRoot, "site");
const appsScriptWebAppUrl = "https://script.google.com/macros/s/AKfycbyCrdM3g-ixxjbvqjysQ7pdO59Bn6NQA6PECUC_YI-ByfwzC1ueWcQFx1hErWqTHVoSxw/exec";

async function read(relativePath) {
  return readFile(path.join(projectRoot, relativePath), "utf8");
}

function renderPlanningPage(template, styles, backendBridge, plannerCore, app, performanceClient, generatedComment, pwaHead = "") {
  const templateWithHead = pwaHead
    ? template.replace('    <link rel="icon" href="data:," />', '    <link rel="icon" href="data:," />\n' + pwaHead)
    : template;
  const templateWithBridge = templateWithHead.replace(
    "    <script>\n{{PLANNER_CORE}}\n</script>",
    `    <script>\n${backendBridge.trimEnd()}\n</script>\n    <script>\n{{PLANNER_CORE}}\n</script>`,
  );
  if (templateWithBridge === template) throw new Error("No se encontro el punto de insercion del puente de backend");

  const index = templateWithBridge
    .replace("{{PLANNING_STYLES}}", styles.trimEnd())
    .replace("{{PLANNER_CORE}}", plannerCore.trimEnd())
    .replace("{{PLANNING_APP}}", `${app.trimEnd()}\n</script>\n    <script>\n${performanceClient.trimEnd()}`)
    .replace("<!-- Archivo generado. Edita src/web/planning y ejecuta npm run build. -->", generatedComment);

  if (/{{[A-Z0-9_]+}}/.test(index)) throw new Error("Quedaron marcadores sin reemplazar en Index.html");
  return index;
}

export async function buildProject() {
  await Promise.all([
    rm(distDir, { recursive: true, force: true }),
    rm(siteDir, { recursive: true, force: true }),
  ]);
  await Promise.all([
    mkdir(distDir, { recursive: true }),
    mkdir(siteDir, { recursive: true }),
  ]);

  const [template, styles, bridgeSource, plannerCore, app, performanceClient] = await Promise.all([
    read("src/web/planning/index.template.html"),
    read("src/web/planning/styles.css"),
    read("src/web/shared/apps-script-bridge-client.js"),
    read("src/web/planning/planner-core.js"),
    read("src/web/planning/app.js"),
    read("src/web/shared/performance-client.js"),
  ]);
  const backendBridge = bridgeSource.replace("__PP_APPS_SCRIPT_WEB_APP_URL__", appsScriptWebAppUrl);

  const appsScriptIndex = renderPlanningPage(
    template,
    styles,
    backendBridge,
    plannerCore,
    app,
    performanceClient,
    "<!-- Generado para Apps Script por npm run build. No editar directamente. -->",
    "",
  );
  const pagesIndex = renderPlanningPage(
    template,
    styles,
    backendBridge,
    plannerCore,
    app,
    performanceClient,
    "<!-- Generado para GitHub Pages por npm run build. No editar directamente. -->",
    '    <link rel="manifest" href="./manifest.webmanifest" />',
  );

  await Promise.all([
    writeFile(path.join(distDir, "Index.html"), appsScriptIndex, "utf8"),
    writeFile(path.join(siteDir, "index.html"), pagesIndex, "utf8"),
    writeFile(path.join(siteDir, ".nojekyll"), "", "utf8"),
    writeFile(path.join(siteDir, "manifest.webmanifest"), JSON.stringify({
      name: "Plan Maestro de Produccion",
      short_name: "Plan Maestro",
      description: "Planeacion y control de produccion",
      start_url: "./",
      scope: "./",
      display: "standalone",
      background_color: "#eef1f4",
      theme_color: "#087f7a",
      lang: "es-MX"
    }, null, 2), "utf8"),
    writeFile(path.join(siteDir, "sw.js"), `const CACHE_NAME = "plan-maestro-v2.41.0";
const APP_SHELL = ["./", "./index.html", "./operator.html", "./skills.html", "./manifest.webmanifest"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request).then((cached) => {
    const network = fetch(event.request).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
      return response;
    }).catch(() => cached);
    return cached || network;
  }));
});
`, "utf8"),
    cp(path.join(projectRoot, "src/web/operator/IndexOperator.html"), path.join(distDir, "IndexOperator.html")),
    cp(path.join(projectRoot, "src/web/skills/IndexSkills.html"), path.join(distDir, "IndexSkills.html")),
    cp(path.join(projectRoot, "src/web/operator/IndexOperator.html"), path.join(siteDir, "operator.html")),
    cp(path.join(projectRoot, "src/web/skills/IndexSkills.html"), path.join(siteDir, "skills.html")),
    cp(path.join(projectRoot, "src/web/bridge/Bridge.html"), path.join(distDir, "Bridge.html")),
    cp(path.join(projectRoot, "appsscript.json"), path.join(distDir, "appsscript.json")),
  ]);

  const serverDir = path.join(projectRoot, "src/server");
  const serverFiles = (await readdir(serverDir)).filter((name) => name.endsWith(".js")).sort();
  for (const file of serverFiles) await cp(path.join(serverDir, file), path.join(distDir, file));

  return {
    distDir,
    siteDir,
    serverFiles,
    htmlFiles: ["Index.html", "IndexOperator.html", "IndexSkills.html", "Bridge.html"],
    pagesFiles: ["index.html", "operator.html", "skills.html", "manifest.webmanifest", "sw.js"],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildProject();
  console.log(`Apps Script generado en ${result.distDir}`);
  console.log(`GitHub Pages generado en ${result.siteDir}`);
  console.log(`${result.serverFiles.length} archivos de servidor, ${result.htmlFiles.length} vistas Apps Script y ${result.pagesFiles.length} paginas estaticas.`);
}
