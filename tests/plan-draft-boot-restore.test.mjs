import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

/**
 * RULE-PLAN-013: el borrador del plan NO vive en localStorage (compactLocalState pone
 * operations: [] y materials: []), y su autoridad es el snapshot "draft" del backend. Por eso el
 * unicoepath que puede devolver el plan cuando getAppState falla es
 * maybeRestoreSavedDraftOnBoot (app.js), que lee ese snapshot.
 *
 * El sintoma medido en produccion el 2026-09-27: al recargar, getAppState agotaba los 120 s, el
 * cliente avisaba "Se mantiene el cache local porque el backend no respondio" y la app se quedaba
 * con la cola de OTs (workOrders y selectedOts, que SI se persisten) pero SIN operaciones: la
 * informacion guardada de la OT no aparecia. El rescate existia, pero su presupuesto de reintentos
 * era de 15 x 2 500 ms = 37,5 s, y lo que esperaba (que se liberara netSuiteSyncInFlight) tarda
 * hasta 120 s. La cadena se agotaba 82 s antes de que pudiera hacer falta.
 *
 * Estos tests fijan la RELACION entre las dos constantes, que es lo que se rompio, y no el numero
 * suelto: asi si alguien mueve el timeout del puente, el test obliga a mover el presupuesto con el.
 */

const RAIZ = fileURLToPath(new URL("../", import.meta.url));
const appPath = path.join(RAIZ, "src", "web", "planning", "app.js");
const bridgePath = path.join(RAIZ, "src", "web", "shared", "apps-script-bridge-client.js");

async function leerApp() {
  return readFile(appPath, "utf8");
}

test("el presupuesto de reintentos del borrador dura MAS que el timeout que espera", async () => {
  const app = await leerApp();

  // MEDIDO 2026-09-30: esta prueba leia CALL_TIMEOUT_MS del puente. Ese ya no es el techo que
  // puede tener ocupado a netSuiteSyncInFlight, porque el puente quedo deshabilitado
  // (RULE-SUP-030). El techo real paso a ser el presupuesto del cliente, que vive en el mismo
  // archivo. Y aqui se rompio algo de verdad: con el puente el sync se cortaba a los 120 s, asi
  // que un presupuesto de 180 s iba con margen; al quitarlo el sync ocupa los 180 s completos y
  // el presupuesto se agotaba en el MISMO instante en que se liberaba el flag, que es el fallo
  // que este mismo archivo ya habia comentado. Por eso el presupuesto subio a 240 s y por
  // eso el test lee la constante nueva.
  const timeout = Number((app.match(/NETSUITE_BACKLOG_SYNC_TIMEOUT_MS\s*=\s*(\d+)/) || [])[1]);
  const presupuesto = Number((app.match(/DRAFT_BOOT_RESTORE_BUDGET_MS\s*=\s*(\d+)/) || [])[1]);
  const paso = Number((app.match(/DRAFT_BOOT_RESTORE_RETRY_MS\s*=\s*(\d+)/) || [])[1]);

  assert.ok(timeout, "no se encontro NETSUITE_BACKLOG_SYNC_TIMEOUT_MS en app.js");
  assert.ok(presupuesto, "no se encontro DRAFT_BOOT_RESTORE_BUDGET_MS en app.js");
  assert.ok(paso > 0, "DRAFT_BOOT_RESTORE_RETRY_MS tiene que ser un paso positivo");

  assert.ok(
    presupuesto > timeout,
    `el presupuesto del rescate (${presupuesto} ms) tiene que durar MAS que el timeout que espera ` +
      `(${timeout} ms): si no, la cadena de reintentos se agota antes de que se libere ` +
      `netSuiteSyncInFlight y el borrador nunca se restaura`,
  );
  // Y tiene que caber un numero entero de intentos: un presupuesto que no es multiplo del paso
  // desperdicia el ultimo tramo, que es justo el final, el que importa.
  assert.ok(presupuesto % paso === 0, `el presupuesto (${presupuesto}) deberia ser multiplo del paso (${paso})`);
});

test("el presupuesto se lleva en tiempo, no en numero de intentos", async () => {
  const app = await leerApp();
  // El defecto original era un contador de intentos con un tope fijo. Si vuelve a aparecer un
  // tope por conteo, el presupuesto depende de cuantos intentos quepan, no de cuanto tiempo
  // sobreviva la llamada que espera, que es lo unico que importa.
  assert.doesNotMatch(
    app,
    /__draftBootRestoreRetries/,
    "el presupuesto del rescate no puede volver a ser un conteo de intentos: por eso se quito __draftBootRestoreRetries",
  );
  assert.match(app, /__draftBootRestoreRetrySpentMs/);
  assert.match(
    app,
    /if \(spent >= DRAFT_BOOT_RESTORE_BUDGET_MS\) return;/,
    "el corte tiene que comparar contra el presupuesto en ms, no contra un numero de intentos",
  );
});

test("el disparador del rescate sobrevive a que una de las dos ramas del arranque falle", async () => {
  const app = await leerApp();
  // El otro disparador de maybeRestoreSavedDraftOnBoot es este Promise.all. Un Promise.all sin
  // catch se rechaza entero si UNA rama falla y el .then nunca corre: la lectura de la lista de
  // instantaneas es de red, y si falla, el borrador no se restauraba aunque el sync hubiera
  // terminado bien.
  const promiseAll = app.match(/void Promise\.all\(\[[\s\S]*?\]\)\.then\(\(\[bootResult\]\) => \{[\s\S]*?\}\);/);
  assert.ok(promiseAll, "no se encontro el Promise.all del arranque que dispara maybeRestoreSavedDraftOnBoot");
  const bloque = promiseAll[0];
  assert.match(
    bloque,
    /Promise\.resolve\(bootSync\)\.catch\(/,
    "la rama del sync necesita catch: si revienta, el .then no corre y no hay rescate",
  );
  assert.match(
    bloque,
    /Promise\.resolve\(snapshotsRequest\)\.catch\(/,
    "la rama de la lista de instantaneas necesita catch por la misma razon",
  );
  assert.match(bloque, /maybeRestoreSavedDraftOnBoot/, "el .then tiene que seguir llamando al rescate del borrador");
});

test("el rescate del borrador tiene DOS disparadores independientes, no uno", async () => {
  const app = await leerApp();
  // Son exactamente dos, y por eso los dos tienen que estar: la cadena de reintentos (que espera a
  // que se libere netSuiteSyncInFlight) y el Promise.all del arranque (que espera a que terminen el
  // sync y la lista de instantaneas). Antes el segundo no tenia catch, con lo cual la red de
  // seguridad se caia en cuanto fallaba una rama: un solo fallo de red dejaba la app sin plan.
  // NO son tres: no hay un tercer temporizador de arranque, y este test lo dice para que nadie
  // cuente sobre un disparador imaginario.
  const reintento = app.includes(
    "setTimeout(() => { void maybeRestoreSavedDraftOnBoot(); }, DRAFT_BOOT_RESTORE_RETRY_MS);",
  );
  const arranque = app.includes("Promise.resolve(bootSync).catch(");
  assert.ok(reintento, "falta el disparador por reintentos");
  assert.ok(arranque, "falta el disparador del arranque");
  const llamadas = app.match(/maybeRestoreSavedDraftOnBoot\(\)/g) || [];
  assert.equal(llamadas.length, 3, `se esperaban 3 llamadas a maybeRestoreSavedDraftOnBoot y hay ${llamadas.length}`);
});

test("compactLocalState sigue sin persistir el plan, y el borrador del backend es la unica autoridad", async () => {
  const cliente = await readFile(path.join(RAIZ, "src", "web", "shared", "performance-client.js"), "utf8");
  // No se "arregla" la falta de operaciones en localStorage metiendolas ahi: es una decision
  // documentada (RULE-PLAN-013 punto 3) y meter el plan en localStorage lo duplicaria sin reloj de
  // frescura. Este test existe para que ese cambio, si alguien lo intenta, sea explicito.
  const compact = cliente.match(/function compactLocalState\(\) \{[\s\S]*?\n  \}/);
  assert.ok(compact, "no se encontro compactLocalState");
  assert.match(compact[0], /operations: \[\]/, "localStorage no debe persistir operations: la autoridad del plan es el snapshot draft");
  assert.match(compact[0], /materials: \[\]/, "localStorage no debe persistir materials: se piden aparte (deferredMaterials)");
  assert.match(
    cliente,
    /delete persisted\.machineToolHistory/,
    "machineToolHistory es dato derivado del servidor y no se persiste en el cliente",
  );
});

test("la puerta del rescate: no toca un plan de pantalla mas nuevo que el borrador", async () => {
  const app = await leerApp();
  // Si alguien relaja la puerta para "hacer que siempre restaure", introduce el fallo de
  // ERR-DATOS-VIEJOS-BORRADOR-001: un borrador viejo pisando uno nuevo. La puerta de hoy: si el
  // plan de pantalla es MAS NUEVO que el borrador Y ya tiene plan, no se toca. Antes era
  // "no hay nada programado en pantalla", que ya no sirve porque el espejo hoy SI trae horas.
  assert.match(app, /savedGeneratedAtMs > currentGeneratedAtMs/, "el rescate sigue comparando el reloj del borrador contra el de pantalla");
  assert.match(app, /pantallaEsMasNueva && hayPlanEnPantalla\) return;/, "un plan de pantalla mas nuevo que el borrador no se pisa");
});

// ---------------------------------------------------------------------------
// RULE-PLAN-015 (2026-10-04): el rescate vuelve a estar ENCENDIDO, y lo unico que dejo de
// hacer es reordenar la cola. Estos tests ejecutan la funcion de verdad, en un vm con las
// piezas de app.js que usa, porque lo que hay que proteger aqui no es una forma de codigo sino
// una consecuencia: la cola de la persona y sus bloqueos tienen que salir intactos, y las
// operaciones con fecha tienen que entrar.
//
// QUE SE MIDIO ANTES DE ESCRIBIRLOS. Con una carga nueva de la pagina (navegador del taller,
// 2026-10-04) la cola volvia entera: 4 OTs, mismo orden manual, con sus configuraciones. El
// plan NO volvia: el espejo `operations` trae lo que escribio la ingesta de NetSuite, con
// `start_planned` a medianoche y sin horas (supabase-reader.js, MEDIDO 2026-09-29), y el reporte
// de la semana decia "Sin OTs para esta semana". El borrador si estaba guardado (1 fila en
// plan_snapshots, snapshot_id 'draft'); lo que no existia era quien lo leyera, porque este
// rescate estaba apagado (RULE-PLAN-014) y el boton "Restaurar borrador" descarta el borrador de
// su lista (`restoreDraftCandidateSnapshots`).
// ---------------------------------------------------------------------------

function recorteRescate(app) {
  const desde = app.indexOf("async function maybeRestoreSavedDraftOnBoot()");
  const hasta = app.indexOf("function scheduleDraftBootRestoreRetry()", desde);
  assert.ok(desde > 0 && hasta > desde, "no se pudo recortar maybeRestoreSavedDraftOnBoot");
  return app.slice(desde, hasta);
}

function operacion(ot, secuencia, extra = {}) {
  return Object.assign({
    id: `${ot}-${secuencia}`,
    ot,
    secuencia,
    ct: "CT 1",
    descripcion: "Corte",
    operador: "",
    maquina: "M1",
    tiempoCiclo: 10,
    tiempoSetup: 0,
    fechaInicio: "",
    horaInicio: "",
    fechaFin: "",
    horaFin: "",
    tipoInsercion: "OPERACION",
    estatus: "PLAN",
    locked: false,
  }, extra);
}

/**
 * El rescate, ejecutado de verdad. Solo se sustituyen las piezas de app.js que son de otros
 * modulos (las de planificacion) y las de pantalla; la DECISION (que restaura, que no, y sobre
 * que cola) es la de app.js sin tocar.
 */
function correrRescate(app, { state, snapshot, planSnapshots = [{ snapshotId: "draft", operations: 99 }] }) {
  const registro = { toasts: [], guardados: [], reintentos: 0, renders: 0 };
  const contexto = {
    console,
    state,
    planSnapshots,
    netSuiteSyncInFlight: false,
    netSuitePlanningSyncInFlight: false,
    planningActionsBusy: false,
    scheduleDraftBootRestoreRetry: () => { registro.reintentos += 1; },
    fetchPlanSnapshot: async (snapshotId) => {
      assert.equal(snapshotId, "draft", "el rescate solo puede leer el borrador");
      return snapshot;
    },
    uniq: (lista) => [...new Set((Array.isArray(lista) ? lista : []).filter(Boolean))],
    normalizeKey: (valor) => String(valor || "").trim().toUpperCase(),
    normalizeOperation: (op) => Object.assign({}, op),
    opStart: (op) => (op && op.fechaInicio
      ? new Date(`${op.fechaInicio}T${String(op.horaInicio || "00:00")}:00Z`)
      : null),
    isToolChangeReportOperation: (op) => String(op && op.tipoInsercion || "").toUpperCase() === "CAMBIO_HERRAMENTAL",
    captureLocalPlanningState: () => ({ planStart: state.planStart, selectedOts: state.selectedOts, lockedOts: state.lockedOts, operations: state.operations }),
    planningDraftDiffers: (a, b) => JSON.stringify((a.operations || []).map((op) => [op.ot, op.secuencia, op.fechaInicio, op.horaInicio, op.maquina]))
      !== JSON.stringify((b.operations || []).map((op) => [op.ot, op.secuencia, op.fechaInicio, op.horaInicio, op.maquina])),
    normalizeState: () => {},
    invalidateCurrentPlanOperationsCache: () => {},
    alignReportWeekStartToFirstScheduledOperation: () => {},
    saveState: (ambito) => { registro.guardados.push(ambito); registro.relojEnGuardado = state.lastSchedule && state.lastSchedule.generatedAt; },
    render: () => { registro.renders += 1; },
    showToast: (mensaje) => { registro.toasts.push(String(mensaje || "")); },
  };
  vm.runInNewContext(recorteRescate(app), contexto);
  return contexto.maybeRestoreSavedDraftOnBoot().then(() => ({ registro, estado: contexto.state }));
}

test("el rescate del borrador restaura el plan y NO toca la cola ni los bloqueos de la persona", async () => {
  const app = await leerApp();
  const state = {
    // El orden MANUAL que puso la persona. El borrador trae el suyo, que es el de programacion.
    selectedOts: ["3750", "3747"],
    lockedOts: ["3747"],
    planStart: "2026-06-29",
    horizonDays: 15,
    lastSchedule: { generatedAt: "2026-10-04T18:00:00.000Z", scheduledOts: ["3750", "3747"] },
    operations: [operacion("3750", 10), operacion("3750", 20), operacion("3747", 10)],
  };
  const snapshot = {
    snapshotId: "draft",
    generatedAt: "2026-10-04T19:00:00.000Z",
    planStart: "2026-10-05",
    horizonDays: 15,
    lastSchedule: { generatedAt: "2026-10-04T18:30:00.000Z", scheduledOts: ["3699", "3747", "3750"] },
    // La cola del borrador, en orden de programacion, con una OT que la persona ya saco.
    selectedOts: ["3699", "3747", "3750"],
    lockedOts: ["3699"],
    operations: [
      operacion("3750", 10, { fechaInicio: "2026-10-05", horaInicio: "08:00", fechaFin: "2026-10-05", horaFin: "08:10", maquina: "M1", operador: "ANA" }),
      operacion("3750", 20, { fechaInicio: "2026-10-05", horaInicio: "08:15", fechaFin: "2026-10-05", horaFin: "08:25", maquina: "M1", operador: "ANA" }),
      operacion("3747", 10, { fechaInicio: "2026-10-05", horaInicio: "09:00", fechaFin: "2026-10-05", horaFin: "09:10", maquina: "M2", operador: "LUIS", locked: true }),
      operacion("3699", 10, { fechaInicio: "2026-10-05", horaInicio: "10:00", horaFin: "2026-10-05", horaFin: "10:10" }),
    ],
  };

  const { registro, estado } = await correrRescate(app, { state, snapshot });

  // 1. LA COLA: intacta, en el orden de la persona, sin la OT que saco.
  assert.deepEqual(estado.selectedOts, ["3750", "3747"], "el rescate no puede reordenar la cola ni resucitar una OT sacada");
  assert.deepEqual(estado.lockedOts, ["3747"], "los bloqueos tambien son de la persona");
  assert.ok(!estado.selectedOts.includes("3699"), "3699 no estaba en la cola y no vuelve con el plan");

  // 2. EL PLAN: entra con fecha y hora, solo para las OTs de la cola.
  const porOt = new Map();
  for (const op of estado.operations) {
    if (!porOt.has(op.ot)) porOt.set(op.ot, []);
    porOt.get(op.ot).push(op);
  }
  assert.deepEqual([...porOt.keys()].sort(), ["3747", "3750"], "solo vuelven las operaciones de las OTs en cola");
  const sec10 = porOt.get("3750").find((op) => op.secuencia === 10);
  assert.equal(sec10.fechaInicio, "2026-10-05");
  assert.equal(sec10.horaInicio, "08:00", "la hora es justo lo que el espejo de NetSuite no trae");
  assert.equal(sec10.operador, "ANA", "el plan se restaura con la asignacion del borrador, no con la del espejo");
  assert.equal(porOt.get("3747")[0].locked, true, "el bloqueo viaja en la propia operacion");

  // 3. LO QUE SE DICE, y lo que se guarda. El rescate RENDERIZA el plan y avisa, pero NO
  //    solicita guardado remoto (RULE-SUP-062, 2026-10-07): un `saveState("plan")` aqui
  //    re-marcaba el plan sucio, el debounce de 850-900 ms guardaba el plan entero en cada
  //    arranque con borrador, y ese guardado caia al camino viejo por el freno y sacaba la
  //    cascada de avisos por tabla (materials incluido) sin distinguir confirmacion de error.
  assert.equal(estado.lastSchedule.generatedAt, "2026-10-04T19:00:00.001Z", "arreglo B: el reloj queda 1 ms por encima del generatedAt del borrador");
  assert.equal(estado.planStart, "2026-10-05");
  assert.deepEqual(registro.guardados, [], "el rescate no solicita guardado remoto");
  assert.ok(registro.toasts.some((t) => /Borrador restaurado al iniciar/.test(t)), `no se aviso del rescate: ${JSON.stringify(registro.toasts)}`);
});

test("el rescate entra aunque el borrador NO sea mas nuevo, si en pantalla no hay nada programado", async () => {
  const app = await leerApp();
  // Este es el caso medido del 2026-10-04. El `generatedAt` del borrador es ANTERIOR al del
  // app_state (los dos los escribio el mismo guardado de "Generar plan", y el snapshot se sella
  // despues de calcular el plan), asi que `savedIsNewer` da false y la unica segunda via que
  // queda es "en pantalla no hay nada programado": el espejo trae operaciones, pero con
  // `start_planned` a medianoche y sin horas.
  const state = {
    selectedOts: ["3750"],
    lockedOts: [],
    planStart: "2026-06-29",
    horizonDays: 15,
    lastSchedule: { generatedAt: "2026-10-04T19:00:00.000Z" },
    operations: [operacion("3750", 10), operacion("3750", 20)],
  };
  const snapshot = {
    snapshotId: "draft",
    generatedAt: "2026-10-04T18:59:00.000Z",
    planStart: "2026-10-05",
    horizonDays: 15,
    lastSchedule: { generatedAt: "2026-10-04T18:58:00.000Z", scheduledOts: ["3750"] },
    operations: [
      operacion("3750", 10, { fechaInicio: "2026-10-05", horaInicio: "07:00", fechaFin: "2026-10-05", horaFin: "07:10" }),
      operacion("3750", 20, { fechaInicio: "2026-10-05", horaInicio: "07:15", fechaFin: "2026-10-05", horaFin: "07:25" }),
    ],
  };

  const { registro, estado } = await correrRescate(app, { state, snapshot });

  // `structuredClone` y no el array directo: `estado.operations` lo arma la funcion dentro del vm, y
  // su Array.prototype es de otro realm, entonces `deepEqual` estricto falla por eso y no por el dato.
  assert.deepEqual(structuredClone(estado.operations).map((op) => op.horaInicio), ["07:00", "07:15"], "el plan tiene que entrar igual: no hay nada programado en pantalla");
  assert.deepEqual(estado.selectedOts, ["3750"]);
  assert.equal(estado.lastSchedule.generatedAt, "2026-10-04T18:59:00.001Z", "arreglo B: el reloj queda 1 ms por encima del del borrador, aunque savedIsNewer sea falso");
  assert.ok(registro.toasts.some((t) => /Borrador restaurado al iniciar/.test(t)));
});

test("arreglo B: el sello del reloj queda solo en memoria; el rescate ya no guarda nada", async () => {
  const app = await leerApp();
  // Escenario igual al de produccion: los dos generatedAt salen del MISMO guardado de
  // "Generar plan", o sea IGUALES (savedIsNewer falso). Por eso el import de fondo no
  // dejaba el plan en paz y habia que sellar el reloj.
  const state = {
    selectedOts: ["3750"],
    lockedOts: [],
    planStart: "2026-06-29",
    horizonDays: 15,
    lastSchedule: { generatedAt: "2026-10-04T19:00:00.000Z" },
    operations: [operacion("3750", 10)],
  };
  const snapshot = {
    snapshotId: "draft",
    generatedAt: "2026-10-04T19:00:00.000Z",
    planStart: "2026-10-05",
    horizonDays: 15,
    lastSchedule: { generatedAt: "2026-10-04T19:00:00.000Z", scheduledOts: ["3750"] },
    operations: [
      operacion("3750", 10, { fechaInicio: "2026-10-05", horaInicio: "07:00", fechaFin: "2026-10-05", horaFin: "07:10" }),
    ],
  };

  const { registro, estado } = await correrRescate(app, { state, snapshot });

  // En memoria: 1 ms por encima del borrador.
  assert.equal(estado.lastSchedule.generatedAt, "2026-10-04T19:00:00.001Z", "el reloj de pantalla queda 1 ms por encima del borrador");
  // Sin guardado, el sello NO puede viajar a app_state por construccion: el reloj de la base
  // sigue siendo el del ultimo guardado real, y la puerta de entrada puede volver a entrar en
  // la siguiente ingesta (importedIsStaleSchedule) si el borrador vuelve a ser el mas nuevo.
  assert.deepEqual(registro.guardados, [], "el rescate ya no escribe app_state: el sello +1 ms ni siquiera tiene oportunidad de guardarse");
});

test("el rescate NO entra si el borrador es mas viejo Y en pantalla ya hay plan", async () => {
  const app = await leerApp();
  const state = {
    selectedOts: ["3750"],
    lockedOts: [],
    planStart: "2026-10-05",
    horizonDays: 15,
    lastSchedule: { generatedAt: "2026-10-04T19:00:00.000Z" },
    operations: [operacion("3750", 10, { fechaInicio: "2026-10-06", horaInicio: "06:00", maquina: "M9", operador: "BETO" })],
  };
  const snapshot = {
    snapshotId: "draft",
    generatedAt: "2026-10-04T18:00:00.000Z",
    planStart: "2026-10-05",
    horizonDays: 15,
    lastSchedule: { generatedAt: "2026-10-04T17:59:00.000Z" },
    operations: [operacion("3750", 10, { fechaInicio: "2026-10-05", horaInicio: "07:00", maquina: "M1", operador: "ANA" })],
  };

  const { registro, estado } = await correrRescate(app, { state, snapshot });

  assert.equal(estado.operations[0].maquina, "M9", "un borrador viejo no pisa un plan en pantalla (ERR-DATOS-VIEJOS-BORRADOR-001)");
  assert.equal(estado.operations[0].horaInicio, "06:00");
  assert.deepEqual(registro.guardados, [], "no hay nada que guardar si no se restauro nada");
  assert.deepEqual(registro.toasts, []);
});
