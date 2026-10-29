// La sonda web tiene que servir un PostgREST FIJO que no separe de las filas que la pagina lee
// de verdad. Este test es la red que hace que esa copia no se vayaidicando sola.
//
// QUE PASABA. MEDIDO 2026-10-05: `npm run probe` estaba roto desde el 2026-10-03 (verde por
// ultima vez el 2026-09-27). Con RULE-SUP-030 la pagina no lee por el puente de Apps Script:
// lee Supabase directo con `fetch` (`PPSupabaseReader.restUrl`), y el bundle de `site/` trae
// embebida la URL REAL del proyecto. La sonda seguia falseando `window.PPAppsScriptBridge` -un
// camino que nadie recorre- y su guarda anti-produccion cortaba las 34 peticiones del lector:
// la app arrancaba sin estado, la precondicion abortaba la corrida y el informe|reportaba 0
// tarjetas, 0 OTs y 0 llamadas al puente. Un informe de "todo bien" sobre una app que no arranco
// es peor que no tener sonda.
//
// QUE HACE LA SONDA AHORA. El mismo servidor local de la sonda atiende `/rest/v1/<tabla>` con
// filas del MISMO fixture que ya se sembraba en localStorage, y `configure()` -el gancho que el
// propio lector expone- apunta ahi el lector y el escritor. Se falsea el ORIGEN, no el camino:
// la app arranca por Supabase, con el lector real, sus mappers y su paginacion, y nada sale de
// la maquina porque la guarda sigue cortando todo lo que no sea de este origen.
//
// POR QUE ESTE TEST. El riesgo de un PostgREST falso no es que no responda: es que responda con
// la forma VIEJA. Una columna que el lector dejo de leer, una tabla que se renombro o una que se
// borre del proyecto se convierten en una sonda que mide una app que ya no existe, y eso no se
//ve en ningun informe porque todo sale "ok". Por eso cada columna escrita aqui se ata a una
// columna que el LECTOR REAL lee (`row.<columna>` en el mapper de esa tabla), y cada tabla servida
// a una tabla que el lector pide. Si el esquema o el lector cambian, esto falla en vez de servir
// la forma vieja.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { buildFixture } from "../scripts/web-fixture.mjs";
import { filasDesdeFixture, responderPostgREST, TABLAS_INEXISTENTES } from "../scripts/web-probe-supabase.mjs";

const readerSource = await readFile(new URL("../src/web/shared/supabase-reader.js", import.meta.url), "utf8");
const probeSource = await readFile(new URL("../scripts/web-probe.mjs", import.meta.url), "utf8");
const writerSource = await readFile(new URL("../src/web/shared/supabase-writer.js", import.meta.url), "utf8");

/**
 * Las tablas que se sirven en el almacen local y que NADIE LEE: solo las escribe el escritor. Van
 * una por una y con su porque, porque una tabla de mas en el almacen local es una tabla que la
 * sonda podria servir con datos que la pagina nunca va a ver.
 */
const TABLAS_QUE_SOLO_ESCRIBE_EL_ESCRITOR = new Set([
  // La crea el mismo DDL que `plan_guardar` (docs/schema-supabase-plan.sql:126). El escritor la
  // usa en el camino viejo, un POST por evento (supabase-writer.js:1555).
  "operation_events",
]);
// El esquema NO esta en un solo archivo: `machine_catalog` esta en `schema-machine-catalog.sql` y
// el resto en `schema-supabase.sql`. Se leen todos los `schema*.sql` de docs/, que es donde vive
// el DDL del proyecto.
const ddlSource = (
  await Promise.all(
    (await readdir(new URL("../docs", import.meta.url)))
      .filter((nombre) => /^schema.*\.sql$/.test(nombre))
      .sort()
      .map((nombre) => readFile(new URL(`../docs/${nombre}`, import.meta.url), "utf8")),
  )
).join("\n");

/**
 * Las columnas que el DDL declara para una tabla.
 *
 * MEDIDO 2026-10-05: hace falta porque hay columnas que la sonda tiene que escribir sin que el
 * LECTOR las lea. `app_state.id` es `primary key ... check (id = 1)` y el escritor la usa para
 * parchear la fila (`PATCH app_state?id=eq.1`, supabase-writer.js:1528); `mapAppState` no la lee
 * porque no la necesita. Antes de esto, el `id` faltaba en el fixture y el parche no encontraba
 * fila -se perdia en silencio-, y la unica forma de escribirlo era romper el guard de "toda
 * columna escrita la lee el lector". Atarlo al DDL deja pasar `id` sin abrir la puerta a que la
 * sonda escriba una columna que no existe en ninguna parte.
 */
function columnasDelDDL(tabla) {
  const desde = ddlSource.search(new RegExp(`create table (?:if not exists )?(?:public\\.)?${tabla}\\s*\\(`, "i"));
  if (desde < 0) return new Set();
  const hasta = ddlSource.indexOf(");", desde);
  const cuerpo = ddlSource.slice(desde + 1, hasta < 0 ? ddlSource.length : hasta);
  const columnas = new Set();
  for (const linea of cuerpo.split("\n")) {
    const hit = /^\s+([a-z_][a-z0-9_]*)\s+[a-z]/i.exec(linea);
    if (hit) columnas.add(hit[1]);
  }
  return columnas;
}

// ---------------------------------------------------------------------------
// LAS COLUMNAS QUE EL LECTOR REAL LEE
// ---------------------------------------------------------------------------

/** Tabla de la sonda -> mapper del lector que la convierte en estado. */
const MAPPER_POR_TABLA = {
  app_state: "mapAppState",
  operators: "mapOperators",
  capabilities: "mapCapabilities",
  operation_catalog: "mapOperationCatalog",
  matrix: "mapMatrix",
  machine_catalog: "mapMachines",
  // MEDIDO 2026-10-05: la sonda antes la servia con 404 y no la vigila. Ahora que se sirve con
  // filas (existe en produccion, 8 filas medidas), sus columnas tienen que estar cubiertas igual
  // que las dems: `machine_nombre` y `excluida` las lee `mapMachinePlanningOverrides`, que es la
  // que arma `state.machinePlanningOverrides` (supabase-reader.js:1494); `actualizado` esta en el
  // DDL.
  machine_planning_overrides: "mapMachinePlanningOverrides",
  operations: "mapOperations",
  work_orders: "mapWorkOrders",
  selected_ots: "mapSelectedOts",
  locked_ots: "mapLockedOts",
  operation_plan_statuses: "mapPlanStatuses",
  tools: "mapTools",
  ot_configurations: "mapOtConfigurations",
  article_configurations: "mapArticleConfigurations",
  materials: "mapMaterials",
};

/**
 * Las columnas que un mapper lee de la FILA. Se sacan del cuerpo del mapper (`row.<columna>`), no
 * de una lista escrita a mano: asi la red se mueve sola si el lector agrega o cambia una columna.
 * Los prefijos covers los alias que usa el codigo (`linea`, `fila`, `r`, `value`).
 */
function columnasQueLee(fn) {
  const lineas = readerSource.split("\n");
  const desde = lineas.findIndex((linea) => new RegExp(`^  function ${fn}\\(`).test(linea));
  assert.ok(desde >= 0, `supabase-reader.js no tiene ${fn}: la tabla que lo usaba cambio de mapper`);
  let hasta = desde + 1;
  while (hasta < lineas.length && !/^  function [A-Za-z]/.test(lineas[hasta])) hasta += 1;
  const cuerpo = lineas.slice(desde, hasta).join("\n");
  const columnas = new Set();
  for (const hit of cuerpo.matchAll(/\b(?:row|linea|fila|r|value)\.([a-z_][a-z0-9_]*)/g)) columnas.add(hit[1]);
  return columnas;
}

/** Una constante del lector que es una lista de nombres de tabla, leida del propio fuente. */
function listaDeTablas(nombre) {
  const hit = new RegExp(`const ${nombre} = \\[([^\\]]*)\\]`).exec(readerSource);
  assert.ok(hit, `supabase-reader.js ya no declara ${nombre}: la sonda tiene que revisarlo`);
  return [...hit[1].matchAll(/"([a-z_][a-z0-9_]*)"/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------
// EL ESTADO DE PRUEBA
// ---------------------------------------------------------------------------

/**
 * El fixture con UN estado de plan puesto a mano. Sin esto, `operation_plan_statuses` sale vacio
 * (el fixture no siembra estados), su fila nunca llega al guard de columnas y la tabla quedaria
 * sin cubrir justo por no tener datos: un test que depende de que haya filas para poder fallar.
 */
function estadoConUnPlan() {
  const estado = buildFixture({ otCount: 4, seed: 20260925 });
  const primera = estado.operations[0];
  estado.operationPlanStatuses = {
    [`${primera.ot}|${primera.secuencia}|${primera.ct}`]: { status: "COMPLETADA", origin: "PLAN", completedAt: new Date().toISOString() },
  };
  return estado;
}

// ---------------------------------------------------------------------------
// 1. CADA COLUMNA ESCRITA LA LEE EL LECTOR DE VERDAD
// ---------------------------------------------------------------------------

test("toda columna que la sonda escribe la lee el lector de verdad", () => {
  const tablas = filasDesdeFixture(estadoConUnPlan());
  const sueltas = [];
  for (const [tabla, filas] of Object.entries(tablas)) {
    const mapper = MAPPER_POR_TABLA[tabla];
    if (!mapper) continue; // Las tablas vacias no tienen columnas que revisar.
    assert.ok(filas.length, `${tabla} tiene mapper pero el fixture no le dio ninguna fila: el guard de columnas no la cubrio`);
    const leidas = columnasQueLee(mapper);
    const declaradas = columnasDelDDL(tabla);
    assert.ok(declaradas.size, `${tabla} no sale del DDL de docs/schema-supabase.sql: el guard de columnas no tiene contra que comparar`);
    for (const fila of filas) {
      for (const columna of Object.keys(fila)) {
        // O la lee el lector de verdad, o la declara el DDL porque hace falta para ESCRIBIR
        // (la clave primaria con la que el escritor parchea). Lo que no se permite es una
        // columna que no existe: ahi el PostgREST falso y la base real diverge en silencio.
        if (!leidas.has(columna) && !declaradas.has(columna)) sueltas.push(`${tabla}.${columna} (ni ${mapper} la lee ni el DDL la declara)`);
      }
    }
  }
  assert.deepEqual(sueltas, [], `columnas que la sonda inventa y nadie lee: ${sueltas.join(", ")}`);
});

test("el guard de columnas cubre las dieciseis tablas con datos", () => {
  // Si alguien quita una tabla del mapper, el guard deja de mirarla en silencio. Este test lo
  // dice: la cuenta de tablas vigiladas es parte del contrato.
  const tablas = filasDesdeFixture(estadoConUnPlan());
  const conFilas = Object.entries(tablas).filter(([, filas]) => filas.length).map(([tabla]) => tabla).sort();
  assert.deepEqual(conFilas, Object.keys(MAPPER_POR_TABLA).sort());
});

// ---------------------------------------------------------------------------
// 2. CADA TABLA SERVIDA ES UNA TABLA QUE EL LECTOR PIDE
// ---------------------------------------------------------------------------

test("la sonda solo sirve tablas que el lector pide", () => {
  const pedidas = new Set([...listaDeTablas("TABLES"), ...listaDeTablas("CATALOG_TABLES"), ...listaDeTablas("PERSON_TABLES"), ...TABLAS_QUE_SOLO_ESCRIBE_EL_ESCRITOR]);
  const servidas = Object.keys(filasDesdeFixture(estadoConUnPlan()));
  const inventadas = servidas.filter((tabla) => !pedidas.has(tabla));
  assert.deepEqual(inventadas, [], `tablas que la sonda sirve y el lector nunca pide: ${inventadas.join(", ")}`);
});

test("las unicas tablas que se sirven sin que el lector las pida son las que escribe el escritor", () => {
  // MEDIDO 2026-10-05: `operation_events` la crea el mismo DDL que `plan_guardar`
  // (docs/schema-supabase-plan.sql:126), o sea que existe en produccion, y el escritor la usa:
  // en el camino viejo manda un POST por evento (supabase-writer.js:1555). Sin declararla en el
  // almacen local, el falso le contestaba 404 y el guardado del plan se perdia entero con
  // "operation_events: se omitieron N evento(s)" -un defecto de la sonda que salia como si fuera
  // de la pagina-.
  //
  // La excepcion se declara TABLA POR TABLA, no como "cuantasquiera que el escritor escriba": una
  // tabla de mas en el almacen local es una tabla que la sonda podria servir con datos que la
  // pagina nunca vera, que es el modo de fallo que este archivo existe para evitar.
  const pedidas = new Set([...listaDeTablas("TABLES"), ...listaDeTablas("CATALOG_TABLES"), ...listaDeTablas("PERSON_TABLES")]);
  const servidas = Object.keys(filasDesdeFixture(estadoConUnPlan()));
  const extra = servidas.filter((tabla) => !pedidas.has(tabla));
  assert.deepEqual(extra.filter((tabla) => !TABLAS_QUE_SOLO_ESCRIBE_EL_ESCRITOR.has(tabla)), [], `tablas que ni el lector pide ni el escritor escribe: ${extra.join(", ")}`);
  // Y cada una se escribe en el codigo REAL: si el escritor deja de usarla, la lista se caduca.
  for (const tabla of TABLAS_QUE_SOLO_ESCRIBE_EL_ESCRITOR) {
    assert.ok(servidas.includes(tabla), `${tabla} la escribe el escritor y no esta en el almacen local`);
    assert.ok(new RegExp(`"${tabla}"`).test(writerSource), `supabase-writer.js ya no menciona ${tabla}: la excepcion del guard esta caduca`);
  }
});

test("machine_planning_overrides se sirve CON FILAS porque en produccion EXISTE", () => {
  // MEDIDO 2026-10-05T18:31Z con sesion (sin sesion el RLS responde cero y no mide nada,
  // RULE-SUP-037): la tabla existe con 8 filas, `machine_nombre` 39, 40, 42, 90, 113, 188, 209 y
  // 211, todas `excluida = false`, `actualizado` 2026-09-29T22:20:31Z. La version anterior de esta
  // sonda la respondia 404 porque el 2026-10-01 se concluyo que no existia, y eso hacia que
  // `supabase-catalog-boot.js:406` marcara `informe.fallo` y `supabase-catalog-apply.js:141`
  // ABORTARA la aplicacion entera: dos corridas midiendo el estado del fixture, no el leido.
  assert.deepEqual(TABLAS_INEXISTENTES, [], "ninguna tabla que la pagina lee falta en produccion (medido 2026-10-05)");
  const url = new URL("http://127.0.0.1:1/rest/v1/machine_planning_overrides?select=*");
  const respuesta = responderPostgREST(url, "GET", {}, filasDesdeFixture(estadoConUnPlan()));
  assert.equal(respuesta.status, 200);
  const filas = JSON.parse(respuesta.body);
  assert.ok(filas.length > 0, "la tabla existe: servirla vacia seria fingir que no hay maquinas");
  for (const fila of filas) {
    assert.equal(typeof fila.machine_nombre, "string", "machine_nombre es la clave que lee mapMachines");
    assert.equal(fila.excluida, false, "en produccion nadie ha apartado ninguna maquina");
  }
  // La forma de produccion: una fila por maquina del catalogo MAS una cuya maquina ya no esta.
  const tablas = filasDesdeFixture(estadoConUnPlan());
  const delCatalogo = filas.filter((f) => tablas.machine_catalog.some((m) => m.nombre === f.machine_nombre));
  assert.equal(delCatalogo.length, tablas.machine_catalog.length, "toda maquina del catalogo tiene su fila de override");
  assert.ok(filas.length > delCatalogo.length, "esta la fila sobrante de la maquina retirada (medido: la 90)");
});

test("el catalogo de maquinas trae una fila que el fixture NO tiene, para poder distinguir de donde salio", () => {
  // Sin esto, contar maquinas no prueba nada: el fixture ya trae 4 y con el apply abortado tambien
  // son 4. El falso sirve una de mas (`SUP-05`), y el check de la sonda la busca por nombre.
  const tablas = filasDesdeFixture(estadoConUnPlan());
  const nombres = tablas.machine_catalog.map((m) => m.nombre);
  assert.ok(nombres.indexOf("SUP-05") >= 0, "machine_catalog tiene la maquina que solo existe en Supabase");
  const delFixture = (estadoConUnPlan().machines || []).map((m) => m.name || m.machine);
  assert.ok(delFixture.indexOf("SUP-05") < 0, "SUP-05 no esta en el estado del fixture, que es justo lo que la distingue");
});

// ---------------------------------------------------------------------------
// 3. EL POSTGREST FALSO SE PARECE AL DE VERDAD EN LO QUE EL LECTOR LE PIDE
// ---------------------------------------------------------------------------

const pedir = (url, metodo = "GET", headers = {}, tablas = null) =>
  responderPostgREST(new URL(url), metodo, headers, tablas || filasDesdeFixture(estadoConUnPlan()));

test("filtra por columna con eq.", () => {
  const estado = estadoConUnPlan();
  // La OT se toma del fixture, no se escribe a mano: los numeros de OT los genera el semillero y
  // un `eq.3001` fijo pasaria a filtrar por vacio en cuanto cambiara la semilla.
  const ot = estado.workOrders[1].ot;
  const filas = pedir(`http://x/rest/v1/work_orders?select=*&ot=eq.${ot}`, "GET", {}, filasDesdeFixture(estado));
  assert.equal(filas.status, 200);
  const body = JSON.parse(filas.body);
  assert.ok(body.length > 0, `el filtro no devolvio nada para la OT ${ot}`);
  assert.ok(body.every((fila) => fila.ot === ot));
});

test("corta con limit y offset, como hace la paginacion del lector", () => {
  const todas = JSON.parse(pedir("http://x/rest/v1/work_orders?select=*").body);
  const limite = pedir("http://x/rest/v1/work_orders?select=*&limit=1");
  const pagina = pedir("http://x/rest/v1/work_orders?select=*&limit=1&offset=1");
  assert.equal(JSON.parse(limite.body).length, 1);
  assert.equal(JSON.parse(pagina.body)[0].ot, todas[1].ot);
});

test("ordena con order=col.asc,col2.desc", () => {
  const filas = JSON.parse(pedir("http://x/rest/v1/work_orders?select=*&order=ot.desc").body);
  const ots = filas.map((f) => f.ot);
  assert.deepEqual(ots, [...ots].sort().reverse());
});

test("devuelve content-range cuando piden el conteo exacto", () => {
  const filas = pedir("http://x/rest/v1/operations?select=*&limit=3", "GET", { prefer: "count=exact" });
  const total = JSON.parse(pedir("http://x/rest/v1/operations?select=*").body).length;
  assert.equal(filas.headers["content-range"], `0-2/${total}`);
  const sinPrefer = pedir("http://x/rest/v1/operations?select=*&limit=3");
  assert.equal(sinPrefer.headers["content-range"], undefined);
});

test("responde 404 con la forma de PostgREST para una tabla que no existe", () => {
  const respuesta = pedir("http://x/rest/v1/tabla_inventada?select=*");
  assert.equal(respuesta.status, 404);
  const body = JSON.parse(respuesta.body);
  assert.equal(body.code, "42P01");
  assert.match(body.message, /tabla_inventada/);
});

test("no es del lector lo que no es /rest/v1", () => {
  assert.equal(responderPostgREST(new URL("http://x/index.html"), "GET", {}, {}), null);
  assert.equal(responderPostgREST(new URL("http://x/api/appState"), "POST", {}, {}), null);
});

// ---------------------------------------------------------------------------
// 3b. EL FALSO ESCRIBE COMO ESCRIBE EL DE VERDAD
// ---------------------------------------------------------------------------
//
// POR QUE ESTOS TESTS. MEDIDO 2026-10-05: sin escrituras el PostgREST falso contestaba 200 a un
// POST sin guardar nada, y "Generar plan" terminaba con "No se pudo guardar el plan (OT ...)",
// sin dejar NI UNA operacion con fecha. Todo lo que se media despues -el motor, el Gantt, el
// cuadre con los reportes- era entonces la medida de un plan que no existia, y el informe lo
// contaba como defecto de la app. Un falso que no escribe no es un falso: es una pagina que no
// puede guardar, y eso hay que medirlo en el test, no descubrirlo en la corrida.

test("el POST hace upsert por la columna de on_conflict y no duplica", () => {
  const tablas = filasDesdeFixture(estadoConUnPlan());
  const antes = tablas.operations.length;
  const existente = tablas.operations[0];
  const prefers = { prefer: "resolution=merge-duplicates,return=minimal" };
  const escritura = {
    headers: prefers,
    cuerpo: [{ ...existente, start: "2026-10-06T06:00:00.000Z" }],
  };
  const respuesta = responderPostgREST(new URL("http://x/rest/v1/operations?on_conflict=operations.operation_id"), "POST", escritura.headers, tablas, escritura);
  assert.equal(respuesta.status, 201);
  assert.equal(tablas.operations.length, antes, "un upsert no puede agregar filas");
  const misma = tablas.operations.find((f) => f.operation_id === existente.operation_id);
  assert.equal(misma.start, "2026-10-06T06:00:00.000Z", "el upsert tiene que actualizar la fila que ya estaba");
  assert.deepEqual(JSON.parse(respuesta.body), [], "con return=minimal el cuerpo va vacio");

  const nueva = responderPostgREST(
    new URL("http://x/rest/v1/operations?on_conflict=operations.operation_id"),
    "POST",
    prefers,
    tablas,
    { headers: prefers, cuerpo: [{ operation_id: "ns-999999", ot: "3099", secuencia: 1, ct: 10, start: "" }] },
  );
  assert.equal(nueva.status, 201);
  assert.equal(tablas.operations.length, antes + 1, "una fila con clave nueva si se agrega");
});

test("el on_conflict compuesto de materials no lo confunde con una columna", () => {
  // `CLAVE_NATURAL.materials` es `ot,line_id` (supabase-writer.js:310). Si el falso lo leyera
  // como una sola columna llamada "ot,line_id", ninguna fila coincidiria y cada guardado
  // duplicaria todos los materiales del fixture sin que nada lo dijera.
  const tablas = filasDesdeFixture(estadoConUnPlan());
  const antes = tablas.materials.length;
  const fila = tablas.materials[0];
  const url = new URL("http://x/rest/v1/materials?on_conflict=ot%2Cline_id");
  responderPostgREST(url, "POST", { prefer: "return=minimal" }, tablas, { cuerpo: [{ ...fila, cantidad: 99 }] });
  assert.equal(tablas.materials.length, antes, "con clave compuesta no debe duplicar");
  assert.equal(tablas.materials[0].cantidad, 99);
});

test("el PATCH mezcla el cuerpo solo en las filas que pide el filtro", () => {
  // `parchearAppState` (supabase-writer.js:1528) hace `PATCH app_state?id=eq.1`.
  const tablas = filasDesdeFixture(estadoConUnPlan());
  const respuesta = responderPostgREST(new URL("http://x/rest/v1/app_state?id=eq.1"), "PATCH", { prefer: "return=minimal" }, tablas, { cuerpo: { revision: 99 } });
  assert.equal(respuesta.status, 200);
  assert.equal(tablas.app_state[0].revision, 99);

  const sinFiltro = responderPostgREST(new URL("http://x/rest/v1/app_state?id=eq.999"), "PATCH", {}, tablas, { cuerpo: { revision: 1234 } });
  assert.equal(sinFiltro.status, 200);
  assert.equal(tablas.app_state[0].revision, 99, "un PATCH que no encuentra filas no toca ninguna");
});

test("el DELETE con neq. borra justo lo que el escritor manda borrar", () => {
  // `escribirEspejo` borra con `id=neq.<uuid nulo>` para vaciar las tablas propias antes de
  // escribir (supabase-writer.js:480). Si el falso no entendiera `neq.`, no borraria nada y el
  // informe no lo notaria; si lo entendiera al reves, borraria justo lo que hay que conservar.
  const tablas = filasDesdeFixture(estadoConUnPlan());
  const total = tablas.selected_ots.length;
  assert.ok(total > 0, "el fixture tiene que sembrar OTs en el plan");
  const url = new URL("http://x/rest/v1/selected_ots?id=neq.00000000-0000-0000-0000-000000000000");
  const respuesta = responderPostgREST(url, "DELETE", {}, tablas);
  assert.equal(respuesta.status, 204);
  assert.equal(tablas.selected_ots.length, 0, "todo lo que hay tiene id distinto del uuid nulo");
});

test("plan_guardar existe y se comporta como la del DDL, no como una caja negra", () => {
  // MEDIDO con las reglas del repo: `plan_guardar` esta en produccion (2026-09-30 dio 400 con
  // 42702, RULE-SUP-025; el 2026-10-03 ya devolvia su informe con CONFLICT_REVISION,
  // RULE-GOV-015) y es el mismo DDL el que crea `operation_events`. Contestarle 404 hacia que el
  // escritor cayera al camino viejo y, como `operation_events` no estaba en el almacen, el
  // guardado entero se perdia: el "No se pudo guardar el plan" de la corrida era la sonda.
  const estado = estadoConUnPlan();
  const tablas = filasDesdeFixture(estado);
  const url = new URL("http://x/rest/v1/rpc/plan_guardar");
  const antesOperations = tablas.operations.length;
  const antesMaterials = tablas.materials.length;
  const revision = tablas.app_state[0].revision;
  const payload = {
    // La fila va con los NOMBRES QUE USA EL ESCRITOR, no los que lee el lector: el escritor
    // manda `fecha_inicio`/`hora_inicio` (timestamptz) y no un `start`. Mandar el nombre del
    // lector haria que la fila no se actualizara -que es justo lo que hay que comprobar-, pero
    // por una razon equivocada.
    operations: [{ ...tablas.operations[0], fecha_inicio: "2026-10-06T06:00:00.000Z", hora_inicio: "2026-10-06T06:00:00.000Z", operador: "JORGE" }],
    work_orders: [],
    materials: [],
    selected_ots: [{ ot: estado.selectedOts[0], posicion: 1 }],
    locked_ots: [],
    operation_plan_statuses: [],
    operation_events: [{ id: "ev-1", ot: "3099", kind: "PRUEBA" }],
    plan_snapshots: [],
    app_state: { plan_start: "2026-10-05", saved_at: "2026-10-05T17:00:00.000Z" },
  };

  // (a) CONFLICTO DE REVISION: no se escribe NADA. Es la regla que evita que dos pestanas se
  // pisen; un falso que la dejara pasar mediria una app que si deja pisarse.
  const conConflicto = responderPostgREST(url, "POST", {}, tablas, { cuerpo: { p_payload: payload, p_revision_esperada: revision + 5, p_actor: "sonda" } });
  assert.equal(conConflicto.status, 200);
  const informeConflicto = JSON.parse(conConflicto.body);
  assert.equal(informeConflicto.ok, false);
  assert.equal(informeConflicto.conflicto, "CONFLICT_REVISION");
  assert.equal(informeConflicto.revision_actual, revision);
  assert.equal(tablas.operations.length, antesOperations, "un conflicto no puede escribir");
  assert.equal(tablas.app_state[0].revision, revision, "un conflicto no mueve la revision");

  // (b) LA GUARDADA BIEN.
  const ok = responderPostgREST(url, "POST", {}, tablas, { cuerpo: { p_payload: payload, p_revision_esperada: revision, p_actor: "sonda" } });
  assert.equal(ok.status, 200);
  const informe = JSON.parse(ok.body);
  assert.equal(informe.ok, true);
  assert.equal(informe.revision, revision + 1);
  assert.equal(tablas.app_state[0].revision, revision + 1);

  // LAS TRES DEL ERP: UPDATE, NUNCA INSERT. Una operacion que la pagina no conocia no aparece.
  assert.equal(tablas.operations.length, antesOperations, "plan_guardar no inserta en operations");
  assert.equal(informe.tablas.operations.modo, "actualiza");
  assert.equal(informe.tablas.operations.filas, 1);
  assert.equal(tablas.materials.length, antesMaterials, "plan_guardar no inserta en materials");

  // Y SOLO de las columnas que la pagina puede tocar. `fecha_req` viene en el payload y la pagina
  // NO la escribe (no esta en `plan_tabla_escritura`), asi que la fila tiene que quedar con el
  // valor anterior: es lo que impide que un guardado desde el navegador pise un dato del ERP.
  const fila = tablas.operations.find((f) => f.operation_id === payload.operations[0].operation_id);
  assert.equal(fila.operador, "JORGE");
  assert.equal(fila.fecha_inicio, "2026-10-06T06:00:00.000Z");
  assert.equal(fila.revision, revision + 1, "la revision la pone la funcion, no la pagina");

  // LAS MARCAS DE RETIRADA: las OTs que salen de selected_ots se marcan, y no se borra nada.
  const salientes = estado.selectedOts.filter((ot) => ot !== payload.selected_ots[0].ot);
  if (salientes.length && informe.tablas.retiradas) {
    const marcadas = tablas.operations.filter((f) => f.retirada_en);
    assert.ok(marcadas.length > 0, "una OT que salio del plan tiene que quedar marcada en operations");
    assert.ok(tablas.operations.some((f) => f.ot === salientes[0]), "la operacion sigue en la tabla: se marca, no se borra");
  }

  // ESPEJO: selected_ots queda con lo que mando la pagina, ni una fila mas.
  assert.deepEqual(tablas.selected_ots.map((f) => f.ot), [payload.selected_ots[0].ot]);
  assert.equal(informe.tablas.selected_ots.modo, "espejo");

  //(operation_events es un FLUJO: se inserta una vez y repetir el guardado no duplica.
  assert.equal(tablas.operation_events.length, 1);
  const repetida = responderPostgREST(url, "POST", {}, tablas, { cuerpo: { p_payload: payload, p_revision_esperada: revision + 1, p_actor: "sonda" } });
  assert.equal(JSON.parse(repetida.body).ok, true);
  assert.equal(tablas.operation_events.length, 1, "el evento repetido no se duplica");
});

test("una funcion que no existe se responde 404 con la forma de PostgREST", () => {
  // El escritor distingue 404 (degrada al camino viejo) de otros codigos (no degrada), asi que la
  // forma del 404 no es un detalle: un 200 con `{ok:true}` seria un falso que dice que hay una
  // funcion que no hay.
  const respuesta = responderPostgREST(new URL("http://x/rest/v1/rpc/otra_funcion"), "POST", {}, filasDesdeFixture(estadoConUnPlan()), { cuerpo: {} });
  assert.equal(respuesta.status, 404);
  const body = JSON.parse(respuesta.body);
  assert.equal(body.code, "PGRST202");
  assert.match(body.message, /otra_funcion/);
});

test("plan_guardar sin fila de app_state contesta el error de Postgres, no un informe", () => {
  // La funcion real levanta 23514 (DDL:695-698). Un falso que devolviera `{ok:false}` ensenaria a
  // leer un error de base como si fuera un resultado de guardado.
  const tablas = filasDesdeFixture(estadoConUnPlan());
  tablas.app_state = [];
  const respuesta = responderPostgREST(new URL("http://x/rest/v1/rpc/plan_guardar"), "POST", {}, tablas, { cuerpo: { p_payload: {} } });
  assert.equal(respuesta.status, 400);
  assert.equal(JSON.parse(respuesta.body).code, "23514");
});

test("escribir en una tabla que no existe da 404 y no se guarda nada en la nada", () => {
  const tablas = filasDesdeFixture(estadoConUnPlan());
  const respuesta = responderPostgREST(new URL("http://x/rest/v1/tabla_inventada"), "POST", {}, tablas, { cuerpo: [{ id: 1 }] });
  assert.equal(respuesta.status, 404);
  assert.equal(tablas.tabla_inventada, undefined, "no se inventa la tabla al escribir");
});

test("un metodo que la sonda no implementa se dice, no se contesta 200", () => {
  const respuesta = responderPostgREST(new URL("http://x/rest/v1/operations"), "PUT", {}, filasDesdeFixture(estadoConUnPlan()), {});
  assert.equal(respuesta.status, 405);
});

// ---------------------------------------------------------------------------
// 4. LOS DATOS SON LOS DEL FIXTURE, NO OTRO ORIGEN
// ---------------------------------------------------------------------------

test("las operaciones y las OTs que sirve son las del fixture, no un conjunto aparte", () => {
  // Si el PostgREST falso sirviera otra lista, la sonda mediria datos que la pagina nunca ve y
  // las comparaciones de la corrida no significarian nada.
  const estado = buildFixture({ otCount: 6, seed: 20260925 });
  const tablas = filasDesdeFixture(estado);
  assert.equal(tablas.operations.length, estado.operations.length);
  assert.equal(tablas.work_orders.length, estado.workOrders.length);
  assert.deepEqual(tablas.operations.map((f) => f.operation_id), estado.operations.map((op) => String(op.id)));
});

test("las tablas que el fixture no alimenta se sirven vacias, no con filas inventadas", () => {
  const tablas = filasDesdeFixture(estadoConUnPlan());
  for (const tabla of ["ot_types", "subcontracts", "calendar_exceptions", "inventory", "items", "sales_orders", "plan_snapshots", "unconfirmed_work_orders", "closed_work_order_summaries", "inspection_routes", "inspection_history"]) {
    assert.deepEqual(tablas[tabla], [], `${tabla} deberia estar vacia`);
  }
});

// ---------------------------------------------------------------------------
// 5. LO QUE LA SONDA TIENE QUE SEGUIR HACIENDO
// ---------------------------------------------------------------------------

test("la sonda apunta el lector y el escritor de Supabase al origen local", () => {
  // El arreglo se sostiene en que configure() corra en el momento en que el bundle asigna el
  // modulo, antes de que la app lea el estado. Si el trap desaparece, la sonda vuelve a arrancar
  // contra la URL de produccion embebida y su guarda la corta: el bug medido el 2026-10-05.
  assert.match(probeSource, /addInitScript\(installSupabaseTrap, origin\)/);
  assert.match(probeSource, /PPSupabaseReader/, "la sonda debe interceptar PPSupabaseReader");
  assert.match(probeSource, /PPSupabaseWriter/, "la sonda debe interceptar PPSupabaseWriter, o las escrituras quedan apuntando a produccion");
});

test("la precondicion de arranque ya no exige llamadas al puente", () => {
  // El puente es el camino muerto desde RULE-SUP-030. Preguntar por el arrancaria negativo con la
  // app perfectamente sana, que es como la sonda paso a dar verde con 0 tarjetas el 2026-10-03.
  assert.doesNotMatch(probeSource, /observed\.calls\.includes\("getAppState"\)/);
  assert.match(probeSource, /el arranque carga el estado desde Supabase/);
});