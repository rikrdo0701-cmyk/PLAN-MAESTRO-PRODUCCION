// Candado de los DOS bugs del 2026-09-30 que eran silenciosos:
//
// 1. condicionDeClave usaba el VALOR de la clave como NOMBRE de columna, y claveDeFila
//    comparaba contra la clave VIEJA de calendar_exceptions. Los dos son el mismo error: un
//    nombre de columna escrito a mano que se desincroniza de def.clave.
//
// 2. El informe de catalogos mezclaba el error del POST y el del DELETE en un campo, y la
//    revision del plan salia del mismo payload que los catalogos, asi que un 404 de catalogo
//    dejaba la pagina con una revision que nadie habia verificado (22 contra una base en 2, y
//    ningun guardado posible).
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const escritor = await readFile(new URL("../src/web/shared/supabase-writer.js", import.meta.url), "utf8");
const reemplazo = await readFile(new URL("../src/web/shared/supabase-bridge-replacement.js", import.meta.url), "utf8");
const arranque = await readFile(new URL("../src/web/shared/performance-client.js", import.meta.url), "utf8");
const app = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");

/** El fuente sin comentarios: lo que se afirma es codigo, no prosa. */
function codigo(txt) {
  return txt.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
}
const cod = codigo(escritor);

test("el filtro de borrado usa el NOMBRE de columna de def.clave, no el valor de la clave", () => {
  // MEDIDO 2026-09-30: HTTP 400 42703 "column ot_configurations.1905 does not exist". La causa
  // era `return clave + "=eq." + clave`, o sea el VALOR de la clave como nombre de COLUMNA. Con
  // la clave 1905 salia el filtro 1905=eq.1905. El DELETE de lo que la persona quito no habia
  // funcionado para ninguna tabla salvo calendar_exceptions, que tenia un caso especial, y
  // nadie lo noto porque el informe lo mezclaba con el error del POST.
  //
  // Se afirma que la condicion se arma a partir de def.clave partido por comas, y que NO queda
  // ningun nombre de columna escrito a mano: un nombre a mano es justo lo que se desincroniza
  // cuando alguien cambia una clave.
  assert.match(cod, /function condicionDeClave\(def,\s*clave\)/,
    "condicionDeClave tiene que recibir la definicion, no el nombre de la tabla");
  assert.match(cod, /def\.clave[\s\S]{0,120}split\(","\)/,
    "las columnas tienen que salir de def.clave partido por comas");
  assert.doesNotMatch(cod, /tabla\s*!==\s*"calendar_exceptions"/,
    "no puede quedar un caso especial por tabla: es lo que se desincroniza al cambiar una clave");
  assert.doesNotMatch(cod, /and=\(fecha_inicio\.eq\./,
    "no puede quedar un filtro con el nombre de columna escrito a mano");
  assert.doesNotMatch(cod, /return\s+clave\s*\+\s*"=eq\."/,
    "el valor de la clave no puede usarse como nombre de columna");
});

test("la clave de una fila sale de def.clave, sin comparar contra una clave vieja", () => {
  // El segundo bug del mismo cambio: claveDeFila comparaba contra
  // "fecha_inicio,concepto,maquina", que era la clave VIEJA. Al cambiarla a
  // "fecha,concepto,maquina" el caso especial dejo de aplicar, la tabla cayo a
  // fila["fecha,concepto,maquina"] (undefined) y sus claves salian vacias: sus DELETES salian
  // como "clave natural ilegible".
  assert.doesNotMatch(cod, /def\.clave\s*===\s*"fecha_inicio,concepto,maquina"/,
    "claveDeFila no puede comparar contra una clave literal: se desincroniza al cambiarla");
  assert.doesNotMatch(cod, /"fecha_inicio,concepto,maquina"/,
    "no puede quedar la clave vieja escrita a mano");
  assert.match(cod, /function claveDeFila\(def,\s*fila\)/);
  assert.match(cod, /columnas\.length\s*===\s*1/,
    "una clave de una sola columna y una compuesta tienen que salir del mismo camino");
});

test("el informe separa el error de la subida del error del borrado", () => {
  // MEDIDO 2026-09-30: el informe hacia `error: error || previo.error`, mezclando el fallo del
  // POST con el del DELETE. Con un 42P01 del POST tapado, el 42703 del DELETE no se veia, y al
  // reves. Dos escrituras, un campo: el toast senalaba al sistema equivocado y costo una ronda
  // entera de investigacion.
  assert.match(cod, /errorPost:/, "el informe tiene que decir si fallo la subida");
  assert.match(cod, /errorDelete:/, "el informe tiene que decir si fallo el borrado");
  assert.match(cod, /paso:/, "y tiene que nombrar el paso, para que el toast lo diga");
  // Y el toast lo tiene que usar, no solo el informe.
  assert.match(codigo(app), /tablas\[tabla\]\.paso/,
    "el toast tiene que nombrar el paso que fallo");
});

test("la revision del plan se lee de app_state, y NO depende de los catalogos", () => {
  // MEDIDO 2026-09-30: la pagina estaba en revision 22 y la base en 2, y ningun guardado podia
  // pasar. El 22 era residuo de localStorage de la era de las Hojas, y se conservaba porque el
  // arranque tomaba la revision del MISMO payload que los catalogos: como readCatalogs() lee
  // del orden de 39 tablas y algunas dan 404, un fallo de catalogo se llevaba la revision y
  // dejaba un numero sin verificar. Un 22 contra una base en 2 no se puede guardar NUNCA.
  assert.match(reemplazo, /async function getAppStateRevision\(\)/,
    "tiene que existir una lectura de la revision que no toque los catalogos");
  assert.match(codigo(reemplazo), /readTable\("app_state"/,
    "la revision sale de app_state, que es la unica tabla con la revision DEL PLAN");
  assert.match(arranque, /getAppStateRevision\(\)/,
    "el arranque tiene que leerla");
  // Y tiene que ser ANTES del bloque de catalogos, con su propio try, para que un fallo de
  // catalogo no pueda decidir la revision.
  const posLectura = arranque.indexOf("getAppStateRevision()");
  const posCatalogos = arranque.indexOf("loadPlanSnapshots(false");
  assert.ok(posLectura > 0 && posCatalogos > 0, "no se localizaron las dos llamadas");
  assert.ok(posLectura < posCatalogos, "la revision tiene que leerse antes que los catalogos");
  assert.match(arranque, /No se pudo leer la revision de app_state/,
    "si esa lectura sola falla, el arranque lo dice y sigue, no se cae");
});

test("un fallo de catalogos NO puede dejar la pagina con una revision sin verificar", () => {
  // La forma de la trampa: que la revision y los catalogos vuelvan en el MISMO payload, para
  // que uno dependa del otro. Se afirma que la lectura de la revision esta en su propio bloque
  // try, y que despues hay OTRO try para el resto. Un solo try seria volver a atarlos.
  const i = arranque.indexOf("getAppStateRevision()");
  assert.ok(i > 0);
  const antes = arranque.slice(Math.max(0, i - 600), i);
  const despues = arranque.slice(i, i + 1200);
  assert.match(antes, /try\s*\{/, "la lectura de la revision abre su propio try");
  assert.match(despues, /catch[\s\S]{0,400}?\}\s*\n\s*try\s*\{/,
    "despues del catch de la revision tiene que abrir el try de los catalogos, aparte");
});
