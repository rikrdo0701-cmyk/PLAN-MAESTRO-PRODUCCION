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

// MEDIDO 2026-10-01 con grep sobre el repo: la foto_url de la OT se produce en
// src/server/09-photos.js:35 como 'https://drive.google.com/thumbnail?id=' + file.getId() +
// '&sz=w400'. Estas pruebas fijan que la pagina acepta ESA forma, y que las otras dos que
// existen en Drive (un id suelto y un /file/d/<id>/view pegado como foto) se traducen al mismo
// endpoint de imagen. La segunda es la que fallaba: /view es la pagina HTML del visor, un <img>
// que la pide da error, y la tarjeta caia al "Sin foto" con el dato entero disponible.
test("safePhotoUrl acepta la foto de Drive que produce el servidor", async () => {
  const source = await readFile(path.join(RAIZ, "src", "web", "planning", "app.js"), "utf8");
  const vm = await import("node:vm");
  const contexto = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf("const DRIVE_THUMBNAIL"), source.indexOf("function bindPhotoFallback(")), contexto);

  // La forma exacta de 09-photos.js:35, tal cual la guarda el mirror.
  const delServidor = "https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMnOpQrStUvWxYz&sz=w400";
  assert.equal(contexto.safePhotoUrl(delServidor), delServidor, "la foto de Drive tal cual, sin reescribir");

  // Un id suelto (mismo criterio que normalizeDrawingUrl, pero al endpoint de imagen).
  assert.equal(
    contexto.safePhotoUrl("1AbCdEfGhIjKlMnOpQrStUvWxYz"),
    "https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMnOpQrStUvWxYz&sz=w400",
    "un id suelto de Drive tiene que terminar en /thumbnail, no en /view",
  );

  // Un /view o /preview pegado como foto: es HTML del visor, no una imagen.
  assert.equal(
    contexto.safePhotoUrl("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view"),
    "https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMnOpQrStUvWxYz&sz=w400",
  );
  assert.equal(
    contexto.safePhotoUrl("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/preview"),
    "https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMnOpQrStUvWxYz&sz=w400",
  );

  // La foto de NetSuite, que es un https cualquiera, pasa igual.
  assert.equal(contexto.safePhotoUrl("https://netsuite.com/foto.jpg"), "https://netsuite.com/foto.jpg");
});

test("safePhotoUrl rechaza lo que un <img> no puede pintar", async () => {
  const source = await readFile(path.join(RAIZ, "src", "web", "planning", "app.js"), "utf8");
  const vm = await import("node:vm");
  const contexto = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf("const DRIVE_THUMBNAIL"), source.indexOf("function bindPhotoFallback(")), contexto);

  // El ataque del que la función existe.
  assert.equal(contexto.safePhotoUrl("javascript:alert(1)"), "");
  assert.equal(contexto.safePhotoUrl("  javascript:alert(1)  "), "");
  // Contenido mixto: la pagina va por https, un <img> en http lo bloquea.
  assert.equal(contexto.safePhotoUrl("http://ejemplo.com/foto.jpg"), "");
  // normalizeDrawingUrl devuelve estas dos para los DIBUJOS, y un <img> no las pinta.
  assert.equal(contexto.safePhotoUrl("maldonado://abrir?archivo=x.pdf"), "");
  assert.equal(contexto.safePhotoUrl("C:\\dibujos\\plano.pdf"), "");
  // Sin dato: vacio, que es lo que hace que la tarjeta muestre "Sin foto" y no un roto.
  assert.equal(contexto.safePhotoUrl(""), "");
  assert.equal(contexto.safePhotoUrl(null), "");
  // La foto pegada dentro de la base si se acepta: viaja como data:image/.
  assert.equal(contexto.safePhotoUrl("data:image/png;base64,iVBORw0KGgo="), "data:image/png;base64,iVBORw0KGgo=");
});

// MEDIDO 2026-10-01: las 175 tarjetas del Backlog decian "Sin foto" para DOS cosas opuestas,
// y el texto no distinguia ninguna:
//   - la OT no tiene foto en la carpeta de Drive (dato AUSENTE), y
//   - si hay foto, la URL esta y el <img> no la cargo (dato ROTO, hay que arreglar la foto).
// bindPhotoFallback es la unica que separa las dos: sin <img> no hay error que escuchar y el
// <span> se queda en "Sin foto"; con <img> que falla, ese mismo <span> pasa a decir que lo que
// fallo fue la carga. Se prueba con un DOM minimo, no leyendo el texto de la funcion, para que un
// comentario que explicase el motivo sin implementarlo haga fallar la prueba.
test("bindPhotoFallback separa 'no hay foto' de 'la foto no cargo'", async () => {
  const source = await readFile(path.join(RAIZ, "src", "web", "planning", "app.js"), "utf8");
  const vm = await import("node:vm");
  const contexto = vm.createContext({});
  vm.runInContext(
    source.slice(source.indexOf("function bindPhotoFallback("), source.indexOf("function materialValue(")),
    contexto,
  );

  // DOM minimo con la forma EXACTA que pintan los tres renders:
  //   <div class="...-photo has-photo"><img ...><span>Sin foto</span></div>
  function recuadro(conFoto) {
    const clases = new Set(conFoto ? ["has-photo"] : []);
    const span = { textContent: "Sin foto" };
    const box = {
      classList: { remove: (c) => clases.delete(c), add: (c) => clases.add(c) },
      querySelector: (sel) => (sel === "span" ? span : null),
    };
    let alFallar = null;
    const img = {
      parentElement: box,
      addEventListener: (tipo, fn) => { if (tipo === "error") alFallar = fn; },
    };
    const fotos = conFoto ? [img] : [];
    return { root: { querySelectorAll: () => fotos }, clases, span, alFallar: () => alFallar };
  }

  // CASO 1: la OT no tiene foto. No hay <img>, o sea que no hay error que escuchar y el recuadro
  // se queda como lo pinto el render. Aqui no se inventa nada.
  const sinFoto = recuadro(false);
  contexto.bindPhotoFallback(sinFoto.root);
  assert.equal(sinFoto.alFallar(), null, "sin foto no hay <img> al que escuchar: no hay nada que pueda fallar");
  assert.equal(sinFoto.clases.has("photo-broken"), false,
    "no tener foto NO se marca como roto: no hay ninguna URL que haya fallado");
  assert.equal(sinFoto.span.textContent, "Sin foto", "y el texto sigue diciendo la verdad: no hay foto");

  // CASO 2: la foto SI esta, y el <img> falla al cargar. Ahi el recuadro tiene que quitarse
  // has-photo (para que se vea el <span> de respaldo), marcar photo-broken (borde punteado y
  // color de error en styles.css) Y cambiar el texto, porque "Sin foto" diria una falsedad.
  const rota = recuadro(true);
  contexto.bindPhotoFallback(rota.root);
  assert.equal(typeof rota.alFallar(), "function", "bindPhotoFallback tiene que escuchar el error del <img>");
  rota.alFallar()();

  assert.equal(rota.clases.has("has-photo"), false, "se quita has-photo para que se vea el texto de respaldo");
  assert.equal(rota.clases.has("photo-broken"), true,
    "y se marca como roto, que es un dato DISTINTO de no tener foto");
  assert.notEqual(rota.span.textContent, "Sin foto",
    "el texto ya no puede decir 'Sin foto': la foto SI existe, lo que fallo es que no cargo");
  assert.match(rota.span.textContent, /no carg/i,
    "el texto dice que lo que fallo fue la carga, no que falte la foto: " + rota.span.textContent);
});

// Por que esto importa mas de lo que parece: los tres render de foto (backlog, cola, detalle) tienen
// que pasar por safePhotoUrl, no por normalizeDrawingUrl. normalizeDrawingUrl existe para DIBUJOS
// (PDFs en la red de Produccion2 que se abren con maldonado://) y devuelve file://, maldonado:// y
// UNC, que un <img> jamas pinta. Con la mezcla, la foto de Drive se traducía a /view y no cargaba.
test("los tres renders de foto pasan por safePhotoUrl, no por normalizeDrawingUrl", async () => {
  const source = await readFile(path.join(RAIZ, "src", "web", "planning", "app.js"), "utf8");
  for (const marca of ["data-backlog-photo", "data-queue-photo", "data-detail-photo"]) {
    const line = source.split("\n").find((l) => l.includes(`escapeHtml(`) && l.includes(marca));
    assert.ok(line, `no se encontro el <img> de ${marca}`);
    assert.doesNotMatch(line, /normalizeDrawingUrl\(/,
      `${marca}: el src tiene que salir de safePhotoUrl, no del normalizador de dibujos`);
  }
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
