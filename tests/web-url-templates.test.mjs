import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * RULE-WEB-002: el HTML service de Apps Script recorta la linea en cada "//" que encuentra
 * DENTRO de una plantilla (backtick). Al entregar la pagina, esas lineas llegan cortadas y
 * el bundle deja de parsear, dejando la app con la interfaz visible pero sin datos.
 *
 * Evidencia (2026-09-26, comprobacion de humo con Playwright contra /exec):
 *  - El archivo almacenado en el proyecto de Apps Script es IDENTICO a este build: clasp
 *    pull bajo 24 archivos y los 24 coinciden byte a byte con dist/, mismo sha256 en
 *    Index.html. Servido ese mismo archivo como estatico carga sin un solo error de
 *    sintaxis, y GitHub Pages, que sirve el mismo archivo, funciona.
 *  - NO es cache: se reproduce con la cache desactivada por CDP (Network.setCacheDisabled)
 *    y con un parametro de ruptura en la URL.
 *  - Lo que llega recortado se midio con un oraculo: cada linea de JavaScript del build que
 *    no aparece en la entrega fue cortada por la entrega. Asi se descubrieron dos tandas:
 *    primero las URL construidas con "`https://${raw}`", despues dos textos de aviso que
 *    decian "maldonado://" en una plantilla. Los dos casos quedaron en cero.
 *
 * Las cadenas con comillas simples o dobles NO se recortan: por eso la mitigacion es
 * concatenar con comillas (o sacar el esquema a una constante) en vez de interpolar.
 *
 * La comprobacion es por linea y No lleva estado entre lineas a proposito: un lexer con
 * expresiones regulares se desincroniza y produce falsos positivos. El patron /`[^`]*\/\//
 * solo puede coincidir si hay un backtick antes del "//" en la misma linea, y un regex
 * de JavaScript no contiene backticks, asi que no hay falsos positivos en este codigo.
 */

const RAIZ = fileURLToPath(new URL("../", import.meta.url));
const PLANTILLA_CON_BARRAS = /`[^`]*\/\//;

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

function offenses(texto) {
  const salida = [];
  texto.replace(/\r\n/g, "\n").split("\n").forEach((linea, i) => {
    if (PLANTILLA_CON_BARRAS.test(linea)) salida.push(`linea ${i + 1}: ${linea.trim().slice(0, 120)}`);
  });
  return salida;
}

test("ningun archivo de src/web tiene // dentro de una plantilla", async () => {
  const archivos = await archivosJs(path.join(RAIZ, "src", "web"));
  const infractiones = [];
  for (const archivo of archivos) {
    for (const linea of offenses(await readFile(archivo, "utf8"))) {
      infractiones.push(`${path.relative(RAIZ, archivo)} ${linea}`);
    }
  }
  assert.deepEqual(
    infractiones,
    [],
    'Usa concatenacion con comillas o una constante: "https://" + valor. El HTML service de '
      + "Apps Script recorta la linea en el // de una plantilla y el bundle deja de parsear.",
  );
});

test("las paginas construidas tampoco lo tienen", async () => {
  for (const nombre of ["dist/Index.html", "site/index.html"]) {
    let texto;
    try {
      texto = await readFile(path.join(RAIZ, ...nombre.split("/")), "utf8");
    } catch {
      continue; // La pagina aun no esta construida; la prueba anterior cubre el fuente.
    }
    assert.deepEqual(offenses(texto), [], `${nombre} tiene "//" dentro de una plantilla.`);
  }
});

test("el detector no marca las expresiones regulares ni los comentarios", () => {
  // Si estas lineas se marcaran, el detector daria falsos positivos en todo el codigo.
  const sanas = [
    '  if (/^https?:\\/\\//i.test(raw)) return raw;',
    "  // un comentario con http://schemas.openxmlformats.org no debe marcar",
    '  const x = "https://ejemplo.com/a";',
    '  return "https://" + raw;',
    "  return `${a}/${b}`;",
  ];
  assert.deepEqual(offenses(sanas.join("\n")), []);
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

test("el XLSX sigue declarando los espacios de nombres XML fuera de las plantillas", async () => {
  const source = await readFile(path.join(RAIZ, "src", "web", "planning", "app.js"), "utf8");
  for (const nombre of ["XLSX_NS_PACKAGE", "XLSX_NS_PACKAGE_RELS", "XLSX_NS_OFFICE", "XLSX_NS_MAIN"]) {
    assert.ok(source.includes(`const ${nombre} = "http`), `falta la constante ${nombre}`);
  }
  // buildSheetXml usa XLSX_NS_MAIN y esta declarada despues de buildXlsxBytes: si estuviera
  // dentro de la funcion, buildSheetXml no la encontraria al construirse el XLSX.
  const iConst = source.indexOf("const XLSX_NS_PACKAGE ");
  const iBuild = source.indexOf("function buildXlsxBytes(");
  const iSheet = source.indexOf("function buildSheetXml(");
  assert.ok(iConst >= 0 && iConst < iBuild && iConst < iSheet, "las constantes deben estar en ambito de modulo");
  assert.ok(source.includes("<worksheet xmlns=\"${XLSX_NS_MAIN}\">"), "buildSheetXml debe usar la constante");
});
