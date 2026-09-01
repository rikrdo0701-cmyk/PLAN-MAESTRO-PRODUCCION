# Rules registry

Registro de todas las reglas con ID estable `RULE-<DOMINIO>-NNN`. Cada regla tiene una sola
fuente canónica y una clasificación: **DOCUMENTADA**, **IMPLEMENTADA**, **INFERIDA** o
**AMBIGUA** (ver `docs/REGLAS.md`). La versión machine-readable vive en
`.project-memory/rules.json`.

## Gobernanza

| ID | Nombre | Estado | Fuente |
|---|---|---|---|
| `RULE-GOV-001` | Project Memory first | DOCUMENTADA | ADR-0001 |
| `RULE-GOV-002` | Single writer | DOCUMENTADA | ADR-0001 |
| `RULE-GOV-003` | Document discovered knowledge | DOCUMENTADA | ADR-0001 |
| `RULE-GIT-001` | Private independent remote | DOCUMENTADA | ADR-0001 |
| `RULE-GOV-004` | Dry-run == ejecución real (sin fallbacks que la web no hace) | IMPLEMENTADA | `planner-core.js` |
| `RULE-GOV-005` | GitHub Pages es el punto de acceso público a la app | ACTIVA | `deploy-pages.yml` |
| `RULE-GOV-006` | Sin estado de demostración en el arranque público; datos reales se autoaplican | IMPLEMENTADA | `scripts/build-appscript.mjs` |
| `RULE-GOV-007` | El arranque real es `performance-client.js`; parches del boot vía `scripts/build-appscript.mjs` | IMPLEMENTADA | `scripts/build-appscript.mjs` |
| `RULE-GOV-008` | Código inyectado por el build no usa helpers internos de `planner-core` | IMPLEMENTADA | `scripts/build-appscript.mjs` |

## Arranque (boot / carga)

| ID | Nombre | Estado | Fuente |
|---|---|---|---|
| `RULE-LOAD-001` | Capa 1: hidratar caché local al boot (render instantáneo para recurrentes) | IMPLEMENTADA | plan 2026-09-01 |
| `RULE-LOAD-002` | Capa 2: rescate rápido del Borrador en paralelo; `getAppState` autoritativo después | IMPLEMENTADA | plan 2026-09-01 |
| `RULE-LOAD-003` | El caché local se puebla tras cada carga autoritativa exitosa | IMPLEMENTADA | plan 2026-09-01 |
| `RULE-LOAD-004` | No abrir el modal de "última modificación" si el contenido local vino del servidor | IMPLEMENTADA | plan 2026-09-01 |

Detalle y mediciones: `docs/superpowers/plans/2026-09-01-arranque-con-datos-reales-sin-demo.md`.

## UI / vistas del workspace

| ID | Nombre | Estado | Fuente |
|---|---|---|---|
| `RULE-UI-001` | Cada vista no-plan ocupa todo el workspace (el plan/Gantt queda oculto en Reportes, Cargas, Cuello de botella y Config) | IMPLEMENTADA | `src/web/planning/styles.css`, commit `34c5802` |

Patrón: `.workspace[data-view="VISTA"] > :not(.topbar):not(PANEL):not(.toast):not(.planning-dialog) { display: none; }`, espejo de lo que `src/web/inspection/inspection.css` hace con `data-view="inspection"`.

## Reportes

| ID | Nombre | Estado | Fuente |
|---|---|---|---|
| `RULE-REP-001` | Fechas de reportes: día = hoy (operador/ajustador/subcontrato); semana = lunes del plan seleccionado, sin campo "Semana" | IMPLEMENTADA | `app.js`, `index.template.html`, commit `221f4d8` |
| `RULE-REP-002` | Rango de fechas de reportes diarios: muestran operaciones con fecha anterior al día seleccionado y hacia adelante según la casilla de días; no se limitan a la semana del plan (`operationsForDayReport`, `filteredReportRows`, `reportDateRange`) | IMPLEMENTADA | `app.js` (`operationsForDayReport`, `operatorReportSelection`, `adjusterReportSelection`) |
| `RULE-REP-003` | El seguimiento de completado (Completar/Reabrir y columna Estado) solo aplica al último plan publicado; el borrador y los planes anteriores son solo lectura (`reportSourceAllowsOperationTracking`) | IMPLEMENTADA | `app.js` (`reportSourceAllowsOperationTracking`, `planStatusActionCell`) |
| `RULE-REP-004` | TC siempre derivado = tiempo de producción ÷ piezas a producir (importación `08-netsuite.js` + fallback de visualización `operationCycleMinutesForReport`) | IMPLEMENTADA | `08-netsuite.js`, `app.js` |

## OT

| ID | Nombre | Estado | Fuente |
|---|---|---|---|
| `RULE-OT-001` | Mapeo de hojas (Control → Trabajos → Operaciones) | DOCUMENTADA | `OT_RULES.md` |
| `RULE-OT-002` | Normalización de TRABAJO/Folio | DOCUMENTADA | `OT_RULES.md` |
| `RULE-OT-003` | ID Interno como cadena | DOCUMENTADA | `OT_RULES.md` |
| `RULE-OT-004` | Agrupación por secuencia | DOCUMENTADA | `OT_RULES.md` |
| `RULE-OT-005` | Coherencia del borrador (`selectedOts`) | DOCUMENTADA | spec 2026-07-12 |
| `RULE-OT-006` | Sincronización ligera del backlog | IMPLEMENTADA | `planning/app.js` |
| `RULE-OT-007` | Exclusión mutua de sync/programación | IMPLEMENTADA | task-2-report |
| `RULE-OT-008` | OTs cerradas conservadas (`CLOSED_KEPT`) | IMPLEMENTADA | task-2-report |
| `RULE-OT-009` | Tipos de trabajo (PROTOTIPO/URGENTE/EXPEDITACION) | IMPLEMENTADA | `legacy/IndexPlanning.html` |
| `RULE-OT-010` | Persistencia de `CONFIGURACION_OT` mientras OT abierta | DOCUMENTADA | definición de usuario 2026-08-12 |
| `RULE-OT-011` | Inicio del borrador desde Gantt | IMPLEMENTADA | definición de usuario 2026-08-13 |
| `RULE-OT-012` | Precedencia por secuencia incluida | IMPLEMENTADA | definición de usuario 2026-08-13 |
| `RULE-OT-013` | Vigencia por OT de datos de planeacion (24h) y fallback parcial | IMPLEMENTADA | definición de usuario 2026-08-13, 2026-08-27 |
| `RULE-OT-014` | Sincronización inteligente y actualización por OT | IMPLEMENTADA | definición de usuario 2026-08-14 |
| `RULE-OT-015` | OT u operación nueva no inicia antes de la hora actual | IMPLEMENTADA | definición de usuario 2026-08-14 |
| `RULE-OT-016` | Dry-run de rendimiento de planeación | IMPLEMENTADA | definición de usuario 2026-08-26 |
| `RULE-OT-017` | OT no bloqueada: borrar asignación del borrador y recalcular | IMPLEMENTADA | definición de usuario 2026-08-27 |

Nota `RULE-OT-014`: la ruta directa de OT (`getPlanningWorkOrderData`) entrega cada operación con
`cantTotal`/`cantPendiente` = cantidad pendiente real (`Cantidad` − `Cantidad ensamblada`) vía
`'Cantidad a procesar'` en la fila; coherente con `tiempoProd`.

## Doblado

| ID | Nombre | Estado | Fuente |
|---|---|---|---|
| `RULE-DOB-001` | Precarga CT 5459/5527 en preparación de OT | DOCUMENTADA | spec 2026-07-12 |

## Herramentales

| ID | Nombre | Estado | Fuente |
|---|---|---|---|
| `RULE-HER-001` | Preservación de `HERRAMENTALES` | DOCUMENTADA | spec 2026-07-12 |
| `RULE-HER-002` | Herramental en doblado (complemento DOB-001) | INFERIDA | spec 2026-07-12 |
| `RULE-HER-003` | Múltiples herramentales simultáneos en doblado | IMPLEMENTADA | definición de usuario 2026-08-12 |

## Máquinas

| ID | Nombre | Estado | Fuente |
|---|---|---|---|
| `RULE-MAQ-001` | Preservación de `MAQUINAS` | DOCUMENTADA | spec 2026-07-12 |
| `RULE-MAQ-002` | Programa semanal = vista Gantt por máquina | IMPLEMENTADA | `legacy/IndexPlanning.html` |
| `RULE-MAQ-003` | Cada operación tiene máquina asignada | IMPLEMENTADA | `legacy/IndexPlanning.html` |

## Matriz de capacidad

| ID | Nombre | Estado | Fuente |
|---|---|---|---|
| `RULE-MAT-001` | Catálogo maestro SuiteQL | DOCUMENTADA | spec 2026-07-26 |
| `RULE-MAT-002` | Dedupe y filtro de activos | DOCUMENTADA | spec 2026-07-26 |
| `RULE-MAT-003` | Fallback del catálogo (nunca lista vacía) | DOCUMENTADA | spec 2026-07-26 |
| `RULE-MAT-004` | No modificar RESTlets/Apps Script | DOCUMENTADA | spec 2026-07-26 |
| `RULE-MAT-005` | Exclusión de subcontratos especiales | DOCUMENTADA | spec 2026-07-26 |
| `RULE-MAT-006` | Buscador de operaciones | DOCUMENTADA | spec 2026-07-26 |
| `RULE-MAT-007` | Exclusiones globales (`excludedCapabilities`) | DOCUMENTADA | spec 2026-07-26 |
| `RULE-MAT-008` | Memorización de operaciones incluidas | IMPLEMENTADA | spec 2026-07-27 |
| `RULE-MAT-009` | Catálogo con caché 1 h | IMPLEMENTADA | spec 2026-07-27 |

## Balanceo

| ID | Nombre | Estado | Fuente |
|---|---|---|---|
| `RULE-BAL-001` | KPIs de carga | IMPLEMENTADA | `legacy/IndexPlanning.html` |
| `RULE-BAL-002` | Cargas coherentes con `selectedOts` (misma regla OT-005) | DOCUMENTADA | spec 2026-07-12 |
| `RULE-BAL-003` | Agrupación por máquina/herramental/kit con trade-off controlado de setup vs entrega | DOCUMENTADA | definición de usuario 2026-08-12, 2026-08-14 y 2026-08-29 |
| `RULE-BAL-004` | Menor tiempo de OT en producción para reducir WIP | DOCUMENTADA | definición de usuario 2026-08-12 |
| `RULE-BAL-005` | Validación de operador en operaciones sincronizadas de NetSuite | IMPLEMENTADA | definición de usuario 2026-08-27; `08-netsuite.js` |
| `RULE-BAL-006` | Operador programado siempre desde la matriz de habilidades (MATRIZ), nunca residual | IMPLEMENTADA | definición de usuario 2026-08-27; `planner-core.js` |
| `RULE-BAL-007` | Validación previa de operador en la matriz antes de generar plan | IMPLEMENTADA | definición de usuario 2026-08-27; `app.js` `planner-core.js` |
| `RULE-BAL-008` | Arranque por orden de Planeado/No planeado; sucesoras optimizables y terminación flexible | IMPLEMENTADA | definición de usuario 2026-08-29; `planner-core.js` |
| `RULE-BAL-009` | Modo rápido 5 min con keep-best-on-timeout y estrategias acotadas | IMPLEMENTADA | definición de usuario 2026-08-29; `app.js` `planner-core.js` |

## BOM

| ID | Nombre | Estado | Fuente |
|---|---|---|---|
| `RULE-BOM-001` | `MATERIALES` en limpieza del borrador | DOCUMENTADA | spec 2026-07-12 |
| `RULE-BOM-002` | `materialsForOt()` filtra por OT | IMPLEMENTADA | `CONFIGURACION.md` |

## Calendario

| ID | Nombre | Estado | Fuente |
|---|---|---|---|
| `RULE-CAL-001` | Turno y ventanas de trabajo por defecto 07:00–17:00 | IMPLEMENTADA | `planner-core.js`, `app.js`, `02-storage.js` |
| `RULE-CAL-002` | Partición de operaciones entre días laborables consecutivos | IMPLEMENTADA | definición de usuario 2026-08-16; `planner-core.js`; `tests/planner-core.test.mjs` |

## Pendientes y ambigüedades

- Balanceo y BOM carecen de reglas explícitas más allá de lo listado (evidencia insuficiente).
- Los enlaces a líneas/archivos pueden quedar obsoletos; este registro referencia fuentes, no las reescribe.
