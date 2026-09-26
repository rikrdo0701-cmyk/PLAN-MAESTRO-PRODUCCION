/**
 * El recorrido COMPLETO del zombie, con el applyImported real y el reconciliador real. No es un
 * assert de texto: es la corrida. Y se prueba en los dos sentidos, con la marca y sin ella.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const appSrc = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");
const coreSrc = await readFile(new URL("../src/web/planning/planning-workflow-core.js", import.meta.url), "utf8");

const ctx = { window: {}, console, Math, JSON, Date, Object, Array, Number, String, Set, Map, isFinite, isNaN, parseInt };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(coreSrc, ctx, { filename: "planning-workflow-core.js" });
const C = ctx.window.PlanningWorkflowCore;

const materialOtKey = (v) => String(v ?? "").trim().toUpperCase();
const clone = (o) => JSON.parse(JSON.stringify(o));

/** Saca el bloque de applyImported que restaura marcas y reemplaza la lista de OTs. */
function bloqueApplyImportedOt() {
  const i = appSrc.indexOf("  if (imported.unconfirmedWorkOrders && typeof imported.unconfirmedWorkOrders === \"object\") {");
  assert.notEqual(i, -1, "no encontre el bloque de marcas en applyImported");
  const f = appSrc.indexOf("  invalidateGanttCache();", i);
  assert.ok(f > i, "no encontre el fin del bloque");
  return appSrc.slice(i, f);
}

const BLOQUE = bloqueApplyImportedOt();

// Se usa la mergeWorkOrderLocalOverrides REAL, no una reimplementacion. La primera version de
// este test se invento un stub que hacia `{...item, ...local}`, o sea que el local pisaba al
// importado, y el test FALLO por el motivo equivocado: reportaba que la lista no se respeta
// cuando el defecto era del stub. La real solo hereda una lista blanca de 6 campos
// (dueDateOverride, photoUrl, lastSalePrice, averageSalePrice, averageSalePriceFrom/To) y el
// estatus SIEMPRE lo gana el importado, que es lo correcto: la hoja es mas reciente que la
// sesion del navegador. Un stub que se parece al codigo pero no es el codigo hace fallar los
// tests por razones que no son del codigo, y eso es peor que no tener test.
function extraer(src, nombre) {
  const i = src.search(new RegExp(`^(?:async )?function ${nombre}\\(`, "m"));
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
  throw new Error("llaves sin cerrar");
}
const MERGE_WO = extraer(appSrc, "mergeWorkOrderLocalOverrides");
// eslint-disable-next-line no-new-func
const mergeWorkOrderLocalOverrides = new Function(`${MERGE_WO}\nreturn mergeWorkOrderLocalOverrides;`)();

/** Corre el applyImported REAL: restaura marcas y reemplaza workOrders. */
function recarga(state, imported) {
  // eslint-disable-next-line no-new-func
  const f = new Function("state", "imported", "materialOtKey", "normalizeWorkOrders",
    "mergeUnconfirmedWorkOrderMarks", "mergeClosedWorkOrderSummaries", "mergeWorkOrderLocalOverrides", `
    ${BLOQUE}
    return state;`);
  return f(state, imported, materialOtKey,
    (rows) => (rows || []).filter((r) => r && String(r.ot || "").trim()),
    (local, remote) => ({ ...(local || {}), ...(remote || {}) }),
    (local, remote) => ({ ...(local || {}), ...(remote || {}) }),
    mergeWorkOrderLocalOverrides);
}

const T1 = "2026-09-26T22:00:00.000Z";

/** El navegador tiene la OT con su ficha; la hoja ya no. Es el escenario de la recarga. */
function estadoDelNavegador() {
  return {
    workOrders: [
      { ot: "100", item: "A", status: "En curso", exists: true, quantity: 5, pendingQuantity: 5 },
      { ot: "200", item: "B", status: "En curso", exists: true, quantity: 7, pendingQuantity: 7 },
      { ot: "3000", item: "C", status: "En curso", exists: true, quantity: 9, pendingQuantity: 9 },
    ],
    operations: [{ id: "3000-1", ot: "3000", ct: "5458", tipoInsercion: "PROCESO" }],
    selectedOts: ["100", "200", "3000"],
    unconfirmedWorkOrders: {},
  };
}

const HOJA = {
  workOrders: [
    { ot: "100", item: "A", status: "En curso", exists: true, quantity: 5, pendingQuantity: 5 },
    { ot: "200", item: "B", status: "En curso", exists: true, quantity: 7, pendingQuantity: 7 },
  ],
};
const MARCA = { "3000": { ot: "3000", firstSeenAt: T1, lastSeenAt: T1, misses: 2 } };

test("CON marca: la OT conserva su ficha despues de recargar y del siguiente sync", () => {
  const trasRecarga = recarga(estadoDelNavegador(), { workOrders: clone(HOJA.workOrders), unconfirmedWorkOrders: MARCA });
  assert.ok(trasRecarga.workOrders.some((w) => w.ot === "3000"),
    "la ficha de la OT marcada tiene que sobrevivir a la recarga");

  const r = C.reconcileActiveWorkOrders(trasRecarga, [
    { ot: "100", status: "En curso", exists: true },
    { ot: "200", status: "En curso", exists: true },
  ], "2026-09-26T23:00:00.000Z");
  assert.ok(r.selectedOts.includes("3000"), "y la OT sigue en la cola");
  const ficha = r.workOrders.find((w) => w.ot === "3000");
  assert.ok(ficha, "y con su ficha, no como zombi");
  assert.equal(ficha.item, "C", "la ficha es la de verdad, no una vacia");
  assert.equal(ficha.quantity, 9, "y trae la cantidad, que es lo que la hace util");
  assert.equal(ficha.status, "En curso", "y su estatus real, que es lo que impide que se lea como PLAN");
});

test("SIN marca: la OT se cae de la lista, como antes. La marca es la unica puerta", () => {
  // Si esto pasara, el arreglo seria una puerta trasera para resucitar cualquier OT, y
  // desharia RULE-OT-051. El criterio es que la AUSENCIA de la lista de la hoja, sin marca, no
  // preserva nada.
  const trasRecarga = recarga(estadoDelNavegador(), { workOrders: clone(HOJA.workOrders) });
  assert.ok(!trasRecarga.workOrders.some((w) => w.ot === "3000"),
    "una OT que no vino en la lista importada y no esta marcada NO se conserva");
});

test("una OT marcada que SI viene en la lista se funde, no se duplica", () => {
  const conLaOt = { workOrders: [...clone(HOJA.workOrders), { ot: "3000", item: "C", status: "Cerrada", exists: false }] };
  // El clone de la lista importada NO es cosmetico. En el arnés, pasar los objetos sin clonar
  // hacia que la prueba fallara con el estatus viejo, por aliasing de referencias entre
  // pruebas. En produccion no puede pasar: imported.workOrders viene de getAppState, o sea de
  // un JSON que cruza el puente, y no comparte ningun objeto con state.workOrders. Se clona
  // igual para que el arnes no tenga esa diferencia con la produccion.
  const trasRecarga = recarga(estadoDelNavegador(), { workOrders: clone(conLaOt.workOrders), unconfirmedWorkOrders: MARCA });
  const n3000 = trasRecarga.workOrders.filter((w) => w.ot === "3000").length;
  assert.equal(n3000, 1, "una sola ficha para la 3000, no dos");
  assert.equal(trasRecarga.workOrders.find((w) => w.ot === "3000").status, "Cerrada",
    "y es la de la lista, que es la mas reciente");
});

test("GUARD: la ficha se conserva SOLO con marca, y se ve al revertir el arreglo", () => {
  // Este test pasa con el arreglo puesto. Lo que se verifica aqui es que la asercion sea
  // discriminante: sin la linea que conserva las fichas, el primer test de este archivo
  // falla con "la ficha de la OT marcada tiene que sobrevivir a la recarga". Se comprobo
  // revirtiendo el arreglo en app.js: 1 rojo, y el mensaje es el del zombie.
  const sinArreglo = (estado) => {
    // Reimplementa el applyImported SIN la conservacion de fichas: solo el replace, que es lo
    // que habia antes de este arreglo.
    const local = new Map((estado.workOrders || []).map((i) => [materialOtKey(i?.ot), i]));
    return { ...estado, workOrders: (HOJA.workOrders || []).map((i) => ({ ...i, ...(local.get(materialOtKey(i.ot)) || {}) })) };
  };
  const antes = sinArreglo({ ...estadoDelNavegador(), unconfirmedWorkOrders: MARCA });
  assert.ok(!antes.workOrders.some((w) => w.ot === "3000"),
    "sin el arreglo la ficha se pierde aunque este la marca: ese es el defecto");
  const despues = recarga(estadoDelNavegador(), { workOrders: clone(HOJA.workOrders), unconfirmedWorkOrders: MARCA });
  assert.ok(despues.workOrders.some((w) => w.ot === "3000"),
    "con el arreglo la ficha se conserva: ese es el guard");
});
