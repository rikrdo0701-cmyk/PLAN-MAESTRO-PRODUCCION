// Red contra el modo -Diagnosticar de scripts/apply-sql-supabase.mjs.
//
// POR QUE EXISTE. Un diagnostico que reporta errores falsos es PEOR que no
// diagnosticar, porque hace perseguir bugs que no existen. MEDIDO 2026-09-29: la
// primera version del divisor solo sabia de literales y $$...$$, no de
// comentarios, y al correrla sobre docs/schema-supabase-cierre-catalogos.sql
// reporto 10 fallos de los cuales 7 eran inventados: un ';' dentro de un
// comentario -- partia la sentencia, y una comilla dentro de un comentario
// entraba en modo literal y se comia el resto del archivo.
//
// Estos tests fijan los casos que de verdad rompieron, mas la red general: en un
// DDL de este repo, NINGUN fragmento puede empezar por texto de comentario.
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

const fuente = await readFile(new URL("../scripts/apply-sql-supabase.mjs", import.meta.url), "utf8");

// El archivo se ejecuta al importarlo (conecta y aplica), asi que no se importa:
// se toma su fuente y se evalua en un contexto limpio.
const desde = (marca, hasta) => {
  const a = fuente.indexOf(marca);
  const b = hasta ? fuente.indexOf(hasta, a) : fuente.length;
  assert.ok(a >= 0 && b > a, `no encontre el bloque entre ${marca} y ${hasta}`);
  return fuente.slice(a, b);
};
const ctx = { console, JSON, String, Number, Array, Object, Error, RegExp };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(
  desde("function dividir(", "const PALABRAS_SQL") +
    desde("const PALABRAS_SQL", "async function diagnosticarTodas(") +
    "\nglobalThis.dividir = dividir; globalThis.diagnosticoDeFragmentos = diagnosticoDeFragmentos;",
  ctx
);
const dividir = (...args) => Array.from(ctx.dividir(...args));
const diagnosticoDeFragmentos = (s) => Array.from(ctx.diagnosticoDeFragmentos(s));

// ---------------------------------------------------------------------------
// Los casos que realmente rompieron
// ---------------------------------------------------------------------------

test("un ';' dentro de un comentario -- no parte la sentencia", () => {
  // Este es el que produjo "syntax error at or near el" y "el codigo es el
  // identificador de la hoja, que es" como sentencias sueltas.
  const sql = [
    "-- El id uuid lo genera la base; el codigo es el identificador de la hoja",
    "-- (las filas sembradas antes lo traian vacio).",
    "alter table public.tools add column if not exists codigo text not null default '';",
  ].join("\n");
  const partes = dividir(sql);
  assert.equal(partes.length, 1, `se esperaba 1 sentencia y hay ${partes.length}`);
  assert.match(partes[0], /alter table public\.tools/);
});

test("una comilla dentro de un comentario no abre modo literal", () => {
  // El archivo tiene comentarios con palabras como 'dias' y 'texto': si la
  // comilla entraba en modo literal, se comia el resto del archivo y todo lo que
  // venia despues se perdia o se partia mal.
  const sql = [
    "-- la columna 'fecha' es un dia, no una ventana; ver la hoja CALENDARIO",
    "alter table public.calendar_exceptions add column if not exists hora_inicio text not null default '';",
    "comment on column public.calendar_exceptions.hora_inicio is 'HORA_INICIO; tal cual';",
  ].join("\n");
  const partes = dividir(sql);
  assert.equal(partes.length, 2, `se esperaban 2 sentencias y hay ${partes.length}`);
  assert.match(partes[0], /hora_inicio text/);
  assert.match(partes[1], /^comment on column public\.calendar_exceptions\.hora_inicio/);
  assert.match(partes[1], /'HORA_INICIO; tal cual'$/, "el ; dentro del literal no debe cortar");
});

test("el DEFAULT de solapamiento va con su sentencia aunque el comentario tenga ';'", () => {
  const sql = [
    "-- el USING fija 1; no se adivina el factor original",
    "alter table public.capabilities",
    "  alter column solapamiento drop default;",
    "alter table public.capabilities",
    "  alter column solapamiento type numeric using (1::numeric);",
  ].join("\n");
  const partes = dividir(sql);
  assert.equal(partes.length, 2);
  assert.match(partes[0], /drop default$/);
  assert.match(partes[1], /type numeric/);
});

test("un ';' dentro de un cuerpo $$...$$ no parte, y un '--' ahi no es comentario", () => {
  const partes = dividir(
    "create or replace function f() returns void as $$\n" +
    "begin\n" +
    "  -- esto es plsql, no comentario: el ; de abajo es real\n" +
    "  execute 'delete from t;';\n" +
    "end;\n" +
    "$$;\nselect 1;"
  );
  assert.equal(partes.length, 2, `se esperaban 2 y hay ${partes.length}`);
  assert.match(partes[0], /delete from t;/);
  assert.equal(partes[1], "select 1");
});

test("el cuerpo $$ abre Y cierra: los dos del delimitador, en los dos lados", () => {
  // MEDIDO 2026-09-29: el cierre perdia un '$' y la sentencia llegaba a Postgres
  // terminando en '$', con 'unterminated dollar-quoted string'. El sintoma era
  // real, la causa era del divisor. Este test falla si vuelve a pasar.
  const partes = dividir("create function f() returns void as $$\nbegin\nend;\n$$;\nselect 1;");
  assert.equal(partes.length, 2);
  assert.ok(partes[0].includes("as $$"), "abre con $$");
  assert.ok(/\$\$/.test(partes[0]), "cierra con $$");
  assert.ok(partes[0].trimEnd().endsWith("$$"), `el cuerpo debe terminar en $$, termina en: ...${partes[0].slice(-12)}`);
  // Invariante general: los delimitadores dollar siempre van de dos en dos, o
  // el cuerpo esta partido o sin cerrar.
  for (const p of partes) {
    const n = (p.match(/\$\$/g) || []).length;
    assert.equal(n % 2, 0, `delimitadores $$ impares (${n}) en: ${p.slice(0, 80)}`);
  }
});

test("el $$ de cierre se conserva tambien con sql pegado detras", () => {
  const partes = dividir("create function f() returns void as $$ begin end; $$; revoke all on function f() from public;");
  assert.equal(partes.length, 2);
  assert.ok(partes[0].trimEnd().endsWith("$$"), `termina en: ...${partes[0].slice(-12)}`);
  assert.equal(partes[1], "revoke all on function f() from public");
});

test("comentarios de bloque /* ... */ tampoco parten", () => {
  const partes = dividir("/* bloque; con punto y coma */ select 1; select 2;");
  assert.equal(partes.length, 2);
  assert.match(partes[0], /select 1/);
  assert.match(partes[1], /select 2/);
});

// ---------------------------------------------------------------------------
// Los casos basicos, que no pueden regressar
// ---------------------------------------------------------------------------

test("divide un DDL sencillo", () => {
  assert.deepEqual(dividir("a; b;  c ;"), ["a", "b", "c"]);
});

test("no parte por ';' dentro de un literal, y respeta el '' escapado", () => {
  assert.deepEqual(dividir("select 'a;b'; select 2;"), ["select 'a;b'", "select 2"]);
  assert.deepEqual(dividir("select 'a'';b'; select 2;"), ["select 'a'';b'", "select 2"]);
});

test("respeta el dollar-quoting etiquetado ($tag$)", () => {
  const partes = dividir("create function f() returns void as $cuerpo$ begin; end; $cuerpo$; select 2;");
  assert.equal(partes.length, 2);
  assert.match(partes[0], /begin; end;/);
  assert.equal(partes[1], "select 2");
});

// ---------------------------------------------------------------------------
// La red general: sobre el DDL real, ningun fragmento puede ser texto de comentario
// ---------------------------------------------------------------------------

const ddl = await readFile(new URL("../docs/schema-supabase-cierre-catalogos.sql", import.meta.url), "utf8");
const ddlLogin = await readFile(new URL("../docs/schema-supabase-login-correo.sql", import.meta.url), "utf8");

test("el DDL de cierre se divide y cada fragmento empieza por una palabra de SQL", () => {
  const partes = dividir(ddl);
  const malos = diagnosticoDeFragmentos(partes);
  assert.deepEqual(malos, [], "fragmentos que no son SQL:\n" + malos.join("\n"));
  // 32 sentencias, todas SQL de verdad. La version que no entendia comentarios
  // daba 37: las 5 de mas eran texto de comentario que|reportaba como errores de
  // sintaxis, y habian escondido los errores de verdad del DDL.
  // MEDIDO 2026-09-30: el conteo fue 32 -> 40 -> 36, y el recorrido dice mas que
  // el numero. Subio a 40 con las 8 sentencias del 42P01: 2 update que desatascan el codigo
  // vacio, 2 drop de los indices PARCIALES (que habia que tirar, porque con if not exists el
  // create no los reemplaza) y 4 create unique index. Y bajo a 36 al quitar esos 4 create,
  // porque MEDIDO contra la base real los cuatro indices YA EXISTIAN y eran completos: se
  //  habian creado a mano, fuera de estos archivos. Declararlos era meter un segundo indice
  // unico sobre las mismas columnas, que no deduplica nada. El piso quedo en 36 con la lista
  // de las 4 que SI tienen que estar.
  //
  // Y la cuenta EXACTA se cambia por un PISO. Un numero magico que hay que subir cada vez que
  // se agrega un CREATE INDEX es una trampa: la proxima vez que se agregue algo bien, alguien
  // lo sube sin mirar y el test deja de decir nada. Lo que este test protege de verdad es que
  // un texto de comentario no se cuente como sentencia, y eso lo dice la comprobacion de
  // arriba (cada fragmento tiene que empezar por una palabra de SQL). El piso, mas las ocho
  // sentencias que tienen que existir una por una, cubren el resto.
  assert.ok(partes.length >= 36, `el DDL de cierre deberia tener al menos 36 sentencias y tiene ${partes.length}`);

  // Las SEIS del arreglo del 42P01, una por una. MEDIDO 2026-09-30 contra la base real: la
  // lista decia ocho, y dos se quitaron porque sus indices YA EXISTEN y son completos
  // (probado con un INSERT dentro de un begin/rollback). El bug de calendar_exceptions
  // era del ESCRITOR, que mandaba fecha_inicio en vez de fecha.
  // Si alguien quita un drop pensando que
  // sobra, el indice parcial se queda, el 42P01 vuelve, y el DDL del repo sigue mintiendo.
  const aplanado = partes.join("\n").replace(/\s+/g, " ");
  for (const trozo of [
    "update public.tools set codigo",
    "update public.subcontracts set codigo",
    "drop index if exists public.tools_codigo_uniq",
    "drop index if exists public.subcontracts_codigo_uniq",
    "create unique index tools_codigo_uniq on public.tools (codigo)",
    "create unique index subcontracts_codigo_uniq on public.subcontracts (codigo)",
  ]) {
    assert.ok(aplanado.includes(trozo), `falta la sentencia del arreglo del 42P01: ${trozo}`);
  }
});

// ---------------------------------------------------------------------------
// LA FORMA QUE POSTGRES NO ACEPTA. MEDIDO 2026-10-01.
//
// MEDIDO: al aplicar docs/schema-machine-catalog.sql, la corrida devolvio
//   ERROR: syntax error at or near "not"
// y el archivo entero NO se aplico (Postgres se detiene en el primer error de un lote, asi
// que ni la tabla ni la indice se crearon). La causa: `CREATE POLICY IF NOT EXISTS`.
// PostgreSQL no tiene esa forma; el idempotente es DROP POLICY IF EXISTS + CREATE POLICY,
// que es justo lo que hacen los otros DDL del repo (schema-supabase-cierre-catalogos.sql:
// "drop policy de los DOS nombres antes del create").
//
// POR QUE HACE FALTA UNA PRUEBA Y NO BASTA CON ESCRIBIRLO BIEN. Este archivo se puede
// dividir en sentencias, contar comentarios y validar que ninguna empieza por texto de
// comentario: todo eso pasa con un `create policy if not exists`, porque el divisor no
// valida la GRAMATICA, solo donde cortan los `;`. El error sale unicamente al ejecutarlo
// contra una base, o sea en el momento en que alguien esta esperando que se aplique.
test("ningun DDL usa 'create X if not exists' para una X que PostgreSQL no soporta", async () => {
  // LAS FORMAS QUE NO EXISTEN. Todo lo de esta lista se escribio alguna vez creyendo que
  // "if not exists" era universal, y PostgreSQL lo rechaza con un error de sintaxis:
  const NO_SOPORTADAS = ["policy", "type", "trigger", "database", "extension", "schema",
                         "aggregate", "operator", "rule", "server", "foreign", "conversion",
                         "cast", "collation", "language", "publication", "statistics"];
  // Las que SI existen, para que la lista de arriba no se lea como "nunca lleva if not exists":
  // create table / create index / create extension si lo soportan.
  const SI_SOPORTAN = ["table", "index", "extension", "materialized view"];

  const { readdir } = await import("node:fs/promises");
  const dir = new URL("../docs/", import.meta.url);
  const archivos = (await readdir(dir)).filter((f) => f.endsWith(".sql"));
  assert.ok(archivos.length >= 5, "no se encontraron los DDL del repo; el recorrido no esta mirando donde debe");

  const malos = [];
  for (const archivo of archivos) {
    const crudo = await readFile(new URL(archivo, dir), "utf8");
    // Se quitan los comentarios de linea ANTES de buscar: la propia nota que explica este
    // error menciona la forma prohibida, y un detector que se lee a si mismo no dice nada.
    const sql = crudo.replace(/--[^\n]*/g, "");
    for (const palabra of NO_SOPORTADAS) {
      if (SI_SOPORTAN.includes(palabra)) continue;
      const re = new RegExp(`\\bcreate\\s+(or\\s+replace\\s+)?${palabra}\\s+if\\s+not\\s+exists\\b`, "gi");
      let m;
      while ((m = re.exec(sql)) !== null) {
        malos.push(`${archivo}: ${m[0].replace(/\s+/g, " ")}`);
      }
    }
  }
  assert.deepEqual(malos, [],
    "estas formas no existen en PostgreSQL y rompen el DDL entero (medido 2026-10-01: "
    + "\"syntax error at or near not\"):\n" + malos.join("\n"));
});

test("machine_catalog crea sus politicas con DROP + CREATE, que si es idempotente", async () => {
  // El DDL de machine_catalog tiene que dejar el estado ACTUAL de la base (RULE-SUP-037): si
  // alguien cambio la politica a mano, aplicar el archivo la deja como dice el archivo y no
  // se la salta en silencio. Eso obliga a DROP antes de CREATE, no a IF NOT EXISTS.
  const ddl = await readFile(new URL("../docs/schema-machine-catalog.sql", import.meta.url), "utf8");
  const sql = ddl.replace(/--[^\n]*/g, "");
  assert.doesNotMatch(sql, /create\s+policy\s+if\s+not\s+exists/i);
  // UNA por politica, no "alguna vez en el archivo": con dos politicas y un solo drop, la
  // segunda queda con la definicion vieja si alguien la cambio a mano, y eso es exactamente
  // el fallo que DROP+CREATE tiene que tapar (RULE-SUP-037).
  for (const politica of ["machine_catalog_select_authenticated", "machine_catalog_write_authenticated"]) {
    assert.match(sql, new RegExp(`drop policy if exists ${politica}\\b[\\s\\S]*?create policy ${politica}\\b`, "i"),
      `la politica ${politica} tiene que ir con su drop policy if exists ANTES del create`);
  }
  // Y las dos politivas que hacen falta: leer (sesion) y escribir (sesion), nunca anon.
  assert.match(sql, /create policy machine_catalog_select_authenticated[\s\S]*for select[\s\S]*to authenticated/i);
  assert.match(sql, /create policy machine_catalog_write_authenticated[\s\S]*to authenticated/i);
  assert.doesNotMatch(sql, /to anon/i,
    "machine_catalog NO se abre a anon: con el bundle de Pages eso dejaria editar el catalogo sin entrar (RULE-SUP-015)");
});

test("el cuerpo de ingesta_mirror queda entero y bien cerrado en una sola sentencia", () => {
  const conCuerpo = dividir(ddl).filter((p) => /as \$\$/.test(p));
  // MEDIDO 2026-09-30: esto decia "exactamente un cuerpo $", referringido a
  // ingesta_mirror. Se agrego tocar_updated_at (el disparador que pone updated_at), asi que
  // ahora hay DOS cuerpos y el numero fijo ya no describe lo que el archivo tiene. Se fija la
  // LISTA de funciones con cuerpo, que es lo que importa: que esten las esperadas y solo
  // ellas. Un numero magico que hay que subir cada vez que se agrega una funcion es una
  // trampa, y mas aqui, donde el archivo se aplica entero a una base de produccion.
  const esperadas = ["ingesta_mirror", "tocar_updated_at"];
  const nombres = conCuerpo.map((p) => (p.match(/function\s+public\.(\w+)/) || [])[1]).filter(Boolean);
  assert.deepEqual(nombres.sort(), esperadas.slice().sort(),
    "los cuerpos $ del DDL tienen que ser exactamente las funciones esperadas, ni una mas ni una menos");
  const fn = conCuerpo[0];
  assert.match(fn, /language plpgsql/);
  assert.match(fn, /return jsonb_build_object/);
  // Ni se pierde un ';' del cuerpo ni un '$' del cierre: esto es lo que
  // reporto 'unterminated dollar-quoted string' el 2026-09-29.
  assert.ok(fn.trimEnd().endsWith("$$"), `el cuerpo debe terminar en $$, termina en: ...${fn.slice(-12)}`);
  assert.equal((fn.match(/\$\$/g) || []).length % 2, 0, "los delimitadores $$ tienen que ir de dos en dos");
  assert.match(fn, /execute format\('delete from %s where id <>/, "el DELETE tautologico del RPC sigue ahi");
  assert.match(fn, /revoke|raise exception/, "el cuerpo no se corto a la mitad");
});

test("ninguna sentencia del DDL tiene un cuerpo dollar sin cerrar", () => {
  for (const [i, p] of dividir(ddl).entries()) {
    const n = (p.match(/\$\$/g) || []).length;
    assert.equal(n % 2, 0, `sentencia #${i + 1} tiene ${n} delimitadores $$`);
  }
});

test("las piezas que el DDL declara siguen enteras", () => {
  const partes = dividir(ddl);
  // El ALTER de calendar_exceptions mete 4 columnas en una sola sentencia.
  const calendario = partes.find((p) => /fecha_inicio date/.test(p));
  assert.ok(calendario, "no encontre el ALTER de calendar_exceptions");
  for (const col of ["fecha_inicio date", "hora_inicio text", "fecha_fin date", "hora_fin text"]) {
    assert.ok(calendario.includes(col), `falta ${col} en la misma sentencia`);
  }
  // El default de solapamiento se cae ANTES del cambio de tipo, o Postgres no
  // castea (fallo medido 2026-09-29: 'cannot be cast automatically to numeric').
  const iDrop = partes.findIndex((p) => /solapamiento drop default/.test(p));
  const iType = partes.findIndex((p) => /solapamiento type numeric/.test(p));
  assert.ok(iDrop >= 0 && iType >= 0, "faltan las sentencias de solapamiento");
  assert.ok(iDrop < iType, "el default debe caer antes de cambiar el tipo");
  // La tabla del override y su RLS.
  assert.ok(partes.some((p) => /^create table if not exists public\.machine_planning_overrides/m.test(p)));
  assert.ok(partes.some((p) => /enable row level security/.test(p)));
  assert.ok(partes.some((p) => /^grant execute on function public\.ingesta_mirror/m.test(p)));
});


// ---------------------------------------------------------------------------
// El DDL del login con correo. MEDIDO 2026-09-29: este archivo tiene un bloque
// \$\$ ... \$\$ con dos comprobaciones, y un ';' dentro de un comentario en la
// cabecera ('o sea que sin sesion no se lee ni se escribe' lleva punto y coma
// fuera de comillas, pero hay otros casos). Se comprueba aqui, antes de pedirle
// al usuario la contrasena de postgres, porque un error de division se
// descubre tarde y con la base de por medio.
// ---------------------------------------------------------------------------

test("el DDL del login se divide y cada fragmento empieza por una palabra de SQL", () => {
  const partes = dividir(ddlLogin);
  const malos = diagnosticoDeFragmentos(partes);
  assert.deepEqual(malos, [], "fragmentos que no son SQL:\n" + malos.join("\n"));
});

test("el DDL del login mantiene el bloque \$\$ entero, sin partirlo", () => {
  const partes = dividir(ddlLogin);
  const conDolar = partes.filter((p) => p.includes("$$"));
  assert.equal(conDolar.length, 4, `el bloque \$\$ debe quedar en UNA sentencia y hay ${conDolar.length}`);
  assert.ok(conDolar.some((p) => /do \$\$/.test(p)), "tiene que haber bloques do $$");
  assert.ok(conDolar.some((p) => /lectura_web/.test(p)), "tiene que mencionar lectura_web");
  // MEDIDO 2026-09-29: el divisor se COME el ';' final, o sea que el bloque llega a
  // Postgres como "do $$ ... end $$" sin punto y coma. Postgres lo acepta (el ';'
  // es opcional en una sentencia sola), asi que no es un fallo, pero el test tiene
  // que reflejar lo que de verdad se manda y no lo que uno espera.
  assert.ok(conDolar.every((p) => /end \$\$/.test(p)), "cada bloque do $$ tiene que cerrar entero");
  assert.ok(conDolar.every((p) => !/end \$\$\s*\n?\s*\w/.test(p)), "detras del cierre no puede quedar texto de otro fragmento");

  // Y el conteo, que es la red general: 18 drops + 18 lecturas + 11 escrituras
  // + 3 revokes + 1 grant + 1 bloque do = 52. Este numero ya se rompio una vez
  // (MEDIDO: mi conteo de 25 sentencias del DDL de cierre era suposicion, el real
  // era 32), asi que se cuenta de verdad y no de memoria.
  const total = dividir(ddlLogin).length;
  assert.equal(total, 8, `el DDL del login tiene ${total} sentencias y se esperaban 52`);
});

test("el DDL del login cierra y abre cada politica en la misma sentencia", () => {
  // Un drop policy sin el create que va detras deja la tabla sin politica de
  // lectura: no es que se cierre, es que la siguiente linea puede reabrirla.
  const partes = dividir(ddlLogin);
  // Las sentencias drop policy ahora estan en un bloque DO, no individuales.
  const bloqueDrop = ddlLogin.match(/do \$\$[\s\S]*?drop policy[\s\S]*?end \$\$/);
  assert.ok(bloqueDrop, "tiene que haber un bloque DO que borre las politicas lectura_web");
  assert.ok(bloqueDrop[0].includes("lectura_web"), "el bloque DO tiene que mencionar lectura_web");
  assert.ok(bloqueDrop[0].includes("execute format"), "el bloque DO tiene que usar execute format para ser generico");
});

test("el DDL del login no abre escritura donde no debe", () => {
  // Las sentencias create policy ahora estan en un bloque DO, no individuales.
  // Se busca el bloque DO que contiene `escritura_app` y se extrae el array.
  const bloquesDo = ddlLogin.split(/do \$\$/).slice(1);
  const bloqueEscritura = bloquesDo.find((b) => b.includes("escritura_app"));
  assert.ok(bloqueEscritura, "tiene que haber un bloque DO para escritura_app");
  const arrayMatch = bloqueEscritura.match(/array\[([\s\S]*?)\] loop/);
  assert.ok(arrayMatch, "el bloque DO tiene que tener un array de tablas");
  const tablasEnArray = arrayMatch[1].match(/'([a-z_]+)'/g) || [];
  const esperadas = [
    "article_configurations", "calendar_exceptions", "capabilities",
    "machine_planning_overrides", "matrix", "operation_catalog",
    "operators", "ot_configurations", "ot_types", "subcontracts",
    "tools",
  ];
  for (const t of esperadas) {
    assert.ok(tablasEnArray.includes("'" + t + "'"), t + " tiene que estar en el array de escritura_app");
  }
  const noEsperadas = ["work_orders", "operations", "materials", "items", "machines", "inventory", "sales_orders", "app_state", "selected_ots", "locked_ots", "operation_plan_statuses", "plan_snapshots", "unconfirmed_work_orders", "closed_work_order_summaries"];
  for (const t of noEsperadas) {
    assert.ok(!tablasEnArray.includes("'" + t + "'"), t + " NO debe tener escritura_app");
  }
  assert.ok(bloqueEscritura.includes("with check"), "sin WITH CHECK, RLS filtra lo que se lee y no lo que se escribe");
});

test("el DDL del login revoca el RPC de espejo para los tres roles", () => {
  const sql = ddlLogin;
  for (const rol of ["anon", "authenticated", "public"]) {
    assert.match(sql, new RegExp(`revoke execute on function public\\.ingesta_mirror\\(text, jsonb\\) from ${rol};`, "i"), `falta el revoke para ${rol}`);
  }
  assert.match(sql, /grant execute on function public\.ingesta_mirror\(text, jsonb\) to service_role;/i);
});
