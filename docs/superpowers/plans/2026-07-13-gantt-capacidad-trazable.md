# Gantt y capacidad trazable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar ocupaciones fantasma, conservar OTs bloqueadas seleccionadas, explicar las esperas y separar tiempo productivo del intervalo real en el Gantt.

**Architecture:** `selectedOts` será la frontera explícita del borrador programable. El motor reconstruirá sus mapas de ocupación con operaciones seleccionadas pendientes, conservará únicamente bloqueos seleccionados y añadirá metadatos de origen a cada intervalo; la UI impedirá retirar bloqueos y presentará duración productiva, tiempo no operativo y causa de espera.

**Tech Stack:** JavaScript sin framework, Node.js test runner, build estático Apps Script/GitHub Pages.

## Global Constraints

- Solo OTs seleccionadas en `Planeado / Por planear` consumen capacidad.
- Las OTs bloqueadas seleccionadas conservan exactamente su programación.
- Una OT bloqueada no puede volver al backlog hasta desbloquearse.
- Operaciones completadas, no seleccionadas y cambios antiguos no reservan recursos.
- La barra cubre el intervalo real y muestra minutos productivos.
- Las cargas y reportes usan tiempo productivo.

---

### Task 1: Limitar capacidad al borrador autorizado

**Files:**
- Modify: `tests/planner-core.test.mjs`
- Modify: `src/web/planning/planner-core.js`

**Interfaces:**
- Consumes: `state.selectedOts`, `isFixedOperation(op)`, `isPlanCompletedOperation(state, op)`.
- Produces: `isAuthorizedPlanOperation(op) -> boolean` dentro de `schedulePlanOnce`.

- [ ] **Step 1: Escribir prueba fallida para una operación fantasma no seleccionada**

Agregar una prueba con OT 100 fechada y bloqueada de 07:00–12:00, OT 200 seleccionada con el mismo operador y una operación de 20 minutos. Afirmar que OT 200 inicia a las 07:00 y que OT 100 no aparece en `lastSchedule.scheduledOts`.

```js
assert.deepEqual([pending.fechaInicio, pending.horaInicio], ["2026-07-13", "07:00"]);
assert.deepEqual(result.lastSchedule.scheduledOts, ["200"]);
```

- [ ] **Step 2: Ejecutar y confirmar el fallo**

Run: `node --test --test-name-pattern="fantasma no seleccionada" tests/planner-core.test.mjs`

Expected: FAIL porque la operación fija no seleccionada todavía reserva el operador.

- [ ] **Step 3: Implementar el filtro autorizado**

En `schedulePlanOnce`, definir:

```js
const isAuthorizedPlanOperation = (op) => !selectionDefined || selectedOtsSet.has(normalizeKey(op.ot));
```

Aplicarlo a `fixed`, `movable`, `seedMachineToolHistory` y a toda inserción inicial en `operatorBusy`, `machineBusy` y `machineTools`. Mantener las no seleccionadas en `excluded` para no perder datos, pero sin capacidad.

- [ ] **Step 4: Confirmar que pasa**

Run: `node --test --test-name-pattern="fantasma no seleccionada" tests/planner-core.test.mjs`

Expected: PASS.

### Task 2: Conservar bloqueos seleccionados y rechazar retiro

**Files:**
- Modify: `tests/planner-core.test.mjs`
- Modify: `tests/planning-workflow-core.test.mjs`
- Modify: `src/web/planning/planning-workflow-core.js`
- Modify: `src/web/planning/app.js`

**Interfaces:**
- Produces: `canRemoveSelectedOt(state, ot) -> { allowed, reason }` en `PlanningWorkflowCore`.

- [ ] **Step 1: Escribir pruebas fallidas**

Probar que una OT 100 seleccionada, bloqueada y fechada 08:00–09:00 conserva sus cuatro campos de fecha/hora y obliga a OT 200 a iniciar fuera del intervalo. Probar también:

```js
assert.deepEqual(core.canRemoveSelectedOt({ lockedOts: ["100"] }, "100"), {
  allowed: false,
  reason: "Desbloquea la OT antes de retirarla del plan",
});
```

- [ ] **Step 2: Ejecutar y confirmar el fallo**

Run: `node --test tests/planner-core.test.mjs tests/planning-workflow-core.test.mjs`

Expected: FAIL por ausencia de `canRemoveSelectedOt` o por movimiento del bloqueo.

- [ ] **Step 3: Implementar contrato y usarlo en la UI**

Añadir al core:

```js
function canRemoveSelectedOt(state, ot) {
  const locked = new Set((state?.lockedOts || []).map(normalizeKey));
  return locked.has(normalizeKey(ot))
    ? { allowed: false, reason: "Desbloquea la OT antes de retirarla del plan" }
    : { allowed: true, reason: "" };
}
```

Exportarlo y consultarlo antes de toda acción o arrastre de `Planeado / Por planear` hacia backlog. Si no está permitido, mostrar `showToast(result.reason)` y no alterar estado.

- [ ] **Step 4: Ejecutar pruebas**

Run: `node --test tests/planner-core.test.mjs tests/planning-workflow-core.test.mjs`

Expected: PASS.

### Task 3: Eliminar cambios antiguos y conservar solo los actuales

**Files:**
- Modify: `tests/planner-core.test.mjs`
- Modify: `src/web/planning/planner-core.js`

**Interfaces:**
- Consumes: `generatedBy === "PLANNER_CORE_V2"` y `tipoInsercion === "CAMBIO_HERRAMENTAL"`.
- Produces: una colección `generatedChanges` creada desde cero en cada ejecución.

- [ ] **Step 1: Escribir prueba fallida**

Crear un cambio antiguo con fechas y operador `AJUSTADOR`, más una operación seleccionada que usaría el mismo recurso. Afirmar que el cambio antiguo no aparece en el resultado salvo que la nueva secuencia requiera generar uno equivalente.

- [ ] **Step 2: Ejecutar y confirmar el fallo**

Run: `node --test --test-name-pattern="cambio antiguo" tests/planner-core.test.mjs`

Expected: FAIL si el cambio antiguo se conserva o reserva capacidad.

- [ ] **Step 3: Implementar limpieza**

Excluir de `fixed` y ocupaciones todos los cambios generados anteriores que no estén completados. Conservar cambios completados solo como historial/herramienta terminada, sin añadirlos a mapas de capacidad.

- [ ] **Step 4: Ejecutar prueba**

Run: `node --test --test-name-pattern="cambio antiguo" tests/planner-core.test.mjs`

Expected: PASS.

### Task 4: Registrar la causa de cada espera

**Files:**
- Modify: `tests/planner-core.test.mjs`
- Modify: `src/web/planning/planner-core.js`

**Interfaces:**
- Produces en cada operación: `esperaMinutos`, `causaEspera`, `recursoEspera`, `otBloqueadora`, `secuenciaBloqueadora`.
- Los intervalos ocupados incluyen `operationId`, `ot`, `secuencia`, `resourceType` y `resource`.

- [ ] **Step 1: Escribir prueba fallida de conflicto real**

Programar una OT bloqueada 07:00–09:00 y otra seleccionada con el mismo operador, cuyo inicio más temprano sea 07:00. Afirmar:

```js
assert.equal(pending.esperaMinutos, 120);
assert.equal(pending.causaEspera, "OPERADOR");
assert.equal(pending.recursoEspera, "OP 1");
assert.equal(pending.otBloqueadora, "100");
assert.equal(pending.secuenciaBloqueadora, 1);
```

- [ ] **Step 2: Confirmar fallo**

Run: `node --test --test-name-pattern="registra la operacion bloqueadora" tests/planner-core.test.mjs`

Expected: FAIL porque aún no existen metadatos.

- [ ] **Step 3: Añadir metadatos a ocupaciones y asignaciones**

Extender `addBusySegments(map, resource, segments, metadata)` y preservar el origen. En `findEarliestSlot`, registrar el último conflicto que desplazó el cursor. En `commitAssignment`, calcular la diferencia entre `earliest` y `operationStart`, y copiar la causa identificada; usar `SIN_CAUSA` cuando exista diferencia sin conflicto trazable.

- [ ] **Step 4: Ejecutar prueba**

Run: `node --test --test-name-pattern="registra la operacion bloqueadora" tests/planner-core.test.mjs`

Expected: PASS.

### Task 5: Tiempo productivo, intervalo real y tooltip

**Files:**
- Modify: `tests/planner-core.test.mjs`
- Modify: `tests/build.test.mjs`
- Modify: `src/web/planning/app.js`

**Interfaces:**
- Produces: `ganttOperationTiming(op, start, end) -> { productiveMinutes, elapsedMinutes, nonOperatingMinutes }`.

- [ ] **Step 1: Agregar pruebas del calendario**

Agregar los dos casos completos definidos en `2026-07-13-gantt-tiempo-productivo.md`: pausa 15:00–15:05 con resultado 14:50–15:15 y fin de semana con resultado viernes 16:50–lunes 07:10. Afirmar `operationDuration(operation) === 20`.

- [ ] **Step 2: Agregar prueba fallida del build**

```js
assert.match(pagesIndex, /function ganttOperationTiming\(op, start, end\)/);
assert.match(pagesIndex, /min productivos/);
assert.match(pagesIndex, /min no operativos/);
assert.match(pagesIndex, /causaEspera/);
```

- [ ] **Step 3: Confirmar fallo visual**

Run: `node --test tests/build.test.mjs tests/planner-core.test.mjs`

Expected: FAIL por ausencia del helper y textos.

- [ ] **Step 4: Implementar helper y tooltip**

```js
function ganttOperationTiming(op, start, end) {
  const productiveMinutes = Math.max(MIN_OPERATION_MINUTES, operationDuration(op));
  const elapsedMinutes = Math.max(productiveMinutes, diffMinutes(start, end));
  return { productiveMinutes, elapsedMinutes, nonOperatingMinutes: Math.max(0, elapsedMinutes - productiveMinutes) };
}
```

Mantener el ancho basado en `start`/`end`. Mostrar `N min productivos` en la barra. En `title`, añadir tiempo no operativo y, cuando `esperaMinutos > 0`, causa, recurso y OT/secuencia bloqueadora.

- [ ] **Step 5: Ejecutar pruebas específicas**

Run: `node --test tests/build.test.mjs tests/planner-core.test.mjs`

Expected: PASS.

### Task 6: Verificación y publicación

**Files:**
- Verify: todos los archivos anteriores.

**Interfaces:**
- Produces: build y rama `main` verificados.

- [ ] **Step 1: Ejecutar suite completa**

Run: `npm.cmd test`

Expected: 0 fallos.

- [ ] **Step 2: Ejecutar build y revisión de diff**

Run: `npm.cmd run build`

Expected: Apps Script y GitHub Pages generados.

Run: `git diff --check`

Expected: sin errores.

- [ ] **Step 3: QA en navegador**

Verificar en `http://localhost:4173/#plan-semanal`: bloqueo inamovible, ausencia de OTs del backlog en el Gantt, tooltip con tiempo productivo/no operativo y causa de espera, y consola sin errores.

- [ ] **Step 4: Commit y push**

```bash
git add src/web/planning tests
git commit -m "Eliminar operaciones fantasma y explicar esperas"
git push origin main
```
