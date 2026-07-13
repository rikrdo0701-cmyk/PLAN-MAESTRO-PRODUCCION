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

## Corrección posterior a revisión

### RED

- Se agregaron cuatro regresiones: calendario posterior a un conflicto corto, espera por máquina, cambio de herramental previo a producción y bloqueadores simultáneos con elección del determinante.
- Comando: `node --test --test-name-pattern="limite de calendario|maquina como causa|cambio requerido determina|bloqueadores simultaneos" tests/planner-core.test.mjs`.
- Resultado inicial: el caso calendario falló porque devolvía `OPERADOR` en vez de `CALENDARIO`. Los dos fixtures de máquina también revelaron que necesitaban la capacidad de ajustador exigida por las reglas existentes; tras corregir el fixture quedaron como regresiones válidas. El caso de cambio ya documentaba correctamente el comportamiento existente.

### GREEN

- El diagnóstico selecciona primero el conflicto que termina más tarde y consulta la disponibilidad de calendario desde su final.
- Si el calendario desplaza todavía más el cursor hasta el inicio asignado, la causa definitiva es `CALENDARIO` y no se copia una OT bloqueadora.
- Si el recurso está disponible al terminar el conflicto, se conserva la atribución real a `OPERADOR` o `MAQUINA`.

### Comandos y resultados

- `node --test --test-name-pattern="limite de calendario|maquina como causa|cambio requerido determina|bloqueadores simultaneos" tests/planner-core.test.mjs` — 4/4 pasan.
- `node --test --test-name-pattern="registra la operacion bloqueadora|sin espera|limite de calendario|maquina como causa|cambio requerido determina|bloqueadores simultaneos" tests/planner-core.test.mjs` — 6/6 pasan.
- `node --test tests/planner-core.test.mjs` — 22/22 pasan.

### Auto-revisión de la corrección

- La comparación usa el final del conflicto determinante, no cualquier intervalo que cruce todo el tramo de espera.
- El desempate entre conflictos conserva el criterio estable existente.
- Calendario, cambio de herramental y espera sin causa demostrable no inventan una OT bloqueadora.
- No se modificó UI ni tooltip.
