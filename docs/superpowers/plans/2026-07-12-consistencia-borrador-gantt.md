# Consistencia del borrador y Gantt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir y demostrar los seis defectos aprobados del borrador, Gantt, preparación, operaciones completadas, doblado/herramental y exportación.

**Architecture:** `state.selectedOts` será la frontera autoritativa del borrador. La lógica filtrable y comprobable se extraerá a funciones puras de `planning-workflow-core.js`; `app.js` quedará responsable de eventos, modales y renderizado. El motor conservará toda operación productiva o emitirá un diagnóstico explícito.

**Tech Stack:** JavaScript ES modules, DOM sin framework, Node test runner, GitHub Pages.

## Global Constraints

- No borrar operaciones ni configuración reutilizable al devolver una OT al backlog.
- Las versiones publicadas son de solo lectura.
- Precio vacío o `0` es válido.
- Una operación completada sigue visible en detalle, pero no consume capacidad ni aparece en vistas pendientes.
- Ninguna prueba puede usar afirmaciones vacías como `assert.ok(true)`.

---

### Task 1: Estado único de la vista Gantt

**Files:**
- Modify: `src/web/planning/planning-workflow-core.js`
- Modify: `src/web/planning/app.js`
- Test: `tests/planning-workflow-core.test.mjs`

**Interfaces:**
- Produces: `normalizeGanttView(view): "job"|"ct"|"machine"|"operator"` y `isActiveGanttView(current, candidate): boolean`.

- [ ] **Step 1: Write the failing tests** para las cuatro vistas, valor inválido, botón activo único y persistencia tras exportar/importar estado.
- [ ] **Step 2: Run test to verify it fails**

  Run: `node --test tests/planning-workflow-core.test.mjs`
  Expected: FAIL porque los helpers aún no existen.

- [ ] **Step 3: Implement the minimal helpers** y hacer que clic, render, importación y agrupación lean exclusivamente `state.ganttView`; invalidar `state._ganttGroupsCache` al cambiar.
- [ ] **Step 4: Run the test**; expected: PASS.
- [ ] **Step 5: Commit** `fix: keep gantt view state synchronized`.

### Task 2: Selección vigente y preparación idempotente

**Files:**
- Modify: `src/web/planning/planning-workflow-core.js`
- Modify: `src/web/planning/app.js`
- Test: `tests/planning-workflow-core.test.mjs`

**Interfaces:**
- Produces: `isOtEligibleForDraft(state, ot): boolean`, `removeOtFromDraft(state, ot): state`, `missingPreparationRequirements(state, ot): string[]`.

- [ ] **Step 1: Write failing tests** que retiren una OT y verifiquen que sale de `selectedOts`, prioridades, bloqueos y `lastSchedule.scheduledOts`, pero conserva operaciones/configuración; simular además que se retira durante un `await` y confirmar que nunca abre modal ni se programa.
- [ ] **Step 2: Run test**; expected: FAIL en selección asíncrona e idempotencia.
- [ ] **Step 3: Implement** los helpers y volver a validar `isOtEligibleForDraft` antes de cada preparación y después de cada `await`. Abrir el modal solo si `missingPreparationRequirements` devuelve campos; no considerar precio vacío/0 faltante.
- [ ] **Step 4: Run test**; expected: PASS.
- [ ] **Step 5: Commit** `fix: scope preparation to current draft selection`.

### Task 3: Completar y reabrir desde Detalle de OT

**Files:**
- Modify: `src/web/planning/planning-workflow-core.js`
- Modify: `src/web/planning/app.js`
- Test: `tests/planning-workflow-core.test.mjs`

**Interfaces:**
- Produces: `setDraftOperationCompletion(op, completed, timestamp): operation`, `isPendingDraftOperation(op): boolean`.

- [ ] **Step 1: Write failing tests** para completar/reabrir, preservar fechas/recursos históricos y excluir completadas de programación, Gantt, cargas y reportes pendientes.
- [ ] **Step 2: Run test**; expected: FAIL.
- [ ] **Step 3: Implement** botones `Completar`/`Reabrir` solo en borrador; mostrar etiqueta `Completada` en detalle y aplicar `isPendingDraftOperation` en todas las proyecciones operativas.
- [ ] **Step 4: Run test**; expected: PASS.
- [ ] **Step 5: Commit** `feat: complete draft operations from job detail`.

### Task 4: Doblado y cambio de herramental verificables

**Files:**
- Modify: `src/web/planning/planner-core.js`
- Modify: `src/web/planning/app.js`
- Test: `tests/planner-core.test.mjs`

**Interfaces:**
- Produces: operación `CAMBIO_HERRAMENTAL` con `maquina`, `operador` ajustador, `herramentalOrigen`, `herramentalDestino`, `inicio`, `fin`; operación no ubicable con `status: "UNSCHEDULED"` y `diagnostico`.

- [ ] **Step 1: Write a real failing scenario** con dos OTs, misma dobladora, kits distintos y ajustador único. Afirmar que existen ambas operaciones productivas, exactamente un cambio, destino correcto y que el segundo doblado inicia después del cambio.
- [ ] **Step 2: Add failing diagnostic test** quitando el ajustador o capacidad; afirmar OT, secuencia y causa concreta, sin `assert.ok(true)`.
- [ ] **Step 3: Run tests**; expected: FAIL mostrando la operación o transición perdida.
- [ ] **Step 4: Fix the scheduling transition** sin saltar la operación productiva; reservar máquina y ajustador durante el cambio y emitir `UNSCHEDULED` cuando no haya hueco/recurso.
- [ ] **Step 5: Run** `node --test tests/planner-core.test.mjs`; expected: PASS.
- [ ] **Step 6: Commit** `fix: preserve bending operations across tool changes`.

### Task 5: Fuentes de reportes y exportación del borrador

**Files:**
- Modify: `src/web/planning/planning-workflow-core.js`
- Modify: `src/web/planning/app.js`
- Test: `tests/planning-workflow-core.test.mjs`

**Interfaces:**
- Produces: `operationalPlanOptions(snapshots): option[]`, `draftExportOperations(state): operation[]`.

- [ ] **Step 1: Write failing tests** que acepten solo `Borrador` y snapshots `PUBLICADO`; construir mezcla de OT seleccionada/backlog, pendiente/completada, programada/no programada y afirmar que CSV incluye únicamente seleccionadas, pendientes y con inicio/fin.
- [ ] **Step 2: Run test**; expected: FAIL.
- [ ] **Step 3: Implement** ambos helpers y hacer que `Exportar` siempre use `draftExportOperations(state)`, aunque el reporte visible sea publicado.
- [ ] **Step 4: Run test**; expected: PASS.
- [ ] **Step 5: Commit** `fix: export current scheduled draft snapshot`.

### Task 6: Regresión integrada, navegador y publicación

**Files:**
- Modify: `tests/planning-workflow-core.test.mjs`
- Modify: `tests/planner-core.test.mjs`
- Modify: `docs/superpowers/specs/2026-07-12-consistencia-borrador-gantt-design.md` only if behavior discovered during QA requires clarification.

**Interfaces:**
- Consumes: all helpers and UI behavior from Tasks 1–5.

- [ ] **Step 1: Run full suite**

  Run: `node --test tests/*.test.mjs`
  Expected: all tests PASS, zero skipped/fake assertions.

- [ ] **Step 2: Run static checks**

  Run: `git diff --check`
  Expected: no output.

- [ ] **Step 3: Browser QA at `http://localhost:4173/`**: switch all four Gantt views; remove an OT while preparing; regenerate without repeated modal; complete/reopen from draft detail; schedule two bending OTs with different kits; verify report selector and CSV; inspect console for errors.
- [ ] **Step 4: Verify production build/local static serving** with the repository's documented command and repeat the critical draft/report flow.
- [ ] **Step 5: Commit** `test: verify draft gantt workflow end to end`.
- [ ] **Step 6: Push only after evidence**

  Run: `git status -sb` then `git log --oneline origin/main..HEAD` then `git push origin main`.
  Expected: clean worktree; intended commits only; push updates `main`.
- [ ] **Step 7: Verify GitHub Pages** loads the pushed commit and repeat Gantt switch plus draft export smoke tests.

## Self-review

- Spec coverage: Tasks 1–5 map one-to-one to Gantt, selection/preparation, completion, bending/tooling, reports/export; Task 6 covers browser and publication.
- Placeholder scan: no deferred implementation or empty assertions.
- Type consistency: all UI consumers use the pure helpers declared in their producing task.
