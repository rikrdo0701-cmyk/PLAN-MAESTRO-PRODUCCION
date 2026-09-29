// El DDL que habilita la regla (RULE-SUP-023) tiene que ser correcto ANTES de que
// el usuario meta su contrasena. Es el unico paso del proyecto que no se puede
// deshacer con un ctrl+z, y meter la contrasena en un DDL roto gasta una vez la
// unica oportunidad que el usuario tiene de escribirla sin que quede en ningun
// sitio.
//
// ESTOS TESTS NO APLICAN NADA. Solo leen el archivo y comprueban que:
//   1. se divide en sentencias que son SQL de verdad, sin que ningun comentario
//      se coma como sentencia;
//   2. los bloques $$ abren y cierran, que es donde el divisor ya fallo una vez;
//   3. las 12 columnas que el usuario aprobo estan, con los tipos que la app
//      necesita, que es la parte que no se puede inventar y por eso se fija;
//   4. la tabla del log existe, con los cuatro indices que hacen falta para que
//      la vista de debug no sea un seq scan sobre una tabla que solo crece;
//   5. ningun permiso queda abierto a anon, porque con el DDL a medias la puerta
//      se queda peor que antes.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const ddl = await readFile(new URL("../docs/schema-supabase-plan.sql", import.meta.url), "utf8");

const fuente = await readFile(new URL("../scripts/apply-sql-supabase.mjs", import.meta.url), "utf8");
const desde = (a, b) => {
  const i = fuente.indexOf(a);
  const j = b ? fuente.indexOf(b, i) : fuente.length;
  return fuente.slice(i, j);
};
const ctx = { console, JSON, String, Number, Array, Object, Error, RegExp };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(
  desde("function dividir(", "const PALABRAS_SQL") + desde("const PALABRAS_SQL", "async function diagnosticarTodas(") +
    "\nglobalThis.dividir=dividir;globalThis.diagnosticoDeFragmentos=diagnosticoDeFragmentos;",
  ctx
);
const dividir = (...a) => Array.from(ctx.dividir(...a));
const diagnosticoDeFragmentos = (s) => Array.from(ctx.diagnosticoDeFragmentos(s));

test("el DDL se divide en SQL de verdad", () => {
  const partes = dividir(ddl);
  const malos = diagnosticoDeFragmentos(partes);
  assert.deepEqual(malos, [], "fragmentos que no son SQL:\n" + malos.join("\n"));
  assert.ok(partes.length >= 40, `solo ${partes.length} sentencias; el archivo tiene bastante mas que eso`);
});

test("ningun bloque dollar-quoted queda partido", () => {
  // MEDIDO 2026-09-29: el divisor perdia un '$' del cierre $$ y la sentencia llegaba
  // a Postgres como 'unterminated dollar-quoted string'. Con el DDL del plan hay
  // cuatro bloques (dos funciones y dos comprobaciones) y se comprueba cada uno.
  const partes = dividir(ddl);
  const conD = partes.filter((p) => p.includes("$$"));
  assert.equal(conD.length, 4, `deberian ser 4 bloques $$ y hay ${conD.length}`);
  for (const p of conD) {
    const abiertos = (p.match(/\$\$/g) || []).length;
    assert.equal(abiertos % 2, 0, `bloque con un numero impar de $$: quedaria sin cerrar\n${p.slice(0, 120)}`);
    assert.ok(/\b(language plpgsql|do)\b/.test(p), `un bloque $$ no es una funcion ni un do: ${p.slice(0, 80)}`);
  }
});

test("las 12 columnas que el usuario aprobo estan, con los tipos que la app necesita", () => {
  // Los tipos no son un detalle: prioridad es TEXTO porque la app acepta 'ALTO' y
  // 'BAJO' ademas de numeros (normalizePriority), y las fechas son TEXTO porque
  // la hoja guarda 'SIN FECHA' y una columna date haría fallar el INSERT entero.
  const esperadas = [
    [/operations add column if not exists num integer/, "operations.num"],
    [/operations add column if not exists parte text/, "operations.parte"],
    [/operations add column if not exists contenido text/, "operations.contenido"],
    [/operations add column if not exists prioridad text/, "operations.prioridad"],
    [/operations add column if not exists fecha_req text/, "operations.fecha_req"],
    [/operations add column if not exists comentario text/, "operations.comentario"],
    [/operations add column if not exists tiempo_fallback numeric/, "operations.tiempo_fallback"],
    [/operations add column if not exists kit_pending boolean not null default false/, "operations.kit_pending"],
    [/work_orders add column if not exists due_date_override text/, "work_orders.due_date_override"],
    [/work_orders add column if not exists precio_desde numeric/, "work_orders.precio_desde"],
    [/work_orders add column if not exists precio_hasta numeric/, "work_orders.precio_hasta"],
  ];
  for (const [re, nombre] of esperadas) {
    assert.match(ddl, re, `falta la columna ${nombre} con su tipo`);
  }
  // 11 columnas mas la tabla operation_events: el usuario aprobo 12 huecos, y uno de
  // ellos--el log-- se resuelve como tabla y no como columna. El numero se fija para
  // que, si alguien anade o quita una, el usuario se entere.
  assert.equal(esperadas.length, 11, "son 11 columnas y 1 tabla (operation_events); si el numero cambia, hay que avisar al usuario");
});

test("prioridad y las fechas NO son numeric ni date, y el motivo queda escrito", () => {
  // Si alguien 'mejora' estos tipos, el guardado empieza a fallar con un 400 de
  // Postgres que no dice de donde viene. El motivo tiene que estar en el archivo.
  assert.doesNotMatch(ddl, /prioridad (integer|numeric|bigint)/i);
  assert.doesNotMatch(ddl, /fecha_req date/i);
  assert.match(ddl, /POR QUE LAS FECHAS SON text/, "el por que de los tipos tiene que estar en el archivo");
  assert.match(ddl, /prioridad es text y no integer/i);
});

test("el log es una TABLA con indice, no una columna mas de operations", () => {
  // El usuario lo pidio el 2026-09-29: 'log es la que más necesita tu criterio...
  // podria ser otra tabla de supabase'. Y la razon esta escrita: un log es un
  // flujo, y como columna operations crecia sin limite en la tabla que el
  // planificador lee en cada render.
  assert.match(ddl, /create table if not exists public\.operation_events/);
  assert.doesNotMatch(ddl, /operations add column if not exists log/, "el log no puede ser columna de operations");
  for (const col of ["operation_id text not null", "kind text not null", "at timestamptz", "actor text", "payload jsonb"]) {
    assert.match(ddl, new RegExp(col.replace(/[()]/g, "\\$&")), `falta la columna del evento: ${col}`);
  }
  const indices = (ddl.match(/create index if not exists operation_epochs?/g) || []).length
    + (ddl.match(/create index if not exists operation_events/g) || []).length;
  assert.equal(indices, 4, `operation_events necesita 4 indices para la vista de debug y hay ${indices}`);
});

test("la whitelist del espejo es una TABLA, y el RPC la lee", () => {
  // Esta es la pieza de escalabilidad: agregar una tabla al sistema tiene que
  // costar una fila, no un bloque de SQL. Y el RPC tiene que leer de la tabla, o
  // las dos listas se separan en silencio.
  assert.match(ddl, /create table if not exists public\.ingesta_mirror_whitelist/);
  assert.match(ddl, /from public\.ingesta_mirror_whitelist w where w\.tabla = v_tabla/, "el RPC tiene que leer la tabla, no una lista en su cuerpo");
 assert.match(ddl, /\('app_state',\s*'estado del plan/);
 assert.match(ddl, /\('operations',\s*'ingesta de NetSuite y, desde la web/);
});

test("el RPC se queda en service_role: la pagina escribe por politicas, no por el espejo", () => {
  // El espejo BORRA la tabla. Si la pagina pudiera llamarlo, podria vaciar el plan
  // con una peticion. Las escrituras de la web van por INSERT/UPDATE/DELETE con
  // las politicas escritura_app.
  assert.match(ddl, /revoke execute on function public\.ingesta_mirror\(text, jsonb\) from anon;/);
  assert.match(ddl, /revoke execute on function public\.ingesta_mirror\(text, jsonb\) from authenticated;/);
  assert.match(ddl, /grant execute on function public\.ingesta_mirror\(text, jsonb\) to service_role;/);
});

test("todas las politicas son para authenticated y con with check", () => {
  // Sin with check, RLS filtra lo que se lee y no lo que se escribe. Es la razon
  // de que el DDL anterior (schema-supabase-login-correo.sql) lo pusiera explicito
  // y este tiene que mantenerlo.
  assert.doesNotMatch(ddl, /to anon/);
  assert.doesNotMatch(ddl, /for select to public/i);
  const escrituras = ddl.match(/for all to authenticated using \(true\) with check \(true\)/g) || [];
  assert.ok(escrituras.length >= 1, "tiene que haber politicas de escritura con WITH CHECK explicito");
  assert.match(ddl, /with check explicito y no por omision/, "el motivo de WITH CHECK tiene que quedar escrito");
});

test("el archivo lleva comprobaciones que abortan si algo fallo a medias", () => {
  // Un DDL que se aplica a medias y no dice nada deja la base en un estado que
  // nadie pidio. Estas comprobaciones son las que evitan creerse un exito parcial.
  assert.match(ddl, /raise exception/);
  assert.match(ddl, /operations: hay % de 8 columnas nuevas/);
  assert.match(ddl, /work_orders: hay % de 3 columnas nuevas/);
  assert.match(ddl, /QUEDAN % politicas abiertas a anon/);
});

test("las 7 tablas del estado del plan salen de 'no hay escritor' a 'la web escribe'", () => {
  // MEDIDO 2026-09-29: 18 de 25 tablas pobladas, 7 vacias, y las 7 vacias son
  // exactamente app_state, selected_ots, locked_ots, operation_plan_statuses,
  // plan_snapshots, unconfirmed_work_orders y closed_work_order_summaries.
  const enLectura = ddl.slice(ddl.indexOf("lecturas text[]"), ddl.indexOf("escrituras text[]"));
  const enEscritura = ddl.slice(ddl.indexOf("escrituras text[]"), ddl.indexOf("begin\n  foreach"));
  for (const t of ["app_state", "selected_ots", "locked_ots", "operation_plan_statuses", "plan_snapshots", "unconfirmed_work_orders", "closed_work_order_summaries"]) {
    assert.ok(enLectura.includes(`'${t}'`), `${t} tiene que estar en las lecturas`);
    assert.ok(enEscritura.includes(`'${t}'`), `${t} tiene que estar en las escrituras: hoy no la escribe nadie`);
  }
});
