// Prueba del divisor de sentencias de scripts/apply-sql-supabase.mjs, sin base de
// datos: importa la funcion con un truco de ESM (el archivo es un script con
// codigo de nivel superior, asi que se lee el fuente y se evalua solo la funcion).
// El fallo que vigila es concreto: si el split por ';' no respeta $$...$$, el
// cuerpo de ingesta_mirror se parte en trozos y el modo -Diagnosticar reportaria
// errores que no existen, que es peor que no diagnosticar.
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

const fuente = await readFile(new URL("../scripts/apply-sql-supabase.mjs", import.meta.url), "utf8");
const cuerpo = fuente.slice(fuente.indexOf("function dividir("), fuente.indexOf("async function diagnosticarTodas("));
const ctx = { console, JSON, String, Number, Array, Object, Error };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(cuerpo + "\nglobalThis.dividir = dividir;", ctx);
// El array que devuelve la funcion vive en el contexto vm y trae otro
// Array.prototype: deepEqual (estricto) lo rechaza aunque las cadenas cuadren. Se
// copia al realm de aqui para comparar el valor y no el prototipo.
const dividir = (...args) => Array.from(ctx.dividir(...args));

test("divide un DDL sencillo", () => {
  assert.deepEqual(dividir("a; b;  c ;"), ["a", "b", "c"]);
});

test("no parte por ';' dentro de un literal", () => {
  assert.deepEqual(dividir("select 'a;b'; select 2;"), ["select 'a;b'", "select 2"]);
  // El '' escapado no cierra el literal.
  assert.deepEqual(dividir("select 'a'';b'; select 2;"), ["select 'a'';b'", "select 2"]);
});

test("no parte por ';' dentro de un cuerpo $$...$$", () => {
  const sql = "create or replace function f() returns void as $$\nbegin\n  execute 'delete from t;';\nend;\n$$;\nselect 1;";
  const partes = dividir(sql);
  assert.equal(partes.length, 2, `se esperaban 2 sentencias y hay ${partes.length}`);
  assert.match(partes[0], /^create or replace function/);
  assert.match(partes[0], /delete from t;/, "el ; interno debe seguir dentro del cuerpo");
  assert.equal(partes[1], "select 1");
});

test("respeta el dollar-quoting etiquetado ($tag$)", () => {
  const partes = dividir("create function f() returns void as $cuerpo$ begin; end; $cuerpo$; select 2;");
  assert.equal(partes.length, 2);
  assert.match(partes[0], /begin; end;/);
  assert.equal(partes[1], "select 2");
});

test("el DDL de cierre se divide sin partir el cuerpo de ingesta_mirror", async () => {
  const ddl = await readFile(new URL("../docs/schema-supabase-cierre-catalogos.sql", import.meta.url), "utf8");
  const partes = dividir(ddl);
  // 1 create table machine_planning_overrides + 2 RLS + ... + la funcion del RPC
  // tienen que quedar enteras: si una se partiera, el diagnostico mentiria.
  const conCuerpo = partes.filter((p) => /as \$\$/.test(p));
  assert.equal(conCuerpo.length, 1, "debe haber exactamente un cuerpo $$: la funcion ingesta_mirror");
  assert.match(conCuerpo[0], /language plpgsql/);
  assert.match(conCuerpo[0], /revoke|return jsonb_build_object/);
  // Y ninguna sentencia puede quedar a medias con un ';' suelto al final.
  for (const p of partes) {
    assert.equal(p.endsWith(";"), false, `la sentencia termina en ';', se partio mal: ${p.slice(-40)}`);
  }
  // El capileto con las 4 columnas de una vez debe quedar en una sola pieza.
  const calendario = partes.find((p) => /fecha_inicio date/.test(p));
  assert.ok(calendario, "no encontre el ALTER de calendar_exceptions");
  assert.match(calendario, /hora_fin text not null default '';?\s*$/);
  // El fix del DEFAULT de solapamiento: drop default ANTES del cambio de tipo.
  const iDrop = partes.findIndex((p) => /solapamiento drop default/.test(p));
  const iType = partes.findIndex((p) => /solapamiento type numeric/.test(p));
  assert.ok(iDrop >= 0 && iType >= 0, "faltan las sentencias de solapamiento");
  assert.ok(iDrop < iType, "el default debe caer antes de cambiar el tipo, o Postgres no castea");
});
