// Candado del disparador de updated_at. MEDIDO 2026-09-30: la alerta de "Datos viejos en
// Supabase" decia que operators llevaba 70 h sin escribirse, y era falso. La fila SI se habia
// escrito; un UPSERT de PostgREST solo toca las columnas del payload, y los catalogos no mandan
// updated_at, asi que la marca no se movia. La pagina miente y el aviso miente.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const ddl = await readFile(new URL("../docs/schema-supabase-cierre-catalogos.sql", import.meta.url), "utf8");

test("el DDL declara la funcion que pone updated_at, y el cuerpo $$ esta cerrado", () => {
  assert.match(ddl, /create or replace function public\.tocar_updated_at\(\) returns trigger/,
    "tiene que existir la funcion del disparador");
  assert.match(ddl, /language plpgsql/, "en plpgsql, que es lo que sabe hacer BEFORE UPDATE");
  // El cuerpo tiene que cerrar: un $$ sin cerrar parte la sentencia y el archivo entero se
  // niega a aplicarse, que es lo que hace scripts/apply-sql-supabase.mjs.
  const abiertos = (ddl.match(/\$\$/g) || []).length;
  assert.equal(abiertos % 2, 0, "los delimitadores $$ no estan emparejados");
  // Y tiene que poner la marca con el reloj de la base, no con el del navegador: si lo mandara
  // la pagina, un reloj mal puesto fecharia la fila en el pasado y la alerta volveria a mentir.
  assert.match(ddl, /new\.updated_at := now\(\)/,
    "la marca tiene que ponerla la base con now(), no el navegador");
});

test("el disparador esta en las ocho tablas que tienen updated_at, y en esas", () => {
  // MEDIDO 2026-09-30: 8 de 9. machine_planning_overrides NO tiene updated_at, tiene
  // actualizado, y por eso queda FUERA. Y queda fuera a proposito, no en silencio: su aviso
  // de antiguedad tampoco funciona, y eso es un dato que la persona tiene que ver.
  const disparadores = [...ddl.matchAll(/create trigger trg_tocar_updated_at before update on public\.(\w+)/g)].map((m) => m[1]);
  const esperadas = ["article_configurations", "calendar_exceptions", "capabilities", "matrix",
    "operators", "ot_configurations", "subcontracts", "tools"];
  assert.deepEqual(disparadores.slice().sort(), esperadas.slice().sort(),
    "los disparadores tienen que ser exactamente las ocho tablas con updated_at");
  assert.ok(!disparadores.includes("machine_planning_overrides"),
    "machine_planning_overrides no tiene updated_at: no puede llevar este disparador");
  // Y el motivo tiene que estar escrito, para que nadie lo "arregle" anadiendo uno que falla.
  assert.match(ddl, /machine_planning_overrides NO entra/,
    "el archivo tiene que decir por que esa tabla queda fuera");
});

test("cada disparador se TIRA antes de crearse", () => {
  // CREATE TRIGGER no es IF NOT EXISTS. Si el nombre cambia, el viejo se queda y los dos
  // escriben la misma columna, que no rompe nada pero es ruido que nadie pidio.
  const drops = [...ddl.matchAll(/drop trigger if exists trg_tocar_updated_at on public\.(\w+);/g)].map((m) => m[1]);
  const creates = [...ddl.matchAll(/create trigger trg_tocar_updated_at before update on public\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(drops.slice().sort(), creates.slice().sort(),
    "todas las que se crean se tiran antes: CREATE TRIGGER no tiene IF NOT EXISTS");
});

test("es BEFORE UPDATE, no un AFTER ni un INSTEAD", () => {
  // AFTER UPDATE llega tarde: NEW ya esta escrito en la tabla y cambiarlo ahi no hace nada.
  // INSTEAD OF es para tablas VIEWS, y estas son tablas.
  assert.doesNotMatch(ddl, /after update on public\.\w+\s*\n?\s*for each row execute function public\.tocar_updated_at/,
    "no puede ser AFTER: ahi NEW ya esta escrito y el cambio no tendria efecto");
  assert.doesNotMatch(ddl, /instead of update on public\./,
    "no puede ser INSTEAD OF: es para vistas");
});
