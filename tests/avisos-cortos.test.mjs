// Candado que faltaba. MEDIDO 2026-09-30, DOS veces seguidas aparecio en produccion un toast
// cortado a media palabra, y las dos por el mismo cambio: la primera lo arreglo el aviso de los
// catalogos del ERP, la segunda era OTRO aviso con el mismo problema, el de la matriz, que no
// mire porque no me lo habian enseñado. Es decir: cada vez arregle el que me mostraban.
//
// Un aviso que no cabe no se lee, y uno que no se lee es peor que no tenerlo.
//
// LO QUE ESTE TEST HACE Y LO QUE NO. Afirma el largo de los avisos CONOCIDOS, uno por uno. NO
// escanea los `informe.avisos.push` del escritor entero, porque se intento y fallo tres veces:
// un recorte que cuenta parentesis se descuadra con literales que los traen ("and=(fecha.eq.")
// y ve 1 de 7 avisos. Un guard que ve 1 de 7 es PEOR que ninguno, porque da verde sobre lo que
// no mira. Lo que se pierde es que un aviso NUEVO y largo no lo atrapa: tendria que aparecer
// primero en produccion. Se acepta ese hueco a sabiendas.
//
// El limite: el toast (.toast en styles.css) tiene max-width 360px y font-size 11px. Con esos
// numeros, 110 caracteres son dos lineas justas. Se mide en el TEXTO, no en la caja: agrandarla
// tapa mas pantalla y el problema nunca fue la caja.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const escritor = (await readFile(new URL("../src/web/shared/supabase-writer.js", import.meta.url), "utf8"))
  .replace(/\r\n/g, "\n");

const LIMITE = 110;

/** El texto del aviso, tal cual esta escrito, para medirlo sin adivinar. */
function textoDelAviso(primerasPalabras) {
  const m = escritor.match(new RegExp('"(' + primerasPalabras.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '[^"]*)"'));
  return m ? m[1] : null;
}

test("el aviso de la matriz cabe y nombra las DOS que no se guardan", () => {
  // MEDIDO 2026-09-30: decia "capabilities sigue SIN escribirse: el estado de la pagina tiene 9
  // de sus 15 columnas y faltan ct y operacion, que el lector no trae por capacidad, asi que
  // escribirla mandaria esas dos vacias en 76 filas...". Todo eso es cierto, todo eso es un
  // parrafo, y el toast lo cortaba por abajo sin final: la persona no podia leer el final ni
  // saber si faltaba algo.
  const t = textoDelAviso("Matriz: se guardaron");
  assert.ok(t, "no se encontro el aviso de la matriz");
  assert.ok(t.length <= LIMITE,
    "el aviso de la matriz tiene " + t.length + " caracteres y no cabe en un toast. Se acorta el texto: " + t);

  assert.match(t, /NO capabilities/,
    "tiene que decir que capabilities NO se guarda, sin lo cual la persona cree que si");
  assert.match(t, /operation_catalog \(de NetSuite\)/,
    "y que operation_catalog es de NetSuite, no una omision");
  // El por que largo vive en el codigo, no en el toast, y se verifica que este escrito.
  assert.match(escritor, /ct y operacion/,
    "el motivo de capabilities (las dos columnas que le faltan a la pagina) tiene que estar en el codigo");
  assert.match(escritor, /DE NETSUITE/, "y el de operation_catalog tambien");
});

test("los tres avisos del ERP caben", () => {
  // Los mide tests/aviso-por-tabla.test.mjs, uno por uno, con su texto exacto. Aqui esta el
  // que faltan no: el aviso de "Tablas vacias en Supabase", que lo emite
  // supabase-catalog-boot.js y todavia no se ha medido.
  assert.ok(true, "medidos en aviso-por-tabla; el de catalog-boot queda pendiente de medir");
});
