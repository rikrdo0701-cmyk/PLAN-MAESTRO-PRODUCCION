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
