# Plan de Rediseño del Algoritmo de Planeación/Scheduling

## Resumen Ejecutivo

Este documento detalla los cambios necesarios para rediseñar el algoritmo de planeación en `src/web/planning/planner-core.js` para cumplir con las reglas de negocio críticas del sistema plangit. Los cambios incluyen:

1. **Protección de la primera operación** de cada OT para respetar la secuencia `planeado/por planear` sin reordenamiento
2. **Validación de subcontrato** como operaciones "no finitas" que no compiten por recursos compartidos
3. **Balanceo de recursos por matriz** para operaciones subsiguientes, minimizando tiempos muertos
4. **Reportes de saturación operadora** identificando quién está más/menos saturado
5. **Estrategia de selección Mejorada** en `applyComparableScores` con consideración de carga operadora

## Arquitectura del Cambio

Las modificaciones se concentran en `src/web/planning/planner-core.js`, específicamente en las funciones:
- `schedulePlan` - entrada principal, protección de primera operación
- `isFiniteOperation` - validación de subcontrato como no finito
- `applyComparableScores` - nueva estrategia de selección con carga operadora
- `compareReadyCandidates` - balanceo de recursos en selección de candidatos
- `evaluatePlan` - reporte de saturación operadora

### Flujo de Cambios

```
schedulePlan
  ↓
Identificar primeras operaciones de cada OT y proteger su secuencia
  ↓
Clasificar operaciones: fixed (primeras OT) vs movable (restantes)
  ↓
buildJobs - agrupar por OT, preservar secuencia interna
  ↓
Bucle de scheduling con interleaving permitido
  ↓
compareReadyCandidates - selecciona basada en carga de matriz
  ↓
findAssignments - manejo de subcontrato como non-finite
  ↓
commitAssignment - tracking de carga sin consumir recursos compartidos
  ↓
evaluatePlan - reporte de saturación al final
```

## Lista de Tareas

### 1. Proteger la primera operación de cada OT

**Regla afectada**: RULE-OT-005, regla de secuencia planeado/por planear

**Cambio de código propuesto**:
- Agregar función `getFirstOperations(state)` que identifica la primera operación (secuencia 1) de cada OT seleccionada
- Modificar la clasificación `fixed`/`movable` en `schedulePlan` para marcar las primeras operaciones como "protegidas de reordenamiento"
- Asegurar que las primeras operaciones mantengan status `PENDIENTE`/`planeado` y no sean reordenadas por el algoritmo greedy
- Verificar que las dependencias inmediatas se respeten: la operación N-1 debe completarse antes de programar la operación N dentro de la misma OT

**Ubicación exacta**: `src/web/planning/planner-core.js`, función `schedulePlan`, líneas 146-157

**Riesgo**: Medio - el algoritmo actual ya respeta la secuencia dentro de OTs mediante `job.index`, pero se necesita asegurar que las primeras operaciones no sean omitidas o reordenadas entre diferentes OTs

**Verificación**: `npm test` - tests existentes en `tests/planner-core.test.mjs` deben seguir pasando

---

### 2. Integrar subcontrato como "no finito"

**Regla afectada**: Regla de validación de subcontrato en `docs/REGLAS.md` y `.project-memory/rules.json`

**Cambio de código propuesto**:
- Verificar que `isFiniteOperation(state, op)` retorne `false` para operaciones con `tipoInsercion === "SUBCONTRATO"` (ya implementado en línea 1089)
- Asegurar que `findSubcontractAssignment` sea llamado en `findAssignments` para operaciones subcontrato (línea 322-325)
- Confirmar que las operaciones subcontrato no agregan carga al operador/máquina en `commitAssignment` mediante el check `isLoadBearingOperator` (línea 532)
- Añadir consideración de `DIAS_HABILES` para lead-time (ya existente en `findSubcontractAssignment`, línea 490)

**Ubicación exacta**: 
- `isFiniteOperation` en líneas 1088-1098
- `findAssignments` en líneas 319-341 
- `commitAssignment` en líneas 513-602, específicamente línea 532-542

**Riesgo**: Bajo - la infraestructura ya existe, se necesita verificar que se propaga correctamente en el nuevo algoritmo

**Verificación**: Test "un subcontrato puede terminar despues del horizonte visible" (línea 369) y "operaciones no finitas simultaneas no generan conflicto de operador" (línea 529)

---

### 3. Estrategia de balanceo por recursos (matrix-based)

**Regla afectada**: Reglas de balanceo en `docs/REGLAS.md` sección Balanceo

**Cambio de código propuesto**:
- Modificar `compareReadyCandidates` para incluir carga actual y proyectada del operador
- Agregar penalización por tiempos muertos en la comparación de candidatos
- Incluir peso especial para operaciones subcontrato (sin consumo de recurso compartido)
- Modificar `applyComparableScores` (líneas 1825-1837) para incluir:
  - `currentOperatorLoad`: carga actual del operador
  - `projectedOperatorLoad`: carga proyectada después de asignar
  - `idleTimePenalty`: penalización por tiempos muertos
  - `subcontractWeight`: peso para operaciones subcontrato

**Ubicación exacta**:
- `applyComparableScores` en líneas 1825-1837
- `compareReadyCandidates` en líneas 1540-1569
- `compareAssignments` en líneas 1571-1585

**Riesgo**: Medio - requiere cambios en la lógica de comparación que afecta la selección de estrategias

**Verificación**: Tests de estrategias de scheduling existentes; nuevo test para balanceo por recursos

---

### 4. Calcular y reportar saturación operadora

**Regla afectada**: KPIs de carga en `docs/REGLAS.md` sección RULE-BAL-001

**Cambio de código propuesto**:
- Agregar función `calculateOperatorSaturation(state, operations)` que retorne:
  - Operador más saturado y su carga total
  - Operador menos saturado y su carga total
  - Operación con tiempo más alto (`TIEMPO_PROD` / `TIEMPO_CICLO`)
  - Tiempo máximo registrado
- Modificar `evaluatePlan` para incluir métricas de saturación en el resultado
- Exposición en el estado retornado para consumo del front-end

**Ubicación exacta**: `evaluatePlan` en líneas 1672-1774, agregar nuevas métricas después de la línea 1773

**Riesgo**: Bajo - el cálculo ya existe parcialmente en `evaluatePlan` (líneas 1680-1773 para `loadByOperator`), se extiende para incluir ranking

**Verificación**: `npm test` - tests de métricas existentes deben continuar pasando

---

### 5. Cambiar estrategia de selección en applyComparableScores

**Regla afectada**: Lógica de comparación en planner-core.js:1825-1837

**Cambio de código propuesto**:
- Reemplazar o extender los componentes actuales en `applyComparableScores`:
  ```javascript
  const components = [
    ["weightedTardinessMinutes", 0.45],
    ["averageFlowMinutes", 0.30],
    ["avoidableIdleMinutes", 0.15],
    ["toolChanges", 0.10],
    // Nuevos componentes:
    ["currentOperatorLoad", 0.10],     // Carga actual del operador
    ["projectedOperatorLoad", 0.20],   // Carga proyectada después de asignar
    ["idleTimePenalty", 0.15],         // Penalización por tiempos muertos
    ["subcontractProtection", 0.05],   // Peso para proteger operaciones subcontrato
  ];
  ```
- Los denominadores deben calcularse dinámicamente basándose en los valores evaluados

**Ubicación exacta**: `applyComparableScores` en líneas 1825-1837

**Riesgo**: Medio - cambia la función de puntuación global que determina qué plan se selecciona

**Verificación**: Tests de selección de estrategia existentes; verificar que la estrategia "balanced" aún funcione correctamente

---

### 6. Ejemplo de entrada/salida

**Input** (estado actual del borrador):
```javascript
{
  operations: [
    { id: "op-1", ot: "OT-100", secuencia: 1, ct: "CORTE", descripcion: "CORTE", tipoInsercion: "OPERACION", estatus: "PENDIENTE", operador: "OP_1", tiempoProd: 60 },
    { id: "op-2", ot: "OT-100", secuencia: 2, ct: "DOBLEZ", descripcion: "DOBLEZ", tipoInsercion: "OPERACION", estatus: "PENDIENTE", operador: "OP_1", tiempoProd: 40 },
    { id: "op-3", ot: "OT-200", secuencia: 1, ct: "PINTURA", descripcion: "PINTURA", tipoInsercion: "SUBCONTRATO", estatus: "PENDIENTE", subcontractType: "MAKA", subcontractDays: 15 },
    { id: "op-4", ot: "OT-200", secuencia: 2, ct: "CORTE", descripcion: "CORTE", tipoInsercion: "OPERACION", estatus: "PENDIENTE", operador: "OP_2", tiempoProd: 30 },
  ],
  workOrders: [{ ot: "OT-100" }, { ot: "OT-200" }],
  matrix: { CORTE: ["OP_1"], DOBLEZ: ["OP_1"], PINTURA: ["OP_SUB"] }, 
  configuredCapabilities: ["CORTE::CORTE", "DOBLEZ::DOBLEZ", "PINTURA::PINTURA"],
  operators: ["OP_1", "OP_2", "OP_SUB"],
  settings: { optimizationPasses: 1 }
}
```

**Output** (nuevo plan):
```
Plan con:
(a) primera operación de cada OT sin reordenar:
  - op-1 (OT-100, secuencia 1: CORTE) programada primero manteniendo estatus PENDIENTE
  - op-3 (OT-200, secuencia 1: PINTURA/SUBCONTRATO) programada primero con su lead-time de 15 días hábiles

(b) operaciones subsiguientes balanceadas por recursos:
  - op-2 (OT-100, secuencia 2: DOBLEZ) asignada después de op-1, misma operadora OP_1
  - op-4 (OT-200, secuencia 2: CORTE) asignada en paralelo o después, operadora OP_2 para balancear carga

(c) reporte de saturación operadora:
  - Operador más saturado: OP_1 con 100 minutos cargados
  - Operador menos saturado: OP_2 con 30 minutos cargados
  - Operación con tiempo más alto: op-1 con TIEMPO_PROD: 60 minutos

(d) validación de subcontrato como no finito:
  - op-3 (SUBCONTRATO) no consume capacidad de OP_1/OP_2 en el cálculo de carga
  - Tiene lead-time propio: 15 DIAS_HABILES desde su fecha de inicio
```

## Ejemplo de Entrada/Salida

### Input (estado de borrador antes del rediseño)

```json
{
  "operations": [
    { "id": "op-1", "ot": "OT-100", "secuencia": 1, "ct": "CORTE", "descripcion": "CORTE", "tipoInsercion": "OPERACION", "estatus": "PENDIENTE", "operador": "OP_1", "tiempoProd": 60 },
    { "id": "op-2", "ot": "OT-100", "secuencia": 2, "ct": "DOBLEZ", "descripcion": "DOBLEZ", "tipoInsercion": "OPERACION", "estatus": "PENDIENTE", "operador": "OP_1", "tiempoProd": 40 },
    { "id": "op-3", "ot": "OT-200", "secuencia": 1, "ct": "519", "descripcion": "MAKA", "tipoInsercion": "SUBCONTRATO", "estatus": "PENDIENTE", "subcontractType": "MAKA", "subcontractDays": 15 },
    { "id": "op-4", "ot": "OT-200", "secuencia": 2, "ct": "CORTE", "descripcion": "CORTE", "tipoInsercion": "OPERACION", "estatus": "PENDIENTE", "operador": "OP_2", "tiempoProd": 30 }
  ],
  "workOrders": [{ "ot": "OT-100" }, { "ot": "OT-200" }],
  "matrix": { "CORTE": ["OP_1"], "DOBLEZ": ["OP_1"], "PINTURA": ["OP_SUB"] },
  "configuredCapabilities": ["CORTE::CORTE", "DOBLEZ::DOBLEZ", "PINTURA::PINTURA"],
  "operators": ["OP_1", "OP_2", "OP_SUB"]
}
```

### Output (después del rediseño)

**Plan programado**:
```json
{
  "operations": [
    // (a) Primera operación de cada OT sin reordenar
    { "id": "op-1", "ot": "OT-100", "secuencia": 1, "ct": "CORTE", "descripcion": "CORTE", "tipoInsercion": "OPERACION", "estatus": "PENDIENTE", "operador": "OP_1", "fechaInicio": "2026-07-13", "horaInicio": "07:00", "fechaFin": "2026-07-13", "horaFin": "08:00", "tiempoProd": 60 },
    { "id": "op-3", "ot": "OT-200", "secuencia": 1, "ct": "519", "descripcion": "MAKA", "tipoInsercion": "SUBCONTRATO", "estatus": "PENDIENTE", "subcontractType": "MAKA", "subcontractDays": 15, "fechaInicio": "2026-07-13", "horaInicio": "14:50", "fechaFin": "2026-08-03", "horaFin": "07:00" },
    
    // (b) Operaciones subsiguientes balanceadas por recursos
    { "id": "op-2", "ot": "OT-100", "secuencia": 2, "ct": "DOBLEZ", "descripcion": "DOBLEZ", "tipoInsercion": "OPERACION", "estatus": "PENDIENTE", "operador": "OP_1", "fechaInicio": "2026-07-13", "horaInicio": "08:00", "fechaFin": "2026-07-13", "horaFin": "09:00", "tiempoProd": 40 },
    { "id": "op-4", "ot": "OT-200", "secuencia": 2, "ct": "CORTE", "descripcion": "CORTE", "tipoInsercion": "OPERACION", "estatus": "PENDIENTE", "operador": "OP_2", "fechaInicio": "2026-07-13", "horaInicio": "07:00", "fechaFin": "2026-07-13", "horaFin": "07:30", "tiempoProd": 30 }
  ],
  "lastSchedule": {
    "operatorConflicts": 0,
    "unscheduled": 0,
    // (c) Reporte de saturación
    "operatorSaturation": {
      "mostSaturated": { "operator": "OP_1", "totalMinutes": 100 },
      "leastSaturated": { "operator": "OP_2", "totalMinutes": 30 },
      "highestTimeOperation": { "operationId": "op-1", "tiempoProd": 60, "tiempoCiclo": 60 }
    }
  }
}
```

**Validación de subcontrato**:
- `op-3` (SUBCONTRATO) tiene `finite: false` en su assignment
- No aparece en `operatorConflicts` calculation
- Tiene `leadTime: 15 DIAS_HABILES` calculado desde `findSubcontractAssignment`
- No compete por recursos de `OP_1` u `OP_2` en el mismo sentido que operaciones normales

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Tests existentes fallan por cambios en `applyComparableScores` | Media | Alto | Ejecutar `npm test` después de cada cambio incremental; mantener backward compatibility |
| Secuencia de primera operación no se respeta en bordes casos | Baja | Alto | Tests unitarios específicos para `isFirstOperationOfOt` y protección de secuencia |
| Subcontrato sí consume capacidad inesperada | Media | Medio | Verificar `isLoadBearingOperator` checks y tests de subcontrato existentes |
| Performance degrade con nueva lógica de comparación | Baja | Medio | Optimizar funciones de comparación; usar clamping para valores extremos |
| Interleaving causa dependencias rotas entre OTs | Baja | Alto | Tests de precedence con múltiples OTs; verificar que `job.index` respete secuencias |

## Próximos Pasos

1. Implementar cambios en `planner-core.js` siguiendo el orden de las tareas
2. Ejecutar `npm test` después de cada cambio major
3. Verificar que los tests de subcontrato sigan pasando
4. Agregar tests unitarios nuevos para las funcionalidades nuevas
5. Actualizar documentación del front-end para mostrar reportes de saturación