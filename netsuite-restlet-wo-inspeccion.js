/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * RESTlet unificado para Hoja Inspec (copia de 2080 con detalle de OT cerradas).
 *
 * POST body:
 * - { table: "WO_INSPECCION", action: "list", locationId: 1, onlyOpen: true, pageIndex: 0, pageSize: 500 }
 * - { table: "WO_INSPECCION", action: "detail", woFolio: "28", locationId: 1, onlyOpen: true }
 * - { table: "WO_INSPECCION", action: "diagnostico", woFolio: "28", locationId: 1 }
 *
 * Diferencias frente a 2080:
 * - action "detail" ignora onlyOpen: regresa OTs cerradas/canceladas.
 * - action "detail" agrega a "trabajo": cantidadTotal, cantidadEnsamblada,
 *   cantidadEnsambladaFuente, cantidadEnsambladaCampo, cantidadPendiente,
 *   cantidadRealizadaMax, cantidadRealizadaUltimaOp, operacionesTotal y operacionesCompletas.
 * - action "detail" agrega a cada operacion: cantidadRealizada (mot.completedquantity).
 * - action "list" conserva onlyOpen: las listas de inspeccion no cambian.
 */
define(['N/query', 'N/record'], (query, record) => {
  const DEFAULT_PAGE_SIZE = 500;
  const MAX_PAGE_SIZE = 2000;

  function post(body) {
    const payload = body || {};
    if (payload.table !== 'WO_INSPECCION') {
      return { ok: false, error: 'table debe ser WO_INSPECCION' };
    }

    const action = String(payload.action || 'detail').toLowerCase();
    if (action === 'list') return listWorkOrders(payload);
    if (action === 'detail') return getInspectionDetail(payload);
    if (action === 'diagnostico') return diagnosticarBuilt(payload);

    return { ok: false, error: 'action no soportada: ' + action };
  }

  function diagnosticarBuilt(payload) {
    const woFolio = String(payload.woFolio || payload.wo || '').trim();
    if (!woFolio) return { ok: false, error: 'woFolio requerido' };

    const resultados = { woFolio: woFolio };
    const found = findWorkOrder(payload, woFolio);
    let workOrderId = found ? found.workorder_id : null;
    if (!workOrderId) {
      try {
        const lookup = runSuiteQL("SELECT id, tranid FROM transaction WHERE type = 'WorkOrd' AND tranid = ?", [woFolio]);
        workOrderId = lookup.length ? lookup[0].id : null;
      } catch (error) {
        resultados.lookupError = String(error && error.message || error).slice(0, 200);
      }
    }
    resultados.workOrderId = workOrderId;
    if (!workOrderId) return { ok: true, action: 'diagnostico', resultados: resultados };

    const pruebas = [
      'SELECT built FROM transaction WHERE id = ?',
      'SELECT quantitybuilt FROM transaction WHERE id = ?',
      'SELECT quantityremaining FROM transaction WHERE id = ?',
      "SELECT quantityshiprecv FROM transactionline WHERE transaction = ? AND NVL(mainline, 'F') = 'T'",
      "SELECT ABS(NVL(tl.quantity,0)) AS cantidad, ABS(NVL(t.built,0)) AS built FROM transaction t JOIN transactionline tl ON tl.transaction = t.id WHERE t.id = ? AND NVL(tl.mainline, 'F') = 'T'"
    ];
    resultados.consultas = pruebas.map((sql) => {
      try {
        const rows = runSuiteQL(sql, [workOrderId]);
        return { sql: sql, ok: true, filas: rows.length, primeras: rows.slice(0, 3) };
      } catch (error) {
        return { sql: sql, ok: false, error: String(error && error.message || error).slice(0, 200) };
      }
    });

    try {
      const loaded = record.load({ type: record.Type.WORK_ORDER, id: workOrderId });
      const fields = loaded.getFields() || [];
      resultados.camposRelacionados = fields.filter((f) => /built|ensam|cantidad|quantity|remain/i.test(String(f)));
      resultados.valores = {};
      resultados.camposRelacionados.forEach((field) => {
        try {
          resultados.valores[field] = loaded.getValue(field);
        } catch (error) {
          resultados.valores[field] = 'error';
        }
      });
    } catch (error) {
      resultados.recordError = String(error && error.message || error).slice(0, 200);
    }

    return { ok: true, action: 'diagnostico', resultados: resultados };
  }

  function listWorkOrders(payload) {
    const pageIndex = toInt(payload.pageIndex, 0);
    const pageSize = clamp(toInt(payload.pageSize, DEFAULT_PAGE_SIZE), 1, MAX_PAGE_SIZE);
    const offset = pageIndex * pageSize;
    const params = [];

    let where = "t.type = 'WorkOrd'";
    if (payload.onlyOpen !== false) {
      where += " AND UPPER(BUILTIN.DF(t.status)) NOT LIKE '%CLOSED%' AND UPPER(BUILTIN.DF(t.status)) NOT LIKE '%COMPLETED%' AND UPPER(BUILTIN.DF(t.status)) NOT LIKE '%CERRAD%' AND UPPER(BUILTIN.DF(t.status)) NOT LIKE '%COMPLETAD%' AND UPPER(BUILTIN.DF(t.status)) NOT LIKE '%CANCEL%'";
    }
    if (payload.locationId) {
      where += ' AND tl.location = ?';
      params.push(payload.locationId);
    }

    const sql = `
      SELECT DISTINCT
        t.id AS workorder_id,
        t.tranid AS wo,
        BUILTIN.DF(tl.item) AS articulo,
        COALESCE(i.description, i.purchasedescription, i.displayname) AS descripcion,
        ABS(NVL(tl.quantity, 0)) AS cantidad,
        t.enddate AS fechaEntrega,
        BUILTIN.DF(t.status) AS estatus,
        '' AS revision,
        BUILTIN.DF(t.billofmaterialsrevision) AS bomRevision
      FROM transaction t
      JOIN transactionline tl ON tl.transaction = t.id
      LEFT JOIN item i ON i.id = tl.item
      WHERE ${where}
        AND NVL(tl.mainline, 'F') = 'T'
      ORDER BY t.tranid
    `;

    const all = runSuiteQL(sql, params);
    const rows = all.slice(offset, offset + pageSize).map(normalizeWorkOrder);
    return {
      ok: true,
      action: 'list',
      wos: rows,
      rows,
      pageIndex,
      pageSize,
      totalRows: all.length,
      hasMore: offset + pageSize < all.length
    };
  }

  function getInspectionDetail(payload) {
    const woFolio = String(payload.woFolio || payload.wo || '').trim();
    if (!woFolio) return { ok: false, error: 'woFolio requerido' };

    const workOrder = findWorkOrder(payload, woFolio);
    if (!workOrder) return { ok: false, error: 'WO no encontrada: ' + woFolio };

    const materiales = getMaterials(workOrder.workorder_id);
    enrichMaterials(materiales, payload.locationId);
    const operaciones = getOperations(workOrder.workorder_id);
    enrichWorkOrderQuantities(workOrder, operaciones);

    return {
      ok: true,
      action: 'detail',
      trabajo: workOrder,
      workOrder,
      materiales,
      operaciones
    };
  }

  function findWorkOrder(payload, woFolio) {
    const params = [woFolio];
    let where = "t.type = 'WorkOrd' AND t.tranid = ?";
    if (payload.locationId) {
      where += ' AND tl.location = ?';
      params.push(payload.locationId);
    }

    const rows = runSuiteQL(`
      SELECT DISTINCT
        t.id AS workorder_id,
        t.tranid AS wo,
        BUILTIN.DF(tl.item) AS articulo,
        COALESCE(i.description, i.purchasedescription, i.displayname) AS descripcion,
        ABS(NVL(tl.quantity, 0)) AS cantidad,
        t.enddate AS fechaEntrega,
        BUILTIN.DF(t.status) AS estatus,
        '' AS revision,
        BUILTIN.DF(t.billofmaterialsrevision) AS bomRevision
      FROM transaction t
      JOIN transactionline tl ON tl.transaction = t.id
      LEFT JOIN item i ON i.id = tl.item
      WHERE ${where}
        AND NVL(tl.mainline, 'F') = 'T'
    `, params);

    return rows[0] ? normalizeWorkOrder(rows[0]) : null;
  }

  function enrichWorkOrderQuantities(workOrder, operaciones) {
    const total = Number(workOrder.cantidad || 0);
    const operations = Array.isArray(operaciones) ? operaciones : [];
    const builtInfo = readBuiltQuantity(workOrder.workorder_id, total, operations);
    const completed = operations.filter((op) => {
      const status = String(pickValue(op, 'estado') || '').toUpperCase();
      return status.indexOf('COMPLETE') >= 0 || status.indexOf('COMPLET') >= 0 || status.indexOf('CERRAD') >= 0;
    }).length;
    const real = operations
      .map((op) => toNumberOrNull(pickValue(op, 'cantidadrealizada')))
      .filter((value) => value !== null);
    const ultima = operations.length
      ? toNumberOrNull(pickValue(operations[operations.length - 1], 'cantidadrealizada'))
      : null;

    workOrder.cantidadTotal = total;
    workOrder.cantidadEnsamblada = builtInfo.value;
    workOrder.cantidadEnsambladaFuente = builtInfo.fuente;
    workOrder.cantidadEnsambladaCampo = builtInfo.campo || '';
    workOrder.cantidadPendiente = Math.max(0, total - builtInfo.value);
    workOrder.cantidadRealizadaMax = real.length ? Math.max.apply(null, real) : 0;
    workOrder.cantidadRealizadaUltimaOp = ultima === null ? 0 : ultima;
    workOrder.operacionesTotal = operations.length;
    workOrder.operacionesCompletas = completed;
    return workOrder;
  }

  function pickValue(row, name) {
    if (!row) return undefined;
    const target = String(name).toLowerCase();
    const keys = Object.keys(row);
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === target) return row[keys[i]];
    }
    return undefined;
  }

  function toNumberOrNull(value) {
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function builtFieldCandidates(fieldIds) {
    const fields = (Array.isArray(fieldIds) ? fieldIds : []).map((f) => String(f || ''));
    const lower = fields.map((f) => f.toLowerCase());
    const exact = ['built', 'quantitybuilt', 'quantity_built', 'cantidadensamblada', 'quantity built', 'ensamblada'];
    const ordered = [];
    exact.forEach((name) => {
      const index = lower.indexOf(name);
      if (index >= 0 && ordered.indexOf(fields[index]) < 0) ordered.push(fields[index]);
    });
    lower.forEach((name, index) => {
      const match = name.indexOf('built') >= 0 || name.indexOf('ensam') >= 0 || name.indexOf('assembl') >= 0;
      if (match && ordered.indexOf(fields[index]) < 0) ordered.push(fields[index]);
    });
    return ordered;
  }

  function readBuiltQuantity(workOrderId, total, operations) {
    const notes = [];
    if (!workOrderId) return { value: 0, fuente: 'sin-id', campo: '' };

    let loaded = null;
    try {
      loaded = record.load({ type: record.Type.WORK_ORDER, id: workOrderId });
    } catch (error) {
      notes.push('load=error:' + String(error && error.message || error).slice(0, 40));
    }

    if (loaded) {
      let fieldIds = [];
      try {
        fieldIds = loaded.getFields() || [];
      } catch (error) {
        notes.push('getFields=error:' + String(error && error.message || error).slice(0, 40));
      }
      const candidates = builtFieldCandidates(fieldIds);
      const diagnosticos = candidates.map((field) => {
        try {
          const raw = loaded.getValue(field);
          return field + '=' + (raw === '' || raw === null || raw === undefined ? 'vacio' : raw);
        } catch (error) {
          return field + '=error';
        }
      });
      if (diagnosticos.length) notes.push(diagnosticos.join(','));

      for (const field of candidates) {
        let raw = null;
        try {
          raw = loaded.getValue(field);
        } catch (error) {
          continue;
        }
        const value = toNumberOrNull(raw);
        if (value !== null) return { value: value, fuente: 'record:' + field, campo: field };
      }

      let remaining = null;
      try {
        remaining = loaded.getValue('quantityremaining');
      } catch (error) {
        remaining = null;
      }
      const remainingNumber = toNumberOrNull(remaining);
      if (remainingNumber !== null) {
        return {
          value: Math.max(0, Math.min(total, total - remainingNumber)),
          fuente: 'record:quantityremaining',
          campo: 'quantityremaining'
        };
      }
    }

    const sqls = [
      'SELECT quantitybuilt AS built FROM transaction WHERE id = ?',
      'SELECT built AS built FROM transaction WHERE id = ?'
    ];
    for (const sql of sqls) {
      try {
        const rows = runSuiteQL(sql, [workOrderId]);
        const sqlNumber = rows.length ? toNumberOrNull(rows[0].built) : null;
        notes.push(sql.indexOf('quantitybuilt') >= 0 ? 'suiteql:quantitybuilt=' + (sqlNumber === null ? 'vacio' : sqlNumber) : 'suiteql:built=' + (sqlNumber === null ? 'vacio' : sqlNumber));
        if (sqlNumber !== null) {
          return { value: sqlNumber, fuente: 'suiteql:' + (sql.indexOf('quantitybuilt') >= 0 ? 'quantitybuilt' : 'built'), campo: 'transaction.' + (sql.indexOf('quantitybuilt') >= 0 ? 'quantitybuilt' : 'built') };
        }
      } catch (error) {
        notes.push((sql.indexOf('quantitybuilt') >= 0 ? 'suiteql:quantitybuilt' : 'suiteql:built') + '=error:' + String(error && error.message || error).slice(0, 40));
      }
    }

    const ultima = operations && operations.length
      ? toNumberOrNull(pickValue(operations[operations.length - 1], 'cantidadrealizada'))
      : null;
    if (ultima !== null) {
      return { value: Math.min(total, ultima), fuente: 'operaciones:ultima', campo: 'manufacturingoperationtask.completedquantity' };
    }
    notes.push('operaciones:ultima=vacio');

    return { value: 0, fuente: 'no-disponible(' + notes.join(';') + ')', campo: '' };
  }

  function getMaterials(workOrderId) {
    return runSuiteQL(`
      SELECT
        tl.id AS line_id,
        tl.item AS item_id,
        BUILTIN.DF(tl.item) AS componente,
        COALESCE(i.description, i.purchasedescription, i.displayname) AS descripcion,
        ABS(NVL(tl.quantity, 0)) AS requerido,
        BUILTIN.DF(tl.units) AS unidad,
        ABS(NVL(tl.quantityshiprecv, 0)) AS emitido,
        ABS(NVL(tl.quantitycommitted, 0)) AS comprometido,
        CASE
          WHEN ABS(NVL(tl.quantity, 0)) - ABS(NVL(tl.quantityshiprecv, 0)) < 0 THEN 0
          ELSE ABS(NVL(tl.quantity, 0)) - ABS(NVL(tl.quantityshiprecv, 0))
        END AS pendiente
      FROM transactionline tl
      LEFT JOIN item i ON i.id = tl.item
      WHERE tl.transaction = ?
        AND NVL(tl.mainline, 'F') = 'F'
        AND tl.item IS NOT NULL
        AND ABS(NVL(tl.quantity, 0)) > 0
      ORDER BY tl.id
    `, [workOrderId]);
  }

  function enrichMaterials(materials, locationId) {
    const itemIds = unique(materials.map((m) => m.item_id).filter(Boolean));
    if (!itemIds.length) return materials;

    const availability = getAvailabilityByItem(itemIds, locationId);
    const woByItem = getOpenWorkOrdersByMaterial(itemIds);
    const fabricationByItem = getOpenFabricationByAssembly(itemIds, locationId);

    materials.forEach((m) => {
      const key = String(m.item_id || '');
      const inv = availability[key] || { disponible: 0, fisico: 0 };
      const woStatus = woByItem[key] || [];
      const fabricacionWos = fabricationByItem[key] || [];
      const demandaActiva = woStatus.reduce((sum, wo) => sum + Number(wo.cantidad || 0), 0);
      const enFabricacion = fabricacionWos.reduce((sum, wo) => sum + Number(wo.cantidad || 0), 0);
      m.disponible = Number(inv.disponible || 0);
      m.fisico = Number(inv.fisico || 0);
      m.remanente = Number(inv.disponible || 0) - Number(m.pendiente || 0);
      m.demandaActiva = demandaActiva;
      m.enFabricacion = enFabricacion;
      m.deficit = Math.max(0, demandaActiva - m.disponible);
      m.deficitNeto = Math.max(0, demandaActiva - m.disponible - enFabricacion);
      m.woStatus = woStatus;
      m.fabricacionWos = fabricacionWos;
    });
    return materials;
  }

  function getAvailabilityByItem(itemIds, locationId) {
    const params = itemIds.slice();
    let where = `item IN (${placeholders(itemIds.length)})`;
    if (locationId) {
      where += ' AND location = ?';
      params.push(locationId);
    }
    const rows = runSuiteQL(`
      SELECT
        item,
        SUM(NVL(quantityavailable, 0)) AS disponible,
        SUM(NVL(quantityonhand, 0)) AS fisico
      FROM aggregateitemlocation
      WHERE ${where}
      GROUP BY item
    `, params);
    return rows.reduce((acc, row) => {
      acc[String(row.item || '')] = {
        disponible: Number(row.disponible || 0),
        fisico: Number(row.fisico || 0)
      };
      return acc;
    }, {});
  }

  function getOpenFabricationByAssembly(itemIds, locationId) {
    const params = itemIds.slice();
    let locationWhere = '';
    if (locationId) {
      locationWhere = ' AND tl.location = ?';
      params.push(locationId);
    }
    const rows = runSuiteQL(`
      SELECT
        tl.item AS item_id,
        t.tranid AS wo,
        BUILTIN.DF(t.status) AS status,
        CASE
          WHEN ABS(NVL(tl.quantity, 0)) - ABS(NVL(tl.quantityshiprecv, 0)) < 0 THEN 0
          ELSE ABS(NVL(tl.quantity, 0)) - ABS(NVL(tl.quantityshiprecv, 0))
        END AS cantidad
      FROM transaction t
      JOIN transactionline tl ON tl.transaction = t.id
      WHERE t.type = 'WorkOrd'
        AND NVL(tl.mainline, 'F') = 'T'
        AND tl.item IN (${placeholders(itemIds.length)})
        ${locationWhere}
        AND ABS(NVL(tl.quantity, 0)) > 0
        AND ABS(NVL(tl.quantity, 0)) - ABS(NVL(tl.quantityshiprecv, 0)) > 0
        AND (
          UPPER(BUILTIN.DF(t.status)) LIKE '%LIBERAD%'
          OR UPPER(BUILTIN.DF(t.status)) LIKE '%PLANIFICAD%'
          OR UPPER(BUILTIN.DF(t.status)) LIKE '%EN CURSO%'
        )
      ORDER BY tl.item, t.tranid
    `, params);
    return rows.reduce((acc, row) => {
      const key = String(row.item_id || '');
      if (!acc[key]) acc[key] = [];
      acc[key].push({
        wo: row.wo || '',
        status: row.status || '',
        cantidad: Number(row.cantidad || 0)
      });
      return acc;
    }, {});
  }

  function getOpenWorkOrdersByMaterial(itemIds) {
    const params = itemIds.slice();
    const rows = runSuiteQL(`
      SELECT
        tl.item AS item_id,
        t.tranid AS wo,
        BUILTIN.DF(t.status) AS status,
        CASE
          WHEN ABS(NVL(tl.quantity, 0)) - ABS(NVL(tl.quantityshiprecv, 0)) < 0 THEN 0
          ELSE ABS(NVL(tl.quantity, 0)) - ABS(NVL(tl.quantityshiprecv, 0))
        END AS cantidad
      FROM transaction t
      JOIN transactionline tl ON tl.transaction = t.id
      WHERE t.type = 'WorkOrd'
        AND tl.item IN (${placeholders(itemIds.length)})
        AND ABS(NVL(tl.quantity, 0)) > 0
        AND ABS(NVL(tl.quantity, 0)) - ABS(NVL(tl.quantityshiprecv, 0)) > 0
        AND (
          UPPER(BUILTIN.DF(t.status)) LIKE '%LIBERAD%'
          OR UPPER(BUILTIN.DF(t.status)) LIKE '%PLANIFICAD%'
          OR UPPER(BUILTIN.DF(t.status)) LIKE '%EN CURSO%'
        )
      ORDER BY tl.item, t.tranid
    `, params);
    return rows.reduce((acc, row) => {
      const key = String(row.item_id || '');
      if (!acc[key]) acc[key] = [];
      acc[key].push({
        wo: row.wo || '',
        status: row.status || '',
        cantidad: Number(row.cantidad || 0)
      });
      return acc;
    }, {});
  }

  function getOperations(workOrderId) {
    return runSuiteQL(`
      SELECT
        mot.id AS operation_id,
        mot.operationsequence AS secuencia,
        mot.title AS operacion,
        BUILTIN.DF(mot.manufacturingworkcenter) AS centro,
        mot.inputquantity AS cantidadProceso,
        mot.completedquantity AS cantidadRealizada,
        mot.startdatetime AS fechaInicioProgramada,
        mot.enddate AS fechaFinProgramada,
        mot.status AS estado
      FROM manufacturingoperationtask mot
      WHERE mot.workorder = ?
      ORDER BY mot.operationsequence
    `, [workOrderId]);
  }

  function runSuiteQL(sql, params) {
    const result = query.runSuiteQL({ query: sql, params: params || [] });
    return result.asMappedResults() || [];
  }

  function normalizeWorkOrder(row) {
    const out = Object.assign({}, row);
    out.bomRevision = out.bomrevision || out.bomRevision || '';
    out.revision = parseRevisionFromBom(out.bomRevision);
    return out;
  }

  function parseRevisionFromBom(value) {
    const text = String(value || '').trim();
    const match = text.match(/\bREV\s+(\S+)/i);
    if (!match) return '';
    return String(match[1] || '').trim();
  }

  function toInt(value, fallback) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function unique(values) {
    return Array.from(new Set(values.map((v) => String(v || '')).filter(Boolean)));
  }

  function placeholders(count) {
    return new Array(count).fill('?').join(',');
  }

  return { post };
});
