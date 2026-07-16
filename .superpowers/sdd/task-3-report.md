# Task 3 - Fidelidad visual e impresión horizontal

## Estado

Implementación terminada y verificación automatizada aprobada. La comparación visual con PDF real quedó bloqueada y no se presenta como aprobada.

## Cambios

- Panel lateral replicado con tarjetas, radios, tipografía y cuadrícula de acciones; la hoja conserva 1280 px y desplazamiento en pantalla.
- Documento migrado de tabla plana a cuadrícula de 24 columnas, con bordes negros, encabezados agrupados de setup, inactividad y producción, segunda captura y pie.
- Impresión horizontal con márgenes `3mm 8mm 5mm 9mm`, ocultamiento del chrome de la app y escala mediante `--inspection-print-scale`.
- Cálculo previo a imprimir con razones de ancho/alto, límite `Math.min(1, widthRatio, heightRatio)` y limpieza en `afterprint`.
- Prueba de build actualizada mediante ciclo RED-GREEN para cubrir la cuadrícula, agrupaciones, regla de página y escala.

## Pruebas y evidencia

- RED: `npm.cmd test -- --test-name-pattern="builds Apps Script"` falló inicialmente porque no existía `.inspection-grid` con 24 columnas.
- GREEN: el mismo comando pasó después de implementar; 85 pruebas totales, 0 fallas.
- `npm.cmd test`: 85/85, código 0.
- `npm.cmd run build`: código 0; Apps Script y GitHub Pages generados.
- `npm.cmd run check`: código 0; "Validacion correcta".
- `git diff --check`: código 0.

## Auto-revisión

- Cada encabezado, subencabezado y fila de operación suma 24 columnas.
- Las operaciones ocultas se compactan antes de renderizar por `InspectionCore.inspectionRows`; los huecos sólo se agregan al final.
- La hoja no se reduce en pantalla y el transform sólo se activa bajo `body.printing-inspection`.
- No se incorporaron secretos ni archivos de credenciales.
- La revisión independiente señaló inicialmente una posible fila de materiales de 17 columnas; al recontar el literal completo se confirmó que incluye una celda inicial de 7 columnas y suma 24. El segundo hallazgo sí era válido: la medición ocurría antes de activar estilos de impresión. Se corrigió activando `printing-inspection`, esperando el recálculo de layout y midiendo después.

## Bloqueo de evidencia PDF

No se generó ni se afirmó validar `output/pdf/hoja-inspeccion.pdf`: la pantalla necesita un backend de Apps Script autenticado con una WO que tenga materiales y al menos diez operaciones, datos no disponibles localmente. Además, `pdfinfo` y `pdftoppm` no están instalados en este entorno (`CommandNotFoundException`), por lo que tampoco fue posible renderizar `C:\Users\plane\Documents\Necesidades de Produccion.pdf`. Se verificó la estructura contra el CSS/HTML original indicado en el brief, pero queda pendiente la comparación visual de una página horizontal real.

## Preocupaciones

- La fidelidad visual final y ausencia de recortes en el driver de impresión real requieren la WO/backend y Poppler.
- El proyecto conserva una regla `@page` global para otros reportes y añade la regla específica de inspección; la prueba ahora espera ambas.
