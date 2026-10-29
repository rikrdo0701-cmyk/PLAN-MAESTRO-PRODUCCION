/**
 * Test de LECTURA de Apps Script contra el despliegue REAL de produccion, por el mismo camino
 * que usa el frontend: el puente postMessage. No hay atajo (nada de scripts.run ni de clasp
 * push): lo que se prueba es exactamente lo que depende la app, iframe de por medio.
 *
 * QUE MIDE
 *   1. deploy.http             GET {exec}?app=bridge -> el despliegue responde y la pagina del
 *                              puente sale con el origen del frontend ya resuelto
 *                              (FRONTEND_ORIGIN en Propiedades del script).
 *   2. bridge.getDeploymentStatus  -> version de app y de esquema desplegadas, y si el script
 *                              tiene PLANNING_SPREADSHEET_ID, credenciales de NetSuite y
 *                              PHOTO_FOLDER_ID configuradas. NO escribe nada.
 *   3. bridge.getAppRevision   -> lee CONFIG (revision, savedAt, syncedAt). NO escribe nada.
 *   4. bridge.getAppStateIfChanged(revision) -> el mismo codigo que consulta el arranque; se
 *                              manda la revision recien leida para que responda {unchanged:true}
 *                              y no baje el estado completo. NO escribe datos, pero SI llama
 *                              PP_ensureWorkbook_ (normalizacion idempotente de hojas y
 *                              encabezados, ver src/server/02-storage.js:91).
 *   5. bridge.listPlanSnapshots -> lectura de PLANES_HISTORICOS. Misma normalizacion que 4.
 *
 * AISLAMIENTO DE ESCRITURA
 * En la pagina solo existe una lista blanca de metodos de lectura; cualquier otro metodo lanza
 * excepcion antes de salir. Ademas el cliente real del puente (src/web/shared/
 * apps-script-bridge-client.js) se envuelve para registrar cada llamada: el reporte lista los
 * metodos que se invocaron, y si alguno no esta en la lista blanca la corrida es FALLA.
 *
 * USO
 *   node scripts/appsscript-bridge-read-test.mjs
 *   node scripts/appsscript-bridge-read-test.mjs --headed --keep-open
 *   node scripts/appsscript-bridge-read-test.mjs --url=https://script.google.com/macros/s/<id>/exec
 *   node scripts/appsscript-bridge-read-test.mjs --http-only
 *
 * ENTORNO
 *   PP_APPS_SCRIPT_WEB_APP_URL   URL /exec de produccion (equivale a --url=). Si no se pasa, se
 *                                lee de site/index.html, que es donde el build deja la URL real.
 *
 * SALIDA
 *   Tabla por consola y artifacts/appsscript-bridge-read-<sello>.json. Codigo de salida: 0 = todo
 *   paso paso; 1 = hay fallos.
 */

import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const flag = (name, fallback = "") => {
  const hit = args.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = (name) => args.includes(`--${name}`);

const HEADED = has("headed");
const KEEP_OPEN = has("keep-open");
const HTTP_ONLY = has("http-only");
const READY_TIMEOUT_MS = Number(flag("timeout", "45000"));
const root = path.resolve(".");
const artifactsDir = path.join(root, "artifacts");
const clientPath = path.join(root, "src", "web", "shared", "apps-script-bridge-client.js");

const checks = [];
const calls = [];
let failures = 0;

/** Metodos que este test puede pedir. Todo lo demas se rechaza en la pagina, antes de salir. */
const READ_ONLY_METHODS = Object.freeze([
  "getDeploymentStatus",
  "getAppRevision",
  "getAppStateIfChanged",
  "listPlanSnapshots",
]);

function record(kind, name, detail, extra = {}) {
  const entry = { kind, name, detail, at: new Date().toISOString(), ...extra };
  checks.push(entry);
  if (kind === "fail") failures += 1;
  const mark = kind === "fail" ? "FALLA" : kind === "warn" ? "AVISO" : "ok";
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
  return entry;
}

function maskId(value) {
  const text = String(value || "");
  return text ? `${text.slice(0, 6)}…${text.slice(-4)}` : "(vacio)";
}

/** La URL del build es la fuente de verdad de a donde apunta el frontend. */
async function resolveUrl() {
  const explicit = flag("url") || process.env.PP_APPS_SCRIPT_WEB_APP_URL || "";
  if (explicit) return explicit;
  const siteIndex = path.join(root, "site", "index.html");
  if (existsSync(siteIndex)) {
    const source = await readFile(siteIndex, "utf8");
    const found = source.match(/DEFAULT_WEB_APP_URL\s*=\s*"([^"]+)"/);
    if (found) return found[1];
  }
  throw new Error("No se encontro la URL del backend. Pasa --url=... o ejecuta npm run build:pages (site/index.html la lleva embebida).");
}

async function readExpectations() {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const code = await readFile(path.join(root, "src", "server", "01-code.js"), "utf8");
  const schema = Number((code.match(/const PP_SCHEMA_VERSION = (\d+);/) || [])[1] || 0);
  const serverVersion = (code.match(/const PP_APP_VERSION = '([^']+)'/) || [])[1] || "";
  return { appVersion: String(pkg.version || ""), schemaVersion: schema, serverVersion };
}

/**
 * Apps Script NO sirve el HTML del puente tal cual: lo envuelve en
 * goog.script.init("...json...", ...) y dentro viaja userHtml con el codigo escapado. Por eso el
 * chequeo del origenallowed y de la lista de funciones desplegadas se hace sobre ese payload
 * parseado, no con una expresion regular sobre la respuesta cruda.
 */
function parseAppsScriptInit(html) {
  const marker = html.search(/goog\.script\.init\s*\(/);
  if (marker < 0) return null;
  const from = marker + html.slice(marker).indexOf("(") + 1;
  const start = html.indexOf('"', from);
  if (start < 0) return null;
  // Se recorre el literal respetando los escapes para encontrar su cierre: un \" no lo cierra.
  let end = start + 1;
  while (end < html.length) {
    const char = html[end];
    if (char === "\\") { end += 2; continue; }
    if (char === '"') break;
    end += 1;
  }
  if (end >= html.length) return null;
  const decoded = decodeJsStringLiteral(html.slice(start + 1, end));
  if (decoded === null) return null;
  try {
    return JSON.parse(decoded);
  } catch (error) {
    return { __parseError: String(error?.message || error) };
  }
}

/**
 * El literal que Apps Script pasa a goog.script.init es JavaScript, no JSON estricto: usa escapes
 * hexadecimales (\x7b), que JSON.parse rechaza. Se descodifica a mano en vez de pasar el texto
 * remoto por eval o Function: este test lee el despliegue, no lo ejecuta.
 */
function decodeJsStringLiteral(source) {
  let out = "";
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char !== "\\") { out += char; continue; }
    const next = source[i + 1];
    i += 1;
    switch (next) {
      case "n": out += "\n"; break;
      case "t": out += "\t"; break;
      case "r": out += "\r"; break;
      case "b": out += "\b"; break;
      case "f": out += "\f"; break;
      case "v": out += "\v"; break;
      case "0": out += "\0"; break;
      case "x": out += String.fromCharCode(parseInt(source.slice(i + 1, i + 3), 16)); i += 2; break;
      case "u": out += String.fromCharCode(parseInt(source.slice(i + 1, i + 5), 16)); i += 4; break;
      case undefined: out += "\\"; break;
      default: out += next; break;
    }
  }
  return out;
}

async function checkHttp(url) {
  const bridgeUrl = `${url}?app=bridge`;
  const started = Date.now();
  let response;
  let text;
  try {
    response = await fetch(bridgeUrl, { signal: AbortSignal.timeout(READY_TIMEOUT_MS) });
    text = await response.text();
  } catch (error) {
    return record("fail", "deploy.http", `sin salida a ${bridgeUrl} — ${String(error?.message || error)}`, { url: bridgeUrl });
    }
  const ms = Date.now() - started;
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) return record("fail", "deploy.http", `${response.status} ${text.slice(0, 160)}`, { url: bridgeUrl, status: response.status, ms });
  if (!contentType.includes("text/html")) return record("fail", "deploy.http", `content-type ${contentType}: se esperaba el HTML del puente`, { url: bridgeUrl, ms });

  const payload = parseAppsScriptInit(text);
  if (!payload) return record("fail", "deploy.http", "la respuesta no trae goog.script.init legible: no es una pagina de web app de Apps Script", { url: bridgeUrl, ms });
  if (payload.__parseError) return record("fail", "deploy.http", `el payload de goog.script.init no es JSON valido: ${payload.__parseError}`, { url: bridgeUrl, ms });
  const userHtml = String(payload.userHtml || "");
  if (!userHtml.includes("pp-appscript-bridge")) return record("fail", "deploy.http", "userHtml no es Bridge.html (falta el source del puente)", { url: bridgeUrl, ms });

  // ALLOWED_ORIGIN sale de FRONTEND_ORIGIN en Propiedades del script: si no esta resuelto, el
  // puente deniega el handshake y la app no conecta aunque el despliegue responda.
  const allowedOrigin = (userHtml.match(/const ALLOWED_ORIGIN = "([^"]*)";/) || [])[1] || "";
  if (!/^https?:\/\//.test(allowedOrigin)) return record("fail", "deploy.http", `ALLOWED_ORIGIN sin resolver: ${allowedOrigin || "(no encontrado)"}`, { url: bridgeUrl, ms, allowedOrigin });
  record("ok", "deploy.http", `${response.status} ${contentType} en ${ms} ms — ALLOWED_ORIGIN ${allowedOrigin}`, { url: bridgeUrl, status: response.status, ms, allowedOrigin });

  const deploymentId = String(payload.deploymentId || "");
  const urlDeployment = (url.match(/\/macros\/s\/([^/]+)\//) || [])[1] || "";
  record(!urlDeployment || !deploymentId || deploymentId === urlDeployment, "el deploymentId del HTML es el de la URL", deploymentId && urlDeployment ? `${deploymentId} vs ${urlDeployment}` : `solo se conoce uno (html ${deploymentId || "-"}, url ${urlDeployment || "-"})`, { deploymentId, urlDeployment });

  // Contrato del despliegue, leido del propio HTML: los metodos de lectura que este test pide
  // tienen que existir en la version desplegada, no solo en el repo.
  const functionNames = Array.isArray(payload.functionNames) ? payload.functionNames : [];
  const missing = READ_ONLY_METHODS.filter((method) => !functionNames.includes(method));
  record(missing.length === 0, "el despliegue expone los metodos de lectura que usa el test", missing.length ? `faltan en la version desplegada: ${missing.join(", ")} (de ${functionNames.length} funciones)` : `${READ_ONLY_METHODS.length}/${READ_ONLY_METHODS.length} presentes; ${functionNames.length} funciones desplegadas`, { missing, functionCount: functionNames.length });
  record("ok", "modo de sandbox del despliegue", String(payload.sandboxMode || "(sin dato)"), { sandboxMode: payload.sandboxMode });
  return { ms, allowedOrigin, deploymentId, functionNames };
}

/**
 * Pagina minima que carga el cliente REAL del puente. No se reimplementa el protocolo: si el
 * handshake se rompe en la app, este test se entera porque usa el mismo codigo.
 */
function buildPage(url, clientSource) {
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>Prueba de lectura del puente de Apps Script</title></head>
<body>
<script>
  window.__READ_ONLY__ = ${JSON.stringify(READ_ONLY_METHODS)};
  window.__CALLS__ = [];
  window.PP_APPS_SCRIPT_WEB_APP_URL = ${JSON.stringify(url)};
  window.addEventListener("message", (event) => {
    const message = event.data || {};
    if (message.type === "denied") window.__DENIED__ = message.error || "sin motivo";
  });
</script>
<script>${clientSource}</script>
<script>
  (function installGuardedBridge() {
    const bridge = window.PPAppsScriptBridge;
    const original = bridge.call.bind(bridge);
    bridge.call = async function (method, callArgs) {
      // Lista blanca: un metodo de escritura falla aqui, sin llegar al servidor.
      if (!window.__READ_ONLY__.includes(method)) {
        window.__CALLS__.push({ method, rejected: true });
        throw new Error("Metodo fuera de la lista blanca de lectura: " + method);
      }
      const started = Date.now();
      try {
        const result = await original(method, callArgs);
        window.__CALLS__.push({ method, ok: true, ms: Date.now() - started });
        return result;
      } catch (error) {
        window.__CALLS__.push({ method, ok: false, ms: Date.now() - started, error: String(error && error.message || error) });
        throw error;
      }
    };
    window.__rpc__ = (method, callArgs) => bridge.call(method, callArgs || []);
    window.__ready__ = bridge.ensureReady();
  })();
</script>
</body>
</html>`;
}

async function servePage(html) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function bridgeCall(page, method, callArgs) {
  return page.evaluate(([name, callArgsList]) => window.__rpc__(name, callArgsList), [method, callArgs]);
}

async function runBridgeChecks(page, expected) {
  const status = await bridgeCall(page, "getDeploymentStatus");
  record(status?.ok === true, "bridge.getDeploymentStatus", status?.ok === true
    ? `app ${status.appVersion} · schema ${status.schemaVersion} · hoja ${status.spreadsheetConfigured ? "si" : "no"} · NetSuite ${status.netSuiteConfigured ? "si" : "no"} · fotos ${status.photoFolderConfigured ? "si" : "no"}`
    : `respuesta inesperada: ${JSON.stringify(status).slice(0, 200)}`, { payload: status });
  if (status?.ok) {
    const sameApp = status.appVersion === expected.appVersion;
    record(sameApp, "version desplegada = package.json", `desplegado ${status.appVersion} vs package ${expected.appVersion} (mismo numero en tres lugares, RULE-WEB-003)`, { deployed: status.appVersion, expected: expected.appVersion });
    const sameSchema = Number(status.schemaVersion) === expected.schemaVersion;
    record(sameSchema, "schemaVersion desplegado = src/server/01-code.js", `${status.schemaVersion} vs ${expected.schemaVersion}`, { deployed: status.schemaVersion, expected: expected.schemaVersion });
    record(status.spreadsheetConfigured, "PLANNING_SPREADSHEET_ID configurado", status.spreadsheetConfigured ? maskId(status.spreadsheetId) : "falta la propiedad del script");
    record(status.netSuiteConfigured, "credenciales de NetSuite configuradas", String(status.netSuiteConfigured));
    record(status.photoFolderConfigured, "PHOTO_FOLDER_ID configurado", String(status.photoFolderConfigured));
    record("user" in status ? "ok" : "warn", "usuario de la sesion", status.user || "(vacio: el despliegue responde como anonimo; el frontend igual puede leer)");
  }

  const revision = await bridgeCall(page, "getAppRevision");
  const revisionOk = revision?.ok && Number.isFinite(Number(revision.revision)) && Number(revision.revision) > 0;
  record(revisionOk, "bridge.getAppRevision", revisionOk ? `revision ${revision.revision}, savedAt ${revision.savedAt || "(vacio)"}, source ${revision.source}` : `respuesta inesperada: ${JSON.stringify(revision).slice(0, 200)}`, { payload: revision });
  if (!revisionOk) return null;

  // Mismo codigo que el arranque, con la revision ya conocida: debe responder unchanged:true y
  // NO bajar el estado completo. Si aqui bajara el estado, el arranque de la app haria lo mismo.
  const unchanged = await bridgeCall(page, "getAppStateIfChanged", [Number(revision.revision)]);
  record(unchanged?.unchanged === true, "bridge.getAppStateIfChanged(revision) responde unchanged", unchanged?.unchanged === true
    ? `unchanged:true y revision ${unchanged.revision}: el arranque no baja el estado completo`
    : `llego ${JSON.stringify(unchanged).slice(0, 160)}`, { summary: { unchanged: unchanged?.unchanged, revision: unchanged?.revision }, note: "PP_ensureWorkbook_ normaliza hojas/encabezados de forma idempotente" });

  const snapshots = await bridgeCall(page, "listPlanSnapshots");
  const list = Array.isArray(snapshots?.snapshots) ? snapshots.snapshots : Array.isArray(snapshots) ? snapshots : null;
  record(Boolean(list), "bridge.listPlanSnapshots", list ? `${list.length} snapshot(s); ultimo ${JSON.stringify(list[list.length - 1] || {}).slice(0, 140)}` : `respuesta inesperada: ${JSON.stringify(snapshots).slice(0, 200)}`, { count: list ? list.length : null, last: list ? list[list.length - 1] || null : null, note: "PP_ensureWorkbook_ normaliza hojas/encabezados de forma idempotente" });
  return revision;
}

async function main() {
  const url = await resolveUrl();
  const expected = await readExpectations();
  const clientSource = await readFile(clientPath, "utf8");
  console.log(`Prueba de lectura de Apps Script: ${url}`);
  console.log(`Esperado en el repositorio: app ${expected.appVersion} (package.json) · schema ${expected.schemaVersion} (01-code.js)\n`);

  console.log("1. El despliegue responde por HTTP");
  const http = await checkHttp(url);
  if (HTTP_ONLY) {
    console.log(`\n${failures ? `${failures} fallo(s)` : "Sin fallos"} (--http-only: no se abrio navegador)`);
    // exitCode y no exit(): con sockets de fetch vivos, process.exit() en Windows revienta con
    // "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)".
    process.exitCode = failures ? 1 : 0;
    return;
  }

  console.log("\n2. El puente real en el navegador (lectura)");
  const html = buildPage(url, clientSource);
  const { server, origin } = await servePage(html);
  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error?.message || error)));

  try {
    await page.goto(`${origin}/index.html`, { waitUntil: "domcontentloaded", timeout: READY_TIMEOUT_MS });
    const handshake = await page.evaluate(async (ms) => {
      // Se espera el "ready" del puente con la misma espera del cliente real (30 s) y, si no
      // llega, se reporta el estado del iframe: lo mas comun es que el despliegue exija iniciar
      // sesion y entonces google.script.run no existe dentro del iframe.
      const outcome = await Promise.race([
        window.__ready__.then(() => "ready").catch((error) => `error:${String(error?.message || error)}`),
        new Promise((resolve) => setTimeout(() => resolve("timeout"), ms)),
      ]);
      const iframe = document.getElementById("ppAppsScriptBridge");
      return {
        outcome,
        denied: window.__DENIED__ || "",
        configured: window.PPAppsScriptBridge ? window.PPAppsScriptBridge.isConfigured() : false,
        hasNativeRuntime: window.PPAppsScriptBridge ? window.PPAppsScriptBridge.nativeRuntimeAvailable() : false,
        backendUrl: window.PPAppsScriptBridge ? window.PPAppsScriptBridge.getBackendUrl() : "",
        iframeSrc: iframe ? iframe.src : "(sin iframe)",
        iframeTitle: iframe && iframe.contentDocument ? iframe.contentDocument.title : "",
      };
    }, Math.min(READY_TIMEOUT_MS, 40000));
    console.log(`  puente: ${handshake.outcome}${handshake.denied ? ` · denegado: ${handshake.denied}` : ""} · iframe ${handshake.iframeSrc}${handshake.iframeTitle ? ` (${handshake.iframeTitle})` : ""}`);
    record(handshake.outcome === "ready", "handshake del puente", handshake.outcome === "ready" ? "el iframe de produccion respondio ready" : `${handshake.outcome}; iframe ${handshake.iframeSrc} titulo "${handshake.iframeTitle}"; si el despliegue pide iniciar sesion, el puente nunca queda listo`, handshake);

    if (handshake.outcome === "ready") await runBridgeChecks(page, expected);
    else record("fail", "lecturas por el puente", "no se hacen: sin handshake no hay forma de llamar al servidor", null);

    const trace = await page.evaluate(() => window.__CALLS__ || []);
    calls.push(...trace);
    const rejected = trace.filter((item) => item.rejected);
    const outside = trace.filter((item) => !READ_ONLY_METHODS.includes(item.method));
    record(rejected.length === 0 && outside.length === 0, "aislamiento: solo metodos de lectura", trace.length ? `invocados: ${trace.map((item) => `${item.method}(${item.ok === undefined ? "rechazado" : item.ok ? "ok" : "error"})`).join(", ")}` : "sin llamadas registradas", { trace });
    record(pageErrors.length === 0, "sin excepciones en la pagina", pageErrors.slice(0, 3).join(" | "), { pageErrors });
  } finally {
    if (!KEEP_OPEN) {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
      server.close();
    } else {
      console.log(`\n(--keep-open: la pagina queda en http://127.0.0.1 (${origin}); server en proceso, cerrar con Ctrl+C)`);
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await mkdir(artifactsDir, { recursive: true });
  const artifact = path.join(artifactsDir, `appsscript-bridge-read-${stamp}.json`);
  await writeFile(artifact, JSON.stringify({
    generatedAt: new Date().toISOString(),
    target: { url, allowedOrigin: http?.allowedOrigin || null },
    expected,
    summary: { total: checks.length, failures, passed: checks.length - failures },
    calls,
    checks,
  }, null, 2));

  console.log(`\n${failures ? `${failures} fallo(s)` : "Sin fallos"} · ${checks.length} comprobaciones`);
  console.log(`Reporte: ${path.relative(root, artifact)}`);
  process.exitCode = failures ? 1 : 0;
}

main().catch((error) => {
  console.error(`La prueba no pudo ejecutarse: ${String(error?.stack || error)}`);
  process.exitCode = 1;
});
