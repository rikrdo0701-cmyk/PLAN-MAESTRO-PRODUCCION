// EL BORRADO A PROPOSITO, EJECUTADO (RULE-SUP-061).
//
// Este archivo es la prueba que faltaba: EJECUTA la rama de escritura de guardarCatalogos
// con intencion registrada, con intencion ausente, con la fila vuelta a agregar y con un
// DELETE fallido. El candado de fuente (borrado-apagado.test.mjs) dice lo que solo se ve
// leyendo; aqui se corre el codigo de verdad con un fetch de mentira que guarda cada
// peticion.
//
// LO QUE SE PROTEGE, EN UNA LINEA: solo borra una clave que un handler de la pagina registro
// como quitada a proposito en ESTA sesion. La diferencia entre lo leido al arrancar y lo que
// hay (antes: 76 filas de ot_configurations el 2026-09-30) no manda NINGUNA peticion: solo
// un aviso que dice "NO se tocan".
//
// LOS CASOS, Y POR QUE ESTA CADA UNO:
//   1. con intencion: DELETE por la clave natural, sube primero y borra despues, informe con
//      borradas, registro limpio. Y sin clavesLeidas: el borrado NO depende de esa lista.
//   2. sin intencion: ni un DELETE, aunque la diferencia exista, y el aviso lo dice.
//   3. quitar y volver a agregar antes de guardar: la intencion se anula, no se borra nada.
//   4. DELETE que falla (403, no se reintenta): la intencion QUEDA pendiente, el informe
//      señala el borrado y no la subida, y el siguiente guardado la reintenta y la limpia.
//   5. la clave registrada es la MISMA que sube la fila (roundtrip del mapeo), incluida la
//      compuesta de calendar_exceptions y el toUpperCase de machine_planning_overrides.
//   6. borrar una maquina apartada: las DOS filas (catalogo y override).
//   7. los dos avisos de un mismo guardado se separan: lo borrado a proposito dice
//      "A PROPOSITO", lo que el navegador no tiene dice "NO se tocan" y no lo incluye.
//   8. sin puerta no hay intencion: matrix, ot_configurations y tablas inexistentes dan null.
//   9. ot_configurations NO persiste el residuo derivado (config sin contenido y sin marca
//      de edicion: la deriva normalize de una OT que nunca tuvo fila), pero SI escribe la
//      config que la persona VACIO a proposito (updatedAt la marca) y la que tiene contenido.
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

/** El mismo arnes que supabase-writer.test.mjs: fetch de mentira, todo queda en
 *  `llamadas` para afirmar sobre QUE se escribio. `responder` decide la respuesta. */
function escritor({ token = JWT_FALSO, responder = null } = {}) {
  const llamadas = [];
  const contexto = {
    console,
    AbortController, setTimeout, clearTimeout, Math, Date, JSON, Object, Array,
    Promise, String, Number, Boolean, Error, RegExp, Set, isFinite, parseInt,
    encodeURIComponent,
    atob,
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
      if (responder) return responder(registro, llamadas.length);
      return contestando(204, "");
    },
  };
  contexto.globalThis = contexto;
  vm.createContext(contexto);
  vm.runInContext(fuente, contexto, { filename: "supabase-writer.js" });
  const writer = contexto.PPSupabaseWriter;
  writer.configure({ url: URL_FALSA, anonKey: CLAVE_FALSA });
  return { writer, llamadas, contexto };
}

/** Los catalogos que la pagina escribe, con los nombres de campo de PP_buildState_. */
function estadoCatalogos() {
  return {
    revision: 42,
    toolCatalog: [
      { id: "H-1", part: "C 590", herramental: "DOBLEZ", kitHerramental: "K-1", active: true },
      { id: "H-2", part: "C 610", herramental: "PLIEGUE", kitHerramental: "K-2", active: true },
    ],
    subcontracts: [
      { id: "LAMINADO", part: "*", name: "LAMINADO EXTERNO", days: 3, active: true },
    ],
    calendarExceptions: [
      { id: "ce-1", concept: "MANTENIMIENTO", machine: "AB11", startDate: "2026-10-10", start: "08:00",
        endDate: "2026-10-10", end: "17:00", reason: "Parada programada", active: true },
    ],
    machines: [
      { id: "39", active: true, excluded: false },
      { id: "40", active: true, excluded: true },
    ],
    operators: ["CORTADOR", "AJUSTADOR"],
    matrix: {},
    matrixFull: [],
    otConfigurations: {},
    articleConfigurations: {},
    operatorCapacity: {},
    operatorPerformance: {},
    operatorProfiles: {},
  };
}

const de = (llamadas, metodo, tabla) => llamadas.filter((c) => c.metodo === metodo && c.tabla === tabla);
const indiceDe = (llamadas, metodo, tabla) => llamadas.findIndex((c) => c.metodo === metodo && c.tabla === tabla);

test("con intencion registrada: DELETE por la clave, sube primero y limpia el registro, sin necesitar clavesLeidas", async () => {
  const { writer, llamadas } = escritor();
  const estado = estadoCatalogos();
  const quitado = estado.toolCatalog.find((t) => t.id === "H-1");
  // El handler registra ANTES de quitar (asi lo hace app.js).
  const clave = writer.registrarBorrado(estado, "tools", quitado);
  assert.equal(clave, "H-1", "la clave natural de tools es el codigo");
  estado.toolCatalog = estado.toolCatalog.filter((t) => t.id !== "H-1");

  // Sin clavesLeidas: el borrado por intencion no depende de esa lista (es solo el aviso).
  const informe = await writer.guardarCatalogos(estado);

  const deletes = de(llamadas, "DELETE", "tools");
  assert.equal(deletes.length, 1, "tiene que salir exactamente un DELETE");
  assert.match(deletes[0].url, /tools\?codigo=eq\.H-1$/, "el DELETE va por la clave natural");
  assert.ok(indiceDe(llamadas, "POST", "tools") >= 0, "la tabla que queda si se sube");
  assert.ok(indiceDe(llamadas, "POST", "tools") < indiceDe(llamadas, "DELETE", "tools"),
    "primero sube lo que queda, despues borra lo que quito: al reves seria escribir encima de lo viejo");
  const cuerpo = de(llamadas, "POST", "tools").pop().cuerpo;
  assert.ok(Array.isArray(cuerpo) && cuerpo.some((f) => f.codigo === "H-2"), "la que queda sube");
  assert.ok(!cuerpo.some((f) => f.codigo === "H-1"), "la quitada no sube");
  assert.equal(informe.ok, true);
  assert.equal(informe.tablas.tools.borradas, 1);
  assert.equal(estado.__borradosPendientes.tools, undefined,
    "la intencion sale del registro cuando el DELETE tuvo exito");
  assert.ok(informe.avisos.some((a) => a === "tools: 1 fila(s) borrada(s) A PROPOSITO de la base"),
    "el aviso dice que se borro a proposito: " + JSON.stringify(informe.avisos));
});

test("sin intencion: lo que el navegador no tiene NO recibe ni un DELETE, y el aviso lo dice", async () => {
  const { writer, llamadas } = escritor();
  const estado = estadoCatalogos();
  delete estado.subcontracts[0];
  estado.subcontracts = [];

  const informe = await writer.guardarCatalogos(estado, {
    clavesLeidas: { subcontracts: ["LAMINADO"], ot_configurations: Array.from({ length: 28 }, (_, i) => "OT-" + i) },
  });

  assert.equal(de(llamadas, "DELETE", "subcontracts").length, 0, "la diferencia no manda DELETE");
  assert.equal(de(llamadas, "DELETE", "ot_configurations").length, 0, "las 28 del ERP tampoco");
  assert.ok(informe.avisos.some((a) => a === "subcontracts: 1 fila(s) leidas que aqui NO estan; NO se tocan"),
    "el aviso de lo no tocado: " + JSON.stringify(informe.avisos));
  assert.ok(informe.avisos.some((a) => a === "ot_configurations: 28 fila(s) leidas que aqui NO estan; NO se tocan"),
    "el aviso de las 28 filas del ERP: " + JSON.stringify(informe.avisos));
  assert.equal(informe.ok, true, "sin intencion no hay nada que pueda fallar en borrado");
});

test("quitar y volver a agregar antes de guardar: la intencion se anula y no se borra nada", async () => {
  const { writer, llamadas } = escritor();
  const estado = estadoCatalogos();
  const quitado = estado.subcontracts[0];
  writer.registrarBorrado(estado, "subcontracts", quitado);
  // La persona se arrepintio y la volvio a agregar antes del guardado.
  estado.subcontracts.push(quitado);

  const informe = await writer.guardarCatalogos(estado);

  assert.equal(de(llamadas, "DELETE", "subcontracts").length, 0, "una fila que sigue viva no se borra");
  assert.equal(estado.__borradosPendientes.subcontracts, undefined,
    "la intencion anulada sale del registro: no queda rezagada para un guardado futuro");
  assert.equal(informe.ok, true);
});

test("si el DELETE falla, la intencion queda pendiente, el informe senala el borrado y el siguiente guardado reintenta", async () => {
  let falla = true;
  const { writer, llamadas } = escritor({
    responder: (registro) => {
      if (falla && registro.metodo === "DELETE" && registro.tabla === "subcontracts") {
        return contestando(403, "permission denied for table subcontracts");
      }
      return contestando(204, "");
    },
  });
  const estado = estadoCatalogos();
  const quitado = estado.subcontracts[0];
  writer.registrarBorrado(estado, "subcontracts", quitado);
  estado.subcontracts = [];

  const informe = await writer.guardarCatalogos(estado);

  assert.equal(informe.ok, false, "un DELETE fallido hace fallar el guardado de esa tabla");
  assert.ok(informe.tablas.subcontracts.errorDelete, "el error del DELETE va en su propio campo");
  assert.ok(!informe.tablas.subcontracts.errorPost,
    "y el error del borrado NO se cuela como error de subida");
  assert.equal(informe.tablas.subcontracts.paso, "borrado de lo que quitaste",
    "el toast tiene que decir que fallo el borrado, no la subida");
  assert.deepEqual(Array.from(estado.__borradosPendientes.subcontracts), ["LAMINADO"],
    "la intencion NO se limpia en el fallo: es lo que permite reintentar");

  // El siguiente guardado, con la base volviendo a contestar bien.
  falla = false;
  const informe2 = await writer.guardarCatalogos(estado);
  assert.equal(de(llamadas, "DELETE", "subcontracts").length, 2, "el reintento manda el DELETE otra vez");
  assert.equal(informe2.ok, true);
  assert.equal(informe2.tablas.subcontracts.borradas, 1);
  assert.equal(estado.__borradosPendientes.subcontracts, undefined, "y al exito si se limpia");
});

test("la clave registrada es LA MISMA que sube la fila (roundtrip del mapeo y de claveDeFila)", () => {
  const { writer } = escritor();
  const estado = estadoCatalogos();
  const armado = writer.armarCatalogos(estado);

  // Cada item, quitado del estado, registra exactamente la clave con la que su fila subio.
  const casos = [
    ["tools", estado.toolCatalog[1], armado.tools.claves],
    ["subcontracts", estado.subcontracts[0], armado.subcontracts.claves],
    ["calendar_exceptions", estado.calendarExceptions[0], armado.calendar_exceptions.claves],
    ["machine_catalog", estado.machines[0], armado.machine_catalog.claves],
    ["machine_planning_overrides", estado.machines[1], armado.machine_planning_overrides.claves],
    ["operators", "CORTADOR", armado.operators.claves],
  ];
  for (const [tabla, item, claves] of casos) {
    const clave = writer.registrarBorrado(estado, tabla, item);
    assert.ok(clave, tabla + ": no registro clave");
    assert.ok(claves[clave], tabla + ": la clave registrada (" + clave +
      ") no es ninguna de las que sube la fila");
  }
  // La compuesta, explicita: fecha|concepto|maquina.
  assert.equal(writer.registrarBorrado(estado, "calendar_exceptions", estado.calendarExceptions[0]),
    "2026-10-10|MANTENIMIENTO|AB11");
  // machine_planning_overrides guarda el nombre en MAYUSCULAS.
  assert.equal(
    writer.registrarBorrado(estado, "machine_planning_overrides", { id: "mm-9", excluded: true }),
    "MM-9");
  // Una maquina NO apartada no tiene fila en overrides: no hay nada que registrar.
  assert.equal(
    writer.registrarBorrado(estado, "machine_planning_overrides", { id: "39", excluded: false }),
    null, "el mapeo no produce fila y por eso no se registra nada");
  // Duplicar el mismo registro no duplica la intencion.
  writer.registrarBorrado(estado, "subcontracts", estado.subcontracts[0]);
  writer.registrarBorrado(estado, "subcontracts", estado.subcontracts[0]);
  assert.deepEqual(Array.from(estado.__borradosPendientes.subcontracts), ["LAMINADO"],
    "la misma clave se anota una sola vez");
});

test("borrar una maquina apartada manda el DELETE de sus DOS filas", async () => {
  const { writer, llamadas } = escritor();
  const estado = estadoCatalogos();
  const quitada = estado.machines.find((m) => m.id === "40");
  // Asi lo hace el handler de app.js: catalogo siempre, overrides solo si estaba apartada.
  writer.registrarBorrado(estado, "machine_catalog", quitada);
  writer.registrarBorrado(estado, "machine_planning_overrides", quitada);
  estado.machines = estado.machines.filter((m) => m.id !== "40");

  const informe = await writer.guardarCatalogos(estado, {
    clavesLeidas: { machine_catalog: ["39", "40"], machine_planning_overrides: ["39", "40"] },
  });

  const delCatalogo = de(llamadas, "DELETE", "machine_catalog");
  const delOverrides = de(llamadas, "DELETE", "machine_planning_overrides");
  assert.equal(delCatalogo.length, 1);
  assert.match(delCatalogo[0].url, /nombre=eq\.40$/);
  assert.equal(delOverrides.length, 1);
  assert.match(delOverrides[0].url, /machine_nombre=eq\.40$/);
  assert.equal(informe.tablas.machine_catalog.borradas, 1);
  assert.equal(informe.tablas.machine_planning_overrides.borradas, 1);
  assert.equal(informe.ok, true);
  // machine_catalog: 39 sigue en el estado y 40 salio por intencion, asi que su aviso de
  // "NO se tocan" NO aparece: lo borrado a proposito no se cuenta dos veces.
  assert.equal(informe.avisos.filter((a) => a.startsWith("machine_catalog:") && a.includes("NO se tocan")).length, 0,
    "lo que se borro a proposito no se cuenta tambien como no tocado: " + JSON.stringify(informe.avisos));
  // En machine_planning_overrides si queda UNA fila fuera: la legacy 39 con excluida = false,
  // que el navegador no mapea (mapear solo las apartadas). Cuenta 1, no 2: la 40 no se duplica.
  assert.ok(
    informe.avisos.includes("machine_planning_overrides: 1 fila(s) leidas que aqui NO estan; NO se tocan"),
    "el aviso de lo no tocado tiene que contar solo la legacy: " + JSON.stringify(informe.avisos));
  assert.ok(
    informe.avisos.includes("machine_catalog: 1 fila(s) borrada(s) A PROPOSITO de la base") &&
    informe.avisos.includes("machine_planning_overrides: 1 fila(s) borrada(s) A PROPOSITO de la base"),
    "y las dos filas borradas se dicen como tales: " + JSON.stringify(informe.avisos));
  assert.equal(Object.keys(estado.__borradosPendientes).length, 0,
    "los dos registros se limpian; el objeto vacio queda y no molesta");
});

test("un mismo guardado separa las dos especies: borradas A PROPOSITO vs leidas que NO se tocan", async () => {
  const { writer, llamadas } = escritor();
  const estado = estadoCatalogos();
  const quitado = estado.subcontracts[0];
  writer.registrarBorrado(estado, "subcontracts", quitado);
  estado.subcontracts = [];

  // Al arrancar se leyeron DOS: la que la persona quito (con intencion) y otra que el
  // navegador simplemente no tiene.
  const informe = await writer.guardarCatalogos(estado, {
    clavesLeidas: { subcontracts: ["LAMINADO", "OTRA"] },
  });

  assert.equal(de(llamadas, "DELETE", "subcontracts").length, 1, "solo la quitada");
  assert.ok(informe.avisos.some((a) => a === "subcontracts: 1 fila(s) borrada(s) A PROPOSITO de la base"),
    "falta el aviso de lo borrado: " + JSON.stringify(informe.avisos));
  assert.ok(informe.avisos.some((a) => a === "subcontracts: 1 fila(s) leidas que aqui NO estan; NO se tocan"),
    "falta el aviso de lo no tocado, y tiene que contar SOLO la otra: " + JSON.stringify(informe.avisos));
});

test("sin puerta de borrado no hay intencion: matrix y ot_configurations registran null", () => {
  const { writer } = escritor();
  const estado = estadoCatalogos();
  assert.equal(writer.registrarBorrado(estado, "matrix", { operator: "CORTADOR" }), null,
    "matrix se edita con banderas, no con ausencias");
  assert.equal(writer.registrarBorrado(estado, "ot_configurations", { ot: "3177" }), null,
    "ot_configurations es objeto y su pagina no tiene boton de borrar fila");
  assert.equal(writer.registrarBorrado(estado, "no-existe", {}), null, "tabla desconocida");
  assert.equal(writer.registrarBorrado(null, "subcontracts", {}), null, "estado nulo");
  assert.equal(estado.__borradosPendientes, undefined, "nada de lo anterior crea el registro");
});

test("ot_configurations no persiste el residuo derivado pero SI el vaciado a proposito", async () => {
  const { writer, llamadas } = escritor();
  const estado = estadoCatalogos();
  // Como las deja normalizeOtResourceAssignments: la derivada de una OT que nunca tuvo
  // fila ni edicion va SIN updatedAt; la que la persona VACIO lleva la marca de edicion
  // (app.js sella new Date().toISOString()); la de contenido se escribe siempre; y el kit
  // pendiente tampoco es residuo aunque todo lo demas este vacio.
  estado.otConfigurations = {
    "1000": { ot: "1000", machine: "", herramental: "", kitHerramental: "", kitPending: false,
      subcontractType: "", subcontractDays: 0, additionalHerramentales: [] },
    "2000": { ot: "2000", machine: "", herramental: "", kitHerramental: "", kitPending: false,
      subcontractType: "", subcontractDays: 0, additionalHerramentales: [],
      updatedAt: "2026-10-06T14:00:00.000Z" },
    "3000": { ot: "3000", machine: "42", herramental: "5 x 6", kitHerramental: "K1",
      kitPending: true, subcontractType: "", subcontractDays: 0, additionalHerramentales: [] },
    "4000": { ot: "4000", machine: "", herramental: "", kitHerramental: "", kitPending: true,
      subcontractType: "", subcontractDays: 0, additionalHerramentales: [] },
  };

  const armado = writer.armarCatalogos(estado);
  const ots = armado.ot_configurations.filas.map((f) => f.ot);
  assert.ok(!ots.includes("1000"), "el residuo derivado sin marca no se mapea: " + JSON.stringify(ots));
  assert.ok(ots.includes("2000"), "la config que se vacio a proposito SI se escribe (la marca lo distingue)");
  assert.ok(ots.includes("3000"), "la config con contenido se escribe");
  assert.ok(ots.includes("4000"), "kit pendiente no es residuo aunque el resto este vacio");
  assert.equal(armado.ot_configurations.claves["1000"], undefined, "el residuo tampoco queda en las claves");
  assert.ok(armado.ot_configurations.claves["2000"], "la vaciada si queda en las claves");

  // El guardado real: el POST de ot_configurations no lleva la 1000, si lleva las otras tres.
  const informe = await writer.guardarCatalogos(estado);
  const post = de(llamadas, "POST", "ot_configurations");
  assert.ok(post.length >= 1, "ot_configurations si sube");
  const subidas = post.pop().cuerpo.map((f) => f.ot);
  assert.ok(!subidas.includes("1000"), "la 1000 no sube: " + JSON.stringify(subidas));
  assert.ok(
    subidas.includes("2000") && subidas.includes("3000") && subidas.includes("4000"),
    "suben la vaciada, la de contenido y la del kit pendiente: " + JSON.stringify(subidas));
  assert.equal(informe.ok, true);
});

test("ot_configurations: la captura comercial POR OT se manda en sus columnas (RULE-OT-057)", () => {
  const { writer } = escritor();
  const estado = estadoCatalogos();
  // Una OT que SOLO tiene captura comercial (sin maquina/kit/herramental y sin updatedAt):
  // antes no existia columna y se perdia; ahora no es residuo y se escribe.
  estado.otConfigurations = {
    "5000": { ot: "5000", machine: "", herramental: "", kitHerramental: "", kitPending: false,
      subcontractType: "", subcontractDays: 0, additionalHerramentales: [],
      jobType: "plan", planningType: "produccion", manualUnitPrice: 2.5,
      commercialCapturedAt: "2026-10-10T00:00:00+00:00" },
  };
  const armado = writer.armarCatalogos(estado);
  const fila = armado.ot_configurations.filas.filter((f) => f.ot === "5000")[0];
  assert.ok(armado.ot_configurations.filas.length === 1,
    "la captura comercial sola no es residuo: " + JSON.stringify(armado.ot_configurations.filas));
  assert.equal(armado.ot_configurations.filas[0].tipo_ot, "PLAN", "jobType -> tipo_ot, en mayusculas");
  assert.equal(armado.ot_configurations.filas[0].tipo_trabajo, "PRODUCCION");
  assert.equal(armado.ot_configurations.filas[0].precio_manual, 2.5);
  assert.equal(armado.ot_configurations.filas[0].comercial_capturado_en, "2026-10-10T00:00:00.000Z",
    "la marca de captura se normaliza a instante ISO y es lo que evita el re-pedido");
});

test("app_state: prepared_planning_by_ot se manda en la fila (RULE-OT-057)", () => {
  const { writer } = escritor();
  const fila = writer.mapear.appState({ preparedPlanningByOt: { 100: "firma-100" } }, 7);
  assert.deepEqual(JSON.parse(JSON.stringify(fila.prepared_planning_by_ot)), { 100: "firma-100" });
  assert.equal(fila.revision, 7);
});
