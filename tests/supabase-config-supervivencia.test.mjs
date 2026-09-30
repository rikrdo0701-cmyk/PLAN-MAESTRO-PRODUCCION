// Los archivos que el pipeline NO publica (la clave de Supabase, entre otros)
// sobreviven a los despliegues porque scripts/appsscript-preservar-config.mjs los
// baja del proyecto y los vuelve a poner en dist/ antes del push.
//
// POR QUE ESTOS TESTS EXISTEN. MEDIDO 2026-09-29: el usuario pego config.js con
// la service role key. El siguiente despliegue borro el archivo entero y el
// proyecto paso de 27 archivos a 26. La causa: clasp push no actualiza archivo por
// archivo, llama a script.projects.updateContent (src/core/files.ts:616) con la
// lista completa de archivos locales, y esa API SUSTITUYE el proyecto entero. Lo
// que no esta en la lista, no existe despues. No hay delete ni removeFile en
// push.ts porque no hace falta: la API borra por ausencia.
//
// Y el fallo de la primera version de la preservacion fue de NOMBRE: buscaba
// supabase-config.gs, que es como se llama en el repo, y el usuario lo habia
// llamado config.js. El paso reporto 'el remoto NO tiene supabase-config.gs' con
// la clave ahi a la vista, y el despliegue siguiente la borro. Por eso ahora se
// preserva por contenido y no por nombre.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("../", import.meta.url));
const SCRIPT = path.join(RAIZ, "scripts", "appsscript-preservar-config.mjs");
const WORKFLOW = path.join(RAIZ, ".github", "workflows", "deploy-appscript.yml");

function archivosDe(dir, filtro) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? archivosDe(p, filtro) : filtro(p) ? [p] : [];
  });
}

/** Corre la preservacion contra un directorio que hace de remoto. */
function correr(remotoDir, distDir) {
  return spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, PRESERVE_CONFIG_REMOTO_DIR: remotoDir, PRESERVE_CONFIG_DIST_DIR: distDir },
    encoding: "utf8",
  });
}

/**
 * MEDIDO 2026-09-30: antes los tests jugaban con el dist/ REAL del repo, lo tomaban
 * con `conDistLimpio` y lo restauraban en un `finally`. Con la maquina ocupada esa
 * restauracion se cruzaba con la corrida y el test daba rojo sin que hubiera cambio
 * (2 de 6 corridas completas de la suite, siempre en este archivo). Un test que a veces
 * falla por el reloj entrena a ignorar el rojo, que es peor que no tenerlo. Ahora cada
 * test trabaja sobre su propio dist/ de Arena: cero estado compartido, y el dist/ real
 * no se toca ni por accidente.
 */
function arena(nombre) {
  return path.join(RAIZ, ".openchamber", nombre);
}

/** Crea un dist/ de Arena con los archivos indicados y lo devuelve. */
function distDePrueba(nombre, archivos = {}) {
  const dir = arena(nombre);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [n, t] of Object.entries(archivos)) writeFileSync(path.join(dir, n), t, "utf8");
  return dir;
}

test("el build NO pone ninguna plantilla de credenciales en dist/", () => {
  // Si existiera, se subiria al proyecto y el paso de preservacion, al no
  // encontrarlo en el remoto, no podria hacer nada: la plantilla ya estaria
  // substituting a la clave real.
  const gs = archivosDe(path.join(RAIZ, "src"), (p) => p.endsWith(".gs") || /supabase-config/.test(p));
  assert.deepEqual(gs, [], "src/ no debe traer ningun .gs ni un config: dist/ se sube entero");
  assert.ok(!existsSync(path.join(RAIZ, "dist", "supabase-config.gs")), "dist/supabase-config.gs solo puede venir del remoto");
});

test("el despliegue preserva ANTES de subir, con el nombre de archivo correcto", () => {
  const yml = readFileSync(WORKFLOW, "utf8");
  // Se ancla a la linea "run:" y no al nombre del script. MEDIDO 2026-09-29: al
  // anadir el script al filtro "paths" del workflow, un indexOf del nombre plano
  // empezo a encontrar ESA entrada, que esta antes del push, y el test reportaba
  // que el paso de verificacion iba antes cuando si iba despues. Un test que
  // mide mal es peor que no tener test: da verde mintiendo.
  const preservar = yml.indexOf("run: node scripts/appsscript-preservar-config.mjs");
  const push = yml.indexOf("npx --yes @google/clasp push");
  assert.ok(preservar > 0, "el workflow no llama a la preservacion: cualquier archivo a mano se pierde en el push");
  assert.ok(push > 0, "el workflow ya no hace clasp push");
  assert.ok(preservar < push, "preservar despues del push no preserva nada: ese push ya borro lo que no venia de dist/");
  assert.ok(existsSync(SCRIPT), "el archivo que el workflow ejecuta tiene que existir");
});

test("el despliegue verifica el CONTENIDO del proyecto, no solo que la funcion exista", () => {
  // MEDIDO 2026-09-29: dos despliegues dijeron "Pushed 26 files" con el archivo
  // listado y el proyecto seguia con la version vieja (13620 bytes contra 14563).
  // La comprobacion de antes, que 'ingesta' apareciera entre las funciones
  // desplegadas, daba verde igual: el bug no cambiaba ningun nombre, cambiaba el
  // cuerpo de la funcion. Sin comparar contenido, un despliegue a medias es
  // indetectable.
  const yml = readFileSync(WORKFLOW, "utf8");
  const push = yml.indexOf("npx --yes @google/clasp push");
  const verificar = yml.indexOf("run: node scripts/verificar-deploy-appscript.mjs");
  assert.ok(verificar > 0, "el workflow no verifica lo que subio: un deploy a medias sale verde");
  assert.ok(verificar > push, "verificar antes del push no verifica nada");
  const txt = readFileSync(path.join(RAIZ, "scripts", "verificar-deploy-appscript.mjs"), "utf8");
  assert.match(txt, /clasp pull/);
  assert.doesNotMatch(txt, /goog\.script\.init|functionNames/, "la lista de funciones es lo que no alcanza");
  assert.match(txt, /readFileSync\(path\.join\(DIST, n\)/, "tiene que leer el archivo de dist/ y compararlo");
});

test("ningun workflow usa el gancho de prueba", () => {
  // MEDIDO 2026-09-30: hay DOS ganchos de prueba (el remoto y el dist/) y ninguno
  // puede usarse en produccion. Si un workflow pasara PRESERVE_CONFIG_DIST_DIR,
  // preservaria contra un dist/ de mentira y la clave real se perderia igual.
  for (const f of readdirSync(path.join(RAIZ, ".github", "workflows"))) {
    const yml = readFileSync(path.join(RAIZ, ".github", "workflows", f), "utf8");
    assert.doesNotMatch(yml, /PRESERVE_CONFIG_REMOTO_DIR/, `${f} usa el gancho de prueba en produccion`);
    assert.doesNotMatch(yml, /PRESERVE_CONFIG_DIST_DIR/, `${f} usa el gancho de prueba en produccion`);
  }
});

test("los ganchos de prueba no se pueden colar al bundle que se publica", () => {
  // El gancho se decide por variable de entorno, asi que un bundle que lo lea hace
  // exactamente lo que el test quiere pero en el sitio publico, donde cualquiera que
  // abra la consola pone la variable. La condicion es que SOLO el script lo mire.
  const codifiedos = archivosDe(path.join(RAIZ, "src"), (p) => /\.(js|gs|html)$/.test(p));
  for (const p of codifiedos) {
    const txt = readFileSync(p, "utf8");
    assert.doesNotMatch(txt, /PRESERVE_CONFIG_(REMOTO|DIST)_DIR/, `${p} lee un gancho de prueba en el bundle publicado`);
  }
});

test("un archivo con credenciales y otro nombre tambien se preserva", () => {
  // El caso medido: config.js, no supabase-config.gs. La primera version buscaba
  // por nombre, no encontro nada y el despliegue siguiente lo borro.
  const remoto = path.join(RAIZ, ".openchamber", "remoto-prueba");
  const dist = distDePrueba("dist-prueba");
  rmSync(remoto, { recursive: true, force: true });
  mkdirSync(remoto, { recursive: true });
  const clave = [
    "const SUPABASE_URL = 'https://xtgtfjcwxcoxvixholpj.supabase.co';",
    "const SUPABASE_KEY = 'sb_secret_VALORDEPRUEBANOSEIMPRIME';",
    "const UBICACION = '1';",
  ].join("\n");
  writeFileSync(path.join(remoto, "config.js"), clave, "utf8");
  writeFileSync(path.join(remoto, "otro.js"), "function sinRelacion() { return 1; }\n", "utf8");
  try {
    const r = correr(remoto, dist);
    assert.equal(r.status, 0, `salio ${r.status}: ${r.stderr}`);
    const destino = path.join(dist, "config.js");
    assert.ok(existsSync(destino), "config.js no llego a dist/: el push lo borraria del proyecto");
    assert.equal(readFileSync(destino, "utf8"), clave, "no llego identico");
    assert.ok(existsSync(path.join(dist, "otro.js")), "tambien hay que preservar lo que no lleva credenciales");
    assert.match(r.stdout, /config\.js/);
    assert.match(r.stdout, /credenciales/i);

    // Y con la clave de ejemplo tiene que avisar, no subirla sin decir nada.
    // Cada corrida usa un dist/ NUEVO: si se reusara el de arriba, los archivos ya
    // estarian ahi y no contarian como propios del remoto, y el aviso no saldria.
    const dist2 = distDePrueba("dist-prueba-2");
    writeFileSync(path.join(remoto, "config.js"), "const SUPABASE_KEY = 'TU_SERVICE_ROLE_KEY';\nconst UBICACION = '1';\n", "utf8");
    const r2 = correr(remoto, dist2);
    assert.equal(r2.status, 0, `salio ${r2.status}: ${r2.stderr}`);
    assert.match(r2.stdout, /valor de ejemplo/, "con la clave de ejemplo tiene que avisar");
  } finally {
    rmSync(remoto, { recursive: true, force: true });
    rmSync(arena("dist-prueba"), { recursive: true, force: true });
    rmSync(arena("dist-prueba-2"), { recursive: true, force: true });
  }
});

test("sin archivo propio, no inventa ninguno", () => {
  // Un remoto que es una copia exacta de dist/ no debe hacer que aparezca nada
  // nuevo: si el script fabricara un archivo de credenciales de repuesto,
  // cualquier despliegue volveria a pisar la clave con el ejemplo.
  const remoto = path.join(RAIZ, ".openchamber", "remoto-vacio");
  const dist = distDePrueba("dist-vacio", {
    "Index.js": "function hola() { return 1; }\n",
    "supabase-config.gs": "const SUPABASE_URL = 'https://ejemplo.supabase.co';\n",
  });
  rmSync(remoto, { recursive: true, force: true });
  mkdirSync(remoto, { recursive: true });
  for (const n of readdirSync(dist)) {
    writeFileSync(path.join(remoto, n), readFileSync(path.join(dist, n)));
  }
  try {
    const antes = readdirSync(dist).length;
    const r = correr(remoto, dist);
    assert.equal(r.status, 0);
    assert.equal(readdirSync(dist).length, antes, "aparecio un archivo que no venia del remoto");
    assert.match(r.stdout, /nada que preservar/);
  } finally {
    rmSync(remoto, { recursive: true, force: true });
    rmSync(arena("dist-vacio"), { recursive: true, force: true });
  }
});

test("si no puede leer el remoto, CORTA el despliegue en vez de seguir", () => {
  // Antes hacia lo contrario: avisaba y continuaba, con lo que dist/ se quedaba
  // sin el archivo y el push siguiente lo eliminaba del proyecto. Perder la clave
  // por un fallo transitorio de la API de Google es el peor resultado posible.
  const dist = distDePrueba("dist-ilegible");
  try {
    const r = correr(path.join(RAIZ, ".openchamber", "no-existe-este-directorio"), dist);
    assert.equal(r.status, 1, "con el remoto ilegible tiene que salir con 1, no con 0");
    assert.match(r.stderr, /CORTO el despliegue/);
  } finally {
    rmSync(arena("dist-ilegible"), { recursive: true, force: true });
  }
});

test("la preservacion no trae claves ni imprime el contenido", () => {
  const txt = readFileSync(SCRIPT, "utf8");
  assert.doesNotMatch(txt, /sb_secret_[A-Za-z0-9_-]{8,}/);
  assert.doesNotMatch(txt, /sb_publishable_[A-Za-z0-9_-]{8,}/);
  assert.doesNotMatch(txt, /console\.log\([^)]*\btexto\b/, "el contenido de un archivo de credenciales no se imprime");
});
