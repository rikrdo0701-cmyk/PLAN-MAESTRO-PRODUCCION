# Arquitectura

## Backend

El backend permanece en Google Apps Script y usa:

- `SpreadsheetApp` como almacenamiento estructurado.
- `PropertiesService` para configuración y secretos.
- `LockService` para evitar escrituras simultáneas.
- `UrlFetchApp` para la integración con NetSuite.
- `DriveApp` y `CacheService` para fotografías.

## Frontend

Apps Script no carga módulos JavaScript locales como un servidor convencional. Por eso el repositorio conserva los componentes separados y el build produce un HTML autocontenido:

1. Plantilla HTML.
2. Estilos.
3. Motor `PlannerCore`.
4. Código de interfaz.

## Entornos

Cada entorno debe usar un proyecto de Apps Script y un `.clasp.json` diferente. El archivo no se versiona. Para producción y pruebas, usa proyectos separados y propiedades de script independientes.
