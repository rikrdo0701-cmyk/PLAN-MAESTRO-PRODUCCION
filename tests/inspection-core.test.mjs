import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/web/inspection/inspection-core.js", import.meta.url), "utf8");
const context = { window: {} };
vm.runInNewContext(source, context);
const core = context.window.InspectionCore;

test("selecciona todas las operaciones al cargar y compacta la impresion", () => {
  const operations = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(structuredClone(core.initialOperationSelection(operations)), { a: true, b: true, c: true });
  assert.deepEqual(structuredClone(core.printableOperations(operations, { a: true, b: false, c: true })).map((item) => item.id), ["a", "c"]);
});

test("compacta operaciones visibles y agrega vacias solamente al final", () => {
  const operations = [{ id: "a", code: "10C" }, { id: "b", code: "20C" }, { id: "c", code: "30C" }];
  const rows = core.inspectionRows(operations, { a: true, b: false, c: true }, 4);
  assert.deepEqual(structuredClone(rows).map((row) => row.operation?.code || ""), ["10C", "30C", "", ""]);
});

test("reiniciar seleccion incluye todas las operaciones", () => {
  assert.deepEqual(structuredClone(core.initialOperationSelection([{ id: "x" }, { code: "20C" }])), { x: true, "20C": true });
});

test("diagnostico de impresion replica pendientes, tramos y deficit del original", () => {
  const diagnostic = core.inspectionPrintDiagnostic([
    { material: "TUBO", required: 1.5, available: 1, route: "", deficitNeto: 0.5 },
    { material: "INSERTO", required: 2, available: 1, route: "", deficit: 1 }
  ], true);

  assert.equal(diagnostic.status, "block");
  assert.equal(diagnostic.pending.length, 2);
  assert.deepEqual(diagnostic.missingRoutes.map((item) => item.material), ["TUBO"]);
  assert.equal(diagnostic.deficit.length, 2);
});

test("operaciones ocultas no cambian el semaforo y el deficit solo advierte", () => {
  const diagnostic = core.inspectionPrintDiagnostic([
    { material: "TUBO", required: 2, available: 1, route: "", deficitNeto: 1 }
  ], true);

  assert.equal(diagnostic.status, "warn");
  assert.equal(diagnostic.label, "Revisar");
  assert.equal(diagnostic.pending.length, 1);
  assert.equal(diagnostic.missingRoutes.length, 0);
});

test("usa deficit neto del backend y filtra costo cero o sin requerido", () => {
  const diagnostic = core.inspectionPrintDiagnostic([
    { material: "TUBO", required: 2, available: 0, deficitNeto: 0, deficit: 0 },
    { material: "Costo 0 ajuste", required: 4, deficitNeto: 4 },
    { material: "SIN REQUERIR", required: 0, deficitNeto: 2 }
  ], true);

  assert.equal(diagnostic.status, "ok");
  assert.deepEqual(diagnostic.materials.map((item) => item.material), ["TUBO"]);
  assert.equal(diagnostic.deficit.length, 0);
});
