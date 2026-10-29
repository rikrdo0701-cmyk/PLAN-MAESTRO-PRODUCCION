# Brief para retomar: optimizaciones de tiempo del motor de planeacion

## Objetivo

Implementar optimizaciones exclusivas de rendimiento en `src/web/planning/planner-core.js` para disminuir el tiempo de generacion y hacer la UI mas fluida, sin sacrificar calidad del plan ni omitir reglas de negocio.

No cambiar reglas de negocio, no relajar restricciones duras y no aceptar un plan con mas conflictos o mas operaciones sin hueco contra el baseline aceptado.

## Contexto actual

- El motor ya usa modo rapido con `fastQualityMode: true` y `timeBudgetMs: 300000` desde `src/web/planning/app.js`.
- `RULE-BAL-009` exige conservar el mejor plan completo bajo presupuesto de 5 minutos.
- El dry-run correcto para medir es no persistente: `window.runPlanningPerformanceDryRun({ timeoutMs: 300000, collectStats: true, progressEveryMs: 5000 })`.
- Baseline documentado anterior para dataset grande: `selectedOts=204`, `readyOts=146`, `inputOperations=2087`.
- Contadores altos observados: millones de `slotProbes`, `busyOverlapScans`, `busyConflictScans` y `toolCatalogScans`.

## Restricciones que no se pueden romper

- Ninguna operacion movible puede iniciar antes de `planStart`.
- Operadores siempre salen de MATRIZ; no usar operador residual de la operacion como fuente de verdad.
- Respetar maquina, herramental, kit, capacidad finita/no finita, calendario, subcontratos, precedencia por secuencia, cambios de herramental, exclusiones y cantidad pendiente.
- Preservar OTs bloqueadas, completadas, historicas, publicadas/guardadas y congeladas.
- Mantener `CAMBIO_HERRAMENTAL` cuando corresponde.
- No aumentar `OPERATOR_OVERLAP`.
- No aumentar `unscheduled` contra el baseline aceptado.
- Mantener `onYield` y checks de budget para que la UI siga respirando.
- No hacer dry-run con datos inventados que no existan en live.

## Estimacion de impacto

Las cifras son estimaciones. Confirmar con dry-run antes/despues en el mismo dataset.

| Tarea | Riesgo | Reduccion esperada | Comentario |
|---|---:|---:|---|
| B. Insercion ordenada de busy intervals | Bajo | 5-12% | Evita `sort` completo tras cada insercion de ocupacion. |
| C. Busy conflict sin arrays/sort por probe | Medio | 10-25% | Ataca millones de consultas en el loop de slots. Probablemente mayor impacto seguro. |
| A. Caches estaticos por operacion | Medio | 8-20% | Memoiza lookups puros: matriz, maquinas, catalogo, duracion, reglas. |
| D. Indice de excepciones de calendario | Bajo-medio | 2-10% | Impacto depende de cuantas excepciones/calendarios existan. |
| E. Cache de fechas parseadas | Medio | 3-8% | Reduce parsing repetido en ordenamientos/evaluacion. |
| G. Indice de estados completados | Bajo | 1-5% | Barato y seguro, impacto menor. |
| F. Precomputar sucesores fijos | Medio-alto | 0-15% | Ayuda si hay muchas OTs con sucesores fijos/completados. |

Estimacion acumulada:

- Conservadora: 15-25% menos tiempo.
- Realista si los contadores siguen altos: 25-40% menos tiempo.
- Optimista en dataset grande con muchos probes/conflictos: 40-50% menos tiempo.

Ejemplo aproximado:

- Si hoy tarda `160s`, podria bajar a `95-130s`.
- Si hoy tarda `300s`, podria bajar a `180-240s`.
- Si hoy usa casi `5 min`, podria quedar alrededor de `2.5-4 min` si el cuello son scans/sorts repetidos.

## Orden recomendado de implementacion

1. Implementar B + C juntas: busy intervals y busy conflict mas baratos.
2. Implementar A: caches estaticos por operacion.
3. Implementar G + E: indices/caches simples de estados y fechas.
4. Implementar D: indice de calendario.
5. Implementar F solo si benchmark muestra costo alto en sucesores fijos.

No empezar por `Top 2-3 maquinas` ni `local search`: pueden aportar, pero tienen mas riesgo de cambiar calidad si no se implementan con fallback exhaustivo y fixtures fuertes.

## Tarea B: insercion ordenada de busy intervals

Archivo principal: `src/web/planning/planner-core.js`.

Zonas a revisar:

- `addBusySegments`
- llamadas desde commits de produccion/setup/cambios de herramental/fijas

Cambio esperado:

- Mantener cada lista de ocupacion ordenada por `start`.
- En vez de `current.push(...segments)` + `current.sort(...)`, insertar por busqueda binaria o merge de listas ordenadas.
- Conservar exactamente los mismos intervalos.

Calidad protegida:

- Misma ocupacion, mismo orden, mismas reglas de solape.
- No cambia asignacion, calendario, maquina, operador ni herramental.

Validar:

- Tests de solape operador/maquina.
- Tests de `CAMBIO_HERRAMENTAL`.
- Fixture con operaciones fijas y generadas insertadas fuera de orden cronologico.

## Tarea C: busy conflict sin arrays/sort por probe

Archivo principal: `src/web/planning/planner-core.js`.

Zonas a revisar:

- `nextBusyConflictEnd`
- `collectBusyConflicts`
- `firstBusyOverlapEnd`
- llamada desde el loop de busqueda de slots

Cambio esperado:

- Evitar crear `intervals = []` y ordenar en cada probe.
- Aprovechar que las listas de ocupacion ya estan ordenadas.
- Calcular el siguiente fin de conflicto con scan directo o k-way scan sobre listas ordenadas.

Calidad protegida:

- Debe devolver el mismo conflict end que antes.
- No relaja capacidad ni solapes.
- No cambia reglas de operador/maquina.

Validar fixtures:

- Conflicto solo de operador.
- Conflicto solo de maquina.
- Conflictos de operador y maquina que se encadenan y extienden el bloqueo.
- Intervalos adyacentes que no deben mergearse como solape falso.

## Tarea A: caches estaticos por operacion

Archivo principal: `src/web/planning/planner-core.js`.

Zonas a revisar:

- `findAssignments`
- `toolCatalogForOperation`
- `operatorCandidates`
- `machineCandidates`
- `operationEfficiencyForOperation`
- `isFiniteOperation`
- `operationRuleForOperation`
- `operationDuration` / `productionMinutes`

Cachear solamente datos puros durante una estrategia:

- capability key
- CT normalizado
- candidatos de operador desde MATRIZ
- candidatos base de maquina
- catalogo/herramental aplicable
- duracion/productive minutes cuando no dependa de estado dinamico
- modo finito/no finito

No cachear:

- disponibilidad de operadores/maquinas
- busy intervals
- herramienta montada actual
- calendario vivo
- carga acumulada
- decision de asignacion
- resultado negativo “no hay slot” por operacion

Calidad protegida:

- Memoizacion de funciones puras solamente.
- Misma entrada debe producir misma salida.
- Recalcular por estrategia si alguna dependencia cambia.

## Tarea D: indice de excepciones de calendario

Archivo principal: `src/web/planning/planner-core.js`.

Zona a revisar:

- `effectiveWindows`

Cambio esperado:

- Construir un indice interno una vez por ejecucion/estrategia desde `state.calendarExceptions`.
- Indexar por fecha y recurso/concepto: general, asueto, vacaciones, maquina, operador.
- `effectiveWindows` debe aplicar las mismas excepciones con `subtractWindow`.

Calidad protegida:

- Misma semantica: general/asuento/vacaciones afectan todos; maquina solo la maquina; operador solo el operador.

## Tarea E: cache de fechas parseadas

Archivo principal: `src/web/planning/planner-core.js`.

Zonas a revisar:

- `operationStart`
- `operationEnd`
- `evaluatePlan`
- sorts finales y checks de precedencia/conflictos

Cambio esperado:

- Evitar parsear repetidamente `fechaInicio/horaInicio` y `fechaFin/horaFin`.
- Usar campos internos `__` o side maps locales durante la corrida.
- Actualizar/invalidatear al escribir fechas en `commitAssignment`.
- Asegurar que campos `__` no se persisten en snapshots.

## Tarea G: indice de estados completados

Archivo principal: `src/web/planning/planner-core.js`.

Zonas a revisar:

- `isPlanCompletedOperation`
- splitting de operaciones completadas/inactivas/activas

Cambio esperado:

- Si `state.operationPlanStatuses` llega como array, construir un `Map` interno por `operationCompletionKey` una vez por corrida.
- Mantener fallback para objeto y array.

Calidad protegida:

- Mismos estados, mismo criterio de completada.

## Tarea F: sucesores fijos precomputados

Archivo principal: `src/web/planning/planner-core.js`.

Zonas a revisar:

- `respectsFixedSuccessor`
- `fixedChainFeasibility`
- `cloneFeasibilityContext`
- `buildJobs`

Cambio esperado:

- Precomputar por OT las operaciones fijas futuras ya ordenadas.
- Fast-return si una operacion no tiene sucesores fijos.
- Evitar reconstruir/sortear la misma lista por candidato.

Riesgo:

- Medio-alto. No relajar esta validacion.
- Implementar solo despues de medir que realmente pesa.

## Optimizaciones a evitar por ahora

- Podar maquinas sin fallback exhaustivo.
- Cachear resultados dinamicos de factibilidad o “no hay slot”.
- Aumentar `SEARCH_STEP_MINUTES` o `ALLOCATION_CHUNK_MINUTES`.
- Quitar o suavizar `respectsFixedSuccessor`.
- Usar convergencia aproximada entre estrategias.
- Usar operador residual de una operacion en lugar de MATRIZ.
- Inventar datos en dry-run que live no usaria.

## Protocolo de medicion

Antes de tocar el motor:

```javascript
await window.runPlanningPerformanceDryRun({
  timeoutMs: 300000,
  collectStats: true,
  progressEveryMs: 5000
})
```

Guardar baseline:

- `scheduledOperationsCount`
- `unscheduledOperationsCount`
- `diagnosticsByCode.OPERATOR_OVERLAP`
- `selectedStrategy`
- `plannerElapsedMs`
- `plannerAssignmentCandidateEvaluations`
- `plannerSlotProbes`
- `plannerBusyOverlapScans`
- `plannerBusyConflictScans`
- `plannerBusyConflictSorts`
- `plannerBusySegmentSorts`
- `plannerToolCatalogLookups`
- `plannerToolCatalogScans`

Despues de cada tarea:

- Ejecutar el mismo dry-run.
- Comparar plan y contadores.
- Aceptar solo si no aumenta conflictos ni `unscheduled` y baja tiempo o contadores.

## Tests minimos por cambio

```powershell
node --test tests/planner-core.test.mjs
node --test tests/planning-workflow-core.test.mjs
node --test tests/plan-generate.endtoend.test.mjs
npm run check
```

Si se toca build/UI o export/snapshots:

```powershell
npm test
```

Nota: puede existir una falla no relacionada en `tests/build.test.mjs` sobre matriz/localStorage. No mezclarla con esta tarea salvo que el usuario lo pida.

## Criterios de aceptacion

- Mismo o menor `unscheduled` contra baseline aceptado.
- `OPERATOR_OVERLAP = 0` o no mayor al baseline si el baseline no era cero.
- Ninguna operacion movible antes de `planStart`.
- Misma preservacion de fijas/completadas/historicas/publicadas.
- `CAMBIO_HERRAMENTAL` sigue generandose cuando corresponde.
- `lastSchedule.optimization` sigue trazando estrategia elegida, skips y timeouts.
- Reduccion medible de tiempo o contadores en dry-run real.

## Prompt sugerido para otra conversacion

Quiero implementar optimizaciones del motor de planeacion para reducir tiempo sin sacrificar calidad ni omitir reglas. Usa `docs/superpowers/plans/2026-08-31-planner-runtime-optimization-brief.md` como briefing. Primero mide baseline con dry-run no persistente, luego implementa B+C como primer paquete: insercion ordenada de busy intervals y busy conflict lookup sin arrays/sort por probe. No cambies reglas, no aumentes `unscheduled`, no aumentes conflictos, no uses operadores fuera de MATRIZ, no muevas operaciones antes de `planStart`. Agrega pruebas focales y compara contadores antes/despues.
