# Sincronización NetSuite en dos fases — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sincronizar OTs primero y operaciones/materiales después, conservando las OTs si la segunda consulta excede el timeout.

**Architecture:** Un orquestador puro describirá las fases y sus resultados; `app.js` ejecutará las llamadas Apps Script, aplicará cada payload de forma independiente y controlará la interfaz. La persistencia del borrador continuará usando la instantánea coherente existente.

**Tech Stack:** JavaScript, Google Apps Script bridge, NetSuite RESTlets, Node test runner, GitHub Pages.

## Global Constraints

- `syncNetSuiteWorkOrdersLite` siempre se ejecuta antes de `syncNetSuitePlanningData`.
- Un timeout de operaciones nunca revierte OTs recibidas.
- Un error de OTs no modifica el estado ni inicia operaciones.
- Generar y Sincronizar permanecen bloqueados durante ambas fases.

---

### Task 1: Modelo comprobable de resultado por fases

**Files:**
- Modify: `src/web/planning/planning-workflow-core.js`
- Test: `tests/planning-workflow-core.test.mjs`

**Interfaces:**
- Produces: `netSuiteSyncOutcome(workOrdersResult, planningResult): {status:"complete"|"partial"|"failed", message:string}`.

- [ ] **Step 1: Write failing tests** para éxito completo, timeout de operaciones y error inicial; afirmar los mensajes exactos.
- [ ] **Step 2: Run** `node --test tests/planning-workflow-core.test.mjs`; expected: FAIL por función inexistente.
- [ ] **Step 3: Implement** la función pura con los tres estados definidos.
- [ ] **Step 4: Run test**; expected: PASS.
- [ ] **Step 5: Commit** `test: define two phase NetSuite sync outcomes`.

### Task 2: Orquestar OTs y operaciones sin perder borrador

**Files:**
- Modify: `src/web/planning/app.js`
- Test: `tests/build.test.mjs`
- Test: `tests/planning-workflow-core.test.mjs`

**Interfaces:**
- Produces: `syncNetSuiteTwoPhase(): Promise<SyncOutcome>`.

- [ ] **Step 1: Write failing generated-page assertions** que exijan llamadas en orden a `syncNetSuiteWorkOrdersLite` y `syncNetSuitePlanningData`, timeout solo alrededor de la segunda y aplicación independiente de payloads.
- [ ] **Step 2: Run** `node --test tests/build.test.mjs`; expected: FAIL.
- [ ] **Step 3: Implement**: capturar borrador; llamar OTs; validar/aplicar solo `workOrders`; guardar/renderizar; llamar planning con timeout; aplicar operaciones/materiales conservando selección/configuración; devolver resultado.
- [ ] **Step 4: Run tests**; expected: PASS.
- [ ] **Step 5: Commit** `fix: synchronize NetSuite in two phases`.

### Task 3: Estados y bloqueo de interfaz

**Files:**
- Modify: `src/web/planning/app.js`
- Test: `tests/build.test.mjs`

**Interfaces:**
- Consumes: `syncNetSuiteTwoPhase`.
- Produces: etiquetas `Sincronizando OTs...` y `Sincronizando operaciones...` y desbloqueo garantizado en `finally`.

- [ ] **Step 1: Add failing assertions** para ambas etiquetas, bloqueo de Generar/Sincronizar y `finally`.
- [ ] **Step 2: Run build test**; expected: FAIL.
- [ ] **Step 3: Implement** actualización de etiqueta por fase y mensajes completo/parcial/error; eliminar mensaje ambiguo del flujo manual.
- [ ] **Step 4: Run tests**; expected: PASS.
- [ ] **Step 5: Commit** `fix: expose NetSuite synchronization phases`.

### Task 4: Verificación y publicación

**Files:**
- Test: `tests/build.test.mjs`
- Test: `tests/planning-workflow-core.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–3.

- [ ] **Step 1: Run** `node --test tests/*.test.mjs`; expected: zero failures.
- [ ] **Step 2: Run** `npm.cmd run build`, `node --check src/web/planning/app.js`, `git diff --check`; expected: exit 0/no diff errors.
- [ ] **Step 3: QA GitHub Pages**: pulsar Sincronizar, observar fase OTs, después operaciones, verificar que backlog cambia o aparece mensaje de error concreto y que ambos botones se desbloquean.
- [ ] **Step 4: Commit and push**; confirmar `main...origin/main` limpio y volver a probar la versión desplegada.

## Self-review

- Los tres resultados y la conservación del borrador están cubiertos.
- Las llamadas, mensajes y timeout tienen nombres exactos.
- No hay marcadores ni pruebas vacías.
