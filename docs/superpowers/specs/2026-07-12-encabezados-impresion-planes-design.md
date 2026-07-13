# Encabezados compactos para impresión de planes

## Objetivo

Simplificar la impresión individual de los planes operativos y semanal para aprovechar la hoja A4, conservando el reporte completo existente del botón Generar PDF.

## Alcance

Aplica a las impresiones individuales de:

- Plan por operador.
- Plan de ajustador.
- Plan de subcontratos.
- Plan de producción semanal.

El botón Generar PDF permanece sin cambios funcionales y continúa generando el reporte completo con alertas, resumen ejecutivo, métricas y demás información.

## Encabezado imprimible

Cada impresión individual tendrá una franja de tres zonas:

- Izquierda: logo textual `MALDONADO`.
- Centro:
  - Planes diarios: `PLAN DE PRODUCCIÓN DIARIO INDIVIDUAL`.
  - Plan semanal: `PLAN DE PRODUCCIÓN SEMANAL`.
- Derecha:
  - Arriba, en miniatura: código `MP CD 28-02 V02`.
  - Debajo, con mayor tamaño: fecha y hora en que se imprime el plan.

La tabla comenzará inmediatamente después del encabezado, sin bloques de resumen intermedios.

## Contenido y alineación

- En la impresión individual se ocultarán barras de alertas, Resumen, métricas, filtros, botones y textos de contexto redundantes.
- Todo el contenido de encabezados y celdas de las tablas se alineará al centro.
- Se conservarán colores semánticos, encabezados de tabla, límite de 25 registros y formato A4.
- Los campos editables o botones de estado seguirán las reglas de impresión existentes: no se imprimirá la columna de acciones.

## Implementación

- Se añadirá un componente HTML reutilizable de encabezado imprimible a cada bloque de reporte.
- La fecha y hora se actualizarán inmediatamente antes de ejecutar `window.print()`.
- CSS de impresión ocultará el contenido global no perteneciente al reporte seleccionado.
- La vista en pantalla conservará filtros y controles; el encabezado compacto será visible principalmente en impresión.

## Validación

- Pruebas de presencia del logo, títulos, código y fecha para los cuatro reportes.
- Prueba de que Generar PDF conserva su ruta actual con resumen completo.
- Pruebas de CSS para ocultamiento y centrado de tablas.
- Verificación de impresión A4 con máximo 25 filas.
