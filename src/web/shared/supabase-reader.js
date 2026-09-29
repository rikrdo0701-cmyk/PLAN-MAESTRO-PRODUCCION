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
  ];

  // TABLAS DE LA FASE 3. Las que traen datos frescos (refresh 2026-09-29T04:08) y se pueden leer
  // tal cual. El resto del estado (cola, plan, snapshots) esta VACIO en Supabase: mientras no haya
  // escritor, esas siguen viniendo del puente. Ver readCatalogs().missing.
  const CATALOG_TABLES = [
    "operators", "capabilities", "operation_catalog", "matrix", "machines",
    "ot_types", "subcontracts", "tools", "calendar_exceptions",
    "ot_configurations", "article_configurations", "materials",
    // La decision de la planificacion de apartar una maquina. No va en `machines` porque
    // esa tabla la reescribe entera el RESTlet 2246 cada 15 minutos (RULE-SUP-017).
    "machine_planning_overrides",
  ];

  // Lo que readCatalogs()/status() leen por omision: los catalogos + las tablas operativas de la
  // ingesta que se pueden mapear (work_orders/materials) o exponer en crudo (operations/items/
  // inventory/sales_orders). Es lo que la fase 3 necesita tener a la mano.
  const READ_TABLES = CATALOG_TABLES.concat([
    "work_orders", "operations", "items", "inventory", "sales_orders",
  ]);

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
      "operations[].fechaInicio y fechaFin | falta la FORMA de la columna fecha_inicio | la columna existe pero es timestamptz, y el state espera el texto 'AAAA-MM-DD' que la hoja guarda en FECHA_INICIO (PP_mapOperation_). Partir un timestamptz en la fecha de la planta exige su zona horaria, que no esta medida ni escrita en el repositorio: se deja sin mapear en vez de correr la fecha un dia.",
      "operations[].horaInicio y horaFin | falta la FORMA de la columna hora_inicio | la columna existe pero es timestamptz, y el state espera 'HH:MM'. Mismo motivo que en la fecha: sin la zona horaria de la planta, partirla seria inventar una hora.",
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

  function headers() {
    return {
      apikey: config.anonKey,
      Authorization: "Bearer " + config.anonKey,
      Accept: "application/json",
    };
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
    const response = await root.fetch(restUrl(table, options), { headers: headers(), cache: "no-store" });
    if (!response.ok) throw new Error("Supabase " + table + ": HTTP " + response.status);
    return response.json();
  }

  async function countTable(table) {
    if (!isConfigured()) throw new Error("Supabase sin configurar");
    const response = await root.fetch(restUrl(table, { select: "id", limit: 1 }), {
      headers: Object.assign(headers(), { Prefer: "count=exact" }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Supabase " + table + ": HTTP " + response.status);
    const range = response.headers.get("content-range") || "";
    const total = range.split("/")[1];
    return total === undefined ? null : Number(total);
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
      return {
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
        tipoInsercion: String(row.tipo_insercion == null ? "" : row.tipo_insercion).trim(),
        estatus: String(row.estatus == null ? "" : row.estatus).trim(),
        locked: asBool(row.locked, false),
        autoFrozen: asBool(row.auto_frozen, false),
        subcontractType: subcontractType,
        subcontractDays: number(row.subcontract_days),
        is_subcontract: Boolean(subcontractType),
      };
    });
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
      const rawPending = String(row.cant_pendiente == null ? "" : row.cant_pendiente).trim();
      return {
        id: row.id, workOrderId: row.wo_internal_id, ot: row.ot, item: row.articulo,
        description: row.descripcion, photoUrl: row.foto_url, startDate: row.fecha_inicio_ns,
        endDate: row.fecha_fin_ns, dueDate: row.fecha_vencimiento, dueDateOverride: "",
        quantity: quantity, status: row.estatus, customer: row.cliente, builtQuantity: builtQuantity,
        pendingQuantity: rawPending === "" ? Math.max(0, quantity - builtQuantity) : Math.max(0, number(row.cant_pendiente)),
        averageSalePrice: number(row.precio_promedio_venta), averageSalePriceFrom: "", averageSalePriceTo: "",
        lastSalePrice: number(row.precio_ultima_venta),
      };
    });
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
    const tables = opts.tables || READ_TABLES;
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
      machines: siSePudoLeer(rows, "machines", mapMachines(rows.machines, rows.machine_planning_overrides)),
      otTypes: siSePudoLeer(rows, "ot_types", mapOtTypes(rows.ot_types)),
      subcontracts: siSePudoLeer(rows, "subcontracts", mapSubcontracts(rows.subcontracts)),
      // Estas cuatro ya se PIDIAN y se leian (estan en CATALOG_TABLES) pero se descartaban
      // enteras: la pagina se quedaba sin herramientas, sin calendario, sin configuracion
      // por OT y sin precio de venta por articulo aunque las filas estuvieran ahi.
      toolCatalog: siSePudoLeer(rows, "tools", mapTools(rows.tools)),
      calendarExceptions: siSePudoLeer(rows, "calendar_exceptions", mapCalendar(rows.calendar_exceptions)),
      otConfigurations: siSePudoLeer(rows, "ot_configurations", mapOtConfigurations(rows.ot_configurations)),
      articleConfigurations: siSePudoLeer(rows, "article_configurations", mapArticleConfigurations(rows.article_configurations)),
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
      // operations: el plan. supabase-catalog-apply.js NO lo aplica a proposito (el plan
      // sigue viniendo del puente); se mapea para que la sonda y el arranque puedan
      // compararlo con el del puente, y las columnas que faltan estan en MAPPING_GAPS.
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
    TABLES: TABLES,
    CATALOG_TABLES: CATALOG_TABLES,
    MAPPING_GAPS: MAPPING_GAPS,
  };
});
