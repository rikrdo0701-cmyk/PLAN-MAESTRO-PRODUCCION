#!/usr/bin/env node
/**
 * Preserva los archivos que el pipeline no publica.
 *
 * QUE HACE Y POR QUE HACE FALTA. MEDIDO 2026-09-29: el usuario pego a mano
 * config.js con la service role key de Supabase. El siguiente despliegue se la
 * llevo: el proyecto paso de 27 archivos a 26 y config.js desaparecio. La
 * ingesta, que antes decia "Config OK", iba a morir con SUPABASE_KEY no definida.
 *
 * POR QUE. clasp push NO actualiza archivo por archivo. Leyendo su codigo
 * (src/core/files.ts:616), push junta la lista de archivos locales y llama a
 * script.projects.updateContent con esa lista, que es una sustitucion del
 * PROYECTO ENTERO: lo que no esta en la lista, no existe despues. No hay
 * delete ni removeFile en push.ts porque no hace falta: la API borra por
 * ausencia. Por eso este archivo existe, y por eso antes decia (mal) que un
 * archivo pegado a mano sobrevivia a los despliegues.
 *
 * QUE PROBLEMA HUBO ADEMAS. La primera version de este script buscaba un
 * archivo llamado supabase-config.gs, el nombre que estaba en el repo, y el
 * usuario lo habia llamado config.js. Con eso el paso no preservo nada: reporto
 * "el remoto NO tiene supabase-config.gs" mientras la clave estaba ahi, y el
 * despliegue siguiente la borro. UnNombre es un detalle; el archivo es el que
 * importa. Ahora se preserva por CONTENIDO: cualquier archivo del proyecto que
 * no venga de dist/ se copia de vuelta antes del push, se sea cual sea su
 * nombre, y se avisa de cada uno.
 *
 * QUE NO HACE, A PROPOSITO. No adivina si un archivo sobra. Copiar de vuelta un
 * archivo que ya no se quiere es un annoyance; borrarlo sin que nadie lo pida es
 * perder trabajo. Se preserva todo y se dice, que la decision es de quien
 * entiende el proyecto.
 *
 * POR QUE SE PUEDE SEGUIR ADELANTE SI FALLA. El unico modo de perder un archivo
 * es subir una version distinta de la que esta ahi, y este script nunca tiene una
 * version distinta que subir: si no consigue bajar el remoto, dist/ se queda SIN
 * el archivo y el push lo borra del proyecto. Por eso aqui, si la lectura falla,
 * se BLOQUEA el despliegue en vez de avisar y continuar. Antes hacia lo
 * contrario, y por el camino borro la clave: un fallo transitorio de la API
 * habria dejado dist/ sin el archivo y el push siguiente lo eliminaba. Cortar el
 * despliegue es mas molesto que perder un archivo, y no se pierde nada.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// MEDIDO 2026-09-30: los tests de la supervivencia (tests/supabase-config-supervivencia) tienen
// que tocar el dist/ REAL, y por eso lo snapshoteaban y lo restauraban. Con la maquina ocupada
// esa restauracion se cruzaba con la corrida y el test daba rojo sin que hubiera cambio:
// un test que a veces falla por el reloj entrena a ignorar el rojo. Este es otro gancho de
// PRUEBA, igual que PRESERVE_CONFIG_REMOTO_DIR mas abajo, y ningun workflow lo usa: en
// produccion DIST sigue siendo dist/.
const DIST = process.env.PRESERVE_CONFIG_DIST_DIR
  ? path.resolve(process.env.PRESERVE_CONFIG_DIST_DIR)
  : path.join(RAIZ, "dist");
const TEMPORAL = path.join(RAIZ, ".clasp-preserve");

const limpiarTemporal = () => rmSync(TEMPORAL, { recursive: true, force: true });
process.on("exit", limpiarTemporal);

const avisar = (m) => console.log(`[preserve-config] ${m}`);

/**
 * Un archivo es de credenciales si declara los valores que la ingesta lee. Se
 * busca por CONTENIDO y no por nombre a proposito: el archivo del proyecto se
 * llama config.js, no supabase-config.gs, y buscarlo por su nombre fue
 * exactamente el fallo que borro la clave.
 */
function esDeCredenciales(texto) {
  return /\bSUPABASE_(URL|KEY)\b/.test(texto) || /\bUBICACION\b/.test(texto);
}

/** Que valores del archivo siguen sin rellenar, sin imprimir ninguno. */
function diagnostico(texto) {
  const faltan = [];
  if (!/const\s+SUPABASE_URL\s*=\s*'https:\/\/[^']+'/s.test(texto)) faltan.push("SUPABASE_URL");
  const clave = (texto.match(/const\s+SUPABASE_KEY\s*=\s*'([^']*)'/s) || [])[1];
  if (!clave) faltan.push("SUPABASE_KEY (no esta declarado)");
  else if (/^TU_|PLACEHOLDER|^<|^xxx/i.test(clave)) faltan.push("SUPABASE_KEY sigue con el valor de ejemplo");
  if (!/const\s+UBICACION\s*=/s.test(texto)) faltan.push("UBICACION");
  return faltan;
}

/** Baja el proyecto entero. clasp pull no acepta un archivo suelto. */
function bajar(claspJson) {
  // Gancho de prueba. El camino de 'el proyecto tiene archivos que dist/ no tiene'
  // SI se puede ejercitar sin credenciales, passandole un directorio que haga de
  // remoto. El de 'el remoto no se puede leer' tambien, con un directorio que no
  // exista. Ningun workflow lo usa: si lo usara, el pipeline subiria lo que
  // marque la variable en vez de lo que hay en el proyecto de verdad, que es
  // justamente el borrado que este script existe para que no pase.
  if (process.env.PRESERVE_CONFIG_REMOTO_DIR) {
    const dir = path.resolve(process.env.PRESERVE_CONFIG_REMOTO_DIR);
    if (!existsSync(dir)) return { estado: 'fallo', motivo: 'PRESERVE_CONFIG_REMOTO_DIR no existe: ' + dir };
    const archivos = readdirSync(dir).filter((n) => n !== '.clasp.json');
    return { estado: 'ok', archivos, leer: (n) => readFileSync(path.join(dir, n), 'utf8') };
  }
  rmSync(TEMPORAL, { recursive: true, force: true });
  mkdirSync(TEMPORAL, { recursive: true });
  writeFileSync(path.join(TEMPORAL, ".clasp.json"), JSON.stringify({ ...claspJson, rootDir: "." }, null, 2));
  const r = spawnSync("npx", ["--yes", "@google/clasp", "pull", "--force"], {
    cwd: TEMPORAL,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) return { estado: "fallo", motivo: `clasp pull fallo (${r.status}): ${String(r.stderr || r.stdout || "").trim().slice(0, 250)}` };
  const archivos = readdirSync(TEMPORAL).filter((n) => n !== ".clasp.json");
  return { estado: "ok", archivos, leer: (n) => readFileSync(path.join(TEMPORAL, n), "utf8") };
}

// --- Reglas de salida. Nada de esto se puede saltar por accidente.
if (!existsSync(path.join(RAIZ, ".clasp.json"))) {
  avisar("no hay .clasp.json: no es un despliegue, se sale");
  process.exit(0);
}
const claspJson = JSON.parse(readFileSync(path.join(RAIZ, ".clasp.json"), "utf8"));
if (/^AKfy/.test(claspJson.scriptId || "")) {
  avisar(".clasp.json trae un deploymentId en vez de un scriptId: se sale");
  process.exit(0);
}
if (!existsSync(DIST)) {
  console.error("[preserve-config] no hay dist/: se ejecuta despues del build. CORTO el despliegue para no borrar archivos.");
  process.exit(1);
}

const r = bajar(claspJson);
if (r.estado === "fallo") {
  // Bloquea, no avisa: el push siguiente borraria lo que hay en el proyecto y no
  // hay copia en dist/ de donde recuperarlo. Ver la cabecera del archivo.
  console.error(`[preserve-config] ${r.motivo}`);
  console.error("[preserve-config] CORTO el despliegue: sin copia del remoto no se puede saber que hay que preservar.");
  process.exit(1);
}

const enDist = new Set(readdirSync(DIST));
const extras = r.archivos.filter((n) => !enDist.has(n));
if (!extras.length) {
  avisar(`el proyecto tiene los mismos ${enDist.size} archivos que dist/: nada que preservar`);
  process.exit(0);
}

let conCredenciales = 0;
for (const n of extras) {
  const texto = r.leer(n);
  writeFileSync(path.join(DIST, n), texto, "utf8");
  const cred = esDeCredenciales(texto);
  if (cred) conCredenciales += 1;
  avisar(`preservado ${n}: NO viene de dist/ y clasp push borra del proyecto lo que no sube (updateContent reemplaza el proyecto entero). ${cred ? "Declara credenciales de Supabase." : ""}`);
  if (cred) {
    const faltan = diagnostico(texto);
    if (faltan.length) avisar(`  AVISO: ${n} tiene sin rellenar -> ${faltan.join(", ")}. ingesta() lo dira con ese mismo texto`);
  }
}
avisar(`${extras.length} archivo(s) de ${conCredenciales} con credenciales reenviados en este despliegue`);
process.exit(0);
