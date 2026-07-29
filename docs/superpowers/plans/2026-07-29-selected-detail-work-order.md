# Stable Work Order Detail Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mantener el panel ligado a la última OT pulsada, independientemente de la operación seleccionada o de respuestas asíncronas.

**Architecture:** Añadir `state.selectedDetailOt` como identidad explícita del panel. Las funciones de selección priorizarán ese folio y conservarán `selectedOperationId` únicamente para filas operativas, con compatibilidad para estados anteriores.

**Tech Stack:** JavaScript, Node.js test runner, Google Apps Script, GitHub Pages.

## Global Constraints

- No modificar el Apps Script protegido `1ew3Nqi0e8SHid_zWv1z5cl6ATCZzqVLqc2lkbfox5CMNsh8FH5tL8zKx`.
- Conservar compatibilidad con estados guardados sin `selectedDetailOt`.
- Mantener las cargas individuales y sincronizaciones existentes.

---

### Task 1: Separar la OT activa de la operación seleccionada

**Files:**
- Modify: `src/web/planning/app.js`
- Modify: `tests/performance-client-calls.test.mjs`
- Modify: `tests/build.test.mjs`

**Interfaces:**
- Consumes: `state.selectedOperationId`, `materialOtKey(value)`, `getPriorityJobs()`.
- Produces: `state.selectedDetailOt: string`, `selectedJobOt(): string`, `getSelectedPriorityJob(): object|null`.

- [ ] **Step 1: Escribir pruebas que fallen**

Agregar pruebas que abran primero 1325 y después 2773, y comprueben:

```js
openSelectedJobDetail("1325");
openSelectedJobDetail("2773");
assert.equal(state.selectedDetailOt, "2773");
assert.equal(getSelectedPriorityJob().ot, "2773");
```

Agregar una respuesta tardía de 1325 y comprobar:

```js
assert.equal(state.selectedDetailOt, "2773");
assert.equal(state.selectedOperationId, "direct-2773-1");
```

- [ ] **Step 2: Verificar el fallo**

Run: `node --test tests/performance-client-calls.test.mjs tests/build.test.mjs`

Expected: FAIL porque `selectedDetailOt` todavía no existe o 1325 vuelve a ser el detalle activo.

- [ ] **Step 3: Implementar el estado explícito**

Aplicar estas reglas en `src/web/planning/app.js`:

```js
function openSelectedJobDetail(ot) {
  const job = getPriorityJobs().find((item) => materialOtKey(item.ot) === materialOtKey(ot));
  if (!job) return;
  state.selectedDetailOt = job.ot;
  state.selectedOperationId = job.firstOp.id;
  // render y carga existentes
}
```

```js
function getSelectedPriorityJob() {
  const detailKey = materialOtKey(state.selectedDetailOt);
  const jobs = getPriorityJobs();
  if (detailKey) return jobs.find((job) => materialOtKey(job.ot) === detailKey) || null;
  // compatibilidad existente por selectedOperationId
}
```

`selectedJobOt()` priorizará `selectedDetailOt`. El cierre del panel limpiará ambos campos. La carga asíncrona comparará la OT solicitada con `selectedDetailOt` antes de cambiar `selectedOperationId`.

- [ ] **Step 4: Verificar pruebas específicas**

Run: `node --test tests/performance-client-calls.test.mjs tests/build.test.mjs`

Expected: PASS, 0 fallos.

- [ ] **Step 5: Verificar el proyecto completo**

Run: `npm.cmd test`

Expected: todas las pruebas PASS, 0 fallos.

- [ ] **Step 6: Commit**

```text
git add src/web/planning/app.js tests/performance-client-calls.test.mjs tests/build.test.mjs
git commit -m "fix: track selected detail work order explicitly"
```
