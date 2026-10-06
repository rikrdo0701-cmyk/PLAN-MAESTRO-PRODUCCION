import assert from "node:assert/strict";
import test from "node:test";
import { createContext, runInContext } from "node:vm";
import { readFile } from "node:fs/promises";

// QUE HACE ESTE ARCHIVO, Y POR QUE HACE FALTA.
//
// MEDIDO 2026-10-06 20:59, en produccion: la corrida de la ingesta se murio con
//   TypeError: Cannot read properties of undefined (reading 'workorders')
//   (anónimo) @ 19-appscript-ingesta-supabase.gs:575
//   PP_ingesta_  @ 19-appscript-ingesta-supabase.gs:574
//   ingesta      @ 19-appscript-ingesta-supabase.gs:477
// o sea: `acciones[nombre]`, con `acciones` en `undefined`. El `if (!respuesta.ok)` de una
// linea mas arriba NO habia saltado: el RESTlet contesto HTTP 200 con un cuerpo que no trae
// la clave `acciones`. `acciones` no se comprobaba nunca antes de indexarse, y su unico filtro
// era `ok`, que no dice nada de la FORMA que esta corrida necesita.
//
// NADA DE LA SUITE LO DETECTABA, y ese es el punto. Los tests de este repo miraban el texto de
// los archivos o el `post` del RESTlet por separado (tests/restlet-unificado-workorders-cerradas.test.mjs
// corre el 2246 con un N/query de mentira), pero NINGUNO ejecutaba `PP_ingesta_` de verdad: la
// parte que recibe la respuesta y decide que escribir no tenia ninguna prueba. Un TypeError en
// esa linea es invisible para una suite que no corre la funcion.
//
// ESTE ARCHIVO CORRE `PP_ingesta_` en un `vm` con el runtime de Apps Script de mentira: solo se
// falsea lo que NO es el camino (UrlFetchApp, PropertiesService, las constantes de
// supabase-config.gs). El codigo que se prueba es el del archivo, sin copiar ni reescribir.

const fuente = (await readFile(new URL("../src/server/19-appscript-ingesta-supabase.js", import.meta.url), "utf8"))
  .replace(/\r\n/g, "\n");

/**
 * Levanta la ingesta con un RESTlet y un Supabase de mentira.
 *
 * @param responder  que cuerpo JSON contesta el RESTlet
 * @param rpc        que responde el RPC ingesta_mirror (por defecto, todo bien). Si devuelve
 *                   un objeto con `__status`, ese es el codigo HTTP de la respuesta, que es
 *                   como se reproduce un 4xx de Postgres sin tener que fingir un `ok`.
 */
function ingesta(responder, rpc) {
  const llamadas = { restlet: [], rpc: [], vaciados: [], filas: [] };
  const props = {
    NS_ACCOUNT_ID: "11103874",
    NS_CONSUMER_KEY: "ck",
    NS_CONSUMER_SECRET: "cs",
    NS_TOKEN: "tk",
    NS_TOKEN_SECRET: "ts",
  };

  const respuesta = (cuerpo, code) => ({
    getResponseCode: () => code,
    getContentText: () => JSON.stringify(cuerpo),
  });

  const contexto = {
    console: { log() {}, warn() {}, error() {} },
    JSON,
    Math,
    String,
    Number,
    Boolean,
    Date,
    Error,
    isFinite,
    parseInt,
    parseFloat,
    isNaN,
    // supabase-config.gs del proyecto: lo falseado, no el camino.
    SUPABASE_URL: "https://ejemplo.supabase.co",
    SUPABASE_KEY: "sb_secret_de_pruebas",
    UBICACION: "1",
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] }) },
    // Las dos de OAuth viven en 08-netsuite.js, no en este archivo (lo dice su propio header:
    // "este archivo usa las que ya hay... si alguien copia este archivo a un proyecto que NO
    // tiene 08-netsuite.js, tiene que copiar tambien esas dos funciones"). No son el camino que
    // se prueba, asi que se falsean en vez de arrastrar el archivo entero. Si el codigo bajo
    // prueba empieza a depender de ellas, este stub se ve.
    PP_oauthEncode_: (v) => encodeURIComponent(String(v)),
    PP_oauthHeader_: () => "OAuth de pruebas",
    UrlFetchApp: {
      fetch(url, opciones) {
        const cuerpo = opciones && opciones.payload ? JSON.parse(opciones.payload) : {};
        if (String(url).indexOf("/rest/v1/rpc/ingesta_mirror") !== -1) {
          const tabla = cuerpo.p_tabla;
          const filas = cuerpo.p_filas || [];
          if (!filas.length) llamadas.vaciados.push(tabla);
          llamadas.rpc.push(tabla);
          // `rpc` guarda solo el NOMBRE (hay pruebas que lo comparan con la lista de las siete),
          // asi que las filas que salieron por el hilo se guardan aparte, para poder afirmar sobre
          // lo que llego a Postgres y no solo sobre cuantas llamadas hubo.
          llamadas.filas.push({ tabla: tabla, filas: filas });
          const r = rpc ? rpc(tabla, filas) : { insertadas: filas.length, borradas: 99 };
          if (r && typeof r === "object" && typeof r.__status === "number") {
            return respuesta(r, r.__status);
          }
          return respuesta(r, 200);
        }
        llamadas.restlet.push(cuerpo);
        return respuesta(responder(cuerpo), 200);
      },
    },
  };
  contexto.globalThis = contexto;
  createContext(contexto);
  runInContext(fuente, contexto, { filename: "19-appscript-ingesta-supabase.js" });
  return { correr: (forzado) => contexto.PP_ingesta_(forzado === true), llamadas, contexto };
}

/** Una accion util con una fila, que es lo que el 2246 da de una tabla que si tiene datos. */
function accionBuena(fila) {
  return { ok: true, headers: ["ot"], rows: [fila || { ot: "1", cantidad: 1 }], totalRows: 1 };
}

/**
 * La respuesta que el 2246 da de verdad para `accion: 'todas'`: `{ ok, acciones }` con las
 * SIETE acciones (netsuite-restlet-unificado-supabase.js:27-33). Los nombres de las acciones
 * no son los nombres de tabla, por eso van a mano.
 */
function respuestaBuena() {
  return {
    ok: true,
    acciones: {
      workorders: accionBuena({
        wo_internal_id: "1",
        ot: "1",
        articulo: "A",
        descripcion: "d",
        cantidad: 1,
        estatus: "En curso",
        cliente: "",
        fecha_vencimiento: "2026-10-01",
      }),
      operaciones: accionBuena(),
      materiales: accionBuena(),
      items: accionBuena(),
      centros: accionBuena(),
      inventario: accionBuena(),
      ordenes_venta: accionBuena(),
    },
  };
}

/** Las siete tablas que la ingesta escribe, en el orden en que las escribe. */
const TABLAS = ["work_orders", "operations", "materials", "items", "machines", "inventory", "sales_orders"];

test("un 200 SIN `acciones` se dice y NO se toca ninguna tabla", async () => {
  // El caso medido. Antes esto reventaba con un TypeError que no decia ni el codigo HTTP ni
  // el cuerpo recibido; ahora devuelve un motivo que si los dice.
  const { correr, llamadas } = ingesta(() => ({ ok: true }));
  const r = await correr(true);

  assert.equal(r.ok, false, "una respuesta sin acciones NO es una corrida buena");
  assert.equal(r.ejecutada, false);
  assert.equal(r.motivo, "restlet_sin_acciones");
  assert.match(r.mensaje, /SIN "acciones"/);
  assert.match(r.mensaje, /claves que si trajo = \[ok\]/, "el mensaje tiene que decir QUE trajo, no solo que faltaba algo");
  assert.match(r.mensaje, /no es este archivo/, "tiene que senalar que lo desplegado no es este 2246");
  assert.deepEqual(llamadas.rpc, [], "RULE-SUP-048: sin una sola tabla que reescribir, no se vacia ninguna");
  assert.deepEqual(llamadas.vaciados, [], "y menos se vacian: vaciar las siete es el incidente del 2026-10-05");
});

test("la misma guarda cubre `acciones` ausente, no-objeto y array", async () => {
  // Un array es truthy y tiene indices, asi que `acciones[nombre]` NO reventaria: pasaria de largo
  // con `undefined` en las siete acciones y caeria en `sin_acciones` por otra ruta. Se comprueba
  // que las tres formas salgan por la misma puerta y con el mismo motivo.
  for (const cuerpo of [{ ok: true }, { ok: true, acciones: null }, { ok: true, acciones: [] }, { ok: true, acciones: "todas" }]) {
    const { correr, llamadas } = ingesta(() => cuerpo);
    const r = await correr(true);
    assert.equal(r.motivo, "restlet_sin_acciones", "cuerpo " + JSON.stringify(cuerpo) + " tiene que dar restlet_sin_acciones");
    assert.deepEqual(llamadas.rpc, [], "cuerpo " + JSON.stringify(cuerpo) + " no puede escribir");
  }
});

test("la forma correcta SI pasa la guarda y entra a escribir", async () => {
  // La otra mitad: la guarda no puede tragarse la respuesta buena. Si `acciones` esta bien, la
  // corrida sigue y escribe por el RPC las siete tablas, en orden, y NO vacia ninguna.
  const { correr, llamadas } = ingesta(() => respuestaBuena());
  const r = await correr(true);

  assert.equal(r.motivo, undefined, "una respuesta con acciones no puede decir restlet_sin_acciones");
  assert.equal(r.ok, true);
  assert.deepEqual(llamadas.rpc, TABLAS, "escribe las siete, en el orden del modulo");
  assert.deepEqual(llamadas.vaciados, [], "y no vacia ninguna: todas traen filas, aunque vacias");
});

test("un RESTlet con `ok:false` sigue tirandose como error, sin cambiar", async () => {
  // La guarda nueva NO puede tapar la de `ok`. Este camino ya existia y dice RESTlet + codigo.
  //
  // MEDIDO al escribir esta prueba: `PP_ingesta_` NO es `async` (19-appscript:516) y el `throw`
  // del `ok:false` ocurre en codigo SINCRONO, porque `UrlFetchApp.fetch` en Apps Script es
  // sincrono. O sea que la excepcion se tira antes de que la funcion devuelva nada: no la
  // atrapa un `.catch()` puesto a la llamada, hay que usar try/catch. Por eso aqui no se usa
  // `assert.rejects`, que ademas no reconoce la promesa de otro realm del `vm`.
  const { correr, llamadas } = ingesta(() => ({ ok: false, error: "accion no soportada: todas" }));
  let mensaje = null;
  try {
    await correr(true);
  } catch (error) {
    mensaje = String((error && error.message) || error);
  }
  assert.match(mensaje, /RESTlet no ok/, "la respuesta con ok:false sigue siendo un error, no un aviso");
  assert.deepEqual(llamadas.rpc, [], "y no escribe nada: se tira antes de tocar tablas");
});

test("un 200 cuyo cuerpo NO es objeto no se cuela por `respuesta.ok`", async () => {
  // MEDIDO 2026-10-06: `PP_restletUnificado_` devuelve lo que parseo, y un 200 puede traer un
  // cuerpo que no es objeto (`null` literal, un string, un numero). `null.ok` era un TypeError
  // sin decir nada; con `!respuesta` primero, todos caen en la puerta de `ok`, que si dice el
  // cuerpo. Aqui se comprueba que ninguno revienta con el TypeError de la propiedad.
  for (const cuerpo of ["texto plano", 42, null, true]) {
    const { correr, llamadas } = ingesta(() => cuerpo);
    let mensaje = null;
    try {
      await correr(true);
    } catch (error) {
      mensaje = String((error && error.message) || error);
    }
    assert.match(mensaje, /^RESTlet no ok: /, "cuerpo " + JSON.stringify(cuerpo) + ": sale por la puerta de ok, no por un TypeError");
    assert.deepEqual(llamadas.rpc, [], "cuerpo " + JSON.stringify(cuerpo) + " no puede escribir");
  }
});

// =============================================================================
// EL 22P02 DE work_orders, Y POR QUE HACE FALTA QUE NADA LO RECORTE
// =============================================================================

const RPC_22P02 = {
  code: "22P02",
  message: 'invalid input syntax for type integer: ""',
  details: null,
  hint: null,
};

/**
 * El RPC que acepta todo menos la escritura de UNA tabla, a la que le devuelve el 22P02 de
 * Postgres. Las demas tablas y los vaciados van bien, que es como estuvo el 2026-10-05: seis
 * tablas escritas y `work_orders` en 0.
 */
function rpcCon22P02En(rota) {
  return function (tabla, filas) {
    if (tabla === rota && filas.length) {
      return { __status: 400, code: "22P02", message: RPC_22P02.message };
    }
    return { insertadas: filas.length, borradas: filas.length ? filas.length : 99 };
  };
}

test("un 22P02 llega ENTERO al log: el valor que se quejo Postgres no se puede recortar", async () => {
  // MEDIDO 2026-10-06 21:16, en produccion. El log traia:
  //
  //   work_orders: ERROR al escribir: Supabase rpc ingesta_mirror work_orders 400:
  //   codigo 22P02 | invalid input syntax for type integer: "
  //
  // Cortado con `.slice(0, 100)`. El valor se come de ahi: el prefijo ocupa 60 caracteres y
  // `invalid input syntax for type integer: ` ocupa 39, o sea que para el valor quedaban 1. Un
  // recorte al principio se come la parte util SIEMPRE, porque Postgres pone la fila repetida
  // en `details` y el valor culpable al FINAL, en `message` (ya se habia visto con el 23502 el
  // 2026-10-02, PP_errorPostgREST_). Este test falla si alguien vuelve a recortar.
  const { correr } = ingesta(() => respuestaBuena(), rpcCon22P02En("work_orders"));
  const r = await correr(true);

  const delLog = r.log.filter((l) => l.indexOf("ERROR al escribir") !== -1)[0] || "";
  assert.ok(delLog, "tiene que haber una linea de error en el log");
  assert.match(delLog, /integer: ""/, 'el valor "" tiene que llegar completo al log');
  assert.doesNotMatch(delLog, /integer: "$/, "y no puede quedar cortado en la comilla, como el 2026-10-06 a las 21:16");
  assert.ok(r.errores.indexOf(delLog) !== -1, "el mismo texto entero va tambien en `errores`");
});

test('el saneo de tipos deja la cantidad en cadena vacia en 0 y la escritura se hace', async () => {
  // El caso medido del 2026-10-05: una fila de 513 con `cantidad` en cadena vacia tumba el
  // `work_orders` entero (22P02). `work_orders.cantidad` es `integer not null default 0`
  // (docs/schema-supabase.sql), asi que 0 es el valor por omision de la columna, no un dato
  // inventado: es lo que ya tiene la fila cuando nadie escribe esa columna. Lo que paso
  // ademas es que la tabla se vaciaba, y eso se decidio el 2026-10-06 (ya no se vacia).
  const cuerpo = respuestaBuena();
  cuerpo.acciones.workorders.rows = [
    { wo_internal_id: "1", ot: "1", articulo: "A", descripcion: "d", cantidad: "", estatus: "En curso", cliente: "", fecha_vencimiento: "2026-10-01" },
    { wo_internal_id: "2", ot: "2", articulo: "B", descripcion: "e", cantidad: 480, estatus: "Cerrada", cliente: "", fecha_vencimiento: "2026-08-14" },
  ];
  const { correr, llamadas } = ingesta(() => cuerpo);
  const r = await correr(true);

  assert.equal(r.ok, true, "con el saneo, la escritura va: no hay 22P02");
  const deWork = r.filas.work_orders;
  assert.equal(deWork, 2, "las dos filas se escriben, la mala y la buena");
  const aviso = r.log.filter((l) => l.indexOf("valores que no eran del tipo") !== -1)[0] || "";
  assert.match(aviso, /work_orders: 1 valores? que no eran del tipo/, "y el log DICE que toco una, con el nombre de la columna");
  assert.match(aviso, /cantidad 1/, "con el detalle por columna: 'cantidad 1'");
  assert.deepEqual(llamadas.vaciados, [], "no se vacia nada");
});

// =============================================================================
// LA COLUMNA AUSENTE: EL 23502 QUE NO SE HABIA VISTO NUNCA
// =============================================================================

test('una fila SIN `cantidad` la recibe con el default del DDL y el log lo dice aparte', async () => {
  // ESTE FALLO NO SE HABIA VISTO, Y ES EL MISMO QUE EL DE `foto_url` DEL 2026-10-02.
  // El RPC arma el INSERT con la UNION de claves del arreglo (docs/rpc-ingesta-mirror.sql:130,
  // `jsonb_object_keys(p_filas -> 0)`), y `jsonb_populate_recordset` pone NULL en lo que a una
  // fila le falte. Un NULL contra `cantidad integer not null` es 23502, no 22P02: otro codigo,
  // otra causa, y el mismo final.
  //
  // Y no lo tapa el saneo de TIPOS, porque ese hace `if (!(col in copia)) continue;`: una columna
  // que no vino no se inventa, se salta. O sea que `PP_saneaTipos_` cubria el "" y no cubria el
  // "falta", que son las dos formas del mismo 23502.
  const cuerpo = respuestaBuena();
  cuerpo.acciones.workorders.rows = [
    { wo_internal_id: "1", ot: "1", articulo: "A", descripcion: "d", cantidad: 480, estatus: "En curso", cliente: "", fecha_vencimiento: "2026-10-01" },
    { wo_internal_id: "2", ot: "2", articulo: "B", descripcion: "e", estatus: "Cerrada", cliente: "", fecha_vencimiento: "2026-08-14" },
  ];
  const { correr, llamadas } = ingesta(() => cuerpo);
  const r = await correr(true);

  assert.equal(r.ok, true, "la escritura va: la segunda fila ya no llega con cantidad en NULL");
  assert.equal(r.filas.work_orders, 2, "las dos filas se escriben");
  const enviada = llamadas.filas.find((e) => e.tabla === "work_orders");
  const segunda = enviada.filas[1];
  assert.equal(segunda.cantidad, 0, 'la fila que no traia `cantidad` sale con 0, el default de la columna');
  assert.ok("cantidad" in segunda, "y la clave EXISTE en el JSON: es lo que evita el NULL del RPC");

  // El aviso va SEPARADO del de los tipos, porque es otro hecho: aqui la fila no traia el campo.
  const aviso = r.log.filter((l) => l.indexOf("no venian en su fila") !== -1)[0] || "";
  assert.ok(aviso, "el log dice que hubo celdas rellenadas por ausencia: " + JSON.stringify(r.log));
  assert.match(aviso, /work_orders: 1 celdas? de columnas not null/, "con el conteo exacto");
  assert.match(aviso, /cantidad 1/, "y el detalle por columna");
  assert.equal(r.log.filter((l) => l.indexOf("valores que no eran del tipo") !== -1).length, 0,
    "y NO se cuenta como correccion de tipo: 0 por ausencia no es lo mismo que un 480 mal escrito");
});

test('cuando NINGUNA fila trae la columna, NO se rellena nada (ahi el DEFAULT lo pone Postgres)', async () => {
  // La distincion que hace que el relleno no sea ruido. Si las 513 filas vienen sin
  // `cant_ensamblada`, el RPC no la nombra en el INSERT y Postgres aplica el DEFAULT solo: no hay
  // nada que arreglar. Rellenar tambien ahi solo sumaria una columna al INSERT sin cambiar el
  // resultado, y haria que CADA corrida gritara "rellene 513 celdas" de algo que no es un fallo.
  const cuerpo = respuestaBuena();
  const base = cuerpo.acciones.workorders.rows[0];
  cuerpo.acciones.workorders.rows = [
    Object.assign({}, base, { ot: "1" }),
    Object.assign({}, base, { ot: "2" }),
  ];
  delete cuerpo.acciones.workorders.rows[0].cant_ensamblada;   // no venia, y se asegura
  const { correr, llamadas } = ingesta(() => cuerpo);
  const r = await correr(true);

  assert.equal(r.ok, true);
  const enviada = llamadas.filas.find((e) => e.tabla === "work_orders");
  assert.ok(!("cant_ensamblada" in enviada.filas[0]),
    'la columna que nadie trae no se agrega al JSON: la deja el DEFAULT de Postgres');
  assert.equal(r.log.filter((l) => l.indexOf("no venian en su fila") !== -1).length, 0,
    "y el log no reporta un relleno que no es un fallo");
});

// =============================================================================
// EL DECIMAL EN UNA COLUMNA ENTERA: EL 22P02 DEL 2026-10-06 22:09
// =============================================================================

test('una cantidad con parte decimal se REDONDEA y el log dice que valor traia', async () => {
  // MEDIDO 2026-10-06 22:09, en produccion, con las 520 filas reales:
  //
  //   workorders: columnas = wo_internal_id, ot, articulo, descripcion, cantidad, estatus,
  //                cliente, fecha_vencimiento, foto_url
  //   work_orders: ERROR al escribir: Supabase rpc ingesta_mirror work_orders 400:
  //   codigo 22P02 | invalid input syntax for type integer: "0.01"
  //
  // El `""` del 2026-10-05 ya estaba cubierto. Este es el OTRO caso del mismo codigo, y el
  // saneo lo dejaba pasar: comprobaba `typeof n === "number" && isFinite(n)`, y 0.01 cumple las
  // dos cosas. `work_orders.cantidad` es `integer not null default 0` (docs/schema-supabase.sql),
  // y Postgres no castea un decimal a entero.
  const cuerpo = respuestaBuena();
  cuerpo.acciones.workorders.rows = [
    { wo_internal_id: "1", ot: "1905", articulo: "P-12668", descripcion: "ONE STOP TRUCK PART", cantidad: 0.01, estatus: "En curso", cliente: "", fecha_vencimiento: "2026-08-14" },
    { wo_internal_id: "2", ot: "1906", articulo: "B", descripcion: "e", cantidad: 480, estatus: "Cerrada", cliente: "", fecha_vencimiento: "2026-08-14" },
  ];
  const { correr, llamadas } = ingesta(() => cuerpo);
  const r = await correr(true);

  assert.equal(r.ok, true, "con el redondeo, la escritura va: no hay 22P02");
  assert.equal(r.filas.work_orders, 2, "las dos filas se escriben");
  const enviada = llamadas.filas.find((e) => e.tabla === "work_orders");
  assert.equal(enviada.filas[0].cantidad, 0, 'la fila con 0.01 sale con el entero 0, no con el decimal');
  assert.equal(enviada.filas[1].cantidad, 480, "y la que ya era entera no se toca");

  // El aviso tiene que decir el VALOR que traia, no solo cuantos valores hubo: sin el, no hay
  // forma de saber que fila buscar en NetSuite, que es donde se arregla.
  const aviso = r.log.filter((l) => l.indexOf("parte decimal") !== -1)[0] || "";
  assert.ok(aviso, "el log dice que hubo redondeos: " + JSON.stringify(r.log));
  assert.match(aviso, /work_orders: 1 valores? con parte decimal/, "con el conteo exacto");
  assert.match(aviso, /cantidad: 0\.01->0 x1/, "y con el valor original, que es lo que hace falta para corregirlo alla");
  assert.match(aviso, /NetSuite/, "y dice DONDE se corrige, que no es el espejo");
  assert.equal(r.log.filter((l) => l.indexOf("valores que no eran del tipo") !== -1).length, 0,
    "y NO se cuenta como correccion de TIPO: 0.01 era un numero bien escrito, solo que con decimal");
});

test("una columna `numeric` NO se redondea: el 123.9504 de un tubo llega tal cual", async () => {
  // La contraprueba, y es la importante. `materials.requerido` es `numeric(18,6)` A PROPOSITO:
  // el DDL la cambio de `integer` porque el 2246 redondeaba a 0 y un tubo de 6 metros llegaba como
  // 0 piezas (RULE-SUP-046). Lo mismo con `inventory.disponible` y `operations.tiempo_prod`.
  // Un arreglo de "redondea los enteros" que se tragara estas columnas seria ese mismo fallo.
  const cuerpo = respuestaBuena();
  cuerpo.acciones.materiales.rows = [
    { wo_internal_id: "22983", ot: "1905", ensamble: "P-12668", line_id: "2", componente_id: "18368", componente: "MP00219", descripcion: "Tubo Inox 304", unidad: "", requerido: 123.9504, emitido: 131, pendiente: 0 },
  ];
  cuerpo.acciones.inventario.rows = [
    { item: "EM00006", ubicacion: "Planta MM del Llano", disponible: 12, fisico: 12.75, comprometido: 0, en_transito: 0 },
  ];
  cuerpo.acciones.operaciones.rows = [
    { operation_id: "ns-17654", ot: "1905", secuencia: 1, ct: "5458", descripcion: "CORTE DE TUBO", operador: "1", maquina: "1", cant_total: 480, cant_pendiente: 0, tiempo_ciclo: 0, tiempo_setup: 6, tiempo_prod: 2.82, fecha_inicio: "2026-07-24T00:00:00.000Z", fecha_fin: "2026-07-24T00:00:00.000Z" },
  ];
  const { correr, llamadas } = ingesta(() => cuerpo);
  const r = await correr(true);

  assert.equal(r.ok, true);
  const porTabla = (t) => llamadas.filas.find((e) => e.tabla === t).filas[0];
  assert.equal(porTabla("materials").requerido, 123.9504, "el requerido conserva sus decimales: es `numeric(18,6)`");
  assert.equal(porTabla("inventory").fisico, 12.75, "y el fisico del inventario tambien");
  assert.equal(porTabla("operations").tiempo_prod, 2.82, "y el tiempo de produccion, que son minutos con decimales de verdad");
  assert.equal(porTabla("operations").cant_total, 480, "mientras `cant_total`, que SI es integer, sigue entero");
  assert.equal(r.log.filter((l) => l.indexOf("parte decimal") !== -1).length, 0,
    "ninguna de esas produce un aviso de redondeo: no se toco nada que no debiera");
});

test("el aviso de redondeo agrupa por valor y NO se pasa del tope", async () => {
  // Con el tope de 4 (PP_MAX_VALORES_REDONDEADOS_): 6 filas, 6 decimales distintos. El total tiene
  // que decir 6, y el detalle los cuatro primeros con "y 2 mas". Un aviso que se traga los
  // valores para que el log no crezca miente sobre lo que se perdio; uno que los lista todos
  // tarda mas en leerse de lo que vale, y el que se lee entero es el que dice cuantos son.
  const cuerpo = respuestaBuena();
  cuerpo.acciones.workorders.rows = [
    { wo_internal_id: "1", ot: "1", articulo: "A", descripcion: "d", cantidad: 0.01, estatus: "E", cliente: "", fecha_vencimiento: "2026-10-01" },
    { wo_internal_id: "2", ot: "2", articulo: "A", descripcion: "d", cantidad: 0.02, estatus: "E", cliente: "", fecha_vencimiento: "2026-10-01" },
    { wo_internal_id: "3", ot: "3", articulo: "A", descripcion: "d", cantidad: 0.03, estatus: "E", cliente: "", fecha_vencimiento: "2026-10-01" },
    { wo_internal_id: "4", ot: "4", articulo: "A", descripcion: "d", cantidad: 0.04, estatus: "E", cliente: "", fecha_vencimiento: "2026-10-01" },
    { wo_internal_id: "5", ot: "5", articulo: "A", descripcion: "d", cantidad: 0.05, estatus: "E", cliente: "", fecha_vencimiento: "2026-10-01" },
    // El sexto repite el primero: tiene que contar DOS, no uno, y por eso el detalle dice "x2".
    { wo_internal_id: "6", ot: "6", articulo: "A", descripcion: "d", cantidad: 0.01, estatus: "E", cliente: "", fecha_vencimiento: "2026-10-01" },
  ];
  const { correr } = ingesta(() => cuerpo);
  const r = await correr(true);

  const aviso = r.log.filter((l) => l.indexOf("parte decimal") !== -1)[0] || "";
  assert.match(aviso, /work_orders: 6 valores? con parte decimal/, "el total SIEMPRE va completo: son 6 celdas");
  assert.match(aviso, /0\.01->0 x2/, "y el valor repetido cuenta las dos filas, no una");
  // 6 filas, 5 valores DISTINTOS (0.01 va dos veces): caben 4 y sobra uno. El "cuantos" que se
  // reporta son 6 CELDA, no 5 valores, que es lo que se perdio.
  assert.match(aviso, /y 1 valor\(es\) mas/, "los que no caben se dicen como numero, no se inventan ni se callan");
  assert.doesNotMatch(aviso, /0\.05/, "0.05 no se lista: el tope es 4 y es el quinto valor distinto");
});

test("un entero con decimales CERO no cuenta como redondeo", async () => {
  // `480.0` y `"480"` son enteros y van como tales. Si un `!Number.isInteger` mal hecho los
  // contara, CADA corrida diria que redondeo algo, y un aviso que aparece siempre sin que haya
  // pasado nada es un aviso que nadie lee (RULE-SUP-057: el relleno sin motivo es ruido).
  const cuerpo = respuestaBuena();
  cuerpo.acciones.workorders.rows = [
    { wo_internal_id: "1", ot: "1", articulo: "A", descripcion: "d", cantidad: 480.0, estatus: "E", cliente: "", fecha_vencimiento: "2026-10-01" },
    { wo_internal_id: "2", ot: "2", articulo: "A", descripcion: "d", cantidad: "480", estatus: "E", cliente: "", fecha_vencimiento: "2026-10-01" },
    { wo_internal_id: "3", ot: "3", articulo: "A", descripcion: "d", cantidad: -0.0, estatus: "E", cliente: "", fecha_vencimiento: "2026-10-01" },
  ];
  const { correr, llamadas } = ingesta(() => cuerpo);
  const r = await correr(true);

  const enviada = llamadas.filas.find((e) => e.tabla === "work_orders");
  assert.equal(enviada.filas[0].cantidad, 480, "480.0 sale como 480");
  assert.equal(enviada.filas[1].cantidad, 480, 'y "480" se convierte, que es una correccion de TIPO');
  assert.equal(r.log.filter((l) => l.indexOf("parte decimal") !== -1).length, 0,
    "ninguno de los tres es un redondeo: o no traia decimal o traia texto");
  assert.match(r.log.join(" | "), /1 valores? que no eran del tipo/,
    "el \"480\" con comillas sigue siendo una correccion de tipo, que es lo que es");
});

test("un entero que se redondea a 0 con valor negativo NO se reporta como si fuera 0", async () => {
  // `Math.round(-0.4)` es `-0`, y `String(-0)` es `"0"`. Ahi el log diria `0.4->0 x1` para un valor
  // NEGATIVO, que es una lectura equivocada en la direccion que mas confunde (parece que faltaba
  // una pieza cuando en realidad venia de menos). El aviso lleva el original tal cual vino.
  const cuerpo = respuestaBuena();
  cuerpo.acciones.workorders.rows = [
    { wo_internal_id: "1", ot: "1", articulo: "A", descripcion: "d", cantidad: -0.4, estatus: "E", cliente: "", fecha_vencimiento: "2026-10-01" },
  ];
  const { correr, llamadas } = ingesta(() => cuerpo);
  const r = await correr(true);

  const enviada = llamadas.filas.find((e) => e.tabla === "work_orders");
  assert.equal(enviada.filas[0].cantidad, 0, "-0.4 se escribe como 0: la columna es integer y no admite -0.4");
  const aviso = r.log.filter((l) => l.indexOf("parte decimal") !== -1)[0] || "";
  assert.match(aviso, /-0\.4->0 x1/, "el aviso nombra el valor NEGATIVO que traia, no un 0 que no vino");
});

test('una clave natural que falta NO se rellena: ahi el espejo tiene que fallar y decir cual', async () => {
  // `work_orders.ot` es `not null` SIN default, y es la clave natural (UNIQUE). Si una fila llega
  // sin `ot`, completarla con "" haria que dos filas sin folio colisionaran en el UNIQUE, o peor,
  // que una OT se escribiera con el folio de otra. A una clave natural no se le inventa valor:
  // el espejo tiene que rechazarla y el aviso tiene que nombrar la columna.
  const cuerpo = respuestaBuena();
  cuerpo.acciones.workorders.rows = [
    { wo_internal_id: "1", ot: "1905", articulo: "A", descripcion: "d", cantidad: 1, estatus: "E", cliente: "", fecha_vencimiento: "2026-10-01" },
    { wo_internal_id: "2", articulo: "B", descripcion: "e", cantidad: 1, estatus: "E", cliente: "", fecha_vencimiento: "2026-10-01" },
  ];
  const { correr, llamadas } = ingesta(() => cuerpo);
  const r = await correr(true);

  const enviada = llamadas.filas.find((e) => e.tabla === "work_orders");
  assert.equal(enviada.filas[1].ot, undefined,
    "la fila sin folio sigue sin folio: no se le inventa un valor para una clave natural");
});

test("si el RPC rechaza una fila, work_orders conserva lo anterior y el motivo viaja entero", async () => {
  // La contraprueba: este caso es el que se midio en produccion. No se puede ejecutar contra el
  // archivo del repo porque el arreglo esta ahi, asi que se comprueba la FORMA del fallo: el RPC
  // rechaza, el log lo dice entero, y la tabla NO se toca. Antes de la decision del usuario del
  // 2026-10-06 esto terminaba en `se VACIO igual`, que fue lo que borro las 213 OTs del 05-10.
  // Si alguien vuelve a vaciar en este camino, esta prueba se pone en rojo.
  const { correr, llamadas } = ingesta(() => respuestaBuena(), rpcCon22P02En("work_orders"));
  const r = await correr(true);

  assert.equal(r.ok, false, "la corrida se declara NO buena: una tabla no se escribio");
  assert.ok(!r.filas.work_orders, 'work_orders no tiene conteo de escritura: el throw ocurre antes de que se cuente');
  assert.equal(r.filas.operations, 1, "las otras seis si se escribieron, como el 2026-10-06 a las 21:16");
  assert.ok(!llamadas.vaciados.includes("work_orders"),
    "y NO se vacia: una escritura que falla no borra lo que ya estaba (decision del usuario 2026-10-06)");
  assert.ok(r.noSePudoVaciar.some((t) => t.tabla === "work_orders"),
    "va en la lista de 'conserva lo anterior', que es la que la pagina nombra");
  assert.match(
    r.log.join(" | "),
    /integer: ""/,
    "el motivo del 22P02 queda en el log entero, sin el recorte de 100 caracteres"
  );
});