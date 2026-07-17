# Reporte Task 3: Tramos de inspección en Catálogos

## Resultado

Se integró en Catálogos una sección **Tramos de inspección**, antes de Objetivo semanal, con carga bajo demanda, actualización explícita, búsqueda local por artículo/material y edición de tramo mediante el diálogo genérico existente.

## Evidencia TDD

1. Se agregaron primero aserciones de integración en `tests/build.test.mjs` para los IDs de buscador/tabla, carga `getInspectionDrawingRoutes` sin filtro, función de edición, uso de `inspectionRouteSavePayload` y llamada a `saveInspectionLink`.
2. RED: `node --test tests/build.test.mjs` falló con `AssertionError` porque no existía `id="inspectionRouteCatalogSearch"` (1 prueba fallida, 1 aprobada).
3. GREEN: tras la implementación, `node --test tests/build.test.mjs` aprobó 2/2 pruebas.
4. Revisión: se detectó que el toast podía quedar eclipsado al reabrir el diálogo tras un fallo.
5. Segundo RED/GREEN: se exigió un error con `role="alert"` dentro del editor; la prueba falló antes del cambio y volvió a aprobar 2/2 después.

## Implementación

- `src/web/planning/index.template.html`
  - Sección, descripción, botón Actualizar, buscador y tabla solicitados.
- `src/web/planning/app.js`
  - Estado efímero de filas/ready/loading, sin persistir ni mezclarlo con el estado del plan.
  - Carga al entrar a Catálogos; cachea el resultado y sólo recarga con Actualizar.
  - Render de estados de carga y vacío; errores mediante toast.
  - Búsqueda local con `InspectionCore.filterInspectionRouteRows`.
  - Edición con `openPlanningDialog`, artículo/material de sólo lectura y tramo editable.
  - Guardado con `InspectionCore.inspectionRouteSavePayload`, conservando el dibujo existente.
  - En fallo, conserva el valor intentado, reabre el editor y muestra el error dentro del diálogo y por toast; en éxito actualiza tramo/fecha y notifica.
- `src/web/planning/styles.css`
  - Formulario de escritorio coherente con Catálogos y apilado a menos de 720 px.
  - Tabla con desplazamiento horizontal; no se añadieron acciones de dibujo ni eliminación.
- `tests/build.test.mjs`
  - Contrato de integración de la nueva UI y flujo.

## Comandos y resultados

- `node --test tests/build.test.mjs` (RED): 1 fallo esperado por UI ausente.
- `node --test tests/build.test.mjs` (GREEN final): 2/2 aprobadas.
- `npm.cmd run build`: correcto; 18 archivos de servidor, 4 vistas Apps Script y 5 páginas estáticas.
- `npm.cmd test`: 98/98 pruebas aprobadas.
- `npm.cmd run check`: `Validacion correcta`; Apps Script y Pages listos.
- `git diff --check`: sin errores de whitespace.

## Decisiones y auto-revisión

- Se reutilizó el diálogo genérico; no se creó otro sistema modal.
- La clave funcional permanece artículo + material.
- El payload de guardado se deriva de la fila original, por lo que el dibujo no se pierde aunque Catálogos no lo muestre ni edite.
- La búsqueda sólo filtra memoria y no provoca llamadas al backend.
- Una carga fallida queda reintentable al volver a entrar; una actualización fallida conserva las filas ya visibles.
- No se modificaron esquema, hoja imprimible, servicio ni helpers.
- Revisión independiente: sin hallazgos críticos; se corrigió el hallazgo importante de visibilidad del error. Se mantuvo la prueba de integración por build solicitada y usada por el repositorio, sin introducir un arnés DOM o dependencia nueva.
