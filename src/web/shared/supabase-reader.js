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
  // QUE NO HACE. No escribe: todo es GET. No inventa reglas de negocio: solo mapea las columnas que
  // existen y declara en MAPPING_GAPS lo que NO se puede mapear todavia (campos del state sin columna
  // en Supabase, o con nombre distinto y semantica no confirmada). No adivina.

  const api = factory(root);
  if (root) root.PPSupabaseReader = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function supabaseReaderFactory(root) {
  "use strict";

  // El build reemplaza estos dos marcadores. Si quedan asi, el lector esta apagado.
  const DEFAULT_URL = "__PP_SUPABASE_URL__";
  const DEFAULT_ANON_KEY = "__PP_SUPABASE_ANON_KEY__";

  const config = { url: DEFAULT_URL, anonKey: DEFAULT_ANON_KEY };

  // 24 tablas expuestas por la Data API (medido 2026-09-29 con .openchamber/diag-supabase-todas.mjs).
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
  ];

  // Lo que readCatalogs()/status() leen por omision: los catalogos + las tablas operativas de la
  // ingesta que se pueden mapear (work_orders/materials) o exponer en crudo (operations/items/
  // inventory/sales_orders). Es lo que la fase 3 necesita tener a la mano.
  const READ_TABLES = CATALOG_TABLES.concat([
    "work_orders", "operations", "items", "inventory", "sales_orders",
  ]);

  // HUECOS DE MAPEO Supabase -> shape del estado, medidos contra el esquema real y PP_buildState_.
  // Cada entrada dice que campo del state NO se puede llenar con la tabla de hoy y por que. Se
  // declaran en vez de rellenarlos con un valor inventado: es la regla de no inferir en silencio.
  const MAPPING_GAPS = {
    operators: [
      "operatorProfiles.name: la hoja distingue OPERADOR (clave) de NOMBRE (nombre real); la tabla operators solo tiene 'nombre' y no se sabe cual de los dos es.",
    ],
    capabilities: [
      "operationRules.overlap: la hoja SOLAPAMIENTO es numerico (factor, default 1); la tabla trae 'solapamiento' boolean. Falta confirmar la conversion.",
      "operationRules.keywords: la hoja tiene PALABRAS_CLAVE; la tabla no tiene columna equivalente.",
      "customCapabilities: la hoja tiene CUSTOM; la tabla no tiene columna equivalente, asi que no se puede saber que capacidad es personalizada.",
    ],
    tools: [
      "id: la hoja tiene un ID textual propio; la tabla solo tiene id uuid. La identidad no coincide.",
      "kitHerramental: la hoja usa KIT_HERRAMENTAL; la tabla usa 'kit'. Semantica no confirmada.",
    ],
    calendar_exceptions: [
      "start/end: la hoja tiene FECHA_INICIO/HORA_INICIO/FECHA_FIN/HORA_FIN; la tabla solo tiene 'fecha'. No se puede reconstruir la ventana.",
    ],
    ot_configurations: [
      "kitHerramental: la hoja usa KIT_HERRAMENTAL; la tabla usa 'kit'. Semantica no confirmada.",
    ],
    article_configurations: [
      "referenceSalePrice: la hoja tiene PRECIO_REF_VENTA (RULE-REP-021); la tabla no tiene columna equivalente.",
    ],
    work_orders: [
      "dueDateOverride: la hoja tiene FECHA_ENTREGA_AJUSTADA; la tabla no la trae.",
      "averageSalePriceFrom/To: la hoja tiene PRECIO_DESDE/PRECIO_HASTA; la tabla no las trae.",
    ],
    operations: [
      "num, parte, contenido, prioridad, fechaReq: no hay columna en la tabla operations.",
      "kitHerramental, kitPending: la tabla solo tiene 'kit'; falta confirmar equivalencia.",
      "log, generatedBy, toolChangeFromHerramental/FromKit/ToHerramental/ToKit, comentario, tiempoFallback: no hay columna.",
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
      const name = String(row.nombre == null ? "" : row.nombre).trim();
      if (!name) return;
      if (asBool(row.activo, true)) slice.operators.push(name);
      slice.operatorCapacity[name] = number(row.minutos_capacidad);
      const performance = number(row.rendimiento_pct);
      if (performance > 0) slice.operatorPerformance[name] = clamp(performance, 1, 300);
      if (asBool(row.activo, true)) {
        slice.operatorProfiles[name] = {
          name: name,
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
    };
    (rows || []).forEach(function (row) {
      const key = normalizeCapabilityKey(row.key);
      if (!key) return;
      const ct = String(row.ct == null ? "" : row.ct).trim();
      if (asBool(row.activa, true)) slice.configuredCapabilities.push(key);
      else slice.hiddenCapabilities.push(key);
      slice.capacityModes[key] = String(row.capacidad || "FINITA").toUpperCase();
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

  function mapMachines(rows) {
    // El state identifica la maquina por su NOMBRE (PP_mapMachine_: id = row.ID, y la hoja MAQUINAS
    // guarda el nombre en ID). En Supabase el uuid es 'id' y el nombre es 'nombre'.
    return (rows || []).map(function (row) {
      return { id: String(row.nombre == null ? "" : row.nombre).trim(), active: asBool(row.activa, true) };
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
    return (rows || []).map(function (row) {
      return {
        id: row.id,
        part: String(row.parte || "*"),
        name: row.tipo,
        days: number(row.dias_habiles) || 3,
        active: asBool(row.activo, true),
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

    return {
      source: "supabase",
      schemaVersion: "supabase-reader/1",
      catalogs: {
        operators: operatorSlice.operators,
        operatorCapacity: operatorSlice.operatorCapacity,
        operatorPerformance: operatorSlice.operatorPerformance,
        operatorProfiles: operatorSlice.operatorProfiles,
        configuredCapabilities: capabilitySlice.configuredCapabilities,
        hiddenCapabilities: capabilitySlice.hiddenCapabilities,
        capacityModes: capabilitySlice.capacityModes,
        customCapabilities: [],
        cts: cts,
        operationCatalog: mapOperationCatalog(rows.operation_catalog),
        matrix: mapMatrix(rows.matrix),
        machines: mapMachines(rows.machines),
        otTypes: mapOtTypes(rows.ot_types),
        subcontracts: mapSubcontracts(rows.subcontracts),
      },
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
    isConfigured: isConfigured,
    readTable: readTable,
    countTable: countTable,
    status: status,
    readCatalogs: readCatalogs,
    normalizeCapabilityKey: normalizeCapabilityKey,
    normalizeKey: normalizeKey,
    TABLES: TABLES,
    CATALOG_TABLES: CATALOG_TABLES,
    MAPPING_GAPS: MAPPING_GAPS,
  };
});
