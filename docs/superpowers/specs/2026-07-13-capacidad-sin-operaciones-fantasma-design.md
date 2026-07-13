# Capacidad sin operaciones fantasma y trazabilidad de esperas

## Objetivo

Reconstruir la capacidad de cada generación exclusivamente con las operaciones autorizadas por el borrador actual, evitando que fechas, bloqueos o cambios de herramental antiguos provoquen huecos. Toda espera real deberá conservar su causa.

Este diseño complementa `2026-07-13-gantt-tiempo-productivo-design.md`.

## Conjunto autorizado

Al iniciar una generación, el motor crea un conjunto autorizado a partir de `selectedOts`, que representa las OTs presentes en `Planeado / Por planear`.

Solo consumen capacidad:

1. Operaciones pendientes, activas y programables pertenecientes a OTs seleccionadas.
2. Operaciones bloqueadas pertenecientes a OTs seleccionadas.
3. Cambios de herramental creados durante la generación actual.

No consumen capacidad:

- OTs que se encuentran en el backlog.
- Operaciones completadas.
- Operaciones cerradas, canceladas o eliminadas.
- Fechas residuales de borradores anteriores pertenecientes a OTs no seleccionadas.
- Cambios de herramental generados en ejecuciones anteriores.
- Operaciones bloqueadas cuya OT no pertenece al conjunto seleccionado; la interfaz impedirá producir este estado.

## Operaciones bloqueadas

- Una OT bloqueada que permanece seleccionada conserva sin cambios sus fechas, horas, operador, máquina, herramental y secuencia.
- Sus operaciones reservan operador y máquina para impedir solapamientos reales.
- La acción de devolver una OT bloqueada al backlog se rechaza.
- La interfaz muestra `Desbloquea la OT antes de retirarla del plan`.
- Después de desbloquearla, la OT puede volver al backlog y deja de reservar capacidad inmediatamente.

## Limpieza antes de programar

Antes de buscar huecos, el motor y el flujo de borrador:

1. Eliminan los cambios de herramental generados por ejecuciones anteriores.
2. Ignoran por completo las fechas de operaciones no seleccionadas al construir mapas de ocupación.
3. Conservan operaciones completadas únicamente como historial visible; no reservan capacidad.
4. Conservan las fechas de operaciones bloqueadas seleccionadas y las insertan en los mapas de ocupación.
5. Limpian y reprograman únicamente operaciones pendientes y movibles de OTs seleccionadas.

## Trazabilidad de esperas

Cuando una operación no comienza en su fecha de precedencia más temprana, el resultado almacena:

- `esperaMinutos`: diferencia entre inicio asignado e inicio más temprano, sin contar valores negativos.
- `causaEspera`: `OPERADOR`, `MAQUINA`, `CALENDARIO`, `CAMBIO_HERRAMENTAL` o `SIN_CAUSA`.
- `recursoEspera`: nombre del operador, máquina o evento de calendario.
- `otBloqueadora`: OT que posee el intervalo de ocupación, cuando exista.
- `secuenciaBloqueadora`: secuencia que posee el intervalo, cuando exista.

Los intervalos ocupados conservarán referencias a su operación de origen, no solamente fechas de inicio y fin.

## Presentación en el Gantt

El tooltip combina esta trazabilidad con el diseño de tiempo productivo:

```text
20 min productivos · 5 min no operativos
Espera 20 min: OPERADOR 2 ocupado por OT 2436, secuencia 4
Inicio 13/07 15:32 · Fin 13/07 15:55
```

Si no hubo espera, se omite la línea correspondiente. Si existe una espera sin causa identificable, se muestra `Espera N min: causa no identificada` para evitar ocultarla.

## Casos de aceptación

### OT retirada al backlog

- OT 100 conserva fechas antiguas, pero no aparece en `selectedOts`.
- OT 200 está seleccionada y utiliza el mismo operador.
- La OT 100 no reserva capacidad.
- La OT 200 inicia en el primer momento permitido por calendario y precedencia.

### OT bloqueada seleccionada

- OT 100 está seleccionada, bloqueada y programada 08:00–09:00.
- OT 200 está seleccionada y utiliza el mismo operador.
- OT 100 conserva exactamente 08:00–09:00.
- OT 200 se programa fuera de ese intervalo y registra a OT 100 como bloqueadora si tuvo que esperar.

### Retirar una OT bloqueada

- El usuario intenta regresar OT 100 al backlog.
- La acción no modifica `selectedOts`, prioridades ni operaciones.
- Se muestra el mensaje para desbloquearla primero.

### Cambio antiguo

- Existe un cambio de herramental generado en una ejecución anterior.
- Al generar nuevamente, ese cambio no reserva ajustador ni máquina.
- Solo los cambios requeridos por la nueva secuencia se vuelven a crear.

## Componentes afectados

- `planning-workflow-core.js`: limpieza del borrador y rechazo consistente de retiro bloqueado.
- `planner-core.js`: construcción del conjunto autorizado, ocupación con metadatos y diagnóstico de esperas.
- `app.js`: impedir el movimiento al backlog y mostrar causas en el tooltip.
- Pruebas del motor, flujo y build.

## Fuera de alcance

- Mover automáticamente una OT bloqueada.
- Reservar capacidad a partir de planes publicados que no están cargados como borrador actual.
- Convertir operaciones completadas en bloqueos de capacidad.
- Inferir manualmente una causa histórica cuando la instantánea original ya fue reemplazada.

## Verificación

- Prueba de operación antigua no seleccionada que no bloquea.
- Prueba de OT bloqueada seleccionada que conserva fechas y sí bloquea.
- Prueba de rechazo al retirar una OT bloqueada.
- Prueba de limpieza de cambio de herramental antiguo.
- Prueba de conflicto real con OT y secuencia bloqueadoras.
- Pruebas de tiempo productivo e intervalo real.
- Suite completa, build y QA en navegador.
