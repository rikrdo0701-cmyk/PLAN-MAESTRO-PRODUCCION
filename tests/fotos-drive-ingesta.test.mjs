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
 * mentira, y devuelve { enrich, catalogo, folderId }.
 */
function fotosConDrive(catalogo, folderId) {
  const leidas = { folder: 0 };
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
      getScriptCache: () => ({ get: () => null, put: () => {} }),
    },
    DriveApp: {
      getFolderById: (id) => {
        leidas.folder += 1;
        const archivos = Object.keys(catalogo).map((nombre) => ({
          getName: () => nombre,
          getId: () => catalogo[nombre],
        }));
        let i = 0;
        return {
          getFiles: () => ({
            hasNext: () => i < archivos.length,
            next: () => archivos[i++],
          }),
        };
      },
    },
    Logger: { log: () => {} },
  };
  contexto.globalThis = contexto;
  createContext(contexto);
  runInContext(fotos, contexto, { filename: "09-photos.js" });
  // Se sube el ADAPTADOR, no PP_enrichWorkOrderPhotos_: este ultimo solo entiende el shape del
  // puente ({ item, photoUrl }) y por eso no le sirve a la ingesta, que recibe { articulo, foto_url }.
  return { enrich: contexto.PP_enrichPhotoRows_, catalogo: leidas };
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
  const { enrich } = fotosConDrive(CARPETA, "");
  const r = enrich([{ ot: "2121", articulo: "20241152", foto_url: "" }]);
  assert.equal(r.filas[0].foto_url, "",
    "sin carpeta configurada el resultado es la foto vacia, no una URL inventada");
  assert.equal(r.sinFoto, 1);
  assert.equal(r.carpeta, "", "y el adaptador avisa que no hay carpeta, para que el 0 tenga un porque");
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