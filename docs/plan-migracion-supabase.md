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

#### 3.3.1 Tablas del plan que `schema-supabase.sql` todavía NO crea — pendiente de aprobar

Contraste hecho el **2026-09-28** con `scripts/supabase-read-test.mjs` (paso `plan.documento`, que
lee las dos fuentes y las compara). Esta sección del plan declara **22 tablas**;
`docs/schema-supabase.sql` crea **21**:

| Falta en el SQL | Origen | Qué guarda |
|---|---|---|
| `prepared_planning_by_ot` | `CONFIG.preparedPlanningByOt` | la preparación validada de cada OT (máquina, herramental, kit, tipo/días de subcontrato) antes de generar plan — ver RULE-OT-010 |

**No se agregó el `create table`.** Este plan dice arriba *"No se mueve nada hasta que se apruebe"*
y `schema-supabase.sql` es el artefacto de la **fase 1**; agregar la tabla es una decisión de la
persona, no de la sonda. Se deja anotado aquí para que la diferencia se vea antes de la migración y
no el día de ejecutarla, que es cuando ya cuesta caro.

**Y un segundo drift, del lado de la ingesta (2026-09-28), que tampoco se aplicó.** La sección 3.4
reescribió la ingesta a un RESTlet de NetSuite con 7 tablas, y `schema-supabase.sql` solo tiene 4 de
esas 7. El delta va en `docs/schema-supabase-sync-netsuite.sql` (propuesto): crea `items`,
`inventory` y `sales_orders`, y altera `materials` y `machines`:

| Drift | Por qué la ingesta lo necesita |
|---|---|
| falta la tabla `items` | la acciones `items` no tiene dónde escribir |
| falta la tabla `inventory` | ídem para `inventario` |
| falta la tabla `sales_orders` | ídem para `ordenes_venta` |
| `materials` no tiene `line_id` | es la **clave natural** de la fila: sin ella no hay `on_conflict` y el upsert degrada a borrar-y-reinsertar |
| `machines` no tiene `tipo` | **ya no se agrega** (RULE-SUP-010): `workcentertype` no existe en ninguna fuente (SuiteQL ni REST Record API, medido) y el usuario decidió que el dato no se necesita porque la máquina se captura en el plan; `centros` guarda solo `nombre` y `activa` |

Mientras ese SQL no se aplique, `accion: 'diagnostico'` del RESTlet responde `tablasFaltantes` con
`items`, `inventory` y `sales_orders`, y dice qué hacer. Ese es el mecanismo: el hueco se declara en
la respuesta en vez de asumirse.

Además, medido el mismo día y sin credenciales:

- **El proyecto existe y responde**, pero **no se pudo contar ninguna tabla real**: `/auth/v1/health`
  devolvió `401` sin `apikey` (respuesta normal de un Supabase sano) y los pasos de Data API
  quedaron *sin datos*, no *fallidos*. Ver `.project-memory/integrations.json` `INT-SUPABASE` y
  `.project-memory/data-sources.json` `SUPABASE-PLAN` (status `planned`: **sin tablas y sin datos**).
- **Los dos hosts no son intercambiables**: la Data API, el panel y `/auth` son
  `https://xtgtfjcwxcoxvixholpj.supabase.co` (**sin** prefijo `db.`), y el Postgres del 5432 es
  `db.xtgtfjcwxcoxvixholpj.supabase.co` (**con** prefijo), que además salió **IPv6-only** (DoH
  devuelve `NODATA` para el tipo A), o sea que no es alcanzable por IPv4 desde esta red.
- **No hay ninguna credencial en el repo**: ni contraseña de la base, ni clave `anon`, ni
  `service_role`. Para cerrar la comprobación de lectura de filas hace falta la clave `anon` y, para
  el paso directo a Postgres, además `SUPABASE_DB_PASSWORD` y el paquete `pg`.

### 3.4 La ingesta NetSuite → Supabase — **CAMBIO 2026-09-28: push desde NetSuite, no Apps Script**

La versión anterior de esta sección decía que la ingesta sería *un RESTlet de Apps Script corriendo en
horario*. **Eso cambió**: el push se hace **desde dentro de NetSuite**. La razón es que el trigger ya
existe y es el correcto — el propio guardado del registro — y ningun User Event de NetSuite puede
invocar a Apps Script de forma nativa sin una indirección (RESTlet → App Script → Supabase) que
devuelve el problema: una llamada extra en la transacción del usuario, y un punto más donde la ingesta
se puede caer sin que nadie se entere.

```
User Event (afterSubmit)  ──encola──►  Suitelet  ──URL interna──►  RESTlet  ──PostgREST──►  Supabase
   (6, uno por registro)              (encolado,               (lee NetSuite         (upsert por
                                       corre aparte)            por SuiteQL)          clave natural)
                                       
Script programado  ──encola──►  Suitelet  (barrido: inventario + reconciliación)
```

Piezas, todas en la raíz del repo:

| Archivo | Tipo | Qué hace |
|---|---|---|
| `netsuite-user-event-workorder.js` | UserEvent `workorder` | encola `workorders` + `operaciones` + `materiales` (son tres registros distintos) |
| `netsuite-user-event-operacion.js` | UserEvent `manufacturingoperationtask` | encola `operaciones` |
| `netsuite-user-event-item.js` | UserEvent `item` | encola `items` |
| `netsuite-user-event-workcenter.js` | UserEvent `workcenter` (los centros son registros de tipo `workcenter`, respaldados por `entitygroup`) | encola `centros` |
| `netsuite-user-event-salesorder.js` | UserEvent `salesorder` | encola `ordenes_venta` |
| `netsuite-suitelet-sync-tarea.js` | Suitelet | despacha al RESTlet por URL interna; no reintenta solo |
| `netsuite-restlet-supabase-sync.js` | Restlet | **el único escritor** de las 7 tablas; lee por SuiteQL, hace upsert |
| `netsuite-scheduled-sincronizacion.js` | ScheduledScript | barrido: `inventario` (sin User Event posible) + reconciliación |

El User Event de `workorder` **no** dispara la ingesta de operaciones ni de materiales: esos son otros
registros (`manufacturingoperationtask`, `transactionline`). Por eso hay seis User Events y no uno.

**Lo que NO cambió:** Apps Script sigue siendo la única capa con el OAuth de NetSuite, y por eso sigue
siendo quien responde a la web cuando la escritura necesita ir a NetSuite. El cambio es de dirección:
antes los datos salían de NetSuite por askew hacia Apps Script; ahora NetSuite empuja. El **estado
vive en Supabase** en los dos casos. Contrato completo en
`docs/integrations/netsuite-supabase-sync.md`.

**Delta de esquema APLICADO el 2026-09-28** en el proyecto `xtgtfjcwxcoxvixholpj`:
`docs/schema-supabase-sync-netsuite.sql` (crea `items`, `inventory`, `sales_orders`; agrega
`materials.line_id` con su UNIQUE; **no agrega `machines.tipo`**, revocado por RULE-SUP-010).
Verificado después de aplicar: las 3 tablas existen, `materials.line_id` existe y
`materials_line_id_key` (UNIQUE) existe.

### 3.5 Concurrencia

Una columna `revision` por fila (o por tabla). Cada escritura hace `update ... where revision = ?`
y espera `revision + 1`. Si no, rechaza. Es el equivalente de `CONFLICT_REVISION` en Postgres.

## 4. Fases

1. **Esquema** en Supabase (tablas, ids, índices, RLS si hace falta). Sin tocar la app.
2. **Migración de datos** (una vez, de Hojas a Supabase). Verificación fila por fila.
3. **Lectura**: la web lee los catálogos/operaciones de Supabase. Escritores siguen en Hojas.
   *(Iniciada el 2026-09-29: existe `src/web/shared/supabase-reader.js` + sonda; ver §4.1.)*
4. **Escritura**: los escritores pasan a Supabase. Hojas pasa a historial.
5. **Ingesta NetSuite** → Supabase en horario. Se retira el puente de lectura.
6. **Fuera** el puBridge de lectura (queda solo para escrituras que necesitan NetSuite).

Cada fase se verifica con las sondas que ya existen (`web-probe.mjs`, `web-probe-generar-plan.mjs`).

Las fases que tocan Supabase agregan **`scripts/supabase-read-test.mjs`** (`npm run
probe:lectura:supabase`), que es de **solo lectura** y no escribe nada: `--list` imprime qué tablas
expone la Data API y cuáles del esquema faltan, y `--table=<tabla>` lee filas reales con conteo
exacto, columnas y muestra. La comparación de esquema (`plan.esquema`) no depende de la credencial:
siempre contrasta lo expuesto contra `docs/schema-supabase.sql`, de modo que sirve para las fases 1
a 3; la lectura de filas necesita la clave `anon`. Es la sonda del `RULE-TST-002`.

### 4.1 Fase 3 — estado al 2026-09-29 (iniciada)

El **primer cambio de fuente** de la fase 3 ya está en el repo: `src/web/shared/supabase-reader.js`,
un lector de **solo lectura** que trae filas de Supabase por PostgREST con la clave **publicable**
(cliente) y las mapea al MISMO shape que arma `PP_buildState_` (`src/server/02-storage.js`).

- **Va apagado por defecto.** La URL y la clave se inyectan en el build desde `SUPABASE_URL` /
  `SUPABASE_ANON_KEY` (nunca del repo). Sin ellas, `isConfigured()` es `false` y **nada** del lector
  toca el arranque: la página sigue por el puente de Apps Script. Estar fuera de la ruta de arranque
  es deliberado: primero se prueba, después se engancha.
- **No infiere.** Los campos del state que la tabla de hoy NO puede llenar están declarados en
  `MAPPING_GAPS` (`capabilities.operationRules.overlap` por ser booleano en Supabase y numérico en la
  hoja, `capabilities` sin `PALABRAS_CLAVE`/`CUSTOM`, `tools.id` textual vs uuid, `KIT_HERRAMENTAL` vs
  `kit`, `calendar_exceptions` sin hora inicio/fin, `article_configurations.PRECIO_REF_VENTA`,
  `work_orders.FECHA_ENTREGA_AJUSTADA`/`PRECIO_DESDE`/`PRECIO_HASTA` y los campos faltantes de
  `operations`).
- **Sonda:** `npm run probe:lectura:frontend` (`scripts/supabase-reader-verify.mjs`) ejecuta el MISMO
  código que se sirve en Pages contra el Supabase real. Medido el 2026-09-29: 24 tablas, 208
  `work_orders`, 2119 `operations`, 327 `materials`, 202 `machines`, 86 `operation_catalog`, 78 CTs.
- **Decisión tomada (2026-09-29): "la información de restlet desde Apps Script y lectura y escritura
  desde Supabase".** Se **midió** antes de escribir código, porque la decisión define si hace falta
  login: el rol `anon` **no puede escribir** en ninguna de las 24 tablas (`POST /rest/v1/tools` →
  `401 {"code":"42501","message":"new row violates row-level security policy for table \"tools\""}`,
  `.openchamber/diag-supabase-escritura.mjs`). Las 24 tienen RLS con **solo** la política `lectura_web`
  de SELECT, y es a propósito (`docs/schema-supabase-sync-netsuite.sql:198-200`: *"NADIE escribe desde
  la web… si la web pudiera escribir, podría pisar el plan"*), porque la clave publicable viaja
  dentro del bundle público de Pages. Por tanto **no hace falta Supabase Auth**: la página **lee** con
  la publicable y **Apps Script escribe** con la service role key (`sb_secret_…`, nunca en el repo).
  Dos escritores, con **uno solo por tabla** (RULE-SUP-015).
- **Espejo de catálogos implementado** (`src/server/16-supabase-catalogo.js`). Apps Script
  convierte las 10 tablas de catálogo de las Hojas a Supabase por el mismo RPC atómico
  `public.ingesta_mirror`, enganchado a los **tres** caminos de guardado (`PP_finishPartialWrite_`
  para catálogos y matriz, `PP_writeNetSuiteSyncState_` y `PP_writeState_`). Cada guardado paga solo
  las tablas que tocó, el espejo entero tiene un presupuesto de 20 s, y va **después** de
  `SpreadsheetApp.flush()` y dentro de `try/catch`: **un Supabase caído no puede impedir guardar el
  plan**, solo se pierde la frescura, que el siguiente guardado reintenta. Sin credencial el espejo no
  hace nada.
  - **Excluye `machines` a propósito**: la escribe el RESTlet 2246 (entitygroup que es centro de
    trabajo, RULE-SUP-010) y la hoja `MAQUINAS` guarda lo mismo; espejarla serían dos escritores
    peleándose la tabla cada 15 minutos.
  - **Lo que esa exclusión produce, medido el 2026-09-29 (corregido: aquí se había escrito que
    "desactivar una máquina no llega a Supabase", y era impreciso).** `machines.activa` **sí viene de
    NetSuite** (`netsuite-restlet-unificado-supabase.js:287`, `entitygroup.isinactive`) y hay **202
    máquinas, 0 inactivas**. La app **no puede** desactivar una máquina: el único control es
    *"Eliminar máquina"* (`app.js:5443-5454`), que quita la fila; no hay toggle como sí lo hay para
    `ot_types` (`app.js:5555`). Los dos conceptos están separados: *"NetSuite dice que está inactivo"*
    es del ERP y lo trae el RESTlet; *"aquí no quiero agendar"* es decisión de la app y hoy se
    expresa **borrando la fila**, no bajando un flag. **El conflicto real es el borrado**: si
    `machines` se espejara desde Apps Script, cada borrado del catálogo lo desharía el mirror del
    RESTlet en menos de 15 minutos. Ésa es la razón de excluirla, no una regla inventada.
  - **Consecuencia en el cutover, abierta para decidir:** hoy "retirar una máquina del catálogo" se
    respeta (vive en la hoja). Cuando la página lea las máquinas de Supabase **dejará de respetarse**,
    porque manda NetSuite y no habrá forma de apartar una máquina de la planificación. Caminos:
    (a) aceptar y documentarlo — hoy no cuesta nada porque hay 0 inactivas y la UI no produce el
    flag; (b) `machines.activa_override` nullable, que el frontend aplique al leer ("NetSuite manda
    salvo que alguien lo anule") — es la que resuelve el caso real; (c) no cambiar la fuente de
    `machines` en el cutover. (b) implica decidir si la planificación puede contradecir a NetSuite, y
    eso no se inventa.
- **Requisito previo, sin aplicar: `docs/schema-supabase-cierre-catalogos.sql`.** Medido contra el
  esquema **desplegado**, el de los catálogos **no puede representar lo que las Hojas guardan**
  (RULE-SUP-016): falta `operators.nombre_real`, `capabilities.palabras_clave`, `capabilities.custom`,
  el **factor** de `capabilities.solapamiento` (la hoja lo guarda como ratio 0..1 y en la tabla
  quedó `boolean`), `tools.codigo`, `subcontracts.codigo`, la ventana de `calendar_exceptions` y
  `article_configurations.precio_ref_venta`. El archivo corrige eso y mete las 10 tablas en la
  whitelist de `ingesta_mirror` **sin abrir escritura a `anon`** (el RPC sigue siendo
  `SECURITY INVOKER` y revocado a `PUBLIC`). Está escrito y verificado, pero **sin aplicar**: falta
  `SUPABASE_DB_PASSWORD`. Al revés, el espejo falla a propósito (columna desconocida / tabla no
  permitida) y queda registrado en `AUDITORIA`.
- **Verificación sin escribir nada.** `.openchamber/diag-catalogo-payload.mjs` compara las columnas
  que emite el mapeador contra el esquema real (leído por la Data API) más las del DDL de cierre:
  **10/10 tablas OK**. Esa sonda **encontró un bug real** —el mapeador leía `TIPO_TRABJO` en vez de
  `TIPO_TRABAJO` y el campo salía vacío **sin dar error**—, y `tests/supabase-catalogo-mapping.test.mjs`
  lo vuelve a cazar (se comprobó mutando el typo a propósito: el test falla nombrando la columna).
- **Lo que falta para enganchar el lector al arranque**, en orden:
  1. aplicar `docs/schema-supabase-cierre-catalogos.sql` (necesita `SUPABASE_DB_PASSWORD`),
  2. desplegar el archivo nuevo de servidor en Apps Script (25 archivos; el build lo agrega solo),
  3. confirmar que los catálogos de Supabase se refrescan al guardar,
  4. recién entonces cambiar la fuente de los catálogos en la página.
- **Tablas vacías** (cola/estado/plan: `app_state`, `selected_ots`, `locked_ots`,
  `operation_plan_statuses`, `plan_snapshots`, `closed_work_order_summaries`,
  `unconfirmed_work_orders`, `tools`, `subcontracts`, `calendar_exceptions`): siguen viniendo del
  puente; su migración es la fase 2/4, no la 3.
- **Pendiente de despliegue (solo el usuario).** El RESTlet 2246 desplegado en NetSuite **aún no trae**
  el filtro `ail.location = 1` de `RULE-SUP-013`: `inventory` sigue en **2401** filas cuando el SQL
  filtrado da ~1933. Hay que pegar `netsuite-restlet-unificado-supabase.js` en NetSuite. Igual, el
  `.gs` de Apps Script desplegado aún no coincide con el local (falta el guard de horario).

## 5. Riesgos

- **La concurrencia**: hay que recrear `CONFLICT_REVISION` en Supabase o dos sesiones se pisarán.
- **La cola con orden**: `selected_ots` necesita una columna de posición o el orden manual se pierde.
- **La migración**: 138 715 filas de PLANES_HISTORICOS + el estado completo. Se hace una vez y se verifica.
- **La ingesta**: si el sync falla, la web lee datos viejos de Supabase. Hay que avisar, no esconder.
- **El OAuth de NetSuite sigue en Apps Script**: Supabase no puede llamar a NetSuite directamente. La
  lectura de NetSuite que necesita la web sigue pasando por Apps Script; la escritura desde NetSuite a
  Supabase es el sentido inverso y no usa OAuth (§3.4).
- **El modo `comparar` es una llamada por fila.** Con el gobierno de 10,000 llamadas externas/día por
  cliente, un barrido grande no puede ir en `comparar`. Por eso `MAX_FILAS_COMPARAR = 60` y pasado ese
  tope el RESTlet degrada a `upsert` (una llamada por lote) **y lo declara** en `degradaciones`. Un
  `POST` con `Prefer: resolution=merge-duplicates` es last-write-wins: sin guarda de `revision`. Es una
  degradación consciente, no un default.
- **La service role key sale de un script parameter de NetSuite**, nunca del repo. Si ese deployment
  queda *Available Externally*, la clave queda expuesta por una URL. Por eso el RESTlet se invoca por
  URL interna desde el Suitelet (RULE-SUP-005).
