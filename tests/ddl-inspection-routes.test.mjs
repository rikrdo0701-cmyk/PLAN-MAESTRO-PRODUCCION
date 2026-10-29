// EL DDL DE `inspection_routes` TIENE QUE ESTAR DE ACUERDO CON QUIEN LO ESCRIBE Y
// CON QUIEN LO LEE. Sin este test, los tres viven en archivos distintos y nada
// avisa cuando uno se mueve solo.
//
// POR QUE ESTE TEST Y NO UNO MAS DE LOS QUE YA HAY. El divisor de sentencias
// (tests/apply-sql-split.test.mjs) mira que el DDL se pueda aplicar; el guard de
// RLS (tests/ddl-politicas-sin-anon.test.mjs) que no se abra a anon. Ninguno de
// los dos sabe que `inspection_routes` existe, y ninguno mira si la columna que el
// escritor manda existe en la tabla. Ese es el hueco: tres archivos (el DDL, el
// escritor y el lector) que comparten un contrato escrito en prosa.
//
// QUE SE COMPRUEBA, Y CADA COSA POR QUE.
//
// 1. `clave` ES COLUMNA Y ES UNIQUE COMPLETO. El escritor manda on_conflict=clave.
//    PostgREST solo lo resuelve contra un indice unico sobre COLUMNAS (RULE-SUP-032):
//    un indice de expresion, uno parcial o una columna que no exista dan 42P01, y el
//    guardado del tramo falla entero.
//
// 2. TODAS LAS COLUMNAS QUE MANDA EL ESCRITOR EXISTEN EN EL DDL. Un `dibujo` que
//    no este en la tabla es un 400 de PostgREST en cada guardado de tramo, y el
//    mensaje no dice que columna. Este test corre el DDL por TODOS los .sql de
//    docs/ y no solo por el suyo, porque una tabla se puede crear en un archivo y
//    alterarse en otro: es lo que paso con `operations` en
//    docs/schema-supabase-plan.sql.
//
// 3. TODAS LAS COLUMNAS QUE PIDE EL LECTOR EXISTEN. El lector hace `select=...` y
//    si uno de los nombres no esta, PostgREST devuelve 400 y el listado de tramos
//    no aparece. Es el mismo fallo por el otro lado de la misma frase.
//
// 4. LA TABLA ESTA EN LA WHITELIST DE ingesta_mirror. Sin esa fila el RPC rechaza
//    p_tabla y el importador no puede volcar la hoja, que es el paso que deja la
//    tabla con datos.
//
// 5. LA POLITICA DE ESCRITURA ES PARA `authenticated`, NO PARA `anon`. Se repite
//    aqui a proposito: el guard general lo cubre, y si alguien borra el DDL entero
//    el guard deja de ver la tabla sin avisar. Este test lee el archivo por su
//    nombre.
//
// 6. `updated_at` TIENE DISPARADOR. Sin el, la columna se queda en el valor del
//    INSERT para siempre y "cuando se modifico esto" responde una mentira.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = fileURLToPath(new URL("../", import.meta.url));
const DDL = await readFile(path.join(RAIZ, "docs/schema-inspection-routes.sql"), "utf8");
const ESCRITOR = await readFile(path.join(RAIZ, "src/web/shared/supabase-writer.js"), "utf8");
const LECTOR = await readFile(path.join(RAIZ, "src/web/shared/supabase-reader.js"), "utf8");
const SERVIDOR = await readFile(path.join(RAIZ, "src/server/16-inspection-service.js"), "utf8");

const TABLA = "inspection_routes";

/** El DDL sin comentarios: se afirma sobre SENTENCIAS, no sobre lo que el archivo
 *  dice que hace. Ver el porque en tests/ddl-claves-catalogo.test.mjs: un regex
 *  encuentra el texto DENTRO del comentario que explica el bug y el test falla por
 *  su propia explicacion. */
function sqlSinComentarios(texto) {
  return texto.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
}

const ddl = sqlSinComentarios(DDL);

/** Todas las definiciones de la tabla en TODO docs/, no solo en su archivo: una
 *  tabla se puede crear aqui y alterarse en otro, y un test que solo mira un
 *  archivo daria por bueno un `dibujo` que existe en ninguna parte. */
async function columnasDeLaTabla() {
  const dir = path.join(RAIZ, "docs");
  const archivos = (await readdir(dir)).filter((n) => n.endsWith(".sql"));
  const texto = (await Promise.all(archivos.map((n) => readFile(path.join(dir, n), "utf8"))))
    .map(sqlSinComentarios)
    .join("\n");
  const cols = new Set();

  // El cuerpo del CREATE TABLE se saca contando parentesis, NO con `[^)]*`: la
  // primera columna de esta tabla es `id uuid primary key default
  // gen_random_uuid()`, y un patron que se para en el primer ) se queda con media
  // tabla y dice que `clave` no existe. Un extractor de columnas que falla en
  // silencio es peor que no tener uno: el test pasa por el motivo equivocado o
  // falla por uno que nadie lee.
  const inicio = texto.search(new RegExp(`create table (?:if not exists )?public\\.${TABLA}\\s*\\(`, "i"));
  if (inicio >= 0) {
    let depth = 0;
    let fin = -1;
    for (let i = texto.indexOf("(", inicio); i < texto.length; i += 1) {
      if (texto[i] === "(") depth += 1;
      else if (texto[i] === ")") {
        depth -= 1;
        if (depth === 0) { fin = i; break; }
      }
    }
    if (fin > inicio) {
      const cuerpo = texto.slice(inicio, fin);
      for (const linea of cuerpo.split(",")) {
        const m = linea.trim().match(/^([a-z_]+)\s/i);
        if (m) cols.add(m[1].toLowerCase());
      }
    }
  }

  const alta = texto.match(new RegExp(`alter table public\\.${TABLA}\\s+add column (?:if not exists )?([a-z_]+)`, "gi"));
  for (const m of alta || []) cols.add(m[1].toLowerCase());
  return cols;
}

const COLUMNAS = await columnasDeLaTabla();

/** Las columnas que el escritor manda en el cuerpo de guardarInspectionRoute. */
function columnasDelEscritor() {
  const fn = ESCRITOR.slice(ESCRITOR.indexOf("async function guardarInspectionRoute"));
  const cuerpo = fn.slice(0, fn.indexOf("\n  }"));
  return new Set([...cuerpo.matchAll(/^\s{6}([a-z_]+):/gm)].map((m) => m[1]));
}

/** Las columnas que el lector pide en el `select`. */
function columnasDelLector() {
  const m = LECTOR.match(/readTable\("inspection_routes",\s*\{\s*select:\s*"([^"]+)"/);
  if (!m) return new Set();
  return new Set(m[1].split(",").map((c) => c.trim().toLowerCase()));
}

test("el DDL declara la tabla inspection_routes", () => {
  assert.equal(
    new RegExp(`create table (?:if not exists )?public\\.${TABLA}\\s*\\(`, "i").test(ddl),
    true,
    "docs/schema-inspection-routes.sql tiene que crear la tabla; sin ella el autor estara bien pero la base no lo tendra",
  );
});

test("1. `clave` es columna REAL de la tabla y tiene indice UNICO COMPLETO", () => {
  assert.equal(COLUMNAS.has("clave"), true, "la columna clave tiene que existir: es la que va en on_conflict");

  const indices = [...ddl.matchAll(new RegExp(`create (unique )?index (?:if not exists )?\\S+\\s+on public\\.${TABLA}\\s*\\(([^)]*)\\)([^;]*);`, "gi"))]
    .map((m) => ({ unique: Boolean(m[1]), cols: m[2], resto: m[3] || "" }));
  const deClave = indices.filter((i) => i.cols.split(",").map((c) => c.trim()).includes("clave"));

  assert.equal(deClave.length >= 1, true, "no hay ningun indice sobre (clave)");
  assert.equal(deClave.some((i) => i.unique), true, "el indice de (clave) tiene que ser UNIQUE o el UPSERT crea una fila por guardado");
  // El predicado es lo que separa un indice utilizable de uno que existe pero no
  // sirve: PostgreSQL no infiere un indice PARCIAL desde on_conflict=columna.
  assert.equal(deClave.some((i) => /\bwhere\b/i.test(i.resto)), false, "el indice de (clave) es PARCIAL y on_conflict=clave no lo puede inferir (42P01)");
});

test("2. TODAS las columnas que manda el escritor existen en el DDL", () => {
  const enviadas = columnasDelEscritor();
  assert.equal(enviadas.size > 0, true, "el test no encontro el cuerpo de guardarInspectionRoute; si se renombro, este test esta mintiendo");
  const faltantes = [...enviadas].filter((c) => !COLUMNAS.has(c));
  assert.deepEqual(faltantes, [], `el escritor manda columnas que el DDL no declara: ${faltantes.join(", ")}. Cada una es un HTTP 400 de PostgREST en cada guardado de tramo.`);
});

test("3. TODAS las columnas que pide el lector existen en el DDL", () => {
  const pedidas = columnasDelLector();
  assert.equal(pedidas.size > 0, true, "el test no encontro el select de readInspectionRoutes; si se renombro, este test esta mintiendo");
  const faltantes = [...pedidas].filter((c) => !COLUMNAS.has(c));
  assert.deepEqual(faltantes, [], `el lector pide columnas que el DDL no declara: ${faltantes.join(", ")}. El listado de tramos devuelve 400 y no aparece.`);
});

test("4. la tabla esta en la whitelist de ingesta_mirror, que es una TABLA", () => {
  assert.match(ddl, /insert into public\.ingesta_mirror_whitelist\s*\(\s*tabla\s*,\s*nota\s*\)/i);
  const fila = ddl.match(new RegExp(`insert into public\\.ingesta_mirror_whitelist[^;]*'${TABLA}'[^;]*;`, "i"));
  assert.ok(fila, "falta la fila que mete inspection_routes en la whitelist. Sin ella el RPC rechaza p_tabla y el importador no puede volcar la hoja, que es el paso que deja la tabla con datos.");
});

test("5. la escritura es para `authenticated` y NO para `anon`", () => {
  const politicas = [...ddl.matchAll(/create policy\s+(\S+)\s+on public\.inspection_routes\s+for\s+(\w+)\s+to\s+([\w\s,]+)/gi)]
    .map((m) => ({ nombre: m[1], para: m[2].toLowerCase(), roles: m[3].toLowerCase() }));
  assert.equal(politicas.length > 0, true, "no hay ninguna politica: con RLS habilitado y sin politicas la tabla no se lee ni se escribe");
  assert.equal(politicas.some((p) => p.para === "select" && p.roles.includes("authenticated")), true, "falta la politica de lectura para authenticated");
  assert.equal(politicas.some((p) => (p.para === "all" || p.para === "insert" || p.para === "update") && p.roles.includes("authenticated")), true, "falta la politica de escritura para authenticated");
  assert.equal(politicas.some((p) => p.roles.includes("anon")), false, "esta tabla se lee y se escribe con sesion: abrirla a anon daria el plan y los tramos a cualquiera que abra la pagina (RULE-SUP-015)");
});

test("6. `updated_at` tiene disparador, o la columna miente la antiguedad", () => {
  assert.equal(COLUMNAS.has("updated_at"), true);
  assert.match(ddl, /create trigger\s+inspection_routes_set_updated_at[\s\S]*before update on public\.inspection_routes/i);
  // Y el nombre de la funcion tiene que ser el que el disparador llama, no otro
  // del repo: un trigger que apunte a una funcion que no existe aqui no compila.
  // La funcion se puede llamar CON esquema (`public.pp_set_updated_at()`) y el
  // nombre tiene punto, asi que el patron acepta `esquema.nombre`. Un trigger que
  // apunte a una funcion de otro esquema que este DDL no crea compila igual de
  // bien: el error sale al aplicar, no al leer.
  const fn = ddl.match(/create trigger\s+inspection_routes_set_updated_at[\s\S]*?execute function\s+([a-z_]+(?:\.[a-z_]+)?)\s*\(\s*\)\s*;/i);
  assert.ok(fn, "el disparador no dice que funcion ejecuta");
  assert.match(ddl, new RegExp(`create or replace function\\s+${fn[1].replace(".", "\\.")}\\s*\\(`, "i"), `el disparador llama a ${fn[1]}() y ese DDL no la crea`);
});

/**
 * Y una comprobacion de COHERENCIA entre los dos normalizadores, que estan en
 * archivos distintos y no se comparan entre si. Si el escritor y el servidor
 * calcularan la clave distinto, el mismo tramo entraria por dos claves y el UNIQUE
 * no podria de-duplicarlo, porque estarian en filas distintas: el fallo es
 * silencioso y aparece semanas despues como "hay dos filas del mismo tramo".
 */
test("el escritor y el importador calculan la clave con la MISMA regla", () => {
  // El servidor: PP_Inspection_routeKey_ (16-inspection-service.js).
  const fn = SERVIDOR.slice(SERVIDOR.indexOf("function PP_Inspection_routeKey_"));
  const cuerpo = fn.slice(0, fn.indexOf("\n}"));
  assert.match(cuerpo, /PP_normalizeKey_/, "la clave del servidor sale de PP_normalizeKey_");

  // El escritor: normalizeKey, con el nombre del origen al lado.
  const norm = ESCRITOR.slice(ESCRITOR.indexOf("function normalizeKey(valor)"));
  const cuerpoNorm = norm.slice(0, norm.indexOf("\n  }"));
  assert.match(cuerpoNorm, /toUpperCase\(\)/, "el escritor tiene que subir a mayusculas, como PP_normalizeKey_");
  assert.match(cuerpoNorm, /\\u0300-\\u036f/, "el escritor tiene que quitar acentos, como PP_normalizeKey_");
  assert.match(cuerpoNorm, /\\s\+/, "el escritor tiene que cambiar espacios por _, como PP_normalizeKey_");

  // Y las tres piezas de la clave, en el mismo orden y con el mismo separador.
  const claveEscritor = ESCRITOR.slice(ESCRITOR.indexOf("const clave = normalizeKey(articulo)"));
  assert.match(claveEscritor, /normalizeKey\(articulo\)\s*\+\s*"\|\"\s*\+\s*normalizeKey\(material\)/, "la clave del escritor es articulo|material, y el separador tiene que ser el mismo que use el servidor");
});
