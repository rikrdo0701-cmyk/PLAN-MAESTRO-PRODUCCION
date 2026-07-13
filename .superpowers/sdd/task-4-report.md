# Task 4 — Registrar causas de espera

## RED

- Se agregaron las pruebas `registra la operacion bloqueadora que causa la espera` y `sin espera registra diagnostico vacio`.
- Comando: `node --test --test-name-pattern="registra la operacion bloqueadora|sin espera" tests/planner-core.test.mjs`
- Resultado inicial: 2 fallos esperados; `esperaMinutos` era `undefined` en ambos casos.

## GREEN

- Las asignaciones conservan el `earliest` calculado antes de buscar recursos.
- Los intervalos ocupados conservan `operationId`, `ot`, `secuencia`, `resourceType` y `resource`, además de `start`/`end`.
- `commitFixedOperation` y `commitAssignment` pasan esos metadatos al registrar ocupación.
- El diagnóstico final distingue operador, máquina, calendario, cambio de herramental y desplazamiento sin causa demostrable; una operación sin espera recibe causa vacía.
- Las operaciones fijas reciben el diagnóstico estable de espera cero.

## Decisiones

- Ante varios conflictos se atribuye el intervalo que termina más tarde, porque determina el salto definitivo; en empate se prioriza operador para mantener un resultado estable.
- Un cambio de herramental con duración previa a producción se reporta como `CAMBIO_HERRAMENTAL` y no inventa una OT bloqueadora.
- Las OT y secuencias bloqueadoras solo se copian desde metadatos reales del intervalo ocupado.

## Verificación

- `node --test --test-name-pattern="registra la operacion bloqueadora|sin espera" tests/planner-core.test.mjs` — 2/2 pasan.
- `node --test tests/planner-core.test.mjs` — 18/18 pasan.
- `git diff --check` — sin errores.

## Auto-revisión

- El cambio queda limitado al motor, sus pruebas y este reporte; no incluye UI ni tooltip.
- Los consumidores existentes de intervalos siguen pudiendo leer `start` y `end` sin cambios.
- No se atribuye OT bloqueadora para calendario, cambio de herramental ni `SIN_CAUSA`.
- No se observaron regresiones en la suite del motor.
