/**
 * EL INVARIANTE QUE PIDIO EL USUARIO, y los dos agujeros que lo rompian.
 *
 *   "que desde el ultimo sync ninguna OT cambia de estado hasta el nuevo sync, y que si de una
 *    OT no se tiene informacion esta permanece su estado"
 *
 * LO QUE YA FUNCIONABA, y no se toco. Entre sync y sync, nada escribe los dos campos que deciden
 * si una OT esta cerrada. Los escritores de workOrders[].status son applyNetSuiteWorkOrdersPayload
 * (sync) y applyImported (carga); el resto son mergeWorkOrderLocalOverrides, que copia, y
 * normalizeWorkOrders, que normaliza. Los escritores de operations[].estatus son el sync y
 * normalizeOperation, que unicamente convierte "" en "PLAN", y los dos significan "no cerrada".
 * O sea que el invariante se sostiene por construccion: no hay un tercero que escriba el estado.
 *
 * LOS DOS AGUJEROS QUE SI EXISTIAN, y ninguno era de NetSuite: eran de RECARGA.
 *
 *  1. state.unconfirmedWorkOrders NO SE PERSISTIA. Lo escribia el reconciliador durante un sync y
 *     lo leian normalizeState, la cola y la confirmacion folio por folio, pero ningun escritor lo
 *     guardaba en la hoja y applyImported no lo restauraba. La red de seguridad de RULE-OT-051
 *     duraba HASTA LA PRIMERA RECARGA.
 *  2. Al recargar, applyImported REEMPLAZA la lista de OTs con la del servidor
 *     (state.workOrders = normalizeWorkOrders(imported.workOrders)...). La OT sin marca, sin ficha
 *     y sin operaciones se caia de la cola en el siguiente normalizeState, sin que hubiera pasado
 *     nada en NetSuite.
 *
 * El recorrido se prueba con el bloque REAL de app.js, no con una reimplementacion.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { sinComentarios } from "./helpers/sin-comentarios.mjs";

const app = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");
const storage = await readFile(new URL("../src/server/02-storage.js", import.meta.url), "utf8");
const code = await readFile(new URL("../src/server/01-code.js", import.meta.url), "utf8");
const coreSrc = await readFile(new URL("../src/web/planning/planning-workflow-core.js", import.meta.url), "utf8");
// DECIDIDO 2026-09-30: el sync ya no guarda por `saveWorkOrderSyncState` (la fila
// UNCONFIRMED_WORK_ORDERS de la hoja) sino por el escritor de Supabase. Los tests de la seccion 1
// se migran al camino nuevo, y se leen el escritor y el lector porque el invariante quedo
// repartido entre los tres: app.js decide QUE se sube, el escritor decide COMO se escribe y el
// lector si vuelve.
const writerSrc = await readFile(new URL("../src/web/shared/supabase-writer.js", import.meta.url), "utf8");
const readerSrc = await readFile(new URL("../src/web/shared/supabase-reader.js", import.meta.url), "utf8");

/** Saca una funcion por nombre del archivo real, con sus llaves balanceadas. */
function extraer(src, nombre) {
  const i = src.search(new RegExp(`^(?:async )?function ${nombre}\\(`, "m"));
  assert.notEqual(i, -1, `no encontre ${nombre} en el archivo`);
  const abre = src.indexOf("{", i);
  let nivel = 0;
  let comillas = null;
  for (let k = abre; k < src.length; k += 1) {
    const c = src[k];
    if (comillas) {
      if (c === "\\") { k += 1; continue; }
      if (c === comillas) comillas = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { comillas = c; continue; }
    if (c === "{") nivel += 1;
    if (c === "}") {
      nivel -= 1;
      if (nivel === 0) return src.slice(i, k + 1);
    }
  }
  throw new Error(`llaves sin cerrar en ${nombre}`);
}

/**
 * Corre una funcion REAL extraida del archivo, pasndole sus dependencias por nombre y
 * llamndola con `args` (una cadena con la expresin de argumentos).
 * Ojo: el codigo es una DECLARACION de funcion, as que hay que llamarla explicitamente; si
 * solo se devuelve el valor de la expresion, lo que sale es la propia funcion y las
 * aserciones comparan contra `[]`, que es lo que Object.keys de una funcion da.
 */
function correr(nombre, codigo, deps, args = "") {
  const nombres = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  return new Function(...nombres, `${codigo}\nreturn ${nombre}(${args});`)(...nombres.map((n) => deps[n]));
}

const materialOtKey = (v) => String(v ?? "").trim().toUpperCase();

const MERGE_MARKS = extraer(app, "mergeUnconfirmedWorkOrderMarks");
const IS_VALID_DATE = new Function(`${extraer(app, "isValidDate")}; return isValidDate;`)();
const PARSE_MARKS = extraer(storage, "PP_parseUnconfirmedWorkOrderMarks_");
const SERIALIZE_MARKS = extraer(storage, "PP_serializeUnconfirmedWorkOrderMarks_");

const mergeMarks = (local, remote) =>
  correr("mergeUnconfirmedWorkOrderMarks", MERGE_MARKS, { materialOtKey, isValidDate: IS_VALID_DATE, local, remote }, "local, remote");
const parseMarks = (v) =>
  correr("PP_parseUnconfirmedWorkOrderMarks_", PARSE_MARKS, { source: v, JSON }, "source");

// ---------------------------------------------------------------------------------------------
// 1. EL AGUJERO 1: la marca no viaja. Ahora tiene que viajar en el estado que el sync sube.
// ---------------------------------------------------------------------------------------------
//
// QUE SE MIGRO Y POR QUE. Antes el sync armaba un payload a mano con
// `unconfirmedWorkOrders: nextState.unconfirmedWorkOrders || {}` y lo mandaba por
// `callAppsScript("saveWorkOrderSyncState", ...)`, que escribia la fila
// UNCONFIRMED_WORK_ORDERS de la hoja. Ese payload ya no existe: DECIDIDO 2026-09-30, el sync sube
// el ESTADO con el mismo escritor que el resto de la pagina, y el escritor mapea
// `state.unconfirmedWorkOrders` a la tabla `unconfirmed_work_orders`. Por eso las dos
// aserciones de esta seccion ya no pueden buscar el payload: tienen que seguir la cadena
// entera, que es lo que ahora puede romperse en cuatro puntos distintos.

test("sinComentarios: quita el // de una linea sin comerse el codigo de al lado", () => {
  // Guarda de la herramienta que usa la asercion de abajo (esta vive en
  // tests/helpers/sin-comentarios.mjs; su guarda se queda aqui porque el primer test que
  // la uso fue este). Si la herramienta se comiera codigo, la asercion pasaria por la
  // razon equivocada (no encontraria la llamada porque leyo menos archivo del que
  // debia), y el error seria invisible hasta que otra cosa se rompiera.
  const limpio = sinComentarios([
    'const a = callAppsScript("x"); // callAppsScript("y")',
    'const b = "https://ejemplo.supabase.co"; /* bloque */ const c = `t ${d} t`;',
  ].join("\n"));
  assert.match(limpio, /callAppsScript\("x"\)/, "el codigo de verdad se conserva");
  assert.doesNotMatch(limpio, /callAppsScript\("y"\)/, "el comentario de linea se quita");
  assert.match(limpio, /https:\/\/ejemplo\.supabase\.co/, "un // dentro de un string no es comentario");
  assert.doesNotMatch(limpio, /bloque/, "y el de bloque tambien");
  assert.match(limpio, /`t \$\{d\} t`/, "las plantillas sobreviven enteras");

  // Ahi se mide la diferencia. Un `${ { a: 1 } }` con llaves internas: si el recorrido no las
  // contara, la plantilla quedaria abierta y TODO lo de abajo pasaria por texto, con el `//`
  // incluido. O sea que este caso es el que separa la herramienta de una que no sirve.
  const conLlaves = sinComentarios('const d = `a ${ { x: 1 }.x } b`; // fuera\nconst e = 1;');
  assert.match(conLlaves, /const e = 1;/, "el codigo que sigue a la plantilla se sigue leyendo");
  assert.doesNotMatch(conLlaves, /fuera/, "y el comentario de despues se sigue quitando");

  // Y el caso que mas rompio la primera version: una REGULAR con una comilla adentro. Un
  // `/"` leido como comilla abre una cadena que no cierra nunca, y de ahi en adelante todo el
  // archivo se lee como texto (con los comentarios adentro). Este es el `.replace(/"/g, ...)`
  // de escapeHtml, que esta en app.js de verdad.
  const conRegular = sinComentarios('const h = String(x).replace(/"/g, "&quot;");\n// fuera2\nconst i = 2;');
  assert.match(conRegular, /const i = 2;/, "una regular con comilla no rompe el resto");
  assert.doesNotMatch(conRegular, /fuera2/, "y el comentario de despues se sigue quitando");
  // La division tampoco puede tomarse por regular, o se comeria el codigo de la derecha.
  const conDivision = sinComentarios("const k = total / 2; // fuera3\nconst l = 3;");
  assert.match(conDivision, /const k = total \/ 2;/, "la division sobrevive");
  assert.match(conDivision, /const l = 3;/, "y el codigo de al lado tambien");
  assert.doesNotMatch(conDivision, /fuera3/);
});

test("el sync sube el estado entero, y el escritor de ese estado trae las marcas", () => {
  // Punto 1: el sync no se arma un payload propio, sube `state`. Un payload a mano seria una
  // segunda verdad, que es exactamente el agujero que se cerro el 2026-09-26: la marca vivia en
  // el payload y no en el estado, asi que cualquier otro guardado se la llevaba.
  // El nombre sobrevive en COMENTARIOS (app.js explica que se quito), asi que la asercion mira
  // el CODIGO, con los comentarios fuera: si no, daria un falso positivo y no probaria nada.
  assert.doesNotMatch(sinComentarios(app), /callAppsScript\(\s*["']saveWorkOrderSyncState/,
    "el sync ya no llama a un metodo del puente para guardar: se sube por Supabase");
  assert.match(app, /const persistido = await guardarSyncDeOrdenesTrabajoEnSupabase\(\);/,
    "el sync sube con el helper, que es el unico que avisa cuando la subida falla");
  // Punto 2: el helper delega en el MISMO `guardarPlanEnSupabase` del guardado normal. Dos
  // caminos de escritura son dos verdades que se separan en cuanto una de las dos falla.
  assert.match(app, /async function guardarSyncDeOrdenesTrabajoEnSupabase\(\) \{[\s\S]{0,300}await guardarPlanEnSupabase\(\)/,
    "el guardado del sync no puede tener su propio camino de escritura");
  // Punto 3: y el escritor lee las marcas del estado, not de un campo propio.
  assert.match(writerSrc, /function filasUnconfirmedWorkOrders\(state\) \{[\s\S]{0,400}state\.unconfirmedWorkOrders/,
    "el escritor tiene que mapear las marcas del estado");
});

test("el ciclo se cierra: el lector trae las marcas de la tabla y applyImported las restaura", () => {
  // Si el escritor sube pero el lector no trae, las marcas se acumulan en la base y no vuelven
  // nunca a la pantalla. El sintoma es invisible (no hay error) y el contador `misses`, que es
  // JUSTO lo que decide cuando una marca es real, se reinicia en cada recarga.
  assert.match(readerSrc, /unconfirmed_work_orders/,
    "el lector tiene que leer la tabla de marcas");
  assert.match(readerSrc, /function mapUnconfirmedWorkOrders\(rows\)/,
    "con un mapeo propio, por folio y no por el id de la fila");
  assert.match(readerSrc, /unconfirmedWorkOrders: siSePudoLeer\(rows, "unconfirmed_work_orders", mapUnconfirmedWorkOrders\(/,
    "y readCatalogs lo expone con la regla de las demas: undefined si la tabla cayo, {} si esta vacia");
  assert.match(app, /state\.unconfirmedWorkOrders = mergeUnconfirmedWorkOrderMarks\(/,
    "y applyImported las restaura al cargar");
});

test("las marcas se toman de nextState, que ya paso por el reconciliador", () => {
  // ESTE ORDEN ES EL INVARIANTE, y no es cosmetico. `reconcileActiveWorkOrders` es quien
  // RESUELVE las marcas: sube `misses` para la OT que sigue sin venir y borra la que NetSuite
  // ya no manda. Si el estado se subiera ANTES del reconcile se guardaria el contador viejo, y
  // la marca decidiria con evidencia de una lectura anterior.
  const iReconcile = app.indexOf("const nextState = window.PlanningWorkflowCore.purgeClosedWorkOrderRetention(");
  const iAplica = app.indexOf("state = nextState;", iReconcile);
  const iSube = app.indexOf("const persistido = await guardarSyncDeOrdenesTrabajoEnSupabase();", iReconcile);
  assert.ok(iReconcile >= 0, "el sync arma un nextState reconciliado");
  assert.ok(iAplica > iReconcile, "el estado se aplica DESPUES del reconcile");
  assert.ok(iSube > iAplica, "y se sube DESPUES de aplicarlo: lo que sube es el reconciliado");
  // Y lo que sube es `state`, no una copia: si se pasara otro objeto, la marca que acaba de
  // resolver el reconciliador se quedaria solo en memoria.
  assert.doesNotMatch(app.slice(iSube, iSube + 200), /nextState\./,
    "el helper no recibe nextState: sube el estado global, que ya ES el reconciliado");
});

test("el servidor guarda la fila UNCONFIRMED_WORK_ORDERS y la devuelve al cargar", () => {
  // DECIDIDO 2026-09-30: la web YA NO ESCRIBE AQUI. El sync sube a `unconfirmed_work_orders`
  // por el escritor de Supabase, y la lectura tambien viene de ahi. Este test sigue probando el
  // lado del servidor porque el codigo sigue vivo y expuesto: `saveWorkOrderSyncState` sigue
  // declarado en 01-code.js:277 y permitido en Bridge.html:27, o sea que un cliente viejo (o una
  // llamada directa) lo puede seguir usando, y si el servidor se rompiera ese cliente perderia
  // las marcas en silencio. No debe leerse como "la pagina guarda en la hoja".
  assert.match(storage, /\['UNCONFIRMED_WORK_ORDERS',\s*PP_serializeUnconfirmedWorkOrderMarks_\(/,
    "la escritura en CONFIG tiene que existir");
  // Y el PUNTO DE LLAMADA, no solo que la funcion este bien. Probar la funcion sin probar quien
  // la llama es un agujero clasico: con la mutacion que cambia la llamada por un {} fijo, la
  // funcion seguia siendo correcta y ningun test se ponia rojo, pero un cliente viejo borraba
  // las marcas en cada guardado. Esta asercion es la que cierra ese agujero.
  assert.match(storage,
    /UNCONFIRMED_WORK_ORDERS:\s*PP_serializeUnconfirmedWorkOrderMarks_\(payload\.unconfirmedWorkOrders, spreadsheet\)/,
    "el guardado tiene que pasarle el payload al serializador, no sustituirlo por un valor fijo");
  assert.match(storage, /unconfirmedWorkOrders:\s*PP_parseUnconfirmedWorkOrderMarks_\(config\.UNCONFIRMED_WORK_ORDERS\)/,
    "la lectura de CONFIG tiene que devolver las marcas");
  assert.match(code, /UNCONFIRMED_WORK_ORDERS:\s*\{\}/,
    "una hoja recien creada tiene que tener la misma forma que una con datos");
});

// ---------------------------------------------------------------------------------------------
// 2. EL AGUJERO 2: applyImported reemplaza la lista. Ahora restaura la marca antes.
// ---------------------------------------------------------------------------------------------

test("applyImported restaura las marcas que vienen de la hoja", () => {
  assert.match(app,
    /if \(imported\.unconfirmedWorkOrders && typeof imported\.unconfirmedWorkOrders === "object"\)[\s\S]{0,3000}mergeUnconfirmedWorkOrderMarks\(/,
    "applyImported tiene que fusionar las marcas importadas, no ignorarlas");
  assert.match(app, /workOrders: \[\],\s*\r?\n\s*closedWorkOrderSummaries: \{\},[\s\S]{0,900}unconfirmedWorkOrders: \{\}/,
    "el estado por defecto tiene que declarar el campo");
});

test("EL ORDEN: las marcas se restauran ANTES de reemplazar la lista de OTs", () => {
  // Si se reemplazan las OTs primero, el reemplazo no sabe cuales estan marcadas y no puede
  // conservarles la ficha. El orden no es cosmetico: es lo que hace que la prueba de abajo
  // tenga sentido. Se afirma por POSICION, no por presencia, porque las dos ramas existen en
  // cualquier orden y un assert de presencia pasaria con el orden equivocado.
  const iMarcas = app.indexOf("state.unconfirmedWorkOrders = mergeUnconfirmedWorkOrderMarks(");
  const iOts = app.indexOf("if (Array.isArray(imported.workOrders)) {");
  assert.ok(iMarcas >= 0 && iOts >= 0, "las dos ramas existen");
  assert.ok(iMarcas < iOts,
    "las marcas tienen que restaurarse ANTES: el reemplazo de la lista las necesita para saber a quien conservar la ficha");
});

test("una OT marcada conserva su FICHA al recargar, no solo su lugar en la cola", () => {
  // El escenario medido el 2026-09-26: con la marca pero sin este arreglo, la OT sobrevivia a
  // la recarga en la cola y perdia la ficha. Sin ficha, jobStatusForOt devuelve "PLAN", o sea
  // ABIERTA por defecto: la app presenta como abierta una OT de la que no sabe nada. Y
  // reconcileActiveWorkOrders no la puede recuperar, porque arma currentByOt desde la lista que
  // ya no la tiene. O sea que la ficha es lo unico que hay que preservar.
  assert.match(app,
    /const fichasDeMarcadas = \[\];[\s\S]{0,700}state\.unconfirmedWorkOrders\[key\][\s\S]{0,700}fichasDeMarcadas\.push\(\{ \.\.\.item \}\);[\s\S]{0,200}state\.workOrders = importadas\.concat\(fichasDeMarcadas\);/,
    "la ficha de una OT marcada y ausente de la lista importada tiene que conservarse");
  // Y tiene que ser SOLO para las marcadas: una OT no marcada que no viene en la lista se
  // comporta como antes, que es lo que hace que esto no sea una puerta trasera para resucitar OTs.
  assert.match(app, /if \(!state\.unconfirmedWorkOrders \|\| !state\.unconfirmedWorkOrders\[key\]\) continue;/,
    "sin marca, la ficha no se conserva: la marca es la unica que abre esa puerta");
});

test("la ficha conservada no duplica la OT que si vino en la lista", () => {
  // Si una OT marcada viene TAMBIEN en la lista importada, su ficha es la que trae la lista
  // (mas reciente) y solo se le fusionan los overrides locales. Agregarla otra vez seria un
  // duplicado, y normalizeWorkOrders deduplica por folio as que el resultado seria el mismo
  // pero con trabajo de mas; peor, si la lista trajera OTs duplicadas por folio, el conteo de
  // fichas de la hoja dejaria de coincidir con el numero de filas.
  assert.match(app, /const porOt = new Set\(importadas\.map\(\(item\) => materialOtKey\(item\?\.ot\)\)\);[\s\S]{0,300}if \(!key \|\| porOt\.has\(key\)\) continue;/,
    "una OT que ya vino en la lista no se agrega de nuevo");
});

test("el bloque REAL de normalizeState: con la marca la OT sobrevive, sin la marca se cae", () => {
  // El bloque de app.js tal cual, desde operationOts hasta despues de asignar selectedOts. Si
  // se cortara antes de la asignacion, el test no probaria nada.
  const ini = app.indexOf("const operationOts = state.operations.filter");
  const fin = app.indexOf("if (state.lastSchedule", ini);
  const codigo = app.slice(ini, fin);
  assert.ok(codigo.includes("operationOts"), "el bloque empieza en operationOts");
  assert.ok(codigo.includes("state.selectedOts = uniq(configuredSelectedOts)"),
    "y contiene la asignacion: si no, el test devolveria el selectedOts de entrada");

  const isClosedJobStatus = (status) => {
    const n = String(status || "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return ["CERRAD", "CLOSED", "COMPLETE", "COMPLETADO"].some((b) => n.includes(b));
  };
  const isMovablePlanningStatus = (status) => {
    const n = String(status || "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return !["CERRAD", "CLOSED", "COMPLET", "CANCELAD", "CANCELED", "CANCELLED"].some((b) => n.includes(b));
  };
  const uniq = (arr) => [...new Set(arr)];

  const f = new Function("selectedOts", "workOrders", "operations", "unconfirmedWorkOrders",
    "materialOtKey", "isClosedJobStatus", "isMovablePlanningStatus", "jobStatusForOt", "uniq",
    `const state = { selectedOts, workOrders, operations, unconfirmedWorkOrders };
     ${codigo}
     return state.selectedOts;`);
  const deps = [materialOtKey, isClosedJobStatus, isMovablePlanningStatus, () => "EN PROCESO", uniq];

  // 3001 esta en la cola pero NO vino en el payload: no tiene ficha ni operaciones.
  const ops = [{ ot: "3000", tipoInsercion: "PROCESO" }];
  const sinMarca = f(["3000", "3001"], [{ ot: "3000" }], ops, {}, ...deps);
  assert.deepEqual(sinMarca, ["3000"],
    "sin la marca, una OT sin datos se cae de la cola (el comportamiento previo al fix)");

  const conMarca = f(["3000", "3001"], [{ ot: "3000" }], ops, { "3001": { misses: 1 } }, ...deps);
  assert.deepEqual(conMarca, ["3000", "3001"], "con la marca, se conserva");

  // El caso de la recarga: la marca se leyo de la hoja con su forma completa.
  const desdeHoja = JSON.parse(JSON.stringify({ "3001": { ot: "3001", firstSeenAt: "2026-09-26T20:00:00.000Z", lastSeenAt: "2026-09-26T20:00:00.000Z", misses: 3 } }));
  const trasRecarga = f(["3000", "3001"], [{ ot: "3000" }], ops, desdeHoja, ...deps);
  assert.deepEqual(trasRecarga, ["3000", "3001"],
    "una marca que sobrevive en la hoja sigue sosteniendo a la OT en la recarga");
});

// ---------------------------------------------------------------------------------------------
// 3. LA SEMANTICA DE LA MARCA: gane la mas probada, y el reloj no se reinicie.
// ---------------------------------------------------------------------------------------------

test("si la OT esta marcada en los dos lados, gana la que mas misses tiene", () => {
  const m = mergeMarks(
    { "3000": { ot: "3000", firstSeenAt: "2026-09-26T20:00:00.000Z", lastSeenAt: "2026-09-26T20:00:00.000Z", misses: 1 } },
    { "3000": { ot: "3000", firstSeenAt: "2026-09-26T22:00:00.000Z", lastSeenAt: "2026-09-26T22:00:00.000Z", misses: 4 } },
  );
  assert.equal(m["3000"].misses, 4, "la marca mas probada es la que hay que conservar");
  assert.equal(m["3000"].firstSeenAt, "2026-09-26T20:00:00.000Z",
    "pero firstSeenAt no se reinicia por venir de la hoja: el reloj de la OT es continuo");
  assert.equal(m["3000"].lastSeenAt, "2026-09-26T22:00:00.000Z", "lastSeenAt toma el mas reciente");
});

test("a igualdad de misses gana la marca mas vieja, que es la que lleva mas tiempo sin verse", () => {
  const m = mergeMarks(
    { "3000": { ot: "3000", firstSeenAt: "2026-09-26T20:00:00.000Z", lastSeenAt: "2026-09-26T20:00:00.000Z", misses: 3 } },
    { "3000": { ot: "3000", firstSeenAt: "2026-09-25T10:00:00.000Z", lastSeenAt: "2026-09-25T10:00:00.000Z", misses: 3 } },
  );
  assert.equal(m["3000"].firstSeenAt, "2026-09-25T10:00:00.000Z");
});

test("el merge es una UNION: una OT marcada en un solo lado no se pierde", () => {
  const m = mergeMarks(
    { "3000": { ot: "3000", firstSeenAt: "2026-09-26T20:00:00.000Z", lastSeenAt: "2026-09-26T20:00:00.000Z", misses: 1 } },
    { "3001": { ot: "3001", firstSeenAt: "2026-09-26T21:00:00.000Z", lastSeenAt: "2026-09-26T21:00:00.000Z", misses: 1 } },
  );
  assert.deepEqual(Object.keys(m).sort(), ["3000", "3001"]);
});

test("el merge NUNCA borra una marca por si mismo: no decide cierres", () => {
  const m = mergeMarks(
    { "3000": { ot: "3000", firstSeenAt: "2026-09-26T20:00:00.000Z", lastSeenAt: "2026-09-26T20:00:00.000Z", misses: 1 } },
    {},
  );
  assert.equal(m["3000"].misses, 1,
    "resolver la marca es trabajo del proximo sync, con evidencia de NetSuite, no con una carga");
});

test("la clave de la marca se normaliza a folio en mayusculas, como el resto de la app", () => {
  const m = mergeMarks({}, { " m-66-8602 ": { ot: "m-66-8602", firstSeenAt: "", lastSeenAt: "", misses: 2 } });
  assert.deepEqual(Object.keys(m), ["M-66-8602"]);
});

// ---------------------------------------------------------------------------------------------
// 4. LA LECTURA DE LA HOJA NO SE ROMPE CON UN VALOR RARO
// ---------------------------------------------------------------------------------------------

test("una fila de CONFIG corrupta devuelve {} y NO rompe la carga", () => {
  assert.deepEqual(parseMarks("{no es json"), {}, "texto ilegible -> objeto vacio, no excepcion");
  assert.deepEqual(parseMarks(""), {});
  assert.deepEqual(parseMarks(null), {});
  assert.deepEqual(parseMarks([1, 2]), {}, "un arreglo no es un mapa de marcas");
  assert.deepEqual(parseMarks({ "3000": null }), {}, "una marca nula se descarta");
  assert.deepEqual(parseMarks({ "": { ot: "" } }), {}, "una marca sin folio no es una OT");
});

test("la lectura normaliza la forma: misses 0 se vuelve 1 y el folio se rellena con la clave", () => {
  assert.deepEqual(parseMarks('{"3000":{"misses":0}}'),
    { 3000: { ot: "3000", firstSeenAt: "", lastSeenAt: "", misses: 1 } });
});

// ---------------------------------------------------------------------------------------------
// 5. UN CLIENTE VIEJO NO BORRA LO QUE YA ESTA
// ---------------------------------------------------------------------------------------------

function serializarConHoja(value, hoja) {
  return correr("PP_serializeUnconfirmedWorkOrderMarks_", SERIALIZE_MARKS, {
    value,
    spreadsheet: { getSheetByName: (n) => ({ n }) },
    PP_readConfig_: () => hoja,
    PP_parseUnconfirmedWorkOrderMarks_: parseMarks,
    JSON,
  }, "value, spreadsheet");
}

test("un cliente VIEJO que no manda el campo NO borra las marcas de la hoja", () => {
  // Este es el error de fondo de RULE-OT-051 en su forma mas breve: tratar la AUSENCIA de un
  // campo como "ya no hay nada que confirmar". Si un cliente viejo guarda, lo que hay en CONFIG
  // tiene que quedar igual.
  const marcas = { "3000": { ot: "3000", firstSeenAt: "2026-09-26T20:00:00.000Z", lastSeenAt: "2026-09-26T20:00:00.000Z", misses: 3 } };
  const salida = serializarConHoja(undefined, { UNCONFIRMED_WORK_ORDERS: marcas });
  assert.deepEqual(JSON.parse(salida), marcas, "un payload sin el campo conserva lo que habia");
});

test("un {} explicito SI es una orden de borrar: lo decide el siguiente sync, con evidencia", () => {
  const salida = serializarConHoja({}, { UNCONFIRMED_WORK_ORDERS: { "3000": { ot: "3000", misses: 3 } } });
  assert.deepEqual(JSON.parse(salida), {}, "un {} explicito si limpia: no se confunde con una ausencia");
});

test("una hoja sin la fila se comporta como una hoja sin marcas, sin reventar", () => {
  assert.deepEqual(JSON.parse(serializarConHoja(undefined, {})), {});
  assert.deepEqual(JSON.parse(serializarConHoja(undefined, { UNCONFIRMED_WORK_ORDERS: "{roto" })), {});
});

// ---------------------------------------------------------------------------------------------
// 6. LA MARCA SIGUE SIENDO DEL NUCLEO, NO DE UN ESCRITOR NUEVO
// ---------------------------------------------------------------------------------------------

test("app.js solo restaura marcas: no fabrica ninguna, no borra ninguna", () => {
  const asignaciones = app.match(/state\.unconfirmedWorkOrders\s*=\s*([^\n;]+)/g) || [];
  assert.equal(asignaciones.length, 1,
    `se esperaba UNA sola asignacion en app.js y hay ${asignaciones.length}: ${asignaciones.join(" | ")}`);
  assert.match(asignaciones[0], /mergeUnconfirmedWorkOrderMarks\(/,
    "y tiene que ser la fusion con la hoja, no una fabricacion a mano");
  assert.match(coreSrc, /unconfirmedWorkOrders: unconfirmed,/,
    "el nucleo sigue siendo el que decide que OT se marca");
});
