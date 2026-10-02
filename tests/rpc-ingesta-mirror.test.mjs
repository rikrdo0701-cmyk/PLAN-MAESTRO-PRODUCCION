// EL RPC public.ingesta_mirror TIENE QUE LEER LA TABLA, NO LLEVAR UNA LISTA EN EL
// CUERPO, Y SOLO TIENE QUE HABER UNA COPIA VIVA DE ESA DEFINICION.
//
// MEDIDO 2026-10-01. El fallo que motivo este test no lo daba ningun test: el
// importador de la hoja `Tramos` devolvio
//   ingesta_mirror 400 {"code":"P0001","message":"ingesta_mirror: tabla no permitida: inspection_routes"}
// con la fila 'inspection_routes' YA en public.ingesta_mirror_whitelist, insertada ese
// mismo dia. La fila estaba bien y la funcion ni la miraba. La causa, verificada con
// pg_get_functiondef sobre el proyecto real (no leyendo el repo): habia TRES
// definiciones del mismo RPC repartidas en tres archivos, y la aplicacion del DDL de
// cierre de catalogos (2026-09-29) volvio a definir el RPC con una lista de 17 tablas
// metida en el cuerpo, pisando sin avisar la version que leia la tabla. `create or
// replace` no dice que esta reemplazando una version anterior.
//
// QUE SE COMPRUEBA, Y CADA COSA POR QUE.
//
// 1. LA CANONICA LEE LA TABLA. `docs/rpc-ingesta-mirror.sql` es el archivo que cita
//    Project Memory (data-sources.json SUPABASE-PLAN -> references) y el unico que se
//    aplica. Si vuelve a llevar `p_tabla not in (...)`, agregar una tabla obliga a
//    reescribir la funcion, que es el problema que la tabla existe para evitar.
//
// 2. SOLO HAY UNA DEFINICION VIVA EN TODO docs/. Este es el guard que de verdad
//    importa: recorre los .sql, saca los comentarios y cuenta los que DEFINEN
//    `create or replace function public.ingesta_mirror(`. Tiene que quedar una, y las
//    otras tienen que estar marcadas como superadas. Un archivo nuevo con la funcion
//    rompe el test en vez de romper produccion en silencio.
//
// 3. EL ARREGLO VACIO CONSERVA SU SIGNIFICADO. Este es el detalle que hizo que NO se
//    copiara la funcion de docs/schema-supabase-plan.sql aunque esa si lea la tabla:
//    no tiene la rama `if jsonb_array_length(p_filas) > 0`, asi que con `p_filas = []`
//    cae en `array_length(v_cols, 1) is null`, revienta, la transaccion hace rollback
//    y la tabla se queda con los datos anteriores. Para un espejo, "el origen ya no
//    tiene filas" es un estado legitimo, no un error. Con la rama, `[]` borra y
//    devuelve `insertadas: 0, ok: true`.
//
// 4. EL DELETE SIGUE SIENDO LA TAUTOLOGIA DEL UUID NULO. PostgREST exige WHERE en un
//    DELETE y `WHERE true` no es valido para el (PGRST, medido 2026-09-29).
//
// 5. EL INSERT NOMBRA LAS COLUMNAS Y NUNCA USA `.*`. Con `.*`, `.*` mete todas las
//    columnas, `jsonb_populate_recordset` pone NULL en las que no llegan y un DEFAULT
//    no salva a una columna que entra como NULL explicito: 23502 'null value in column
//    "id"' en las 7 tablas de la ingesta (medido 2026-09-30). Ademas el DELETE ya habia
//    corrido en la misma transaccion.
//
// 6. p_filas VIAJA COMO PARAMETRO DE EXECUTE, no dentro del texto de format(), para que
//    un valor con comillas no rompa la sentencia montada.
//
// 7. SOLO service_role. Este RPC BORRA la tabla entera. La clave publicable viaja en el
//    bundle publico de la pagina, asi que si `anon` pudiera ejecutarla, cualquiera que
//    abriera la pagina podria vaciar el plan. Medido el 2026-10-01 contra el proyecto
//    real: execute anon=NO, authenticated=NO, service_role=SI.
//
// 8. security invoker, NO security definer. Con definer el RPC correria con los
//    privilegios de su propietario y el revoke de la linea 7 no serviria de nada.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = fileURLToPath(new URL("../", import.meta.url));
const DIR = path.join(RAIZ, "docs");
const CANONICO = "rpc-ingesta-mirror.sql";

/** El SQL sin comentarios. Se afirma sobre SENTENCIAS, no sobre lo que el archivo dice
 *  que hace: un regex encuentra el texto DENTRO del comentario que explica el bug y el
 *  test falla por su propia explicacion (por eso el punto 3 tiene que mirar el cuerpo de
 *  la funcion, no su prosa). */
function sqlSinComentarios(texto) {
  return texto.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
}

const crudos = Object.fromEntries(
  await Promise.all(
    (await readdir(DIR))
      .filter((n) => n.endsWith(".sql"))
      .map(async (n) => [n, await readFile(path.join(DIR, n), "utf8")])
  )
);
const sql = Object.fromEntries(Object.entries(crudos).map(([n, t]) => [n, sqlSinComentarios(t)]));

/** El cuerpo de una funcion, del `create or replace` hasta el `$$;` que la cierra.
 *  Contar parentesis no sirve: aqui el cuerpo tiene el `as $$ ... $$` y los parentesis
 *  del plpgsql son pocos. */
function cuerpoDeLaFuncion(texto, nombre) {
  const i = texto.search(new RegExp(`create or replace function public\\.${nombre}\\s*\\(`, "i"));
  assert.ok(i >= 0, `no se encontro la definicion de ${nombre}`);
  const fin = texto.indexOf("$$;", i);
  assert.ok(fin > i, `el cuerpo de ${nombre} no se cerro con $$;`);
  return texto.slice(i, fin);
}

const canonico = sql[CANONICO];
assert.ok(canonico, `docs/${CANONICO} no existe: es el archivo que cita Project Memory como la definicion del RPC`);

test("1. la copia canonica lee la whitelist de la TABLA", () => {
  const cuerpo = cuerpoDeLaFuncion(canonico, "ingesta_mirror");
  assert.match(
    cuerpo,
    /from public\.ingesta_mirror_whitelist\s+w\s+where\s+w\.tabla\s*=\s*p_tabla/,
    "la whitelist tiene que leerse de public.ingesta_mirror_whitelist; si esto falla, agregar una tabla vuelve a obligar a reescribir la funcion"
  );
  assert.doesNotMatch(
    cuerpo,
    /p_tabla\s+not\s+in\s*\(/,
    "la copia canonica no puede llevar la lista de tablas en el cuerpo: eso es justo lo que se movio a la tabla"
  );
});

test("2. UNA sola definicion viva en todo docs/, y las demas marcadas como superadas", async () => {
  const definidores = Object.keys(sql).filter((n) =>
    /create or replace function public\.ingesta_mirror\s*\(/i.test(sql[n])
  );
  assert.ok(definidores.length >= 2, `solo se encontro una definicion del RPC (${definidores.join(", ") || "ninguna"}): este test deberia notar cuando aparecen las otras`);

  const vivas = definidores.filter((n) => n !== CANONICO && !/SUPERAD/i.test(crudos[n]));
  assert.deepEqual(
    vivas,
    [],
    `estas copias del RPC NO estan marcadas como superadas y aplicarlas volveria a pisarlo: ${vivas.join(", ")}`
  );

  for (const n of definidores.filter((n) => n !== CANONICO)) {
    assert.match(
      crudos[n],
      /SUPERAD/i,
      `docs/${n} define public.ingesta_mirror y tiene que decir en su encabezado que esta superado`
    );
    assert.match(
      crudos[n],
      /rpc-ingesta-mirror\.sql/,
      `docs/${n} tiene que apuntar a la copia canonica para que se sepa donde cambiar el RPC`
    );
  }
});

test("3. p_filas = [] borra y devuelve ok: la rama del arreglo vacio sigue ahi", () => {
  const cuerpo = cuerpoDeLaFuncion(canonico, "ingesta_mirror");
  assert.match(
    cuerpo,
    /if jsonb_array_length\(p_filas\)\s*>\s*0 then/,
    "falta la rama del payload vacio: sin ella un espejo sin filas revienta y hace rollback, y la tabla se queda con los datos viejos"
  );
  assert.match(
    cuerpo,
    /else\s+v_insertadas\s*:=\s*0;/,
    "la rama del payload vacio tiene que dejar insertadas en 0, no en NULL"
  );
  assert.match(
    cuerpo,
    /return jsonb_build_object\('ok',\s*true/,
    "un espejo sin filas es un resultado ok, no un error"
  );
});

test("4. el DELETE es la tautologia del uuid nulo (PostgREST exige WHERE)", () => {
  const cuerpo = cuerpoDeLaFuncion(canonico, "ingesta_mirror");
  assert.match(
    cuerpo,
    /delete from\s+%s\s+where id <> ''00000000-0000-0000-0000-000000000000''/,
    "el WHERE tiene que ser `id <> uuid nulo`: PostgREST rechaza el DELETE sin WHERE y `WHERE true` no vale para el (PGRST, medido 2026-09-29)"
  );
  assert.doesNotMatch(cuerpo, /delete from [^;]*\bwhere true\b/i, "`WHERE true` en un DELETE sin clave no es valido para PostgREST");
});

test("5. el INSERT nombra las columnas y no usa `.*`", () => {
  const cuerpo = cuerpoDeLaFuncion(canonico, "ingesta_mirror");
  assert.match(
    cuerpo,
    /insert into %s \(%s\) select %s from jsonb_populate_recordset/,
    "el INSERT tiene que llevar su lista de columnas: con `.*` mete todas y las que faltan llegan como NULL (23502 en `id`, medido 2026-09-30)"
  );
  assert.doesNotMatch(cuerpo, /jsonb_populate_recordset\([^)]*\)\)\.\*/, "el `.*` es justamente lo que se quito");
  assert.match(
    cuerpo,
    /where c not in \('id',\s*'created_at',\s*'updated_at'\)/,
    "las columnas que genera la base tienen que quedar fuera de la lista del INSERT para que sus defaults apliquen"
  );
});

test("6. p_filas viaja como parametro de EXECUTE, no dentro del format()", () => {
  const cuerpo = cuerpoDeLaFuncion(canonico, "ingesta_mirror");
  assert.match(
    cuerpo,
    /execute v_sql using p_filas/,
    "el payload tiene que ir como parametro ligado: metido en el texto de format(), un valor con comillas rompe la sentencia montada"
  );
  assert.doesNotMatch(cuerpo, /format\([^)]*p_filas/s, "p_filas no debe aparecer dentro del texto que arma format()");
});

test("7. solo service_role puede ejecutar el RPC: este borra la tabla entera", () => {
  for (const rol of ["anon", "authenticated", "public"]) {
    assert.match(
      canonico,
      new RegExp(`revoke execute on function public\\.ingesta_mirror\\(text, jsonb\\) from ${rol};`, "i"),
      `falta el revoke para ${rol}: con la clave publicable en el bundle de la pagina, quien pueda ejecutar esto vacia el plan`
    );
  }
  assert.match(
    canonico,
    /grant execute on function public\.ingesta_mirror\(text, jsonb\) to service_role;/i
  );
});

test("8. security invoker, no security definer", () => {
  const cuerpo = cuerpoDeLaFuncion(canonico, "ingesta_mirror");
  assert.match(cuerpo, /security\s+invoker/i);
  assert.doesNotMatch(
    cuerpo,
    /security\s+definer/i,
    "con security definer el RPC corre con los privilegios de su propietario y los revoke de arriba no sirven de nada"
  );
});

test("9. la v1 queda como tombstone que dice a donde ir", () => {
  const v1 = cuerpoDeLaFuncion(canonico, "ingesta_mirror_v1");
  assert.match(v1, /raise exception/i, "la v1 no debe hacer nada quietly: si alguien la llama tiene que saber que use ingesta_mirror");
  assert.match(v1, /ingesta_mirror_whitelist/, "el mensaje de la v1 tiene que decir donde esta la lista buena");
});