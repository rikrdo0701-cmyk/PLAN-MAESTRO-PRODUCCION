const PP_DEFAULT_PHOTO_FOLDER_ID = '1J529pwn9DMoldXdO2bdR2LAhtIysAyvY'; // MEDIDO 2026-10-01: carpeta real de fotos; el usuario confirma que los archivos llevan el nombre del articulo.
const PP_PHOTO_CACHE_SECONDS = 600;

// MEDIDO 2026-10-01, con la carpeta real de fotos (1J529pwn9DMoldXdO2bdR2LAhtIysAyvY) y el
// sintoma "el articulo es el nombre de la foto pero no se ve": la foto SI esta y el nombre SI
// coincide, y hay DOS formas en que el catalogo se podia leer VACIO sin que nada lo dijera.
//
//   1. getFiles() NO BAJA A SUBCARPETAS. El codigo hacia DriveApp.getFolderById(id).getFiles(), y
//      eso solo devuelve los archivos que estan DIRECTO en la carpeta. Si la biblioteca de fotos
//      esta organizada en subcarpetas, el catalogo sale con CERO claves y no hay ningun aviso:
//      la lista de archivos esta vacia y eso es un resultado valido para Drive. Ahora baja, con
//      tope de PROFUNDIDAD y de ARCHIVOS para no pasarse del limite de 6 min de Apps Script.
//   2. LA LISTA DE EXTENSIONES ERA CORTA. Solo quitaba jpg|jpeg|png|gif|webp. Un .heic, un .bmp,
//      un .tiff o un archivo SIN extension dejaban la extension pegada a la clave, y entonces la
//      clave era "20241152.HEIC" y el articulo "20241152" nunca la alcanzaba. Ahora se quita
//      cualquier extension de imagen conocida, y ADEMAS se indexa tambien el nombre COMPLETO:
//      con las dos claves no se pierde ningun caso, y lo que ya funcionaba sigue funcionando.
const PP_PHOTO_PROFUNDIDAD_MAXIMA = 3;
const PP_PHOTO_ARCHIVOS_MAXIMOS = 4000;
const PP_PHOTO_EXTENSION = /\.(jpe?g|png|gif|webp|bmp|tiff?|heic|heif|avif)$/i;

// Lo que se leyo en la ULTIMA carga, para que quien lo llama pueda decir POR QUE salio cero en vez
// de dejar que un 0 se vea solo. No se loguea aqui: un archivo compartido por dos caminos pierde
// el log en uno de los dos.
const PP_photoStats_ = { archivos: 0, claves: 0, carpetas: 0, ejemplos: [] };

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
  // El v2 del sobre (la version va en la clave) guarda el catalogo Y los conteos. Antes se
  // cacheaba solo el catalogo, y al salir de la cache no habia forma de decir si "0 con foto"
  // era porque la carpeta venia vacia o porque el articulo no cuadraba: el dato que hace falta
  // para diagnosticar no sobrevivia a los 10 minutos de cache.
  const cacheKey = 'pp:photo-catalog:v2:' + folderId;
  try {
    const cached = cache.get(cacheKey);
    if (cached) {
      const sobre = JSON.parse(cached);
      if (sobre && sobre.c && sobre.s) {
        PP_photoStats_.archivos = sobre.s.archivos || 0;
        PP_photoStats_.claves = sobre.s.claves || 0;
        PP_photoStats_.carpetas = sobre.s.carpetas || 0;
        PP_photoStats_.ejemplos = Array.isArray(sobre.s.ejemplos) ? sobre.s.ejemplos : [];
        return sobre.c;
      }
    }
  } catch (error) {}

  const catalog = {};
  PP_photoStats_.archivos = 0;
  PP_photoStats_.claves = 0;
  PP_photoStats_.carpetas = 0;
  PP_photoStats_.ejemplos = [];

  // Bajar por subcarpetas, con topes. Antes era un while plano sobre getFiles() de la carpeta
  // raiz, que es exactamente el caso en el que la biblioteca de fotos "no aparece".
  const visitar = function (carpeta, profundidad) {
    if (profundidad > PP_PHOTO_PROFUNDIDAD_MAXIMA) return;
    PP_photoStats_.carpetas += 1;
    const files = carpeta.getFiles();
    while (files.hasNext() && PP_photoStats_.archivos < PP_PHOTO_ARCHIVOS_MAXIMOS) {
      const file = files.next();
      PP_photoStats_.archivos += 1;
      const nombre = String(file.getName() || '');
      const url = 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(file.getId()) + '&sz=w400';
      // Las DOS claves: la del nombre sin extension (que es como llega el articulo) y la del
      // nombre completo. Con las dos no se pierde ningun caso y lo que ya cuadraba sigue
      // cuadrando, porque la clave sin extension se sigue escribiendo igual que antes.
      PP_photoLookupKeys_(nombre.replace(PP_PHOTO_EXTENSION, '')).forEach(function (key) { catalog[key] = url; });
      PP_photoLookupKeys_(nombre).forEach(function (key) { catalog[key] = url; });
      if (PP_photoStats_.ejemplos.length < 3) PP_photoStats_.ejemplos.push(nombre);
    }
    const subcarpetas = carpeta.getFolders();
    while (subcarpetas.hasNext() && PP_photoStats_.archivos < PP_PHOTO_ARCHIVOS_MAXIMOS) {
      visitar(subcarpetas.next(), profundidad + 1);
    }
  };

  try {
    visitar(DriveApp.getFolderById(folderId), 0);
    PP_photoStats_.claves = Object.keys(catalog).length;
    try {
      cache.put(cacheKey, JSON.stringify({
        c: catalog,
        s: {
          archivos: PP_photoStats_.archivos,
          claves: PP_photoStats_.claves,
          carpetas: PP_photoStats_.carpetas,
          ejemplos: PP_photoStats_.ejemplos
        }
      }), PP_PHOTO_CACHE_SECONDS);
    } catch (error) {}
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
// EL POR QUE DE UN CERO, EN UNA FRASE, Y SOLO SI HAY CERO.
// MEDIDO 2026-10-01: "0 de 199 con foto" es el mismo numero para tres fallas que no se arreglan
// igual: que falte la Script Property, que la carpeta este vacia, o que el archivo no se llame
// como el articulo. Un 0 sin motivo es un 0 que hay que adivinar, asi que el motivo se arma con
// los conteos del catalogo, que son justamente lo que separa las tres.
function PP_photoMotivoCero_(fotos) {
  if (!fotos || fotos.conFoto) return '';
  if (!fotos.carpeta) return ' -- PHOTO_FOLDER_ID NO esta configurado en las Script Properties';
  if (!fotos.claves) {
    return ' -- la carpeta dio 0 archivos en ' + (fotos.carpetas || 1) + ' carpeta(s): revisa el id y los permisos';
  }
  return ' -- el catalogo tiene ' + fotos.claves + ' claves y ninguna es el articulo; archivos: '
    + (fotos.ejemplos || []).join(' | ');
}

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
    carpeta: PP_photoFolderId_(),
    // Los conteos del catalogo. MEDIDO 2026-10-01: sin estos, un "0 de 199 con foto" no
    // distinguia entre las tres causas reales, y las tres necesitan una accion distinta:
    //   - sin `carpeta`: falta la Script Property PHOTO_FOLDER_ID.
    //   - con `claves` > 0 y conFoto == 0: el nombre del archivo NO es el del articulo.
    //   - con `claves` == 0: la carpeta no devolvio archivos (carpeta equivocada o vacia).
    claves: PP_photoStats_.claves,
    archivos: PP_photoStats_.archivos,
    carpetas: PP_photoStats_.carpetas,
    ejemplos: PP_photoStats_.ejemplos
  };
}

function getPhotoSourceStatus() {
  const catalog = PP_loadPhotoCatalog_();
  return {
    ok: true,
    folderId: PP_photoFolderId_(),
    photos: Object.keys(catalog).length,
    // MEDIDO 2026-10-01: se agregan para que se pueda abrir UNA SOLA PREGUNTA desde la consola y
    // saber si el problema es la carpeta o el nombre del archivo, sin esperar a la ingesta.
    archivos: PP_photoStats_.archivos,
    carpetas: PP_photoStats_.carpetas,
    ejemplos: PP_photoStats_.ejemplos
  };
}
