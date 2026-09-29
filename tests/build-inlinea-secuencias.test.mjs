import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

/**
 * NINGUN ARCHIVO QUE EL BUILD INLINEA PUEDE CONTENER LA SECUENCIA $` (dolar
 * seguido de backtick), NI $' (dolar seguido de comilla simple).
 *
 * El build mete las fuentes del navegador con String.replace, y en la cadena de
 * reemplazo esos dos son patrones especiales: significan "la parte del texto
 * anterior al match" y "la posterior". O sea que no se copian literales: se
 * inyecta el principio o el final de la pagina DENTRO del bundle.
 *
 * MEDIDO 2026-09-29: un comentario mio en supabase-writer.js con la expresion
 * regular de los ids de operacion termino en backtick produce site/index.html con
 * 2.1 MB en vez de 1.3, tres <html> y el boton de restaurar borrador triplicado.
 * El sintoma parece de otro: el boton aparecia tres veces y el test que lo
 * comprueba (`build.test.mjs`, "un solo restoreDraftBtn") fallaba con 3 !== 1 sin
 * ninguna pista de la causa. El buildsalvaba igual: sale sin error y con un
 * archivo plausible, que es la peor forma de romperse.
 *
 * Por eso el control va aqui y no en un comentario: la condicion es
 * mecanica, se puede comprobar sin entender el build, y el fallo que previene es
 * invisible.
 */

const EXT = new Set([".js", ".html", ".css"]);
const RAIZES = ["src/web", "src/server"];

function archivos() {
  const salida = [];
  const recorrer = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) recorrer(p);
      else if (EXT.has(path.extname(e.name))) salida.push(p);
    }
  };
  for (const r of RAIZES) if (fs.existsSync(r)) recorrer(r);
  return salida;
}

test("ningun fuente del build contiene la secuencia que rompe String.replace", () => {
  const malos = [];
  for (const p of archivos()) {
    const t = fs.readFileSync(p, "utf8");
    t.split(/\r?\n/).forEach((linea, i) => {
      // $` y $' son los dos patrones de "parte anterior" y "parte posterior".
      // Se exige que el dolar no este escapado: un \$ si es inocuo.
      const troceada = linea.replace(/\\[$]/g, "");
      if (/[$][`]/.test(troceada) || /[$]'/.test(troceada)) {
        malos.push(p + ":" + (i + 1) + "  " + linea.trim().slice(0, 90));
      }
    });
  }
  assert.equal(
    malos.length,
    0,
    "estas lineas se inyectan literalmente al bundle y rompen la pagina:\n  " + malos.join("\n  ")
  );
});

test("la pagina generada tiene UNA sola vez el html y el boton de restaurar", () => {
  const site = new URL("../site/index.html", import.meta.url);
  if (!fs.existsSync(site)) {
    // Sin build no hay nada que comprobar; el otro test (el del build) corre en
    // ese caso. Saltarse aqui es correcto y no es un verde falso: el control de
    // la secuencia corre igual, y es el que mira la causa.
    return;
  }
  const h = fs.readFileSync(site, "utf8");
  const cuenta = (s) => h.split(s).length - 1;
  assert.equal(cuenta("<html"), 1, "la pagina tiene mas de un <html>: se inyecto texto dentro del bundle");
  assert.equal(cuenta("</html>"), 1);
  assert.equal(cuenta('id="restoreDraftBtn"'), 1, "el boton de restaurar aparece mas de una vez");
});
