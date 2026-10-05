/**
 * PostgREST FALSO para la sonda web: el mismo origen local, pero atendiendo `/rest/v1/<tabla>` con
 * filas de fixture. Existe porque MEDIDO el 2026-10-05, la sonda estaba midiendo un camino que ya
 * no existe.
 *
 * POR QUE. Con RULE-SUP-030 la pagina NO lee por el puente de Apps Script: lee Supabase directo con
 * `fetch` (`src/web/shared/supabase-reader.js`, `restUrl` + `root.fetch`). La sonda seguia
 * falseando `window.PPAppsScriptBridge` y su guarda anti-produccion cortaba TODA peticion que no
 * fuera de localhost, o sea tambien las 34 del lector: resultado medido, 0 tarjetas, 0 OTs en la
 * cola, 0 llamadas al puente, y la precondicion de arranque abortando la corrida. La ultima
 * corrida verde fue la del 2026-09-27; la del 2026-10-03 fallo igual que hoy.
 *
 * LA REGLA SE RESPETA, NO SE RODEA. La app arranca POR SUPABASE, y lo que se falsea es el
 * ORIGEN, no el camino: `PPSupabaseReader.configure({url})` (el mismo gancho que usa el proyecto
 * para sus pruebas) apunta el LECTOR REAL al PostgREST local. Asi la sonda ejercita el lector de
 * verdad -con sus mappers, sus `MAPPING_GAPS` y su paginacion- en vez de un stub muerto, y sin que
 * nada salga de la maquina: la guarda de aislamiento sigue cortando todo lo que no sea localhost, y
 * lo unico que contesto es este servidor.
 *
 * LO QUE NO SE INVENTA: los nombres de columna salen de los mappers del lector (las expresiones
 * `row.<columna>` de `supabase-reader.js`), no de memoria. `tests/web-probe-supabase.test.mjs`
 * ata cada columna escrita aqui con una que el lector REALmente lee, asi que si el esquema o el
 * lector cambian, esta sonda se cae en vez de servir una tabla con la forma vieja.
 *
 * LAS TABLAS QUE NO TIENEN FIXTURE SE RESPONDEN VACIAS, y una VACIA es una respuesta legitima: es lo
 * que veria una planta que todavia no tiene esos datos. `machine_planning_overrides` se responde
 * 404 a proposito,
 * porque MEDIDO 2026-10-01 esa tabla NO existe en el proyecto y el lector la reporta en `errors` y
 * sigue adelante sin override: falsearla con filas taparia justo ese camino.
 *
 * `plan_guardar` SI SE IMPLEMENTA, y por que. MEDIDO con las reglas del repo: el 2026-09-30
 * contestaba HTTP 400 con 42702 -o sea que EXISTIA (RULE-SUP-025)- y el 2026-10-03 la pagina ya
 * recibia su propio informe con `conflicto: CONFLICT_REVISION` (RULE-GOV-015), que solo puede
 * decir una funcion viva. Ademas es el MISMO DDL el que crea `operation_events`
 * (docs/schema-supabase-plan.sql:126). Contestarle 404 hacia caer al camino viejo, donde el
 * escritor manda `operation_events` tabla por tabla y como no este en el almacen la respuesta era
 * 404: por ahi salio el "No se pudo guardar el plan" de la corrida, y era la sonda=falseando una
 * funcion que en produccion esta. Las columnas que escribe cada tabla se LEEN del DDL
 * (`plan_tabla_escritura`), no de memoria, que es la misma fuente que usa la funcion.
 */

import { readFileSync } from "node:fs";

/** Normaliza una clave de capacidad igual que `normalizeCapabilityKey` del lector. */
function normKey(ct, label) {
  return `${String(ct || "").trim()}::${String(label || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")}`;
}

/**
 * `plan_tabla_escritura` tal como la declara el DDL: tabla -> { modo, clave, columnas }.
 *
 * Se lee del archivo y no se escribe a mano a proposito. La lista es lo que decide QUE columnas
 * puede tocar la pagina: si el DDL agrega una columna y esta copia no se enterara, el falso
 * seguiria dejando pasar (o dejando de pasar) algo que la base real no deja, y la sonda mediria
 * una regla que nadie tiene.
 */
export const PLAN_TABLA_ESCRITURA = leerPlanTablaEscritura();

function leerPlanTablaEscritura() {
  const ddl = readFileSync(new URL("../docs/schema-supabase-plan.sql", import.meta.url), "utf8");
  const desde = ddl.indexOf("insert into public.plan_tabla_escritura");
  if (desde < 0) throw new Error("docs/schema-supabase-plan.sql ya no siembra plan_tabla_escritura");
  const hasta = ddl.indexOf("on conflict (tabla)", desde);
  const cuerpo = ddl.slice(desde, hasta < 0 ? ddl.length : hasta);
  const tabla = {};
  // Cada fila empieza con ('tabla', 'modo', 'clave', array['col', ...], 'nota') y el `array[...]`
  // puede ocupar varias lineas: se toma el trozo hasta la coma que sigue al cierre del corchete.
  const re = /\(\s*'([a-z_]+)'\s*,\s*'([a-z]+)'\s*,\s*'([^']+)'\s*,\s*(null|array\[[\s\S]*?\])\s*,/g;
  for (const hit of cuerpo.matchAll(re)) {
    const [, nombre, modo, clave, columnas] = hit;
    tabla[nombre] = {
      modo,
      clave,
      columnas: /^null/i.test(columnas) ? null : [...columnas.matchAll(/'([a-z_][a-z0-9_]*)'/g)].map((m) => m[1]),
    };
  }
  if (!tabla.operations || !tabla.selected_ots) {
    throw new Error(`no se pudo leer plan_tabla_escritura del DDL (salieron ${Object.keys(tabla).join(", ")})`);
  }
  return tabla;
}

/** Deshace el `CT::LABEL` para poder poner `ct` y `operacion` en sus columnas. */
function partirKey(key) {
  const i = String(key).indexOf("::");
  return i < 0 ? { ct: "", label: "" } : { ct: key.slice(0, i), label: key.slice(i + 2) };
}

const texto = (v) => (v === null || v === undefined ? "" : String(v));
const numero = (v, porDefecto = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : porDefecto;
};
const json = (v) => (v === undefined ? null : JSON.stringify(v === null ? null : v));

/**
 * Las filas de las 26 tablas que la pagina pide al arrancar, en la forma que el LECTOR mapea.
 * `state` es el fixture de `web-fixture.mjs` (un estado de app, no filas): esta funcion es la que
 * traduce el estado a filas, y por eso vive aqui y no en el fixture, para que el fixture siga
 * sirviendo a lo que se sembraba por localStorage.
 */
export function filasDesdeFixture(state) {
  const capabilities = [];
  const matrix = [];
  const operationCatalog = [];
  const ocultas = new Set(state.hiddenCapabilities || []);
  const customKeys = new Set((state.customCapabilities || []).map((c) => c.key));

  for (const [key, operadores] of Object.entries(state.matrix || {})) {
    const { ct, label } = partirKey(key);
    const regla = (state.operationRules || {})[ct] || {};
    for (const operador of operadores) {
      matrix.push({ capability_key: key, operator: operador, habilitado: true });
    }
    capabilities.push({
      key,
      ct,
      activa: !ocultas.has(key),
      capacidad: (state.capacityModes || {})[ct] || "FINITA",
      solapamiento: regla.overlap === undefined ? 1 : regla.overlap,
      eficiencia_pct: regla.efficiency === undefined ? 100 : regla.efficiency,
      palabras_clave: texto(regla.keywords),
      requiere_herramental: Boolean(regla.requiresTool),
      requiere_kit: Boolean(regla.requiresKit),
      custom: customKeys.has(key),
      operacion: texto(label.replace(/_/g, " ")),
    });
    operationCatalog.push({ key, ct, label: texto(label.replace(/_/g, " ")), source: "SISTEMA", active: true });
  }
  // Las capacidades que el estado tiene pero la matriz no: la pagina las ofrece igual.
  for (const extra of state.customCapabilities || []) {
    if (capabilities.some((c) => c.key === extra.key)) continue;
    capabilities.push({
      key: extra.key, ct: texto(extra.ct), activa: extra.active !== false, capacidad: "FINITA",
      solapamiento: 1, eficiencia_pct: 100, palabras_clave: "",
      requiere_herramental: false, requiere_kit: false, custom: true,
      operacion: texto(extra.label),
    });
    operationCatalog.push({ key: extra.key, ct: texto(extra.ct), label: texto(extra.label), source: "SISTEMA", active: true });
  }

  const operations = (state.operations || []).map((op) => ({
    operation_id: texto(op.id),
    ot: texto(op.ot),
    secuencia: numero(op.secuencia),
    ct: texto(op.ct),
    descripcion: texto(op.descripcion),
    operador: texto(op.operador),
    maquina: texto(op.maquina),
    herramental: texto(op.herramental),
    kit: texto(op.kitHerramental),
    cant_total: numero(op.cantTotal),
    cant_pendiente: numero(op.cantPendiente),
    tiempo_ciclo: numero(op.tiempoCiclo),
    tiempo_setup: numero(op.tiempoSetup),
    tiempo_prod: numero(op.tiempoProd),
    tipo_insercion: texto(op.tipoInsercion) || "OPERACION",
    estatus: texto(op.estatus),
    locked: Boolean(op.locked),
    auto_frozen: Boolean(op.autoFrozen),
    subcontract_days: numero(op.subcontractDays),
    retirada_en: texto(op.retiradaEn),
    retirada_por: texto(op.retiradaPor),
    subcontract_type: texto(op.subcontractType),
    fecha_inicio: texto(op.fechaInicio),
    hora_inicio: texto(op.horaInicio),
    fecha_fin: texto(op.fechaFin),
    hora_fin: texto(op.horaFin),
  }));

  const workOrders = (state.workOrders || []).map((wo) => ({
    wo_internal_id: texto(`fake-${wo.ot}`),
    ot: texto(wo.ot),
    articulo: texto(wo.item || wo.parte),
    descripcion: texto(wo.description),
    cantidad: numero(wo.quantity),
    cant_ensamblada: numero(wo.builtQuantity),
    cant_pendiente: numero(wo.pendingQuantity),
    fecha_inicio_ns: null,
    fecha_fin_ns: null,
    fecha_vencimiento: texto(wo.dueDate) || null,
    foto_url: texto(wo.photoUrl),
    estatus: texto(wo.status),
    cliente: texto(wo.cliente),
    precio_promedio_venta: numero(wo.averageSalePrice),
    precio_ultima_venta: numero(wo.lastSalePrice),
  }));

  const tables = {
    app_state: [{
      // `id integer primary key default 1 check (id = 1)`, una sola fila (docs/schema-supabase.sql:258).
      // MEDIDO 2026-10-05: faltaba, y con el `PATCH app_state?id=eq.1` del escritor
      // (supabase-writer.js:1528) el parche no encontraba fila y el guardado del plan se perdia
      // en silencio. El DDL lo declara, asi que no es una columna inventada.
      id: 1,
      revision: numero(state.revision),
      saved_at: new Date().toISOString(),
      synced_at: texto(state.syncedAt) || new Date().toISOString(),
      plan_start: texto(state.planStart),
      horizon_days: numero(state.horizonDays, 7),
      report_week_start: texto(state.reportWeekStart),
      report_filters: json(state.reportFilters || {}),
      settings: json(state.settings || {}),
      plant: json(state.plant || {}),
      operation_catalog_warning: texto(state.operationCatalogWarning),
      last_schedule: json(state.lastSchedule || null),
    }],
    operators: (state.operators || []).map((nombre) => ({
      nombre: texto(nombre),
      nombre_real: texto((state.operatorProfiles || {})[nombre]?.name || nombre),
      activo: true,
      minutos_capacidad: numero((state.operatorCapacity || {})[nombre], 480),
      rendimiento_pct: numero((state.operatorPerformance || {})[nombre], 100),
      categoria: texto((state.operatorProfiles || {})[nombre]?.category || ""),
    })),
    capabilities,
    operation_catalog: operationCatalog,
    matrix,
    machine_catalog: (state.machines || []).map((m) => ({
      nombre: texto(m.name || m.machine),
      activa: true,
      excluida: false,
    })),
    operations,
    work_orders: workOrders,
    selected_ots: (state.selectedOts || []).map((ot, i) => ({ ot: texto(ot), posicion: i + 1 })),
    locked_ots: (state.lockedOts || []).map((ot) => ({ ot: texto(ot) })),
    operation_plan_statuses: Object.entries(state.operationPlanStatuses || {}).map(([key, value]) => {
      const partes = String(key).split("|");
      return {
        key: texto(key),
        ot: texto(partes[1]),
        secuencia: numero(partes[2]),
        ct: texto(partes[3]),
        status: texto(value && value.status),
        origin: texto(value && value.origin),
        fecha_completado: texto(value && value.completedAt) || null,
        fecha_reapertura: texto(value && value.reopenedAt) || null,
      };
    }),
    tools: (state.toolCatalog || []).map((t) => ({
      codigo: texto(t.codigo || t.parte),
      parte: texto(t.parte || t.part),
      herramental: texto(t.herramental),
      kit: texto(t.kit || ""),
      tiempo_ajuste_herr: numero(t.tiempoAjusteHerr),
      tiempo_ajuste_kit: numero(t.tiempoAjusteKit),
      activo: t.active !== false,
    })),
    ot_configurations: Object.entries(state.otConfigurations || {}).map(([ot, cfg]) => ({
      ot: texto(ot),
      maquina: texto(cfg.machine || cfg.maquina),
      herramental: texto(cfg.tool || cfg.herramental || ""),
      kit: texto(cfg.kit || ""),
      kit_pendiente: Boolean(cfg.kitPending),
      tipo_subcontrato: texto(cfg.subcontractType || ""),
      dias_subcontrato: numero(cfg.subcontractDays),
    })),
    article_configurations: Object.entries(state.articleConfigurations || {}).map(([articulo, cfg]) => ({
      articulo: texto(articulo),
      tipo_ot: texto(cfg.otType || ""),
      tipo_trabajo: texto(cfg.workType || ""),
      precio_manual: numero(cfg.manualUnitPrice),
      precio_ref_venta: numero(cfg.referencePrice),
    })),
    materials: (state.materials || []).map((m, i) => ({
      ot: texto(m.ot),
      wo_internal_id: texto(`fake-${m.ot}`),
      ensamble: texto(m.item),
      componente_id: texto(m.component),
      componente: texto(m.component),
      descripcion: texto(m.description || ""),
      unidad: texto(m.unit || "PZA"),
      requerido: numero(m.required),
      emitido: numero(m.issued),
      pendiente: numero(m.pending),
      // `line_id` es el `comp.id` de NetSuite y SIEMPRE entero (RULE-SUP-047). Aqui se inventa uno
      // por renglon porque el fixture no lo trae: lo que importa para el lector es el TIPO.
      line_id: i + 1,
    })),
    // Tablas que el fixture no alimenta. Vacia es una respuesta legitima (planta sin esos datos).
    ot_types: [],
    subcontracts: [],
    calendar_exceptions: [],
    inventory: [],
    items: [],
    sales_orders: [],
    plan_snapshots: [],
    unconfirmed_work_orders: [],
    closed_work_order_summaries: [],
    inspection_routes: [],
    inspection_history: [],
    // `operation_events` la crea EL MISMO DDL que `plan_guardar`
    // (docs/schema-supabase-plan.sql:126), asi que en produccion existe. Va vacia porque el
    // fixture no siembra eventos, y se declara aunque asi sea porque el ESCRITOR la usa: en el
    // camino viejo manda un POST POR EVENTO (`escribirEventos`, supabase-writer.js:1555). Sin la
    // fila, el falso le contestaba 404 y el guardado entero se perdia con
    // "operation_events: se omitieron N evento(s)", que era un defecto de la sonda, no del plan.
    operation_events: [],
  };
  return tables;
}

/**
 * Las tablas que en el proyecto SUPABASE NO EXISTEN y por eso el lector las reporta en `errors` y
 * sigue sin el dato. MEDIDO 2026-10-01 con `.openchamber/diag-supabase-todas.mjs`: la creaba
 * `docs/schema-supabase-cierre-catalogos.sql`, que sigue sin aplicar. Servirla con filas taparia
 * el camino; servirla con 404 es lo que pasa en produccion.
 */
export const TABLAS_INEXISTENTES = ["machine_planning_overrides"];

/**
 * `plan_guardar` en el falso, con la misma forma que la del DDL
 * (`docs/schema-supabase-plan.sql:660-900`). NO es una simulacion del guardado: es el guardado,
 * con las MISMAS reglas que decides por tabla en `plan_tabla_escritura`.
 *
 *   1. `app_state` bloqueado y revision comparada. Si no coincide: `{ok:false, conflicto:
 *      CONFLICT_REVISION, revision_actual}` y NO se escribe nada. Es la regla que hace que dos
 *      pestanas no se pisen, y si el falso no la tuviera, la sonda mediria una app que si deja
 *      pisarse.
 *   2. `operations`, `work_orders` y `materials`: SOLO UPDATE, por filas que ya existen, y solo de
 *      las columnas que la pagina tiene derecho a tocar. Nunca inserta, nunca borra (RULE-SUP-021).
 *   3. Las marcas de retirada y reintegracion, que salen de comparar `selected_ots` de antes con
 *      el de despues: no hay que pedirlas a la pagina porque la pagina no las tiene.
 *   4. `selected_ots`, `locked_ots` y `operation_plan_statuses`: espejo (borra y reinscribe).
 *   5. `operation_events`: solo inserta, con clave idempotente.
 *   6. `plan_snapshots`: upsert, nunca delete.
 *   7. `app_state` AL FINAL, con la revision nueva en la misma sentencia.
 *
 * Devuelve `{status, body}` porque una excepcion de la funcion real es un error de Postgres con su
 * codigo, no un informe con `ok:false`.
 */
function planGuardar(cuerpo, tables) {
  const t0 = Date.now();
  const rpc = cuerpo && typeof cuerpo === "object" && !Array.isArray(cuerpo) ? cuerpo : {};
  const payload = rpc.p_payload && typeof rpc.p_payload === "object" && !Array.isArray(rpc.p_payload) ? rpc.p_payload : {};
  const actor = rpc.p_actor || "desconocido";
  const json = (status, body) => ({ status, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) });

  if (!Array.isArray(tables.app_state) || !tables.app_state.length) {
    // La funcion real levanta 23514 en este caso (DDL:695-698). Se contesta igual, y no con un
    // `ok:false`: un falso que devuelve un informe donde Postgres devuelve un error teaches a
    // medir el error como si fuera un resultado.
    return json(400, { code: "23514", message: "plan_guardar: no existe la fila id=1 de app_state, sin ella no hay contra que comparar la revision", details: null, hint: null });
  }
  const filaEstado = tables.app_state[0];
  const revisionActual = Number(filaEstado.revision) || 0;
  const revisionEsperada = rpc.p_revision_esperada;
  // `p_revision_esperada is distinct from v_actual`: si no llega, o llega distinta, hay conflicto.
  if (revisionEsperada === null || revisionEsperada === undefined || Number(revisionEsperada) !== revisionActual) {
    return json(200, {
      ok: false,
      conflicto: "CONFLICT_REVISION",
      revision_actual: revisionActual,
      revision_esperada: revisionEsperada === undefined ? null : revisionEsperada,
      mensaje: "El plan cambio desde la ultima carga. Recarga antes de guardar.",
      ms: Date.now() - t0,
    });
  }
  const nueva = revisionActual + 1;
  const informe = {};
  const enTexto = (valor) => String(valor === undefined || valor === null ? "" : valor);
  const clavesDe = (tabla) => String(PLAN_TABLA_ESCRITURA[tabla].clave).split(",").map((c) => c.trim()).filter(Boolean);
  const lista = (tabla) => (Array.isArray(payload[tabla]) ? payload[tabla] : []);
  const filasDe = (tabla) => (Array.isArray(tables[tabla]) ? tables[tabla] : (tables[tabla] = []));
  const coincideClave = (fila, entrante, tabla) => clavesDe(tabla).every((columna) => enTexto(fila[columna]) === enTexto(entrante[columna]));

  // 1) LAS TRES DEL ERP: UPDATE por filas que ya existen.
  for (const tabla of ["operations", "work_orders", "materials"]) {
    const regla = PLAN_TABLA_ESCRITURA[tabla];
    const almacen = filasDe(tabla);
    const escribibles = (regla.columnas || []).filter((columna) => !clavesDe(tabla).includes(columna));
    let afectadas = 0;
    for (const entrante of lista(tabla)) {
      if (!entrante || typeof entrante !== "object") continue;
      const existente = almacen.find((fila) => coincideClave(fila, entrante, tabla));
      if (!existente) continue; // UPDATE: una fila que no existe NO se inserta. Nunca.
      for (const columna of escribibles) {
        if (Object.prototype.hasOwnProperty.call(entrante, columna)) existente[columna] = entrante[columna];
      }
      existente.revision = nueva; // La revision la pone la funcion, no la pagina (DDL:745-747).
      afectadas += 1;
    }
    informe[tabla] = { modo: "actualiza", filas: afectadas };
  }

  // 2) LAS MARCAS DE RETIRADA Y REINTEGRACION, comparando selected_ots antes y despues.
  const otsActuales = filasDe("selected_ots").map((fila) => String(fila.ot));
  const otsNuevas = lista("selected_ots").map((fila) => String(fila.ot));
  const salientes = otsActuales.filter((ot) => !otsNuevas.includes(ot));
  const entrantes = otsNuevas.filter((ot) => !otsActuales.includes(ot));
  if (salientes.length) {
    let afectadas = 0;
    for (const fila of filasDe("operations")) {
      if (salientes.includes(String(fila.ot)) && !fila.retirada_en) { fila.retirada_en = "AHORA"; fila.retirada_por = actor; afectadas += 1; }
    }
    informe.retiradas = { ots: salientes, operaciones: afectadas };
  }
  if (entrantes.length) {
    let afectadas = 0;
    for (const fila of filasDe("operations")) {
      if (entrantes.includes(String(fila.ot))) { fila.retirada_en = null; fila.retirada_por = null; afectadas += 1; }
    }
    informe.reintegradas = { ots: entrantes, operaciones: afectadas };
  }

  // 3) LAS TRES QUE LA PERSONA ESCRIBE SOLA: espejo (borra y reinscribe).
  for (const tabla of ["selected_ots", "locked_ots", "operation_plan_statuses"]) {
    const entrantes2 = lista(tabla).filter((fila) => fila && typeof fila === "object");
    tables[tabla] = entrantes2.map((fila) => ({ ...fila }));
    informe[tabla] = { modo: "espejo", filas: entrantes2.length };
  }

  // 4) operation_events: solo inserta, con clave idempotente (`on conflict (id) do nothing`).
  const eventos = lista("operation_events").filter((fila) => fila && typeof fila === "object");
  if (eventos.length) {
    const almacen = filasDe("operation_events");
    let insertadas = 0;
    for (const evento of eventos) {
      if (almacen.some((fila) => enTexto(fila.id) === enTexto(evento.id))) continue;
      almacen.push({ ...evento, actor: evento.actor || actor });
      insertadas += 1;
    }
    informe.operation_events = { modo: "flujo", filas: insertadas };
  }

  // 5) plan_snapshots: historico, upsert y NUNCA delete.
  const borradores = lista("plan_snapshots").filter((fila) => fila && typeof fila === "object");
  if (borradores.length) {
    const almacen = filasDe("plan_snapshots");
    let afectadas = 0;
    for (const borrador of borradores) {
      const existente = almacen.find((fila) => enTexto(fila.snapshot_id) === enTexto(borrador.snapshot_id));
      if (existente) Object.assign(existente, borrador);
      else almacen.push({ ...borrador });
      afectadas += 1;
    }
    informe.plan_snapshots = { modo: "anexo", filas: afectadas };
  }

  // 6) app_state AL FINAL, con la revision nueva en la misma sentencia.
  const estadoNuevo = payload.app_state && typeof payload.app_state === "object" ? payload.app_state : {};
  const columnasEstado = ["saved_at", "synced_at", "plan_start", "horizon_days", "report_week_start", "report_filters", "settings", "plant", "operation_catalog_warning", "last_schedule"];
  for (const columna of columnasEstado) {
    if (Object.prototype.hasOwnProperty.call(estadoNuevo, columna)) filaEstado[columna] = estadoNuevo[columna];
  }
  filaEstado.revision = nueva;

  return json(200, { ok: true, revision: nueva, actor, tablas: informe, ms: Date.now() - t0 });
}

/**
 * Responde una peticion del LECTOR o del ESCRITOR. Devuelve `{ status, body, headers }` o `null`
 * si la peticion no es de la Data API (esa la contesta otra cosa).
 *
 * PostgREST en minimo, para las cuatro operaciones que la pagina hace:
 *   GET     `select=*`, `columna=eq.valor`, `order=col.asc,col2.desc`, `limit`, `offset` y el
 *           `content-range` que `countTable` lee del encabezado con `Prefer: count=exact`.
 *   POST    UPSERT por la columna de `on_conflict`, que es como escribe el escritor real
 *           (`resolution=merge-duplicates`), y cuerpo vacio cuando pide `return=minimal`.
 *   PATCH   merge del cuerpo en las filas que cumple el filtro de la URL.
 *   DELETE  borra las filas que cumple el filtro (`escribirEspejo` borra con `id=neq.<uuid nulo>`).
 *
 * POR QUE EL FALSO ESCRIBE. MEDIDO 2026-10-05: sin escrituras, "Generar plan" terminaba con
 * "No se pudo guardar el plan (OT ...)" y la app no dejaba NI UNA operacion con fecha, o sea que
 * el motor, el Gantt y el cuadre con los reportes se median contra un plan inexistente. La causa
 * era de la sonda -contestaba 200 a un POST sin guardar nada-, no de la app. Con escritura, el
 * plan queda en el almacen local y el resto de la corrida mide el plan de verdad. El almacen es
 * el objeto `tables` del proceso: nada sale de la maquina y la guarda sigue cortando lo externo.
 */
export function responderPostgREST(url, method, headers, tables, opciones = {}) {
  const match = /^\/rest\/v1\/([^/?]+)/.exec(url.pathname);
  if (!match) return null;
  const tabla = decodeURIComponent(match[1]);
  const verbo = String(method || "GET").toUpperCase();
  const cuerpo = opciones.cuerpo === undefined ? null : opciones.cuerpo;
  const json = (status, body, extra = {}) => ({
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
    body: body === null ? "" : JSON.stringify(body),
  });
  const prefiere = String((headers && headers["prefer"]) || "");

  // LAS FUNCIONES NO SON TABLAS. MEDIDO con las reglas del repo: `plan_guardar` existe en
  // produccion (el 2026-09-30 daba 400 con 42702 y el 2026-10-03 ya devolvia su informe con
  // CONFLICT_REVISION), asi que contestarle 404 hacia medir un camino que la pagina no recorre y
  // tapaba el fallo real del guardado. Se implementa como la declara el DDL, con las columnas de
  // `plan_tabla_escritura`. Cualquier OTRA funcion que se pida es 404 PGRST202: esa es la forma de
  // PostgREST y el escritor distingue 404 ( degrade al camino viejo) de error (no degrada).
  if (tabla === "rpc") {
    const nombre = decodeURIComponent(url.pathname.replace(/^\/rest\/v1\/rpc\/?/, "")) || "(desconocida)";
    if (nombre === "plan_guardar" && verbo === "POST") return planGuardar(cuerpo, tables);
    return json(404, {
      code: "PGRST202",
      message: `Could not find the function public.${nombre} in the schema cache`,
      details: null,
      hint: null,
    });
  }

  // `opciones.inexistentesVacias` hace que las tablas que NO existen en el proyecto se sirvan
  // como una tabla vacia en vez de con 404. MEDIDO 2026-10-05: NO es lo que pasa en produccion y
  // por eso NO es el omision. Sirve para aislar una causa: con el 404 de
  // `machine_planning_overrides`, `supabase-catalog-boot.js` marca `informe.fallo` y
  // `supabase-catalog-apply.js:141` ABORTA la aplicacion entera, asi que la pagina se queda sin
  // operadores, sin matriz y sin maquinas aunque las otras 24 tablas se lean bien. Servirla vacia
  // quita esa unica falla y, si el resto de la corrida se pone verde, deja medido que ESA es la
  // causa -no la sonda ni el resto de los datos-. Con la opcion apagada, la corrida mide lo que
  // mide la persona hoy.
  const inexistentesComoVacias = opciones.inexistentesVacias === true;
  if (TABLAS_INEXISTENTES.includes(tabla)) {
    if (!inexistentesComoVacias) {
      return json(404, {
        code: "42P01",
        message: `relation "public.${tabla}" does not exist`,
        details: null,
        hint: null,
      });
    }
    // Con la opcion encendida se responde como tabla vacia. Se declara en el mismo objeto de
    // tablas para que el camino de filtrar/ordenar sea el de verdad y no un atajo aparte.
    if (!Object.prototype.hasOwnProperty.call(tables, tabla)) tables[tabla] = [];
  }
  if (!Object.prototype.hasOwnProperty.call(tables, tabla)) {
    // Una tabla que no esta en el fixture y tampoco se marco como inexistente es un 404 de
    // verdad: seria una peticion que la pagina no deberia estar haciendo.
    return json(404, { code: "42P01", message: `relation "public.${tabla}" does not exist`, details: null, hint: null });
  }

  const enTexto = (valor) => String(valor === undefined || valor === null ? "" : valor);
  const noEsParametro = (columna) => ["select", "order", "limit", "offset", "on_conflict"].includes(columna);

  /** Las filas que cumple el filtro de la URL. `eq.` y `neq.` son los dos que usa el escritor. */
  const coincide = (fila) => {
    for (const [columna, bruto] of url.searchParams) {
      if (noEsParametro(columna)) continue;
      const eq = /^eq\.(.*)$/.exec(bruto);
      const neq = /^neq\.(.*)$/.exec(bruto);
      // La sonda no necesita operadores raros: si aparece uno, no se filtra y se ve raro en el
      // informe, que es preferible a inventar la semántica de algo que la pagina no usa.
      if (!eq && !neq) continue;
      const valor = decodeURIComponent((eq || neq)[1]);
      const esIgual = enTexto(fila[columna]) === valor;
      if (eq ? !esIgual : esIgual) return false;
    }
    return true;
  };

  // ---------------------------------------------------------------------------
  // ESCRITURAS
  // ---------------------------------------------------------------------------
  if (verbo === "POST") {
    const almacen = tables[tabla];
    const entrantes = Array.isArray(cuerpo) ? cuerpo : cuerpo === null ? [] : [cuerpo];
    // `on_conflict` llega como `columna`, como `tabla.columna` o COMPUESTA: `materials` usa
    // `ot,line_id` (CLAVE_NATURAL, supabase-writer.js:310). Sin esto, cada guardado del probe
    // agregaba una copia de cada material en vez de actualizar la que estaba, y el almacen local
    // crecia sin que nada en el informe lo dijera.
    const claves = String(url.searchParams.get("on_conflict") || "id")
      .split(".")
      .pop()
      .split(",")
      .map((columna) => columna.trim())
      .filter(Boolean);
    for (const entrante of entrantes) {
      if (!entrante || typeof entrante !== "object") continue;
      const mismaClave = (fila) => claves.every((columna) => enTexto(fila[columna]) === enTexto(entrante[columna]));
      const existente = almacen.find(mismaClave);
      if (existente) Object.assign(existente, entrante);
      else almacen.push({ ...entrante });
    }
    return json(201, /return=minimal/.test(prefiere) ? [] : entrantes);
  }
  if (verbo === "PATCH") {
    const cambiadas = tables[tabla].filter(coincide);
    for (const fila of cambiadas) Object.assign(fila, cuerpo && typeof cuerpo === "object" ? cuerpo : {});
    return json(200, /return=minimal/.test(prefiere) ? [] : cambiadas);
  }
  if (verbo === "DELETE") {
    const quedan = tables[tabla].filter((fila) => !coincide(fila));
    tables[tabla] = quedan;
    return json(204, null);
  }
  if (verbo !== "GET") return json(405, { code: "42601", message: `${verbo} no esta implementado en la sonda`, details: null, hint: null });

  let filas = tables[tabla].filter(coincide);
  const orden = url.searchParams.get("order");
  if (orden) {
    const claves = orden.split(",").map((trozo) => {
      const [col, dir] = trozo.split(".");
      return { col: col.trim(), desc: String(dir || "asc").toLowerCase() === "desc" };
    });
    filas.sort((a, b) => {
      for (const { col, desc } of claves) {
        const va = a[col] === undefined ? "" : a[col];
        const vb = b[col] === undefined ? "" : b[col];
        if (va === vb) continue;
        const cmp = va > vb ? 1 : -1;
        return desc ? -cmp : cmp;
      }
      return 0;
    });
  }
  const limite = url.searchParams.get("limit");
  const offset = url.searchParams.get("offset");
  const desde = offset ? Number(offset) : 0;
  const total = filas.length;
  if (limite != null) filas = filas.slice(desde, desde + Number(limite));
  else if (desde) filas = filas.slice(desde);

  // `countTable` lee el total del `content-range` cuando pide `Prefer: count=exact`.
  const quiereConteo = prefiere.includes("count=exact");
  const extra = quiereConteo ? { "content-range": `0-${Math.max(0, filas.length - 1)}/${total}` } : {};
  return json(200, filas, extra);
}