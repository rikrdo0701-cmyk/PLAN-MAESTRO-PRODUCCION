# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Changed

- skills: se eliminó la leyenda amarilla "Vista independiente"; carga más rápida (caché `sessionStorage`, `getAppStateIfChanged`, `PlannerCore` con `defer`).
- Restlet 1766 (REQ_FIFO): `lastSalePrice` y `averageSalePrice` salen solo de Restlet 1766 (SuiteQL de facturas CustInvc eliminada); precio efectivo = `max(última, promedio 6m)` con fallback a `PRECIO_MANUAL`. Si las tres fuentes están en 0, el modal de preparación exige `ot_manual_price > 0` (`needsManualPrice`, RULE-FIN-001). Versión `PP_APP_VERSION` 2.43.0 / `PP_SCHEMA_VERSION` 31. Tests 561/561.
- `TASK-20260809-125520-4FE9` — Create the canonical non-duplicating index in docs/REGLAS.md using business rules verified across documentation, code, tests, SQL/configuration for OT, doblado, herramentales, máquinas, matriz de capacidad, balanceo, and BOM; preserve the existing project memory unchanged.


### Added

- RULE-MAT-011 / RULE-MAT-012 — Matriz resalta en rojo tenue las capacidades sin operador habilitado; `site/skills.html` es una vista independiente publicable en GitHub Pages que comparte el mismo almacén Google Sheets (getAppState/saveSkillState, payload espejo de matrixSavePayload, CONFLICT_REVISION recarga, sin altas/bajas destructivas). Project Memory, docs/REGLAS.md y docs/rules/RULES.md actualizados (RULE-GOV-003).
- Project Memory and governance bootstrap.
