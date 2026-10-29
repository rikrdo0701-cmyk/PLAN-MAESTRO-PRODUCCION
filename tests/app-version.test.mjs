import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * RULE-WEB-003: la version de la app vivia en TRES lugares y nada los mantienia conectados:
 *   - PP_APP_VERSION en src/server/01-code.js, que es la que responde getDeploymentStatus y
 *     la que se graba en la hoja; es la que de verdad importa.
 *   - version en package.json, que solo leen npm y el CI.
 *   - el v= del iframe puente en apps-script-bridge-client.js, que NO leia nadie: era
 *     cache-busting, porque PP_isBridgeRequest_ solo mira app=bridge.
 *
 * El 2026-09-26 se vio en produccion getDeploymentStatus contestando 2.43.0 mientras
 * package.json decia 2.41.1, y se comprobo con git que el 2.41.1 NUNCA estuvo en el
 * servidor: 2.43.0 llego en 9103c17 y el 2.41.1 de la v= lo escribio a mano 50e8b5f. No
 * era un backend adelantado, eran tres numeros sueltos.
 *
 * MEDIDO 2026-09-30: el puente quedo deshabilitado (RULE-SUP-030) y con el desaparecio el
 * iframe, asi que la v= de cache-busting se fue con el. Quedan DOS lugares, no tres, y la
 * regla baja a dos. Lo que NO se pierde es lo que la reglaprotected: que esos dos tienen que
 * coincidir, y que el servidor del web app no debe empezar a leer una v= que nadie le manda.
 * Por eso la segunda prueba ya no afirma que el cliente la mande, sino que el servidor
 * siga decidiendo solo por app=bridge.
 */
const RAIZ = fileURLToPath(new URL("../", import.meta.url));

test("las dos versiones que quedan coinciden", async () => {
  const pkg = JSON.parse(await readFile(path.join(RAIZ, "package.json"), "utf8"));
  const server = await readFile(path.join(RAIZ, "src", "server", "01-code.js"), "utf8");

  const delServer = server.match(/^const PP_APP_VERSION = '([^']+)';/m);
  assert.ok(delServer, "no se encontro PP_APP_VERSION en src/server/01-code.js");

  assert.equal(
    pkg.version,
    delServer[1],
    `package.json dice ${pkg.version} y PP_APP_VERSION dice ${delServer[1]}`,
  );

  // Y el tercer lugar no debe volver a aparecer sin que la regla se actualice: si alguien
  // reintroduce una v= escrita a mano, el incidente del 2026-09-26 se repite, y ademas
  // seria un puente de vuelta sin decirlo.
  const puente = await readFile(path.join(RAIZ, "src", "web", "shared", "apps-script-bridge-client.js"), "utf8");
  assert.doesNotMatch(puente, /searchParams\.set\("v"/, "la v= de cache-busting se fue con el iframe del puente");
});

test("el servidor del web app sigue decidiendo solo por app=bridge, y no por una v=", async () => {
  const puenteServidor = await readFile(path.join(RAIZ, "src", "server", "14-pages-bridge.js"), "utf8");

  // El lado de Apps Script sigue desplegado; lo que quito la app es dejar de llamarlo. Asi
  // que la compuerta del servidor se queda, porque es lo que evita que una visita normal
  // de la pagina del web app se interprete como una peticion del puente.
  assert.match(puenteServidor, /parameter\.app[\s\S]{0,80}===\s*'bridge'/);
  assert.doesNotMatch(
    puenteServidor,
    /parameter\.v|get\("v"\)/,
    "el servidor no debe empezar a leer la v= sin querer: es cache-busting del cliente",
  );
});

test("el build no reescribe la v=, solo la URL del backend", async () => {
  const build = await readFile(path.join(RAIZ, "scripts", "build-appscript.mjs"), "utf8");
  assert.match(build, /__PP_APPS_SCRIPT_WEB_APP_URL__/, "el build debe seguir reemplazando la URL");
  assert.doesNotMatch(
    build,
    /searchParams\.set\("v"/,
    "el build no debe tocar la v=: si la tocara, la version de package.json seria la que manda y el fuente mentiria",
  );
});
