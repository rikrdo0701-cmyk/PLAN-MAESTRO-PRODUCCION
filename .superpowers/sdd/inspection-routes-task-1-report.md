# Reporte — Task 1: contrato estable para listar tramos

## Alcance

Se optimizó `getInspectionDrawingRoutes(article)` para construir el índice de rutas una sola vez por invocación. El contrato de filtrado se conserva: artículo vacío devuelve todas las filas y un artículo con valor filtra por su clave normalizada.

## TDD

1. Se agregó primero la prueba `lista todo el catalogo de tramos sin filtro y conserva dibujo` en `tests/inspection-service.test.mjs`.
2. La prueba crea el servicio con `loadService()`, sustituye `context.PP_Inspection_routeIndex_`, ofrece dos artículos distintos y llama `context.getInspectionDrawingRoutes("")`.
3. Evidencia RED:

   ```text
   node --test --test-name-pattern="lista todo el catalogo de tramos sin filtro y conserva dibujo" tests/inspection-service.test.mjs
   AssertionError: 3 !== 1
   ```

   El fallo probó que la implementación anterior construía el índice tres veces: una para las claves y una por cada fila.

4. Cambio mínimo GREEN: se introdujo `const routes = PP_Inspection_routeIndex_();` y el mapeo usa `routes[indexKey]`.
5. Evidencia GREEN focal:

   ```text
   node --test --test-name-pattern="lista todo el catalogo de tramos sin filtro y conserva dibujo" tests/inspection-service.test.mjs
   pass 1, fail 0
   ```

## Verificación

| Comando | Resultado |
| --- | --- |
| `node --test tests/inspection-service.test.mjs` | 7 pruebas aprobadas, 0 fallos |
| `npm test` | No inició: PowerShell bloqueó `npm.ps1` por política de ejecución |
| `npm.cmd test` | Suite completa aprobada: 96 pruebas, 0 fallos |
| `git diff --check` | Sin errores de espacios |

## Archivos modificados

- `src/server/16-inspection-service.js`
- `tests/inspection-service.test.mjs`
- `.superpowers/sdd/inspection-routes-task-1-report.md` (este reporte)

## Auto-revisión

- La prueba verifica `ok === true`, las dos filas completas (artículo, material, tramo y dibujo) y que el índice se invoca una sola vez.
- No se modificó el esquema de Google Sheets, la clave de guardado artículo + material, ni se agregaron dependencias o capacidades fuera de alcance.
- El filtro existente se mantiene sin cambios; la ruta vacía sigue devolviendo las dos entradas del catálogo.
