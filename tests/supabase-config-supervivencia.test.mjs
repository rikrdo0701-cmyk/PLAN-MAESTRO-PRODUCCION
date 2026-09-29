// La service role key de Supabase vive en un archivo del PROYECTO de Apps Script
// (supabase-config.gs), no en el repo. Estos tests fijan por que no puede viajar
// al repo ni colarse en dist/ por accidente, porque el unico modo de perderla es
// que alguien suba una version distinta de la que esta pegada en el proyecto.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("../", import.meta.url));
const CONFIG = "supabase-config.gs";

function archivosDe(dir, filtro) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? archivosDe(p, filtro) : filtro(p) ? [p] : [];
  });
}

test("el build NO genera ninguna plantilla de supabase-config.gs en dist/", () => {
  // Si existiera, un fallo de la API de Google en el paso de preservacion seria
  // justo el que la sobreescribiera con el valor de ejemplo.
  const enSrc = archivosDe(path.join(RAIZ, "src"), (p) => p.endsWith(".gs") || p.includes(CONFIG));
  assert.deepEqual(enSrc, [], "src/ no debe traer ningun .gs: dist/ se sube entero y publicaria la plantilla");
  assert.ok(
    !existsSync(path.join(RAIZ, "dist", CONFIG)),
    "dist/supabase-config.gs solo puede existir si lo bajo el remoto, nunca por build"
  );
  // Y la copia local es el ejemplo, no una clave: esta en .gitignore, asi que no
  // llega al CI, pero aun asi no debe tener una clave real.
  const local = path.join(RAIZ, CONFIG);
  if (existsSync(local)) {
    const txt = readFileSync(local, "utf8");
    assert.match(txt, /TU_SERVICE_ROLE_KEY/, "la copia del repo es la plantilla con el valor de ejemplo");
    assert.doesNotMatch(txt, /sb_secret_[A-Za-z0-9_-]{8,}/, "una clave real en un archivo del repo se publica");
  }
});

test("el despliegue preserva el archivo antes de subir, no despues", () => {
  const yml = readFileSync(path.join(RAIZ, ".github", "workflows", "deploy-appscript.yml"), "utf8");
  const preservar = yml.indexOf("appsscript-preservar-config.mjs");
  const push = yml.indexOf("clasp push");
  assert.ok(preservar > 0, "el workflow no llama al script de preservacion: la clave dejaria de viajar con el despliegue");
  assert.ok(push > 0, "el workflow ya no hace clasp push");
  assert.ok(preservar < push, "preservar despues del push no preservaria nada: el archivo se perderia en ese push");
  // Y el nombre que pone es el de verdad. MEDIDO 2026-09-29: se escribio
  // 'appscript-preservar-config.mjs' con una s menos, asi que el paso habria
  // fallado en CI con MODULE_NOT_FOUND. Un test que solo busca 'preservar-config'
  // no lo ve: el workflow si Mentionaba la palabra.
  assert.ok(
    existsSync(path.join(RAIZ, "scripts", "appsscript-preservar-config.mjs")),
    "el archivo que el workflow ejecuta tiene que existir"
  );
});

test("el script de preservacion no imprime el contenido ni trae una clave", () => {
  const txt = readFileSync(path.join(RAIZ, "scripts", "appsscript-preservar-config.mjs"), "utf8");
  assert.doesNotMatch(txt, /sb_secret_[A-Za-z0-9_-]{8,}/);
  assert.doesNotMatch(txt, /sb_publishable_[A-Za-z0-9_-]{8,}/);
  // Imprimir el archivo seria filtrar la clave en el log publico del workflow.
  assert.doesNotMatch(txt, /console\.log\([^)]*contenido\b/, "el contenido del archivo no se imprime");
  assert.doesNotMatch(txt, /console\.log\([^)]*readFileSync/, "el contenido del archivo no se imprime");
});

test("el script de preservacion nunca sube una version distinta de la remota", () => {
  const txt = readFileSync(path.join(RAIZ, "scripts", "appsscript-preservar-config.mjs"), "utf8");
  // Si el remoto no se pudo bajar, la unica escritura admitida es borrar lo que
  // hubiera en dist/, no dejar un archivo de mas.
  assert.match(txt, /rmSync\(enDist, \{ force: true \}\)/, "sin copia del remoto hay que quitar el archivo de dist/, no subirlo");
  assert.doesNotMatch(
    txt,
    /writeFileSync\(path\.join\(DIST, CONFIG\)[^)]*contenido\s*\|\|\s*(contenido|[\`'])/,
    "no se puede escribir en dist/ un valor por defecto cuando no se bajo el remoto"
  );
});

test("ningun workflow usa el gancho de prueba PRESERVE_CONFIG_DESDE", () => {
  // El gancho salta la lectura del remoto. Si un workflow lo usara, el pipeline
  // subiria lo que marque la variable en vez de la clave de verdad: exactamente
  // lo que este script existe para que no pase.
  const dir = path.join(RAIZ, ".github", "workflows");
  for (const f of readdirSync(dir)) {
    const yml = readFileSync(path.join(dir, f), "utf8");
    assert.doesNotMatch(yml, /PRESERVE_CONFIG_DESDE/, `${f} usa el gancho de prueba en produccion`);
  }
});

test("con el remoto presente, el archivo llega a dist/ igual que estaba", async () => {
  // Ejercita de verdad el camino que en el proyecto real no se puede ejecutar:
  // MEDIDO 2026-09-29, el remoto NO tiene todavia supabase-config.gs, o sea que
  // sin el gancho de prueba este camino no se correria nunca.
  const config = path.join(RAIZ, CONFIG);
  assert.ok(existsSync(config), "se necesita la copia local como fuente de prueba");
  const destino = path.join(RAIZ, "dist", CONFIG);
  const habia = existsSync(destino);
  const antes = habia ? readFileSync(destino, "utf8") : null;
  try {
    const r = spawnSync(process.execPath, [path.join(RAIZ, "scripts", "appsscript-preservar-config.mjs")], {
      env: { ...process.env, PRESERVE_CONFIG_DESDE: config },
      encoding: "utf8",
    });
    assert.equal(r.status, 0, `el script salio ${r.status}: ${r.stderr}`);
    assert.ok(existsSync(destino), "no puso el archivo en dist/: el push no lo reenviaria");
    assert.equal(readFileSync(destino, "utf8"), readFileSync(config, "utf8"), "dist/ no coincide con el remoto");
    // Y avisa de que la clave sigue siendo el ejemplo, en vez de subirla callado.
    assert.match(r.stdout, /TU_SERVICE_ROLE_KEY/, "con la clave de ejemplo tiene que avisar, no subirla sin decir nada");
  } finally {
    if (habia) writeFileSync(destino, antes, "utf8");
    else rmSync(destino, { force: true });
  }
});

test("sin el remoto, dist/ se queda igual y el aviso es el correcto", async () => {
  const destino = path.join(RAIZ, "dist", CONFIG);
  const habia = existsSync(destino);
  const antes = habia ? readFileSync(destino, "utf8") : null;
  try {
    // El gancho apunta a algo inexistente: es el mismo caso que "el remoto no lo tiene".
    const r = spawnSync(process.execPath, [path.join(RAIZ, "scripts", "appsscript-preservar-config.mjs")], {
      env: { ...process.env, PRESERVE_CONFIG_DESDE: path.join(RAIZ, "no-existe.gs") },
      encoding: "utf8",
    });
    assert.equal(r.status, 0, `el script salio ${r.status}: ${r.stderr}`);
    assert.equal(existsSync(destino), false, "sin copia del remoto no debe quedar nada en dist/");
    // El aviso tiene que decir que falta pegarlo, no que fallo la lectura: MEDIDO
    // 2026-09-29 la primera version decia "no se pudo bajar" con clasp pull saliendo
    // 0, y mandaba a pegar a mano un archivo que ya estaba.
    assert.match(r.stdout, /NO tiene/);
    assert.doesNotMatch(r.stdout, /no se pudo bajar/);
  } finally {
    if (habia) writeFileSync(destino, antes, "utf8");
  }
});
