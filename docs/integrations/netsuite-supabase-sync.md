# Ingesta NetSuite → Supabase (push desde NetSuite)

**Estado (actualizado 2026-09-29):** el **esquema de destino SÍ está aplicado, y también el DDL de
cierre** — el proyecto `xtgtfjcwxcoxvixholpj` expone **25 tablas** por la Data API y la ingesta **está
corriendo**: las 7
tablas de NetSuite (`work_orders`, `operations`, `materials`, `items`, `inventory`, `sales_orders`,
`machines`) se refrescaron a las **2026-09-29T04:08** con el mismo `created_at` en todas las filas
(mirror atómico de la RPC `ingesta_mirror`), medido con `.openchamber/diag-supabase-frescura.mjs`.

**Ojo — dos caminos conviven en el repo.** El que **corre hoy** es **Apps Script → RESTlet unificado
2246 → Supabase** (`src/server/19-appscript-ingesta-supabase.js`, el archivo que el build publica en `dist/`, + `netsuite-restlet-unificado-supabase.js`), que
hace un *mirror* atómico (borra y reescribe) y por eso deja todas las filas con el mismo `created_at`.
MEDIDO 2026-10-04: el `.gs` suelto de la raíz (`appscript-ingesta-supabase.gs`) se eliminó porque era una
segunda copia que **nunca se despliega** (el build de Apps Script solo copia `src/server/*.js`) y su
`continue` silencioso reportaba una escritura que no había pasado. Este documento lo señalaba como el
código vivo; ya no lo es. Un escritor por repositorio, también para el archivo que se parece a un escritor.
La arquitectura de **User Events** que describe este documento (seis archivos `netsuite-user-event-*.js`,
Suitelet, RESTlet `netsuite-restlet-supabase-sync.js`, ScheduledScript) es el **diseño propuesto** y
**no está desplegada** en NetSuite; sus `deployments` no existen todavía y subirlos es manual.

- Writer único de las 7 tablas en el camino que corre: el RESTlet unificado 2246 (deploy 1), invocado
  por Apps Script (`RULE-SUP-001`). El diseño de User Events nombra otro writer; mientras no se
  despliegue, no sustituye al 2246.
- **Un segundo escritor, y es la respuesta a "quién escribe" (2026-09-29).** El `anon` **no puede
  escribir** en ninguna de las 25 tablas (medido: `401 / 42501`), y es a propósito, porque la clave
  publicable va en el bundle público de Pages. Así que la escritura la hace **Apps Script** con la
  service role key: las **7 tablas de NetSuite** las sigue escribiendo el 2246, y las **11 tablas de
  catálogo** las espeja `src/server/16-supabase-catalogo.js` en cada guardado. El `machines` queda
  **excluido** del espejo a propósito para no tener dos escritores peleándose la tabla
  (`RULE-SUP-015`). Ese espejo ya puede correr: `docs/schema-supabase-cierre-catalogos.sql` **se aplicó
  el 2026-09-29** con `scripts/aplicar-ddl-cierre.ps1 -Si -Teclado`, que pide la contraseña por prompt
  enmascarado y no la deja en disco ni en el historial (`RULE-SUP-016`). Antes hubo que arreglar dos
  bugs del divisor de sentencias de `scripts/apply-sql-supabase.mjs` —que inventaba 7 errores falsos—,
  y por eso el modo `-Diagnosticar` ejecuta cada sentencia en su propio `SAVEPOINT` y lo revierte todo
  antes de tocar la base. Lo que falta ahora no es el esquema, es **desplegar el `.gs` en Apps Script**:
  hasta que el `16-supabase-catalogo.js` esté desplegado y se guarde una vez la pestaña de catálogos,
  los catálogos de Supabase siguen con la siembra del `2026-09-28T05:11`.
- **La decisión de apartar una máquina va en `machine_planning_overrides`, no en `machines`
  (`RULE-SUP-017`, decisión del usuario 2026-09-29).** La planificación puede apartar una máquina que
  NetSuite da por activa, y solo en esa dirección. No puede ser una columna de `machines` porque el
  2246 **borra y reescribe esa tabla entera** cada 15 minutos: la decisión se perdería en la siguiente
  corrida. La tabla nueva tiene un único escritor (Apps Script, desde la columna `EXCLUIDA` de la hoja
  `MAQUINAS`) y el RESTlet nunca la toca. La bandera efectiva es
  `machines.activa AND NOT excluida`, calculada en un solo lugar por capa para no cambiar los filtros
  que ya consumen el estado. La crea `docs/schema-supabase-cierre-catalogos.sql`, **aplicada el
  2026-09-29** y verificada con `.openchamber/diag-ddl-cierre.mjs` (existe, con RLS y solo lectura;
  `anon` no inserta `401/42501`, no actualiza `Content-Range */0` medido sobre una fila real, y no
  ejecuta `ingesta_mirror` `401/42501`; el borrado por `anon` **no quedó medido** porque la tabla está
  vacía y medirlo exigiría borrar datos reales, y la sonda lo dice en vez de declarar un OK). Sigue
  **vacía** hasta que Apps Script la siembre.
- Reglas: `RULE-SUP-001` a `RULE-SUP-017` en `.project-memory/rules.json`.
- Plan: `docs/plan-migracion-supabase.md` §3.4 y §4 (fase 3).

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

## 5. Modo de escritura: MIRROR EXACTO ATOMICO (RPC)

Desde el 2026-09-29 la ingesta no hace upsert incremental: **borra cada tabla completa y
reescribe lo que NetSuite devuelve en esa corrida** (decisión del usuario: "que no se queden
datos antiguos"). Las 7 tablas quedan como espejo exacto de las filas abiertas del ERP.

El flujo corre en Google Apps Script (`src/server/19-appscript-ingesta-supabase.js`, función `ingesta`):
1. Una sola llamada al RESTlet unificado **2246** con `accion: 'todas'` (solo lectura).
2. Por cada tabla: `POST /rest/v1/rpc/ingesta_mirror` con `{ p_tabla, p_filas }`. El RPC
   (`docs/rpc-ingesta-mirror.sql`) hace `delete` + `insert` **dentro de una sola transacción**:
   o COMMIT (200) o ROLLBACK (400). Si el insert falla, la tabla queda con los datos
   anteriores a la corrida, nunca vacía ni a medias (el DELETE+POST previo del commit
   c883d5e dejaba la tabla vacía si el POST fallaba).
3. El RPC valida que `p_tabla` esté en las 7 tablas de la whitelist, que las columnas del
   payload existan en la tabla (los desconocidas RAISAN, como el PGRST204), castea cada
   valor contra el tipo real de la columna (`jsonb_populate_recordset`) y solo
   `service_role` puede ejecutarlo (la service key de `supabase-config.gs`).

   **El DELETE lleva `WHERE id <> '00000000-0000-0000-0000-000000000000'`** (tautología:
   ningún id vale el uuid nulo, borra todas las filas igual). Motivo medido el 2026-09-29:
   PostgREST rechaza un DELETE sin cláusula WHERE con `21000 DELETE requires a WHERE
   clause` (issue supabase-py #534, PostgREST #663); con la tautología el mirror pasa
   incluso llamando desde Apps Script y con la tabla vacía. Un DELETE directo sobre el
   endpoint de tabla sin filtro (`DELETE /rest/v1/<tabla>` sin query) NO está permitido:
   la ingesta solo borra vía el RPC.

### Una tabla que la corrida no reescribió se VACÍA (RULE-SUP-048)

Decisión del usuario, 2026-10-04: *"todas las ingestas deberían borrar los valores previos y
reescribirse"*. El RPC ya cumplía la mitad del borrado (una tabla vacía es un espejo legítimo:
`p_filas: []` borra y no inserta). Lo que faltaba era el caso de **una tabla que esta corrida no
reeescribió**, que antes conservaba lo anterior en silencio:

| caso | qué hace ahora la ingesta (`src/server/19-appscript-ingesta-supabase.js`) | qué ve quien mira |
| --- | --- | --- |
| NetSuite no devolvió la tabla (`accion` ausente o `ok:false`) | `PP_vaciaTabla_` (el mismo RPC con payload vacío) y la tabla queda en `vaciadas` | vacío |
| la escritura de la tabla se cayó | se intenta el mismo vaciado; si cuela, también queda en `vaciadas` | vacío |
| ni el vaciado se pudo hacer (Supabase caído, RPC con error) | queda en `noSePudoVaciar` con su motivo, y la corrida es `ok:false` | **datos viejos**, nombrados |
| **ninguna** de las 7 acciones vino bien | la corrida no se cuenta (`ejecutada:false`, `motivo:'sin_acciones'`) y **no se toca ninguna tabla** | datos viejos, con aviso |

El último renglón es la única excepción, y es deliberada: "esta tabla falló" y "el origen no
respondió" no son lo mismo. Ante un `respuesta.ok:true` con cero acciones usables (caída de red,
o un despliegue del RESTlet con otro shape), vaciar las siete tablas deja el panel **en blanco**
sin una sola OT, que en el taller se lee como "se borró todo" en vez de "no se pudo leer". Se
conserva lo anterior y se devuelve `ok:false` con el detalle de las siete acciones.

**Las dos listas no se pueden fundir en `errores`**: una tabla vaciada se ve vacía, y una que
conservó lo anterior se ve con datos de la corrida pasada creyendo que son de ahora. Por eso la
corrida devuelve `vaciadas` y `noSePudoVaciar` aparte, `doPost` las reenvía, y el cliente
(`src/web/shared/apps-script-ingesta-trigger.js`) las pasa sin resumirlas.

**Medición del 2026-10-04** (con sesión, `.openchamber/diag-mirror-exacto2.mjs`): las seis tablas
espejo sin otro escritor tenían su última escritura en `2026-10-04T07:48:39-44Z`, todas de la
misma corrida, y `materials` era la única con filas de otro escritor (las 348 copias, escritas a
las `16:32:44Z` por la página). Es decir: la última reescritura completa fue esa, y las copias se
borran solas en la próxima corrida de `ingesta_mirror` porque el RPC borra la tabla entera antes de
insertar. El activador de 15 minutos sigue sin disparar (`tests/disparar-ingesta.test.mjs`,
diagnóstico de `getTriggerStatus`): es un problema aparte y conocido.

**Primera corrida real con esta regla, 2026-10-04T18:48Z** (forzada por POST directo al web app,
con el código ya desplegado): `ok:true`, `ejecutada:true`, `vaciadas:[]`, `noSePudoVaciar:[]`,
`errores:[]`, y el conteo por tabla **bien** — `work_orders 213`, `operations 2232`,
`materials 349`, `items 2494`, `machines 202`, `inventory 1935`, `sales_orders 151`. Los mismos
números que la corrida de las 07:48Z salvo `materials`, que es la que se había ensuciado: 349 filas
escritas, o sea la tabla quedó con los renglones del ERP y **sin las 348 copias**. Que el conteo
llegue como objeto y no como arreglo es la prueba en vivo del arreglo de `conteo` (el contador se
llamaba `filas` y lo tapaba el arreglo de filas del bucle). Las siete acciones del RESTlet vinieron
bien, así que `vaciadas` vacío es el resultado correcto y no un caso sin ejercitar.

Claves naturales del dedupe (solo evita duplicados DENTRO del payload: `items` dedupe por
`codigo`, `materiales` por `ot+line_id`, `inventario` por `item+ubicacion`):
- `work_orders` → `ot`
- `operations` → `operation_id` (`ns-<mot.id>`)
- `materials` → `ot,line_id` (UNIQUE compuesto; `comp.id` es el número de línea *dentro* de
  la OT y se repite entre OTs, medido el 2026-09-29). **Excluye el item dummy `Costo 0
  manufactura`** (pedido del usuario 2026-09-29: era el 81 % de las filas, 1930/2376, en 230
  OTs; filtro en el SQL del 2246, `UPPER(BUILTIN.DF(comp.item)) <> 'COSTO 0 MANUFACTURA'`,
  verificado: 446 filas, RULE-SUP-011).
- `items` → `codigo`
- `machines` → `nombre`
- `inventory` → `item,ubicacion`
- `sales_orders` → `folio`

### `materials.line_id` = `comp.id`, y NINGÚN writer puede escribir otra cosa (RULE-SUP-047)

`line_id` **es** el `comp.id` de NetSuite: el número de renglón del BOM **dentro** de la OT. La
ingesta lo escribe en `materiales_` (`netsuite-restlet-unificado-supabase.js`, `comp.id AS
line_id` + `String(r.line_id)`) y por eso siempre es un **entero** (`'2'`, `'3'`, `'4'`, `'24'`;
medido en vivo). Cualquier otro valor en `line_id` lo escribió alguien que no es la ingesta.

**Por qué importa, medido el 2026-10-04 contra la base en vivo**: `materials` es la única de las
7 tablas donde la web también escribe (el resto es espejo de la ingesta), y el escritor de la
página (`filasMaterials`, `src/web/shared/supabase-writer.js`) usaba `line_id = id`, el **UUID de
la fila que acababa de leer**. Con el UNIQUE `(ot, line_id)` dos claves distintas para el mismo
renglón de BOM no emparejan, y el merge inserta una **COPIA** en vez de actualizar:

| medición (2026-10-04, con sesión) | valor |
| --- | --- |
| filas de `materials` | 697 |
| `(ot, componente)` distintos | 348 |
| filas escritas por la ingesta (`line_id` entero) | 349 |
| filas escritas por la página (`line_id` con forma de UUID) = **las copias** | 348 |
| filas de más si se cuenta `filas − (ot, componente)` | 349 (el único par con 3 filas aporta 2) |
| `(ot, componente)` con **dos renglones reales** del BOM | 1 (OT 3776 / MP00094) |
| `(ot, componente)` sin **ningún** renglón real | 0 |
| parejas con datos idénticos / con alguna diferencia | 345 / 4 (3 con un espacio final en `descripcion`; la cuarta son los dos renglones reales de la 3776, no una diferencia copia↔original) |

El síntoma era visible en la hoja de inspección: cada MP salía **dos veces lado a lado**.

Contrato que queda, y que no se deduce del código:

1. **Quien escribe `materials` desde la página escribe `line_id` = el `line_id` que leyó** de la
   fila del ERP (`texto(m.lineId) || texto(m.id)`). Para eso `mapMaterials` expone `lineId`
   (`supabase-reader.js`); sin esa columna el escritor solo tenía el UUID de la fila.
2. **La hoja no confía en que la base esté limpia**: `inspectionMaterialsUnicos` +
   `inspectionLineaDelBom` (`src/web/inspection/inspection-core.js`) quitan las copias, en
   `inspectionDetail` (semáforo, contador, diálogo de tramo) y en `renderDetail`
   (`inspection-app.js`), que es donde el duplicado se ve.
3. **La deduplicación es por RENGLÓN DEL BOM, no por MP.** La copia se reconoce porque su
   `line_id` **no es un entero**. No se puede agrupar por componente: medido que la OT 3776
   tiene MP00094 en dos renglones reales (`line_id` 2 con 6.27 y 3 con 330) y son dos líneas
   distintas del BOM. Las cantidades nunca se suman ni se eligen.
4. Las copias que había (348) **se borraron con la ingesta del 2026-10-04T18:48Z**, sin delete a
   mano: `ingesta_mirror` hace `delete` de la tabla completa + `insert` en una sola transacción
   (línea 123), así que la corrida las dejó ir y `materials` quedó con las 349 filas del ERP. Por
   eso `docs/limpieza-materials-copias-2026-10-04.sql` **ya no hace falta** y queda solo como
   registro (y con su guarda, por si algún día hay que repetirla).
5. Para que no vuelvan hace falta **el escritor con el `lineId` desplegado en el bundle de Pages**,
   que ya lo está: verificado el 2026-10-04 por GET al bundle remoto, que trae
   `inspectionMaterialsUnicos`, `function inspectionLineaDelBom` y `lineId`. Antes de ese push cada
   guardado de plan recreaba las 348 copias entre ingesta e ingesta.

Sin guarda de `revision` ni modo `comparar`: el mirror convive con la concurrencia optimista
de `app_state`/`plan_snapshots` (que son tablas de estado, no de ingesta), sin pisarse.

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
| **`workorders` y `items` deben leer `item.description` para la descripción, no `purchasedescription`** | medido el 2026-09-29: `purchasedescription` está vacía en casi todo el catálogo (solo 2 de 282 OTs abiertas la tienen), así que el COALESCE anterior (`purchasedescription → displayname → itemid`) caía al **código** del artículo en vez de al texto real del producto (p. ej. `C 590` en vez de `Codo 5" x 90° Pintado`). `i.description` está poblada en 279 de 282 OTs abiertas. Fix en el 2246: `COALESCE(i.description, i.purchasedescription, i.displayname, i.itemid)` en `workorders_` e `items_`. Verificado: 266 de 282 workorders con descripción real (los 3 restantes no tienen `description` y caen al displayname correctamente) |
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

### 8.1 En Apps Script, la service key vive en un archivo del PROYECTO

Del lado de Apps Script hay otro consumidor de la misma clave (la ingesta, RULE-SUP-018) y ahí **no**
se puede usar un script parameter como en NetSuite: se lee desde `PP_config_()`
(`src/server/19-appscript-ingesta-supabase.js`), que la toma de un archivo del proyecto.

Ese archivo lo pega el usuario en el editor de Apps Script. MEDIDO 2026-09-29: lo pegó como
`config.js`, no como `supabase-config.gs`, y el despliegue siguiente **lo borró**. La causa está en
clasp: `push` no actualiza archivo por archivo, arma la lista completa de archivos locales y llama a
`script.projects.updateContent` (`google/clasp`, `src/core/files.ts:616`), que **sustituye el
proyecto entero**. Lo que no está en la lista, no existe después. El proyecto pasó de 27 archivos a 26.

Por lo mismo ese archivo **no puede estar en el build**: `src/server/` se copia entero a `dist/` y el
CI sube `dist/`, así que una clave ahí acabaría publicada en GitHub Pages y se reenviaría en cada
despliegue.

Lo que evita el borrado es `scripts/appscript-preservar-config.mjs`, paso del workflow
`deploy-appscript.yml` que corre **antes** del `clasp push`: baja el proyecto y copia a `dist/` todo
archivo que no venga de `dist/`, se llame como se llame, avisando de cada uno. Se preserva **por
contenido** (reconoce `SUPABASE_URL` / `SUPABASE_KEY` / `UBICACION`), no por nombre, porque el nombre
fue justo lo que falló. Si no puede leer el remoto, **corta el despliegue**: si no, `dist/` se
quedaría sin el archivo y el push siguiente lo eliminaría del proyecto.

`scripts/verificar-deploy-appscript.mjs` es el otro paso, después del deploy: baja el proyecto y
compara byte a byte contra `dist/`. Existe porque dos despliegues seguidos dijeron `Pushed 26 files`
con el archivo listado y el proyecto seguía con la versión anterior. La comprobación anterior —que
`ingesta` apareciera entre las funciones desplegadas— daba verde igual: el bug no cambiaba ningún
nombre, cambiaba el cuerpo de la función.

Guardas de `tests/supabase-config-supervivencia.test.mjs` (8): que el build no genere ninguna
plantilla de credenciales, que la preservación vaya antes del push, que la verificación vaya después y
compare contenido, que ningún workflow use el gancho de prueba, y los tres caminos ejecutados de
verdad —archivo con credenciales y nombre inesperado, remoto idéntico a `dist/`, y remoto ilegible
cortando el despliegue.

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

**Resuelto el 2026-09-29 (decisión del usuario):** la ingesta solo trae OTs de la planta 1. Los tres
lectores de OT (`workorders_`, `operaciones_`, `materiales_`) filtran por la ubicación de la línea
mainline (`transactionline.location = 1`, Planta MM del Llano): `workorders_` y `materiales_` con
`AND tl.location = 1` / `AND mainline_item.location = 1` (su JOIN mainline ya existe), `operaciones_`
con `EXISTS (SELECT 1 FROM transactionline tl WHERE tl.transaction = wo.id AND tl.mainline = 'T'
AND tl.location = 1)` (immune a mainlines duplicadas), e `inventario_` con `WHERE ail.location = 1`
sobre `aggregateitemlocation` (pedido del usuario el mismo día: "también usa ubicación 1 en
inventario"; el par item/location ya trae la ubicación como fila). Medido: de 282 OTs abiertas, 74
(26 %) eran de la planta 2 (V.Guerrero) y quedan fuera — p. ej. la OT 3631 (reportada por el usuario
el 2026-09-29) y la 271; inventario baja de ~2 400 a ~1 933 pares. Resultado verificado con los SQL
exactos del RESTlet: 208 OTs (y 208 para operaciones y materiales), 0 restos de la planta 2. La
ubicación NO se guarda en Supabase (sin columna): el filtro vive solo en el SQL del RESTlet.
`items`, `machines` y `sales_orders` no se tocan (no están atados a la OT). RULE-SUP-013.

## 10. Pedir una corrida: el activador y `doPost` (2026-09-30)

Hasta el 2026-09-30 la única forma de que corriera la ingesta era el activador programado
(Time-driven, cada 15 min, lun-vie 7:00-17:00). Un activador no se puede llamar por HTTP, así que
la página no tenía ninguna forma de pedir una corrida: los botones **Sincronizar** y
**Sincronizar OTs** releían Supabase y nada más. Un botón llamado Sincronizar que no sincroniza es
peor que no tenerlo, porque releer Supabase *funciona* y el botón dice que sí.

### La puerta

`doPost(e)` en `src/server/19-appscript-ingesta-supabase.js`. Antes de existir, la URL del web app
respondía `200` con `No se encontró la función de la secuencia de comandos: doPost` (ver
`docs/APPS_SCRIPT_DEPLOYMENT_Y_BYPASS.md`, sección 8).

```
POST {web app}/exec
Content-Type: text/plain;charset=utf-8

{"accion":"ingesta","forzado":true}
```

- `text/plain` y **no** `application/json`: con `application/json` el navegador manda un preflight
  OPTIONS que Apps Script no contesta y el fetch muere sin error legible. **RULE-SUP-035.**
- El veredicto va en el JSON del cuerpo y **nunca** en `r.status`: un web app en `/exec` responde
  `200` siempre. **RULE-SUP-034.**
- `forzado` salta el filtro de horario. Antes era un `return` temprano *sin nada dentro*, o sea que
  no se podía saltar: a las 20:00 el botón habría dicho «sincronizado» con las OTs viejas en
  pantalla. El activador sigue pasando `forzado = false`.
- `LockService` hace que dos clics seguidos no sean dos llamadas al RESTlet; la segunda recibe
  `{ ok:false, motivo:"ocupada" }`.

### Quién puede dispararla

Solo quien lo nombra. `syncBacklogWorkOrders(options)` y `syncNetSuiteTwoPhase(options)` no
disparan la ingesta salvo que el llamador escriba `{ dispararIngesta: true }`, y la comparación es
`=== true` para que no se pueda heredar por error. **RULE-SUP-033.**

Medido por qué el omisión es *no* disparar: `ensureNetSuiteWorkOrdersFresh`, la comprobación
automática que corre antes de generar o publicar el plan cuando las OTs tienen más de 15 minutos,
llama a `syncBacklogWorkOrders`. Con el omisión en `true`, **generar el plan gastaba una llamada al
RESTlet y siete espejos cada 15 minutos, sin que nadie pulsara nada**. Releer es el fallo seguro.

### Tres desenlaces, porque la ingesta puede fallar a medias

`ingesta()` recorre las siete tablas con `try/catch` por tabla y sigue, así que una corrida puede
escribir cinco y fallar en dos. **RULE-SUP-036.**

| Caso | Qué hace el cliente |
|---|---|
| sin éxito | no sigue leyendo; el aviso nombra el motivo |
| fallo a medias | **sigue leyendo** (las tablas escritas están más nuevas) y **no** dice «sincronizado»; el toast lleva la cuenta y el detalle por tabla va al panel de alertas |
| sin veredicto | error de canal; `dispararIngesta` ya había lanzado |

Un «sincronizado» en el toast significa que las siete tablas se escribieron. Para «¿estos DATOS son
actuales?» la única marca que sirve es el `synced_at` global de `app_state`: con «última escritura»,
una tabla donde la ingesta solo cambió una fila se ve fresca aunque las otras 2 110 sigan viejas.

### El botón no escribe

La página no habla con NetSuite (RULE-SUP-030) y sigue sin hacerlo. El escritor de las siete tablas
sigue siendo **uno solo**, el RESTlet. Lo que el botón hace es *pedir que corra* y después releer de
Supabase.

### Verificación sin gastar una llamada

Un POST con una acción desconocida prueba que `doPost` está desplegado sin sincronizar nada,
porque el servidor contesta `accion_desconocida` antes de tocar el cerrojo o NetSuite. MEDIDO
2026-09-30 contra el despliegue `AKfycbzom44…B5Q @483`:

```text
r.status: 200  (siempre 200 en /exec: no dice nada)
content-type: application/json; charset=utf-8
{"ok":false,"ejecutada":false,"motivo":"accion_desconocida", ...}
VEREDICTO: doPost ESTA desplegado y leyendo el cuerpo
```

Guards: `tests/disparar-ingesta.test.mjs` (11).