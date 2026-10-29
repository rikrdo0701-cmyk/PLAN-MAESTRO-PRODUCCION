// LO QUE FALLA Y QUE ESTAS PRUEBAS VIGILAN. MEDIDO 2026-10-01 en la pagina real de produccion,
// con sesion: las 175 OT del Backlog mostraban "Sin foto" en su mayoria, y el detalle de la OT no
// tenia foto en ningun lado. El dato SI existe y SI se guarda bien; lo que faltaba era el ultimo
// tramo.
//
// LA CADENA DE LA FOTO, Y DONDE SE ROMPIA. MEDIDO con grep sobre el repo:
//
//   1. ORIGEN: la foto sale de GOOGLE DRIVE. src/server/09-photos.js:35 arma la URL como
//      'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w400', y la busca por el
//      nombre del ARTICULO (PP_photoLookupKeys_) dentro de la carpeta PHOTO_FOLDER_ID.
//   2. QUIEN LA PEGABA A LAS FILAS: PP_enrichWorkOrderPhotos_ (09-photos.js:8). MEDIDO: tiene
//      EXACTAMENTE DOS llamadores en todo src/server/, y los dos estan en 08-netsuite.js:64 y
//      08-netsuite.js:98, dentro de PP_fetchNetSuitePlantData_ y PP_fetchNetSuiteWorkOrdersData_.
//   3. ESOS DOS SON EL CAMINO MUERTO. La pagina ya no lee del puente de Apps Script; lee de
//      Supabase. El camino vivo es 19-appscript-ingesta-supabase.js:271 -> PP_restletUnificado_
//      -> PP_supabaseMirror_, y MEDIDO: ese archivo NO menciona ni PP_enrichWorkOrderPhotos_ ni
//      DriveApp en ninguna linea. Escribe `accion.rows` tal cual.
//   4. O sea que `work_orders.foto_url` en Supabase traia UNICAMENTE el campo 'Foto URL' de
//      NetSuite (08-netsuite.js:989) y nunca la foto de Drive. La pieza existia, funcionaba y
//      estaba probada por dentro; nadie la conecto al camino que de verdad escribe la tabla que
//      lee la pagina. Es la MISMA clase que sessionRequired() y que el disparador de updated_at:
//      el disparador bien puesto y probado que nadie lee.
//
// QUE HACE ESTE ARCHIVO. Convierte las filas del RESTlet (snake_case) al shape que
// PP_enrichWorkOrderPhotos_ ya sabe Enrichcer (item/photoUrl), lo llama, y devuelve las filas de
// vuelta en snake_case. Asi el enriquecimiento de Drive ocurre ANTES del mirror, que es el unico
// punto donde work_orders llega a la base.
//
// Y EL PORQUE DE QUE NO SE INVENTE NADA. El shape de la fila del RESTlet no se adivina: sale de lo
// que el LECTOR ya mapea de esa misma tabla (supabase-reader.js mapWorkOrders: ot, articulo,
// descripcion, cantidad, estatus, cliente, foto_url). El nombre de la columna de Drive tampoco:
// sale textual de 09-photos.js:35. No hay ninguna regla de negocio nueva en este archivo.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";

const server = await readFile(new URL("../src/server/19-appscript-ingesta-supabase.js", import.meta.url), "utf8");
const fotos = await readFile(new URL("../src/server/09-photos.js", import.meta.url), "utf8");
const reader = await readFile(new URL("../src/web/shared/supabase-reader.js", import.meta.url), "utf8");

/**
 * Levanta las DOS funciones de 09-photos.js con DriveApp, CacheService y PropertiesService de
 * mentira, y devuelve { enrich, status, motivo, ctx, catalogo }.
 */
function fotosConDrive(catalogo, folderId, arbol, opciones) {
  const leidas = { folder: 0, puts: 0 };
  // MEDIDO 2026-10-01, al tratar de hacer que esta prueba MUERDA: con el reloj real y las dos
  // llamadas en el MISMO contexto, quitar la restauracion de los conteos no se nota, porque las
  // variables del modulo siguen con el valor de la primera lectura. En Apps Script no es asi: cada
  // corrida es una ejecucion NUEVA y el modulo arranca en frio. Por eso `opciones.cache` acepta un
  // reloj COMPARTIDO entre dos contexto, que es como se reproducen dos ejecuciones separadas, y
  // `opciones.sinDrive` prohibe tocar Drive para que un acierto de cache no pueda disfrazarse de
  // una lectura.
  const reloj = opciones && opciones.cache;
  const portador = reloj === true || !reloj ? { sobre: null } : reloj;
  const sinDrive = Boolean(opciones && opciones.sinDrive);
  // MEDIDO 2026-10-01: el codigo tambien BAJA A SUBCARPETAS, asi que el reloj de Drive tiene que
  // contestar las dos preguntas (getFiles y getFolders) o el recorrido revienta. La carpeta que se
  // devuelve es `arbol` si se pasa, y si no es una plana con los nombres de `catalogo`.
  //
  // `opciones.cache` enciende un reloj DE VERDAD. Antes era siempre `get: () => null`, o sea que el
  // camino del ACIERTO de cache no se ejecutaba nunca: se podia cambiar el sobre del cache todo lo
  // que se quisiera y las pruebas seguian verdes. Ese camino importa, porque al segundo uso (a los
  // 10 minutos, la segunda corrida de la ingesta) es donde los conteos se perdian y el cero
  // volvia a ser mudo.
  const carpetaDe = (nodo) => {
    const archivos = (nodo.archivos || Object.keys(catalogo).map((nombre) => ({ nombre, id: catalogo[nombre] })))
      .map((a) => ({ getName: () => a.nombre, getId: () => a.id }));
    const subs = (nodo.subcarpetas || []).map(carpetaDe);
    let i = 0;
    let j = 0;
    return {
      getFiles: () => ({ hasNext: () => i < archivos.length, next: () => archivos[i++] }),
      getFolders: () => ({ hasNext: () => j < subs.length, next: () => subs[j++] }),
    };
  };
  const contexto = {
    console,
    JSON,
    Object,
    Array,
    Promise,
    Date,
    String,
    Number,
    Boolean,
    Error,
    RegExp,
    encodeURIComponent,
    decodeURIComponent,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (name) => (name === "PHOTO_FOLDER_ID" ? folderId : ""),
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        // El reloj devuelve EXACTAMENTE lo que se le guardo: el codigo le hace JSON.parse al valor.
        // Un mock que antepone la clave rompe el parseo y hace creer que el cache no funciona.
        get: () => portador.sobre,
        put: (clave, valor) => { leidas.puts += 1; portador.sobre = String(valor); },
      }),
    },
    DriveApp: {
      getFolderById: () => {
        leidas.folder += 1;
        if (sinDrive) throw new Error("Drive no se debe tocar en la segunda corrida: el catalogo estaba en cache");
        return carpetaDe(arbol || {});
      },
    },
    Logger: { log: (msg) => { leidas.logs = (leidas.logs || []).concat([msg]); } },
  };
  // MEDIDO 2026-10-02: PP_DEFAULT_PHOTO_FOLDER_ID ya NO esta vacio (el usuario paso el id real de
  // la carpeta de Drive), o sea que "sin carpeta configurada" ya no se consigue con un folderId ""
  // en el reloj de mentira: la propiedad vacia cae al default y el catalogo se llena igual. Para que
  // estas pruebas sigan midiendo LO QUE MEDIAN — que sin carpeta NO se inventa una foto y que el
  // cero diga que falta la configuracion — el default se borra del fuente antes de correr el
  // modulo, que es exactamente el estado de un despliegue sin la constante. Sin esta bandera, las
  // dos pruebas mas importantes de la cadena de la foto se quedarian en verde sin probar nada.
  const fuente = (opciones && opciones.sinDefault)
    ? fotos.replace(/const\s+PP_DEFAULT_PHOTO_FOLDER_ID\s*=\s*[^;]+;/, "const PP_DEFAULT_PHOTO_FOLDER_ID = '';")
    : fotos;
  // `usarDefaultReal` deja el default como esta en el repo (la carpeta 1J529...). Se usa para
  // comprobar que la foto se encuentra SIN Script Property, que es como va a funcionar el
  // despliegue real ahora que el id del usuario quedo como default.
  contexto.globalThis = contexto;
  createContext(contexto);
  runInContext(fuente, contexto, { filename: "09-photos.js" });
  // Se sube el ADAPTADOR, no PP_enrichWorkOrderPhotos_: este ultimo solo entiende el shape del
  // puente ({ item, photoUrl }) y por eso no le sirve a la ingesta, que recibe { articulo, foto_url }).
  return { enrich: contexto.PP_enrichPhotoRows_, status: contexto.getPhotoSourceStatus, motivo: contexto.PP_photoMotivoCero_, ctx: contexto, catalogo: leidas };
}

// El catalogo de Drive con una foto, indexado por el nombre del archivo SIN extension. Asi se
// arma en 09-photos.js:36 (PP_photoLookupKeys_ sobre el baseName).
const CARPETA = { "20241152": "FILEID-20241152", "CCA 519 C": "FILEID-CCA519" };

test("el adaptador convierte la fila del RESTlet y devuelve la foto de Drive", () => {
  const { enrich } = fotosConDrive(CARPETA, "FOLDER-1");
  assert.equal(typeof enrich, "function", "el adaptador PP_enrichPhotoRows_ tiene que existir en 09-photos.js");
  // Esta es la forma EXACTA que devuelve el RESTlet 2246 para work_orders: los mismos nombres de
  // columna que mapWorkOrders lee de la tabla (supabase-reader.js).
  const entra = [{ ot: "2121", articulo: "20241152", descripcion: "TUBO SALIDA TURBO CONJ", cantidad: 500, foto_url: "" }];
  const r = enrich(entra);
  assert.equal(r.filas.length, 1);
  assert.match(r.filas[0].foto_url, /^https:\/\/drive\.google\.com\/thumbnail\?id=FILEID-20241152&sz=w400$/,
    "la foto de Drive tiene que quedar pegada en la columna foto_url de la fila del RESTLET");
  assert.equal(r.filas[0].ot, "2121", "y el resto de la fila no se tocan: esto pega una foto, no rehace la OT");
  assert.equal(r.filas[0].cantidad, 500);
  assert.equal(r.conFoto, 1, "y el conteo vuelve para que la ingesta lo diga, no para que quede en silencio");
});

test("el adaptador NO pisa una foto que ya viene de NetSuite", () => {
  const { enrich } = fotosConDrive(CARPETA, "FOLDER-1");
  const entra = [{ ot: "2121", articulo: "20241152", foto_url: "https://ejemplo.supabase.co/netsuite.jpg" }];
  const r = enrich(entra);
  assert.equal(r.filas[0].foto_url, "https://ejemplo.supabase.co/netsuite.jpg",
    "NetSuite ya trae su foto y Drive es el respaldo, no el que manda");
  assert.equal(r.yaTraia, 1);
});

test("sin PHOTO_FOLDER_ID la foto se queda vacia y NO se inventa", () => {
  // `sinDefault` es obligatorio aca: con el default real puesto (carpeta 1J529...), una propiedad
  // vacia NO es "sin carpeta", es "usa el default". Ver la nota de fotosConDrive.
  const { enrich } = fotosConDrive(CARPETA, "", null, { sinDefault: true });
  const r = enrich([{ ot: "2121", articulo: "20241152", foto_url: "" }]);
  assert.equal(r.filas[0].foto_url, "",
    "sin carpeta configurada el resultado es la foto vacia, no una URL inventada");
  assert.equal(r.sinFoto, 1);
  assert.equal(r.carpeta, "", "y el adaptador avisa que no hay carpeta, para que el 0 tenga un porque");
});

// LA CARPETA REAL, COMO DEFAULT. MEDIDO 2026-10-02: el usuario confirmo que la biblioteca de fotos
// esta en Drive y que cada archivo se llama como su articulo. El id de esa carpeta quedo como
// PP_DEFAULT_PHOTO_FOLDER_ID en 09-photos.js, asi que la foto se enlaza sin tocar Script Properties.
// Estas dos pruebas vigilan que el default siga ahi y que NO pise lo que la Script Property dice:
// la propiedad es la fuente de verdad cuando existe, y el default es el respaldo.
test("sin Script Property la carpeta del default se usa: la foto se encuentra sola", () => {
  const { enrich } = fotosConDrive(CARPETA, "", null, { usarDefaultReal: true });
  assert.match(fotos, /const\s+PP_DEFAULT_PHOTO_FOLDER_ID\s*=\s*'1J529pwn9DMoldXdO2bdR2LAhtIysAyvY'/,
    "la carpeta de Drive del usuario es el default, para que la foto funcione sin configuracion");
  assert.match(enrich([{ ot: "2121", articulo: "20241152", foto_url: "" }]).filas[0].foto_url || "",
    /FILEID-20241152/, "y con el default puesto el articulo SI encuentra su foto");
});

test("la Script Property manda sobre el default: si dice otra carpeta, se lee ESA", () => {
  // La propiedad gana, y se nota en QUE CARPETA se leyo. El reloj de Drive de mentira no distingue
  // una carpeta de otra, asi que el arbol que se devuelve es el de la carpeta de la propiedad: si
  // el default ganara, el catalogo seria el de 1J529... y no habria forma de notarlo.
  const { enrich, status } = fotosConDrive({}, "FOLDER-OTRA", {
    archivos: [{ nombre: "OT 2121 TUBO.jpg", id: "ID-OTRA-CARPETA" }],
  });
  assert.equal(status().folderId, "FOLDER-OTRA",
    "la propiedad es la fuente de verdad; el default solo entra cuando no hay propiedad");
  assert.equal(enrich([{ ot: "2121", articulo: "20241152", foto_url: "" }]).filas[0].foto_url, "",
    "y lo que hay en ESA carpeta es lo que se busca: aqui no esta 20241152");
});

test("la ingesta Enriquece work_orders ANTES del mirror, y lo dice", () => {
  // La parte que de verdad rompia la foto no es el adaptador: es que NADIE lo llamaba. Si esto
  // se desconecta, el adaptador sigue perfecto, sus pruebas siguen verdes, y las tarjetas siguen
  // dicen "Sin foto". Por eso el llamador se comprueba aqui.
  const espejo = server.indexOf("PP_supabaseMirror_(def.tabla, filas, config)");
  const llama = server.indexOf("PP_enrichPhotoRows_(");
  assert.ok(llama > 0, "la ingesta tiene que llamar al adaptador de fotos");
  assert.ok(llama < espejo,
    "el enriquecimiento va ANTES del mirror: despues ya se escribieron las filas en la base");
});

test("la ingesta solo lo aplica a work_orders, y solo con filas", () => {
  // Si se aplicara a materials o a operations, se buscaria una foto por el nombre de un
  // componente o de un centro de trabajo, y se pegaria en una columna que no existe.
  const bloque = server.slice(server.indexOf("PP_enrichPhotoRows_(") - 200, server.indexOf("PP_supabaseMirror_(def.tabla, filas, config)"));
  assert.match(bloque, /nombre === ["']workorders["']/,
    "el enriquecimiento se aplica solo a work_orders");
});

test("el lector publica el mapper de machine_planning_overrides", async () => {
  const { PPSupabaseReader } = (() => {
    const contexto = { console, JSON, Object, Array, Promise, Date, String, Number, Boolean, Error, Math, RegExp, encodeURIComponent };
    contexto.globalThis = contexto;
    createContext(contexto);
    runInContext(reader, contexto, { filename: "supabase-reader.js" });
    return contexto;
  })();
  assert.equal(typeof PPSupabaseReader.mapMachinePlanningOverrides, "function",
    "mapMachinePlanningOverrides tiene que estar publicado como los demas mappers");
  const r = PPSupabaseReader.mapMachinePlanningOverrides([
    { machine_nombre: "CORTADOR INICIAL", excluida: true },
    { machine_nombre: "  ", excluida: false },
  ]);
  assert.deepEqual(r.map((x) => [x.machineName, x.excluded]), [["CORTADOR INICIAL", true]],
    "una fila sin nombre de maquina no es una fila");
});

// LA CARPETA REAL. MEDIDO 2026-10-01: el usuario passo el id de la carpeta de Drive
// (1J529pwn9DMoldXdO2bdR2LAhtIysAyvY) y el sintoma textual fue "el articulo es el nombre de la
// foto pero no se ve". Con el dato delante hay DOS formas en que el catalogo salia VACIO sin que
// nada lo dijera, y las dos son cambios de codigo, no de configuracion del usuario.
//
//   1. getFiles() NO baja a subcarpetas. MEDIDO en el codigo: era un while plano sobre
//      DriveApp.getFolderById(id).getFiles(), que devuelve SOLO lo que esta directo en la carpeta.
//      Una biblioteca de fotos organizada por subcarpetas produce un catalogo de CERO claves y
//      Drive no lanza ningun error: la lista vacia es un resultado valido para la API.
test("la foto se encuentra aunque este en una SUBCARPETA de la carpeta de Drive", () => {
  const { enrich } = fotosConDrive({}, "FOLDER-1", {
    archivos: [],
    subcarpetas: [{ archivos: [{ nombre: "20241152.jpg", id: "FILEID-20241152" }] }],
  });
  const r = enrich([{ ot: "2121", articulo: "20241152", foto_url: "" }]);
  assert.match(r.filas[0].foto_url || "", /FILEID-20241152/,
    "una foto en una subcarpeta es una foto de la misma carpeta: el article es el nombre del archivo");
  assert.equal(r.conFoto, 1);
  assert.equal(r.carpetas, 2, "y el conteo de carpetas dice que bajo a buscarla, no que solo miro arriba");
});

// 2. La lista de extensiones era corta: solo quitaba jpg|jpeg|png|gif|webp. Un .heic, un .bmp o
//    un .tiff dejaban la extension pegada a la clave y el articulo NUNCA la alcanzaba.
test("la foto se encuentra con cualquier extension de imagen, no solo jpg y png", () => {
  const { enrich } = fotosConDrive({}, "FOLDER-1", {
    archivos: [
      { nombre: "20241152.HEIC", id: "ID-HEIC" },
      { nombre: "20241153.tiff", id: "ID-TIFF" },
      { nombre: "20241154.bmp", id: "ID-BMP" },
      { nombre: "20241155.avif", id: "ID-AVIF" },
      { nombre: "20241156", id: "ID-SIN-EXT" },
    ],
  });
  const r = enrich([2121, 2122, 2123, 2124, 2125].map((ot, i) => ({
    ot: String(ot), articulo: "2024115" + (2 + i), foto_url: "",
  })));
  const porArticulo = {};
  r.filas.forEach((f) => { porArticulo[f.articulo] = (f.foto_url.match(/ID-[A-Z-]+/) || [""])[0]; });
  assert.equal(porArticulo["20241152"], "ID-HEIC");
  assert.equal(porArticulo["20241153"], "ID-TIFF");
  assert.equal(porArticulo["20241154"], "ID-BMP");
  assert.equal(porArticulo["20241155"], "ID-AVIF");
  assert.equal(porArticulo["20241156"], "ID-SIN-EXT",
    "un archivo sin extension tambien es el nombre del articulo");
  assert.equal(r.conFoto, 5, "y el conteo sale en cinco, no en uno: el fallo era la extension");
});

// EL POR QUE DEL CERO. MEDIDO 2026-10-01: "0 de 199 con foto" era el MISMO texto para tres fallas
// que piden tres acciones distintas, y con ese texto no habia forma de saber cual era. Estas tres
// pruebas son las que hacen que el cero deje de ser un cero mudo.
test("un cero dice SI FALTA LA CARPETA, y no dice que la carpeta se leyo vacia", () => {
  const { enrich, ctx } = fotosConDrive(CARPETA, "", null, { sinDefault: true });
  const r = enrich([{ ot: "2121", articulo: "20241152", foto_url: "" }]);
  const motivo = ctx.PP_photoMotivoCero_(r);
  assert.match(motivo, /PHOTO_FOLDER_ID NO esta configurado/,
    "sin Script Property lo que falta es la configuracion; decir que la carpeta salio vacia manda a revisar Drive");
  assert.doesNotMatch(motivo, /0 archivos/,
    "y no puede decir las dos cosas: sonellinomas contradictorias");
});

test("un cero con la carpeta puesta pero sin claves dice que la carpeta NO DIO ARCHIVOS", () => {
  const { enrich, ctx } = fotosConDrive({}, "FOLDER-1");
  const r = enrich([{ ot: "2121", articulo: "20241152", foto_url: "" }]);
  assert.equal(r.claves, 0, "el catalogo esta vacio de verdad: no hay ningun archivo que indexar");
  assert.match(ctx.PP_photoMotivoCero_(r), /0 archivos/,
    "aqui el problema es el id o los permisos de la carpeta, no el nombre del archivo");
});

test("un cero con claves pero sin coincidir dice CUANTAS CLAVES HAY y COMO SE LLAMAN los archivos", () => {
  // Este es el caso REAL del sintoma: la foto esta, el catalogo se lleno, pero el nombre del
  // archivo no es el del articulo. Sin los ejemplos el que lee el log no puede compararlos sin
  // abrir Drive, y abrir Drive es justo el paso que hay que evitar.
  const { enrich, ctx } = fotosConDrive({}, "FOLDER-1", {
    archivos: [{ nombre: "OT 2121 TUBO.jpg", id: "ID-1" }, { nombre: "OT 2122 TUBO.jpg", id: "ID-2" }],
  });
  const r = enrich([{ ot: "2121", articulo: "20241152", foto_url: "" }]);
  // 6 claves y no 2: por cada archivo se indexan la clave sin extension ("OT 2121 TUBO") y la
  // completa ("OT 2121 TUBO.JPG"), y cada una en sus dos formas (exacta y sin punctuation), que
  // para estos nombres coinciden. Lo que importa es que NO es 0: hay archivos.
  assert.equal(r.claves, 6, "las claves se indexaron bien: hay archivos, solo que con otro nombre");
  assert.equal(r.conFoto, 0);
  const motivo = ctx.PP_photoMotivoCero_(r);
  assert.match(motivo, /6 claves/, "dice cuantas hay, para que se vea que la carpeta si se leyo");
  assert.match(motivo, /OT 2121 TUBO\.jpg/, "y manda los nombres reales de archivo para comparar");
  assert.doesNotMatch(motivo, /PHOTO_FOLDER_ID/, "y no culpa a la configuracion que si esta bien");
});

test("cuando HAY foto no se inventan motivos: el motivo es cadena vacia", () => {
  const { enrich, ctx } = fotosConDrive(CARPETA, "FOLDER-1");
  const r = enrich([{ ot: "2121", articulo: "20241152", foto_url: "" }]);
  assert.equal(ctx.PP_photoMotivoCero_(r), "",
    "un acierto no necesita explicacion, y un texto de problema en un acierto hace dudar del dato");
});

test("getPhotoSourceStatus dice cuantos archivos y carpetas vio, no solo cuantas claves", () => {
  // MEDIDO 2026-10-01: getPhotoSourceStatus era la unica forma de preguntar sin esperar a la ingesta,
  // y devolvia `photos: 0` para "carpeta vacia" y para "199 nombres que no cuadran". Con los
  // conteos del catalogo la pregunta se responde sola desde la consola.
  const { status } = fotosConDrive({}, "FOLDER-1", {
    archivos: [{ nombre: "20241152.jpg", id: "ID-1" }],
    subcarpetas: [{ archivos: [{ nombre: "20241153.jpg", id: "ID-2" }] }],
  });
  const s = status();
  assert.equal(s.folderId, "FOLDER-1");
  assert.equal(s.photos, 6, "3 claves por archivo: el nombre sin extension, el completo y el limpio del completo");
  assert.equal(s.archivos, 2, "los dos archivos, uno en la raiz y otro en la subcarpeta");
  assert.equal(s.carpetas, 2, "la raiz y la subcarpeta");
  assert.match(s.ejemplos[0], /20241152\.jpg/, "y un nombre real para comparar contra el articulo");
});

// LOS TOPES. MEDIDO 2026-10-01: bajar por subcarpetas sin tope se puede pasar del limite de 6
// minutos de Apps Script, y una ingesta que se pasa el limite NO escribe nada: no es una foto
// faltante, es la tabla entera sin actualizar. El tope existe por eso, y se comprueba.
test("el recorrido por subcarpetas tiene TOPE de profundidad, para no pasarse de los 6 minutos", () => {
  // Un arbol de 6 niveles, con un archivo en cada uno, y el tope del codigo es 3.
  const nido = (nivel, archivo) => (nivel >= 6
    ? { archivos: [{ nombre: archivo, id: "ID-N" + nivel }] }
    : { subcarpetas: [nido(nivel + 1, archivo)] });
  const { enrich, motivo } = fotosConDrive({}, "FOLDER-1", nido(0, "20241152.jpg"));
  const r = enrich([{ ot: "2121", articulo: "20241152", foto_url: "" }]);
  assert.equal(r.claves, 0,
    "un archivo escondido a 6 carpetas de profundidad NO se encuentra, y hay que decirlo: el tope corta antes");
  // Y lo que mas importa con un tope: que la fila siga saliendo. Cortar es una decision, romperse
  // seria tumbar la ingesta entera, y aqui la foto es UNA columna de UNA fila.
  assert.equal(r.filas.length, 1, "el tope corta la busqueda, no la entrega de filas");
  assert.equal(r.filas[0].foto_url, "", "y la foto de ese articulo queda vacia, que es la verdad");
  assert.match(motivo(r), /0 archivos/, "y el cero dice que la carpeta no dio archivos, aunque si habia");
});

test("un archivo a 3 niveles SI se encuentra: el tope no debe comerse la foto real", () => {
  const { enrich } = fotosConDrive({}, "FOLDER-1", {
    subcarpetas: [{ subcarpetas: [{ subcarpetas: [{ archivos: [{ nombre: "20241152.jpg", id: "ID-PROFUNDO" }] }] }] }],
  });
  const r = enrich([{ ot: "2121", articulo: "20241152", foto_url: "" }]);
  assert.match(r.filas[0].foto_url || "", /ID-PROFUNDO/,
    "tres niveles es lo que declara el tope, asi que a tres niveles tiene que encontrar la foto");
});

// LA CACHE, Y POR QUE ESTA EN SU PROPIA PRUEBA. MEDIDO 2026-10-01: antes el reloj de mentira
// contestaba siempre `null`, o sea que el camino del acierto de cache no se ejecutaba NUNCA. Con
// el cache al vacio, el "0 de 199 con foto" del primer minuto de la ingesta lo decia bien y el de
// los minutos siguientes salia mudo, porque del catalogo cacheado no habia conteos: el archivo
// guardado era el catalogo pelado.
test("los conteos del catalogo SOBREVIVEN a la cache: el segundo cero tambien dice su porque", () => {
  // Un reloj COMPARTIDO entre dos contextos = dos ejecuciones de Apps Script separadas por 10
  // minutos. La segunda arranca en frio (variables de modulo en 0) y Drive esta cerrado: si el
  // sobre no trae los conteos, el cero vuelve a ser mudo y esta prueba se cae.
  const reloj = { sobre: null };
  const primera = fotosConDrive({}, "FOLDER-1", {
    archivos: [{ nombre: "OT 2121 TUBO.jpg", id: "ID-1" }],
  }, { cache: reloj });
  const uno = primera.enrich([{ ot: "2121", articulo: "20241152", foto_url: "" }]);
  assert.equal(uno.claves, 3, "la primera vez se leyo Drive de verdad");
  assert.equal(primera.catalogo.puts, 1, "y se guardo el sobre");
  assert.ok(reloj.sobre, "el sobre tiene que quedar en el reloj de verdad, no en una copia");

  // Segunda EJECUCION: mismo reloj, modulo en frio, Drive prohibido.
  const segunda = fotosConDrive({}, "FOLDER-1", null, { cache: reloj, sinDrive: true });
  const dos = segunda.enrich([{ ot: "2121", articulo: "20241152", foto_url: "" }]);
  assert.equal(segunda.catalogo.folder, 0, "la segunda vez se lee del cache, sin tocar Drive");
  assert.equal(segunda.catalogo.puts, 0, "y no se reescribe el sobre");
  assert.equal(dos.claves, 3,
    "del catalogo cacheado sale cuantas claves habia: sin esto, el cero del minuto 11 no dice nada");
  assert.equal(dos.archivos, 1);
  assert.equal(dos.ejemplos[0], "OT 2121 TUBO.jpg");
  assert.match(segunda.motivo(dos), /OT 2121 TUBO\.jpg/,
    "y el cero de los minutos 11 sigue diciendo COMO SE LLAMAN los archivos, no solo que hay 0");
  assert.match(segunda.motivo(dos), /3 claves/, "y cuantas claves habia, no un 0 seco");
});
// =============================================================================
// MEDIDO 2026-10-02: EL ESPEJO DE work_orders SE ROMPIA CON 23502 Y LAS 64 FOTOS SE IBAN CON EL.
// =============================================================================
//
// LO QUE PASÓ, CON NUMEROS. La ingesta forzada en produccion devolvio:
//
//   fotos: 64 de 213 con foto de Drive
//   workorders: ERROR Supabase rpc ingesta_mirror work_orders 400: {"code":"23502", ...}
//
// O sea que el emparejamiento con Drive FUNCIONABA (64 de 213) y el espejo entero se revirtio, con
// las 64 fotos dentro. work_orders fue la unica de las 7 tablas que no se escribio, y por eso la
// pagina seguia diciendo "Sin foto" con el dato entero disponible.
//
// LA CAUSA. `foto_url text not null default ''` (docs/schema-supabase.sql:175). Un default NO
// protege aca, y esta es la parte que hay que tener clara: PostgREST arma el INSERT con la UNION de
// las claves que aparecen en el arreglo, y para las filas a las que les falta una clave pone NULL, no
// el default de la columna. Antes de que existiera el adaptador, el payload no traia la clave
// foto_url en NINGUNA fila, entonces no entraba en la union, no se nominaba en el INSERT y el
// default llenaba las 213. En cuanto el adaptador le puso la clave a las 64 filas que SI tienen
// foto, la clave entro en la union y las otras 149 llegaron como NULL contra una NOT NULL.
//
// LAS TRES PRUEBAS SIGUIENTES. La primera dice que TODA fila sale con la clave. La segunda reproduce
// el caso exacto del fallo: un payload donde el RESTlet ni siquiera manda la clave. La tercera dice
// que la funcion hermana, que ya lo hacia bien, no se puede volver a desalinear. Verificadas por
// mutacion: revertir cualquiera de las dos ramas del adaptador las hace fallar.
test("el adaptador le pone la clave foto_url a TODA fila, tambien a la que no tiene foto", () => {
  const { enrich } = fotosConDrive(CARPETA, "FOLDER-1");
  const entra = [
    { ot: "2121", articulo: "20241152" },                 // tiene foto en Drive
    { ot: "2122", articulo: "NO EXISTE EN DRIVE" },       // no tiene foto
  ];
  const r = enrich(entra);
  assert.equal(r.conFoto, 1);
  assert.equal(r.sinFoto, 1);
  // La asercion que importa no es el valor: es que "foto_url" SEA PROPIA en las dos filas. Con la
  // columna NOT NULL, una fila sin la clave es la fila que tumba el espejo con 23502.
  for (const fila of r.filas) {
    assert.ok(Object.prototype.hasOwnProperty.call(fila, "foto_url"),
      `la fila ${fila.ot} tiene que salir con la clave foto_url, aunque no tenga foto`);
    assert.equal(typeof fila.foto_url, "string",
      `la foto_url de la fila ${fila.ot} tiene que ser texto: null es lo que rompe el espejo`);
  }
});

test("una fila sin foto sale con '' y no con la clave ausente: el caso exacto del 23502", () => {
  const { enrich } = fotosConDrive(CARPETA, "FOLDER-1");
  // Asi es como se manifesto: el RESTlet NO manda la clave foto_url en las filas sin foto, y el
  // adaptador se la ponia solo en las que casaban. El resultado era un payload mezcla, y PostgREST
  // le ponia NULL a las que no casaban.
  const r = enrich([{ ot: "2122", articulo: "NO EXISTE EN DRIVE" }]);
  assert.equal(r.filas[0].foto_url, "",
    "sin foto el valor es '', que es lo que declara la columna, no la ausencia de la clave");
  assert.equal(r.sinFoto, 1);
});

test("las dos funciones de enriquecimiento se portan igual: la que ya existia no se desalinea", () => {
  // PP_enrichWorkOrderPhotos_ (09-photos.js:38) ya asignaba photoUrl SIEMPRE, con '' cuando no
  // habia. La asimetria entre las dos funciones era el defecto, asi que esta prueba la fija: si
  // alguien "simplifica" la hermana para que se parezca en la forma a la otra, la afirmacion falla.
  assert.match(fotos, /return Object\.assign\(\{\}, workOrder, \{ photoUrl: photoUrl \}\);/,
    "PP_enrichWorkOrderPhotos_ tiene que asignar photoUrl en todas las filas, sin condicion");
  const conFotoYSin = fotos.slice(
    fotos.indexOf("function PP_enrichWorkOrderPhotos_"),
    fotos.indexOf("function PP_loadPhotoCatalog_"));
  assert.ok(!/if \([^)]*photoUrl[^)]*\)\s*return workOrder\s*;?\s*\}\s*\n?\s*return workOrder;/.test(conFotoYSin),
    "y no puede devolver la fila sin tocar cuando la foto ya viene, porque el espejo necesita uniformidad");
});

// EL ERROR DEL RPC, Y POR QUE SE CORTA AL FINAL. MEDIDO 2026-10-02: el mensaje se armaba con
// getContentText().slice(0, 300) y un 23502 salia mudo, porque en el cuerpo de Postgres el campo
// que dice la COLUMNA es 'message' y va despues de 'details', que es la fila repetida. Estas dos
// pruebas fijan que el ayudante lee 'message'.
function errorPostgREST(texto) {
  const ctx = createContext({ JSON, String, console });
  // El recorte se toma tal cual, SIN envolverlo en otra function: envolverlo declaraba el mismo
  // nombre dos veces y la de adentro tapaba a la de afuera, asi que la prueba recibia undefined y
  // fallaba por el arnes, no por el codigo que queria vigilar.
  runInContext(server.slice(
    server.indexOf("function PP_errorPostgREST_(res) {"),
    server.indexOf("function PP_supabaseMirror_(")), ctx);
  return ctx.PP_errorPostgREST_({ getContentText: () => texto });
}

test("el error del espejo nombra la columna: se lee el 'message' de Postgres, no el 'details'", () => {
  const real = JSON.stringify({
    code: "23502",
    details: "Failing row contains (4e97d1a0-0000-0000-0000-000000000000,2121,20241152," + "x".repeat(400) + ")",
    hint: null,
    message: 'null value in column "foto_url" of relation "work_orders" violates not-null constraint "work_orders_foto_url_not_null"',
  });
  const salida = errorPostgREST(real);
  assert.match(salida, /23502/, "el codigo de Postgres se conserva");
  assert.match(salida, /column "foto_url"/,
    "el nombre de la columna tiene que salir: es lo unico que dice que arreglar, y con el slice(0,300) quedaba cortada");
  assert.ok(!salida.includes("Failing row contains"),
    "y el 'details', que es la fila repetida, no se gasta el espacio del mensaje");
});

test("si el cuerpo no es JSON, el error devuelve el FINAL del texto, no el principio", () => {
  const largo = "A".repeat(400) + "COLUMN_QUE_FALTA_Al_final";
  const salida = errorPostgREST(largo);
  assert.ok(salida.includes("COLUMN_QUE_FALTA_Al_final"),
    "en un error de Postgres lo que dice que paso esta al final casi siempre");
  assert.ok(salida.startsWith("..."), "y se marca que se recorto, para que nadie crea que es el texto entero");
});
