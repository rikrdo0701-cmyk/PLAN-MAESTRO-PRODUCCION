# Task 3 - Backlog progresivo

## Estado

Implementación terminada y verificada.

## Cambios

- El backlog renderiza 30 tarjetas inicialmente y amplía la ventana en bloques exactos de 30.
- La búsqueda y el filtro se aplican al dataset completo antes del corte visible.
- Se agregaron botón accesible y sentinel dentro del área desplazable.
- Un único `IntersectionObserver` carga un bloque por entrada visible y se rearma al salir, evitando cascadas.
- La ventana sólo se reinicia al cambiar consulta, filtro o dataset de OTs/operaciones/materiales.
- El rerender conserva el foco del campo de entrega cuando la OT continúa visible; selección y eventos de drag existentes permanecen en cada tarjeta.

## TDD y pruebas

- RED inicial: `node --test tests/build.test.mjs` falló en 5 pruebas por constantes, corte, controles, eventos, observer y foco ausentes.
- RED de sincronización: la prueba focalizada falló al detectar dos rutas directas de reemplazo de dataset sin reinicio.
- RED de auto-revisión: una advertencia sin cambios de backlog reiniciaba indebidamente la ventana.
- GREEN focalizado: `node --test tests/build.test.mjs`, 24/24.
- Suite completa: `npm.cmd test`, 192/192.
- Build: `npm.cmd run build`, código 0.
- Validación: `npm.cmd run check`, código 0.
- Higiene: `git diff --check`, código 0.

## Auto-revisión

- El filtrado ocurre antes de `slice(0, backlogVisibleLimit)`.
- `showMoreBacklogJobs()` incrementa una sola página y hace un solo render.
- El observer se crea una vez y bloquea callbacks repetidos mientras el sentinel sigue intersectando.
- Los reinicios por importación son condicionales a cambios reales del dataset; avisos de catálogo por sí solos no reinician.
- Los cambios se limitan a los cuatro archivos previstos y este reporte.

## Validación visual

Se generó correctamente la vista local, pero el navegador integrado no estuvo disponible y el proyecto no incluye Playwright. No se instalaron dependencias nuevas. La conducta queda cubierta por pruebas funcionales del controlador/observer y pruebas de integración de fuente/build.
