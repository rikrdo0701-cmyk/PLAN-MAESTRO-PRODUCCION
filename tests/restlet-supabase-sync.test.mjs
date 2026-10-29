import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const RUTA = "../netsuite-restlet-supabase-sync.js";
const SUITELET = "../netsuite-suitelet-sync-tarea.js";

/**
 * Harness de los scripts de la ingesta NetSuite -> Supabase. Se captura la factoria AMD y
 * se le inyectan N/query, N/https, N/runtime, N/log y N/record falsos, para poder comprobar QUE SE
 * ESCRIBE en Supabase (URL, metodo, cabeceras, Prefer, cuerpo) sin tocar la red.
 */
async function cargar({ parametros = {}, filas = {}, http = null, supabase = null, record = null } = {}) {
  const source = await readFile(new URL(RUTA, import.meta.url), "utf8");
  const calls = { suiteql: [], http: [], record: [] };
  const respuestas = supabase || {};

  const query = {
    runSuiteQL(payload) {
      calls.suiteql.push({ sql: String(payload.query || ""), params: payload.params || [] });
      const etiqueta = etiquetaDeSql(String(payload.query || ""));
      const delUsuario = filas[etiqueta];
      const devolver = typeof delUsuario === "function" ? delUsuario(payload) : delUsuario || [];
      return { asMappedResults: () => devolver };
    }
  };

  const https = {
    request(req) {
      calls.http.push(req);
      if (http) return http(req, calls.http.length);
      const r = respuestas[req.url.split("?")[0].split("/rest/v1/")[1]] || null;
      if (r) return r;
      // Por omision, todo responde bien y no hay filas previas.
      if (req.method === "GET") return { code: 200, body: "[]" };
      return { code: 200, body: "[]" };
    }
  };

  const runtime = { getParameter: ({ name }) => parametros[name] };
  const log = { info() {}, error() {} };
  // N/record: de aqui sale la cantidad ensamblada (medido: en SuiteQL no existe). Por omision
  // se comporta como una OT liberada sin avance (built 0, quantityremaining 0), para que la
  // cadena de respaldos siga hacia SuiteQL y ese camino siga probado.
  const nrecord = record || fakeRecord(calls, {});

  let factory = null;
  const define = (_deps, callback) => { factory = callback; };
  // eslint-disable-next-line no-new-func
  new Function("define", source)(define);
  assert.equal(typeof factory, "function", "el restlet no llamo define()");
  const exportado = factory(query, https, runtime, log, nrecord);
  assert.equal(typeof exportado.post, "function", "el restlet no exporta post()");
  return { post: exportado.post, calls };
}

/** N/record falso. `valores` mapea nombre de campo a valor; `falla` simula que la OT no carga. */
function fakeRecord(calls, valores, falla) {
  return {
    Type: { WORK_ORDER: "workorder" },
    load(req) {
      calls.record.push(req);
      if (falla) throw new Error(falla);
      return {
        getValue(campo) {
          const v = (valores || {})[campo];
          return v == null ? "" : v;
        }
      };
    }
  };
}

/**
 * Reconoce el SQL por su FROM y sus marcas propias, para que cada lector reciba SOLO sus
 * filas. El orden importa: las consultas se traslapan (materiales y workorders son los dos
 * sobre `transaction` con `mainline`; operaciones y centros sharean `manufacturing...`), y
 * con un detector mal puesto el mock le devuelve al lector filas de otro y el mapeo que se
 * prueba no es el mapeo real.
 */
function etiquetaDeSql(sql) {
  if (/SELECT (?:built|quantitybuilt|quantityremaining) AS v FROM transaction/.test(sql)) return "ensamblada";
  if (/MAX\(NVL\(mot\.completedquantity/.test(sql)) return "ensamblada_operacion";
  if (/FROM manufacturingoperationtask/.test(sql)) return "operaciones";
  if (/FROM entitygroup eg/.test(sql)) return "centros";
  if (/FROM aggregateitemlocation/.test(sql)) return "inventario";
  if (/SalesOrd/.test(sql)) return "ordenes_venta";
  if (/FROM transactionline tl/.test(sql)) return "ordenes_venta_lineas";
  if (/comp\.mainline = 'F'/.test(sql)) return "materiales";
  if (/FROM transaction t/.test(sql)) return "workorders";
  if (/FROM item i/.test(sql)) return "items";
  return "otro";
}

/**
 * Las fechas van en `dd/MM/aaaa`, que es lo que DEVUELVE SuiteQL en esta cuenta (medido el
 * 2026-09-28 en las 6 columnas de fecha de los 7 lectores: `transaction.startdate`,
 * `transaction.enddate`, `transaction.trandate`, `mot.startdatetime`, `mot.enddate` e
 * `item.lastmodifieddate`, todas sin hora ni zona). El fixture usaba antes
 * "2026-09-20 08:00:00", un formato que esta cuenta NO devuelve, y por eso la prueba no
 * cubria el fallo real: `new Date("20/09/2026")` es Invalid Date y el texto crudo se iba
 * tal cual a un timestamptz.
 */
const FILAS_BASE = {
  workorders: [{
    wo_internal_id: "4821", ot: "3177", articulo: "D88-6055", descripcion: "Placa",
    cantidad: "40", estatus: "En Proceso", cliente: "ACME", fecha_inicio: "20/09/2026",
    fecha_fin: "30/09/2026"
  }],
  operaciones: [{
    // Fechas y nombres con el formato REAL de la cuenta (medido el 2026-09-28): los centros de
    // trabajo se llaman '10OTD : DOBLEZ DE TUBERIA' y su id interno es 5459, que es el CT.
    id: "991", ot: "3177", secuencia: "10", ct_id: "5459", ct_nombre: "10OTD : DOBLEZ DE TUBERIA",
    titulo: "Doblez", cant_total: "40", cant_realizada: "10", tiempo_setup: "30",
    tasa: "2", restante: "60", estimado: "70", estado: "PROGRESS", operador: "12",
    maquina: "Dobladora 209", fecha_inicio: "21/09/2026", fecha_fin: "21/09/2026"
  }],
  materiales: [{
    wo_internal_id: "4821", ot: "3177", ensamble: "D88-6055", line_id: "7001",
    componente_id: "55", componente: "LAM-01", descripcion: "Lamina", unidad: "EA",
    requerido: "80", emitido: "20"
  }],
  items: [{
    // `tipo` es el ENUM DE TEXTO de NetSuite, medido el 2026-09-28 con `SELECT * FROM item`:
    // la columna se llama `itemtype` (NO `type`) y sus 2522 articulos dan `Assembly` 1591,
    // `InvtPart` 675, `NonInvtPart` 238, `Service` 14, `OthCharge` 3, `Kit` 1. El fixture
    // usaba "1", un id inventado: con num() eso se guardaba en 0 sin avisar.
    codigo: "D88-6055", descripcion: "Placa", descripcion_compra: "Placa lamina",
    nombre_mostrado: "D88-6055 Placa", tipo: "Assembly", clase: "10", es_ensamblaje: "T",
    inactivo: "F", ultima_modificacion: "01/09/2026"
  }],
  centros: [{ nombre: "Dobladora 209", inactivo: "F", tipo: "1" }],
  // El SQL de inventario NO pide `pickeado`: no existe en el agregado y la unica fuente
  // parecida (`transactionline.quantitypicked`) significa otra cosa (RULE-SUP-009).
  inventario: [{ item: "LAM-01", ubicacion: "Almacen 1", disponible: "120", fisico: "140",
    comprometido: "10", en_transito: "0" }],
  ordenes_venta: [{
    sales_order_id: "3301", folio: "SO-900", cliente: "ACME", cliente_id: "77",
    fecha: "15/09/2026", estatus: "Pendiente de Aprobacion", aprobacion: "Aprobada",
    total: "12000", moneda: "1", memo: "pedido de septiembre"
  }],
  ordenes_venta_lineas: [
    { order_id: "3301", item_id: "55", item: "LAM-01", cantidad: "10", precio: "1200", unidad: "EA" }
  ],
  // La cantidad ensamblada NO se puede leer en el mock de FILAS_BASE: `ensamblada` no esta
  // ahi a proposito, para que cada workorder caiga por toda la cadena de respaldos y quede
  // cant_ensamblada = 0. Las pruebas de la cadena usan cargarConEnsamblada().
  ensamblada: []
};

/**
 * La conversion de fechas ya NO depende de la zona del servidor: `dd/MM/aaaa` se desarma a
 * dia/mes/anio y se arma el ISO a mano en UTC. Por eso las expectativas son texto fijo y
 * estas pruebas pasan igual en un runner en UTC que en la cuenta, que esta en UTC-6.
 * `dd/MM/aaaa` sin hora se ancla a medianoche UTC (es lo que hacia la version anterior).
 */
const MEDIANOCHE = (ddmmaaaa) => {
  const [d, m, a] = String(ddmmaaaa).split("/");
  return `${a}-${m}-${d}T00:00:00.000Z`;
};

// ---------------------------------------------------------------- contrato y seguridad

test("sin los script parameters de Supabase NO escribe, NO llama y lo dice una vez", async () => {
  const { post, calls } = await cargar({ parametros: {}, filas: FILAS_BASE });
  const r = post({ accion: "workorders", folios: ["3177"] });
  assert.equal(r.ok, false, "sin credenciales la ingesta NO se hizo: eso es un fallo, no un ok vacio");
  assert.equal(r.escritas, 0);
  assert.equal(r.credencialesFaltantes, true);
  assert.equal(calls.http.length, 0, "no debe pegarle a Supabase sin URL ni key");
  const avisosDeCredencial = r.avisos.filter((a) => /SUPABASE_URL y SUPABASE_KEY/.test(a));
  assert.equal(avisosDeCredencial.length, 1, "una vez, no una por fila: si no, parece un choque de revision");
});

test("el diagnostico NUNCA imprime la service_role key", async () => {
  const { post } = await cargar({
    parametros: { SUPABASE_URL: "https://xtgtfjcwxcoxvixholpj.supabase.co", SUPABASE_KEY: "service-role-secreto" },
    filas: FILAS_BASE
  });
  const r = post({ accion: "diagnostico" });
  assert.equal(r.ok, true);
  assert.ok(!JSON.stringify(r).includes("service-role-secreto"), "la key se filtro al diagnostico");
});

// ---------------------------------------------------------------- mapeo de columnas

test("work_orders: mapea folio, articulo, cantidad, estatus, cliente y cant_ensamblada", async () => {
  const { post, calls } = await cargar({
    parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" },
    filas: FILAS_BASE,
    http: (req) => {
      if (req.method === "GET") return { code: 200, body: "[]" };
      return { code: 200, body: "[]" };
    }
  });
  const r = post({ accion: "workorders", folios: ["3177"] });
  assert.equal(r.ok, true);
  const escritura = calls.http.find((c) => c.method === "PATCH" || c.method === "POST");
  assert.ok(escritura, "hubo una escritura");
  const cuerpo = JSON.parse(escritura.body);
  assert.equal(escritura.url.includes("/rest/v1/work_orders"), true);
  const fila = Array.isArray(cuerpo) ? cuerpo[0] : cuerpo;
  assert.equal(fila.ot, "3177");
  assert.equal(fila.articulo, "D88-6055");
  assert.equal(fila.cantidad, 40);
  assert.equal(fila.estatus, "En Proceso");
  assert.equal(fila.cliente, "ACME");
  assert.equal(fila.wo_internal_id, "4821");
});

test("work_orders: cant_ensamblada sale de record:built y cant_pendiente es el resto", async () => {
  const { post } = await cargarConEnsamblada({ record: { built: 10 } });
  const r = post({ accion: "workorders", folios: ["3177"], dryRun: true });
  const fila = r.filasQueSeEscribirian[0];
  assert.equal(fila.cant_ensamblada, 10);
  assert.equal(fila.cant_pendiente, 30, "40 - 10");
  assert.deepEqual(r.origen.notas.ensamblada, { "record:built": 1 }, "dice de donde salio cada fila");
});

test("work_orders: si built es 0, cae a record:quantityremaining en vez de inventar 0", async () => {
  const { post } = await cargarConEnsamblada({ record: { built: 0, quantityremaining: 12 } });
  const r = post({ accion: "workorders", folios: ["3177"], dryRun: true });
  const fila = r.filasQueSeEscribirian[0];
  assert.equal(fila.cant_ensamblada, 28, "40 - 12 restante");
  assert.equal(fila.cant_pendiente, 12);
  assert.deepEqual(r.origen.notas.ensamblada, { "record:quantityremaining": 1 });
});

test("work_orders: con el record disponible NO se consulta transaction.built en SuiteQL", async () => {
  // `SELECT built FROM transaction` responde "Unknown identifier" (400) en esta cuenta
  // (medido el 2026-09-28): esa consulta no es un respaldo, es ruido que tumba la fila.
  const { post, calls } = await cargarConEnsamblada({ record: { built: 7 } });
  post({ accion: "workorders", folios: ["3177"], dryRun: true });
  const deEnsamblada = calls.suiteql.filter((c) => /SELECT (built|quantitybuilt|quantityremaining) AS v FROM transaction/.test(c.sql));
  assert.equal(deEnsamblada.length, 0, "con el record answered no se van a preguntar esas columnas");
  assert.equal(calls.record.length, 1, "una sola carga del record por OT");
  assert.equal(calls.record[0].type, "workorder");
});

test("work_orders: si el record no carga, el ultimo respaldo es MAX(mot) acotado a cantidad", async () => {
  // MAX(mot.completedquantity) puede exceder la cantidad de la OT (folio 2204: cantidad 3000,
  // MAX 4200) porque operacion y OT no se miden en la misma unidad: se acota y se declara.
  const { post } = await cargarConEnsamblada({ recordFalla: "no se pudo cargar", porOperacion: 4200 });
  const r = post({ accion: "workorders", folios: ["3177"], dryRun: true });
  const fila = r.filasQueSeEscribirian[0];
  assert.equal(fila.cant_ensamblada, 40, "acotado a la cantidad de la OT");
  assert.equal(fila.cant_pendiente, 0);
  assert.deepEqual(r.origen.notas.ensamblada, { "manufacturingoperationtask.completedquantity": 1 });
  assert.ok(r.avisos.some((a) => /No se pudo leer la cantidad ensamblada/.test(a)) === false,
    "una estrategia que respondio no es un fallo: no debe avisar");
});

test("work_orders: si NADIE responde, se empuja 0 y se avisa (no se disimula)", async () => {
  const { post } = await cargarConEnsamblada({ recordFalla: "no se pudo cargar" });
  const r = post({ accion: "workorders", folios: ["3177"], dryRun: true });
  assert.equal(r.filasQueSeEscribirian[0].cant_ensamblada, 0);
  assert.ok(r.avisos.some((a) => /No se pudo leer la cantidad ensamblada/.test(a)),
    "un 0 sin aviso es indistinguible de una OT sin avance");
  assert.ok(r.avisos.some((a) => /record\.load=error/.test(a)), "el aviso dice que fallo el record");
});

test("operations: operation_id es ns-<mot.id> y el CT es el id interno del centro", async () => {
  // El CT del app NO es un numero sacado del nombre: es `workcenter` del 2240, que es
  // `mot.manufacturingworkcenter` crudo (PP_mapNetSuiteOperation_, 08-netsuite.js:1041). Medido
  // el 2026-09-28 en la cuenta: 158 de los 159 centros NO tienen 3+ digitos en el nombre, y el
  // id 5459 es '10OTD : DOBLEZ DE TUBERIA', que el app trata como CT de doblado (1061).
  const { post, calls } = await cargar({
    parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" },
    filas: FILAS_BASE
  });
  post({ accion: "operaciones", workorderIds: ["4821"] });
  const escritura = calls.http.find((c) => c.method === "PATCH" || c.method === "POST");
  const cuerpo = JSON.parse(escritura.body);
  const fila = Array.isArray(cuerpo) ? cuerpo[0] : cuerpo;
  assert.equal(fila.operation_id, "ns-991");
  assert.equal(fila.ct, "5459", "el CT es el id interno del centro, no un numero del nombre");
  assert.equal(fila.descripcion, "10OTD : DOBLEZ DE TUBERIA", "la descripcion es el nombre del centro");
  assert.equal(fila.estatus, "En proceso", "PROGRESS es el valor real de la cuenta y se traduce");
  assert.equal(fila.cant_total, 40);
  assert.equal(fila.cant_pendiente, 30, "inputquantity - completedquantity");
  assert.equal(fila.tiempo_prod, 60, "runrate(2) x pendiente(30)");
  assert.equal(fila.tiempo_ciclo, 2, "tiempo_prod / pendiente");
  assert.equal(fila.tiempo_setup, 30);
});

test("operations: COMPLETE (el 98.6% de las tareas de la cuenta) NO se escribe crudo", async () => {
  // Medido el 2026-09-28 con `GROUP BY mot.status` sobre las 30864 tareas de la cuenta:
  // COMPLETE 28663, NOTSTART 2148, PROGRESS 53. NO existen INPROCESS, COMPLETED ni CLOSED, que
  // eran justo las tres llaves de la tabla de traduccion: por eso el 98.6% de las operaciones
  // se escribia con 'COMPLETE' mezclado con el espanol de las otras.
  const base = JSON.parse(JSON.stringify(FILAS_BASE));
  base.operaciones[0].estado = "COMPLETE";
  const { post, calls } = await cargar({
    parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" },
    filas: base
  });
  post({ accion: "operaciones", workorderIds: ["4821"] });
  const escritura = calls.http.find((c) => c.method === "PATCH" || c.method === "POST");
  const cuerpo = JSON.parse(escritura.body);
  const fila = Array.isArray(cuerpo) ? cuerpo[0] : cuerpo;
  assert.equal(fila.estatus, "Completado");
  for (const [crudo, esperado] of [["NOTSTART", "No iniciado"], ["PROGRESS", "En proceso"], ["COMPLETE", "Completado"], ["CLOSED", "Cerrado"]]) {
    base.operaciones[0].estado = crudo;
    const r = await cargar({ parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" }, filas: base });
    r.post({ accion: "operaciones", workorderIds: ["4821"] });
    const w = r.calls.http.find((c) => c.method === "PATCH" || c.method === "POST");
    const c = JSON.parse(w.body);
    const f = Array.isArray(c) ? c[0] : c;
    assert.equal(f.estatus, esperado, crudo + " debe escribirse como '" + esperado + "'");
  }
});

test("operations: el nombre del centro sale de BUILTIN.DF(mot.manufacturingworkcenter)", async () => {
  // MEDIDO el 2026-09-28 contra el ERP de produccion, y corrige una regla que se dio por buena el
  // 2026-09-26: `BUILTIN.DF(mot.manufacturingworkcenter)` SI funciona (devuelve
  // '10OTD : DOBLEZ DE TUBERIA'), y es lo que usa el 2240 y el 2244, los dos que hoy funcionan.
  // Lo que NO se puede envolver es un campo ESTATICO, y `mot.status` lo es: da 400 con
  // 'Cannot build builtin function / Static field is not supported for Builtin.DF function'.
  // Y la tabla `manufacturingworkcenter` NO EXISTE en el SuiteQL de esta cuenta ('Tipo de busqueda
  // no valida: manufacturingworkcenter'): los centros de trabajo son `entitygroup`, que es donde
  // el FROM del JOIN anterior tymaba y hacia fallar la accion entera.
  const { post, calls } = await cargar({
    parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" },
    filas: FILAS_BASE
  });
  post({ accion: "operaciones", workorderIds: ["4821"] });
  const sql = calls.suiteql[0].sql;
  assert.ok(!/BUILTIN\.DF\(\s*mot\.status/.test(sql), "BUILTIN.DF(mot.status) rompe toda la consulta: es estatico");
  assert.match(sql, /mot\.status\s+AS estado/, "se pide crudo a proposito");
  assert.match(sql, /BUILTIN\.DF\(mot\.manufacturingworkcenter\)\s+AS ct_nombre/,
    "el nombre tiene que salir de ahi: es lo unico que respondio en la medicion");
  assert.doesNotMatch(sql, /JOIN\s+manufacturingworkcenter\b/i,
    "esa tabla no existe en esta cuenta: el FROM/JOIN mataba la consulta con 400");
  assert.match(sql, /mot\.manufacturingworkcenter\s+AS ct_id/, "el id crudo sigue ahi porque es el CT");
});

test("ningun SQL lleva un '//' dentro del texto: SuiteQL no lo parsea", async () => {
  // MEDIDO el 2026-09-28: el SQL de operaciones traia `mot.status AS estado,   // CRUDO a
  // proposito` con el comentario DENTRO del texto, y SuiteQL responde 400 "Failed to parse SQL".
  // El comentario va en el codigo, no en la cadena del SQL.
  const { post, calls } = await cargar({
    parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" },
    filas: FILAS_BASE
  });
  for (const accion of ["workorders", "operaciones", "materiales", "items", "centros", "inventario", "ordenes_venta"]) {
    post({ accion });
  }
  for (const c of calls.suiteql) {
    assert.doesNotMatch(c.sql, /\/\//, "SuiteQL no acepta '//' como comentario: 400 Failed to parse SQL");
  }
});

test("ningun SQL lleva clausulas de paginacion: la recorte es en memoria, con tope", async () => {
  // MEDIDO el 2026-09-28 en esta cuenta: `ORDER BY ... OFFSET n ROWS FETCH NEXT m ROWS ONLY`
  // SI se acepta (OFFSET sin ORDER BY se ignora, y `FETCH NEXT ... OFFSET ...` en ese orden
  // da 400 "Failed to parse SQL", que fue lo que tumbo al 2244 el 2026-09-26: ver
  // RULE-REP-016-A). Aqui NO se usa ninguna de las dos formas: la paginacion es recorte en
  // memoria con tope de filas por tabla, que es lo que ya se sabe que corre. Este guard
  // existe para que nadie reintroduzca `FETCH NEXT ... OFFSET ...` creyendo que no funciona
  // ninguna forma: funciona una, y esa no se usa a proposito.
  const { post, calls } = await cargar({
    parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" },
    filas: FILAS_BASE
  });
  post({ accion: "operaciones" });
  for (const c of calls.suiteql) {
    assert.doesNotMatch(c.sql, /FETCH NEXT/i);
    assert.doesNotMatch(c.sql, /OFFSET \d+ ROWS/i);
    assert.doesNotMatch(c.sql, /\bLIMIT\b/i, "esta cuenta no tiene LIMIT: da 400");
  }
});

test("ninguna fecha sale del RESTlet en un formato que Postgres no acepte", async () => {
  // SuiteQL devuelve dd/MM/aaaa sin zona. Si el texto crudo se va tal cual a un timestamptz,
  // PostgREST responde 400 y se cae el lote entero; y si se pasa por `new Date()`, con dia
  // <= 12 la fecha se guarda corrida y sin error. Este guard corre las 7 acciones y
  // revisa TODO lo que se escribe.
  const acciones = [
    { accion: "workorders", payload: { accion: "workorders", folios: ["3177"] } },
    { accion: "operaciones", payload: { accion: "operaciones", workorderIds: ["4821"] } },
    { accion: "materiales", payload: { accion: "materiales", workorderIds: ["4821"] } },
    { accion: "items", payload: { accion: "items", itemIds: ["D88-6055"] } },
    { accion: "centros", payload: { accion: "centros" } },
    { accion: "inventario", payload: { accion: "inventario" } },
    { accion: "ordenes_venta", payload: { accion: "ordenes_venta", salesOrderIds: ["3301"] } }
  ];
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  for (const caso of acciones) {
    const { post, calls } = await cargar({
      parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" },
      filas: FILAS_BASE
    });
    post(caso.payload);
    const escritura = calls.http.find((c) => c.method === "PATCH" || c.method === "POST");
    assert.ok(escritura, caso.accion + ": no hubo escritura que revisar");
    const cuerpo = JSON.parse(escritura.body);
    const filas = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
    for (const fila of filas) {
      for (const [columna, valor] of Object.entries(fila)) {
        if (valor == null) continue;
        if (typeof valor !== "string") continue;
        // Cualquier valor con forma de fecha tiene que ser ISO completo.
        if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(valor)) {
          assert.fail(caso.accion + "." + columna + ": se escribio texto de fecha crudo: " + valor);
        }
        if (/\d{4}-\d{2}-\d{2}/.test(valor)) {
          assert.ok(ISO.test(valor), caso.accion + "." + columna + ": ISO incompleto: " + valor);
        }
      }
    }
  }
});

test("una fecha dd/MM con dia <= 12 NO se lee como mes/dia (la cuenta es dd/MM/aaaa)", async () => {
  // Con el parser viejo, "03/04/2026" (3 de abril) se guardaba como 4 de marzo: un error
  // invisible. Aqui se comprueba el caso que mas dano hace, porque pasa sin avisar.
  const { post, calls } = await cargar({
    parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" },
    filas: { ...FILAS_BASE, workorders: [{ ...FILAS_BASE.workorders[0], fecha_inicio: "03/04/2026", fecha_fin: "09/02/2026" }] }
  });
  post({ accion: "workorders", folios: ["3177"] });
  const escritura = calls.http.find((c) => c.method === "PATCH" || c.method === "POST");
  const cuerpo = JSON.parse(escritura.body);
  const fila = Array.isArray(cuerpo) ? cuerpo[0] : cuerpo;
  assert.equal(fila.fecha_inicio_ns, "2026-04-03T00:00:00.000Z", "3 de abril, no 4 de marzo");
  assert.equal(fila.fecha_fin_ns, "2026-02-09T00:00:00.000Z", "9 de febrero, no 2 de septiembre");
  assert.equal(fila.fecha_vencimiento, "2026-02-09T00:00:00.000Z");
});

test("una fecha que no se puede leer sale marcada, no convertida a una fecha inventada", async () => {
  const { post, calls } = await cargar({
    parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" },
    filas: { ...FILAS_BASE, workorders: [{ ...FILAS_BASE.workorders[0], fecha_inicio: "31/02/2026", fecha_fin: "" }] }
  });
  post({ accion: "workorders", folios: ["3177"] });
  const escritura = calls.http.find((c) => c.method === "PATCH" || c.method === "POST");
  const cuerpo = JSON.parse(escritura.body);
  const fila = Array.isArray(cuerpo) ? cuerpo[0] : cuerpo;
  assert.equal(fila.fecha_inicio_ns, "31/02/2026", "no existe esa fecha: se ve, no se corrige a marzo");
  assert.equal(fila.fecha_fin_ns, null, "vacio es null, no un 1900");
});

test("cada lector solo usa alias que existen en SU FROM/JOIN (un alias inventado no parsea)", async () => {
  // Este es el guard que atrapa el `t.type = 'WorkOrd'` que se coló en el SQL de materiales,
  // cuyo FROM es `FROM transaction wo`: no es un warning, es un 400 que tumba la consulta
  // entera y la accion se va sin escribir nada.
  const casos = [
    { accion: "workorders", payload: { accion: "workorders", folios: ["3177"] } },
    { accion: "operaciones", payload: { accion: "operaciones", workorderIds: ["4821"] } },
    { accion: "materiales", payload: { accion: "materiales", workorderIds: ["4821"] } },
    { accion: "items", payload: { accion: "items", itemIds: ["D88-6055"] } },
    { accion: "centros", payload: { accion: "centros" } },
    { accion: "inventario", payload: { accion: "inventario" } },
    { accion: "ordenes_venta", payload: { accion: "ordenes_venta", salesOrderIds: ["3301"] } }
  ];
  for (const caso of casos) {
    const { post, calls } = await cargar({
      parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" },
      filas: FILAS_BASE
    });
    post(caso.payload);
    assert.ok(calls.suiteql.length, caso.accion + " no corrio ningun SuiteQL");
    for (const c of calls.suiteql) assertAliases(c.sql, caso.accion);
  }
});

/** Aliases declarados por los FROM/JOIN del propio SQL. */
function aliasDe(sql) {
  const set = new Set();
  const re = /\b(?:FROM|JOIN)\s+[A-Za-z_][A-Za-z0-9_]*(?:\s+AS)?\s+([A-Za-z_][A-Za-z0-9_]*)/gi;
  let m = re.exec(sql);
  while (m) { set.add(m[1].toLowerCase()); m = re.exec(sql); }
  return set;
}

function assertAliases(sql, donde) {
  const alias = aliasDe(sql);
  const permitidos = new Set(["builtin"]); // BUILTIN.DF(...) es una funcion, no una tabla
  alias.forEach((a) => permitidos.add(a));
  // Prefijo de columna: "alias.columna". Se ignoran las llamadas de funcion ("BUILTIN.DF(").
  const re = /\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  const usados = new Set();
  let m = re.exec(sql);
  while (m) {
    if (!permitidos.has(m[1].toLowerCase())) usados.add(m[1]);
    m = re.exec(sql);
  }
  const re2 = /\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/g;
  m = re2.exec(sql);
  while (m) {
    if (!permitidos.has(m[1].toLowerCase())) usados.add(m[1]);
    m = re2.exec(sql);
  }
  assert.equal(usados.size, 0,
    donde + ": alias sin tabla en el FROM/JOIN -> " + Array.from(usados).join(", ") + "\n" + sql);
}

test("materials: la identidad de fila es line_id (id de la linea de transaccion)", async () => {
  const { post, calls } = await cargar({
    parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" },
    filas: FILAS_BASE
  });
  post({ accion: "materiales", workorderIds: ["4821"] });
  const escritura = calls.http.find((c) => c.method === "PATCH" || c.method === "POST");
  const cuerpo = JSON.parse(escritura.body);
  const fila = Array.isArray(cuerpo) ? cuerpo[0] : cuerpo;
  assert.equal(fila.line_id, "7001");
  assert.equal(fila.componente, "LAM-01");
  assert.equal(fila.requerido, 80);
  assert.equal(fila.emitido, 20);
  assert.equal(fila.pendiente, 60, "requerido - emitido");
  assert.equal(fila.ensamble, "D88-6055");
});

test("materiales: solo OTs abiertas (mismo patron NOT LIKE que workorders/operaciones)", async () => {
  // Decision del usuario 2026-09-28: "solo me interesan las abiertas". Sin el filtro el barrido
  // leia 28 671 materiales de TODAS las OTs y truncaba a 5 000; midido el mismo dia, solo
  // 2 413 son de OTs abiertas. Las de OTs cerradas las empujaba este lector y ningun otro.
  const { post, calls } = await cargar({
    parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" },
    filas: FILAS_BASE
  });
  post({ accion: "materiales", workorderIds: ["4821"] });
  const sql = calls.suiteql.find((c) => c.sql.includes("comp.mainline = 'F'")).sql;
  assert.match(sql, /wo\.type = 'WorkOrd'/, "sigue siendo WorkOrd");
  assert.match(sql, /UPPER\(BUILTIN\.DF\(wo\.status\)\) NOT LIKE '%CERRAD%'/, "filtra Cerrada");
  assert.match(sql, /UPPER\(BUILTIN\.DF\(wo\.status\)\) NOT LIKE '%CLOSED%'/, "filtra Closed");
  assert.match(sql, /UPPER\(BUILTIN\.DF\(wo\.status\)\) NOT LIKE '%COMPLET%'/, "filtra Completada");
});

test("ordenes_venta: solo ordenes abiertas (ni Cerrada ni Facturada)", async () => {
  // Decision del usuario 2026-09-28: "ordenes de venta tambien las abiertas". Midido el mismo
  // dia: 2 408 SalesOrd, 1 870 no cerradas, 1 24 abiertas (ni Cerrada ni Facturada). Sin el
  // filtro el barrido truncaba a 2 000.
  const { post, calls } = await cargar({
    parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" },
    filas: FILAS_BASE
  });
  post({ accion: "ordenes_venta", salesOrderIds: ["3301"] });
  const sql = calls.suiteql.find((c) => c.sql.includes("FROM transaction t")).sql;
  assert.match(sql, /t\.type = 'SalesOrd'/, "sigue siendo SalesOrd");
  assert.match(sql, /UPPER\(BUILTIN\.DF\(t\.status\)\) NOT LIKE '%CERRAD%'/, "filtra Cerrada");
  assert.match(sql, /UPPER\(BUILTIN\.DF\(t\.status\)\) NOT LIKE '%CLOSED%'/, "filtra Closed");
  assert.match(sql, /UPPER\(BUILTIN\.DF\(t\.status\)\) NOT LIKE '%FACTURAD%'/, "filtra Facturada");
});

test("centros: lee los entitygroup de trabajo, sin filtro de tipo (la maquina se captura en el plan)", async () => {
  // MEDIDO el 2026-09-28: `manufacturingworkcenter` no es tabla (400), `workcentertype` no
  // existe en ninguna parte y el record type `workcenter` de la REST Record API da 404. El
  // usuario decidio que no se necesita `machines.tipo` porque la maquina se captura en el
  // plan: el lector va contra `entitygroup` y guarda solo nombre + activa, sin descartar a
  // nadie por tipo.
  const { post, calls } = await cargar({
    parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" },
    filas: { centros: [{ nombre: "Dobladora 209", inactivo: "F" }, { nombre: "Calidad", inactivo: "T" }] }
  });
  const r = post({ accion: "centros" });
  const sql = calls.suiteql.find((c) => c.sql.includes("FROM entitygroup eg")).sql;
  assert.match(sql, /FROM entitygroup eg/, "los centros son entitygroup, no manufacturingworkcenter");
  assert.doesNotMatch(sql, /\bworkcentertype\b|\bmanufacturingworkcenter\b/, "no hay tipo que leer: esa columna/tabla no existe");
  const escrituras = calls.http.filter((c) => c.method === "PATCH" || c.method === "POST");
  const cuerpos = escrituras.map((c) => JSON.parse(c.body));
  const filas = cuerpos.every(Array.isArray) ? cuerpos.flat() : cuerpos;
  assert.equal(filas.length, 2, "no se descarta por tipo: todos los centros de trabajo se guardan");
  assert.equal(filas[0].nombre, "Dobladora 209");
  assert.equal(filas[0].activa, true);
  assert.equal(filas[1].nombre, "Calidad");
  assert.equal(filas[1].activa, false);
  assert.equal(filas[0].tipo, undefined, "machines.tipo no existe: la maquina se captura en el plan");
});

test("inventario: una fila por (item, ubicacion) con las medidas y pickeado SIN FUENTE en 0", async () => {
  const { post, calls } = await cargar({
    parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" },
    filas: FILAS_BASE
  });
  const r = post({ accion: "inventario" });
  const escritura = calls.http.find((c) => c.method === "PATCH" || c.method === "POST");
  const cuerpo = JSON.parse(escritura.body);
  const fila = Array.isArray(cuerpo) ? cuerpo[0] : cuerpo;
  assert.equal(fila.item, "LAM-01");
  assert.equal(fila.ubicacion, "Almacen 1");
  assert.equal(fila.disponible, 120);
  assert.equal(fila.fisico, 140);
  assert.equal(fila.comprometido, 10);
  assert.equal(fila.en_transito, 0);
  // pickeado NO tiene fuente en esta cuenta: se guarda en 0 y se DECLARA en el aviso. El
  // fixture trae 5 a proposito, para que la prueba falle si alguien vuelve a leerlo del SQL.
  assert.equal(fila.pickeado, 0, "pickeado no se deduce de ninguna columna");
  assert.ok(r.avisos.some((a) => /pickeado se guarda en 0/.test(a)), "avisa de que pickeado no tiene fuente");
});

test("inventario: dos renglones del mismo par se suman y se avisa (no rompen el unique)", async () => {
  const { post, calls } = await cargar({
    parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" },
    filas: { ...FILAS_BASE, inventario: [
      { item: "LAM-01", ubicacion: "Almacen 1", disponible: "120", fisico: "140", comprometido: "10", en_transito: "0" },
      { item: "LAM-01", ubicacion: "Almacen 1", disponible: "5", fisico: "6", comprometido: "1", en_transito: "2" }
    ] }
  });
  const r = post({ accion: "inventario" });
  const escritura = calls.http.find((c) => c.method === "PATCH" || c.method === "POST");
  const cuerpo = JSON.parse(escritura.body);
  const filas = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
  assert.equal(filas.length, 1, "un renglon por par (articulo, ubicacion)");
  assert.equal(filas[0].disponible, 125);
  assert.equal(filas[0].fisico, 146);
  assert.equal(filas[0].en_transito, 2);
  assert.ok(r.avisos.some((a) => /repetidos por \(articulo, ubicacion\)/.test(a)), "avisa del repetido");
});

test("items: tipo es el enum de texto de NetSuite y es_ensamblaje sale de itemtype", async () => {
  const { post, calls } = await cargar({
    parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" },
    filas: { ...FILAS_BASE, items: [
      // Decidido por el usuario el 2026-09-28: SOLO `Assembly` es ensamble padre. Un `Kit`
      // es un ensamble de articulo, no un padre, asi que NO cuenta.
      { codigo: "D88-6055", descripcion: "Placa", descripcion_compra: "", nombre_mostrado: "",
        tipo: "Assembly", clase: "10", es_ensamblaje: "T", inactivo: "F", ultima_modificacion: "01/09/2026" },
      { codigo: "KIT-01", descripcion: "Kit", descripcion_compra: "", nombre_mostrado: "",
        tipo: "Kit", clase: "10", es_ensamblaje: "F", inactivo: "F", ultima_modificacion: "01/09/2026" },
      { codigo: "LAM-01", descripcion: "Lamina", descripcion_compra: "", nombre_mostrado: "",
        tipo: "InvtPart", clase: "", es_ensamblaje: "F", inactivo: "F", ultima_modificacion: "01/09/2026" }
    ] }
  });
  post({ accion: "items" });
  // `items` se escribe una fila por llamada (clave natural `codigo`, sin lote), asi que se
  // juntan los cuerpos de todas las escrituras y no solo el primero.
  const filas = calls.http
    .filter((c) => c.method === "PATCH" || c.method === "POST")
    .flatMap((c) => {
      const cuerpo = JSON.parse(c.body);
      return Array.isArray(cuerpo) ? cuerpo : [cuerpo];
    });
  assert.equal(filas.length, 3, "tres articulos, tres escrituras");
  assert.equal(filas[0].tipo, "Assembly", "tipo es TEXTO, no un id: NetSuite devuelve el enum");
  assert.equal(filas[0].es_ensamblaje, true);
  assert.equal(filas[1].tipo, "Kit");
  assert.equal(filas[1].es_ensamblaje, false, "Kit no cuenta como ensamble padre");
  assert.equal(filas[2].tipo, "InvtPart");
  assert.equal(filas[2].clase, 0, "clase vacia de NetSuite se guarda en 0, no en null");
});

test("ningun SQL pide columnas que no existen en esta cuenta (medido 2026-09-28)", async () => {
  const { post, calls } = await cargar({
    parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" },
    filas: FILAS_BASE
  });
  for (const accion of ["workorders", "operaciones", "materiales", "items", "centros", "inventario", "ordenes_venta"]) {
    post({ accion: accion });
  }
  // Cada uno de estos nombres dio 500 o 400 medido contra el ERP, y el sintoma NO es una lista
  // vacia: es la accion entera caida sin escribir nada.
  const inexistentes = [
    "i.type",                    // la columna se llama itemtype
    "i.isassortmentitem",        // no existe ninguna columna de ensamblaje en item
    "i.isassemblyitem",
    "ail.quantityreserved",      // la columna se llama quantitycommitted
    "ail.quantitypicked",        // no existe ninguna columna de pickeado en el agregado
    "i.units",
    "i.purchasingcost"
  ];
  for (const c of calls.suiteql) {
    for (const mala of inexistentes) {
      assert.ok(!new RegExp("\\b" + mala + "\\b").test(c.sql),
        "el SQL pide " + mala + ", que no existe en esta cuenta:\n" + c.sql);
    }
  }
  // El SQL de inventario no lleva SUM ni GROUP BY: envolver la proyeccion con BUILTIN.DF en una
  // consulta agregada da 400, y el agregado trae ya una fila por par (medido).
  const inv = calls.suiteql.filter((c) => /FROM aggregateitemlocation/.test(c.sql));
  assert.equal(inv.length, 1, "inventario hace UNA consulta, no dos");
  assert.ok(!/GROUP BY/.test(inv[0].sql), "inventario no lleva GROUP BY");
  assert.ok(!/SUM\(/.test(inv[0].sql), "inventario no lleva SUM: el agregado ya trae una fila por par");
  assert.ok(/BUILTIN\.DF\(ail\.item\)/.test(inv[0].sql), "el codigo del articulo sale del envoltorio");
});

test("items: el CASE de es_ensamblaje solo reconoce Assembly", async () => {
  const { post, calls } = await cargar({
    parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" },
    filas: FILAS_BASE
  });
  post({ accion: "items", itemIds: ["D88-6055"] });
  const sql = calls.suiteql.find((c) => /FROM item i/.test(c.sql)).sql;
  assert.ok(/i\.itemtype\s+AS tipo/.test(sql), "el tipo sale de i.itemtype");
  assert.ok(/CASE WHEN i\.itemtype = 'Assembly' THEN 'T' ELSE 'F' END AS es_ensamblaje/.test(sql),
    "es_ensamblaje se deriva de itemtype y NO de una columna que no existe:\n" + sql);
});

test("ordenes_venta: una fila por orden con las lineas dentro", async () => {
  const { post, calls } = await cargar({
    parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" },
    filas: { ...FILAS_BASE, ordenes_venta: FILAS_BASE.ordenes_venta }
  });
  post({ accion: "ordenes_venta", salesOrderIds: ["3301"] });
  const escritura = calls.http.find((c) => c.method === "PATCH" || c.method === "POST");
  const cuerpo = JSON.parse(escritura.body);
  const fila = Array.isArray(cuerpo) ? cuerpo[0] : cuerpo;
  assert.equal(fila.folio, "SO-900");
  assert.equal(fila.cliente, "ACME");
  assert.ok(Array.isArray(fila.lineas), "las lineas van en jsonb");
});

// ---------------------------------------------------------------- escritura en Supabase

test("modo comparar: si la fila previa es identica, NO escribe (solo la lectura)", async () => {
  const previa = [{
    ot: "3177", wo_internal_id: "4821", articulo: "D88-6055", descripcion: "Placa",
    cantidad: 40, estatus: "En Proceso", cliente: "ACME", cant_ensamblada: 0,
    cant_pendiente: 40, fecha_inicio_ns: MEDIANOCHE("20/09/2026"),
    fecha_fin_ns: MEDIANOCHE("30/09/2026"),
    fecha_vencimiento: "2026-09-30T00:00:00+00:00",
    synced_at: "2026-09-01T00:00:00.000Z", revision: 4
  }];
  const { post, calls } = await cargar({
    parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" },
    filas: FILAS_BASE,
    http: (req) => (req.method === "GET" ? { code: 200, body: JSON.stringify(previa) } : { code: 200, body: "[]" })
  });
  const r = post({ accion: "workorders", folios: ["3177"] });
  assert.equal(r.omitidas, 1, "la fila no cambio: se omite");
  assert.equal(r.escritas, 0);
  assert.equal(calls.http.filter((c) => c.method !== "GET").length, 0, "cero escrituras");
});

test("modo comparar: si la fila previa cambio, hace PATCH con guarda de revision", async () => {
  const previa = [{
    ot: "3177", wo_internal_id: "4821", articulo: "D88-6055", descripcion: "Placa",
    cantidad: 40, estatus: "Abierta", cliente: "ACME", cant_ensamblada: 0,
    cant_pendiente: 40, fecha_inicio_ns: MEDIANOCHE("20/09/2026"),
    fecha_fin_ns: MEDIANOCHE("30/09/2026"),
    fecha_vencimiento: MEDIANOCHE("30/09/2026"),
    synced_at: "2026-09-01T00:00:00.000Z", revision: 4
  }];
  const { post, calls } = await cargar({
    parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" },
    filas: FILAS_BASE,
    http: (req) => (req.method === "GET"
      ? { code: 200, body: JSON.stringify(previa) }
      : { code: 200, body: JSON.stringify([{ ot: "3177", revision: 5 }]) })
  });
  const r = post({ accion: "workorders", folios: ["3177"] });
  assert.equal(r.escritas, 1);
  const patch = calls.http.find((c) => c.method === "PATCH");
  assert.ok(patch, "la escritura estricta es un PATCH, no un POST");
  assert.ok(patch.url.includes("ot=eq.3177"), "filtra por la clave natural");
  assert.ok(patch.url.includes("revision=eq.4"), "y por la revision que leyo: esa es la concurrencia optimista");
  assert.equal(JSON.parse(patch.body).revision, 5);
  assert.equal(patch.headers.Prefer, "return=representation");
});

test("modo comparar: si la fila cambio ENTRE la lectura y el PATCH, no la pisa y lo reporta", async () => {
  // Se lee una previa y el PATCH responde 0 filas: es el choque de concurrencia.
  const { post } = await cargar({
    parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" },
    filas: FILAS_BASE,
    http: (req) => (req.method === "GET"
      ? { code: 200, body: JSON.stringify([{ ot: "3177", cantidad: 1, estatus: "Otra", revision: 2 }]) }
      : { code: 200, body: "[]" })
  });
  const r = post({ accion: "workorders", folios: ["3177"] });
  assert.equal(r.ok, false);
  assert.equal(r.escritas, 0);
  assert.equal(r.conflictos.length, 1);
  assert.ok(/cambio entre la lectura y la escritura/.test(r.conflictos[0].motivo));
  assert.equal(r.conflictos[0].clave, "3177");
});

test("modo upsert: si el lote pasa el tope, degrada a merge-duplicates Y LO DICE", async () => {
  const muchas = Array.from({ length: 61 }, (_, i) => ({
    wo_internal_id: String(1000 + i), ot: String(3000 + i), articulo: "A" + i, descripcion: "D",
    cantidad: "10", estatus: "En Proceso", cliente: "ACME", fecha_inicio: "20/09/2026",
    fecha_fin: "30/09/2026"
  }));
  const { post, calls } = await cargar({
    parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" },
    filas: { ...FILAS_BASE, workorders: muchas }
  });
  const r = post({ accion: "workorders" });
  assert.equal(r.modoUsado, "upsert");
  assert.ok(r.degradaciones.some((d) => /tope es 60/.test(d)), "la degradacion queda escrita, no es silenciosa");
  const post1 = calls.http.find((c) => c.method === "POST");
  assert.ok(post1.headers.Prefer.includes("merge-duplicates"));
  assert.ok(post1.url.includes("on_conflict=ot"), "el upsert es por la clave natural");
});

test("nunca viajan columnas que no estan en el esquema (las notas internas se filtran)", async () => {
  const { post, calls } = await cargar({
    parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" },
    filas: FILAS_BASE
  });
  post({ accion: "workorders", folios: ["3177"] });
  const escritura = calls.http.find((c) => c.method === "PATCH" || c.method === "POST");
  const cuerpo = JSON.parse(escritura.body);
  const fila = Array.isArray(cuerpo) ? cuerpo[0] : cuerpo;
  assert.equal(fila._fuenteEnsamblada, undefined, "_fuenteEnsamblada es nota interna: si viaja, PostgREST da 400");
  const permitidas = ["ot", "wo_internal_id", "articulo", "descripcion", "cantidad", "estatus",
    "cliente", "cant_ensamblada", "cant_pendiente", "fecha_inicio_ns", "fecha_fin_ns",
    "fecha_vencimiento", "synced_at", "revision"];
  for (const columna of Object.keys(fila)) {
    assert.ok(permitidas.includes(columna), "columna fuera del esquema: " + columna);
  }
});

test("un valor con coma NO rompe el filtro in.(...) de PostgREST", async () => {
  const { post, calls } = await cargar({
    parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" },
    filas: { ...FILAS_BASE, items: [{ codigo: "A,B", descripcion: "x", descripcion_compra: "", nombre_mostrado: "", tipo: "1", clase: "1", es_ensamblaje: "F", inactivo: "F", ultima_modificacion: "2026-09-01 10:00:00" }] }
  });
  post({ accion: "items", itemIds: ["A,B"] });
  const get = calls.http.find((c) => c.method === "GET");
  assert.ok(get.url.includes("codigo=in.(A B)"), "la coma se sustituye, no rompe el filtro");
});

test("sin credenciales el fallo es accionable, no un error generico", async () => {
  const { post } = await cargar({ parametros: {}, filas: FILAS_BASE });
  const r = post({ accion: "workorders", folios: ["3177"] });
  assert.equal(r.escritas, 0);
  assert.ok(r.avisos.some((a) => /SUPABASE_URL y SUPABASE_KEY/.test(a)), "dice que script parameter falta");
});

test("una accion desconocida lista las que si existen", async () => {
  const { post } = await cargar({ parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" } });
  const r = post({ accion: "inventario2" });
  assert.equal(r.ok, false);
  assert.ok(r.acciones.includes("workorders"));
  assert.ok(r.acciones.includes("ordenes_venta"));
});

test("dryRun no escribe y dice que claves se escribirian", async () => {
  const { post, calls } = await cargar({
    parametros: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" },
    filas: FILAS_BASE
  });
  const r = post({ accion: "workorders", folios: ["3177"], dryRun: true });
  assert.equal(r.dryRun, true);
  assert.equal(r.escritas, 0);
  assert.equal(calls.http.length, 0, "ni una llamada a Supabase");
  assert.deepEqual(r.clavesQueSeEscribirian, ["3177"]);
});

// ---------------------------------------------------------------- helpers de test

/**
 * Igual que cargar(), pero con la cadena de respaldos de la cantidad ensamblada bajo control.
 * `opciones.record` son los valores del record de la OT y `opciones.recordFalla` simula que
 * la OT no se puede cargar, que es lo que deja que la cadena llegue a SuiteQL.
 */
async function cargarConEnsamblada(opciones = {}) {
  const source = await readFile(new URL(RUTA, import.meta.url), "utf8");
  const calls = { suiteql: [], http: [], record: [] };
  // Cada estrategia de la cadena de respaldos se identifica por el texto EXACTO de su
  // SELECT. Si el detector se pasa, el mock contesta la fila de workorders a una consulta de
  // `built` y la prueba mide cualquier cosa menos la cadena.
  const query = {
    runSuiteQL(payload) {
      const sql = String(payload.query || "");
      calls.suiteql.push({ sql, params: payload.params || [] });
      const etiqueta = etiquetaDeSql(sql);
      let filas = [];
      if (etiqueta === "ensamblada") {
        if (/quantityremaining AS v/.test(sql)) filas = opciones.restante == null ? [] : [{ v: opciones.restante }];
        else filas = opciones.suiteqlBuilt == null ? [] : [{ v: opciones.suiteqlBuilt }];
      }
      if (etiqueta === "ensamblada_operacion") {
        filas = opciones.porOperacion == null ? [] : [{ v: opciones.porOperacion }];
      }
      if (etiqueta === "workorders") filas = FILAS_BASE.workorders;
      return { asMappedResults: () => filas };
    }
  };
  const https = {
    request(req) {
      calls.http.push(req);
      return { code: 200, body: "[]" };
    }
  };
  const runtime = { getParameter: ({ name }) => (name === "SUPABASE_URL" ? "https://x.supabase.co" : "k") };
  let factory = null;
  const define = (_deps, callback) => { factory = callback; };
  // eslint-disable-next-line no-new-func
  new Function("define", source)(define);
  const nrecord = fakeRecord(calls, opciones.record || {}, opciones.recordFalla);
  return { post: factory(query, https, runtime, { info() {}, error() {} }, nrecord).post, calls };
}
