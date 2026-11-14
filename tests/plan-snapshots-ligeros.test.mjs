// plan_snapshots LIGERO Y CON RETENCION (2026-11-13).
//
// EL FALLO QUE ESTE TEST FIJA. MEDIDO 2026-11-13: la lista de instantaneas pedia
// `select=*` (payload de las 14 filas: 50.443.992 bytes, 5.8-7 s) y el rol `authenticated`
// tiene `statement_timeout = 8 s`. Con el arranque normal encima, PostgREST devolvia HTTP
// 500 (57014) y el plan no cargaba. La causa no era la base: era que la lectura pedia el
// cuerpo entero del plan para pintar una lista de metadatos.
//
// Lo que se comprueba, en el codigo y en el DDL:
//   1. La lista pide columnas y NINGUNA es `payload`.
//   2. La lectura de UNA instantanea pide `payload->operations`, no `payload`.
//   3. El escritor manda `plan_start` como COLUMNA (sin payload no hay de donde leerla).
//   4. El DDL tiene la columna generada y la retencion de 5 que NUNCA borra `draft`.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const raiz = new URL("../", import.meta.url);
const leer = (ruta) => readFile(new URL(ruta, raiz), "utf8").then((s) => s.replace(/\r\n/g, "\n"));

const bridge = await leer("src/web/shared/supabase-bridge-replacement.js");
const writer = await leer("src/web/shared/supabase-writer.js");
const delta = await leer("docs/schema-supabase-plan-delta-2026-11-13.sql");
const schema = await leer("docs/schema-supabase-plan.sql");

function entre(inicio, fin, fuente = bridge) {
  const start = fuente.indexOf(inicio);
  const end = fuente.indexOf(fin, start);
  assert.ok(start >= 0 && end > start, `falta ${inicio}`);
  return fuente.slice(start, end);
}

test("la lista de instantaneas no pide el payload", () => {
  const lista = entre("async function listPlanSnapshots()", "async function getPlanSnapshotLight(");
  assert.match(lista, /select: COLUMNAS_LISTA_SNAPSHOTS/, "tiene que mandar un select explicito");
  const columnas = entre("const COLUMNAS_LISTA_SNAPSHOTS = [", "].join(\",\");");
  assert.doesNotMatch(columnas, /payload/, "el payload son 50 MB medidos: no puede entrar en la lista");
  assert.match(columnas, /operations_count/, "el conteo tiene que venir de la columna generada");
  assert.match(columnas, /plan_start/, "la semana del plan tiene que venir de su columna");
});

test("la lectura de UNA instantanea pide payload->operations y no payload", () => {
  const una = entre("async function getPlanSnapshotLight(snapshotId)", "async function saveOperationPlanStatus(");
  assert.match(una, /ops:payload->operations/, "solo se necesita la lista de operaciones");
  assert.match(una, /select:/, "el select tiene que ser explicito");
  assert.doesNotMatch(una, /select: "\*"/, "nunca select=*");
});

test("el escritor manda plan_start y version como columnas", () => {
  const guardar = entre("async function guardarPlanSnapshot(fila, opciones)", "function cuerpoDePayload(data)", writer);
  assert.match(guardar, /cuerpo\.plan_start = planStart/, "sin la columna, la lista pierde la semana del plan");
  assert.match(guardar, /cuerpo\.version = version/);
});

test("el DDL conserva draft + 5 instantaneas y las demas se borran al insertar", () => {
  for (const [nombre, ddl] of [["delta", delta], ["schema-supabase-plan.sql", schema]]) {
    assert.match(ddl, /add column if not exists operations_count integer\s+generated always as/,
      `${nombre}: falta la columna generada con el conteo`);
    assert.match(ddl, /jsonb_array_length\(payload -> 'operations'\)/, `${nombre}: el conteo sale del payload`);
    assert.match(ddl, /security definer/, `${nombre}: el trigger borra como dueno de la tabla, no como el rol que inserto`);
    assert.match(ddl, /v_conservar constant integer := 5/, `${nombre}: la retencion es de 5`);
    assert.match(ddl, /where snapshot_id <> 'draft'/, `${nombre}: la fila draft NUNCA entra al ranking que se borra`);
    assert.match(ddl, /after insert on public\.plan_snapshots/, `${nombre}: la regla corre en cada insert`);
    assert.match(ddl, /row_number\(\) over \(order by created_at desc nulls last, id desc\)/,
      `${nombre}: el orden tiene que ser el de escritura y sin NULLS FIRST`);
  }
});

test("la retencion no depende de que la pagina borre nada", () => {
  // Si la regla se implementara en el navegador, el RPC plan_guardar (que inserta por su
  // cuenta) la saltearia y la tabla volveria a crecer sin limite.
  assert.doesNotMatch(bridge, /delete from plan_snapshots|from\("plan_snapshots"\)\.delete/i,
    "el borrado de la retencion es de la base, no de la pagina");
});
