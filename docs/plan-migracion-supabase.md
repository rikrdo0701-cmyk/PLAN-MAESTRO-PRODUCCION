# Plan de migración a Supabase — Plan Maestro de Producción

**Fecha:** 2026-09-27
**Estado:** PLAN. No se mueve nada hasta que se apruebe.
**Alcance:** catálogos + operaciones/OTs/estados + la ingesta de NetSuite, para que la web lea
directo de Supabase y no haya que sincronizar en cada carga.

---

## 0. Qué NO cambia

- **RULE-OT-051** (las tres capas del cierre): la lógica vive en `reconcileActiveWorkOrders` y
  `PP_applyNetSuiteWorkOrdersData_`. La migración la **traslada**, no la reescribe.
- **RULE-PLAN-013** (el plan no vive en localStorage; el snapshot `draft` es su autoridad): el
  snapshot `draft` sigue siendo la fuente del plan, ahora como fila en Supabase.
- **RULE-OT-053** (la cola no se pierde por ausencia) y **RULE-OT-047** (`selectedOts` es la
  autoridad de la cola y persiste).
- La concurrencia optimista: se **recrea** en Supabase, no se elimina.

## 1. Estado actual (fuente: `.project-memory/data-sources.json`)

Todo está en **un solo workbook** (`PLANNING_SPREADSHEET_ID`), 19 hojas, más 5 RESTlets de
NetSuite y Drive. Las lecturas calientes pasan por `PP_buildState_`, que las lee **todas** en cada
`getAppState`.

| Hoja | Papel | ¿Lectura caliente? |
|---|---|---|
| CONFIG | revisión, savedAt, syncedAt, selectedOts, lockedOts, expandedOts, planStart, horizonDays, reportWeekStart, reportFilters, preparedPlanningByOt, closedWorkOrderSummaries, unconfirmedWorkOrders, settings, lastSchedule, plant, operationCatalogWarning | **Sí** (cada getAppState) |
| OPERACIONES | 37 columnas por operación | **Sí** |
| ESTADOS_OPERACION_PLAN | 22 columnas, la clave de completado | **Sí** |
| ORDENES_TRABAJO | 19 columnas, las fichas | **Sí** |
| MATERIALES | 13 columnas | **Sí** |
| OPERADORES | 6 columnas | Sí |
| CAPACIDADES | 10 columnas | Sí |
| CATALOGO_OPERACIONES | 5 columnas | Sí |
| MAQUINAS, HERRAMENTALES, SUBCONTRATOS, TIPOS_OT, CALENDARIO | catálogos | Sí |
| CONFIGURACION_OT, CONFIGURACION_ARTICULO, MATRIZ | configuración | Sí |
| AUDITORIA, PLANES_HISTORICOS, BORRADOR_PLAN | historial | No (cola diferida) |

El cuello de botella: `getAppState` las lee **todas**, y el reconstruido frío pasa de 120 s
(RULE-PERF-014). Por eso migrar a Supabase sí ataca el dolor.

## 2. Objetivo

1. **ID único por registro** en cada catálogo (petición explícita de la persona).
2. **NetSuite como fuente** ingesta a Supabase, para que la web **no sincronice en cada carga**.
3. Lecturas rápidas: la web lee Supabase directo (PostgREST), sin puente ni reconstruido frío.
4. Una sola fuente de verdad para los datos que hoy viven en Hojas.

## 3. Estructura objetivo en Supabase

### 3.1 Catálogos (ID único, lectura caliente)

| Tabla | Hoja origen | ID único | Clave natural |
|---|---|---|---|
| `operators` | OPERADORES | `id` uuid | OPERADOR |
| `capabilities` | CAPACIDADES | `id` uuid | KEY |
| `operation_catalog` | CATALOGO_OPERACIONES | `id` uuid | KEY |
| `machines` | MAQUINAS | `id` uuid | nombre |
| `tools` | HERRAMENTALES | `id` uuid | (parte, herramental) |
| `subcontracts` | SUBCONTRATOS | `id` uuid | (parte, tipo) |
| `ot_types` | TIPOS_OT | `id` uuid | nombre |
| `calendar_exceptions` | CALENDARIO | `id` uuid | (fecha, concepto, máquina) |
| `ot_configurations` | CONFIGURACION_OT | `id` uuid | OT |
| `article_configurations` | CONFIGURACION_ARTICULO | `id` uuid | ARTICULO |
| `matrix` | MATRIZ | `id` uuid | (CAPACIDAD_KEY, OPERADOR) |

### 3.2 Datos operativos

| Tabla | Hoja origen | ID único |
|---|---|---|
| `work_orders` | ORDENES_TRABAJO | uuid (o el folio) |
| `operations` | OPERACIONES | uuid (ya trae `ns-<id>`) |
| `operation_plan_statuses` | ESTADOS_OPERACION_PLAN | uuid |
| `materials` | MATERIALES | uuid |

### 3.3 Estado y cola

| Tabla | Origen | Notas |
|---|---|---|
| `app_state` (una fila) | CONFIG | revisión, savedAt, syncedAt, planStart, horizonDays, reportWeekStart, reportFilters, settings, plant, operationCatalogWarning, lastSchedule |
| `selected_ots` | CONFIG.selectedOts | **la cola**, con posición (order) para el orden manual |
| `locked_ots` | CONFIG.lockedOts | |
| `closed_work_order_summaries` | CONFIG.closedWorkOrderSummaries | |
| `unconfirmed_work_orders` | CONFIG.unconfirmedWorkOrders | |
| `prepared_planning_by_ot` | CONFIG.preparedPlanningByOt | |
| `plan_snapshots` | PLANES_HISTORICOS + BORRADOR_PLAN | snapshotId + operations (jsonb) |

### 3.4 La ingesta NetSuite → Supabase

Un RESTlet de Apps Script (el 1764 ya existe; se añade un endpoint de catálogos) corre **en horario**
(fuerte: un trigger programado) y escribe en Supabase por su REST API con la service key:

```
NetSuite RESTlets ──► Apps Script (OAuth ya está) ──► Supabase REST ──► tablas
```

La web lee Supabase directo. Para las escrituras que necesitan NetSuite, la web llama a Apps Script
(que sigue siendo la única capa con el OAuth), pero **el estado vive en Supabase**.

### 3.5 Concurrencia

Una columna `revision` por fila (o por tabla). Cada escritura hace `update ... where revision = ?`
y espera `revision + 1`. Si no, rechaza. Es el equivalente de `CONFLICT_REVISION` en Postgres.

## 4. Fases

1. **Esquema** en Supabase (tablas, ids, índices, RLS si hace falta). Sin tocar la app.
2. **Migración de datos** (una vez, de Hojas a Supabase). Verificación fila por fila.
3. **Lectura**: la web lee los catálogos/operaciones de Supabase. Escritores siguen en Hojas.
4. **Escritura**: los escritores pasan a Supabase. Hojas pasa a historial.
5. **Ingesta NetSuite** → Supabase en horario. Se retira el puente de lectura.
6. **Fuera** el puBridge de lectura (queda solo para escrituras que necesitan NetSuite).

Cada fase se verifica con las sondas que ya existen (`web-probe.mjs`, `web-probe-generar-plan.mjs`).

## 5. Riesgos

- **La concurrencia**: hay que recrear `CONFLICT_REVISION` en Supabase o dos sesiones se pisarán.
- **La cola con orden**: `selected_ots` necesita una columna de posición o el orden manual se pierde.
- **La migración**: 138 715 filas de PLANES_HISTORICOS + el estado completo. Se hace una vez y se verifica.
- **La ingesta**: si el sync falla, la web lee datos viejos de Supabase. Hay que avisar, no esconder.
- **El OAuth de NetSuite sigue en Apps Script**: Supabase no puede llamar a NetSuite directamente. La
  ingesta pasa por Apps Script.
