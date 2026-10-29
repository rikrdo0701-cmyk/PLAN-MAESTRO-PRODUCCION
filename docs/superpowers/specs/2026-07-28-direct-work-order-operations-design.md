# Operaciones directas de NetSuite por OT

## Objetivo

Obtener operaciones completas de una OT desde NetSuite al agregarla al plan o abrir su detalle, sin recargar toda la aplicación.

## Fuente de datos

El backend consultará SuiteQL sobre `manufacturingoperationtask` usando el ID interno de la orden de trabajo. Por operación obtendrá:

- secuencia;
- centro de trabajo y descripción;
- tiempo de preparación;
- tiempo por pieza.

El tiempo estimado total será `preparación + (tiempo por pieza × cantidad pendiente)`. Una operación con tiempo por pieza cero seguirá siendo válida cuando tenga preparación positiva.

## Flujo

Una función backend por OT devolverá datos de la orden, materiales y operaciones directas. El cliente reutilizará una única solicitud concurrente por OT y conservará el resultado en el estado.

La consulta se ejecutará al:

- pulsar `+` desde Backlog;
- arrastrar una tarjeta de Backlog a Planeado;
- abrir el detalle de una OT.

El detalle abrirá inmediatamente, mostrará un estado de carga en Operaciones y se actualizará sin refrescar la página.

## Caché y actualización

Los datos completos ya cargados se reutilizarán durante la sesión. No se repetirá una consulta cuando exista una solicitud en curso para la misma OT. La sincronización general podrá reemplazar posteriormente esos datos.

## Errores

Si la consulta directa falla, la OT no perderá datos existentes. El detalle mostrará el error y las acciones de agregar conservarán el bloqueo actual cuando no haya operaciones programables.

## Pruebas

- SuiteQL transforma CT, secuencia y tiempos de la OT 2773.
- El cálculo usa preparación más tiempo por pieza por cantidad pendiente.
- Abrir el detalle inicia una sola consulta y actualiza sus operaciones.
- `+` y drag-and-drop comparten la misma carga.
- Las solicitudes simultáneas para una OT se deduplican.
- Un error conserva el estado existente y permite reintentar.
