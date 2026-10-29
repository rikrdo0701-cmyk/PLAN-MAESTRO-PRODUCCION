import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");

function dedupeSource() {
  const start = app.indexOf("function dedupeOperationsById(");
  const end = app.indexOf("function normalizeOperation(", start);
  assert.ok(start >= 0 && end > start, "Falta dedupeOperationsById");
  return app.slice(start, end);
}

function buildDedupe() {
  const context = {};
  vm.runInNewContext(dedupeSource(), context, { filename: "dedupeOperationsById" });
  return context;
}

test("dedupeOperationsById elimina copias exactas por id (doble cambio de la regresion)", () => {
  const { dedupeOperationsById } = buildDedupe();
  const ops = [
    { id: "ns-722", ot: "3397", num: 1, estatus: "PLAN" },
    { id: "chg-ns-723-1", ot: "3397", num: 7, estatus: "PLAN", herramental: "5 x 6" },
    { id: "chg-ns-723-1", ot: "3397", num: 7, estatus: "PLAN", herramental: "5 x 6" },
    { id: "ns-723", ot: "3397", num: 40, estatus: "PLAN", herramental: "5 x 6" },
    { id: "ns-723", ot: "3397", num: 40, estatus: "PLAN", herramental: "5 x 6" },
    { id: "ns-724", ot: "3397", num: 68, estatus: "PLAN" },
  ];
  const deduped = dedupeOperationsById(ops);
  assert.equal(deduped.length, 4);
  assert.equal(deduped.filter((op) => op.id === "chg-ns-723-1").length, 1);
  assert.equal(deduped.filter((op) => op.id === "ns-723").length, 1);
});

test("dedupeOperationsById preserva la copia PLAN programada sobre el original No iniciado del mismo id", () => {
  const { dedupeOperationsById } = buildDedupe();
  const ops = [
    { id: "ns-723", ot: "3397", num: 723, estatus: "No iniciado", ct: "5459", herramental: "5 x 6" },
    { id: "ns-723", ot: "3397", num: 40, estatus: "PLAN", ct: "SIN_CT", herramental: "5 x 6", fechaInicio: "2026-09-14", horaInicio: "09:19" },
  ];
  const deduped = dedupeOperationsById(ops);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].estatus, "PLAN");
  assert.equal(deduped[0].num, 40);
});

test("dedupeOperationsById no altera ids unicos ni ops sin id", () => {
  const { dedupeOperationsById } = buildDedupe();
  const ops = [
    { id: "ns-1", ot: "1", num: 1 },
    { id: "ns-2", ot: "1", num: 2 },
    { ot: "2", num: 1 },
  ];
  const deduped = dedupeOperationsById(ops);
  assert.equal(deduped.length, 3);
});