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

function getPhotoSourceStatus() {
  const catalog = PP_loadPhotoCatalog_();
  return { ok: true, folderId: PP_photoFolderId_(), photos: Object.keys(catalog).length };
}
