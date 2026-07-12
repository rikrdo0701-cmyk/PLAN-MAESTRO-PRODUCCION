# Diseño: limpieza del borrador, reportes diarios y doblado

## Objetivo

Eliminar la mezcla de programación antigua sin perder configuraciones maestras ni planes históricos, y reconstruir un borrador coherente desde NetSuite.

## Respaldo y limpieza

Antes de modificar la hoja `PLANDATA`, se creará una copia de respaldo completa en Google Drive.

Se limpiarán únicamente datos transaccionales del borrador:

- filas de `OPERACIONES` y `MATERIALES` que representan el estado sincronizado/programado actual;
- `ESTADOS_OPERACION_PLAN` del borrador;
- en `CONFIG`: `selectedOts`, `lockedOts`, `expandedOts`, `lastSchedule`, `draftVersionId` y programación temporal.

Se preservarán `CONFIGURACION_ARTICULO`, `CONFIGURACION_OT`, `HERRAMENTALES`, `MATRIZ`, `OPERADORES`, `MAQUINAS`, `SUBCONTRATOS`, calendarios, tipos y `PLANES_HISTORICOS`.

Después de limpiar se ejecutará sincronización NetSuite en dos fases. El borrador nuevo deberá contener exclusivamente OTs vigentes y ninguna programación anterior.

## Coherencia del borrador

Gantt, KPI, backlog, Planeado/Por planear, cargas y reportes del borrador usarán la misma lista `selectedOts`. Una OT no seleccionada no aparecerá como parte del borrador programado.

## Planes diarios

Operador, Ajustador y Subcontratos mostrarán el borrador por defecto durante la planeación. Cuando exista un plan `PUBLICADO`, mostrarán el último publicado como fuente operativa aprobada. El selector permitirá cambiar entre `Borrador` y publicados.

Los comentarios serán editables únicamente en Borrador y se persistirán. En publicados serán de solo lectura.

La columna de acción `Completado` permanecerá disponible en pantalla, pero se ocultará en impresión/PDF sin dejar una columna vacía.

## Doblado y herramental

Las operaciones CT `5459`/`5527` sincronizadas sin máquina, herramental o kit no se descartarán. La preparación de la OT solicitará esos datos precargando el catálogo del artículo.

Con dos OTs en la misma máquina y herramientas diferentes, el resultado incluirá ambas operaciones productivas y `CAMBIO_HERRAMENTAL` con ajustador, duración, origen y destino. Si falta configuración, aparecerá diagnóstico visible con OT, secuencia y campo faltante.

## Verificación

- Existe copia de respaldo antes de limpiar.
- Catálogos/configuraciones/históricos conservan sus filas.
- Tablas transaccionales quedan vacías antes de resincronizar.
- NetSuite repuebla OTs y operaciones vigentes.
- El borrador no muestra OTs fuera de Planeado/Por planear.
- Comentarios editables persisten; Completado no se imprime.
- Doblado y cambio aparecen o muestran diagnóstico concreto.
- Suite, build y QA en GitHub Pages pasan sin errores relevantes.
