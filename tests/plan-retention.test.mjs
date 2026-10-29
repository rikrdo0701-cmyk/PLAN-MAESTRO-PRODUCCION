/**
 * Retención por antigüedad de los planes publicados. Decisión de la persona (2026-09-27):
 * "si ya pasó 1 mes desde que se generó se puede borrar", apoyándose en `generatedAt`.
 *
 * ESTA ES UNA FUNCIÓN QUE BORRA. Por eso los tests se concentran en lo que NO debe borrar, que es
 * donde está el daño irreversible:
 *   - el borrador, nunca;
 *   - el snapshot más reciente, nunca, aunque sea viejo;
 *   - un snapshot sin fecha, nunca, y además se reporta en vez de ignorarse en silencio;
 *   - nada cuando dryRun, aunque la antigüedad se cumpla;
 *   - y nada con un `maxAgeDays` inválido, porque "borrar todo porque no me dijeron cuántos días"
 *     es la peor respuesta posible a una pregunta mal hecha.
 *
 * Y un test de que el borrado falla ruidosamente: `PP_deletePlanSnapshot_` va SIN catch, a
 * propósito, para no repetir el agujero de la poda anterior (85 snapshots de una semana y un
 * `catch (ignored) {}` que se tragaba el error).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const src = await readFile(new URL("../src/server/05-publishing-service.js", import.meta.url), "utf8");

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

const FN = extraer("PP_pruneOldPlanSnapshots_");

/** deepStrictEqual falla entre contextos de vm (prototipo distinto). Se compara por JSON. */
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const DIA = 24 * 60 * 60 * 1000;
const HOY = Date.parse("2026-09-27T12:00:00.000Z");
const hace = (d) => new Date(HOY - d * DIA).toISOString();

/** snapshots: [{id, fecha|null, ops, weekStart}] */
function correr({ snapshots, maxAgeDays, dryRun, keepSnapshotIds, ahora, deleteFalla }) {
  const borrados = [];
  // Date real con `now` parcheado: la funcion usa `new Date(corte).toISOString()`, asi que hace
  // falta un constructor de verdad, no un objeto con now y parse.
  const Fecha = class extends Date {
    constructor(...args) { return args.length ? new Date(...args) : new Date(HOY); }
    static now() { return HOY; }
  };
  const ctx = {
    console, JSON, Math, String, Number, Object, Array, isFinite, isNaN, Date: Fecha,
    PP_listPlanSnapshots_: () => snapshots.map((s) => ({
      snapshotId: s.id,
      generatedAt: s.fecha === null ? "" : s.fecha,
      weekStart: s.weekStart || "",
      operations: s.ops || 0,
    })),
    PP_deletePlanSnapshot_: (hoja, id) => {
      if (deleteFalla && deleteFalla === id) throw new Error("No se pudo borrar " + id);
      // SE REGISTRA SIEMPRE, sin mirar el dryRun. La primera version del arnes hacia
      // `if (!dryRun) borrados.push(id)`, o sea que el MOCK respetaba el dryRun por su cuenta: si
      // el codigo de produccion llamaba a borrar en simulacion, el mock no lo anotaba y el test
      // pasaba. Una mutacion que hacia que dryRun BORRARA de verdad salia verde. Un arnes que
      // protege al codigo de ser probado no sirve para probar al codigo.
      borrados.push(id);
    },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(`${FN}\nthis.run=PP_pruneOldPlanSnapshots_;`, ctx);
  return { r: ctx.run({}, maxAgeDays, { dryRun, keepSnapshotIds, nowMs: ahora || HOY }), borrados };
}

const SNP = [
  { id: "draft", fecha: null, ops: 1403, weekStart: "2026-09-07" },
  { id: "reciente", fecha: hace(2), ops: 1400 },
  { id: "hace-20d", fecha: hace(20), ops: 1400 },
  { id: "hace-45d", fecha: hace(45), ops: 1400 },
  { id: "hace-100d", fecha: hace(100), ops: 1400 },
  { id: "sin-fecha", fecha: null, ops: 1400, weekStart: "" },
];

test("con corte de 30 dias borra SOLO lo que lo cumple, y protege el borrador y el mas reciente", () => {
  const { r, borrados } = correr({ snapshots: SNP, maxAgeDays: 30 });
  assert.deepEqual(borrados.sort(), ["hace-100d", "hace-45d"],
    "borra los de mas de 30 dias y nada mas");
  assert.ok(!borrados.includes("draft"), "el borrador NUNCA se borra");
  assert.ok(!borrados.includes("reciente"), "ni el mas reciente");
  assert.ok(!borrados.includes("hace-20d"), "ni uno de 20 dias, que no cumple el corte");
  assert.ok(!borrados.includes("sin-fecha"), "ni el que no tiene fecha");
  assert.equal(r.filasLiberadas, 2800, "y dice cuantas filas libera");
  assert.equal(r.sinFecha.length, 1, "el sin fecha se reporta aparte, no se ignora");
  assert.equal(r.sinFecha[0].snapshotId, "sin-fecha");
  assert.equal(r.protegidos.length, 1, "el mas reciente queda en protegidos");
  assert.equal(r.protegidos[0].snapshotId, "reciente");
  assert.equal(r.borrados[0].edadDias >= 45, true, "y dice cuantos dias tiene cada uno");
});

test("EL BORRADOR: ni por antigüedad, ni aunque se le ponga una fecha vieja", () => {
  // El caso mas peligroso: un borrador con fecha de hace un año. Si la guarda del borrador se
  // puede saltar por la antigüedad, se pierde el plan en curso.
  const { borrados } = correr({
    snapshots: [
      { id: "draft", fecha: hace(400), ops: 1403 },
      { id: "viejo", fecha: hace(400), ops: 10 },
    ],
    maxAgeDays: 30,
  });
  assert.deepEqual(borrados, ["viejo"], "el borrador se queda aunque tenga 400 dias");
});

test("el mas reciente se protege AUNQUE sea viejo, y solo si tiene fecha", () => {
  // a tiene 200 dias, b 300, c 400: el MAS RECIENTE es a (menos dias = mas nuevo).
  const { r, borrados } = correr({
    snapshots: [
      { id: "a", fecha: hace(200), ops: 5 },
      { id: "b", fecha: hace(300), ops: 5 },
      { id: "c", fecha: hace(400), ops: 5 },
    ],
    maxAgeDays: 30,
  });
  assert.ok(borrados.includes("b") && borrados.includes("c"), "los otros dos si se borran");
  assert.ok(!borrados.includes("a"), "el mas reciente por fecha no, aunque tenga 200 dias");
  assert.equal(r.protegidos.length, 1);
  assert.equal(r.protegidos[0].snapshotId, "a");
});

test("un snapshot SIN fecha NO se borra, y sale en sinFecha para que lo decida la persona", () => {
  // Ponerle "hoy" a un plan del que no se sabe cuando se hizo haria que un corte por antiguedad
  // borrara el equivocado. La ausencia de fecha no es evidencia de antiguedad, igual que en
  // RULE-OT-051 la ausencia en un payload no era evidencia de cierre.
  const { r, borrados } = correr({
    snapshots: [
      { id: "mas-nuevo", fecha: hace(3), ops: 5 },
      { id: "con-fecha", fecha: hace(100), ops: 5 },
      { id: "sin-fecha", fecha: null, ops: 900, weekStart: "" },
    ],
    maxAgeDays: 30,
  });
  assert.deepEqual(borrados, ["con-fecha"], "el unico que cumple el corte y no esta protegido");
  assert.equal(r.sinFecha.length, 1);
  assert.equal(r.sinFecha[0].snapshotId, "sin-fecha");
  assert.equal(r.sinFecha[0].operations, 900, "y dice cuantas filas tiene, para pesar el costo de dejarlo");
  assert.match(r.mensaje, /SIN FECHA .*: 1/);
});

test("dryRun: calcula todo y NO borra nada", () => {
  const { r, borrados } = correr({ snapshots: SNP, maxAgeDays: 30, dryRun: true });
  assert.deepEqual(borrados, [], "no se borra nada");
  assert.equal(r.dryRun, true);
  assert.equal(r.borrados.length, 2, "pero dice cuantos BORRARIA");
  assert.equal(r.filasLiberadas, 2800, "y cuantas filas liberaria");
  assert.match(r.mensaje, /SIMULACION/);
  // Las cubetas cuentan TODOS los que tienen fecha, protegidos incluidos. Si contaran solo los
  // evaluados, diria 1 cuando hay 2, y el diagnostico miente por omision.
  assert.ok(igual(r.cubetas['0-30 dias'], { snapshots: 2, filas: 2800 }), 'incluye el mas reciente, que esta protegido');
  assert.ok(igual(r.cubetas['31-60 dias'], { snapshots: 1, filas: 1400 }));
  assert.ok(igual(r.cubetas['mas de 90 dias'], { snapshots: 1, filas: 1400 }));
  assert.ok(igual(r.cubetas['sin fecha'], { snapshots: 1, filas: 1400 }));
  assert.equal(r.cubetas['61-90 dias'].snapshots, 0, 'una cubeta vacia se reporta en cero, no se omite');
});

test("maxAgeDays invalido NO borra nada y avisa", () => {
  for (const malo of [0, -5, "abc", "", null, undefined, NaN]) {
    assert.throws(() => correr({ snapshots: SNP, maxAgeDays: malo }),
      /maxAgeDays/, `un valor invalido (${String(malo)}) tiene que fallar, no borrar`);
  }
});

test("si un borrado falla, el error SUBE: no se traga", () => {
  // El fallo exacto que hizo la poda anterior: 85 snapshots de una semana y un catch (ignored)
  // que se comio el error, sin que nadie se enterara. Aqui no hay catch a proposito.
  assert.throws(() => correr({ snapshots: SNP, maxAgeDays: 30, deleteFalla: "hace-45d" }),
    /No se pudo borrar/);
});

test("keepSnapshotIds protege lo que se le pase, ademas del mas reciente", () => {
  // c es el MAS RECIENTE (10 dias), a y b son viejos. Se pide proteger b ademas.
  const { borrados, r } = correr({
    snapshots: [
      { id: "a", fecha: hace(200), ops: 5 },
      { id: "b", fecha: hace(150), ops: 5 },
      { id: "c", fecha: hace(10), ops: 5 },
    ],
    maxAgeDays: 30,
    keepSnapshotIds: ["b"],
  });
  assert.deepEqual(borrados, ["a"], "a si se borra; b esta protegido porKeep y c por ser el mas reciente");
  assert.equal(r.protegidos.length, 2, "los dos protegidos aparecen en el reporte");
  assert.ok(r.protegidos.some((x) => x.snapshotId === "b"));
  assert.ok(r.protegidos.some((x) => x.snapshotId === "c"));
});

test("lista vacia: no borra nada y no se cae", () => {
  const { r, borrados } = correr({ snapshots: [], maxAgeDays: 30 });
  assert.deepEqual(borrados, []);
  assert.equal(r.evaluados, 0);
  assert.match(r.mensaje, /Se evaluaron 0 snapshots/);
});
