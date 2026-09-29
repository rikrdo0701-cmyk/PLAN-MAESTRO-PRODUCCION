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
  assert.equal(partes.length, 32, `se esperaban 32 sentencias y hay ${partes.length}`);
});

test("el cuerpo de ingesta_mirror queda entero y bien cerrado en una sola sentencia", () => {
  const conCuerpo = dividir(ddl).filter((p) => /as \$\$/.test(p));
  assert.equal(conCuerpo.length, 1, "debe haber exactamente un cuerpo $$: la funcion ingesta_mirror");
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
  assert.equal(conDolar.length, 1, `el bloque \$\$ debe quedar en UNA sentencia y hay ${conDolar.length}`);
  assert.match(conDolar[0], /do \$\$/);
  assert.match(conDolar[0], /QUEDAN POLITICAS lectura_web/);
  // MEDIDO 2026-09-29: el divisor se COME el ';' final, o sea que el bloque llega a
  // Postgres como "do $$ ... end $$" sin punto y coma. Postgres lo acepta (el ';'
  // es opcional en una sentencia sola), asi que no es un fallo, pero el test tiene
  // que reflejar lo que de verdad se manda y no lo que uno espera.
  assert.match(conDolar[0], /end if;\s*end \$\$/, "el bloque do $$ tiene que cerrar entero");
  assert.doesNotMatch(conDolar[0], /end \$\$\s*\n?\s*\w/, "detras del cierre no puede quedar texto de otro fragmento");

  // Y el conteo, que es la red general: 18 drops + 18 lecturas + 11 escrituras
  // + 3 revokes + 1 grant + 1 bloque do = 52. Este numero ya se rompio una vez
  // (MEDIDO: mi conteo de 25 sentencias del DDL de cierre era suposicion, el real
  // era 32), asi que se cuenta de verdad y no de memoria.
  const total = dividir(ddlLogin).length;
  assert.equal(total, 52, `el DDL del login tiene ${total} sentencias y se esperaban 52`);
});

test("el DDL del login cierra y abre cada politica en la misma sentencia", () => {
  // Un drop policy sin el create que va detras deja la tabla sin politica de
  // lectura: no es que se cierre, es que la siguiente linea puede reabrirla.
  const partes = dividir(ddlLogin);
  const drops = partes.filter((p) => /^drop policy/i.test(p.trim()) || /drop policy if exists/i.test(p));
  // El nombre de la tabla aparece de dos formas: "alter table public.X drop policy"
  // y "create policy ... on public.X". Se buscan las dos, no solo la segunda.
  const tablaDe = (p) => (p.match(/alter table\s+(public\.\w+)\s+drop policy/i) || p.match(/on\s+(public\.\w+)/i) || [])[1];
  const tablasConDrop = new Set(drops.map(tablaDe).filter(Boolean));
  const tablasConCreate = new Set(partes.filter((p) => /create policy/i.test(p)).map(tablaDe).filter(Boolean));
  for (const t of tablasConDrop) {
    assert.ok(tablasConCreate.has(t), `se quita la politica de ${t} y no se pone ninguna en su lugar`);
  }
  assert.ok(tablasConDrop.size >= 18, `solo hay ${tablasConDrop.size} tablas con drop policy, se esperaban las 18`);
});

test("el DDL del login no abre escritura donde no debe", () => {
  // Las 7 de ingesta y las 5 del estado del plan quedan solo para lectura. Es
  // deliberado (RULE-SUP-022) y este test lo fija, porque abrirlo de golpe seria
  // cambiar dos cosas el mismo dia.
  const partes = dividir(ddlLogin);
  const escrituras = partes.filter((p) => /create policy\s+"escritura_app"/i.test(p));
  const tablas = escrituras.map((p) => (p.match(/on (public\.\w+)/i) || [])[1]).sort();
  const esperadas = [
    "public.article_configurations", "public.calendar_exceptions", "public.capabilities",
    "public.machine_planning_overrides", "public.matrix", "public.operation_catalog",
    "public.operators", "public.ot_configurations", "public.ot_types", "public.subcontracts",
    "public.tools",
  ].sort();
  assert.deepEqual(tablas, esperadas);
  for (const p of escrituras) {
    assert.match(p, /with check \(true\)/i, "sin WITH CHECK, RLS filtra lo que se lee y no lo que se escribe");
  }
});

test("el DDL del login revoca el RPC de espejo para los tres roles", () => {
  const sql = ddlLogin;
  for (const rol of ["anon", "authenticated", "public"]) {
    assert.match(sql, new RegExp(`revoke execute on function public\\.ingesta_mirror\\(text, jsonb\\) from ${rol};`, "i"), `falta el revoke para ${rol}`);
  }
  assert.match(sql, /grant execute on function public\.ingesta_mirror\(text, jsonb\) to service_role;/i);
});
