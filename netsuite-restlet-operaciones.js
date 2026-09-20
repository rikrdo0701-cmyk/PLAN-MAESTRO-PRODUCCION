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
 */
define(['N/query'], (query) => {
  function post(body) {
    body = body || {};

    const pageSize = clamp(Number(body.pageSize ?? 200), 50, 5000);
    const pageIndex = Math.max(0, Number(body.pageIndex ?? 0));

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
      '  mot.status                                AS status_op,',
      '  mot.manufacturingworkcenter               AS workcenter,',
      '  mot.setuptime                             AS setup_min,',
      '  mot.estimatedwork                         AS est_min,',
      '  mot.actualwork                            AS real_min,',
      '  mot.remainingwork                         AS remaining_min,',
      '  mot.runrate                               AS production_rate,',
      '  mot.laborresources                        AS human_resource,',
      '  mot.machineresources                      AS machine_resource,',
      '  mot.completedquantity                     AS qty_completed',
      'FROM manufacturingoperationtask mot',
      'JOIN transaction wo',
      '  ON wo.id = mot.workorder',
      "JOIN transactionline tl",
      "  ON tl.transaction = wo.id",
      " AND tl.mainline = 'T'",
      'WHERE',
      "  UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%CERRAD%'",
      "  AND UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%CLOSED%'",
      "  AND UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%COMPLET%'",
      'ORDER BY wo.id, mot.operationsequence'
    ].join(' ');

    const all = runSuiteQL_(sql);
    const total = all.length;
    const from = pageIndex * pageSize;
    const to = Math.min(from + pageSize, total);
    const slice = from < total ? all.slice(from, to) : [];

    const rows = slice.map((r) => ({
      id: String(r.id ?? ''),
      workorder_id: String(r.workorder_id || ''),
      workorder_tranid: String(r.workorder_tranid || ''),
      item_name: String(r.item_name || ''),
      operation: String(r.operation || ''),
      sequence: String(r.sequence ?? ''),
      qty_to_process: String(r.qty_to_process ?? ''),
      start_planned: fmtDate_(r.start_planned),
      end_planned: fmtDate_(r.end_planned),
      status_op: translateStatus_(r.status_op),
      workcenter: String(r.workcenter ?? ''),
      setup_min: String(r.setup_min ?? ''),
      est_min: String(r.est_min ?? ''),
      real_min: String(r.real_min ?? 0),
      remaining_min: String(r.remaining_min ?? r.est_min ?? ''),
      production_rate: String(r.production_rate ?? ''),
      human_resource: String(r.human_resource ?? ''),
      machine_resource: String(r.machine_resource ?? ''),
      start_actual: '',
      end_actual: '',
      qty_completed: String(r.qty_completed ?? '')
    }));

    return {
      ok: true,
      pageIndex,
      pageSize,
      totalRows: total,
      hasMore: to < total,
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
        'Cantidad realizada'
      ],
      rows,
      debug: {
        idSource: 'mot.id',
        note: 'RESTlet exclusivo del plan maestro; devuelve id estable de manufacturingoperationtask'
      }
    };
  }

  function runSuiteQL_(sql) {
    const rs = query.runSuiteQL({ query: sql });
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