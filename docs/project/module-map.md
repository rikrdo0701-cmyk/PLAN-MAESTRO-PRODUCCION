# Module map

Mapa de módulos con propósito, entry points y dependencias principales. La versión
machine-readable vive en `.project-memory/modules.json`. Se organiza en backend (`src/server/`),
frontend (`src/web/`), build (raíz/scripts), tests y pipeline legacy.

## Backend — `src/server/` (19 módulos numerados, orden de carga)

| Módulo | Propósito | Entry points (funciones globales/exportadas) |
|---|---|---|
| `00-common.js` | Utilidades de despacho de apps (nombre, título, archivo HTML por app) | `doGet` helper: `PP_appNameFromRequest_`, `PP_appTitle_`, `PP_appHtmlFile_` |
| `01-code.js` | Constantes de versión (`PP_APP_VERSION = 2.41.0`, `PP_SCHEMA_VERSION = 29`), webapp `doGet`, setup/init y **API global del backend** | `doGet`, `setupProductionPlanningApp`, `setProductionPlanningSpreadsheet`, `initializeProductionPlanningDatabase`, `verifyProductionPlanningDatabase`, `getAppState`, `saveAppState`, `saveWorkOrderSyncState`, `saveCatalogState`, `saveSkillState`, `savePlanSnapshot`, `saveDraftSnapshot`, `listPlanSnapshots`, `getPlanSnapshot`, `restorePublishedPlanAsDraft`, `syncNetSuitePlant`, `syncNetSuiteWorkOrders`, `syncNetSuitePlanningData`, `getDeploymentStatus`, `runProductionReadinessCheck`, `PP_acquireScriptLock_` |
| `02-storage.js` | Esquema declarado `PP_SHEETS`, `PP_OPERATION_FIELDS`, lectura/escritura de estado, mappers de fila, instantáneas y normalizadores | `PP_readState_`, `PP_writeState_`, `PP_writeCatalogState_`, `PP_writeSkillState_`, `PP_writeNetSuiteSyncState_`, `PP_writeNetSuiteWorkOrdersState_`, `PP_writeWorkOrderSyncState_`, `PP_writeConfigPatch_`, `PP_appendPlanSnapshot_`, `PP_replaceDraftSnapshot_`, `PP_clearDraftSnapshot_`, `PP_listPlanSnapshots_`, `PP_getPlanSnapshot_`, `PP_readRows_`, `PP_writeTable_`, `PP_mapOperation_`, `PP_mapWorkOrder_`, `PP_buildOperationPlanStatuses_`, `PP_buildOtConfigurations_`, `PP_buildArticleConfigurations_` |
| `03-storage-service.js` | Capa delgada de servicio sobre storage | `PP_readPlanningState_`, `PP_writePlanningState_`, `PP_writeSkillMatrixState_`, `PP_readLatestPublishedPlan_` |
| `04-planning-service.js` | Motor de planeación (generación del borrador) | `PP_generateDraftPlan_` |
| `05-publishing-service.js` | Publicación y restauración de planes | `PP_publishDraftPlan_`, `PP_restorePublishedPlanAsDraft_`, `PP_reconcilePublishedPlan_` |
| `06-completion-service.js` | Completado de operaciones y surtido | `PP_completeOperation_`, `PP_registerSubassemblyPicking_` |
| `07-report-service.js` | Reportes del borrador y publicados | `PP_getDraftReport_`, `PP_getPublishedReport_` |
| `08-netsuite.js` | OAuth 1.0a, RESTlets, SuiteQL, catálogo maestro, promedios de facturación, filtros de planta, mapeo de filas NetSuite→plan | `PP_syncNetSuitePlant_`, `PP_fetchNetSuitePlantData_`, `PP_fetchNetSuiteWorkOrdersData_`, `PP_fetchNetSuitePlanningData_`, `PP_fetchNetSuiteOperationCatalog_`, `PP_fetchInvoiceSalesAverages_`, `PP_fetchRestletPages_`, `PP_netSuiteRestletRequest_`, `PP_oauthHeader_`, `PP_buildPlantFilter_`, `PP_mapNetSuiteOperation_`, `PP_mapNetSuiteMaterial_` |
| `09-photos.js` | Catálogo de fotografías desde Drive | `PP_enrichWorkOrderPhotos_`, `PP_loadPhotoCatalog_`, `getPhotoSourceStatus` |
| `10-app-planning.js` | Entry points de la app Planning | `PP_getPlanningBootstrap`, `PP_generateDraftPlan`, `PP_publishDraftPlan` |
| `11-app-operator.js` | Entry points de la app Operador | `PP_getActiveOperatorPlan`, `PP_completeOperation`, `PP_registerSubassemblyPicking` |
| `12-app-skills.js` | Entry points de la app Habilidades/Matriz | `PP_saveSkillMatrix` |
| `13-configuration.js` | Comandos de configuración | `configureProductionPlanningProject`, `setProductionPlanningPhotoFolder` |
| `14-pages-bridge.js` | Validación del puente y origen del frontend | `PP_isBridgeRequest_`, `PP_frontendOrigin_`, `PP_createBridgeOutput_`, `setProductionPlanningFrontendOrigin` |
| `15-performance-service.js` | Endpoints optimizados (revisiones, delta state, materiales por OT, sync ligero) | `getAppRevision`, `getAppStateIfChanged`, `getMaterialsForOt`, `savePlanningStateOptimized`, `saveOperationPlanStatus`, `syncNetSuiteWorkOrdersLite`, `fetchNetSuiteWorkOrdersLite` |
| `16-inspection-service.js` | Inspección: OTs, rutas (hoja `Tramos`), historial de impresión | `getInspectionWorkOrders`, `getInspectionWorkOrder`, `saveInspectionLink`, `getInspectionDrawingRoutes`, `getInspectionHistory`, `recordInspectionPrint` |
| `17-inspection-drawing-service.js` | Bundle de inspección con dibujos y matching V2 de rutas | `getInspectionWorkOrderBundle`, `PP_Inspection_routeIndexV2_`, `PP_Inspection_routeMatchV2_` |
| `18-planning-work-order-service.js` | Datos de planeación de OT individual vía SuiteQL directo | `getPlanningWorkOrderData`, `PP_fetchDirectWorkOrderOperations_`, `PP_fetchDirectWorkOrderSuiteQl_` |

## Frontend — `src/web/`

| Módulo | Propósito |
|---|---|
| `bridge/Bridge.html` | Página puente del iframe (proxy `postMessage` → `google.script.run`) |
| `planning/app.js` | App de planeación: estado, persistencia, borrador/Gantt/KPI/backlog |
| `planning/planner-core.js` | Motor de planeación del frontend (multi-estrategia) |
| `planning/planning-workflow-core.js` | Workflow de planeación (flujos, estados, exclusión mutua) |
| `planning/index.template.html` + `styles.css` | Vista Planning |
| `operator/IndexOperator.html` | Vista Operador (plan del día por operador) |
| `skills/IndexSkills.html` | Vista Matriz de habilidades |
| `inspection/inspection-app.js`, `inspection-core.js`, `inspection.css` | App de inspección (rutas, dibujos, semáforo) |
| `shared/apps-script-bridge-client.js` | Cliente RPC del puente |
| `shared/fluid-client.js` | Carga progresiva del frontend |
| `shared/performance-client.js` | Cliente de endpoints optimizados (revisiones/delta) |

## Build y herramientas

| Ruta | Propósito |
|---|---|
| `scripts/build-appscript.mjs` | Genera `dist/` (Apps Script) y `site/` (GitHub Pages) |
| `scripts/check-project.mjs` | Verificación del build (sintaxis, marcadores, URL backend) |
| `appsscript.json` | Manifest de Apps Script (runtime V8, webapp, `access = anyone`) |
| `package.json` | Scripts npm (`build`, `test`, `check`) |
| `.github/workflows/` | CI (`ci.yml`), deploy Apps Script (`deploy-appscript.yml`), GitHub Pages (`deploy-pages.yml`) |

## Tests — `tests/`

Suite `node --test` (347 pruebas). Archivos clave: `planner-core.test.mjs`,
`planning-workflow-core.test.mjs`, `storage-state.test.mjs`, `netsuite-operation-catalog.test.mjs`,
`matrix-integration-app.test.mjs`, `performance-client-*.test.mjs`, `inspection-*.test.mjs`,
`planning-work-order-service.test.mjs`, `build.test.mjs`, `test-plan-maestro.gs`.

## Pipeline legacy — raíz

`PRINCIPAL.js`, `global.js`, `parser_*.js`, `modelo_logico.js`, `SCHEDULER.js`, `WRITTER.js`,
`* FINAL.js` (alimentadores NetSuite), `NetSuiteOAuth.js`, `NETAUTHSUITEQL.js`, `utility.js`,
`ACTUALIZAR CENTRO DE TRABAJOS.js`, `legacy/IndexPlanning.html`. Documentado en `OT_RULES.md` y
`docs/data/sources.md#Parte C`.
