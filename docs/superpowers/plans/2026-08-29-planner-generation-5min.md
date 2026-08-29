# Plan de optimizacion de generacion a 5 minutos

> **For agentic workers:** Implementar por pasos. Cada tarea debe dejar pruebas o dry-runs trazables antes de pasar a la siguiente. No sacrificar restricciones duras ni publicar snapshots durante validaciones de rendimiento.

**Goal:** Reducir la generacion de plan a un presupuesto objetivo de 300000 ms (~5 min) sin degradar calidad: mismos o menos conflictos, `unscheduled` no mayor que el baseline aceptado y ningun movimiento antes de `planStart`.

**Architecture:** Convertir la generacion actual multi-estrategia en un flujo con mejor salida ante timeout, menos trabajo repetido y poda segura de candidatos. La calidad se protege con keep-best, fallback completo de candidatos y validaciones comparativas contra el modo actual de 10 min.

**Tech Stack:** JavaScript browser bundle, `src/web/planning/planner-core.js`, `src/web/planning/app.js`, Node test runner, dry-run live no persistente con `window.runPlanningPerformanceDryRun`.

## Baseline Medido

Dry-run live sin publicar ni persistir, con `planStart=2026-08-28`, `selectedOts=204`, `readyOts=146`, `inputOperations=2087`.

| Budget | Tiempo real | Scheduler | Scheduled | Unscheduled | Estrategia final | Estrategias iniciadas | Ultima fase |
|---:|---:|---:|---:|---:|---|---:|---|
| 120s | 183.6s | 183.1s | 1727 | 360 | `finish` | 2 | `strategy:flow_balanced:start` |
| 300s | 360.1s | 359.6s | 1661 | 426 | `balanced` parcial abortado | 4 | `allocate-work` |
| 600s | 335.5s | 335.0s | 1727 | 360 | `load` | 4 | `job-scan` |

La corrida de 300s demuestra el riesgo principal: al vencer presupuesto dentro de una estrategia, el motor puede devolver un parcial peor aunque ya exista un plan completo mejor.

Counters principales observados:

| Budget | Candidate evals | Slot probes | Busy overlap scans | Busy conflict scans | Tool catalog scans |
|---:|---:|---:|---:|---:|---:|
| 120s | 438065 | 3294172 | 2171393 | 2158078 | 5305900 |
| 300s | 693616 | 6531309 | 4518084 | 4675691 | 10260440 |
| 600s | 694083 | 6558954 | 4540697 | 4689646 | 10317440 |

## Restricciones Globales

- Preservar `respectPlanStart:true`: ninguna operacion movible antes de `planStart`.
- Operadores siempre salen de MATRIZ; no aceptar operador residual de una operacion.
- Respetar maquina, herramental, kit, capacidad, calendario, subcontrato, CAMBIO_HERRAMENTAL, exclusiones y cantidad pendiente.
- Preservar OTs bloqueadas, operaciones completadas, historicas, publicadas/guardadas y congeladas.
- No aumentar `operatorConflicts` ni `unscheduled` contra el baseline aceptado.
- Mantener `onYield` y `checkPlanningBudget`; la UI debe seguir respirando.
- Dry-runs de validacion no deben llamar `savePlanSnapshot`, `saveDraftSnapshot`, `publishDraftPlan`, `saveState` ni render persistente.

## Pipeline Objetivo

```text
Preprocesamiento + caches estaticos
  ↓
Greedy inteligente: balanced completo
  ↓
Earliest Feasible Slot con candidatos podados y fallback
  ↓
Greedy alterno: finish completo
  ↓
Greedy alterno: load o local search enfocado
  ↓
Keep-best final
  ↓
Terminar antes de 5 min
```

## Task 1: Keep-best-on-timeout

**Objetivo:** Si vence el presupuesto despues de una o mas estrategias completas, devolver el mejor plan completo ya evaluado y marcar `performance.aborted=true`, en lugar de devolver el parcial abortado.

**Files:**
- Modify: `src/web/planning/planner-core.js`
- Test: `tests/planner-core.test.mjs`

- [ ] Agregar fixture donde `schedulePlan` complete al menos una estrategia y aborte la siguiente por `TIME_BUDGET_EXCEEDED`.
- [ ] Verificar que el resultado devuelto sea el mejor plan completo ya evaluado, no el parcial abortado.
- [ ] Verificar que `lastSchedule.performance.aborted === true`, `reason === "TIME_BUDGET_EXCEEDED"` y `optimization.selectedStrategy` apunte a la estrategia completa elegida.
- [ ] Mantener fallback actual si no existe ninguna estrategia completa: puede devolver el parcial con diagnostico de timeout.
- [ ] Implementar en `planner-core.js:168-182` y seleccion final `planner-core.js:191-215`.
- [ ] Ejecutar `node --test tests/planner-core.test.mjs`.

**Validacion:**
- `operatorConflicts` del plan devuelto no aumenta contra el mejor completo.
- `unscheduled` del plan devuelto no aumenta contra el mejor completo.
- Dry-run 300s deja de devolver el caso degradado `1661/426` si ya habia un `1727/360` completo.

## Task 2: Modo 5 minutos con estrategias acotadas

**Objetivo:** Evitar iniciar una estrategia completa si el tiempo restante no alcanza razonablemente para terminarla.

**Files:**
- Modify: `src/web/planning/planner-core.js`
- Modify: `src/web/planning/app.js` si se expone setting/preset
- Test: `tests/planner-core.test.mjs`, `tests/build.test.mjs` si hay UI/config

- [ ] Agregar opcion interna `timeBudgetMs <= 300000` o setting explicito `fastQualityMode`.
- [ ] En modo 5 min, evaluar como maximo `balanced`, `finish`, `load`.
- [ ] Ejecutar `flow_balanced` solo si queda tiempo suficiente estimado o si el mejor completo tiene calidad insuficiente.
- [ ] Mantener modo 10 min como fallback configurable para comparacion y auditoria.
- [ ] Registrar en `lastSchedule.optimization` estrategias omitidas por presupuesto.
- [ ] Cubrir en tests el conteo maximo de estrategias.

**Validacion:**
- Dry-run 300s inicia maximo 3 estrategias completas.
- Aceptacion minima en dataset real: `scheduled >= 1727`, `unscheduled <= 360`, `operatorConflicts=0`.
- Si `flow_balanced` se omite, debe quedar trazado en `strategyFailures` o campo equivalente sin marcar error funcional.

## Task 3: Caches estaticos por operacion

**Objetivo:** Reducir recomputacion dentro del loop candidato x maquina x operador.

**Files:**
- Modify: `src/web/planning/planner-core.js`
- Test: `tests/planner-core.test.mjs`

- [ ] Crear cache por `operation.id`/`operationKey`: duracion base, CT normalizado, candidatos de operador, candidatos de maquina base, eficiencia/rendimiento y catalogo de herramienta aplicable.
- [ ] Reutilizar cache en `findAssignments` (`planner-core.js:552-576`), `operatorCandidates` (`planner-core.js:1214-1224`), `machineCandidates` (`planner-core.js:1263-1276`) y `toolCatalogForOperation` (`planner-core.js:1191-1212`).
- [ ] No cachear disponibilidad dinamica (`operatorBusy`, `machineBusy`, calendario actual, herramienta montada actual); eso debe seguir evaluandose en runtime.
- [ ] Asegurar invalidacion por estrategia si algun campo depende de `context.strategy`.

**Validacion:**
- Tests de MATRIZ: operador inexistente/residual nunca se acepta.
- Tests de maquina/herramental: CAMBIO_HERRAMENTAL y KIT_PENDIENTE se mantienen.
- Dry-run 300s reduce `toolCatalogScans`, `candidateEvals` o tiempo real sin cambiar `scheduled/unscheduled`.

## Task 4: Top 2-3 maquinas candidatas con fallback seguro

**Objetivo:** Aplicar la idea del usuario sin degradar factibilidad: podar para acelerar el caso comun, pero ampliar cuando haya riesgo.

**Files:**
- Modify: `src/web/planning/planner-core.js`
- Test: `tests/planner-core.test.mjs`

- [ ] Antes del loop de maquinas en `findAssignments`, rankear candidatas por disponibilidad temprana aproximada, compatibilidad de herramienta/kit ya montado, menor cambio de herramental y carga proyectada.
- [ ] Probar primero Top 2-3 maquinas.
- [ ] Fallback obligatorio: si Top N no produce assignment, probar todas las maquinas candidatas.
- [ ] Ampliar desde el inicio para operaciones criticas: fecha requerida cercana, duracion larga, pocas ventanas disponibles, o si una maquina fuera del Top N ya tiene el herramental/kit montado.
- [ ] Nunca podar cuando `machineCandidates` ya retorna maquina fija por configuracion de OT.

**Validacion:**
- Fixture donde la unica maquina factible queda fuera del Top 3: debe programarse por fallback.
- Fixture donde una maquina fuera del Top 3 evita cambio de herramental: debe incluirse o ganar por fallback.
- Comparativo real 300s: `unscheduled` no aumenta; cambios de herramental no aumentan materialmente.

## Task 5: Busy intervals mas baratos

**Objetivo:** Bajar costo de scans/sorts de ocupacion sin cambiar reglas de solape.

**Files:**
- Modify: `src/web/planning/planner-core.js`
- Test: `tests/planner-core.test.mjs`

- [ ] Revisar `addBusySegments` (`planner-core.js:1893-1904`): evita sort completo tras cada insercion usando insercion ordenada o buckets por recurso/dia.
- [ ] Revisar `firstBusyOverlapEnd`, `nextBusyConflictEnd`, `collectBusyConflicts` (`planner-core.js:1733-1809`) para limitar scans al rango relevante.
- [ ] Mantener invariantes de intervalos ordenados por `start/end`.

**Validacion:**
- Tests de solape operador/maquina siguen en cero.
- Tests con operaciones bloqueadas/fijas/historicas se preservan.
- Dry-run muestra reduccion de `busyOverlapScans`, `busyConflictScans` o tiempo real.

## Task 6: Local search enfocado

**Objetivo:** Sustituir o complementar una estrategia completa por refinamiento barato sobre el plan ya construido.

**Files:**
- Modify: `src/web/planning/planner-core.js`
- Test: `tests/planner-core.test.mjs`

- [ ] Implementar solo despues de Tasks 1-5 si 300s aun no alcanza calidad objetivo.
- [ ] Limitar vecindario a operaciones no programadas, operaciones cerca de `fechaReq`, cambios de herramental costosos y huecos evitables.
- [ ] Probar movimientos locales: desplazar dentro de misma maquina, cambiar a maquina equivalente, insertar en hueco existente, swap limitado entre recursos equivalentes.
- [ ] Aceptar movimiento solo si no aumenta conflictos ni rompe precedencia y reduce `unscheduled`, tardanza, cambio de herramienta o hueco evitable.
- [ ] Budget maximo sugerido: 30-45s al final del modo 5 min.

**Validacion:**
- Fixture donde local search rescata una operacion no programada sin crear conflictos.
- Fixture donde un swap tentador rompe precedencia: debe rechazarse.
- Dry-run comparativo: mejora o mantiene `unscheduled`; nunca empeora hard constraints.

## Task 7: Validacion integral y rollout

**Files:**
- Test: `tests/planner-core.test.mjs`, `tests/planning-workflow-core.test.mjs`, `tests/build.test.mjs`
- Docs: actualizar Project Memory y docs relevantes si cambia regla o dato.

- [ ] Ejecutar `npm test`.
- [ ] Ejecutar `npm run check`.
- [ ] Ejecutar dry-run live no persistente 120s/300s/600s con el mismo dataset.
- [ ] Capturar tabla antes/despues: scheduled, unscheduled, conflicts, ops antes de planStart, estrategias, elapsedMs, candidateEvals, slotProbes, busy scans, tool scans.
- [ ] Confirmar que reporte/publicacion no cambia: el resultado sigue teniendo `lastSchedule`, operaciones fechadas y `optimization` trazable.
- [ ] Si se introduce setting 5min/10min, documentar valor default y rollback.

## Criterios de Aceptacion

- Presupuesto 300000 ms devuelve un plan completo o el mejor completo disponible, no un parcial peor.
- En dataset real de referencia: `scheduled >= 1727`, `unscheduled <= 360`, `operatorConflicts=0`.
- Ninguna operacion movible empieza antes de `planStart`.
- El modo 5 min no aumenta operaciones sin hueco contra el baseline de 10 min aceptado.
- Si Top 2-3 no encuentra slot, fallback a todas las maquinas garantiza factibilidad.
- Los contadores de rendimiento bajan respecto al baseline: slot probes, tool scans y/o busy scans.
- `lastSchedule.optimization` explica estrategias corridas, omitidas, seleccionadas y si hubo timeout.

## Orden Recomendado

1. Keep-best-on-timeout: menor riesgo, corrige degradacion clara de 300s.
2. Estrategias acotadas para modo 5 min: evita gastar tiempo en pases que no terminan.
3. Caches estaticos por operacion: reduce millones de scans sin cambiar decision dinamica.
4. Top 2-3 maquinas con fallback: alto impacto, requiere fixtures de seguridad.
5. Busy intervals mas baratos: mejora estructural con riesgo medio.
6. Local search enfocado: solo si despues de lo anterior falta calidad.
