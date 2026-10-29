/**
 * Despliega una VERSION NUEVA del deployment que ya existe. No crea uno nuevo.
 *
 * POR QUE ESTE ARCHIVO EXISTE, MEDIDO 2026-10-02. `clasp deploy` sin `--deploymentId` NO actualiza
 * el deployment que esta sirviendo: abre uno NUEVO y devuelve un identificador distinto. En una
 * corrida sola casi no se nota, pero la diferencia importa porque la pagina no llama al
 * deployment nuevo: la URL horneada en el bundle (scripts/build-appscript.mjs) y la del boton
 * Sincronizar son SIEMPRE la misma, la del deployment canonico. O sea que un `npm run deploy` mal
 * hecho sube el codigo, dice "Deployed" y no cambia nada de lo que la gente ve. MEDIDO: dos
 * corridas seguidas de `npm run deploy` dejaron 2.51.0 sirviendo en @494 y creando @493, @496 y
 * @497 al mismo tiempo, tres endpoints publicos que no estan en ningun lado del repo.
 *
 * clasp 3.3.0 ignora el campo `deploymentId` de .clasp.json (MEDIDO: con el campo puesto sigue
 * abriendo deployments nuevos), asi que el identificador hay que pasarlo en la linea de comandos.
 *
 * DE DONDE SALE EL IDENTIFICADOR. De `.clasp.json`, que es la fuente unica, y de la que tambien
 * lo lee el workflow. Si los dos caminos no leen el mismo archivo, uno de los dos despliega a
 * otro sitio, que es exactamente el defecto que este archivo evita. El build lee el mismo campo
 * para hornear la URL, asi que hoy hay una sola copia del identificador en el repo.
 * `tests/deploy-target.test.mjs` lo vigila comparando los tres caminos que lo consumen.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(".clasp.json", "utf8"));
const deploymentId = config.deploymentId;

// Fallar aqui es el punto. Un `clasp deploy` sin objetivo creeria algo nuevo en silencio y el
// que avisara seria el usuario, dias despues, cuando la pagina no cambie.
if (!deploymentId) {
  console.error("[deploy] .clasp.json no trae deploymentId: no se sabe a que deployment pertenece este codigo.");
  console.error("[deploy] Sin ese campo, clasp deploy abre uno NUEVO y el que se sigue viendo no cambia.");
  process.exit(1);
}
if (deploymentId === config.scriptId) {
  console.error("[deploy] .clasp.json tiene el mismo valor en scriptId y en deploymentId: uno de los dos esta mal.");
  process.exit(1);
}

const descripcion = process.argv[2] || "local";
const args = ["deploy", "--deploymentId", deploymentId, "--description", descripcion];

console.log(`[deploy] objetivo ${deploymentId} (leido de .clasp.json)`);
const r = spawnSync("clasp", args, { stdio: "inherit", shell: true });

if (r.status !== 0) process.exit(r.status || 1);

// MEDIDO: `clasp deploy` devuelve "Deployed <otro-id> @N". Si el identificador que imprime no es
// el que le pedimos, se desplego a otra parte y el paso no puede pasar por bueno: asi se caza el
// caso en el que clasp ignores el --deploymentId en vez de confiar en que lo honro.
const linea = String(r.stdout || "") + String(r.stderr || "");
const impreso = linea.match(/Deployed\s+(AKfy\w+)/);
if (impreso && impreso[1] !== deploymentId) {
  console.error(`[deploy] clasp desplego a ${impreso[1]} y se le habia pedido ${deploymentId}.`);
  console.error("[deploy] Eso significa que se creo un deployment NUEVO; el que usa la pagina no cambio.");
  process.exit(1);
}
console.log(`[deploy] ok: ${deploymentId} actualizado`);