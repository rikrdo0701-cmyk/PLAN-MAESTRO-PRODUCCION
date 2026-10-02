// EL HISTORIAL DE IMPRESIONES DE INSPECCION: de la hoja `HISTORIAL_IMPRESION_INSPEC`
// a la tabla `inspection_history`.
//
// MEDIDO 2026-10-01, LO QUE ESTABA ROTO Y POR QUE ESTAS PRUEBAS EXISTEN.
//
// 1. NO SE GUARDABA NADA. `printInspection` (inspection-app.js) pedia
//    `recordInspectionPrint` por `call(...)`, o sea por el puente de Apps Script, que
//    esta deshabilitado (RULE-SUP-029). La impresion salia igual porque el registro es
//    NO BLOQUEANTE: la app pregunta "¿Imprimir de todos modos?" y sigue. O sea que no
//    era un historial guardado en otro sitio: era un historial SIN LUGAR, y el unico
//    sintoma era un confirm.
//
// 2. NO SE PODIA LEER. La tarjeta "Ultima impresion" salia con `Total: 0` porque
//    `loadDetail` leia `bundle.history`, y el bundle plano no traia esa propiedad. Con
//    la Data API, sin sesion, la respuesta es HTTP 200 con CERO filas: "no pude leer" y
//    "nadie ha impreso nunca" se ve IGUALES. Por eso `leerInspectionHistoryConAviso`
//    devuelve `{ok:false, error}` nombrando la tabla y el DDL, y `renderHistory` pinta
//    ese error en vez de un 0.
//
// QUE SE COMPRUEBA AQUI Y POR QUE CADA COSA.
//
// A. LA TABLA ESTA DECLARADA Y LA LECTURA VA A ELLA. Si alguien apuntara a la hoja o a
//    otra tabla, el historial se leeria de un sitio donde no esta y la pagina no lo
//    distinguiria de "vacio". Se afirma sobre QUE URL SE PIDIO.
//
// B. `printed_at` ORDENA Y `fecha_hora` SE MUESTRA. Son las dos columnas del mismo dato
//    (RULE-INS-001) y cada una tiene su uso. Si el lector usara el texto para ordenar,
//    "01/02/2026" quedaria antes que "15/12/2025"; y si mostrara el instante, la
//    pagina dejaria de pintar la fecha con el formato de la hoja.
//
// C. EL NUMERO DE CADA IMPRESION CUENTA DESDE LA MAS RECIENTE. La hoja lo hacia con
//    `rows.length - index` sobre `slice(-5).reverse()`, o sea que depende del TOTAL, no
//    del indice de la lista. Con el total es el numero real de impresion de esa OT.
//
// D. EL TOTAL VIENE DEL CONTEO CON FILTRO POR OT. Sin filtro seria el numero de
//    impresiones de la PLANTAShown como el de esa OT.
//
// E. SIN TOKEN NO SE ESCRIBE. Igual que el resto del escritor: la clave publicable
//    viaja en el bundle publico de GitHub Pages (RULE-SUP-015) y una fila del
//    historial dice que OT se imprimio, cuando y con que semaforo.
//
// F. LO QUE SE ESCRIBE ES UN INSERT, SIEMPRE. Sin `on_conflict` y sin indice UNIQUE:
//    dos impresiones de la misma OT en el mismo segundo son dos hechos, y un
//    `merge-duplicates` se comería la segunda.
//
// G. LA TABLA QUE FALTA SE DICE POR SU NOMBRE. Un 404 de PostgREST con "Could not find
//    the table ... in the schema cache" no dice de donde sale el problema; el aviso
//    nombra el archivo de DDL que lo arregla, igual que el de `inspection_routes`.
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const readerSource = await readFile(new URL("../src/web/shared/supabase-reader.js", import.meta.url), "utf8");
const writerSource = await readFile(new URL("../src/web/shared/supabase-writer.js", import.meta.url), "utf8");
const puenteSource = await readFile(new URL("../src/web/shared/supabase-bridge-replacement.js", import.meta.url), "utf8");
const serviceSource = await readFile(new URL("../src/server/16-inspection-service.js", import.meta.url), "utf8");
const drawingServiceSource = await readFile(new URL("../src/server/17-inspection-drawing-service.js", import.meta.url), "utf8");

// =============================================================================
// EL LECTOR
// =============================================================================

/**
 * Levanta el lector con un fetch de mentira. `filas` es un objeto tabla -> filas;
 * las que no esten devuelven `[]` con HTTP 200, que es lo que hace de verdad la Data
 * API cuando la tabla existe pero el filtro no calza. `conteo` fija el
 * `content-range` que lee `countTable`, que es de donde sale el "Total: N".
 */
function lector({ filas = {}, conteo = null, error = null } = {}) {
  const pedido = [];
  const contexto = {
    console,
    JSON, Object, Array, Promise, Date, String, Number, Boolean, Error, RegExp, isFinite, Math,
    encodeURIComponent, decodeURIComponent,
    fetch: async (url, opciones) => {
      const completa = String(url);
      const tabla = decodeURIComponent(completa.split("/rest/v1/")[1].split("?")[0]);
      const registro = { tabla, url: completa, headers: (opciones && opciones.headers) || {} };
      pedido.push(registro);
      if (error) throw new Error(error);
      const hay = Object.prototype.hasOwnProperty.call(filas, tabla);
      return {
        ok: true,
        status: 200,
        headers: {
          get: (clave) => (String(clave).toLowerCase() === "content-range"
            ? `0-0/${conteo === null ? "7" : conteo}`
            : null),
        },
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

test("A. la tabla de historial esta declarada en la Data API", () => {
  const { api } = lector({});
  assert.equal(api.TABLES.includes("inspection_history"), true);
  // Y NO en CATALOG_TABLES: el historial es un hecho por impresion, no estado del plan.
  assert.equal(api.CATALOG_TABLES.includes("inspection_history"), false);
});

test("A. readInspectionHistory filtra por `ot` y trae las trece columnas", async () => {
  const { api, pedido } = lector({
    filas: { inspection_history: [] },
  });

  await api.readInspectionHistory("OT-1234");

  const lecturas = pedido.filter((p) => p.url.includes("inspection_history"));
  assert.ok(lecturas.length >= 1, "no se pidio nada a inspection_history");
  for (const lectura of lecturas) {
    assert.match(lectura.url, /ot=eq\.OT-1234/, `la lectura no filtra por OT: ${lectura.url}`);
  }
  const conSelect = lecturas.find((p) => /select=/.test(p.url) && !/limit=1/.test(p.url));
  assert.ok(conSelect, "no se encontro la lectura con select de columnas");
  for (const columna of ["fecha_hora", "printed_at", "semaforo", "alertas", "materiales_pendientes", "materiales_deficit", "sin_dibujo", "falta_tramo", "detalle"]) {
    assert.ok(conSelect.url.includes(columna), `el historial no pide ${columna}: la tarjeta no lo muestra y el registro se guarda a ciegas`);
  }
});

test("B. el historial se ORDENA por printed_at DESC con NULLS LAST, no por el texto", async () => {
  const { api, pedido } = lector({ filas: { inspection_history: [] } });
  await api.readInspectionHistory("OT-1");
  const lectura = pedido.find((p) => /order=/.test(p.url));
  assert.ok(lectura, "la lectura no lleva order: el historial saldría en el orden en que las guarde Postgres, que es el de insercion, y no por impresion");
  // MEDIDO 2026-10-01: en PostgreSQL un `desc` SIN `.nullslast` pone los NULLS
  // PRIMERO. Las filas sin `printed_at` son las que no pudieron leer la fecha, o sea
  // las MAS VIEJAS del importador: sin el `.nullslast` se subirian al principio y la
  // pagina diria que la ultima impresion fue una de las que no tiene fecha.
  assert.match(lectura.url, /order=printed_at\.desc\.nullslast/, `el orden es por texto o sin nullslast: ${lectura.url}`);
  assert.match(lectura.url, /created_at\.desc/, "created_at desempata las impresiones del mismo segundo, que pueden ser varias");
});

test("B. el mapa trae `printedAt` (el TEXTO que se ve) y `printedAtIso` (el instante)", () => {
  const { api } = lector({});
  const [fila] = api.mapInspectionHistory([
    {
      ot: "OT-1", fecha_hora: "01/10/2026 09:15:00", printed_at: "2026-10-01T15:15:00.000Z",
      articulo: "A-100", semaforo: "LISTO", alertas: "Falta tramo: MP1",
      sin_dibujo: "SI", falta_tramo: "NO", detalle: { materials: [] },
    },
  ]);
  // Lo que la pagina PINTA es el texto con el formato de la hoja.
  assert.equal(fila.printedAt, "01/10/2026 09:15:00");
  assert.equal(fila.FECHA_HORA, "01/10/2026 09:15:00");
  assert.equal(fila.fechaHora, "01/10/2026 09:15:00");
  // Y el instante viaja aparte, que es lo que se usa para ordenar.
  assert.equal(fila.printedAtIso, "2026-10-01T15:15:00.000Z");
  // Los nombres del folio, en los dos juegos, porque `renderHistory` acepta
  // `FOLIO || folio || OT || wo`.
  assert.equal(fila.folio, "OT-1");
  assert.equal(fila.FOLIO, "OT-1");
  assert.equal(fila.wo, "OT-1");
  // El semaforo en los dos juegos tambien.
  assert.equal(fila.semaphore ?? fila.semaforo, "LISTO");
  assert.equal(fila.SEMAFORO, "LISTO");
});

test("`sin_dibujo` / `falta_tramo` se leen como texto Y como boolean, sin cambiar la columna", () => {
  const { api } = lector({});
  const filas = api.mapInspectionHistory([
    { ot: "OT-1", sin_dibujo: "SI", falta_tramo: "SI" },
    { ot: "OT-2", sin_dibujo: "NO", falta_tramo: "NO" },
    { ot: "OT-3", sin_dibujo: "", falta_tramo: "" },
  ]);
  // El texto VERBATIM, que es lo que se guardaba y lo que habia en la hoja.
  assert.equal(filas[0].sinDibujo, "SI");
  assert.equal(filas[0].SIN_DIBUJO, "SI");
  // Y la forma booleana para quien quiera el dato sin parsear el texto. Un booleano en
  // la columna habria cambiado lo que se lee; esto solo lo agrega.
  assert.equal(filas[0].sinDibujoEs, true);
  assert.equal(filas[0].faltaTramoEs, true);
  assert.equal(filas[1].sinDibujoEs, false);
  assert.equal(filas[2].sinDibujoEs, false);
});

test("`detalle` es un objeto aunque la fila venga con texto", () => {
  const { api } = lector({});
  const filas = api.mapInspectionHistory([
    { ot: "OT-1", detalle: { materials: [{ material: "MP1", pending: 5 }] } },
    { ot: "OT-2", detalle: '{"materials":[]}' },
    { ot: "OT-3", detalle: null },
  ]);
  // jsonb llega parseado de PostgREST...
  assert.equal(filas[0].detalle.materials[0].material, "MP1");
  // ...y una fila sembrada a mano con texto se parsea igual, para que quien lea no
  // tenga que preguntar de que tipo es.
  assert.equal(Array.isArray(filas[1].detalle.materials), true);
  assert.deepEqual(Object.keys(filas[2].detalle), []);
});

test("una fila sin `ot` se descarta: un historial sin folio no es de ninguna OT", () => {
  const { api } = lector({});
  const filas = api.mapInspectionHistory([
    { ot: "", fecha_hora: "01/10/2026 09:15:00" },
    { ot: "OT-2", fecha_hora: "01/10/2026 09:16:00" },
  ]);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].ot, "OT-2");
});

test("C. el numero de cada impresion cuenta desde la mas reciente, usando el TOTAL", async () => {
  const { api } = lector({
    conteo: 12,
    filas: {
      inspection_history: [
        { ot: "OT-1", fecha_hora: "01/10/2026 12:00:00", semaforo: "LISTO" },
        { ot: "OT-1", fecha_hora: "01/10/2026 11:00:00", semaforo: "LISTO" },
        { ot: "OT-1", fecha_hora: "01/10/2026 10:00:00", semaforo: "REVISAR" },
      ],
    },
  });

  const data = await api.readInspectionHistory("OT-1");

  // La hoja numeraba con `rows.length - index` sobre las ULTIMAS CINCO: la ultima
  // impresion es la numero 1. Con el total de 12 son la 12, la 11 y la 10, que es lo
  // que hace que el numero sea el numero REAL de impresion de esa OT.
  assert.deepEqual(data.history.map((h) => h.number), [12, 11, 10]);
  assert.deepEqual(data.history.map((h) => h.printedAt), [
    "01/10/2026 12:00:00", "01/10/2026 11:00:00", "01/10/2026 10:00:00",
  ]);
  assert.equal(data.history[0].folio, "OT-1");
  assert.equal(data.history[0].semaphore, "LISTO");
  assert.equal(data.count, 12);
  assert.equal(data.conteo, 12);
  // `historial` es el MISMO dato con los nombres en espanol: la hoja devolvia las dos
  // parejas y `renderHistory` acepta cualquiera de las dos. No se inventa una tercera.
  assert.deepEqual(data.historial.map((h) => h.numero), [12, 11, 10]);
  assert.equal(data.historial[0].fechaHora, "01/10/2026 12:00:00");
});

test("D. el total sale del conteo FILTRADO por OT", async () => {
  const { api, pedido } = lector({ conteo: 4, filas: { inspection_history: [{ ot: "OT-1", fecha_hora: "x" }] } });
  const data = await api.readInspectionHistory("OT-9");
  const conteo = pedido.find((p) => /count=exact/i.test(Object.entries(p.headers).map(([k, v]) => `${k}:${v}`).join(",")));
  assert.ok(conteo, "no se pidio el conteo: el total seria el numero de filas de la lectura, o sea 5 como maximo, no el total real");
  assert.match(conteo.url, /ot=eq\.OT-9/, `el conteo no filtra por OT: contaria las impresiones de la PLANTA y las mostraria como de esta OT (${conteo.url})`);
  assert.equal(data.count, 4);
});

test("si el conteo no llega (PostgREST devuelve `*`), se cae al numero de filas leidas", async () => {
  const { api } = lector({
    conteo: "*",
    filas: { inspection_history: [{ ot: "OT-1", fecha_hora: "01/10/2026 12:00:00" }, { ot: "OT-1", fecha_hora: "01/10/2026 11:00:00" }] },
  });
  const data = await api.readInspectionHistory("OT-1");
  // Un numero inventado seria peor que el dato que si se tiene. La hoja hacia esto
  // mismo: el numero era `rows.length - index` sobre lo que habia leido.
  assert.equal(data.count, 2);
  assert.deepEqual(data.history.map((h) => h.number), [2, 1]);
});

test("sin folio no se llama a la red: un historial de '' seria el de todas las OT", async () => {
  const { api, pedido } = lector({ filas: { inspection_history: [{ ot: "OT-1" }] } });
  const data = await api.readInspectionHistory("   ");
  // MEDIDO 2026-10-01: `deepEqual` no sirve para comparar objetos que nacieron DENTRO
  // de la vm con los de aqui: tienen distinto `Object.prototype`, asi que Node los ve
  // "iguales en estructura pero no referencialmente iguales" y falla un test que esta
  // bien. Se compara el JSON, que es lo que importa: la forma que recibe la pagina.
  assert.equal(JSON.stringify(data), JSON.stringify({ count: 0, conteo: 0, history: [], historial: [] }));
  assert.equal(pedido.length, 0, "pidio la red con el folio vacio");
});

test("las ultimas son cinco, y el limite va en la consulta", async () => {
  const { api, pedido } = lector({ filas: { inspection_history: [] } });
  await api.readInspectionHistory("OT-1");
  const lectura = pedido.find((p) => /select=/.test(p.url) && !/limit=1/.test(p.url));
  assert.match(lectura.url, /limit=5/, "la hoja mostraba las ultimas cinco (`slice(-5).reverse()`); sin el limite se traerian todas y la tarjeta creeria que puede");
  assert.equal(api.INSPECTION_HISTORY_ULTIMAS, 5);
});

// =============================================================================
// EL ESCRITOR
// =============================================================================

const URL_FALSA = "https://ejemplo.supabase.co";
const CLAVE_FALSA = "sb_publishable_esto-no-es-real";
const JWT_FALSO = "jwt-de-pruebas.eyJzdWIiOiJ1dWlkLWRlLXBydWViYSJ9.firma-que-no-es-real";

function contestando(status, cuerpo) {
  const texto = typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => texto,
    json: async () => JSON.parse(texto),
  };
}

function escritor({ token = JWT_FALSO, configurado = true, responder = null, sinAuth = false } = {}) {
  const llamadas = [];
  const contexto = {
    console,
    AbortController, setTimeout, clearTimeout, Math, Date, JSON, Object, Array,
    Promise, String, Number, Boolean, Error, RegExp, isFinite, parseInt,
    encodeURIComponent, atob,
    fetch: async (destino, opciones) => {
      const url = String(destino);
      const registro = {
        url,
        metodo: (opciones && opciones.method) || "GET",
        headers: (opciones && opciones.headers) || {},
        cuerpo: opciones && opciones.body ? JSON.parse(opciones.body) : null,
        tabla: decodeURIComponent(url.split("/rest/v1/")[1].split("?")[0]),
      };
      llamadas.push(registro);
      if (responder) return responder(registro);
      return contestando(200, []);
    },
  };
  contexto.globalThis = contexto;
  if (!sinAuth) contexto.PPSupabaseAuth = { token: async () => token, configurado: true };
  contexto.PPSupabaseReader = { isConfigured: () => true, config: () => ({ url: URL_FALSA, anonKey: CLAVE_FALSA }) };
  vm.createContext(contexto);
  vm.runInContext(writerSource, contexto, { filename: "supabase-writer.js" });
  const writer = contexto.PPSupabaseWriter;
  if (configurado) writer.configure({ url: URL_FALSA, anonKey: CLAVE_FALSA });
  return { writer, llamadas };
}

const IMPRESION = {
  wo: "OT-1234",
  article: "A-100",
  quantity: 25,
  status: "EN PROCESO",
  semaphore: "REVISAR",
  alerts: ["Falta tramo: MP1", "Sin dibujo"],
  pendingMaterials: [{ material: "MP1", quantity: 5 }, { material: "MP2", quantity: 3 }],
  deficitMaterials: [{ material: "MP2", deficit: 4 }],
  withoutDrawing: true,
  missingRoutes: true,
  operations: ["ns-10", "ns-20"],
  detail: { materials: [{ material: "MP1", pending: 5, issued: 0, available: 0, deficitNeto: 5 }] },
};

test("E. sin sesion NO se escribe y se dice por que", async () => {
  const { writer, llamadas } = escritor({ token: null });
  const informe = await writer.guardarInspectionPrint(IMPRESION);
  assert.equal(informe.ok, false);
  assert.match(informe.motivo, /sesion/i);
  assert.equal(llamadas.length, 0, "escribio sin sesion: una fila del historial dice que OT se imprimio, cuando y con que semaforo");
});

test("sin folio NO se escribe: un historial sin OT no se puede leer despues", async () => {
  const { writer, llamadas } = escritor();
  const informe = await writer.guardarInspectionPrint({ ...IMPRESION, wo: "", ot: "" });
  assert.equal(informe.ok, false);
  assert.match(informe.motivo, /folio/i);
  assert.equal(llamadas.length, 0);
});

test("escribe UNA fila con las doce columnas de la hoja", async () => {
  const { writer, llamadas } = escritor({
    responder: (registro) => (registro.metodo === "POST"
      ? contestando(200, [{ ot: "OT-1234", fecha_hora: "01/10/2026 09:15:00" }])
      : contestando(204, "")),
  });

  const informe = await writer.guardarInspectionPrint(IMPRESION);

  assert.equal(informe.ok, true);
  assert.equal(llamadas.length, 1);
  const envio = llamadas[0];
  assert.equal(envio.metodo, "POST");
  assert.equal(envio.tabla, "inspection_history");
  const cuerpo = envio.cuerpo;
  // Las doce, con el mapeo que hacia `recordInspectionPrint` de Apps Script.
  assert.equal(cuerpo.ot, "OT-1234");
  assert.match(cuerpo.fecha_hora, /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/, "fecha_hora es el TEXTO con el formato de la hoja, no un ISO: es lo que se pinta");
  assert.equal(cuerpo.articulo, "A-100");
  assert.equal(cuerpo.cantidad, 25);
  assert.equal(cuerpo.estado_trabajo, "EN PROCESO");
  assert.equal(cuerpo.semaforo, "REVISAR");
  assert.equal(cuerpo.alertas, "Falta tramo: MP1 | Sin dibujo");
  assert.equal(cuerpo.materiales_pendientes, "MP1:5 | MP2:3");
  assert.equal(cuerpo.materiales_deficit, "MP2:4");
  assert.equal(cuerpo.sin_dibujo, "SI");
  assert.equal(cuerpo.falta_tramo, "SI");
  // `detalle` es un OBJETO: la columna es jsonb, no la celda de texto de la hoja.
  assert.equal(typeof cuerpo.detalle, "object");
  // MEDIDO 2026-10-01: `deepEqual` tampoco sirve aca, por el `Object.prototype` de la vm.
  assert.equal(JSON.stringify(cuerpo.detalle.operations), JSON.stringify(["ns-10", "ns-20"]));
  assert.equal(cuerpo.detalle.materials[0].material, "MP1");
  assert.equal(Object.keys(cuerpo).length, 12, `la hoja declara doce columnas y se mandan ${Object.keys(cuerpo).length}`);
});

test("`sin_dibujo` y `falta_tramo` se guardan como 'SI'/'NO', igual que la hoja", async () => {
  const { writer, llamadas } = escritor();
  await writer.guardarInspectionPrint({ ...IMPRESION, withoutDrawing: false, missingRoutes: false });
  assert.equal(llamadas[0].cuerpo.sin_dibujo, "NO");
  assert.equal(llamadas[0].cuerpo.falta_tramo, "NO");
  // MEDIDO 2026-10-01: la hoja guardaba el texto, no un boolean. Un boolean seria mas
  // comodo de filtrar, pero cambiar lo que se guarda cambia lo que se lee, y el
  // `SI`/`NO` es lo que la gente ya conoce de la hoja vieja.
  assert.equal(typeof llamadas[0].cuerpo.sin_dibujo, "string");
});

test("F. el POST es un INSERT: sin `Prefer: resolution=merge-duplicates`", async () => {
  const { writer, llamadas } = escritor();
  await writer.guardarInspectionPrint(IMPRESION);
  const preferir = Object.entries(llamadas[0].headers).map(([k, v]) => `${k}: ${v}`).join(" | ");
  assert.doesNotMatch(preferir, /resolution=merge-duplicates/i, `el historial se manda con merge-duplicates: dos impresiones de la misma OT en el mismo segundo son DOS hechos, y la segunda se come..Headers: ${preferir}`);
  assert.doesNotMatch(llamadas[0].url, /on_conflict/, `la URL lleva on_conflict: sin indice UNIQUE sobre (ot, fecha_hora) es un 400 de PostgREST. ${llamadas[0].url}`);
});

test("G. si la tabla no existe, el aviso nombra el archivo de DDL", async () => {
  const { writer } = escritor({
    responder: () => contestando(404, { message: "Could not find the table 'public.inspection_history' in the schema cache" }),
  });

  const informe = await writer.guardarInspectionPrint(IMPRESION);

  assert.equal(informe.ok, false);
  assert.match(informe.avisos.join(" "), /schema-inspection-history\.sql/, "el aviso tiene que decir QUE aplicar: un 404 de schema cache no lo dice");
});

// =============================================================================
// EL REEMPLAZO DEL PUENTE (lo que la pagina llama de verdad)
// =============================================================================

/**
 * Levanta el LECTOR REAL, el NUCLEO REAL y el reemplazo del puente, con un `fetch` de
 * mentira que sirve filas por tabla.
 *
 * MEDIDO 2026-10-01, POR QUE EL LECTOR REAL Y NO UNO DE MENTIRA. La primera version de
 * este harness substitute `mapWorkOrders`/`mapMaterials`/`mapOperations` por unas
 * funciones escritas a mano, y el test PASABA con un `detail.materials[0].material` en
 * blanco: los nombres de columna que mi maqueta inventaba no son los que lee
 * `inspection-core.js`, que consume el mapeo del lector. Un mock mas fiel que el
 * codigo es un mock que no prueba nada. Con el lector real, el nucleo real y solo la red
 * falsa, el unico que puede mentir es el fetch.
 *
 * `tablas` son filas CRUDAS de la base (nombres de columna de Postgres), porque es lo
 * que devuelve PostgREST y lo que el lector mapea. Los filtros `ot=eq.X` e
 * `item=in.(...)` se respetan, que es lo que hace la base.
 */
function puente({ tablas = {}, errores = {}, guardar = async () => ({ ok: true, fila: {} }) } = {}) {
  const leidos = [];
  const guardados = [];
  const contexto = {
    console,
    JSON, Object, Array, Promise, Date, String, Number, Boolean, Error, RegExp, isFinite, Math,
    AbortController, setTimeout, clearTimeout, encodeURIComponent, decodeURIComponent, atob,
    fetch: async (destino) => {
      const url = String(destino);
      const tabla = decodeURIComponent(url.split("/rest/v1/")[1].split("?")[0]);
      leidos.push(tabla);
      if (errores[tabla]) throw new Error(errores[tabla]);
      let filas = (tablas[tabla] || []).slice();
      const query = url.split("?")[1] || "";
      const filtroOt = query.match(/ot=eq\.([^&]*)/);
      if (filtroOt) filas = filas.filter((fila) => String(fila.ot) === decodeURIComponent(filtroOt[1]));
      const filtroIn = query.match(/item=in\.\(([^)]*)\)/);
      if (filtroIn) {
        const pedidos = decodeURIComponent(filtroIn[1]).split(",").filter(Boolean);
        filas = filas.filter((fila) => pedidos.includes(String(fila.item)));
      }
      return {
        ok: true,
        status: 200,
        headers: { get: (clave) => (String(clave).toLowerCase() === "content-range" ? `0-0/${filas.length}` : null) },
        json: async () => filas,
        text: async () => JSON.stringify(filas),
      };
    },
  };
  contexto.globalThis = contexto;
  vm.createContext(contexto);
  vm.runInContext(readerSource, contexto, { filename: "supabase-reader.js" });
  contexto.PPSupabaseReader.configure({ url: "https://ejemplo.supabase.co", anonKey: "sb_publishable_falsa" });
  vm.runInContext(coreSource, contexto, { filename: "inspection-core.js" });
  // El escritor es el unico que se sustituye: aqui se prueba que el puente le DELGA el
  // payload tal cual, no que el escritor escriba bien (eso lo prueba su propio archivo).
  contexto.PPSupabaseWriter = {
    guardarInspectionRoute: async (cuerpo) => { guardados.push(cuerpo); return guardar(cuerpo); },
    guardarInspectionPrint: async (cuerpo) => { guardados.push(cuerpo); return guardar(cuerpo); },
  };
  vm.runInContext(puenteSource, contexto, { filename: "supabase-bridge-replacement.js" });
  return { api: contexto.PPSupabaseBridgeReplacement, leidos, guardados };
}

const coreSource = await readFile(new URL("../src/web/inspection/inspection-core.js", import.meta.url), "utf8");

/** Filas CRUDAS de `work_orders`, con los nombres de columna de Postgres. */
function otCruda(ot, articulo, estado = "EN PROCESO") {
  return { ot, articulo, descripcion: `Ensamble ${articulo}`, cantidad: 5, estatus: estado };
}

test("la lista de OTs sale de `work_orders` y excluye las cerradas", async () => {
  const { api, leidos } = puente({
    tablas: {
      work_orders: [
        otCruda("OT-1", "A-100", "EN PROCESO"),
        otCruda("OT-2", "B-200", "CERRADA"),
        otCruda("OT-3", "C-300", "CANCELADA"),
        otCruda("OT-4", "D-400", "abierta"),
      ],
    },
  });

  const result = await api.getInspectionWorkOrders();

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.map((wo) => wo.wo), ["OT-1", "OT-4"]);
  assert.ok(leidos.includes("work_orders"), "la lista no se leyo de work_orders");
  assert.equal(result.data[0].article, "A-100");
  assert.equal(result.data[0].quantity, 5);
  // El estado VACIO entra: el filtro es por lista de estados CERRADOS, asi que
  // cualquier estado que no este en la lista se considera abierta, que es lo que se
  // decidio al declarar la lista compartida.
  assert.equal(result.data[1].wo, "OT-4");
});

test("los estados cerrados son los mismos de `confirmWorkOrderClosures`", () => {
  // Las dos hacen la MISMA pregunta -si la OT sigue abierta- y si cada una escribiera
  // su propia lista, al confirmar el cierre de una OT el estado podria quedar en uno
  // que la lista sigue mostrando como abierta. Por eso la lista esta en UNA
  // constante.
  assert.match(puenteSource, /const ESTADOS_CERRADOS = \["CERRADA", "CERRADO", "CLOSED", "COMPLETADA", "COMPLETADO", "CANCELADA", "CANCELADO"\]/);
  assert.equal((puenteSource.match(/ESTADOS_CERRADOS\.includes/g) || []).length >= 2, true,
    "ESTADOS_CERRADOS tiene que usarse en los DOS caminos: la lista de inspeccion y confirmWorkOrderClosures");
  assert.equal((puenteSource.match(/const ESTADOS_CERRADOS =/g) || []).length, 1,
    "hay mas de una lista de estados cerrados: se declaran en dos sitios y se van a desincronizar");
});

test("el bundle trae `detail` y `history`, que es lo que los DOS consumidores leen", async () => {
  const { api } = puente({
    tablas: {
      work_orders: [otCruda("OT-1", "A-100")],
      materials: [{ ot: "OT-1", componente: "MP1", descripcion: "Tubo", requerido: 5, emitido: 0, pendiente: 5 }],
      operations: [{ operation_id: "ns-11", ot: "OT-1", secuencia: 1, descripcion: "Corte", estatus: "PENDIENTE" }],
      inspection_routes: [{ clave: "A-100|MP1", articulo: "A-100", material: "MP1", tramo: "650 mm", dibujo: "a.pdf", actualizado: "01/10/2026 09:00:00" }],
      inspection_history: [
        { ot: "OT-1", fecha_hora: "01/10/2026 09:00:00", printed_at: "2026-10-01T15:00:00Z", semaforo: "LISTO" },
        { ot: "OT-1", fecha_hora: "01/10/2026 08:00:00", printed_at: "2026-10-01T14:00:00Z", semaforo: "REVISAR" },
      ],
    },
  });

  const result = await api.getInspectionWorkOrderBundle("OT-1");

  assert.equal(result.ok, true);
  // MEDIDO 2026-10-01: con la forma PLANA anterior, `loadDetail` hacia
  // `state.detail = bundle.detail` -> `undefined` -> `renderDetail` salia en su primer
  // `if (!detail) return` y la hoja se quedaba en blanco. Y `drawingFromBundle`
  // (planning/app.js) devolvia `""` siempre, con lo que el boton de abrir el dibujo de
  // la OT en planeacion NUNCA abria y caia siempre al segundo intento, por rutas.
  assert.ok(result.data.detail, "el bundle no trae `detail`");
  assert.equal(result.data.detail.workOrder.wo, "OT-1");
  assert.equal(result.data.detail.workOrder.article, "A-100");
  assert.equal(result.data.detail.materials.length, 1);
  assert.equal(result.data.detail.materials[0].material, "MP1");
  assert.equal(result.data.detail.operations.length, 1);
  // Y el tramo se empareja del CATALOGO, no de la fila: `A-100|MP1` -> "650 mm".
  assert.equal(result.data.detail.materials[0].route, "650 mm");
  assert.equal(result.data.detail.routesFuente, "supabase");
  // El historial tambien viene, con el TOTAL y la ultima impresion.
  assert.ok(result.data.history, "el bundle no trae `history`");
  assert.equal(result.data.history.ok, true);
  assert.equal(result.data.history.data.count, 2);
  assert.equal(result.data.history.data.history[0].printedAt, "01/10/2026 09:00:00");
});

test("una OT que no esta en work_orders se dice, no se devuelve un detalle vacio", async () => {
  const { api } = puente({ tablas: { work_orders: [otCruda("OT-1", "A-100")] } });
  const result = await api.getInspectionWorkOrderBundle("OT-9");
  assert.equal(result.ok, false);
  assert.match(result.error, /OT-9/);
});

test("si `inspection_history` no existe, el historial del bundle lo DICE", async () => {
  const { api } = puente({
    tablas: { work_orders: [otCruda("OT-1", "A-100")] },
    errores: { inspection_history: "Could not find the table 'public.inspection_history' in the schema cache" },
  });

  const result = await api.getInspectionWorkOrderBundle("OT-1");

  // El DETALLE sale igual: una tabla que falta no puede tumbar la hoja entera.
  assert.equal(result.ok, true);
  assert.ok(result.data.detail);
  assert.equal(result.data.detail.workOrder.wo, "OT-1");
  // Pero el historial NO es `{ok:true, history:[]}`: MEDIDO 2026-10-01, sin sesion la
  // Data API responde HTTP 200 con CERO filas, o sea que "no pude leer" y "nadie ha
  // impreso nunca" se ven IGUALES si no se distinguen. Un historial que se ve vacio sin
  // explicacion es peor que uno que no esta.
  assert.equal(result.data.history.ok, false);
  assert.match(result.data.history.error, /schema-inspection-history\.sql/, "el error tiene que decir que aplicar: un schema cache no lo dice");
});

test("si `inspection_routes` no existe, el detalle sale SIN TRAMOS y lo dice", async () => {
  const { api } = puente({
    tablas: { work_orders: [otCruda("OT-1", "A-100")] },
    errores: { inspection_routes: "Could not find the table 'public.inspection_routes' in the schema cache" },
  });

  const result = await api.getInspectionWorkOrderBundle("OT-1");

  assert.equal(result.ok, true);
  assert.ok(result.data.detail, "una tabla que falta tumbaba el detalle entero");
  // Sin tabla, lo unico honesto es el catalogo vacio Y DECIRLO. El plan B a la hoja NO
  // se puede copiar aca: la hoja se leia por Apps Script y el puente esta deshabilitado
  // (RULE-SUP-029), asi que el plan B de la pagina es cargar el catalogo a mano.
  assert.equal(result.data.detail.routesFuente, "ninguna");
  assert.match(result.data.detail.routesAviso, /schema-inspection-routes\.sql/);
  assert.match(result.data.detail.routesAviso, /PP_migrarTramosASupabase_/, "el aviso tiene que decir cual es el plan B: correr el importador una vez");
});

test("getInspectionHistory re-lee SOLO el historial, sin armar el bundle", async () => {
  const { api, leidos } = puente({
    tablas: {
      work_orders: [otCruda("OT-1", "A-100")],
      materials: [{ ot: "OT-1", componente: "MP1", requerido: 5, pendiente: 5 }],
      operations: [{ operation_id: "ns-11", ot: "OT-1", secuencia: 1, descripcion: "Corte" }],
      inspection_history: [{ ot: "OT-1", fecha_hora: "01/10/2026 09:00:00", semaforo: "LISTO" }],
    },
  });

  const result = await api.getInspectionHistory("OT-1");

  assert.equal(result.ok, true);
  assert.equal(result.data.count, 1);
  assert.equal(result.data.history[0].printedAt, "01/10/2026 09:00:00");
  // MEDIDO 2026-10-01: la razon de que exista esta funcion es que despues de imprimir
  // la tarjeta de al lado seguia diciendo la impresion ANTERIOR, con el bundle entero en
  // `bundleCache` (5 minutos). Releer el historial son DOS lecturas a UNA tabla;
  // releer el bundle son SEIS tablas (`work_orders`, `materials`, `operations`,
  // `inventory`, `inspection_routes`, `inspection_history`) y despues de imprimir solo
  // cambio UNA.
  assert.deepEqual(leidos, ["inspection_history", "inspection_history"], "armo el bundle entero para leer una tabla");
});

test("recordInspectionPrint devuelve `ok` y el dato guardado, no una excepcion", async () => {
  const { api, guardados } = puente({
    guardar: async (cuerpo) => ({ ok: true, fila: { ot: cuerpo.wo, fecha_hora: "01/10/2026 09:15:00" } }),
  });

  const result = await api.recordInspectionPrint(IMPRESION);

  // MEDIDO 2026-10-01: `printInspection` decide con un
  // `if (!result?.ok && !root.confirm(...))`. Una excepcion obligaria a un try/catch
  // alrededor de la impresion, que es justo el camino que no debe romperse por un
  // historial.
  assert.equal(result.ok, true);
  assert.equal(result.data.wo, "OT-1234");
  assert.equal(result.data.recordedAt, "01/10/2026 09:15:00");
  assert.equal(guardados.length, 1);
  // El payload NO se traduce en esta capa: se pasa tal cual al escritor, que es quien
  // decide de que columna sale cada valor.
  assert.equal(guardados[0].wo, "OT-1234");
});

test("si el escritor falla, se devuelve el motivo, no una excepcion", async () => {
  const { api } = puente({
    guardar: async () => ({ ok: false, motivo: "no hay sesion de Supabase", avisos: [] }),
  });

  const result = await api.recordInspectionPrint(IMPRESION);

  assert.equal(result.ok, false);
  assert.match(result.error, /sesion/);
});

test("sin el escritor de `inspection_history` se dice QUE FALTA, no \"Backend no disponible\"", () => {
  // `getWriter()` exige `writer.guardarPlan`, que el escritor no exporta (exporta
  // `guardar`), asi que este camino no se puede ejercitar con el escritor real. Se
  // afirma sobre el mensaje, que es lo que evita tener que buscar sin saber que buscar.
  assert.match(puenteSource, /guardarInspectionPrint no existe/);
  assert.match(puenteSource, /inspeccion|inspection_history/);
});

// =============================================================================
// EL CONTRATO CON EL SERVIDOR, QUE ES EL QUE NO SE NEGOCIA
// =============================================================================

test("las cuatro funciones del bundle tienen los mismos NOMBRES que en Apps Script", () => {
  // El reemplazo del puente existe para que la pagina no sepa donde esta el dato. Si
  // una funcion cambia de nombre, el consumidor falla en silencio (undefined) y el
  // fallo sale como "la hoja esta vacia".
  for (const nombre of ["getInspectionWorkOrderBundle", "getInspectionWorkOrders", "getInspectionHistory", "recordInspectionPrint"]) {
    assert.match(drawingServiceSource + serviceSource, new RegExp(`function ${nombre}\\b`), `Apps Script tenia ${nombre} y el reemplazo no`);
    assert.match(puenteSource, new RegExp(`(async )?function ${nombre}\\b`), `el reemplazo del puente no define ${nombre}`);
  }
});

test("el bundle de Apps Script es `{ detail, history }` y el detalle trae las TRES piezas", () => {
  // El reemplazo del puente devuelve una forma; si no coincide con la que el servidor
  // tiene, el fallo sale como "la hoja esta vacia" y nadie busca el porque.
  //
  // `getInspectionWorkOrderBundle` de 17 (la que gana) es un ENVOLTORIO: llama a
  // `getInspectionWorkOrder` (el detalle) y a `getInspectionHistory` (el historial) y
  // los junta. Por eso la forma se mira en las dos: `detail`/`history` en el envoltorio,
  // y `workOrder`/`materials`/`operations` en quien arma el detalle.
  const envoltorio = cuerpoDe(drawingServiceSource, "function getInspectionWorkOrderBundle");
  assert.match(envoltorio, /bundle\s*=\s*\{\s*detail:\s*detail\.data,\s*history:\s*history\.data\s*\}/,
    "el bundle de Apps Script es `{ detail, history }`: con otra forma, `loadDetail` haria `state.detail = bundle.detail` -> undefined");

  // OJO CON EL PARENTESIS EN LA FIRMA. `indexOf("function getInspectionWorkOrder")`
  // encuentra `getInspectionWorkOrderBundle` primero, porque ese nombre empieza igual y
  // esta ANTECEDIDO en el archivo. Con el `(` ya no hay confusion. No es un detalle
  // cosmetico: sin el parentesis este test miraba el envoltorio, que no trae
  // `workOrder`, y fallaba por un motivo que no era el que decia.
  const detalle = cuerpoDe(drawingServiceSource, "function getInspectionWorkOrder(");
  for (const pieza of ["workOrder", "materials", "operations"]) {
    assert.match(detalle, new RegExp(pieza + ":"), "el detalle de inspeccion tiene que traer `" + pieza + "`");
  }
  // Y los avisos de la fuente de los tramos viajan en el detalle, que es del detalle.
  assert.match(detalle, /routesFuente/, "sin `routesFuente` la pagina no puede decir de donde salieron los tramos");
  assert.match(detalle, /routesAviso/, "sin `routesAviso` el aviso se pierde");
});

/** El cuerpo de una funcion de Apps Script: desde su `function` hasta la primera llave
 *  de cierre de nivel 0. */
function cuerpoDe(fuente, firma) {
  const inicio = fuente.indexOf(firma);
  assert.ok(inicio >= 0, "no se encontro " + firma + " en el servidor: este test no puede affirmar sobre una funcion que no encuentra");
  return fuente.slice(inicio, fuente.indexOf("\n}", inicio));
}