# Fuentes de datos

> Índice humano de todas las fuentes de datos del sistema. La versión estructurada está en
> `.project-memory/data-sources.json`. Cada fuente indica tipo, ubicación exacta, columnas,
> readers, writers y restricciones. Toda columna listada fue verificada contra el código.

Convenciones:

- **reader** = funciones que leen la hoja; **writer** = funciones que la escriben.
- Lectura genérica del backend: `PP_readRows_` usa `getDataRange().getDisplayValues()` con
  **headers en fila 1** (objetos clave=header). Escritura genérica `PP_writeTable_` =
  `clearContents` + `setValues`. `AUDITORIA` es append-only.
- El esquema declarado vive en `PP_SHEETS` (`src/server/02-storage.js`).

---

# Parte A — Workbook principal (`PLANNING_SPREADSHEET_ID`)

## CONFIG

Tabla de pares clave→valor (JSON). Headers: `KEY, VALUE`.

- Readers: `PP_readConfig_` (usado por `PP_readState_`, `PP_assertCurrentRevision_`,
  `PP_nextRevision_`, `PP_writeConfigPatch_`; en `15-performance-service.js`:
  `PP_appRevisionMetadata_`, `getAppStateIfChanged`, `savePlanningStateOptimized`,
  `saveOperationPlanStatus`, `syncNetSuiteWorkOrdersLite`).
- Writers: `PP_writeConfigPatch_`, `PP_writeState_`, seed en `PP_ensureWorkbook_`.
- Claves escritas (no exhaustivo): `schemaVersion`, `appVersion`, `revision`, `savedAt`,
  `source`, `syncedAt`, `ganttView`, `ganttDayWidth`, `selectedOperationId`,
  `capacityMinutes`, `planStart`, `horizonDays`, `loadWeekStart`, `reportWeekStart`,
  `reportFilters`, `preparedPlanningByOt`, `closedWorkOrderSummaries`,
  `EXCLUDED_CAPABILITIES`, `selectedOts`, `lockedOts`, `expandedOts`, `workSchedule`,
  `dailyBreaks`, `plant`, `settings`, `lastSchedule`, `operationCatalogWarning`,
  `invoicePriceWindow`.

## OPERACIONES

Headers (37): `ID, NUM, OT, PARTE, DESCRIPCION, CONTENIDO, PRIORIDAD, FECHA_REQ, CANT_TOTAL,
SECUENCIA, CT, OPERADOR, MAQUINA, HERRAMENTAL, KIT_HERRAMENTAL, CANT_PENDIENTE, TIEMPO_CICLO,
TIEMPO_SETUP, TIEMPO_PROD, FECHA_INICIO, HORA_INICIO, FECHA_FIN, HORA_FIN, TIPO_INSERCION,
ESTATUS, LOG, GENERATED_BY, LOCKED, DIAS_SUBCONTRATO, KIT_PENDIENTE, AUTO_FROZEN,
TIPO_SUBCONTRATO, HERRAMENTAL_ORIGEN, KIT_ORIGEN, HERRAMENTAL_DESTINO, KIT_DESTINO, COMENTARIO,
TIEMPO_FALLBACK`.

- Readers: `PP_readState_` → `PP_mapOperation_` (mapeo header→campo en `PP_OPERATION_FIELDS`).
- Writers: `PP_writeState_`, `PP_writeNetSuiteSyncState_`, `PP_writeWorkOrderSyncState_`,
  `savePlanningStateOptimized`.
- Restricciones: las operaciones con `ESTATUS`/`planStatus` en `COMPLETADA_PLAN` no se incluyen
  en las instantáneas; los cambios de herramental usan `TIPO_INSERCION = CAMBIO_HERRAMENTAL`.

## OPERADORES

Headers: `OPERADOR, ACTIVO, MINUTOS_CAPACIDAD, RENDIMIENTO_PCT, NOMBRE, CATEGORIA`.

- Readers: `PP_readState_`. Writers: `PP_writeState_`, `PP_writeSkillState_`.
- Categorías normalizadas: `ACABADOS`, `FUERA_DE_PLAN`, `TD` (`PP_normalizeResourceCategory_`).

## CAPACIDADES

Headers: `KEY, CT, OPERACION, ACTIVA, CAPACIDAD, SOLAPAMIENTO, PALABRAS_CLAVE,
REQUIERE_HERRAMENTAL, REQUIERE_KIT, CUSTOM, EFICIENCIA_PCT`.

- Readers: `PP_readState_`. Writers: `PP_writeState_`, `PP_writeSkillState_`.
- La clave de cambio de herramental es `TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL`
  (`PP_TOOL_CHANGE_CAPABILITY_KEY`).

## CATALOGO_OPERACIONES

Headers: `KEY, CT, OPERACION, ORIGEN, ACTIVA`.

- Readers: `PP_readState_` → `PP_mapOperationCatalog_`.
- Writers: `PP_writeState_`, `PP_writeSkillState_`, `PP_writeNetSuiteSyncState_`.
- ORIGEN típico: `NETSUITE_MASTER` (catálogo maestro SuiteQL).

## ORDENES_TRABAJO

Headers (18): `ID, WO_INTERNAL_ID, OT, ARTICULO, DESCRIPCION, FOTO_URL, FECHA_INICIO_NS,
FECHA_FIN_NS, FECHA_VENCIMIENTO, FECHA_ENTREGA_AJUSTADA, CANTIDAD, ESTATUS, CLIENTE,
CANT_ENSAMBLADA, CANT_PENDIENTE, PRECIO_PROMEDIO_VENTA, PRECIO_DESDE, PRECIO_HASTA`.

- Readers: `PP_readState_` → `PP_mapWorkOrder_`; `syncNetSuiteWorkOrdersLite`.
- Writers: `PP_writeState_`, `PP_writeNetSuiteSyncState_`, `PP_writeNetSuiteWorkOrdersState_`,
  `PP_writeWorkOrderSyncState_`, `savePlanningStateOptimized`.

## CONFIGURACION_OT

Headers: `OT, MAQUINA, KIT_HERRAMENTAL, KIT_PENDIENTE, TIPO_SUBCONTRATO, DIAS_SUBCONTRATO,
ACTUALIZADO, HERRAMENTAL, HERRAMENTALES_EXTRA_JSON`.

- Readers: `PP_readState_` → `PP_buildOtConfigurations_`.
- Writers: `PP_writeState_`, `PP_writeCatalogState_`, `PP_writeWorkOrderSyncState_`,
  `savePlanningStateOptimized`.
- Restricción: precarga de máquina/herramental/kit para doblado (CT 5459/5527).
- `HERRAMENTAL` guarda el herramental principal; `HERRAMENTALES_EXTRA_JSON` guarda un arreglo JSON
  de herramentales adicionales de la OT. El motor expande cada adicional como operación artificial
  de doblado con la misma capacidad y tiempos del primer doblado.

## CONFIGURACION_ARTICULO

Headers: `ARTICULO, TIPO_OT, TIPO_TRABAJO, PRECIO_MANUAL, ACTUALIZADO`.

- Readers: `PP_readState_` → `PP_buildArticleConfigurations_`.
- Writers: `PP_writeState_`, `PP_writeCatalogState_`, `savePlanningStateOptimized`.

## MATRIZ

Headers: `CAPACIDAD_KEY, OPERADOR, HABILITADO`.

- Readers: `PP_readState_`. Writers: `PP_writeState_`, `PP_writeSkillState_`.
- Relación: una capacidad puede estar habilitada para varios operadores.

## MAQUINAS

Headers: `ID, ACTIVA`.

- Readers: `PP_readState_` → `PP_mapMachine_`. Writers: `PP_writeState_`, `PP_writeCatalogState_`.

## HERRAMENTALES

Headers: `ID, PARTE, HERRAMENTAL, KIT_HERRAMENTAL, TIEMPO_AJUSTE_HERR, TIEMPO_AJUSTE_KIT, ACTIVO`.

- Readers: `PP_readState_` → `PP_mapTool_`. Writers: `PP_writeState_`, `PP_writeCatalogState_`.
- Restricción: la hoja `HERRAMENTALES` se preserva durante la limpieza del borrador.
- Cardinalidad actual: puede haber varias filas para una misma `PARTE` como alternativas de catálogo,
  pero cada fila contiene un solo `HERRAMENTAL` y un solo `KIT_HERRAMENTAL`.

## MATERIALES

Headers (11): `ID, OT, WO_INTERNAL_ID, ENSAMBLE, COMPONENTE_ID, COMPONENTE, DESCRIPCION, UNIDAD,
REQUERIDO, EMITIDO, PENDIENTE`.

- Readers: `PP_readState_` → `PP_mapMaterial_`; `getMaterialsForOt` (filtra por `OT`).
- Writers: `PP_writeState_`, `PP_writeNetSuiteSyncState_`, `PP_writeWorkOrderSyncState_`.

## CALENDARIO

Headers: `ID, CONCEPTO, MAQUINA, FECHA_INICIO, HORA_INICIO, FECHA_FIN, HORA_FIN, MOTIVO, ACTIVO`.

- Readers: `PP_readState_` → `PP_mapCalendar_`. Writers: `PP_writeState_`, `PP_writeCatalogState_`.

## SUBCONTRATOS

Headers: `ID, PARTE, TIPO, DIAS_HABILES, ACTIVO`.

- Readers: `PP_readState_` → `PP_mapSubcontract_`. Writers: `PP_writeState_`,
  `PP_writeCatalogState_`. Seed por defecto en `PP_ensureWorkbook_`: `sub-cromado`/CROMADO/3,
  `sub-metokote`/METOKOTE/3, `sub-maka`/MAKA/3.

## TIPOS_OT

Headers: `ID, NOMBRE, ACTIVO`.

- Readers: `PP_readState_`. Writers: `PP_writeState_`, `PP_writeCatalogState_`.
- Seed: `tipo-oem`/OEM, `tipo-especial`/ESPECIAL, `tipo-linea`/LINEA.

## ESTADOS_OPERACION_PLAN

Headers (22): `KEY, TIPO, ESTATUS_PLAN, OPERATION_ID, OT, SECUENCIA, CT, OPERADOR, MAQUINA,
ARTICULO, DESCRIPCION, FECHA_INICIO, HORA_INICIO, FECHA_FIN, HORA_FIN, HERRAMENTAL_ORIGEN,
KIT_ORIGEN, HERRAMENTAL_DESTINO, KIT_DESTINO, TOOL_KEY_DESTINO, FECHA_COMPLETADO,
FECHA_REAPERTURA`.

- Readers: `PP_readState_` → `PP_buildOperationPlanStatuses_`; `saveOperationPlanStatus`,
  `syncNetSuiteWorkOrdersLite`.
- Writers: `PP_writeState_`, `PP_writeNetSuiteSyncState_`, `PP_writeNetSuiteWorkOrdersState_`,
  `PP_writeWorkOrderSyncState_`, `savePlanningStateOptimized`, `saveOperationPlanStatus`.
- `TIPO` default `OPERATION`; `ESTATUS_PLAN` default `PENDIENTE`.

## PLANES_HISTORICOS

Headers (30): `SNAPSHOT_ID, FECHA_GENERACION, USUARIO, PLAN_INICIO, HORIZONTE_DIAS, NUM, OT,
PARTE, OP, MAQ_AREA, OPERADOR, TC_MIN, TIEMPO_SETUP, TIEMPO_PROD, F_INICIO, H_INICIO, F_FIN,
H_FIN, COMENTARIOS, PRIORIDAD, ESTATUS, BLOQUEADA, HERRAMENTAL, KIT_HERRAMENTAL,
TIPO_SUBCONTRATO, DIAS_SUBCONTRATO, PZAS_PENDIENTES, TIPO_OT, PRECIO_UNITARIO, MONTO`.

- Readers: `PP_listPlanSnapshots_`, `PP_getPlanSnapshot_`, `PP_readMachineToolHistory_`.
- Writer: `PP_appendPlanSnapshot_` (append por filas en `getLastRow()+1`).
- Restricción: al publicar no se incluyen operaciones `COMPLETADA_PLAN` ni sin fechas.
- `PLAN_INICIO` conserva la fecha exacta `INICIO` del Gantt; la metadata `weekStart` del payload/snapshot identifica la semana normalizada al lunes para reportes/publicación (RULE-OT-011).

## BORRADOR_PLAN

Mismos 30 headers que `PLANES_HISTORICOS`.

- Readers: `PP_getPlanSnapshot_` (`sourceSheet='BORRADOR_PLAN'` si `snapshotId === 'draft'`),
  `PP_listPlanSnapshots_`, `PP_replaceDraftSnapshot_` (backup previo).
- Writers: `PP_replaceDraftSnapshot_` (clear + append con `snapshotId='draft'`),
  `PP_clearDraftSnapshot_` (clearContent).
- `PLAN_INICIO` conserva la fecha exacta `INICIO` del Gantt; la metadata `weekStart` del payload/snapshot identifica la semana normalizada al lunes para reportes/publicación (RULE-OT-011).

## plan-produccion.csv

Export CSV descargado por el frontend de planeacion desde el boton `Exportar`. Origen: borrador
programado actual en memoria; si existe `lastSchedule.scheduledOts`, esa lista define las OTs del
CSV. Se omiten operaciones completadas en el plan, historicas/publicadas, sin fechas y capacidades
excluidas por `currentPlanOperations()`.

Headers (33): `NUM, OT, PARTE, DESCRIPCION, CONTENIDO, PRIORIDAD, FECHA_REQ, CANT_TOTAL,
SECUENCIA, CT, OPERADOR, MAQUINA, HERRAMENTAL, KIT_HERRAMENTAL, CANT_PENDIENTE, TIEMPO_CICLO,
TIEMPO_SETUP, TIEMPO_PROD, FECHA_INICIO, HORA_INICIO, FECHA_FIN, HORA_FIN, TIPO_INSERCION,
ESTATUS, LOG, DIAS_SUBCONTRATO, KIT_PENDIENTE, AUTO_FROZEN, HERRAMENTAL_ORIGEN, KIT_ORIGEN,
HERRAMENTAL_DESTINO, KIT_DESTINO, COMENTARIO`.

- Readers: descarga externa del usuario.
- Writer: `exportCsv` (`src/web/planning/app.js`) via `PlanningWorkflowCore.draftExportOperations`.

## AUDITORIA

Headers: `FECHA, USUARIO, ACCION, REVISION, DETALLE`. **Append-only** (nadie lee).

- Writers (appendRow): `PP_writeState_` (`GUARDAR_PLAN`), `PP_writeNetSuiteSyncState_`
  (`SINCRONIZAR_NETSUITE`), `PP_writeNetSuiteWorkOrdersState_` (`SINCRONIZAR_NETSUITE_OT`),
  `PP_writeWorkOrderSyncState_` (`SINCRONIZAR_OT_LIGERA`), `PP_finishPartialWrite_`
  (`GUARDAR_CATALOGOS`/`GUARDAR_MATRIZ`), `PP_appendPlanSnapshot_` (`INSTANTANEA_PLAN`),
  `savePlanningStateOptimized` (`GUARDAR_PLAN_OPTIMIZADO`),
  `saveOperationPlanStatus` (`GUARDAR_ESTADO_OPERACION`).

---

# Parte B — Workbook de inspección (`INSPECTION_SPREADSHEET_ID`)

Default hardcodeado en `16-inspection-service.js`; override con la propiedad
`INSPECTION_SPREADSHEET_ID`.

## Tramos

Headers: `Articulo, Materia prima, Tramo, DIBUJO, Ultima modificacion`. Acepta alias
(`Artículo`, `Material`, `Dibujo`, `URL_DIBUJO`, `ACTUALIZADO`); elimina columnas `AUX`/
`USUARIOMODIFICACION`; renombra `BF` → `Articulo`.

- Readers: `PP_Inspection_routeIndex_`, `PP_Inspection_routeIndexV2_`, `saveInspectionLink`,
  `getInspectionDrawingRoutes`.
- Writer: `saveInspectionLink` (appendRow + setValue).

## HISTORIAL_IMPRESION_INSPEC

Headers: `FECHA_HORA, WO, ARTICULO, CANTIDAD, ESTADO_TRABAJO, SEMAFORO, ALERTAS,
MATERIALES_PENDIENTES, MATERIALES_DEFICIT, SIN_DIBUJO, FALTA_TRAMO, DETALLE_JSON`.

- Readers: `getInspectionHistory`. Writer: `recordInspectionPrint` (appendRow).

---

# Parte C — Pipeline legacy (raíz del repositorio)

Sistema independiente "Plan Maestro" que lee hojas y escribe `Plan Maestro`. Los alimentadores
`* FINAL.js` extraen de NetSuite hacia estas hojas. Ver `docs/REGLAS.md` y `OT_RULES.md`.

## Control de trabajos

Headers (18, **fila 2**, parser `parser_control.js`): `STATUS, TRABAJO, PARTE, REVISION,
CANTIDAD, PRIORIDAD, FECHA REQUERIMIENTO, FECHA FIN ORACLE, CLIENTE, MAQUINA, MEDIDA,
HERRAMENTAL, KIT HERRAMENTAL, CONTENIDO, SUBCONTRATO, COSTO DE PIEZA, COSTO TOTAL, % AVANCE`.

- Reader: `parser_control.js` (`parseControlDeTrabajos`). Writer: `ACTUALIZAR CENTRO DE TRABAJOS.js`
  (`actualizarControlDeTrabajos`).
- ⚠️ Conflicto: `global.js` la lee con `leerHojaEstandar()` asumiendo headers en fila 1.

## Trabajos programados

Headers (8): `Folio de trabajo (link), Artículo, Cantidad, Estado, Fecha inicio de producción,
Fecha finalización de producción, Ubicación, ID Interno`.

- Reader: `parser_trabajos.js`. Writer: `TRABAJOS FINAL.js` (filtro: ubicación
  `PLANTA : Planta MM del Llano` y estado distinto de `cerrada`).
- ⚠️ `Actualizador herramentales.js` usa el nombre `trabajos programados` (todo en minúsculas).

## Operaciones Programadas

Headers (18): `ID (link), Operación, Orden de trabajo, Secuencia, Fecha inicio programada,
Fecha fin programada, Estado, Centro de trabajo, Tiempo preparación (min), Tiempo estimado (min),
Tiempo real (min), Trabajo restante (min), Tasa producción, Recurso humano, Recurso máquina,
Fecha inicio real, Fecha fin real, Cantidad realizada`.

- Reader: `parser_operaciones.js`. Writer: `OPERACION FINAL.js`.
- ⚠️ Conflicto de nombre: `OPERACION FINAL.js` escribe `Operaciones programadas` (p minúscula)
  vs constante `HOJA_OPERACIONES_PROGRAMADAS = 'Operaciones Programadas'`.
- ⚠️ `testoperaciones.js` escribe `Operaciones Programadas` pero con esquema incompatible
  (14 headers en minúsculas): `orden de trabajo, articulo, descripcion articulo, estado,
  fecha inicio, fecha inicio real orden, fecha final, cantidad planificada, cantidad completada,
  secuencia, operacion, tiempo setup real, tiempo trabajo real, id operacion`.

## Plan Maestro

Headers (25, escritos por `WRITTER.js`): `NUM, OT, PARTE, DESCRIPCION, CONTENIDO, PRIORIDAD,
FECHA_REQ, CANT_TOTAL, SECUENCIA, CT, OPERADOR, MAQUINA, HERRAMENTAL, KIT_HERRAMENTAL,
CANT_PENDIENTE, TIEMPO_CICLO, TIEMPO_SETUP, TIEMPO_PROD, FECHA_INICIO, HORA_INICIO, FECHA_FIN,
HORA_FIN, TIPO_INSERCION, ESTATUS, LOG`.

- Writer: `WRITTER.js` (`escribirPlanMaestro`). Salida del scheduler legacy.

## BALANCE DE CARGAS

Columnas usadas: `OPERADOR, ID CENTRO DE TRABAJO` (el CT puede ser lista separada por comas).

- Reader: `global.js` (`construirMapaOperadores`).

## SUBCONTRATOS (legacy)

Columnas usadas: `PARTE, TIPO, DIAS` (fila con `TIPO === 'NO APLICA'` se ignora).

- Reader: `modelo_logico.js` (`construirMapaSubcontratos`).

## Inventario Total

Headers (11): `ID Artículo, Artículo, Descripción, Ubicación, Disponible, Física, Comprometida,
Pickeada, En Tránsito, Última Modificación, Precio`.

- Writer: `INVENTARIO FINAL.js`. Consumido por `modelo_logico.js` (columnas `Artículo`,
  `Descripción`).

## Herramentales (legacy)

Columnas por modelo: `PARTE, HERRAMENTAL, KIT HERRAMENTAL, TIEMPO DE AJUSTE HERRAMENTAL,
TIEMPO DE AJUSTE KIT` (`modelo_logico.js`); posicional `PARTE, DIAMETRO, HERRAMENTAL, KIT`
(`ACTUALIZAR CENTRO DE TRABAJOS.js`); escritor de PARTEs `Actualizador herramentales.js`.

## Días festivos

- Reader: `SCHEDULER.js` (columna A = fecha ISO, sin headers).
- Writer: `CALENDARIO VACACIONES.js` (headers `FECHA, MOTIVO`, formato `dd/MM/yyyy`, origen
  SuiteQL `workcalendarholiday` con `workcalendar = 3`).

## Excepciones de dia

Headers (9): `TIPO, FECHA, INICIO TURNO, COMIDA INICIO, COMIDA FIN, BREAK INICIO, BREAK FIN,
FIN DE TURNO, MOTIVO`. Obligatorias: `TIPO, INICIO TURNO, FIN DE TURNO`.

- Reader: `SCHEDULER.js` (`cargarHorariosDesdeExcepciones`).
- Reglas: `ESTANDAR` define el horario base; `ESPECIAL`+`FECHA` define horario por día.
  Precedencia: festivo > especial > fin de semana > estándar.

## Materiales programados

Headers: `ID, Artículo, Material, Descripción, Cantidad, Emitido, Pendiente por emitir`.

- Writer: `MATERIALES FINAL.js`. No lo consume ningún parser de la raíz.

## Contenido / Costo de piezas

- `Contenido`: columnas `PARTE, CONTENIDO`. Reader: `ACTUALIZAR CENTRO DE TRABAJOS.js`.
- `Costo de piezas`: columnas `PARTE, COSTO`. Reader: `ACTUALIZAR CENTRO DE TRABAJOS.js`.

---

# Parte D — NetSuite

## RESTlets

| Script | Deploy | Body | Uso |
|---|---|---|---|
| `1764` | `1` | `{ table: 'WO_LISTA', locationId: 1, onlyOpen: true, pageIndex, pageSize: 200 }` | OTs (folios, internal IDs, cantidades, fechas, precios) |
| `1762` | `17` | `{ locationId: 1, onlyOpen: true, pageIndex, pageSize: 200 }` | Operaciones programadas de la planta |
| `1763` | `14` | `{ locationId: 1, onlyOpen: true, maxWOs: 50000, pageIndex, pageSize: 200 }` | Materiales |
| `2080` | `1` | `{ table: 'WO_INSPECCION', locationId: 1, onlyOpen: true, action: 'list'\|'detail', ... }` | Inspección (props `NS_WO_INSPECTION_SCRIPT/DEPLOY`) |

- Endpoint: `https://{accountId}.restlets.api.netsuite.com/app/site/hosting/restlet.nl`.
- OAuth 1.0a HMAC-SHA256 (`PP_oauthHeader_`). Credenciales en Script Properties (`NS_*`).

## SuiteQL

Endpoint: `https://{accountId}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`
(`POST`, body `{q: sql}`, header `Prefer: transient`, `limit=1000`).

1. **Catálogo maestro de operaciones** (`PP_fetchNetSuiteOperationCatalog_`):
   `manufacturingroutingstep` JOIN `manufacturingrouting` JOIN `entitygroup`, con
   `NVL(routing.isinactive,'F')='F'` y `NVL(center.isinactive,'F')='F'`. Excluye operaciones
   especiales `SUBCONTRATO/CROMADO/METOKOTE/MAKA/GALVANIZADO`. Caché en `CacheService`
   (`NS_OPERATION_CATALOG_V1_{accountId}_{locationId}`, TTL 3600 s) + cooldown 1 h.
2. **Promedios de facturación** (`PP_fetchInvoiceSalesAverages_`): ventana 6 meses
   (mínimo `2026-02-01`), `CustInvc` no anuladas, promedio `ABS(SUM(netamount))/ABS(SUM(quantity))`.
3. **Ruta directa de OT** (`18-planning-work-order-service.js`):
   `manufacturingoperationtask WHERE workorder='...'` y lookup `transaction WHERE type='WorkOrd'
   AND tranid='...'`.

## REST Record API v1

`https://{accountId}.suitetalk.api.netsuite.com/services/rest/record/v1/...`

- `workorder` (lista + detalle por `links.rel='self'`): usado por `TRABAJOS FINAL.js`.
- `workorder/{id}/billOfMaterialsRevision/component` y `inventoryItem/{itemId}`:
  usado por `MATERIALES FINAL.js`.

## Reglas de sincronización (backend)

- `onlyOpen: true` en los RESTlets; filtro de planta (`PP_buildPlantFilter_`/`PP_belongsToPlant_`).
- `PP_isSchedulable_` excluye estados que contienen `COMPLETE, COMPLETAD, CERRAD, CLOSED,
  CANCELAD, CANCELED, CANCELLED`.
- `PP_assertNetSuiteRows_` lanza error si NetSuite devuelve 0 filas.
- Los estados terminales de OT (`CERRADA, CERRADO, CLOSED, CANCELADA, CANCELADO`) no se restauran.
- Catálogo: un fallback nunca reemplaza el catálogo anterior por una lista vacía.

---

# Parte E — Google Drive

- Carpeta de fotos (`PHOTO_FOLDER_ID`): indexada por `PP_loadPhotoCatalog_` (miniaturas
  `drive.google.com/thumbnail?id=...&sz=w400`), caché `pp:photo-catalog:{folderId}` 600 s.
- Reader: `09-photos.js`. Escritura: solo lectura (no se escriben archivos).

---

# Conflictos y pendientes (documentados, sin corregir)

1. `Operaciones Programadas` vs `Operaciones programadas` (mayúscula en la "p").
2. `testoperaciones.js`: esquema de 14 headers incompatible con `parser_operaciones.js`.
3. `trabajos programados` (minúsculas) vs `Trabajos programados` (`Actualizador herramentales.js`).
4. `Control de trabajos`: headers en fila 2 vs `leerHojaEstandar()` que asume fila 1.
5. Credenciales OAuth hardcodeadas en 8 scripts legacy de la raíz + ID de libro en
   `Actualizador herramentales.js` (pendiente: rotar y mover a Script Properties).
6. `NetSuiteOAuth.request` ignora el 5º argumento (`Prefer: transient` no se aplica en
   `EXISTENCIAS INV.js`).
7. `getDeploymentStatus()` no devuelve `frontendOrigin` (discrepancia con documentación antigua).
