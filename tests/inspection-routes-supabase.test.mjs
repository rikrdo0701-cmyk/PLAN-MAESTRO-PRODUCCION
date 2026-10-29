// LA MIGRACION DEL CATALOGO DE TRAMOS: de la hoja `Tramos` a `inspection_routes`.
//
// MEDIDO 2026-10-01, lo que estaba roto y por eso estas pruebas existen:
//
// 1. LA PAGINA LEIA LOS TRAMOS DE `materials`, QUE ES TABLA DEL ERP. La columna
//    "Tramo" de la tabla de Catalogos salia VACIA siempre, y en su lugar se
//    mostraba `dibujo || foto_url` de un material. No era una lectura
//    incompleta: era una lectura de la tabla equivocada. Los tramos de verdad
//    estaban en la hoja `Tramos` del libro INSPECTION_SPREADSHEET_ID y no
//    llegaban a la pagina.
//
// 2. LA PAGINA GUARDABA EL TRAMO TAMBIEN EN `materials` (`dibujo: route`). O sea
//    que un tramo de inspeccion terminaba en la columna de DIBUJO de una tabla de
//    materiales que el RESTlet 2246 sobreescribe cada 15 minutos. Y ese camino
//    ademas no funcionaba: `getWriter()` exige `writer.guardarPlan` y
//    PPSupabaseWriter exporta `guardar`, o sea que lanzaba antes de escribir.
//
// QUE SE COMPRUEBA AQUI Y POR QUE.
//
// A. LA LECTURA DE LA PAGINA VA A `inspection_routes` Y TRAE TRAMO. Si alguien
//    volviera a apuntar a `materials`, la tabla de Catalogos volveria a mostrar
//    una columna vacia sin que nada fallara: es el fallo que se ve bien y esta
//    mal. Por eso se afirma sobre QUE URL SE PIDIO, no solo sobre el resultado.
//
// B. LA DEDUPLICACION AL IMPORTAR. La hoja llega con dos filas que solo se
//    diferencian en las mayusculas ("A-100" y "a-100") y el indice de antes se
//    quedaba con la ULTIMA porque escribia en un objeto. Con la tabla nueva el
//    UNIQUE esta en `clave`, que sale de PP_normalizeKey_ (mayusculas), o sea que
//    "A-100" y "a-100" SI colisionan y el INSERT se negaria a las dos. Si la
//    deduplicacion no estaria donde se dice, la importacion falla entera.
//
// C. LA DEDUPLICACION ES POR CLAVE LAXA, no solo por mayusculas. "A-100" y
//    "A 100" son columnas distintas para PP_normalizeKey_ y la MISMA para
//    PP_Inspection_routeLooseKey_, que es como las empareja la busqueda. Dejarlas
//    como dos filas seriameter dos verdades para un tramo y las dos responderian
//    a la misma busqueda.
//
// D. `actualizado_at` SOLO CUANDO EL TEXTO SE PUDO LEER COMO FECHA. La celda
//    "Ultima modificacion" de la hoja es texto libre. Poner una fecha inventada
//    cuando el texto no es una fecha seria fabricar un dato de auditoria.
//
// E. EL REPARTO CON LA HOJA SE DICE. Supabase es la fuente; si la lectura falla,
//    la hoja contesta y el resultado trae `fuente` y `aviso`. Un catalogo vacio o
//    viejo sin explicacion es el peor de los finales, porque se ve correcto.
//
// F. EL IMPORTADOR USA EL RPC DE ESPEJO Y DICE LO QUE HIZO. `escritas: 0` con la
//    hoja llena significa que el DDL no esta aplicado o que la tabla no esta en
//    la whitelist, y eso tiene que ser legible sin adivinar.
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const readerSource = await readFile(new URL("../src/web/shared/supabase-reader.js", import.meta.url), "utf8");
const puenteSource = await readFile(new URL("../src/web/shared/supabase-bridge-replacement.js", import.meta.url), "utf8");
const serviceSource = await readFile(new URL("../src/server/16-inspection-service.js", import.meta.url), "utf8");

// =============================================================================
// EL LECTOR
// =============================================================================

/** Levanta el lector con un fetch de mentira que devuelve `filas` por tabla. */
function lector(filas) {
  const pedido = [];
  const contexto = {
    console,
    JSON, Object, Array, Promise, Date, String, Number, Boolean, Error, RegExp, isFinite,
    encodeURIComponent, decodeURIComponent,
    fetch: async (url) => {
      const tabla = decodeURIComponent(String(url).split("/rest/v1/")[1].split("?")[0]);
      pedido.push({ tabla: tabla, url: String(url) });
      const hay = Object.prototype.hasOwnProperty.call(filas, tabla);
      return {
        ok: true,
        status: 200,
        json: async () => (hay ? filas[tabla] : []),
      };
    },
  };
  contexto.globalThis = contexto;
  vm.createContext(contexto);
  vm.runInContext(readerSource, contexto, { filename: "supabase-reader.js" });
  const api = contexto.PPSupabaseReader;
  api.configure({ url: "https://ejemplo.supabase.co", anonKey: "sb_publishable_falsa" });
  return { api, pedido };
}

test("la tabla de tramos esta declarada en la Data API", () => {
  const { api } = lector({});
  assert.equal(api.TABLES.includes("inspection_routes"), true);
  // Y NO esta en CATALOG_TABLES: los tramos no son parte del estado del plan
  // (PP_buildState_ no tiene un campo de tramos). Meterlos ahi seria cambiar un
  // contrato que consume el planificador entero, y ademas costaria una llamada en
  // cada arranque para un dato que solo usa la pestana de inspeccion.
  assert.equal(api.CATALOG_TABLES.includes("inspection_routes"), false);
});

test("readInspectionRoutes pide las columnas del tramo y NO `materials`", async () => {
  const { api, pedido } = lector({
    inspection_routes: [{ clave: "A-100|MP-1", articulo: "A-100", material: "MP-1", tramo: "650 mm", dibujo: "a.pdf", actualizado: "ayer", actualizado_at: null }],
    materials: [{ componente: "MP-1", dibujo: "esto-no-es-un-tramo" }],
  });

  const filas = await api.readInspectionRoutes();

  // MEDIDO 2026-10-03: la lectura pagina con limit=1000 + offset (ver
  // readInspectionRoutes en supabase-reader.js). Sin limit, PostgREST aplica
  // db-max-rows (1000) y un catalogo de 2006 filas llega recortado en
  // silencio. Con una sola fila la paginacion termina en la primera vuelta.
  assert.equal(pedido.length, 1);
  assert.equal(pedido[0].tabla, "inspection_routes");
  assert.match(pedido[0].url, /select=clave%2Carticulo%2Cmaterial%2Ctramo%2Cdibujo%2Cactualizado%2Cactualizado_at/);
  assert.match(pedido[0].url, /order=articulo\.asc/);
  assert.match(pedido[0].url, /limit=1000/);
  assert.match(pedido[0].url, /offset=0/);
  assert.equal(filas[0].tramo, "650 mm");
});

test("readInspectionRoutes pagina: un catalogo de 2006 filas llega entero (2 vueltas)", async () => {
  // MEDIDO 2026-10-03 en produccion: sin limit, la consulta de la pagina
  // recibia solo las primeras 1000 de 2006 (db-max-rows de PostgREST) y las
  // 1006 restantes nunca llegaron: D88-6055 iba en la 1201 y su tramo salia en
  // blanco en la hoja de inspeccion. Este test simula el corte: el fetch de
  // mentira respeta limit/offset, como PostgREST.
  const todas = Array.from({ length: 2006 }, (_, i) => ({
    clave: "A" + String(i).padStart(4, "0") + "|MP-1",
    articulo: "A" + String(i).padStart(4, "0"),
    material: "MP-1",
    tramo: "tramo " + i,
    dibujo: "",
    actualizado: "",
    actualizado_at: null,
  }));
  const pedido = [];
  const contexto = {
    console,
    JSON, Object, Array, Promise, Date, String, Number, Boolean, Error, RegExp, isFinite,
    encodeURIComponent, decodeURIComponent,
    fetch: async (url) => {
      const params = new URLSearchParams(String(url).split("?")[1] || "");
      const limit = Number(params.get("limit") || 0);
      const offset = Number(params.get("offset") || 0);
      pedido.push({ limit, offset });
      return { ok: true, status: 200, json: async () => todas.slice(offset, offset + limit) };
    },
  };
  contexto.globalThis = contexto;
  vm.createContext(contexto);
  vm.runInContext(readerSource, contexto, { filename: "supabase-reader.js" });
  const api = contexto.PPSupabaseReader;
  api.configure({ url: "https://ejemplo.supabase.co", anonKey: "sb_publishable_falsa" });

  const filas = await api.readInspectionRoutes();

  // 1000 + 1000 + 6: la ultima vuelta devuelve menos de una pagina y cierra el bucle.
  assert.deepEqual(pedido, [{ limit: 1000, offset: 0 }, { limit: 1000, offset: 1000 }, { limit: 1000, offset: 2000 }]);
  assert.equal(filas.length, 2006);
  // La que antes nunca llegaba:
  assert.equal(filas[1200].tramo, "tramo 1200");
});

test("el mapeo trae los dos aliases que acepta el nucleo de inspeccion", () => {
  const { api } = lector({});
  const [fila] = api.mapInspectionRoutes([
    { clave: "A-100|MP-1", articulo: "A-100", material: "MP-1", tramo: "650 mm", dibujo: "a.pdf", actualizado: "01/10/2026 09:00:00", actualizado_at: "2026-10-01T15:00:00.000Z" },
  ]);

  // En mayusculas, que es como los nombraba Apps Script (ARTICULO/MATERIAL/TRAMO/
  // DIBUJO/ACTUALIZADO) y como los acepta inspection-core.js:39-52.
  assert.equal(fila.ARTICULO, "A-100");
  assert.equal(fila.MATERIAL, "MP-1");
  assert.equal(fila.TRAMO, "650 mm");
  assert.equal(fila.DIBUJO, "a.pdf");
  assert.equal(fila.ACTUALIZADO, "01/10/2026 09:00:00");
  // Y en minusculas, que es como los nombra el nucleo.
  assert.equal(fila.article, "A-100");
  assert.equal(fila.material, "MP-1");
  assert.equal(fila.route, "650 mm");
  assert.equal(fila.drawing, "a.pdf");
  assert.equal(fila.updated, "01/10/2026 09:00:00");
  assert.equal(fila.actualizadoAt, "2026-10-01T15:00:00.000Z");
});

test("una fila sin ARTICULO se descarta: sin el no hay clave", () => {
  const { api } = lector({});
  const filas = api.mapInspectionRoutes([
    { articulo: "", material: "MP-1", tramo: "650 mm" },
    { articulo: "A-100", material: "MP-1", tramo: "650 mm" },
  ]);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].articulo, "A-100");
});

test("una fila SIN DIBUJO se conserva: es el dibujo a nivel de OT, no un dato incompleto", () => {
  const { api } = lector({});
  const filas = api.mapInspectionRoutes([
    // El material VACIO con dibujo es como PP_Inspection_articleDrawingMatchV2_
    // busca el dibujo del articulo entero. Tirar filas sin dibujo aca borraria ese
    // caso, que es una fila mas del catalogo.
    { articulo: "A-100", material: "", tramo: "", dibujo: "a100-completo.pdf", actualizado: "" },
  ]);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].material, "");
  assert.equal(filas[0].drawing, "a100-completo.pdf");
});

test("`actualizado` se queda como TEXTO: no se convierte a fecha", () => {
  const { api } = lector({});
  const [fila] = api.mapInspectionRoutes([
    { articulo: "A-100", material: "MP-1", actualizado: "lo reviso ana", actualizado_at: null },
  ]);
  // En la hoja `Ultima modificacion` era una celda de texto libre. Convertirla
  // cambiaria lo que la tabla de Catalogos muestra, sin que nadie lo pidiera.
  assert.equal(fila.actualizado, "lo reviso ana");
  assert.equal(fila.actualizadoAt, "");
});

// =============================================================================
// EL REEMPLAZO DEL PUENTE (lo que la pagina llama de verdad)
// =============================================================================

/** Levanta el reemplazo del puente con el lector y el escritor de mentira. */
function puente({ filas = [], guardar = async () => ({ ok: true, fila: {} }) } = {}) {
  const leidos = [];
  const guardados = [];
  const contexto = {
    console, JSON, Object, Array, Promise, Date, String, Number, Boolean, Error, RegExp, isFinite,
    PPSupabaseReader: {
      readInspectionRoutes: async () => { leidos.push("readInspectionRoutes"); return filas; },
      readTable: async (tabla) => { leidos.push(tabla); return []; },
    },
    PPSupabaseWriter: {
      guardarInspectionRoute: async (cuerpo) => { guardados.push(cuerpo); return guardar(cuerpo); },
    },
  };
  contexto.globalThis = contexto;
  vm.createContext(contexto);
  vm.runInContext(puenteSource, contexto, { filename: "supabase-bridge-replacement.js" });
  return { api: contexto.PPSupabaseBridgeReplacement, leidos, guardados };
}

test("A. la pagina lee los tramos de inspection_routes y NO de materials", async () => {
  const { api, leidos } = puente({
    filas: [{ clave: "A-100|MP-1", articulo: "A-100", material: "MP-1", tramo: "650 mm", dibujo: "a.pdf", actualizado: "ayer" }],
  });

  const result = await api.getInspectionDrawingRoutes("");

  assert.deepEqual(leidos, ["readInspectionRoutes"]);
  assert.equal(result.ok, true);
  assert.equal(result.data[0].TRAMO, "650 mm");
  assert.equal(result.data[0].ARTICULO, "A-100");
  assert.equal(result.data[0].MATERIAL, "MP-1");
  assert.equal(result.data[0].DIBUJO, "a.pdf");
});

test("el filtro por articulo es laxo: acentos y puntuacion no lo espantan", async () => {
  const filas = [
    { articulo: "A-100", material: "MP-1", tramo: "650 mm", dibujo: "", actualizado: "" },
    { articulo: "A100", material: "MP-2", tramo: "420 mm", dibujo: "", actualizado: "" },
    { articulo: "B-200", material: "MP-3", tramo: "380 mm", dibujo: "", actualizado: "" },
  ];

  const conGuion = await puente({ filas }).api.getInspectionDrawingRoutes("A-100");
  // "A-100" sin guiones tiene que encontrar tambien la fila de "A100": el servidor
  // empareja con PP_Inspection_routeLooseKey_, que quita toda la puntuacion.
  assert.equal(conGuion.data.length, 2);

  const conAcento = await puente({ filas }).api.getInspectionDrawingRoutes("á-100");
  assert.equal(conAcento.data.length, 2);
});

test("el guardado del tramo va a guardarInspectionRoute y NO a `materials`", async () => {
  const { api, guardados } = puente({
    guardar: async (cuerpo) => ({ ok: true, fila: { ...cuerpo, actualizado: "01/10/2026 09:00:00" } }),
  });

  const result = await api.saveInspectionLink({ article: "A-100", material: "MP-1", route: "650 mm" });

  assert.equal(result.ok, true);
  assert.equal(guardados.length, 1);
  assert.equal(guardados[0].articulo, "A-100");
  assert.equal(guardados[0].material, "MP-1");
  assert.equal(guardados[0].tramo, "650 mm");
  // El dibujonotrabaja VIA: el dialogo de Catalogos solo edita el tramo, y mandarlo
  // vacio borraria el dibujo que alguien mas mantiene.
  assert.equal(Object.prototype.hasOwnProperty.call(guardados[0], "dibujo"), false);
  assert.equal(result.data.TRAMO, "650 mm");
  assert.equal(result.data.ACTUALIZADO, "01/10/2026 09:00:00");
});

test("el dialogo de la hoja de inspeccion SI puede cambiar el dibujo", async () => {
  const { api, guardados } = puente();

  await api.saveInspectionLink({ article: "A-100", material: "MP-1", route: "650 mm", drawing: "nuevo.pdf" });

  assert.equal(guardados[0].dibujo, "nuevo.pdf");
});

test("si el escritor falla, el reemplazo devuelve ok:false con el motivo", async () => {
  const { api } = puente({ guardar: async () => ({ ok: false, motivo: "no hay sesion de Supabase: entra con tu correo" }) });

  const result = await api.saveInspectionLink({ article: "A-100", material: "MP-1", route: "650 mm" });

  assert.equal(result.ok, false);
  assert.match(result.error, /sesion/);
});

// =============================================================================
// EL LADO DE APPS SCRIPT: el indice y el importador
// =============================================================================

const HOJA = [
  ["Articulo", "Materia prima", "Tramo", "DIBUJO", "Ultima modificacion"],
  ["A-100", "MP-1", "600 mm", "viejo.pdf", "01/09/2026 08:00:00"],
  ["a100", "MP-1", "650 mm", "nuevo.pdf", "02/09/2026 09:30:00"],
  ["B-200", "MP-2", "420 mm", "", "ayer lo reviso"],
  ["A 200", "MP-3", "300 mm", "a200.pdf", "03/09/2026 10:15:00"],
  ["A-200", "MP-3", "310 mm", "a200b.pdf", "04/09/2026 11:00:00"],
];

/** Levanta 16-inspection-service.js con la hoja de Tramos de mentira. */
function servicio(extra = {}) {
  const pedidos = [];
  const contexto = {
    console: { log: () => {}, error: () => {} },
    JSON, Object, Array, Promise, Date, String, Number, Boolean, Error, RegExp, isFinite, parseInt, parseFloat,
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => "" }) },
    SpreadsheetApp: { openById: () => ({}) },
    // La MISMA normalizacion de PP_normalizeKey_ (02-storage.js:2419). Se declara
    // en vez de duplicarse: si el servidor cambiara esa regla, este contexto
    // tendria que cambiar con ella y el test avisaria.
    PP_normalizeKey_: (value) => String(value ?? "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_"),
    // La hoja de Tramos YA CONGELADA, tal como llego: con filas que se repiten por
    // clave y una con `Ultima modificacion` en texto libre. Es el caso que hace
    // necesaria la deduplicacion al importar.
    PP_readRows_: () => HOJA.slice(1).map((fila) => ({ Articulo: fila[0], "Materia prima": fila[1], Tramo: fila[2], DIBUJO: fila[3], "Ultima modificacion": fila[4] })),
    Session: { getScriptTimeZone: () => "America/Mexico_City" },
    Utilities: { formatDate: () => "15/07/2026 17:04:03" },
    ...extra,
  };
  vm.createContext(contexto);
  vm.runInContext(serviceSource, contexto, { filename: "16-inspection-service.js" });
  // OJO, y es el orden lo que importa: `PP_Inspection_sheet_` ESTA DECLARADA en
  // 16-inspection-service.js, y una declaracion de funcion sobrescribe lo que
  // hubiera en el contexto. Por eso la sustitucion va DESPUES de correr el fuente,
  // igual que hacen las pruebas de 16-inspection-service.js. Lo que se sustituye es
  // la resolucion de la hoja (que normaliza encabezados con Drive), no las filas:
  // esas las da `PP_readRows_`, que vive en 02-storage.js y por eso si sobrevive.
  contexto.PP_Inspection_sheet_ = () => ({});
  return { contexto, pedidos };
}

/** El servidor con Supabase disponible: se atude el `PP_supabaseLee_` falso. */
function conSupabase(filas, responder = null) {
  const pedidos = [];
  const { contexto } = servicio({
    PP_supabaseLee_: (tabla, opciones) => {
      pedidos.push({ tabla, opciones });
      if (responder) return responder(tabla, opciones);
      return filas;
    },
    PP_supabaseCatalogoConfig_: () => ({ url: "https://ejemplo.supabase.co", key: "service-role-de-prueba" }),
    PP_supabaseMirrorCatalogo_: (tabla, cuerpo, config) => {
      pedidos.push({ tabla: tabla + ":espejo", cuerpo });
      return { insertadas: cuerpo.length, borradas: 1 };
    },
  });
  return { contexto, pedidos };
}

test("E. Supabase es la fuente: el indice sale de la tabla, no de la hoja", () => {
  const { contexto, pedidos } = conSupabase([
    { articulo: "A-100", material: "MP-1", tramo: "650 mm", dibujo: "nuevo.pdf", actualizado: "02/09/2026 09:30:00" },
  ]);
  contexto.PP_Inspection_invalidateRouteIndexCache_ = () => {};

  const lectura = contexto.PP_Inspection_routeIndexConFuente_();

  assert.equal(lectura.fuente, "supabase");
  assert.equal(lectura.aviso, "");
  assert.equal(lectura.index["A-100|MP-1"].TRAMO, "650 mm");
  assert.equal(lectura.index["A-100|MP-1"].DIBUJO, "nuevo.pdf");
  assert.equal(pedidos[0].tabla, "inspection_routes");
});

test("una fila con material VACIO se indexa como articulo| (el dibujo de la OT)", () => {
  const { contexto } = conSupabase([
    { articulo: "A-100", material: "", tramo: "", dibujo: "a100-completo.pdf", actualizado: "" },
  ]);
  contexto.PP_Inspection_invalidateRouteIndexCache_ = () => {};

  const lectura = contexto.PP_Inspection_routeIndexConFuente_();

  assert.equal(lectura.index["A-100|"].DIBUJO, "a100-completo.pdf");
});

test("E. si Supabase falla, la hoja contesta Y SE DICE QUE NO ES LA FUENTE", () => {
  const { contexto } = servicio({
    PP_supabaseLee_: () => { throw new Error("HTTP 404: relation \"inspection_routes\" does not exist"); },
  });
  contexto.PP_Inspection_invalidateRouteIndexCache_ = () => {};

  const lectura = contexto.PP_Inspection_routeIndexConFuente_();

  assert.equal(lectura.fuente, "hoja");
  // El aviso importa: un tramo viejo que se ve bien es el fallo que se imprime mal.
  assert.match(lectura.aviso, /no es la fuente/);
  assert.match(lectura.aviso, /404/);
  // Y aun asi contesta con datos, que es lo que permite trabajar mientras se
  // aplica el DDL.
  //
  // LA CLAVE ES `A100|MP-1` Y NO `A-100|MP-1`, y es lo que hacia la hoja: la fila
  // que gana la deduplicacion es la ultima, la que dice "a100", y su clave sale de
  // SU articulo. El indice de la hoja tampoco tenia `A-100|MP-1` (ganaba la
  // ultima por el mismo motivo), o sea que el comportamiento no se mueve. Y la
  // busqueda no se rompe por eso: el segundo nivel, laxo, si encuentra las dos
  // formas (PP_Inspection_routeIndexV2_).
  assert.equal(lectura.index["A100|MP-1"].TRAMO, "650 mm");
});

test("B+C. el importador deduplica por clave laxa y GANA LA ULTIMA", () => {
  const { contexto, pedidos } = conSupabase([]);
  contexto.PP_Inspection_invalidateRouteIndexCache_ = () => {};

  const informe = contexto.PP_migrarTramosASupabase_();

  assert.equal(informe.ok, true);
  const espejo = pedidos.find((p) => p.tabla === "inspection_routes:espejo");
  assert.equal(espejo.cuerpo.length, 3);
  // "A-100"/"a100" con la MISMA materia: una sola fila, y la ULTIMA (650 mm), que
  // es la que ganaba cuando la hoja se leia como indice. La fila que gana es la
  // que dice "a100", asi que su clave es `A100|MP-1`: se guarda lo que la hoja
  // tenia, no una clave "corregida" que no existia en ningun sitio.
  const a100 = espejo.cuerpo.filter((f) => f.articulo.toLowerCase().replace(/-/g, "") === "a100");
  assert.equal(a100.length, 1);
  assert.equal(a100[0].tramo, "650 mm");
  assert.equal(a100[0].dibujo, "nuevo.pdf");
  // "A 200" y "A-200" son columnas distintas para PP_normalizeKey_ pero la MISMA
  // fila para la busqueda laxa: si no se unieran, dos filas responderian al mismo
  // tramo y la base tendria dos verdades.
  const a200 = espejo.cuerpo.filter((f) => f.articulo.replace(/[- ]/g, "") === "A200");
  assert.equal(a200.length, 1);
  assert.equal(a200[0].tramo, "310 mm");
  // Y el recuento de lo que se desconto se dice, para que una importacion que
  // "pierde" filas no parezca silenciosa.
  assert.equal(informe.data.omitidas, 2);
  assert.equal(informe.data.escritas, 3);
});

test("B. la hoja con mayusculas distintas no rompe la importacion por el UNIQUE", () => {
  const { contexto, pedidos } = conSupabase([]);
  contexto.PP_Inspection_invalidateRouteIndexCache_ = () => {};

  contexto.PP_migrarTramosASupabase_();

  const claves = pedidos.find((p) => p.tabla === "inspection_routes:espejo").cuerpo.map((f) => f.clave);
  assert.equal(new Set(claves).size, claves.length);
});

test("D. actualizado_at se llena solo cuando el texto se pudo leer como fecha", () => {
  const { contexto, pedidos } = conSupabase([]);
  contexto.PP_Inspection_invalidateRouteIndexCache_ = () => {};

  contexto.PP_migrarTramosASupabase_();

  const cuerpo = pedidos.find((p) => p.tabla === "inspection_routes:espejo").cuerpo;
  // "02/09/2026 09:30:00" SI es una fecha.
  const conFecha = cuerpo.find((f) => f.actualizado === "02/09/2026 09:30:00");
  assert.equal(conFecha.actualizado_at, "2026-09-02T09:30:00.000Z");
  // "ayer lo reviso" NO lo es: se guarda el texto y el instante queda NULO. Poner
  // una fecha inventada seria fabricar un dato de auditoria.
  const textoLibre = cuerpo.find((f) => f.actualizado === "ayer lo reviso");
  assert.equal(textoLibre.clave, "B-200|MP-2");
  assert.equal(textoLibre.actualizado_at, null);
});

test("F. la importacion dice lo que escribio y de donde vino", () => {
  const { contexto } = conSupabase([]);
  contexto.PP_Inspection_invalidateRouteIndexCache_ = () => {};

  const informe = contexto.PP_migrarTramosASupabase_();

  assert.deepEqual(
    { fuente: informe.data.fuente, destino: informe.data.destino },
    { fuente: "hoja Tramos", destino: "inspection_routes" }
  );
});

test("F. sin Supabase, la importacion dice que falta, en vez de no hacer nada", () => {
  const { contexto } = servicio(); // sin PP_supabaseLee_ ni config

  const informe = contexto.PP_migrarTramosASupabase_();

  assert.equal(informe.ok, false);
  assert.match(informe.error, /16-supabase-catalogo\.js/);
});

test("la importacion usa el RPC de espejo, no borra filas fila por fila", () => {
  const { contexto, pedidos } = conSupabase([]);
  contexto.PP_Inspection_invalidateRouteIndexCache_ = () => {};

  contexto.PP_migrarTramosASupabase_();

  // Un solo pedido de escritura. El RPC ingesta_mirror es BORRA-E-INSERTA, y por
  // eso la importacion se corre A MANO y no desde la pagina: volveria a dejar el
  // catalogo como estaba en la hoja y se perderia lo capturado desde la migracion.
  const escrituras = pedidos.filter((p) => String(p.tabla).includes("espejo"));
  assert.equal(escrituras.length, 1);
});
