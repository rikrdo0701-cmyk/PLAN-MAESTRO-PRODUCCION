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
 *    usar el ultimo.
 *    ESTE CAMINO SE REVERTIÓ: hoy la pagina se recorta EN MEMORIA, otra vez, y por
 *    DECISION (no porque la cuenta lo prohiba: ver la medicion de abajo). hasMore se
 *    deduce de la fila extra (pageSize + 1) en vez de con un totalRows. El recorte en
 *    memoria se conservo porque con este catalogo (2400 filas) el ahorro de viajes se
 *    consigue con el pageSize, que es decision del servidor. Si alguna vez se quiere
 *    paginar en la consulta, el orden correcto es `ORDER BY ... OFFSET n ROWS
 *    FETCH NEXT m ROWS ONLY` y el ORDER BY es obligatorio.
 *
 *    MEDIDO 2026-09-28 contra esta cuenta (sondas de solo lectura, ver RULE-REP-016-A):
 *    `ORDER BY ... OFFSET n ROWS FETCH NEXT m ROWS ONLY` SI se acepta. El 400 "Failed to
 *    parse SQL" que se vio el 2026-09-26 fue por escribir las clausulas al reves
 *    (`FETCH NEXT m ROWS ONLY OFFSET n ROWS`). `LIMIT` no existe (400) y `OFFSET` sin
 *    `ORDER BY` se ignora en silencio. Este archivo se SUBE A MANO.
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

    // POR QUE NO HAY `??` (MEDIDO 2026-10-06). Este archivo tenia `body.pageSize ?? 200` en
    // estas cuatro lineas. `??` es ES2020 y el parser de SuiteScript no lo tiene: al cargar
    // el archivo responde "SyntaxError: missing ; before statement", porque despues de
    // `body.pageSize` el parser espera un `;` y se encuentra un `?`. A diferencia de V8 (con
    // el que `node --check` da OK) el parser de NetSuite es el que decide si el archivo carga,
    // y por eso un `node --check` en verde NO prueba que el RESTlet cargue.
    //
    // `??` NO se cambia por `||`: no son lo mismo. `||` tambien se come el 0 y el "" que si
    // son valores, y con `pageSize: 0` daria 200 en vez de 0. Se escribe la forma explicita
    // `== null`, que es exactamente lo que `??` quiere decir: solo null y undefined.
    const pageSize = clamp(Number(body.pageSize == null ? 200 : body.pageSize), 50, 5000);
    const pageIndex = Math.max(0, Number(body.pageIndex == null ? 0 : body.pageIndex));

    // La ultima estrategia es LITERALMENTE el SQL que estaba en produccion antes de este
    // cambio (mismas columnas, sin tl.location, sin FETCH NEXT). Esa es la red de seguridad:
    // si algo de lo nuevo no funciona en la cuenta, se cae ahi y el listado responde igual
    // que antes. La primera version de este fallback solo cubria "FETCH NEXT falla" y "el
    // filtro devuelve 0", y no cubria "la columna nueva no existe y hace fallar el parseo",
    // que fue exactamente lo que dejo la app sin operaciones el 2026-09-26.
    const conUbicacion = Boolean(body.locationId);
    const estrategias = [
      { nombre: 'con-ubicacion', porUbicacion: conUbicacion },
      { nombre: 'sql-de-produccion', porUbicacion: false }
    ];

    let elegida = null;
    let consultada = null;
    const intentos = [];
    for (const estrategia of estrategias) {
      try {
        const resultado = consultar_(estrategia, pageIndex, pageSize, body.locationId);
        // Si el filtro por ubicacion devuelve 0 filas pero el SQL sin filtro trae, el problema
        // es el filtro o la columna, no que la planta no tenga trabajo: se degrada.
        const vacioSospechoso = estrategia.porUbicacion
          && !resultado.filas.length
          && resultado.totalSinFiltro > 0;
        if (vacioSospechoso) {
          intentos.push(estrategia.nombre + ': 0 filas con el filtro de ubicacion, se degrada a sin filtro');
          continue;
        }
        elegida = estrategia;
        consultada = resultado;
        break;
      } catch (error) {
        intentos.push(estrategia.nombre + ': ' + String(error && error.message || error).slice(0, 200));
      }
    }

    if (!elegida) {
      throw new Error('Ninguna estrategia de consulta funciono. Intentos: ' + intentos.join(' | '));
    }

    const hasMore = consultada.hayMas;
    const page = consultada.filas;

    const rows = page.map((r) => ({
      id: String(r.id == null ? '' : r.id),
      workorder_id: String(r.workorder_id || ''),
      workorder_tranid: String(r.workorder_tranid || ''),
      item_name: String(r.item_name || ''),
      operation: String(r.operation || ''),
      sequence: String(r.sequence == null ? '' : r.sequence),
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
        estrategia: elegida.nombre,
        // OJO, medido el 2026-09-28: esta cuenta SI acepta
        // `ORDER BY ... OFFSET n ROWS FETCH NEXT m ROWS ONLY`. El 400 "Failed to parse SQL" del
        // 2026-09-26 fue por el ORDEN de las clausulas (`FETCH NEXT m ROWS ONLY OFFSET n ROWS`).
        // Se sigue recortando en memoria por decision, no por imposibilidad: ver la nota de
        // consultar_ mas abajo. La razon se dice entera para que el app no se guie por un
        // "no se puede" que resulto falso.
        paginacion: 'recorte en memoria por decision (la cuenta SI acepta ORDER BY ... OFFSET n ROWS FETCH NEXT m ROWS ONLY; lo que no existe es LIMIT, y OFFSET sin ORDER BY se ignora)',
        filtroUbicacion: elegida.porUbicacion ? `tl.location = ${body.locationId}` : 'sin filtro por ubicacion',
        degradaciones: intentos,
        note: 'RESTlet exclusivo del plan maestro; devuelve id estable de manufacturingoperationtask'
      }
    };
  }

  /**
   * Corre el SQL del 2240 segun la estrategia. Sin `paginado` trae el catalogo completo y
   * recorta en memoria (el comportamiento viejo, que ya se sabe que funciona en esta cuenta);
   * con `paginado` resuelve la pagina en la consulta con FETCH NEXT/OFFSET.
   *
   * `totalSinFiltro` se calcula solo cuando hay filtro por ubicacion, para poder distinguir
   * "esta planta no tiene operaciones" de "el filtro no funciona": en el segundo caso hay que
   * degradar a sin filtro en vez de devolver una lista vacia.
   */
  function consultar_(estrategia, pageIndex, pageSize, locationId) {
    // Siempre trae el catalogo completo y recorta en memoria. Esto es DECISION, no imposibilidad:
    // medido el 2026-09-28 contra esta cuenta, `ORDER BY ... OFFSET n ROWS FETCH NEXT m ROWS ONLY`
    // SI se acepta. El 400 de las 08:00 del 2026-09-26 vino de escribir las clausulas al reves
    // (`FETCH NEXT m ROWS ONLY OFFSET n ROWS`), que es lo que decia este comentario y quedo
    // registrado como si la cuenta no aceptara paginacion.
    // Otros limites medidos el mismo dia: `LIMIT` no existe (400) y `OFFSET` sin `ORDER BY` se
    // ignora en silencio (RULE-REP-016-A). Se mantiene el recorte en memoria porque con este
    // catalogo (2400 filas) el ahorro se consigue con el pageSize, que es decision del servidor.
    let conFiltro = null;
    if (estrategia.porUbicacion) {
      const c = armarSql_(true, pageIndex, pageSize, locationId);
      conFiltro = runSuiteQL_(c.sql, c.params);
    }
    const s = armarSql_(false, pageIndex, pageSize, null);
    const sinFiltro = runSuiteQL_(s.sql, s.params);
    const base = conFiltro || sinFiltro;
    const from = pageIndex * pageSize;
    const to = from + pageSize;
    return {
      filas: base.slice(from, to),
      hayMas: to < base.length,
      totalSinFiltro: sinFiltro.length
    };
  }

  function armarSql_(porUbicacion, pageIndex, pageSize, locationId) {
    const where = [
      "UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%CERRAD%'",
      "UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%CLOSED%'",
      "UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%COMPLET%'",
    ];
    const params = [];
    if (porUbicacion && locationId) {
      where.push('tl.location = ?');
      params.push(locationId);
    }

    // El desempate por mot.id mantiene el orden estable entre llamadas, para que el recorte
    // en memoria siempre reparta las mismas filas.
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
      // OJO, MEDIDO el 2026-09-28 (este comentario estaba mal el 2026-09-26): `mot.status` se
      // pide CRUDO y no se puede envolver, porque es un campo enumerado/estatico y BUILTIN.DF
      // responde 400 "Cannot build builtin function / Static field is not supported for
      // Builtin.DF function". `mot.manufacturingworkcenter` SI se puede envolver, porque es una
      // referencia a entidad, y de hecho el nombre de la operacion sale de ahi (arriba, `AS
      // operation`). Lo que se puede envolver NO depende del campo: depende de si el campo es
      // una referencia o un valor estatico. Abajo, `workcenter` se deja crudo porque ese es el
      // valor que la app usa como CT.
      '  mot.status                                AS status_op,',
      '  mot.manufacturingworkcenter               AS workcenter,',
      '  mot.setuptime                             AS setup_min,',
      '  mot.estimatedwork                         AS est_min,',
      '  mot.actualwork                            AS real_min,',
      '  mot.remainingwork                         AS remaining_min,',
      '  mot.runrate                               AS production_rate,',
      '  mot.laborresources                        AS human_resource,',
      '  mot.machineresources                      AS machine_resource,',
      '  mot.completedquantity                     AS qty_completed,',
      // tl.location SOLO en la estrategia con filtro: si la columna no se llamara asi en la
      // cuenta, el parseo de TODA la consulta falla y la app se queda sin operaciones. Por eso
      // la ultima estrategia ni la menciona. Aqui solo se agrega una columna mas.
      // Sobre BUILTIN.DF, MEDIDO el 2026-09-28: se puede envolver un campo que sea REFERENCIA
      // A ENTRO (`mot.manufacturingworkcenter`, `transaction.status`, `wc.id` de un JOIN) y NO
      // se puede envolver un campo ESTATICO/enumerado (`mot.status`), que responde 400 con
      // "Cannot build builtin function / Static field is not supported for Builtin.DF function".
      // Antes se generalize mal a "BUILTIN.DF no funciona" y por eso el lector de operaciones
      // del restlet de ingesta se fue a un JOIN contra la tabla `manufacturingworkcenter`, que
      // no existe en esta cuenta, y dejo la accion entera muerta.
      porUbicacion ? '  tl.location                               AS location' : "  ''                                       AS location",
      'FROM manufacturingoperationtask mot',
      'JOIN transaction wo',
      '  ON wo.id = mot.workorder',
      'JOIN transactionline tl',
      '  ON tl.transaction = wo.id',
      " AND tl.mainline = 'T'",
      'WHERE',
      where.map((clause) => clause).join('\n  AND '),
      'ORDER BY wo.id, mot.operationsequence, mot.id'
    ];

    // La pagina se recorta en memoria. NO se usa FETCH NEXT/OFFSET por DECISION, no porque la
    // cuenta lo rechace: medido el 2026-09-28, `ORDER BY ... OFFSET n ROWS FETCH NEXT m ROWS
    // ONLY` SI se acepta en esta cuenta. El 400 "Failed to parse SQL" del 2026-09-26 08:00 (con
    // el que se dio por hecho que la cuenta no aceptaba paginacion) fue por el ORDEN de las
    // clausulas, no por la sintaxis. Si se cambia esto, el orden correcto es OFFSET antes de
    // FETCH NEXT y con ORDER BY de antemano.
    // Lo que si se aprovecho del cambio es el pageSize: con 2500 en vez de 200, las 2400 filas
    // entran en UNA llamada en vez de 12, y el termino fijo medido es de ~2 s por llamada
    // (2023 ms + 0.543 ms por fila), asi que el ahorro son ~22 s por sincronizacion.
    return { sql: sql.join('\n'), params: params };
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
