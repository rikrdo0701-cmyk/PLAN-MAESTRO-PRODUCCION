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
