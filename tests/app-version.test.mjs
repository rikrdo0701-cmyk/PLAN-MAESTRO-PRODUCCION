import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * RULE-WEB-003: la version de la app vive en TRES lugares y nada los mantienia conectados:
 *   - PP_APP_VERSION en src/server/01-code.js, que es la que responde getDeploymentStatus y
 *     la que se graba en la hoja; es la que de verdad importa.
 *   - version en package.json, que solo leen npm y el CI.
 *   - el v= del iframe puente en apps-script-bridge-client.js, que NO lee nadie: es
 *     cache-busting, porque PP_isBridgeRequest_ solo mira app=bridge.
 *
 * El 2026-09-26 se vio en produccion getDeploymentStatus contestando 2.43.0 mientras
 * package.json decia 2.41.1, y se comprobo con git que el 2.41.1 NUNCA estuvo en el
 * servidor: 2.43.0 llego en 9103c17 y el 2.41.1 de la v= lo escribio a mano 50e8b5f. No
 * era un backend adelantado, eran tres numeros sueltos.
 *
 * Esta prueba es la que evita que vuelvan a separarse: es mas barata que el diagnostico.
 */

const RAIZ = fileURLToPath(new URL("../", import.meta.url));

test("las tres versiones coinciden", async () => {
  const pkg = JSON.parse(await readFile(path.join(RAIZ, "package.json"), "utf8"));
  const server = await readFile(path.join(RAIZ, "src", "server", "01-code.js"), "utf8");
  const puente = await readFile(path.join(RAIZ, "src", "web", "shared", "apps-script-bridge-client.js"), "utf8");

  const delServer = server.match(/^const PP_APP_VERSION = '([^']+)';/m);
  assert.ok(delServer, "no se encontro PP_APP_VERSION en src/server/01-code.js");
  const deLaV = puente.match(/searchParams\.set\("v", "([^"]+)"\)/);

  assert.equal(
    pkg.version,
    delServer[1],
    `package.json dice ${pkg.version} y PP_APP_VERSION dice ${delServer[1]}`,
  );
  if (deLaV) {
    assert.equal(
      deLaV[1],
      delServer[1],
      `el v= del puente dice ${deLaV[1]} y PP_APP_VERSION dice ${delServer[1]}`,
    );
  }
});

test("la v= del puente es solo cache-busting y el servidor no la lee", async () => {
  const puente = await readFile(path.join(RAIZ, "src", "web", "shared", "apps-script-bridge-client.js"), "utf8");
  const puenteServidor = await readFile(path.join(RAIZ, "src", "server", "14-pages-bridge.js"), "utf8");

  // El cliente la manda; el servidor tiene que seguir decidiendo solo por app=bridge.
  assert.match(puente, /searchParams\.set\("app", "bridge"\)/);
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
