# Reporte Task 2: núcleo compartido del catálogo de tramos

## Alcance

- Agregadas a `InspectionCore`: `inspectionRouteRows`, `filterInspectionRouteRows` e `inspectionRouteSavePayload`.
- No se modificó `inspectionOperationLayout`.
- No se tocaron UI, servidor, hoja imprimible ni se agregaron dependencias.

## Evidencia TDD

### RED

Comando:

```powershell
node --test tests/inspection-core.test.mjs
```

Resultado: 6 pruebas pasaron y 2 fallaron como se esperaba con `TypeError: core.inspectionRouteRows is not a function` y `TypeError: core.inspectionRouteSavePayload is not a function`.

### GREEN

Comandos:

```powershell
node --test --test-name-pattern "normaliza, ordena y filtra" tests/inspection-core.test.mjs
node --test tests/inspection-core.test.mjs
npm.cmd test
```

Resultados: prueba focal 1/1; archivo focal 8/8; suite completa 98/98. `npm test` fue bloqueado por la política de ejecución de PowerShell (`npm.ps1`), por lo que se usó el ejecutable equivalente `npm.cmd test` sin modificar la configuración del entorno.

## Archivos

- Modificado: `src/web/inspection/inspection-core.js`
- Modificado: `tests/inspection-core.test.mjs`
- Creado: `.superpowers/sdd/inspection-routes-task-2-report.md`

## Auto-revisión

- La normalización acepta campos en español/inglés, elimina artículo o material vacíos y ordena por artículo y material con sensibilidad base española.
- El filtro opera sobre artículo y material sin distinguir mayúsculas/minúsculas, y retorna la misma colección ante búsqueda vacía.
- El payload devuelve sólo artículo, material, tramo y dibujo, todos recortados; recibe el nuevo tramo sin perder el dibujo existente.
