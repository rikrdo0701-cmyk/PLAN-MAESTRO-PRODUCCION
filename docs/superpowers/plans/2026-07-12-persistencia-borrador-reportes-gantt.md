# Persistencia del borrador, reportes y Gantt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restaurar el borrador como una unidad coherente, elegir correctamente la fuente de planes diarios y verificar las vistas Gantt y el doblado real.

**Architecture:** La lógica de elección y validación de instantáneas vivirá en funciones puras de `planning-workflow-core.js`. `app.js` persistirá/restaurará una sola instantánea completa y proyectará desde ella el Gantt y los reportes. `planner-core.js` conservará operaciones de doblado o emitirá un diagnóstico específico.

**Tech Stack:** JavaScript, DOM sin framework, localStorage/Google Apps Script, Node test runner, GitHub Pages.

## Global Constraints

- Nunca mezclar `selectedOts` de una revisión con operaciones u órdenes de otra.
- Sincronizar NetSuite no sustituye silenciosamente la programación del borrador.
- Plan diario predeterminado: último `PUBLICADO`; si no existe, `Borrador`.
- Exactamente un botón Gantt tendrá `aria-selected="true"`.
- Una operación de doblado no puede desaparecer sin resultado o diagnóstico.

---

### Task 1: Elegir y validar una instantánea completa

**Files:**
- Modify: `src/web/planning/planning-workflow-core.js`
- Test: `tests/planning-workflow-core.test.mjs`

**Interfaces:**
- Produces: `draftSnapshot(state): DraftSnapshot`, `isCoherentDraft(snapshot): boolean`, `selectNewestCoherentDraft(local, remote): DraftSnapshot|null`.

- [ ] **Step 1: Write failing tests** con un borrador local completo, uno remoto más nuevo, una mezcla inválida donde `selectedOts` no tiene órdenes/operaciones y empates resueltos por `revision`, después `savedAt`.
- [ ] **Step 2: Run** `node --test tests/planning-workflow-core.test.mjs`; expected: FAIL porque las funciones no existen.
- [ ] **Step 3: Implement** el snapshot con `operations`, `workOrders`, selección, prioridades, configuraciones, estados completados, vista Gantt y `lastSchedule`; validar que cada OT seleccionada tenga orden y operaciones.
- [ ] **Step 4: Run the test**; expected: PASS.
- [ ] **Step 5: Commit** `feat: select coherent draft snapshots`.

### Task 2: Restaurar y guardar el borrador sin mezclar revisiones

**Files:**
- Modify: `src/web/planning/app.js`
- Modify: `scripts/build-appscript.mjs`
- Test: `tests/build.test.mjs`
- Test: `tests/planning-workflow-core.test.mjs`

**Interfaces:**
- Consumes: `draftSnapshot`, `isCoherentDraft`, `selectNewestCoherentDraft`.
- Produces: `captureLocalPlanningState()` y `restoreLocalPlanningState(snapshot)` trabajando sobre la unidad completa.

- [ ] **Step 1: Write failing tests** que simulen recarga y demuestren que operaciones, `workOrders`, selección, prioridad, fechas, herramientas y Gantt sobreviven juntos; comprobar que un import compartido no reemplaza solo `operations`.
- [ ] **Step 2: Run tests**; expected: FAIL por pérdida de `operations`/`workOrders`.
- [ ] **Step 3: Implement** captura completa, selección local/remota por revisión/fecha y alerta `Borrador recuperado`; bloquear guardado/publicación si no hay snapshot coherente.
- [ ] **Step 4: Run tests**; expected: PASS.
- [ ] **Step 5: Commit** `fix: restore the draft as one coherent snapshot`.

### Task 3: Fuente predeterminada de planes diarios

**Files:**
- Modify: `src/web/planning/planning-workflow-core.js`
- Modify: `src/web/planning/app.js`
- Test: `tests/planning-workflow-core.test.mjs`

**Interfaces:**
- Produces: `defaultDailyPlanSource(snapshots, draft): {type:"published"|"draft", snapshotId:string}`.

- [ ] **Step 1: Write failing tests**: sin publicados devuelve borrador; con varios publicados devuelve el de `publishedAt`/`generatedAt` más reciente; ignora guardados.
- [ ] **Step 2: Run test**; expected: FAIL.
- [ ] **Step 3: Implement** el helper y usarlo al cargar Operador, Ajustador y Subcontratos; mantener la selección manual y el selector limitado.
- [ ] **Step 4: Run test**; expected: PASS.
- [ ] **Step 5: Commit** `fix: default daily reports to latest published plan`.

### Task 4: Estado verificable de las cuatro vistas Gantt

**Files:**
- Modify: `src/web/planning/app.js`
- Modify: `src/web/planning/template.html`
- Test: `tests/build.test.mjs`

**Interfaces:**
- Produces: `setGanttView(view)` que actualiza estado, agrupación, clase y `aria-selected`.

- [ ] **Step 1: Write a failing generated-page test** que exija `setGanttView`, cuatro controles con valores únicos y restauración desde estado persistido.
- [ ] **Step 2: Run** `node --test tests/build.test.mjs`; expected: FAIL.
- [ ] **Step 3: Implement** un manejador único, inicialización segura antes/después de `DOMContentLoaded` y `aria-selected` inicial en plantilla.
- [ ] **Step 4: Build and run test**; expected: PASS.
- [ ] **Step 5: Browser QA**: hacer clic OT → Operador → Máquina → CT, comprobar exactamente un seleccionado, recargar y confirmar CT.
- [ ] **Step 6: Commit** `fix: persist and expose active gantt view`.

### Task 5: Doblado real y diagnóstico visible

**Files:**
- Modify: `src/web/planning/planner-core.js`
- Modify: `src/web/planning/app.js`
- Test: `tests/planner-core.test.mjs`

**Interfaces:**
- Produces: `CAMBIO_HERRAMENTAL` completo o `UNSCHEDULED` con `ot`, `sequence`, `cause` y recurso faltante.

- [ ] **Step 1: Extend the deterministic test** para afirmar duración, origen/destino, ajustador, máquina y precedencia de ambas operaciones productivas.
- [ ] **Step 2: Add a fixture** con campos reales de CT 5459/5527, máquina, herramienta y kit usados por la aplicación; expected initially FAIL si la normalización descarta el doblado.
- [ ] **Step 3: Implement minimal normalization/scheduling fix** y proyectar diagnósticos en alertas visibles.
- [ ] **Step 4: Run** `node --test tests/planner-core.test.mjs`; expected: PASS sin afirmaciones vacías.
- [ ] **Step 5: Commit** `fix: preserve real bending and tool change operations`.

### Task 6: Verificación y publicación

**Files:**
- Test: `tests/build.test.mjs`
- Test: `tests/planner-core.test.mjs`
- Test: `tests/planning-workflow-core.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–5.

- [ ] **Step 1: Run** `node --test tests/*.test.mjs`; expected: zero failures.
- [ ] **Step 2: Run** `npm.cmd run build` and `node --check src/web/planning/app.js`; expected: exit 0.
- [ ] **Step 3: Run** `git diff --check`; expected: no output.
- [ ] **Step 4: QA local and GitHub Pages**: recargar borrador, verificar listas/KPI/Gantt coherentes, fuente diaria, cuatro vistas, doblado y consola sin errores.
- [ ] **Step 5: Commit/push** solo los archivos revisados y confirmar `git status -sb` igual a `main...origin/main`.

## Self-review

- Cobertura: persistencia Task 1–2, reportes Task 3, Gantt Task 4, doblado Task 5, publicación Task 6.
- Sin marcadores ni afirmaciones vacías.
- Las interfaces de snapshot y fuente diaria son puras y reutilizadas por la aplicación.
