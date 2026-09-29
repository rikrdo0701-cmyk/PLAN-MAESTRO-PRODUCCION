/**
 * Espejo de CATALOGOS: Hojas -> Supabase.
 *
 * POR QUE EXISTE. La decision de arquitectura es que Supabase es el almacen de
 * lectura Y escritura: la web lee por PostgREST con la clave publicable (solo
 * SELECT, RLS lo permite) y Apps Script escribe con la service role key, que
 * salta RLS. MEDIDO el 2026-09-29: el rol `anon` NO puede escribir (PostgREST
 * 401 / 42501 "new row violates row-level security policy"), y el DDL lo
 * dice a proposito: "No se da politica de escritura a anon a proposito: si la
 * web pudiera escribir, podria pisar el plan" (docs/schema-supabase-sync-netsuite.sql).
 *
 * Sin este espejo, los catalogos de Supabase se quedan en la siembra del
 * 2026-09-28T05:11 mientras las hojas siguen avanzando: la pagina leeria datos
 * viejos. Con el, cada guardado del catalogo deja Supabase al dia y la pagina
 * puede leerlo (RULE-SUP-015).
 *
 * QUE ESPEJA Y QUE NO, Y POR QUE.
 *  - Espeja las 10 tablas de catalogo de abajo, con el MISMO mecanismo atomico
 *    de la ingesta de NetSuite: el RPC public.ingesta_mirror borra la tabla e
 *    inserta lo nuevo DENTRO de una transaccion. Si algo falla, el rollback
 *    deja la tabla con los datos anteriores: nunca queda a medias ni vacia.
 *  - NO espeja `machines`: esa tabla la escribe el RESTlet unificado 2246 desde
 *    NetSuite (los entitygroup que son centro de trabajo, RULE-SUP-010) y la
 *    hoja MAQUINAS guarda lo mismo. Espejarla aqui serian DOS escritores
 *    peleandose la tabla cada 15 minutos. Un solo escritor por almacen.
 *  - NO espeja `app_state`, `selected_ots`, `locked_ots`, `operation_plan_statuses`
 *    ni `plan_snapshots`: son estado y plan de la aplicacion, no catalogo.
 *    Migrarlos es la fase 4 y no se hace de contrabando.
 *
 * DE DONDE VIENEN LAS COLUMNAS. Cada tabla delega en los encabezados reales de
 * la hoja (PP_SHEETS, src/server/02-storage.js:1-34) y no en un supuesto. Las
 * columnas que la hoja tiene y Supabase NO (medido el 2026-09-29) se aggregate-
 * ron en docs/schema-supabase-cierre-catalogos.sql: NOMBRE de OPERADORES,
 * PALABRAS_CLAVE y CUSTOM de CAPACIDADES, el factor de SOLAPAMIENTO (que en la
 * hoja es un RATIO 0..1 y aqui habia quedado boolean), el ID de HERRAMENTALES y
 * de SUBCONTRATOS, la ventana de CALENDARIO y PRECIO_REF_VENTA.
 *
 * ORDEN DE DESPLIEGUE: primero se aplica ese DDL (habilita las columnas nuevas y
 * mete estas tablas en la whitelist del RPC), despues se sube este archivo. Al
 * reves, el RPC levanta un error de columna desconocida a proposito (no se
 * descartan columnas en silencio) y este espejo lo reporta en el log.
 *
 * NUNCA ROMPE UN GUARDADO. Todo va en try/catch por tabla y el conjunto: la hoja
 * sigue siendo la autoridad y un fallo de Supabase no puede impedir guardar el
 * plan. El error se ve en el log y en la fila de auditoria, no en un error 500.
 */

const PP_CATALOGO_TABLAS_ = [
  {
    tabla: 'operators',
    hoja: 'OPERADORES',
    clave: function (r) { return String(r.OPERADOR || '').trim(); },
    mapear: function (r) {
      return {
        nombre: String(r.OPERADOR || '').trim(),
        nombre_real: String(r.NOMBRE || '').trim(),
        activo: PP_boolCelda_(r.ACTIVO, true),
        minutos_capacidad: PP_numero_(r.MINUTOS_CAPACIDAD, 2400),
        rendimiento_pct: PP_numero_(r.RENDIMIENTO_PCT, 100),
        categoria: String(r.CATEGORIA || '').trim()
      };
    }
  },
  {
    tabla: 'capabilities',
    hoja: 'CAPACIDADES',
    clave: function (r) { return PP_normalizeCapabilityKey_(r.KEY); },
    mapear: function (r) {
      return {
        key: PP_normalizeCapabilityKey_(r.KEY),
        ct: String(r.CT || '').trim(),
        operacion: String(r.OPERACION || '').trim(),
        activa: PP_boolCelda_(r.ACTIVA, true),
        capacidad: String(r.CAPACIDAD || 'FINITA').trim().toUpperCase(),
        // RATIO 0..1: la hoja lo edita como porcentaje y lo divide entre 100
        // (app.js:5067 y 5114). El default 1 es el de PP_buildState_ (Number(x || 1)).
        solapamiento: PP_numero_(r.SOLAPAMIENTO, 1),
        palabras_clave: String(r.PALABRAS_CLAVE || ''),
        requiere_herramental: PP_boolCelda_(r.REQUIERE_HERRAMENTAL, false),
        requiere_kit: PP_boolCelda_(r.REQUIERE_KIT, false),
        custom: PP_boolCelda_(r.CUSTOM, false),
        eficiencia_pct: PP_numero_(r.EFICIENCIA_PCT, 100)
      };
    }
  },
  {
    tabla: 'operation_catalog',
    hoja: 'CATALOGO_OPERACIONES',
    clave: function (r) { return PP_normalizeCapabilityKey_(r.KEY); },
    mapear: function (r) {
      return {
        key: PP_normalizeCapabilityKey_(r.KEY),
        ct: String(r.CT || '').trim(),
        label: String(r.OPERACION || '').trim(),
        source: String(r.ORIGEN || 'NETSUITE').trim() || 'NETSUITE',
        active: PP_boolCelda_(r.ACTIVA, true)
      };
    }
  },
  {
    tabla: 'matrix',
    hoja: 'MATRIZ',
    clave: function (r) { return PP_normalizeCapabilityKey_(r.CAPACIDAD_KEY) + '#' + String(r.OPERADOR || '').trim(); },
    mapear: function (r) {
      return {
        capability_key: PP_normalizeCapabilityKey_(r.CAPACIDAD_KEY),
        operator: String(r.OPERADOR || '').trim(),
        habilitado: PP_boolCelda_(r.HABILITADO, true)
      };
    }
  },
  {
    tabla: 'tools',
    hoja: 'HERRAMENTALES',
    clave: function (r) { return String(r.ID || '').trim(); },
    mapear: function (r) {
      return {
        codigo: String(r.ID || '').trim(),
        parte: String(r.PARTE || '').trim(),
        herramental: String(r.HERRAMENTAL || '').trim(),
        kit: String(r.KIT_HERRAMENTAL || '').trim(),
        tiempo_ajuste_herr: PP_numero_(r.TIEMPO_AJUSTE_HERR, 0),
        tiempo_ajuste_kit: PP_numero_(r.TIEMPO_AJUSTE_KIT, 0),
        activo: PP_boolCelda_(r.ACTIVO, true)
      };
    }
  },
  {
    tabla: 'subcontracts',
    hoja: 'SUBCONTRATOS',
    clave: function (r) { return String(r.ID || '').trim(); },
    mapear: function (r) {
      return {
        codigo: String(r.ID || '').trim(),
        parte: String(r.PARTE || '*').trim() || '*',
        tipo: String(r.TIPO || '').trim(),
        dias_habiles: PP_numero_(r.DIAS_HABILES, 0),
        activo: PP_boolCelda_(r.ACTIVO, true)
      };
    }
  },
  {
    tabla: 'ot_types',
    hoja: 'TIPOS_OT',
    clave: function (r) { return String(r.NOMBRE || '').trim().toUpperCase(); },
    mapear: function (r) {
      // El id lo pone la base (el RPC descarta id/created_at/updated_at del
      // payload a proposito), asi que aqui solo va lo que tiene texto propio.
      return {
        nombre: String(r.NOMBRE || '').trim().toUpperCase(),
        activo: PP_boolCelda_(r.ACTIVO, true)
      };
    }
  },
  {
    tabla: 'calendar_exceptions',
    hoja: 'CALENDARIO',
    clave: function (r) {
      return [r.FECHA_INICIO, r.CONCEPTO, r.MAQUINA].join('#');
    },
    mapear: function (r) {
      const fechaInicio = PP_fecha_(r.FECHA_INICIO);
      return {
        // 'fecha' es NOT NULL y forma parte del unique (fecha, concepto, maquina):
        // se iguala al inicio de la ventana para no romper ese indice.
        fecha: fechaInicio || PP_fecha_(r.FECHA_FIN) || '1970-01-01',
        concepto: String(r.CONCEPTO || 'GENERAL').trim() || 'GENERAL',
        maquina: String(r.MAQUINA || '').trim(),
        fecha_inicio: fechaInicio || null,
        hora_inicio: String(r.HORA_INICIO || '').trim(),
        fecha_fin: PP_fecha_(r.FECHA_FIN) || null,
        hora_fin: String(r.HORA_FIN || '').trim(),
        motivo: String(r.MOTIVO || '').trim(),
        activo: PP_boolCelda_(r.ACTIVO, true)
      };
    }
  },
  {
    tabla: 'ot_configurations',
    hoja: 'CONFIGURACION_OT',
    clave: function (r) { return String(r.OT || '').trim(); },
    mapear: function (r) {
      return {
        ot: String(r.OT || '').trim(),
        maquina: String(r.MAQUINA || '').trim(),
        kit: String(r.KIT_HERRAMENTAL || '').trim(),
        kit_pendiente: PP_boolCelda_(r.KIT_PENDIENTE, false),
        tipo_subcontrato: String(r.TIPO_SUBCONTRATO || '').trim(),
        dias_subcontrato: PP_numero_(r.DIAS_SUBCONTRATO, 0),
        herramental: String(r.HERRAMENTAL || '').trim(),
        // jsonb: una celda vacia NO es un jsonb valido y haria fallar TODO el
        // insert de la tabla (y el rollback la dejaria con los datos previos).
        herramentales_extra: PP_json_(r.HERRAMENTALES_EXTRA_JSON, '[]'),
        actualizado: PP_timestamp_(r.ACTUALIZADO)
      };
    }
  },
  {
    tabla: 'article_configurations',
    hoja: 'CONFIGURACION_ARTICULO',
    clave: function (r) { return String(r.ARTICULO || '').trim(); },
    mapear: function (r) {
      return {
        articulo: String(r.ARTICULO || '').trim(),
        tipo_ot: String(r.TIPO_OT || '').trim().toUpperCase(),
        // El encabezado real es TIPO_TRABAJO (PP_SHEETS.CONFIGURACION_ARTICULO,
        // 02-storage.js:21). Aqui estuvo mal escrito TIPO_TRABJO y el campo salia
        // vacio sin dar error: la sonda .openchamber/diag-catalogo-payload.mjs lo
        // caza, y tests/supabase-catalogo-mapping.test.mjs lo vuelve a cazar.
        tipo_trabajo: String(r.TIPO_TRABAJO || '').trim().toUpperCase(),
        precio_manual: PP_numero_(r.PRECIO_MANUAL, 0),
        // PRECIO_REF_VENTA lo baja el sync con el precio de venta de NetSuite
        // (RULE-REP-021): es distinto de PRECIO_MANUAL, que escribe una persona.
        precio_ref_venta: PP_numero_(r.PRECIO_REF_VENTA, 0),
        actualizado: PP_timestamp_(r.ACTUALIZADO)
      };
    }
  }
];

// -----------------------------------------------------------------------------
// Que espeja cada guardado. Se pasa solo lo que el guardado toco, porque un
// guardado de plan no debe pagar 10 llamadas de HTTP cada vez. `machines` no
// aparece en ninguna lista a proposito: la escribe el RESTlet 2246 (RULE-SUP-010).
// -----------------------------------------------------------------------------

// PP_writeCatalogState_: la pestana Catalogos de la pagina.
var PP_CATALOGO_TABLAS_CATALOGOS_ = [
  'ot_configurations', 'article_configurations', 'tools',
  'calendar_exceptions', 'subcontracts', 'ot_types'
];

// PP_writeSkillState_: la pestana de matriz/operadores.
var PP_CATALOGO_TABLAS_MATRIZ_ = [
  'operators', 'capabilities', 'operation_catalog', 'matrix'
];

// PP_writeNetSuiteSyncState_: el sync solo puede cambiar el catalogo de operaciones.
var PP_CATALOGO_TABLAS_SYNC_ = ['operation_catalog'];

// -----------------------------------------------------------------------------
// Configuracion
// -----------------------------------------------------------------------------

function PP_supabaseCatalogoConfig_() {
  var url = (typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL) ? String(SUPABASE_URL) : '';
  var key = (typeof SUPABASE_KEY !== 'undefined' && SUPABASE_KEY) ? String(SUPABASE_KEY) : '';
  if ((!url || !key) && typeof PropertiesService !== 'undefined') {
    var p = PropertiesService.getScriptProperties();
    url = url || (p.getProperty('SUPABASE_URL') || '');
    key = key || (p.getProperty('SUPABASE_KEY') || '');
  }
  // Sin credencial el espejo no hace nada: la pagina sigue leyendo de las hojas.
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ''), key: key };
}

// -----------------------------------------------------------------------------
// Espejo
// -----------------------------------------------------------------------------

/**
 * Espeja las tablas de catalogo indicadas (o las 10 por omision). Devuelve un
 * resumen para el log/auditoria. NUNCA lanza: una tabla que falla se reporta y
 * las demas siguen.
 *
 * `tablas` son nombres de TABLA de Supabase, no de hoja. Se pasa solo lo que el
 * guardado toco: guardar la matriz no necesita reescribir herramientas y
 * subcontratos, y un guardado de plan no deberia pagar 10 llamadas de HTTP cada
 * vez (RULE-PERF-*: estos guardados tienen timeout de 180s).
 *
 * `PP_CATALOGO_PRESUPUESTO_MS` acota lo que se intenta: si Supabase esta lento o
 * caido, se corta el espejo y se reporta. La hoja YA quedo escrita y la pagina
 * sigue leyendo de ahi, asi que quedarse a medias no rompe el guardado; lo
 * unico que se pierde es la frescura de Supabase, que es justo lo que el proximo
 * guardado intentara de nuevo.
 */
var PP_CATALOGO_PRESUPUESTO_MS = 20000;

function PP_mirrorCatalogosSupabase_(spreadsheet, tablas) {
  var config = null;
  try {
    config = PP_supabaseCatalogoConfig_();
  } catch (e) {
    return { ok: false, motivo: 'no se pudo leer la configuracion: ' + String((e && e.message) || e).slice(0, 120), tablas: {} };
  }
  if (!config) {
    return { ok: false, motivo: 'sin configuracion de Supabase', tablas: {} };
  }
  var solo = tablas ? {} : null;
  if (solo) {
    for (var q = 0; q < tablas.length; q++) solo[String(tablas[q])] = true;
  }
  var resumen = { ok: true, tablas: {} };
  var limite = new Date().getTime() + PP_CATALOGO_PRESUPUESTO_MS;
  for (var i = 0; i < PP_CATALOGO_TABLAS_.length; i++) {
    var def = PP_CATALOGO_TABLAS_[i];
    if (solo && !solo[def.tabla]) continue;
    if (new Date().getTime() > limite) {
      resumen.ok = false;
      resumen.tablas[def.tabla] = 'omitida: se acabo el presupuesto de ' + PP_CATALOGO_PRESUPUESTO_MS + 'ms';
      continue;
    }
    try {
      var sheet = spreadsheet.getSheetByName(def.hoja);
      if (!sheet) {
        // Hoja inexistente: se SALTA, no se espeja vacio. Borrar la tabla porque
        // no se pudo leer la hoja dejaria al plan sin catalogo.
        resumen.tablas[def.tabla] = 'sin hoja ' + def.hoja + ' (saltada)';
        continue;
      }
      var filas = [];
      var vistas = {};
      var sueltas = PP_readRows_(sheet);
      for (var j = 0; j < sueltas.length; j++) {
        var fila = def.mapear(sueltas[j]);
        // Deduplicar por la clave natural de la tabla: si la hoja trajera dos
        // filas con la misma clave, el INSERT violaria el UNIQUE y el rollback
        // dejaria la tabla con los datos viejos (no con los nuevos).
        var clave = String(def.clave(sueltas[j]) || '').trim();
        if (!clave) continue;
        if (vistas[clave]) continue;
        vistas[clave] = true;
        filas.push(fila);
      }
      var r = PP_supabaseMirrorCatalogo_(def.tabla, filas, config);
      resumen.tablas[def.tabla] = r.insertadas + ' filas (' + r.borradas + ' borradas)';
    } catch (e) {
      resumen.ok = false;
      resumen.tablas[def.tabla] = 'ERROR ' + String((e && e.message) || e).slice(0, 160);
      console.log('Catalogo ' + def.tabla + ': ERROR ' + String((e && e.message) || e).slice(0, 300));
    }
  }
  return resumen;
}

// -----------------------------------------------------------------------------
// Trazabilidad
// -----------------------------------------------------------------------------

/**
 * Deja rastro del espejo: una fila en AUDITORIA con el detalle por tabla y, si
 * algo fallo, un throw-free log. Best-effort total: si ni la fila se puede
 * escribir, el guardado ya esta hecho y no se rompe por eso.
 */
function PP_logCatalogoSupabase_(spreadsheet, resumen, accion, revision) {
  try {
    var texto = accion + '|' + revision + '|' + JSON.stringify(resumen.tablas);
    console.log('Catalogo->Supabase ' + texto);
    spreadsheet.getSheetByName('AUDITORIA').appendRow([
      new Date().toISOString(),
      'SUPABASE',
      resumen.ok ? 'ESPEJO_CATALOGOS' : 'ESPEJO_CATALOGOS_PARCIAL',
      revision,
      texto.slice(0, 900)
    ]);
  } catch (e) {
    console.log('No se pudo registrar el espejo de catalogo: ' + String((e && e.message) || e).slice(0, 200));
  }
}

function PP_supabaseMirrorCatalogo_(tabla, filas, config) {
  var res = UrlFetchApp.fetch(config.url + '/rest/v1/rpc/ingesta_mirror', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.key,
      Authorization: 'Bearer ' + config.key
    },
    payload: JSON.stringify({ p_tabla: tabla, p_filas: filas }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var texto = res.getContentText();
  if (code !== 200) {
    throw new Error('ingesta_mirror ' + tabla + ' ' + code + ': ' + texto.slice(0, 300));
  }
  var json = JSON.parse(texto);
  return { insertadas: json.insertadas || 0, borradas: json.borradas || 0 };
}

// -----------------------------------------------------------------------------
// Conversiones de celda
// -----------------------------------------------------------------------------

/** Igual que PP_bool_ del servidor: acepta boolean y los textos de una hoja. */
function PP_boolCelda_(valor, porDefecto) {
  if (valor === true || valor === false) return valor;
  var texto = String(valor == null ? '' : valor).trim().toUpperCase();
  if (texto === 'TRUE' || texto === 'VERDADERO' || texto === 'SI' || texto === '1') return true;
  if (texto === 'FALSE' || texto === 'FALSO' || texto === 'NO' || texto === '0') return false;
  return porDefecto;
}

function PP_numero_(valor, porDefecto) {
  if (valor === null || valor === undefined || String(valor).trim() === '') return porDefecto;
  var n = Number(valor);
  return isFinite(n) ? n : porDefecto;
}

/** Date de la celda o texto -> 'YYYY-MM-DD'. Vacio -> '' (la tabla lo vuelve null). */
function PP_fecha_(valor) {
  if (!valor && valor !== 0) return '';
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    return Utilities.formatDate(valor, 'America/Mexico_City', 'yyyy-MM-dd');
  }
  var texto = String(valor).trim();
  if (!texto) return '';
  var m = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  variso = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (variso) {
    return variso[3] + '-' + ('0' + variso[1]).slice(-2) + '-' + ('0' + variso[2]).slice(-2);
  }
  var d = new Date(texto);
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, 'America/Mexico_City', 'yyyy-MM-dd');
}

/** timestamptz: ISO si se puede; '' -> null (la columna es nullable). */
function PP_timestamp_(valor) {
  if (valor == null || String(valor).trim() === '') return null;
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    return Utilities.formatDate(valor, 'Etc/GMT', "yyyy-MM-dd'T'HH:mm:ss'Z'");
  }
  var texto = String(valor).trim();
  if (isNaN(new Date(texto).getTime())) return null;
  return texto;
}

/** jsonb: solo pasa texto que sea JSON valido; si no, el valor por defecto. */
function PP_json_(valor, porDefecto) {
  var texto = String(valor == null ? '' : valor).trim();
  if (!texto) return porDefecto;
  try {
    JSON.parse(texto);
    return texto;
  } catch (e) {
    console.log('Catalogo: JSON invalido, se usa ' + porDefecto + ' -> ' + texto.slice(0, 80));
    return porDefecto;
  }
}
