# Restauración de borrador, cambios de herramental en Gantt y costo semanal

## Objetivo

Permitir que cualquier plan publicado histórico se copie de forma segura a un nuevo borrador, mostrar en el Gantt por máquina los cambios de herramental que ya existen en el plan y calcular el costo por pieza de la semana usando únicamente las OTs que terminan dentro de esa semana.

## Principios

- Los planes publicados son históricos, inmutables y exclusivamente de consulta, reporte e impresión.
- El borrador es la única versión editable.
- Restaurar nunca modifica el plan publicado seleccionado.
- El estado productivo actual prevalece sobre el histórico: una OT cerrada no se reactiva y una operación completada no vuelve a pendiente.
- Los recursos y precios actuales prevalecen sobre los históricos cuando existen; el histórico funciona como respaldo.
- Un precio explícito de cero es válido y no se considera un dato faltante.

## Restaurar un histórico como borrador

### Entrada desde Plan semanal

Plan semanal tendrá una acción `Restaurar borrador`. La acción abrirá una lista con todos los planes publicados históricos. Cada opción mostrará fecha y hora de publicación, usuario, fecha inicial del plan y cantidad de operaciones.

Los planes históricos no se abrirán en el espacio editable. Seleccionar uno únicamente prepara la restauración.

### Estado de sincronización

Antes de preparar la restauración, el modal mostrará la fecha y hora de la última sincronización disponible. El usuario podrá:

- continuar con los datos ya cargados; o
- ejecutar `Sincronizar antes de restaurar`.

La sincronización seguirá usando su timeout existente. Si falla, no se modificará el borrador y el usuario podrá cancelar o continuar explícitamente con los datos cargados.

La sincronización y la restauración no podrán ejecutarse mientras el motor esté programando. Recíprocamente, el motor no podrá iniciar mientras alguna de esas acciones esté activa.

### Reconciliación

La vista previa comparará la instantánea publicada con el estado actual y clasificará sus elementos:

- OT abierta y operación pendiente: se restaurará.
- OT cerrada o ausente del conjunto actual de OTs abiertas: se omitirá por completo.
- Operación completada en el estado actual: conservará su condición completada; permanecerá disponible en el detalle, pero no aparecerá en Gantt, cargas ni reportes pendientes.
- Operación eliminada de la secuencia actual: se omitirá y se informará como eliminada.
- Operación nueva en la secuencia actual: se incorporará como pendiente sin horario publicado.
- Operación modificada: se usará la identidad y secuencia actuales, conservando el horario publicado solo cuando siga correspondiendo a la misma operación.

La identidad de una operación productiva se resolverá con la misma clave estable utilizada para completar/reabrir operaciones. Los cambios de herramental autogenerados no se reconciliarán como operaciones productivas: se regenerarán al volver a ejecutar el motor.

### Precedencia de datos

Para cada OT restaurada se aplicará esta prioridad:

1. Estado actual de la OT y de sus operaciones.
2. Marcadores actuales de completada/reabierta.
3. Configuración actual específica de la tarjeta: máquina, herramental, kit y subcontrato.
4. Configuración publicada, únicamente como respaldo cuando no exista un dato actual.
5. Catálogo por artículo, únicamente cuando tampoco exista un dato publicado.

El plan restaurado conservará del histórico la prioridad, fechas y asignaciones que todavía sean compatibles. Las operaciones pendientes sin correspondencia segura quedarán sin horario para que el usuario vuelva a generar el plan.

### Confirmación y persistencia

La vista previa mostrará como mínimo:

- OTs que se restaurarán.
- OTs omitidas por estar cerradas.
- Operaciones completadas conservadas.
- Operaciones eliminadas u operaciones nuevas.
- Configuraciones actuales conservadas.

Antes de reemplazar el borrador, el servidor conservará una copia de seguridad de la instantánea `draft` vigente. La copia será de recuperación técnica y no aparecerá como un plan publicado.

Al confirmar:

1. Se guarda la copia de seguridad.
2. Se reemplaza la instantánea única `draft` por el resultado reconciliado.
3. Se actualiza el estado editable de Plan semanal con las OTs restauradas.
4. Se presenta el borrador sin ejecutar automáticamente el motor.

Si cualquier escritura falla, se restaura atómicamente el borrador anterior y se informa el error. El plan publicado permanece sin cambios en todos los casos.

## Cambio de herramental en Gantt por Máquina

### Causa actual

La vista por máquina filtra con `ganttOperationHasMachine`, que actualmente acepta únicamente operaciones de doblado. Las operaciones `CAMBIO_HERRAMENTAL` sí contienen máquina, inicio y fin, pero quedan excluidas por ese filtro.

### Comportamiento requerido

La línea de cada máquina mostrará:

- operaciones productivas de doblado asignadas a esa máquina; y
- cambios de herramental generados en la ejecución actual que tengan esa misma máquina e inicio/fin programados.

El cambio se dibujará en el intervalo real durante el cual ocupa la máquina. Tendrá estilo visual distinto de una operación productiva y una etiqueta compacta `Cambio de herramental`.

El tooltip mostrará OT asociada, máquina, herramental/kit origen, herramental/kit destino, ajustador, inicio, fin y duración. El cambio seguirá apareciendo en el plan del ajustador; incluirlo en la vista Máquina no lo duplicará en la capacidad.

Los cambios históricos pendientes de ejecuciones anteriores seguirán excluidos. Los cambios completados permanecerán solo como historial y no consumirán capacidad ni aparecerán como pendientes.

## Sincronización ligera de OTs en Backlog

### Alcance

El encabezado de Backlog tendrá una acción `Sincronizar OTs`. Esta consulta será independiente de la sincronización completa y obtendrá únicamente:

- número de OT;
- artículo;
- cantidad total;
- cantidad fabricada;
- cantidad pendiente; y
- existencia o estado abierto/cerrado de la OT.

No leerá ni modificará operaciones, materiales, catálogos, máquinas, herramentales, kits, subcontratos ni configuraciones del motor.

### Reglas de actualización

- Una OT nueva y abierta se agregará al Backlog.
- Una OT abierta ya conocida actualizará artículo y cantidades sin cambiar su pertenencia actual a Backlog o Planeado/Por planear.
- Una OT cerrada o eliminada desaparecerá del Backlog.
- La consulta nunca moverá masivamente OTs del Backlog a Planeado/Por planear ni en sentido contrario.
- La sincronización ligera no podrá ejecutarse mientras el motor esté generando, mientras se sincronice el conjunto completo ni mientras se restaure un borrador.

### OTs planeadas que fueron cerradas o eliminadas

Si una OT cerrada o eliminada está en Planeado/Por planear, la sincronización no la retirará silenciosamente. Mostrará una confirmación con las OTs afectadas y el efecto de retirarlas del borrador.

Al confirmar:

- se retiran de `selectedOts` y de la prioridad del plan;
- sus operaciones pendientes dejan de aparecer en el Gantt, cargas y reportes del borrador;
- sus marcadores de operaciones completadas se conservan como historial; y
- se reemplaza la instantánea `draft` con el estado coherente resultante.

Al cancelar, esas OTs permanecen visibles en Planeado/Por planear con una advertencia `Cerrada o no encontrada en NetSuite` y el motor no podrá volver a programarlas. La advertencia persistirá hasta que el usuario las retire o una sincronización posterior las reporte abiertas.

Las OTs bloqueadas también requerirán confirmación. Confirmar la depuración por cierre de NetSuite tendrá precedencia sobre el bloqueo manual, pues una OT cerrada no puede seguir consumiendo capacidad; el diálogo deberá indicarlo expresamente.

### Cambios de cantidad en OTs planeadas

Una diferencia en cantidad total, fabricada o pendiente de una OT que permanezca en Backlog se aplicará directamente. La misma diferencia en una OT de Planeado/Por planear requerirá confirmación porque cambia la duración productiva y puede invalidar el horario del borrador.

La confirmación mostrará OT, artículo, valores anteriores y nuevos, e indicará que será necesario volver a generar el plan. Por ejemplo: `La OT 2433 cambió de 30 a 45 piezas pendientes. Este cambio afecta la duración de sus operaciones y requiere volver a generar el plan.`

Al aceptar una diferencia de cantidad:

- se actualizan cantidad total, fabricada y pendiente;
- las operaciones pendientes no bloqueadas de esa OT pierden sus fechas y horas calculadas;
- las operaciones completadas conservan estado y fechas históricas;
- el borrador se marca `Requiere reprogramación`; y
- el motor no se ejecuta automáticamente.

Si la OT está bloqueada, se actualizan sus cantidades pero se conservan inicialmente sus fechas, horas y recursos bloqueados. El borrador queda marcado con una incompatibilidad explícita entre cantidad y programación bloqueada; el usuario deberá desbloquear y volver a generar para recalcularla. El motor nunca moverá silenciosamente una operación bloqueada.

Al cancelar, el borrador conserva las cantidades anteriores y la tarjeta muestra una advertencia con las cantidades distintas reportadas por NetSuite. Una sincronización posterior volverá a ofrecer la actualización mientras persista la diferencia.

## Costo por pieza semanal

### Universo de cálculo

El resumen tomará una sola fila por OT cuya última operación productiva termine dentro de la semana seleccionada. No incluirá OTs que únicamente inician en esa semana ni cambios de herramental.

Para cada OT que termina:

- `piezasTerminadas` será la cantidad pendiente capturada en su instantánea o estado actual, contabilizada una sola vez.
- `precioUnitario` será el precio persistido para esa OT/artículo, incluido cero como valor válido.
- `montoOT` usará el monto persistido cuando esté disponible; si el monto está ausente pero el precio está presente, será `precioUnitario × piezasTerminadas`.

La ausencia de un valor debe representarse como `null`, `undefined` o campo vacío; el número `0` representa un valor explícito.

### Fórmulas

```text
piezasTotalesSemana = suma(piezasTerminadas de cada OT que termina)
costoTotalSemana = suma(montoOT de cada OT que termina)
costoPorPieza = piezasTotalesSemana > 0
  ? costoTotalSemana / piezasTotalesSemana
  : 0
```

El resumen mostrará `Costo P/P` con formato monetario. Las agrupaciones por tipo de OT aplicarán la misma fórmula y el mismo tratamiento de cero explícito.

## Límites y exclusiones

- No se implementará navegación ni edición directa de planes publicados.
- No se implementará historial visible de todas las revisiones del borrador.
- Restaurar no reabrirá operaciones automáticamente.
- Restaurar no publicará ni generará automáticamente un plan.
- No se alterará la regla de 25 registros por reporte impreso.
- La sincronización ligera de Backlog no sustituye la sincronización completa necesaria para obtener operaciones y recursos.

## Pruebas de aceptación

### Restauración

- Se puede elegir cualquier histórico publicado desde Plan semanal.
- Una OT cerrada se omite y no aparece en Planeado/Por planear.
- Una operación completada permanece completada y no consume capacidad.
- Una operación nueva se incorpora pendiente y sin horario histórico inventado.
- La configuración actual de una tarjeta prevalece sobre la publicada.
- Un fallo de sincronización o escritura conserva intacto el borrador anterior.
- El histórico seleccionado permanece idéntico después de restaurar y editar el borrador.

### Gantt

- Dos OTs con la misma máquina y herramientas distintas generan un cambio.
- El cambio aparece en el plan del ajustador y en la línea de esa máquina.
- La barra ocupa exactamente inicio-fin y no agrega una segunda reserva de capacidad.
- La vista OT, CT y Operador conserva su comportamiento actual.

### Resumen semanal

- Solo las OTs que terminan en la semana aportan piezas y monto.
- Cada OT aporta una sola vez aunque tenga muchas operaciones.
- Un monto ausente se reconstruye desde precio por piezas.
- Un precio explícito de cero produce monto cero y no activa otro fallback.
- Sin piezas terminadas, `Costo P/P` muestra `$0.00`.
- La suma general y las agrupaciones por tipo son consistentes.

### Sincronización ligera

- Una OT nueva se agrega únicamente al Backlog.
- Un cambio de cantidades actualiza la tarjeta sin cambiarla de columna.
- Una OT cerrada desaparece del Backlog.
- Un cambio de cantidad en Backlog se aplica sin confirmación.
- Un cambio de cantidad en Planeado/Por planear requiere confirmación y no ejecuta automáticamente el motor.
- Aceptar el cambio limpia horarios pendientes no bloqueados y marca el borrador para reprogramar.
- Una OT bloqueada conserva horarios y muestra incompatibilidad hasta ser desbloqueada y reprogramada.
- Cancelar conserva la cantidad del borrador y muestra la diferencia reportada por NetSuite.
- Una OT planeada cerrada solicita confirmación antes de retirarse.
- Cancelar conserva la OT planeada con advertencia y la excluye de la siguiente programación.
- Confirmar retira la OT planeada, limpia su capacidad pendiente y conserva el historial completado.
- La consulta no modifica operaciones, materiales ni configuraciones del motor.
