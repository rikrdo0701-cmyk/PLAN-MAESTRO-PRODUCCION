# Tarea 5 — Intervalo real y tiempo productivo en Gantt

## Estado

Implementada la separación entre intervalo calendario, minutos productivos y minutos no operativos en las barras del Gantt.

## RED

Se agregaron primero regresiones para la pausa de 15:00–15:05, el cruce de fin de semana y el cálculo puro del Gantt, además de comprobaciones del build para el contenido visible y el tooltip.

```powershell
node --test --test-name-pattern="pausa intermedia|cierre del viernes|ganttOperationTiming|el build" tests/planner-core.test.mjs tests/planning-workflow-core.test.mjs tests/build.test.mjs
```

Resultado inicial: 2 aprobadas y 2 fallidas. El motor ya conservaba correctamente los intervalos reales; fallaron el helper inexistente y la integración del Gantt.

## Cambios

- `ganttOperationTiming` calcula de forma pura minutos productivos, transcurridos y no operativos.
- La duración productiva reutiliza `PlannerCore.productionMinutes`, por lo que prioriza TC × cantidad pendiente sobre un `tiempoProd` obsoleto y aplica los mismos ajustes de desempeño y eficiencia.
- Cargas, reportes y resúmenes usan duración productiva aun cuando la operación tenga un intervalo calendario que atraviese pausas o días no laborables; el intervalo solo queda como respaldo para datos históricos sin duración explícita.
- La posición y anchura siguen usando los extremos reales de inicio y fin.
- La etiqueta de la barra muestra minutos productivos.
- El tooltip muestra inicio, fin, minutos productivos y no operativos.
- Cuando existen diagnósticos de espera, el tooltip incorpora minutos, causa, recurso y operación bloqueadora disponibles.
- Se conservaron las cuatro agrupaciones OT, CT, máquina y operador sin cambiar su construcción.

## GREEN y verificación

La prueba enfocada terminó con 4 aprobadas y 0 fallidas. También se ejecutaron la suite completa, validación del proyecto, build y `git diff --check` antes del commit.

## Preocupaciones

Ninguna abierta.
