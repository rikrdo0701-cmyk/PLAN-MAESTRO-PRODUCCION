# Task 5 - Llamadas compartidas y sincronizacion unica

## Estado

Implementacion terminada y verificada.

## Cambios

- Se reemplazo el marcador dedicado de snapshots por un registro `singleFlight` reutilizable.
- Estado inicial, snapshots y sincronizacion de OTs usan las claves `state`, `snapshots` y `sync-work-orders`.
- `loadSnapshotsOnce` comparte Reportes y Restaurar, conserva snapshots ya cargados y se une a una recarga explicita activa.
- El boton Actualizar y las actualizaciones posteriores a una restauracion conservan la recarga explicita.
- La sincronizacion manual y de fondo devuelve la misma promesa activa.
- Una solicitud concurrente con `showMessage` eleva el resultado compartido sin crear otra llamada ni duplicar el estado busy.
- Exito y fallo producen un solo toast cuando fue solicitado.
- `finally` libera todas las claves para permitir reintentos.

## TDD

- RED: dos sincronizaciones simultaneas ejecutaban dos llamadas y `syncNetSuiteInBackground` no devolvia la promesa.
- RED: `loadSnapshotsOnce` no compartia la llamada entre Reportes y Restaurar.
- RED de auto-revision: Restaurar podia usar cache mientras una recarga explicita seguia activa.
- GREEN: `node --test tests/performance-client-calls.test.mjs`, 5/5.

## Verificacion

- Focalizada: `node --test tests/performance-client-calls.test.mjs tests/performance-client-conflict.test.mjs tests/build.test.mjs`, 49/49.
- Suite completa: `npm.cmd test`, 216/216.
- Build: `npm.cmd run build`, codigo 0.
- Validacion: `npm.cmd run check`, codigo 0.
- Higiene: `git diff --check`, codigo 0.

## Revision

- Revision independiente final: listo para integrar, sin hallazgos criticos ni importantes.
- Observacion menor: una accion solapada podria conservar temporalmente una etiqueta visual anterior; no afecta `disabled`, `aria-busy` ni la ejecucion.

## Alcance

- Se actualizaron las aserciones de build que todavia exigian `snapshotsRequestPromise`.
- Los cambios y archivos ajenos ya presentes en el worktree quedaron fuera del commit.

## Correcciones de revision

- El boton manual y la sincronizacion de fondo comparten ahora la primera fase de OTs mediante `syncWorkOrdersOnce`.
- La implementacion base se captura antes del wrapper optimizado; `deferPresentation` evita renders y toasts duplicados sin recursion.
- Si el flujo manual se une a una operacion de fondo, conserva el busy global y emite solo el resultado final de las dos fases.
- El payload compartido actualiza OTs, seleccion, planta, ventana de precios y poda el borrador antes de continuar con operaciones.
- `snapshotsLoaded` distingue una carga valida vacia de una carga fallida; `count: 0` queda cacheado y los errores permiten retry.
- RED de revision: manual y background ejecutaban dos llamadas backend; una lista vacia valida se solicitaba dos veces.
- RED adicional: al terminar el sync de OTs, Generar plan y Backlog podian conservar `disabled` aunque ya no hubiera trabajo activo.
- Los cuatro controles recalculan juntos `disabled` y `aria-busy` ante cualquier transicion de las tres fuentes de actividad.
- GREEN de revision: `node --test tests/performance-client-calls.test.mjs`, 8/8.
- Focalizada final: 52/52.
- Suite final: 219/219.
- Build, validacion e higiene final: codigo 0.
