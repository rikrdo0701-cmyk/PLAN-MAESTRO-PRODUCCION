# Task 2: Fusión cliente y consulta compartida

## Archivos

- `src/web/planning/app.js`: agrega la carga individual con promesa compartida, fusión aislada por OT e invalidación de cachés tras una fusión válida.
- `tests/performance-client-calls.test.mjs`: cubre concurrencia, fusión selectiva, caché y reintentos.

## Pruebas

- RED: `node --test tests/performance-client-calls.test.mjs tests/build.test.mjs` falló inicialmente por las funciones inexistentes.
- GREEN: el mismo comando pasó con 38 pruebas.
- `npm.cmd test`: 230 pruebas aprobadas.
- `git diff --check`: sin errores.

## Commit

- `feat: add individual planning data loader`

## Preocupaciones

- `selectJob` no se modificó; su integración queda para Task 3.
