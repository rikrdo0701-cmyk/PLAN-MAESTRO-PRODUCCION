# Editor de tramos de inspección

## Objetivo

Mejorar el modal de edición de tramo y dibujo de la hoja de inspección para uso principalmente en computadora, y permitir editar los tramos guardados desde la pestaña **Catálogos**.

La mejora debe reducir el desplazamiento vertical, facilitar la lectura de muchos materiales y reutilizar el contrato actual de almacenamiento por combinación de artículo y material.

## Alcance

### Modal de hoja de inspección

- Convertir el editor actual en un diálogo centrado con un ancho máximo aproximado de 1,100 px.
- Mantener el fondo de la aplicación visible bajo una capa atenuada.
- Usar un encabezado fijo que agrupe el título, la WO y el artículo, con una acción de cierre visible.
- Mostrar la regla de captura en una franja informativa compacta.
- Presentar el dibujo del artículo en una única sección destacada.
- Presentar los materiales como filas compactas con estas áreas:
  - código y descripción;
  - cantidad requerida;
  - campo de tramo;
  - estado o indicación de tramo faltante.
- Mantener un pie fijo con **Cancelar** y **Guardar tramo/dibujo**.
- Conservar una adaptación apilada para pantallas estrechas, aunque la prioridad visual es escritorio.

### Catálogo de tramos

- Agregar dentro de **Catálogos** una sección llamada **Tramos de inspección**.
- Consultar los registros existentes mediante el servicio de rutas de inspección sin filtro de artículo.
- Mostrar una tabla con:
  - artículo;
  - material;
  - tramo;
  - última modificación;
  - acción **Editar**.
- Incluir un buscador local que filtre por artículo o material.
- Mostrar un estado vacío claro cuando no existan registros o el filtro no produzca resultados.
- Abrir un diálogo compacto al editar una fila.
- El diálogo de catálogo editará únicamente el tramo. No editará el dibujo del artículo.
- No se permitirá eliminar registros en este alcance.

## Comportamiento y datos

El guardado continuará usando `saveInspectionLink` con `article`, `material`, `route` y el dibujo existente cuando corresponda. La clave funcional seguirá siendo artículo + material.

En el editor de Catálogos:

1. Se carga la lista completa con `getInspectionDrawingRoutes("")`.
2. El usuario filtra y elige una fila.
3. El editor conserva artículo y material como contexto de solo lectura.
4. Al guardar, envía el tramo nuevo y preserva el valor de dibujo existente de esa fila.
5. Tras una respuesta correcta, actualiza la fila visible y la fecha de modificación devuelta por el servidor.
6. Si el servidor rechaza el cambio, el diálogo permanece abierto y se muestra el error sin perder el valor escrito.

En el editor de la hoja de inspección, el guardado conserva el comportamiento actual: el dibujo corresponde a la WO o artículo y los tramos corresponden a cada material.

## Diseño visual

- Fondo de diálogo blanco y fondo exterior oscuro translúcido.
- Encabezado y pie adheridos al borde superior e inferior del diálogo.
- Tipografía y colores alineados con la aplicación de Planeación de Producción.
- Bordes suaves y sombras discretas; evitar tarjetas anidadas para cada dato.
- Tabla o filas con separadores, encabezados claros y densidad adecuada para escritorio.
- Campo activo con foco visible.
- Indicador de tramo faltante con color de advertencia y texto, sin depender únicamente del color.
- Botón principal con el color de acción existente y botón secundario neutral.

## Accesibilidad y teclado

- Mantener el foco dentro del diálogo mientras esté abierto.
- Permitir cerrar con `Escape` o con el botón de cierre.
- Asociar etiquetas visibles a todos los campos.
- Usar botones reales para las acciones.
- No cerrar el editor cuando exista un error de guardado.
- Mantener contraste suficiente en texto secundario, bordes y estados.

## Compatibilidad

- Prioridad: computadora, especialmente anchos de 1,024 px o mayores.
- En pantallas menores, las columnas del editor se apilan y el diálogo ocupa casi toda la ventana.
- La tabla de Catálogos puede desplazarse horizontalmente si el espacio resulta insuficiente.
- No se modifica la hoja imprimible ni su escala.

## Verificación

- Comprobar que el modal se abre, cierra y conserva sus valores.
- Comprobar guardado de dibujo y varios tramos desde la hoja de inspección.
- Comprobar carga, búsqueda y edición desde Catálogos.
- Confirmar que editar desde Catálogos preserva el dibujo existente.
- Confirmar estados de carga, vacío y error.
- Ejecutar las pruebas automatizadas existentes y agregar cobertura para la nueva integración.
- Revisar visualmente escritorio y una ventana estrecha, verificando encabezado y pie fijos, ausencia de recortes y navegación por teclado.

## Fuera de alcance

- Eliminar registros de la hoja `Tramos`.
- Edición masiva.
- Cambiar el esquema de Google Sheets.
- Editar dibujos desde Catálogos.
- Modificar la lógica de diagnóstico o impresión de la hoja de inspección.
