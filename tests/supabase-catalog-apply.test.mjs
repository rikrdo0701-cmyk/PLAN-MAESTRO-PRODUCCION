// Tests de la PUERTA de arranque de Supabase: las dos piezas que hacen que el
// estado de la pagina venga de Supabase y no del puente de Apps Script.
//
// QUE SE PRUEBA, Y POR QUE SON DOS PIEZAS:
//
//  A) supabase-catalog-apply.js arma UN objeto con todo lo leido y se lo pasa a
//     `aplicarEstadoDesdeSupabase`. No escribe `root.state`.
//
//  B) La puerta de app.js (el bloque marcado con PP-APPLY-DESDE-SUPABASE) mete ese
//     objeto por `applyImported` con preserveLocalPlanning en false, y pone los
//     cuatro campos que applyImported no mapea.
//
// POR QUE B SE PRUEBA LEYENDO EL CODIGO FUENTE Y NO UNA COPIA. La puerta vive
// dentro de app.js, que necesita el DOM entero para cargarse. El bloque marcado es
// el contrato entre las dos piezas: si alguien lo mueve o le cambia el nombre, este
// test falla en vez de que el arranque se quede escribiendo en un objeto fantasma.
//
// EL FALLO QUE ESTA DETRAS DE TODO, MEDIDO 2026-09-29. El apply hacia
// `root.state = {...}` sobre un `let state` de primer nivel, que NO es propiedad de
// window. La pagina no cambiaba y no habia ningun error. El primer test de A es el
// que cierra esa puerta.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const APLICACION = readFileSync(new URL("../src/web/shared/supabase-catalog-apply.js", import.meta.url), "utf8");
const APP = readFileSync(new URL("../src/web/planning/app.js", import.meta.url), "utf8");

/** El bloque real de la puerta, sacado de app.js entre los dos centinelas. */
function bloquePuerta() {
  const desde = APP.indexOf("/* PP-APPLY-DESDE-SUPABASE:INICIO */");
  const hasta = APP.indexOf("/* PP-APPLY-DESDE-SUPABASE:FIN */");
  assert.ok(desde >= 0 && hasta > desde, "app.js tiene que conservar el bloque PP-APPLY-DESDE-SUPABASE: la puerta no se movio");
  return APP.slice(desde, hasta);
}

/**
 * Corre la puerta de verdad. `state` y el `applyImported` de mentira se declaran en
 * el PRIMER NIVEL del script del vm, igual que en app.js: eso es lo que hace que
 * `state` sea invisible para `ctx.state` y lo que obliga a la puerta a tocarlo por el
 * identificador. El applyImported de aqui imita las lineas del de app.js que importan,
 * incluido el `else if (!preserveLocalPlanning) state.excludedCapabilities = []`.
 */
function correrPuerta(entrada) {
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    Promise, JSON, Date, Math, String, Number, Object, Array, Error, Boolean, Set, Map,
    render: (o) => { ctx.renderCon = o; },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(
    [
      "let state = { operations: ['viejo'], excludedCapabilities: ['CT-1'], savedAt: 'ayer', otTypes: [{ id: 'viejo' }] };",
      "globalThis.__state = () => state;",
      "async function applyImported(importado, opciones) {",
      "  globalThis.__opciones = opciones;",
      "  globalThis.__entradaRecibida = importado;",
      "  if (Array.isArray(importado.operations)) state.operations = importado.operations;",
      "  if (Array.isArray(importado.materials)) state.materials = importado.materials;",
      "  if (importado.operators) state.operators = importado.operators;",
      "  if (Number.isFinite(Number(importado.revision))) state.revision = Number(importado.revision);",
      "  if (importado.planStart) state.planStart = importado.planStart;",
      "  if (importado.settings) state.settings = importado.settings;",
      "  if (Array.isArray(importado.excludedCapabilities)) state.excludedCapabilities = importado.excludedCapabilities;",
      "  else if (!opciones.preserveLocalPlanning) state.excludedCapabilities = [];",
      "}",
      bloquePuerta(),
      "globalThis.__puerta = aplicarEstadoDesdeSupabase;",
    ].join("\n"),
    ctx,
  );
  return ctx.__puerta(entrada).then((r) => ({ r, ctx }));
}

// ---------------------------------------------------------------------------
// A) El modulo de aplicacion
// ---------------------------------------------------------------------------

function crearCtx({ boot = {}, puerta = true } = {}) {
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, Promise, JSON, Date, Math, String, Number, Object, Array, Error, RegExp, Boolean,
    addEventListener() {},
    document: { readyState: "complete", getElementById: () => null, createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }), head: { appendChild() {} }, body: { appendChild() {} } },
    PPCatalogBoot: {
      correr: async () => Object.assign({ activo: true, fallo: null, catalogs: boot.catalogs || {}, ms: 1, viejo: {}, vacias: [] }, boot),
      aviso: () => false,
    },
    PPSupabaseWriter: {
      armarCatalogos: (estado) => ({
        tools: { claves: Object.fromEntries((estado.toolCatalog || []).map((i) => [i.id, true])) },
        calendar_exceptions: { claves: Object.fromEntries((estado.calendarExceptions || []).map((i) => [[i.startDate, i.concept, i.machine].join("|"), true])) },
      }),
    },
    async aplicarEstadoDesdeSupabase(entrada) {
      ctx.entrada = entrada;
      return { aplicado: true, claves: Object.keys(entrada) };
    },
  };
  // El modulo se instala solo al cargarse (document.readyState "complete"), y esa
  // primera corrida es la que esta en vuelo cuando el test llama a aplicarUnaVez.
  // Por eso el fallo se declara aqui y no despues: si se cambia despues, el test
  // estaria mirando el resultado de la corrida buena.
  if (!puerta) delete ctx.aplicarEstadoDesdeSupabase;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(APLICACION, ctx);
  return ctx;
}

test("el apply NO escribe root.state: pasa todo por la puerta de app.js", async () => {
  // El fallo medido el 2026-09-29. `state` es un `let` de primer nivel de app.js, o
  // sea que NO existe como propiedad de window: escribir ahi era escribir en un
  // objeto que nadie lee, y la pagina se quedaba con los valores de muestra.
  const ctx = crearCtx({ boot: { catalogs: { operators: ["A"] }, operations: [{ id: "s" }] } });
  const r = await ctx.PPCatalogApply.aplicarUnaVez();
  assert.equal(r.aplicado, true);
  assert.equal(ctx.state, undefined, "no se puede crear un 'state' global desde el apply");
  assert.ok(ctx.entrada, "se llamo a aplicarEstadoDesdeSupabase");
  assert.deepEqual([...ctx.entrada.operators], ["A"], "los catalogos van en el objeto de entrada");
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.entrada.operations)), [{ id: "s" }], "el plan va en el MISMO objeto");
});

test("el apply sale SIN APLICAR si app.js no expone la puerta", async () => {
  const ctx = crearCtx({ boot: { catalogs: { operators: ["A"] } }, puerta: false });
  const r = await ctx.PPCatalogApply.aplicarUnaVez();
  assert.equal(r.aplicado, false, "no se finge que se aplico");
  assert.match(String(r.motivo), /aplicarEstadoDesdeSupabase/);
});

test("undefined NO se pasa: lo que el lector no trajo no se toca", async () => {
  const ctx = crearCtx({ boot: { catalogs: { operators: ["A"] }, selectedOts: undefined, lockedOts: undefined, operationPlanStatuses: undefined } });
  await ctx.PPCatalogApply.aplicarUnaVez();
  assert.equal("selectedOts" in ctx.entrada, false, "sin fallback: la clave ni se pone");
  assert.equal("lockedOts" in ctx.entrada, false);
  assert.equal("operationPlanStatuses" in ctx.entrada, false);
});

test("una cola VACIA si se pasa: 'no hay' es informacion real", async () => {
  const ctx = crearCtx({ boot: { catalogs: {}, selectedOts: [], lockedOts: [], operationPlanStatuses: {} } });
  await ctx.PPCatalogApply.aplicarUnaVez();
  assert.deepEqual([...ctx.entrada.selectedOts], [], "array vacio se pasa");
  assert.deepEqual(ctx.entrada.operationPlanStatuses, {}, "objeto vacio se pasa");
});

test("si la lectura falla, no se aplica nada", async () => {
  const ctx = crearCtx({ boot: { fallo: "red caida", catalogs: null } });
  const r = await ctx.PPCatalogApply.aplicarUnaVez();
  assert.equal(r.aplicado, false);
  assert.equal(ctx.entrada, undefined, "no se llamo a la puerta");
});

test("las claves leidas las calcula el ESCRITOR, no una copia de la regla", async () => {
  // Si el apply tuviera su propia version de la clave natural, el primer cambio de
  // nombre de columna las separaria y el borrado de "lo que quito la persona" dejaria
  // de funcionar en silencio.
  const ctx = crearCtx({ boot: { catalogs: { toolCatalog: [{ id: "T1" }, { id: "T2" }] } } });
  await ctx.PPCatalogApply.aplicarUnaVez();
  assert.deepEqual(ctx.PPCatalogApply.claves.tools, ["T1", "T2"]);
});

// ---------------------------------------------------------------------------
// B) La puerta de app.js
// ---------------------------------------------------------------------------

test("la puerta aplica con preserveLocalPlanning en FALSE (Supabase gana al localStorage)", async () => {
  const { r, ctx } = await correrPuerta({ operations: [{ id: "s" }] });
  assert.equal(ctx.__opciones.preserveLocalPlanning, false, "con true, el borrador local le gana a la base");
  assert.equal(r.aplicado, true);
});

test("la puerta NO borra excludedCapabilities, que el lector no trae", async () => {
  // applyImported, con preserveLocalPlanning en false, hace
  // `else if (!preserveLocalPlanning) state.excludedCapabilities = []`. Sin esto, cada
  // arranque borraria una decision de la persona.
  const { ctx } = await correrPuerta({ operations: [] });
  assert.deepEqual([...ctx.__state().excludedCapabilities], ["CT-1"]);
});

test("la puerta pone los cuatro campos que applyImported no mapea", async () => {
  const { ctx } = await correrPuerta({
    savedAt: "2026-09-29T10:00:00.000Z",
    syncedAt: "2026-09-29T09:00:00.000Z",
    reportFilters: { planta: "MONTERREY" },
    otTypes: [{ id: "tipo-1", name: "PROD" }],
  });
  const s = ctx.__state();
  assert.equal(s.savedAt, "2026-09-29T10:00:00.000Z");
  assert.equal(s.syncedAt, "2026-09-29T09:00:00.000Z");
  assert.deepEqual(s.reportFilters, { planta: "MONTERREY" });
  assert.deepEqual(JSON.parse(JSON.stringify(s.otTypes)), [{ id: "tipo-1", name: "PROD" }]);
});

test("la puerta NO inventa los campos que no llegaron", async () => {
  const { ctx } = await correrPuerta({ operations: [] });
  const s = ctx.__state();
  assert.equal(s.otTypes[0].id, "viejo", "sin datos de Supabase, el estado se queda como estaba");
  assert.equal(s.savedAt, "ayer");
});

test("la puerta pinta una vez, sin guardar", async () => {
  const { ctx } = await correrPuerta({ operations: [] });
  // El objeto es del realm del vm, asi que se compara por su forma y no por prototipo.
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.renderCon)), { save: false });
});
