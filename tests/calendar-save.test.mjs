import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");
const handler = source.slice(source.indexOf("async function addCalendarException()"), source.indexOf("function addSubcontract()"));

function setup(save) {
  const values = {
    calendarConceptInput: "ASUETO", calendarMachineInput: "", calendarOperatorInput: "",
    calendarReasonInput: "independencia", calendarStartDateInput: "2026-09-16",
    calendarEndDateInput: "", calendarStartInput: "", calendarEndInput: "",
  };
  const els = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }]));
  els.addCalendarBtn = { disabled: false, textContent: "Agregar periodo", setAttribute() {}, removeAttribute() {} };
  const messages = [];
  const scopes = [];
  const context = vm.createContext({
    els, state: { calendarExceptions: [] }, appSheetSaveInFlight: false,
    appSheetWaitForIdle: async () => {}, checkpointState() {}, uid: () => "cal-test",
    appSheetMarkDirtyScope: (scope) => scopes.push(scope),
    saveAppSheet: () => save(context), showToast: (message) => messages.push(message),
    updateCalendarForm() {}, renderCalendarExceptions() {},
  });
  vm.runInContext(handler, context);
  return { context, els, messages, scopes };
}

test("Agregar periodo espera confirmacion antes de limpiar el asueto de dia completo", async () => {
  let acknowledge;
  let stored;
  const { context, els, messages, scopes } = setup(async (ctx) => {
    await new Promise((resolve) => { acknowledge = resolve; });
    stored = JSON.parse(JSON.stringify(ctx.state.calendarExceptions));
    return true;
  });
  const pending = context.addCalendarException();
  assert.equal(els.addCalendarBtn.disabled, true);
  assert.equal(els.calendarReasonInput.value, "independencia");
  assert.equal(messages.length, 0);
  await context.addCalendarException();
  assert.equal(context.state.calendarExceptions.length, 1);
  acknowledge();
  await pending;
  assert.deepEqual(scopes, ["catalogs"]);
  assert.equal(stored[0].startDate, "2026-09-16");
  assert.equal(stored[0].endDate, "2026-09-16");
  assert.equal(stored[0].start, "00:00");
  assert.equal(stored[0].end, "24:00");
  assert.equal(els.calendarReasonInput.value, "");
  assert.equal(els.addCalendarBtn.disabled, false);
  assert.match(messages.at(-1), /guardado en la hoja/);
});

test("fallo de guardado conserva captura y reintentar no duplica el asueto", async () => {
  let attempts = 0;
  const { context, els, messages } = setup(async () => ++attempts > 1);
  await context.addCalendarException();
  assert.equal(els.calendarReasonInput.value, "independencia");
  assert.match(messages.at(-1), /sin confirmar/);
  await context.addCalendarException();
  assert.equal(context.state.calendarExceptions.length, 1);
  assert.equal(attempts, 2);
});

test("conflicto que recarga calendario remoto permite reenviar el formulario conservado", async () => {
  let attempts = 0;
  const { context, els } = setup(async (ctx) => {
    if (++attempts === 1) { ctx.state.calendarExceptions = []; return false; }
    return true;
  });
  await context.addCalendarException();
  assert.equal(els.calendarStartDateInput.value, "2026-09-16");
  await context.addCalendarException();
  assert.equal(context.state.calendarExceptions[0].reason, "independencia");
});
