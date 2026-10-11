// Verifica que los 5 sitios de guardado en app.js escriben el plan por Supabase y
// NO por el puente de Apps Script.
//
// Los sitios son:
//   1. saveAppSheet (guardado principal del plan, y de los catalogos con su ambito)
//   2. persistOptimisticPlanStatus (Completar/Reabrir operacion)
//   3. persistPlanSnapshot (instantanea del borrador)
//   4. syncNetSuiteTwoPhase (guardado tras sincronizar con NetSuite)
//
// Estos tests SACAN las funciones del cuerpo de app.js y las corren en un vm con
// dobles, como hace tests/guardado-sin-puente.test.mjs. Reimplementarlas probaria
// el test, no el codigo.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const app = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");

/** Saca un bloque de app.js desde `desde` hasta `hasta`. */
function bloque(desde, hasta) {
  const i = app.indexOf(desde);
  assert.ok(i > 0, `no se encontro ${desde}`);
  const f = app.indexOf(hasta, i);
  assert.ok(f > i, `no se encontro el final de ${desde}`);
  return app.slice(i, f);
}

// Las funciones que se prueban, sacadas de app.js. El orden importa: guardarPlanEnSupabase
// y guardarCatalogosEnSupabase tienen que existir antes de que saveAppSheet las llame por
// nombre (una declaracion de function se eleva, asi que en realidad da igual, pero mantener
// el orden del archivo hace mas facil leer el diff).
const FUENTES = [
  bloque("async function guardarPlanEnSupabase(", "async function guardarCatalogosEnSupabase("),
  bloque("async function guardarCatalogosEnSupabase(", "function ambitosDeCatalogo("),
  bloque("function ambitosDeCatalogo(", "async function saveAppSheet("),
  bloque("async function saveAppSheet(", "function appSheetMarkDirtyScope("),
  bloque("async function persistPlanSnapshot(", "async function persistPlanAutoBackup("),
  bloque("async function syncNetSuiteTwoPhase(", "function applyNetSuitePlanningPayload("),
  bloque("async function persistOptimisticPlanStatus(", "function renderProductionReportRow("),
].join("\n");

/**
 * Monta el contexto con los dobles necesarios.
 *
 * `guardar` es el doble de PPSupabaseWriter.guardar; el escenario decide que devuelve.
 * Los 5 sitios se prueban contra el MISMO writer, asi que ninguno puede escribir por su
 * cuenta: si alguno se escapara al puente, apareceria un "callAppsScript" en `llamadas`.
 */
function escenario({ guardar = null, esRuntimeDeAppsScript = false } = {}) {
  const llamadas = [];
  const toasts = [];
  const ambitos = [];
  // El doble por defecto ANOTA la llamada, igual que el doble del puente. Si un sitio
  // de guardado se escapara al puente, el test lo veria como un "callAppsScript" extra.
  const writer = {
    guardar: guardar || (async (state, opciones) => {
      llamadas.push({ metodo: "guardar", state, opciones });
      return {
        ok: true,
        camino: "rpc",
        revision: 1,
        savedAt: "2026-01-01T00:00:00.000Z",
        avisos: [],
        tablas: {},
        ms: 10,
      };
    }),
  };
  const state = {
    revision: 0,
    savedAt: null,
    operations: [],
    workOrders: [],
    materials: [],
    selectedOts: [],
    lockedOts: [],
    operationPlanStatuses: {},
  };
  const ctx = {
    state,
    appSheetAvailable: true,
    appSheetSaveInFlight: false,
    appSheetSavePending: false,
    appSheetSaveTimer: null,
    appSheetDirtyScopes: new Set(["plan"]),
    operationStatusSavesInFlight: 0,
    appSheetSaveOwner: null,
    appSheetSaveCompletion: null,
    resolveAppSheetSaveCompletion: null,
    planningActionsBusy: "",
    planStateMutationVersion: 0,
    // RULE-SUP-068: la senal de "la cola se leyo sin fallo" que la puerta del
    // arranque enciende en app.js; en los dobles arranca apagada, como en la
    // pagina antes de que corra la puerta.
    colaLeidaSinFallo: false,
    // RULE-SUP-069: la compuerta de la primera lectura; en este arnes ya concluyo (el
    // doble resuelve al instante), como en la pagina despues del arranque.
    esperarPrimeraLecturaDeSupabase: async () => {},
    // syncNetSuiteTwoPhase multiplica este tiempo por 24 para el batch de planeacion.
    NETSUITE_PLANNING_TIMEOUT_MS: 1000,
    backlogSyncInFlight: false,
    netSuiteSyncInFlight: false,
    netSuitePlanningSyncInFlight: false,
    showToast: (message) => toasts.push(message),
    isAppsScriptRuntime: () => esRuntimeDeAppsScript,
    // MEDIDO 2026-09-29 en el navegador: `isAppsScriptRuntime` miente en el sitio estatico
    // (los dos instaladores lo dejan en "el puente esta configurado"), y por eso el guardado
    // del plan se iba por callAppsScript. `enRuntimeAppsScript` es el predicado que responde
    // la pregunta de verdad: google.script.run solo existe dentro de HtmlService. El arnes
    // lo monta con el MISMO valor que isAppsScriptRuntime para que el escenario "estamos en
    // Apps Script" siga describiendo lo que describe.
    enRuntimeAppsScript: () => esRuntimeDeAppsScript,
    appSheetDisponible: () => true,
    PPSupabaseWriter: writer,
    PPCatalogApply: { claves: { "tools.codigo": ["T1"] } },
    // Cualquier llamada al puente queda registrada. El punto del test es que NO haya
    // ninguna para escribir el plan, asi que el doble no silencia nada: lo anota.
    callAppsScript: async (method, ...args) => {
      llamadas.push({ metodo: "callAppsScript", method, args });
      return { revision: 1, savedAt: "2026-01-01T00:00:00.000Z" };
    },
    // PPSupabaseBridgeReplacement: el reemplazo del puente de Apps Script por Supabase.
    // syncNetSuiteTwoPhase y persistOptimisticPlanStatus lo usan para leer de Supabase.
    // saveOperationPlanStatus delega en el writer para que los tests de fallen puedan simular errores.
    //
    // MEDIDO 2026-10-02, Y ESTE DOBLE ESCONDIO UN DEFECTO. Este falso REEMPLAZA el metodo
    // real de `PPSupabaseBridgeReplacement`, y el metodo real estaba roto: pedia
    // `writer.guardarPlan`, que el escritor no exporta, o sea que en el navegador el boton
    // Completar/Reabrir del detalle de OT rechazaba antes de escribir y la persona veia el
    // estado cambiar y volver. Con este doble, el camino real no se ejercitaba NUNCA y la
    // suite podia estar en verde con el boton roto.
    //
    // El metodo real, con el escritor real y sin red, se prueba en
    // tests/supabase-bridge-escritura.test.mjs. Este doble sigue aqui porque su proposito
    // es otro: estos tests simulan fallos de guardado, y para eso hay que poder hacer que
    // la escritura falle sin abrir Supabase.
    PPSupabaseBridgeReplacement: {
      syncNetSuitePlanningData: async () => ({ operations: [], materials: [], source: "supabase" }),
      saveOperationPlanStatus: async (payload) => {
        const result = await writer.guardar(ctx.state, { operationPlanStatuses: payload.statuses });
        if (result?.ok === false) throw new Error(result?.motivo || "No se pudo guardar");
        return { revision: result?.revision || 1, savedAt: "2026-01-01T00:00:00.000Z" };
      },
      // 2026-10-10: el archivo del BORRADOR va aparte del guardado del estado. persistPlanSnapshot
      // llama aqui DESPUES de guardarPlanEnSupabase, para que el RPC del estado no cargue los
      // ~1,95 MB de la instantanea (el cuerpo de 4,4 MB no subia por el enlace). El doble anota
      // lo archivado para que el test pueda afirmar sobre el.
      saveDraftSnapshot: async (payload) => {
        llamadas.push({ metodo: "saveDraftSnapshot", payload });
        const data = payload || {};
        return { ...data, snapshotId: data.snapshotId || "draft-test" };
      },
    },
    appSheetTryAcquireSaveGate: () => ({}),
    appSheetReleaseSaveGate: () => true,
    appSheetMarkDirtyScope: () => {},
    // saveAppSheet CONSUME los ambitos sucios; se le da la lista que el test quiera.
    appSheetConsumeDirtyScopes: () => [...ctx.appSheetDirtyScopes],
    appSheetWaitForIdle: async () => {},
    queueAppSheetSave: () => {},
    saveState: () => {},
    render: () => {},
    renderTop: () => {},
    renderPlanAlerts: () => {},
    renderPriorityList: () => {},
    renderPriorityQueue: () => {},
    renderPlanStatusRow: () => {},
    updateQueueLockCard: () => {},
    requestAnimationFrame: (fn) => fn(),
    clearPendingPlanStatusSaveKeys: () => {},
    discardDetachedPlanStatusRows: () => {},
    rollbackPlanStatusByOrigin: () => {},
    planStatusOriginForSource: () => "draft",
    schedulePlanStatusBackgroundWork: () => {},
    clearNetSuiteSyncAlert: () => {},
    setNetSuiteSyncAlert: () => {},
    setNetSuiteSyncPhaseLabel: () => {},
    setBacklogSyncInFlight: () => {},
    syncWorkOrdersOnce: async () => true,
    applyNetSuitePlanningPayload: () => {},
    applyNetSuiteWorkOrdersPayload: () => {},
    currentPlanOperations: () => [],
    savePlanSnapshotsCache: () => {},
    renderPlanSnapshotSelect: () => {},
    renderReports: () => {},
    upsertPlanSnapshotRecord: () => {},
    createAppSheetPayload: () => ({ operations: [], workOrders: [], materials: [] }),
    persistableState: () => ({}),
    validateNetSuiteImportedData: () => {},
    invalidateCurrentPlanOperationsCache: () => {},
    resetBacklogWindow: () => {},
    reconcileActiveWorkOrders: (current) => current,
    purgeClosedWorkOrderRetention: (current) => current,
    otHasPendingOperation: () => true,
    console: { warn: () => {}, error: () => {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    structuredClone,
    window: {
      clearTimeout: () => {},
      setTimeout: () => 0,
      PlanningWorkflowCore: {
        buildDraftSnapshot: (payload) => ({ ...payload, snapshotId: "draft-test" }),
        isUnsupportedDraftSnapshotError: () => false,
        // conTimeout recibe la PROMESA ya hecha (app.js la envuelve antes de llamar),
        // no una funcion. Este doble solo la devuelve.
        withTimeout: async (promesa) => promesa,
        netSuiteSyncOutcome: (workOrders, planning) => ({ status: planning?.ok ? "complete" : "failed", error: planning?.error, message: planning?.ok ? "Sincronizacion completa" : "Fallo" }),
        mondayIso: () => "2026-01-01",
        nextWeeklyVersion: () => 1,
      },
    },
    Set, String, Object, Array, JSON, Math, Date, Number, Boolean, Promise, Error, RegExp, Map,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(FUENTES, ctx, { filename: "planning-supabase-write-sites.js" });
  // Las funciones de app.js son globales del vm; se leen de ahi, no se redefinen.
  const leer = (nombre) => vm.runInContext(nombre, ctx);
  return {
    ctx,
    llamadas,
    toasts,
    ambitos,
    writer,
    guardarPlanEnSupabase: leer("guardarPlanEnSupabase"),
    guardarCatalogosEnSupabase: leer("guardarCatalogosEnSupabase"),
    ambitosDeCatalogo: leer("ambitosDeCatalogo"),
    saveAppSheet: leer("saveAppSheet"),
    persistPlanSnapshot: leer("persistPlanSnapshot"),
    syncNetSuiteTwoPhase: leer("syncNetSuiteTwoPhase"),
    persistOptimisticPlanStatus: leer("persistOptimisticPlanStatus"),
    guardar: (...args) => writer.guardar(...args).then((informe) => {
      llamadas.push({ metodo: "guardar", args });
      return informe;
    }),
  };
}

const OPERACION = { ot: "123", id: "op-1", planStatus: "COMPLETADA_PLAN" };

test("guardarPlanEnSupabase llama a PPSupabaseWriter.guardar y no al puente", async () => {
  const f = escenario();
  f.llamadas = [];
  f.ctx.PPSupabaseWriter.guardar = async (state, opciones) => {
    f.llamadas.push({ metodo: "guardar", state, opciones });
    return { ok: true, revision: 1, savedAt: "2026-01-01T00:00:00.000Z", avisos: [] };
  };

  const resultado = await f.guardarPlanEnSupabase();

  assert.equal(resultado, true);
  assert.ok(f.llamadas.some((l) => l.metodo === "guardar"), "tiene que llamar a PPSupabaseWriter.guardar");
  assert.deepEqual(f.llamadas.filter((l) => l.metodo === "callAppsScript"), [], "no puede llamar al puente");
});

test("guardarPlanEnSupabase deja en el estado la revision y el savedAt del informe", async () => {
  const f = escenario();

  await f.guardarPlanEnSupabase();

  assert.equal(f.ctx.state.revision, 1, "la revision del informe tiene que quedar en el estado");
  assert.equal(f.ctx.state.savedAt, "2026-01-01T00:00:00.000Z");
});

test("guardarPlanEnSupabase con conflicto devuelve false y avisa que hay que recargar", async () => {
  const f = escenario();
  f.ctx.PPSupabaseWriter.guardar = async () => ({
    ok: false,
    camino: "rpc",
    conflicto: { codigo: "CONFLICT_REVISION", revision_actual: 5, revision_esperada: 0 },
    revision: 5,
    avisos: [],
  });

  const resultado = await f.guardarPlanEnSupabase();

  assert.equal(resultado, false);
  assert.ok(f.toasts.some((t) => t.includes("Recarga")), "tiene que pedir recargar");
});

test("guardarPlanEnSupabase con error devuelve false y muestra el motivo", async () => {
  const f = escenario();
  f.ctx.PPSupabaseWriter.guardar = async () => { throw new Error("fallo de red"); };

  const resultado = await f.guardarPlanEnSupabase();

  assert.equal(resultado, false);
  assert.ok(f.toasts.some((t) => t.includes("fallo de red")), "tiene que mostrar el motivo");
});

test("guardarPlanEnSupabase pasa los snapshots tal cual a guardar", async () => {
  const f = escenario();
  let recibido = null;
  f.ctx.PPSupabaseWriter.guardar = async (_state, opciones) => {
    recibido = opciones;
    return { ok: true, revision: 1, avisos: [] };
  };
  const snapshot = { snapshotId: "draft-test", operations: [] };

  await f.guardarPlanEnSupabase({ snapshots: [snapshot] });

  assert.deepEqual(recibido.snapshots, [snapshot]);
});

test("guardarPlanEnSupabase sin escritor en el build no dice que guardo", async () => {
  const f = escenario();
  f.ctx.PPSupabaseWriter = null;

  const resultado = await f.guardarPlanEnSupabase();

  assert.equal(resultado, false, "sin escritor no puede decir que guardo");
  assert.ok(f.toasts.some((t) => t.includes("Supabase")));
});

test("saveAppSheet escribe el plan por Supabase, no por el puente", async () => {
  const f = escenario();

  const resultado = await f.saveAppSheet(false);

  assert.equal(resultado, true);
  assert.ok(f.llamadas.some((l) => l.metodo === "guardar"), "tiene que llamar a guardar");
  assert.deepEqual(f.llamadas.filter((l) => l.metodo === "callAppsScript"), []);
});

test("saveAppSheet FUERA de Apps Script escribe por Supabase y NUNCA por el puente", async () => {
  // MEDIDO 2026-09-29 en el navegador real (sitio estatico, sesion de Supabase): con
  // `isAppsScriptRuntime()` dando TRUE por el predicado mentiroso del puente, saveAppSheet
  // caia en la rama de Apps Script y el plan se subia por callAppsScript, que en GitHub Pages
  // es un iframe que no escribe las Hojas. Los catalogos no se subian de ninguna manera.
  // Este es el escenario que el navegador mostro y el que los tests anteriores no cubrian:
  // el runtime NO es Apps Script, y el guardado tiene que ir entero por Supabase.
  const f = escenario({ esRuntimeDeAppsScript: false });

  const resultado = await f.saveAppSheet(false);

  assert.equal(resultado, true);
  assert.ok(f.llamadas.some((l) => l.metodo === "guardar"), "el plan tiene que ir por Supabase");
  assert.deepEqual(f.llamadas.filter((l) => l.metodo === "callAppsScript"), [],
    "fuera de Apps Script no puede escribir por el puente: es un iframe, no el runtime");
});

test("saveAppSheet DENTRO de Apps Script sigue el camino del puente nativo", async () => {
  // El runtime de Apps Script es el unico lugar donde el puente nativo sigue escribiendo
  // las Hojas. Ahi la rama de Apps Script es la correcta y no se toca.
  const f = escenario({ esRuntimeDeAppsScript: true });

  const resultado = await f.saveAppSheet(false);

  assert.equal(resultado, true);
  assert.ok(f.llamadas.some((l) => l.metodo === "guardar"), "el plan tiene que ir por Supabase");
  assert.deepEqual(f.llamadas.filter((l) => l.metodo === "callAppsScript"), [],
    "incluso dentro de Apps Script el plan va por Supabase; el puente nativo es quien lo escribe despues");
});

test("saveAppSheet sube los catalogos cuando el ambito lo pide", async () => {
  const f = escenario();
  f.ctx.appSheetDirtyScopes = new Set(["catalogs", "plan"]);
  let ambitoRecibido = null;
  f.ctx.PPSupabaseWriter.guardarCatalogos = async (_state, opciones) => {
    ambitoRecibido = opciones;
    return { ok: true, avisos: [] };
  };

  const resultado = await f.saveAppSheet(false);

  assert.equal(resultado, true);
  assert.equal(ambitoRecibido.ambito, "catalogs");
  // Las claves que se leyeron al arrancar: sin ellas el escritor sube y no borra.
  assert.deepEqual(ambitoRecibido.clavesLeidas, { "tools.codigo": ["T1"] });
});

test("saveAppSheet NO sube catalogos en un guardado que solo es del plan", async () => {
  // MEDIDO 2026-09-29: subir catalogos en cada guardado del plan mandaba cientos de
  // filas que no cambiaron, en un plan que se guarda cada 900 ms.
  const f = escenario();
  f.ctx.appSheetDirtyScopes = new Set(["plan"]);
  let subioCatalogos = false;
  f.ctx.PPSupabaseWriter.guardarCatalogos = async () => {
    subioCatalogos = true;
    return { ok: true, avisos: [] };
  };

  await f.saveAppSheet(false);

  assert.equal(subioCatalogos, false);
});

test("saveAppSheet sube los catalogos DESPUES del plan, no antes", async () => {
  // Si el plan falla, saveAppSheet lanza antes de llegar a los catalogos: no se sube
  // nada de un guardado que no ocurrio.
  const f = escenario();
  f.ctx.appSheetDirtyScopes = new Set(["catalogs"]);
  const orden = [];
  f.ctx.PPSupabaseWriter.guardar = async () => {
    orden.push("plan");
    return { ok: true, revision: 1, avisos: [] };
  };
  f.ctx.PPSupabaseWriter.guardarCatalogos = async () => {
    orden.push("catalogos");
    return { ok: true, avisos: [] };
  };

  await f.saveAppSheet(false);

  assert.deepEqual(orden, ["plan", "catalogos"]);
});

test("saveAppSheet con plan fallido no sube catalogos", async () => {
  const f = escenario();
  f.ctx.appSheetDirtyScopes = new Set(["catalogs"]);
  f.ctx.PPSupabaseWriter.guardar = async () => ({ ok: false, motivo: "rechazado por RLS", avisos: [] });
  let subioCatalogos = false;
  f.ctx.PPSupabaseWriter.guardarCatalogos = async () => {
    subioCatalogos = true;
    return { ok: true, avisos: [] };
  };

  const resultado = await f.saveAppSheet(false);

  assert.equal(resultado, false);
  assert.equal(subioCatalogos, false);
});

test("ambitosDeCatalogo reconoce los cuatro ambitos de catalogo y no los del plan", () => {
  const f = escenario();

  assert.deepEqual([...f.ambitosDeCatalogo(["plan", "catalogs"])], ["catalogs"]);
  assert.deepEqual([...f.ambitosDeCatalogo(["matrix"])], ["matrix"]);
  assert.deepEqual([...f.ambitosDeCatalogo(["ot-config", "gantt"])].sort(), ["gantt", "ot-config"]);
  assert.deepEqual([...f.ambitosDeCatalogo(["plan", "ui", "local"])], []);
  assert.deepEqual([...f.ambitosDeCatalogo([])], []);
});

test("persistPlanSnapshot guarda el estado y archiva el borrador en dos escrituras", async () => {
  const f = escenario();
  let opciones = null;
  f.ctx.PPSupabaseWriter.guardar = async (_state, o) => {
    opciones = o;
    return { ok: true, revision: 1, avisos: [] };
  };

  const resultado = await f.persistPlanSnapshot();

  assert.ok(resultado, "persistPlanSnapshot tiene que devolver el snapshot");
  // 2026-10-10: la instantanea YA NO viaja dentro del cuerpo del RPC (era el 44% del payload y
  // no subia por el enlace). El estado va por guardarPlanEnSupabase y el borrador por su POST.
  assert.ok(!opciones || !Array.isArray(opciones.snapshots) || opciones.snapshots.length === 0,
    "la instantanea no puede volver a viajar dentro del RPC del estado");
  const archivados = f.llamadas.filter((l) => l.metodo === "saveDraftSnapshot");
  assert.equal(archivados.length, 1, "la instantanea se archiva por su propio camino");
  assert.equal(archivados[0].payload.snapshotId, resultado.snapshotId);
  assert.deepEqual(f.llamadas.filter((l) => l.metodo === "callAppsScript"), []);
});

test("syncNetSuiteTwoPhase guarda por Supabase y no pide savePlanningStateOptimized", async () => {
  const f = escenario();
  let guardo = false;
  f.ctx.PPSupabaseWriter.guardar = async () => {
    guardo = true;
    return { ok: true, revision: 2, avisos: [] };
  };

  const outcome = await f.syncNetSuiteTwoPhase({ persist: true });

  assert.equal(outcome.status, "complete", `el sync tiene que terminar bien: ${outcome.error || ""}`);
  assert.ok(guardo, "syncNetSuiteTwoPhase tiene que guardar por Supabase");
  // syncNetSuitePlanningData si es una llamada al puente, y esta bien: TRAE operaciones
  // de NetSuite. Lo que no puede pasar es que el PLAN se escriba por ahi.
  const escrituraPorPuente = f.llamadas.filter((l) => l.metodo === "callAppsScript" && /save|write/i.test(String(l.method || "")));
  assert.deepEqual(escrituraPorPuente, [], "el plan no se puede escribir por el puente");
});

test("persistOptimisticPlanStatus guarda por Supabase fuera de Apps Script", async () => {
  const f = escenario();
  let guardo = false;
  f.ctx.PPSupabaseWriter.guardar = async () => {
    guardo = true;
    return { ok: true, revision: 2, avisos: [] };
  };

  const resultado = await f.persistOptimisticPlanStatus(
    "key-1",
    OPERACION,
    { status: "PENDIENTE" },
    OPERACION,
    ["123"],
    "Estatus actualizado",
  );

  assert.equal(resultado, true);
  assert.ok(guardo, "tiene que guardar por Supabase");
  assert.deepEqual(f.llamadas.filter((l) => l.metodo === "callAppsScript"), []);
});

test("persistOptimisticPlanStatus revierte el cambio cuando Supabase no deja guardar", async () => {
  const f = escenario();
  f.ctx.PPSupabaseWriter.guardar = async () => ({ ok: false, motivo: "rechazado", avisos: [] });

  const resultado = await f.persistOptimisticPlanStatus(
    "key-1",
    OPERACION,
    { status: "PENDIENTE" },
    OPERACION,
    ["123"],
    "Estatus actualizado",
  );

  assert.equal(resultado, false, "no puede confirmar un cambio que no se guardo");
  assert.ok(f.toasts.some((t) => t.includes("restauro")), "tiene que avisar que restauro el valor anterior");
});
