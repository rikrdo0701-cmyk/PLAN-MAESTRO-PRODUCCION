# Task 2: Fusión cliente y consulta compartida

Estado: corregido tras revisión. La caché individual sólo acepta operaciones con CT utilizable y tiempo de planeación positivo.

## Archivos

- `src/web/planning/app.js`: carga individual con promesa compartida, fusión aislada por OT e invalidación de cachés tras una fusión válida; valida CT y `tiempoProd` antes de usar caché.
- `tests/performance-client-calls.test.mjs`: concurrencia, fusión selectiva, caché, reintentos y operaciones incompletas.

## Pruebas

- RED: `node --test tests/performance-client-calls.test.mjs tests/build.test.mjs` falló inicialmente por las funciones inexistentes.
- GREEN de corrección: el mismo comando pasó con 39 pruebas.
- `npm.cmd test`: 231 pruebas aprobadas.
- `git diff --check`: sin errores.

## Commit

- `90699e1` — `feat: add individual planning data loader`
- `e95b0df224cd635117ccbe7a5c167048cc2b0e51` — `fix: validate cached planning operations`

## Preocupaciones

- `selectJob` no se modificó; su integración queda para Task 3.
