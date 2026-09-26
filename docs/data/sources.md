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
  `invoicePriceWindow`, `operationsSyncedAt`.
- `syncedAt` global indica la última sincronización NetSuite completa. La frescura de la
  generación de plan se evalúa por OT con `operationsSyncedAt` (mapa OT normalizada -> ISO,
  clave CONFIG adicional): una OT se considera fresca si tiene operaciones en `state.operations`
  y su timestamp está dentro de `NETSUITE_PLANNING_FRESH_MS` (24 h). Si todas las OTs
  seleccionadas están frescas, se genera sin llamar NetSuite. Si NetSuite no responde al
  refresco y quedan OTs sin operaciones cargadas, la generación continúa parcial con las OTs
  disponibles y avisa cuáles quedaron fuera (RULE-OT-013).
- `workSchedule` (JSON por día: `{ MON..SUN: { enabled, start, end } }`) define la ventana de
  trabajo de cada día que consume `effectiveWindows` del motor (RULE-CAL-001). Default en
  `app.js:19-27`: lunes a viernes `07:00-17:00` habilitados; sábado/domingo deshabilitados
  (`07:00-13:00` sin efecto). `dailyBreaks` (JSON por evento: `{ MEAL, PRODUCTION: { enabled,
  start, end } }`) define pausas intradía que restan de la ventana; default deshabilitadas
  (`app.js:28-31`). Ambos los lee el frontend (`app.js:1018-1027`) y el motor
  (`planner-core.js:1267-1279`), y los persiste el backend como JSON en `CONFIG`
  (`02-storage.js:130-131, 567-568`).
- `selectedOts` es la clave que materializa la cola **Planeado / Por planear**
  (RULE-OT-005). Restricciones (RULE-OT-047):
  - Escritor del traslado: `performSelectJob` → `flushPlanSave("plan")` →
    `savePlanningStateOptimized` (`15-performance-service.js`), que escribe
    `CONFIG.selectedOts` como arreglo de OTs normalizadas. No existe debounce tolerado para
    esta acción: se persiste de inmediato y se espera el acuse.
  - En cada recarga el backend es la única autoridad de la lista: `loadState()` (`app.js`)
    devuelve `deepClone(sampleState)` y nunca lee `localStorage`; la cola efectiva llega por
    `getAppState`/`getAppStateIfChanged` → `PP_buildState_` (`selectedOts`).
  - El cache local (`compactLocalState`, `performance-client.js`) **conserva** `selectedOts`
    y `lockedOts` (sí descarta `operations`, `lastSchedule` y las vistas efímeras) porque es la
    única red mientras el servidor no responde; su identidad es
    `performanceCache.identity = plan-produccion-cache-v5` y la validez se comprueba contra
    `revision` + `cacheRevision` de la metadata `plan-produccion-performance-v2`.
  - Una importación remota (`applyImported` con `preserveLocalPlanning:false`) no debe borrar
    un alta local no guardada: `reloadStateAfterConflict` (conflicto) y
    `loadInitialStateConditionally` (carga de arranque) reaplican
    `state._locallyAddedDraftOts` y `state._locallyEditedOtConfigurations` antes/después de
    importar (RULE-GOV-013 + RULE-OT-047).

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
- Origen de refresco: `syncNetSuitePlanningData` reemplaza esta hoja con operaciones abiertas de
  NetSuite; las consultas directas por OT (`getPlanningWorkOrderData`) fusionan operaciones de una
  OT en el estado del navegador y luego pueden persistirse en esta hoja. Si el refresco general de
  NetSuite vence timeout al generar plan, `state.operations`/`OPERACIONES` ya cargadas son el
  fallback usado por el motor, siempre que cubran todas las OTs seleccionadas.
- Restricciones: las operaciones con `ESTATUS`/`planStatus` en `COMPLETADA_PLAN` no se incluyen
  en las instantáneas; los cambios de herramental usan `TIPO_INSERCION = CAMBIO_HERRAMENTAL`.
- Restricción: para doblado con máquina se genera/conserva `CAMBIO_HERRAMENTAL` cuando el último
  herramental/kit de esa máquina difiere o no existe antecedente; `KIT_PENDIENTE` sin kit no elimina
  el cambio inicial por herramental.

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

Headers (19): `ID, WO_INTERNAL_ID, OT, ARTICULO, DESCRIPCION, FOTO_URL, FECHA_INICIO_NS,
FECHA_FIN_NS, FECHA_VENCIMIENTO, FECHA_ENTREGA_AJUSTADA, CANTIDAD, ESTATUS, CLIENTE,
CANT_ENSAMBLADA, CANT_PENDIENTE, PRECIO_PROMEDIO_VENTA, PRECIO_DESDE, PRECIO_HASTA,
PRECIO_ULTIMA_VENTA`.

- Readers: `PP_readState_` → `PP_mapWorkOrder_`; `syncNetSuiteWorkOrdersLite`;
  `DASH_getOrdenesRows_` (dashboard-control-prod: cuadrante 2 "Saldrán"; JOIN por OT
  normalizada con fallback de dígitos para mostrar cliente y cobertura vía `CANT_ENSAMBLADA`).
- Writers: `PP_writeState_`, `PP_writeNetSuiteSyncState_`, `PP_writeNetSuiteWorkOrdersState_`,
  `PP_writeWorkOrderSyncState_`, `savePlanningStateOptimized`.
- Restricción: el payload ligero de `fetchNetSuiteWorkOrdersLite` no incluye tiempos de operación
  (solo cabecera de la OT); los tiempos reales de una OT se obtienen por consulta directa
  (`getPlanningWorkOrderData`) y se fusionan en `state.operations`/`OPERACIONES`.

## CONFIGURACION_OT

Headers: `OT, MAQUINA, KIT_HERRAMENTAL, KIT_PENDIENTE, TIPO_SUBCONTRATO, DIAS_SUBCONTRATO,
ACTUALIZADO, HERRAMENTAL, HERRAMENTALES_EXTRA_JSON`.

- Readers: `PP_readState_` → `PP_buildOtConfigurations_`.
- Writers: `PP_writeState_`, `PP_writeCatalogState_`, `PP_writeWorkOrderSyncState_`,
  `savePlanningStateOptimized`; edición en el cliente vía `applyMachineToJob`, `applyToolToJob`,
  `applyKitToJob`, `applySubcontractToJob` (cada una marca la clave en `state._locallyEditedOtConfigurations`
  con `rememberLocalOtConfigurationEdit`).
- Restricción: precarga de máquina/herramental/kit para doblado (CT 5459/5527).
- Restricción: antes de generar plan, la preparación y validación deben usar esta configuración
  efectiva persistida para las OTs realmente reprogramables del alcance incremental; no debe
  volver a pedir máquina, herramental, kit o tipo/días de subcontrato si el dato requerido ya
  existe aquí. Si el dato ya guardado no se encontró, confirmar que las claves de OT coinciden
  (mismo formato) entre donde se edita y donde se valida.
- Restricción: tras una recarga por conflicto (`CONFLICT_REVISION`) **o tras cualquier otra
  carga remota** (`loadInitialStateConditionally`), las ediciones locales marcadas en
  `state._locallyEditedOtConfigurations` se re-fusionan sobre la fila remota y los tombstones
  se limpian solo con el acuse durable del guardado (RULE-GOV-013, RULE-OT-047).
- `HERRAMENTAL` guarda el herramental principal; `HERRAMENTALES_EXTRA_JSON` guarda un arreglo JSON
  de herramentales adicionales de la OT. El motor expande cada adicional como operación artificial
  de doblado con la misma capacidad y tiempos del primer doblado.

## CONFIGURACION_ARTICULO

Headers: `ARTICULO, TIPO_OT, TIPO_TRABAJO, PRECIO_MANUAL, ACTUALIZADO`.

- Readers: `PP_readState_` → `PP_buildArticleConfigurations_`.
- Writers: `PP_writeState_`, `PP_writeCatalogState_`, `savePlanningStateOptimized`.
- Restricción (RULE-FIN-001): si `ORDENES_TRABAJO` tiene `PRECIO_ULTIMA_VENTA`,
  `PRECIO_PROMEDIO_VENTA` y `PRECIO_MANUAL` en 0 y la operación de la OT no tiene
  `unitPrice`/`amount` ≥ $1, la preparación de la OT abre el
  modal con `ot_manual_price` obligatorio (`required`, `min="1"`; piso $1 MXN, RULE-MON-001);
  si la ops ya trae precio/monto ≥ $1 no se pide precio.

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

- Readers: `PP_readState_` → `PP_mapCalendar_` (mapea a `state.calendarExceptions` con campos
  `{id, concept, machine, startDate, start, endDate, end, reason, active}`); en el frontend el
  motor `PlannerCore.effectiveWindows` consume esas excepciones (`planner-core.js:1280-1297`).
- Writers: `PP_writeState_`, `PP_writeCatalogState_`.
- Origen de datos: hoja mantenida por el usuario (configuración de calendario); no proviene de
  NetSuite.
- Conceptos (`CONCEPTO`, RULE-CAL-001):
  - `GENERAL` — paro extraordinario de toda la planta con horario definido (`start`/`end`).
  - `MAQUINA` — la máquina de `MAQUINA` no está disponible en el intervalo; sin horas cubre el
    día completo. `MAQUINA` → `MAQUINAS.ID`.
  - `ASUETO` — asueto de toda la planta; sin horas se considera el día completo.
  - `VACACIONES` — periodo continuo (fecha/hora inicial → final).
  - `OPERADOR` — el operador de `MAQUINA` (columna reutilizada como recurso) no está disponible en
    el intervalo; sin horas cubre el día completo. El motor lo filtra por `resource`/`recurso`
    (`planner-core.js:1287`) y el frontend lo conserva al normalizar estado (`app.js:1086`,
    mapeando el recurso en `resource`). El backend persiste el operador en la columna `MAQUINA`
    (`02-storage.js:222-224`).
- `ACTIVO = false` excluye la excepción (`planner-core.js:1281`).
- Efecto en el motor: cada excepción resta un intervalo de la ventana de trabajo del día
  (`subtractWindow`); una sin horas abarca `00:00-24:00` (`planner-core.js:1294-1296`). Ver
  RULE-CAL-001 y RULE-CAL-002.

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

Headers (31): `SNAPSHOT_ID, FECHA_GENERACION, USUARIO, PLAN_INICIO, HORIZONTE_DIAS, NUM, OT,
PARTE, OP, MAQ_AREA, OPERADOR, TC_MIN, TIEMPO_SETUP, TIEMPO_PROD, F_INICIO, H_INICIO, F_FIN,
H_FIN, COMENTARIOS, PRIORIDAD, ESTATUS, BLOQUEADA, HERRAMENTAL, KIT_HERRAMENTAL,
TIPO_SUBCONTRATO, DIAS_SUBCONTRATO, PZAS_PENDIENTES, TIPO_OT, PRECIO_UNITARIO, MONTO,
COMPLETION_KEY`.

- Readers: `PP_listPlanSnapshots_`, `PP_getPlanSnapshot_`, `PP_readMachineToolHistory_`,
  `loadIncrementalPlanningBase` para generación normal y `window.runPlanningPerformanceDryRun()`
  (frontend, solo lectura; usa presupuesto cooperativo del planner con default 60000 ms o
  `options.timeoutMs`, devuelve métricas parciales sin persistir, y `options.skipScheduler`/
  `profileOnly` omite el scheduler).
- Writer: `PP_appendPlanSnapshot_` (append por filas en `getLastRow()+1`).
- `COMPLETION_KEY`: guarda el `id` real de la operación del borrador al publicar, para que la clave de
  completado (`operationCompletionKey`) del snapshot publicado coincida con la del borrador y el estado de
  completado (botones Completar/Reabrir) se comparta entre ambos. Vacío en filas antiguas.
- Restricción: al publicar no se incluyen operaciones `COMPLETADA_PLAN` ni sin fechas.
- `PLAN_INICIO` conserva la fecha exacta `INICIO` del Gantt; la metadata `weekStart` del payload/snapshot identifica la semana normalizada al lunes para reportes/publicación (RULE-OT-011).

## BORRADOR_PLAN

Mismos 31 headers que `PLANES_HISTORICOS` (incluida `COMPLETION_KEY`).

- Readers: `PP_getPlanSnapshot_` (`sourceSheet='BORRADOR_PLAN'` si `snapshotId === 'draft'`),
  `PP_listPlanSnapshots_`, `PP_replaceDraftSnapshot_` (backup previo),
  `loadIncrementalPlanningBase` para generación normal y `window.runPlanningPerformanceDryRun()`
  (frontend, solo lectura; usa presupuesto cooperativo del planner con default 60000 ms o
  `options.timeoutMs`, devuelve métricas parciales sin persistir, y `options.skipScheduler`/
  `profileOnly` omite el scheduler).
- Writers: `PP_replaceDraftSnapshot_` (clear + append con `snapshotId='draft'`),
  `PP_clearDraftSnapshot_` (clearContent).
- `PLAN_INICIO` conserva la fecha exacta `INICIO` del Gantt; la metadata `weekStart` del payload/snapshot identifica la semana normalizada al lunes para reportes/publicación (RULE-OT-011).

## plan-produccion.csv

Export CSV descargado por el frontend de planeacion desde el boton `Exportar`. Origen: borrador
programado actual en memoria; si existe `lastSchedule.scheduledOts`, esa lista define las OTs del
CSV. Se omiten operaciones completadas en el plan, historicas/publicadas, sin fechas y capacidades
excluidas por `currentPlanOperations()`.
En filas `CAMBIO_HERRAMENTAL`, `PARTE` identifica el articulo/OT que origina el cambio; `HERRAMENTAL`
y `KIT_HERRAMENTAL` contienen el destino asignado al cambio, ademas de las columnas origen/destino.
La fila debe aparecer si el doblado requiere una máquina y no hay antecedente de herramental en esa
máquina, o si el último herramental/kit conocido en la misma máquina difiere del destino.

Headers (35): `NUM, OT, PARTE, DESCRIPCION, CONTENIDO, PRIORIDAD, FECHA_REQ, CANT_TOTAL,
SECUENCIA, CT, OPERADOR, MAQUINA, HERRAMENTAL, KIT_HERRAMENTAL, CANT_PENDIENTE, TIEMPO_CICLO,
TIEMPO_SETUP, TIEMPO_PROD, FECHA_INICIO, HORA_INICIO, FECHA_FIN, HORA_FIN, TIPO_INSERCION,
ESTATUS, LOG, DIAS_SUBCONTRATO, KIT_PENDIENTE, AUTO_FROZEN, HERRAMENTAL_ORIGEN, KIT_ORIGEN,
HERRAMENTAL_DESTINO, KIT_DESTINO, COMENTARIO, PRECIO, MONTO`.
`PRECIO` = precio unitario de la OT: `max(unitPrice` de la operación,
`max(PRECIO_ULTIMA_VENTA, PRECIO_PROMEDIO_VENTA)`, `PRECIO_MANUAL`)`;
`MONTO` = `PRECIO × piezas pendientes` de la OT (monto de liberación, RULE-MON-001).
Valores almacenados `< $1 MXN` (cero o polvo residual 0.01/0.1) **no cuentan**: en el CSV
`PRECIO`/`MONTO` caen al fallback (`effectiveUnitPriceForOt`/`amountForOt`) y en
`weeklyJobSummary` (Plan de la semana) la fila queda sin precio (`null` → `$0.00`);
el piso $1 MXN evita publicar el polvo `$0.01`/`$0.02` de COMPONENTE.

- Readers: descarga externa del usuario.
- Writer: `exportCsv` (`src/web/planning/app.js`) via `PlanningWorkflowCore.draftExportOperations`.
- `FECHA_INICIO`/`HORA_INICIO`/`FECHA_FIN`/`HORA_FIN` conservan el inicio y fin reales de la
  operación; cuando una operación se parte entre días laborables (RULE-CAL-002), el fin puede caer
  en el día siguiente (07:00 del siguiente día hábil) aunque `TIEMPO_PROD` siga siendo los minutos
  productivos.

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
- ⚠️ No incluye columna de cantidad a procesar. En el sync completo (RESTlet 1762/17 vía
  `PP_fetchNetSuitePlanningData_` → `PP_mapNetSuiteOperation_`), la cantidad pendiente
  (`cantTotal`/`cantPendiente`) proviene de la OT: de la fila si expone
  `Cantidad a procesar` / `Cantidad` / `qty_to_process`, o del catálogo de OTs
  (`current.workOrders[].pendingQuantity = Cantidad - Cantidad ensamblada`, RESTlet 1764/1);
  no existe fallback de cantidad. Las operaciones cuya OT no está en el catálogo abierto
  (OT cerrada o eliminada) se descartan del sync completo y de planeación (filtro
  `PP_belongsToPlant_` contra el catálogo). La ruta directa por OT
  (`PP_fetchDirectWorkOrderOperations_`) sí inyecta `Cantidad a procesar = Cantidad - Cantidad ensamblada`. La ruta directa por OT
  (`PP_fetchDirectWorkOrderOperations_`) sí inyecta `Cantidad a procesar = Cantidad - Cantidad ensamblada`.
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
| `1764` | `1` | `{ table: 'WO_LISTA', locationId: 1, onlyOpen: true, pageIndex, pageSize: 200 }` | OTs abiertas. Headers reales (2026-09-24): `WO Internal ID, WO Folio, Artículo, Descripción, Cantidad, Fecha de vencimiento, Estatus, BOM Revision, Revisión, Cliente` — **sin `Item Internal ID`** → `PP_buildWorkOrderCatalog_.itemId` va vacío; match de precios solo por `Artículo` |
| `1766` | `1` | `{ table: 'REQ_FIFO', pageIndex, pageSize }` | Precios de venta por artículo: headers reales incluyen `PARTE` (nombre), `_ITEM_ID`, `PRECIO BASE MNX`, `CANTIDAD ORDEN`, `FECHA DE ORDEN`, `MONEDA`, `TIPO CAMBIO` — **sin `_ITEM_NAME`**; `PP_fetchSalesPricesRestlet_` indexa por `_ITEM_ID` y `PARTE` (FIX 2026-09-24). **`pageSize: 1000`** desde RULE-REP-016-B: es el tamaño que ya usa en producción el script de inventario `INV_PLANTAS_WIP`, o sea que el restlet lo aguanta; con el 200 histórico la app paginaba 5× más veces sobre las mismas filas. **Tope real 1000** (RULE-REP-018: pedir 2000 devuelve 1000) |
| `1762` | `17` | `{ locationId: 1, onlyOpen: true, pageIndex, pageSize: 200 }` | Operaciones programadas de la planta |
| `1763` | `14` | `{ locationId: 1, onlyOpen: true, maxWOs: 50000, pageIndex, pageSize: 200 }` | Materiales |
| `2244` | `1` | `{ table: 'WO_INSPECCION', locationId: 1, onlyOpen: true, action: 'list'\|'detail'\|'diagnostico', ... }` | Inspección (props `NS_WO_INSPECTION_SCRIPT/DEPLOY`; default `2244`). `list` con `pageSize: 500` (`getInspectionWorkOrders`, **una** llamada por carga); `detail` con `woFolio` (`getInspectionWorkOrder`, `getInspectionWorkOrderBundle`, `getPlanningWorkOrderData`). Desde RULE-REP-016-A el `list` pagina en SuiteQL (`FETCH NEXT pageSize+1` / `OFFSET`) y ya no expone `totalRows`: `hasMore` se deduce de la fila extra. |

- Endpoint: `https://{accountId}.restlets.api.netsuite.com/app/site/hosting/restlet.nl`.
- OAuth 1.0a HMAC-SHA256 (`PP_oauthHeader_`). Credenciales en Script Properties (`NS_*`).
- **Costo por llamada (medido, RULE-REP-019):** `ms = 2023 + 0.543 × filas`, ajustado sobre cuatro `pageSize` del 1766 (200→2124 ms, 500→2306, 1000→2561, 2000→2371). El término fijo de ~2 s domina: pedir 5× más filas cuesta 0.34 s más, **repetir la llamada cuesta 2 s**. Por eso `PP_RESTLET_PAGE_SIZE_` sube el tamaño mientras el restlet lo aguante: `1766: 1000` (tope real), `2240: 2500` (2400 filas ⇒ **1 llamada**), resto `200` (máximo **no verificado**, no subir a ciegas).
- **El 2240 (CORREGIDO 2026-09-26, se sube a NetSuite a mano):** el archivo del repo ya trae las tres correcciones de RULE-REP-019, pero **producción sigue con la versión vieja** hasta que se suba. Antes: `const all = runSuiteQL_(sql)` + `all.slice(from, to)`, o sea que **cada llamada re-ejecutaba el JOIN completo** de `manufacturingoperationtask` + `transaction` + `transactionline`, y `post()` **ignoraba `body.locationId`** (solo leía `pageSize` y `pageIndex`). Ahora: página en SQL con `FETCH NEXT`/`OFFSET`, `tl.location = ?` como parámetro ligado y `location` en la respuesta. El desglose medido que motiva el filtro: **2231** operaciones de planta 1 contra **169** de otras (7%).
  - **Riesgo y cómo se cubre:** `FETCH NEXT/OFFSET` resultó **no existir** en el SuiteQL de esta cuenta, y `BUILTIN.DF` **no** se puede aplicar sobre `mot.status` (sí sobre `mot.manufacturingworkcenter`, que es referencia a entidad). Ambos se comprobaron en producción el 2026-09-26: al subirlos, los dos RESTlets devolvieron `400 "Failed to parse SQL"` y la app se quedó sin operaciones ni inspección. Por eso el RESTlet trae un **fallback de estrategias** y la última es **literalmente el SQL de producción** (sin `tl.location`, sin `FETCH NEXT`): `con-ubicacion` → `sql-de-produccion`. Si una lanza excepción se pasa a la siguiente; si el filtro por ubicación devuelve **0 filas sin excepción**, también degrada. `debug` deja constancia de qué estrategia respondió.
  - **Verificado en producción 2026-09-26 08:12** (`DIAG_restlets`, 0 fallos): `estrategia: con-ubicacion`, `degradaciones: []`, **2231 filas** con 2231 ids únicos, 0 repetidas — exactamente la línea base de planta 1, ni una menos. `tl.location` **sí** es una columna válida: el filtro funciona y las 169 filas de otras plantas ya no viajan. **2556 ms** por el camino de la app, contra las 12 llamadas y ~25 s previas. El `pageSize: 2500` del servidor es lo que da ese ~10×; la paginación en SQL no aporta nada aquí.
  - El `2244` responde 200 con **222** OTs de inspección, 222 ids únicos, 0 repetidas. Como `getInspectionWorkOrders` pide una sola página (`pageIndex: 0`, `pageSize: 500`), la app ve las 222 completas. El día que superen 500, la app solo verá la primera página: es un límite conocido, no una regresión.
  - El `ORDER BY` ganó un desempate por `mot.id` (`wo.id, mot.operationsequence, mot.id`): sin un orden total, `OFFSET` puede repetir o saltar filas entre páginas, lo que rompería el `operationId` estable `ns-<id>` (RULE-OT-031).
  - `totalRows` deja de exponerse (implicaba recorrer el mismo `JOIN` para contar; ningún consumidor del repo lo leía). El servidor solo usa `hasMore`.
  - Pruebas: `tests/restlet-operaciones.test.mjs` (15 casos; el 2240 no tenía ninguna antes). 4 cubren el *fallback*: degradar al recorte en memoria si `FETCH NEXT` falla, degradar a sin filtro si el filtro devuelve 0, enumerar los intentos si todo falla, y ganar la primera estrategia con una sola consulta cuando nada falla.
- **Contrato que consume el servidor** (`src/server/08-netsuite.js:56` y `:116`): `PP_fetchRestletPages_(PP_operationsRestlet_(), { locationId: config.locationId, onlyOpen: true }, config, 20)` con `PP_OPERATIONS_RESTLET_ = { script: '2240', deploy: '1' }` fijo en código (a diferencia del 2244, que sí lee `NS_WO_INSPECTION_SCRIPT`). El servidor manda `locationId` **y sigue filtrando en memoria** con `PP_belongsToPlant_` (`08-netsuite.js:833`): esa segunda red es la que evita que un filtro equivocado en el RESTlet traiga operaciones de otra planta, y por eso el cambio es seguro de subir aunque el `WHERE` no se aplique.
- Errores: `PP_netSuiteRestletRequest_` reintenta 3 veces (2/5/10 s) **solo** ante `400 SSS_REQUEST_LIMIT_EXCEEDED`; cualquier otro 400 se devuelve de inmediato. Un 200 con `{"ok":false,...}` (p. ej. folio inexistente o body sin `table`) NO es un error de NetSuite: es el RESTlet validando sus parámetros, y el folio **no** se interpola en el SuiteQL (verificado 2026-09-25 con folios `3483'`, `3483 OR 1=1`, `3483%` y uno de 90 caracteres → `200 {"ok":false,"WO no encontrada: …"}`).
- **`REQ_FIFO` en detalle (RULE-REP-018, verificado 2026-09-26 con la sonda `DIAG_precios1766`):** son **6 671 filas** de *línea de orden de venta* con sus impuestos, no una vista de precio. Las 25 columnas reales: `FECHA DE ORDEN, ORDEN, CLIENTE, ID CLIENTE, LINEA, PARTE, PLANTA, CANTIDAD ORDEN, PZAS POR SURTIR, ESTADO SURTIDO, FECHA EMBARQUE, PRICE LEVEL, PRECIO BASE MNX, MONEDA, TIPO CAMBIO, IVA_RATE, TAX AMOUNT, GROSS AMT, ESTADO, _QTY_PICKED, _QTY_PACKED, _QTY_FULFILLED, _QTY_BILLED, _ITEM_ID, _LOCATION_ID`. `ORDEN` + `LINEA` es la clave del renglón. Con `pageSize: 1000` son **7 páginas**, no 100.
  - **`PRECIO BASE MNX` NO está en pesos cuando la venta es en otra moneda.** Demostración con la fila real `_ITEM_ID 5111`: precio `3204.25`, `MONEDA` `US Dollar`, `TIPO CAMBIO` `18.31`, cantidad `22`, `TAX AMOUNT` `11278.96`, `GROSS AMT` `81772.46`. `3204.25 × 22 = 70 493.50`; `× 0.16 = 11 278.96` = `TAX AMOUNT` exacto; `70 493.50 + 11 278.96 = 81 772.46` = `GROSS AMT` exacto. Ni el impuesto ni el total del propio restlet aplican el tipo de cambio, así que el valor viene en la moneda de la transacción. `PP_fetchSalesPricesRestlet_` lo convierte con `TIPO CAMBIO` (MXN por unidad de moneda extranjera; en pesos vale 1, y si viniera 0 o ausente se conserva el valor crudo en vez de dejar 0). **Lo mismo aplica a `GROSS AMT` y `TAX AMOUNT`**, que quedan en la moneda original.
  - **El tipo de cambio NO es un número fijo.** En la corrida real del 2026-09-26 aparecieron `18.31`, `17.9842` y `17.3213` en la misma tabla, porque el factor varía por fecha. No documentar "×18" como si fuera constante.
  - **Magnitud real del bug (verificado 2026-09-26):** de las 6 671 filas, **2 464 (37%)** tienen `TIPO CAMBIO > 1`. El error de tomar el campo como pesos no era un caso raro, afectaba más de un tercio de los renglones de precio y con ello los montos de los reportes.
  - **La conversión quedó verificada de punta a punta en producción** con `scripts/diagnosticos/VERIFICA_PRECIOS_B.gs` (2026-09-26 09:28): de los 893 artículos con venta ganadora, **888 de 888** devuelven `crudo × TIPO CAMBIO` y **ninguno** devuelve el crudo sin convertir (tolerancia 0.5%), y el promedio ponderado por cantidad —el número que va a los reportes— cuadra **768/768**. Ejemplo del log: artículo 9392, `US Dollar`, crudo `104.6207`, `TIPO CAMBIO` `17.3213` → la función devuelve `1812` (`104.6207 × 17.3213 = 1812.1665`; la diferencia es el redondeo del log).
  - **Cuidado al comparar precios: la función se queda con la venta MÁS NUEVA** de cada artículo (`08-netsuite.js:627-633`, sobreescribe cuando encuentra `FECHA DE ORDEN` mayor). Contrastar contra una fila cualquiera del arreglo da falsos negativos. `PP_fetchSalesPricesRestlet_` además mete **dos claves por fila** —la normalizada de `_ITEM_ID` y la de `PARTE`— con el mismo precio, así que `lastByItem` tiene casi el doble de entradas que artículos (`893 × 2 = 1786` de 1787 claves): no son 1787 ventas distintas.
  - **`FECHA DE ORDEN` llega como `AAAA-MM-DD hh:mm:ss`** (ej. `2025-12-24 01:28:28`), no en formato con AM/PM; `PP_parseRestletDate_` reconoce ese formato y también `DD/MM/AAAA hh:mm:ss`. Antes, una fecha en cualquiera de esos dos formatos caía en `new Date(texto)`, devolvía inválida y la fila se descartaba en silencio del precio.
  - **No acepta filtro de fechas**: `from/to`, `fechaDesde/fechaHasta`, `dateFrom/dateTo` y `startDate/endDate` devuelven las mismas filas con `error` vacío, o sea que el `1766` acepta e **ignora** cualquier filtro (no lo rechaza). La ventana de 6 meses tiene que seguir filtrándose en memoria.
- **Tiempos (RULE-REP-016):** `fetchNetSuiteWorkOrdersLite` mide 43–73 s porque `PP_fetchSalesPricesRestlet_` pagina el `1766` `REQ_FIFO` y filtra la ventana de 6 meses **en memoria**, no en la petición (el body solo manda `table`). Cada petición que sufra el límite de solicitudes añade hasta 17 s. El presupuesto del cliente es 180 s por intento (`NETSUITE_BACKLOG_SYNC_TIMEOUT_MS`) y el del puente 420 s para `fetchNetSuiteWorkOrdersLite`/`syncNetSuiteWorkOrdersLite`, que antes caían en el genérico de 120 s y cortaban antes que el cliente. Reducir más la duración real exige saber la fuente física de `REQ_FIFO`: si `SuiteQL` la puede consultar, el precio cabe en una consulta agregada por artículo (y de paso en el `2244`); si es una lista guardada sobre un tipo no soportado, no se puede, y el camino es cachear el resultado. Sonda `DIAG_precios1766` (Apps Script, 9 llamadas de solo lectura) para descubrirlo.
- **Cuota diaria de `urlfetch` (RULE-REP-017, verificada 2026-09-25):** la cuenta que corre la web app es de **consumidor**, así que tiene un tope de **20 000 `UrlFetch`/día** y se reinicia a medianoche hora del Pacífico. Agotada, *toda* llamada falla en la plataforma con `Service invoked too many times for one day: urlfetch` **sin llegar a NetSuite**, y `PP_netSuiteRestletRequest_` encima espera los reintentos de 2/5/10 s antes de propagar el error. Esto se<constató de forma directa: las 9 llamadas de `DIAG_precios1766` fallaron con ese mensaje. Con hasta 100 páginas del `1766` por sincronización y sincronización en cada carga, ~200 sincronizaciones agotaban el día. **Mitigación: el precio se cachea 1 h** (`PP_fetchSalesPricesRestletCached_`, clave `NS_SALES_PRICES_V1_<cuenta>_<ubicación>_<desde>_<hasta>` en `CacheService`, con lock, relectura dentro del lock, marcador de cooldown en Script Properties y fallos nunca cacheados), de modo que el `1766` se golpea 1 vez por hora y 0 en el resto. **La lista de OTs del `1764` NO se cachea**: de sus columnas salen el estatus y el centro de trabajo que detectan una OT cerrada y `fetchedAt`/`syncedAt` con el que `needsWorkOrderSyncBeforeSchedule` decide la frescura. Cachear el snapshot completo falsearía esas dos cosas. Escritor único del caché: `PP_fetchSalesPricesRestletCached_`; lectores: `PP_fetchNetSuiteWorkOrdersData_` y `PP_fetchNetSuitePlantData_`. Cualquier fallo de `CacheService`/`PropertiesService`/`LockService` degrada a "sin precio" con `warning` y no rompe la sincronización. La sonda `DIAG_precios1766` hace una llamada de guardia y para en seco si detecta la cuota agotada.
- El fallo de `PP_Inspection_restlet_` llega al cliente como `{ ok: false, error: 'NetSuite inspeccion: <status> <raw 300 chars>' }` (`PP_Inspection_result_` no lanza) y el puente lo **resuelve** sin rechazar. Desde 2026-09-25 (RULE-REP-015-A) `PP_Inspection_restlet_` escribe `console.error` con status/script/deploy/body/raw antes de lanzar, así que el detalle sí queda en el registro de ejecuciones de Apps Script, y el cliente lo registra en `inspectionWorkOrderFailures` + `console.warn` + un `showToast` agregado.

## SuiteQL

Endpoint: `https://{accountId}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`
(`POST`, body `{q: sql}`, header `Prefer: transient`, `limit=1000`).

1. **Catálogo maestro de operaciones** (`PP_fetchNetSuiteOperationCatalog_`):
   `manufacturingroutingstep` JOIN `manufacturingrouting` JOIN `entitygroup`, con
   `NVL(routing.isinactive,'F')='F'` y `NVL(center.isinactive,'F')='F'`. Excluye operaciones
   especiales `SUBCONTRATO/CROMADO/METOKOTE/MAKA/GALVANIZADO`. Caché en `CacheService`
   (`NS_OPERATION_CATALOG_V1_{accountId}_{locationId}`, TTL 3600 s) + cooldown 1 h.
2. **Ruta directa de OT** (`18-planning-work-order-service.js`):
   `manufacturingoperationtask WHERE workorder='...'` y lookup `transaction WHERE type='WorkOrd'
   AND tranid='...'`. Por operación se calcula `'Tiempo estimado (min)' = setuptime + runrate ×
   cantidad pendiente de la OT (`PP_pendingWorkOrderQuantity_` = Cantidad − Cantidad ensamblada)
   y cada fila lleva `'Cantidad a procesar' = cantidad pendiente`, con lo que
   `PP_mapNetSuiteOperation_` deriva `cantTotal`/`cantPendiente` igual a la cantidad pendiente,
   coherentes con `tiempoProd`.

## REST Record API v1

`https://{accountId}.suitetalk.api.netsuite.com/services/rest/record/v1/...`

- `workorder` (lista + detalle por `links.rel='self'`): usado por `TRABAJOS FINAL.js`.
- `workorder/{id}/billOfMaterialsRevision/component` y `inventoryItem/{itemId}`:
  usado por `MATERIALES FINAL.js`.

## Reglas de sincronización (backend)

- `onlyOpen: true` en los RESTlets; filtro de planta (`PP_buildPlantFilter_`/`PP_belongsToPlant_`).
- `PP_isSchedulable_` excluye estados que contienen `COMPLETE, COMPLETAD, CERRAD, CLOSED,
  CANCELAD, CANCELED, CANCELLED`.
- La ruta directa por OT (`getPlanningWorkOrderData` → `PP_fetchDirectWorkOrderOperations_`)
  distingue: sin filas en `manufacturingoperationtask` → "Ruta de manufactura vacia para la OT X";
  filas presentes pero todas con status terminal (filtradas por `PP_isSchedulable_` de `08-netsuite.js`)
  → "OT X completada: todas sus operaciones estan en estado terminal (...); no apta para programarse"
  (RULE-OT-034).
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
