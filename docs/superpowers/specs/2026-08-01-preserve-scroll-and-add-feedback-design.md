# Preservar desplazamiento y mostrar fallos al agregar OTs

## Objetivo

Evitar que las actualizaciones de fondo regresen la vista al inicio y asegurar que un fallo inesperado al agregar una OT siempre muestre un mensaje.

## Diseño

- `showWorkspaceView` aceptará una opción para no desplazar la ventana.
- La navegación manual conservará el comportamiento actual de iniciar arriba.
- La carga inicial en segundo plano, incluida la versión optimizada generada, reaplicará la vista sin cambiar `scrollY`.
- Los renders parciales, sincronizaciones y guardados no moverán el documento.
- `selectJob` capturará fallos de todo el flujo, incluida la preparación posterior a la consulta de NetSuite, y mostrará el motivo en un toast.
- Cancelar voluntariamente un diálogo no se tratará como error.

## Pruebas

- La navegación manual sigue desplazando al inicio.
- La carga remota tardía preserva una posición distinta de cero.
- El cliente optimizado conserva la misma regla.
- Un error durante la preparación de la OT muestra un toast y libera el estado ocupado.
- Un agregado correcto mantiene el flujo existente.

## Restricciones

No modificar NetSuite ni el Apps Script protegido `1ew3Nqi0e8SHid_zWv1z5cl6ATCZzqVLqc2lkbfox5CMNsh8FH5tL8zKx`.
