/**
 * REEMPLAZO DEL PUENTE DE APPS POR SUPABASE.
 *
 * Este modulo reemplaza todas las llamadas al puente de Apps Script con
 * lecturas/escrituras directas a Supabase. Es la unica fuente de datos.
 *
 * Cada funcion replica el contrato del metodo del puente que reemplaza,
 * devolviendo datos en el mismo formato que la app espera.
 */
(function initSupabaseBridgeReplacement(root, factory) {
  "use strict";

  const api = factory(root);
  if (root) root.PPSupabaseBridgeReplacement = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function supabaseBridgeReplacementFactory(root) {
  "use strict";

  const reader = root.PPSupabaseReader;
  const writer = root.PPSupabaseWriter;

  function getReader() {
    if (!reader || typeof reader.readTable !== "function") {
      throw new Error("PPSupabaseReader no esta disponible");
    }
    return reader;
  }

  function getWriter() {
    if (!writer || typeof writer.guardarPlan !== "function") {
      throw new Error("PPSupabaseWriter no esta disponible");
    }
    return writer;
  }

  /**
   * El nucleo de inspeccion. MEDIDO 2026-10-01: el reemplazo se necesita para ARMAR el
   * detalle de una OT (el emparejamiento de tramos y dibujos, las cuatro reglas), y esa
   * parte vive en `InspectionCore` porque es pura y se puede probar con filas sueltas, sin
   * abrir la base. Por eso se pide por `root` en el momento de usar y no en el cierre del
   * modulo: el orden de los scripts dentro del bundle pone al lector y al escritor antes
   * que a este archivo, pero `InspectionCore` va en la pagina y este modulo tambien se
   * carga en otros contextos (las pruebas lo levantan solo), y un `undefined` capturado en
   * el cierre seeria un fallo que solo aparece en uno de los dos.
   */
  function getInspectionCore() {
    const core = root.InspectionCore;
    if (!core || typeof core.inspectionDetail !== "function") {
      throw new Error(
        "InspectionCore no esta disponible, y es quien empareja los tramos y los dibujos de la OT: "
        + "sin el no se puede armar el detalle de inspeccion. No es un problema de Supabase ni de la sesion."
      );
    }
    return core;
  }

  /**
   * QUE ESTADO CUENTA COMO ABIERTA. MEDIDO 2026-10-01.
   *
   * El camino viejo lo decidia NetSuite: `getInspectionWorkOrders` pasaba
   * `onlyOpen: true` al RESTlet 2244 (16-inspection-service.js:141) y esa regla NO esta
   * escrita en ningun archivo de este repo, porque vive en el RESTlet. La unica lista de
   * estados cerrados que hay aqui es la de `confirmWorkOrderClosures`, que es la que la
   * pagina usa para preguntarle "¿esta cerrada?" a una OT, y por eso es la que se usa
   * tambien para armar la lista de inspeccion. Se declara en una constante compartida
   * porque son DOS preguntas sobre el mismo dato —si la OT sigue abierta— y dos listas
   * distintas harían que la pagina mostrara una OT en la hoja de inspeccion y preguntara
   * al rato si está cerrada.
   */
  const ESTADOS_CERRADOS = ["CERRADA", "CERRADO", "CLOSED", "COMPLETADA", "COMPLETADO", "CANCELADA", "CANCELADO"];

  /**
   * fetchNetSuiteWorkOrdersLite -> lee de work_orders
   * Devuelve { workOrders, syncedAt, savedAt, previewComplete }
   */
  async function fetchNetSuiteWorkOrdersLite() {
    const r = getReader();
    const rows = await r.readTable("work_orders", { order: "ot.asc" });
    const workOrders = r.mapWorkOrders(rows);
    const now = new Date().toISOString();
    return {
      workOrders,
      syncedAt: now,
      savedAt: now,
      previewComplete: true,
    };
  }

  /**
   * getPlanningWorkOrderDataBatch -> lee de operations y materials
   * Devuelve { ok, data: [{ ot, ok, data: { operations, materials, workOrder } }] }
   */
  async function getPlanningWorkOrderDataBatch(ots) {
    const r = getReader();
    const otList = Array.isArray(ots) ? ots : [];
    if (!otList.length) return { ok: true, data: [] };

    const operations = await r.readTable("operations", {
      filters: otList.length === 1 ? { ot: otList[0] } : undefined,
      order: "ot.asc,secuencia.asc",
    });
    const materials = await r.readTable("materials", {
      order: "ot.asc",
    });
    const workOrders = await r.readTable("work_orders", {
      order: "ot.asc",
    });

    const opsByOt = {};
    (operations || []).forEach((op) => {
      const key = String(op.ot || "").trim();
      if (!key) return;
      if (!opsByOt[key]) opsByOt[key] = [];
      opsByOt[key].push(op);
    });
    const matsByOt = {};
    (materials || []).forEach((mat) => {
      const key = String(mat.ot || "").trim();
      if (!key) return;
      if (!matsByOt[key]) matsByOt[key] = [];
      matsByOt[key].push(mat);
    });
    const woByOt = {};
    (workOrders || []).forEach((wo) => {
      const key = String(wo.ot || "").trim();
      if (!key) return;
      woByOt[key] = wo;
    });

    const data = otList.map((ot) => {
      const key = String(ot || "").trim();
      const ops = opsByOt[key] || [];
      const mats = matsByOt[key] || [];
      const wo = woByOt[key] || null;
      return {
        ot,
        ok: true,
        data: {
          operations: r.mapOperations(ops),
          materials: r.mapMaterials(mats),
          workOrder: wo ? r.mapWorkOrders([wo])[0] : null,
        },
      };
    });
    return { ok: true, data };
  }

  /**
   * getPlanningWorkOrderData -> lee de operations y materials para una OT
   * Devuelve { ok, data: { operations, materials, workOrder } }
   */
  async function getPlanningWorkOrderData(ot) {
    const r = getReader();
    const key = String(ot || "").trim();
    if (!key) return { ok: false, error: "OT requerida" };

    const operations = await r.readTable("operations", {
      filters: { ot: key },
      order: "secuencia.asc",
    });
    const materials = await r.readTable("materials", {
      filters: { ot: key },
    });
    const workOrders = await r.readTable("work_orders", {
      filters: { ot: key },
    });

    return {
      ok: true,
      data: {
        operations: r.mapOperations(operations),
        materials: r.mapMaterials(materials),
        workOrder: workOrders.length ? r.mapWorkOrders(workOrders)[0] : null,
      },
    };
  }

  /**
   * syncNetSuiteWorkOrders -> lee de work_orders
   */
  async function syncNetSuiteWorkOrders() {
    return fetchNetSuiteWorkOrdersLite();
  }

  /**
   * syncNetSuitePlant -> lee de catalogos (operators, capabilities, etc.)
   */
  async function syncNetSuitePlant() {
    const r = getReader();
    const catalogs = await r.readCatalogs();
    return {
      ...catalogs,
      source: "supabase",
    };
  }

  /**
   * syncNetSuitePlanningData -> lee de operations y materials
   */
  async function syncNetSuitePlanningData() {
    const r = getReader();
    const operations = await r.readTable("operations", { order: "ot.asc,secuencia.asc" });
    const materials = await r.readTable("materials", { order: "ot.asc" });
    return {
      operations: r.mapOperations(operations),
      materials: r.mapMaterials(materials),
      source: "supabase",
    };
  }

  /**
   * confirmWorkOrderClosures -> lee de work_orders para confirmar estatus
   * Devuelve { results: { [ot]: { ot, found, closed, status } } }
   */
  async function confirmWorkOrderClosures(ots) {
    const r = getReader();
    const otList = Array.isArray(ots) ? ots : [];
    if (!otList.length) return { results: {}, asked: 0 };

    const workOrders = await r.readTable("work_orders", { order: "ot.asc" });
    const woByOt = {};
    (workOrders || []).forEach((wo) => {
      const key = String(wo.ot || "").trim();
      if (key) woByOt[key] = wo;
    });

    const results = {};
    otList.forEach((ot) => {
      const key = String(ot || "").trim();
      const wo = woByOt[key];
      if (wo) {
        const status = String(wo.estatus || "").toUpperCase();
        const closed = ESTADOS_CERRADOS.includes(status);
        results[key] = { ot: key, found: true, closed, status: wo.estatus };
      } else {
        results[key] = { ot: key, found: false, closed: false, status: "" };
      }
    });
    return { results, asked: otList.length };
  }

  /**
   * getInspectionWorkOrder -> lee de work_orders para inspeccion
   * Devuelve { ok, data: { workOrder: { quantity, builtQuantity, pendingQuantity, status } } }
   */
  async function getInspectionWorkOrder(ot) {
    const r = getReader();
    const key = String(ot || "").trim();
    if (!key) return { ok: false, error: "OT requerida" };

    const rows = await r.readTable("work_orders", { filters: { ot: key } });
    if (!rows.length) return { ok: false, error: "OT no encontrada" };

    const wo = r.mapWorkOrders(rows)[0];
    return {
      ok: true,
      data: {
        workOrder: {
          quantity: wo.quantity,
          builtQuantity: wo.builtQuantity,
          pendingQuantity: wo.pendingQuantity,
          status: wo.status,
        },
      },
    };
  }

  /**
   * getInspectionWorkOrders -> la lista de OTs ABIERTAS para el selector de la hoja.
   *
   * MEDIDO 2026-10-01, POR QUE ESTA NO EXISTIA. `loadList` (inspection-app.js:75) la
   * pedia por `call("getInspectionWorkOrders")`, o sea por el puente de Apps Script, que
   * esta deshabilitado (RULE-SUP-029). `call` devuelve una promesa rechazada y la
   * pagina no podia ni hacer la lista: la pestana de inspeccion abria sin una sola OT,
   * sin error visible y sin poder imprimir nada. No era un dato faltante: la funcion
   * estaba en 16-inspection-service.js:139 y no tiene a quien llamar.
   *
   * QUE DEVUELVE. `{ ok: true, data: [{ wo, article, description, quantity, status,
   * dueDate }] }`, la forma de la hoja, que es la que consume `optionLabel` y el filtro
   * de `renderList`. Se manda `ok` porque `loadList` hace `if (!result?.ok) throw new
   * Error(result?.error)` y un fallo tiene que ser legible.
   *
   * LA LISTA COMPLETA Y EL FILTRO EN MEMORIA. Se piden todas las `work_orders` y se
   * filtra por estatus aca, no con un filtro en la URL. MEDIDO 2026-10-01: la pagina ya
   * trae cientos de filas de `work_orders` por `fetchNetSuiteWorkOrdersLite`, asi que la
   * tabla entera cabe comodo; y un `estatus=not.in.(...)` en el query es una regla de
   * estados metida en una URL, donde no se puede leer ni probar sin abrir la red. Con el
   * filtro aca, "que es una OT abierta" queda escrito en una linea y el mismo filtro
   * puede probarse con filas sueltas.
   *
   * POR QUE NO SE USA EL CACHE DE `bundleCache`. El de `inspection-app.js` es por OT y
   * de 5 minutos; esta lista no tiene ninguno y se relee en cada `loadList`, que solo
   * corre al abrir la pestana o al cambiar el filtro de la URL. Con la lista en memoria
   * una recarga de pagina trae el estado actual, que es lo que hace falta para NO
   * imprimir una OT que alguien acaba de cerrar.
   */
  async function getInspectionWorkOrders() {
    const r = getReader();
    const rows = await r.readTable("work_orders", { order: "ot.asc" });
    const data = r.mapWorkOrders(rows || [])
      .filter((wo) => !ESTADOS_CERRADOS.includes(String(wo.status || "").trim().toUpperCase()))
      .map((wo) => ({
        wo: wo.ot,
        article: wo.item,
        description: wo.description,
        quantity: wo.quantity,
        status: wo.status,
        dueDate: wo.dueDate,
      }))
      .filter((item) => Boolean(item.wo));
    return { ok: true, data: data };
  }

  /**
   * getInspectionWorkOrderBundle -> el detalle de UNA OT: `work_orders`, `materials`,
   * `operations`, el catalogo de tramos y el historial de impresiones.
   *
   * MEDIDO 2026-10-01, LA FORMA ESTABA ROTA Y NADIE LA LEIA. Antes devolvia
   * `{ workOrder, materials, drawing }`, plano. Los DOS consumidores leen `bundle.detail`:
   *   - `loadDetail` (inspection-app.js:547) haria `state.detail = bundle.detail`, que
   *     con esa forma es `undefined`, y `renderDetail` saldria en su primer `if (!detail)
   *     return`. O sea que la hoja de inspeccion se quedaria en blanco.
   *   - `drawingFromBundle` (planning/app.js:8555) haria `bundle?.detail || {}` y
   *     devolveria `""` siempre, o sea que el boton de abrir el dibujo de la OT en la
   *     pagina de planeacion NUNCA abria y caia siempre al segundo intento, por rutas.
   * Y `loadDetail` ademas leia `bundle.history`, que no existia. Ahora devuelve
   * `{ detail, history }`: la forma de `getInspectionWorkOrderBundle` de Apps Script
   * (17-inspection-drawing-service.js:10), que es la que los dos consumidores ya
   *imentaryon. Se cambia la forma de un reemplazo para que coincida con el contrato
   * original, que es lo unico que no se negocia.
   *
   * LAS CUATRO SEGUNDAS FUENTES, Y POR QUE NO SE ADELANTAN. `operations`,
   * `materials`, `work_orders` e `inventory` se piden en paralelo con `Promise.all`:
   * son cuatro fuentes y no dependen entre si. `inspection_routes` y
   * `inspection_history` se piden FUERA, antes, porque las dos pueden no existir todavia
   * (sus DDL siguen sin aplicar) y una de ellas no debe tumbar el detalle entero: sin
   * `inspection_routes` la hoja sale sin tramos y lo dice; sin `inspection_history` el
   * historial sale vacio y lo dice. Sin `work_orders` no hay ni folio, asi que ahi si
   * se deja caer.
   *
   * QUE DEVUELVA `history` CUANDO LA TABLA NO ESTA. `{ ok: false, error }` con el
   * nombre de la tabla y el del DDL que la crea. NO un historial vacio con `ok: true`:
   * MEDIDO 2026-10-01 en las demas tablas, con la clave publica y sin sesion la Data API
   * responde HTTP 200 con CERO filas, y un historial que se lee "vacio" sin decir por que
   * parece que nadie ha impreso nunca, que es justo lo contrario de lo que pasa.
   * `renderHistory` se modifico para que pinte ese error en vez de un 0.
   *
   * `options.forceRefresh` SE ACEPTA Y SE IGNORA EN LA FORMA PERO NO EN EL HECHO. En
   * Apps Script el flag saltaba el `CacheService` del servidor. En la pagina el cache es
   * de `inspection-app.js` (`bundleCache`, 5 minutos) y este reemplazo no tiene ninguno:
   * el bundle se arma de tablas que no se cachean. El parametro se acepta para no romper
   * el contrato de quien lo llama, y el refresco real lo decide el cache de la pagina
   * (`requestBundle(wo, true)` no lee cache).
   */
  async function getInspectionWorkOrderBundle(ot, options) {
    const r = getReader();
    const core = getInspectionCore();
    const key = String(ot || "").trim();
    if (!key) return { ok: false, error: "OT requerida" };

    const workOrders = await r.readTable("work_orders", { filters: { ot: key } });
    const fila = workOrders && workOrders[0];
    if (!fila) return { ok: false, error: `OT ${key} no esta en work_orders` };

    // Los tramos y el historial, antes, y por separado: cada uno puede faltar y cada
    // falta se reporta distinta. Ver el comentario de arriba.
    const rutas = await leerInspectionRoutesConAviso();
    const historial = await leerInspectionHistoryConAviso(r, key);
    // Los materiales ANTES que `inventory`, y no en el mismo `Promise.all`: la consulta de
    // `inventory` necesita la lista de items para filtrar por `in.(...)`, o sea que depende
    // de estos materiales. Pedirlo en paralelo obligaria a traer TODA la tabla de inventario y
    // a filtrar en memoria, que son miles de filas para usar unas decenas. Y es la UNICA
    // lectura de `materials` del bundle: leerla dos veces (una para la lista de items y otra
    // para el detalle) daria un detalle con la mitad de los materiales si la segunda saliera
    // incompleta, y un material sin leer es un material sin tramo y sin disponible en una
    // hoja que parece completa.
    const materials = await leerMaterialesDeLaOt(r, key);
    const compones = (fila.articulo ? [String(fila.articulo).trim()] : [])
      .concat(materials.map((material) => String(material.componente || "").trim()))
      .filter(Boolean);

    const [operations, inventario] = await Promise.all([
      r.readTable("operations", { filters: { ot: key }, order: "secuencia.asc" }),
      leerDisponibles(r, compones),
    ]);

    const detail = core.inspectionDetail({
      workOrder: r.mapWorkOrders([fila])[0],
      materials: r.mapMaterials(materials),
      operations: r.mapOperations(operations),
      routes: rutas.indice,
      disponibles: inventario,
    });
    // MEDIDO 2026-10-01: el aviso de los tramos viaja con el detalle y no con el
    // historial, porque es del detalle. `routesFuente`/`routesAviso` son los nombres que
    // ya usaba `getInspectionWorkOrder` de Apps Script (17-inspection-drawing-service.js:189).
    detail.routesFuente = rutas.fuente;
    detail.routesAviso = rutas.aviso;
    return { ok: true, data: { detail: detail, history: historial } };
  }

  /**
   * Los materiales de la OT, y por que van en una lectura propia.
   *
   * No lleva `limit` porque el filtro por `ot` ya acota, y un material que se quedara
   * fuera por un limite seria un material sin tramo y sin disponible en una hoja que
   * parece completa. El orden es por componente para que el orden de la hoja sea estable
   * entre recargas, que es lo que permite comparar dos impresiones de la misma OT.
   */
  async function leerMaterialesDeLaOt(r, ot) {
    const rows = await r.readTable("materials", { filters: { ot: ot }, order: "componente.asc" });
    return Array.isArray(rows) ? rows : [];
  }

  /**
   * El indice de tramos, y si se pudo leer de verdad.
   *
   * MEDIDO 2026-10-01, POR QUE NO HAY PLAN B. La version de Apps Script (16) tiene un
   * plan B: si Supabase no responde, lee la hoja `Tramos` y devuelve `fuente: 'hoja'` con
   * un aviso, porque la hoja es el respaldo y todavia esta ahi. Aca NO se puede copiar
   * ese plan B: la hoja se leia por Apps Script y el puente esta deshabilitado
   * (RULE-SUP-029). O sea que el plan B de la pagina no es "la hoja", es "cargar el
   * catalogo una vez a mano" (PP_migrarTramosASupabase_, 16-inspection-service.js:352).
   * Sin tabla, lo unico honesto es devolver el catalogo vacio Y DECIRLO, para que quien
   * imprime sepa que los tramos que ve son los de la fila de la OT, no los del catalogo.
   */
  async function leerInspectionRoutesConAviso() {
    const r = getReader();
    const core = getInspectionCore();
    if (typeof r.readInspectionRoutes !== "function") {
      return {
        indice: core.inspectionRoutesIndex([]),
        fuente: "ninguna",
        aviso: "Este build no trae PPSupabaseReader.readInspectionRoutes, asi que los tramos no se pueden leer de inspection_routes",
      };
    }
    try {
      const filas = await r.readInspectionRoutes();
      return { indice: core.inspectionRoutesIndex(filas || []), fuente: "supabase", aviso: "" };
    } catch (error) {
      // MEDIDO 2026-10-01 en las otras tablas: sin sesion la Data API responde 200 con
      // CERO filas en vez de un error, y con el DDL sin aplicar responde 404 con
      // "Could not find the table ... in the schema cache". Los dos casos son "no hay
      // catalogo", y el aviso los nombra para que no haya que adivinar.
      const crudo = String((error && error.message) || error);
      const faltaDdl = /Could not find the table|schema cache|PGRST205/i.test(crudo);
      return {
        indice: core.inspectionRoutesIndex([]),
        fuente: "ninguna",
        aviso: faltaDdl
          ? "La tabla inspection_routes no existe todavia: aplica docs/schema-inspection-routes.sql y corre PP_migrarTramosASupabase_ una vez. Los tramos que ves son los de la fila de la OT, no los del catalogo."
          : `No se pudo leer inspection_routes (${crudo}). Los tramos que ves son los de la fila de la OT, no los del catalogo.`,
      };
    }
  }

  /**
   * El historial de impresiones de una OT, o el motivo por el que no se pudo leer.
   *
   * La tabla es NUEVA (docs/schema-inspection-history.sql) y es la razon de que este
   * helper devuelva dos cosas y no una: hasta que el DDL este aplicado no hay historial
   * en ningun sitio, y eso hay que decirlo en la pagina. Antes de esta tabla el historial
   * vivia en la hoja `HISTORIAL_IMPRESION_INSPEC` y no se perdia nada al no leerlo,
   * porque se leia de la hoja; ahora que la lectura es de la base, "no pude leer" y "no
   * hay ninguna impresion" son dos respuestas distintas y tienen que verse distintas.
   */
  async function leerInspectionHistoryConAviso(r, ot) {
    if (typeof r.readInspectionHistory !== "function") {
      return { ok: false, error: "Este build no trae PPSupabaseReader.readInspectionHistory, asi que el historial de impresiones no se puede leer" };
    }
    try {
      const data = await r.readInspectionHistory(ot);
      return { ok: true, data: data };
    } catch (error) {
      const crudo = String((error && error.message) || error);
      const faltaDdl = /Could not find the table|schema cache|PGRST205/i.test(crudo);
      return {
        ok: false,
        error: faltaDdl
          ? "La tabla inspection_history todavia no existe, asi que no hay historial de impresiones que mostrar. Se crea con docs/schema-inspection-history.sql; las impresiones que se hagan desde ahora tampoco se guardan hasta entonces."
          : `No se pudo leer el historial de impresiones (${crudo}). Puede que haya impresiones registradas que no se estan viendo.`,
      };
    }
  }

  /**
   * `inventory.disponible` por ITEM, sumando todas sus ubicaciones.
   *
   * POR QUE SE SUMA. La columna es `ail.quantityavailable` de NetSuite POR UBICACION
   * (docs/schema-supabase-sync-netsuite.sql:100) y la clave natural de la fila es
   * `(item, ubicacion)`, o sea que un item con dos filas NO es un dato duplicado: son dos
   * lugares de la planta. Tomar solo la primera seria pedir la disponibilidad de un
   * almacen y creyendo que es la de la planta.
   *
   * `fisico`, `comprometido`, `pickeado` y `en_transito` NO se suman. MEDIDO 2026-10-01:
   * `pickeado` se queda en 0 a proposito y sin fuente declarada en el propio DDL
   * (RULE-SUP-009), y los otros tres no son lo que la hoja de inspeccion llamaba
   * `disponible`. Sumarlos seria cambiar la definicion del dato.
   *
   * EL FILTRO. Va por `item=in.(...)`, que es lo que hace `restUrl` con el objeto de
   * filtros. Con la lista vacia NO se llama a la red: `in.()` con un parentesis vacio es
   * un error de sintaxis de PostgREST, y una OT sin materiales es un caso normal (una OT
   * que no tiene lista de materiales), no un error.
   */
  async function leerDisponibles(r, items) {
    const codigos = Array.from(new Set(items.filter(Boolean)));
    const disponibles = {};
    if (!codigos.length) return disponibles;
    // El limite de PostgREST sobre el numero de valores de un `in.`: los items de una
    // OT con BOM grande pueden pasar de cien. Se parte en tandas de 50 porque es el
    // tope que la propia Data API acepta con holgura en la practice y ninguna consulta
    // de una sola OT se acerca a las tres tandas.
    for (let i = 0; i < codigos.length; i += 50) {
      const tanda = codigos.slice(i, i + 50);
      const filas = await r.readTable("inventory", {
        select: "item,disponible",
        filters: { item: `in.(${tanda.join(",")})` },
      });
      (filas || []).forEach((fila) => {
        const item = String(fila.item == null ? "" : fila.item).trim();
        if (!item) return;
        disponibles[item] = (disponibles[item] || 0) + (Number(fila.disponible) || 0);
      });
    }
    return disponibles;
  }

  /**
   * getInspectionHistory -> el historial de impresiones de una OT.
   *
   * No lo pedia nadie todavia: la pagina lo recibia DENTRO del bundle (`bundle.history`),
   * que es como lo montaba `getInspectionWorkOrderBundle` de Apps Script. Se agrega
   * aparte por una razon concreta: `recordInspectionPrint` acaba de registrar una
   * impresion y la lista que se ve al lado ("Ultima impresion") seguia diciendo la
   * anterior hasta que se recargaba la OT entera. Con esta funcion, quien imprime puede
   * releer solo el historial —una lectura, no un bundle con operaciones y materiales— y
   * ver la impresion que acaba de hacer.
   */
  async function getInspectionHistory(ot) {
    const r = getReader();
    const key = String(ot || "").trim();
    if (!key) return { ok: false, error: "OT requerida" };
    return leerInspectionHistoryConAviso(r, key);
  }

  /**
   * recordInspectionPrint -> INSERTA una fila en `inspection_history`.
   *
   * MEDIDO 2026-10-01, POR QUE EXISTIA ESTA Y NO LA HABIA. `printInspection`
   * (inspection-app.js:565) la pedia por `call(...)` y por ahi salia a la hoja
   * `HISTORIAL_IMPRESION_INSPEC`. Con el puente deshabilitado (RULE-SUP-029) el registro
   * NUNCA se guardaba, y como la app lo trata como no bloqueante (pregunta "¿Imprimir de
   * todos modos?"), la impresion salia y no quedaba rastro: el historial era un historial
   * SIN LUGAR. No se notaba porque el "no se pudo guardar" solo aparecia en un confirm.
   *
   * QUE DEVUELVE. `{ ok, data, avisos }`. `ok: false` NO es una excepcion: la pagina
   * decide con un `if (!result?.ok && !root.confirm(...))` y una excepcion obligaria a un
   * try/catch alrededor de la impresion, que es justo el camino que no debe romperse por
   * un historial. El error que se devuelve, cuando lo hay, nombra la tabla y el DDL, para
   * que el confirm diga por que y no "Error desconocido".
   *
   * EL PAYLOAD NO SE TRADUCE AQUI. Se pasa tal cual a `guardarInspectionPrint`, que es
   * quien decide de que columna sale cada valor (supabase-writer.js:1218-1240). Repartir
   * las doce columnas entre los dos pasos daria el doble de lugares donde una columna
   * puede quedar mal; que las doce esten documentadas en un solo sitio, junto a la
   * escritura, es lo que hace que se pueda cambiar una sin romper la otra.
   */
  async function recordInspectionPrint(payload) {
    const w = writer;
    if (!w || typeof w.guardarInspectionPrint !== "function") {
      throw new Error("PPSupabaseWriter.guardarInspectionPrint no existe: este build no trae el escritor de inspection_history, asi que las impresiones se van a imprimir sin quedar registradas");
    }
    const informe = await w.guardarInspectionPrint(payload || {});
    if (!informe || !informe.ok) {
      const motivo = (informe && (informe.motivo
        || (informe.tablas && informe.tablas.inspection_history && informe.tablas.inspection_history.error)))
        || "sin motivo";
      return { ok: false, error: motivo, avisos: (informe && informe.avisos) || [] };
    }
    const guardada = informe.fila || {};
    return {
      ok: true,
      avisos: informe.avisos || [],
      data: {
        wo: guardada.ot || "",
        folio: guardada.ot || "",
        recordedAt: guardada.fecha_hora || "",
        printedAt: guardada.fecha_hora || "",
      },
    };
  }

  /**
   * getInspectionDrawingRoutes -> lee el catalogo de TRAMOS en `inspection_routes`.
   *
   * QUE CAMBIO Y POR QUE (MEDIDO 2026-10-01). Antes leia `materials` y devolvia
   * `{ ARTICULO, MATERIAL, DIBUJO }` con `DIBUJO = row.dibujo || row.foto_url`. Eso
   * NO eran los tramos: `materials` es una tabla DEL ERP (la escribe el RESTlet
   * 2246 cada 15 minutos) y no tiene columna de tramo. La tabla de Catalogos
   * mostraba la columna "Tramo" VACIA siempre, porque el mapeo no traia TRAMO, y
   * en su lugar enseñaba el dibujo de un material. El catalogo de verdad estaba en
   * la hoja `Tramos` del libro INSPECTION_SPREADSHEET_ID y no llegaba a la pagina.
   * Ahora esta en `inspection_routes` (docs/schema-inspection-routes.sql), con la
   * pagina como unica escritora.
   *
   * DEVUELVE LAS DOS COSAS QUE LA PAGINA PIDE. `TRAMO` y `DIBUJO` estan los dos,
   * con los dos aliases (mayusculas, que es como los nombraba Apps Script, y
   * minusculas, que es como los nombra el nucleo de inspeccion) porque
   * InspectionCore.inspectionRouteRows acepta cualquiera de los dos. Mandar solo
   * uno obliga a elegir, y el que no se mande se ve como columna vacia.
   *
   * `partLabel` filtra por ARTICULO, con la misma regla laxa que el servidor
   * (PP_Inspection_routeLooseKey_: sin acentos y sin puntuacion) para que filtrar
   * "A-100" encuentre tambien la fila de "a100". Con vacio sale todo, que es lo que
   * pide la tabla de Catalogos.
   */
  async function getInspectionDrawingRoutes(partLabel) {
    const r = getReader();
    if (typeof r.readInspectionRoutes !== "function") {
      throw new Error("PPSupabaseReader.readInspectionRoutes no existe: este build no trae la tabla inspection_routes");
    }
    const todas = await r.readInspectionRoutes();
    const laxo = (value) => String(value == null ? "" : value)
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const parte = laxo(partLabel);
    const data = (todas || [])
      .filter((row) => !parte || laxo(row.articulo).includes(parte))
      .map((row) => ({
        ARTICULO: row.articulo,
        MATERIAL: row.material,
        TRAMO: row.tramo,
        DIBUJO: row.dibujo,
        ACTUALIZADO: row.actualizado,
        CLAVE: row.clave,
      }));
    return { ok: true, data };
  }

  /**
   * saveInspectionLink -> guarda el TRAMO en `inspection_routes`.
   *
   * QUE CAMBIO Y POR QUE (MEDIDO 2026-10-01). Antes escribia `materials` con
   * `{ ot, line_id, dibujo: drawing || route }`: un tramo de inspeccion terminaba
   * en la columna de DIBUJO de una tabla de materiales del ERP, que el RESTlet
   * 2246 sobreescribe cada 15 minutos, o sea que perderlo era question de tiempo.
   * Y no funcionaba: `getWriter()` exige `writer.guardarPlan`, y PPSupabaseWriter
   * exporta `guardar`. O sea que este camino lanzaba "PPSupabaseWriter no esta
   * disponible" antes de escribir nada, y el tramo no se guardaba en ningun sitio.
   *
   * AHORA. Un solo escritor: PPSupabaseWriter.guardarInspectionRoute, con el
   * token de la sesion. El `ot` y el `line_id` que se mandaban NO van: en la hoja
   * `Tramos` la fila se identifica por (Articulo, Materia prima) y no habia
   * columna de OT. Meterlos seria inventar una clave que el resto del sistema no
   * usa.
   *
   * LO QUE SE MANDA Y LO QUE NO, Y POR QUE. El dialogo de la pagina edita el
   * TRAMO. El DIBUJO de esa fila no se esta tocando, asi que no se manda: si se
   * mandara vacio, cada guardado de tramo borraria el dibujo, que es un dato que
   * existe y que alguien mantiene. La columna se omite del cuerpo y PostgREST no
   * la toca. Si el que llama SI quiere cambiar el dibujo (tiene su propio caso de
   * uso), lo manda con `dibujo` y se escribe.
   *
   * EL DIBUJO QUE SE DEVUELVE. Se devuelve el de la fila YA GUARDADA cuando se
   * conoce, para que `applyInspectionRouteSave` no lo pinte vacio en la tabla
   * despues de guardar un tramo. Si no se conoce, se devuelve el que vino en el
   * payload y `applyInspectionRouteSave` lo deja como estaba.
   */
  async function saveInspectionLink(payload) {
    const w = writer;
    if (!w || typeof w.guardarInspectionRoute !== "function") {
      throw new Error("PPSupabaseWriter.guardarInspectionRoute no existe: este build no trae el escritor de inspection_routes");
    }
    const data = payload || {};
    // MEDIDO 2026-10-01: el payload que llega usa `article`/`material`/`route` en
    // ingles, no `articulo`/`material`/`tramo`. Sale de
    // InspectionCore.inspectionRouteSavePayload (inspection-core.js:67) y del dialogo
    // de la hoja de inspeccion (inspection-app.js), y los dos escriben en ingles
    // aunque la tabla este en espanol. Se aceptan los dos juegos de nombres para no
    // tener que decidir cual es el bueno: lo que se guarda en la tabla es siempre la
    // forma en espanol.
    const cuerpo = {
      articulo: data.article || data.articulo || data.ARTICULO || "",
      material: data.material || data.MATERIAL || "",
      tramo: data.route || data.tramo || data.TRAMO || "",
    };
    if (Object.prototype.hasOwnProperty.call(data, "dibujo") || Object.prototype.hasOwnProperty.call(data, "drawing") || Object.prototype.hasOwnProperty.call(data, "DIBUJO")) {
      cuerpo.dibujo = data.dibujo != null ? data.dibujo : (data.drawing != null ? data.drawing : data.DIBUJO);
    }
    const informe = await w.guardarInspectionRoute(cuerpo);
    if (!informe || !informe.ok) {
      const motivo = (informe && (informe.motivo || (informe.tablas && informe.tablas.inspection_routes && informe.tablas.inspection_routes.error))) || "sin motivo";
      return { ok: false, error: motivo, avisos: (informe && informe.avisos) || [] };
    }
    const guardada = informe.fila || {};
    const fila = {
      articulo: guardada.articulo || cuerpo.articulo,
      ARTICULO: guardada.articulo || cuerpo.articulo,
      material: guardada.material != null ? guardada.material : cuerpo.material,
      MATERIAL: guardada.material != null ? guardada.material : cuerpo.material,
      route: guardada.tramo != null ? guardada.tramo : cuerpo.tramo,
      TRAMO: guardada.tramo != null ? guardada.tramo : cuerpo.tramo,
      updated: guardada.actualizado || "",
      ACTUALIZADO: guardada.actualizado || "",
    };
    // El dibujo SOLO viaja si se mando o si vino guardado. Sin esto, quien edita un
    // tramo sobre una fila que tiene dibujo veria desaparecer el dibujo de la tabla
    // hasta recargar, aunque en la base siga intacto.
    if (guardada.dibujo != null) fila.dibujo = guardada.dibujo;
    else if (Object.prototype.hasOwnProperty.call(cuerpo, "dibujo")) fila.dibujo = cuerpo.dibujo;
    else if (data.drawing != null) fila.drawing = data.drawing;
    else if (data.DIBUJO != null) fila.DIBUJO = data.DIBUJO;
    return { ok: true, data: fila, avisos: informe.avisos || [] };
  }

  /**
   * saveDraftSnapshot -> escribe en plan_snapshots
   * Devuelve { snapshotId, version, ... }
   */
  async function saveDraftSnapshot(payload) {
    const w = getWriter();
    const data = payload || {};
    const snapshotId = data.snapshotId || `snap-${Date.now()}`;
    const result = await w.guardarPlan({
      planSnapshots: [{
        snapshot_id: snapshotId,
        version: data.version || 1,
        plan_start: data.planStart || "",
        status: "BORRADOR",
        payload: JSON.stringify(data),
        generated_at: data.generatedAt || new Date().toISOString(),
      }],
    });
    if (result?.error) throw new Error(result.error);
    return { ...data, snapshotId };
  }

  /**
   * savePlanSnapshot -> escribe en plan_snapshots
   */
  async function savePlanSnapshot(payload) {
    const w = getWriter();
    const data = payload || {};
    const snapshotId = data.snapshotId || `snap-${Date.now()}`;
    const result = await w.guardarPlan({
      planSnapshots: [{
        snapshot_id: snapshotId,
        version: data.version || 1,
        plan_start: data.planStart || "",
        status: data.status || "RESPALDO",
        payload: JSON.stringify(data),
        generated_at: data.generatedAt || new Date().toISOString(),
      }],
    });
    if (result?.error) throw new Error(result.error);
    return { ...data, snapshotId };
  }

  /**
   * publishDraftPlan -> escribe en plan_snapshots con status PUBLICADO
   */
  async function publishDraftPlan(payload) {
    const w = getWriter();
    const data = payload || {};
    const snapshotId = data.snapshotId || `snap-${Date.now()}`;
    const result = await w.guardarPlan({
      planSnapshots: [{
        snapshot_id: snapshotId,
        version: data.version || 1,
        plan_start: data.planStart || "",
        status: "PUBLICADO",
        payload: JSON.stringify(data),
        generated_at: data.generatedAt || new Date().toISOString(),
      }],
    });
    if (result?.error) throw new Error(result.error);
    return { ok: true, activeVersion: { ...data, snapshotId } };
  }

  /**
   * getPlanSnapshot -> lee de plan_snapshots
   */
  async function getPlanSnapshot(snapshotId) {
    const r = getReader();
    const id = String(snapshotId || "").trim();
    if (!id) return null;
    const rows = await r.readTable("plan_snapshots", {
      filters: { snapshot_id: id },
    });
    if (!rows.length) return null;
    const row = rows[0];
    try {
      return JSON.parse(row.payload || "{}");
    } catch {
      return row;
    }
  }

  /**
   * restorePublishedPlanAsDraft -> lee de plan_snapshots y devuelve el estado
   */
  async function restorePublishedPlanAsDraft(snapshotId, previewState) {
    const snapshot = await getPlanSnapshot(snapshotId);
    if (!snapshot) throw new Error("No se encontro la instantanea");
    return {
      state: {
        ...snapshot,
        draftVersionId: snapshotId,
        planStatus: "BORRADOR",
      },
    };
  }

  /**
   * listPlanSnapshots -> lee de plan_snapshots
   */
  async function listPlanSnapshots() {
    const r = getReader();
    const rows = await r.readTable("plan_snapshots", {
      order: "generated_at.desc",
    });
    return (rows || []).map((row) => {
      try {
        return JSON.parse(row.payload || "{}");
      } catch {
        return row;
      }
    });
  }

  /**
   * getPlanSnapshotLight -> lee de plan_snapshots (version ligera)
   */
  async function getPlanSnapshotLight(snapshotId) {
    const r = getReader();
    const id = String(snapshotId || "").trim();
    if (!id) return null;
    const rows = await r.readTable("plan_snapshots", {
      filters: { snapshot_id: id },
    });
    if (!rows.length) return null;
    const row = rows[0];
    try {
      const parsed = JSON.parse(row.payload || "{}");
      return {
        snapshotId: parsed.snapshotId || id,
        version: parsed.version,
        planStart: parsed.planStart,
        status: parsed.status,
        generatedAt: parsed.generatedAt,
        operations: parsed.operations || [],
      };
    } catch {
      return row;
    }
  }

  /**
   * saveOperationPlanStatus -> escribe en operation_plan_statuses
   */
  async function saveOperationPlanStatus(payload) {
    const w = getWriter();
    const data = payload || {};
    const statuses = Array.isArray(data.statuses) ? data.statuses : [data.status].filter(Boolean);
    const result = await w.guardarPlan({
      operationPlanStatuses: statuses.map((s) => ({
        key: s.key || `${s.ot}-${s.sequence}`,
        ot: s.ot || "",
        secuencia: s.sequence || 0,
        status: s.status || "PENDIENTE",
        origin: s.origin || "draft",
        fecha_completado: s.completedAt || null,
        fecha_reapertura: s.reopenedAt || null,
      })),
    });
    return { revision: data.revision, savedAt: new Date().toISOString(), ...result };
  }

  /**
   * getAppState -> lee de Supabase (app_state + catalogos)
   */
  async function getAppState() {
    const r = getReader();
    const catalogs = await r.readCatalogs();
    return {
      ...catalogs,
      source: "supabase",
    };
  }

  /**
   * getAppStateRevision -> la revision del plan, y SOLO eso.
   *
   * MEDIDO 2026-09-30 en produccion. Existia porque el arranque tomaba la revision del MISMO
   * payload que los catalogos, y readCatalogs() lee del orden de 39 tablas. Si una de esas
   * da 404, cae la promesa entera, el arranque se queda con el cache local, y la pagina
   * conserva una revision que nadie verifico: la base estaba en 2 y la pagina en 22, y todo
   * guardado moria con CONFLICT_REVISION para siempre. El 22 venia de la columna revision de
   * la tabla operations (maximo 22), que es la revision de la ingesta del RESTlet, un contador
   * DISTINTO del del plan. Un residuo de la era de las Hojas.
   *
   * La revision del plan vive en app_state, que es una fila y una columna. Se lee aqui, sin
   * tocar ninguna otra tabla, para que la revision sea correcta aunque los catalogos no lo
   * sean. Que una tabla de catálogos decida en que revision esta el plan es la misma clase
   * de error que la que se corrigio en RULE-SUP-031: una compuerta que no era la pregunta.
   */
  async function getAppStateRevision() {
    const r = getReader();
    const rows = await r.readTable("app_state", { limit: 1 });
    const appState = r.mapAppState(rows);
    return { revision: Number(appState?.revision || 0), savedAt: appState?.savedAt || "" };
  }
  /**
   * getAppStateIfChanged -> lee de Supabase y compara revision
   */
  async function getAppStateIfChanged(revision, options) {
    const r = getReader();
    const rows = await r.readTable("app_state", { limit: 1 });
    const appState = r.mapAppState(rows);
    const currentRevision = appState?.revision || 0;
    if (currentRevision === Number(revision || 0)) {
      return { unchanged: true, revision: currentRevision, savedAt: appState?.savedAt || "" };
    }
    const catalogs = await r.readCatalogs();
    return {
      ...catalogs,
      revision: currentRevision,
      savedAt: appState?.savedAt || "",
      source: "supabase",
    };
  }

  /**
   * getMaterialsForOt -> lee de materials
   */
  async function getMaterialsForOt(ot, revision) {
    const r = getReader();
    const key = String(ot || "").trim();
    if (!key) return { materials: [] };
    const rows = await r.readTable("materials", { filters: { ot: key } });
    return { materials: r.mapMaterials(rows) };
  }

  return {
    fetchNetSuiteWorkOrdersLite,
    getPlanningWorkOrderDataBatch,
    getPlanningWorkOrderData,
    syncNetSuiteWorkOrders,
    syncNetSuitePlant,
    syncNetSuitePlanningData,
    confirmWorkOrderClosures,
    getInspectionWorkOrder,
    getInspectionDrawingRoutes,
    // MEDIDO 2026-10-01: las cuatro de la hoja de inspeccion que antes salian por el
    // puente de Apps Script. `getInspectionWorkOrderBundle` cambio de FORMA (a
    // `{detail, history}`, la de 17-inspection-drawing-service.js:10) y no solo de
    // origen: la que estaba, `{workOrder, materials, drawing}` plano, no la leia bien
    // NINGUN consumidor, y eso se explica en el cuerpo de la funcion.
    getInspectionWorkOrders,
    getInspectionWorkOrderBundle,
    getInspectionHistory,
    recordInspectionPrint,
    saveInspectionLink,
    saveDraftSnapshot,
    savePlanSnapshot,
    publishDraftPlan,
    getPlanSnapshot,
    restorePublishedPlanAsDraft,
    listPlanSnapshots,
    getPlanSnapshotLight,
    saveOperationPlanStatus,
    getAppState,
    getAppStateRevision,
    getAppStateIfChanged,
    getMaterialsForOt,
  };
});
