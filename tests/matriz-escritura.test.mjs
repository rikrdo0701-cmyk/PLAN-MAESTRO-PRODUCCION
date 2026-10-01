// Candado de la matriz. MEDIDO 2026-09-30: la persona dijo que la matriz es manual y tiene que
// guardarse en Supabase, y que el listado de operaciones es de NetSuite.
//
// Se afirma contra lo MEDIDO en la base, no contra lo que el codigo supone:
//   operators        clave unica: nombre                       18 filas
//   matrix           clave unica: (capability_key, operator)  97 filas
//   operation_catalog clave unica: key                        86 filas, de NetSuite
// Y se afirma la regla que hace que desmarcar exista: la matriz se mapea desde la rejilla
// COMPLETA, no desde la de los habilitados.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const escritor = await readFile(new URL("../src/web/shared/supabase-writer.js", import.meta.url), "utf8");
const lector = await readFile(new URL("../src/web/shared/supabase-reader.js", import.meta.url), "utf8");

/** El cuerpo de un objeto del catalogo, por su tabla. */
function cuerpoDeCatalogo(txt, tabla) {
  const i = txt.indexOf('tabla: "' + tabla + '"');
  if (i < 0) throw new Error("no se encontro el catalogo " + tabla);
  const desde = txt.lastIndexOf("{", i);
  let nivel = 0;
  let fin = desde;
  for (; fin < txt.length; fin += 1) {
    if (txt[fin] === "{") nivel += 1;
    else if (txt[fin] === "}") { nivel -= 1; if (nivel === 0) break; }
  }
  return txt.slice(desde, fin + 1);
}

test("operators se escribe con la clave que MEDIMOS que existe: nombre", () => {
  // MEDIDO: operators tiene UNIQUE (nombre). Es la unica clave, y es la que el escritor
  // devuelve de state.operators, que es la lista de nombres.
  const c = cuerpoDeCatalogo(escritor, "operators");
  assert.match(c, /clave:\s*"nombre"/, "la clave tiene que ser la columna nombre, la unica con indice unico");
});

test("matrix se escribe con la clave COMPUESTA que MEDIMOS que existe", () => {
  // MEDIDO: matrix tiene UNIQUE (capability_key, operator), en ese orden. Con las columnas
  // invertidas Postgres no deduce el indice y contesta 42P10, que es el mismo 42P10 del
  // bug de calendar_exceptions.
  const c = cuerpoDeCatalogo(escritor, "matrix");
  assert.match(c, /clave:\s*"capability_key,operator"/,
    "la clave tiene que ser (capability_key, operator), en ese orden y sin espacios extras");
  assert.match(c, /capability_key:\s*key/, "la fila manda capability_key");
  assert.match(c, /operator:\s*operador/, "la fila manda operator");
});

test("la matriz se mapea desde la REJILLA COMPLETA, que es lo que hace que desmarcar exista", () => {
  // MEDIDO 2026-09-30: la tabla guarda la pareja con un booleano. El lector antes se comia las
  // filas con habilitado=false, o sea que el estado solo traia lo que SI, y un no no se puede
  // expresar como una AUSENCIA: con el borrado apagado, mandar solo las marcadas dejaria las
  // desmarcadas marcadas para siempre. Por eso tiene que salir de matrixFull.
  const c = cuerpoDeCatalogo(escritor, "matrix");
  assert.match(c, /state\.matrixFull/,
    "tiene que mapearse desde matrixFull (la rejilla completa), no desde state.matrix");
  assert.doesNotMatch(c, /state\.matrix\[/,
    "mapearlo desde state.matrix seria backtraer el bug: solo trae las marcadas");
  assert.match(c, /habilitado:\s*Boolean\(/,
    "tiene que mandar el booleano, marcado o no: no es una ausencia, es un valor");
  // Y el lector tiene que traer las dos.
  assert.match(lector, /function mapMatrixFull\(/, "el lector tiene que traer la rejilla completa");
  assert.match(lector, /matrixFull:\s*siSePudoLeer\(/, "y exponerla en el estado");
});

test("una pareja repetida en la rejilla se manda una vez", () => {
  // Sin esto, dos filas con la misma clave en el mismo POST darian 23505 y se perderia el
  // guardado ENTERO de la matriz, no solo una fila.
  const c = cuerpoDeCatalogo(escritor, "matrix");
  assert.match(c, /vistos\.has\(/, "tiene que deduplicar por la clave compuesta");
  assert.match(c, /vistos\.add\(/);
});

test("operation_catalog NO se escribe: es el listado de operaciones de NetSuite", () => {
  // La persona lo dijo: "el listado de operaciones es de NetSuite". Si la pagina lo escribiera,
  // pisaria el ERP con lo local, que es justo lo que se llevo por delante con article_configurations
  // (RULE-REP-021: el precio de venta lo baja el sync, no la pagina).
  assert.doesNotMatch(escritor, /tabla:\s*"operation_catalog"/,
    "operation_catalog no puede estar en el catalogo que escribe la pagina");
  // Y el aviso tiene que decirlo, para que la persona sepa que es a proposito. Se afirman
  // las dos mitades por separado porque el texto esta partido en varios literales pegados
  // con +, y buscar la frase entera daria un fallo que no dice nada del texto.
  assert.match(escritor, /operation_catalog es el listado de operaciones/,
    "el aviso tiene que decir que operation_catalog es el listado de operaciones");
  assert.match(escritor, /DE NETSUITE y no se toca desde la pagina/,
    "y que viene de NetSuite y no se toca desde la pagina");
});

test("capabilities NO se escribe, y el aviso dice por que", () => {
  // MEDIDO: capabilities tiene 15 columnas y el estado trae 9. Faltan ct y operacion, y el
  // lector solo da la lista de CT distintos, no el CT de cada capacidad. Escribirla mandaria
  // esas dos vacias en 76 filas. Es la misma clase de perdida que las 76 de ot_configurations.
  assert.doesNotMatch(escritor, /tabla:\s*"capabilities"/,
    "capabilities no se puede escribir todavia: se perderian ct y operacion");
  assert.match(escritor, /capabilities sigue SIN escribirse/,
    "y el aviso tiene que decirlo, no callar lo que no se guarda");
  assert.match(escritor, /faltan ct y operacion/,
    "el aviso tiene que nombrar las dos columnas que faltan, no decir 'no se guarda' a secas");
});
