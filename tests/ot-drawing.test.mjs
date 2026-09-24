import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");
const drawingFunctions = source.slice(
  source.indexOf("function cleanDrawingInput("),
  source.indexOf("function renderOperatorSelect()"),
);

function setup(bundleResolver) {
  const messages = [];
  const opened = [];
  const calls = [];
  const context = vm.createContext({
    otDrawingCache: {},
    messages,
    opened,
    calls,
    showToast: (message) => messages.push(message),
    callAppsScript: async (method, ...args) => {
      calls.push({ method, args });
      return bundleResolver(method, ...args);
    },
  });
  vm.runInContext(drawingFunctions, context);
  vm.runInContext(
    `function openDrawingUrl(url) { if (!url) return false; opened.push(url); return true; }`,
    context,
  );
  return { context, messages, opened, calls };
}

test("openOtDrawing lee el envoltorio { ok, data } del bundle y abre el dibujo del workOrder", async () => {
  const { context, messages, opened, calls } = setup(async (method) => {
    assert.equal(method, "getInspectionWorkOrderBundle");
    return {
      ok: true,
      data: {
        detail: {
          workOrder: { drawing: "\\\\192.168.1.101\\Produccion2\\partes\\pieza.pdf" },
          materials: [],
        },
        history: {},
      },
    };
  });

  await context.openOtDrawing(" 4501 ", "PARTE-A");

  assert.deepEqual(calls.map((call) => call.method), ["getInspectionWorkOrderBundle"]);
  assert.deepEqual(opened, ["\\\\192.168.1.101\\Produccion2\\partes\\pieza.pdf"]);
  assert.equal(messages.length, 0);
  assert.equal(context.otDrawingCache["4501"], "\\\\192.168.1.101\\Produccion2\\partes\\pieza.pdf");
});

test("openOtDrawing usa el primer material con dibujo cuando el workOrder no trae ruta", async () => {
  const { context, opened } = setup(async () => ({
    ok: true,
    data: {
      detail: {
        workOrder: { drawing: "" },
        materials: [{ material: "CRUDO", drawing: "https://example.com/dibujo.pdf" }, { material: "OTRO", drawing: "" }],
      },
      history: {},
    },
  }));

  await context.openOtDrawing("4502", "PARTE-B");

  assert.deepEqual(opened, ["https://example.com/dibujo.pdf"]);
});

test("si el bundle no trae dibujo, consulta getInspectionDrawingRoutes por PARTE", async () => {
  const { context, messages, opened, calls } = setup(async (method, arg) => {
    if (method === "getInspectionWorkOrderBundle") {
      return { ok: true, data: { detail: { workOrder: { drawing: "" }, materials: [] }, history: {} } };
    }
    assert.equal(method, "getInspectionDrawingRoutes");
    assert.equal(arg, "PARTE-C");
    return {
      ok: true,
      data: [
        { ARTICULO: "PARTE-C", MATERIAL: "ACERO", DIBUJO: "" },
        { ARTICULO: "PARTE-C", MATERIAL: "", DIBUJO: "\\\\SERVER2008\\Produccion2\\c\\plano.pdf" },
      ],
    };
  });

  await context.openOtDrawing("4503", "PARTE-C");

  assert.deepEqual(calls.map((call) => call.method), ["getInspectionWorkOrderBundle", "getInspectionDrawingRoutes"]);
  assert.deepEqual(opened, ["\\\\SERVER2008\\Produccion2\\c\\plano.pdf"]);
  assert.equal(messages.length, 0);
});

test("sin dibujo en bundle ni rutas, muestra el toast con la PARTE y no cachea errores de red", async () => {
  let attempts = 0;
  const { context, messages, calls } = setup(async (method) => {
    attempts += 1;
    if (method === "getInspectionWorkOrderBundle") throw new Error("timeout");
    return { ok: true, data: [] };
  });

  await context.openOtDrawing("4504", "PARTE-D");

  assert.match(messages.at(-1), /No se pudo obtener el dibujo de la OT 4504: timeout/);
  assert.equal(context.otDrawingCache["4504"], undefined);
  assert.equal(calls.length, 1);

  const recovered = setup(async () => ({
    ok: true,
    data: { detail: { workOrder: { drawing: "https://example.com/listo.pdf" }, materials: [] }, history: {} },
  }));
  await recovered.context.openOtDrawing("4504", "PARTE-D");
  assert.deepEqual(recovered.opened, ["https://example.com/listo.pdf"]);
  assert.equal(attempts, 1);
});

test("normalizeDrawingUrl convierte UNC de Produccion2 al protocolo maldonado", () => {
  const { context } = setup(async () => ({ ok: true, data: [] }));
  assert.equal(
    context.normalizeDrawingUrl("\\\\192.168.1.101\\Produccion2\\dibujos\\plano.pdf"),
    `maldonado://abrir?archivo=${encodeURIComponent("\\\\192.168.1.101\\Produccion2\\dibujos\\plano.pdf")}`,
  );
  assert.equal(
    context.normalizeDrawingUrl("SERVER2008\\Produccion2\\dibujos\\plano.pdf"),
    `maldonado://abrir?archivo=${encodeURIComponent("\\\\192.168.1.101\\Produccion2\\dibujos\\plano.pdf")}`,
  );
  assert.equal(context.normalizeDrawingUrl("https://example.com/a.pdf"), "https://example.com/a.pdf");
  assert.equal(context.normalizeDrawingUrl(""), "");
});
