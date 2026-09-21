import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const storage = await readFile(new URL("../src/server/02-storage.js", import.meta.url), "utf8");

function dedupeSource() {
  const start = storage.indexOf("function PP_dedupeOperationGenerations_(");
  const end = storage.indexOf("function PP_operationRows_(", start);
  assert.ok(start >= 0 && end > start, "Falta PP_dedupeOperationGenerations_");
  return storage.slice(start, end);
}

function buildDedupe() {
  const context = {};
  vm.runInNewContext(dedupeSource(), context, { filename: "PP_dedupeOperationGenerations_" });
  return context;
}

test("conserva solo la familia numerica mayor por (ot, parte)", () => {
  const { PP_dedupeOperationGenerations_ } = buildDedupe();
  const ops = [
    { id: "ns-90", ot: "2752", parte: "CCA 519 C", num: 1, ct: "A2942" },
    { id: "ns-91", ot: "2752", parte: "CCA 519 C", num: 2, ct: "A2942" },
    { id: "ns-24367", ot: "2752", parte: "CCA 519 C", num: 1, ct: "A2942" },
    { id: "ns-24368", ot: "2752", parte: "CCA 519 C", num: 2, ct: "A2942" },
  ];
  const deduped = PP_dedupeOperationGenerations_(ops);
  assert.deepEqual([...deduped.map((op) => op.id)].sort(), ["ns-24367", "ns-24368"]);
});

test("descarta ids de fabrica heredada junto con la familia vieja", () => {
  const { PP_dedupeOperationGenerations_ } = buildDedupe();
  const ops = [
    { id: "ns-23268", ot: "2613", parte: "AMRFA05131000", num: 5, ct: "TAL" },
    { id: "ns-29450", ot: "2613", parte: "AMRFA05131000", num: 1, ct: "COR" },
    { id: "ns-29451", ot: "2613", parte: "AMRFA05131000", num: 2, ct: "COR" },
    { id: "ns-2613-11", ot: "2613", parte: "AMRFA05131000", num: 11, ct: "INCIN" },
  ];
  const deduped = PP_dedupeOperationGenerations_(ops);
  assert.deepEqual([...deduped.map((op) => op.id)].sort(), ["ns-29450", "ns-29451"]);
});

test("no toca una sola generacion, ids unicos o filas sin id", () => {
  const { PP_dedupeOperationGenerations_ } = buildDedupe();
  const ops = [
    { id: "ns-28813", ot: "3295", parte: "M-24.5100.04", num: 1 },
    { id: "ns-28814", ot: "3295", parte: "M-24.5100.04", num: 2 },
    { id: "ns-3177-4", ot: "3177", parte: "", num: 4, ct: "PAÑ" },
    { id: "ns-3177-18", ot: "3177", parte: "", num: 18, ct: "PAÑ" },
    { ot: "4001", num: 1 },
    { id: "ns-31017", ot: "3584", parte: "MFAL16-0007", num: 1 },
  ];
  const deduped = PP_dedupeOperationGenerations_(ops);
  assert.equal(deduped.length, 6);
});

test("preserva cambios de herramental aunque haya generaciones duplicadas", () => {
  const { PP_dedupeOperationGenerations_ } = buildDedupe();
  const ops = [
    { id: "ns-90", ot: "1111", parte: "PIEZA A", tipoInsercion: "NORMAL" },
    { id: "chg-ns-90-1", ot: "1111", parte: "PIEZA A", tipoInsercion: "CAMBIO_HERRAMENTAL", herramental: "5 x 6" },
    { id: "ns-24367", ot: "1111", parte: "PIEZA A", tipoInsercion: "NORMAL" },
  ];
  const deduped = PP_dedupeOperationGenerations_(ops);
  const ids = [...deduped.map((op) => op.id)].sort();
  assert.deepEqual(ids, ["chg-ns-90-1", "ns-24367"]);
});

test("dedupe por (ot, parte): productos distintos de la misma OT no colisionan", () => {
const { PP_dedupeOperationGenerations_ } = buildDedupe();
  const ops = [
    { id: "ns-23268", ot: "2613", parte: "PIEZA A", num: 5 },
    { id: "ns-29450", ot: "2613", parte: "PIEZA A", num: 1 },
    { id: "ns-29451", ot: "2613", parte: "PIEZA A", num: 2 },
    { id: "ns-5001", ot: "2613", parte: "PIEZA B", num: 1 },
    { id: "ns-5002", ot: "2613", parte: "PIEZA B", num: 2 },
  ];
  const deduped = PP_dedupeOperationGenerations_(ops);
  const a = [...deduped.filter((op) => op.parte === "PIEZA A").map((op) => op.id)].sort();
  const b = [...deduped.filter((op) => op.parte === "PIEZA B").map((op) => op.id)].sort();
  assert.deepEqual(a, ["ns-29450", "ns-29451"]);
  assert.deepEqual(b, ["ns-5001", "ns-5002"]);
});