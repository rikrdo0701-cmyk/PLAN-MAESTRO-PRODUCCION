// EL DDL DE `inspection_history` TIENE QUE ESTAR DE ACUERDO CON QUIEN LO ESCRIBE Y CON
// QUIEN LO LEE. MEDIDO 2026-10-01: sin este test, los tres viven en archivos distintos
// (el .sql, el escritor y el lector) y nada avisa cuando uno se mueve solo.
//
// QUE SE COMPRUEBA, Y CADA COSA POR QUE.
//
// 1. LAS DOCE COLUMNAS DE LA HOJA. `recordInspectionPrint` de Apps Script
//    (16-inspection-service.js:689) escribia doce celdas, declaradas en
//    `PP_Inspection_historySheet_` (mismo archivo, linea 666). Si el DDL deja de traer
//    una, la impresion se sigue dando PERO se pierde el dato: `printInspection` trata
//    el registro como no bloqueante y pregunta "¿Imprimir de todos modos?", asi que un
//    400 de PostgREST por una columna de mas NO se ve como error de columna, se ve como
//    "el historial no se guardo" generico.
//
// 2. LAS COLUMNAS DEL ESCRITOR Y LAS DEL LECTOR EXISTEN. El mismo fallo por los dos
//    lados: una columna que el escritor manda y el DDL no tiene es un 400; una que el
//    lector pide y no existe tambien, y el historial se ve vacio sin decir por que.
//
// 3. `fecha_hora` ES TEXTO Y `printed_at` ES timestamptz, Y ESTAN LAS DOS. El texto es
//    lo que la pagina muestra y lo que la hoja guardaba; el instante es lo que se
//    ordena. Si alguien "limpia" la tabla y convierte `fecha_hora` a timestamptz, la
//    pagina deja de pintar la fecha que imprimio la hoja, y si quita `printed_at` el
//    lector tiene que ordenar por texto: "01/02/2026" antes que "15/12/2025".
//    Mismo criterio que `actualizado` / `actualizado_at` de los tramos (RULE-INS-001).
//
// 4. NO HAY INDICE UNIQUE Y NO HAY `on_conflict`. Un UNIQUE sobre (ot, fecha_hora) con
//    `merge-duplicates` se traga la segunda impresion de una OT en el mismo segundo, y
//    el historial es justo la unica tabla donde dos filas iguales son dos hechos
//    distintos. Y por la misma razon la tabla NO va en la whitelist del espejo, que
//    borra.
//
// 5. RLS: `authenticated`, nunca `anon`. Se repite aqui aunque el guard general lo
//    cubra, porque ese guard recorre el DDL buscando tablas y si alguien borra el
//    archivo entero deja de ver la tabla sin avisar.
//
// 6. `updated_at` tiene disparador, aunque en un historial que solo inserta casi nunca
//    se dispare: la columna existe y un disparador que no esta es una columna que
//    miente si alguien la toca a mano.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = fileURLToPath(new URL("../", import.meta.url));
const DDL = await readFile(path.join(RAIZ, "docs/schema-inspection-history.sql"), "utf8");
const ESCRITOR = await readFile(path.join(RAIZ, "src/web/shared/supabase-writer.js"), "utf8");
const LECTOR = await readFile(path.join(RAIZ, "src/web/shared/supabase-reader.js"), "utf8");
const SERVIDOR = await readFile(path.join(RAIZ, "src/server/16-inspection-service.js"), "utf8");
const APLICADOR = await readFile(path.join(RAIZ, "src/web/shared/apps-script-ingesta-trigger.js"), "utf8");

const TABLA = "inspection_history";

/** El DDL sin comentarios: se afirma sobre SENTENCIAS, no sobre lo que el archivo
 *  dice que hace. Ver el porque en tests/ddl-inspection-routes.test.mjs: un regex
 *  encuentra el texto DENTRO del comentario que explica el bug y el test falla por
 *  su propia explicacion. */
function sqlSinComentarios(texto) {
  // MEDIDO 2026-10-03: el $ sin bandera m solo termina al final ABSOLUTO de la
  // string, no antes del \r de fin de linea. Con checkout CRLF (git i/lf, w/crlf
  // en este archivo; core.autocrlf=true) cada linea dividida terminaba en \r y
  // NINGUN comentario se quitaba: el extracto de columnas heredaba los comentarios
  // y las columnas que los siguen (ot, fecha_hora, alertas, sin_dibujo, detalle)
  // quedaban "sin declarar". Sin anclaje, .* devora hasta el \r y el corte es
  // portable LF/CRLF, como el del arnes de performance-client-calls.
  return texto.split("\n").map((l) => l.replace(/--.*/, "")).join("\n");
}

const ddl = sqlSinComentarios(DDL);

/** Todas las definiciones de la tabla en TODO docs/, no solo en su archivo. El cuerpo
 *  del CREATE TABLE se saca contando parentesis, no con `[^)]*`: la primera columna es
 *  `id uuid primary key default gen_random_uuid()` y un extractor que se para en el
 *  primer `)` se queda con media tabla. */
async function columnasDeLaTabla() {
  const dir = path.join(RAIZ, "docs");
  const archivos = (await readdir(dir)).filter((n) => n.endsWith(".sql"));
  const texto = (await Promise.all(archivos.map((n) => readFile(path.join(dir, n), "utf8"))))
    .map(sqlSinComentarios)
    .join("\n");
  const cols = new Set();

  const inicio = texto.search(new RegExp(`create table (?:if not exists )?public\\.${TABLA}\\s*\\(`, "i"));
  assert.ok(inicio >= 0, `no se encontro el CREATE TABLE de ${TABLA} en NINGUN .sql de docs/: este test no puede affirmar sobre columnas que no encuentra`);
  let depth = 0;
  let fin = -1;
  for (let i = texto.indexOf("(", inicio); i < texto.length; i += 1) {
    if (texto[i] === "(") depth += 1;
    else if (texto[i] === ")") {
      depth -= 1;
      if (depth === 0) { fin = i; break; }
    }
  }
  assert.ok(fin > inicio, "el cuerpo del CREATE TABLE no se cerro: el extractor de columnas esta fallando y el test pasaria por el motivo equivocado");
  for (const linea of texto.slice(inicio, fin).split(",")) {
    const m = linea.trim().match(/^([a-z_]+)\s/i);
    if (m) cols.add(m[1].toLowerCase());
  }

  const alta = texto.match(new RegExp(`alter table public\\.${TABLA}\\s+add column (?:if not exists )?([a-z_]+)`, "gi"));
  for (const m of alta || []) cols.add(m[1].toLowerCase());
  return cols;
}

const COLUMNAS = await columnasDeLaTabla();

/** TODOS los .sql de docs/, sin comentarios. Se usa para comprobar que la FUNCION del
 *  disparador existe en algun DDL: un trigger que apunte a `pp_set_updated_at()` y que
 *  nadie haya creado compila igual de bien, y el error sale al aplicar. */
const TODOS_LOS_SQL = (await (async () => {
  const dir = path.join(RAIZ, "docs");
  const archivos = (await readdir(dir)).filter((n) => n.endsWith(".sql"));
  return (await Promise.all(archivos.map((n) => readFile(path.join(dir, n), "utf8")))).map(sqlSinComentarios).join("\n");
})());

/** El cuerpo del CREATE TABLE del historial, para afirmar sobre tipos. */
function cuerpoTablaDeLaHoja() {
  const cuerpo = ddl.slice(ddl.search(new RegExp(`create table (?:if not exists )?public\\.${TABLA}\\s*\\(`, "i")));
  return cuerpo.slice(0, cuerpo.indexOf("\n);") + 3);
}

/** Las doce celdas de `PP_Inspection_historySheet_`, tal como el servidor las declara.
 *  La cabecera esta partida en dos lineas, asi que se lee el bloque entero entre
 *  corchetes en vez de una sola linea. */
function columnasDeLaHoja() {
  const inicio = SERVIDOR.indexOf("function PP_Inspection_historySheet_");
  assert.ok(inicio >= 0, "no se encontro PP_Inspection_historySheet_ en 16-inspection-service.js: la lista de columnas de la hoja se leeria de la nada");
  const fn = SERVIDOR.slice(inicio, SERVIDOR.indexOf("\n}", inicio));
  assert.match(fn, /PP_INSPECTION_HISTORY_SHEET/, "la hoja del historial se abre por una constante: si cambio de hoja, este test tiene que avisar");
  const m = fn.match(/\[\s*'FECHA_HORA'([\s\S]*?)\]/);
  assert.ok(m, "no se encontro la cabecera de columnas de la hoja; el mapa de abajo seria una lista inventada");
  return [m[0].replace(/^\[|\]$/g, "")]
    .flatMap((bloque) => bloque.split(","))
    .map((c) => c.trim().replace(/^['"]|['"]$/g, "").toLowerCase())
    .filter(Boolean);
}

/** Las columnas que el escritor manda en el cuerpo de guardarInspectionPrint. */
function columnasDelEscritor() {
  const inicio = ESCRITOR.indexOf("async function guardarInspectionPrint");
  assert.ok(inicio >= 0, "no se encontro guardarInspectionPrint en supabase-writer.js: este test no puede affirmar sobre un escritor que no existe");
  const fn = ESCRITOR.slice(inicio);
  const cuerpo = fn.slice(0, fn.indexOf("\n  }"));
  return new Set([...cuerpo.matchAll(/^\s{6}([a-z_]+):/gm)].map((m) => m[1]));
}

/** Las columnas que el lector pide en el `select` de readInspectionHistory. El `select`
 *  esta armado por concatenacion (`select = "a,b" + "c,d"`), asi que se lee la
 *  expresion completa y se juntan los trozos de cadena. */
function columnasDelLector() {
  const inicio = LECTOR.indexOf('const select = "ot,fecha_hora');
  assert.ok(inicio >= 0, "no se encontro el select armado de readInspectionHistory en supabase-reader.js: si se reescribio, este test esta mintiendo");
  const fin = LECTOR.indexOf(';', inicio);
  const expr = LECTOR.slice(inicio, fin);
  const trozos = [...expr.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  return new Set(trozos.join(",").split(",").map((c) => c.trim().toLowerCase()).filter(Boolean));
}

/** El nombre de la tabla donde el escritor manda el POST, y si lleva on_conflict. */
function escrituraDelHistorial() {
  const m = ESCRITOR.match(/pedir\(token,\s*"(POST|PATCH)",\s*"inspection_history",\s*\{([\s\S]*?)\}\)/);
  assert.ok(m, "no se encontro el POST a inspection_history en guardarInspectionPrint");
  const cuerpo = m[2];
  return { metodo: m[1], onConflict: /onConflict/.test(cuerpo) };
}

test("el DDL declara la tabla inspection_history", () => {
  assert.match(
    ddl,
    new RegExp(`create table (?:if not exists )?public\\.${TABLA}\\s*\\(`, "i"),
    "docs/schema-inspection-history.sql tiene que crear la tabla; sin ella el escritor estara bien y la base no lo tendra",
  );
});

test("1. las DOCE columnas de la hoja existen, con el nombre de la hoja y no otro", () => {
  const hoja = columnasDeLaHoja();
  assert.equal(hoja.length, 12, `la hoja declara 12 columnas y el test encontro ${hoja.length}: revisa el extractor antes de culpar al DDL`);
  const mapeo = {
    fecha_hora: "fecha_hora",
    wo: "ot",
    articulo: "articulo",
    cantidad: "cantidad",
    estado_trabajo: "estado_trabajo",
    semaforo: "semaforo",
    alertas: "alertas",
    materiales_pendientes: "materiales_pendientes",
    materiales_deficit: "materiales_deficit",
    sin_dibujo: "sin_dibujo",
    falta_tramo: "falta_tramo",
    detalle_json: "detalle",
  };
  const faltantes = hoja.filter((columna) => !COLUMNAS.has(mapeo[columna]));
  assert.deepEqual(faltantes, [], `el DDL no declara la columna de ${faltantes.join(", ")}`);
  // Y al reves: una columna de la hoja que NO se guarda pierde el dato. `ot` y
  // `detalle` se llaman distinto a proposito (`WO` y `DETALLE_JSON` son nombres de hoja),
  // asi que el mapa de arriba es la unica fuente de verdad de esa traduccion.
  for (const columna of Object.values(mapeo)) {
    assert.equal(COLUMNAS.has(columna), true, `el mapa hoja->tabla dice ${columna} pero el DDL no la declara`);
  }
});

test("2. TODAS las columnas que manda el escritor y las que pide el lector existen", () => {
  const enviadas = columnasDelEscritor();
  assert.equal(enviadas.size > 0, true, "el test no encontro el cuerpo de guardarInspectionPrint; si se renombro, este test esta mintiendo");
  const pedidas = columnasDelLector();
  assert.equal(pedidas.size > 0, true, "el test no encontro el select de readInspectionHistory; si se renombro, este test esta mintiendo");

  const faltantesEscritor = [...enviadas].filter((c) => !COLUMNAS.has(c));
  assert.deepEqual(faltantesEscritor, [], `el escritor manda columnas que el DDL no declara: ${faltantesEscritor.join(", ")}. Cada impresion seria un 400 de PostgREST, y como el registro no es bloqueante, se veria como un confirm genérico.`);

  const faltantesLector = [...pedidas].filter((c) => !COLUMNAS.has(c));
  assert.deepEqual(faltantesLector, [], `el lector pide columnas que el DDL no declara: ${faltantesLector.join(", ")}. El historial devolveria 400 y la tarjeta de la pagina diria que no se pudo leer.`);
});

test("3. `fecha_hora` es texto, `printed_at` es timestamptz, y estan LAS DOS", () => {
  const cuerpo = ddl.slice(ddl.search(new RegExp(`create table (?:if not exists )?public\\.${TABLA}\\s*\\(`, "i")));
  const cuerpoTabla = cuerpo.slice(0, cuerpo.indexOf("\n);") + 3);
  assert.match(cuerpoTabla, /^\s*fecha_hora\s+text\s+not null/m, "fecha_hora es el texto VERBATIM que la pagina muestra; si pasa a timestamptz, deja de pintarse la fecha que imprimio la hoja");
  assert.match(cuerpoTabla, /^\s*printed_at\s+timestamptz/m, "printed_at es el instante con tipo: sin el, el lector ordena por texto y '01/02/2026' queda antes que '15/12/2025'");
  // Y el lector tiene que usar el instante para ordenar y el texto para pintar. Si
  // invirtiera las dos columnas, el orden seria correcto y la fecha mostrada seria la
  // de la fila equivocada: un fallo que no se ve en el total.
  const fn = LECTOR.slice(LECTOR.indexOf("async function readInspectionHistory"));
  const cuerpoFn = fn.slice(0, fn.indexOf("\n  }"));
  assert.match(cuerpoFn, /order:\s*"printed_at\.desc\.nullslast/, "el historial se ordena por printed_at DESC con NULLS LAST: en PostgreSQL un desc pone los NULLS PRIMERO, y las filas sin instante son las MAS VIEJAS del importador");
  assert.match(cuerpoFn, /item\.printedAt\b/, "lo que se muestra es `printedAt`, que sale del texto de fecha_hora, no del instante");
});

test("4. NO hay indice UNIQUE, NO hay on_conflict, y la tabla NO esta en la whitelist del espejo", () => {
  const indices = [...ddl.matchAll(new RegExp(`create (unique )?index (?:if not exists )?\\S+\\s+on public\\.${TABLA}\\s*\\(([^)]*)\\)`, "gi"))]
    .map((m) => ({ unique: Boolean(m[1]), cols: m[2] }));
  assert.ok(indices.length >= 1, "sin ningun indice la pagina filtra el historial por `ot` sobre la tabla entera; con 12 columnas y pocas impresiones aguanta, pero la busqueda crece sin control");
  assert.equal(
    indices.some((i) => i.unique),
    false,
    "un UNIQUE en un historial se come impresiones: dos impresiones de la misma OT en el mismo segundo son DOS hechos",
  );
  assert.match(ddl, /create index if not exists inspection_history_ot_idx on public\.inspection_history\s*\(ot\)/i, "el indice por `ot` es el que usa `getInspectionHistory`");

  const escritura = escrituraDelHistorial();
  assert.equal(escritura.metodo, "POST", "el historial se INSERTA; un PATCH sobre una tabla sin clave natural no tiene a que actualizar");
  assert.equal(escritura.onConflict, false, "`on_conflict` en un historial con indice UNIQUE sobre (ot, fecha_hora) se traga la segunda impresion de la misma OT en el mismo segundo");

  const enWhitelist = new RegExp(`insert into public\\.ingesta_mirror_whitelist[^;]*'${TABLA}'[^;]*;`, "i").test(ddl);
  assert.equal(enWhitelist, false, "esta tabla NO va en la whitelist: ingesta_mirror BORRA la tabla y re-inserta el payload, y un historial no se repone borrando (RULE-SUP-021)");
  // Y que el disparador de la pagina tampoco la mande por el espejo.
  assert.doesNotMatch(APLICADOR, new RegExp(TABLA), `apps-script-ingesta-trigger.js menciona ${TABLA}: el espejo borraria el historial en la proxima corrida de la ingesta`);
});

test("5. la escritura es para `authenticated` y NO para `anon`", () => {
  const politicas = [...ddl.matchAll(new RegExp(`create policy\\s+(\\S+)\\s+on public\\.${TABLA}\\s+for\\s+(\\w+)\\s+to\\s+([\\w\\s,]+)`, "gi"))]
    .map((m) => ({ nombre: m[1], para: m[2].toLowerCase(), roles: m[3].toLowerCase() }));
  assert.ok(politicas.length > 0, "no hay ninguna politica: con RLS habilitado y sin politicas la tabla no se lee ni se escribe, y la pagina no lo distingue de \"nadie ha impreso\"");
  assert.ok(politicas.some((p) => p.para === "select" && p.roles.includes("authenticated")), "falta la politica de lectura para authenticated");
  assert.ok(politicas.some((p) => (p.para === "all" || p.para === "insert" || p.para === "update") && p.roles.includes("authenticated")), "falta la politica de escritura para authenticated");
  assert.equal(politicas.some((p) => p.roles.includes("anon")), false, "una fila de este historial dice que OT se imprimio, cuando y con que semaforo: abrirla a anon daria el plan de produccion a cualquiera que abra la pagina (RULE-SUP-015)");
  assert.match(ddl, /alter table public\.inspection_history enable row level security/i, "sin `enable row level security` las politicas de abajo no aplican y la tabla queda abierta para el rol `anon` aunque las politicas digan `authenticated`");
});

test("6. `updated_at` tiene disparador, o la columna miente la antiguedad", () => {
  assert.equal(COLUMNAS.has("updated_at"), true, "la columna tiene que existir para que el disparador tenga algo que actualizar");
  assert.match(ddl, /create trigger\s+inspection_history_set_updated_at[\s\S]*before update on public\.inspection_history/i);
  const fn = ddl.match(/create trigger\s+inspection_history_set_updated_at[\s\S]*?execute function\s+([a-z_]+(?:\.[a-z_]+)?)\s*\(\s*\)\s*;/i);
  assert.ok(fn, "el disparador no dice que funcion ejecuta");
  assert.match(TODOS_LOS_SQL, new RegExp(`create or replace function\\s+${fn[1].replace(".", "\\.")}\\s*\\(`, "i"), `el disparador llama a ${fn[1]}() y ningun DDL de docs/ la crea: el error sale al aplicar, no al leer el archivo`);
});

/**
 * Y la coherencia entre el mapeo del ESCRITOR y el del LECTOR, que estan en dos
 * archivos y no se comparan entre si. Si el escritor guardara el separador `" | "` y
 * el lector lo dividiera por `","`, el historial se veria bien (la pagina pinta el texto
 * entero) y el conteo de alertas de cada impresion estaria mal para siempre.
 */
test("el separador de las listas de la hoja es el mismo en el que escribe y en el que se lee", () => {
  const servidor = SERVIDOR.slice(SERVIDOR.indexOf("function recordInspectionPrint"));
  const cuerpoServidor = servidor.slice(0, servidor.indexOf("\n}"));
  assert.ok(
    cuerpoServidor.includes("join(' | ')"),
    "recordInspectionPrint de Apps Script unia las listas con ' | '; si el escritor usa otro separador, la hoja y la tabla no dicen lo mismo",
  );

  const inicio = ESCRITOR.indexOf("async function guardarInspectionPrint");
  const escritor = ESCRITOR.slice(inicio, ESCRITOR.indexOf("\n  }", inicio));
  assert.ok(
    escritor.includes('.join(" | ")'),
    "el escritor tiene que unir con ' | ', el mismo separador que usaba la hoja",
  );
  // Y el separador del `material: cantidad` se afirma sobre el AYUDANTE `lista`, no
  // sobre el cuerpo entero: hay dos uniones con " | " (la de `alertas` y la de la
  // lista), y si la del ayudante pasara a "," el test seguiria viendo la de `alertas`
  // y no avisaria. El texto que se veria en la columna seria "TUBO:5, TUBO2:3" donde la
  // hoja ponia "TUBO:5 | TUBO2:3", y nadie lo notaria hasta que alguien buscara una
  // alerta concreta en la hoja vieja.
  const ayudante = escritor.slice(escritor.indexOf("const lista = function"), escritor.indexOf("const cuerpo = {"));
  assert.ok(ayudante.length > 0, "no se encontro el ayudante `lista` de guardarInspectionPrint");
  assert.match(ayudante, /\.join\(" \| "\)/, "los materiales pendientes y con deficit se unen con ' | ', como los unia la hoja");
  assert.match(escritor, /alertas:[\s\S]{0,200}?\.join\(" \| "\)/, "las alertas se unen con ' | '");

  // Y el `SI`/`NO` de `sin_dibujo` / `falta_tramo` es TEXTO en la hoja y texto en la
  // columna: un boolean seria mas comodo de filtrar, pero cambiar lo que se guarda
  // cambia lo que se lee, y la regla de este proyecto es no cambiar un dato al
  // migrarlo sin que nadie lo pida.
  assert.match(escritor, /sin_dibujo:\s*\(fila && \([^)]+\)\)\s*\?\s*"SI"\s*:\s*"NO"/, "sin_dibujo se escribe como 'SI'/'NO', igual que la hoja");
  assert.match(escritor, /falta_tramo:\s*\(fila && \([^)]+\)\)\s*\?\s*"SI"\s*:\s*"NO"/, "falta_tramo se escribe como 'SI'/'NO', igual que la hoja");
  assert.match(cuerpoTablaDeLaHoja(), /sin_dibujo\s+text\s+not null default 'NO'/i, "la columna es texto y no boolean");
});
