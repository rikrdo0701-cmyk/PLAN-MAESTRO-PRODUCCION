// El DDL que habilita la regla (RULE-SUP-023) tiene que ser correcto ANTES de que
// el usuario meta su contrasena. Es el unico paso del proyecto que no se puede
// deshacer con un ctrl+z, y meter la contrasena en un DDL roto gasta una vez la
// unica oportunidad que el usuario tiene de escribirla sin que quede en ningun
// sitio.
//
// ESTOS TESTS NO APLICAN NADA. Solo leen el archivo y comprueban que:
//   1. se divide en sentencias que son SQL de verdad, sin que ningun comentario
//      se coma como sentencia;
//   2. los bloques$ abren y cierran, que es donde el divisor ya fallo una vez;
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
  // seis bloques y se comprueba cada uno: las dos funciones del espejo, la nueva
  // plan_guardar, y tres comprobaciones que abortan. El numero esta fijado a
  // proposito: si al anadir una comprobacion sube, el que lo cambia tiene que
  // venir aqui y confirmar que el bloque nuevo abre y cierra.
  const partes = dividir(ddl);
  const conD = partes.filter((p) => p.includes("$$"));
  assert.equal(conD.length, 6, `deberian ser 6 bloques $$ y hay ${conD.length}`);
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
    [/work_orders add column if not exists precio_desde text/, "work_orders.precio_desde"],
    [/work_orders add column if not exists precio_hasta text/, "work_orders.precio_hasta"],
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
  // precio_desde y precio_hasta PARECEN precios y son una ventana de FECHAS: app.js:1726
  // los normaliza con normalizeOtDate. Numeric aqui revienta el INSERT entero.
  assert.doesNotMatch(ddl, /precio_(desde|hasta) (numeric|integer|date)/i);
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

// ===========================================================================
// EL GUARDADO EN UNA TRANSACCION, y las marcas de retirada.
// ===========================================================================
//
// Estos tests no aplican nada: leen el DDL. La razon es la misma de los de
// arriba, y mas fuerte: plan_guardar es la unica parte de este proyecto que
// decide si la persona pierde su trabajo, y no se puede deshacer con un ctrl+z.

test("plan_guardar existe, con la firma que el navegador va a llamar", () => {
  assert.match(
    ddl,
    /create or replace function public\.plan_guardar\(\s*p_payload jsonb,\s*p_revision_esperada integer,\s*p_actor text default null\s*\)\s*returns jsonb/,
    "la firma tiene que ser exactamente la que el escritor va a llamar: si cambia, el POST del navegador da 404"
  );
  assert.match(ddl, /language plpgsql/);
  assert.match(ddl, /security definer/);
});

test("la revision se comprueba con un bloqueo de fila, no con una lectura normal", () => {
  // ESTA ES LA LINEA QUE HACE QUE FUNCIONE. Un `select ... for update` sobre la
  // fila unica de app_state serializa a los que guardan: el segundo espera a que
  // el primero termine, y para entonces ve la revision nueva y se rechaza. Sin el
  // `for update`, los dos compararian contra el mismo numero y los dos pasarian.
  // Y el `is distinct from` es a proposito: con `<>` un null nunca seria igual a
  // nada y el primer guardado con estado nuevo pasaria sin comprobar nada.
  assert.match(ddl, /select revision into v_actual from public\.app_state where id = 1 for update/i);
  assert.match(ddl, /if p_revision_esperada is distinct from v_actual then/i);
});

test("un conflicto NO se reporta como error de red", () => {
  // La distincion es lo que evita que alguien pierda su trabajo en silencio:
  // un conflicto se recarga y se reintenta, un error de red no. Si la pagina los
  // mezcla, en el peor caso ensaya otra vez encima del trabajo de otro.
  assert.match(ddl, /'conflicto', 'CONFLICT_REVISION'/);
  assert.match(ddl, /'revision_actual', v_actual/);
  // El recorte va desde la COMPROBACION del conflicto, no desde la primera
  // mencion de la palabra. Antes empezaba en el comentario de cabecera y
  // arrastraba hasta el raise de "p_payload no es un objeto", que ese si tiene
  // que ser excepcion: un payload mal formado no es recuperable, es un bug.
  const bloqueConflicto = ddl.slice(
    ddl.indexOf("if p_revision_esperada is distinct from v_actual then"),
    ddl.indexOf("v_nueva :=")
  );
  assert.ok(
    !/raise exception/.test(bloqueConflicto),
    "el conflicto se devuelve como jsonb, no se lanza: es recuperable y una excepcion lo hace parecer un fallo"
  );
  assert.match(bloqueConflicto, /return jsonb_build_object/);
});

test("la transaccion se deshace sola si algo falla a mitad", () => {
  // Un guardado a medias es PEOR que no guardar: la pagina siguiente lee un plan
  // que no escribio ninguna persona. Por eso no se envuelve en un jsonb con
  // ok:false, sino que se relanza y Postgres deshace.
  assert.match(ddl, /when others then[\s\S]{0,400}raise;/);
  assert.ok(
    !/when others then[\s\S]{0,400}jsonb_build_object\(\s*'ok', false/.test(ddl),
    "un error unexpected no puede disfrazarse de un ok:false, porque la pagina no podria distinguir fallo de conflicto"
  );
});

test("operations, work_orders y materials SOLO se actualizan: nunca insert ni delete", () => {
  // MEDIDO 2026-09-29: operations tiene 1000 filas de la ingesta del RESTlet 2246
  // con operation_id ns-XXXXX, y el navegador usa el MISMO key natural. Un borrado
  // desde la pagina se llevaria las filas que una sincronizacion metio despues de
  // la ultima carga, y no daria ningun error. Por eso el modo es 'actualiza'.
  const bloque = ddl.slice(ddl.indexOf("LAS TRES DEL ERP"), ddl.indexOf("LAS MARCAS DE RETIRADA"));
  assert.match(bloque, /update public\.%I t set %s from ex/);
  assert.ok(
    !/delete from public\.%I/.test(bloque),
    "no puede haber DELETE en las tres del ERP: destruirian la ingesta de NetSuite que el navegador no conoce"
  );
  assert.ok(
    !/insert into public\.%I t/.test(bloque),
    "no puede haber INSERT: la pagina no crea operaciones, las crea NetSuite"
  );
  // Y el modo sale de la tabla de reglas, no esta escrito a mano en la funcion.
  assert.match(bloque, /from public\.plan_tabla_escritura where tabla = v_tabla/);
  assert.match(bloque, /if v_modo <> 'actualiza' then/);
});

test("el update solo toca las columnas que la web decide, y eso sale de una tabla", () => {
  // El riesgo del otro lado: un update de fila completa pondria en NULL los datos
  // del ERP que el navegador no trae (descripcion, cantidades, tiempos). Perder
  // datos por no mandarlos es tan grave como perderlos por borrarlos.
  assert.match(ddl, /v_asignar := \(select string_agg\(quote_ident\(c\)/);
  assert.match(ddl, /create table if not exists public\.plan_tabla_escritura/);
  assert.match(ddl, /modo text not null check \(modo in \('actualiza','espejo','anexo','flujo'\)\)/);
  // Y las columnas del ERP tienen que estar EXCLUIDAS de la lista de la web.
  const listaOperaciones = ddl.slice(
    ddl.indexOf("('operations', 'actualiza'"),
    ddl.indexOf("'Solo decisiones de plan")
  );
  for (const fueraDeLaWeb of ["descripcion", "cant_total", "tiempo_ciclo", "tipo_insercion", "created_at"]) {
    assert.ok(
      !new RegExp("'" + fueraDeLaWeb + "'").test(listaOperaciones),
      fueraDeLaWeb + " es un dato del ERP y no puede estar en la lista de lo que la web escribe"
    );
  }
  for (const decisionDeLaWeb of ["maquina", "operador", "fecha_inicio", "hora_inicio", "kit_pending"]) {
    assert.ok(
      new RegExp("'" + decisionDeLaWeb + "'").test(listaOperaciones),
      decisionDeLaWeb + " si es una decision de la persona y tiene que estar en la lista"
    );
  }
});

test("app_state se actualiza AL FINAL, y su revision no se manda desde el navegador", () => {
  // La revision se incrementa DENTRO de la misma transaccion. Si se moviera
  // primero y algo fallara despues, la pagina creeria que guardo y el siguiente
  // guardado se rechazaria contra un numero que ya no corresponde a nada.
  const cuerpo = ddl.slice(ddl.indexOf("plan_guardar("), ddl.indexOf("comment on function public.plan_guardar"));
  const iAppState = cuerpo.indexOf("update public.app_state");
  const iEventos = cuerpo.indexOf("insert into public.operation_events");
  assert.ok(iAppState > iEventos, "app_state se actualiza despues de los eventos, no antes");
  assert.match(cuerpo, /set revision = v_nueva/);
  assert.ok(
    !/"revision"\s*:/.test(cuerpo.slice(0, iAppState)),
    "el navegador no puede mandar la revision: la incrementa la funcion dentro de la transaccion"
  );
});

test("las marcas de retirada salen de selected_ots, y no borran la operacion", () => {
  // MEDIDO 2026-09-29: NO existe en el estado ninguna lista de operaciones
  // retiradas. operationPlanStatuses es un objeto (app.js:249) y removedOperations
  // solo se calcula para el preview del dialogo de restaurar
  // (planning-workflow-core.js:1315). La unica fuente real y persistida es
  // selected_ots: si la OT sale de ahi, sus operaciones salen del plan.
  assert.match(ddl, /add column if not exists retirada_en timestamptz/);
  assert.match(ddl, /add column if not exists retirada_por text/);
  const bloque = ddl.slice(ddl.indexOf("LAS MARCAS DE RETIRADA"), ddl.indexOf("LAS CUATRO QUE LA PERSONA"));
  assert.match(bloque, /set retirada_en = now\(\), retirada_por = v_actor/);
  assert.match(bloque, /where ot = any\(v_salientes\) and retirada_en is null/);
  assert.ok(
    !/delete from public\.operations/.test(bloque),
    "retirar NO es borrar: la fila tambien la escribe la ingesta de NetSuite"
  );
  // Y al volver la OT, la marca se levanta. Sin esto, una OT que vuelve al plan
  // con sus operaciones saldria marcada como retirada para siempre.
  assert.match(bloque, /set retirada_en = null, retirada_por = null/);
  assert.match(bloque, /v_entrantes/);
  // El actor viene del JWT, no de lo que mande el navegador.
  assert.match(ddl, /v_actor := coalesce\(p_actor, 'desconocido'\)/);
});

test("app_state recibe su fila id=1 antes de que plan_guardar la necesite", () => {
  // MEDIDO 2026-09-29: app_state esta VACIA (0 filas). Sin esta fila, el
  // `select ... for update` no encuentra nada y no hay contra que comparar la
  // revision, o sea que la funcion no puede decidir y el guardado no va.
  assert.match(ddl, /insert into public\.app_state \(id, revision\) values \(1, 0\) on conflict \(id\) do nothing/);
  assert.match(ddl, /if not found then[\s\S]{0,200}raise exception/);
});

test("los indices unicos que hacen posible el upsert estan, con su justificacion medida", () => {
  // MEDIDO 2026-09-29 con sondas reales: operations.operation_id y
  // materials(ot,line_id) TIENEN indice unico (el upsert responde 200), pero
  // work_orders.wo_internal_id NO lo tenia, y el upsert ahi falla con 42P10
  // "there is no unique or exclusion constraint matching the ON CONFLICT
  // specification". Ese fallo solo se ve en produccion, nunca en un test unitario.
  assert.match(ddl, /create unique index if not exists work_orders_wo_internal_id_key on public\.work_orders \(wo_internal_id\)/);
  assert.match(ddl, /create unique index if not exists plan_snapshots_snapshot_id_key\s+on public\.plan_snapshots \(snapshot_id\)/);
  // Y el abort que hay al final comprueba que un indice no se quedo a medias.
  assert.match(ddl, /faltan indices unicos para el upsert/);
});

test("plan_guardar se abre a authenticated y SIGUE cerrada a anon, con la razon escrita", () => {
  // Es la distincion importante: ingesta_mirror borra tablas enteras sin mirar quien
  // llama, asi que sigue revocado para el navegador. plan_guardar no borra nada del
  // ERP, no crea operaciones, y rechaza el guardado si la revision no es la que el
  // navegador leyo. Eso es lo que hace aceptable exponerla, y la comprobacion del
  // bloque final aborta si alguien la abrio a anon.
  assert.match(ddl, /grant execute on function public\.plan_guardar\(jsonb, integer, text\) to authenticated/);
  assert.match(ddl, /revoke execute on function public\.plan_guardar\(jsonb, integer, text\) from anon/);
  assert.match(ddl, /revoke execute on function public\.plan_guardar\(jsonb, integer, text\) from public/);
  assert.match(ddl, /plan_guardar tiene EXECUTE para anon/);
  // Y sigue sin abrirse el que borra.
  assert.match(ddl, /revoke execute on function public\.ingesta_mirror\(text, jsonb\) from authenticated/);
});

test("la funcion declara que se deshace con raise, no que devuelve un ok falso", () => {
  // Si el error se envolviera en jsonb, la pagina no podria distinguir "no se
  // guardo, no pasa nada" de "hay un conflicto, recarga". Y con la transaccion ya
  // deshecha, devolver ok:false seria mentir: el estado no cambio pero la pagina
  // podria leerlo como un exito parcial.
  const cuerpo = ddl.slice(ddl.indexOf("exception"), ddl.indexOf("comment on function public.plan_guardar"));
  assert.match(cuerpo, /when others then/);
  assert.match(cuerpo, /raise;/);
});

test("plan_snapshots recibe la columna payload, y el motivo esta escrito", () => {
  // ERROR MIO, CORREGIDO. MEDIDO 2026-09-29: plan_snapshots tiene id, snapshot_id,
  // operations, generated_at, plan_start, version, usuario, change_summary,
  // published_at, publication_reason y created_at. NO tiene `payload`, y la primera
  // version de plan_guardar hacia
  //   insert into plan_snapshots (snapshot_id, payload, created_at)
  //   select snapshot_id, payload, ... from jsonb_populate_recordset(...)
  // Eso no resuelve. Y como la sentencia viene de jsonb_populate_recordset, no es
  // un INSERT que se salte esa fila y siga: se CAE LA TRANSACCION ENTERA. O sea que
  // un solo borrador habria roto todos los guardados, no solo los de borrador. Lo
  // encontro el agente que escribio el escritor, al usar el contrato que le di yo.
  assert.match(ddl, /alter table public\.plan_snapshots add column if not exists payload jsonb/);
  assert.match(ddl, /comment on column public\.plan_snapshots\.payload is/);
  // Y el por que de agregar la columna en vez de amoldar el insert a `operations`:
  // un borrador tiene que poder restaurar el plan entero, y `operations` es solo la
  // lista de operaciones.
  assert.match(ddl, /no alcanza para restaurar/);
});

test("la revision la pone la funcion, y el navegador no puede mandarla", () => {
  // MEDIDO por el mismo agente: `revision` estaba en la lista de columnas escribibles
  // de plan_tabla_escritura, con lo que cada fila quedaba con la revision que TENIA
  // la pagina y no con la que se guardo. Eso es un guardado por detras, y hace que
  // no se pueda atribuir un cambio a una revision concreta, que es justo para lo que
  // sirve la revision.
  const cuerpo = ddl.slice(ddl.indexOf("plan_guardar("), ddl.indexOf("comment on function public.plan_guardar"));
  assert.match(
    cuerpo,
    /\|\| ', revision = ' \|\| v_nueva/,
    "la funcion tiene que poner revision = v_nueva en las filas que actualiza"
  );
  // Y en las cuatro listas de columnas escribibles, `revision` NO puede estar.
  for (const tabla of ["operations", "work_orders", "materials", "operation_plan_statuses"]) {
    const desde = ddl.indexOf("('" + tabla + "', '");
    const hasta = ddl.indexOf("),", desde);
    const fila = ddl.slice(desde, hasta);
    assert.ok(
      !/'revision'/.test(fila),
      tabla + ": `revision` no puede estar en la lista de lo que escribe la pagina, o cada fila queda un guardado por detras"
    );
  }
});

test("el DDL no nombra una columna que plan_snapshots no tiene", async () => {
  // LA RED GENERAL DEL DDL, y la que habria atrapado lo de `payload` antes de que lo
  // encontrara un agente. plan_guardar nombra columnas por su nombre en UN sitio: el
  // update de app_state. Ahi un nombre equivocado no es un INSERT que se salta una
  // fila, es una sentencia que no resuelve y tumba la transaccion entera.
  //
  // Las demas tablas llegan por jsonb_populate_recordset, que no necesita que el
  // nombre exista en el texto, asi que ahi la red es la que trae el esquema medido
  // (tests/supabase-reader-mapeo.test.mjs).
  const esquema = JSON.parse(
    await readFile(new URL("../docs/esquema-supabase-medido.json", import.meta.url), "utf8")
  );
  const reales = new Set((esquema.app_state || []).map((c) => c.columna));
  assert.ok(reales.size > 0, "el esquema medido tiene que traer app_state, o este test no comprueba nada");

  // El bloque exacto del update, para no arrastrar el resto de la funcion.
  const iUpdate = ddl.indexOf("update public.app_state");
  const iFin = ddl.indexOf("where id = 1", iUpdate);
  assert.ok(iUpdate > 0 && iFin > iUpdate, "el update de app_state tiene que estar en el DDL");
  const bloque = ddl.slice(iUpdate, iFin);

  // Solo las columnas del LADO IZQUIERDO de cada asignacion, que es donde el nombre
  // tiene que existir. El lado derecho es una expresion y no se comprueba.
  const nombradas = new Set();
  const iSet = bloque.indexOf("set");
  assert.ok(iSet > 0, "el update de app_state tiene que tener un set");
  for (const a of bloque.slice(iSet + 3).split(",")) {
    const col = a.trim().split(/\s*=/)[0].trim();
    if (/^[a-z_][a-z0-9_]*$/.test(col)) nombradas.add(col);
  }
  assert.ok(nombradas.size >= 10, "el update tiene que nombrar sus columnas, y se detectaron " + nombradas.size);

  // Este DDL agrega columnas que todavia no estan, y hay que tenerlas en cuenta o el
  // test falla por lo que el DDL va a hacer, no por lo que el DDL esta mal.
  const agregadas = new Set();
  for (const m of ddl.matchAll(/alter table public\.app_state add column if not exists (\w+)/g)) agregadas.add(m[1]);

  const malas = [...nombradas].filter((c) => !reales.has(c) && !agregadas.has(c));
  assert.deepEqual(
    malas,
    [],
    "estas columnas no existen en app_state y el update no resolveria: " + malas.join(", ")
  );

  // Y el caso concreto que rompio todo: `payload` en plan_snapshots.
  const colsPlanSnapshots = new Set((esquema.plan_snapshots || []).map((c) => c.columna));
  assert.ok(
    !colsPlanSnapshots.has("payload"),
    "si el esquema medido ya trae payload, el DDL que la agrega es redundante y hay que quitarlo"
  );
  assert.match(ddl, /alter table public\.plan_snapshots add column if not exists payload jsonb/);
});

test("NINGUNA funcion se crea sin declarar su tipo de retorno", () => {
  // ERROR REAL, 2026-09-29. El usuario aplico el DDL y Postgres contesto
  //   ERROR: function result type must be specified
  // y el script se paro ahi. Las dos funciones de ingesta_mirror no declaraban
  // RETURNS, que en PostgreSQL es obligatorio: la firma acaba en el `as $$` del cuerpo.
  //
  // Esto llevo 25 tests sin verlo, porque todos comprobaban estructura (que el archivo
  // se divida en SQL, que los bloques $$ cierren, que los nombres de columna existan) y
  // NINGUNO comprobaba que Postgres aceptara la sentencia. Un DDL puede estar
  // estructuralmente perfecto y ser invalido, y gastarse la unica vez que el usuario
  // escribe la contrasena. Por eso el recorrido es sobre la FIRMA: desde
  // `create or replace function` hasta el `as $$`, que es donde acaba.
  const re = /create or replace function\s+([\s\S]{0,500}?)as\s+\$\$/g;
  const firmas = [];
  let m;
  while ((m = re.exec(ddl))) firmas.push(m[1]);
  assert.ok(firmas.length >= 3, "se esperaban al menos 3 funciones y se hallaron " + firmas.length);
  const sinReturns = firmas.filter((f) => !/\breturns\b/i.test(f));
  assert.deepEqual(
    sinReturns.map((f) => f.replace(/\s+/g, " ").trim().slice(0, 70)),
    [],
    "estas funciones no declaran RETURNS y Postgres las rechaza: function result type must be specified"
  );
});

test("el tipo de retorno sale del CUERPO de la funcion, no de una suposicion", () => {
  // ingesta_mirror tiene un `return jsonb_build_object(...)` explico: el tipo es jsonb y
  // se lee del codigo. Un test que solo mirara la firma podria poner cualquier cosa
  // despues y seguir en verde; este ata las dos cosas.
  const cuerpo = ddl.slice(ddl.indexOf("create or replace function public.ingesta_mirror("));
  const hasta = cuerpo.indexOf("$$", cuerpo.indexOf("$$") + 2);
  const cuerpoReal = cuerpo.slice(0, hasta);
  assert.match(cuerpoReal, /return jsonb_build_object\(/);
  assert.match(cuerpoReal.slice(0, 200), /returns jsonb/);
});

test("ingesta_mirror_v1 se suelta antes de crearse, porque su tipo no se puede cambiar", () => {
  // MEDIDO 2026-09-29: ingesta_mirror YA VIVE en la base, asi que su `create or replace`
  // tiene que coincidir con el tipo de retorno que ya tiene. Para la v1 no se sabe cual
  // era, y `create or replace` no cambia el tipo de retorno de una funcion existente:
  // falla con "cannot change return type of existing function". Por eso lleva un
  // `drop function if exists` antes, y es inocuo porque la v1, por definicion, no hace
  // nada: su unico cuerpo es un raise con el aviso de que la whitelist se movio a la
  // tabla.
  // Ojo con cual de las dos apariciones del nombre se mira: la PRIMERA es la del propio
  // `drop function if exists`, y un recorte que termina ahi acaba en "public." y nunca
  // ve el nombre. Se apunta a la del `create`, que es donde empieza la declaracion.
  const i = ddl.indexOf("create or replace function public.ingesta_mirror_v1");
  const previo = ddl.slice(Math.max(0, i - 500), i);
  assert.match(previo, /drop function if exists public\.ingesta_mirror_v1\(text, jsonb\)/);
  // Y la v1 no puede devolver nada, porque no devuelve nada.
  const cuerpo = ddl.slice(i);
  const hasta = cuerpo.indexOf("$$", cuerpo.indexOf("$$") + 2);
  assert.ok(!/return\s+/.test(cuerpo.slice(0, hasta)), "la v1 no debe tener return: su cuerpo es un raise");
});

test("el otro DDL pendiente, el del login, tampoco tiene funciones sin RETURNS", async () => {
  // El login se aplica DESPUES, con otra pasada con la contrasena. Si tiene el mismo
  // fallo, el usuario lo descubre tarde yhaving ya gastado la primera. Se comprueba
  // aqui aunque todavia no se haya aplicado nunca.
  const login = await readFile(new URL("../docs/schema-supabase-login-correo.sql", import.meta.url), "utf8");
  const re = /create or replace function\s+([\s\S]{0,500}?)as\s+\$\$/g;
  const sinReturns = [];
  let m;
  while ((m = re.exec(login))) if (!/\breturns\b/i.test(m[1])) sinReturns.push(m[1].replace(/\s+/g, " ").slice(0, 60));
  assert.deepEqual(sinReturns, [], "el DDL del login tiene funciones sin RETURNS: " + sinReturns.join(" | "));
});
