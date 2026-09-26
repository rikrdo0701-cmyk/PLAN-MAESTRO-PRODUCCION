import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * RULE-WEB-002: el HTML service de Apps Script mutila las lineas que tienen "://" seguido
 * de una interpolacion dentro de una plantilla. Al entregar la pagina, esas lineas llegan
 * cortadas justo despues de "://" y el bundle entero deja de parsear con
 * "Unexpected identifier 'https'", dejando la app sin estado.
 *
 * Se verifico que el archivo almacenado en Apps Script es identico a este build, que
 * servido como estatico carga sin errores, y que el mismo archivo por /exec no carga.
 * El patron "//${" es el unico que distingue a los scripts que fallan de los que pasan.
 *
 * En JS valido "${" solo puede ser una interpolacion, asi que el patron no tiene falsos
 * positivos: no puede aparecer fuera de una plantilla.
 */

const RAIZ = fileURLToPath(new URL("../", import.meta.url));

async function archivosJs(dir) {
  const entradas = await readdir(dir, { withFileTypes: true });
  const salida = [];
  for (const entrada of entradas) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...(await archivosJs(completo)));
    else if (entrada.name.endsWith(".js")) salida.push(completo);
  }
  return salida;
}

function ofensas(texto) {
  const encontradas = [];
  const lineas = texto.split("\n");
  lineas.forEach((linea, i) => {
    if (linea.includes("//${")) encontradas.push(`linea ${i + 1}: ${linea.trim().slice(0, 120)}`);
  });
  return encontradas;
}

test("ningun archivo de src/web usa //${ dentro de una plantilla", async () => {
  const archivos = await archivosJs(path.join(RAIZ, "src", "web"));
  const infractiones = [];
  for (const archivo of archivos) {
    const texto = await readFile(archivo, "utf8");
    for (const linea of ofensas(texto)) {
      infractiones.push(`${path.relative(RAIZ, archivo)} ${linea}`);
    }
  }
  assert.deepEqual(
    infractiones,
    [],
    "Usa concatenacion con comillas en vez de una plantilla: \"https://\" + valor. "
      + "El HTML service de Apps Script corta la linea en \"//\" y el bundle deja de parsear.",
  );
});

test("las paginas construidas no contienen el patron que mutila el HTML service", async () => {
  for (const nombre of ["dist/Index.html", "site/index.html"]) {
    const url = path.join(RAIZ, ...nombre.split("/"));
    let texto;
    try {
      texto = await readFile(url, "utf8");
    } catch {
      continue; // La pagina aun no esta construida; la prueba anterior cubre el fuente.
    }
    assert.deepEqual(
      ofensas(texto.replace(/\r\n/g, "\n")),
      [],
      `${nombre} entrego el patron "//\${": el HTML service lo mutila al servir la pagina.`,
    );
  }
});

test("normalizeDrawingUrl sigue resolviendo los mismos valores sin plantillas", async () => {
  const source = await readFile(path.join(RAIZ, "src", "web", "planning", "app.js"), "utf8");
  const fn = source.slice(
    source.indexOf("function cleanDrawingInput("),
    source.indexOf("function renderOperatorSelect()"),
  );
  const vm = await import("node:vm");
  const contexto = vm.createContext({ callAppsScript: async () => ({ ok: true, data: [] }) });
  vm.runInContext(fn, contexto);

  const unc = "\\\\192.168.1.101\\Produccion2\\dibujos\\plano.pdf";
  assert.equal(contexto.normalizeDrawingUrl(unc), "maldonado://abrir?archivo=" + encodeURIComponent(unc));
  assert.equal(contexto.normalizeDrawingUrl("www.ejemplo.com/a.pdf"), "https://www.ejemplo.com/a.pdf");
  assert.equal(contexto.normalizeDrawingUrl("drive.google.com"), "https://drive.google.com");
  assert.equal(
    contexto.normalizeDrawingUrl("A".repeat(25)),
    "https://drive.google.com/file/d/" + encodeURIComponent("A".repeat(25)) + "/view",
  );
  assert.equal(contexto.normalizeDrawingUrl("C:\\dibujos\\plano.pdf"), "file://C:/dibujos/plano.pdf");
  assert.equal(contexto.normalizeDrawingUrl("https://example.com/a.pdf"), "https://example.com/a.pdf");
  assert.equal(contexto.normalizeDrawingUrl(""), "");
});
