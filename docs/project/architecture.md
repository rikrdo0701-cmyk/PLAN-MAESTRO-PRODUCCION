# Architecture

> Documento de arquitectura de **plangit** (Plan Maestro de Producción). Es la autoridad en
> separación de responsabilidades, topología de integración, flujo de ejecución y límites de
> módulos. Para el detalle de datos ver `docs/data/sources.md` y `docs/data/relationships.md`.

## 1. Visión de conjunto

Sistema de planificación semanal de producción para la planta **Planta MM del Llano**
(NetSuite `locationId = 1`). Planea **Órdenes de Trabajo (OT)** y sus **operaciones** asignando
máquinas, operadores y herramentales con **capacidad finita**, sincronizando desde **NetSuite**
y persistiendo en **Google Sheets**. Incluye apps satélite: plan de operador, matriz de
habilidades e inspección.

```text
GitHub Pages (frontend estático)
   │  window.postMessage (RPC bidireccional, canal aleatorio por pestaña)
   ▼
Apps Script Bridge (iframe oculto ?app=bridge)
   │  google.script.run (proxy local en Apps Script)
   ▼
Apps Script backend (src/server/)
   │  SpreadsheetApp · PropertiesService · LockService · UrlFetchApp · CacheService · DriveApp
   ▼
Google Sheets (workbook) + NetSuite (RESTlets/SuiteQL/REST Record API) + Google Drive (fotos)
```

Apps Script ya no es el alojamiento principal del frontend; solo sirve un HTML mínimo de puente
(`Bridge.html`) para invocar el backend sin exponer credenciales en el navegador (ver §4).

## 2. Capas

| Capa | Tecnología | Ubicación | Responsabilidad |
|---|---|---|---|
| Frontend | HTML/CSS/JS estático + PWA | `src/web/` | Renderizado, estado de UI, motor de planeación, interacción |
| Puente | Apps Script HTML + `postMessage` | `src/web/bridge/Bridge.html` + `src/server/14-pages-bridge.js` | Invocar backend sin exponer credenciales; validar origen y métodos |
| Backend | Google Apps Script (V8) | `src/server/` (19 módulos numerados) | Persistencia en Sheets, sync NetSuite, fotos Drive, control de revisiones |
| Almacenamiento | Google Sheets | workbook `PLANNING_SPREADSHEET_ID` | Estado compartido (ver `docs/data/sources.md`) |
| ERP | NetSuite | RESTlets + SuiteQL + REST Record API | Fuente de verdad de OTs, operaciones, materiales, catálogo maestro |
| Fotos | Google Drive | carpeta `PHOTO_FOLDER_ID` | Fotografías de artículos |

Pipeline legacy (raíz del repositorio): parsers + modelo lógico + scheduler en `.js` sueltos que
escriben la hoja "Plan Maestro". Independiente de `src/server`, se documenta en `OT_RULES.md`.

## 3. Flujo de ejecución (backend)

1. `doGet(e)` (`01-code.js`) despacha a la app por nombre (`planning`, `operator`, `skills`,
   `inspection`, `bridge`) y sirve el HTML correspondiente.
2. La app llamante invoca funciones del backend expuestas como funciones globales:
   - **Estado**: `getAppState` / `getAppStateIfChanged` (optimizado), `saveAppState`,
     `savePlanningStateOptimized`.
   - **Sync NetSuite**: `syncNetSuitePlant`, `syncNetSuiteWorkOrders`,
     `syncNetSuitePlanningData`, `syncNetSuiteWorkOrdersLite` (todas usan `PP_acquireScriptLock_`).
   - **Planes**: `generateDraftPlan` → `publishDraftPlan` → instantánea en `PLANES_HISTORICOS`;
     `saveDraftSnapshot` / `restorePublishedPlanAsDraft`.
   - **Catálogos y habilidades**: `saveCatalogState`, `saveSkillState`.
   - **Operador**: `getActiveOperatorPlan`, `completeOperation`, `registerSubassemblyPicking`.
   - **Inspección**: `getInspectionWorkOrders`, `getInspectionWorkOrder`,
     `getInspectionWorkOrderBundle`, `saveInspectionLink`, `getInspectionDrawingRoutes`,
     `getInspectionHistory`, `recordInspectionPrint`.
3. Toda escritura pasa por control de revisiones (`PP_assertCurrentRevision_` +
   `PP_nextRevision_`) y por un único writer a la vez (LockService). Las tablas se escriben con
   `PP_writeTable_` (clear + setValues); `AUDITORIA` es append-only.

## 4. El puente (bridge) y seguridad

`google.script.run` solo existe dentro de HTML servido por Apps Script. El frontend crea un
iframe oculto hacia `?app=bridge` y se comunica por `window.postMessage`. El puente valida:

- origen del mensaje igual a `FRONTEND_ORIGIN` (`https://rikrdo0701-cmyk.github.io` o local);
- un canal aleatorio generado por cada pestaña (evita spoofing entre pestañas);
- lista cerrada de métodos permitidos (`ALLOWED_METHODS`, `14-pages-bridge.js`).

El backend **no expone credenciales** al navegador: los secretos (NetSuite OAuth, IDs de
book/hojas) viven en `PropertiesService` (Script Properties). Ver
`docs/APPS_SCRIPT_DEPLOYMENT_Y_BYPASS.md` y `docs/CONFIGURACION.md`.

## 5. Persistencia y control de concurrencia

- `SpreadsheetApp`: almacenamiento estructurado por hojas (esquema `PP_SHEETS` en
  `02-storage.js`; detalle por hoja en `docs/data/sources.md`).
- `LockService`: `PP_acquireScriptLock_` (script lock, 30–60 s) en sincronizaciones y escrituras.
- `PropertiesService`: configuración y secretos; también almacena payloads de instantáneas
  (manifest en `CONFIG`), con `PP_storePlanSnapshotPayload_` / rollback.
- `CacheService`: caché del catálogo maestro de operaciones NetSuite (1 h) y de fotos.
- `DriveApp`: catálogo de fotografías por miniaturas.

## 6. Integraciones externas

| Integración | Mecanismo | Ver |
|---|---|---|
| NetSuite (RESTlets propios) | `1764` OTs, `1762` operaciones, `1763` materiales, `2080` inspección; OAuth 1.0a HMAC-SHA256 | `08-netsuite.js`, `docs/data/sources.md#Parte D` |
| NetSuite (SuiteQL) | catálogo maestro de operaciones; promedios de facturación; rutas directas de OT | `08-netsuite.js`, `18-planning-work-order-service.js` |
| NetSuite (REST Record API) | solo pipeline legacy (`TRABAJOS FINAL.js`, `MATERIALES FINAL.js`) | `docs/data/sources.md#Parte C` |
| Google Sheets | workbook principal + workbook de inspección | `02-storage.js`, `16-inspection-service.js` |
| Google Drive | fotos de artículos | `09-photos.js` |

## 7. Builds y despliegue

`npm run build` genera dos salidas:

- `dist/` → `clasp push` a Apps Script (manifest `appsscript.json`, raíz `dist`).
- `site/` → GitHub Actions publica en GitHub Pages (`src/web/**`).

Ambas carpetas son generadas y no deben editarse ni versionarse. Workflows en `.github/workflows/`
(`deploy-appscript.yml`, `deploy-pages.yml`, `ci.yml`). Guía completa: `docs/REBUILD.md`.

## 8. Decisiones de arquitectura

- `docs/architecture/decisions/ADR-0001-project-memory-private-git.md` — memoria obligatoria
  versionada, git local obligatorio, remote privado independiente, un writer por repositorio,
  gates de documentación y aprobación antes del push.
- `docs/ARQUITECTURA.md` (raíz) es la versión resumida heredada de esta arquitectura.
