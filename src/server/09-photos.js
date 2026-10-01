const PP_DEFAULT_PHOTO_FOLDER_ID = ''; // Configure PHOTO_FOLDER_ID in Script Properties.
const PP_PHOTO_CACHE_SECONDS = 600;

function PP_photoFolderId_() {
  return String(PropertiesService.getScriptProperties().getProperty('PHOTO_FOLDER_ID') || PP_DEFAULT_PHOTO_FOLDER_ID).trim();
}

function PP_enrichWorkOrderPhotos_(workOrders) {
  const catalog = PP_loadPhotoCatalog_();
  return (workOrders || []).map(function(workOrder) {
    if (workOrder.photoUrl) return workOrder;
    const keys = PP_photoLookupKeys_(workOrder.item);
    let photoUrl = '';
    for (let index = 0; index < keys.length && !photoUrl; index++) photoUrl = catalog[keys[index]] || '';
    return Object.assign({}, workOrder, { photoUrl: photoUrl });
  });
}

function PP_loadPhotoCatalog_() {
  const folderId = PP_photoFolderId_();
  if (!folderId) return {};
  const cache = CacheService.getScriptCache();
  const cacheKey = 'pp:photo-catalog:' + folderId;
  try {
    const cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (error) {}

  const catalog = {};
  try {
    const files = DriveApp.getFolderById(folderId).getFiles();
    while (files.hasNext()) {
      const file = files.next();
      const baseName = String(file.getName() || '').replace(/\.(jpg|jpeg|png|gif|webp)$/i, '');
      const url = 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(file.getId()) + '&sz=w400';
      PP_photoLookupKeys_(baseName).forEach(function(key) { catalog[key] = url; });
    }
    try { cache.put(cacheKey, JSON.stringify(catalog), PP_PHOTO_CACHE_SECONDS); } catch (error) {}
  } catch (error) {
    Logger.log('No se pudo leer la carpeta de fotos: ' + error.message);
  }
  return catalog;
}

function PP_photoLookupKeys_(value) {
  const exact = String(value || '').toUpperCase().trim().replace(/\s+/g, ' ');
  const clean = exact.replace(/[^A-Z0-9\s\-_]/g, '').trim();
  return [exact, clean].filter(function(key, index, values) { return key && values.indexOf(key) === index; });
}

// ADAPTADOR PARA LAS FILAS DEL RESTLET, Y POR QUE EXISTE.
//
// MEDIDO 2026-10-01: PP_enrichWorkOrderPhotos_ (arriba) es lo UNICO en todo el proyecto que pone
// una URL de Google Drive en photoUrl, y tenia exactamente dos llamadores, los dos en
// 08-netsuite.js:64 y :98 (PP_fetchNetSuitePlantData_ y PP_fetchNetSuiteWorkOrdersData_), que son
// el camino del PUENTE de Apps Script. La pagina ya no lee de ahi: lee de Supabase.
//
// El camino vivo es 19-appscript-ingesta-supabase.js (PP_restletUnificado_ -> PP_supabaseMirror_)
// y MEDIDO: no mencionaba ni esta funcion ni DriveApp en ninguna linea, o sea que escribia en
// work_orders lo que devolvia el RESTlet tal cual. De ahi que la foto de Drive, que se construia
// y se guardaba bien, no llegara nunca a la columna foto_url que es la que lee la pagina. Es la
// misma clase de fallo que sessionRequired() y que el trigger de updated_at: la pieza existe,
// funciona y esta probada por dentro, y nadie la conecta al camino que escribe.
//
// ESTE ADAPTADOR NO ADIVINA NINGUN NOMBRE. El shape de la fila del RESTlet sale de lo que el
// LECTOR ya mapea de esa misma tabla (supabase-reader.js, mapWorkOrders): ot, articulo,
// descripcion, cantidad, estatus, cliente, foto_url. Y el destino de la foto sale textual de la
// linea 35 de este archivo. No hay ninguna regla de negocio nueva aqui.
//
// Acepta las dos escrituras (articulo/item, foto_url/photoUrl) porque las dos existen de verdad en
// el codigo: la del RESTlet y la del shape del puente. No es tolerancia inventada para adivinar.
function PP_enrichPhotoRows_(rows) {
  const catalogo = PP_loadPhotoCatalog_();
  let conFoto = 0;
  let sinFoto = 0;
  let yaTraia = 0;
  const salida = (rows || []).map(function (row) {
    if (!row || typeof row !== 'object') return row;
    const antes = row.foto_url != null ? row.foto_url : (row.photoUrl != null ? row.photoUrl : '');
    if (String(antes || '').trim()) {
      // NetSuite ya trajo su foto: Drive es el respaldo, no el que manda.
      yaTraia += 1;
      conFoto += 1;
      return row;
    }
    const articulo = row.articulo != null ? row.articulo : (row.item != null ? row.item : '');
    const claves = PP_photoLookupKeys_(articulo);
    let url = '';
    for (let i = 0; i < claves.length && !url; i++) url = catalogo[claves[i]] || '';
    if (!url) {
      sinFoto += 1;
      return row;
    }
    conFoto += 1;
    return Object.assign({}, row, { foto_url: url });
  });
  // El conteo se DEVUELVE y no se loguea aqui: quien decide si esto es un aviso o un dato es la
  // ingesta, que ya tiene su propio `log`. Un Logger.log() en un archivo compartido por dos
  // caminos se pierde en uno de los dos.
  return {
    filas: salida,
    conFoto: conFoto,
    sinFoto: sinFoto,
    yaTraia: yaTraia,
    carpeta: PP_photoFolderId_()
  };
}

function getPhotoSourceStatus() {
  const catalog = PP_loadPhotoCatalog_();
  return { ok: true, folderId: PP_photoFolderId_(), photos: Object.keys(catalog).length };
}
