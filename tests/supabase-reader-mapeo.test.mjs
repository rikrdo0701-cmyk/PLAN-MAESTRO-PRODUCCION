// MAPPING_GAPS tiene que decir la verdad de HOY, y el lector tiene que mapear las columnas
// que SI existen.
//
// QUE PASABA. src/web/shared/supabase-reader.js declaraba como ausentes columnas que estan
// en la base, y ademas no las mapeaba: leer de Supabase perdia datos que estaban ahi.
// Medido el 2026-09-29 contra el esquema REAL desplegado, columna por columna:
//   - article_configurations.precio_ref_venta existe (numeric) y el lector decia que no.
//   - calendar_exceptions tiene fecha_inicio, hora_inicio, fecha_fin y hora_fin, y el lector
//     decia que no se podia reconstruir la ventana.
//   - capabilities.solapamiento es NUMERIC (el ratio 0..1), no un boolean, y ademas existen
//     palabras_clave (text) y custom (boolean): el lector decia que faltaban las tres.
//   - operators.nombre_real existe: se decia que no se sabia cual de las dos era la clave.
//   - tools.codigo existe: la identidad si coincide.
// El sintoma es el peor de los posibles: no es un error, es un dato que no llega y nadie lo ve.
//
// LA RED GENERAL. El test de mas abajo recorre el JSON del esquema (el OpenAPI que sirve
// PostgREST) y falla si un hueco declarado nombra algo que SI existe. Ese es el que habria
// atrapado el error, y es el que lo va a atrapar la proxima vez: por eso cada hueco declara
// su columna con un formato fijo, y ese formato se comprueba tambien.
//
// LO QUE SIGUE FALTANDO (docs/schema-supabase-plan.sql, SIN APLICAR) se declara aqui a
// proposito, para que el dia que se aplique el DDL la lista baje sola y se note el cambio.
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const readerSource = await readFile(new URL("../src/web/shared/supabase-reader.js", import.meta.url), "utf8");

// El esquema MEDIDO, no el DDL objetivo: sale del OpenAPI que sirve PostgREST el 2026-09-29.
// MEDIDO 2026-09-29: .openchamber/ esta en .gitignore, asi que este archivo no viaja con el
// repositorio. Si no esta, la red general no se simula: se salta y avisa, porque una red
// que corre contra un esquema inventado de memoria no mide nada.
// MEDIDO 2026-09-29: la primera version leia .openchamber/esquema-supabase.json, que
// esta en .gitignore. En un clon limpio, y en CI, el archivo no esta, y los dos
// tests de la red general se SALTABAN con t.skip. Un test que se salta da verde por
// un motivo falso, que es peor que no tener test. Por eso el esquema medido se
// versiona en docs/esquema-supabase-medido.json y se lee de ahi.
const esquemaUrl = new URL("../docs/esquema-supabase-medido.json", import.meta.url);
let ESQUEMA = null;
try {
  ESQUEMA = JSON.parse(await readFile(esquemaUrl, "utf8"));
} catch (error) {
  console.warn(`aviso: no se leyo el esquema medido (${String(error && error.message)}); la red general no corre`);
}

/** Levanta el LECTOR REAL, con un fetch de mentira que devuelve `filas` por tabla. */
function lector(filas) {
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
    encodeURIComponent,
    fetch: async (url) => {
      const tabla = decodeURIComponent(String(url).split("/rest/v1/")[1].split("?")[0]);
      const hay = Object.prototype.hasOwnProperty.call(filas, tabla);
      return {
        ok: hay,
        status: hay ? 200 : 404,
        json: async () => (hay ? filas[tabla] : []),
      };
    },
  };
  contexto.globalThis = contexto;
  vm.createContext(contexto);
  vm.runInContext(readerSource, contexto, { filename: "supabase-reader.js" });
  const reader = contexto.PPSupabaseReader;
  reader.configure({ url: "https://ejemplo.supabase.co", anonKey: "publicable-de-pruebas" });
  return reader;
}

/** Corre readCatalogs con filas de mentira y devuelve el bloque catalogs. */
async function catalogsDe(filas, tablas) {
  const reader = lector(filas);
  const leido = await reader.readCatalogs(tablas ? { tables: tablas } : undefined);
  return leido;
}

/**
 * Copia al realm de este archivo. El lector corre dentro de un vm, o sea que sus arrays y
 * objetos tienen otro prototipo: assert.deepEqual los declara distintos aunque tengan lo
 * mismo (es lo mismo que avisa el comentario de tests/supabase-catalog-boot.test.mjs:120).
 */
function copiar(valor) {
  return JSON.parse(JSON.stringify(valor));
}

const reader = lector({});
const MAPPING_GAPS = reader.MAPPING_GAPS;

// El formato de cada hueco: "<campo del state> | falta la [FORMA de la] columna X | <por que>".
// No es una costumbre: la red general lee el nombre de la columna de ahi, asi que una entrada
// fuera de formato se saltaria sola. Por eso el formato se comprueba con un test aparte.
const ENTRADA = /^[^|]+\|\s*falta la (FORMA de la )?columna ([A-Za-z_][A-Za-z0-9_]*)\s*\|.+$/;

/** Todas las entradas de MAPPING_GAPS, con el parseo de su columna declarada. */
function huecos() {
  const salida = [];
  for (const [tabla, entradas] of Object.entries(MAPPING_GAPS)) {
    assert.ok(Array.isArray(entradas), `${tabla}: los huecos tienen que ser un arreglo de texto`);
    for (const entrada of entradas) {
      assert.equal(typeof entrada, "string", `${tabla}: cada hueco es un texto, no ${typeof entrada}`);
      const coincide = ENTRADA.exec(entrada);
      salida.push({
        tabla,
        entrada,
        formato: Boolean(coincide),
        // En mayusculas y en minusculas cuentan igual: los encabezados de hoja van en
        // mayusculas y las columnas de la tabla en minusculas, y el nombre buscado es el
        // mismo aunque este escrito distinto.
        columna: coincide ? coincide[2].toLowerCase() : null,
        forma: coincide ? Boolean(coincide[1]) : false,
      });
    }
  }
  return salida;
}

/** Columnas que TIENE la tabla, en minusculas, tal como las reporta el OpenAPI. */
function columnasDe(tabla) {
  const definicion = ESQUEMA[tabla];
  assert.ok(definicion, `${tabla} no esta en el esquema medido: no se puede comprobar nada de ella`);
  return new Set(definicion.map((columna) => String(columna.columna).toLowerCase()));
}

// Las 11 columnas que agrega docs/schema-supabase-plan.sql y que HOY no existen. Van en una
// constante porque salen en dos tests: el que las exige declaradas y el que comprueba que de
// verdad siguen sin existir.
const PENDIENTES_DEL_PLAN = [
  "operations.num", "operations.parte", "operations.contenido", "operations.prioridad",
  "operations.fecha_req", "operations.comentario", "operations.tiempo_fallback", "operations.kit_pending",
  "work_orders.due_date_override", "work_orders.precio_desde", "work_orders.precio_hasta",
];

// ---------------------------------------------------------------------------
// LA RED GENERAL
// ---------------------------------------------------------------------------

test("cada hueco declara su columna con el formato que la red puede leer", () => {
  const sueltos = huecos().filter((hueco) => !hueco.formato);
  assert.deepEqual(
    sueltos.map((hueco) => `${hueco.tabla}: ${hueco.entrada}`),
    [],
    "un hueco fuera de formato se escapa de la red general: tiene que decir 'falta la columna X' o 'falta la FORMA de la columna X'"
  );
});

test("NINGUN hueco declara ausente una columna que existe en el esquema medido", (t) => {
  // Si el esquema medido no estuviera, esto NO puede seguir en verde: seria la red
// general apagada sin avisar. Se falla en vez de saltarse.
if (!ESQUEMA) throw new Error("falta docs/esquema-supabase-medido.json: la red general de mapeo no se puede comprobar");
  const falsos = [];
  for (const hueco of huecos()) {
    // Un hueco que dice 'falta la FORMA' NO afirma que la columna falte: afirma que existe y
    // que no esta en la forma que el state necesita. Por eso va al reves, y tambien se
    // comprueba en el test de abajo: si alguien usara esa marca para tapar un hueco real,
    // revienta ahi.
    if (hueco.forma) continue;
    if (columnasDe(hueco.tabla).has(hueco.columna)) falsos.push(hueco);
  }
  assert.deepEqual(
    falsos.map((hueco) => `${hueco.tabla}.${hueco.columna} (${hueco.entrada})`),
    [],
    "estos huecos declaran ausente una columna que SI existe: el lector se estaria tragando un dato que esta en la base"
  );
});

test("un hueco que dice 'falta la FORMA' nombra una columna que si existe", (t) => {
  // Si el esquema medido no estuviera, esto NO puede seguir en verde: seria la red
// general apagada sin avisar. Se falla en vez de saltarse.
if (!ESQUEMA) throw new Error("falta docs/esquema-supabase-medido.json: la red general de mapeo no se puede comprobar");
  const falsos = [];
  for (const hueco of huecos()) {
    if (!hueco.forma) continue;
    if (!columnasDe(hueco.tabla).has(hueco.columna)) falsos.push(hueco);
  }
  assert.deepEqual(
    falsos.map((hueco) => `${hueco.tabla}.${hueco.columna} (${hueco.entrada})`),
    [],
    "esta entrada dice que la columna existe pero no en la forma que el state necesita, y la columna no existe"
  );
});

test("las 11 columnas que de verdad faltan hoy siguen declaradas una por una", () => {
  // Si alguien las borra de MAPPING_GAPS creyendo que ya estan, el DDL sigue sin aplicar y
  // nadie se entera hasta que el dato falta en la pagina.
  const declaradas = new Set(
    huecos().filter((hueco) => !hueco.forma).map((hueco) => `${hueco.tabla}.${hueco.columna}`)
  );
  const sinDeclarar = PENDIENTES_DEL_PLAN.filter((columna) => !declaradas.has(columna));
  assert.deepEqual(sinDeclarar, [], `estos huecos no estan declarados: ${sinDeclarar.join(", ")}`);
});

test("las columnas del DDL pendiente NO estan en el esquema todavia", (t) => {
  // La contraprueba del test de arriba, para que el dia que se aplique el DDL se note aqui y
  // no en la pagina: si estas columnas ya existen, la red general empieza a fallar y hay que
  // bajar MAPPING_GAPS y quitar este test.
  // Si el esquema medido no estuviera, esto NO puede seguir en verde: seria la red
// general apagada sin avisar. Se falla en vez de saltarse.
if (!ESQUEMA) throw new Error("falta docs/esquema-supabase-medido.json: la red general de mapeo no se puede comprobar");
  const yaAplicadas = PENDIENTES_DEL_PLAN.filter((columna) => {
    const [tabla, nombre] = columna.split(".");
    return columnasDe(tabla).has(nombre);
  });
  assert.deepEqual(
    yaAplicadas,
    [],
    "docs/schema-supabase-plan.sql ya esta aplicado: hay que bajar MAPPING_GAPS y quitar este test"
  );
});

test("las tablas que ya no tienen huecos no declaran ninguno", () => {
  // Cada una declaraba un hueco FALSO: la columna existe, y el escritor de catalogos dice de
  // donde sale (16-supabase-catalogo.js). Un hueco falso no es cosmetico: por ahi se dejo de
  // mapear el dato.
  for (const tabla of ["operators", "capabilities", "tools", "ot_configurations", "article_configurations", "machines"]) {
    assert.equal(MAPPING_GAPS[tabla], undefined, `${tabla} ya no tiene huecos: se corrigio el mapeo, no se oculta el dato`);
  }
});

// ---------------------------------------------------------------------------
// EL MAPEO
// ---------------------------------------------------------------------------

test("capabilities: el solapamiento se lee como el RATIO que es, no como una bandera", () => {
  // MEDIDO: capabilities.solapamiento es numeric. Venia boolean y el factor se perdia
  // (docs/schema-supabase-cierre-catalogos.sql, seccion 2.1). Un 0 aqui es un 0 de verdad:
  // con `|| 1` seria 1, y una capacidad que no se solapa volveria a solaparse al 100%.
  const rebanada = reader.mapCapabilities([
    {
      key: "CORTE::CORTE LASER", ct: "5459", solapamiento: 0, palabras_clave: "laser, corte",
      custom: true, requiere_herramental: true, requiere_kit: false, capacidad: "FINITA",
      activa: true, operacion: "CORTE LASER", eficiencia_pct: 90,
    },
  ]);
  // La clave se normaliza como en el servidor: lo que va despues de '::' se pasa por
  // normalizeKey, o sea 'CORTE LASER' se vuelve 'CORTE_LASER' (PP_normalizeCapabilityKey_).
  const clave = Object.keys(rebanada.operationRules)[0];
  assert.equal(clave, "CORTE::CORTE_LASER");
  const regla = rebanada.operationRules[clave];
  assert.equal(regla.overlap, 0, "un solapamiento de 0 es un 0, no el default de 1");
  assert.equal(regla.keywords, "laser, corte", "palabras_clave es texto y se pasa tal cual");
  assert.equal(regla.requiresTool, true);
  assert.equal(regla.requiresKit, false);
  assert.equal(regla.efficiency, 90);
  assert.deepEqual(
    copiar(rebanada.customCapabilities),
    [{ key: "CORTE::CORTE_LASER", ct: "5459", label: "CORTE LASER" }]
  );
});

test("capabilities: sin solapamiento se usa el default de 1, y activa=false va a ocultas", () => {
  const rebanada = reader.mapCapabilities([
    { key: "5459", ct: "5459", solapamiento: null, capacidad: "INFINITA", activa: true, custom: false, palabras_clave: "" },
    { key: "5527", ct: "5527", solapamiento: 0.5, capacidad: "FINITA", activa: false, custom: false, palabras_clave: "" },
  ]);
  // El default 1 es el de PP_buildState_ (Number(SOLAPAMIENTO || 1)): es lo que hace que una
  // capacidad sin factor se comporte como en la hoja.
  assert.equal(rebanada.operationRules["5459"].overlap, 1);
  assert.equal(rebanada.operationRules["5527"].overlap, 0.5, "un ratio de 0.5 se respeta tal cual");
  assert.deepEqual(copiar(rebanada.hiddenCapabilities), ["5527"]);
  assert.deepEqual(copiar(rebanada.configuredCapabilities), ["5459"]);
  assert.deepEqual(copiar(rebanada.customCapabilities), [], "custom=false no es una capacidad personalizada");
});

test("operators: el perfil trae el NOMBRE real, no la clave con la que se programa", () => {
  // La ambiguedad que el lector declaraba la resuelve el ESCRITOR
  // (16-supabase-catalogo.js:57-68): `nombre` es OPERADOR (la clave, unica) y `nombre_real`
  // es NOMBRE (la persona). Sin esto, la pagina mostraba 'CORTADOR INICIAL' donde deberia
  // mostrar el nombre de quien corta.
  const rebanada = reader.mapOperators([
    { nombre: "CORTADOR INICIAL", nombre_real: "Juan Perez", activo: true, minutos_capacidad: 2400, rendimiento_pct: 100, categoria: "" },
  ]);
  assert.deepEqual(copiar(rebanada.operators), ["CORTADOR INICIAL"]);
  assert.equal(rebanada.operatorProfiles["CORTADOR INICIAL"].name, "Juan Perez");
  assert.equal(rebanada.operatorCapacity["CORTADOR INICIAL"], 2400);
  // Sin NOMBRE en la fila, el perfil cae a la clave: es el default del servidor (02-storage.js:459).
  const sinNombre = reader.mapOperators([{ nombre: "OPERADOR 2", nombre_real: "", activo: true }]);
  assert.equal(sinNombre.operatorProfiles["OPERADOR 2"].name, "OPERADOR 2");
});

test("article_configurations: llega el precio de venta de referencia, que es otro precio", async () => {
  // PRECIO_MANUAL lo escribe una persona y PRECIO_REF_VENTA lo baja el sync con el precio de
  // venta de NetSuite, y baja tambien cuando el precio baja (RULE-REP-021). Antes se
  // declaraba que la columna no existia, y el precio de venta salia en cero.
  const { catalogs } = await catalogsDe({
    article_configurations: [
      { articulo: "abc-1", tipo_ot: "prod", tipo_trabajo: "interno", precio_manual: 120, precio_ref_venta: 137.5, actualizado: "2026-09-29T10:00:00+00:00" },
    ],
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(catalogs.articleConfigurations)),
    {
      "ABC-1": {
        article: "ABC-1",
        jobType: "PROD",
        planningType: "INTERNO",
        manualUnitPrice: 120,
        referenceSalePrice: 137.5,
        updatedAt: "2026-09-29T10:00:00+00:00",
      },
    },
    "el articulo es la clave en mayusculas, como en PP_buildArticleConfigurations_"
  );
});

test("calendar: la ventana completa, no un solo dia", async () => {
  // FECHA_INICIO/HORA_INICIO/FECHA_FIN/HORA_FIN existen (docs/schema-supabase-cierre-catalogos.sql,
  // seccion 5). Con solo 'fecha' una excepcion de varios dias se perdia entera: el planificador
  // la usa para quitarle horas a la maquina, y solo se le quitaban el primer dia.
  const { catalogs } = await catalogsDe({
    calendar_exceptions: [
      { id: "uuid-1", fecha: "2026-12-24", fecha_inicio: "2026-12-24", hora_inicio: "07:00", fecha_fin: "2026-12-31", hora_fin: "18:00", concepto: "VACACIONES", maquina: "", motivo: "Cierre de anio", activo: true },
      // Fila vieja, sembrada antes de la migracion: solo trae 'fecha'. Se usa como respaldo en
      // vez de devolver una excepcion sin fecha, que la app descarta (app.js:1403).
      { id: "uuid-2", fecha: "2026-11-02", concepto: "MAQUINA", maquina: "AB11", motivo: "Mantenimiento", activo: true },
    ],
  });
  const [ventana, vieja] = JSON.parse(JSON.stringify(catalogs.calendarExceptions));
  assert.equal(ventana.startDate, "2026-12-24");
  assert.equal(ventana.start, "07:00");
  assert.equal(ventana.endDate, "2026-12-31");
  assert.equal(ventana.end, "18:00");
  assert.equal(ventana.concept, "VACACIONES");
  assert.equal(vieja.startDate, "2026-11-02", "sin fecha_inicio se cae a fecha");
  assert.equal(vieja.endDate, "2026-11-02", "y el fin cae al inicio, no a una fecha inventada");
  assert.equal(vieja.machine, "AB11");
});

test("tools: la identidad es el ID de la hoja (codigo) y el KIT_HERRAMENTAL esta en 'kit'", async () => {
  // tools.id es un uuid de la base y NO es la clave del plan; el ID de la hoja HERRAMENTALES
  // lo guarda `codigo` (16-supabase-catalogo.js:121-131). Con el uuid, buscar o borrar un
  // herramental no encontraba nunca la fila.
  const { catalogs } = await catalogsDe({
    tools: [
      { id: "uuid-a", codigo: "HERR-01", parte: "ART-1", herramental: "MOLD-7", kit: "KIT-2", tiempo_ajuste_herr: 15, tiempo_ajuste_kit: 5, activo: true },
    ],
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(catalogs.toolCatalog)),
    [{ id: "HERR-01", part: "ART-1", herramental: "MOLD-7", kitHerramental: "KIT-2", toolSetupMinutes: 15, kitSetupMinutes: 5, active: true }]
  );
});

test("ot_configurations: KIT_HERRAMENTAL, KIT_PENDIENTE y los herramentales extra si se mapean", async () => {
  const { catalogs } = await catalogsDe({
    ot_configurations: [
      { ot: "OT-100", maquina: "SIN_MAQUINA", kit: "KIT-9", kit_pendiente: true, tipo_subcontrato: "PINTADO", dias_subcontrato: 3, herramental: "MOLD-1", herramentales_extra: ["MOLD-2", " MOLD-2 ", "MOLD-3"], actualizado: "2026-09-29T11:00:00+00:00" },
    ],
  });
  const config = JSON.parse(JSON.stringify(catalogs.otConfigurations))["OT-100"];
  assert.equal(config.machine, "", "SIN_MAQUINA es 'sin maquina', no una maquina con ese nombre");
  assert.equal(config.kitHerramental, "KIT-9");
  assert.equal(config.kitPending, true);
  assert.equal(config.herramental, "MOLD-1");
  assert.equal(config.subcontractType, "PINTADO");
  assert.equal(config.subcontractDays, 3);
  assert.deepEqual(config.additionalHerramentales, ["MOLD-2", "MOLD-3"], "jsonb con repetidos y espacios, como PP_additionalToolList_");
});

test("subcontracts: el id es el de la hoja, no el uuid de la base", async () => {
  // La app borra por id (app.js:5569, data-delete-subcontract). Con el uuid, el borrado no
  // encontraba la fila de la hoja.
  const { catalogs } = await catalogsDe({
    subcontracts: [{ id: "uuid-s", codigo: "SUB-1", parte: "*", tipo: "PINTADO", dias_habiles: 4, activo: true }],
  });
  assert.equal(catalogs.subcontracts[0].id, "SUB-1");
});

test("operations: herramental y kit si se mapean, y lo que no tiene columna no se inventa", () => {
  const [op] = reader.mapOperations([
    {
      operation_id: "ns-4821-10", ot: "OT-100", secuencia: 10, ct: "5459", descripcion: "Corte",
      operador: "CORTADOR INICIAL", maquina: "AB11", herramental: "MOLD-7", kit: "KIT-2",
      cant_total: 100, cant_pendiente: 40, tiempo_ciclo: 1.5, tiempo_setup: 10, tiempo_prod: 2,
      tipo_insercion: "MANUAL", estatus: "PENDIENTE", locked: true, auto_frozen: false,
      subcontract_type: "", subcontract_days: 0,
    },
  ]);
  assert.equal(op.id, "ns-4821-10", "la clave de la fila es operation_id, no el uuid");
  assert.equal(op.herramental, "MOLD-7", "HERRAMENTAL de la hoja esta en la columna herramental");
  assert.equal(op.kitHerramental, "KIT-2", "KIT_HERRAMENTAL de la hoja esta en la columna kit");
  assert.equal(op.cantTotal, 100);
  assert.equal(op.locked, true);
  // Lo que no tiene columna NO se rellena: un 0 en tiempoFallback afirmaria que el tiempo
  // alternativo es cero, y un '' en parte afirmaria que la operacion no es de ningun articulo.
  // Se dejan sin definir y la lista esta en MAPPING_GAPS.operations.
  for (const campo of ["num", "parte", "contenido", "prioridad", "fechaReq", "comentario", "tiempoFallback", "kitPending", "log", "generatedBy"]) {
    assert.equal(op[campo], undefined, `${campo} no tiene columna en la tabla: no se inventa`);
  }
  // Y las fechas YA NO se dejan sin mapear: la regla simetrica existe (partir el ISO en UTC,
  // sin convertir de zona, y medianoche = hora vacia) y esta probada mas abajo. Esta fila no
  // trae ninguna columna de fecha, o sea que lo unico que se puede decir es que estan vacias:
  // "" y no undefined, porque las columnas SI existen y lo que no hay es un dato. Y las dos
  // marcas de retirada NO se rellenan: la columna todavia no esta en el esquema medido
  // (MEDIDO 2026-09-29), y poner "" afirmaria que la operacion esta en el plan.
  for (const campo of ["fechaInicio", "horaInicio", "fechaFin", "horaFin"]) {
    assert.equal(op[campo], "", `${campo}: la columna existe y no trae valor, no se inventa`);
  }
  for (const campo of ["retiradaEn", "retiradaPor"]) {
    assert.equal(op[campo], undefined, `${campo}: la columna no esta en el esquema medido, no se inventa`);
  }
});

test("una tabla que NO se pudo leer no llega como vacia: llega como undefined", async () => {
  // Un array vacio SI se aplica encima del estado (supabase-catalog-apply.js) y significa
  // 'no hay'. Si una tabla cae por un 500 y el lector devuelve [], la pagina se queda sin
  // herramientas, sin calendario y sin configuracion, y no hay ningun error que lo diga.
  const caida = await catalogsDe(
    { tools: [{ codigo: "HERR-01", parte: "A", herramental: "M", kit: "" }] },
    ["tools", "calendar_exceptions"]
  );
  assert.equal(caida.catalogs.toolCatalog.length, 1, "la tabla que SI se leyo trae su valor");
  assert.equal("calendar_exceptions" in caida.catalogs, false, "la que cayo no aparece en catalogs");
  assert.equal(caida.catalogs.calendarExceptions, undefined);
  assert.ok(caida.errors.calendar_exceptions, "y el motivo queda en errors, que es donde lo lee el arranque");

  const vacia = await catalogsDe({ tools: [], calendar_exceptions: [] }, ["tools", "calendar_exceptions"]);
  assert.deepEqual(vacia.catalogs.toolCatalog, [], "si se leyo y esta vacia, [] es informacion real");
  assert.deepEqual(vacia.catalogs.calendarExceptions, []);
});

// ---------------------------------------------------------------------------
// LA REGLA DE LAS FECHAS
// ---------------------------------------------------------------------------
//
// QUE SE MEDIO, Y NO SE RE-INVESTIGA AQUI. El 2026-09-29, sobre filas reales y no sobre el DDL
// objetivo: operations.hora_inicio y operations.hora_fin NULAS en 1000/1000, y
// operations.fecha_inicio SIEMPRE con la forma T00:00:00+00:00; work_orders.fecha_inicio_ns y
// work_orders.fecha_fin_ns NULAS en 212/212, y work_orders.fecha_vencimiento con valor en
// 212/212. O sea que lo que hay en la base son FECHAS SIN HORA.
//
// EL ERROR QUE ESTOS TESTS ATRAPAN, POR QUE ES FACIL DE COMETER Y POR QUE CUESTA UN DIA. La
// zona de la planta es America/Mexico_City (16-supabase-catalogo.js:429 y :441, y el default de
// 16-inspection-service.js). 2026-09-30T00:00:00+00:00 en Ciudad de Mexico es 2026-09-29
// 18:00, o sea que "aplicar la zona horaria" al leer MOVERIA LAS 1000 FECHAS UN DIA HACIA
// ATRAS. La regla que se aplica es la SIMETRICA con el escritor (supabase-writer.js instante(),
// que copia el criterio de isoFechaHora_ del RESTlet 2246,
// netsuite-restlet-unificado-supabase.js:396): la hora de pared se escribio como UTC, asi que
// se relee en UTC, partiendo el texto y sin tocar el offset.

test("una fecha a medianoche UTC devuelve la fecha y la HORA VACIA, no 00:00", () => {
  const medianoche = reader.partirFechaTexto("2026-09-30T00:00:00+00:00");
  assert.equal(medianoche.fecha, "2026-09-30");
  assert.equal(medianoche.hora, "", "medianoche es que la app NO TENIA hora, no una operacion a las 00:00");
  // Las dos formas que hay en la base dan lo mismo, porque son el mismo instante escrito por
  // dos escritores distintos: el +00:00 de la ingesta (isoFechaHora_ con Date.UTC) y el
  // .000Z del escritor de la pagina (toISOString).
  assert.deepEqual(
    copiar(reader.partirFechaTexto("2026-09-30T00:00:00.000Z")),
    { fecha: "2026-09-30", hora: "" }
  );
  // Y una fecha sin hora, que es como la hoja la guarda.
  assert.deepEqual(copiar(reader.partirFechaTexto("2026-10-01")), { fecha: "2026-10-01", hora: "" });
  assert.deepEqual(copiar(reader.partirFechaTexto("2026-10-01 00:00:00")), { fecha: "2026-10-01", hora: "" });
  // Sin valor: vacio en los dos, y no una fecha inventada.
  assert.deepEqual(copiar(reader.partirFechaTexto(null)), { fecha: "", hora: "" });
  assert.deepEqual(copiar(reader.partirFechaTexto("")), { fecha: "", hora: "" });
});

test("un valor con hora distinta de medianoche devuelve ESA hora", () => {
  assert.deepEqual(
    copiar(reader.partirFechaTexto("2026-09-30T08:30:00+00:00")),
    { fecha: "2026-09-30", hora: "08:30" }
  );
  assert.deepEqual(
    copiar(reader.partirFechaTexto("2026-09-30T08:30:00.000Z")),
    { fecha: "2026-09-30", hora: "08:30" }
  );
  // A "HH:MM", que es lo que el estado guarda en HORA_INICIO/HORA_FIN: una hora con un digito
  // se rellena, los segundos se pierden porque no hay donde ponerlos.
  assert.equal(reader.partirFechaTexto("2026-09-30T8:05:00+00:00").hora, "08:05");
  assert.equal(reader.partirFechaTexto("2026-09-30T08:05:59+00:00").hora, "08:05");
  assert.equal(reader.partirFechaTexto("2026-09-30 23:59").hora, "23:59");
  // Medianoche CON segundos no es una ausencia: hay hora, y 00:00 es su HH:MM. La regla de
  // medianoche es de 00:00:00, que es lo que produce el escritor cuando no hay hora.
  assert.equal(reader.partirFechaTexto("2026-09-30T00:00:30+00:00").hora, "00:00");
});

test("NINGUN valor se convierte de zona: un T00:00:00+00:00 conserva su dia", () => {
  // El dia que se pierde al convertir es el dia 30. Se mide aqui con Intl para que el test no
  // dependa de una suposicion sobre la zona: en America/Mexico_City, este valor es el dia 29.
  assert.equal(
    new Date("2026-09-30T00:00:00+00:00").toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" }),
    "2026-09-29",
    "la conversion que el lector NO hace: por eso la fecha leida tiene que ser la del 30"
  );
  assert.equal(reader.partirFechaTexto("2026-09-30T00:00:00+00:00").fecha, "2026-09-30", "sin aplicar la zona de la planta");
  // Las cuatro fechas de una fila real, con la forma medida.
  const [op] = reader.mapOperations([
    { operation_id: "ns-1", fecha_inicio: "2026-09-30T00:00:00+00:00", fecha_fin: "2026-12-31T00:00:00+00:00" },
  ]);
  assert.equal(op.fechaInicio, "2026-09-30", "el 30, no el 29");
  assert.equal(op.fechaFin, "2026-12-31", "tampoco el 31 de diciembre se corre al 30");
  assert.equal(op.horaInicio, "", "y sin hora, porque el valor es medianoche");
  // Y las tres de work_orders, que es la otra mitad del mismo problema.
  const [wo] = reader.mapWorkOrders([
    { id: "uuid-1", wo_internal_id: "WO-1", ot: "OT-1", fecha_inicio_ns: "2026-09-30T00:00:00+00:00", fecha_vencimiento: "2026-10-01T00:00:00+00:00" },
  ]);
  assert.equal(wo.startDate, "2026-09-30");
  assert.equal(wo.dueDate, "2026-10-01");
});

test("las CUATRO fechas de operations salen del instante, y la hora solo si la hay", () => {
  const [op] = reader.mapOperations([
    {
      operation_id: "ns-4821-10",
      fecha_inicio: "2026-09-30T08:00:00+00:00", hora_inicio: "2026-09-30T08:00:00+00:00",
      fecha_fin: "2026-10-02T17:45:00.000Z", hora_fin: null,
    },
  ]);
  assert.equal(op.fechaInicio, "2026-09-30");
  assert.equal(op.horaInicio, "08:00", "la hora sale del instante que trae la columna");
  assert.equal(op.fechaFin, "2026-10-02");
  assert.equal(op.horaFin, "17:45", "y con hora_fin NULAS la hora sale de fecha_fin, que es el mismo instante");
  // hora_inicio y hora_fin son el MISMO instante que sus columnas de fecha (el escritor pone
  // hora_inicio = fecha_inicio, supabase-writer.js:530-534), asi que si la de fecha no trae
  // hora porque es medianoche, la repetida puede traeria.
  const [repetida] = reader.mapOperations([
    { operation_id: "ns-2", fecha_inicio: "2026-09-30T00:00:00+00:00", hora_inicio: "2026-09-30T08:30:00+00:00" },
  ]);
  assert.equal(repetida.fechaInicio, "2026-09-30");
  assert.equal(repetida.horaInicio, "08:30", "la hora la trae la columna repetida, no la de fecha");
  // Y si las dos traen una hora DISTINTA, manda la de fecha: es la columna que escribe la
  // ingesta del RESTlet 2246 (netsuite-restlet-unificado-supabase.js:163) y la que tiene las
  // 1000 filas medidas. Nunca se mezclan dos horas ni se promedian.
  const [dos] = reader.mapOperations([
    { operation_id: "ns-3", fecha_inicio: "2026-09-30T08:30:00+00:00", hora_inicio: "2026-09-30T22:00:00+00:00" },
  ]);
  assert.equal(dos.horaInicio, "08:30");
  // Sin ninguna de las dos columnas: vacio, que es lo que hay en 1000/1000.
  const [nada] = reader.mapOperations([{ operation_id: "ns-4", fecha_inicio: null, hora_inicio: null, fecha_fin: null, hora_fin: null }]);
  assert.deepEqual(
    copiar([nada.fechaInicio, nada.horaInicio, nada.fechaFin, nada.horaFin]),
    ["", "", "", ""]
  );
});

test("las TRES fechas de work_orders usan la misma regla que las de operations", () => {
  // MEDIDO 2026-09-29: las dos primeras NULAS en 212/212 y la tercera con valor.
  const [medida] = reader.mapWorkOrders([
    { id: "uuid-1", ot: "OT-1", fecha_inicio_ns: null, fecha_fin_ns: null, fecha_vencimiento: "2026-09-30T00:00:00+00:00" },
  ]);
  assert.equal(medida.startDate, "", "nula es vacio, no una fecha inventada");
  assert.equal(medida.endDate, "");
  assert.equal(medida.dueDate, "2026-09-30");
  // Si una llegara con hora, la fecha se queda igual: PP_mapWorkOrder_ (02-storage.js:2179) no
  // tiene un campo de hora para una orden, y aqui no se inventa uno.
  const [conHora] = reader.mapWorkOrders([{ id: "uuid-2", ot: "OT-2", fecha_vencimiento: "2026-09-30T18:03:11+00:00" }]);
  assert.equal(conHora.dueDate, "2026-09-30", "la hora no se cuela en la fecha");
  // Y una fecha con la forma del escritor tambien entra igual.
  const [conZ] = reader.mapWorkOrders([{ id: "uuid-3", ot: "OT-3", fecha_inicio_ns: "2026-09-30T00:00:00.000Z" }]);
  assert.equal(conZ.startDate, "2026-09-30");
});

test("un valor con zona explicita se devuelve TAL CUAL, con sus cifras", () => {
  // Un -06:00 no se desplaza ni a la zona de la planta ni a UTC: se leen los numeros del
  // texto, porque aplicar el offset seria una conversion que nadie pidio.
  const conOffset = reader.partirFechaTexto("2026-09-30T08:30:00-06:00");
  assert.equal(conOffset.fecha, "2026-09-30");
  assert.equal(conOffset.hora, "08:30");
  assert.deepEqual(copiar(reader.partirFechaTexto("2026-09-30T08:30:00-0600")), { fecha: "2026-09-30", hora: "08:30" });
  // Formato raro: se devuelve entero en la fecha y con la hora vacia. Se puede ver raro en la
  // pagina, y eso es mejor que una fecha que nadie escribio.
  assert.deepEqual(copiar(reader.partirFechaTexto("30/09/2026")), { fecha: "30/09/2026", hora: "" });
  assert.deepEqual(copiar(reader.partirFechaTexto("2026-13-45")), { fecha: "2026-13-45", hora: "" });
  assert.deepEqual(copiar(reader.partirFechaTexto("no es una fecha")), { fecha: "no es una fecha", hora: "" });
  // Una hora fuera de rango NO se normaliza con un Date, que correria el dia entero: se deja
  // vacia y la fecha del texto se conserva.
  const fuera = reader.partirFechaTexto("2026-09-30T25:00:00+00:00");
  assert.equal(fuera.fecha, "2026-09-30", "ni la fecha se rodia a 26 ni a 01");
  assert.equal(fuera.hora, "");
});

test("retirada_en y retirada_por se leen cuando existen, y no se inventan cuando no", () => {
  // MEDIDO 2026-09-29: las columnas NO estan en el esquema desplegado; las agrega
  // docs/schema-supabase-plan.sql:434-435, que sigue sin aplicar. Y NO estan declaradas
  // ausentes en MAPPING_GAPS, a proposito: el lector ya sabe leerlas, asi que no son un hueco
  // de mapeo, y declararlas faltantes diria justo lo contrario, que el dato no se puede traer.
  // Por eso tampoco estan en PENDIENTES_DEL_PLAN, que es la lista de huecos de mapeo: la
  // contraprueba de que el DDL sigue sin aplicar la hace el test de mas abajo.
  const declaradas = huecos().filter((hueco) => hueco.columna === "retirada_en" || hueco.columna === "retirada_por");
  assert.deepEqual(declaradas.map((hueco) => `${hueco.tabla}.${hueco.columna}`), [], "el lector sabe leerlas: no son un hueco");
  // Sin columna (que es el estado de HOY) el campo NO se rellena: un "" afirmaria que la
  // operacion esta en el plan, que es lo que el comentario del DDL define como el null.
  const [sinColumna] = reader.mapOperations([{ operation_id: "ns-1" }]);
  assert.equal(sinColumna.retiradaEn, undefined);
  assert.equal(sinColumna.retiradaPor, undefined);
  // Con columna: la marca viaja tal cual. retirada_en se devuelve como texto, sin partir y sin
  // convertir de zona, porque la escribe now() con zona REAL (no es una fecha sin hora) y
  // porque el estado no tiene campo donde ponerla (comentario del DDL, lineas 437-440).
  const [marcada] = reader.mapOperations([
    { operation_id: "ns-2", retirada_en: "2026-09-29T18:03:11.234+00:00", retirada_por: "persona@ejemplo.com" },
  ]);
  assert.equal(marcada.retiradaEn, "2026-09-29T18:03:11.234+00:00", "sin convertir de zona y sin partir");
  assert.equal(marcada.retiradaPor, "persona@ejemplo.com");
  // Null es la marca limpia: la operacion esta en el plan, y eso si se puede decir con "".
  const [enPlan] = reader.mapOperations([{ operation_id: "ns-3", retirada_en: null, retirada_por: null }]);
  assert.equal(enPlan.retiradaEn, "");
  assert.equal(enPlan.retiradaPor, "");
  // Y la marca NO decide nada: el lector no quita la operacion del plan ni arma una lista de
  // retiradas. Que una retirada saque la operacion de la vista es de la pagina, no de aqui.
  assert.equal(enPlan.id, "ns-3", "la operacion sigue en la lista que devuelve el lector");
  assert.equal(enPlan.ot, "");
});

test("retirada_en y retirada_por SIGUEN sin existir en el esquema medido", () => {
  // Si el dia que se aplique el DDL esto falla, que es lo que tiene que pasar: la rama de las
  // marcas pasa a ejecutarse en TODAS las filas y hay que decidir que hace la pagina con ellas.
  // Si el esquema medido no estuviera, esto NO puede seguir en verde: seria una comprobacion
  // apagada sin avisar. Se falla en vez de saltarse.
  if (!ESQUEMA) throw new Error("falta docs/esquema-supabase-medido.json: la red general no se puede comprobar");
  for (const columna of ["retirada_en", "retirada_por"]) {
    assert.equal(
      columnasDe("operations").has(columna),
      false,
      "docs/schema-supabase-plan.sql ya esta aplicado: hay que decidir que hace la pagina con las marcas de retirada"
    );
  }
});

test("el hueco de FORMA de las fechas dice la REGLA, no 'no se sabe'", () => {
  // Lo que QUEDA del hueco viejo no es 'falta la forma y no se sabe como': es que la columna es
  // timestamptz y el estado espera texto, y eso se resuelve con una regla. Si alguien deja de
  // lado el motivo y pone solo que falta, este test lo dice.
  const deOperations = MAPPING_GAPS.operations.filter((entrada) => entrada.includes("fecha_inicio"));
  assert.equal(deOperations.length, 1, "una sola entrada para las cuatro fechas de operations");
  assert.match(deOperations[0], /falta la FORMA de la columna fecha_inicio \|/);
  assert.match(deOperations[0], /sin convertir de zona/i, "el motivo tiene que decir la regla");
  assert.match(deOperations[0], /medianoche/, "y cuando la hora queda vacia");
  // Y lo mismo en work_orders, por las mismas tres columnas.
  const deWorkOrders = MAPPING_GAPS.work_orders.filter((entrada) => entrada.includes("fecha_inicio_ns"));
  assert.equal(deWorkOrders.length, 1);
  assert.match(deWorkOrders[0], /falta la FORMA de la columna fecha_inicio_ns \|/);
  assert.match(deWorkOrders[0], /sin convertir de zona/i);
});

test("el lector NO tiene maquinaria de zona horaria: ninguna fecha se puede convertir", () => {
  // Los tests de arriba comprueban COMO SE LEE HOY un valor. Este comprueba que la conversion no
  // se puede colar ni por error: no hay ninguna llamada en el codigo que la haga. Se quitan los
  // comentarios de linea, que es donde si se nombra 'new Date()' al explicar que no se usa.
  const codigo = readerSource.replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const llamada of ["new Date(", "Date.UTC", "toLocaleDateString", "toLocaleString", "getTimezoneOffset", "Intl."]) {
    assert.equal(codigo.includes(llamada), false, `el lector tiene ${llamada}: aplicaria una zona y moveria las fechas un dia`);
  }
});
