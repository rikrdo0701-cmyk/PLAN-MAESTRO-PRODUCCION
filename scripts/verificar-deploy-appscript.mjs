#!/usr/bin/env node
/**
 * Comprueba que lo que hay en Apps Script es lo que dice dist/.
 *
 * POR QUE EXISTE. MEDIDO 2026-09-29: dos despliegues seguidos dijeron "Pushed 26
 * files" y el archivo aparecio listado, y sin embargo el proyecto seguia con
 * la version anterior: 13620 bytes en el remoto contra 14563 en dist/, y la
 * constante RESTLET_URL no estaba. La ingesta moria con "RESTLET_URL is not
 * defined" y el pipeline entero en verde.
 *
 * LO QUE NO ALCANZA A VER ESTO. Antes se comprobaba que `ingesta` apareciera en
 * la lista de funciones desplegadas, y eso es cierto en los dos casos: el bug no
 * cambia ningun nombre, cambia el CUERPO de la funcion. La lista de funciones
 * solo dice que hay una puerta, no que Detras haya algo. Por eso lo que se compara
 * aqui es el contenido, archivo por archivo.
 *
 * QUE ES FALSO Y POR QUE SE ACEPTA. clasp push decide que archivos subir
 * comparando el archivo local contra el remoto, asi que en teoria no anuncia
 * nada que no haya subido. Esa teoria no se cumplio el 2026-09-29 y no se sabe
 * por que: el commit llevaba el arreglo, el build lo genero y el log lo listo
 * como subido. Un chequeo que da verde sobre un 'segun el log' no es un chequeo.
 * Este lee el proyecto de verdad y compara.
 *
 * QUE MIDE, Y QUE NO. Compara byte a byte, ignorando los finales de linea, cada
 * archivo de dist/ contra su gemelo remoto. Tambien avisa de archivos que estan
 * en el proyecto y no en dist/, que no son un error (config.js lo pego el
 * usuario) pero pueden pisar en silencio lo que el pipeline publico: en Apps
 * Script una funcion repetida gana la ultima que carga, sin error ni aviso.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(RAIZ, "dist");
const TEMPORAL = path.join(RAIZ, ".clasp-verificar");

/** El proyecto remoto no guarda el origen con los mismos finales de linea. */
const normalizar = (s) => s.replace(/\r\n/g, "\n");

const claspPath = path.join(RAIZ, ".clasp.json");
if (!existsSync(claspPath) || !existsSync(DIST)) {
  console.log("[verificar-deploy] no hay .clasp.json o dist/: no es un despliegue, se sale");
  process.exit(0);
}
const claspJson = JSON.parse(readFileSync(claspPath, "utf8"));
if (/^AKfy/.test(claspJson.scriptId || "")) {
  console.log("[verificar-deploy] .clasp.json trae un deploymentId, no un scriptId: se sale");
  process.exit(0);
}

rmSync(TEMPORAL, { recursive: true, force: true });
mkdirSync(TEMPORAL, { recursive: true });
writeFileSync(path.join(TEMPORAL, ".clasp.json"), JSON.stringify({ ...claspJson, rootDir: "." }, null, 2));
const r = spawnSync("npx", ["--yes", "@google/clasp", "pull", "--force"], {
  cwd: TEMPORAL,
  encoding: "utf8",
  shell: process.platform === "win32",
});
if (r.status !== 0) {
  // Fallo a comprobar NO es fallo del despliegue: clasp push ya habia Reported
  // bien. Se avisa y se sale con 0 para no tumbar un despliegue correcto por una
  // comprobacion que no se pudo hacer. Lo que no se hace es dar verde.
  console.log(`[verificar-deploy] clasp pull fallo (${r.status}): ${String(r.stderr || r.stdout || "").trim().slice(0, 200)}`);
  console.log("[verificar-deploy] SIN VERIFICAR: no se puede decir que el despliegue quedo bien");
  rmSync(TEMPORAL, { recursive: true, force: true });
  process.exit(0);
}

const remotos = readdirSync(TEMPORAL).filter((n) => n !== ".clasp.json");
const dist = readdirSync(DIST);
const distintos = [];
const faltan = [];
for (const n of dist) {
  const rp = path.join(TEMPORAL, n);
  if (!existsSync(rp)) { faltan.push(n); continue; }
  const a = normalizar(readFileSync(path.join(DIST, n), "utf8"));
  const b = normalizar(readFileSync(rp, "utf8"));
  if (a !== b) {
    const la = a.split("\n");
    const lb = b.split("\n");
    let i = 0;
    while (i < la.length && la[i] === lb[i]) i += 1;
    distintos.push({ n, dist: Buffer.byteLength(a), remoto: Buffer.byteLength(b), linea: i + 1 });
  }
}
const extras = remotos.filter((n) => !dist.includes(n));

console.log(`[verificar-deploy] ${dist.length} archivos en dist/ | ${remotos.length} en el proyecto`);
if (!faltan.length && !distintos.length) {
  console.log("[verificar-deploy] CONTENIDO: los " + dist.length + " archivos coinciden byte a byte con dist/");
} else {
  if (faltan.length) console.log(`[verificar-deploy] FALTAN en el proyecto: ${faltan.join(", ")}`);
  for (const d of distintos) {
    console.log(`[verificar-deploy] DISTINTO ${d.n}: dist/ ${d.dist} bytes, remoto ${d.remoto} bytes; primera diferencia en la linea ${d.linea}`);
  }
}
if (extras.length) {
  console.log(`[verificar-deploy] en el proyecto y NO en dist/ (pueden pisar en silencio): ${extras.join(", ")}`);
}
rmSync(TEMPORAL, { recursive: true, force: true });

if (faltan.length || distintos.length) {
  console.log("[verificar-deploy] VEREDICTO: el despliegue NO esta al dia con el repo");
  process.exit(1);
}
console.log("[verificar-deploy] VEREDICTO: despliegue verificado contra dist/");
