# Reporte Tarea 5: Cambio de herramental en Gantt por Máquina

## Implementación

- Se agregó `isMachineGanttOperation(op)` al workflow core como predicado puro.
- La vista por máquina incluye doblados programados con máquina y cambios de herramental vigentes generados por `PLANNER_CORE_V2` con geometría programada.
- Se excluyen operaciones ajenas al doblado, operaciones sin máquina o fechas completas, completadas, históricas y cambios heredados.
- `ganttOperationHasMachine` delega exclusivamente al helper; no crea ni clona operaciones ni capacidad.
- Las barras de cambio usan `gantt-bar--tool-change`, el texto `Cambio de herramental` y un tooltip con OT, máquina, origen/destino de herramental y kit, ajustador, inicio, fin y duración.
- La geometría conserva los valores existentes de inicio y fin. Las vistas OT, CT y Operador permanecen disponibles.

## TDD y pruebas

- RED verificado: las pruebas nuevas fallaron porque `isMachineGanttOperation` y el markup especializado no existían.
- GREEN verificado: `node --test tests/planning-workflow-core.test.mjs tests/build.test.mjs` pasó 36/36.
- Se cubrió explícitamente el caso de dos OTs en la misma máquina con herramientas distintas y el cambio intermedio.

## Verificación final

- `npm.cmd test`: 60/60 pruebas, 0 fallos.
- `npm.cmd run check`: validación correcta.
- `npm.cmd run build`: Apps Script y GitHub Pages generados correctamente.
- `git diff --check`: sin errores de whitespace (solo avisos de conversión LF/CRLF de Git).

## Corrección P2 de revisión visual

- Se verificó que las reglas posteriores de tipo de OT y riesgo tenían la misma especificidad y podían sobrescribir el fondo y borde de `gantt-bar--tool-change`.
- La regla especializada ahora aparece después de ambas familias, conservando el fondo rayado y el borde distintivo incluso al coexistir con clases prototype, urgent o risk.
- Se añadió una aserción de build sensible al orden de cascada y a la presencia del gradiente y borde; falló antes del ajuste y pasó después.
