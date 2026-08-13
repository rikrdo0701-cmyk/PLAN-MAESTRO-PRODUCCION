# Documento Maestro del Sistema

> Documento maestro de **plangit** (Plan Maestro de Producción). Contiene visión, arquitectura,
> flujos, estados y versiones. Los detalles por dominio están en los documentos referenciados.

## 1. Visión

Sistema de planificación semanal de producción para la planta **Planta MM del Llano**
(`PP_PLANT_LOCATION_ID = 1`, `PP_PLANT_NAME = 'Planta MM del Llano'`).

- Planea **Órdenes de Trabajo (OT)** con sus **operaciones** (rutas de manufactura), asignando
  máquinas, operadores y herramentales con **capacidad finita**.
- Sincroniza datos desde **NetSuite** (OTs, operaciones, materiales, catálogo maestro de
  operaciones, promedios de precio de venta).
- Mantiene un **borrador** de plan que se **publica** por semana y queda como **histórico**.
- Incluye apps satélite: **plan de operador**, **matriz de habilidades** e **inspección**
  (paquetes de impresión con tramos y dibujos).

## 2. Capas y separación de responsabilidades

```text
GitHub Pages (frontend estático)
   │  window.postMessage (RPC)
   ▼
Apps Script Bridge (iframe oculto ?app=bridge)
   │  google.script.run
   ▼
Apps Script backend (src/server/)
   │  SpreadsheetApp · PropertiesService · LockService · UrlFetchApp · CacheService · DriveApp
   ▼
Google Sheets + NetSuite + Google Drive
```

| Capa | Tecnología | Ubicación | Responsabilidad |
|---|---|---|---|
| Frontend | HTML/CSS/JS estático + PWA | `src/web/` | Renderizado, estado de UI, motor de planeación, interacción |
| Puente | Apps Script HTML + `postMessage` | `src/web/bridge/Bridge.html` + `src/server/14-pages-bridge.js` | Invocar backend sin exponer credenciales, validar origen y métodos |
| Backend | Google Apps Script (V8) | `src/server/` | Persistencia en Sheets, sync NetSuite, fotos Drive, control de revisiones |
| Almacenamiento | Google Sheets | workbook `PLANNING_SPREADSHEET_ID` | Estado compartido (tablas) |
| ERP | NetSuite | RESTlets + SuiteQL + REST Record API | Fuente de verdad de OTs, operaciones, materiales, catálogo |
| Fotos | Google Drive | carpeta `PHOTO_FOLDER_ID` | Fotografías de artículos |

El backend **no expone credenciales** al navegador. El puente solo acepta el origen configurado
(`FRONTEND_ORIGIN`) y una lista cerrada de métodos (`ALLOWED_METHODS`).

## 3. Flujos principales

### 3.1 Ciclo de vida del plan

```text
Sincronización NetSuite (OTs/operaciones/materiales)
        │
        ▼
Borrador (BORRADOR) ── programar (planner-core, multi-estrategia)
        │
        ▼
Publicar por semana (PUBLICADO) → instantánea en PLANES_HISTORICOS
        │
        ▼
Restaurar publicado como borrador (reconciliación) o consultar histórico
```

- `selectedOts`: lista de OTs del borrador. Gantt, KPI, backlog, cargas y reportes usan la misma lista.
- `lockedOts`: OTs bloqueadas (no se reprograman).
- `operationPlanStatuses`: estados por operación (`PENDIENTE` / `COMPLETADA_PLAN`).

### 3.2 Sincronización NetSuite

| Función | Alcance | Locks | Hojas que actualiza |
|---|---|---|---|
| `syncNetSuitePlant()` | OTs + operaciones + materiales + catálogo | script lock 60 s | OPERACIONES, CATALOGO_OPERACIONES, ORDENES_TRABAJO, MATERIALES, ESTADOS_OPERACION_PLAN, CONFIG, AUDITORIA |
| `syncNetSuiteWorkOrders()` | Solo OTs | script lock 30 s | ORDENES_TRABAJO, ESTADOS_OPERACION_PLAN, CONFIG, AUDITORIA |
| `syncNetSuiteWorkOrdersLite()` | Solo OTs, respuesta reducida | script lock 30 s | idem + devuelve solo OTs/estados/metadata |
| `syncNetSuitePlanningData()` | Operaciones/materiales con OTs ya presentes | script lock 60 s | idem syncNetSuitePlant |

Todas re-leen el estado dentro del lock y usan control de revisión. Exclusión mutua entre
sincronización ligera, completa y programación (ver `docs/REGLAS.md`).

### 3.3 Inspección

`getInspectionWorkOrders` (RESTlet `WO_INSPECCION`) → detalle `getInspectionWorkOrderBundle`
(con caché 300 s) → impresión `recordInspectionPrint` (historial) y edición de tramos
`saveInspectionLink` (hoja `Tramos`).

## 4. Estados

| Estado | Ámbito | Notas |
|---|---|---|
| `BORRADOR` | plan | `planLifecycleStatus` al generar borrador |
| `PUBLICADO` / `GUARDADO` / `HISTORICO` | plan | instantáneas en `PLANES_HISTORICOS` |
| `PENDIENTE` | operación | estado por defecto (`ESTATUS_PLAN`) |
| `COMPLETADA_PLAN` | operación | operaciones completadas del plan (no van a la instantánea) |
| `COMPLETADA` | operación | `operationState` / stub `PP_completeOperation_` |
| `EXCLUIDA` | operación | operación excluida (frontera frontend) |
| `SURTIDO_REGISTRADO` | operación | stub `PP_registerSubassemblyPicking_` |
| `CAMBIO_HERRAMENTAL` | operación | `TIPO_INSERCION` para operaciones fantasma de cambio de herramental |
| `CLOSED_KEPT` | OT | advertencia de sync ligera: OT cerrada conservada visible sin entrar al motor |
| `CERRADA`/`CERRADO`/`CLOSED`/`CANCELADA`/`CANCELADO` | OT | estados terminales (no se restauran) |

`TIPO_INSERCION` también usa `SUBCONTRATO` y `OPERATION`. `GENERATED_BY` = `PLANNER_CORE_V2` o
`NETSUITE_APPS_SCRIPT`.

## 5. Versiones

| Constante | Valor | Dónde |
|---|---|---|
| `PP_APP_VERSION` | `2.41.0` | `src/server/01-code.js` |
| `PP_SCHEMA_VERSION` | `29` | `src/server/01-code.js`; `APP_SCHEMA_VERSION` en frontend |
| Versión npm | `2.41.1` | `package.json` |
| `__PP_FLUID_BUILD__` | `fluid-2026-07-11-03` | marcador de optimización (frontend) |
| `LOCAL_CACHE_IDENTITY` | `plan-produccion-cache-v4` | identidad de caché local |
| `STORAGE_KEY` | `plan-produccion-app-v1` | clave de localStorage |
| `META_KEY` | `plan-produccion-performance-v2` | metadatos de rendimiento en localStorage |

## 6. Referencias

- Arquitectura: `docs/project/architecture.md`.
- Módulos: `docs/project/module-map.md`.
- Fuentes de datos y esquemas: `docs/data/sources.md`, `docs/data/relationships.md`.
- Reglas de negocio: `docs/REGLAS.md`, `OT_RULES.md`.
- Configuración y despliegue: `docs/CONFIGURACION.md`, `docs/REBUILD.md`,
  `docs/APPS_SCRIPT_DEPLOYMENT_Y_BYPASS.md`.
