# Diseño: detalle compacto e instantánea única del borrador

## Objetivo

Hacer visibles y operables las operaciones de una OT desde el detalle, estabilizar el traslado de tarjetas a Planeado / Por planear, evitar solicitudes repetidas de configuración y definir una fuente única y predecible para los reportes operativos.

## Detalle de OT

- La cabecera será una sola franja con OT, artículo, prioridad y control de bloqueo.
- Se eliminan del detalle la foto, el estado, Inicio NetSuite y Fin NetSuite.
- Cantidad y fecha de entrega permanecen en una franja compacta.
- Máquina, kit, herramental, subcontrato y materiales serán secciones plegables con un resumen visible cuando estén cerradas.
- Operaciones permanecerá abierta y ocupará el alto restante del panel con desplazamiento propio.
- En pantalla angosta se priorizan secuencia, operación, tiempo y acción; CT se presenta como información secundaria.
- Completar y Reabrir deben permanecer accesibles para cada operación visible.

## Traslado de tarjetas

- La OT permanece en Backlog mientras el modal de preparación esté abierto.
- Cancelar no cambia selección, prioridad ni ubicación.
- Confirmar aplica la configuración y agrega la OT a `selectedOts` en una sola transición.
- La tarjeta debe desaparecer de Backlog y aparecer inmediatamente en Planeado / Por planear.
- Si guardar el borrador remoto falla, se restaura el estado anterior y se informa el error; la tarjeta nunca queda ausente de ambas columnas.

## Preparación idempotente

- La firma de preparación incluye configuración obligatoria relevante: máquina, herramental, kit o kit pendiente, tipo y días de subcontrato, tipo comercial y estructura de operaciones.
- La firma se calcula después de aplicar y normalizar los datos confirmados.
- Generar plan no vuelve a abrir el modal si la firma almacenada coincide con la configuración actual.
- El modal solo reaparece cuando falta un dato obligatorio o cambió una entrada que modifica la firma.

## Instantánea única de borrador

- Generar plan programa únicamente las OTs seleccionadas y operaciones pendientes.
- Tras una generación correcta se crea o reemplaza una sola instantánea lógica con identificador `draft`.
- La instantánea contiene selección, orden, operaciones programadas, fechas, recursos, cambios de herramental, estados pendientes y fecha de generación.
- Una generación fallida no reemplaza la instantánea anterior.
- Publicar crea o actualiza un plan PUBLICADO independiente; no convierte históricos guardados en fuentes operativas.

## Fuente de reportes

- Operador, Ajustador y Subcontratos usan el plan PUBLICADO más reciente.
- Si no existe ningún plan PUBLICADO, usan la instantánea `draft` más reciente.
- No mezclan filas de ambas fuentes ni usan snapshots guardados no publicados.
- Los filtros y la impresión se aplican después de seleccionar la fuente.

## Persistencia

- PLANDATA es la autoridad del borrador; almacenamiento local es únicamente respaldo temporal.
- La instantánea `draft` se reemplaza de forma atómica.
- Los planes históricos y publicados se conservan.
- La sincronización de NetSuite depura OTs cerradas sin alterar planes publicados.

## Comprobaciones

- Prueba visual del detalle en el ancho mostrado por el usuario y en escritorio.
- Prueba de confirmar y cancelar la preparación de una tarjeta.
- Prueba de fallo de guardado con restauración de tarjeta.
- Prueba de preparación idempotente con máquina/herramental ya configurados.
- Prueba de reemplazo de la instantánea `draft` y conservación ante fallo.
- Prueba de elección del último PUBLICADO y fallback a Borrador.
- Prueba de Completar/Reabrir con desplazamiento de operaciones.
- Suite completa, build, consola del navegador y verificación del sitio desplegado.

