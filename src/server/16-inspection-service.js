const PP_INSPECTION_DEFAULT_SPREADSHEET_ID = '1X0jtJBgxcD8jIKYVhuw76OTVLP74Lv2yZsbPA_WpG9M';
const PP_INSPECTION_ROUTES_SHEET = 'Tramos';
const PP_INSPECTION_HISTORY_SHEET = 'HISTORIAL_IMPRESION_INSPEC';
const PP_INSPECTION_ROUTE_INDEX_CACHE_KEY = 'PP_INSPECTION_ROUTE_INDEX_V2';
const PP_INSPECTION_ROUTE_INDEX_CACHE_TTL_SECONDS = 900;

function PP_Inspection_result_(callback) {
  try { return { ok: true, data: callback() }; }
  catch (error) { return { ok: false, error: String(error && error.message || error) }; }
}

function PP_Inspection_book_() {
  const properties = PropertiesService.getScriptProperties();
  const id = String(properties.getProperty('INSPECTION_SPREADSHEET_ID') || PP_INSPECTION_DEFAULT_SPREADSHEET_ID).trim();
  return SpreadsheetApp.openById(id);
}

function PP_Inspection_headerKey_(value) {
  return String(value == null ? '' : value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function PP_Inspection_normalizeSheet_(sheet, headers, normalizeRoutes) {
  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sheet;
  }
  if (normalizeRoutes) {
    let current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    for (let index = current.length - 1; index >= 0; index -= 1) {
      const key = PP_Inspection_headerKey_(current[index]);
      if (key === 'AUX' || key === 'USUARIOMODIFICACION') sheet.deleteColumn(index + 1);
    }
    current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    current.forEach(function(value, index) {
      if (PP_Inspection_headerKey_(value) === 'BF') sheet.getRange(1, index + 1).setValue('Articulo');
    });
  }
  const existing = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0]
    .reduce(function(index, value) { index[PP_Inspection_headerKey_(value)] = true; return index; }, {});
  headers.forEach(function(header) {
    const key = PP_Inspection_headerKey_(header);
    if (!existing[key]) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      existing[key] = true;
    }
  });
  return sheet;
}

function PP_Inspection_sheet_(name, headers) {
  const book = PP_Inspection_book_();
  let sheet = book.getSheetByName(name);
  if (!sheet) sheet = book.insertSheet(name);
  PP_Inspection_normalizeSheet_(sheet, headers, name === PP_INSPECTION_ROUTES_SHEET);
  sheet.setFrozenRows(1);
  return sheet;
}

function PP_Inspection_routeIndexCache_() {
  try {
    if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) return CacheService.getScriptCache();
  } catch (error) {
    // La cache es opcional; ignorar fallos de acceso.
  }
  return null;
}

function PP_Inspection_invalidateRouteIndexCache_() {
  const cache = PP_Inspection_routeIndexCache_();
  if (!cache) return;
  try {
    cache.remove(PP_INSPECTION_ROUTE_INDEX_CACHE_KEY);
  } catch (error) {
    // Un fallo de invalidacion no impide seguir guardando el vinculo.
  }
}

function PP_Inspection_text_(value, maxLength) {
  const text = String(value == null ? '' : value).trim();
  return maxLength ? text.slice(0, maxLength) : text;
}

function PP_Inspection_value_(row, names) {
  const normalized = {};
  Object.keys(row || {}).forEach(function(key) { normalized[PP_normalizeKey_(key)] = row[key]; });
  for (let index = 0; index < names.length; index += 1) {
    const value = normalized[PP_normalizeKey_(names[index])];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

function PP_Inspection_number_(value) {
  const number = parseFloat(String(value == null ? '' : value).replace(/,/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function PP_Inspection_longDate_(value) {
  if (!value) return '';
  const raw = String(value).trim();
  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) {
    const short = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (short) match = [short[0], short[3], short[2], short[1]];
  }
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(value);
  if (isNaN(date.getTime())) return raw;
  const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return days[date.getDay()] + ', ' + date.getDate() + ' de ' + months[date.getMonth()] + ' de ' + date.getFullYear();
}

function PP_Inspection_restlet_(body) {
  const properties = PropertiesService.getScriptProperties();
  const config = PP_netSuiteConfig_();
  const query = {
    script: properties.getProperty('NS_WO_INSPECTION_SCRIPT') || '2244',
    deploy: properties.getProperty('NS_WO_INSPECTION_DEPLOY') || '1'
  };
  const response = PP_netSuiteRestletRequest_(query, Object.assign({
    table: 'WO_INSPECCION', locationId: config.locationId, onlyOpen: true
  }, body || {}), config);
  if (!response.ok) {
    // PP_Inspection_result_ devuelve { ok: false } en vez de lanzar, asi que la ejecucion
    // termina sin error y el status/cuerpo de NetSuite solo existia como texto en el
    // cliente. Este console.error deja el detalle (script, deploy, body y respuesta) en
    // el registro de ejecuciones de Apps Script, que es donde se diagnostica NetSuite.
    const detail = 'NetSuite inspeccion ' + response.status
      + ' script=' + query.script + ' deploy=' + query.deploy
      + ' body=' + JSON.stringify(body || {})
      + ' raw=' + response.raw.slice(0, 300);
    try { console.error(detail); } catch (error) { /* registrar un fallo nunca debe romper la llamada */ }
    throw new Error('NetSuite inspeccion: ' + response.status + ' ' + response.raw.slice(0, 300));
  }
  if (response.json && response.json.ok === false) throw new Error(response.json.error || 'Respuesta invalida de NetSuite');
  return response.json || {};
}

function getInspectionWorkOrders() {
  return PP_Inspection_result_(function() {
    const response = PP_Inspection_restlet_({ action: 'list', pageIndex: 0, pageSize: 500 });
    const rows = response.wos || response.rows || response.data || [];
    return rows.map(function(row) {
      const dueDate = PP_Inspection_text_(PP_Inspection_value_(row, ['fechaEntrega', 'duedate', 'enddate']));
      return {
        wo: PP_Inspection_text_(PP_Inspection_value_(row, ['wo', 'WO Folio', 'workorder_tranid', 'tranid', 'Trabajo'])),
        article: PP_Inspection_text_(PP_Inspection_value_(row, ['Articulo', 'item_name', 'item', 'Ensamble'])),
        description: PP_Inspection_text_(PP_Inspection_value_(row, ['descripcion', 'description'])),
        quantity: Number(PP_Inspection_value_(row, ['cantidad', 'quantity', 'qty']) || 0),
        status: PP_Inspection_text_(PP_Inspection_value_(row, ['estatus', 'status', 'Estado'])),
        dueDate: PP_dateToIso_(dueDate)
      };
    }).filter(function(item) { return item.wo; });
  });
}

// =============================================================================
// EL CATALOGO DE TRAMOS VIVE EN SUPABASE (migrado de la hoja `Tramos`)
// =============================================================================
//
// QUE CAMBIO Y POR QUE. La fuente de los tramos era la hoja `Tramos` del libro
// INSPECTION_SPREADSHEET_ID. Es un dato MANUAL que se edita desde dos lugares de
// la pagina, y no llegaba a Supabase: la web leia de `materials`, que es tabla del
// ERP y no tiene columna de tramo, y guardaba ahi. La tabla es
// `inspection_routes` (docs/schema-inspection-routes.sql).
//
// UN ESCRITOR, Y POR QUE ESTO SOLO LEE. La pagina escribe con su sesion por
// PPSupabaseWriter.guardarInspectionRoute. Apps Script SOLO lee, con la service
// role (PP_supabaseLee_), para resolver el tramo y el dibujo de cada material al
// imprimir. Si Apps Script tambien escribiera, habria dos escritores sobre la
// misma tabla y el ultimo en escribir le pisaria el dato al otro sin que ninguno
// se enterara (RULE-SUP-015).
//
// LA HOJA NO SE BORRA Y SE CONGELA. Sigue siendo el respaldo de lo que habia y es
// de donde sale la importacion (PP_migrarTramosASupabase_). Si se edita a mano
// DESPUES de migrar, Supabase no lo ve: la fuente es una sola y esta ya no es la
// hoja.
//
// EL REPARTO CON LA HOJA, Y POR QUE SE DICE EN VEZ DE OCULTARSE. Si la lectura de
// Supabase falla (DDL sin aplicar, credencial, red), la hoja responde y el
// resultado trae `fuente` y `aviso` para que la pagina lo diga. Un catalogo
// vacio sin explicacion es la peor de las salidas: se ve correcto y no lo esta. La
// hoja es el respaldo, no la fuente, y por eso la lectura la intenta PRIMERO a
// Supabase.
//
// NOTA DE IDENTIDAD, Y POR QUE NO SE CAMBIA. La clave de una fila es
// PP_normalizeKey_(articulo) + '|' + PP_normalizeKey_(material): trim, mayusculas,
// sin acentos y espacios como "_". Es la misma que usaba el indice de la hoja, y
// por eso el comportamiento de emparejamiento no cambia al migrar. El segundo
// nivel, que ademas quita la puntuacion, sigue calculandose al leer en
// PP_Inspection_routeLooseKey_ (17-inspection-drawing-service.js) y no se metio en
// la base: meterlo exigiria un indice sobre una expresion, y PostgREST solo
// resuelve on_conflict contra un indice unico sobre COLUMNAS.
// =============================================================================

/** La clave de un tramo. Es la columna `clave` y el indice unico de la tabla. */
function PP_Inspection_routeKey_(article, material) {
  return PP_normalizeKey_(article) + '|' + PP_normalizeKey_(material);
}

/** La clave laxa, la del segundo nivel del emparejamiento. Solo para deduplicar. */
function PP_Inspection_routeLooseKey_(value) {
  return String(value == null ? '' : value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
}

/**
 * El texto del dibujo, limpio de las comillas que la hoja arrastra.
 *
 * MEDIDO 2026-10-01: la columna DIBUJO de la hoja `Tramos` a veces llega con una
 * comilla simple o doble al principio y al final, y sin quitarla la liga que se
 * arma en la hoja de impresion no abre. Se limpia AL LEER y no al guardar, para no
 * reescribir la fila de la tabla solo por quitar unas comillas: el que se guardo
 * es el texto que la persona escribio.
 *
 * Antes vivia en 17-inspection-drawing-service.js y lo usaba el indice de la hoja
 * de ahi. Con la migracion a Supabase el indice se arma en 16
 * (PP_Inspection_routeIndexFrom_), y dejar la funcion en 17 obligaba a que el
 * servicio base dependiera del de dibujo. En Apps Script el orden de carga no
 * importa para llamadas en tiempo de ejecucion, asi que "funciona igual" no es
 * argumento: la dependencia si lo es.
 */
function PP_Inspection_cleanDrawing_(value) {
  return PP_Inspection_text_(value, 1000).replace(/^['"]+|['"]+$/g, '').trim();
}

/** Una fila de la tabla, con los nombres que consume el resto del servicio. */
function PP_Inspection_routeRow_(articulo, material, tramo, dibujo, actualizado) {
  const article = PP_Inspection_text_(articulo, 200);
  const materia = PP_Inspection_text_(material, 200);
  if (!article) return null;
  return {
    ARTICULO: article,
    MATERIAL: materia,
    TRAMO: PP_Inspection_text_(tramo, 100),
    DIBUJO: PP_Inspection_cleanDrawing_(dibujo),
    ACTUALIZADO: PP_Inspection_text_(actualizado, 40)
  };
}

/** INDEXA las filas ya normalizadas. GANA LA ULTIMA de cada clave, como en la hoja. */
function PP_Inspection_routeIndexFrom_(filas) {
  const index = {};
  (filas || []).forEach(function (row) {
    if (!row || !row.ARTICULO) return;
    index[PP_Inspection_routeKey_(row.ARTICULO, row.MATERIAL)] = row;
  });
  return index;
}

/**
 * Las filas de la TABLA, con la deduplicacion que hacia el indice de la hoja.
 *
 * DEDUPLICAR POR QUE, Y CON QUE GANA. La hoja llega con dos filas que solo se
 * diferencian en las mayusculas ("A-100" y "a-100"), y el indice de antes se
 * quedaba con la ULTIMA porque escribia en un objeto. Con la tabla nueva el
 * UNIQUE esta en `clave`, que sale de PP_normalizeKey_ (mayusculas), o sea que
 * "A-100" y "a-100" SI colisionan y el INSERT se negaria a las dos. Se quitan
 * aqui: la que se queda es la ultima, que es la que ganaba antes. La dedupe es
 * por clave laxa (PP_Inspection_routeLooseKey_, que ademas quita la puntuacion)
 * porque si no, "A-100" y "A 100" serian dos filas distintas en la base y las dos
 * responderian a la busegada laxa: dos verdades para un tramo.
 */
function PP_Inspection_routesDedup_(filas) {
  const porClave = {};
  const orden = [];
  (filas || []).forEach(function (row) {
    if (!row || !row.ARTICULO) return;
    const laxa = PP_Inspection_routeLooseKey_(row.ARTICULO) + '|' + PP_Inspection_routeLooseKey_(row.MATERIAL);
    if (!Object.prototype.hasOwnProperty.call(porClave, laxa)) orden.push(laxa);
    porClave[laxa] = row;
  });
  return orden.map(function (clave) { return porClave[clave]; });
}

/** Las filas de SUPABASE. Lanza si no se puede leer: el que llama decide el plan B. */
function PP_Inspection_routesSupabase_() {
  const filas = PP_supabaseLee_('inspection_routes', {
    select: 'articulo,material,tramo,dibujo,actualizado',
    order: 'actualizado.asc'
  });
  return PP_Inspection_routesDedup_(filas.map(function (row) {
    return PP_Inspection_routeRow_(row.articulo, row.material, row.tramo, row.dibujo, row.actualizado);
  }));
}

/**
 * Las filas de la HOJA, que es de donde se importa. Se conserva porque es el
 * respaldo de lo que habia y porque PP_migrarTramosASupabase_ la necesita viva.
 * NO se edita mas: en cuanto Supabase responde, esta no se lee (ver el bloque de
 * arriba).
 */
function PP_Inspection_routesHoja_() {
  const sheet = PP_Inspection_sheet_(PP_INSPECTION_ROUTES_SHEET, ['Articulo', 'Materia prima', 'Tramo', 'DIBUJO', 'Ultima modificacion']);
  const filas = [];
  PP_readRows_(sheet).forEach(function (row) {
    const fila = PP_Inspection_routeRow_(
      PP_Inspection_value_(row, ['Articulo', 'Artículo', 'bf', 'ARTICULO']),
      PP_Inspection_value_(row, ['Materia prima', 'Material', 'MATERIAL']),
      PP_Inspection_value_(row, ['Tramo', 'TRAMO']),
      PP_Inspection_value_(row, ['DIBUJO', 'Dibujo', 'URL_DIBUJO']),
      PP_Inspection_value_(row, ['Ultima modificacion', 'Última modificación', 'ACTUALIZADO'])
    );
    if (fila) filas.push(fila);
  });
  return PP_Inspection_routesDedup_(filas);
}

/**
 * EL INDICE, y de donde salio cada fila.
 *
 * `fuente` viaja hasta la pagina porque el plan B (la hoja) es un estado
 * degradado, no un resultado equivalente: si alguien edita la hoja a mano
 * mientras tanto, lo que sale en pantalla no es lo que esta guardado, y sin el
 * aviso eso es invisible.
 */
function PP_Inspection_routeIndexConFuente_() {
  if (typeof PP_supabaseLee_ === 'function') {
    try {
      return { index: PP_Inspection_routeIndexFrom_(PP_Inspection_routesSupabase_()), fuente: 'supabase', aviso: '' };
    } catch (error) {
      const motivo = String((error && error.message) || error).slice(0, 200);
      console.log('Tramos: no se pudo leer de Supabase, se usa la hoja. ' + motivo);
      return {
        index: PP_Inspection_routeIndexFrom_(PP_Inspection_routesHoja_()),
        fuente: 'hoja',
        aviso: 'No se pudo leer el catálogo de tramos de Supabase ('
          + motivo + '). Se está mostrando la hoja Tramos, que ya no es la fuente: '
          + 'lo que se capture aquí no se guarda.'
      };
    }
  }
  return {
    index: PP_Inspection_routeIndexFrom_(PP_Inspection_routesHoja_()),
    fuente: 'hoja',
    aviso: 'Supabase no está configurado en este proyecto: el catálogo de tramos sale de la hoja Tramos.'
  };
}

function PP_Inspection_routeIndex_() {
  return PP_Inspection_routeIndexConFuente_().index;
}

/**
 * IMPORTAR LA HOJA A SUPABASE. Se corre A MANO, una vez, desde el editor de Apps
 * Script, despues de aplicar docs/schema-inspection-routes.sql.
 *
 * POR QUE NO HAY UN BOTON EN LA PAGINA. El RPC que usa (public.ingesta_mirror)
 * BORRA la tabla e inserta lo que le manden. Es lo correcto para una importacion y
 * es un arma cargada en una pagina: volveria a dejar el catalogo como estaba en la
 * hoja y se perderia todo lo capturado desde la migracion. Se ejecuta a mano,
 * con el nombre de la accion en el log.
 *
 * QUE DEVUELVE, Y POR QUE DICE LO QUE DICE. `omitidas` son las filas que la hoja
 * traia repetidas por clave (gana la ultima, como siempre) y `escritas` las que
 * quedaron. Si `escritas` es 0 con la hoja llena, el DDL no esta aplicado o la
 * tabla no entra en public.ingesta_mirror_whitelist, y eso se dice aqui para que
 * no haya que adivinarlo desde la pagina.
 *
 * QUE PASA CON LA HOJA DESPUES. Nada: no la borra ni la bloquea. Queda congelada
 * como respaldo, y si alguien la edita a mano la pagina no lo va a ver.
 */
function PP_migrarTramosASupabase_() {
  return PP_Inspection_result_(function () {
    if (typeof PP_supabaseLee_ !== 'function') {
      throw new Error('No hay lector de Supabase en este proyecto (PP_supabaseLee_ no existe). '
        + 'Verifica que 16-supabase-catalogo.js esté desplegado.');
    }
    var config = PP_supabaseCatalogoConfig_();
    if (!config) throw new Error('Supabase sin configurar: falta SUPABASE_URL o SUPABASE_KEY en supabase-config.gs');
    var crudas = PP_Inspection_routesHojaCrudas_();
    var filas = PP_Inspection_routesDedup_(crudas.filas);
    if (!filas.length) throw new Error('La hoja Tramos no tiene filas con artículo: no hay nada que importar');
    var cuerpo = filas.map(function (row) {
      // `crudas.fechas` esta indexada por la MISMA clave que va en la columna
      // `clave`. MEDIDO 2026-10-01: la busqueda usaba `row.ARTICULO + '|' +
      // row.MATERIAL`, o sea el TEXTO tal cual, y por eso nunca encontraba nada:
      // todas las filas salian con `actualizado_at` NULL aunque la celda de la
      // hoja fuera una fecha legible. El sintoma es silencioso y por eso hay un
      // test que lo fija: la fecha se pierde en un `|| null` que nunca cae en la
      // rama del otro lado.
      var clave = PP_Inspection_routeKey_(row.ARTICULO, row.MATERIAL);
      return {
        clave: clave,
        articulo: row.ARTICULO,
        material: row.MATERIAL,
        tramo: row.TRAMO,
        dibujo: row.DIBUJO,
        actualizado: row.ACTUALIZADO,
        actualizado_at: crudas.fechas[clave] || null
      };
    });
    var r = PP_supabaseMirrorCatalogo_('inspection_routes', cuerpo, config);
    PP_Inspection_invalidateRouteIndexCache_();
    console.log('Tramos->Supabase: ' + r.insertadas + ' filas, ' + crudas.omitidas + ' repetidas descartadas');
    return {
      escritas: r.insertadas,
      borradas: r.borradas,
      omitidas: crudas.omitidas,
      fuente: 'hoja Tramos',
      destino: 'inspection_routes'
    };
  });
}

/**
 * La hoja YA deduplicada por clave laxa, con el instante de cada fila.
 *
 * POR QUE SE LLAMA "crudas" SI YA ESTA DEDUPLICADA. Porque no leyo nada mas que
 * la hoja: no sabe nada de Supabase, y por eso es la que se puede correr sin
 * credencial y sin DDL aplicado. La deduplicacion esta porque la tabla nueva tiene
 * UN UNIQUE en `clave` y la hoja llega con repetidas por clave: sin quitarlas, el
 * UNIQUE rechaza la fila y la importacion falla entera.
 *
 * QUIEN GANA, Y POR QUE NO ES LA PRIMERA. La hoja llega con "A-100" y "a100" para
 * la misma materia, y el indice de antes se quedaba con la ULTIMA porque hacia
 * `index[clave] = fila`, que en un objeto reasigna el VALOR y conserva la
 * POSICION. Aqui se reproduce esa misma regla: el contenido de la ultima, en el
 * lugar de la primera. Descartar la nueva (que es lo obvio) traeria los tramos
 * viejos y nadie veria un aviso.
 *
 * `omitidas` es el numero de filas que se pierden por tener la misma clave, y se
 * devuelve para que la importacion no sea silenciosa: si la hoja trae 400 filas y
 * quedan 380, esas 20 son repetidas y se dice cuantas son.
 *
 * `actualizado_at` se llena SOLO si el texto de la celda se pudo leer como fecha.
 * La hoja lo escribe Utilities.formatDate en 'dd/MM/yyyy HH:mm:ss', pero la
 * columna es de texto libre: si alguien escribio otra cosa, se guarda el texto y
 * el instante queda NULL. No se inventa una fecha.
 */
function PP_Inspection_routesHojaCrudas_() {
  var sheet = PP_Inspection_sheet_(PP_INSPECTION_ROUTES_SHEET, ['Articulo', 'Materia prima', 'Tramo', 'DIBUJO', 'Ultima modificacion']);
  var filas = [];
  var fechas = {};
  // DONDE ESTA CADA CLAVE dentro de `filas`. Se usa para reemplazar el CONTENIDO
  // en su lugar y no para ignorar la fila nueva: el indice de la hoja asignaba
  // `index[clave] = fila`, y en un objeto una reasignacion conserva la posicion
  // original y cambia el valor. O sea que la fila que GANA es la ultima en el
  // TIEMPO (contenido) y la PRIMERA en la posicion. Si se descartara la nueva, la
  // que ganaria seria la primera, que es justo lo contrario de lo que pasaba
  // antes, y la importacion traeria tramos viejos sin avisar.
  var donde = {};
  var repetidas = 0;
  PP_readRows_(sheet).forEach(function (row) {
    var fila = PP_Inspection_routeRow_(
      PP_Inspection_value_(row, ['Articulo', 'Artículo', 'bf', 'ARTICULO']),
      PP_Inspection_value_(row, ['Materia prima', 'Material', 'MATERIAL']),
      PP_Inspection_value_(row, ['Tramo', 'TRAMO']),
      PP_Inspection_value_(row, ['DIBUJO', 'Dibujo', 'URL_DIBUJO']),
      PP_Inspection_value_(row, ['Ultima modificacion', 'Última modificación', 'ACTUALIZADO'])
    );
    if (!fila) return;
    var laxa = PP_Inspection_routeLooseKey_(fila.ARTICULO) + '|' + PP_Inspection_routeLooseKey_(fila.MATERIAL);
    if (Object.prototype.hasOwnProperty.call(donde, laxa)) {
      repetidas += 1;
      filas[donde[laxa]] = fila;
    } else {
      donde[laxa] = filas.length;
      filas.push(fila);
    }
    // La fecha va con la fila que gana, no con la primera: si el texto de la
    // repetida no es una fecha, el instante queda NULO. Poner el de la primera
    // seria reportar como vigente una modificacion que la hoja ya no dice.
    var clave = PP_Inspection_routeKey_(fila.ARTICULO, fila.MATERIAL);
    var fecha = PP_Inspection_momentoTexto_(fila.ACTUALIZADO);
    if (fecha) fechas[clave] = fecha;
    else delete fechas[clave];
  });
  return { filas: filas, fechas: fechas, omitidas: repetidas };
}

/** 'dd/MM/yyyy [HH:mm[:ss]]' -> ISO. Vacio o irreconocible -> null, nunca inventado. */
function PP_Inspection_momentoTexto_(valor) {
  var texto = String(valor == null ? '' : valor).trim();
  if (!texto) return null;
  var m = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  var iso = m[3] + '-' + (m[2].length < 2 ? '0' + m[2] : m[2]) + '-' + (m[1].length < 2 ? '0' + m[1] : m[1])
    + 'T' + (m[4] ? (m[4].length < 2 ? '0' + m[4] : m[4]) : '00') + ':' + (m[5] || '00') + ':' + (m[6] || '00') + '.000Z';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

// CONFIRMAR EL CIERRE DE UNA OT CONTRA NETSUITE (RULE-OT-051).
//
// POR QUE HACE FALTA. El catalogo de OTs del 1764 va con onlyOpen:true, asi que una OT cerrada
// no aparece: solo desaparece. El codigo no puede distinguir "cerrada" de "no vino en el
// payload", y por eso antes la ausencia se tomaba por cierre. Este metodo consulta a NetSuite
// POR OT y lee su estatus real, que es la unica confirmacion POSITIVA disponible sin cambiar el
// listado del 1764.
//
// POR QUE EL 2244 Y NO EL LISTADO. El 2244 tiene dos modos: list (que conserva onlyOpen) y
// detail (que lo ignora y por lo tanto SI ve las cerradas). Pedir el listado completo con
// onlyOpen:false traeria TODAS las OTs de la historia con todas sus lineas, paginadas, contra
// la cuota de 20 000 UrlFetch/dia que ya se agoto una vez (RULE-REP-017). Preguntar folio por
// folio cuesta una llamada por OT pendiente, y normalmente no hay ninguna.
//
// QUE DEVUELVE, Y POR QUE CADA CASO ES DISTINTO. found + estatus. found false significa que
// NetSuite no la conoce: eso NO es lo mismo que cerrada (puede estar borrada, o en otra
// planta), asi que el cliente la tiene que CONSERVAR. estatus con CERRAD/CLOSED/COMPLET/
// CANCELAD es cierre confirmado. estatus vacio significa que el 2244 todavia no trae el campo
// (no se ha subido la version nueva), y tambien se conserva: es un estado degradado seguro, no
// se poda nada. Solo se cierra con evidencia positiva.
function confirmWorkOrderClosures(ots) {
  var lista = [];
  var vistas = {};
  (Array.isArray(ots) ? ots : []).forEach(function(item) {
    var folio = PP_Inspection_text_(item, 80);
    var clave = PP_normalizeKey_(folio);
    if (!folio || !clave || vistas[clave]) return;
    vistas[clave] = true;
    lista.push(folio);
  });
  if (!lista.length) return { asked: 0, results: {}, note: 'no habia OTs por confirmar' };

  // Tope duro. Si de pronto hay cientos de OTs por confirmar, eso NO es una confirmacion que
  // valga la pena gastar: es una señal de que algo anda mal, y la respuesta correcta es
  // conservarlas todas y avisar, no pedir hundreds de llamadas.
  var TOPE = 20;
  var recortada = lista.length > TOPE;
  var consultadas = recortada ? lista.slice(0, TOPE) : lista;
  var resultados = {};

  consultadas.forEach(function(folio) {
    var clave = PP_normalizeKey_(folio);
    try {
      var response = PP_Inspection_restlet_({ action: 'detail', woFolio: folio });
      var diag = response.diagnostico || {};
      var res = diag.resultados || {};
      var estatus = PP_Inspection_text_(PP_Inspection_value_(res, ['estatus', 'status', 'Estado']));
      var trabajo = response.trabajo || response.workOrder || {};
      if (!estatus) {
        estatus = PP_Inspection_text_(PP_Inspection_value_(trabajo, ['estatus', 'status', 'Estado']));
      }
      var encontrado = Boolean(res.workOrderId || trabajo.woFolio || trabajo.wo || trabajo.WOFolio);
      resultados[clave] = {
        ot: folio,
        found: encontrado,
        status: estatus,
        closed: encontrado && PP_confirmedClosedStatus_(estatus)
      };
    } catch (error) {
      // Un fallo aqui NUNCA puede cerrar una OT. Se registra como desconocido.
      resultados[clave] = { ot: folio, found: false, status: '', closed: false, error: String(error && error.message || error).slice(0, 160) };
    }
  });

  return {
    asked: consultadas.length,
    omitted: recortada ? lista.length - TOPE : 0,
    truncated: recortada,
    results: resultados
  };
}

var PP_CONFIRMED_CLOSED_WORDS_ = ['CERRAD', 'CLOSED', 'COMPLET', 'CANCELAD', 'CANCELED', 'CANCELLED'];

function PP_confirmedClosedStatus_(status) {
  var normalizado = String(status || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!normalizado) return false;
  return PP_CONFIRMED_CLOSED_WORDS_.some(function(palabra) { return normalizado.indexOf(palabra) >= 0; });
}

function getInspectionWorkOrder(wo) {
  return PP_Inspection_result_(function() {
    const folio = PP_Inspection_text_(wo, 80);
    if (!folio) throw new Error('OT requerida');
    const response = PP_Inspection_restlet_({ action: 'detail', woFolio: folio });
    const workOrder = response.trabajo || response.workOrder;
    if (!workOrder) throw new Error('OT no encontrada en NetSuite');
    const article = PP_Inspection_text_(PP_Inspection_value_(workOrder, ['Articulo', 'item_name', 'item', 'Ensamble']));
    const routes = PP_Inspection_routeIndex_();
    const articleRoute = routes[PP_normalizeKey_(article) + '|'] || {};
    let drawingFallback = PP_Inspection_text_(articleRoute.DIBUJO);
    const materials = (response.materiales || response.materials || []).map(function(row) {
      const material = PP_Inspection_text_(PP_Inspection_value_(row, ['componente', 'component_name', 'component', 'Material']));
      const route = routes[PP_normalizeKey_(article) + '|' + PP_normalizeKey_(material)] || {};
      if (!drawingFallback && route.DIBUJO) drawingFallback = PP_Inspection_text_(route.DIBUJO);
      const requiredOriginal = PP_Inspection_number_(PP_Inspection_value_(row, ['requerido', 'Requerido', 'required', 'quantity', 'Cantidad requerida', 'requeridoOriginal', 'requiredOriginal']));
      const pendingRaw = PP_Inspection_value_(row, ['pendiente', 'Pendiente', 'pending', 'Cantidad pendiente']);
      const issued = PP_Inspection_number_(PP_Inspection_value_(row, ['emitido', 'Emitido', 'usadoEnsamblaje', 'Usado en ensamblaje', 'quantityshiprecv']));
      return {
        material: material,
        description: PP_Inspection_text_(PP_Inspection_value_(row, ['Descripcion', 'description'])),
        required: pendingRaw === '' ? requiredOriginal : Math.max(0, PP_Inspection_number_(pendingRaw)),
        requiredOriginal: requiredOriginal,
        issued: issued,
        available: Number(PP_Inspection_value_(row, ['disponible', 'quantityavailable']) || 0),
        deficit: Number(PP_Inspection_value_(row, ['deficit', 'shortage']) || 0),
        deficitNeto: Number(PP_Inspection_value_(row, ['deficitNeto', 'netDeficit']) || 0),
        route: PP_Inspection_text_(route.TRAMO), drawing: PP_Inspection_text_(route.DIBUJO)
      };
    });
    const operations = (response.operaciones || response.operations || []).map(function(row, index) {
      const operation = PP_Inspection_text_(PP_Inspection_value_(row, ['Operacion', 'operation']));
      const sequence = Number(PP_Inspection_value_(row, ['secuencia', 'sequence']) || index + 1);
      return { id: folio + '-' + sequence + '-' + index, code: operation.split(':')[0].trim() || operation, operation: operation, sequence: sequence, workCenter: '' };
    }).filter(function(item) { return item.operation; }).sort(function(a, b) { return a.sequence - b.sequence; });
    const quantityTotal = Number(PP_Inspection_value_(workOrder, ['cantidad', 'quantity', 'qty']) || 0);
    const builtRaw = PP_Inspection_value_(workOrder, ['cantidadEnsamblada', 'Cantidad ensamblada', 'builtQuantity', 'built']);
    const pendingRaw = PP_Inspection_value_(workOrder, ['cantidadPendiente', 'Cantidad pendiente', 'pendingQuantity']);
    const builtQuantity = builtRaw === '' ? 0 : Math.max(0, PP_Inspection_number_(builtRaw));
    const pendingQuantity = pendingRaw === '' ? Math.max(0, quantityTotal - builtQuantity) : Math.max(0, PP_Inspection_number_(pendingRaw));
    return {
      workOrder: { wo: folio, article: article,
        description: PP_Inspection_text_(PP_Inspection_value_(workOrder, ['Descripcion', 'description'])),
        quantity: quantityTotal,
        builtQuantity: builtQuantity,
        pendingQuantity: pendingQuantity,
        dueDate: PP_Inspection_longDate_(PP_Inspection_value_(workOrder, ['fechaEntrega', 'duedate', 'enddate'])),
        status: PP_Inspection_text_(PP_Inspection_value_(workOrder, ['estatus', 'status', 'Estado'])),
        revision: PP_Inspection_text_(PP_Inspection_value_(workOrder, ['Revision', 'revision', 'bomRevision'])) || 'A',
        drawing: drawingFallback },
      materials: materials, operations: operations
    };
  });
}

/**
 * ESTA FUNCION YA NO GUARDA NADA. Se conserva por el nombre, no por el cuerpo.
 *
 * QUE CAMBIO. Guardaba el tramo en la hoja `Tramos`. El catalogo de tramos se
 * migro a la tabla `inspection_routes` (docs/schema-inspection-routes.sql) y el
 * UNICO escritor es la pagina: PPSupabaseWriter.guardarInspectionRoute, con el
 * JWT de la sesion. Esta funcion ya no escribe.
 *
 * POR QUE SE NIEGA EN VEZ DE SEGUIR ESCRIBIENDO EN LA HOJA. Si escribiera aqui y
 * escribiera la pagina, habria DOS escritores sobre el mismo dato. No es un
 * problema de "se sincronizan": no hay sincronizacion. El ultimo en escribir le
 * pisaria el tramo al otro y el que perdio se enteraria al imprimir, no al
 * guardar. Con una sola puerta el error se ve donde ocurre (RULE-SUP-015).
 *
 * POR QUE NO SE BORRA DE BRIDGE.HTML. Porque el que llegue por el puente (la
 * pagina vieja de /exec, un script de pruebas, un enlace guardado) tiene que leer
 * un error que diga QUE PASO Y DONDE ESTA AHORA. Si la funcion no existiera,
 * Apps Script responderia "function not found" y eso no dice nada. Un mensaje de
 * error que dice a donde migrated vale mas que una ausencia.
 *
 * LO QUE SE TIENE QUE USAR. Desde el navegador:
 *   await PPSupabaseBridgeReplacement.saveInspectionLink({ article, material, route })
 * que escribe la tabla con la sesion abierta.
 */
function saveInspectionLink(payload) {
  return PP_Inspection_result_(function() {
    throw new Error(
      'saveInspectionLink ya no guarda el tramo: el catálogo de tramos de inspección se migró de la hoja '
      + '"Tramos" a la tabla inspection_routes de Supabase y el único escritor es la página '
      + '(PPSupabaseWriter.guardarInspectionRoute). Si estás en el navegador usa '
      + 'PPSupabaseBridgeReplacement.saveInspectionLink({ article, material, route }).'
    );
  });
}

function getInspectionDrawingRoutes(article) {
  return PP_Inspection_result_(function() {
    const key = PP_normalizeKey_(article);
    const routes = PP_Inspection_routeIndex_();
    return Object.keys(routes).map(function(indexKey) { return routes[indexKey]; })
      .filter(function(row) { return !key || PP_normalizeKey_(row.ARTICULO) === key; });
  });
}

function PP_Inspection_historySheet_() {
  return PP_Inspection_sheet_(PP_INSPECTION_HISTORY_SHEET,
    ['FECHA_HORA', 'WO', 'ARTICULO', 'CANTIDAD', 'ESTADO_TRABAJO', 'SEMAFORO', 'ALERTAS',
      'MATERIALES_PENDIENTES', 'MATERIALES_DEFICIT', 'SIN_DIBUJO', 'FALTA_TRAMO', 'DETALLE_JSON']);
}

function getInspectionHistory(wo) {
  return PP_Inspection_result_(function() {
    const key = PP_normalizeKey_(wo);
    const rows = PP_readRows_(PP_Inspection_historySheet_()).filter(function(row) {
      return PP_normalizeKey_(PP_Inspection_value_(row, ['WO', 'OT'])) === key;
    });
    const history = rows.slice(-5).reverse().map(function(row, index) {
        return { number: rows.length - index,
          printedAt: PP_Inspection_text_(PP_Inspection_value_(row, ['FECHA_HORA'])),
          semaphore: PP_Inspection_text_(PP_Inspection_value_(row, ['SEMAFORO'])),
          folio: PP_Inspection_text_(PP_Inspection_value_(row, ['WO', 'OT'])) };
      });
    return { count: rows.length, history: history, conteo: rows.length,
      historial: history.map(function(item) { return { numero: item.number, fechaHora: item.printedAt, semaforo: item.semaphore, folio: item.folio }; }) };
  });
}

function recordInspectionPrint(payload) {
  return PP_Inspection_result_(function() {
    payload = payload || {};
    const wo = PP_Inspection_text_(payload.wo, 80);
    if (!wo) throw new Error('OT requerida');
    const operations = (payload.operations || []).map(function(value) { return PP_Inspection_text_(value, 80); }).filter(Boolean);
    const detail = Object.assign({}, payload.detail || {}, { operations: operations });
    const alerts = payload.alerts || detail.alerts || [];
    const pendingMaterials = payload.pendingMaterials || payload.materialesPendientes || [];
    const deficitMaterials = payload.deficitMaterials || payload.materialesDeficit || [];
    const withoutDrawing = payload.withoutDrawing !== undefined ? payload.withoutDrawing : payload.sinDibujo;
    const missingRoutes = payload.missingRoutes !== undefined ? payload.missingRoutes : payload.faltaTramo;
    const printedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Mexico_City', 'dd/MM/yyyy HH:mm:ss');
    PP_Inspection_historySheet_().appendRow([printedAt, wo, PP_Inspection_text_(payload.article, 200),
      Number(payload.quantity || payload.cantidad || 0), PP_Inspection_text_(payload.status || payload.estadoTrabajo, 80), PP_Inspection_text_(payload.semaphore || payload.semaforo, 40),
      alerts.join(' | '), pendingMaterials.map(function(item) { return PP_Inspection_text_(item.material || item.componente) + ':' + PP_Inspection_text_(item.quantity !== undefined ? item.quantity : item.cantidad); }).join(' | '),
      deficitMaterials.map(function(item) { return PP_Inspection_text_(item.material || item.componente) + ':' + PP_Inspection_text_(item.deficit); }).join(' | '),
      withoutDrawing ? 'SI' : 'NO', missingRoutes ? 'SI' : 'NO', JSON.stringify(detail)]);
    return { wo: wo, operations: operations, recordedAt: printedAt };
  });
}
