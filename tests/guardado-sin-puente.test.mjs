// Un cambio hecho con la pagina todavia cargandose no puede perderse.
//
// MEDIDO 2026-09-29. El usuario anadio una maquina en la pestana de catalogos y
// aviso de que "GitHub se tardo en cargar la informacion". El guardado NO llego
// nunca a Apps Script: getAppRevision seguia en 4142 con savedAt 15:30, igual que
// antes, y los 11 catalogos de Supabase seguian con la fecha del 2026-09-28.
// Tres defectos en la misma cadena:
//
//  1. queueAppSheetSave se devolvia con `if (!appSheetAvailable) return;` ANTES de
//     llamar a appSheetMarkDirtyScope. Con el puente sin conectar, el ambito
//     nunca se marcaba: el cambio no se guardaba, no se avisaba y no quedaba en
//     cola. Perdido entero.
//
//  2. Al terminar un guardado, el `finally` reencolaba con queueAppSheetSave() sin
//     ambito. Su valor por omision es "plan", que se mete en appSheetDirtyScopes.
//     Si lo pendiente era "catalogs", el conjunto quedaba {catalogs, plan} y el
//     metodo se elegia con appSheetSaveMethodForScopes, que caia en saveAppState en
//     vez de saveCatalogState. Y saveAppState -> PP_writeState_ no escribe las hojas de
//     catalogo ni dispara el espejo: el cambio se guardaba a medias sin decir nada.
//
//     ESTE DEFECTO SE REESCRIBIO EL 2026-09-30 en vez de quedar historico. La funcion
//     que elegia el metodo del puente se borro (no hay metodo del puente que elegir), y
//     los tests de mas abajo fijan el invariante que la reemplaza: el ambito decide SI se
//     suben catalogos y con que escritor, no a donde se escribe el plan.
//
//  3. No habia nada que volcara lo pendiente cuando el puente quedaba disponible.
//
// Estos tests SACAN las funciones del cuerpo de app.js y las corren en un vm con
// dobles, como hace tests/article-price-separation.test.mjs. Reimplementarlas
// probaria el test, no el codigo.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { sinComentarios } from "./helpers/sin-comentarios.mjs";

const app = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");

/** Saca un bloque de app.js desde `desde` hasta la siguiente function de primer nivel. */
function bloque(desde, hasta) {
  const i = app.indexOf(desde);
  assert.ok(i > 0, `no se encontro ${desde}`);
  const f = app.indexOf(hasta, i);
  assert.ok(f > i, `no se encontro el final de ${desde}`);
  return app.slice(i, f);
}

const FUENTES = [
  bloque("function appSheetDisponible(", "let appSheetSaveTimer"),
  bloque("function queueAppSheetSave(", "/**"),
  bloque("function appSheetMarkDirtyScope(", "function appSheetConsumeDirtyScopes"),
  bloque("function appSheetFlushPendingScopes(", "function appSheetConsumeDirtyScopes"),
  bloque("function appSheetConsumeDirtyScopes(", "function purgeClosedWorkOrderRetention"),
  bloque("function appSheetTryAcquireSaveGate(", "async function appSheetAcquireSaveGate("),
  bloque("function appSheetReleaseSaveGate(", "async function appSheetWaitForIdle("),
  bloque("function ambitosDeCatalogo(", "async function saveAppSheet("),
  // El cuerpo real de saveAppSheet, para probar el fallo de catalogos (regresion del
  // 2026-10-03: un catalogo que fallaba soltaba el "Plan guardado" y perdia el ambito).
  bloque("async function saveAppSheet(", "function appSheetMarkDirtyScope("),
].join("\n");

/** Monta el contexto con el estado que describe el escenario. */
function escenario({ disponible = false, enVuelo = false, sucias = [], planOk = true, catalogosOk = true } = {}) {
  const guardados = [];
  const toasts = [];
  const temporizadores = [];
  const ctx = {
    appSheetAvailable: disponible,
    appSheetSaveInFlight: enVuelo,
    appSheetSavePending: false,
    appSheetSaveTimer: null,
    operationStatusSavesInFlight: false,
    appSheetDirtyScopes: new Set(sucias),
    // El escenario de este archivo es SIEMPRE "el puente de Apps Script", que es lo
    // que se deja sin conectar. Por eso se monta como tal la puerta real de app.js
    // (appSheetDisponible, que se extrae aqui arriba): sin el, la pagina guardaria
    // igual porque Supabase este configurado, y estos scenarios dejarian de describir
    // lo que describen.
    isAppsScriptRuntime: () => true,
    // MEDIDO 2026-09-29 en el navegador: `isAppsScriptRuntime` miente en el sitio estatico
    // (los dos instaladores lo dejan en "el puente esta configurado"), y por eso el guardado
    // del plan se iba por callAppsScript. `enRuntimeAppsScript` es el predicado que responde
    // la pregunta de verdad: google.script.run solo existe dentro de HtmlService. El escenario
    // de este archivo es "el puente de Apps Script", asi que aqui es true.
    // MEDIDO 2026-09-29: el nombre lleva S mayuscula, como `isAppsScriptRuntime`. Con la
    // minuscula el arnes montaba una global que app.js no pide y los tests fallaban con
    // `ReferenceError: enRuntimeAppsScript is not defined`; el fallo NO era del codigo.
    enRuntimeAppsScript: () => true,
    window: {
      clearTimeout: (t) => temporizadores.push(["clear", t]),
      setTimeout: (fn, ms) => {
        temporizadores.push(["set", ms, fn]);
        return temporizadores.length;
      },
    },
    queueAppSheetSave: undefined, // la fuente lo define
    // saveAppSheet ya NO va como double: FUENTES trae el cuerpo real de app.js
    // (bloque de arriba) y la declaracion del vm reemplaza al doble anterior.
    // `guardados` se queda vacio a proposito: nada de lo que se programa aqui
    // debe ejecutarse, y si un test quiere el resultado del guardado, llama a
    // ctx.saveAppSheet directamente.
    // Lo que saveAppSheet toca DENTRO del vm (fuente real, extraida arriba). La puerta
    // de guardado (appSheetTryAcquireSaveGate) crea y resuelve sus promesas de espera
    // ahi, asi que las dos variables de la puerta se dejan nulas para que el vm las
    // use y las libere; cada llamada a saveAppSheet las deja limpias al terminar.
    appSheetSaveOwner: null,
    appSheetSaveCompletion: null,
    resolveAppSheetSaveCompletion: null,
    state: { selectedOts: [], operations: [] },
    guardarPlanEnSupabase: async () => planOk,
    guardarCatalogosEnSupabase: async () => catalogosOk,
    showToast: (mensaje) => toasts.push(String(mensaje)),
    Set, String, Object, Array, JSON, Math, Date, Number, Boolean,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(FUENTES, ctx);
  return { ctx, guardados, toasts, temporizadores };
}

test("un cambio con el puente sin conectar NO se pierde: queda marcado", () => {
  const { ctx } = escenario({ disponible: false });
  ctx.queueAppSheetSave("catalogs");
  assert.ok(
    ctx.appSheetDirtyScopes.has("catalogs"),
    "el ambito tiene que quedar marcado aunque el puente no este listo: es lo unico que sobrevive"
  );
});

test("un cambio con el puente sin conectar NO programa guardado todavia", () => {
  const { ctx, guardados } = escenario({ disponible: false });
  ctx.queueAppSheetSave("catalogs");
  assert.deepEqual([...guardados], [], "no se puede guardar sin puente, y no se debe intentar");
});

test("al quedar disponible el puente, lo pendiente se guarda con SU ambito", () => {
  const { ctx, guardados } = escenario({ disponible: false });
  ctx.queueAppSheetSave("catalogs"); // se pierde si no queda marcado
  ctx.appSheetAvailable = true;
  const programo = ctx.appSheetFlushPendingScopes();
  assert.equal(programo, true, "deberia programar el guardado de lo pendiente");
  const temporizadores = ctx.window.setTimeout.mock;
  assert.ok(ctx.appSheetSaveTimer !== null, "dejo un temporizador pendiente");
  // Y lo que se guarda es lo pendiente, con el metodo que corresponde a "catalogs".
  // El array lo crea la funcion DENTRO del vm, o sea en otro realm: con
  // assert/strict, deepEqual compara prototipos y dos Arrays de realms distintos no
  // son iguales aunque tengan lo mismo. Se copia al realm del test con spread.
  const ambitos = [...ctx.appSheetConsumeDirtyScopes()];
  assert.deepEqual(ambitos, ["catalogs"]);
  assert.deepEqual([...ctx.ambitosDeCatalogo(ambitos)], ["catalogs"], "y el ambito llega como ambito, sin que nadie lo convierta en metodo");
  assert.deepEqual([...guardados], [], "el setTimeout aun no se ha ejecutado");
});

test("el ambito NO elige metodo del puente: elige si se suben catalogos", () => {
  // Este es el defecto 2, ya reescrito. Antes el ambito se traducía a un METODO DEL
  // PUENTE (saveAppState / saveCatalogState / saveSkillState) y "catalogs" con "plan"
  // mezclados caian en saveAppState, que no sube catalogos. Hoy no hay metodo que elegir:
  // el plan se sube siempre por el mismo escritor, y el ambito solo decide si encima
  // se escriben catalogos. Por eso "catalogs" + "plan" YA NO es un caso peligroso.
  const { ctx } = escenario({ disponible: true });
  ctx.appSheetDirtyScopes.add("catalogs");
  ctx.appSheetDirtyScopes.add("plan");
  assert.deepEqual([...ctx.ambitosDeCatalogo(["catalogs", "plan"])], ["catalogs"],
    "con plan mezclado los catalogos SI se suben: antes este era el fallo");
  const soloPlan = escenario({ disponible: true });
  soloPlan.ctx.appSheetDirtyScopes.add("plan");
  assert.deepEqual([...soloPlan.ctx.ambitosDeCatalogo(["plan"])], [],
    "un guardado que no toco catalogos no sube cientos de filas de catalogo");
  // Y la funcion que traducía ambitos a metodos del puente no existe. Se fija con
  // doesNotMatch y no borrando el test: si alguien la vuelve a pegar con su tabla de
  // metodos, este es el que avisa.
  assert.doesNotMatch(app, /function appSheetSaveMethodForScopes/,
    "no hay eleccion de metodo del puente: el destino es uno solo");
  // Y el guardado del plan no nombra ningun metodo del puente. El recorte va por el
  // CUERPO de saveAppSheet y con los comentarios FUERA, porque los nombres borrados
  // sobreviven en comentarios que los explican: buscarlos en el archivo crudo daria un
  // falso positivo y la asercion no probaria nada.
  const cuerpo = sinComentarios(bloque("async function saveAppSheet(", "function appSheetMarkDirtyScope"));
  assert.doesNotMatch(cuerpo, /callAppsScript|PPAppsScriptBridge|saveCatalogState|saveSkillState|saveAppState|savePlanningStateOptimized/,
    "el unico destino de saveAppSheet es Supabase: guardarPlanEnSupabase y guardarCatalogosEnSupabase");
});

test("el finally NO mete 'plan' de por omision al reencolar", () => {
  // Estructural a proposito: el comportamiento esta en el finally de saveAppSheet,
  // que hace await de red y no cabe en este arnes. Lo que se fija es que la
  // llamada SIN ambito, que es la que mete "plan" en appSheetDirtyScopes, solo
  // aparezca en la rama de "no hay nada marcado".
  //
  // El recorte va desde la firma de saveAppSheet hasta la siguiente function de
  // primer nivel. Buscar el if suelto por todo el archivo no sirve: hay mas de una
  // ocurrencia de "if (appSheetSavePending) {" y el test se comia el bloque
  // equivocado, con lo que pasaba por una razon distinta a la que creia.
  const i = app.indexOf("async function saveAppSheet");
  assert.ok(i > 0, "no se encontro saveAppSheet");
  const f = app.indexOf("\nfunction appSheetMarkDirtyScope", i);
  assert.ok(f > i, "no se encontro el final de saveAppSheet");
  const cuerpo = app.slice(i, f);

  const sinAmbito = cuerpo.match(/queueAppSheetSave\(\);/g) || [];
  assert.equal(sinAmbito.length, 1, "una sola llamada sin ambito, y tiene que estar en la rama de 'no hay nada marcado'");
  assert.match(
    cuerpo,
    /if \(appSheetDirtyScopes\.size\) \{[\s\S]*?saveAppSheet\(false\);[\s\S]*?\} else \{\s*queueAppSheetSave\(\);/,
    "con ambitos marcados hay que reprogramar el temporizador, no reencolar con 'plan': reencolar con 'plan' meta \"plan\" en el conjunto, y antes eso hacia que el metodo cayera en saveAppState, que no escribe las hojas de catalogo ni dispara el espejo"
  );
});

test("volcar sin nada pendiente no programa un guardado de la nada", () => {
  // Sin este if, cada carga de pagina escribiria el plan entero para solo subir la
  // revision, sin que nadie haya tocado nada.
  const { ctx } = escenario({ disponible: true, sucias: [] });
  assert.equal(ctx.appSheetFlushPendingScopes(), false);
  assert.equal(ctx.appSheetSaveTimer, null, "no debe quedar temporizador");
});

test("volcar con un guardado en curso no pisa el que ya esta corriendo", () => {
  const { ctx } = escenario({ disponible: true, enVuelo: true, sucias: ["catalogs"] });
  assert.equal(ctx.appSheetFlushPendingScopes(), false);
  assert.deepEqual([...ctx.appSheetDirtyScopes], ["catalogs"], "las marcas se conservan: las consume el guardado en curso");
});

test("los ambitos 'local' y 'ui' no se guardan en el servidor", () => {
  const { ctx } = escenario({ disponible: true });
  ctx.queueAppSheetSave("local");
  ctx.queueAppSheetSave("ui");
  assert.equal(ctx.appSheetDirtyScopes.size, 0, "estos ambitos son solo de la interfaz");
});

// ---------------------------------------------------------------------------
// EL MOTIVO DEL FALLO DE GUARDADO
// ---------------------------------------------------------------------------
//
// MEDIDO 2026-09-30 en el navegador: el toast decia "No se pudo guardar el plan: fallo
// desconocido" mientras el escritor sabia la tabla y el error. Motivo medido: `cerrar()`
// (supabase-writer.js) deja `ok:false` cuando alguna tabla de `informe.tablas` tiene `error`, y
// `informe.motivo` solo se llena en `sinEscribir()`, o sea cuando NO se hizo ninguna peticion.
// El camino viejo es el que llena el error por tabla y el que nunca pone `motivo`.
//
// O sea que el mensaje que se leia era el del camino sin motivo, aplicado al camino con
// motivo. No era un fallo del guardado: era el toast escondiendo la respuesta que ya estaba
// en el objeto que acababa de recibir.
//
// Estos tests extraen la funcion y la corren con informes reales del escritor, no
// reimplementan la regla: un test que reimplementa el mensaje probaria el test.
test("un ok false dice QUE tabla fallo y con que error, no 'fallo desconocido'", () => {
  // El corte es por la SIGUIENTE FIRMA, no por el comentario que la abre: cortar en un
  // `/**` deja la estrella y la barra sueltas en el bloque, y `vm` las lee como codigo y
  // contesta SyntaxError. El error sale como "Invalid or unexpected token" en la linea 20 del
  // bloque, que no dice nada de app.js, y es el sintoma de un corte mal puesto.
  const cuerpo = bloque("function motivoDelInforme(", "async function guardarPlanEnSupabase(");
  const ctx = { String, Object, Array, Number };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(cuerpo, ctx);

  // El caso MEDIDO: el camino viejo, con work_orders en 23505 y el resto bien.
  const delCaminoViejo = {
    ok: false,
    camino: "viejo",
    // `motivo` vacio a proposito: asi es como llega de verdad.
    tablas: {
      operations: { insertadas: 1026, error: null },
      work_orders: { insertadas: 0, error: 'HTTP 409: {"code":"23505","message":"duplicate key value violates unique constraint \\"work_orders_ot_key\\""}' },
      materials: { insertadas: 361, error: null },
      selected_ots: { insertadas: 15, error: null },
    },
  };
  const dicho = ctx.motivoDelInforme(delCaminoViejo);
  assert.match(dicho, /work_orders/, "tiene que decir QUE tabla fallo: " + dicho);
  assert.match(dicho, /work_orders_ot_key/, "y con que error, que es lo que hace falta para arreglarlo: " + dicho);
  assert.doesNotMatch(dicho, /fallo desconocido/,
    "'fallo desconocido' es lo que se estaba mostrando con el informe en la mano");

  // Un fallo de la LLAMADA manda sobre el de una tabla: `motivo` es mas especifico.
  assert.equal(
    ctx.motivoDelInforme({ ok: false, motivo: "no hay sesion de Supabase", tablas: { app_state: { error: "401" } } }),
    "no hay sesion de Supabase"
  );

  // Y el caso sin informacion util: se dice que NO HAY MOTIVO, sin inventar uno. El texto
  // exacto es "no dio motivo" y no "sin motivo", asi que la asercion va sobre lo que
  // significa y no sobre una palabra suelta: cambiar la redaccion del mensaje no es un
  // fallo, pero callar el motivo si.
  assert.match(ctx.motivoDelInforme({ ok: false, tablas: {} }), /no dio motivo/i);
  assert.match(ctx.motivoDelInforme({ ok: false }), /no dio motivo/i,
    "un informe sin tablas tampoco puede decir 'fallo desconocido': se dice que no dio motivo");
  assert.doesNotMatch(ctx.motivoDelInforme({ ok: false }), /fallo desconocido/);

  // MEDIDO 2026-10-03 en el navegador: el toast decia "No se pudo guardar el plan: sin
  // filas: no se borra la tabla (vaciarSiEstaVacio lo hace explicito)". Esa nota es la del
  // freno del vacio funcionando a proposito, y el resto del informe no tiene fallo: todo
  // lo demas se escribio bien. "No se pudo" decia que si fallo cuando el guardado se
  // detuvo a proposito. El mensaje tiene que decir que NO se escribio nada y porque, y
  // nombrar vaciarSiEstaVacio es lo que lo hace explicito.
  const soloFreno = { ok: false, tablas: {} };
  for (const t of ["selected_ots", "locked_ots", "operation_plan_statuses"]) {
    soloFreno.tablas[t] = { insertadas: 0, error: null, nota: "sin filas: no se borra la tabla (vaciarSiEstaVacio lo hace explicito)" };
  }
  const dichoFreno = ctx.motivoDelInforme(soloFreno);
  assert.match(dichoFreno, /no se escribio nada/i, "se dice que no se escribio nada: " + dichoFreno);
  assert.match(dichoFreno, /sin filas/i, "se dice porque no se escribio: " + dichoFreno);
  assert.match(dichoFreno, /vaciarSiEstaVacio/, "y se nombra la forma de pedirlo a proposito: " + dichoFreno);
  assert.doesNotMatch(dichoFreno, /fallo desconocido/);

  // El freno de una tabla Y un fallo de verdad en otra: el fallo manda, porque es lo que
  // hay que arreglar. La nota del freno no puede taparlo.
  const frenoYFallo = {
    ok: false,
    tablas: {
      selected_ots: { insertadas: 0, error: null, nota: "sin filas: no se borra la tabla (vaciarSiEstaVacio lo hace explicito)" },
      work_orders: { insertadas: 0, error: "HTTP 409: duplicate key value violates unique constraint work_orders_ot_key" },
    },
  };
  assert.match(ctx.motivoDelInforme(frenoYFallo), /work_orders: HTTP 409/, "con un fallo de verdad, el fallo manda: " + ctx.motivoDelInforme(frenoYFallo));

  // Con MUCHAS tablas que fallan, los nombres van todos y el detalle va al primero, que es
  // el que identifica la peticion que hay que arreglar.
  const muchas = { ok: false, tablas: {} };
  for (const t of ["operations", "work_orders", "materials", "selected_ots", "locked_ots", "operation_plan_statuses"]) {
    muchas.tablas[t] = { error: "HTTP 500: internal server error" };
  }
  const resumen = ctx.motivoDelInforme(muchas);
  for (const t of ["operations", "work_orders", "materials", "selected_ots", "locked_ots", "operation_plan_statuses"]) {
    assert.ok(resumen.includes(t), "con seis tablas que fallan hay que nombrar las seis: falta " + t + " en " + resumen);
  }
  assert.match(resumen, /6 tablas con error/);
  assert.match(resumen, /El primero/, "y se dice cual es el detalle completo");
});

test("los dos caminos de guardado usan el motivo del informe, no un texto fijo", () => {
  // Si uno de los dos vuelve a `informe.motivo || "fallo desconocido"`, la persona vuelve a
  // ver "fallo desconocido" con el motivo a mano. Se fija sobre el CODIGO de las dos, con
  // comentarios fuera: el texto vive en comentarios que explican el defecto, asi que
  // buscarlo en el crudo daria un falso positivo.
  for (const [nombre, fin] of [
    ["async function guardarPlanEnSupabase(", "function guardarSyncDeOrdenesTrabajoEnSupabase"],
    ["async function guardarCatalogosEnSupabase(", "function appSheetMarkDirtyScope"],
  ]) {
    const cuerpo = sinComentarios(bloque(nombre, fin));
    assert.ok(cuerpo.length > 0, "no se encontro el cuerpo de " + nombre);
    assert.match(cuerpo, /motivoDelInforme\(informe\)/, nombre + " tiene que leer el motivo del informe");
    assert.doesNotMatch(cuerpo, /fallo desconocido/,
      nombre + ": volvio el texto fijo, que es lo que se vio MEDIDO 2026-09-30");
  }
});

test("un guardado OK no vuelca la cascada de avisos por tabla como toasts", async () => {
  // MEDIDO 2026-10-07 (usuario, en produccion): `guardarPlanEnSupabase` ponia TODOS los
  // `informe.avisos` como toasts en cascada (showToast reemplaza el unico #toast, se
  // pisaban) y no quedaba claro si eran un error o la confirmacion. El camino viejo empuja
  // un aviso por tabla con filas (queSeEscribioDe: operations:/work_orders:/materials:), y
  // el de materials ademas describe una tabla que la pagina no controla. El fix: esos avisos
  // NO llegan al toast; solo los de ACCION (freno, DDL ausente, eventos omitidos), con el
  // prefijo "Aviso: " para que no lean ni como error ni como confirmacion.
  const cuerpo = (() => {
    const i = app.indexOf("async function guardarPlanEnSupabase(");
    assert.ok(i > 0, "no se encontro guardarPlanEnSupabase");
    const f = app.indexOf("async function guardarSyncDeOrdenesTrabajoEnSupabase()", i);
    assert.ok(f > i, "no se encontro el final de guardarPlanEnSupabase");
    return app.slice(i, f);
  })();
  const toasts = [];
  const guardado = {
    ok: true,
    revision: 9,
    savedAt: "2026-10-07T12:00:00.000Z",
    tablas: {},
    avisos: [
      "operations: no se borro nada; la ingesta de NetSuite tambien escribe aqui",
      "work_orders: se actualizaron solo fechas y precio; el resto es de NetSuite",
      "materials: solo se marco que material se emitio; la lista es de NetSuite",
      "se omitieron 3 evento(s) del log: un guardado manda como mucho 50 eventos por peticion.",
    ],
  };
  const ctx = {
    showToast: (mensaje) => toasts.push(String(mensaje || "")),
    PPSupabaseWriter: { guardar: async () => guardado },
    state: { revision: 4 },
    // RULE-SUP-068: la senal de "la cola se leyo sin fallo"; apagada, como en la
    // pagina antes de que corra la puerta del arranque.
    colaLeidaSinFallo: false,
    // RULE-SUP-069: la compuerta de la primera lectura; en estos escenarios ya
    // concluyo (el doble resuelve al instante), como en la pagina despues del arranque.
    esperarPrimeraLecturaDeSupabase: async () => {},
    String, Object, Array, Number,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(cuerpo, ctx);

  await ctx.guardarPlanEnSupabase();

  assert.equal(ctx.state.revision, 9, "la revision del informe se aplica igual que siempre");
  assert.deepEqual(toasts, [
    "Aviso: se omitieron 3 evento(s) del log: un guardado manda como mucho 50 eventos por peticion.",
  ], "solo los avisos de ACCION llegan al toast, consolidados y con prefijo 'Aviso: '; los de 'que se escribio en la tabla' no");
});

test("el retiro manual de la ultima OT pide vaciarSiEstaVacio; el vacio del arranque no", async () => {
  // MEDIDO 2026-10-07 (usuario, en produccion, con la OT 2844): mover la ultima tarjeta a
  // backlog dejaba selected_ots vacio, el freno de RULE-SUP-062 impedia llamar a
  // plan_guardar y el camino viejo no borraba la tabla (supabase-writer.js:483 "sin filas:
  // no se borra la tabla (vaciarSiEstaVacio lo hace explicito)"), pero el informe salia
  // ok:true y la app mostraba "OT devuelta al backlog". Al recargar, la OT seguia en la
  // cola. El fix añade vaciarSiEstaVacio SOLO cuando el vacio vino de un retiro manual de
  // esta pagina (tombstones _locallyRemovedDraftOts): sin ellos, un estado vacio sigue
  // siendo una lectura fallida o el arranque, y ahi el freno sigue protegiendo la base.
  const cuerpo = (() => {
    const i = app.indexOf("async function guardarPlanEnSupabase(");
    assert.ok(i > 0, "no se encontro guardarPlanEnSupabase");
    const f = app.indexOf("async function guardarSyncDeOrdenesTrabajoEnSupabase()", i);
    assert.ok(f > i, "no se encontro el final de guardarPlanEnSupabase");
    return app.slice(i, f);
  })();
  const corridas = [];
  const ctx = {
    showToast: () => {},
    PPSupabaseWriter: {
      guardar: async (_state, opciones) => {
        corridas.push(opciones);
        return { ok: true, revision: 6, tablas: {}, avisos: [] };
      },
    },
    state: {},
    colaLeidaSinFallo: false,
    // RULE-SUP-069: la compuerta de la primera lectura ya concluyo en este escenario.
    esperarPrimeraLecturaDeSupabase: async () => {},
    String, Object, Array, Number,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(cuerpo, ctx);

  // 1. Retiro manual de la ULTIMA OT: cola vacia CON tombstones de retiro de esta
  //    pagina -> hay que vaciar, sin perder lo que pida el llamador.
  ctx.state = { selectedOts: [], _locallyRemovedDraftOts: ["2844"], revision: 5 };
  await ctx.guardarPlanEnSupabase({ snapshots: ["s1"] });
  assert.equal(corridas[0].vaciarSiEstaVacio, true,
    "cola vacia por retiro manual: pide el opt-in que documenta el propio freno");
  assert.deepEqual(corridas[0].snapshots, ["s1"], "las opciones del llamador no se pierden");

  // 2. El vacio del arranque (o de una lectura fallida) NO lleva el opt-in: ahi el
  //    freno de RULE-SUP-062 sigue protegiendo la base de un estado que nadie quito.
  ctx.state = { selectedOts: [], revision: 5 };
  await ctx.guardarPlanEnSupabase();
  assert.notEqual(corridas[1].vaciarSiEstaVacio, true,
    "cola vacia sin retiro en esta pagina: el freno sigue mandando");

  // 3. Un retiro que NO vacia la cola tampoco lleva el opt-in: el freno solo se
  //    levanta cuando la cola quedo en cero por un retiro de esta pagina.
  ctx.state = { selectedOts: ["2844"], _locallyRemovedDraftOts: ["2926"], revision: 5 };
  await ctx.guardarPlanEnSupabase();
  assert.notEqual(corridas[2].vaciarSiEstaVacio, true,
    "cola que todavia tiene OTs: el freno sigue mandando");
});

test("el aviso del freno con el vacio probado no sale; sin probar, sigue saliendo (RULE-SUP-068)", async () => {
  // MEDIDO 2026-10-08 (usuario, en produccion, tras desplegar RULE-SUP-066): con el
  // plan en cero de verdad, CADA recarga mostraba "Aviso: No se llamo a plan_guardar
  // porque llego vacia... guardalo con vaciarSiEstaVacio" (7 s, toast de accion). El
  // freno tenia razon en no llamar a plan_guardar — nadie pidio vaciar — pero el
  // vacio estaba probado (la lectura de la cola salio bien con 0 filas) y el aviso
  // quedo como alarma falsa de cada arranque. El filtro es SOLO del texto del freno
  // y SOLO con la probanza: con la senal apagada (lectura fallida o guardado previo
  // al arranque) el aviso sigue saliendo tal cual, porque ahi el freno protege.
  const cuerpo = (() => {
    const i = app.indexOf("async function guardarPlanEnSupabase(");
    assert.ok(i > 0, "no se encontro guardarPlanEnSupabase");
    const f = app.indexOf("async function guardarSyncDeOrdenesTrabajoEnSupabase()", i);
    assert.ok(f > i, "no se encontro el final de guardarPlanEnSupabase");
    return app.slice(i, f);
  })();
  const AVISO_FRENO =
    "No se llamo a plan_guardar porque llego vacia y sin que nadie lo pidiera con " +
    "vaciarSiEstaVacio: selected_ots. La funcion borra esas tablas antes de " +
    "reinsertarlas, y un guardado que fallo al leer no puede vaciar el plan entero " +
    "(RULE-SUP-021). Se fue por el camino viejo, que si respeta el freno. Si el " +
    "vacio es de verdad, guardalo con vaciarSiEstaVacio.";
  const AVISO_REAL =
    "se omitieron 1 evento(s) del log: un guardado manda como mucho 50 eventos por peticion.";
  const toasts = [];
  const ctx = {
    showToast: (mensaje) => toasts.push(String(mensaje || "")),
    PPSupabaseWriter: {
      guardar: async () => ({
        ok: true, revision: 6, savedAt: "2026-10-08T12:00:00.000Z", tablas: {},
        avisos: [AVISO_FRENO, AVISO_REAL],
      }),
    },
    state: {},
    colaLeidaSinFallo: false,
    // RULE-SUP-069: la compuerta de la primera lectura ya concluyo en este escenario.
    esperarPrimeraLecturaDeSupabase: async () => {},
    String, Object, Array, Number,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(cuerpo, ctx);

  // 1. VACIO PROBADO por lectura buena: el aviso del freno NO sale; el otro aviso
  //    de accion, que es verdad, pasa igual.
  ctx.state = { selectedOts: [], revision: 5 };
  ctx.colaLeidaSinFallo = true;
  await ctx.guardarPlanEnSupabase();
  assert.deepEqual(toasts, ["Aviso: " + AVISO_REAL],
    "cola leida vacia sin fallo: el freno no tiene nada que advertir y su consejo no es accion posible");

  // 2. SENAL APAGADA (lectura fallida, o guardado anterior a la puerta del arranque):
  //    el aviso del freno sale tal cual — ahi sigue protegiendo la base.
  toasts.length = 0;
  ctx.colaLeidaSinFallo = false;
  await ctx.guardarPlanEnSupabase();
  assert.match(toasts[0], /^Aviso: No se llamo a plan_guardar porque llego vacia/,
    "sin la senal de lectura buena el aviso no se puede filtrar: seria esconder una advertencia cierta");

  // 3. VACIO PROBADO por retiro manual (la otra mitad de la probanza, RULE-SUP-066):
  //    ese caso tambien se silencia, con la senal apagada.
  toasts.length = 0;
  ctx.state = { selectedOts: [], _locallyRemovedDraftOts: ["2844"], revision: 5 };
  await ctx.guardarPlanEnSupabase();
  assert.deepEqual(toasts, ["Aviso: " + AVISO_REAL],
    "el retiro manual de la ultima OT prueba el vacio aunque la lectura no la haya encendido");

  // 4. CON OTS EN LA COLA no hay vacio que probar: aunque la senal este encendida
  //    (se enciende al leer, con OTs o sin ellas), el filtro no aplica.
  toasts.length = 0;
  ctx.state = { selectedOts: ["2844"], revision: 5 };
  ctx.colaLeidaSinFallo = true;
  await ctx.guardarPlanEnSupabase();
  assert.match(toasts[0], /^Aviso: No se llamo a plan_guardar porque llego vacia/,
    "la senal sola no basta: vacioProbado exige la cola en cero");
});

// ---------------------------------------------------------------------------
// EL FALLO DE CATALOGOS NO PUEDE DECIR "GUARDADO" (regresion del 2026-10-03)
// ---------------------------------------------------------------------------
//
// MEDIDO 2026-10-03: con el plan subido y un catalogo fallando (una tabla entre
// muchas, un 400, un RLS), saveAppSheet devolvia true y salia el toast "Plan
// guardado en Supabase". El ambito de catalogo ya habia sido consumido por
// appSheetConsumeDirtyScopes, asi que NO habia reintento: la edicion de la
// pestana quedaba en la memoria y se perdia en la proxima carga. El fix devuelve
// false y re-marca SOLO los ambitos de catalogo (el plan ya esta en la base).
// Estos tests corren el cuerpo real de saveAppSheet, extraido arriba, con los
// dos escritores como dobles: re-implementar el guardado aqui probaria el test.
test("el plan sube y un catalogo falla: false, sin toast de exito y el ambito de catalogo queda vivo", async () => {
  const { ctx, toasts } = escenario({ disponible: true, sucias: ["plan", "catalogs"], planOk: true, catalogosOk: false });
  const guardado = await ctx.saveAppSheet(true);
  assert.equal(guardado, false, "un catalogo que fallo no deja decir que el guardado completo salio bien");
  assert.ok(ctx.appSheetDirtyScopes.has("catalogs"), "el ambito de catalogo quedo re-marcado: la edicion se reintenta y no se pierde");
  assert.ok(!ctx.appSheetDirtyScopes.has("plan"), "el plan YA esta en la base: no se vuelve a re-escribir en el reintento");
  assert.ok(!toasts.some((t) => t === "Plan guardado en Supabase"), "no se dice 'Plan guardado en Supabase' con los catalogos por subir");
  assert.equal(ctx.appSheetSaveInFlight, false, "la puerta se suelta: otro guardado puede entrar a reintentar");
});

test("el ambito de catalogo que falla es el que se re-marca, no otro", async () => {
  const { ctx } = escenario({ disponible: true, sucias: ["matrix"], planOk: true, catalogosOk: false });
  const guardado = await ctx.saveAppSheet(false);
  assert.equal(guardado, false);
  assert.ok(ctx.appSheetDirtyScopes.has("matrix"), "se re-marca 'matrix', que es lo que fallo");
  assert.ok(!ctx.appSheetDirtyScopes.has("catalogs"), "no se inventa un ambito que no estaba en el guardado");
  assert.equal(ctx.appSheetSaveInFlight, false);
});

test("el plan y los catalogos suben: true, ambitos limpios y el toast de exito", async () => {
  const { ctx, toasts } = escenario({ disponible: true, sucias: ["plan", "catalogs"], planOk: true, catalogosOk: true });
  const guardado = await ctx.saveAppSheet(true);
  assert.equal(guardado, true);
  assert.equal(ctx.appSheetDirtyScopes.size, 0, "los ambitos se consumieron y no se re-marcaron");
  assert.deepEqual(toasts, ["Plan guardado en Supabase"], "el toast de exito sale una sola vez y solo cuando todo subio");
  assert.equal(ctx.appSheetSaveInFlight, false);
});

test("el plan falla: todos los ambitos vuelven a marcarse, como siempre", async () => {
  const { ctx, toasts } = escenario({ disponible: true, sucias: ["plan", "catalogs"], planOk: false, catalogosOk: true });
  const guardado = await ctx.saveAppSheet(true);
  assert.equal(guardado, false);
  assert.ok(ctx.appSheetDirtyScopes.has("plan"), "el ambito de plan quedo re-marcado");
  assert.ok(ctx.appSheetDirtyScopes.has("catalogs"), "el ambito de catalogo quedo re-marcado junto con el de plan");
  assert.match(toasts.join(" "), /No se pudo guardar/, "se dice que no se pudo guardar, con el motivo del informe");
  assert.equal(ctx.appSheetSaveInFlight, false);
});

// ---------------------------------------------------------------------------
// RULE-SUP-069: NADIE GUARDA ESTADO QUE NO LEYO
// ---------------------------------------------------------------------------
//
// MEDIDO 2026-10-08 (usuario, en produccion, con RULE-SUP-066/067/068 ya desplegadas): el
// guardado que dispara el arranque corria ANTES de que la lectura de Supabase aplicara, y
// subia el estado local (selected_ots viejo de localStorage) por encima de la base: el
// aviso residual del freno y el riesgo de resucitar OTs ya retiradas. El fix no toca el
// freno ni el filtro del aviso: difiere el guardado hasta que el primer intento de lectura
// concluye, esperandolo en guardarPlanEnSupabase. Estos tests corren la compuerta REAL
// (el bloque PP-APPLY-DESDE-SUPABASE de app.js) con el cuerpo REAL del guardado.

/** El bloque real de la compuerta, entre los dos centinelas de app.js. */
function bloqueCompuerta() {
  const desde = app.indexOf("/* PP-APPLY-DESDE-SUPABASE:INICIO */");
  const hasta = app.indexOf("/* PP-APPLY-DESDE-SUPABASE:FIN */");
  assert.ok(desde >= 0 && hasta > desde, "app.js conserva el bloque PP-APPLY-DESDE-SUPABASE");
  return app.slice(desde, hasta);
}

/** Monta la compuerta real + el guardado real, con la compuerta en el estado pedido. */
function montarCompuerta({ conModulo = true } = {}) {
  const llamadas = [];
  const ctx = {
    showToast: () => {},
    PPSupabaseWriter: {
      guardar: async () => {
        llamadas.push(ctx.state.revision);
        return { ok: true, revision: 1, tablas: {}, avisos: [] };
      },
    },
    state: { revision: 4, selectedOts: ["leida"] },
    colaLeidaSinFallo: false,
    String, Object, Array, Number,
  };
  // Con el modulo de aplicacion en el build, la compuerta bloquea; sin el, no hay quien
  // vaya a leer y esperar seria no guardar nunca.
  if (conModulo) ctx.PPCatalogApply = {};
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(
    bloqueCompuerta() + "\n" + bloque("async function guardarPlanEnSupabase(", "async function guardarSyncDeOrdenesTrabajoEnSupabase"),
    ctx,
  );
  return { ctx, llamadas };
}

test("con la compuerta cerrada el guardado espera; al abrirla escribe con el estado leido (RULE-SUP-069)", async () => {
  const { ctx, llamadas } = montarCompuerta({ conModulo: true });
  const pendiente = ctx.guardarPlanEnSupabase();
  await Promise.resolve();
  assert.deepEqual(llamadas, [], "compuerta cerrada: el guardado de arranque espera, no escribe estado que nadie leyo");

  assert.equal(ctx.concluirPrimeraLecturaDeSupabase(), true, "el primer intento de lectura abre la compuerta");
  await pendiente;
  assert.deepEqual(llamadas, [4], "compuerta abierta: el guardado diferido escribe UNA vez, con el estado ya leido");
  assert.equal(ctx.concluirPrimeraLecturaDeSupabase(), false,
    "abrir dos veces no vuelve a soltar a nadie: es una compuerta de una sola vez");
});

test("sin el modulo de aplicacion en el build la compuerta no bloquea (RULE-SUP-069)", async () => {
  // No hay quien abra la compuerta si nadie va a leer: esperar seria no guardar nunca.
  // Se deja pasar y el comportamiento es el de siempre, con el freno intacto.
  const { ctx, llamadas } = montarCompuerta({ conModulo: false });
  await ctx.guardarPlanEnSupabase();
  assert.deepEqual(llamadas, [4], "sin modulo de aplicacion el guardado pasa como siempre");
});

// ---------------------------------------------------------------------------
// RULE-SUP-072: EL RETIRO DE LA ULTIMA OT NO SE DA POR GUARDADO HASTA QUE SE ESCRIBE
// ---------------------------------------------------------------------------
//
// MEDIDO 2026-10-08 (usuario, en produccion, con la OT 2752): retirar la ultima OT mostraba
// el toast de exito ("OT 2752 devuelta al backlog") y, al recargar, la OT estaba de vuelta.
// El aviso de exito no probaba nada: el marcador de retiro (_locallyRemovedDraftOts) se
// borraba en saveAppSheet por CUALQUIER guardado exitoso —incluido uno que ya estaba en vuelo
// cuando la persona retiro la OT y cuyo payload todavia la llevaba dentro—; al llegar el turno
// del guardado del retiro (flushPlanSave), el marcador ya no estaba, no se pedia
// vaciarSiEstaVacio, el freno del vacio (RULE-SUP-062) saltaba plan_guardar, selected_ots no
// se borraba... y el informe salia ok:true con el aviso del freno silenciado (RULE-SUP-068).
// El marcador se borra ahora en guardarPlanEnSupabase, y solo si ESE guardado escribio el
// vacio de verdad. Estos tests corren el cuerpo REAL de saveAppSheet y de guardarPlanEnSupabase
// (extraidos de app.js) con los escritores como dobles.

test("RULE-SUP-072: con la cola VACIA un guardado exitoso NO borra el retiro pendiente", async () => {
  const { ctx } = escenario({ disponible: true, sucias: ["plan"], planOk: true });
  ctx.state = { selectedOts: [], _locallyRemovedDraftOts: ["2844"], operations: [] };
  const guardado = await ctx.saveAppSheet(false);
  assert.equal(guardado, true, "el guardado en si salio bien");
  assert.deepEqual([...ctx.state._locallyRemovedDraftOts], ["2844"],
    "con la cola vacia el exito de ESTE guardado no prueba que el retiro se escribio: el marcador se conserva para el guardado del retiro");
});

test("RULE-SUP-072: con la cola NO vacia el guardado si borra el retiro pendiente", async () => {
  const { ctx } = escenario({ disponible: true, sucias: ["plan"], planOk: true });
  ctx.state = { selectedOts: ["2926"], _locallyRemovedDraftOts: ["2844"], operations: [] };
  await ctx.saveAppSheet(false);
  assert.equal(ctx.state._locallyRemovedDraftOts, undefined,
    "con la cola NO vacia el retiro ya viaja en el espejo de selected_ots de ESTE guardado");
});

test("RULE-SUP-072: el retiro se borra solo cuando el guardado escribio el vacio", async () => {
  const cuerpo = (() => {
    const i = app.indexOf("async function guardarPlanEnSupabase(");
    assert.ok(i > 0, "no se encontro guardarPlanEnSupabase");
    const f = app.indexOf("async function guardarSyncDeOrdenesTrabajoEnSupabase()", i);
    assert.ok(f > i, "no se encontro el final de guardarPlanEnSupabase");
    return app.slice(i, f);
  })();
  const montar = (guardado) => {
    const ctx = {
      showToast: () => {},
      PPSupabaseWriter: { guardar: async () => guardado() },
      state: { selectedOts: [], _locallyRemovedDraftOts: ["2844"], revision: 5 },
      colaLeidaSinFallo: false,
      // RULE-SUP-069: la compuerta de la primera lectura ya concluyo en este escenario.
      esperarPrimeraLecturaDeSupabase: async () => {},
      String, Object, Array, Number,
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(cuerpo, ctx);
    return ctx;
  };

  // 1. Camino rpc con selected_ots escrito: el vacio se persistio, el marcador ya no hace falta.
  const rpc = montar(() => ({
    ok: true, camino: "rpc", revision: 7,
    tablas: { selected_ots: { modo: "espejo", insertadas: 0, error: null } }, avisos: [],
  }));
  await rpc.guardarPlanEnSupabase();
  assert.equal(rpc.state._locallyRemovedDraftOts, undefined,
    "camino rpc: el vacio se escribio de verdad");

  // 2. Camino viejo con la nota del freno ("sin filas: no se borra la tabla"): NO se escribio,
  //    el marcador se conserva para que el siguiente guardado reintente con vaciarSiEstaVacio.
  const freno = montar(() => ({
    ok: true, camino: "viejo", revision: 7,
    tablas: { selected_ots: { insertadas: 0, error: null, nota: "sin filas: no se borra la tabla (vaciarSiEstaVacio lo hace explicito)" } }, avisos: [],
  }));
  await freno.guardarPlanEnSupabase();
  assert.deepEqual([...freno.state._locallyRemovedDraftOts], ["2844"],
    "freno: la tabla quedo intacta, el marcador no se puede dar por guardado");
});
