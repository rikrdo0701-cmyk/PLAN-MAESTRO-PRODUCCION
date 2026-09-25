# Data relationships

Claves, joins, relaciones padre/hijo y mapeos entre sistemas (NetSuite ↔ Sheets ↔ Drive ↔
pipeline legacy). Cada relación lista las columnas/keys exactas verificadas contra el código.

---

## 1. Workbook principal — relaciones entre hojas

### 1.1 `CONFIG` (pares clave→valor)

- Clave: `KEY` (único). `VALUE` = JSON serializado.
- Sin joins; es el estado de sesión/última escritura del backend y del frontend.
- `workSchedule` y `dailyBreaks` son entradas JSON que definen las ventanas de trabajo diarias y
  las pausas intradía; las consume `PlannerCore.effectiveWindows` (`planner-core.js:1267-1279`).
  Ver RULE-CAL-001.
- `selectedOts` (y `lockedOts`) son la relación de pertenencia OT → borrador Planeado/Por planear
  y funcionan como lista materializada: cada OT de `selectedOts` debe existir en `ORDENES_TRABAJO`
  (y tener filas en `OPERACIONES`) y se escribe desde el cliente con
  `savePlanningStateOptimized`. No hay join en la hoja: la integridad la aplica
  `reconcileActiveWorkOrders` / `purgeClosedWorkOrderRetention` en el cliente y
  `PP_buildState_` al releer. Ver RULE-OT-005 y RULE-OT-047 (persistencia inmediata y única
  autoridad del servidor en cada recarga).

### 1.2 `OPERACIONES` — entidad central

Claves e joins:

| Columna | Relación con | Cardinalidad |
|---|---|---|
| `ID` | clave primaria del plan | 1 por operación |
| `OT` | `ORDENES_TRABAJO.OT` | N operaciones por 1 OT |
| `NUM` | `PLANES_HISTORICOS.NUM` / `BORRADOR_PLAN.NUM` | 1:1 (snapshot) |
| `CT` | `CAPACIDADES.KEY` (clave de capacidad) | N:1 |
| `OPERADOR` | `OPERADORES.OPERADOR` | N:1 |
| `MAQUINA` | `MAQUINAS.ID` | N:1 |
| `HERRAMENTAL` / `KIT_HERRAMENTAL` | `HERRAMENTALES.ID` | N:1 |
| `HERRAMENTAL_ORIGEN`/`KIT_ORIGEN`/`HERRAMENTAL_DESTINO`/`KIT_DESTINO` | `HERRAMENTALES.ID` | 1:1 (cambio) |
| `TIPO_SUBCONTRATO` + `DIAS_SUBCONTRATO` | `SUBCONTRATOS.PARTE` por `PARTE` | N:1 |

Reglas: las filas con `ESTATUS`/`planStatus` `COMPLETADA_PLAN` se excluyen de las instantáneas.
La operación no es material: es el plan derivado de la operación NetSuite vía `PP_mapOperation_`
(`PP_OPERATION_FIELDS`).

### 1.3 `CAPACIDADES` ↔ `MATRIZ` ↔ `OPERADORES`

- `CAPACIDADES.KEY` (único) es la llave de las capacidades/CTs. La clave de cambio de herramental
  es la constante `TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL`.
- `MATRIZ.CAPACIDAD_KEY` → `CAPACIDADES.KEY`; `MATRIZ.OPERADOR` → `OPERADORES.OPERADOR`.
- Cardinalidad: 1 capacidad ↔ N operadores habilitados (N filas en `MATRIZ`).
- `OPERADORES.OPERADOR` es clave única de recurso humano; categorías normalizadas
  (`ACABADOS`, `FUERA_DE_PLAN`, `TD`).

### 1.4 `ORDENES_TRABAJO` — raíz de OT

Claves: `ID` (local), `WO_INTERNAL_ID` (NetSuite internal id), `OT` (folio).

- `OT` → `OPERACIONES.OT`, `MATERIALES.OT`, `CONFIGURACION_OT.OT`, `ESTADOS_OPERACION_PLAN.OT`.
- `WO_INTERNAL_ID` → `MATERIALES.WO_INTERNAL_ID`.
- `ARTICULO` → `CONFIGURACION_ARTICULO.ARTICULO`; `ARTICULO` → `Tramos.Articulo` (inspección).
- Precios: `PRECIO_PROMEDIO_VENTA`/`PRECIO_ULTIMA_VENTA`/`PRECIO_DESDE`/`PRECIO_HASTA` provienen
  del Restlet 1766 `REQ_FIFO` (última venta y promedio ponderado 6m; ver §4.1).
- Estados terminales (`CERRADA, CERRADO, CLOSED, CANCELADA, CANCELADO`) no se restauran.

### 1.5 `CONFIGURACION_OT`

- `OT` → `ORDENES_TRABAJO.OT` (1:1 por OT).
- `MAQUINA` → `MAQUINAS.ID`; `HERRAMENTAL`/`HERRAMENTALES_EXTRA_JSON`/`KIT_HERRAMENTAL`/`KIT_PENDIENTE` → `HERRAMENTALES.ID`.
- `HERRAMENTAL` es el principal y `HERRAMENTALES_EXTRA_JSON` contiene los herramentales adicionales
  de la OT. Cada adicional se expande en una operación artificial de doblado con la misma OT,
  máquina, CT y tiempos del primer doblado; se agenda por capacidad normal de matriz.
- Edición en cliente: `applyMachineToJob`, `applyToolToJob`, `applyKitToJob`, `applySubcontractToJob`
  mutan la fila y marcan la clave en `state._locallyEditedOtConfigurations`; tras una recarga por
  conflicto (y también tras cualquier otra carga remota) esos campos locales se re-fusionan sobre
  la fila remota (RULE-GOV-013, RULE-OT-047). El motor lee la
  configuración efectiva persistida por OT antes de validar (`applyOtConfiguration`).
- `TIPO_SUBCONTRATO` + `DIAS_SUBCONTRATO` → `SUBCONTRATOS` (aplica a operaciones de doblado,
  CTs 5459/5527).

### 1.6 `CONFIGURACION_ARTICULO`

- `ARTICULO` → `ORDENES_TRABAJO.ARTICULO` (1:1 por artículo).
- `TIPO_OT` → `TIPOS_OT.ID` (`tipo-oem`, `tipo-especial`, `tipo-linea`).
- `PRECIO_MANUAL` override del precio de venta; si `ORDENES_TRABAJO` tiene
  `PRECIO_ULTIMA_VENTA` y `PRECIO_PROMEDIO_VENTA` en 0, `PRECIO_MANUAL` en 0
  y la operación de la OT no tiene `unitPrice`/`amount` ≥ $1, la preparación
  de la OT exige capturar un precio ≥ $1 en el modal
  (`needsManualPrice`, RULE-FIN-001); si la ops ya trae precio/monto ≥ $1 no se pide.

### 1.7 `MATERIALES`

- `OT`/`WO_INTERNAL_ID` → `ORDENES_TRABAJO` (N materiales por OT).
- `ENSAMBLE` (BOM ensamblada) + `COMPONENTE_ID`/`COMPONENTE` + `UNIDAD` + `REQUERIDO`/`EMITIDO`/
  `PENDIENTE`. `PENDIENTE = REQUERIDO - EMITIDO`.

### 1.8 `CALENDARIO`

- `MAQUINA` → `MAQUINAS.ID` (N eventos por máquina). Sin relación con `OPERADORES`
  (los bloqueos son por máquina/concepto).
- Mapeo al estado: `PP_readState_` → `PP_mapCalendar_` convierte cada fila en
  `calendarExceptions` (`{id, concept, machine, startDate, start, endDate, end, reason, active}`);
  el motor las resta de la ventana de trabajo del día en `effectiveWindows`
  (`planner-core.js:1280-1297`). Conceptos: `GENERAL`, `MAQUINA`, `ASUETO`, `VACACIONES` (y
  `OPERADOR`, solo filtrado por el motor). Ver RULE-CAL-001.
- Un evento sin `HORA_INICIO`/`HORA_FIN` cubre `00:00-24:00` (`planner-core.js:1294-1296`); esto
  permite que una operación iniciada cerca del cierre de la ventana se parta y continúe el
  siguiente día hábil a las 07:00 (RULE-CAL-002).

### 1.9 `SUBCONTRATOS` y `TIPOS_OT` (catálogos semilla)

- `SUBCONTRATOS`: `ID` (`sub-cromado`, `sub-metokote`, `sub-maka`), `PARTE` (prefijo de parte),
  `TIPO`, `DIAS_HABILES`. Se siembran por defecto en `PP_ensureWorkbook_`.
- `TIPOS_OT`: `ID` + `NOMBRE`. Se siembran por defecto.

### 1.10 `PLANES_HISTORICOS` y `BORRADOR_PLAN`

- `SNAPSHOT_ID` agrupa las filas de un plan publicado; `draft` = borrador actual
  (`BORRADOR_PLAN`).
- `NUM` → 1:1 con `OPERACIONES.NUM`; `OT` → `ORDENES_TRABAJO.OT`; `OP`/`MAQ_AREA` →
  `CAPACIDADES`; `OPERADOR` → `OPERADORES`.
- Ambos comparten los 30 headers (esquema de snapshot de plan).
- `PLAN_INICIO` guarda la fecha exacta `INICIO` del Gantt; la identidad semanal para listados,
  reportes y publicación se toma de `weekStart` en la metadata del payload y se normaliza al lunes.

### 1.11 `ESTADOS_OPERACION_PLAN`

- `KEY` único y estable = `OP|<OT>|<SECUENCIA>|<CT>` (CT vacío → `SIN_CT`); es la identidad de la
  operación para `COMPLETADA_PLAN` (RULE-OT-031). Claves legacy `OP|<id>` se migran a la clave
  canónica por coincidencia de id o identidad ot+secuencia+ct, y las huérfanas se podan al
  normalizar estado (`reconcileOperationPlanStatuses`, planning-workflow-core.js).
- `OPERATION_ID` → `OPERACIONES.ID` es informativo (no forma parte de la clave, el id es volátil
  entre reimports). `OT` + `SECUENCIA` + `CT` identifican la operación NetSuite origen; `TOOL_KEY_DESTINO` →
  `CAPACIDADES.KEY` (capacidad de cambio de herramental).
- `TIPO` default `OPERATION`, `ESTATUS_PLAN` default `PENDIENTE`.
- `FECHA_COMPLETADO`/`FECHA_REAPERTURA` registran el ciclo completo→reabrir.

### 1.12 `AUDITORIA`

- Sin joins; bitácora append-only (`FECHA, USUARIO, ACCION, REVISION, DETALLE`).

---

## 2. Workbook de inspección

- `Tramos.Articulo` → `ORDENES_TRABAJO.ARTICULO` (búsqueda de ruta/dibujo por artículo).
  Acepta alias (`Artículo`, `Material`, `Dibujo`, `URL_DIBUJO`, `ACTUALIZADO`; renombra `BF`).
- `HISTORIAL_IMPRESION_INSPEC`: `WO`/`ARTICULO` → `ORDENES_TRABAJO`; `SEMAFORO` y `ALERTAS`
  derivados del estado de la OT en el momento de imprimir.

---

## 3. Pipeline legacy (hojas de la raíz)

Mapeo maestro definido por `OT_RULES.md`: Control de trabajos → Trabajos programados →
Operaciones Programadas → Plan Maestro.

| Origen | Joins con | Columnas |
|---|---|---|
| `Control de trabajos` (fila 2) | `Trabajos programados` por `TRABAJO`↔`Folio de trabajo`; `Operaciones Programadas` por `TRABAJO`↔`Orden de trabajo` | 18 col |
| `Trabajos programados` | `Operaciones Programadas` por `Folio de trabajo (link)`↔`Orden de trabajo` | `ID Interno` |
| `Operaciones Programadas` | → `Plan Maestro` (WRITTER) | `ID (link)` como clave |
| `BALANCE DE CARGAS` | `OPERADOR`→capacidad; `ID CENTRO DE TRABAJO` puede ser lista separada por comas | — |
| `SUBCONTRATOS` (legacy) | por `PARTE`/`TIPO`/`DIAS` | `TIPO === 'NO APLICA'` se ignora |
| `Inventario Total` | `Artículo` ↔ `Control de trabajos.PARTE` | — |
| `Herramentales` (legacy) | `PARTE` | esquema por modelo |
| `Días festivos` | columna A = fecha ISO (sin headers) | scheduler |
| `Excepciones de dia` | `TIPO` (ESTANDAR/ESPECIAL), `FECHA` | precedencia festivo>especial>fin de semana>estándar |
| `Contenido` / `Costo de piezas` | `PARTE` ↔ `Control de trabajos.PARTE` | — |

---

## 4. NetSuite ↔ Sheets (backend `src/server`)

### 4.1 RESTlets (OAuth 1.0a, `locationId = 1`, `onlyOpen: true`)

| RESTlet | → Hoja/entidad | Mapeo clave |
|---|---|---|
| `1764` `WO_LISTA` | `ORDENES_TRABAJO` | `WO Folio` → `OT`; internal id → `WO_INTERNAL_ID`; `Artículo` → `ARTICULO` (sin `Item Internal ID` en headers → `itemId` catálogo vacío); quantities/dates/status/customer → resto de columnas |
| `1766` `REQ_FIFO` | `ORDENES_TRABAJO.PRECIO_ULTIMA_VENTA` + `PRECIO_PROMEDIO_VENTA` | `_ITEM_ID` **o `PARTE`** (no hay `_ITEM_NAME`) → OT por `itemId`/`Artículo`; `PRECIO BASE MNX`/`FECHA DE ORDEN`/`CANTIDAD ORDEN` → última venta y promedio 6m |
| `1762` operaciones | `OPERACIONES` | `ID (link)` → `ID`; `Orden de trabajo` → `OT`; secuencia/CT/times/resources → `SECUENCIA`, `CT`, `TIEMPO_*`, `OPERADOR`/`MAQUINA` |
| `1763` materiales | `MATERIALES` | assembly → `ENSAMBLE`; item → `COMPONENTE_ID`/`COMPONENTE`; quantity → `REQUERIDO`/`EMITIDO`/`PENDIENTE`; OT/WO → `OT`/`WO_INTERNAL_ID` |
| `2244` `WO_INSPECCION` (antes `2080`) | inspección | `WO Folio`/`tranid` → folio; `cantidad`/`cantidadEnsamblada`/`cantidadPendiente` → detalle de inspección |

La resolución de OT en NetSuite acepta los alias `WO Folio`, `Orden de trabajo`,
`workorder_tranid`, `tranid` (helpers `PP_pick_` en `08-netsuite.js`).

### 4.2 SuiteQL

| Consulta | → Destino | Nota |
|---|---|---|
| Catálogo maestro de operaciones (`manufacturingroutingstep` JOIN ruta/centro) | `CATALOGO_OPERACIONES` (KEY = `CT::OPERACION`) y se fusiona en `CAPACIDADES` | excluye SUBCONTRATO/CROMADO/METOKOTE/MAKA/GALVANIZADO; caché `NS_OPERATION_CATALOG_V1_...` |
| `manufacturingoperationtask WHERE workorder=...` + `transaction WHERE type='WorkOrd'` | ruta directa de OT (inspección/planning) | — |

### 4.3 REST Record API v1 (legacy `* FINAL.js`)

- `workorder` → `Trabajos programados`; `workorder/{id}/billOfMaterialsRevision/component` e
  `inventoryItem/{itemId}` → `Materiales programados`.

### 4.4 Reglas transversales

- `PP_buildPlantFilter_`/`PP_belongsToPlant_` filtran siempre por planta (`PP_PLANT_LOCATION_ID = 1`).
- `PP_assertNetSuiteRows_` aborta si NetSuite devuelve 0 filas (evita borrar catálogo).
- El catálogo nunca se reemplaza por una lista vacía (fallback defensivo).

---

## 5. Drive

- Carpeta de fotos (`PHOTO_FOLDER_ID`) ↔ `ORDENES_TRABAJO.FOTO_URL` (miniatura derivada del
  ID del archivo). Solo lectura; índice en `PP_loadPhotoCatalog_`.
