# Reporte final de correcciones de review

## Alcance corregido

1. **Sincronizacion ligera sin escritura previa**
   - Se agrego `fetchNetSuiteWorkOrdersLite`, endpoint de solo lectura expuesto por el bridge.
   - El backlog compara el preview, resuelve el dialogo, aplica las decisiones y solo entonces persiste con `savePlanningStateOptimized`.
   - `syncNetSuiteTwoPhase({ persist: false })` permite que la vista previa de restore no persista el estado local confirmado.

2. **Seleccion enviada al motor**
   - `schedulingSelectedOts` excluye unicamente OTs con advertencia `CLOSED_KEPT`.
   - Las OTs bloqueadas permanecen en `selectedOts` del motor para reservar capacidad; `readyOts` queda limitado a preparacion/reprogramacion movible.

3. **Contrato del preview de restore**
   - El preview acepta resultados `complete` y `partial` de `netSuiteSyncOutcome`.
   - Solo aborta cuando `status === "failed"`; se elimino el uso de la propiedad inexistente `ready`.

4. **Cancelacion del dialogo de cambios planeados**
   - Cancelar equivale a rechazar los cambios planeados, pero el flujo continua.
   - Los cambios directos de Backlog se aplican y se persisten; cantidades/cierres planeados quedan advertidos como pendientes.

5. **Restore seguro entre pestanas**
   - Bajo el lock, el servidor lee `currentState` y reconcilia exclusivamente contra ese estado.
   - Se compara la revision del payload con la revision vigente y se devuelve `stalePayload`; el payload obsoleto nunca se usa para sobrescribir el estado de otra pestana.

## TDD

- RED confirmado: fallo de API `schedulingSelectedOts` ausente y aserciones de build/source para los cinco flujos anteriores.
- GREEN focalizado: 45 pruebas aprobadas, 0 fallos.
- Pruebas agregadas/ajustadas cubren OTs bloqueadas y `CLOSED_KEPT`, endpoint read-only, persistencia posterior al dialogo, cancelacion con cambios directos, contrato partial/failed y reconciliacion servidor contra estado bajo lock.

## Verificacion final

- `npm.cmd test`: 69 aprobadas, 0 fallos.
- `npm.cmd run check`: validacion correcta.
- `npm.cmd run build`: Apps Script y GitHub Pages generados correctamente.
- `git diff --check`: sin errores.
- No se creo commit; el worktree queda listo para revision/commit del integrador.

## Aislamiento adicional del preview de restore

- `refreshRestorePreviewData` consulta exclusivamente `fetchNetSuiteWorkOrdersLite`; no llama `syncNetSuitePlanningData`, no usa `saveState`, no renderiza y no persiste snapshots o estado backend.
- La respuesta queda staged y solo se incorpora al estado en memoria si el usuario decide continuar; cancelar no altera los datos cargados.
- Como la lectura ligera solo refresca OTs, se clasifica como `partial` salvo que el contrato declare expresamente `previewComplete`; resultados `partial` o `failed` muestran un dialogo explicito con Cancelar y **Continuar con datos cargados**. Solo `complete` avanza sin ese paso.
- RED: la prueba de build detecto la llamada a `syncNetSuiteTwoPhase({ persist: false })` dentro del preview.
- GREEN: la prueba sensible verifica ausencia de `syncNetSuitePlanningData`, `saveState`, persistencias y render dentro del cuerpo read-only y del preview.

## Regla definitiva de revision y estado staged

- El navegador crea `previewState` desde el payload actual y mezcla ahi las OTs frescas. Nunca asigna el estado global durante preview; cancelar cualquiera de los dialogos deja `state` identico.
- La confirmacion envia exactamente `previewState` a `restorePublishedPlanAsDraft`. El estado global solo se reemplaza con `result.state` despues de una respuesta exitosa del servidor.
- Bajo lock, el servidor compara `Number(currentPayload.revision)` con `Number(currentState.revision)`. Si coinciden, el payload no es obsoleto y la reconciliacion usa `currentPayload`, incluyendo las OTs staged. Si difieren, se marca `stalePayload` y se reconcilia contra `currentState`, evitando sobrescribir cambios de otra pestana.
- RED: el build detecto firma de confirmacion sin `previewState`, reconciliacion cliente contra `state` y reconciliacion servidor fija contra `currentState`.
- GREEN: las pruebas de source verifican el orden y las fuentes de estado descritas arriba.
