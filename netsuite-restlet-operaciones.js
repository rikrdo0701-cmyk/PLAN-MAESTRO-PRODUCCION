/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * RESTlet exclusivo de la instancia de Plan Maestro de Produccion.
 *
 * Diferida del 1762/17 (compartido con otra instancia): cada fila
 * devuelve `id` = manufacturingoperationtask.id interno de NetSuite,
 * de modo que la app genere un operationId estable `ns-<id>` en vez del
 * indice posicional `ns-<index+1>` que cambiaba entre sincronizaciones
 * y rompia las claves de operaciones COMPLETADA_PLAN.
 *
 * Espeja el esquema del 1762/17 actual (mismas claves de fila en
 * minusculas) mas la columna `id`; es la unica fuente de operaciones
 * de planta del plan maestro (batch).
 *
 * Respuesta:
 *   { ok, pageIndex, pageSize, totalRows, hasMore, headers, rows, debug }
 * donde `rows` son objetos (no arrays) para que PP_rowsAsObjects_ la
 * devuelva tal cual y PP_mapNetSuiteOperation_ la lea por clave.
 *
 * CAMBIOS 2026-09-26 (RULE-REP-019, medidos con la sonda DIAG_operaciones2240):
 *
 * 1. PAGINACION EN LA CONSULTA. Antes: `const all = runSuiteQL_(sql)` y luego
 *    `all.slice(from, to)`, o sea que CADA pagina re-ejecutaba el JOIN completo de
 *    manufacturingoperationtask + transaction + transactionline y mandaba solo el
 *    trozo. Con 2400 filas y pageSize 200 eran 12 escaneos completos del JOIN para
 *    usar el ultimo. Ahora la pagina se resuelve con FETCH NEXT / OFFSET, igual que
 *    ya hace el restlet 2244 (RULE-REP-016-A), y hasMore se deduce de la fila extra
 *    (pageSize + 1) en vez de con un totalRows.
 *
 *    ATENCION: FETCH NEXT/OFFSET es sintaxis SuiteQL. Si el scripting de la cuenta lo
 *    rechazara, el listado devolveria 200 {ok:false}. La sonda DIAG_inspeccion400
 *    (ya ejecutada en el editor de Apps Script) sirve para verificarlo en NetSuite
 *    antes de dar por buena la change. Este archivo se SUBE A MANO.
 *
 * 2. FILTRO DE UBICACION EN EL SQL. Antes el body traia `locationId: 1` y `post()`
 *    lo IGNORABA (solo leia pageSize y pageIndex), asi que se traian las operaciones de
 *    TODAS las plantas y el servidor las descartaba despues, en memoria, con
 *    PP_belongsToPlant_ (08-netsuite.js:833). Ahora `locationId` filtra con
 *    `tl.location = ?` y la columna entra tambien en la respuesta.
 *
 *    NOTA SOBRE EL TAMAÑO DEL AHORRO: el desglose medido fue 2231 operaciones de
 *    planta 1 contra 169 de otras plantas, o sea 7%. El filtro no es lo que hace
 *    rapida la sincronizacion (eso lo da el pageSize de 2500 en una sola llamada,
 *    que es un cambio del servidor y no de aqui). El filtro se agrega porque ahora
 *    la columna es consultable y porque con ella el servidor puede verificar en
 *    lugar de confiar; si en el futuro se sube el pageSize, el filtro evita traer
 *    volumen que se deshecha.
 *
 * 3. `location` en la respuesta, como columna de la fila. Antes no habia NINGUN campo
 *    de ubicacion o planta (verificado agrupando por location_id, locationId,
 *    location, planta, PLANTA, plant, location_name y subsidiary), de modo que era
 *    imposible filtrar por planta sin antes agregar la columna al SELECT.
 */
define(['N/query'], (query) => {
  function post(body) {
    body = body || {};

    const pageSize = clamp(Number(body.pageSize ?? 200), 50, 5000);
    const pageIndex = Math.max(0, Number(body.pageIndex ?? 0));
    const params = [];

    let where = [
      "UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%CERRAD%'",
      "UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%CLOSED%'",
      "UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%COMPLET%'",
    ];
    if (body.locationId) {
      where.push('tl.location = ?');
      params.push(body.locationId);
    }

    // La pagina se resuelve en la consulta (FETCH NEXT/OFFSET) y no despues en memoria.
    // hasMore se deduce de la fila extra en lugar de exponer totalRows, que obligaba a
    // recorrer el mismo JOIN para contar.
    const limit = pageSize + 1;
    const sql = [
      'SELECT',
      '  mot.id                                    AS id,',
      '  wo.id                                     AS workorder_id,',
      '  wo.tranid                                 AS workorder_tranid,',
      '  tl.item                                   AS item_id,',
      '  BUILTIN.DF(tl.item)                       AS item_name,',
      '  BUILTIN.DF(mot.manufacturingworkcenter)   AS operation,',
      '  mot.operationsequence                     AS sequence,',
      '  mot.inputquantity                         AS qty_to_process,',
      '  mot.startdatetime                         AS start_planned,',
      '  mot.enddate                               AS end_planned,',
      '  BUILTIN.DF(mot.status)                    AS status_op,',
      '  BUILTIN.DF(mot.manufacturingworkcenter)   AS workcenter,',
      '  mot.setuptime                             AS setup_min,',
      '  mot.estimatedwork                         AS est_min,',
      '  mot.actualwork                            AS real_min,',
      '  mot.remainingwork                         AS remaining_min,',
      '  mot.runrate                               AS production_rate,',
      '  mot.laborresources                        AS human_resource,',
      '  mot.machineresources                      AS machine_resource,',
      '  mot.completedquantity                     AS qty_completed,',
      '  tl.location                               AS location',
      'FROM manufacturingoperationtask mot',
      'JOIN transaction wo',
      '  ON wo.id = mot.workorder',
      'JOIN transactionline tl',
      '  ON tl.transaction = wo.id',
      " AND tl.mainline = 'T'",
      'WHERE',
      where.map((clause) => `  ${clause}`).join('\n  AND '),
      'ORDER BY wo.id, mot.operationsequence, mot.id',
      `FETCH NEXT ${limit} ROWS ONLY`,
      `OFFSET ${pageIndex * pageSize} ROWS`
    ].join('\n');

    const fetched = runSuiteQL_(sql, params);
    const hasMore = fetched.length > pageSize;
    const page = hasMore ? fetched.slice(0, pageSize) : fetched;

    const rows = page.map((r) => ({
      id: String(r.id ?? ''),
      workorder_id: String(r.workorder_id || ''),
      workorder_tranid: String(r.workorder_tranid || ''),
      item_name: String(r.item_name || ''),
      operation: String(r.operation || ''),
      sequence: String(r.sequence ?? ''),
      qty_to_process: String(r.qty_to_process || ''),
      start_planned: fmtDate_(r.start_planned),
      end_planned: fmtDate_(r.end_planned),
      status_op: translateStatus_(r.status_op),
      workcenter: String(r.workcenter || ''),
      setup_min: String(r.setup_min || ''),
      est_min: String(r.est_min || ''),
      real_min: String(r.real_min || 0),
      remaining_min: String(r.remaining_min || r.est_min || ''),
      production_rate: String(r.production_rate || ''),
      human_resource: String(r.human_resource || ''),
      machine_resource: String(r.machine_resource || ''),
      start_actual: '',
      end_actual: '',
      qty_completed: String(r.qty_completed || ''),
      location: String(r.location || '')
    }));

    return {
      ok: true,
      pageIndex,
      pageSize,
      hasMore: hasMore,
      headers: [
        'ID (link)',
        'Articulo',
        'Operacion',
        'Secuencia',
        'Cantidad a procesar',
        'Orden de trabajo',
        'Fecha inicio programada',
        'Fecha fin programada',
        'Estado',
        'Centro de trabajo',
        'Tiempo preparacion (min)',
        'Tiempo estimado (min)',
        'Tiempo real (min)',
        'Trabajo restante (min)',
        'Tasa produccion',
        'Recurso humano',
        'Recurso maquina',
        'Fecha inicio real',
        'Fecha fin real',
        'Cantidad realizada',
        'Ubicacion'
      ],
      rows,
      debug: {
        idSource: 'mot.id',
        locationFilter: body.locationId ? `tl.location = ${body.locationId}` : 'sin filtro (body sin locationId)',
        pagination: 'SQL FETCH NEXT/OFFSET, no slice en memoria',
        note: 'RESTlet exclusivo del plan maestro; devuelve id estable de manufacturingoperationtask'
      }
    };
  }

  function runSuiteQL_(sql, params) {
    const payload = (params && params.length) ? { query: sql, params: params } : { query: sql };
    const rs = query.runSuiteQL(payload);
    return rs.asMappedResults() || [];
  }

  function translateStatus_(value) {
    const s = String(value || '');
    if (s === 'NOTSTART') return 'No iniciado';
    if (s === 'INPROCESS') return 'En proceso';
    if (s === 'COMPLETED') return 'Completado';
    if (s === 'CLOSED') return 'Cerrado';
    return s;
  }

  function fmtDate_(value) {
    return value ? String(value) : '';
  }

  function clamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  return { post };
});
