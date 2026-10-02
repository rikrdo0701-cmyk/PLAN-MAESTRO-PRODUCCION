(function initSupabaseReader(root, factory) {
  "use strict";

  // LECTOR DE SUPABASE (solo lectura) — fase 3 de docs/plan-migracion-supabase.md.
  //
  // POR QUE EXISTE. El plan quiere que la web lea directo de Supabase por PostgREST y deje de
  // reconstruir el estado entero en cada carga. Este modulo es la PIEZA DE LECTURA: trae filas de
  // Supabase con la clave publicable (cliente) y las mapea al MISMO shape que arma PP_buildState_
  // (src/server/02-storage.js), que es el contrato que consume el frontend.
  //
  // COMO SE ACTIVA. La URL y la clave publicable se inyectan en el build (scripts/build-appscript.mjs)
  // desde SUPABASE_URL y SUPABASE_ANON_KEY. Sin ellas isConfigured() es false y NADA de este modulo
  // cambia el arranque: el puente de Apps Script sigue siendo la fuente. Estar lejos de la ruta de
  // arranque es a proposito: primero se prueba, despues se engancha.
  //
  // QUE NO HACE. No escribe: todo es GET. No inventa reglas de negocio: mapea las columnas que
  // existen y declara en MAPPING_GAPS lo que NO se puede mapear (campos del state sin columna en
  // Supabase, o con una columna que no esta en la forma que el state necesita). No adivina.

  const api = factory(root);
  if (root) root.PPSupabaseReader = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function supabaseReaderFactory(root) {
  "use strict";

  // El build reemplaza estos dos marcadores. Si quedan asi, el lector esta apagado.
  const DEFAULT_URL = "__PP_SUPABASE_URL__";
  const DEFAULT_ANON_KEY = "__PP_SUPABASE_ANON_KEY__";

  const config = { url: DEFAULT_URL, anonKey: DEFAULT_ANON_KEY };

  // Tablas expuestas por la Data API. MEDIDO 2026-09-29 con
  // .openchamber/diag-supabase-todas.mjs: 24. `machine_planning_overrides` es la 25 y todavia
  // NO existe en el proyecto: la crea docs/schema-supabase-cierre-catalogos.sql, que sigue sin
  // aplicar (falta SUPABASE_DB_PASSWORD). mientras tanto readTable la reporta en `errors` y la
  // pagina sigue leyendo maquinas sin override, que es el comportamiento viejo.
  const TABLES = [
    "app_state", "article_configurations", "calendar_exceptions", "capabilities",
    "closed_work_order_summaries", "inventory", "items", "locked_ots", "machines",
    "materials", "matrix", "operation_catalog", "operation_plan_statuses", "operations",
    "operators", "ot_configurations", "ot_types", "plan_snapshots", "sales_orders",
    "selected_ots", "subcontracts", "tools", "unconfirmed_work_orders", "work_orders",
    // MEDIDO 2026-10-01: el catalogo de tramos de inspeccion se migro de la hoja
    // `Tramos` del libro INSPECTION_SPREADSHEET_ID a esta tabla (ver
    // docs/schema-inspection-routes.sql). Antes la pagina lo leia de `materials`,
    // que es tabla DEL ERP y no tiene columna de tramo: lo que se veia en la tabla
    // de Catalogos no eran los tramos. No esta en CATALOG_TABLES porque NO es parte
    // del estado del plan: se lee suelta, con readInspectionRoutes().
    "inspection_routes",
    // MEDIDO 2026-10-01: el historial de IMPRESIONES de la hoja de inspeccion. Antes
    // vivia en la hoja `HISTORIAL_IMPRESION_INSPEC` y se leia por el puente de Apps
    // Script, que esta deshabilitado (RULE-SUP-029), o sea que no tenia destino
    // (docs/schema-inspection-history.sql). NO es lo mismo que `inspection_routes`:
    // esa es el CATALOGO de tramos (una fila por articulo+material, se edita a mano) y
    // esta es el HISTORIAL (una fila por impresion, la escribe la pagina sola).
    "inspection_history",
  ];

  // TABLAS DE LA FASE 3. Las que traen datos frescos (refresh 2026-09-29T04:08) y se pueden leer
  // tal cual. El resto del estado (cola, plan, snapshots) esta VACIO en Supabase: mientras no haya
  // escritor, esas siguen viniendo del puente. Ver readCatalogs().missing.
  const CATALOG_TABLES = [
    "operators", "capabilities", "operation_catalog", "matrix",
    // MEDIDO 2026-10-01, DECISION DEL USUARIO: el catalogo de maquinas es un dato
    // MANUAL, no de ingesta. Antes vivia en `machines`, que el RESTlet 2246 escribia
    // desde NetSuite cada 15 minutos; ahora vive en `machine_catalog`, que la pagina
    // es la unica que escribe (guardarCatalogos). Ver docs/schema-machine-catalog.sql.
    "machine_catalog",
    "ot_types", "subcontracts", "tools", "calendar_exceptions",
    "ot_configurations", "article_configurations", "materials",
    // La decision de la planificacion de apartar una maquina. No va en `machine_catalog`
    // porque esa tabla la escribe la pagina y el RESTlet no la toca (RULE-SUP-017).
    "machine_planning_overrides",
  ];

  // Lo que readCatalogs()/status() leen por omision: los catalogos + las tablas operativas de la
  // ingesta que se pueden mapear (work_orders/materials) o exponer en crudo (operations/items/
  // inventory/sales_orders). Es lo que la fase 3 necesita tener a la mano.
  const READ_TABLES = CATALOG_TABLES.concat([
    "work_orders", "operations", "items", "inventory", "sales_orders",
  ]);

  // LAS CUATRO "DE PERSONA", que son lo que la pagina escribe y el puente ya no trae.
  //
  // MEDIDO 2026-09-29: sin estas, una pagina que arranca desde Supabase deja a la persona
  // con la cola vacia (selected_ots), sin bloqueos (locked_ots), sin el historial de
  // completar/reabrir (operation_plan_statuses) y con la ventana del plan y los ajustes
  // (app_state) en los valores de muestra. No son un extra: son el estado de la persona.
  //
  // QUE NO SE LEE, Y POR QUE. `plan_snapshots` se queda fuera a proposito: son el
  // HISTORIAL de planes publicados (RULE-OT-005) y la pagina los pide por su cuenta
  // (loadPlanSnapshots, que hoy va al puente). Leerlos aqui y aplicarlos encima
  // pisaria el borrador, que es justo lo que la pagina decide al cargar.
  // DECIDIDO 2026-09-30: se suman `unconfirmed_work_orders` y `closed_work_order_summaries`.
  // MEDIDO 2026-09-29, antes de esto: las leia NADIE. Quien las persistia era
  // `callAppsScript("saveWorkOrderSyncState")`, o sea las Hojas, y solo al pulsar
  // Sincronizar OTs. Con el sync escribiendo a Supabase, si tampoco se leen aqui, la marca
  // "por confirmar" (RULE-OT-051) y la retencion de OTs cerradas se persistirian en una tabla
  // que la pagina no consulta: el mismo dato escrito en un sitio y nunca releido.
  const PERSON_TABLES = [
    "app_state", "selected_ots", "locked_ots", "operation_plan_statuses",
    "unconfirmed_work_orders", "closed_work_order_summaries",
  ];

  // HUECOS DE MAPEO Supabase -> shape del estado, MEDIDOS 2026-09-29 contra el esquema REAL
  // desplegado (.openchamber/esquema-supabase.json, el OpenAPI que sirve PostgREST), tabla por
  // tabla y columna por columna. No contra el DDL objetivo: si algo solo existe en un DDL sin
  // aplicar, aqui NO se da por bueno.
  //
  // QUE SE CORRIGIO Y POR QUE. Este bloque declaraba ausentes columnas que SI existen, y el lector
  // no las mapeaba: leer de Supabase perdia datos que estaban ahi. Medido una por una:
  // article_configurations.precio_ref_venta; las cuatro de la ventana de calendar_exceptions
  // (fecha_inicio, hora_inicio, fecha_fin, hora_fin); capabilities.solapamiento, que es NUMERIC
  // (el ratio 0..1) y no el boolean que se creia; capabilities.palabras_clave;
  // capabilities.custom; operators.nombre_real; y tools.codigo. Todas se mapean ahora.
  //
  // FORMATO DE CADA ENTRADA. Es un contrato con tests/supabase-reader-mapeo.test.mjs, no una
  // costumbre, porque de ese formato vive la red general que recorre el JSON del esquema y falla
  // si una entrada declara ausente una columna que si existe:
  //
  //   "<campo del state> | <lo que falta> | <por que>"
  //
  // <lo que falta> es una de estas dos, y solo dos:
  //   "falta la columna X"            la tabla NO tiene esa columna (medido hoy).
  //   "falta la FORMA de la columna X"  la columna existe, pero no en el tipo o la forma que el
  //                                      state necesita.
  // Y el nombre que se pone es el exacto: el del DDL pendiente cuando lo agrega uno, y el del
  // encabezado de la hoja (en mayusculas) cuando no hay columna de ningun tipo, para no
  // inventar un nombre de columna que nadie ha escrito.
  const MAPPING_GAPS = {
    calendar_exceptions: [
      "calendarExceptions[].id | falta la columna codigo | la hoja CALENDARIO tiene su ID y la tabla no lo guarda: la clave natural de la fila es FECHA_INICIO+CONCEPTO+MAQUINA (16-supabase-catalogo.js:181), no el ID de la hoja. El id de la tabla es un uuid, que no es la misma clave, y la app fabrica un 'cal-N' cuando no le llega (app.js:1392).",
    ],
    work_orders: [
      "workOrders[].dueDateOverride | falta la columna due_date_override | la hoja ORDENES_TRABAJO tiene FECHA_ENTREGA_AJUSTADA. La agrega docs/schema-supabase-plan.sql (text) y ese DDL SIGUE SIN APLICAR. Se deja '' y no se copia fecha_vencimiento: la fecha ajustada a mano manda sobre la de NetSuite, y copiarla seria afirmar que nadie la ajusto.",
      "workOrders[].averageSalePriceFrom | falta la columna precio_desde | la hoja ORDENES_TRABAJO tiene PRECIO_DESDE y el nombre no dice lo que es: no es un precio, es la FECHA desde la que vale el precio promedio de venta. MEDIDO 2026-09-29: app.js:1726 lo pasa por normalizeOtDate y 02-storage.js:2182 lo lee sin Number(), al lado de PRECIO_PROMEDIO_VENTA que si lleva Number(). La agrega docs/schema-supabase-plan.sql como text, sin aplicar.",
      "workOrders[].averageSalePriceTo | falta la columna precio_hasta | la hoja tiene PRECIO_HASTA, la FECHA hasta la que vale ese precio promedio (misma medicion que en el anterior). La agrega docs/schema-supabase-plan.sql como text, sin aplicar.",
      "workOrders[].startDate, endDate y dueDate | falta la FORMA de la columna fecha_inicio_ns | las tres son timestamptz y el estado espera el texto 'AAAA-MM-DD' de la hoja (PP_mapWorkOrder_, 02-storage.js:2179). Se resuelve con una REGLA, no con una columna: partir el ISO en UTC sin convertir de zona, y la hora (que el estado no tiene campo para estas tres) se descarta en vez de inventarse un lugar donde ponerla. La regla y su motivo estan en partirFechaTexto().",
      "workOrders[].pendingQuantity | falta la FORMA de la columna cant_ensamblada | MEDIDO 2026-10-01 con sesion en la pagina real: las 175 OT del Backlog decian 'qty:0' y el detalle de la misma OT si mostraba la cantidad. La columna EXISTE y esta bien tipada ('integer not null default 0'); lo que falta es que alguien la escriba: MEDIDO, 'cant_ensamblada' NO aparece en NINGUN archivo de src/server/, o sea que la ingesta, que hace mirror de las filas del RESTlet tal cual, no la trae. El unico escritor (filasWorkOrders, supabase-writer.js:1290) escribe lo que viene del estado. El hueco NO es de esquema: es que la fuente no trae el dato y la tabla, con su default 0, no puede distinguir 'cero' de 'sin escribir'. mapWorkOrders lo resuelve con la regla que ya declaraba (cantidad - cant_ensamblada) y por eso el pendiente sale igual a la cantidad; mientras el RESTlet no la traiga, una OT en curso se vera como si no tuviera nada surtido.",
      "workOrders[].pendingQuantity | falta la FORMA de la columna cant_pendiente | La misma medicion que la de cant_ensamblada y por el mismo motivo: la columna existe y no la escribe nadie. MEDIDO: 'cant_pendiente' NO aparece en NINGUN archivo de src/server/ y filasWorkOrders (supabase-writer.js:1291) escribe el 0 que le llega del estado. Antes de que existiera el arreglo, mapWorkOrders computaba 'cantidad - cant_ensamblada' solo cuando esta columna llegaba VACIA, y con 'not null default 0' nunca llega vacia: esa rama era codigo muerto y el pendiente salia 0 para todas las OT.",
      "workOrders[].revision | falta la FORMA de la columna revision | MEDIDO 2026-10-01: la columna existe y esta bien tipada, pero lo que guarda NO es lo que el estado pide. filasWorkOrders (supabase-writer.js:1645) escribe ahi la REVISION DEL PLAN, que es un contador de guardado, mientras que la hoja de inspeccion usa este campo en la celda REV, que quiere la revision del BOM de NetSuite ('Revision'/'bomRevision' en PP_getInspectionWorkOrder, 16-inspection-service.js:181). Son dos cosas distintas en la misma columna y no hay forma de saber cual esta sin preguntar a quien la escribio. Se deja '' y la hoja imprime 'A', que es lo que se imprimia cuando NetSuite no traia revision. Poner el numero del plan en una celda REV seria affirmar una revision de ingenieria que nadie dio.",
    ],
    operations: [
      "operations[].num | falta la columna num | la hoja OPERACIONES tiene NUM y la tabla no. La agrega docs/schema-supabase-plan.sql (integer), que SIGUE SIN APLICAR, asi que hoy la fila no trae el numero con el que la app identifica la operacion.",
      "operations[].parte | falta la columna parte | la hoja tiene PARTE. La agrega docs/schema-supabase-plan.sql (text), sin aplicar: sin ella no se sabe que articulo es la operacion.",
      "operations[].contenido | falta la columna contenido | la hoja tiene CONTENIDO. La agrega docs/schema-supabase-plan.sql (text), sin aplicar.",
      "operations[].prioridad | falta la columna prioridad | la hoja tiene PRIORIDAD y la app la acepta como texto o como numero (normalizePriority). La agrega docs/schema-supabase-plan.sql (text), sin aplicar.",
      "operations[].fechaReq | falta la columna fecha_req | la hoja tiene FECHA_REQ. La agrega docs/schema-supabase-plan.sql (text), sin aplicar.",
      "operations[].comentario | falta la columna comentario | la hoja tiene COMENTARIO. La agrega docs/schema-supabase-plan.sql (text), sin aplicar.",
      "operations[].tiempoFallback | falta la columna tiempo_fallback | la hoja tiene TIEMPO_FALLBACK, en minutos, para cuando la capacidad no es finita. La agrega docs/schema-supabase-plan.sql (numeric), sin aplicar.",
      "operations[].kitPending | falta la columna kit_pending | la hoja tiene KIT_PENDIENTE. La agrega docs/schema-supabase-plan.sql (boolean), sin aplicar. Ojo con el nombre: en ot_configurations la columna SI existe y se llama kit_pendiente; en operations todavia no hay nada.",
      "operations[].log | falta la columna LOG | el log de cada operacion es un FLUJO, no un atributo, y por decision del usuario del 2026-09-29 se resuelve como tabla aparte (operation_events de docs/schema-supabase-plan.sql), que tampoco existe todavia. No es una columna pendiente de un ALTER TABLE.",
      "operations[].generatedBy | falta la columna GENERATED_BY | la hoja lo tiene y ningun DDL del proyecto le da columna: no se sabe de donde salio la operacion.",
      "operations[].toolChangeFromHerramental | falta la columna HERRAMENTAL_ORIGEN | la hoja lo tiene y no hay columna: es la mitad 'desde' de un cambio de herramental, que tampoco tiene columna en la tabla.",
      "operations[].toolChangeFromKit | falta la columna KIT_ORIGEN | la hoja lo tiene, la mitad 'desde' del cambio de kit. Sin columna.",
      "operations[].toolChangeToHerramental | falta la columna HERRAMENTAL_DESTINO | la hoja lo tiene, la mitad 'hasta' del cambio de herramental. Sin columna.",
      "operations[].toolChangeToKit | falta la columna KIT_DESTINO | la hoja lo tiene, la mitad 'hasta' del cambio de kit. Sin columna.",
      "operations[].fechaInicio, horaInicio, fechaFin y horaFin | falta la FORMA de la columna fecha_inicio | las cuatro son timestamptz y el estado espera dos textos, 'AAAA-MM-DD' y 'HH:MM' (PP_OPERATION_FIELDS, 02-storage.js:45). MEDIDO 2026-09-29: hora_inicio y hora_fin nulas en 1000/1000 y fecha_inicio siempre T00:00:00+00:00, o sea que lo que hay son FECHAS SIN HORA. Se resuelve con una REGLA, no con una columna: partir el ISO en UTC SIN convertir de zona (la planta es America/Mexico_City y aplicarla moveria las 1000 fechas un dia hacia atras) y dejar la hora VACIA cuando el valor es medianoche. La regla y su motivo estan en partirFechaTexto().",
    ],
  };

  function configure(patch) {
    if (patch && typeof patch === "object") {
      if (patch.url != null) config.url = String(patch.url).replace(/\/+$/, "");
      if (patch.anonKey != null) config.anonKey = String(patch.anonKey);
    }
    return { url: config.url, anonKey: config.anonKey, configured: isConfigured() };
  }

  function isConfigured() {
    return Boolean(
      config.url && config.anonKey &&
      config.url.indexOf("__PP_") !== 0 && config.anonKey.indexOf("__PP_") !== 0
    );
  }

  // POR QUE ESTO ES ASYNC Y BUSCA EL JWT, Y NO SOLO LA CLAVE PUBLICABLE.
  //
  // MEDIDO 2026-09-29: con docs/schema-supabase-login-correo.sql aplicado, la clave
  // publicable ya NO lee nada. Las 18 tablas de la pagina tienen `select to
  // authenticated`, y con la clave sola la respuesta es HTTP 200 con CERO filas, que
  // es el peor de los dos mundos: no es un error que se vea, es una pagina vacia.
  // El rol lo trae el `Authorization: Bearer <JWT>`, que sale de PPSupabaseAuth.token()
  // (renovado si toca) y que NUNCA se escribe en un archivo ni se imprime.
  //
  // SIN SESION NO HAY RESPUESTA, Y ESO SE DICE. Se manda la clave sola (lo que antes
  // pasaba) y quien llama ve HTTP 200 con 0 filas; `sessionRequired` deja constancia
  // para que el arranque pueda avisar en vez de pintar una pagina sin matriz que parece
  // correcta. La escritura nunca cae aqui: esa va por PPSupabaseWriter, que si se
  // niega a escribir sin token.
  let avisadoSinSesion = false;

  async function headers(options) {
    const auth = root.PPSupabaseAuth;
    let token = null;
    if (auth && typeof auth.token === "function") {
      try { token = await auth.token(); } catch (error) { token = null; }
    }
    if (token) {
      avisadoSinSesion = false;
      return {
        apikey: config.anonKey,
        Authorization: "Bearer " + token,
        Accept: "application/json",
      };
    }
    avisadoSinSesion = true;
    return {
      apikey: config.anonKey,
      Authorization: "Bearer " + config.anonKey,
      Accept: "application/json",
    };
  }

  /** Sin sesion, la Data API responde 200 con 0 filas. Esto lo dice sin mentir. */
  function sessionRequired() {
    return avisadoSinSesion;
  }

  function restUrl(table, options) {
    const opts = options || {};
    const parts = ["select=" + encodeURIComponent(opts.select || "*")];
    if (opts.order) parts.push("order=" + encodeURIComponent(opts.order));
    if (opts.limit != null) parts.push("limit=" + encodeURIComponent(opts.limit));
    if (opts.filters && typeof opts.filters === "object") {
      Object.keys(opts.filters).forEach(function (column) {
        parts.push(encodeURIComponent(column) + "=eq." + encodeURIComponent(opts.filters[column]));
      });
    }
    return config.url + "/rest/v1/" + encodeURIComponent(table) + "?" + parts.join("&");
  }

  async function readTable(table, options) {
    if (!isConfigured()) throw new Error("Supabase sin configurar (faltan SUPABASE_URL/SUPABASE_ANON_KEY)");
    const response = await root.fetch(restUrl(table, options), { headers: await headers(), cache: "no-store" });
    if (!response.ok) throw new Error("Supabase " + table + ": HTTP " + response.status);
    return response.json();
  }

  /**
   * El numero TOTAL de filas que calzan, del encabezado `content-range`.
   *
   * `opciones` acepta lo mismo que `readTable` y se le pasa entero. Se agrego el
   * 2026-10-01 porque el historial de impresiones necesita DOS lecturas de la misma
   * tabla: las 5 ultimas de una OT (para la lista) y el total de esa OT (para el
   * "Total: N" y para numerar las entradas al reves, como hacia la hoja). Sin el
   * filtro, un `countTable("inspection_history")` contaria las impresiones de TODAS
   * las ordenes, y un historial mostraria el numero de impresiones de la planta como
   * si fueran de esa OT.
   */
  async function countTable(table, options) {
    if (!isConfigured()) throw new Error("Supabase sin configurar");
    const respuesta = await root.fetch(restUrl(table, Object.assign({ select: "id", limit: 1 }, options || {})), {
      headers: Object.assign(await headers(), { Prefer: "count=exact" }),
      cache: "no-store",
    });
    if (!respuesta.ok) throw new Error("Supabase " + table + ": HTTP " + respuesta.status);
    const range = respuesta.headers.get("content-range") || "";
    const total = range.split("/")[1];
    return total === undefined || total === "*" ? null : Number(total);
  }

  async function status() {
    if (!isConfigured()) return { configured: false, tables: {} };
    const tables = {};
    await Promise.all(READ_TABLES.map(async function (table) {
      try {
        tables[table] = { count: await countTable(table) };
      } catch (error) {
        tables[table] = { error: String((error && error.message) || error) };
      }
    }));
    return { configured: true, tables: tables };
  }

  // ---- helpers que replican las normalizaciones del servidor ----

  function normalizeKey(value) {
    return String(value == null ? "" : value).trim().toUpperCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_");
  }

  function normalizeCapabilityKey(value) {
    const text = String(value == null ? "" : value).trim();
    const separator = text.indexOf("::");
    if (separator < 0) return text;
    return text.slice(0, separator).trim() + "::" + normalizeKey(text.slice(separator + 2).replace(/_/g, " "));
  }

  function asBool(value, fallback) {
    if (value === true || value === false) return value;
    const text = String(value == null ? "" : value).trim().toUpperCase();
    if (["TRUE", "VERDADERO", "SI", "1"].indexOf(text) >= 0) return true;
    if (["FALSE", "FALSO", "NO", "0"].indexOf(text) >= 0) return false;
    return fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function number(value) {
    const parsed = Number(value == null ? 0 : value);
    return isFinite(parsed) ? parsed : 0;
  }

  // Un RATIO con default, que es un caso distinto de number(): capabilities.solapamiento
  // es numeric y va de 0 a 1, con default 1 (PP_buildState_: Number(SOLAPAMIENTO || 1)). Un
  // 0 es un 0 legitimo, o sea que el default se aplica cuando NO HAY VALOR, nunca con `||`
  // sobre un numero ya convertido. MEDIDO 2026-09-29: esta columna venia boolean y el DDL
  // docs/schema-supabase-cierre-catalogos.sql (seccion 2.1) la paso a numeric; el factor
  // se perdia y por eso aqui se lee como numero y no como bandera.
  function ratio(value, porDefecto) {
    if (value === null || value === undefined || String(value).trim() === "") return porDefecto;
    const parsed = Number(value);
    return isFinite(parsed) ? parsed : porDefecto;
  }

  function normalizeResourceCategory(value, operator) {
    const category = normalizeKey(value).replace(/\s+/g, "_");
    if (category === "ACABADOS" || category === "FUERA_DE_PLAN") return category;
    if (category === "TD") return category;
    if (/AJUST/.test(normalizeKey(operator))) return "FUERA_DE_PLAN";
    return /PINTURA|ACABADO/.test(normalizeKey(operator)) ? "ACABADOS" : "TD";
  }

  // ---- la regla de las fechas, que es SIMETRICA con el escritor ----
  //
  // QUE HAY EN LA BASE. MEDIDO 2026-09-29 sobre filas reales, no sobre el DDL objetivo:
  //   operations, 1000 filas: `hora_inicio` y `hora_fin` NULAS en 1000/1000, y `fecha_inicio`
  //     SIEMPRE con la forma T00:00:00+00:00.
  //   work_orders, 212 filas: `fecha_inicio_ns` y `fecha_fin_ns` NULAS en 212/212, y
  //     `fecha_vencimiento` con valor en 212/212.
  // O sea que lo que hay guardado NO es un plan con horas: son FECHAS sin hora.
  //
  // POR QUE NO SE CONVIERTE DE ZONA, Y POR QUE ES EL ERROR MAS CARO DE ESTE MODULO. La zona
  // de la planta es America/Mexico_City (16-supabase-catalogo.js:429 y :441, y el default de
  // 16-inspection-service.js), y aplicarla aqui MOVERIA LAS 1000 FECHAS MEDIDAS UN DIA HACIA
  // ATRAS: 2026-09-30T00:00:00+00:00 en Ciudad de Mexico es 2026-09-29 18:00. Se escribe aqui
  // para que nadie "aplique la zona horaria" sin volver a medir.
  //
  // LA REGLA ES SIMETRICA CON EL ESCRITOR, Y ESO ES LO QUE LA JUSTIFICA. El escritor
  // (supabase-writer.js, instante(), que copia el criterio de isoFechaHora_ del RESTlet 2246,
  // netsuite-restlet-unificado-supabase.js:396) trata la hora de pared como UTC y escribe con
  // toISOString; la ingesta del RESTlet hace lo mismo (isoFechaHora_ usa Date.UTC). O sea que
  // la columna guarda la fecha del estado TAL CUAL, con un +00:00 de etiqueta. Releerla en
  // otro criterio no es una mejora: es un viaje de ida y vuelta que pierde un dia.
  //
  // POR QUE MEDIANOCHE DEJA LA HORA VACIA. T00:00:00+00:00 no es una operacion a las 00:00: es
  // lo que sale cuando la app NO TENIA HORA (instante() con solo la fecha produce exactamente
  // eso). Poner "00:00" afirmaria una hora que nadie escribio y pondria la operacion a media
  // noche. Con la hora vacia el estado la trata como lo que es: una fecha. Y esto es lo que
  // hacen las 1000 filas reales, que es la medicion que manda. El margen que queda, y se dice:
  // la columna no distingue una 00:00 REAL de una fecha sin hora, porque el escritor produce
  // las dos igual; se elige la lectura de fecha sin hora porque es la de las filas medidas.
  //
  // LO QUE ESTA REGLA NO HACE, Y NO VA A HACER. No hay `new Date()`, ni getTimezoneOffset, ni
  // toLocaleDateString, ni tabla de zonas en ninguna de las funciones de la regla. Un valor con
  // zona explicita (un -06:00, o un +00:00 que no sea el del escritor) se devuelve con SUS
  // cifras, sin desplazarlas: no se inventa una conversion que nadie pidio. Un valor con un
  // formato que no es una fecha ISO se devuelve TAL CUAL en el campo de fecha y con la hora
  // vacia, en vez de adivinar un dia.
  //
  // NINGUNA OTRA FECHA DEL MODULO ENTRA AQUI. Las de calendar_exceptions, ot_configurations,
  // article_configurations y demas se leen como estaban, porque de donde salen no esta medido.

  /**
   * "HH:MM" de una hora de pared, o "" si no hay hora. `horas` en null es que el valor no
   * traia hora; una hora fuera de rango se devuelve vacia en vez de normalizarla con un Date,
   * que correria el dia entero. 00:00:00 devuelve "" por lo de arriba: medianoche es una fecha
   * sin hora, no una operacion a las cero. Con segundos NO nulos no es medianoche, y entonces
   * si hay hora (00:00:30 es una hora, no una ausencia).
   */
  function horaDePared(horas, minutos, segundos) {
    if (horas == null) return "";
    const hh = Number(horas);
    const mm = Number(minutos);
    const ss = Number(segundos == null || segundos === "" ? 0 : segundos);
    if (!isFinite(hh) || !isFinite(mm) || hh > 23 || mm > 59) return "";
    if (hh === 0 && mm === 0 && ss === 0) return "";
    return (hh < 10 ? "0" + hh : String(hh)) + ":" + (mm < 10 ? "0" + mm : String(mm));
  }

  /**
   * Texto de una columna timestamptz -> { fecha, hora } para el estado. NUNCA convierte de zona.
   * Ver el bloque de arriba, que dice por que.
   */
  function partirFechaTexto(valor) {
    const texto = String(valor == null ? "" : valor).trim();
    if (!texto) return { fecha: "", hora: "" };
    // 1) "AAAA-MM-DD", o "AAAA-MM-DD hh:mm[:ss]" sin zona. No hay offset que aplicar, y las
    //    cifras del texto son las que puso quien las escribio.
    const plano = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/.exec(texto);
    if (plano) return { fecha: plano[1], hora: horaDePared(plano[2], plano[3], plano[4]) };
    // 2) "AAAA-MM-DDThh:mm:ss[.fff]" con "Z" o con "+hh:mm"/"-hh:mm". Se leen las CIFRAS del
    //    texto tal cual: el offset se ignora a proposito, porque moverlo seria aplicar la zona
    //    de la planta y correr la fecha un dia.
    const conZona = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i.exec(texto);
    if (conZona) return { fecha: conZona[1], hora: horaDePared(conZona[2], conZona[3], conZona[4]) };
    // 3) Formato raro ("31/12/2026", o un texto que no es una fecha). Se devuelve tal cual en la
    //    fecha y con la hora vacia. Se PUEDE ver raro en la pagina, y eso es mejor que una fecha
    //    que nadie escribio.
    return { fecha: texto, hora: "" };
  }

  /**
   * La fecha y la hora de UN momento del estado, que en la tabla son DOS columnas: `principal`
   * trae el instante y `repetida` es la misma fila puesta en la otra columna (el escritor pone
   * hora_inicio = fecha_inicio, supabase-writer.js:530-534, y la ingesta del RESTlet ni escribe
   * la repetida). La hora sale de `principal`; si esa no trae hora se mira `repetida`, que es el
   * mismo instante. NUNCA se mezclan dos horas: si las dos traen una distinta, manda `principal`,
   * que es la columna que escribe la ingesta del RESTlet 2246
   * (netsuite-restlet-unificado-supabase.js:163) y la que trae las 1000 filas medidas.
   */
  function momentoDelTexto(principal, repetida) {
    const primero = partirFechaTexto(principal);
    if (primero.hora) return primero;
    return { fecha: primero.fecha, hora: partirFechaTexto(repetida).hora };
  }

  // ---- mapeo de catalogos ----

  function mapOperators(rows) {
    const slice = {
      operators: [], operatorCapacity: {}, operatorPerformance: {}, operatorProfiles: {},
    };
    (rows || []).forEach(function (row) {
      // MEDIDO 2026-09-29 contra el ESCRITOR (16-supabase-catalogo.js:57-68), que es la
      // unica fuente de la verdad de estas dos columnas: `nombre` es OPERADOR (la clave con
      // la que se programa, unica) y `nombre_real` es NOMBRE (el nombre de la persona). Antes
      // se decia que no se sabia cual de las dos era la clave; el espejo lo dice, y el
      // comentario de la columna en docs/schema-supabase-cierre-catalogos.sql lo repite.
      const name = String(row.nombre == null ? "" : row.nombre).trim();
      if (!name) return;
      if (asBool(row.activo, true)) slice.operators.push(name);
      slice.operatorCapacity[name] = number(row.minutos_capacidad);
      const performance = number(row.rendimiento_pct);
      if (performance > 0) slice.operatorPerformance[name] = clamp(performance, 1, 300);
      if (asBool(row.activo, true)) {
        slice.operatorProfiles[name] = {
          // Mismo default que PP_buildState_ (02-storage.js:459): NOMBRE vacio cae al OPERADOR.
          name: String(row.nombre_real == null ? "" : row.nombre_real).trim() || name,
          category: normalizeResourceCategory(row.categoria, name),
        };
      }
    });
    return slice;
  }

  // operators/operatorCapacity/operatorPerformance/operatorProfiles no se pueden reasignar a state
  // sin perder campos, asi que se devuelven por separado y readCatalogs las une.
  function mapCapabilities(rows) {
    const slice = {
      configuredCapabilities: [], hiddenCapabilities: [], capacityModes: {}, cts: [],
      operationRules: {}, customCapabilities: [],
    };
    (rows || []).forEach(function (row) {
      const key = normalizeCapabilityKey(row.key);
      if (!key) return;
      const ct = String(row.ct == null ? "" : row.ct).trim();
      if (asBool(row.activa, true)) slice.configuredCapabilities.push(key);
      else slice.hiddenCapabilities.push(key);
      slice.capacityModes[key] = String(row.capacidad || "FINITA").toUpperCase();
      // operationRules y customCapabilities: las tres columnas que se creian ausentes ya
      // existen (solapamiento numeric, palabras_clave text y custom boolean) y se leen con el
      // tipo que dice el esquema. El shape es el de PP_buildState_ (02-storage.js:486-493).
      slice.operationRules[key] = {
        overlap: ratio(row.solapamiento, 1),
        efficiency: clamp(number(row.eficiencia_pct) || 100, 1, 100),
        keywords: String(row.palabras_clave == null ? "" : row.palabras_clave).trim(),
        requiresTool: asBool(row.requiere_herramental, false),
        requiresKit: asBool(row.requiere_kit, false),
      };
      if (asBool(row.custom, false)) {
        slice.customCapabilities.push({
          key: key, ct: ct, label: String(row.operacion || "OPERACION").trim(),
        });
      }
      if (ct && slice.cts.indexOf(ct) < 0) slice.cts.push(ct);
    });
    return slice;
  }

  function mapOperationCatalog(rows) {
    return (rows || []).map(function (row) {
      return {
        key: normalizeCapabilityKey(row.key),
        ct: String(row.ct == null ? "" : row.ct).trim(),
        label: String(row.label == null ? "" : row.label).trim(),
        source: String(row.source == null ? "" : row.source).trim() || "NETSUITE",
        active: asBool(row.active, true),
      };
    }).filter(function (item) { return Boolean(item.key); });
  }

  function mapMatrix(rows) {
    const matrix = {};
    (rows || []).forEach(function (row) {
      if (!asBool(row.habilitado, true)) return;
      const key = normalizeCapabilityKey(row.capability_key);
      const operator = String(row.operator == null ? "" : row.operator).trim();
      if (!key || !operator) return;
      if (!matrix[key]) matrix[key] = [];
      if (matrix[key].indexOf(operator) < 0) matrix[key].push(operator);
    });
    return matrix;
  }

  /**
   * La matriz COMPLETA, con marcada y sin marcar. MEDIDO 2026-09-30: mapMatrix se come las
   * filas con habilitado=false, o sea que el estado solo traia lo que SI. Y un no no se puede
   * expresar como una AUSENCIA: la tabla guarda la pareja con un booleano, y con el borrado
   * apagado (que existe porque el 2026-09-30 borro 76 filas de ot_configurations) la fila
   * vieja se queda marcada para siempre. Por eso la vista necesita la rejilla entera, y poder
   * escribir un false es lo que hace que DESMARCAR exista.
   *
   * NO se fusiona con mapMatrix a proposito: el planificador lee state.matrix y quiere solo los
   * habilitados. Mezclarlos obligaria a revisar cada lectura del planificador, y un cambio de
   * esa forma se lleva por delante la programacion entera.
   */
  function mapMatrixFull(rows) {
    const out = [];
    (rows || []).forEach(function (row) {
      const key = normalizeCapabilityKey(row.capability_key);
      const operator = String(row.operator == null ? "" : row.operator).trim();
      if (!key || !operator) return;
      out.push({ capabilityKey: key, operator: operator, habilitado: asBool(row.habilitado, true) });
    });
    return out;
  }

  function machineKey(value) {
    // La union entre `machines` (nombre de NetSuite) y `machine_planning_overrides`
    // (machine_nombre) es por TEXTO, y el state normaliza a mayusculas
    // (app.js:1345), asi que las dos partes se comparan con el mismo criterio.
    return String(value == null ? "" : value).trim().toUpperCase();
  }

  function mapMachines(rows, overrides) {
    // El state identifica la maquina por su NOMBRE (PP_mapMachine_: id = row.ID, y la hoja MAQUINAS
    // guarda el nombre en ID). En Supabase el uuid es 'id' y el nombre es 'nombre'.
    //
    // `activa` sale de NetSuite (entitygroup.isinactive, la escribe el RESTlet 2246) y
    // `excluida` de machine_planning_overrides (la decision de la planificacion de no
    // agendar en ella, RULE-SUP-017). La bandera EFECTIVA se calcula aqui, en un solo
    // lugar, para no tocar los ~6 filtros `.filter(m => m.active !== false)` del frontend.
    const apartadas = {};
    (overrides || []).forEach(function (row) {
      const key = machineKey(row.machine_nombre);
      if (key) apartadas[key] = asBool(row.excluida, false);
    });
    return (rows || []).map(function (row) {
      const id = String(row.nombre == null ? "" : row.nombre).trim();
      const excluded = apartadas[machineKey(id)] === true;
      return { id: id, excluded: excluded, active: asBool(row.activa, true) && !excluded };
    }).filter(function (item) { return Boolean(item.id); });
  }

  function mapMachinePlanningOverrides(rows) {
    return (rows || []).map(function (row) {
      const nombre = String(row.machine_nombre == null ? "" : row.machine_nombre).trim();
      return {
        machineName: nombre,
        excluded: asBool(row.excluida, false),
        // actualizado y created_at se ignoran en el estado del plan (solo logs)
      };
    }).filter(function (item) { return Boolean(item.machineName); });
  }

  // EL CATALOGO DE TRAMOS DE INSPECCION (tabla `inspection_routes`).
  //
  // MEDIDO 2026-10-01: antes la pagina leia los tramos de `materials`, que es tabla
  // DEL ERP (la escribe el RESTlet 2246 cada 15 minutos) y NO tiene columna de
  // tramo. La tabla de Catalogos por eso mostraba `dibujo || foto_url` de los
  // materiales como si fuera el tramo, y la columna Tramo salia vacia siempre. No
  // era una lectura incompleta: era una lectura de la tabla equivocada. Los datos
  // de verdad estaban en la hoja `Tramos`, y ahora estan en `inspection_routes`
  // (docs/schema-inspection-routes.sql), con la pagina como unica escritora.
  //
  // POR QUE NO ENTRA EN `state`. El estado del plan (PP_buildState_, 02-storage.js)
  // no tiene un campo de tramos y agregarlo seria cambiar un contrato que el
  // planificador entero consume para algo que solo usa la pestana de inspeccion.
  // Por eso esta tabla NO esta en CATALOG_TABLES ni en READ_TABLES: se lee
  // suelta con readInspectionRoutes(), que es lo que consume el reemplazo del
  // puente. SUMARLA a READ_TABLES solo pagaria una llamada en cada arranque y en
  // cada status() para un dato que casi nadie mira.
  //
  // LOS NOMBRES DE LOS CAMPOS. Se devuelven con los dos aliases que el nucleo de
  // inspeccion ya acepta (inspection-core.js:39-52): article/ARTICULO,
  // material/MATERIAL, route/TRAMO, drawing/DIBUJO, updated/ACTUALIZADO. El nucleo
  // es el que decide cual de los dos leer; los dos se mandan para que cambiar de
  // fuente no obliga a tocarlo y porque elApps Script usa los nombres en
  // mayusculas (ARTICULO/MATERIAL/TRAMO/DIBUJO/ACTUALIZADO) y son los mismos datos.
  //
  // LA DIBUJO NO SE FILTRA ACA. `dibujo` puede venir vacio a proposito: la fila con
  // material VACIO es el dibujo a nivel de orden de trabajo (que es como lo usa
  // PP_Inspection_articleDrawingMatchV2_). Tirar las filas sin dibujo aca
  // borraria ese caso, que es una fila mas y no un dato incompleto.
  function mapInspectionRoutes(rows) {
    return (rows || []).map(function (row) {
      const articulo = String(row.articulo == null ? "" : row.articulo).trim();
      const material = String(row.material == null ? "" : row.material).trim();
      const tramo = String(row.tramo == null ? "" : row.tramo).trim();
      const dibujo = String(row.dibujo == null ? "" : row.dibujo).trim();
      const actualizado = String(row.actualizado == null ? "" : row.actualizado).trim();
      return {
        clave: String(row.clave == null ? "" : row.clave).trim() || normalizeKey(articulo) + "|" + normalizeKey(material),
        articulo: articulo,
        ARTICULO: articulo,
        article: articulo,
        material: material,
        MATERIAL: material,
        tramo: tramo,
        TRAMO: tramo,
        route: tramo,
        dibujo: dibujo,
        DIBUJO: dibujo,
        drawing: dibujo,
        // `actualizado` es TEXTO y no una fecha: en la hoja `Ultima modificacion`
        // era una celda de texto (Utilities.formatDate, pero sin tipificar) y
        // convertirla aqui cambiaria lo que la tabla de Catalogos muestra. El
        // instante parseado, cuando se pudo, viene aparte en `actualizadoAt`.
        actualizado: actualizado,
        ACTUALIZADO: actualizado,
        updated: actualizado,
        actualizadoAt: row.actualizado_at == null ? "" : String(row.actualizado_at),
      };
    }).filter(function (item) { return Boolean(item.articulo); });
  }

  /**
   * Lee el catalogo de tramos entero y lo devuelve mapeado.
   *
   * POR QUE ENTERO Y NO POR ARTICULO. La tabla son unas 400 filas: una pagina de
   * PostgREST traeria el mismo numero de bytes con el filtro puesto, sin el
   * `&offset` que obliga a paginar, y el filtro en memoria es el mismo que ya
   * usaba la hoja. El filtro por articulo lo aplica quien llama
   * (getInspectionDrawingRoutes del reemplazo del puente).
   *
   * EL ORDEN. Por `articulo` y no por `actualizado`: `actualizado` es texto y
   * ordenarlo como texto daria "01/02/2026" antes que "15/12/2025". El nucleo de
   * inspeccion reordena con localeCompare es, asi que el orden de aqui es solo el
   * de la red; se deja el que si es un orden.
   */
  async function readInspectionRoutes() {
    const rows = await readTable("inspection_routes", {
      select: "clave,articulo,material,tramo,dibujo,actualizado,actualizado_at",
      order: "articulo.asc",
    });
    return mapInspectionRoutes(rows);
  }

  /**
   * CUANTAS IMPRESIONES MUESTRA LA PAGINA, Y POR QUE SON CINCO Y NO MAS.
   * La hoja no limitaba: `getInspectionHistory` hacia `rows.slice(-5).reverse()`, o
   * sea que las ultimas cinco y en orden inverso (la mas reciente primero). El 5 es
   * un dato de la lectura, no una decision que se pueda cambiar aqui sin que se note
   * en la hoja de impresion, asi que se conserva.
   */
  const INSPECTION_HISTORY_ULTIMAS = 5;

  /**
   * Una fila de `inspection_history`, con los nombres de la hoja Y los que usa la
   * pagina.
   *
   * POR QUE LOS DOS JUEGOS DE NOMBRES. `renderHistory` (inspection-app.js:272) lee
   * `latest.FECHA_HORA || latest.fechaHora || latest.printedAt` y `latest.FOLIO ||
   * latest.folio || latest.OT || latest.wo`: ya aceptaba los dos porque antes el dato
   * podia venir de Apps Script (mayusculas, como las columnas de la hoja) o de otro
   * lugar. Mandar solo uno obliga a elegir cual de los dos programas se decide, y el
   * que no se mande se ve como celda vacia. Los nombres en espanol son los de la
   * tabla y los demas son los que el nucleo de inspeccion ya tenia.
   *
   * `fecha_hora` es TEXTO (dd/MM/yyyy HH:mm:ss, como en la hoja) y por eso se copia
   * tal cual a `fechaHora`, `FECHA_HORA` y `printedAt`. El instante con tipo viaja
   * aparte en `printedAtIso`, que es lo que se usa para ORDENAR: ordenar por el texto
   * pondria "01/02/2026" antes que "15/12/2025". Es el mismo criterio que
   * `actualizado` / `actualizadoAt` de los tramos (RULE-INS-001).
   *
   * `detalle` se pasa como objeto. Viene de una columna `jsonb`, asi que PostgREST ya
   * la devuelve parseada; si algun dia se escribiera como texto (una fila sembrada a
   * mano, por ejemplo) se intenta el parseo en vez de devolver la cadena, para que
   * quien lea no tenga que preguntar de que tipo es.
   */
  function mapInspectionHistory(rows) {
    return (rows || []).map(function (row) {
      const folio = String(row.ot == null ? "" : row.ot).trim();
      const fechaHora = String(row.fecha_hora == null ? "" : row.fecha_hora).trim();
      const articulo = String(row.articulo == null ? "" : row.articulo).trim();
      const estadoTrabajo = String(row.estado_trabajo == null ? "" : row.estado_trabajo).trim();
      const semaforo = String(row.semaforo == null ? "" : row.semaforo).trim();
      const alertas = String(row.alertas == null ? "" : row.alertas).trim();
      const pendientes = String(row.materiales_pendientes == null ? "" : row.materiales_pendientes).trim();
      const deficit = String(row.materiales_deficit == null ? "" : row.materiales_deficit).trim();
      const sinDibujo = String(row.sin_dibujo == null ? "" : row.sin_dibujo).trim();
      const faltaTramo = String(row.falta_tramo == null ? "" : row.falta_tramo).trim();
      return {
        ot: folio,
        OT: folio,
        wo: folio,
        folio: folio,
        FOLIO: folio,
        fechaHora: fechaHora,
        FECHA_HORA: fechaHora,
        printedAt: fechaHora,
        printedAtIso: row.printed_at == null ? "" : String(row.printed_at),
        articulo: articulo,
        ARTICULO: articulo,
        cantidad: number(row.cantidad),
        CANTIDAD: number(row.cantidad),
        estadoTrabajo: estadoTrabajo,
        ESTADO_TRABAJO: estadoTrabajo,
        semaforo: semaforo,
        SEMAFORO: semaforo,
        alertas: alertas,
        ALERTAS: alertas,
        materialesPendientes: pendientes,
        MATERIALES_PENDIENTES: pendientes,
        materialesDeficit: deficit,
        MATERIALES_DEFICIT: deficit,
        // 'SI' / 'NO' como texto, igual que en la hoja. `sinDibujoEs` es la forma
        // booleana para quien quiera el dato y no el texto; no se cambia la columna.
        sinDibujo: sinDibujo,
        SIN_DIBUJO: sinDibujo,
        sinDibujoEs: /^(SI|SÍ|TRUE|1)$/i.test(sinDibujo),
        faltaTramo: faltaTramo,
        FALTA_TRAMO: faltaTramo,
        faltaTramoEs: /^(SI|SÍ|TRUE|1)$/i.test(faltaTramo),
        detalle: objetoOjson(row.detalle),
      };
    }).filter(function (item) { return Boolean(item.ot); });
  }

  /** Un jsonb ya parseado, o un texto que se intenta parsear. Nunca una cadena fallida. */
  function objetoOjson(valor) {
    if (valor && typeof valor === "object") return valor;
    const texto = String(valor == null ? "" : valor).trim();
    if (!texto) return {};
    try { return JSON.parse(texto); } catch (error) { return { texto: texto }; }
  }

  /**
   * El historial de impresiones de UNA OT, con la forma que la pagina ya leia.
   *
   * POR QUE NO SE USA `readTable` Y SE USA ESTA. La pagina necesita el TOTAL y las
   * ultimas cinco, y el total no cabe en la respuesta de una lectura con `limit`: son
   * dos peticiones a la misma tabla, con el mismo filtro. Se hacen juntas con
   * `Promise.all` porque no dependen una de la otra.
   *
   * EL NUMERO DE CADA IMPRESION. `number` cuenta desde la mas reciente hacia la mas
   * antigua (la ultima impresion es la numero 1), que es como lo numeraba la hoja:
   * `rows.length - index` sobre `slice(-5).reverse()`. Por eso depende del total y no
   * del indice de la lista: con el total es el numero real de impresion de esa OT, y
   * si el `count` no llega (PostgREST devuelve `*`) se cae al numero de filas que si
   * volvieron, que es el mejor dato disponible y no uno inventado.
   *
   * EL ORDEN, Y POR QUE ES POR EL INSTANTE Y NO POR EL TEXTO. `printed_at.desc` con
   * `.nullslast`: en PostgreSQL un `desc` pone los NULLS PRIMERO, y las filas sin
   * instante son las que no pudieron leer la fecha, o sea las MAS VIEJAS del
   * importador. Sin `.nullslast` se subirian alprincipio de la lista y la pagina
   * diria que la ultima impresion fue una de las que no tiene fecha. `created_at`
   * desempata las que comparten `printed_at` (una OT puede imprimirse dos veces en el
   * mismo segundo).
   *
   * DEVUELVE `{ count, conteo, history, historial }`: los dos nombres de cada cosa
   * porque `renderHistory` acepta cualquiera de los dos (`data?.count ??
   * data?.conteo`) y la hoja devolvia las dos parejas. No se inventa una tercera.
   */
  async function readInspectionHistory(ot) {
    const folio = String(ot == null ? "" : ot).trim();
    const vacio = { count: 0, conteo: 0, history: [], historial: [] };
    if (!folio) return vacio;
    const select = "ot,fecha_hora,printed_at,articulo,cantidad,estado_trabajo,semaforo,"
      + "alertas,materiales_pendientes,materiales_deficit,sin_dibujo,falta_tramo,detalle";
    const pedidos = await Promise.all([
      readTable("inspection_history", {
        select: select,
        filters: { ot: folio },
        order: "printed_at.desc.nullslast,created_at.desc",
        limit: INSPECTION_HISTORY_ULTIMAS,
      }),
      countTable("inspection_history", { select: "id", filters: { ot: folio } }),
    ]);
    const filas = mapInspectionHistory(pedidos[0]);
    const total = pedidos[1] === null || !isFinite(pedidos[1]) ? filas.length : pedidos[1];
    const history = filas.map(function (item, index) {
      return { number: total - index, printedAt: item.printedAt, semaphore: item.semaforo, folio: item.folio };
    });
    return {
      count: total,
      conteo: total,
      history: history,
      historial: history.map(function (item) {
        return { numero: item.number, fechaHora: item.printedAt, semaforo: item.semaphore, folio: item.folio };
      }),
    };
  }

  function mapOtTypes(rows) {
    return (rows || []).map(function (row) {
      return {
        id: String(row.id == null ? "" : row.id),
        name: String(row.nombre == null ? "" : row.nombre).trim().toUpperCase(),
        active: asBool(row.activo, true),
      };
    }).filter(function (item) { return Boolean(item.name); });
  }

  function mapSubcontracts(rows) {
    // El id del state es el ID de la hoja SUBCONTRATOS, no el uuid de la base: la app lo
    // usa para borrar por id (app.js:5569, data-delete-subcontract). MEDIDO 2026-09-29: la
    // columna que lo guarda es `codigo` (16-supabase-catalogo.js:125, y el comentario de
    // docs/schema-supabase-cierre-catalogos.sql:122). Antes se devolvia el uuid, que no
    // coincide con ninguna fila de la hoja.
    return (rows || []).map(function (row) {
      return {
        id: String(row.codigo == null ? "" : row.codigo).trim(),
        part: String(row.parte || "*"),
        name: row.tipo,
        days: number(row.dias_habiles) || 3,
        active: asBool(row.activo, true),
      };
    });
  }

  // tools: la hoja HERRAMENTALES tiene ID, PARTE, HERRAMENTAL, KIT_HERRAMENTAL, TIEMPO_AJUSTE_HERR,
  // TIEMPO_AJUSTE_KIT y ACTIVO, y el espejo los escribe en codigo, parte, herramental, kit,
  // tiempo_ajuste_herr, tiempo_ajuste_kit y activo (16-supabase-catalogo.js:118-133). O sea que
  // las dos columnas que se declaraban ausentes si estan: la identidad esta en `codigo` (no en
  // el uuid de `id`) y el KIT_HERRAMENTAL de la hoja esta en `kit`.
  function mapTools(rows) {
    return (rows || []).map(function (row) {
      return {
        // Las filas sembradas antes del DDL de cierre traen `codigo` vacio (el DEFAULT es
        // ''), y ahi la app fabrica su propio id (app.js:1359). No se inventa uno aqui.
        id: String(row.codigo == null ? "" : row.codigo).trim(),
        part: String(row.parte == null ? "" : row.parte).trim(),
        herramental: String(row.herramental == null ? "" : row.herramental).trim(),
        kitHerramental: String(row.kit == null ? "" : row.kit).trim(),
        toolSetupMinutes: number(row.tiempo_ajuste_herr),
        kitSetupMinutes: number(row.tiempo_ajuste_kit),
        active: asBool(row.activo, true),
      };
    });
  }

  // calendar_exceptions: la ventana completa. MEDIDO 2026-09-29, la tabla tiene las cuatro
  // columnas de la hoja CALENDARIO (fecha_inicio, hora_inicio, fecha_fin, hora_fin) mas `fecha`,
  // que es el dia de inicio y forma parte del unique (fecha, concepto, maquina). El espejo
  // escribe fecha = coalesce(fecha_inicio, fecha) (16-supabase-catalogo.js:184-199), asi que
  // `fecha` es el respaldo cuando una fila vieja no trae la ventana.
  function mapCalendar(rows) {
    return (rows || []).map(function (row) {
      const fecha = String(row.fecha == null ? "" : row.fecha).trim();
      const inicio = String(row.fecha_inicio == null ? "" : row.fecha_inicio).trim() || fecha;
      const fin = String(row.fecha_fin == null ? "" : row.fecha_fin).trim() || inicio || fecha;
      return {
        // El id es el uuid de la base: el ID de la hoja no se guarda (MAPPING_GAPS).
        id: String(row.id == null ? "" : row.id).trim(),
        concept: String(row.concepto == null ? "" : row.concepto).trim(),
        machine: String(row.maquina == null ? "" : row.maquina).trim(),
        startDate: inicio,
        start: String(row.hora_inicio == null ? "" : row.hora_inicio).trim(),
        endDate: fin,
        end: String(row.hora_fin == null ? "" : row.hora_fin).trim(),
        reason: String(row.motivo == null ? "" : row.motivo).trim(),
        active: asBool(row.activo, true),
      };
    }).filter(function (item) { return Boolean(item.startDate); });
  }

  // article_configurations: PRECIO_REF_VENTA SI existe (docs/schema-supabase-cierre-catalogos.sql,
  // seccion 4), y es el precio de venta que baja el sync, distinto del PRECIO_MANUAL que escribe
  // una persona (RULE-REP-021). Se mapean los dos. El shim PP_articlePriceCells_ del servidor
  // (02-storage.js:2283) es para una hoja con columnas corridas: aqui las columnas tienen
  // nombre, asi que no hace falta y no se aplica.
  function mapArticleConfigurations(rows) {
    const out = {};
    (rows || []).forEach(function (row) {
      // La clave del state es el articulo en mayusculas (PP_buildArticleConfigurations_).
      const article = String(row.articulo == null ? "" : row.articulo).trim().toUpperCase();
      if (!article) return;
      out[article] = {
        article: article,
        jobType: String(row.tipo_ot == null ? "" : row.tipo_ot).trim().toUpperCase(),
        planningType: String(row.tipo_trabajo == null ? "" : row.tipo_trabajo).trim().toUpperCase(),
        manualUnitPrice: number(row.precio_manual),
        referenceSalePrice: number(row.precio_ref_venta),
        updatedAt: String(row.actualizado == null ? "" : row.actualizado).trim(),
      };
    });
    return out;
  }

  // HERRAMENTALES_EXTRA_JSON es jsonb en la tabla: ya llega como arreglo, no como el texto de
  // una celda. Se normaliza igual (PP_additionalToolList_) para que el state no cambie de forma
  // segun de donde venga la fila.
  function listaDeHerramentales(value) {
    let values = value;
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) return [];
      try { values = JSON.parse(text); } catch (error) { values = text.split(/[,+;|]/); }
    }
    if (!Array.isArray(values)) return [];
    const out = [];
    const vistos = {};
    values.forEach(function (item) {
      const text = String(item == null ? "" : item).trim();
      if (!text || vistos[text]) return;
      vistos[text] = true;
      out.push(text);
    });
    return out;
  }

  // ot_configurations: el state las tiene indexadas por OT, y TODOS los campos de
  // PP_buildOtConfigurations_ tienen columna (16-supabase-catalogo.js:201-220): KIT_HERRAMENTAL
  // esta en `kit`, KIT_PENDIENTE en `kit_pendiente` y HERRAMENTALES_EXTRA_JSON en
  // `herramentales_extra`. `updatedAt` es un timestamptz y la app lo lee con new Date(), que es
  // justo lo que espera (app.js:3266 escribe un ISO en ese mismo campo).
  function mapOtConfigurations(rows) {
    const out = {};
    (rows || []).forEach(function (row) {
      const ot = String(row.ot == null ? "" : row.ot).trim();
      if (!ot) return;
      const machine = String(row.maquina == null ? "" : row.maquina).trim();
      out[ot] = {
        ot: ot,
        machine: normalizeKey(machine) === "SIN_MAQUINA" ? "" : machine,
        herramental: String(row.herramental == null ? "" : row.herramental).trim(),
        kitHerramental: String(row.kit == null ? "" : row.kit).trim(),
        kitPending: asBool(row.kit_pendiente, false),
        subcontractType: String(row.tipo_subcontrato == null ? "" : row.tipo_subcontrato).trim(),
        subcontractDays: number(row.dias_subcontrato),
        updatedAt: String(row.actualizado == null ? "" : row.actualizado).trim(),
        additionalHerramentales: listaDeHerramentales(row.herramentales_extra),
      };
    });
    return out;
  }

  // operations: el shape es PP_OPERATION_FIELDS (02-storage.js:40). Se mapean las columnas que
  // existen HOY y las que no se quedan SIN DEFINIR, en vez de rellenarse con 0 o '': un cero
  // afirmaria un dato que la base no tiene. Las ausentes estan una por una en
  // MAPPING_GAPS.operations.
  function mapOperations(rows) {
    // Sin filtrar por id: una operacion sin clave sigue siendo una operacion del plan, y
    // perderla seria peor que devolverla con el id vacio.
    return (rows || []).map(function (row) {
      const subcontractType = String(row.subcontract_type == null ? "" : row.subcontract_type).trim();
      // Las cuatro fechas se parten con la regla simetrica: sin convertir de zona y con la
      // hora vacia cuando el valor es medianoche. Ver el bloque de partirFechaTexto.
      const inicio = momentoDelTexto(row.fecha_inicio, row.hora_inicio);
      const fin = momentoDelTexto(row.fecha_fin, row.hora_fin);
      const operacion = {
        // `operation_id` es la clave natural de la fila (la clave del espejo es esa columna,
        // 19-appscript-ingesta-supabase.js:259) y es la que el plan usa para referenciar una
        // operacion; `id` es el uuid de la base.
        id: String(row.operation_id == null ? "" : row.operation_id).trim(),
        ot: String(row.ot == null ? "" : row.ot).trim(),
        secuencia: number(row.secuencia),
        ct: String(row.ct == null ? "" : row.ct).trim(),
        descripcion: String(row.descripcion == null ? "" : row.descripcion).trim(),
        operador: String(row.operador == null ? "" : row.operador).trim(),
        maquina: String(row.maquina == null ? "" : row.maquina).trim(),
        // HERRAMENTAL y KIT_HERRAMENTAL de la hoja: en la tabla se llaman `herramental` y `kit`.
        herramental: String(row.herramental == null ? "" : row.herramental).trim(),
        kitHerramental: String(row.kit == null ? "" : row.kit).trim(),
        cantTotal: number(row.cant_total),
        cantPendiente: number(row.cant_pendiente),
        tiempoCiclo: number(row.tiempo_ciclo),
        tiempoSetup: number(row.tiempo_setup),
        tiempoProd: number(row.tiempo_prod),
        fechaInicio: inicio.fecha,
        horaInicio: inicio.hora,
        fechaFin: fin.fecha,
        horaFin: fin.hora,
        tipoInsercion: String(row.tipo_insercion == null ? "" : row.tipo_insercion).trim(),
        estatus: String(row.estatus == null ? "" : row.estatus).trim(),
        locked: asBool(row.locked, false),
        autoFrozen: asBool(row.auto_frozen, false),
        subcontractType: subcontractType,
        subcontractDays: number(row.subcontract_days),
        is_subcontract: Boolean(subcontractType),
      };
      // LAS MARCAS DE RETIRADA, que son columnas NUEVAS: las agrega
      // docs/schema-supabase-plan.sql:434-435 y MEDIDO 2026-09-29 NO estan en el esquema
      // desplegado (docs/esquema-supabase-medido.json no las trae), asi que hasta que se
      // aplique el DDL PostgREST no las manda y la fila llega sin ellas. Por eso los campos se
      // anaden SOLO si la fila las trae: rellenar con "" cuando la columna no existe
      // afirmaria que la operacion esta en el plan (que es lo que significa el null del
      // comentario del DDL) sin que la base tenga nada que decir. Es la misma regla que el
      // resto de columnas ausentes: lo que no esta, no se rellena.
      if (Object.prototype.hasOwnProperty.call(row, "retirada_en")
        || Object.prototype.hasOwnProperty.call(row, "retirada_por")) {
        // retirada_en se devuelve como el TEXTO que llega, sin partir y sin convertir: no hay
        // un campo del estado donde ponerla (el comentario del DDL, lineas 437-440, dice que
        // no existe ninguna lista de operaciones retiradas) y `now()` la escribe con zona real,
        // o sea que no es una fecha sin hora. Vacio = sin marca.
        operacion.retiradaEn = String(row.retirada_en == null ? "" : row.retirada_en).trim();
        // retirada_por es el correo de quien provoco la retirada, del JWT (mismo comentario del
        // DDL). Vacio = sin marca.
        operacion.retiradaPor = String(row.retirada_por == null ? "" : row.retirada_por).trim();
      }
      // Y NO se decide nada con las marcas: el lector no quita operaciones del plan, no arma
      // una lista de retiradas y no las repone. Que una retirada deba sacar la operacion de la
      // vista es una regla de la pagina (la fuente real y persistida es selected_ots, segun el
      // comentario del DDL), y aqui solo se lleva el dato.
      return operacion;
    });
  }

  // ---- las CUATRO tablas de la persona: el mapeo INVERSO exacto del escritor ----
  //
  // Cada fila de aqui sale de la que escribe PPSupabaseWriter (filasSelectedOts,
  // filasLockedOts, filasPlanStatuses y filaAppState en supabase-writer.js), y el
  // nombre del campo es el del estado, no el de la columna. Un mapeo que no sea el
  // inverso exacto no es "un poco peor": es un estado que se guarda y se relee
  // distinto, y eso no se nota hasta que la cola se desordena sola.

  /**
   * selected_ots -> la cola. `posicion` es NOT NULL y es el ORDEN MANUAL que puso la
   * persona (RULE-OT-005, y el comentario del escritor): la app no vuelve a derivar el
   * orden de las operaciones, asi que aquí se ordena por `posicion` y no por `ot`, que
   * sería devolver la cola alfabética.
   */
  function mapSelectedOts(rows) {
    return (rows || [])
      .map(function (row, indice) {
        return { ot: String(row.ot == null ? "" : row.ot).trim(), posicion: Number(row.posicion == null ? indice : row.posicion) };
      })
      .filter(function (item) { return Boolean(item.ot); })
      .sort(function (a, b) { return a.posicion - b.posicion; })
      .map(function (item) { return item.ot; });
  }

  /**
   * locked_ots -> la lista de bloqueadas. Sin `posicion` en la tabla (el escritor no
   * la manda), asi que el orden es el que vino, y el estado no lo usa: lo que importa
   * es el conjunto.
   */
  function mapLockedOts(rows) {
    const out = [];
    const vistas = {};
    (rows || []).forEach(function (row) {
      const ot = String(row.ot == null ? "" : row.ot).trim();
      if (!ot || vistas[ot]) return;
      vistas[ot] = true;
      out.push(ot);
    });
    return out;
  }

  /**
   * operation_plan_statuses -> el OBJETO indexado por clave que espera
   * normalizeOperationPlanStatuses (app.js:1739). Los nombres de campo del estado son
   * `sequence`, `completedAt` y `reopenedAt`; los de la tabla son `secuencia`,
   * `fecha_completado` y `fecha_reapertura`. `origin` se conserva tal cual, con su
   * default del escritor ("draft"), porque es lo que decide si la fila pertenece al
   * borrador o a un plan publicado (statusesForPlanOrigin, app.js:1955).
   *
   * `type` NO se inventa: la tabla no lo tiene y el estado lo normaliza a "OPERATION"
   * cuando no viene (app.js:1747). Mandar un "TOOL_CHANGE" aqui seria afirmar que se
   * sabe el tipo cuando la columna no lo guardo.
   */
  function mapPlanStatuses(rows) {
    const out = {};
    (rows || []).forEach(function (row) {
      const key = String(row.key == null ? "" : row.key).trim();
      if (!key || out[key]) return;
      out[key] = {
        key: key,
        ot: String(row.ot == null ? "" : row.ot).trim(),
        sequence: number(row.secuencia),
        ct: String(row.ct == null ? "" : row.ct).trim(),
        status: String(row.status == null ? "PENDIENTE" : row.status).trim() || "PENDIENTE",
        origin: String(row.origin == null ? "draft" : row.origin).trim() || "draft",
        completedAt: String(row.fecha_completado == null ? "" : row.fecha_completado).trim(),
        reopenedAt: String(row.fecha_reapertura == null ? "" : row.fecha_reapertura).trim(),
      };
    });
    return out;
  }

  /**
   * app_state: la fila UNICA (id = 1, con check), y la ventana del plan con los ajustes.
   * Devuelve null si no hay fila: es lo que la pagina写入 la primera vez, y "no hay
   * fila" no es lo mismo que "hay una fila con todo vacio". Quien la aplique decide
   * con eso, y no se inventa un estado de muestra.
   *
   * `last_schedule` es jsonb y ya llega como objeto; `settings`, `plant` y
   * `report_filters` tambien. Se normalizan igual (jsonb()) para que el estado no
   * cambie de forma segun si el dato venia de Postgres o de las Hojas, donde era
   * texto.
   */
  function mapAppState(rows) {
    const fila = (rows || [])[0];
    if (!fila) return null;
    return {
      revision: number(fila.revision),
      savedAt: String(fila.saved_at == null ? "" : fila.saved_at).trim(),
      syncedAt: String(fila.synced_at == null ? "" : fila.synced_at).trim(),
      planStart: String(fila.plan_start == null ? "" : fila.plan_start).trim(),
      horizonDays: fila.horizon_days == null || fila.horizon_days === "" ? null : number(fila.horizon_days),
      reportWeekStart: String(fila.report_week_start == null ? "" : fila.report_week_start).trim(),
      reportFilters: objeto(fila.report_filters, {}),
      settings: objeto(fila.settings, {}),
      plant: objeto(fila.plant, {}),
      operationCatalogWarning: String(fila.operation_catalog_warning == null ? "" : fila.operation_catalog_warning).trim(),
      lastSchedule: objeto(fila.last_schedule, null),
    };
  }

  /** jsonb que puede venir como objeto o como texto (asi lo guardaba la Hoja). */
  function objeto(valor, porDefecto) {
    if (valor === null || valor === undefined) return porDefecto;
    if (typeof valor === "object") return valor;
    const texto = String(valor).trim();
    if (!texto) return porDefecto;
    try { return JSON.parse(texto); } catch (error) { return porDefecto; }
  }

  function mapMaterials(rows) {
    return (rows || []).map(function (row) {
      return {
        id: row.id, ot: row.ot, workOrderId: row.wo_internal_id, assembly: row.ensamble,
        componentId: row.componente_id, component: row.componente, description: row.descripcion,
        unit: row.unidad, required: number(row.requerido), issued: number(row.emitido),
        pending: number(row.pendiente),
      };
    });
  }

  function mapWorkOrders(rows) {
    // Mapeo parcial a proposito: dueDateOverride y averageSalePriceFrom/To NO existen en la tabla
    // (MAPPING_GAPS.work_orders). Se dejan vacios en vez de inventarlos.
    return (rows || []).map(function (row) {
      const quantity = number(row.cantidad);
      const builtQuantity = number(row.cant_ensamblada);
      const pendienteEscrito = number(row.cant_pendiente);
      // MEDIDO 2026-10-01 en la pagina real, con sesion: las 175 OT del Backlog decían `qty:0`
      // y las 10 de la cola igual, mientras el detalle de la OT sí enseña la cantidad. La
      // cadena, y cada paso la conserva:
      //
      //   1. `work_orders.cant_pendiente` y `cant_ensamblada` son `integer not null default 0`.
      //   2. MEDIDO: `cant_pendiente` y `cant_ensamblada` NO aparecen en NINGUN archivo de
      //      `src/server/`, o sea que la ingesta (que hace mirror de las filas del RESTlet tal
      //      cual) no las escribe. El unico escritor de la pagina (filasWorkOrders,
      //      supabase-writer.js:1290-1291) escribe lo que viene del estado, o sea un 0.
      //   3. Antes esta linea decia: `rawPending === "" ? cantidad - cant_ensamblada : ...`.
      //      Con `not null default 0` la columna NUNCA llega vacia, asi que esa rama era CODIGO
      //      MUERTO y el `else` ganaba siempre: pendingQuantity era 0 para todas.
      //   4. Abajo, normalizeWorkOrders (app.js:1805) tiene el respaldo
      //      `pendingQuantity ?? cantidad - ensamblada`, pero `??` solo cae en `null`/`undefined`,
      //      no en 0. Un 0 lo bloquea igual que antes.
      //   5. Y pendingPiecesForWorkOrder (app.js:13098) lo acepta porque
      //      `Number.isFinite(Number(0))` es true.
      //
      // QUE HACE ESTA LINEA Y POR QUE NO ADIVINA. Un pendiente de 0 solo se cree cuando hay un
      // pendiente escrito Y una ensamblada escrita: si assembled=0 y pending=0 juntos, lo unico
      // que se sabe con certeza es que nadie ha escrito ninguna de las dos, y entonces la
      // cantidad pendiente es la cantidad de la orden. `cantidad - cant_ensamblada` es la regla
      // que el propio lector ya declaraba; lo que cambio es que por fin se puede aplicar, y con
      // los datos de hoy sale `cantidad` porque ensamblada viene 0.
      //
      // Y SI HAY UN 0 DE VERDAD. Una OT completamente surtida tiene pending=0 con
      // ensamblada=cantidad, o con ensamblada>0, y ahi el 0 se respeta: la rama de arriba solo
      // se salta cuando las dos columnas son 0 a la vez. La consecuencia de equivocarse en este
      // punto es una OT ya cerrada presenteada como pendiente, que es lo que se revisa a mano;
      // la de antes era una OT de 500 piezas presenteada como 0, que es lo que se revisaba solo.
      //
      // DECIDIDO, no deducido: el hueco de `cant_ensamblada`/`cant_pendiente` se declara en
      // MAPPING_GAPS.work_orders para que quede a la vista en vez de quedar absorbido aqui.
      // Las tres fechas usan la MISMA regla simetrica que las de operations: sin convertir de
      // zona. MEDIDO 2026-09-29: fecha_inicio_ns y fecha_fin_ns NULAS en 212/212, o sea que
      // solo llega fecha_vencimiento, y llega como fecha sin hora.
      //
      // LA HORA DE ESTAS TRES NO TIENE DONDE IR, Y SE DICE. PP_mapWorkOrder_
      // (02-storage.js:2179) deja startDate, endDate y dueDate como un solo campo de texto
      // cada uno: no hay startTime ni endTime en el estado de una orden. Se mapea la fecha y
      // la hora se descarta, en vez de inventar un campo que el estado no tiene. Con los datos
      // medidos no se pierde nada (las tres columnas son nulas o son medianoche); si alguna
      // vez llegara con hora, la decision de donde guardarla es de quien mantenga el shape del
      // estado, no de este lector.
      const inicio = partirFechaTexto(row.fecha_inicio_ns);
      const fin = partirFechaTexto(row.fecha_fin_ns);
      const vencimiento = partirFechaTexto(row.fecha_vencimiento);
      return {
        id: row.id, workOrderId: row.wo_internal_id, ot: row.ot, item: row.articulo,
        description: row.descripcion, photoUrl: row.foto_url, startDate: inicio.fecha,
        endDate: fin.fecha, dueDate: vencimiento.fecha, dueDateOverride: "",
        quantity: quantity, status: row.estatus, customer: row.cliente, builtQuantity: builtQuantity,
        // Ver el comentario de `pendienteEscrito` arriba. En resumen: un 0 que no viene
        // acompañado de avance no es evidencia de que no quede nada, y por eso la cantidad de la
        // orden gana. Un 0 de verdad se respeta, y se distingue porque en ese caso
        // cant_ensamblada trae el avance (el `|| cantidad` solo cubre la OT sin cantidad, donde
        // el pendiente escrito es el unico dato que hay).
        pendingQuantity: (pendienteEscrito > 0 || builtQuantity > 0)
          ? Math.max(0, pendienteEscrito)
          : Math.max(0, quantity),
        averageSalePrice: number(row.precio_promedio_venta), averageSalePriceFrom: "", averageSalePriceTo: "",
        lastSalePrice: number(row.precio_ultima_venta),
        // `revision` NO es la revision del BOM. MEDIDO 2026-10-01: la columna existe
        // pero `filasWorkOrders` (supabase-writer.js:1645) escribe ahi la REVISION DEL
        // PLAN, un contador de guardado. La hoja de inspeccion pinta esta celda en un
        // cuadrito rotulado REV y quiere la revision del BOM de NetSuite. Se deja ""
        // y no se copia `row.revision`: un numero de guardado en una celda de revision
        // de ingenieria es peor que una celda vacia. Ver MAPPING_GAPS.work_orders.
        revision: "",
      };
    });
  }

  /**
   * unconfirmed_work_orders -> el objeto de marcas por folio que el estado espera
   * (`state.unconfirmedWorkOrders`), que consume mergeUnconfirmedWorkOrderMarks en app.js.
   *
   * LA CLAVE ES EL FOLIO y no el id de la fila, porque la marca se identifica por OT: el id es
   * un uuid que el estado nunca vio. Se devuelve un OBJETEO (no una lista) para que
   * applyImported la pueda unir con las marcas locales sin mas trabajo.
   */
  function mapUnconfirmedWorkOrders(rows) {
    const marcas = {};
    (rows || []).forEach(function (row) {
      const ot = String(row.ot == null ? "" : row.ot).trim();
      if (!ot) return;
      marcas[ot] = {
        ot: ot,
        firstSeenAt: String(row.first_seen_at == null ? "" : row.first_seen_at),
        lastSeenAt: String(row.last_seen_at == null ? "" : row.last_seen_at),
        misses: Math.max(1, Math.round(number(row.misses))),
      };
    });
    return marcas;
  }

  /**
   * closed_work_order_summaries -> `state.closedWorkOrderSummaries`, tambien por folio.
   * La columna `summary` es jsonb y guarda lo que la pagina ya escribio, asi que se devuelve
   * tal cual; si viniera como texto (la columna lo permite en otras tablas), se parsea.
   */
  function mapClosedWorkOrderSummaries(rows) {
    const resumenes = {};
    (rows || []).forEach(function (row) {
      const ot = String(row.ot == null ? "" : row.ot).trim();
      if (!ot) return;
      const contenido = objeto(row.summary, null);
      if (!contenido || typeof contenido !== "object") return;
      resumenes[ot] = Object.assign({}, contenido, { ot: contenido.ot || ot });
    });
    return resumenes;
  }

  // UNA TABLA QUE NO SE PUDO LEER NO ES UNA TABLA VACIA. Son dos hechos distintos y el que los
  // confundia perdia datos: si la lectura falla, la rebanada vuelve como undefined, que
  // supabase-catalog-apply.js descarta a proposito (undefined = 'el lector no trajo esto'), y
  // lo que el puente si habia traido se queda. Si la lectura sale bien y la tabla esta vacia,
  // la rebanada vuelve vacia de verdad ([] o {}), que si se aplica porque significa 'no hay'.
  function siSePudoLeer(rows, table, valor) {
    return rows[table] == null ? undefined : valor;
  }

  // LEE LOS CATALOGOS y devuelve las rebanadas del estado que HOY se pueden llenar de Supabase, mas
  // missing (tablas vacias/ausentes) y gaps (campos que no se pueden llenar). Nunca lanza por una
  // tabla caida: la reporta en errors para que el llamador decida el fallback.
  async function readCatalogs(options) {
    const opts = options || {};
    // Las de persona van SIEMPRE, sin opcion para dejarlas fuera: sin ellas la pagina
    // arranca con la cola vacia y sin el historial de completar/reabrir, que es
    // perder el estado de la persona, no un detalle de arranque. Ver PERSON_TABLES.
    const tables = (opts.tables || READ_TABLES).concat(PERSON_TABLES.filter(function (t) {
      return (opts.tables || READ_TABLES).indexOf(t) < 0;
    }));
    const rows = {};
    const errors = {};
    await Promise.all(tables.map(async function (table) {
      try {
        rows[table] = await readTable(table);
      } catch (error) {
        rows[table] = null;
        errors[table] = String((error && error.message) || error);
      }
    }));

    const missing = [];
    tables.forEach(function (table) {
      if (!rows[table] || rows[table].length === 0) missing.push(table);
    });

    const operatorSlice = mapOperators(rows.operators);
    const capabilitySlice = mapCapabilities(rows.capabilities);
    const cts = capabilitySlice.cts.slice();
    (rows.operations || []).forEach(function (op) {
      const ct = String(op.ct == null ? "" : op.ct).trim();
      if (ct && cts.indexOf(ct) < 0) cts.push(ct);
    });

    const catalogs = {
      operators: siSePudoLeer(rows, "operators", operatorSlice.operators),
      operatorCapacity: siSePudoLeer(rows, "operators", operatorSlice.operatorCapacity),
      operatorPerformance: siSePudoLeer(rows, "operators", operatorSlice.operatorPerformance),
      operatorProfiles: siSePudoLeer(rows, "operators", operatorSlice.operatorProfiles),
      configuredCapabilities: siSePudoLeer(rows, "capabilities", capabilitySlice.configuredCapabilities),
      hiddenCapabilities: siSePudoLeer(rows, "capabilities", capabilitySlice.hiddenCapabilities),
      capacityModes: siSePudoLeer(rows, "capabilities", capabilitySlice.capacityModes),
      operationRules: siSePudoLeer(rows, "capabilities", capabilitySlice.operationRules),
      customCapabilities: siSePudoLeer(rows, "capabilities", capabilitySlice.customCapabilities),
      // cts es la union de las de capabilities y las de operations, asi que se cuelga de
      // capabilities: si esa tabla cayo, la union esta a medias y publicarla seria quitar CTs
      // que si existen. Es mejor que se quede la del puente.
      cts: siSePudoLeer(rows, "capabilities", cts),
      operationCatalog: siSePudoLeer(rows, "operation_catalog", mapOperationCatalog(rows.operation_catalog)),
      matrix: siSePudoLeer(rows, "matrix", mapMatrix(rows.matrix)),
    // La rejilla completa, marcada y sin marcar. Para la vista de la matriz; el planificador
    // sigue leyendo matrix, que solo trae los habilitados.
    matrixFull: siSePudoLeer(rows, "matrix", mapMatrixFull(rows.matrix)),
      // MEDIDO 2026-10-01, DECISION DEL USUARIO: el catalogo de maquinas sale de
      // `machine_catalog` (manual, la pagina lo escribe), no de `machines` (ingesta de
      // NetSuite). `machines` sigue existiendo y el RESTlet 2246 sigue escribiendola,
      // pero ya no alimenta el catalogo que ve la pagina. Ver docs/schema-machine-catalog.sql.
      machines: siSePudoLeer(rows, "machine_catalog", mapMachines(rows.machine_catalog, rows.machine_planning_overrides)),
      otTypes: siSePudoLeer(rows, "ot_types", mapOtTypes(rows.ot_types)),
      subcontracts: siSePudoLeer(rows, "subcontracts", mapSubcontracts(rows.subcontracts)),
      // Estas cuatro ya se PIDIAN y se leian (estan en CATALOG_TABLES) pero se descartaban
      // enteras: la pagina se quedaba sin herramientas, sin calendario, sin configuracion
      // por OT y sin precio de venta por articulo aunque las filas estuvieran ahi.
      toolCatalog: siSePudoLeer(rows, "tools", mapTools(rows.tools)),
      calendarExceptions: siSePudoLeer(rows, "calendar_exceptions", mapCalendar(rows.calendar_exceptions)),
      otConfigurations: siSePudoLeer(rows, "ot_configurations", mapOtConfigurations(rows.ot_configurations)),
      articleConfigurations: siSePudoLeer(rows, "article_configurations", mapArticleConfigurations(rows.article_configurations)),
      // machine_planning_overrides ya se usa para calcular `machines.active/excluded`
      // (mapMachines recibe overrides). Se devuelve también mapeado para que el boot tenga
      // TODOS los catálogos normalizados (no filas crudas), aunque la app no lo consuma directo.
      machinePlanningOverrides: siSePudoLeer(rows, "machine_planning_overrides", mapMachinePlanningOverrides(rows.machine_planning_overrides)),
    };
    // undefined no se devuelve: supabase-catalog-apply.js lo descarta a proposito, y es lo
    // unico que NO pisa lo que el puente si trajo. Ver siSePudoLeer.
    Object.keys(catalogs).forEach(function (clave) {
      if (catalogs[clave] === undefined) delete catalogs[clave];
    });

    return {
      source: "supabase",
      schemaVersion: "supabase-reader/1",
      catalogs: catalogs,
      // LAS CUATRO DE PERSONA, con el mismo criterio que las rebanadas: undefined es
      // 'el lector no trajo esto' (la tabla cayo) y un valor, aunque vacio, es 'no
      // hay'. selectedOts/lockedOts son listas de OT y operationPlanStatuses el objeto
      // por clave; appState es la fila unica o null si todavia no existe ninguna.
      selectedOts: siSePudoLeer(rows, "selected_ots", mapSelectedOts(rows.selected_ots)),
      lockedOts: siSePudoLeer(rows, "locked_ots", mapLockedOts(rows.locked_ots)),
      operationPlanStatuses: siSePudoLeer(rows, "operation_plan_statuses", mapPlanStatuses(rows.operation_plan_statuses)),
      appState: siSePudoLeer(rows, "app_state", mapAppState(rows.app_state)),
      // Las marcas de OT y el resumen de las OTs cerradas (DECIDIDO 2026-09-30, con el sync
      // escribiendo a Supabase). Los dos con el criterio de las de arriba: undefined si la
      // tabla no se pudo leer, {} de verdad si se leyo vacia.
      unconfirmedWorkOrders: siSePudoLeer(rows, "unconfirmed_work_orders", mapUnconfirmedWorkOrders(rows.unconfirmed_work_orders)),
      closedWorkOrderSummaries: siSePudoLeer(rows, "closed_work_order_summaries", mapClosedWorkOrderSummaries(rows.closed_work_order_summaries)),
      // operations: el plan. MEDIDO 2026-09-29: el arranque (supabase-catalog-apply.js)
      // lo mete por aplicarEstadoDesdeSupabase -> applyImported, que es la funcion que
      // reconcilia. Lo que NO se puede representar son las columnas ausentes, y estan
      // en MAPPING_GAPS: leer de aqui deja el plan sin num, parte, contenido,
      // prioridad, fechaReq ni log.
      operations: mapOperations(rows.operations),
      workOrders: mapWorkOrders(rows.work_orders),
      materials: mapMaterials(rows.materials),
      operationalRaw: {
        operations: rows.operations || null,
        items: rows.items || null,
        inventory: rows.inventory || null,
        sales_orders: rows.sales_orders || null,
      },
      missing: missing,
      errors: errors,
      gaps: MAPPING_GAPS,
    };
  }

  return {
    configure: configure,
    // MEDIDO 2026-09-29: el modulo de arranque (supabase-catalog-boot.js) necesita
    // saber si hay URL y clave, y hasta ahora no habia forma de preguntarselo: solo
    // existia isConfigured(), que responde si/no pero no da los valores. El arranque
    // lo resolvia inventandose un lector.configured() que no existia, con lo que
    //_entero se daba por apagado y no se leia NADA de Supabase. Sin dar, la pantalla
    // de entrada, los catalogos y el aviso de antiguedad dependian de una funcion
    // que no existia.
    config: function () { return { url: config.url, anonKey: config.anonKey }; },
    isConfigured: isConfigured,
    sessionRequired: sessionRequired,
    PERSON_TABLES: PERSON_TABLES,
    readTable: readTable,
    countTable: countTable,
    status: status,
    readCatalogs: readCatalogs,
    normalizeCapabilityKey: normalizeCapabilityKey,
    normalizeKey: normalizeKey,
    // Los mapeos se exportan para que la sonda y los tests los puedan correr sobre filas
    // sueltas, sin levantar una lectura entera. No son la via de la pagina: la pagina
    // consume lo que devuelve readCatalogs.
    mapOperators: mapOperators,
    mapCapabilities: mapCapabilities,
    mapTools: mapTools,
    mapCalendar: mapCalendar,
    mapArticleConfigurations: mapArticleConfigurations,
    mapOtConfigurations: mapOtConfigurations,
    mapOperations: mapOperations,
    mapSubcontracts: mapSubcontracts,
    mapWorkOrders: mapWorkOrders,
    // MEDIDO 2026-10-01: esta NO estaba exportada y el reemplazo la pide. mapMaterials existia
    // (esta misma linea 851) y se usaba internamente en readCatalogs (linea ~1039), o sea que
    // estaba escrita, probada por dentro y solo faltaba publicarla. El efecto fue que
    // getPlanningWorkOrderData - el camino de la pagina que trae operaciones, materiales y
    // ficha de UNA OT - tiraba `TypeError: r.mapMaterials is not a function` en cada llamada, y
    // con ella caia TODA la carga por OT: MEDIDO en produccion, el toast de la tarjeta del
    // Backlog decia literalmente "r.mapMaterials is not a function". La funcion de la OT no
    // llegaba nunca desde Supabase. Es la misma clase de fallo que el disparador de updated_at
    // bien puesto y sin leer, y que sessionRequired: la pieza existe y nadie la conecta.
    mapMaterials: mapMaterials,
    mapMachinePlanningOverrides: mapMachinePlanningOverrides,
    // MEDIDO 2026-10-01: el catalogo de tramos de inspeccion. No es parte de
    // `state`, asi que no sale de readCatalogs() sino de readInspectionRoutes().
    mapInspectionRoutes: mapInspectionRoutes,
    readInspectionRoutes: readInspectionRoutes,
    // MEDIDO 2026-10-01: el historial de impresiones de la hoja de inspeccion. La
    // tabla se creo en docs/schema-inspection-history.sql y sale de la misma razon que
    // `inspection_routes`: el puente de Apps Script esta deshabilitado y la hoja
    // `HISTORIAL_IMPRESION_INSPEC` se queda congelada como respaldo, sin ni escritor
    // ni lector. `mapInspectionHistory` se exporta para poder probarlo SIN red.
    mapInspectionHistory: mapInspectionHistory,
    readInspectionHistory: readInspectionHistory,
    INSPECTION_HISTORY_ULTIMAS: INSPECTION_HISTORY_ULTIMAS,
    // Los cuatro inversos del escritor, para poder probarlos SIN red: la pareja
    // mapear->mapear es la que demuestra que un guardado y su lectura se cierran.
    mapSelectedOts: mapSelectedOts,
    mapLockedOts: mapLockedOts,
    mapPlanStatuses: mapPlanStatuses,
    mapAppState: mapAppState,
    // Los inversos de las dos tablas que se agregaron para el sync (DECIDIDO 2026-09-30).
    mapUnconfirmedWorkOrders: mapUnconfirmedWorkOrders,
    mapClosedWorkOrderSummaries: mapClosedWorkOrderSummaries,
    // La regla de las fechas se exporta para que se pueda probar SOLA, sobre un valor, sin
    // montar una lectura: es la parte del lector que mas dano hace si se cambia por error.
    partirFechaTexto: partirFechaTexto,
    momentoDelTexto: momentoDelTexto,
    TABLES: TABLES,
    CATALOG_TABLES: CATALOG_TABLES,
    MAPPING_GAPS: MAPPING_GAPS,
  };
});
