// EL TRAMO DE INSPECCION, y por que se prueba en su propio archivo.
//
// MEDIDO 2026-10-01. La escritura del tramo cambio de sitio:
//
//   ANTES  saveInspectionLink de Apps Script -> hoja `Tramos` del libro
//         INSPECTION_SPREADSHEET_ID. Y la pagina, ademas, escribia el tramo en
//         `materials` (`dibujo: route`), que es tabla DEL ERP.
//   AHORA  PPSupabaseWriter.guardarInspectionRoute -> tabla `inspection_routes`.
//         Un solo escritor, con el JWT de la sesion. Apps Script se niega
//         (tests/inspection-service.test.mjs).
//
// QUE SE COMPRUEBA AQUI Y POR QUE CADA COSA.
//
// 1. SIN TOKEN NO SE ESCRIBE. Igual que el resto del escritor y por el mismo
//    motivo: la clave publicable viaja en el bundle publico de GitHub Pages
//    (RULE-SUP-015). Un tramo es el texto que se lee al imprimir una hoja de
//    inspeccion: escribirlo sin sesion es darlo a cualquiera que abra la URL.
//
// 2. LA COLUMNA `dibujo` SE MANDA O NO SE MANDA, Y ESO LO DECIDE EL QUE LLAMA.
//    Este es el corazon del contrato y merece su explicacion: el dialogo de la pestana
//    de Catalogos edita el TRAMO, y el dialogo de la hoja de inspeccion edita el
//    TRAMO Y EL DIBUJO, porque ahi se selecciona una fila de material concreta.
//    Los dos escriben en la MISMA fila de `inspection_routes`. Si el escritor
//    mandara siempre `dibujo: fila.dibujo || ""`, cada guardado de tramo desde
//    Catalogos BORRARIA el dibujo de esa fila, que es un dato que existe y que
//    alguien mantiene. Y si nunca lo mandara, el otro dialogo no podria cambiar
//    el dibujo. Por eso la regla es la de la hoja que se tenia antes, traducida:
//    si el payload trae la propiedad, se escribe tal cual (una cadena vacia
//    limpia el dibujo); si no la trae, la columna no va en el cuerpo y PostgREST
//    no la toca. Estas dos pruebas fijan las dos mitades.// 3. LA CLAVE LA CALCULA EL ESCRITOR. Es la identidad de la fila y va en el
//    indice unico. Si la mandara el que llama, dos paginas con normalizaciones
//    distintas meterian dos filas por el mismo tramo y el UNIQUE no podria
//    de-duplicarlas, porque estarian en claves distintas. Se prueba con acentos,
//    espacios y minusculas, que es donde dos normalizaciones se separan.
//
// 4. `on_conflict=clave` Y EL AVISO DEL INDICE QUE FALTA. El 400 de PostgREST
//    "there is no unique or exclusion constraint matching the ON CONFLICT
//    specification" es la senal de que el DDL no esta aplicado. Sin el aviso,
//    quien lee tiene que saber de Postgres para saber que hacer.
//
// 5. LO QUE SE DEVUELVE ES LA FILA GUARDADA, no la que se pidio. Si se devolviera
//    la que se pidio y el servidor normalizara algo, la tabla y la base se
//    separan hasta la recarga, y no hay forma de notar cual de las dos manda.
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const fuente = await readFile(new URL("../src/web/shared/supabase-writer.js", import.meta.url), "utf8");

const URL_FALSA = "https://ejemplo.supabase.co";
const CLAVE_FALSA = "sb_publishable_esto-no-es-real";
const JWT_FALSO = "jwt-de-pruebas.eyJzdWIiOiJ1dWlkLWRlLXBydWViYSJ9.firma-que-no-es-real";

function contestando(status, cuerpo) {
  const texto = typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => texto,
    json: async () => JSON.parse(texto),
  };
}

/**
 * Levanta el escritor con un fetch de mentira. `responder` decide que contesta
 * cada peticion y todo lo que sale queda en `llamadas`, para poder afirmar sobre
 * QUE se mando (que columnas, que on_conflict) y no solo sobre el codigo.
 */
function escritor({ token = JWT_FALSO, configurado = true, responder = null } = {}) {
  const llamadas = [];
  const contexto = {
    console,
    AbortController, setTimeout, clearTimeout, Math, Date, JSON, Object, Array,
    Promise, String, Number, Boolean, Error, RegExp, isFinite, parseInt,
    encodeURIComponent, atob,
    PPSupabaseAuth: { token: async () => token, configurado: true },
    PPSupabaseReader: { isConfigured: () => true, config: () => ({ url: URL_FALSA, anonKey: CLAVE_FALSA }) },
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
  vm.createContext(contexto);
  vm.runInContext(fuente, contexto, { filename: "supabase-writer.js" });
  const writer = contexto.PPSupabaseWriter;
  if (configurado) writer.configure({ url: URL_FALSA, anonKey: CLAVE_FALSA });
  return { writer, llamadas };
}

const TRAMO = { articulo: "A-100", material: "MP00086", tramo: "102 MM" };

test("guarda el tramo con la sesion y devuelve la fila guardada", async () => {
  const { writer, llamadas } = escritor({
    responder: (registro) => {
      if (registro.metodo === "POST") {
        return contestando(200, [{ clave: "A-100|MP00086", articulo: "A-100", material: "MP00086", tramo: "102 MM", dibujo: "", actualizado: "01/10/2026 09:00:00" }]);
      }
      return contestando(204, "");
    },
  });

  const informe = await writer.guardarInspectionRoute(TRAMO);

  assert.equal(informe.ok, true);
  assert.equal(informe.fila.tramo, "102 MM");
  assert.equal(llamadas.length, 1);
  const envio = llamadas[0];
  assert.equal(envio.metodo, "POST");
  assert.equal(envio.tabla, "inspection_routes");
  assert.match(envio.url, /on_conflict=clave/);
  assert.equal(envio.headers.Authorization, "Bearer " + JWT_FALSO);
  assert.equal(envio.cuerpo.clave, "A-100|MP00086");
  assert.equal(envio.cuerpo.tramo, "102 MM");
});

test("SIN TOKEN NO SE ESCRIBE NADA, ni un POST de prueba", async () => {
  const { writer, llamadas } = escritor({ token: null });

  const informe = await writer.guardarInspectionRoute(TRAMO);

  assert.equal(informe.ok, false);
  assert.match(informe.motivo, /sesion/);
  assert.equal(llamadas.length, 0);
});

test("sin articulo NO se escribe: sin el no hay clave y no hay fila", async () => {
  const { writer, llamadas } = escritor();

  const informe = await writer.guardarInspectionRoute({ material: "MP00086", tramo: "102 MM" });

  assert.equal(informe.ok, false);
  assert.match(informe.motivo, /articulo/);
  assert.equal(llamadas.length, 0);
});

/**
 * LA MITAD 1 DEL CONTRATO DEL DIBUJO (punto 2 de la cabecera). El dialogo de la
 * pestana de Catalogos solo edita el tramo, y el dibujo de esa fila lo mantiene
 * otra persona. Si `dibujo` viajara vacio, cada guardado de tramo borraria el
 * dibujo sin que nadie lo haya pedido.
 */
test("si el payload NO trae dibujo, la columna no viaja en el cuerpo", async () => {
  const { writer, llamadas } = escritor();

  const informe = await writer.guardarInspectionRoute(TRAMO);

  assert.equal(informe.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(llamadas[0].cuerpo, "dibujo"), false);
});

/**
 * LA MITAD 2. El dialogo de la hoja de inspeccion SI edita el dibujo del material,
 * y ese dibujo vive en la columna `dibujo` de la misma fila. Cuando se manda, se
 * manda tal cual.
 */
test("si el payload trae dibujo, se escribe exactamente lo que trae", async () => {
  const { writer, llamadas } = escritor();

  await writer.guardarInspectionRoute({ ...TRAMO, dibujo: "dibujo-nuevo.pdf" });

  assert.equal(llamadas[0].cuerpo.dibujo, "dibujo-nuevo.pdf");
});

/**
 * Y el caso del medio: mandar la cadena VACIA limpia el dibujo. Si aqui se
 * tratara la cadena vacia como "no informado" y se omitiera la columna, no habria
 * forma de borrar un dibujo equivocado desde la pagina, que es justo el caso para
 * el que el dialogo de la hoja de inspeccion manda el valor.
 */
test("una cadena vacia en dibujo Slimpia el dibujo: no es lo mismo que omitirlo", async () => {
  const { writer, llamadas } = escritor();

  await writer.guardarInspectionRoute({ ...TRAMO, dibujo: "" });

  assert.equal(Object.prototype.hasOwnProperty.call(llamadas[0].cuerpo, "dibujo"), true);
  assert.equal(llamadas[0].cuerpo.dibujo, "");
});

/**
 * LA CLAVE LA CALCULA EL ESCRITOR (punto 3). "a 100" y "A-100" son el mismo
 * articulo para el servidor (PP_normalizeKey_ quita acentos, sube a mayusculas y
 * cambia espacios por "_") y para el lector. Si la clave la mandara la pagina con
 * su propia normalizacion, estas dos serian filas distintas en una tabla con
 * indice unico, que es la forma exacta de duplicar un tramo.
 */
test("la clave la calcula el escritor con la normalizacion del servidor", async () => {
  const { writer, llamadas } = escritor();

  await writer.guardarInspectionRoute({ articulo: "a 100", material: "mp-1", tramo: "600 mm" });

  assert.equal(llamadas[0].cuerpo.clave, "A_100|MP-1");
  // Y el valor que se guarda para MOSTRAR es el que pidio la persona, no el
  // normalizado: la columna `articulo` es lo que ve la persona en la tabla.
  assert.equal(llamadas[0].cuerpo.articulo, "a 100");
});

test("la clave de un dibujo a nivel de OT es el articulo con el material vacio", async () => {
  const { writer, llamadas } = escritor();

  await writer.guardarInspectionRoute({ articulo: "A-100", material: "", tramo: "" });

  assert.equal(llamadas[0].cuerpo.clave, "A-100|");
});

/**
 * PUNTO 4. El 400 de PostgREST cuando la tabla no tiene el indice unico sobre
 * `clave`. La causa es el DDL sin aplicar, que es un cambio de esquema y no de
 * la pagina, y el aviso tiene que decirlo con el nombre del archivo.
 */
test("el 400 de on_conflict sin indice dice que archivo aplicar", async () => {
  const { writer } = escritor({
    responder: () => contestando(400, {
      code: "42P10",
      message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification',
    }),
  });

  const informe = await writer.guardarInspectionRoute(TRAMO);

  assert.equal(informe.ok, false);
  assert.match(informe.avisos.join(" "), /schema-inspection-routes\.sql/);
});

test("un 401 no se reintenta: sin sesion no hay nada que esperar", async () => {
  let intentos = 0;
  const { writer } = escritor({ responder: () => { intentos += 1; return contestando(401, { message: "invalid JWT" }); } });

  const informe = await writer.guardarInspectionRoute(TRAMO);

  assert.equal(informe.ok, false);
  assert.equal(intentos, 1);
});

test("el informe de un tramo NO lleva el token de la sesion", async () => {
  const { writer } = escritor({
    responder: () => contestando(400, { message: "boom " + JWT_FALSO + " " + CLAVE_FALSA }),
  });

  const informe = await writer.guardarInspectionRoute(TRAMO);

  assert.equal(informe.ok, false);
  assert.equal(JSON.stringify(informe).indexOf(JWT_FALSO), -1);
  assert.equal(JSON.stringify(informe).indexOf(CLAVE_FALSA), -1);
});
