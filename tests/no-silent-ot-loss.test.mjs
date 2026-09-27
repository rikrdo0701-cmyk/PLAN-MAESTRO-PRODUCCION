/**
 * LAZO DE LISTA BLANCA: quien puede quitar una OT de las listas.
 *
 * POR QUE ESTE ARCHIVO. Los tests de comportamiento de RULE-OT-051 comprueban cuatro funciones
 * conocidas. Se verifico que funcionan como guardia: revirtiendo el fix a la inferencia original
 * ("ausente del payload = cerrada"), 8 tests se pusieron rojos reportando la perdida real
 * ("no se pierde ninguna de las 100" -> 50 perdidas).
 *
 * LO QUE ESO NO CUBRE. Si alguien escribe una funcion NUEVA con la misma forma, ningun test de
 * comportamiento la ve, porque no la conoce. Este lazo mira el arbol entero de src/ y exige que
 * el conjunto de funciones capaces de ASIGNAR a la cola o a las fichas siga siendo el mismo. Un
 * podador nuevo no puede aparecer sin que alguien mire la lista y decida.
 *
 * NOTA SOBRE EL RUIDO. La lista tiene 21 entradas, muchas de ellas acciones de una persona
 * (bloquear, reordenar, devolver a backlog) que si son legitimas. El coste del lazo es que un
 * refactor que mueva una de estas funciones va a poner el CI en rojo. Se paga a proposito: el
 * error que evita es perder el plan de un dia entero sin avisar, y el lazo dice exactamente
 * que paso.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// OJO CON ESTA RUTA. La primera version hacia
//   new URL("..", import.meta.url).pathname.replace(/^\//, "")
// que en Windows da una ruta usable (C:/...), pero en Linux QUITAR LA BARRA INICIAL la
// convierte en RELATIVA y todo falla con ENOENT. En local nunca se ve, porque el CI corre en
// Linux. fileURLToPath es la forma canonica y funciona en los dos. Este lazo existe para
// revisar el arbol entero, asi que necesita una ruta de verdad, no un URL.
const RAIZ = fileURLToPath(new URL("..", import.meta.url));

// Este guardia existe porque el bug anterior SOLO se manifestaba en Linux, y asi que en local
// no se veia. Medido con path.isAbsolute:
//   Windows, "C:\...\plangit\" -> quitarle el primer caracter deja ":\...\plangit\", que
//     path.win32.isAbsolute sigue aceptando como absoluta. O sea que EN LOCAL ESTE GUARDIA NO
//     SE DISPARA, y el bug pasaria inadvertido otra vez.
//   Linux, "/home/runner/..." -> quitarle la barra inicial deja "home/runner/...", que ya NO es
//     absoluta, y todo el archivo falla con ENOENT.
// O sea que el guardia sirve en el CI, que es donde corrio el fallo, y no en local. Es lo unico
// que se puede hacer sin un segundo runner: el mensaje al menos dice cual es la causa, en vez
// de cinco ENOENTs que parecen un problema de archivos faltantes.
if (!path.isAbsolute(RAIZ)) {
  throw new Error(
    `La raiz del repo tiene que ser ABSOLUTA y es "${RAIZ}". Si quitaste la barra inicial con `
    + "replace(/^\\//, '') rompiste Linux: en Windows no se nota y en el CI todo da ENOENT. "
    + "Usar fileURLToPath(new URL('..', import.meta.url)), que es la forma canonica.",
  );
}

// LUGARES AUTORIZADOS A ASIGNAR selectedOts / lockedOts / workOrders. Son 21, y cada uno es
// un lugar donde una OT puede salir de las listas. La lista blanca es deliberada: si
// aparece una funcion nueva aqui, el CI se pone rojo y alguien tiene que decidir si esa
// poda es correcta. Es el seguro contra un podador NUEVO, que ningun test de
// comportamiento podria ver porque todavia no existe.
//
// Las que parecen inocentes y NO lo son de verdad: PP_applyNetSuiteWorkOrdersData_ y
// applyNetSuiteWorkOrdersPayload (sincronizacion), normalizeState y el reconcile del
// cliente (poda por evidencia, RULE-OT-051). Las demas son acciones de una persona
// (bloquear, desbloquear, reordenar, devolver a backlog) o restauraciones de un snapshot.
const AUTORIZADAS = new Set([
  // applyImported y saveAppSheet son async, y el scanner no reconocia `async function`: sus
  // asignaciones quedaban a nombre de la declaracion anterior. applyImported reemplaza la cola
  // con la del servidor (es el import); saveAppSheet hace el rollback de _pendingAddOt cuando el
  // servidor rechaza el guardado. Los dos ya estaban; el scanner es el que los ve ahora.
  "src/web/planning/app.js :: applyImported()",
  "src/web/planning/app.js :: saveAppSheet()",
  "src/web/planning/app.js :: applyNetSuiteWorkOrdersPayload()",
  "src/web/planning/app.js :: blockOtForCompletion()",
  "src/web/planning/app.js :: existingOperations()",
  "src/web/planning/app.js :: existingWorkOrder()",
  "src/web/planning/app.js :: normalizeState()",
  "src/web/planning/app.js :: pushUnique()",
  "src/web/planning/app.js :: renderPlanStatusChange()",
  "src/web/planning/app.js :: reorderSelectedJobs()",
  "src/web/planning/app.js :: sigueViva()",
  "src/web/planning/app.js :: toggleAllJobs()",
  "src/web/planning/app.js :: toggleJobLock()",
  "src/web/planning/app.js :: unblockOtAfterCompletion()",
  // wrapQueueMutation es un wrapper transparente: delega en la funcion envuelta y solo intercambia
  // checkpointState/jobsCache. Escribe las listas al restaurar el snapshot anterior.
  "src/web/shared/fluid-client.js :: wrapQueueMutation()",
  // El reconciliador del servidor (PP_applyNetSuiteWorkOrdersData_) es un bloque largo donde la
  // ultima declaracion con nombre antes de las asignaciones es este predicado. Las tres
  // asignaciones (merged.workOrders / selectedOts / lockedOts) son suyas por construccion: podan
  // con confirmadas[], o sea con evidencia de cierre (RULE-OT-051), igual que las dos de arriba.
  "src/server/08-netsuite.js :: PP_applyNetSuitePlantData_()",
  "src/server/08-netsuite.js :: PP_applyNetSuiteWorkOrdersData_()",
  "src/server/08-netsuite.js :: sigueViva()",
  "src/web/shared/performance-client.js :: keep()",
  "src/web/shared/performance-client.js :: preserved()",
  // trimLocalCachePayload solo hace delete a claves de metadata (_locallyRemovedDraftOts,
  // _pendingAddOt, expandedOts...) cuando el payload excede el guard de 4 MB. Nunca toca
  // selectedOts/lockedOts/workOrders. Falso positivo del scanner linea por linea.
  "src/web/shared/performance-client.js :: trimLocalCachePayload()",
]);

async function jsFiles(sub) {
  const out = [];
  async function walk(d) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) await walk(f);
      else if (e.name.endsWith(".js")) out.push(f);
    }
  }
  await walk(path.join(RAIZ, sub));
  return out;
}

/**
 * Sin comentarios ni cadenas: un ejemplo en un comentario no debe disparar el lazo.
 *
 * OJO CON CRLF. El archivo esta en CRLF, asi que al partir por "\n" cada linea queda con un
 * "\r" al final. En JavaScript el punto de una expresion regular NO cruza un \r (es un
 * terminador de linea), asi que un /\\/\/.*$/ con el "$" pegado NUNCA hace match sobre una linea
 * con CRLF y los comentarios de linea se cuelan. Por eso se normalizan los saltos de linea
 * antes, y el patron no lleva "$".
 */
function soloCodigo(fuente) {
  return fuente
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((linea) => linea.replace(/(^|[^:])\/\/.*/, "$1"))
    .join("\n");
}

const ASIGNA = /\b(?:state|merged|source|next|payload|out|previous|restored)\s*\.\s*(selectedOts|lockedOts|workOrders)\s*=\s*(?![=])/;

test("ninguna funcion NUEVA puede quitar una OT de las listas sin que alguien lo decida", async () => {
  const encontradas = new Set();
  for (const archivo of await jsFiles("src")) {
    if (archivo.includes("node_modules")) continue;
    const fuente = soloCodigo(await readFile(archivo, "utf8"));
    let nombre = "(modulo)";
    for (const linea of fuente.split("\n")) {
      // Con \s* delante: las funciones de src/server/ estan indentadas dentro del IIFE, y sin
      // esto el scanner les atribjia el nombre de la anterior sin sangrar, o sea (modulo).
      const def = linea.match(/^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/);
      if (def) nombre = def[1];
      // var y let tambien: sin ellos, `var sigueViva = function(ot)` no actualiza el nombre y las
      // asignaciones siguientes se atribuyen a la declaracion anterior.
      const asig = linea.match(/^\s*(?:var|let|const)\s+([A-Za-z0-9_$]+)\s*=\s*(?:function|\()/);
      if (asig) nombre = asig[1];
      if (ASIGNA.test(linea)) {
        encontradas.add(`${path.relative(RAIZ, archivo).replace(/\\/g, "/")} :: ${nombre}()`);
      }
    }
  }

  const nuevas = [...encontradas].filter((k) => !AUTORIZADAS.has(k)).sort();
  const desaparecidas = [...AUTORIZADAS].filter((k) => !encontradas.has(k)).sort();

  assert.deepEqual(nuevas, [],
    "UNA FUNCION NUEVA ASIGNA A LA COLA O A LAS FICHAS. Puede quitar una OT de las listas, y "
    + "eso solo puede pasar por evidencia de cierre (RULE-OT-051). Revisa si es correcto y, si "
    + "lo es, agregala a AUTORIZADAS en tests/no-silent-ot-loss.test.mjs con un comentario que "
    + "diga por que:\n  " + nuevas.join("\n  "));
  assert.deepEqual(desaparecidas, [],
    "UNA FUNCION DE LA LISTA YA NO ASIGNA. Si se elimino o renombro, actualiza la lista para que "
    + "siga reflejando la realidad.\n  " + desaparecidas.join("\n  "));
});

test("ningun render escribe en la cola (un render es una ruta de lectura)", async () => {
  const CLIENTE = soloCodigo(await readFile(path.join(RAIZ, "src/web/planning/app.js"), "utf8"));
  const prohibido = /\bstate\s*\.\s*(selectedOts|lockedOts|expandedOts|workOrders|operations)\s*=\s*[^=]/;
  const culpables = [];
  // Solo render*: un update/refresh/save no es un render, y updateSaveAck si escribe a proposito.
  for (const [, nombre] of CLIENTE.matchAll(/function\s+(render[A-Za-z0-9_$]*)\s*\(/g)) {
    const inicio = CLIENTE.indexOf(`function ${nombre}(`);
    const resto = CLIENTE.slice(inicio + 1);
    const siguiente = resto.search(/\nfunction\s+[A-Za-z0-9_$]+\s*\(/);
    const cuerpo = siguiente < 0 ? resto : resto.slice(0, siguiente);
    if (prohibido.test(cuerpo)) culpables.push(nombre + "()");
  }
  assert.deepEqual(culpables, [],
    "un render no puede borrar datos. Estas funciones redibujan y ADEMAS escriben en el estado:\n  "
    + culpables.join("\n  "));
});

test("el mecanismo de evidencia sigue existiendo en el cliente y en el servidor", async () => {
  // Si alguien quita la confirmacion en dos pasos, el lazo de lista blanca no diria nada,
  // porque el podador nuevo ya no usaria el patron viejo. Por eso se comprueba que la
  // evidencia siga ahi.
  const CORE = soloCodigo(await readFile(path.join(RAIZ, "src/web/planning/planning-workflow-core.js"), "utf8"));
  const SERVIDOR = soloCodigo(await readFile(path.join(RAIZ, "src/server/08-netsuite.js"), "utf8"));
  // La confirmacion folio por folio vive en el servicio de inspeccion, que es el que habla con
  // el 2244. El 08-netsuite.js es el que reconcilia y persiste lo que el cliente ya confirms.
  const INSPECCION = soloCodigo(await readFile(path.join(RAIZ, "src/server/16-inspection-service.js"), "utf8"));

  for (const [nombre, fuente] of [["cliente", CORE], ["servidor", SERVIDOR]]) {
    assert.match(fuente, /unconfirmedWorkOrders/, `${nombre}: debe existir la lista de OTs por confirmar`);
    assert.match(fuente, /exists\s*===\s*false/, `${nombre}: exists === false es evidencia positiva`);
    assert.match(fuente, /caidaMasiva|massDrop/, `${nombre}: debe existir el guardia de caida masiva`);
    // Y hay que dejar rastro, para que se pueda auditar que paso en cada sincronizacion.
    assert.match(fuente, /lastWorkOrderReconcile/, `${nombre}: debe dejar auditoria de la reconciliacion`);
  }

  // Y el podador tiene que ser la CONFIRMACION, no la cuenta de ausencias. El 2026-09-26 el
  // usuario cambio esto: la OT se queda hasta que NetSuite DIGA que esta cerrada. Dos
  // ausencias son la ausencia persistiendo, no un "digo", asi que misses >= 2 NO puede volver
  // a ser lo que poda.
  assert.doesNotMatch(CORE, /misses\s*>=\s*2[\s\S]{0,80}confirm/,
    "la segunda ausencia no puede ser lo que confirma el cierre");
  assert.match(CORE, /confirmedBySource/,
    "el cliente tiene que aceptar los folios que NetSuite confirmo como cerrados");
  assert.match(INSPECCION, /function confirmWorkOrderClosures\(/,
    "el servidor tiene que poder preguntar folio por folio");
  assert.match(INSPECCION, /closed: encontrado && PP_confirmedClosedStatus_\(/,
    "y solo declara cerrada una OT que se encontro Y cuyo estatus lo dice");
  assert.match(INSPECCION, /PP_CONFIRMED_CLOSED_WORDS_/,
    "las palabras de cierre confirmado tienen que estar en un solo sitio, no repetidas");
  // Y el reconciliador del servidor tiene que aceptar lo que el cliente ya confirmo, porque es
  // lo que se persiste en CONFIG y no se puede deshacer con otro sync.
  assert.match(SERVIDOR, /confirmadas\[PP_normalizeKey_\(ot\)\]/,
    "el servidor decide por la tabla de confirmadas, no por openOts");
});

test("la sincronizacion SIEMPRE pide la confirmacion de cierres (RULE-OT-051)", async () => {
  const app = soloCodigo(await readFile(path.join(RAIZ, "src/web/planning/app.js"), "utf8"));
  // Si alguien quita la llamada, la ausencia vuelve a decidir el cierre y nada lo detecta.
  assert.match(app, /await confirmUnconfirmedWorkOrderClosures\(\);/,
    "syncNetSuiteData tiene que pedir la confirmacion de cierres");
  const i = app.indexOf("await confirmUnconfirmedWorkOrderClosures();");
  const antes = app.slice(Math.max(0, i - 700), i);
  assert.match(antes, /applyNetSuiteWorkOrdersPayload\(imported\)/,
    "y se pide DESPUES de aplicar el payload, que es cuando ya se sabe que OTs faltaron");
  // Y el 2244 tiene que poder dar el estatus, que es lo que hace posible la confirmacion.
  const restlet = soloCodigo(await readFile(path.join(RAIZ, "netsuite-restlet-wo-inspeccion.js"), "utf8"));
  assert.match(restlet, /resultados\.estatus =/,
    "el 2244 detail tiene que devolver el estatus de la OT; sin eso no hay confirmacion posible");
});

test("reconcileActiveWorkOrders no reemplaza workOrders con el payload crudo", async () => {
  // La version rota hacia que lo que no venia se perdia sin dejar ficha.
  const CORE = soloCodigo(await readFile(path.join(RAIZ, "src/web/planning/planning-workflow-core.js"), "utf8"));
  const inicio = CORE.indexOf("function reconcileActiveWorkOrders(");
  assert.ok(inicio > 0, "no se encontro reconcileActiveWorkOrders");
  const cuerpo = CORE.slice(inicio, inicio + 9000);
  assert.match(cuerpo, /currentByOt\.get\(ot\)/,
    "la ficha de la OT que no vino tiene que conservarse");
  assert.match(cuerpo, /unconfirmedWorkOrders:/,
    "y hay que devolver la lista de por confirmar, no solo podar");
  assert.doesNotMatch(cuerpo, /workOrders:\s*incoming\.map\(/,
    "workOrders no puede ser el payload crudo: eso borra las OTs que no vinieron");
});