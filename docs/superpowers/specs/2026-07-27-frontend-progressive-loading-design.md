# Diseño: carga progresiva y reducción de llamadas

## Objetivo

Mejorar la respuesta de la aplicación en PC sin ocultar OT, perder búsquedas ni cambiar los datos de planeación.

## Diagnóstico

La pantalla inicial crea 202 tarjetas de OT y 8,522 elementos HTML, con cerca de 671,000 caracteres. Además, el arranque consulta estado, históricos y snapshots antes de que el usuario abra Reportes, y puede iniciar una sincronización adicional.

La degradación apareció después de la matriz de capacidades por dos regresiones concretas:

- `currentPlanOperations()` se invoca en 26 lugares y cada invocación vuelve a recorrer las operaciones y normalizar exclusiones.
- El catálogo maestro agrega una consulta SuiteQL durante las sincronizaciones, aunque el catálogo cambia con poca frecuencia.

## Diseño aprobado

### Corregir primero la regresión de la matriz

- Memorizar el resultado de operaciones incluidas para el arreglo principal de `state.operations`.
- La clave del caché combina la referencia de operaciones y la firma normalizada de `excludedCapabilities`.
- Invalidar el caché al normalizar, importar, sincronizar, programar o cambiar exclusiones.
- Las colecciones auxiliares, como `job.ops`, se filtran directamente porque son pequeñas.
- Precalcular un `Set` de exclusiones normalizadas para evitar normalizar la misma clave por cada operación.

### Catálogo maestro reutilizable

- Mantener el último catálogo válido como fallback persistente.
- Usar `CacheService` de Apps Script durante una hora, separado por cuenta y ubicación.
- Una sincronización dentro de esa ventana reutiliza el catálogo y evita una nueva consulta SuiteQL.
- Una respuesta inválida nunca reemplaza el catálogo anterior.
- No cambiar RESTlets ni el contrato público del frontend.

### Backlog progresivo

- Mantener todas las OT en memoria para búsqueda, filtros y planeación.
- Renderizar inicialmente 30 tarjetas.
- Cargar el siguiente bloque al acercarse al final mediante `IntersectionObserver`.
- Si el navegador no soporta el observador, mostrar un botón `Cargar más`.
- Una búsqueda o cambio de filtro reinicia el límite y opera sobre todas las OT.
- Mostrar `N de M OT` para distinguir resultados disponibles de tarjetas visibles.
- Conservar selección, fechas editadas, foco y desplazamiento al rerenderizar.

### Arranque y llamadas

- Usar `getAppStateIfChanged(revision)` cuando exista una revisión local.
- Si el servidor responde `unchanged`, conservar el estado local y evitar descargarlo nuevamente.
- Compartir promesas para impedir llamadas simultáneas duplicadas del mismo recurso.
- No cargar `listPlanSnapshots` ni `getPlanSnapshot` durante el arranque.
- Cargar históricos únicamente al abrir Reportes o Restaurar borrador.
- Sincronizar NetSuite en segundo plano solo cuando los datos estén vencidos; una sincronización manual reutiliza la llamada en curso.

### Renderizado

- El arranque realiza un render principal después de resolver el estado vigente.
- Las actualizaciones de sincronización rerenderizan solo resumen, alertas y backlog afectado.
- Las secciones no visibles no realizan trabajo costoso hasta que se abren.

## Errores y compatibilidad

- Ante fallo del estado condicional, conservar caché local y permitir sincronización manual.
- Ante fallo de históricos, Reportes muestra su aviso sin bloquear Planeación.
- No cambiar contratos existentes: los nuevos comportamientos usan endpoints ya disponibles.
- Mantener compatibilidad con Apps Script nativo y el puente de GitHub Pages.

## Verificación

- Pruebas que demuestren una sola filtración completa por estado/exclusiones.
- Pruebas de invalidación al cambiar operaciones o exclusiones.
- Pruebas de una sola consulta SuiteQL dentro de una hora y nueva consulta al vencer.
- Pruebas de carga inicial de 30 OT, carga del siguiente bloque y reinicio por búsqueda.
- Pruebas de búsqueda sobre OT aún no renderizadas.
- Pruebas de una sola llamada compartida por recurso.
- Pruebas de arranque sin históricos y respuesta `unchanged`.
- Suite completa, build y check.
- QA en PC midiendo tarjetas, nodos, errores de consola e interacción de búsqueda/carga.

## Criterios de éxito

- Una renderización completa reutiliza la misma colección de operaciones incluidas.
- Máximo una consulta del catálogo SuiteQL por hora, cuenta y ubicación.
- Máximo 30 tarjetas de backlog en el DOM al finalizar la carga inicial.
- Ninguna llamada a históricos antes de abrir Reportes o Restaurar borrador.
- Ninguna descarga completa de estado cuando la revisión no cambió.
- Búsqueda y filtros abarcan todas las OT.
- Sin regresiones en selección, planificación o guardado.
