# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added

- Restlet NetSuite `2244` (`netsuite-restlet-wo-inspeccion.js`): copia de `2080` que además devuelve en `trabajo` `cantidadTotal`, `cantidadEnsamblada` (fuente `record:built`), `cantidadPendiente` y `cantidadRealizada` por operación, y entrega OTs cerradas en `action: detail`. Apps Script: `getInspectionWorkOrder` (16/17) expone `builtQuantity`/`pendingQuantity`; `NS_WO_INSPECTION_SCRIPT` pasó de default `2080` a `2244`. Desplegado como versión 409 de la app web (`clasp deploy` reanudado).
- Plan de la semana / Liberación final: solo lo pendiente de ensamblar. Nueva caché `inspectionWorkOrderCache` alimentada en segundo plano por `getInspectionWorkOrder`; `PZAS = cantidad − built` con prioridad sobre ops/ruta/OT cerrada, y `Ensamblado` toma el `built` de inspección antes que `workOrders`. Monto del renglón en 0 cuando no quedan piezas pendientes.
- Tests: `weeklyJobSummary` con pendiente de inspección (completo/parcial/sin caché) y `releaseReportRows` con `Ensamblado` desde inspección. 602/602.
- Liberación final: la columna **Cantidad** ahora muestra el **total de la OT** (`inspectionQuantityForOt` → `workOrders[].quantity` → pendiente de la op como último recurso) en lugar del pendiente, para que la fila lea total / ensamblado. 602/602.

- Reportes → Liberación: columnas Ensamblado (`builtQuantity` de la OT) y Completar (botón Completar/Reabrir de la op 16OC/39OTD, mismo patrón que Plan por operador). Título del panel solo "Liberación". RULE-REP-013 actualizada.

### Fixed

- Plan por operador: columna HERRAMENTAL vacía en operaciones de doblado con `ct=SIN_CT` (feed NetSuite). `effectiveJobTool` ahora consulta la configuración de la OT antes del early-return por filtro de ct; la fila del reporte usa cascada `op.herramental` → config/OT → catálogo (solo si `isBendingAppOperation`). RULE-OT-045.

### Changed

- Planner: operaciones COMPLETADAS no reservan capacidad de operador/máquina (ni pasado ni futuro); la precedencia se mantiene (sucesora en misma OT aún espera el fin de la completada). `commitFixedOperation` con `reservesCapacity`, `operatorOverlapConflicts` filtra completadas. RULE-REP-011 / RULE-OT-042 actualizadas.
- Planner: ancla de fecha — ops incompletas seleccionadas conservan fechas+operador, prioridad sobre OTs nuevas, operador previo preferido (RULE-BAL-025).
- skills: se eliminó la leyenda amarilla "Vista independiente"; carga más rápida (caché `sessionStorage`, `getAppStateIfChanged`, `PlannerCore` con `defer`).
- Restlet 1766 (REQ_FIFO): `lastSalePrice` y `averageSalePrice` salen solo de Restlet 1766 (SuiteQL de facturas CustInvc eliminada); precio efectivo = `max(última, promedio 6m)` con fallback a `PRECIO_MANUAL`. Si las tres fuentes están en 0, el modal de preparación exige `ot_manual_price > 0` (`needsManualPrice`, RULE-FIN-001). Versión `PP_APP_VERSION` 2.43.0 / `PP_SCHEMA_VERSION` 31. Tests 561/561.
- `TASK-20260809-125520-4FE9` — Create the canonical non-duplicating index in docs/REGLAS.md using business rules verified across documentation, code, tests, SQL/configuration for OT, doblado, herramentales, máquinas, matriz de capacidad, balanceo, and BOM; preserve the existing project memory unchanged.


### Added

- RULE-MAT-011 / RULE-MAT-012 — Matriz resalta en rojo tenue las capacidades sin operador habilitado; `site/skills.html` es una vista independiente publicable en GitHub Pages que comparte el mismo almacén Google Sheets (getAppState/saveSkillState, payload espejo de matrixSavePayload, CONFLICT_REVISION recarga, sin altas/bajas destructivas). Project Memory, docs/REGLAS.md y docs/rules/RULES.md actualizados (RULE-GOV-003).
- Project Memory and governance bootstrap.
