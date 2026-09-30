// Tests de supabase-catalog-apply.js: que aplique operations, workOrders y
// materials de Supabase encima del estado, DESPUES de que el puente cargue.
//
// LO QUE SE PRUEBA:
//  1. operations/workOrders/materials se aplican cuando Supabase los trae.
//  2. Si Supabase no trae datos (undefined), NO se borra lo del puente.
//  3. Si Supabase trae arrays vacios, se aplican (significa "no hay").
//  4. Los catálogos se siguen aplicando igual.
//  5. El orden: primero el puente, despues Supabase.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const apply = readFileSync(new URL("../src/web/shared/supabase-catalog-apply.js", import.meta.url), "utf8");

function crearCtx({ state = {}, boot = {} } = {}) {
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, Promise, JSON, Date, Math, String, Number, Object, Array, Error, RegExp, Boolean,
    document: { readyState: "complete", getElementById: () => null, createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }), head: { appendChild() {} }, body: { appendChild() {} } },
    state,
    PPCatalogBoot: {
      correr: async () => ({
        activo: true,
        fallo: null,
        catalogs: boot.catalogs || {},
        operations: boot.operations,
        workOrders: boot.workOrders,
        materials: boot.materials,
        ms: 1,
        viejo: {},
        vacias: [],
      }),
      aviso: () => false,
    },
    render: () => { ctx.pintado = true; },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(apply, ctx);
  return ctx;
}

test("operations, workOrders y materials se aplican cuando Supabase los trae", async () => {
  const ctx = crearCtx({
    state: {
      operations: [{ id: "del puente" }],
      workOrders: [{ id: "del puente" }],
      materials: [{ id: "del puente" }],
    },
    boot: {
      catalogs: { operators: ["A"] },
      operations: [{ id: "de supabase" }],
      workOrders: [{ id: "de supabase" }],
      materials: [{ id: "de supabase" }],
    },
  });
  const r = await ctx.PPCatalogApply.aplicarUnaVez();
  assert.equal(r.aplicado, true);
  // Copiar al realm del test: los arrays del vm tienen otro prototipo.
  const ops = JSON.parse(JSON.stringify(ctx.state.operations));
  const wos = JSON.parse(JSON.stringify(ctx.state.workOrders));
  const mats = JSON.parse(JSON.stringify(ctx.state.materials));
  assert.deepEqual(ops, [{ id: "de supabase" }], "operations se sobrescribe");
  assert.deepEqual(wos, [{ id: "de supabase" }], "workOrders se sobrescribe");
  assert.deepEqual(mats, [{ id: "de supabase" }], "materials se sobrescribe");
  assert.deepEqual([...ctx.state.operators], ["A"], "catalogos se aplican igual");
});

test("si Supabase no trae operations/workOrders/materials, NO se borra lo del puente", async () => {
  const ctx = crearCtx({
    state: {
      operations: [{ id: "del puente" }],
      workOrders: [{ id: "del puente" }],
      materials: [{ id: "del puente" }],
    },
    boot: {
      catalogs: { operators: ["A"] },
      operations: undefined,
      workOrders: undefined,
      materials: undefined,
    },
  });
  const r = await ctx.PPCatalogApply.aplicarUnaVez();
  assert.equal(r.aplicado, true);
  // Copiar al realm del test: los arrays del vm tienen otro prototipo.
  const ops = JSON.parse(JSON.stringify(ctx.state.operations));
  const wos = JSON.parse(JSON.stringify(ctx.state.workOrders));
  const mats = JSON.parse(JSON.stringify(ctx.state.materials));
  assert.deepEqual(ops, [{ id: "del puente" }], "undefined no borra operations");
  assert.deepEqual(wos, [{ id: "del puente" }], "undefined no borra workOrders");
  assert.deepEqual(mats, [{ id: "del puente" }], "undefined no borra materials");
});

test("arrays vacios de Supabase se aplican: significan 'no hay'", async () => {
  const ctx = crearCtx({
    state: {
      operations: [{ id: "del puente" }],
      workOrders: [{ id: "del puente" }],
      materials: [{ id: "del puente" }],
    },
    boot: {
      catalogs: {},
      operations: [],
      workOrders: [],
      materials: [],
    },
  });
  const r = await ctx.PPCatalogApply.aplicarUnaVez();
  assert.equal(r.aplicado, true);
  // Copiar al realm del test: los arrays del vm tienen otro prototipo.
  const ops = JSON.parse(JSON.stringify(ctx.state.operations));
  const wos = JSON.parse(JSON.stringify(ctx.state.workOrders));
  const mats = JSON.parse(JSON.stringify(ctx.state.materials));
  assert.deepEqual(ops, [], "array vacio si se aplica");
  assert.deepEqual(wos, [], "array vacio si se aplica");
  assert.deepEqual(mats, [], "array vacio si se aplica");
});

test("el orden: primero el puente, despues Supabase", async () => {
  // El apply envuelve applyImported. El puente llama a applyImported, y el apply
  // espera a que termine antes de aplicar Supabase. Este test verifica que el
  // estado del puente ya esta cuando se aplica Supabase.
  const ctx = crearCtx({
    state: {},
    boot: {
      catalogs: {},
      operations: [{ id: "de supabase" }],
      workOrders: [{ id: "de supabase" }],
      materials: [{ id: "de supabase" }],
    },
  });
  // Simular que el puente ya cargo
  ctx.state.operations = [{ id: "del puente" }];
  ctx.state.workOrders = [{ id: "del puente" }];
  ctx.state.materials = [{ id: "del puente" }];
  const r = await ctx.PPCatalogApply.aplicarUnaVez();
  assert.equal(r.aplicado, true);
  // Copiar al realm del test: los arrays del vm tienen otro prototipo.
  const ops = JSON.parse(JSON.stringify(ctx.state.operations));
  assert.deepEqual(ops, [{ id: "de supabase" }], "Supabase pisa al puente");
});

test("si la lectura falla, no se aplica nada del plan", async () => {
  const ctx = crearCtx({
    state: {
      operations: [{ id: "del puente" }],
      workOrders: [{ id: "del puente" }],
      materials: [{ id: "del puente" }],
    },
    boot: {
      catalogs: null,
      operations: undefined,
      workOrders: undefined,
      materials: undefined,
    },
  });
  // Simular fallo
  ctx.PPCatalogBoot.correr = async () => ({ activo: true, fallo: "red caida", catalogs: null });
  const r = await ctx.PPCatalogApply.aplicarUnaVez();
  assert.equal(r.aplicado, false);
  // Copiar al realm del test: los arrays del vm tienen otro prototipo.
  const ops = JSON.parse(JSON.stringify(ctx.state.operations));
  const wos = JSON.parse(JSON.stringify(ctx.state.workOrders));
  const mats = JSON.parse(JSON.stringify(ctx.state.materials));
  assert.deepEqual(ops, [{ id: "del puente" }], "un fallo no borra operations");
  assert.deepEqual(wos, [{ id: "del puente" }], "un fallo no borra workOrders");
  assert.deepEqual(mats, [{ id: "del puente" }], "un fallo no borra materials");
});
