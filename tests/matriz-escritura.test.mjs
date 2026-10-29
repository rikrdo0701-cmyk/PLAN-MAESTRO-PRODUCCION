// Candado de la matriz. MEDIDO 2026-09-30: la persona dijo que la matriz es manual y tiene que
// guardarse en Supabase, y que el listado de operaciones es de NetSuite.
//
// Se afirma contra lo MEDIDO en la base, no contra lo que el codigo supone:
//   operators        clave unica: nombre                       18 filas
//   matrix           clave unica: (capability_key, operator)  97 filas
//   operation_catalog clave unica: key                        86 filas, de NetSuite
//
// Y se afirma la regla de las DOS fuentes que hace que desmarcar exista: el UNIVERSO de
// parejas sale de la rejilla COMPLETA (state.matrixFull, lo que trae el lector) y el VALOR
// sale de state.matrix, que es lo que edita la persona. MEDIDO 2026-10-06: separar mal esas
// dos fuentes fue el bug que subio 0 filas y acuso 97 "fuera" (RULE-SUP-060).
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const escritor = await readFile(new URL("../src/web/shared/supabase-writer.js", import.meta.url), "utf8");
const lector = await readFile(new URL("../src/web/shared/supabase-reader.js", import.meta.url), "utf8");
const APP = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");

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

/**
 * Corre el escritor DE VERDAD (su armarCatalogos, sin red) contra un estado de mentira.
 * Es el mismo criterio que tests/supabase-writer.test.mjs: afirmar sobre el mapeo que se
 * subiria, no sobre una copia de la logica escrita en la prueba.
 */
function filasDeMatrix(estado) {
  const contexto = {
    console,
    AbortController, setTimeout, clearTimeout, Math, Date, JSON, Object, Array,
    Promise, String, Number, Boolean, Error, RegExp, isFinite, parseInt,
    encodeURIComponent, atob,
    PPSupabaseAuth: { token: async () => null, configurado: false },
    PPSupabaseReader: { isConfigured: () => false, config: () => null },
    fetch: async () => { throw new Error("sin red en esta prueba"); },
  };
  contexto.globalThis = contexto;
  vm.createContext(contexto);
  vm.runInContext(escritor, contexto, { filename: "supabase-writer.js" });
  const filas = contexto.PPSupabaseWriter.armarCatalogos(estado).matrix.filas;
  // JSON por una razon de realm: el objeto viene de otro contexto de vm y su prototipo no
  // es el de este proceso, asi que deepStrictEqual lo veria como distinto aunque sea igual.
  return JSON.parse(JSON.stringify(filas));
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

test("la matriz manda el UNIVERSO de matrixFull y el VALOR de state.matrix", () => {
  // MEDIDO 2026-09-30: la tabla guarda la pareja con un booleano. El lector antes se comia las
  // filas con habilitado=false, o sea que el estado solo traia lo que SI, y un no no se puede
  // expresar como una AUSENCIA: con el borrado apagado, mandar solo las marcadas dejaria las
  // desmarcadas marcadas para siempre. Por eso el universo tiene que salir de matrixFull.
  //
  // MEDIDO 2026-10-06 (RULE-SUP-060): el VALOR tenia que salir tambien de la rejilla, y la
  // rejilla nace en el arrancar y nadie la actualiza (toggleMatrix, removeCapability,
  // removeOperator y renameOperator tocan state.matrix y solo state.matrix), asi que un
  // false nunca se reflejaba. Peor aun: applyImported no mapeaba imported.matrixFull, la
  // rejilla llegaba vacia y el escritor subia 0 filas mientras acusaba 97 "fuera".
  // Una sola fuente no sirve para las dos cosas: state.matrix no trae las DESMARCADAS y la
  // rejilla no trae las MARCADAS nuevas.
  const c = cuerpoDeCatalogo(escritor, "matrix");
  assert.match(c, /state\.matrixFull/,
    "el universo de parejas tiene que salir de matrixFull (la rejilla completa leida)");
  assert.match(c, /typeof state\.matrix === "object"/,
    "el valor tiene que salir de state.matrix, que es lo que edita la persona");
  assert.match(c, /habilitado:\s*Boolean\(/,
    "tiene que mandar el booleano, marcado o no: no es una ausencia, es un valor");
  // Y el lector tiene que traer las dos.
  assert.match(lector, /function mapMatrixFull\(/, "el lector tiene que traer la rejilla completa");
  assert.match(lector, /matrixFull:\s*siSePudoLeer\(/, "y exponerla en el estado");
});

test("applyImported pasa la rejilla leida a state.matrixFull (el eslabon que faltaba)", () => {
  // La cadena exacta del bug del 2026-10-06: el lector traia matrixFull en catalogs,
  // clavesLeidas la usaba para calcular las 97 claves, pero applyImported solo mapeaba
  // imported.matrix. state.matrixFull quedaba undefined, el escritor mapeaba [] y
  // guardarCatalogos reportaba "0 filas subidas, 97 que el navegador ya no tiene".
  assert.match(APP,
    /if \(Array\.isArray\(imported\.matrixFull\)\) state\.matrixFull = imported\.matrixFull;/,
    "applyImported tiene que pasar la rejilla leida a state.matrixFull, junto a imported.matrix");
});

test("lo que la persona desmarco se manda como false aunque la rejilla lo traiga marcado", () => {
  // El caso de desmarcar: la rejilla llego con AMBAS marcadas al arrancar, la persona quito
  // a BERTA. Sin el valor derivado de state.matrix, la celda conservaria habilitado: true y
  // la desmarcada se quedaria marcada para siempre (con el borrado apagado no hay DELETE).
  const filas = filasDeMatrix({
    matrixFull: [
      { capabilityKey: "120::FRESADO", operator: "ALFREDO", habilitado: true },
      { capabilityKey: "120::FRESADO", operator: "BERTA", habilitado: true },
    ],
    matrix: { "120::FRESADO": ["ALFREDO"] },
  });
  assert.deepEqual(filas, [
    { capability_key: "120::FRESADO", operator: "ALFREDO", habilitado: true },
    { capability_key: "120::FRESADO", operator: "BERTA", habilitado: false },
  ]);
});

test("una marca nueva que el universo no conoce se sube con true", () => {
  // La rejilla nace en el arrancar: una casilla marcada DESPUES no esta en ella. Si el
  // mapeo solo recorriera la rejilla, la marca nueva no se subiria nunca.
  const filas = filasDeMatrix({
    matrixFull: [],
    matrix: { "120::FRESADO": ["CARLOS"] },
  });
  assert.deepEqual(filas, [
    { capability_key: "120::FRESADO", operator: "CARLOS", habilitado: true },
  ]);
});

test("MEDIDO 2026-10-06: sin la rejilla poblada ya no se suben 0 filas", () => {
  // Regresion directa del bug: state.matrixFull undefined NO puede significar "nada que
  // subir" mientras state.matrix tenga marcas. Lo que falto el 2026-10-06 era el mapeo en
  // applyImported (candado de arriba), y esta prueba fija el sintoma que se vio.
  const filas = filasDeMatrix({
    matrix: { "120::FRESADO": ["ALFREDO"] },
  });
  assert.deepEqual(filas, [
    { capability_key: "120::FRESADO", operator: "ALFREDO", habilitado: true },
  ]);
});

test("sin state.matrix no se manda la matriz entera en false", () => {
  // state.matrix es lo que decide el valor, pero si NO existe (un arranque a medias, un
  // puente que no lo trajo) derivar todo en false seria desmarcar la matriz entera sin que
  // nadie lo pidiera. En ese caso manda la rejilla con su habilitado, que es el
  // comportamiento anterior: no empeora lo que ya sabemos hacer.
  const filas = filasDeMatrix({
    matrixFull: [{ capabilityKey: "120::FRESADO", operator: "ALFREDO", habilitado: false }],
  });
  assert.deepEqual(filas, [
    { capability_key: "120::FRESADO", operator: "ALFREDO", habilitado: false },
  ]);
});

test("una pareja repetida en la rejilla se manda una vez", () => {
  // Sin esto, dos filas con la misma clave en el mismo POST darian 23505 y se perderia el
  // guardado ENTERO de la matriz, no solo una fila. Ahora hay DOS pasadas (rejilla y
  // marcas), asi que el dedup tiene que cubrir tambien una pareja que este en las dos.
  const c = cuerpoDeCatalogo(escritor, "matrix");
  assert.match(c, /vistos\.has\(/, "tiene que deduplicar por la clave compuesta");
  assert.match(c, /vistos\.add\(/);
  const filas = filasDeMatrix({
    matrixFull: [
      { capabilityKey: "120::FRESADO", operator: "ALFREDO", habilitado: true },
      { capabilityKey: "120::FRESADO", operator: "ALFREDO", habilitado: true },
    ],
    matrix: { "120::FRESADO": ["ALFREDO"] },
  });
  assert.equal(filas.length, 1, "la pareja repetida (rejilla x2, mas la marcada) se manda una sola vez");
});

test("operation_catalog NO se escribe: es el listado de operaciones de NetSuite", () => {
  // La persona lo dijo: "el listado de operaciones es de NetSuite". Si la pagina lo escribiera,
  // pisaria el ERP con lo local, que es justo lo que se llevo por delante con article_configurations
  // (RULE-REP-021: el precio de venta lo baja el sync, no la pagina).
  assert.doesNotMatch(escritor, /tabla:\s*"operation_catalog"/,
    "operation_catalog no puede estar en el catalogo que escribe la pagina");
  // MEDIDO 2026-09-30: el aviso se acorto a UNA FRASE porque el texto largo (~470
  // caracteres) no cabia en un toast de 360px y salia cortado por abajo, sin final.
  // Ahora el aviso dice que operation_catalog es de NetSuite, y el "y que no se toca"
  // esta en el codigo, que es donde lo lee quien tenga que arreglarlo.
  assert.match(escritor, /operation_catalog \(de NetSuite\)/,
    "el aviso tiene que decir que operation_catalog es de NetSuite");
  assert.match(escritor, /pisaria el ERP/,
    "y el motivo de no tocarla (pisaria el ERP) tiene que estar escrito en el codigo");
});

test("capabilities NO se escribe, y el aviso dice por que", () => {
  // MEDIDO: capabilities tiene 15 columnas y el estado trae 9. Faltan ct y operacion, y el
  // lector solo da la lista de CT distintos, no el CT de cada capacidad. Escribirla mandaria
  // esas dos vacias en 76 filas. Es la misma clase de perdida que las 76 de ot_configurations.
  assert.doesNotMatch(escritor, /tabla:\s*"capabilities"/,
    "capabilities no se puede escribir todavia: se perderian ct y operacion");
  assert.match(escritor, /NO capabilities/,
    "y el aviso tiene que decirlo, no callar lo que no se guarda");
  assert.match(escritor, /ct y operacion/,
    "las dos columnas que le faltan a la pagina tienen que estar escritas en el codigo");
});
