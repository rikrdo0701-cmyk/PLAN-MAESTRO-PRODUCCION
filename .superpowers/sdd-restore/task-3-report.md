# Tarea 3 — Instantánea completa y restauración atómica

## Estado

Implementada la restauración de un publicado como borrador sin cambios de UI. Se amplió únicamente `src/web/bridge/Bridge.html` fuera de la lista original, con autorización explícita, porque el allowlist era requisito del brief.

## TDD (RED/GREEN)

- RED core: `node --test tests/planning-workflow-core.test.mjs --test-name-pattern="reconcilia un publicado"` falló con `core.reconcilePublishedPlan is not a function`.
- GREEN core: el mismo comando pasó tras implementar reconciliación por identidad OT/secuencia/CT.
- RED build: `node --test tests/build.test.mjs` falló al no encontrar `restorePublishedPlanAsDraft: true` en el bridge.
- GREEN build: las aserciones verifican wrapper, allowlist, clave full-state, lock, rollback y respuesta.
- RED P1: las nuevas aserciones de build fallaron al no encontrar enumeración de manifiestos ni staging transaccional.
- GREEN P1: las aserciones verifican recuperación sin filas, exclusión de backups, commit de manifiesto después de chunks, limpieza de staging y restauración del payload del draft.
- RED P1 rollback: la aserción sensible al orden falló porque la generación anterior se eliminaba antes de persistir filas/auditoría.
- GREEN P1 rollback: el reemplazo draft difiere la limpieza hasta después de `SpreadsheetApp.flush()`; el catch restaura el manifiesto anterior y elimina la generación nueva sin reserializar.

## Implementación

- `reconcilePublishedPlan(snapshot, currentState)` omite OTs cerradas, preserva completadas y configuración vigente, incorpora operaciones actuales nuevas pendientes sin fechas, descarta históricas ausentes y cambios autogenerados de herramental, y emite las seis métricas requeridas.
- Los payloads completos se guardan mediante manifiesto fragmentado bajo `PLAN_SNAPSHOT_PAYLOAD::<snapshotId>`; `PP_getPlanSnapshot_` agrega `fullState` cuando existe y conserva lectura por filas para históricos anteriores.
- `restorePublishedPlanAsDraft(snapshotId, currentPayload)` se expone públicamente y en el bridge. El servicio valida el snapshot, adquiere script lock, crea backup técnico fuera de `listPlanSnapshots`, reconcilia, escribe draft/estado y compensa ambos ante error antes de relanzar.
- `PLANES_HISTORICOS` sólo recibe las filas normales de publicación; la restauración no modifica el histórico.
- Corrección P1: snapshots y drafts con cero filas programadas se listan desde su manifiesto y se recuperan desde `fullState`; los IDs técnicos se excluyen explícitamente.
- Corrección P1: la escritura de payload usa una generación de staging. Los chunks nuevos se completan antes de cambiar el manifiesto base; ante error se elimina staging y el manifiesto anterior permanece legible. El reemplazo/rollback del draft restaura también el payload anterior, incluyendo drafts legacy de sólo filas.
- Corrección P1 final: `PP_storePlanSnapshotPayload_` devuelve un token de transacción y acepta limpieza diferida. En draft, la generación previa vive hasta completar filas, auditoría y flush; rollback repone atómicamente su manifiesto y limpia sólo la generación fallida.

## Verificación

- Suite completa: 58/58 pruebas.
- `npm.cmd run check`: validación correcta.
- `npm.cmd run build`: Apps Script y GitHub Pages generados.
- `git diff --check`: sin errores (sólo avisos de normalización LF/CRLF del entorno).

## Auto-revisión y preocupaciones

- Se fragmentó el payload para evitar el límite por valor de Script Properties.
- El rollback intenta restaurar estado y draft de forma independiente; si alguno falla, relanza el error original marcado `ROLLBACK_INCOMPLETO`.
- Riesgo operativo residual: Script Properties tiene cuota total finita; conviene definir retención/depuración de snapshots técnicos e históricos en una tarea futura. No se degradaron las garantías solicitadas en esta tarea.
