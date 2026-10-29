# Reprogramación, Estados y Reportes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reprogramar borradores con datos disponibles aun cuando NetSuite tarde, preservar históricos y completadas, y ofrecer estados, filtros e impresión coherentes en los planes operativos.

**Architecture:** La lógica determinista de timeout, disponibilidad de datos, limpieza del borrador, filtros y cobertura vivirá en un módulo puro `planning-workflow-core.js`, consumido por `app.js` y probado con `node:test`. `planner-core.js` mantendrá la programación de capacidad; la interfaz coordinará sincronización, persistencia y estados visuales sin bloquear el cálculo.

**Tech Stack:** JavaScript UMD/ES2020, Node.js `node:test`, GitHub Pages, Google Apps Script bridge.

## Global Constraints

- Timeout automático de NetSuite: exactamente 15 segundos.
- Una sincronización manual siempre fuerza actualización.
- Los planes guardados, publicados e históricos nunca se limpian al reprogramar.
- Una operación completada conserva fechas históricas, no se reprograma y no consume carga pendiente.
- Cada operación pendiente programada pertenece exactamente a operador, ajustador o subcontrato.
- Sin dependencias nuevas ni cambios al contrato de NetSuite.
- El horizonte solo controla la vista del Gantt, nunca la precedencia ni el fin de una operación.
- Reportes operativos: rangos de 1 a 5 días y máximo 25 filas en una hoja A4 horizontal.

---

### Task 1: Núcleo puro del flujo de planificación

**Files:**
- Create: `src/web/planning/planning-workflow-core.js`
- Create: `tests/planning-workflow-core.test.mjs`
- Modify: `src/web/planning/index.template.html`
- Modify: `scripts/build-appscript.mjs`

**Interfaces:**
- Produces: `PlanningWorkflowCore.withTimeout(promise, milliseconds)`, `hasPlanningData(state, ots)`, `prepareDraftForReschedule(state, ots)`, `filterOperationsByPlanStatus(rows, status)`, `classifyReportOperation(op)` y `reportCoverageIssues(operations)`.
- Consumes: objetos de operación normalizados con `id`, `ot`, `tipoInsercion`, `operador`, `planStatus`, fechas y banderas de bloqueo.

- [ ] **Step 1: Escribir pruebas fallidas del módulo puro**

Crear pruebas que afirmen:

```js
assert.equal(await core.withTimeout(Promise.resolve("ok"), 15), "ok");
await assert.rejects(core.withTimeout(new Promise(() => {}), 15), /15 segundos/);
assert.equal(core.hasPlanningData({ operations: [{ ot: "1325", descripcion: "CORTE" }] }, ["1325"]), true);
assert.equal(core.hasPlanningData({ operations: [] }, ["1325"]), false);
```

Añadir un estado con cuatro operaciones: movible con fechas antiguas, completada, bloqueada y perteneciente a otra OT. `prepareDraftForReschedule` debe limpiar fechas, recursos calculados, `needsReschedule`, `autoFrozen` y estado calculado solamente en la primera; debe conservar las otras tres y no mutar el argumento.

Probar filtros `PENDIENTES`, `COMPLETADAS`, `TODAS`. Probar clasificación exclusiva:

```js
assert.equal(core.classifyReportOperation(productive), "operator");
assert.equal(core.classifyReportOperation(toolChange), "adjuster");
assert.equal(core.classifyReportOperation(subcontract), "subcontract");
```

Probar que `reportCoverageIssues` devuelve diagnóstico para una operación sin categoría o con categoría ambigua y ninguno para las tres anteriores.

- [ ] **Step 2: Verificar RED**

Run: `node --test tests/planning-workflow-core.test.mjs`

Expected: FAIL porque el archivo y API no existen.

- [ ] **Step 3: Implementar el API mínimo**

Crear un módulo UMD que publique `globalThis.PlanningWorkflowCore`. `withTimeout` debe limpiar su temporizador en `finally`; `prepareDraftForReschedule` debe clonar `state` y `operations`, preservar `COMPLETADA_PLAN`, `locked === true`, OTs fuera de selección y operaciones históricas, y vaciar únicamente campos calculados del borrador movible.

- [ ] **Step 4: Integrar el módulo en ambos builds**

Añadir marcador `{{PLANNING_WORKFLOW_CORE}}` antes de `{{PLANNING_APP}}` en `index.template.html`. Leer el archivo en `build-appscript.mjs` e inyectarlo tanto en Apps Script como en Pages. Añadir una aserción a `tests/build.test.mjs` para `PlanningWorkflowCore`.

- [ ] **Step 5: Verificar GREEN y suite**

Run: `node --test tests/planning-workflow-core.test.mjs tests/build.test.mjs`

Expected: PASS.

Run: `npm.cmd test`

Expected: todas PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/planning/planning-workflow-core.js src/web/planning/index.template.html scripts/build-appscript.mjs tests/planning-workflow-core.test.mjs tests/build.test.mjs
git commit -m "Agregar nucleo de flujo de planificacion"
```

### Task 2: Sincronización con timeout y reprogramación limpia

**Files:**
- Modify: `src/web/planning/app.js:3310-3380`
- Modify: `src/web/planning/app.js:4848-4870`
- Modify: `tests/build.test.mjs`

**Interfaces:**
- Consumes: `PlanningWorkflowCore.withTimeout`, `hasPlanningData`, `prepareDraftForReschedule`.
- Produces: `ensurePlanningDataLoaded(showMessage, { force = false } = {})` devuelve `{ ready, source, warning }`; `source` es `fresh`, `cached` o `none`.

- [ ] **Step 1: Escribir comprobaciones fallidas de integración**

En `tests/build.test.mjs`, afirmar que el artefacto incluye `NETSUITE_PLANNING_TIMEOUT_MS = 15000`, `PlanningWorkflowCore.withTimeout`, `prepareDraftForReschedule` y el texto `NetSuite no respondio; se programara con los datos ya cargados`.

- [ ] **Step 2: Verificar RED**

Run: `node --test tests/build.test.mjs`

Expected: FAIL por los marcadores ausentes.

- [ ] **Step 3: Implementar sincronización limitada**

En `app.js`, definir:

```js
const NETSUITE_PLANNING_TIMEOUT_MS = 15000;
const NETSUITE_PLANNING_FRESH_MS = 5 * 60 * 1000;
```

Reutilizar `state.syncedAt` cuando sea reciente y `force` sea falso. En caso contrario envolver `callAppsScript("syncNetSuitePlanningData")` con `PlanningWorkflowCore.withTimeout`. Ante timeout/error, continuar solo si `hasPlanningData(state, state.selectedOts)` es verdadero. El `finally` debe liberar `netSuitePlanningSyncInFlight` y restablecer el botón.

- [ ] **Step 4: Limpiar exclusivamente el borrador antes del motor**

En `scheduleCurrentPlan`, después de validar configuración y antes de `PlannerCore.schedulePlan`, reemplazar el estado por `PlanningWorkflowCore.prepareDraftForReschedule(state, readyOts)`. Mantener snapshots e históricos fuera de esta función. Mostrar el plan calculado antes de `persistPlanSnapshot`; iniciar la persistencia sin mantener el botón bloqueado y notificar fallos.

- [ ] **Step 5: Forzar actualización manual**

El handler del botón `Sincronizar` debe llamar `ensurePlanningDataLoaded(true, { force: true })`; la generación automática usará `force: false`.

- [ ] **Step 6: Verificar GREEN**

Run: `npm.cmd test`

Expected: todas PASS.

Run: `npm.cmd run check`

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/web/planning/app.js tests/build.test.mjs
git commit -m "Evitar bloqueo al sincronizar NetSuite"
```

### Task 3: Completar, reabrir, filtrar y excluir carga

**Files:**
- Modify: `src/web/planning/app.js:3936-4295`
- Modify: `src/web/planning/planner-core.js:45-190`
- Modify: `tests/planner-core.test.mjs`
- Modify: `tests/planning-workflow-core.test.mjs`

**Interfaces:**
- Consumes: `filterOperationsByPlanStatus` y `classifyReportOperation`.
- Produces: planes de operador y ajustador con acciones `Completar`/`Reabrir`, filtros coherentes y operaciones completadas excluidas del cálculo de capacidad pendiente.

- Consumes adicional: una sucesora de subcontrato debe usar el fin real de su predecesora como inicio mínimo.

- [ ] **Step 1: Escribir prueba RED del motor**

Añadir a `tests/planner-core.test.mjs` una operación `COMPLETADA_PLAN` con fechas y otra pendiente. Afirmar que la completada conserva fechas, no aparece en `lastSchedule.scheduled`, no ocupa operador/máquina y la pendiente puede iniciar al comienzo de la ventana.

Añadir una OT con subcontrato de 15 días seguido de una operación productiva y horizonte de 5 días. Afirmar que el subcontrato termina fuera del horizonte y que la sucesora nunca inicia antes de ese fin. La sucesora puede quedar fuera del Gantt/sin programar dentro del horizonte, pero jamás regresar al inicio de la ventana.

- [ ] **Step 2: Escribir prueba RED de filtros**

En `planning-workflow-core.test.mjs`, probar filas con `PENDIENTE` y `COMPLETADA_PLAN`: cada filtro devuelve solo el conjunto esperado y `TODAS` devuelve ambos sin duplicar.

- [ ] **Step 3: Verificar RED**

Run: `node --test tests/planner-core.test.mjs tests/planning-workflow-core.test.mjs`

Expected: al menos una aserción FAIL por capacidad o filtro.

- [ ] **Step 4: Implementar estado y carga**

Usar `isPlanCompletedOperation` como exclusión previa a cualquier siembra de recursos, carga, métricas pendientes y reprogramación. Mantener la operación completada en el resultado sin alterar sus fechas.

- [ ] **Step 5: Implementar acciones y filtros**

Reutilizar `planStatusActionCell`/`bindPlanStatusActions` en operador y ajustador. La celda debe mostrar `Completar` para pendiente y `Reabrir` para completada. Persistir primero en cliente, guardar backend en segundo plano y revertir con mensaje si falla. `filteredReportRows` debe delegar el estado al helper puro.

- [ ] **Step 6: Asegurar impresión filtrada**

Antes de imprimir, renderizar el reporte activo desde el filtro actual. Los estilos `@media print` deben imprimir solo el panel activo y su `<tbody>` ya filtrado; no usar filas ocultas por CSS como fuente de impresión.

- [ ] **Step 7: Verificar GREEN**

Run: `npm.cmd test`

Expected: todas PASS.

- [ ] **Step 8: Commit**

```bash
git add src/web/planning/app.js src/web/planning/planner-core.js tests/planner-core.test.mjs tests/planning-workflow-core.test.mjs
git commit -m "Completar y reabrir operaciones del plan"
```

### Task 4: Cobertura de reportes y estado del PDF

**Files:**
- Modify: `src/web/planning/app.js:3936-4295`
- Modify: `src/web/planning/app.js:3480-3530`
- Modify: `src/web/planning/styles.css`
- Modify: `tests/build.test.mjs`
- Modify: `tests/planning-workflow-core.test.mjs`

**Interfaces:**
- Consumes: `reportCoverageIssues` y filtros activos.
- Produces: diagnósticos de operaciones sin/duplicadas categorías y botón PDF con ciclo `Generar PDF` → `Generando…` → restaurado.

- [ ] **Step 1: Escribir pruebas RED**

Añadir casos de cobertura para productiva, cambio y subcontrato, más una operación inválida. En build test afirmar que el HTML contiene `Generando...`, `aria-busy` y `reportCoverageIssues`.

- [ ] **Step 2: Verificar RED**

Run: `node --test tests/planning-workflow-core.test.mjs tests/build.test.mjs`

Expected: FAIL por integración PDF ausente.

- [ ] **Step 3: Integrar cobertura**

Al renderizar reportes, calcular cobertura sobre operaciones pendientes programadas. Añadir diagnósticos a alertas del plan con OT, secuencia, descripción y categorías. No duplicar operaciones entre tablas.

Actualizar selectores de fuente: `Plan` debe incluir `Borrador`; el plan semanal usa la fuente seleccionada y conserva semana. Operador, ajustador y subcontrato usan fecha inicial más un selector limitado a `1..5` días, ordenan cronológicamente y recortan a 25 filas sin aviso adicional.

- [ ] **Step 4: Implementar estado del PDF**

En el handler, capturar texto original, deshabilitar el botón, establecer `aria-busy="true"` y texto `Generando...`; envolver snapshot, render y apertura en `try/finally`; en `finally` restaurar texto, habilitación y quitar `aria-busy`.

Añadir encabezado de impresión con plan, rango/filtro y fecha/hora actual. Aplicar `@page { size: A4 landscape; }`, márgenes compactos, encabezado repetible, máximo 25 filas y `break-inside: avoid` para que cada reporte operativo quepa en una hoja.

### Task 4A: Preparación de OT y bloqueo mutuo

**Files:**
- Modify: `src/web/planning/app.js`
- Modify: `src/web/planning/index.template.html`
- Modify: `tests/build.test.mjs`

**Interfaces:**
- Consumes: catálogo del artículo y `otConfigurations`.
- Produces: modal precargado al agregar al plan y controles Generar/Sincronizar mutuamente excluyentes.

- [ ] **Step 1: Pruebas RED**

Comprobar en el build los nuevos contratos: precio opcional con `min="0"`, ausencia de piezas/monto en el modal, precarga de subcontrato y doblado, `Cancelar` sin navegación, y funciones compartidas que actualicen ambos botones ocupados.

- [ ] **Step 2: Implementar preparación**

Forzar confirmación al agregar si la OT contiene subcontrato o doblado, aunque exista configuración completa. Precargar desde la configuración de OT y luego desde el último catálogo del artículo. Precio vacío o cero es válido. Eliminar piezas pendientes/monto estimado. Separar callbacks `Cancelar` e `Ir a matriz`.

- [ ] **Step 3: Implementar exclusión mutua**

Centralizar el estado ocupado de planificación/sincronización; al programar deshabilitar Sincronizar, y al sincronizar deshabilitar Generar. Restaurar en `finally` y evitar doble solicitud.

- [ ] **Step 4: Eliminar Balancear**

Retirar el botón de la plantilla y cualquier binding inaccesible asociado, sin alterar cálculos de carga.

- [ ] **Step 5: Verificar y commit**

Run: `npm.cmd test`, `npm.cmd run check`, `npm.cmd run build`, `git diff --check`.

Commit:

```bash
git add src/web/planning/app.js src/web/planning/index.template.html tests/build.test.mjs
git commit -m "Preparar OTs y coordinar acciones del plan"
```

- [ ] **Step 5: Verificar suite y build**

Run: `npm.cmd test`

Expected: todas PASS.

Run: `npm.cmd run check`

Expected: exit 0.

Run: `npm.cmd run build`

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/web/planning/app.js src/web/planning/styles.css tests/build.test.mjs tests/planning-workflow-core.test.mjs
git commit -m "Validar reportes y mostrar progreso del PDF"
```

### Task 5: Validación integral y publicación

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: frontend construido y backend existente.
- Produces: evidencia en producción del flujo OT 1325.

- [ ] **Step 1: Verificación local final**

Run: `npm.cmd ci`, `npm.cmd test`, `npm.cmd run check`, `npm.cmd run build`, `git diff --check`.

Expected: exit 0 en todos.

- [ ] **Step 2: Publicar rama aprobada en `main`**

Integrar mediante avance rápido o PR aprobado y ejecutar `git push origin main`.

- [ ] **Step 3: Esperar GitHub Pages**

Comprobar que la URL pública contiene `PlanningWorkflowCore` y el commit nuevo.

- [ ] **Step 4: Validar navegador**

En sesión limpia: seleccionar OT 1325, configurar MAKA 15 días, generar plan, verificar que el control se libera en máximo 15 segundos si NetSuite no responde y que el subcontrato termina 15 días hábiles después. Completar/reabrir una operación, probar tres filtros e impresión, y confirmar `Generando...` en PDF. Revisar consola y capturar evidencia.
