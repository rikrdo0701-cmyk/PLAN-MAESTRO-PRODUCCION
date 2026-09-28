import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
  const puente = await readFile(bridgePath, "utf8");

  const timeout = Number((puente.match(/CALL_TIMEOUT_MS\s*=\s*(\d+)/) || [])[1]);
  const presupuesto = Number((app.match(/DRAFT_BOOT_RESTORE_BUDGET_MS\s*=\s*(\d+)/) || [])[1]);
  const paso = Number((app.match(/DRAFT_BOOT_RESTORE_RETRY_MS\s*=\s*(\d+)/) || [])[1]);

  assert.ok(timeout, "no se encontro CALL_TIMEOUT_MS en apps-script-bridge-client.js");
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

test("la puerta de frescura del rescate sigue comparando generatedAt contra el snapshot", async () => {
  const app = await leerApp();
  // Si alguien relaja la comparacion para "hacer que siempre restaure", introduce el fallo de
  // ERR-DATOS-VIEJOS-BORRADOR-001: un borrador viejo pisando uno nuevo.
  assert.match(app, /savedGeneratedAtMs > currentGeneratedAtMs/, "el rescate debe seguir exigiendo que el snapshot sea mas nuevo");
  assert.match(app, /savedToolChanges === 0\) return;/, "sin cambios de herramental y sin borrador mas nuevo, no se restaura");
});
