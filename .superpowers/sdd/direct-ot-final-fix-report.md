# Direct OT final fix report

## Scope

- Added a per-session completed-direct-load marker. Existing valid rows no longer suppress the first direct OT request; concurrent requests still share one promise and later requests use the session cache.
- Direct data merge now remaps a selected placeholder/old operation to a newly merged operation for the same OT.
- The detail in-flight marker is cleared before the final selected-detail render, so the loading copy is removed after an error.
- SuiteQL HTTP response content is logged only on the server; browser-facing errors contain only the concise HTTP status.
- Replaced the pending-quantity false positive with a nonzero setup and run-rate fixture, total quantity 10, built quantity 3, and an exact `4 + 1.5 * (10 - 3)` assertion.

## RED evidence

`node --test tests/planning-work-order-service.test.mjs tests/performance-client-calls.test.mjs`

- 35 passed, 4 failed before the production changes.
- Expected failures: valid persisted rows returned `cached` instead of loading direct data; placeholder selection retained its old ID; final error render still saw the in-flight marker; the SuiteQL error exposed raw response content.

`node --test tests/build.test.mjs`

- The existing add/drag test failed after the required behavior change because it asserted the old `!hasIndividualPlanningOperations(ot)` gate. It was updated to require the direct per-session load path for both actions.

## GREEN and verification

- `node --test tests/planning-work-order-service.test.mjs` — 10 passed, 0 failed.
- `node --test tests/performance-client-calls.test.mjs` — 28 passed, 0 failed.
- `node --test tests/build.test.mjs` — 27 passed, 0 failed.
- `npm.cmd run build` — passed.
- `npm.cmd test` — 255 passed, 0 failed.
- `npm.cmd run check` — passed.
- `git diff --check` — passed.

## Concern

The pre-existing `package-lock.json` change and untracked earlier task/review artifacts remain outside this fix commit.

## Second final fix wave

### Scope

- Direct route refreshes now match existing OT operations by sequence first and CT only as a fallback. They replace NetSuite route fields while retaining local plan metadata, including scheduling dates/times, operator, machine, tooling, lock, completion, status, log, and unrecognized local planning fields.
- Selection remapping now receives the selected OT from the selected job, so production's synthetic placeholder (which is not present in `state.operations`) resolves to the newly merged operation.
- The direct request captures an OT route signature. If the OT's current route changes before the response returns, the stale response is ignored even when the request started with a valid persisted route.

### RED evidence

`node --test tests/performance-client-calls.test.mjs`

- 27 passed, 3 failed before implementation.
- Expected failures: no operation ID was selected for the synthetic-placeholder state; direct merge discarded local planning fields; a late direct response overwrote newer valid sync data.

### GREEN and verification

- `node --test tests/planning-work-order-service.test.mjs` — 10 passed, 0 failed.
- `node --test tests/performance-client-calls.test.mjs` — 30 passed, 0 failed.
- `node --test tests/build.test.mjs` — 27 passed, 0 failed.
- `npm.cmd run build` — passed.
- `npm.cmd test` — 257 passed, 0 failed.
- `npm.cmd run check` — passed.
- `git diff --check` — passed.
