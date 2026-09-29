#!/usr/bin/env node
/**
 * Preserva supabase-config.gs a traves de los despliegues.
 *
 * QUE HACE. La service role key de Supabase vive en un archivo del PROYECTO de
 * Apps Script, no en el repo: en el repo acabaria publicada por GitHub Pages y
 * el CI la subiria en cada push. Ese archivo no esta en src/server/ a proposito
 * (src/server/ se copia entero a dist/, y dist/ es lo que sube el workflow).
 *
 * MEDIDO 2026-09-29, leyendo el codigo de clasp: `clasp push --force` NO borra
 * del remoto los archivos que no estan en el directorio local. push.ts solo
 * llama a files.getChangedFiles() y sube lo que cambia; --force significa
 * "sobrescribe el manifiesto", no "borra lo que no veo". Tampoco hay delete ni
 * removeContent en todo el archivo. O sea que un archivo pegado a mano en el
 * editor sobrevive a los despliegues por si solo.
 *
 * AUN ASI, esto lo deja gestionado de verdad. Antes, la clave era un archivo
 * suelto: nadie lo respaldaba, y un `clasp clean`, un cambio de proyecto o que
 * alguien lo metiera en src/server/ por error la perdian sin aviso. Con este
 * paso, cada despliegue se baja la version REMOTA del archivo y la vuelve a
 * subir, asi que el pipeline se vuelve el dueno del archivo y la clave ya no
 * depende de que nadie la toque.
 *
 * POR QUE SE PUEDE SEGUIR ADELANTE SI FALLA (y por que no es peligro).
 * El unico modo de perder el archivo es subir una version distinta de el, y este
 * script nunca tiene una version distinta que subir: si no consegue bajarlo,
 * dist/ se queda SIN el archivo, y push no borra lo que no ve, o sea que el
 * remoto sigue intacto. Por eso aqui se avisa y se sigue, en vez de tumbar el
 * despliegue por un archivo que no corre riesgo.
 *
 * EL PLACEHOLDER NUNCA SE SUBE. No existe ninguna plantilla con
 * TU_SERVICE_ROLE_KEY en src/ ni en dist/: si existiera, un fallo de la API de
 * Google en el paso de aqui seria justo el que la machaca. El archivo remoto
 * es la unica fuente, y si aun no existe, el primer despliegue lo deja como
 * estaba y avisa de que falta pegarlo en el editor.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const limpiarTemporal = () => rmSync(TEMPORAL, { recursive: true, force: true });
process.on("exit", limpiarTemporal);

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = "supabase-config.gs";
const DIST = path.join(RAIZ, "dist");
const TEMPORAL = path.join(RAIZ, ".clasp-preserve");

/** El valor de ejemplo que trae supabase-config.gs en el repo. Nunca es una clave real. */
const PLACEHOLDER = "TU_SERVICE_ROLE_KEY";

function avisar(mensaje) {
  console.log(`[preserve-config] ${mensaje}`);
}

/**
 * No se imprime el contenido del archivo: es una credencial. Solo se mira si
 * sigue el marcador de ejemplo, y se dice cual de los tres valores falla.
 */
function diagnostico(contenido) {
  const problemas = [];
  if (!/const\s+SUPABASE_URL\s*=\s*'https:\/\/[^']+'/s.test(contenido)) problemas.push("SUPABASE_URL");
  const clave = (contenido.match(/const\s+SUPABASE_KEY\s*=\s*'([^']*)'/s) || [])[1];
  if (!clave) problemas.push("SUPABASE_KEY (no esta declarado)");
  else if (clave.includes(PLACEHOLDER)) problemas.push(`SUPABASE_KEY sigue con ${PLACEHOLDER}`);
  if (!/const\s+UBICACION\s*=/s.test(contenido)) problemas.push("UBICACION");
  return problemas;
}

/** El archivo pegado en el editor, si el proyecto remoto ya lo tiene. */
function bajarDelRemoto(claspJson) {
  // Gancho de prueba. El camino de "el remoto SI tiene el archivo" no se puede
  // ejercitar sin un proyecto que ya lo tenga, y este archivo no lo tiene todavia
  // (MEDIDO 2026-09-29), o sea que sin esto ese camino queda sin ejecutar nunca.
  // Se lee un archivo local en vez de preguntar a Google. El workflow nunca lo
  // pone: si lo pusiera, el pipeline subiria lo que marque esta variable en vez de
  // la clave de verdad, que es justo lo que este script evita.
  if (process.env.PRESERVE_CONFIG_DESDE) {
    const desde = path.resolve(process.env.PRESERVE_CONFIG_DESDE);
    return existsSync(desde)
      ? { estado: "ok", texto: readFileSync(desde, "utf8") }
      : { estado: "ausente" };
  }
  // clasp pull no acepta un archivo suelto: trae el proyecto entero. Se tira a un
  // directorio aparte para no pisar dist/, que es el build recien generado.
  rmSync(TEMPORAL, { recursive: true, force: true });
  mkdirSync(TEMPORAL, { recursive: true });
  writeFileSync(path.join(TEMPORAL, ".clasp.json"), JSON.stringify({ ...claspJson, rootDir: "." }, null, 2));
  const r = spawnSync("npx", ["--yes", "@google/clasp", "pull", "--force"], {
    cwd: TEMPORAL,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const destino = path.join(TEMPORAL, CONFIG);
  // MEDIDO 2026-09-29: este caso se confundia con el otro y decia "no se pudo
  // bajar" cuando clasp pull habia salido 0 y lo que faltaba era que el archivo no
  // esta en el remoto. Son dos cosas distintas con el mismo aviso: una se
  // arregla reintentando, la otra pegando el archivo en el editor.
  if (r.status !== 0) {
    return { estado: "fallo", motivo: `clasp pull fallo (${r.status}): ${String(r.stderr || r.stdout || "").trim().slice(0, 300)}` };
  }
  if (!existsSync(destino)) {
    return { estado: "ausente" };
  }
  return { estado: "ok", texto: readFileSync(destino, "utf8") };
}

const claspPath = path.join(RAIZ, ".clasp.json");
if (!existsSync(claspPath)) {
  avisar("no hay .clasp.json en el repo: no hay proyecto remoto contra el que preservar nada (no es un despliegue)");
  process.exit(0);
}
const claspJson = JSON.parse(readFileSync(claspPath, "utf8"));
if (/^AKfy/.test(claspJson.scriptId || "")) {
  avisar(".clasp.json trae un deploymentId en vez de un scriptId: no se puede preservar");
  process.exit(0);
}
if (!existsSync(DIST)) {
  avisar("no hay dist/: se ejecuta despues de npm run check (que es lo que genera el build)");
  process.exit(0);
}

const r = bajarDelRemoto(claspJson);
if (r.estado !== "ok") {
  const enDist = path.join(DIST, CONFIG);
  if (existsSync(enDist)) {
    // El build no lo genera nunca, pero si alguien lo metio a mano en dist/, se
    // retira: subir una version distinta al remoto es la unica forma de perderlo.
    rmSync(enDist, { force: true });
    avisar(`habia un ${CONFIG} en dist/ y se retiro: sin copia del remoto, subir otra version lo perderia`);
  }
  if (r.estado === "ausente") {
    avisar(`el proyecto remoto NO tiene ${CONFIG}: la ingesta no corrara hasta que lo pegues en el editor de Apps Script`);
  } else {
    avisar(`no se preservo (${r.motivo}); el remoto no se toca, asi que no se pierde`);
  }
  process.exit(0);
}

const contenido = r.texto;
const problemas = diagnostico(contenido);
// Se escribe desde el texto ya leido, no desde el archivo del temporal: ese
// directorio se borra al salir del proceso.
writeFileSync(path.join(DIST, CONFIG), contenido, "utf8");
avisar(`${CONFIG} preservado del remoto y puesto en dist/ para que el push lo reenvie`);
if (problemas.length) {
  avisar(`AVISO: el archivo del proyecto tiene estos valores sin rellenar -> ${problemas.join(", ")}. ingesta() lo dira con ese mismo texto`);
}
process.exit(0);
