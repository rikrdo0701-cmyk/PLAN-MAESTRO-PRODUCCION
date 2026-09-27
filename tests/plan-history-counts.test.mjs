/**
 * RULE-PERF-013 — el conteo de PLANES_HISTORICOS tiene que ser IGUAL al conteo entero, y costar
 * solo la cola nueva.
 *
 * MEDIDO 2026-09-26: getDisplayValues() sobre la columna SNAPSHOT_ID de las 138 714 filas tarda
 * 31 s, y PP_listPlanSnapshots_ la pedia COMPLETA en cada carga del estado y otra vez despues de
 * CADA guardado. Ese era el costo que se veia como pausa en "Generar plan".
 *
 * EL ARREGLO NO ES RECORTAR FILAS, Y ESTE ARCHIVO ES LA PRUEBA DE QUE SIGUE SIENDO ASI. Ya se
 * intento una vez acortar por filas y cambio el resultado (ver la nota larga de PP_readMachineToolHistory_
 * en 02-storage.js y tests/plan-history-read.test.mjs). Lo que se hace aqui es lo contrario: se
 * cuenta TODO, pero las filas viejas salen de un conteo guardado y solo se leen de verdad las que
 * se agregaron desde la ultima vez. El resultado tiene que ser identico fila por fila.
 *
 * LO QUE ESTA FIJADO, Y POR QUE CADA CASO:
 *  1. Cold cache: sin conteo guardado, se lee entero. Sin esto, el primer arranque seria un
 *     resultado inventado.
 *  2. Incremental: la hoja crece y el conteo se actualiza SOLO con la cola. Se compara contra un
 *     conteo entero calculado aparte: tienen que coincidir snapshot por snapshot.
 *  3. La hoja NO crecio: no se lee nada. Este es el caso que paga los 31 s: entre un guardado y el
 *     siguiente, el estado cambio pero la hoja no.
 *  4. Filas borradas (getLastRow() bajo el conteo guardado): reconstruccion completa. deleteRow()
 *     desplaza todo, y "restar" filas no es posible sin saber cuantas habia de cada snapshot.
 *  5. Otra hoja u otra columna: reconstruccion completa, por getSheetId / indice de columna.
 *  6. El conteo se LEE con getValues(), no con getDisplayValues(). SNAPSHOT_ID se escribe como
 *     texto y sin formato, asi que el valor crudo es el mismo y no se paga el formateo de 138 714
 *     celdas.
 *  7. Si el conteo no cabe en el script cache, no se guarda a medias: se saca la clave.
 *  8. Si CacheService no existe o falla, se degrada a la lectura completa. Un fallo de cache
 *     cuesta 31 s; no puede costingar un error en getAppState.
 *  9. PP_deletePlanSnapshot_ tira la clave, porque borrar filas es lo unico que invalida el conteo.
 * 10. La lectura con getDisplayValues() de las 138 714 filas ya no esta en PP_listPlanSnapshots_.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const src = await readFile(new URL("../src/server/02-storage.js", import.meta.url), "utf8");

function extraer(nombre) {
  const i = src.search(new RegExp(`^function ${nombre}\\(`, "m"));
  assert.notEqual(i, -1, `no encontre ${nombre}`);
  const abre = src.indexOf("{", i);
  let nivel = 0, comillas = null;
  for (let k = abre; k < src.length; k += 1) {
    const c = src[k];
    if (comillas) { if (c === "\\") { k += 1; continue; } if (c === comillas) comillas = null; continue; }
    if (c === '"' || c === "'" || c === "`") { comillas = c; continue; }
    if (c === "{") nivel += 1;
    if (c === "}") { nivel -= 1; if (nivel === 0) return src.slice(i, k + 1); }
  }
  throw new Error(`sin cerrar en ${nombre}`);
}

const CONSTS = [
  "PP_PLAN_HISTORY_COUNTS_KEY_",
  "PP_PLAN_HISTORY_COUNTS_TTL_",
  "PP_PLAN_HISTORY_COUNTS_MAX_CHARS_",
].map((name) => {
  const found = src.match(new RegExp(`^const ${name} = .*$`, "m"));
  assert.ok(found, `no encontre la constante ${name}`);
  return found[0];
}).join("\n");

const FNS = [
  "PP_planHistoryCountsCache_",
  "PP_planHistorySheetId_",
  "PP_readPlanHistoryCountsCache_",
  "PP_writePlanHistoryCountsCache_",
  "PP_invalidatePlanHistoryCountsCache_",
  "PP_planHistorySnapshotCounts_",
].map(extraer).join("\n");

/** Cache de mentira con la misma superficie que usa el codigo: get / put / remove. */
function cacheFalso() {
  const store = new Map();
  return {
    store,
    get: (k) => (store.has(k) ? store.get(k) : null),
    put: (k, v) => { store.set(k, String(v)); },
    remove: (k) => { store.delete(k); },
  };
}

/**
 * Cuenta de verdad, con el metodo caro, para usarla de referencia. Es el resultado contra el que
 * se compara: si el camino incremental se aleja de aqui, hay un bug.
 */
function contarEntero(filas) {
  const counts = {};
  filas.forEach((fila) => {
    const id = String(fila[0] == null ? "" : fila[0]).trim();
    if (!id) return;
    counts[id] = (counts[id] || 0) + 1;
  });
  return counts;
}

/**
 * Los objetos que devuelve el codigo corriendo en la vm tienen el Object.prototype de ESE
 * contexto, y assert.deepEqual (que en modo strict es deepStrictEqual) compara el prototipo: dos
 * objetos con lo mismo escrito darian "not reference-equal". Se pasa todo por JSON para comparar
 * los DATOS, que es lo que importa.
 */
function plano(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function correr({ cache, filas, sheetId = 7, snapshotColEnHoja = 0, cacheService = true }) {
  const lecturas = [];
  const hoja = {
    getSheetId: () => sheetId,
    getLastRow: () => filas.length + 1,
    getLastColumn: () => 3,
    getRange(f, c, nf) {
      // Se anota el rango pedido SOLO si es la cola de datos (empieza en la fila 2 o después).
      // La lectura del encabezado (fila 1) no cuenta: son 3 celdas.
      if (f >= 2) lecturas.push({ desde: f, filas: nf, columna: c });
      const vals = [];
      for (let r = f; r < f + nf; r += 1) {
        if (r === 1) { vals.push(["SNAPSHOT_ID", "FECHA_GENERACION", "PLAN_INICIO"]); continue; }
        vals.push(filas[r - 2] || []);
      }
      return { getDisplayValues: () => vals, getValues: () => vals };
    },
  };
  const ctx = {
    console, JSON, Math, String, Number, Object, Array, isFinite, isNaN,
    CacheService: cacheService ? { getScriptCache: () => cache } : undefined,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(
    `${CONSTS}\n${FNS}\nthis.contar=function(sheet,col){return PP_planHistorySnapshotCounts_(sheet,col);};`,
    ctx,
  );
  return { counts: ctx.contar(hoja, snapshotColEnHoja), lecturas, hoja };
}

test("sin cache guardada, se lee la hoja ENTERA y el conteo es el entero", () => {
  const cache = cacheFalso();
  const filas = [["a"], ["a"], ["b"], ["a"], ["c"], ["b"]];
  const { counts, lecturas } = correr({ cache, filas });
  assert.deepEqual(plano(counts), contarEntero(filas));
  assert.equal(lecturas.length, 1, "una sola lectura, y entera");
  assert.equal(lecturas[0].desde, 2, "desde la primera fila de datos");
  assert.equal(lecturas[0].filas, filas.length, "las 6 filas, no un recorte");
  assert.ok(cache.store.size > 0, "y el conteo quedo guardado para la proxima");
});

test("la hoja CRECIO: solo se lee la cola y el conteo sigue siendo el entero", () => {
  // Este es el caso de "despues de guardar": la fila nueva se cuenta, las viejas salen del
  // conteo guardado. Si el resultado no es identico al conteo entero, el conteo guardado esta mal.
  const cache = cacheFalso();
  const antes = [["a"], ["a"], ["b"]];
  correr({ cache, filas: antes });
  const despues = [...antes, ["c"], ["c"], ["a"]];
  const { counts, lecturas } = correr({ cache, filas: despues });
  assert.deepEqual(plano(counts), contarEntero(despues), "a: 3, b: 1, c: 2. Igual que contando todo.");
  assert.equal(lecturas.length, 1);
  assert.equal(lecturas[0].desde, 2 + antes.length, "empieza DESPUES de la ultima fila ya contada");
  assert.equal(lecturas[0].filas, 3, "solo las 3 nuevas, no las 6");
});

test("variaciones seguidas de la hoja: el conteo nunca se desvía", () => {
  const cache = cacheFalso();
  const filas = [["a"], ["b"]];
  for (let i = 0; i < 20; i += 1) {
    filas.push([i % 2 ? "a" : "b"], ["nuevo-" + i]);
    const { counts } = correr({ cache, filas });
    assert.deepEqual(plano(counts), contarEntero(filas), `falla en la vuelta ${i}`);
  }
});

test("la hoja NO crecio: no se lee NADA (este es el caso que paga los 31 s)", () => {
  const cache = cacheFalso();
  const filas = [["a"], ["b"], ["c"]];
  correr({ cache, filas });
  const { counts, lecturas } = correr({ cache, filas: [...filas] });
  assert.deepEqual(plano(counts), contarEntero(filas));
  assert.equal(lecturas.length, 0, "cero lecturas: la hoja no cambio, no hay nada que contar");
});

test("borraron filas: reconstruccion COMPLETA, porque deleteRow() desplaza todo", () => {
  const cache = cacheFalso();
  const antes = [["a"], ["a"], ["b"], ["c"]];
  correr({ cache, filas: antes });
  // No se puede "restar" lo que se borro de 'a': no se sabe cuantas filas tenia cada snapshot.
  const despues = [["a"], ["c"]];
  const { counts, lecturas } = correr({ cache, filas: despues });
  assert.deepEqual(plano(counts), contarEntero(despues), "a: 1, c: 1. 'b' ya no esta.");
  assert.equal(lecturas.length, 1);
  assert.equal(lecturas[0].desde, 2, "vuelve a leer desde la primera fila, no desde donde iba");
  assert.equal(lecturas[0].filas, despues.length);
});

test("otra hoja o otra columna: reconstruccion COMPLETA", () => {
  // Mismo numero de filas y mismo conteo, pero de OTRA hoja: si se reusara el conteo, la hoja
  // nueva saldria con los numeros de la anterior. Es el caso de una hoja borrada y recreada.
  const cache = cacheFalso();
  const filas = [["a"], ["b"]];
  correr({ cache, filas, sheetId: 7 });
  const { counts, lecturas } = correr({ cache, filas: [["z"], ["z"], ["z"]], sheetId: 9 });
  assert.deepEqual(plano(counts), { z: 3 }, "los numeros son los de la hoja nueva, no los de la anterior");
  assert.equal(lecturas[0].desde, 2, "se leyo entera");

  const cache2 = cacheFalso();
  correr({ cache: cache2, filas, sheetId: 7, snapshotColEnHoja: 0 });
  const conCol = correr({ cache: cache2, filas: [["w"], ["w"]], sheetId: 7, snapshotColEnHoja: 1 });
  assert.deepEqual(plano(conCol.counts), { w: 2 }, "cambio de columna: reconstruye");
  assert.equal(conCol.lecturas[0].desde, 2);
});

test("la cola se lee con getValues(), NO con getDisplayValues()", () => {
  // El motivo es el costo, pero el valor tiene que ser el mismo. Este test fija las dos cosas: que
  // se llama getValues(), y que los SNAPSHOT_ID (texto escrito por PP_appendPlanSnapshot_, sin
  // formato de celda) salen identicos.
  const cache = cacheFalso();
  const filas = [["a-1"], ["b-1"], ["c-1"], ["a-2"]];
  const usadas = [];
  const sheet = {
    getSheetId: () => 3,
    getLastRow: () => filas.length + 1,
    getLastColumn: () => 3,
    getRange(f, c, nf) {
      const vals = [];
      for (let r = f; r < f + nf; r += 1) vals.push(r === 1 ? ["SNAPSHOT_ID"] : (filas[r - 2] || []));
      return {
        getValues: () => { usadas.push("getValues"); return vals; },
        getDisplayValues: () => { usadas.push("getDisplayValues"); return vals; },
      };
    },
  };
  const ctx = { console, JSON, Math, String, Number, Object, Array, Boolean, isFinite, isNaN, CacheService: { getScriptCache: () => cache } };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(`${CONSTS}\n${FNS}\nthis.correr=function(s,col){return PP_planHistorySnapshotCounts_(s,col);};`, ctx);
  const counts = ctx.correr(sheet, 0);
  assert.deepEqual(plano(counts), contarEntero(filas), "los valores son los mismos");
  assert.ok(usadas.includes("getValues"), "la cola se lee con getValues()");
  assert.ok(!usadas.includes("getDisplayValues"),
    "y NO con getDisplayValues(): formatear 138 714 celdas es justo lo que se esta evitando");
});

test("un conteo que no cabe NO se guarda a medias: se saca la clave y se recalcula", () => {
  const cache = cacheFalso();
  const filas = [];
  for (let i = 0; i < 4000; i += 1) filas.push(["snapshot-con-nombre-largo-" + i]);
  const { counts } = correr({ cache, filas });
  assert.equal(Object.keys(counts).length, 4000, "el conteo de esta corrida es correcto");
  assert.equal(cache.store.size, 0, "pero no se guardo nada, porque no cabia en el limite de CacheService");
  const segunda = correr({ cache, filas });
  assert.deepEqual(plano(segunda.counts), plano(counts), "y la siguiente tambien esta bien: recalcula, no adivina");
  assert.equal(segunda.lecturas[0].desde, 2, "desde el principio, porque no hay de donde continuar");
});

test("si CacheService falla, se degrada a la lectura COMPLETA y no se cae", () => {
  // El peor caso de perder la cache es 31 s. El peor caso de un error aqui es que getAppState
  // deje de responder, que es infinitamente peor.
  const cache = {
    get: () => { throw new Error("sin permiso"); },
    put: () => { throw new Error("sin permiso"); },
    remove: () => { throw new Error("sin permiso"); },
  };
  const filas = [["a"], ["a"], ["b"]];
  const { counts, lecturas } = correr({ cache, filas });
  assert.deepEqual(plano(counts), contarEntero(filas), "el resultado es el de siempre");
  assert.equal(lecturas.length, 1, "y se leyo la hoja entera");
});

test("sin CacheService en el entorno, tambien funciona (solo mas lento)", () => {
  const filas = [["a"], ["b"], ["a"]];
  const { counts, lecturas } = correr({ cache: cacheFalso(), filas, cacheService: false });
  assert.deepEqual(plano(counts), contarEntero(filas));
  assert.equal(lecturas.length, 1);
});

test("un conteo guardado CORRUPTO se descarta, no se mezcla con la hoja", () => {
  const cache = cacheFalso();
  cache.put("PP_PLAN_HISTORY_COUNTS_V1", "{no es json");
  const filas = [["a"], ["a"], ["b"]];
  const { counts, lecturas } = correr({ cache, filas });
  assert.deepEqual(plano(counts), contarEntero(filas));
  assert.equal(lecturas[0].desde, 2, "se reconstruyo desde el principio");
});

test("PP_deletePlanSnapshot_ tira la clave de la cache, porque borrar invalida el conteo", () => {
  // Sin esto, borrar 40 filas de un snapshot y anexar 40 de otro podria dejar el conteo guardado
  // apuntando a la fila equivocada sin que nada lo note.
  const borrar = src.slice(src.indexOf("function PP_deletePlanSnapshot_("), src.indexOf("function PP_clearDraftSnapshot_("));
  assert.match(borrar, /PP_invalidatePlanHistoryCountsCache_\(\);/,
    "el unico escritor que borra filas de PLANES_HISTORICOS tiene que invalidar el conteo");
  assert.match(borrar, /if \(borro && sheetName === 'PLANES_HISTORICOS'\)/,
    "y solo cuando la hoja afectada es PLANES_HISTORICOS: BORRADOR_PLAN no se cuenta aqui");
  // El borrado bulk usa deleteRows (una llamada por bloque), no deleteRow (una por fila).
  // Con 138 715 filas, deleteRow por fila son ~277 000 llamadas: no cabe en 6 min de Apps Script.
  assert.match(borrar, /sheet\.deleteRows\(i \+ 2, cuenta\)/,
    "debe borrar bloques contiguos con deleteRows, no fila por fila con deleteRow");
  assert.doesNotMatch(borrar, /sheet\.deleteRow\(/,
    "deleteRow por fila es O(filas) y no cabe en el limite de 6 min de Apps Script");
  // Una sola lectura de la columna entera, no una por fila.
  assert.match(borrar, /sheet\.getRange\(2, colIndex \+ 1, lastRow - 1, 1\)\.getValues\(\)/,
    "debe leer la columna SNAPSHOT_ID entera en una llamada");
});

test("PP_readRowsCols_ usa getValues() y no getDisplayValues() para las columnas de datos", () => {
  // PP_readMachineToolHistory_ lee 8 columnas de las 139 876 filas de PLANES_HISTORICOS en
  // cada rebuild frío del estado. getDisplayValues() formatea cada celda: en 139 876 celdas
  // por columna eso son segundos por columna. Las columnas son texto plano escrito por el
  // servidor (SNAPSHOT_ID, NUM, OT, MAQ_AREA, HERRAMENTAL, KIT_HERRAMENTAL, F_FIN, H_FIN),
  // sin formato de celda que getDisplayValues pueda convertir a otra cosa.
  const leer = extraer("PP_readRowsCols_");
  assert.match(leer, /getRange\(2, index \+ 1, total, 1\)\.getValues\(\)/,
    "las columnas de datos se leen con getValues(), sin formatear 139 876 celdas por columna");
  assert.doesNotMatch(leer, /getRange\(2, index \+ 1, total, 1\)\.getDisplayValues\(\)/,
    "getDisplayValues() por columna es el costo que hace que el rebuild frío supere los 120 s");
});

test("PP_listPlanSnapshots_ ya no pide la columna entera de datos con getDisplayValues()", () => {
  const listar = extraer("PP_listPlanSnapshots_");
  // La lectura cara era exactamente esta: getRange(2, col, LASTROW-1, 1).getDisplayValues() sobre
  // las 138 714 filas. No puede volver a estar en esta funcion, ni con otro nombre de variable.
  assert.doesNotMatch(listar, /getRange\(2, snapshotCol \+ 1, historySheet\.getLastRow\(\) - 1, 1\)/,
    "la lectura de 31 s no puede volver a estar dentro de PP_listPlanSnapshots_");
  assert.match(listar, /PP_planHistorySnapshotCounts_\(historySheet, snapshotCol\)/);
  // Y el conteo se asigna, no se acumula fila por fila: si volviera a haber un bucle sobre filas,
  // estariamos otra vez pagando por cada celda.
  assert.match(listar, /grouped\[snapshotId\]\.operations = counts\[snapshotId\];/);
  // La cabecera SI se lee con getDisplayValues(), y son 3 celdas: ahi no hay nada que optimizar y
  // el texto del encabezado si conviene compararlo como se ve.
  assert.match(listar, /getRange\(1, 1, 1, historySheet\.getLastColumn\(\)\)\.getDisplayValues\(\)/);
});
