import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const app = readFileSync(new URL("../src/web/planning/app.js", import.meta.url), "utf8");
const cacheFunctions = app.slice(app.indexOf("function reportLoadsCacheInvalidated()"), app.indexOf("function operationMinutesInRange("));

test("report loads invalidate both cache layers after calendar and version changes", () => {
  const context = vm.createContext({});
  vm.runInContext(`
    let reportOperatorLoadsRenderMemo = null;
    let reportOperatorLoadsWeekCache = null;
    let planStateMutationVersion = 1;
    let reportSnapshot = null;
    const state = { operations: [], calendarExceptions: { available: 100 } };
    const operations = [{ minutes: 50 }];
    let calls = 0;
    function selectedWeekRange(week) { return { start: new Date(week) }; }
    function reportLoadsSignature(ops) { return JSON.stringify(ops); }
    function operatorLoadsForOperations(ops) {
      calls += 1;
      return [{ percent: ops[0].minutes / state.calendarExceptions.available * 100 }];
    }
    ${cacheFunctions}
    const week = "2026-09-07";
    const otherWeek = "2026-09-14";
    reportOperatorLoadsSourceMemoized(operations, otherWeek);
    const first = reportOperatorLoadsSourceMemoized(operations, week);
    const warm = reportOperatorLoadsSourceMemoized(operations, week);
    globalThis.warmReused = first === warm && calls === 2;
    state.calendarExceptions = { available: 200 };
    globalThis.afterCalendar = reportOperatorLoadsSourceMemoized(operations, week)[0].percent;
    globalThis.afterOtherWeek = reportOperatorLoadsSourceMemoized(operations, otherWeek)[0].percent;
    operations[0].minutes = 100;
    planStateMutationVersion += 1;
    globalThis.afterVersion = reportOperatorLoadsSourceMemoized(operations, otherWeek)[0].percent;
    globalThis.totalCalls = calls;
  `, context);
  assert.equal(context.warmReused, true);
  assert.equal(context.afterCalendar, 25);
  assert.equal(context.afterOtherWeek, 25);
  assert.equal(context.afterVersion, 50);
  assert.equal(context.totalCalls, 5);
});
