# Confirmacion del alta de periodos no laborales

## Caso reportado

El usuario agrego ASUETO, motivo `independencia`, fecha `2026-09-16`, sin horas
(00:00–24:00), y desaparecio al recargar. Solo pulso Agregar periodo.
No se dispone de un acuse ni del error de esa escritura concreta: no se puede
atribuir el incidente a un conflicto remoto confirmado.

## Origen y persistencia

`addCalendarException` en `src/web/planning/app.js` toma concepto, recurso,
maquina, fecha inicial/final, horas y motivo del formulario de Calendario.
El ASUETO usa la misma fecha de inicio y fin; sin horas, 00:00 y 24:00.
El estado es `state.calendarExceptions`, con campos `id`, `concept`, `machine`,
`resource`, `startDate`, `endDate`, `start`, `end`, `reason`, `active`.

El alta marca el scope `catalogs` y usa el escritor existente `saveAppSheet`.
En el cliente optimizado, `catalogSavePayload` incluye `calendarExceptions`
y llama `saveCatalogState`. El backend `PP_writeCatalogState_` escribe
CALENDARIO del workbook PLANNING_SPREADSHEET_ID. Columnas: ID, CONCEPTO,
MAQUINA (tambien recurso OPERADOR), FECHA_INICIO, HORA_INICIO, FECHA_FIN,
HORA_FIN, MOTIVO, ACTIVO. El guardado completo `PP_writeState_` tambien
serializa esta tabla. La lectura es `PP_readState_` / `PP_mapCalendar_`.
`renderCalendarExceptions` muestra los registros y `PlannerCore.effectiveWindows`
los utiliza para restar disponibilidad. No se agrega un escritor nuevo.

## Cambio

Antes, Agregar periodo mostraba exito y limpiaba el formulario antes del
guardado automatico diferido. Ahora espera el guardado existente, marca
catalogos y solicita la escritura inmediatamente. El boton queda ocupado
hasta recibir respuesta. Solo un resultado exitoso limpia el formulario y
muestra “Periodo no laborable guardado en la hoja”. Un fallo conserva la
captura y pide reintentar; reintentar el mismo registro no lo duplica.

Esto no garantiza conservar una peticion interrumpida por cerrar o recargar
antes de la confirmacion. Tampoco cambia la recuperacion global de conflictos:
si esta reemplaza el calendario pendiente, queda el formulario para reenviarlo.
El asueto reportado no se inserta automaticamente en produccion.

## Verificacion

`tests/calendar-save.test.mjs` ejercita el handler con confirmacion diferida,
asueto de dia completo, fallo/reintento y reemplazo remoto por conflicto.
Estas pruebas simulan la escritura; no constituyen una lectura de la hoja real.
