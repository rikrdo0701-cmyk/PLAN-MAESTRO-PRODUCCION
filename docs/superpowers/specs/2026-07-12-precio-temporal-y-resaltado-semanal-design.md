# Precio temporal editable y resaltado del plan semanal

## Objetivo

Permitir editar o eliminar el precio temporal de cada artículo directamente desde el catálogo, y distinguir visualmente en el reporte Plan de la semana las OTs de tipo PROTOTIPO y EXPEDITADO.

## Precio temporal

- La columna `Precio temporal` del catálogo de configuración de artículos mostrará un campo numérico editable.
- Admitirá números mayores o iguales a cero.
- Un campo vacío o el valor `0` eliminará el precio temporal guardando `manualUnitPrice: 0`.
- El cambio se guardará al modificar la casilla y conservará sin cambios el Tipo comercial y el Tipo de trabajo.
- La generación posterior del plan resolverá el precio en este orden: precio de factura vigente, precio temporal mayor que cero y, si ninguno existe, cero.
- La edición actualizará la fecha de modificación del artículo y utilizará el flujo existente de guardado de catálogos.

## Resaltado del Plan de la semana

- Las filas cuya configuración de artículo tenga Tipo de trabajo `PROTOTIPO` usarán un fondo morado claro y un acento morado.
- Las filas con Tipo de trabajo `EXPEDITADO` usarán un fondo naranja claro y un acento naranja.
- Las filas `NORMAL` o sin tipo reconocido conservarán el estilo actual.
- El resaltado se aplicará tanto a OTs que inician como a OTs que terminan.
- Los colores se conservarán al imprimir mediante `print-color-adjust: exact` y no modificarán los colores de totales, encabezados o cintas de día.

## Datos y compatibilidad

- Se reutilizará `articleConfigurations`; no se añadirá una tabla nueva.
- La clasificación visual se calculará con el artículo de cada fila y su `planningType` normalizado.
- Los planes publicados conservarán los datos de operaciones; cuando el reporte incluya el tipo de trabajo en su instantánea se usará ese valor y, en caso contrario, se consultará la configuración actual del artículo.

## Validación

- Prueba de edición a un precio positivo.
- Prueba de eliminación mediante campo vacío y mediante cero.
- Prueba de conservación de Tipo comercial y Tipo de trabajo.
- Prueba de clases PROTOTIPO, EXPEDITADO y NORMAL en filas semanales.
- Verificación de estilos de impresión y build completo.
