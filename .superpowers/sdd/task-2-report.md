# Task 2 report: `flow_balanced`

## Alcance

- Se añadió una única evaluación opcional `flow_balanced`, habilitada por defecto y aislada con `try/catch`.
- WIP flexible con `flowWipTarget` predeterminado 10 y limitado a 1–50; una OT nueva puede abrirse cuando ninguna activa es elegible.
- Priorización por holgura, cercanía a terminar, trabajo sucesor, encaje en hueco y cambio de herramienta.
- Recursos equivalentes se comparan por carga proyectada sin alterar filtros de capacidad, rendimiento, calendario, matriz o máquina.
- No se modificó UI, Apps Script remoto ni selección de Backlog.

## TDD

- RED inicial: `node --test tests/planner-core.test.mjs` → 55 pass, 5 fail; todos fallaron porque `flow_balanced` no se evaluaba.
- GREEN inicial: mismo comando → 60 pass, 0 fail.
- RED de aislamiento: prueba focal `si flow balanced falla...` → 0 pass, 1 fail por lectura de configuración fuera de la evaluación nueva.
- GREEN de aislamiento: misma prueba → 1 pass, 0 fail; la estrategia defectuosa se excluye y continúan `balanced`, `finish`, `load`.

## Verificación final

- Focal final fresca: `node --test tests/planner-core.test.mjs` → 62 pass, 0 fail.
- Suite final fresca: `npm.cmd test` → 336 pass, 0 fail.
- `git diff --check` → limpio.

## Archivos de producto

- `src/web/planning/planner-core.js`
- `tests/planner-core.test.mjs`

## Auto-revisión

- Primera revisión independiente: sin Critical; detectó dos Important (fijas futuras omitidas del fin proyectado y tres fixtures que inspeccionaban un ganador distinto de flow).
- Correcciones TDD: fin proyectado/sucesor fusionan movibles y fijas futuras en secuencia; los tres fixtures exigen `selectedStrategy === "flow_balanced"`; se añadió regresión de fija futura.
- Segunda revisión independiente: ambos hallazgos cerrados, sin nuevos Critical/Important; veredicto listo.

## Apéndice TDD — factibilidad ante sucesora fija

- Hallazgo Critical: una predecesora movible podía rebasar el inicio de una sucesora fija; `flowProjectedFinish` sólo afectaba el ranking.
- RED: `node --test --test-name-pattern="predecesora movible" tests/planner-core.test.mjs` → 0 pass, 2 fail; la operación de 180 minutos se programaba sobre la sucesora fija 08:00–09:00, con precedencia completa y con `overlap: 0.5`.
- GREEN: el mismo comando → 2 pass, 0 fail.
- Corrección: `findBestAssignment` rechaza asignaciones cuyo hito de liberación rebasa el inicio de la sucesora fija inmediata; el hito reutiliza la misma regla de precedencia/solapamiento de `computeEarliestStart`.
- Verificación final del apéndice: focal 64 pass, 0 fail; suite completa 338 pass, 0 fail; `git diff --check` limpio.

## Apéndice TDD — segmentos reales y cadena hasta fija

- Re-review Critical 1: el hito parcial reconstruía calendario general y omitía pausas reales de operador/máquina.
- Re-review Critical 2: la validación terminaba ante una movible intermedia y no comprobaba la próxima fija de la cadena.
- RED: `node --test --test-name-pattern="segmentos productivos reales|acumula hitos" tests/planner-core.test.mjs` → 0 pass, 2 fail.
- GREEN: el mismo comando → 2 pass, 0 fail.
- Corrección: los hitos consumen `productionSegments`; la cadena se prueba con el asignador existente sobre un contexto sombra que reserva cada candidata sin mutar el plan real.
- Verificación final: focal 66 pass, 0 fail; suite completa 340 pass, 0 fail.

## Apéndice TDD — alternativa factible antes de fija

- Hallazgo Important: la simulación de cadena elegía una sola asignación `flow_balanced`; un recurso menos cargado pero tardío podía ocultar otro que sí alcanzaba la fija.
- RED: `node --test --test-name-pattern="menor carga no alcanza" tests/planner-core.test.mjs` → 0 pass, 1 fail; quedaron 2 operaciones sin programar.
- GREEN: el mismo comando → 1 pass, 0 fail; eligió OP1 07:30–08:00 frente a OP2 disponible desde 09:00.
- Corrección: enumeración compartida de asignaciones y exploración de cadena limitada a 32 ramas; la carga ordena únicamente alternativas factibles.
- Verificación final: focal 67 pass, 0 fail; suite completa 341 pass, 0 fail; `git diff --check` limpio.

## Apéndice TDD — presupuesto de exploración inconcluso

- Hallazgo Important: al agotar 32 sondas, la búsqueda confundía `INCONCLUSIVE` con `INFEASIBLE` y podía descartar una cadena válida.
- RED: `node --test --test-name-pattern="alternativa factible numero 33" tests/planner-core.test.mjs` → 0 pass, 1 fail; quedaron 2 operaciones sin programar.
- GREEN: el mismo comando → 1 pass, 0 fail; encontró el operador factible 07:30–08:00 antes de la sucesora fija 09:00.
- Corrección: las alternativas de cadena priorizan liberación temporal antes que carga y el resultado distingue `FEASIBLE`, `INFEASIBLE` e `INCONCLUSIVE`; agotar el presupuesto acotado de 32 sondas ya no declara inviabilidad.
- Verificación final: focal 68 pass, 0 fail; suite completa 342 pass, 0 fail; `git diff --check` limpio.

## Apéndice TDD — cota segura ante exploración inconclusa

- Hallazgo Critical: `INCONCLUSIVE` se aceptaba sin garantía temporal; una cadena de 33 intermedias podía agotar las 32 sondas y programar una predecesora de 180 minutos más allá de la fija 09:00.
- RED: `node --test --test-name-pattern="33 intermedias agotan" tests/planner-core.test.mjs` → 0 pass, 1 fail; la predecesora quedaba programada el 2026-07-13.
- GREEN: focal de la regresión y el caso de recurso factible número 33 → 2 pass, 0 fail.
- Corrección: `INCONCLUSIVE` solo se admite cuando el hito productivo real de la candidata más una cota inferior admisible de todas las intermedias no rebasa la fija; una duración no demostrable se rechaza conservadoramente.
- Verificación final: focal 69 pass, 0 fail; suite completa 343 pass, 0 fail; las siete regresiones de sucesora fija pasan.
