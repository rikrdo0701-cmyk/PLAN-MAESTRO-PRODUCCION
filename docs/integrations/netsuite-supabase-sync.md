# Ingesta NetSuite → Supabase (push desde NetSuite)

**Estado:** código escrito y probado (23 pruebas). **El esquema de destino NO está aplicado**
(`docs/schema-supabase-sync-netsuite.sql` es propuesta). **Los deployments de NetSuite no existen
todavía**: los archivos del repo son el fuente, subirlos es manual.

- Writer único de las 7 tablas: `netsuite-restlet-supabase-sync.js`.
- Reglas: `RULE-SUP-001` a `RULE-SUP-007` en `.project-memory/rules.json`.
- Plan: `docs/plan-migracion-supabase.md` §3.4.

---

## 1. Por qué push desde NetSuite y no Apps Script

La versión anterior del plan (§3.4, 2026-09-27) decía: *un RESTlet de Apps Script corre en horario
y empuja a Supabase*. Cambió el 2026-09-28 por dos razones concretas:

1. **El trigger correcto ya existe y es el evento.** El dato cambia cuando alguien guarda el registro
   en NetSuite. Un barrido en horario empuja datos viejos por definición: entre que NetSuite cambió y
   que corrió el barrido, Supabase miente. El User Event empuja en el momento.
2. **Un User Event no puede llamar a Apps Script de forma nativa.** Haría falta
   `User Event → RESTlet → App Script → Supabase`: una llamada extra dentro de la transacción del
   usuario, y un eslabón más donde la ingesta se rompe sin que nadie lo note.

Lo que **no** cambió: Apps Script sigue siendo la única capa con el OAuth de NetSuite, y por eso sigue
respondiendo a la web cuando una escritura necesita ir a NetSuite. Solo cambió la dirección del push.

## 2. Las piezas y por qué son ocho

```
User Event (afterSubmit)  ──task.enqueue──►  Suitelet  ──URL interna──►  RESTlet  ──PostgREST──►  Supabase
      6 archivos                        1 archivo                  1 archivo        (upsert)
                                                   ▲
Script programado (barrido) ──task.enqueue────────┘
```

| Archivo | Tipo | Dispara |
|---|---|---|
| `netsuite-user-event-workorder.js` | UserEvent `workorder` | `workorders`, `operaciones`, `materiales` |
| `netsuite-user-event-operacion.js` | UserEvent `manufacturingoperationtask` | `operaciones` |
| `netsuite-user-event-item.js` | UserEvent `item` | `items` |
| `netsuite-user-event-workcenter.js` | UserEvent `workcenter` (los centros son registros de tipo `workcenter`, respaldados por `entitygroup`) | `centros` |
| `netsuite-user-event-salesorder.js` | UserEvent `salesorder` | `ordenes_venta` |
| `netsuite-suitelet-sync-tarea.js` | Suitelet | despacho al RESTlet |
| `netsuite-restlet-supabase-sync.js` | Restlet | lectura SuiteQL + escritura |
| `netsuite-scheduled-sincronizacion.js` | ScheduledScript | barrido |

**Seis User Events y no uno** porque los datos viven en registros distintos. El User Event de
`workorder` no dispara la ingesta de operaciones: las operaciones son filas de
`manufacturingoperationtask`, otro tipo de registro, y un `afterSubmit` de workorder nunca las ve.

**Un Suitelet y no la llamada directa** porque el `afterSubmit` corre *dentro* de la transacción del
usuario. Si el push a Supabase fuera ahí, cada guardado pagaría un viaje de ida y vuelta y, si
Supabase se cayera, el guardado de NetSuite se vería afectado. Encolando una tarea, NetSuite guarda
igual y la ingesta corre aparte (RULE-SUP-003).

**Un script programado y no solo User Events** por dos huecos que los eventos no cubren:

- **`inventario` no tiene User Event posible.** `aggregateitemlocation` es un agregado que se recalcula
  con cada movimiento: no existe un registro que alguien "guarde", así que no hay momento del que
  colgar un `afterSubmit`. El barrido es su único disparador (RULE-SUP-006).
- **Un User Event se puede perder.** Una tarea encolada que no corre, un deployment mal puesto, una
  ingesta que falló con Supabase caído. El barrido relee todo y vuelve a escribir solo lo que difiere,
  así que la diferencia se cierra sola.

## 3. Script parameters

| Deployment | Parámetros |
|---|---|
| RESTlet | `SUPABASE_URL`, `SUPABASE_KEY`, `UBICACION` (default 1) |
| Suitelet | `RESTLET_SCRIPT_ID`, `RESTLET_DEPLOY_ID` |
| Cada User Event | `SCRIPT_ID_TAREA`, `DEPLOY_ID_TAREA`, `ACTIVO` |
| Script programado | `SCRIPT_ID_TAREA`, `DEPLOY_ID_TAREA`, `ACCIONES`, `DRY_RUN` |

`ACTIVO` con un valor distinto de `S'` apaga la ingesta **sin redesplegar los User Events**.

**La `service_role` key no está en el repo** y no debe estarlo. Vive en el script parameter
`SUPABASE_KEY` del deployment del RESTlet. El `diagnostico` la filtra explícitamente de su respuesta y
hay una prueba que lo verifica.

## 4. Contrato del RESTlet

```
POST { accion, ids: {workorderIds, itemIds, salesOrderIds, workcenterIds}, folios: [],
       ubicacion, lote, modo, soloAbiertos, dryRun }
```

| `accion` | Tabla | Clave natural | Origen SuiteQL |
|---|---|---|---|
| `workorders` | `work_orders` | `ot` | `transaction` + `transactionline` mainline |
| `operaciones` | `operations` | `operation_id` = `ns-<mot.id>` | `manufacturingoperationtask` |
| `materiales` | `materials` | `line_id` = `comp.id` | `transaction` + `transactionline` no-mainline |
| `items` | `items` | `codigo` | `item` |
| `centros` | `machines` | `nombre` | `entitygroup` (`ismanufacturingworkcenter='T'`) |
| `inventario` | `inventory` | (item, ubicación) | `aggregateitemlocation` |
| `ordenes_venta` | `sales_orders` | `folio` | `transaction` type `SalesOrd` |
| `todas` | las 7 | | |
| `diagnostico` | ninguna | | no escribe nada |

Respuesta: `{ ok, accion, tabla, modoUsado, leidas, escritas, omitidas, conflictos[], batches,
truncado, avisos[], degradaciones[] }`.

## 5. Modo de escritura: MIRROR EXACTO (borrar + reescribir)

Desde el 2026-09-29 la ingesta no hace upsert incremental: **borra cada tabla completa y
reescribe lo que NetSuite devuelve en esa corrida** (decisión del usuario: "que no se queden
datos antiguos"). Las 7 tablas quedan como espejo exacto de las filas abiertas del ERP.

El flujo corre en Google Apps Script (`appscript-ingesta-supabase.gs`, función `ingesta`):
1. Una sola llamada al RESTlet unificado **2246** con `accion: 'todas'` (solo lectura).
2. Por cada tabla: `DELETE ... WHERE id=neq.<uuid-vacio>` (borra todo; es el único writer,
   la service role key de `supabase-config.gs`) y luego `POST` con `on_conflict=<clave>`.

Claves naturales (`on_conflict`):
- `work_orders` → `ot`
- `operations` → `operation_id` (`ns-<mot.id>`)
- `materials` → `ot,line_id` (UNIQUE compuesto; `comp.id` es el número de línea *dentro* de
  la OT y se repite entre OTs, medido el 2026-09-29)
- `items` → `codigo`
- `machines` → `nombre`
- `inventory` → `item,ubicacion`
- `sales_orders` → `folio`

Sin guarda de `revision` ni modo `comparar`: el mirror semanal/quincenal convive con la
concurrencia optimista de `app_state`/`plan_snapshots` (que son tablas de estado, no de
ingesta), sin pisarse.

**`dryRun` corre sin credenciales** y devuelve `clavesQueSeEscribirian` y `filasQueSeEscribirian`.
Es la forma de verificar el mapeo contra el esquema antes de escribir: si aparece una columna que no
está en `docs/schema-supabase.sql`, ahí se ve, y no con un 400 de PostgREST en producción.

**Sin credenciales se corta antes de tocar Supabase**, con un error accionable y **una sola vez**. Si
no, cada lectura previa y cada escritura devolverían el mismo error y el reporte terminaría con N
conflictos que parecerían choques de `revision`.

## 6. Restricciones medidas de esta cuenta NetSuite

No son preferencias; son lo que se midió contra este ERP:

| Restricción | Evidencia |
|---|---|
| Las fechas de SuiteQL son **`dd/MM/aaaa` sin hora ni zona**, en las 6 columnas de fecha de los 7 lectores (`transaction.startdate`, `transaction.enddate`, `transaction.trandate`, `mot.startdatetime`, `mot.enddate`, `item.lastmodifieddate`) | medido el 2026-09-28. Se arman a mano en `isoFechaNetsuite`: `new Date("25/09/2026")` es *Invalid Date* (el texto crudo se iba a un `timestamptz` y PostgREST respondía 400), y `new Date("03/04/2026")` se lee como **mes/día** y guardaba 3 de abril como 4 de marzo, sin ningún error |
| La cantidad ensamblada **no existe en SuiteQL**: `transaction.built`, `transaction.quantitybuilt` y `transaction.quantityremaining` dan "Unknown identifier" (400), igual que `unbuilt`, `quantity`, `origquantity` y `approveddate` (500) | medido el 2026-09-28. Sale del **record** (`record:built`), que es la misma fuente que usa el 2244 y de la que sale la `cantidadEnsamblada` que la app ya muestra |
| `MAX(mot.completedquantity)` **puede exceder la cantidad de la OT** | folio 2204: cantidad 3000, `MAX(mot)` 4200, `record:built` 4200; folio 3172: 1500 contra 3169. La operación y la OT no se miden en la misma unidad, así que el respaldo se acota a `cantidad` y se declara en `notas.ensamblada` |
| `transaction.approveddate` **no existe** (500) y `itemlocation` **no es una tabla** de SuiteQL ("Tipo de búsqueda no válida") | medido el 2026-09-28. El inventario se lee del agregado `aggregateitemlocation` |
| El endpoint SuiteQL v1 por REST **no acepta parámetros** (`p` da "Invalid content in the request body" con arreglo, con objeto y con marcador `:nombre`) | medido el 2026-09-28. Da igual: dentro de NetSuite se usa `query.runSuiteQL({query, params})`, que **sí** acepta `?` posicional (probado en el 2244 desplegado) |
| `FETCH NEXT` y `OFFSET`: la cuenta **sí** los acepta, pero **en el orden `ORDER BY ... OFFSET n ROWS FETCH NEXT m ROWS ONLY`**; en el orden inverso dan 400, y `OFFSET` sin `ORDER BY` se ignora | medido el 2026-09-28. El 400 del 2026-09-26 08:00 fue por el **orden**, no por la cláusula (RULE-REP-016-A). Aun así aquí **no se usa ninguna**: la paginación es recorte en memoria con topes por tabla, que es lo que ya se sabe que corre |
| `LIMIT` **no existe** | 400 "Failed to parse SQL" |
| `BUILTIN.DF` **sí funciona sobre una referencia a entidad** y **falla sobre un campo estático/enumerado**: `mot.manufacturingworkcenter` → `'10OTD : DOBLEZ DE TUBERIA'`, `transaction.status`, `entitygroup.id`; `mot.status` → 400 *Cannot build builtin function / Static field is not supported for Builtin.DF function* | medido el 2026-09-28. Lo que decide es el **tipo de campo**, no la columna. La regla anterior ("`BUILTIN.DF` no funciona sobre `mot.manufacturingworkcenter`") era **falsa** |
| La tabla **`manufacturingworkcenter` no existe** en esta cuenta | 400 *Tipo de búsqueda no válida: manufacturingworkcenter*, medido el 2026-09-28. Los centros de trabajo son **`entitygroup`** (206 grupos: 202 con `ismanufacturingworkcenter='T'`, 4 sin). Por eso el nombre del centro sale de `BUILTIN.DF(mot.manufacturingworkcenter)` y **no** de un JOIN: el JOIN anterior mataba la acción `operaciones` entera con 400, sin escribir nada |
| La tabla **`manufacturingroutingstep` tampoco existe** | mismo 400, medido el 2026-09-28. El catálogo de operaciones que el app pide por SuiteQL (`src/server/08-netsuite.js:510`) **no puede correr** en esta cuenta y cae al catálogo estático |
| **SuiteQL no acepta `//` como comentario** dentro del texto de una consulta | 400 *Failed to parse SQL*, medido el 2026-09-28. Los comentarios van en el código, nunca dentro de la cadena del SQL |
| Los valores reales de `mot.status` son **`COMPLETE` (28663), `NOTSTART` (2148) y `PROGRESS` (53)** | medido el 2026-09-28 con `GROUP BY mot.status` sobre las 30 864 tareas. **No existen** `INPROCESS`, `COMPLETED` ni `CLOSED`, que eran las tres llaves de la tabla de traducción: por eso el 98.6 % de las operaciones se escribía con `'COMPLETE'` mezclado con el español de las otras |
| **`workcentertype` no tiene ninguna fuente** (ni columna de SuiteQL ni campo/record type de la REST Record API: `workcenter`, `workCenter`, `manufacturingworkcenter` y `entitygroupworkcenter` dan todos **404** *Record type ... does not exist*) | medido el 2026-09-28. El record real es `entitygroup` (`isManufacturingWorkCenter`, `laborResources`, `machineResources`, `workCalendar`, sin columna de tipo). **El usuario decidió que `machines.tipo` no se necesita** porque la máquina se captura en el plan: `centros` guarda solo `nombre` y `activa` |
| Una WorkOrder **no tiene entidad**: `BUILTIN.DF(t.entity)` sale `''` | medido el 2026-09-28 en las 4 OTs de muestra. `work_orders.cliente` queda vacío y eso es lo correcto, no un campo que falle |
| **`SELECT * FROM <tabla> FETCH NEXT 1 ROWS ONLY` sí funciona** y da la lista **real** de columnas | medido el 2026-09-28. `item` 62, `aggregateitemlocation` 15, `transactionline` 52, `entitygroup` 18, `manufacturingoperationtask` 24, `location` 12, `bin` 7. Es la vía para **no adivinar** nombres de columna |
| En `item` la columna del tipo es **`itemtype`** y es un **enum de texto**; **no existen** `type`, `isassortmentitem`, `isassemblyitem`, `units`, `purchasingcost` ni `venvendor` | medido el 2026-09-28: los inexistentes dan **500** uno por uno. `itemtype` reparte los 2522 artículos en `Assembly` 1591, `InvtPart` 675, `NonInvtPart` 238, `Service` 14, `OthCharge` 3, `Kit` 1. Consecuencia: `items.tipo` es **text**, y `es_ensamblaje` se deriva de `itemtype = 'Assembly'` (decisión del usuario del 2026-09-28: un `Kit` **no** es ensamble padre) |
| En `aggregateitemlocation` el comprometido es **`quantitycommitted`**, **no existe** `quantityreserved` y **no hay ninguna columna de pickeado** | medido el 2026-09-28 con `SELECT *` (las 15 columnas). El agregado trae **ya una fila por par**: 2426 filas = 2426 pares distintos, 1946 en la planta 1, 3 ubicaciones |
| **`BUILTIN.DF` no se puede usar en la proyección de una consulta agregada** | medido el 2026-09-28: con `SUM`/`GROUP BY` más el envoltorio da 400 *Búsqueda inválida o no compatible*; solo el `GROUP BY` con ids crudos corre. Por eso el lector de inventario no lleva `SUM`: sin el agregado el envoltorio funciona y da el código del artículo y el nombre de la planta |
| La cantidad **pickeada** existe pero **no es un estado de existencias**: `transactionline.quantitypicked` | medido el 2026-09-28: lo tienen 37 481 líneas y **ninguna** es de tipo `ItemShip` (0 de 33 330) — viven en OT (26 586), SO (9 693) y TrnfrOrd (1 202). `transaction.ordpicked` es un **booleano**, no una cantidad (puesto en 28 006). Por eso `inventory.pickeado` queda en 0 **declarado**: es la regla de "copia fiel o no se guarda" (RULE-SUP-009) |
| **500 y 400 son dos causas distintas** y ninguna devuelve una lista vacía | 500 = columna inexistente; 400 = tabla, filtro o texto de SQL inválido. Las dos tumban la acción entera sin escribir nada, así que **una lista vacía no es señal de que el SQL esté bien** |
| SuiteQL **no acepta subconsultas `IN (SELECT ...)`** ni `BUILTIN.DF` dentro de un `GROUP BY` | 400 en ambos casos, medido el 2026-09-28 |

**El guard que encuentra todo esto en una pasada** es `.openchamber/verifica-sql.mjs`: corre el SQL de
los 7 lectores **extraído del archivo** (nunca copiado a mano — una copia dio un falso positivo que
Casi se reporta como defecto de un lector ya verificado) y reporta el código de error de cada uno.
El 2026-09-28: **3 de 7 caídos** (`items` 500, `centros` 400, `inventario` 400). Corregidos los
tres (**`centros` pasa a `entitygroup`, sin `tipo`**, ver fila de `workcentertype` en la tabla),
corren **los 7**.

**Barridos medidos frente a sus topes `maxScan`:** `workorders` 277/500, `operaciones` 2400/5000,
`items` 2522/5000, `inventory` 2426/5000, `centros` 202/500, `materiales` 2301/5000 y
`ordenes_venta` 124/2000 **no truncan hoy**. El 2026-09-28 `materiales` leía 28 676 filas de
TODAS las OTs (solo 2 301 de abiertas) y `ordenes_venta` 2 408 (solo 124 abiertas); ambos
truncaban. **Decisión del usuario 2026-09-28** (*"solo me interesan las abiertas"*): ambos
lectores filtran ahora solo abiertas — `materiales` con el mismo patrón de 3 `NOT LIKE`
(`CERRAD`/`CLOSED`/`COMPLET`) que `workorders`/`operaciones`, y `ordenes_venta` con
`CERRAD`/`CLOSED`/`FACTURAD` (los estatus reales de venta son `Cerrada`, `Facturada` y
`Ejecución de la orden pendiente`). Y filtrar solo OTs abiertas **esconde trabajo**: hay
**17 operaciones `NOTSTART` en OTs `CERRADAS`** (de 2219 sin terminar).

Por eso el nombre del centro en `operaciones` sale de `BUILTIN.DF(mot.manufacturingworkcenter)` —la
misma columna que usan el 2240 y el 2244, los dos que hoy funcionan— y **no** de un JOIN a
`manufacturingworkcenter`, que es una tabla inexistente en esta cuenta.

**El CT es el id interno del centro de trabajo** (`mot.manufacturingworkcenter`), no un número sacado
del nombre. Es lo que el app usa: `PP_mapNetSuiteOperation_` (`src/server/08-netsuite.js:1041`) lee
la columna `workcenter` del 2240, que es ese id crudo. Medido el 2026-09-28 en los **159 centros** que
trae la cuenta: 158 **no** tienen 3+ dígitos en el nombre (`'10OTD : DOBLEZ DE TUBERIA'`,
`'AB20 : TROQUELADO DE ESCUADRA'`, …) y el único que sí los tiene es `'500 :  SUBCONTRATO'`. El id
tampoco es un invento: el `5459` es `'10OTD : DOBLEZ DE TUBERIA'` y el app trata `5459` y `5527` como
los centros de doblado (`08-netsuite.js:1061`). Antes el orden era al revés (dígitos del nombre
primero, id de respaldo) y por eso ese único centro se escribía como `'500'` mientras el app leería
`'6462'`: dos CT distintos para el mismo centro. Si no hay id, se cae a los dígitos del nombre con el
regex de `PP_extractOperationCatalogCt_` (`src/server/08-netsuite.js:573`) y, si tampoco, la fila
queda sin CT y se avisa.

**La descripción es el nombre del centro**, no el título de la tarea: el app la toma de `operation`
(`08-netsuite.js:1070`), que en el 2240 es `BUILTIN.DF(mot.manufacturingworkcenter)`. `mot.title`
viene como respaldo (`'AB20'`) y `mot.operationname` **no existe** en SuiteQL (500, medido).

## 7. Puesta en marcha (en orden, con verificación en cada paso)

1. **Aplicar el esquema.** `docs/schema-supabase-sync-netsuite.sql`. Antes: correr
   `accion: 'diagnostico'`, que no escribe nada y dice qué tablas faltan. Después: volver a correrlo y
   confirmar que `tablasFaltantes` está vacío.
2. **Subir el RESTlet** y crear el deployment con `SUPABASE_URL`, `SUPABASE_KEY` y `UBICACION`.
   **El deployment NO debe quedar *Available Externally***: la service key está en un script parameter y
   un endpoint externo la expone por URL (RULE-SUP-005). Se invoca por URL interna desde el Suitelet.
3. **Subir el Suitelet** con `RESTLET_SCRIPT_ID` y `RESTLET_DEPLOY_ID`.
4. **Probar el Suitelet a mano** desde *Customization → Maps → SuiteCloud Documents → Suitelets →
   Execute as Suitelet*, con `accion: 'workorders', folios: ['<folio>'], dryRun: true`. No escribe.
5. **Subir y desplegar los User Events** con `SCRIPT_ID_TAREA`, `DEPLOY_ID_TAREA` y `ACTIVO='S'`.
   Empezar por uno solo, con `dryRun` forzado, antes de dejar los seis.
6. **Programar el barrido** con `ACCIONES` y `DRY_RUN='S'` la primera vez.
7. **Recién ahí**, quitar `dryRun`.

## 8. La credencial no está en el repo

`SUPABASE_URL` es `https://xtgtfjcwxcoxvixholpj.supabase.co`, **sin** prefijo `db.` (ese es el host
del Postgres en 5432, que además salió IPv6-only). La `service_role` key **no está en ningún archivo
de este repositorio** y no debe agregarse: vive solo en el script parameter del deployment. Si alguien
la necesita para otra cosa, la obtiene del panel de Supabase y la pega en NetSuite, no en un commit.

## 9. Pruebas

`tests/restlet-supabase-sync.test.mjs`, 34 pruebas. El harness AMD captura la factoría e inyecta
`N/query`, `N/https`, `N/runtime`, `N/log` y `N/record` falsos, así que se verifica **qué se escribe**
(URL, método, cabeceras, `Prefer`, cuerpo) sin tocar la red.

Cubre: el mapeo de las 7 tablas; la cadena de `cant_ensamblada` (`record:built` →
`record:quantityremaining` → respaldos de SuiteQL, con el `0`+aviso cuando nadie responde, y con el
`MAX(mot)` acotado a la cantidad); **que con el record disponible no se consulten `transaction.built` y
compañeros**, que en esta cuenta son un 400; que **ninguna fecha salga del RESTlet en un formato que
Postgres no acepte**, y que una `dd/MM` con día ≤ 12 no se lea como mes/día; que el dedupe omita lo
que no cambió; que el `PATCH` lleve la guarda de `revision`; que un choque se reporte sin pisar; que la
degradación a `upsert` se declare; que ninguna columna interna viaje en el cuerpo; que la
`service_role` no se imprima; que ningún SQL lleve cláusulas de paginación; que **ningún SQL lleve un
`//` dentro del texto** (SuiteQL no lo parsea: 400 *Failed to parse SQL*); que el nombre del centro
salga de `BUILTIN.DF(mot.manufacturingworkcenter)` y **no** de un JOIN a `manufacturingworkcenter`
(tabla inexistente en esta cuenta); que el CT sea el id interno; que los cuatro estados reales de
`mot.status` (`NOTSTART`, `PROGRESS`, `COMPLETE`, `CLOSED`) se traduzcan y **ninguno se escriba crudo**;
que **todo SQL use alias que existen en su propio `FROM`/`JOIN`** (un alias inventado es un 400 que
tumba la consulta entera, y ese guard ya atrapó uno); que **`items.tipo` salga como el enum de texto**
de `itemtype` y que `es_ensamblaje` solo reconozca `Assembly`; que **`pickeado` se guarde en 0 con el
aviso de que no tiene fuente** (y que el fixture le ponga 5 a propósito, para que la prueba falle si
alguien vuelve a leerlo del SQL); que dos renglones del mismo par de inventario **se sumen y se
avisen**, para no romper el `unique (item, ubicacion)`; que el SQL de inventario **no lleve `SUM` ni
`GROUP BY`** (el `BUILTIN.DF` no se puede envolver en una consulta agregada: 400); y un guard que
**prohíbe los 7 nombres de columna que se midieron como inexistentes** (`i.type`,
`i.isassortmentitem`, `i.isassemblyitem`, `ail.quantityreserved`, `ail.quantitypicked`, `i.units`,
`i.purchasingcost`).

Verificación contra el ERP real, lector por lector. La sonda extrae el SQL **del propio RESTlet**,
lo corre contra el NetSuite de producción, mete las filas por el RESTlet de verdad y revisa el cuerpo
exacto que se mandaría a PostgREST, **sin escribir**.

- **`.openchamber/verifica-restlet-01.mjs` — `workorders`.** 2026-09-28, 4 OTs abiertas: folio, id
  interno, artículo, descripción, cantidad, estatus y fechas coinciden con el valor crudo de SuiteQL;
  `cant_ensamblada` coincide con `record:built` del 2244 desplegado; ninguna fecha quedó como texto
  crudo; `CAMPOS.work_orders` está dentro del DDL.
- **`.openchamber/verifica-restlet-02.mjs` — `operaciones`.** 2026-09-28, 85 operaciones reales de 3
  OTs abiertas: las 19 columnas del cuerpo coinciden una a una con la fila cruda, `ct` es el id
  interno del centro, `descripcion` es el nombre del centro, las fechas salen en ISO y
  `CAMPOS.operations` está dentro del DDL. Contra el **2240 desplegado** (la misma información que hoy
  consume el app): 27 filas de la muestra están en su página y hay **0 diferencias inesperadas** en
  `ct`, `descripcion`, `secuencia`, `cant_total`, `cant_realizada`, `tiempo_setup` y `maquina`. Las 27
  diferencias de `estatus` son el cambio intencional de `COMPLETE` crudo a `'Completado'`.
- **`.openchamber/verifica-sql.mjs` — los 7 lectores, parseo contra el ERP real.** 2026-09-28. Es el
  guard más barato y el que más encontró: extrae el `const sql = [...]` **del propio RESTlet** (una
  copia a mano dio un falso positivo y casi se reporta como defecto de un lector ya verificado) y
  corre cada consulta substituting los binds por literales — el endpoint SuiteQL v1 por REST no liga
  `p`, y `query.runSuiteQL` dentro de NetSuite sí liga `?`, que es lo que prueban el 2240 y el 2244.
  Resultado de la primera pasada: **3 de 7 caídos** — `items` **500** (`i.type` e
  `i.isassortmentitem` no existen), `centros` **400** (`manufacturingworkcenter` no es tabla) e
  `inventario` **400** (`quantityreserved` y `quantitypicked` no existen en el agregado). Con
  `items` e `inventario` corregidos corren **6 de 7**; con `centros` corregido a `entitygroup`
  (decisión: sin `tipo`) corren **los 7**.

**Pendiente de decisión del negocio (medido, no implementado):** ninguno de los dos lectores filtra
por ubicación y ni `work_orders` ni `operations` tienen columna de planta, mientras el app sí filtra
por planta (`PP_belongsToPlant_`, `UBICACION=1`). De las 277 OTs abiertas, 55 (19.9 %) son de la
planta 2; de las 2 400 operaciones abiertas, 169 (7 %) son de la planta 2. La ingesta las empuja todas
y no hay forma de distinguirlas en Supabase.
