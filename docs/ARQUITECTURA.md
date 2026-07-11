# Arquitectura

## Separación de responsabilidades

```text
GitHub Pages
  index.html + CSS + JavaScript
            │ postMessage RPC
            ▼
Apps Script Bridge (iframe oculto)
  google.script.run
            │
            ▼
Apps Script backend
  Sheets + NetSuite + Drive
```

El usuario abre la interfaz desde GitHub Pages. Apps Script ya no es el alojamiento principal del frontend; conserva un HTML mínimo llamado `Bridge.html` que permite invocar las funciones del servidor sin exponer credenciales en el navegador.

## Por qué se usa un puente

`google.script.run` solo existe dentro de HTML servido por Apps Script. El frontend de GitHub Pages crea un iframe oculto hacia `?app=bridge` y se comunica mediante `window.postMessage`. El puente valida:

- que el origen sea `https://rikrdo0701-cmyk.github.io` o un servidor local;
- un canal aleatorio generado por cada pestaña;
- una lista cerrada de métodos permitidos.

Esto evita depender de CORS y mantiene las llamadas actuales a Apps Script.

## Backend

El backend permanece en Google Apps Script y usa:

- `SpreadsheetApp` como almacenamiento estructurado;
- `PropertiesService` para configuración y secretos;
- `LockService` para evitar escrituras simultáneas;
- `UrlFetchApp` para NetSuite;
- `DriveApp` y `CacheService` para fotografías.

## Builds

`npm run build` genera dos salidas:

- `dist/`: archivos que `clasp push` envía a Apps Script;
- `site/`: sitio estático que GitHub Actions publica en GitHub Pages.

Ambas carpetas son generadas y no deben editarse ni versionarse.
