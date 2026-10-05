// =============================================================================
// `work_orders` TIENE QUE PODER RESPONDER "¿ESTA CERRADA ESTA OT?"
// =============================================================================
//
// QUE SE ROMPIO, MEDIDO 2026-10-05. Las OTs 3302, 3492 y 3570 del plan avisaban "INSPECCION 2
// OT SIN DATO DE NETSUITE ... OT NO ENCONTRADA". MEDIDO en las dos fuentes:
//
//   - NetSuite, por el `action: 'detail'` del RESTlet 2244 (que IGNORA onlyOpen y devuelve el
//     estatus crudo, la unica fuente capaz de esto), dice:
//         3302  "Orden de trabajo : Cerrada"  50 cant, 48 ensambladas, 2 pendientes, entrega 1-oct
//         3492  "Orden de trabajo : Cerrada"   2 cant,  2 ensambladas, 0 pendientes, entrega 1-oct
//         3570  "Orden de trabajo : Cerrada"   5 cant,  5 ensambladas, 0 pendientes, entrega 1-oct
//     y la lista abierta del mismo RESTlet trae 213 OTs, exactamente las 213 de `work_orders`.
//   - El espejo (2246, `leerWorkorders` con `soloAbiertos`) las filtra por estatus, asi que
//     sus filas nunca llegan a `work_orders`. Y `operations` SI las tiene: 40 filas (8 + 20 +
//     12) con `cant_pendiente` 50 / 2 / 5, escritas por la corrida del 2026-10-04T22:49:04Z.
//
// O sea: la OT que hay que CONFIRMAR que se cerro es, por construccion, la que no esta en la
// tabla. `confirmWorkOrderClosures` la buscaba ahi, no la encontraba nunca, devolvia
// `found:false` para siempre, y `reconcileActiveWorkOrders` no podia podar nada: las tres
// quedaron en el plan con operaciones viejas, y el reporte pedia PZAS de OTs ya cerradas
// (57 piezas fantasma, por la cascada `opPieces` de app.js:8532).
//
// Y habia un SEGUNDO defecto, mas pequeño y mas dificil de ver: el unico predicado de "cerrada"
// era `ESTADOS_CERRADOS.includes(estatus.toUpperCase())`, o sea igualdad EXACTA de cadena. El
// estatus de NetSuite nunca es la palabra pelada, es "Orden de trabajo : Cerrada", asi que
// aunque la fila estuviera presente la respuesta habria sido `closed:false`. No se noto
// mientras `work_orders` solo trajera abiertas: no habia ninguna cerrada que clasificar.
//
// QUE SE CIERRA AQUI, EN ORDEN.
//   1. El espejo trae tambien las OTs CERRADAS con su estatus real (ventana de 90 dias por
//      `t.enddate`, DECIDIDA POR EL USUARIO el 2026-10-05). Assert sobre el fuente del restlet:
//      no hay SuiteQL que se pueda correr desde aca.
//   2. El UNICO predicado de "cerrada" vive en el LECTOR y se publica (`workOrderCerrada`).
//      Las tres preguntas que lo necesitan -el catalogo de OTs, la confirmacion de cierres y la
//      lista de la hoja de inspeccion- son la misma pregunta, y con dos listas distintas se
//      contradecirian entre si.
//   3. El catalogo de OTs y el conjunto "activas" que usa `reconcileActiveWorkOrders` filtran
//      las cerradas: si una cerrada viniera como activa, no se podaria nunca del plan.
//   4. `confirmWorkOrderClosures` y `getInspectionWorkOrder` NO filtran: para esas dos la fila
//      completa es justamente la respuesta.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";

const raiz = new URL("../", import.meta.url);
const readerSource = await readFile(new URL("src/web/shared/supabase-reader.js", raiz), "utf8");
const puenteSource = await readFile(new URL("src/web/shared/supabase-bridge-replacement.js", raiz), "utf8");
const restletSource = await readFile(new URL("netsuite-restlet-supabase-sync.js", raiz), "utf8");
const ingestaSource = await readFile(new URL("src/server/19-appscript-ingesta-supabase.js", raiz), "utf8");

/** Levanta el LECTOR REAL: lo que se prueba es el predicado que la pagina va a usar. */
function lector() {
  const contexto = { console, JSON, Object, Array, Promise, Date, String, Number, Boolean, Error, Math, RegExp, isFinite, encodeURIComponent };
  contexto.globalThis = contexto;
  createContext(contexto);
  runInContext(readerSource, contexto, { filename: "supabase-reader.js" });
  return contexto.PPSupabaseReader;
}

const reader = lector();

/**
 * Levanta el REEMPLAZO DEL PUENTE con el lector real y `readTable` serviendo filas de mentira.
 * El orden importa: el reemplazo captura `root.PPSupabaseReader` al cargarse, asi que el
 * lector tiene que existir antes (si no, `getReader()` lanza y se estaria probando el camino
 * sin lector, que es como se cuelan los fallos de mapeo).
 */
function puente({ workOrders = [] } = {}) {
  const leidas = [];
  const contexto = {
    console, JSON, Object, Array, Promise, Date, String, Number, Boolean, Error, RegExp, isFinite,
    PPSupabaseReader: Object.assign(Object.create(null), reader, {
      // `readTable` respeta `filters.ot` como lo respeta PostgREST. Un stub que devolviera
      // la tabla entera haria que `getInspectionWorkOrder` se llevara la primera fila, y la
      // prueba pasaria probando OT equivocada.
      readTable: async (tabla, opciones) => {
        leidas.push(tabla);
        if (tabla !== "work_orders") return [];
        const ot = opciones && opciones.filters && opciones.filters.ot;
        if (!ot) return workOrders;
        const clave = String(ot).trim();
        return workOrders.filter((w) => String(w.ot).trim() === clave);
      },
    }),
  };
  contexto.globalThis = contexto;
  createContext(contexto);
  runInContext(puenteSource, contexto, { filename: "supabase-bridge-replacement.js" });
  return { api: contexto.PPSupabaseBridgeReplacement, leidas };
}

/**
 * Pasa un objeto de la vm a uno de este realm.
 *
 * POR QUE. Lo que devuelve el reemplazo se creo dentro del contexto de `node:vm`, asi que su
 * prototipo de objeto no es el de este archivo y `assert.deepEqual` los declara distintos
 * aunque tengan las mismas claves. Sin esto, una comparacion correcta falla y no dice nada.
 */
function plano(valor) {
  return JSON.parse(JSON.stringify(valor));
}

// Filas de `work_orders` como llegan de la tabla. Los tres estatus son MEDIDOS, con el prefijo
// que NetSuite pone delante de todos ellos.
const ABIERTA_EN_CURSO = { id: "w2624", ot: "2624", articulo: "C 590 UADA", descripcion: "ELBOW", cantidad: 30, cant_ensamblada: 0, cant_pendiente: 30, estatus: "Orden de trabajo : En curso", cliente: "ACME", fecha_vencimiento: "2026-07-20T00:00:00Z" };
const ABIERTA_LIBERADA = { id: "w2847", ot: "2847", articulo: "A-100", descripcion: "TUBO", cantidad: 10, cant_ensamblada: 4, cant_pendiente: 6, estatus: "Orden de trabajo : Liberada", cliente: "ACME", fecha_vencimiento: "2026-10-10T00:00:00Z" };
const CERRADA_3302 = { id: "w3302", ot: "3302", articulo: "C 590 UADA", descripcion: "ELBOW", cantidad: 50, cant_ensamblada: 48, cant_pendiente: 2, estatus: "Orden de trabajo : Cerrada", cliente: "ACME", fecha_vencimiento: "2026-10-01T00:00:00Z" };
const CERRADA_3492 = { id: "w3492", ot: "3492", articulo: "A-100", descripcion: "TUBO", cantidad: 2, cant_ensamblada: 2, cant_pendiente: 0, estatus: "Orden de trabajo : Cerrada", cliente: "ACME", fecha_vencimiento: "2026-10-01T00:00:00Z" };
const CERRADA_CANCELADA = { id: "w3570", ot: "3570", articulo: "B-200", descripcion: "ABRAZADERA", cantidad: 5, cant_ensamblada: 5, cant_pendiente: 0, estatus: "Orden de trabajo : Cancelada", cliente: "ACME", fecha_vencimiento: "2026-10-01T00:00:00Z" };

const TODAS = [ABIERTA_EN_CURSO, ABIERTA_LIBERADA, CERRADA_3302, CERRADA_3492, CERRADA_CANCELADA];

// =============================================================================
// 1. EL PREDICADO. Una palabra dentro del estatus, no igualdad de la cadena entera.
// =============================================================================

test("A. `workOrderCerrada` reconoce los estatus REALES de NetSuite", () => {
  // MEDIDO: los 213 estatus que hay hoy en `work_orders` son "Orden de trabajo : Liberada" y
  // "Orden de trabajo : En curso". Con el predicado viejo (`ESTADOS_CERRADOS.includes(estatus
  // .toUpperCase())`) estos tres casos de abajo dan false, y el de "Cerrada" tambien.
  assert.equal(reader.workOrderCerrada("Orden de trabajo : Cerrada"), true);
  assert.equal(reader.workOrderCerrada("Orden de trabajo : En curso"), false);
  assert.equal(reader.workOrderCerrada("Orden de trabajo : Liberada"), false);

  // Las cuatro palabras con las que el espejo y el lector coinciden. `leerWorkorders` excluye
  // %CLOSED%, %COMPLET%, %CERRAD% y %CANCEL%; si el lector no reconociera una de esas, la OT
  // saldria del espejo pero se seguiria contando como abierta en la pagina.
  for (const estatus of ["Orden de trabajo : Cerrada", "Closed", "Completada", "Order Complete",
    "Orden de trabajo : Cancelada", "CANCELLED"]) {
    assert.equal(reader.workOrderCerrada(estatus), true, `debería leer "${estatus}" como cerrada`);
  }
});

test("B. sin estatus no hay cierre, y las tildes no espantan la palabra", () => {
  assert.equal(reader.workOrderCerrada(""), false);
  assert.equal(reader.workOrderCerrada(null), false);
  assert.equal(reader.workOrderCerrada(undefined), false);
  assert.equal(reader.workOrderCerrada("   "), false);
  // La palabra se busca sin tildes porque el estatus viene de NetSuite y el del estado guardado
  // puede venir escrito por una persona.
  assert.equal(reader.workOrderCerrada("Órdenes de trabajo : cerráda"), true);
  assert.equal(reader.workOrderCerrada("En curso"), false);
});

test("C. `mapWorkOrders` marca `cerrada` sin tocar las cantidades", () => {
  const [abierta, cerrada] = reader.mapWorkOrders([ABIERTA_EN_CURSO, CERRADA_3302]);
  assert.equal(abierta.cerrada, false);
  assert.equal(cerrada.cerrada, true);
  // Lo que hace la hoja de inspeccion y la columna Ensamblado de Liberacion sale de aqui.
  assert.equal(cerrada.quantity, 50);
  assert.equal(cerrada.builtQuantity, 48);
  assert.equal(cerrada.pendingQuantity, 2);
  assert.equal(cerrada.status, "Orden de trabajo : Cerrada");
  // El estado sale tal cual, con el prefijo de NetSuite: la hoja lo muestra y las reglas lo
  // nombran. Normalizarlo aqui seria cambiar un dato que la pagina ya sabe leer.
  assert.equal(abierta.status, "Orden de trabajo : En curso");
});

test("D. `soloWorkOrdersAbiertas` deja fuera las cerradas y por el MOTIVO", () => {
  const abiertas = reader.soloWorkOrdersAbiertas(TODAS);
  assert.deepEqual(abiertas.map((wo) => wo.ot), ["2624", "2847"]);
  // Y sin la fila que se cierra, la lista abierta es la de siempre: 213 antes, las mismas 213
  // despues. Este es el numero del que depende la persona para saber si el taller se vacio.
  assert.equal(abiertas.length, 2);
});

// =============================================================================
// 2. LA CONFIRMACION DE CIERRES. Lo que antes no podia pasar: `closed: true`.
// =============================================================================

test("E. `confirmWorkOrderClosures` CONFIRMA el cierre si la fila esta", async () => {
  // ESTE es el arreglo. Con la fila cerrada presente y el predicado viejo, esto devolvia
  // `closed:false` porque comparaba "ORDEN DE TRABAJO : CERRADA" contra "CERRADA" con
  // igualdad exacta, y `reconcileActiveWorkOrders` nunca recibia `confirmedBySource`.
  const { api } = puente({ workOrders: TODAS });
  const r = await api.confirmWorkOrderClosures(["3302", "3492", "3570"]);

  assert.deepEqual(plano(r.results["3302"]), { ot: "3302", found: true, closed: true, status: "Orden de trabajo : Cerrada" });
  assert.equal(r.results["3492"].closed, true);
  assert.equal(r.results["3570"].closed, true, "Cancelada tambien es un cierre: sale del plan");
  assert.deepEqual(Object.keys(plano(r.results)).sort(), ["3302", "3492", "3570"]);
});

test("F. una OT que no esta en la tabla sigue siendo `found:false`, no `closed`", async () => {
  // "No la conozco" y "se cerro" NO son lo mismo. La OT que NetSuite todavia no devuelve
  // (una recien creada, o una de otra planta) tiene que quedar como desconocida: si se
  // declarara cerrada sin evidencia, se perderia del plan por una suposicion.
  const { api } = puente({ workOrders: TODAS });
  const r = await api.confirmWorkOrderClosures(["2624", "9999"]);

  assert.equal(r.results["2624"].closed, false, "esta en la tabla y en curso: sigue abierta");
  assert.equal(r.results["2624"].found, true);
  assert.equal(r.results["9999"].found, false);
  assert.equal(r.results["9999"].closed, false);
  assert.equal(r.results["9999"].status, "");
});

test("G. el STATUS que se devuelve es el de la fila, con el prefijo", async () => {
  const { api } = puente({ workOrders: TODAS });
  const r = await api.confirmWorkOrderClosures(["3302"]);
  assert.equal(r.results["3302"].status, "Orden de trabajo : Cerrada");
});

// =============================================================================
// 3. LO QUE NO PUEDE CONTENER CERRADAS: el conjunto activo del plan y la hoja.
// =============================================================================

test("H. `fetchNetSuiteWorkOrdersLite` devuelve SOLO abiertas: es el conjunto activo", async () => {
  // `reconcileActiveWorkOrders` (planning-workflow-core.js) compara el plan contra este
  // conjunto para saber que OTs siguen en el taller. Si una cerrada viniera aqui como activa,
  // NUNCA se podaria del plan: seria al reves de lo que se quiere.
  const { api } = puente({ workOrders: TODAS });
  const r = await api.fetchNetSuiteWorkOrdersLite();

  assert.deepEqual(r.workOrders.map((wo) => wo.ot), ["2624", "2847"]);
  assert.equal(r.previewComplete, true);
});

test("I. la lista de la hoja de inspeccion no ofrece OTs cerradas para imprimir", async () => {
  // Con `work_orders` trayendo cerradas, este filtro es el unico que impide que la persona
  // imprima la lista de trabajo de una OT que ya se cerro. Antes usaba `ESTADOS_CERRADOS
  // .includes(...)`, que con el prefijo de NetSuite nunca excluia nada.
  const { api } = puente({ workOrders: TODAS });
  const r = await api.getInspectionWorkOrders();

  assert.equal(r.ok, true);
  assert.deepEqual(r.data.map((wo) => wo.wo), ["2624", "2847"]);
  // Y las abiertas conservan su forma de hoja.
  assert.equal(r.data[0].article, "C 590 UADA");
  assert.equal(r.data[0].status, "Orden de trabajo : En curso");
});

test("J. `getInspectionWorkOrder` de una OT CERRADA devuelve las cantidades de verdad", async () => {
  // Esto es lo que se ve en produccion: el reporte pedia PZAS y "Ensamblado" de 3302, que
  // estan en la tabla y en el espejo con la fila de la OT cerrada. 50 - 48 = 2 pendientes,
  // que es lo que dice NetSuite, y no las 50 de `operations` que quedaron viejas.
  const { api } = puente({ workOrders: TODAS });
  const r = await api.getInspectionWorkOrder("3302");

  assert.equal(r.ok, true);
  assert.deepEqual(plano(r.data.workOrder), { quantity: 50, builtQuantity: 48, pendingQuantity: 2, status: "Orden de trabajo : Cerrada" });
});

test("J2. una OT abierta devuelve lo mismo que siempre", async () => {
  const { api } = puente({ workOrders: TODAS });
  const r = await api.getInspectionWorkOrder("2624");
  assert.deepEqual(plano(r.data.workOrder), { quantity: 30, builtQuantity: 0, pendingQuantity: 30, status: "Orden de trabajo : En curso" });
});

test("K. `getInspectionWorkOrder` de una OT que no existe SIGUE diciendo que no existe", async () => {
  // El significado del mensaje no se diluye con el arreglo: "OT no encontrada" es "no esta en
  // `work_orders`", y sigue siendo cierto. Lo que cambio es que una OT CERRADA ya no cae
  // aqui: cae en el caso de arriba, con su estatus.
  const { api } = puente({ workOrders: TODAS });
  const r = await api.getInspectionWorkOrder("9999");

  assert.equal(r.ok, false);
  assert.equal(r.error, "OT no encontrada");
  assert.equal(await api.getInspectionWorkOrder("  ").then((x) => x.error), "OT requerida");
});

// =============================================================================
// 4. EL ESPEJO. Assert sobre el fuente: desde aca no hay NetSuite que ejecutar.
// =============================================================================

test("L. la ventana de cerradas son 90 dias, y es un parametro con nombre", () => {
  const ventana = restletSource.match(/const DIAS_OT_CERRADAS = (\d+);/);
  assert.ok(ventana, "DIAS_OT_CERRADAS tiene que existir y estar nombrada: 90 dias es la decision del usuario, no un numero suelto");
  assert.equal(ventana[1], "90", "la ventana se decidio en 90 dias (2026-10-05) y no se cambia sin avisar");
  assert.match(restletSource, /t\.enddate >= SYSDATE - ' \+ DIAS_OT_CERRADAS/);
});

test("M. la lectura de CERRADAS NO puede tirar la acción `workorders`", () => {
  // El riesgo medido: si la acción `workorders` falla, la ingesta VACIA `work_orders` completa
  // (RULE-SUP-048) y la pagina se queda sin una sola OT. `SYSDATE - 90` no se pudo verificar
  // desde el repo, asi que su fallo se degrada a "solo abiertas", que es como estaba antes.
  assert.match(restletSource, /try \{\s*cerradas = leerWorkordersCerradas_\(avisos\);\s*\} catch \(error\) \{/,
    "la consulta de cerradas tiene que ir en su propio try/catch, con su aviso");
  assert.match(restletSource, /No se pudieron leer las OTs CERRADAS/);
  assert.match(restletSource, /cerradas = \[\];/);
});

test("N. las cerradas solo entran en el BARRIDO, no en una sincronizacion por OT", () => {
  // Con `folios` o `workorderIds`, el que llama quiere exactamente esas OTs (la sincronizacion
  // delta por OT, RULE-SUP-047). Agregarles 90 dias de cerradas seria ruido ademas de romper
  // el significado de la llamada.
  assert.match(restletSource, /if \(ctx\.soloAbiertos && ctx\.ids\.workorderIds\.length === 0 && ctx\.folios\.length === 0\) \{/);
});

test("O. el recorte tiene tope propio y las MAS recientes se leen primero", () => {
  // Tope separado del de abiertas: 300 vs 500. Si compartieran, un trimestre con muchas
  // cerradas se comería el lugar de las abiertas, que son las que la pagina necesita. Y el
  // ORDER BY pone las recientes primero, para que si hay que recortar se pierdan las viejas.
  assert.match(restletSource, /maxScan: 500,\s*maxScanCerradas: 300, porId: 'workorderIds'/);
  assert.match(restletSource, /'ORDER BY fecha_fin DESC NULLS LAST, ot'/);
  // La consulta de abiertas no tenia ORDER BY y su recorte era `slice(0, maxScan)` sobre un
  // orden arbitrario. Con 213 de 500 nunca se noto; si hubiera mas, se caerian OTs al azar.
  assert.match(restletSource, /'ORDER BY t\.tranid'/);
  assert.match(restletSource, /const COLUMNAS_WORKORDERS = \[/,
    "las columnas viven en una constante: dos copias de la lista de columnas es como una empieza a traer algo y la otra no");
});

test("P. las cerradas van en la MISMA acción, no en una segunda que pelee con el mirror", () => {
  // La ingesta escribe con `ingesta_mirror`, que BORRA la tabla completa y reescribe. Si
  // `work_orders` recibiera dos acciones, la segunda se comería a la primera. Por eso las
  // cerradas van dentro de `workorders`: una acción, una tabla, una reescritura.
  assert.match(restletSource, /recorte\.concat\(cerradas\)\.map\(/,
    "las filas cerradas se suman a las abiertas ANTES de mapear, no en una llamada aparte");
  assert.match(restletSource, /notas: \{[\s\S]*cerradas: \{\s*incluidas: cerradas\.length/,
    "el numero de cerradas va en las notas: si no, `work_orders` parece crecer sin que nadie haya creado OTs");
  const tablas = ingestaSource.match(/const TABLAS = \{([\s\S]*?)\n  \};/);
  assert.ok(tablas, "TABLAS de la ingesta tiene que estar");
  assert.equal(/workorders_cerradas/.test(tablas[1]), false,
    "una segunda accion que escribiera en `work_orders` se comeria a la primera en el mirror atomico");
  assert.equal(/workorders: \{ tabla: 'work_orders'/.test(tablas[1]), true);
});
