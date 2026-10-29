# Réplica de Hoja de inspección

## Objetivo

Reemplazar la presentación simplificada de Hoja de inspección por una réplica funcional del módulo original ubicado en `nesesidades prod`, conservando su panel lateral y su formato de impresión. La única ampliación visual será la selección temporal de operaciones que deben imprimirse.

## Alcance visual

- Replicar el panel lateral original: selector de trabajo, búsqueda, estado, historial de impresiones, semáforo, acciones y nota informativa.
- Conservar la estructura y jerarquía de los botones `Cargar`, `Ver dibujo`, `Editar liga` e `Imprimir`.
- Añadir `Seleccionar operaciones` como acción secundaria integrada con el mismo lenguaje visual.
- Replicar el documento MP FO 08 V23: logotipo, título, datos de OT, materiales, tabla principal de setup/inactividad/producción, segundo bloque de captura y pie de no conformidad, liberación, observaciones y entrega.
- Imprimir en una sola hoja horizontal con el escalado del módulo original.

## Selección de operaciones

- Al cargar una OT, todas sus operaciones de NetSuite quedan seleccionadas.
- `Seleccionar operaciones` muestra casillas junto a la lista de operaciones.
- Desmarcar una operación solamente la excluye de la impresión actual; no modifica NetSuite ni el plan de producción.
- La selección se reinicia al cambiar de OT o recargar la vista.
- Las operaciones ocultas no dejan filas intermedias vacías. Las visibles conservan su orden original y se compactan desde la primera fila.
- Las filas libres requeridas por el formato se agregan solamente después de la última operación visible.

## Arquitectura

- `inspection-app.js` conserva la carga de datos, historial, semáforo, enlaces, selección y acciones.
- `inspection.css` incorpora el diseño original de pantalla y las reglas de impresión horizontal.
- La plantilla de la hoja se mantiene dentro del módulo de inspección y no se mezcla con el motor de planeación.
- `inspection-core.js` mantiene funciones puras para selección, filtrado, orden y distribución de filas, facilitando pruebas unitarias.
- El servidor existente continúa siendo la fuente de OTs, materiales, operaciones, dibujos e historial.

## Datos y comportamiento

- El selector muestra las OTs abiertas disponibles para inspección.
- `Cargar` obtiene el detalle vigente y vuelve a construir toda la hoja.
- El semáforo usa los datos disponibles de tramos, dibujos, materiales y pendientes.
- `Ver dibujo` y `Editar liga` reutilizan las rutas y métodos existentes.
- `Imprimir` registra el evento y abre la impresión únicamente con la hoja, sin navegación ni controles.
- Los datos ausentes muestran campos vacíos o el estado correspondiente sin romper la cuadrícula.

## Validación

- Pruebas unitarias para selección inicial, filtrado, reinicio, orden y compactación de filas.
- Comparación visual contra `Necesidades de Produccion.pdf` y el módulo original.
- Prueba en navegador de carga de OT, selección/deselección, botones, semáforo e impresión.
- Renderizar la impresión a PDF y PNG para verificar una sola hoja horizontal, proporciones, texto legible, ausencia de cortes y filas compactas.
- Ejecutar la validación completa del proyecto antes de publicar.

## Criterios de aceptación

- La pantalla y el documento impreso se reconocen como una réplica del módulo original.
- El PDF conserva todos los bloques y columnas del formato MP FO 08 V23.
- La selección de operaciones funciona por sesión y no deja huecos intermedios.
- La impresión cabe en una sola hoja horizontal.
- La integración no altera el motor, el Gantt, los planes ni los reportes existentes.
