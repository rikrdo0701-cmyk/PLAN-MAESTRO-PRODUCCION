// UN deployment por proyecto, y que todos los caminos desplieguen AL MISMO.
//
// MEDIDO 2026-10-02, Y POR QUE ESTAS PRUEBAS EXISTEN. `clasp deploy` sin `--deploymentId` NO
// actualiza el deployment que esta sirviendo: abre uno NUEVO y devuelve otro identificador. Tres
// corridas seguidas de `npm run deploy` sin el flag dejaron la version buena sirviendo en @494 y
// creando @493, @496 y @497 al mismo tiempo: tres endpoints publicos que no estan en ninguna parte
// del repo y a los que nadie apunta. La pagina seguia viendo la version vieja, porque la URL que
// usa esta horneada en el bundle, y el bundle no se enteraba de nada.
//
// El identificador estaba escrito en TRES lugares —scripts/build-appscript.mjs, el paso
// "Actualizar implementacion web" del workflow, y (fuera del repo) el panel de Apps Script— sin que
// ninguna prueba los comparara. Estas pruebas hacen esa comparacion y la dejan impossible de
// saltar por accidente.
//
// LO QUE NO SE COMPRUEBA AQUI. Que el deployment exista, ni que la version servida sea la del
// codigo: eso es `scripts/verificar-deploy-appscript.mjs` y la corrida del pipeline.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const leer = (p) => readFile(new URL("../" + p, import.meta.url), "utf8").then((s) => s.replace(/\r\n/g, "\n"));

const clasp = JSON.parse(await leer(".clasp.json"));
const workflow = await leer(".github/workflows/deploy-appscript.yml");
const build = await leer("scripts/build-appscript.mjs");
const deploy = await leer("scripts/deploy-appsscript.mjs");
const pkg = JSON.parse(await leer("package.json"));

const ID = clasp.deploymentId;

test(".clasp.json declara el deployment, y es un deployment y no el script", () => {
  assert.ok(ID, ".clasp.json tiene que traer deploymentId: es la fuente unica de a donde se despliega");
  assert.match(ID, /^AKfy/, "un deployment de Apps Script empieza con AKfy");
  assert.notEqual(ID, clasp.scriptId,
    "scriptId y deploymentId NO pueden ser lo mismo: se desplegaria al proyecto y no a la web");
});

test("el build NO escribe la URL del deployment: la lee de .clasp.json", () => {
  // MEDIDO: la URL estaba literal en el build. Con eso, cambiar el deployment en un lado dejaba
  // el bundle apuntando al viejo sin avisar, y el unico sintoma era que los arreglos no llegaban.
  assert.doesNotMatch(build, /script\.google\.com\/macros\/s\/AKfy/,
    "la URL no puede estar escrita en el build: se arma con claspConfig.deploymentId");
  assert.match(build, /claspConfig\.deploymentId/,
    "y tiene que salir de .clasp.json");
  assert.match(build, /if \(!claspConfig\.deploymentId\)[\s\S]{0,200}throw new Error/,
    "y si falta el campo el build tiene que FALLAR, no hornear una URL vacia");
});

test("npm run deploy pasa el deploymentId de .clasp.json y comprueba donde termino", () => {
  // MEDIDO: clasp 3.3.0 IGNORA el campo deploymentId de .clasp.json (probado: con el campo
  // puesto sigue abriendo deployments nuevos), asi que el identificador hay que pasarlo en la linea
  // de comandos. Por eso esto no puede ser un `clasp deploy` a pelo.
  assert.match(pkg.scripts.deploy, /scripts\/deploy-appsscript\.mjs/);
  assert.doesNotMatch(pkg.scripts.deploy, /clasp deploy\b(?! --)/,
    "`npm run deploy` no puede terminar en un `clasp deploy` pelado: abre un deployment nuevo");
  assert.match(deploy, /--deploymentId/);
  assert.match(deploy, /config\.deploymentId/,
    "y el identificador sale de .clasp.json, no de un argumento ni de una constante");
  assert.match(deploy, /if \(!deploymentId\)[\s\S]{0,600}process\.exit\(1\)/,
    "si falta el campo, se detiene: desplegar sin saber a donde es peor que no desplegar");
  assert.match(deploy, /deploymentId === config\.scriptId[\s\S]{0,300}process\.exit\(1\)/,
    "y si deploymentId y scriptId son el mismo valor, tambien se detiene: uno de los dos esta mal");
  // Elaste de seguridad que ya senico: clasp podria ignorar el flag y abrir otro. Por eso se lee
  // lo que clasp IMPRIMIO y se compara con lo pedido, en vez de confiar en que lo honro.
  assert.match(deploy, /linea\.match\(\/Deployed/,
    "hay que LEER el identificador que imprime clasp");
  assert.match(deploy, /impreso\[1\] !== deploymentId/,
    "y compararlo con el que se pidio: si no son el mismo, es un deployment NUEVO y sale en rojo");
});

test("el workflow lee el MISMO deployment de .clasp.json, no uno escrito a mano", () => {
  assert.doesNotMatch(workflow, /AKfy\w{20,}/,
    "el identificador no puede estar escrito en el workflow: si cambia en un lado, el push a main y npm run deploy despliegan a Lugares distintos");
  assert.match(workflow, /require\('\.\/\.clasp\.json'\)\.deploymentId/,
    "el workflow lo lee de .clasp.json, igual que el build y que el deploy local");
  assert.match(workflow, /steps\.destino\.outputs\.deployment_id/,
    "y lo pasa como --deploymentId");
  assert.match(workflow, /id: destino[\s\S]{0,900}steps\.destino/,
    "OJO CON EL ORDEN: el paso que LEE el destino tiene que estar antes del que lo USA, porque en GitHub Actions `steps.x` no existe hasta que x corrio. Si se invierten, ${{ steps.destino.outputs.deployment_id }} llega vacio y el deploy se cae");
});

test("CLASP_JSON no se lleva por delante el deploymentId al sobrescribir .clasp.json", () => {
  // MEDIDO 2026-10-02, y lo que rompio DE VERDAD. El paso "Configurar clasp" escribe el secreto
  // CLASP_JSON encima de .clasp.json, a proposito: el scriptId no puede cambiarse desde el repo y
  // por eso se valida contra EXPECTED_SCRIPT_ID. Ese overwrite se lleva el deploymentId, que es
  // lo unico que el repo aporta ahi, y el pipeline se cayo en el guard de "no trae deploymentId"
  // SIN DESPLEGAR NADA. El sintoma es el peor de los posibles en un despliegue: no falla el codigo,
  // falla el despliegue, y el log culpa a un campo que en el repo si estaba.
  //
  // Por eso el valor se lee ANTES del printf y se vuelve a poner despues. Si alguien quita el
  // REPO_DEPLOYMENT_ID, esta prueba se pone roja.
  const desde = workflow.indexOf("~/.clasprc.json");
  const paso = workflow.slice(desde, workflow.indexOf("\n", workflow.indexOf("REPO_DEPLOYMENT_ID", desde)) + 1);
  assert.match(paso, /repo_deployment_id=\$\(node -p "require\('\.\/\.clasp\.json'\)\.deploymentId/,
    "el deploymentId del repo se lee ANTES de que el secreto sobrescriba el archivo");
  assert.match(paso, /printf '%s' "\$CLASP_JSON" > \.clasp\.json/,
    "y el secreto se escribe DESPUES de leerlo, que es el orden que hace que sirva de algo");
  assert.match(paso, /config\.deploymentId = process\.env\.REPO_DEPLOYMENT_ID/,
    "y se vuelve a poner en el archivo ya sobrescrito: sin esto el pipeline se queda sin deployment");
  assert.match(paso, /if \(process\.env\.REPO_DEPLOYMENT_ID\)/,
    "con guarda: si el repo no trae el campo, se respeta el del secreto en vez de inventar uno");
});