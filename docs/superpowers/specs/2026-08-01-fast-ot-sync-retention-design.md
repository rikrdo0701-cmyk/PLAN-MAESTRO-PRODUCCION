# Sincronización rápida y retención de OTs cerradas

## Objetivo

Sincronizar solamente OTs activas y retirar automáticamente las cerradas, conservando detalle completado durante cinco días y un resumen semanal compacto después.

## Flujo

- `Sincronizar OTs` consulta exclusivamente el catálogo ligero de OTs; no consulta operaciones, materiales ni rutas.
- Si una OT vigente deja de aparecer, se considera cerrada desde esa primera detección.
- Se retira inmediatamente de Backlog, selección, bloqueos y Planeado, sin confirmación.
- Sus operaciones pendientes, materiales, rutas y configuración operativa se eliminan inmediatamente.
- Sus operaciones completadas permanecen cinco días exactos desde `closedDetectedAt`.
- Al vencer el plazo se eliminan los detalles completados.
- Se conserva el resumen global: OT, artículo, cantidad, último inicio programado, último fin programado, semana, estado final y fecha detectada de cierre.

## Limpieza

La depuración se ejecuta al cargar la aplicación, sincronizar OTs y publicar. Debe ser idempotente y compatible con estados antiguos sin datos de cierre.

## Fallos y rendimiento

- Un timeout o error de NetSuite no modifica ni elimina datos locales.
- La sincronización no reintenta automáticamente ni duplica llamadas.
- La espera manual aumenta respecto a los 15 segundos actuales, manteniendo el resto de la interfaz disponible.
- La persistencia se realiza una sola vez tras reconciliar y depurar.

## Pruebas

Cubrir consulta ligera, retiro sin confirmación, retención antes del límite, limpieza al quinto día, resumen semanal, compatibilidad legacy y ausencia de mutaciones ante fallos.

## Restricciones

No modificar NetSuite ni el proyecto Apps Script protegido `1ew3Nqi0e8SHid_zWv1z5cl6ATCZzqVLqc2lkbfox5CMNsh8FH5tL8zKx`.
