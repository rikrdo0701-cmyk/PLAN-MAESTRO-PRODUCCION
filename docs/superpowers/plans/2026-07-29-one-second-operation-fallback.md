# One-Second Operation Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que una OT con CT válido y operaciones sin tiempo entre al plan usando 1 segundo como duración mínima.

**Architecture:** El servidor normalizará tiempos no positivos a `1 / 60` minutos antes de validar. El cliente aplicará la misma normalización defensiva al combinar datos individuales, manteniendo como único bloqueo estructural la falta de CT.

**Tech Stack:** Google Apps Script JavaScript, navegador JavaScript, Node.js test runner.

## Global Constraints

- Solo operaciones con tiempo vacío, cero, negativo o no numérico reciben 1 segundo.
- Una operación sin CT continúa invalidando la ruta.
- No modificar NetSuite ni el proyecto de Apps Script protegido.

---

### Task 1: Normalización del servicio individual

**Files:**
- Modify: `src/server/18-planning-work-order-service.js`
- Test: `tests/planning-work-order-service.test.mjs`

**Interfaces:**
- Consumes: operaciones normalizadas por `PP_mapNetSuiteOperation_`.
- Produces: operaciones con `tiempoProd >= 1 / 60` minutos y validación basada en CT.

- [ ] **Step 1: Escribir pruebas fallidas**

Agregar casos que esperen `tiempoProd === 1 / 60` para tiempos ausentes y que confirmen que un tiempo válido permanece intacto. Actualizar el caso sin CT para esperar únicamente `sin CT`.

- [ ] **Step 2: Confirmar el fallo**

Run: `node --test tests/planning-work-order-service.test.mjs`
Expected: FAIL porque la ruta sin tiempo todavía se rechaza.

- [ ] **Step 3: Implementar lo mínimo**

Añadir:

```js
const PP_PLANNING_FALLBACK_MINUTES_ = 1 / 60;

function PP_planningOperationWithTimeFallback_(operation) {
  if (Number(operation.tiempoProd) > 0) return operation;
  return Object.assign({}, operation, { tiempoProd: PP_PLANNING_FALLBACK_MINUTES_ });
}
```

Aplicarla después del mapeo y cambiar `PP_planningIndividualOperationValid_` para exigir solo un CT distinto de `SIN_CT`.

- [ ] **Step 4: Confirmar pruebas**

Run: `node --test tests/planning-work-order-service.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/18-planning-work-order-service.js tests/planning-work-order-service.test.mjs
git commit -m "fix: allow operations without configured time"
```

### Task 2: Aceptación defensiva en el cliente

**Files:**
- Modify: `src/web/planning/app.js`
- Test: `tests/performance-client-calls.test.mjs`

**Interfaces:**
- Consumes: `payload.data.operations` del servicio individual.
- Produces: estado local con tiempos mínimos de `1 / 60` minutos y selección habilitada.

- [ ] **Step 1: Escribir prueba fallida**

Agregar una comprobación de fuente que exija una normalización del tiempo antes de `mergeIndividualPlanningData` y que la validez individual dependa del CT, no de `tiempoProd > 0`.

- [ ] **Step 2: Confirmar el fallo**

Run: `node --test tests/performance-client-calls.test.mjs`
Expected: FAIL porque el cliente todavía bloquea tiempos no positivos.

- [ ] **Step 3: Implementar lo mínimo**

Añadir:

```js
const INDIVIDUAL_PLANNING_FALLBACK_MINUTES = 1 / 60;

function normalizeIndividualPlanningOperation(operation) {
  if (Number(operation?.tiempoProd) > 0) return operation;
  return { ...operation, tiempoProd: INDIVIDUAL_PLANNING_FALLBACK_MINUTES };
}
```

Normalizar las operaciones recibidas antes de validarlas y combinarlas. Cambiar `individualPlanningOperationValid` para exigir solamente CT válido.

- [ ] **Step 4: Confirmar pruebas**

Run: `node --test tests/performance-client-calls.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/planning/app.js tests/performance-client-calls.test.mjs
git commit -m "fix: merge untimed planning operations"
```

### Task 3: Verificación integral

**Files:**
- Verify: `src/server/18-planning-work-order-service.js`
- Verify: `src/web/planning/app.js`

**Interfaces:**
- Consumes: cambios de Tasks 1 y 2.
- Produces: artefactos comprobados para publicación.

- [ ] **Step 1: Ejecutar suite completa**

Run: `npm test`
Expected: todos los tests pasan.

- [ ] **Step 2: Validar proyecto y compilación**

Run: `npm run check`
Expected: verificación y build terminan con código 0.

- [ ] **Step 3: Revisar alcance**

Run: `git diff --check HEAD~2..HEAD`
Expected: sin errores de espacios y sin cambios en el script protegido.
