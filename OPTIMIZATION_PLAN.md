# Plan de Optimización de Planeación y Balanceo de Operaciones y Cargas

## 1. Resumen Ejecutivo

Este plan implementa 6 nuevas funcionalidades críticas en el motor de planeación plangit, basándose en las reglas documentadas en `docs/REGLAS.md` y `.project-memory/rules.json`, y aprovechando la arquitectura existente en `src/web/planning/planner-core.js`.

### Qué cambia y por qué:

1. **Balanceo por recursos de la matriz (RULE-MAT-001 a RULE-MAT-009)**: Las operaciones subsiguientes ahora se balancean según la matriz `CAPACIDADES`, disponiendo operaciones para minimizar tiempos muertos y tiempo total de la OT. La matriz define qué operador puede operar qué CT (centro de trabajo).

2. **Interleaving de OTs**: En lugar de completar una OT entera antes de pasar a la siguiente, las operaciones de diferentes OT se entrelacen en el schedule, mejorando la utilización de recursos.

3. **Consideración de operadores**: El plan ahora minimiza el tiempo ocioso del operador, indicando explícitamente qué operador opera cada operación mediante el campo `operador` en las asignaciones.

4. **Validación de subcontrato como no finito**: Las operaciones con `TIPO_SUBCONTRATO` se manejan como "no finitas" - no consumen capacidad de operador/máquina del mismo modo que las operaciones normales. Tienen `DIAS_HABILES` propio y lead-time, pero no compiten por los mismos recursos en el schedule.

5. **Reportes de saturación**: El plan muestra en el front-end quién operador está más saturado (horas usadas / minutos capacidad) y cuál menos, en qué operación específica y el tiempo más alto (`TIEMPO_PROD` / `TIEMPO_CICLO`).

6. **Primera operación protegida**: Ya realizada por el agente anterior - respeta secuencia `planeado / por planear` para la primera operación de cada OT, sin reordenarla.

## 2. Arquitectura del Cambio

### Modificaciones en `src/web/planning/planner-core.js`:

#### 2.1. Nueva función: `balanceByMatrixResources(operations, state)`
- **Ubicación propuesta**: Después de `buildJobs` (línea ~1511)
- **Descripción**: Para operaciones subsiguientes (no primeras), aplica balanceo usando la matriz `state.matrix` que mapea capacidades (CT) a operadores disponibles. Prioriza operadores con menor carga proyectada.
- **Regla afectada**: RULE-MAT-001 a RULE-MAT-009 (matriz de capacidades)

#### 2.2. Modificación a `buildJobs` (línea 1496)
- **Cambio**: Mantener el interleaving entre OTs en lugar de completarlas secuencialmente. Las operaciones de diferentes OTs pueden programarse en cualquier orden, respetando solo las restricciones de secuencia dentro de cada OT.

#### 2.3. Modificación a `compareReadyCandidates` (línea 1548)
- **Cambio**: Agregar consideración de carga de operador (`operatorLoad`) como factor de desempate principal, después de la protección de secuencia primera operación.

#### 2.4. Nueva función: `isSubcontractOperationNoFinita(state, op)`
- **Ubicación**: Basado en `isFiniteOperation` (línea 1096) y `isSubcontractOperation` (línea 1108)
- **Descripción**: Clasifica operaciones subcontrato como "no finitas" - no consumen capacidad de operador/máquina en el schedule, pero respetan sus `DIAS_HABILES` propios.

#### 2.5. Modificación a `findAssignments` (línea 327)
- **Cambio**: Cuando `isSubcontractOperationNoFinita` retorna true, pular la búsqueda de máquinas y limitar solo la validación de calendario, asignando operador "SUBCONTRATO" directamente.

#### 2.6. Nueva función: `computeSaturationReport(state, scheduledOperations)`
- **Ubicación**: Después de `evaluatePlan` (línea 1689)
- **Descripción**: Genera reporte de saturación operador: quién está más/menos saturado, en qué operación específica y el tiempo más alto (TIEMPO_PROD / TIEMPO_CICLO).

#### 2.7. Modificación a `commitAssignment` (línea 521)
- **Cambio**: Para operaciones no finitas (subcontrato), no agregar busy segments a operatorBusy/machineBusy, y no actualizar operatorLoad. Solo asignar operador "SUBCONTRATO" y fechas.

#### 2.8. Nueva función: `flowBalancedInterleaving(context, jobs)`
- **Ubicación**: Nueva estrategia dentro de `schedulePlanOnce`
- **Descripción**: Permite interleaving de OTs en estrategia flow_balanced, respetando WIP target y precedencias.

### Posibles modificaciones en `src/server/04-planning-service.js`
- Agregar endpoints para solicitar reportes de saturación después de generar un plan.
- Persistir la matriz de capacidades en el estado del plan para reutilización.

## 3. Lista de Tareas

| # | Regla Afectada | Cambio de Código Propuesto | Ubicación | Riesgo | Verificación |
|---|---|---|---|---|---|
| 1 | RULE-MAT-001 a RULE-MAT-009 | Implementar `balanceByMatrixResources` - balanceo usando matriz CAPACIDADES para operaciones subsiguientes | `src/web/planning/planner-core.js` ~línea 1511 | Medio | `npm test` - 75 tests pass |
| 2 | Sin regla directa | Modificar `buildJobs` para permitir interleaving entre OTs (no completar OT entera antes siguiente) | `src/web/planning/planner-core.js` línea 1496 | Alto | Verificar que operaciones de OTs diferentes se entrelacen |
| 3 | RULE-BAL-001, RULE-BAL-002 | Agregar consideración de `operatorLoad` en `compareReadyCandidates` y `compareAssignments` | `src/web/planning/planner-core.js` línea 1548 | Bajo | Tests de load strategy aún pasan |
| 4 | RULE-OT-009 | Implementar `isSubcontractOperationNoFinita` - operaciones subcontrato como "no finitas" | `src/web/planning/planner-core.js` ~línea 1096 | Bajo | Test "un subcontrato puede terminar despues del horizonte visible" pasa |
| 5 | Sin regla directa | Agregar `computeSaturationReport` function y reporte en evaluatePlan metrics | `src/web/planning/planner-core.js` ~línea 1689 | Bajo | Nuevo campo en métricas de evaluatePlan |
| 6 | RULE-MAT-005, RULE-MAT-007 | Modificar `findAssignments` para skip machine search para subcontrato no finitas | `src/web/planning/planner-core.js` línea 327 | Bajo | Subcontratos no compiten por recursos |
| 7 | RULE-BAL-002 | Modificar `commitAssignment` para no agregar busy segments para operaciones no finitas | `src/web/planning/planner-core.js` línea 521 | Bajo | operatorBusy/machineBusy no contaminados por subcontratos |
| 8 | RULE-GOV-001 | Refactorizar `schedulePlan` para incluir estrategia `interleaved` en strategyPool | `src/web/planning/planner-core.js` línea 32 | Bajo | Nueva estrategia disponible en options |

## 4. Ejemplo de Entrada/Salida

### Entrada (estado del plan con 3 OTs):

```javascript
const state = {
  operations: [
    // OT-100: secuencia 1 (protegida), secuencia 2 (balanceo), secuencia 3 (balanceo)
    { id: "op-100-1", ot: "100", secuencia: 1, ct: "100", descripcion: "CORTE", tipoInsercion: "OPERACION", operador: "OP 1", tiempoProd: 60 },
    { id: "op-100-2", ot: "100", secuencia: 2, ct: "100", descripcion: "DOBLEZ", tipoInsercion: "OPERACION", operador: "OP 1", tiempoProd: 40 },
    { id: "op-100-3", ot: "100", secuencia: 3, ct: "100", descripcion: "EMPAQUE", tipoInsercion: "OPERACION", operador: "OP 2", tiempoProd: 30 },
    
    // OT-200: secuencia 1, 2 - interleaving con OT-100
    { id: "op-200-1", ot: "200", secuencia: 1, ct: "200", descripcion: "CORTE", tipoInsercion: "OPERACION", operador: "OP 1", tiempoProd: 50 },
    { id: "op-200-2", ot: "200", secuencia: 2, ct: "200", descripcion: "DOBLEZ", tipoInsercion: "OPERACION", operador: "OP 2", tiempoProd: 35 },
    
    // OT-300 con subcontrato (no finita)
    { id: "op-300-1", ot: "300", secuencia: 1, ct: "519", descripcion: "MAKA", tipoInsercion: "SUBCONTRATO", subcontractDays: 15, operador: "SUBCONTRATO", tiempoProd: 0 },
    { id: "op-300-2", ot: "300", secuencia: 2, ct: "CORTE", descripcion: "CORTE", tipoInsercion: "OPERACION", operador: "OP 1", tiempoProd: 45 },
  ],
  matrix: {
    "100::CORTE": ["OP 1"],
    "100::DOBLEZ": ["OP 1", "OP 2"],
    "200::CORTE": ["OP 1"],
    "200::DOBLEZ": ["OP 2"],
    "519::MAKA": [] // Subcontrato - no compete por recursos
  },
  configuredCapabilities: ["100::CORTE", "100::DOBLEZ", "200::CORTE", "200::DOBLEZ"],
  operators: ["OP 1", "OP 2"],
};
```

### Salida (plan programado con interleaving y balanceo):

```javascript
// Las operaciones se programan interleaveando:
// - OT-100 secuencia 1 programa primero (protegida)
// - OT-200 secuencia 1 puede programarse después de OT-100 secuencia 1
// - OT-100 secuencia 2 sigue a OT-100 secuencia 1
// - OT-200 secuencia 2 sigue a OT-200 secuencia 1
// - OT-300 secuencia 1 (subcontrato) no consume capacidad de operador/máquina
// - OT-300 secuencia 2 programa normalmente

state.lastSchedule.saturationReport = {
  mostSaturatedOperator: { operator: "OP 1", minutesUsed: 180, operation: "op-100-1", tiempoAlto: 60 },
  leastSaturatedOperator: { operator: "OP 2", minutesUsed: 75, operation: "op-200-2", tiempoAlto: 35 },
  operatorLoads: {
    "OP 1": { totalMinutes: 180, breakdown: [{op: "op-100-1", tiempo: 60}, {op: "op-200-1", tiempo: 50}, ...] },
    "OP 2": { totalMinutes: 75, breakdown: [{op: "op-100-3", tiempo: 30}, {op: "op-200-2", tiempo: 35}, ...] }
  }
};
```

## 5. Riesgos y Mitigaciones

| Riesgo | Mitigación |
|---|---|
| **Regresión de 75 tests** | Cada tarea se prueba con `npm test` después de cada lote de cambios. Los tests existentes deben mantenerse approval. |
| **Interleaving rompe precedencias de OT** | La protección de secuencia `_protectedSequence` para la primera operación de cada OT se mantiene. Las dependencias dentro de una OT aún se respetan mediante `fixedPredecessor` y `respectsFixedSuccessor`. |
| **Subcontrato como no finita causa recursos órfanos** | `isFiniteOperation` ya retorna `false` para operaciones con `tipoInsercion === "SUBCONTRATO"`. El modification a `commitAssignment` asegura que no se agreguen busy segments para estos casos. |
| **Balanceo por matriz incorrecto** | La matriz `state.matrix` ya está poblada desde `02-storage.js` y validada por `planningConfigurationIssues`. El balanceo prioriza operadores con menor `operatorLoad` proyectado. |
| **Performance degradation con más estrategias** | El `optimizationPasses` ya está limitado por `volumePassLimit` (línea 30-31). El interleaving añade una nueva estrategia pero no duplica el cómputo existente. |
| **Saturación report inaccuracies** | El `evaluatePlan` ya calcula `operatorLoad`, `operatorConflicts`, y `loadByOperator`. El reporte de saturación reutiliza estas métricas en lugar de calcular desde cero. |

## 6. Próximos Pasos

1. Implementar la Tarea 1 (`balanceByMatrixResources`) y verificar con `npm test`
2. Implementar la Tarea 2 (modificar `buildJobs` para interleaving) y verificar
3. Implementar la Tarea 3 (consideración de operadores en compare) y verificar
4. Implementar la Tarea 4 (subcontrato no finita) y verificar
5. Implementar la Tarea 5 (saturación report) y verificar
6. Implementar la Tarea 6 y 7 (modificaciones a `findAssignments` y `commitAssignment`)
7. Ejecutar `npm test` completo para asegurar 75 tests pass
8. Verificar reportes de saturación en el front-end

---

*Plan generado basándose en el código existente en `src/web/planning/planner-core.js`, `src/server/04-planning-service.js`, y `src/server/02-storage.js`, conectando con reglas documentadas en `docs/REGLAS.md` y `.project-memory/rules.json`.*