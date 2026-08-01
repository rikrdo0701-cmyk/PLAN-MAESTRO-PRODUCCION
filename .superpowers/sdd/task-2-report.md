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
