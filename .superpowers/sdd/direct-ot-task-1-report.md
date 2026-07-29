# Task 1 report: direct NetSuite operation-task loader

## Changed files

- `src/server/18-planning-work-order-service.js`
  - Replaced the individual-OT RESTlet 1762/17 path with a direct SuiteQL query of `manufacturingoperationtask`.
  - Resolves the work-order internal ID from inspection data, with a `transaction` lookup fallback.
  - Calculates pending quantity as `max(total - built, 0)`, using total when built is absent.
  - Uses OAuth plus `Prefer: transient`; reports concise SuiteQL, missing-OT, and empty-route failures.
- `tests/planning-work-order-service.test.mjs`
  - Covers the direct `manufacturingoperationtask` query, twelve returned operations, CT `5458`, setup plus run-rate time, zero-run-rate setup-only rows, ID fallback, and pending quantity.

## TDD evidence

- RED: `node --test tests/planning-work-order-service.test.mjs`
  - 9 passed, 1 failed. The new direct-loader test failed as expected because `UrlFetchApp.fetch` was never called (`0 !== 1`), showing the service still used the RESTlet route.
- GREEN: `node --test tests/planning-work-order-service.test.mjs`
  - 8 passed, 0 failed.

## Verification

- `node --test tests/planning-work-order-service.test.mjs` — 8 passed, 0 failed.
- `npm.cmd test` — 248 passed, 0 failed.
- `git diff --check` — no whitespace errors.

## Commit

`feat: load work order operations directly from NetSuite`. The final hash is recorded in the task handoff; this report is included in that same commit and therefore cannot self-reference its own final hash.

## Concerns

- The unrelated pre-existing `package-lock.json` modification and task-brief files were not staged.
