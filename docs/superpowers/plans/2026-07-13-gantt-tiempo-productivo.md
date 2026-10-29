# Gantt con tiempo productivo e intervalo real Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mantener el intervalo real completo de las operaciones en el Gantt y mostrar por separado el tiempo productivo y el tiempo no operativo.

**Architecture:** El motor seguirá asignando trabajo mediante segmentos dentro de las ventanas operativas y almacenará un único inicio y fin reales. La presentación calculará el tiempo productivo mediante `operationDuration(op)` y el tiempo no operativo como la diferencia no negativa entre el intervalo real y la duración productiva, sin alterar cargas ni reportes.

**Tech Stack:** JavaScript sin framework, Node.js test runner, HTML/CSS estático y build de GitHub Pages.

## Global Constraints

- La barra cubre desde el inicio real hasta el fin real.
- La etiqueta muestra únicamente minutos productivos.
- El tooltip muestra inicio, fin, tiempo productivo y tiempo no operativo.
- Las cargas y reportes no contabilizan pausas, noches ni días no laborables.
- No se cambia la escala diaria del Gantt a 24 horas.
- No se divide la barra en segmentos de colores.

---

### Task 1: Proteger la asignación segmentada del motor

**Files:**
- Modify: `tests/planner-core.test.mjs`
- Verify: `src/web/planning/planner-core.js`

**Interfaces:**
- Consumes: `PlannerCore.schedulePlan(state, options)`.
- Produces: pruebas de regresión que fijan fechas reales y duración productiva para interrupciones intradía y fines de semana.

- [ ] **Step 1: Escribir la prueba fallida del periodo no operativo intradía**

Agregar a `tests/planner-core.test.mjs`:

```js
test("una pausa desplaza el fin sin aumentar la duracion productiva", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["1"],
    operations: [{ id: "op", ot: "1", secuencia: 1, ct: "CT", descripcion: "OP", estatus: "PLAN", operador: "OP 1", tiempoCiclo: 20, cantidadPendiente: 1 }],
    workOrders: [{ ot: "1" }],
    matrix: { "CT::OP": ["OP 1"] },
    configuredCapabilities: ["CT::OP"],
    operators: ["OP 1"],
    calendarExceptions: [{ concept: "GENERAL", startDate: "2026-07-13", endDate: "2026-07-13", start: "15:00", end: "15:05", active: true }],
    settings: { optimizationPasses: 1, finiteCapacity: false },
    workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 2, executionTime: "2026-07-13T14:50:00" });
  const operation = result.operations.find((item) => item.id === "op");
  assert.deepEqual([operation.fechaInicio, operation.horaInicio, operation.fechaFin, operation.horaFin], ["2026-07-13", "14:50", "2026-07-13", "15:15"]);
  assert.equal(core.operationDuration(operation), 20);
});
```

- [ ] **Step 2: Ejecutar la prueba y registrar su estado actual**

Run: `node --test --test-name-pattern="una pausa desplaza" tests/planner-core.test.mjs`

Expected: PASS si el motor actual ya respeta el calendario. Si falla, el resultado debe mostrar qué fecha o duración contradice la especificación antes de modificar producción.

- [ ] **Step 3: Escribir la prueba del fin de semana**

Agregar:

```js
test("una operacion cruza dias no laborables conservando minutos productivos", () => {
  const core = loadPlannerCore();
  const workSchedule = Object.fromEntries(["MON", "TUE", "WED", "THU", "FRI"].map((day) => [day, { enabled: true, start: "07:00", end: "17:00" }]));
  workSchedule.SAT = { enabled: false };
  workSchedule.SUN = { enabled: false };
  const result = core.schedulePlan({
    selectedOts: ["1"],
    operations: [{ id: "op-weekend", ot: "1", secuencia: 1, ct: "CT", descripcion: "OP", estatus: "PLAN", operador: "OP 1", tiempoCiclo: 20, cantidadPendiente: 1 }],
    workOrders: [{ ot: "1" }], matrix: { "CT::OP": ["OP 1"] }, configuredCapabilities: ["CT::OP"], operators: ["OP 1"],
    settings: { optimizationPasses: 1, finiteCapacity: false }, workSchedule,
  }, { planStart: "2026-07-17", horizonDays: 5, executionTime: "2026-07-17T16:50:00" });
  const operation = result.operations.find((item) => item.id === "op-weekend");
  assert.deepEqual([operation.fechaInicio, operation.horaInicio, operation.fechaFin, operation.horaFin], ["2026-07-17", "16:50", "2026-07-20", "07:10"]);
  assert.equal(core.operationDuration(operation), 20);
});
```

- [ ] **Step 4: Ejecutar ambas pruebas**

Run: `node --test --test-name-pattern="pausa desplaza|cruza dias no laborables" tests/planner-core.test.mjs`

Expected: 2 PASS. Si alguna falla, ajustar únicamente `allocateWork()` en `src/web/planning/planner-core.js` para consumir minutos dentro de `effectiveWindows()` y conservar `start`/`end` reales; no modificar cargas ni reportes.

- [ ] **Step 5: Commit**

```bash
git add tests/planner-core.test.mjs src/web/planning/planner-core.js
git commit -m "Probar operaciones a traves del calendario"
```

### Task 2: Separar duración productiva e intervalo real en el Gantt

**Files:**
- Modify: `src/web/planning/app.js`
- Modify: `tests/build.test.mjs`

**Interfaces:**
- Consumes: `operationDuration(op)`, `opStart(op)`, `opEnd(op)` y `diffMinutes(start, end)`.
- Produces: `ganttOperationTiming(op, start, end) -> { productiveMinutes, elapsedMinutes, nonOperatingMinutes }`.

- [ ] **Step 1: Escribir la prueba fallida del contrato visual**

Agregar en `tests/build.test.mjs`, después de leer `pagesIndex`:

```js
assert.match(pagesIndex, /function ganttOperationTiming\(op, start, end\)/);
assert.match(pagesIndex, /productiveMinutes:\s*Math\.max\(MIN_OPERATION_MINUTES, operationDuration\(op\)\)/);
assert.match(pagesIndex, /nonOperatingMinutes:\s*Math\.max\(0, elapsedMinutes - productiveMinutes\)/);
assert.match(pagesIndex, /min productivos/);
assert.match(pagesIndex, /min no operativos/);
```

- [ ] **Step 2: Ejecutar la prueba para confirmar el fallo**

Run: `node --test tests/build.test.mjs`

Expected: FAIL porque `ganttOperationTiming` y los nuevos textos todavía no existen.

- [ ] **Step 3: Implementar el cálculo independiente**

Agregar antes de `createGanttBar` en `src/web/planning/app.js`:

```js
function ganttOperationTiming(op, start, end) {
  const productiveMinutes = Math.max(MIN_OPERATION_MINUTES, operationDuration(op));
  const elapsedMinutes = Math.max(productiveMinutes, diffMinutes(start, end));
  return {
    productiveMinutes,
    elapsedMinutes,
    nonOperatingMinutes: Math.max(0, elapsedMinutes - productiveMinutes),
  };
}
```

- [ ] **Step 4: Usar el intervalo para el ancho y el tiempo productivo para el texto**

En `createGanttBar`, sustituir el cálculo y contenido actual por:

```js
const timing = ganttOperationTiming(op, start, end);
bar.title = `${op.ot} / Sec ${op.secuencia} - CT ${op.ct} - ${op.operador}${materialBase ? ` - Material ${materialBase}` : ""} - ${timing.productiveMinutes} min productivos - ${timing.nonOperatingMinutes} min no operativos - ${formatDateTime(start)} a ${formatDateTime(end)}`;
bar.innerHTML = `<strong>Sec ${escapeHtml(op.secuencia)}</strong><span>${escapeHtml(op.ot)} / ${timing.productiveMinutes} min productivos</span>`;
```

Conservar `startMin`, `endMin`, `widthMin`, `left` y `width` basados en `start` y `end`, de modo que el ancho siga representando el intervalo real.

- [ ] **Step 5: Ejecutar pruebas específicas**

Run: `node --test tests/build.test.mjs tests/planner-core.test.mjs`

Expected: todas las pruebas PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/planning/app.js tests/build.test.mjs
git commit -m "Mostrar tiempo productivo en el Gantt"
```

### Task 3: Verificación integral y publicación

**Files:**
- Verify: `src/web/planning/app.js`
- Verify: `src/web/planning/planner-core.js`
- Verify: `tests/build.test.mjs`
- Verify: `tests/planner-core.test.mjs`

**Interfaces:**
- Consumes: build estático y aplicación en `http://localhost:4173/`.
- Produces: evidencia automatizada y visual del comportamiento aprobado.

- [ ] **Step 1: Ejecutar la suite completa**

Run: `npm.cmd test`

Expected: 0 fallos.

- [ ] **Step 2: Generar el build**

Run: `npm.cmd run build`

Expected: Apps Script y GitHub Pages generados sin errores.

- [ ] **Step 3: Revisar formato del diff**

Run: `git diff --check`

Expected: sin errores.

- [ ] **Step 4: QA en navegador**

Abrir `http://localhost:4173/#plan-semanal`, generar o cargar un borrador con una operación que cruce una excepción y verificar:

```text
Barra: cubre el inicio y fin reales.
Etiqueta: N min productivos.
Tooltip: N min productivos, M min no operativos, inicio y fin.
Consola: sin errores ni advertencias relacionadas.
```

- [ ] **Step 5: Publicar**

```bash
git push origin main
```

Expected: la rama `main` remota recibe los commits verificados.
