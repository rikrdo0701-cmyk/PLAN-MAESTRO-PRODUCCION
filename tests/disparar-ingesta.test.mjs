// Candado de que los botones de sincronizacion DISPAREN LA INGESTA y no la releen.
//
// MEDIDO 2026-09-30, y por que este archivo existe. Con RULE-SUP-030 la app no habla con
// NetSuite: NetSuite carga a Supabase y la pagina lee de Supabase. Los botones Sincronizar y
// Sincronizar OTs se HABIAN QUEDADO COMO UN REREAD de las tablas: releian work_orders,
// operations y materials, y no pedian que NetSuite escribiera nada. O sea que un boton
// llamado Sincronizar no sincronizaba: ponia lo viejo otra vez, mas bonito. Y no hacia ruido,
// porque releer Supabase funciona y el boton decia que si.
//
// LO QUE ESTE TEST NO HACE. No llama a Apps Script ni comprueba que la ingesta escriba: eso no
// se puede desde un test, y un test que finge comprobarlo da verde sobre lo que no miro. Lo que
// SI comprueba son las cuatro cosas que hicieron que el boton fuera un reread y que pueden
// volver a serlo sin que nadie se entere: que el boton dispare, que el camino automatico NO
// dispare, que el POST llega como lo que Apps Script puede leer, y que un despliegue viejo sin
// doPost se reporte como lo que es.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";

const leer = (p) => readFile(new URL("../" + p, import.meta.url), "utf8").then((s) => s.replace(/\r\n/g, "\n"));

const app = await leer("src/web/planning/app.js");
const gate = await leer("src/web/shared/apps-script-ingesta-trigger.js");
const server = await leer("src/server/19-appscript-ingesta-supabase.js");
const storage = await leer("src/server/02-storage.js");
const build = await leer("scripts/build-appscript.mjs");
const puente = await leer("src/web/shared/apps-script-bridge-client.js");
const boot = await leer("src/web/shared/performance-client.js");

const LIMITE_TOAST = 110;

test("los DOS botones disparan la ingesta, y no la releen", () => {
  // El boton de OTs, con la opcion EXPLICITA. El listener no puede ser la funcion pelada:
  // el evento de click se pasaria como argumento y `options.dispararIngesta !== false` daria
  // true por casualidad y no por decision, que es la clase de valor por omision que nadie lee despues.
  assert.match(app, /els\.syncBacklogOtsBtn\.addEventListener\("click", \(\) => syncBacklogWorkOrders\(\{ dispararIngesta: true \}\)\)/,
    "el boton Sincronizar OTs tiene que pasar dispararIngesta:true de forma explicita");

  // El boton de dos fases dispara la ingesta ANTES de la primera lectura. Si fuera despues, la
  // pantalla quedaria con OTs viejas y operaciones nuevas, que es el estado que hace que un
  // plan parezca al dia y no lo este.
  const dosFases = app.slice(app.indexOf("async function syncNetSuiteTwoPhase("));
  const corte = dosFases.slice(0, dosFases.indexOf('setNetSuiteSyncPhaseLabel("Sincronizando OTs...")'));
  assert.match(corte, /correrIngestaPorBoton\(\)/,
    "en syncNetSuiteTwoPhase la ingesta tiene que ir antes de leer OTs, no entre las dos fases");
  assert.match(corte, /if \(ingesta && !ingesta\.seguir\)/,
    "y si la ingesta no puede seguir, no se lee ninguna de las dos fases");
  assert.match(app, /const outcome = await syncNetSuiteTwoPhase\(\{ dispararIngesta: true \}\)/,
    "el boton Sincronizar nombra la peticion; no se hereda por haber llegado aqui");

  // Y dentro de syncBacklogWorkOrders, la ingesta va antes de fetchNetSuiteWorkOrdersLite, que es
  // la lectura que trae las OTs. Al reves, el boton "sincroniza" y luego lee lo viejo.
  const sync = app.slice(app.indexOf("async function syncBacklogWorkOrders("));
  const cuerpo = sync.slice(0, sync.indexOf("function ensureNetSuiteWorkOrdersFresh"));
  assert.ok(cuerpo.indexOf("correrIngestaPorBoton()") < cuerpo.indexOf("fetchNetSuiteWorkOrdersLite"),
    "la ingesta tiene que dispararse antes de leer work_orders, no despues");
});

test("el camino AUTOMATICO no dispara la ingesta, y lo dice", () => {
  // Este es el candado mas importante del archivo, y va al reves que el anterior.
  // ensureNetSuiteWorkOrdersFresh corre sola antes de generar o publicar el plan cuando las OTs
  // tienen mas de NETSUITE_WORKORDER_FRESH_MS (15 min). Si esa comprobacion disparara la ingesta,
  // GENERAR EL PLAN gastaria una llamada al RESTlet y siete espejos a Supabase cada 15 minutos,
  // sin que nadie pulse nada, y tardaria minutos en arrancar. El boton es el que dispara; esta
  // comprobacion solo relee.
  assert.match(app, /const result = await syncBacklogWorkOrders\(\{ dispararIngesta: false \}\);/,
    "la comprobacion automatica tiene que leer sin disparar la ingesta");

  // MEDIDO 2026-09-30: la primera version de esto tenia el omision en TRUE (options.dispararIngesta
  // !== false). Con omision en true, cualquier llamador NUEVO gastaba una llamada al RESTlet y
  // siete espejos sin haberla pedido, que es la forma de que un gasto aparezca donde nadie lo
  // pidio. El omision va en false y la comparacion es `=== true`, o sea que no hay forma de
  // heredarlo por error: para dispararla hay que escribir la palabra.
  assert.match(app, /const dispararIngesta = options\.dispararIngesta === true;/,
    "el omision de syncBacklogWorkOrders tiene que ser NO disparar: releer es el fallo seguro, el RESTlet no");

  const auto = app.slice(app.indexOf("async function ensureNetSuiteWorkOrdersFresh"));
  const cuerpoAuto = auto.slice(0, auto.indexOf("function "));
  assert.ok(!/correrIngestaPorBoton/.test(cuerpoAuto),
    "ensureNetSuiteWorkOrdersFresh no puede llamar a la ingesta aunque sea por otro nombre");

  // El arranque tampoco. syncNetSuiteInBackground -> syncWorkOrdersOnce -> syncNetSuiteData, que
  // solo lee de Supabase. Si el boot disparara la ingesta, cargar la pagina gastaria el RESTlet.
  const fondo = app.slice(app.indexOf("function syncNetSuiteInBackground"));
  assert.ok(!/syncNetSuiteTwoPhase|ingesta/i.test(fondo.slice(0, 200)),
    "el sync de arranque no puede entrar por la sincronizacion en dos fases");
  assert.ok(!/PPIngestaTrigger|dispararIngesta/.test(boot),
    "performance-client.js (el arranque) no puede pedir la ingesta: arrancar la pagina no es sincronizar");
});

test("el POST va como text/plain, porque application/json no llega", () => {
  // MEDIDO: mandar application/json hace que el navegador mande un OPTIONS (preflight), porque
  // JSON no es un "simple request", y Apps Script no responde al preflight con cabeceras CORS.
  // El fetch muere sin respuesta y sin error: "Failed to fetch", indistinguible de una caida de
  // red. Con text/plain no hay preflight y el cuerpo llega crudo en postData.contents.
  assert.match(gate, /"Content-Type": "text\/plain;charset=utf-8"/,
    "el POST tiene que declarar text/plain, o el navegador manda un preflight que Apps Script no contesta");
  assert.match(gate, /credentials: "omit"/,
    "y sin credenciales, para que siga siendo peticion simple y no mande ninguna cookie de mas");

  // El cuerpo sigue siendo JSON, solo que como texto.
  assert.match(gate, /JSON\.stringify\(\{ accion: "ingesta", forzado: opciones\.forzado !== false \}\)/,
    "el cuerpo es JSON serializado, que es lo que doPost parsea de postData.contents");
});

test("`forzado` viaja en el cuerpo, o un boton a las 20:00 no sincroniza nada", () => {
  // ingesta() tiene un filtro de horario laboral (lunes a viernes, 7:00 a 17:00) que antes era un
  // `return` sin nada dentro de la funcion. Con el boton disparando la ingesta, ese return hacia
  // que a las 20:00 la corrida se saliera sin escribir, devolviera ok:true y el toast dijera que
  // se sincronizo: un exito FALSO con las OTs viejas en pantalla. Por eso el filtro es un
  // parametro (PP_ingesta_(forzado)) y el cuerpo lo manda en true.
  assert.match(gate, /forzado: opciones\.forzado !== false/,
    "el cliente tiene que pedir la corrida forzada; sin eso el filtro de horario se la salta");
  assert.match(server, /function PP_ingesta_\(forzado\)/,
    "el filtro de horario tiene que ser un parametro del cuerpo, no un return que no se puede saltar");
  assert.match(server, /if \(!forzado && \(dia === 0 \|\| dia === 6 \|\| hora < 7 \|\| hora >= 17\)\)/,
    "el filtro se salta SOLO cuando forzado es true, y el activador sigue sin saltarselo");
  assert.match(server, /function ingesta\(\) \{\n  return PP_ingesta_\(false\);\n\}/,
    "el activador de las 15 minutos entra por ingesta(), que NO fuerza: el horario sigue valiendo");
});

test("el veredicto se lee en json.ok, NUNCA en r.ok", () => {
  // Un web app en /exec no admite codigo de estado: ContentService responde 200 SIEMPRE. Si el
  // cliente juzgara por r.ok, un fallo de Supabase o del RESTlet se tragaria como una
  // sincronizacion buena y el toast diria "sincronizado" sobre tablas que no se tocaron.
  assert.match(gate, /if \(typeof json\.ok !== "boolean"\)/,
    "un cuerpo sin campo ok no es un veredicto: es un fallo de canal y hay que decirlo");
  assert.match(gate, /ok: json\.ok === true,/,
    "el ok que se devuelve sale de json.ok, del JSON que escribio el servidor");

  // r.ok se puede mirar en UN solo sitio, y solo para distinguir "no es JSON" de "error de
  // servidor". Este candado cuenta los usos en CODIGO (los comentarios van aparte, porque el
  // archivo explica por que r.ok no vale y ese texto no es un uso) para que anadir un segundo no
  // pase inadvertido.
  const codigo = gate.split("\n").filter((l) => !/^\s*\*/.test(l) && !/^\s*\/\//.test(l)).join("\n");
  const usos = codigo.match(/\br\.ok\b/g) || [];
  assert.equal(usos.length, 1,
    "r.ok aparece " + usos.length + " veces EN CODIGO. Solo puede aparecer dentro del mensaje de "
    + "'no es JSON': en cualquier otro sitio convierte un fallo en exito");
  assert.match(codigo, /const prefijo = r\.ok\n\s*\? "Apps Script respondio algo que no es JSON"/,
    "el unico uso de r.ok tiene que ser el del cuerpo que no es JSON");

  // Del lado del servidor: ok:false en cuanto una tabla falla. ingesta() recorre las siete tablas
  // en un bucle con try/catch por tabla y SIGUE, o sea que una sincronizacion a medias es un caso
  // real y no teorico.
  assert.match(server, /return \{ ok: errores\.length === 0, ejecutada: true/,
    "con una tabla que falla, la corrida se reporta como no ok; si no, el toast diria que se sincronizo");
});

test("una sincronizacion a medias NO se dice sincronizada, y su detalle no se corta", () => {
  // MEDIDO 2026-09-30: el primer toast de este caso llevaba las siete tablas con sus conteos y
  // eran 121 caracteres, o sea que se cortaba a media palabra. Por TERCERA vez en dos dias, con el
  // mismo motivo que las dos anteriores. El toast lleva la cuenta y el detalle va a #planAlerts.
  const literales = [...app.matchAll(/showToast\(`([^`]*)`/g)].map((m) => m[1]);
  // MEDIDO 2026-10-04: la busca por palabras sueltas (tocadas / filas al dia / tablas) y fallo al
  // cambiar el texto del toast a "N al dia, V vacias, S con lo anterior". Se busca por la MARCA
  // del aviso, que es lo que no cambia, para que el filtro no dependa de la redaccion.
  const conTablas = literales.filter((t) => /Ingesta a medias/.test(t));
  assert.ok(conTablas.length, "no se encontro el aviso de la ingesta a medias");
  // Las variables de estos avisos son CUENTOS de tablas espejo, y las tablas espejo son siete
  // (work_orders, operations, materials, items, machines, inventory, sales_orders), o sea que
  // caben en un digito. Expandir con "9" es el maximo real, no una prudencia: si alguien mete
  // una cadena en uno de estos avisos, este test lo va a tener que cambiar, que es justo lo que
  // tiene que pasar para que se note.
  const MAX_DIGITO = "9";
  for (const t of conTablas) {
    const expanding = t.replace(/\$\{\w+\}/g, MAX_DIGITO);
    assert.ok(expanding.length <= LIMITE_TOAST,
      'el aviso "' + t + '" mide ' + expanding.length + " caracteres como maximo y no cabe en un toast. "
      + "Se acorta el texto; el detalle largo va a setNetSuiteSyncAlert");
  }
  assert.match(app, /setNetSuiteSyncAlert\("Ingesta a medias/,
    "el detalle por tabla tiene que estar en el panel de alertas, que no se corta");
});

test("un despliegue viejo SIN doPost se reporta como eso, no como un fallo de NetSuite", () => {
  // MEDIDO 2026-09-30 contra el proyecto desplegado: la URL del web app sin doPost responde con
  // un 200 y el cuerpo de la pagina de error de Google, no un JSON ni un error HTTP. Sin este
  // caso, un despliegue viejo se veria como "la ingesta fallo" y llevaria a revisar NetSuite,
  // cuando el problema es que Apps Script esta en la version anterior.
  assert.match(gate, /No se encontro la funcion|No se encontr/i,
    "hay que reconocer la pagina de error de Google por su texto");
  assert.match(gate, /doPost/i,
    "y tiene que mencionar doPost: sin la palabra no se distingue de otro error de Apps Script");
  assert.match(gate, /function esFaltaDeDoPost\(texto\) \{\n\s*return \/no se encontr\/i\.test\(texto\) && \/doPost\/i\.test\(texto\)/,
    "los dos textos se buscan juntos, no por separado");
  assert.match(gate, /throw new Error\("Apps Script esta en la version de antes/,
    "el error tiene que decir que falta desplegar, que es lo que se puede arreglar");
});

test("la URL se pide al cliente del puente, y no se escribe a mano", () => {
  // La URL del web app la sustituye el build una sola vez, en apps-script-bridge-client.js. Si
  // aqui se escribiera a mano, un cambio de despliegue dejaria este modulo apuntando al proyecto
  // viejo: es el fallo que MEDIDO 2026-09-29 costo dos despliegues enteros ("Pushed 26 files" y
  // el proyecto con la version anterior).
  assert.match(gate, /PPAppsScriptBridge\.getBackendUrl/,
    "la URL se lee del cliente del puente, que es el unico sitio donde el build la sustituye");
  assert.doesNotMatch(gate, /script\.google\.com\/macros\/s\//,
    "este modulo no puede traer la URL escrita: seria una segunda configuracion que nadie mantiene");

  // Y que la URL siga siendo la misma que ya estaba en el bundle, sin una segunda puerta.
  assert.match(puente, /DEFAULT_WEB_APP_URL = "__PP_APPS_SCRIPT_WEB_APP_URL__"/,
    "la URL sigue viniendo del marcador que sustituye el build");
  assert.match(puente, /getBackendUrl: configuredUrl/,
    "y getBackendUrl sigue expuesto, que es de donde la toma el disparador de la ingesta");
});

test("el build mete el modulo en el bundle", () => {
  // MEDIDO: sin esto los botones siguen funcionando y NO hacen nada nuevo, porque no pueden
  // pedir la ingesta si PPIngestaTrigger no esta en el bundle. No es un fallo visible: el boton
  // sigue releyendo Supabase y sigue "sincronizando".
  assert.match(build, /read\("src\/web\/shared\/apps-script-ingesta-trigger\.js"\)/,
    "el build tiene que leer el modulo");
  assert.match(build, /ingestaTrigger\.trimEnd\(\)/,
    "y meterlo en runtimeClients, que es lo que va al bundle");
});

test("la corrida disparada no se puede solapar: hay cerrojo en el servidor", () => {
  // La URL del web app es publica (esta en el bundle, ANYONE_ANONYMOUS), asi que pedir una
  // corrida es una llamada al RESTlet. No se le pone secreto porque no hay forma de ocultarlo sin
  // escribirlo en el repo, que esta prohibido, y porque el puente que se deshabilito exponia 24
  // metodos sin ninguno. Lo que si tiene que haber es LockService: dos clics seguidos no pueden
  // ser dos llamadas al RESTlet, y la segunda tiene que decirlo con un motivo, no con un error
  // generico.
  assert.match(server, /LockService\.getScriptLock\(\)/,
    "sin cerrojo, dos peticiones simultaneas hacen dos llamadas al RESTlet");
  assert.match(server, /if \(!lock\.tryLock\(1000\)\)/,
    "y una segunda que llega mientras la primera corre tiene que salir por ahi");
  assert.match(server, /motivo: 'ocupada'/,
    "con un motivo dicho, para que la pagina pueda decir 'ya hay una ingesta corriendo'");
  assert.match(gate, /motivo === "ocupada"/,
    "y el cliente tiene que reconocer ese motivo, no tomarlo por un fallo cualquiera");
});

test("un corte de tiempo DICE lo que paso, no solo 'no se pudo'", () => {
  // Un AbortController cancela la peticion del cliente. La ingesta del servidor puede seguir
  // corriendo y completar el espejo, o puede haberse cortado a medias. Decir "no se pudo
  // sincronizar" y ya esta seria falso en los dos sentidos: la persona recargaria y veria datos
  // viejos sin saber si la corrida llego a hacer algo.
  assert.match(gate, /NOMBRE_FALLO_POR_TIEMPO/,
    "el corte de tiempo tiene su propio mensaje, y no uno generico");
  assert.match(gate, /error\.name === "AbortError"/,
    "hay que distinguir el corte de tiempo de una caida de red, que se corrige distinto");
  assert.match(gate, /revisa el contador de work_orders/,
    "y el mensaje dice como saber si la ingesta llego a completarse");
  // El techo va por debajo del limite del web app (6 min), no justo en el.
  assert.match(gate, /const TIEMPO_MAXIMO_MS = 330000;/,
    "el techo del cliente son 5 min 30 s, por debajo de los 6 min del web app, para que el corte lo decida el cliente y no el servidor");
  // MEDIDO 2026-09-30: app.js tenia su propia copia del techo (INGESTA_TIMEOUT_MS) y se la
  // pasaba al modulo. El modulo ya lo aplica con su AbortController, o sea que eran dos
  // numeros para una sola cosa, en dos archivos, y ademas el arnes de pruebas (que corta
  // funciones de app.js) se rompia con la constante que no tenia. El numero va en el modulo.
  assert.doesNotMatch(app, /INGESTA_TIMEOUT_MS/,
    "el techo del POST es del modulo, que lo aplica; app.js no repite el numero");
  assert.match(gate, /Number\(opciones\.timeoutMs\) > 0/,
    "y el modulo sigue aceptando un timeout propio para quien lo necesite, con ese como omision");
});

// =============================================================================
// MEDIDO 2026-10-02: EL ACTIVADOR DE 15 MIN NO DISPARA, Y NO HABIA NADA QUE LO DIJERA.
// =============================================================================
//
// LO QUE PASÃ“. Entre las 07:00 y las 17:00 de un viernes (America/Monterrey, UTC-6) el activador
// de la ingesta debio dispararse unas 21 veces. MEDIDO en Supabase: work_orders seguia con la
// escritura del 2026-10-01T05:40:21Z, o sea que no habia corrido ninguna. Y `clasp push` sube
// CODIGO pero NO crea activadores (son del proyecto, no del archivo), asi que la unica forma de
// saber si el activador estaba puesto era adivinarlo.
//
// QUE HACE ESTE TEST. getTriggerStatus() es SOLO LECTURA de ScriptApp.getProjectTriggers(): no
// crea ni borra nada, que para eso estan PP_creaTriggerIngesta_ y PP_borraTriggerIngesta_. Se
// prueba con un arnes que revienta si alguien llama a newTrigger o deleteTrigger, porque una
// lectura que termina creando un activador no es una lectura: seria la segunda forma de arreglar
// el sintoma sin querer y volveria a fallar en silencio.
//
// LO QUE NO PUEDE DECIR. Apps Script NO expone la proxima ejecucion de un activador de reloj, asi
// que el metodo no la inventa. Por eso estas pruebas tampoco la esperan.
const bridgeHtml = await leer("src/web/bridge/Bridge.html");

// El reloj va de mentira a proposito: getDay() y getHours() del proceso de test salen de la zona
// de la MAQUINA, no de la del script, y una prueba que depende de eso pasa en un huso y falla en
// otro. Se fija el dia y la hora que se quieren probar y se dice cual es.
function relojFalso(dia, hora) {
  return class {
    constructor() { this._dia = dia; this._hora = hora; }
    getDay() { return this._dia; }
    getHours() { return this._hora; }
    toISOString() { return "2026-10-02T00:00:00Z (reloj de mentira: dia " + this._dia + ", hora " + this._hora + ")"; }
  };
}

function estadoTrigger(activadores, dia, hora) {
  const ctx = createContext({
    console,
    JSON,
    Date: relojFalso(dia, hora),
    ScriptApp: {
      getProjectTriggers: () => activadores,
      newTrigger: () => { throw new Error("getTriggerStatus NO puede crear activadores"); },
      deleteTrigger: () => { throw new Error("getTriggerStatus NO puede borrar activadores"); }
    },
    Session: { getScriptTimeZone: () => "America/Monterrey" },
    PP_INGESTA_CADA_MINUTOS_: 15,
  });
  const cuerpo = server.slice(server.indexOf("function getTriggerStatus() {"),
                             server.indexOf("/** Borra los activadores de la ingesta."));
  runInContext(cuerpo, ctx);
  return ctx.getTriggerStatus();
}

function triggerDeIngesta(uid) {
  return { getHandlerFunction: () => "ingesta", getEventType: () => "CLOCK", getUniqueId: () => uid };
}

// dia 5 = viernes, 6 = sabado, 0 = domingo (getDay() de JavaScript).
test("el estado del activador dice que NO esta, y no se calla un 0", () => {
  // Viernes a las 10:00 de la zona del script.
  const r = estadoTrigger([], 5, 10);
  assert.equal(r.deIngesta, 0);
  assert.equal(r.dentroDeHorario, true, "un viernes a las 10:00 SI esta en horario, asi que el 0 no es por horario");
  assert.match(r.veredicto, /NO hay activador de ingesta/);
  assert.match(r.veredicto, /PP_creaTriggerIngesta_/, "y dice QUE EJECUTAR: un 0 sin nombre no se corrige");
});

test("un activador de mas se reporta como sobra, no se deja pasar", () => {
  // MEDIDO el riesgo: PP_creaTriggerIngesta_ borra los previos antes de crear, pero si alguien lo
  // creo de otra forma quedan dos y la ingesta corre el doble cada 15 minutos.
  const r = estadoTrigger([triggerDeIngesta("uid-1"), triggerDeIngesta("uid-2")], 5, 10);
  assert.equal(r.deIngesta, 2);
  assert.match(r.veredicto, /sobran 1/);
});

test("el activador puesto se reconoce, y la lectura NO crea ni borra nada", () => {
  // El arnes revienta si getTriggerStatus llama a newTrigger o deleteTrigger, asi que llegar aqui
  // ya prueba que no escribe. Esto fija ademas el texto del caso bueno, que es el que se va a leer
  // en produccion cuando el diagnostico diga que el problema NO es que falte el activador.
  const r = estadoTrigger([triggerDeIngesta("uid-1")], 5, 10);
  assert.equal(r.deIngesta, 1);
  assert.match(r.veredicto, /esta instalado/);
  assert.match(r.veredicto, /NO es que falte/, "y descarta la causa, para que se vaya a buscar a otro lado");
  assert.equal(r.cadaMinutos, 15);
  assert.equal(r.zona, "America/Monterrey");
});

test("fuera de horario lo dice, para que el cero de la madrugada no se lea como falla", () => {
  // MEDIDO antes: la ultima escritura fue un jueves a las 22:47 LOCALES, o sea fuera de horario,
  // forzada a mano. Sin esto, mirar un domingo y ver que no escribio no dice nada.
  assert.equal(estadoTrigger([triggerDeIngesta("u")], 6, 10).dentroDeHorario, false, "sabado");
  assert.equal(estadoTrigger([triggerDeIngesta("u")], 0, 10).dentroDeHorario, false, "domingo");
  assert.equal(estadoTrigger([triggerDeIngesta("u")], 5, 5).dentroDeHorario, false, "5:00 de la manana");
  assert.equal(estadoTrigger([triggerDeIngesta("u")], 5, 17).dentroDeHorario, false, "17:00 ya salio (hora >= 17)");
  assert.equal(estadoTrigger([triggerDeIngesta("u")], 5, 7).dentroDeHorario, true, "7:00 entra");
  assert.equal(estadoTrigger([triggerDeIngesta("u")], 5, 16).dentroDeHorario, true, "16:00 sigue dentro");
});

test("dentroDeHorario usa EL MISMO criterio que la ingesta, no una segunda regla", () => {
  // Si estas dos reglas se separan, el diagnostico y el comportamiento mienten por turnos. Se fija
  // el texto de la condicion real de PP_ingesta_ y se compara.
  assert.match(server, /if \(!forzado && \(dia === 0 \|\| dia === 6 \|\| hora < 7 \|\| hora >= 17\)\)/,
    "el criterio de horario de la ingesta es este; si cambia, tiene que cambiar tambien el diagnostico");
  assert.match(server, /const dentro = dia !== 0 && dia !== 6 && hora >= 7 && hora < 17;/,
    "y getTriggerStatus tiene que repetirlo EXACTAMENTE, no aproximado");
});

test("la lectura esta en la lista blanca del puente y no inventa la proxima ejecucion", () => {
  // MEDIDO: el puente es el unico camino por el que un metodo del servidor llega a la pagina. Un
  // metodo que no este en la lista responde 'no permitido', que es indistinguible de que no exista.
  assert.match(bridgeHtml, /getTriggerStatus: true/);
  const cuerpo = server.slice(server.indexOf("function getTriggerStatus() {"),
                              server.indexOf("/** Borra los activadores de la ingesta."));
  assert.ok(!/newTrigger|deleteTrigger/.test(cuerpo),
    "getTriggerStatus no puede crear ni borrar activadores: para eso estan PP_creaTriggerIngesta_ y PP_borraTriggerIngesta_, que se ejecutan a mano");
  assert.ok(!/getNextRunTime/.test(cuerpo),
    "y no puede inventar la proxima ejecucion: Apps Script no la expone para los activadores de reloj");
});

// =============================================================================
// MEDIDO 2026-10-04: LA CORRIDA NO DEJA VALORES PREVIOS, Y ADEMAS CONTABA MAL.
// =============================================================================
//
// QUE PIDE EL USUARIO, TEXTUAL. "TODAS LAS INGESTAS DEBERIAN BORRAR LOS VALORES PREVIOS Y
// REESCRIBIRSE", 2026-10-04. El RPC ya lo hacia por tabla (borra + inserta en una transaccion,
// docs/rpc-ingesta-mirror.sql:123) y eso lo vigilan las pruebas 3 y 4 de
// tests/rpc-ingesta-mirror.test.mjs. Lo que NO estaba era el caso de una tabla que ESTA
// CORRIDA no reescribio: la pagina de la ingesta hacia un continue silencioso y esa tabla
// conservaba los datos de la corrida anterior, que en pantalla es indistinguible de un dato
// al dia.
//
// LO QUE SE PRUEBA CON EL CODIGO REAL Y NO CON GREP. Estas pruebas levantan PP_ingesta_ en una
// vm con un espejo de mentira que SI IMPLEMENTA el borrado (la tabla se queda con el payload
// nuevo, o con cero si el payload viene vacio) y una base de datos de mentira con lo que habia
// de la corrida anterior. Asi se afirma el estado FINAL de cada tabla, que es lo que la regla
// prohibe: no que se llamo a una funcion, sino que quedo en la tabla.
//
// Y DE PASO, UN DEFECTO QUE ESTA EN ESTE ARCHIVO Y NO SE HABIA VISTO. El contador por tabla se
// llamaba filas, el mismo nombre que las filas que se escriben, y lo tapaba dentro del bucle:
// el return devolvia el ARREGLO de filas de la ultima tabla en vez del conteo. Se fijo con una
// prueba que falla con el nombre viejo.
const TABLAS_DE_LA_INGESTA = ["work_orders", "operations", "materials", "items", "machines", "inventory", "sales_orders"];

/**
 * Corre PP_ingesta_ de verdad. Devuelve { r, base, escrituras }.
 *
 * - acciones      : lo que "NetSuite" devuelve. Las claves son las del RESTlet (workorders,
 *                   operaciones, materiales, items, centros, inventario, ordenes_venta).
 * - previas       : lo que hay en la base ANTES de la corrida, tabla -> numero de filas.
 * - escribirFalla : tablas cuyo espejo revienta al escribir, para el caso en el que ni el
 *                   vaciado se puede hacer.
 * - vaciarFalla   : tablas cuyo espejo revienta al vaciar.
 */
function correrIngesta({ acciones, previas = {}, escribirFalla = [], vaciarFalla = [], saneaFalla = [] }) {
  const base = {};
  for (const t of TABLAS_DE_LA_INGESTA) base[t] = previas[t] || 0;
  const escrituras = [];
  const lineas = [];
  const contexto = {
    console: { log: (m) => lineas.push(String(m)) },
    JSON, Date, Object, Array, String, Number, Boolean, Error, RegExp, Math, encodeURIComponent,
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => "" }) },
    ScriptApp: { getProjectTriggers: () => [] },
    Session: { getScriptTimeZone: () => "America/Monterrey" },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: () => ({ setMimeType: () => {} }) },
    SUPABASE_URL: "https://ejemplo.supabase.co",
    SUPABASE_KEY: "service-role-de-mentira",
    UBICACION: 1,
  };
  contexto.globalThis = contexto;
  createContext(contexto);
  // `PP_bool_` (el saneo de booleanos) NO esta en el archivo de ingesta: vive en 02-storage.js y
  // los dos van al mismo proyecto de Apps Script. Se recorta DEL ARCHIVO, no se copia pegada: si
  // aqui fuera una reimplementacion, estas pruebas pasarian aunque la de 02-storage.js hiciera otra
  // cosa, y justo lo que se prueba es que el saneo usa la regla de la casa.
  const desdeBool = storage.indexOf("function PP_bool_(");
  const hastaBool = storage.indexOf("\n}", desdeBool) + 2;
  assert.ok(desdeBool > 0 && hastaBool > desdeBool, "no se pudo recortar PP_bool_ de 02-storage.js");
  runInContext(storage.slice(desdeBool, hastaBool), contexto, { filename: "02-storage.js:PP_bool_" });
  runInContext(server, contexto, { filename: "19-appscript-ingesta-supabase.js" });

  // Se sustituyen SOLO las tres fronteras: de donde salen los datos (el RESTlet), de donde sale
  // la configuracion y a donde se escribe (el espejo). Todo lo de en medio es el codigo real.
  contexto.PP_config_ = () => ({
    accountId: "TST", consumerKey: "ck", consumerSecret: "cs", token: "tk", tokenSecret: "ts",
    supabaseUrl: "https://ejemplo.supabase.co", supabaseKey: "service-role-de-mentira", ubicacion: 1,
  });
  contexto.PP_restletUnificado_ = () => ({ ok: true, acciones });
  contexto.PP_enrichPhotoRows_ = (filas) => ({ filas, conFoto: 0, sinFoto: filas.length });
  contexto.PP_photoMotivoCero_ = () => "";
  if (saneaFalla.length) {
    const sano = contexto.PP_saneaTipos_;
    contexto.PP_saneaTipos_ = (tabla, filas) => {
      if (saneaFalla.includes(tabla)) throw new Error("PP_bool_ is not defined");
      return sano(tabla, filas);
    };
  }
  // El espejo de mentira ES la regla: borra la tabla y escribe el payload. Con payload vacio
  // deja la tabla en cero, que es lo que hace el RPC real (docs/rpc-ingesta-mirror.sql:128).
  contexto.PP_supabaseMirror_ = (tabla, filas) => {
    const vacio = filas.length === 0;
    if (vacio && vaciarFalla.includes(tabla)) throw new Error("Supabase no responde (al vaciar)");
    if (!vacio && escribirFalla.includes(tabla)) throw new Error("columna no existe en materials");
    const borradas = base[tabla];
    base[tabla] = filas.length;
    // Se guarda el payload, no solo el conteo: hay pruebas que afirman sobre VALORES (por ejemplo
    // que una cadena vacia en una columna `integer` sale como 0 antes de llegar a Postgres), y un
    // conteo no las dejaria afirmar nada.
    escrituras.push({ tabla, enviadas: filas.length, borradas, filas: structuredClone(filas) });
    return { escritas: filas.length, borradas: borradas };
  };

  const r = contexto.PP_ingesta_(true);
  return { r, base, escrituras, lineas };
}

// Las siete acciones del RESTlet, con dos filas cada una y line_id ENTERO en materiales, que es
// la forma que escribe la ingesta (RULE-SUP-047).
function accionesCompletas() {
  const dos = (n) => Array.from({ length: 2 }, (_, i) => ({ clave: n + (i + 1) }));
  return {
    workorders: { ok: true, rows: [{ ot: "2121", articulo: "A" }, { ot: "2122", articulo: "B" }] },
    operaciones: { ok: true, rows: dos("ns-op") },
    materiales: { ok: true, rows: [{ ot: "2121", componente: "MP00094", line_id: "2" }, { ot: "2121", componente: "MP00095", line_id: "3" }] },
    items: { ok: true, rows: [{ codigo: "IT1" }, { codigo: "IT2" }] },
    centros: { ok: true, rows: [{ nombre: "CORTADOR" }, { nombre: "TORNEADO" }] },
    inventario: { ok: true, rows: [{ item: "IT1", ubicacion: "U1" }, { item: "IT2", ubicacion: "U1" }] },
    ordenes_venta: { ok: true, rows: [{ folio: "F1" }, { folio: "F2" }] },
  };
}

test("la ventana de OTs CERRADAS del 2246 queda saida en el LOG, y NO como error de corrida", () => {
  // MEDIDO 2026-10-05: el 2246 desplegado (`netsuite-restlet-unificado-supabase.js`) es el unico
  // que escribe `work_orders`, y su accion `workorders` ahora suma dos campos que la ingesta no
  // necesita para escribir pero que si hay que decir: `cerradas` (cuantas trayo la ventana de 90
  // dias, RULE-SUP-050) y `aviso` (que aparece SOLO si la consulta de cerradas fallo).
  const acciones = accionesCompletas();
  acciones.workorders.cerradas = { incluidas: 3, dias: 90, tope: 300 };
  acciones.workorders.aviso = "No se pudieron leer las OTs CERRADAS (Failed to parse SQL): se trajo solo las abiertas";
  const { r, base } = correrIngesta({ acciones, previas: { work_orders: 213 } });

  assert.equal(r.ok, true, "las abiertas si se escribieron: la corrida ES valida y no se declara falsa");
  assert.equal(base.work_orders, 2, "y work_orders quedo con las filas que si trajo el 2246");
  assert.ok(r.log.some((l) => /3 OTs cerradas de 90 dias/.test(l)),
    "el log dice cuantas cerradas entraron, que es la cifra que avisa si la ventana funciona: " + JSON.stringify(r.log));
  assert.ok(r.log.some((l) => /No se pudieron leer las OTs CERRADAS/.test(l)),
    "y el aviso pasa tal cual, con su POR QUE: " + JSON.stringify(r.log));
  assert.ok(!r.errores.some((e) => /CERRADAS/.test(e)),
    "pero NO es un error de corrida: ponerlo en `errores` diria que la ingesta fallo, y no fallo");
});

test("sin ventana declarada el log no inventa nada (el 2246 viejo no manda ese campo)", () => {
  const { r } = correrIngesta({ acciones: accionesCompletas() });
  assert.ok(!r.log.some((l) => /OTs cerradas/.test(l)),
    "si el RESTlet no declara `cerradas`, la bitacora no escribe una linea de cerradas: " + JSON.stringify(r.log));
});

test("una cadena vacia en una columna `integer` NO se va a escribir como cadena: sale 0 y se dice", () => {
  // MEDIDO 2026-10-05 07:52, en produccion y de verdad: 513 filas de `work_orders` (213 abiertas
  // + 300 cerradas), una de ellas con `cantidad` en "", Postgres 22P02 "invalid input syntax for
  // type integer", y RULE-SUP-048 vaciando la tabla: `work_orders` quedo en CERO filas. Un valor
  // mal escrito en una fila dejo a la pagina sin una sola OT.
  //
  // El DDL declara `cantidad integer not null default 0` (docs/schema-supabase.sql:179), asi que
  // el 0 es el valor por omision de la columna: la fila queda con el mismo dato que tendria si
  // nadie escribiera esa columna, y no con una cadena que Postgres rechaza.
  const acciones = accionesCompletas();
  acciones.workorders.rows = [
    { ot: "3302", articulo: "A", cantidad: "", estatus: "Orden de trabajo : Cerrada" },
    { ot: "3492", articulo: "B", cantidad: null, estatus: "Orden de trabajo : Cerrada" },
    { ot: "2624", articulo: "C", cantidad: 30, estatus: "Orden de trabajo : En curso" },
  ];
  const { r, escrituras } = correrIngesta({ acciones, previas: { work_orders: 213 } });

  assert.equal(r.ok, true, "la corrida es valida: no se perdio ninguna tabla");
  const escritura = escrituras.find((e) => e.tabla === "work_orders");
  assert.equal(escritura.enviadas, 3, "las tres filas entraron, la buena y las dos malas");
  assert.deepEqual(escritura.filas.map((f) => f.cantidad), [0, 0, 30]);
  for (const f of escritura.filas) {
    assert.equal(typeof f.cantidad, "number", "a Postgres le llega un numero, no una cadena: " + JSON.stringify(f.cantidad));
  }
  // Y se dice, con el nombre de la tabla y de la columna, porque un 0 sin explicación es un
  // dato que nadie va a suspectar.
  assert.ok(r.log.some((l) => /work_orders/.test(l) && /2 valores/.test(l) && /cantidad 2/.test(l)),
    "el log dice cuantas filas y que columna: " + JSON.stringify(r.log));
  assert.ok(!r.errores.some((e) => /work_orders/.test(e)), "y no es un error de corrida: " + JSON.stringify(r.errores));
});

test("una cantidad que llega como TEXTO se convierte, y una que no es numero va a 0", () => {
  const acciones = accionesCompletas();
  acciones.workorders.rows = [
    { ot: "1", cantidad: "480" },
    { ot: "2", cantidad: "1,200" },
    { ot: "3", cantidad: "48.5" },
    { ot: "4", cantidad: true },
  ];
  const { escrituras } = correrIngesta({ acciones });
  const f = escrituras.find((e) => e.tabla === "work_orders").filas;
  assert.equal(f[0].cantidad, 480, "el texto que SI es numero se vuelve numero, no cadena");
  assert.equal(f[1].cantidad, 0, "y lo que no es numero no se inventa: 0 con el aviso en el log");
  assert.equal(f[2].cantidad, 48.5);
  assert.equal(f[3].cantidad, 0, "un booleano en una columna entera tampoco es un entero");
});

test("las fechas ilegibles van a null, y una fecha en dd/mm/aaaa NO se convierte (seria la fecha equivocada)", () => {
  // Las fechas de las siete tablas son nullable, asi que null es legal. Y "01/10/2026" SI se
  // parsea en un motor de JS, como OCTUBRE: escribirlo seria inventar un dato con cara de dato.
  const acciones = accionesCompletas();
  acciones.workorders.rows = [
    { ot: "1", fecha_vencimiento: "2026-10-01T00:00:00.000Z" },
    { ot: "2", fecha_vencimiento: "" },
    { ot: "3", fecha_vencimiento: "01/10/2026" },
    { ot: "4", fecha_vencimiento: null },
  ];
  const { escrituras } = correrIngesta({ acciones });
  const f = escrituras.find((e) => e.tabla === "work_orders").filas;
  assert.equal(f[0].fecha_vencimiento, "2026-10-01T00:00:00.000Z", "una ISO se respeta tal cual");
  assert.equal(f[1].fecha_vencimiento, null);
  assert.equal(f[2].fecha_vencimiento, null, "dd/mm/aaaa en una columna timestamptz es null, no la fecha que el motor adivine");
  assert.equal(f[3].fecha_vencimiento, null);
});

test("los booleanos del espejo se sietizan, y las columnas que no estan en la lista no se tocan", () => {
  const acciones = accionesCompletas();
  acciones.items.rows = [{ codigo: "A", inactivo: "", es_ensamblaje: "true", descripcion: "" }, { codigo: "B" }];
  const { escrituras } = correrIngesta({ acciones });
  const f = escrituras.find((e) => e.tabla === "items").filas;
  assert.equal(f[0].inactivo, false, "una cadena vacia en un booleano es false, no error");
  assert.equal(f[0].es_ensamblaje, true, "y el texto 'true' se reconoce");
  assert.equal(f[0].descripcion, "", "el texto acepta la cadena vacia: es el default de la columna");
  assert.ok(!("descripcion" in f[1]) === false || f[1].descripcion === undefined, "y una fila sin la columna no la inventa");
});

test("un payload que ya esta bien se escribe EXACTO como vino, y las filas de entrada no se tocan", () => {
  // El saneo no puede cambiar el dato bueno, porque en eso se apoya: si no, el 0 de la OT
  // cerrada se podria ir formando una costumbre y ningun dia se sabria que el espejo esta
  // mintiendo. Y las filas que devuelve el RESTlet no se modifican en el sitio (el `forEach` del
  // recorrido de fotos las reemplaza, no las muta).
  const filas = [{ ot: "1", articulo: "A", cantidad: 30, estatus: "Orden de trabajo : En curso" }];
  const acciones = accionesCompletas();
  acciones.workorders.rows = filas;
  const { escrituras } = correrIngesta({ acciones });
  const escritura = escrituras.find((e) => e.tabla === "work_orders").filas[0];
  assert.deepEqual(escritura, { ot: "1", articulo: "A", cantidad: 30, estatus: "Orden de trabajo : En curso" });
  assert.deepEqual(filas[0].cantidad, 30);
  assert.notEqual(escritura, filas[0], "y lo que se escribe es una copia, no el mismo objeto");
});

test("sin nada que corregir, el log NO inventa una linea de saneo", () => {
  const { r } = correrIngesta({ acciones: accionesCompletas() });
  assert.ok(!r.log.some((l) => /no eran del tipo/.test(l)),
    "una corrida limpia no dice que corrigio nada: " + JSON.stringify(r.log));
});

test("si el SANEO falla, la tabla NO se vacia: un arreglo de la escritura que tumba la escritura no es un arreglo", () => {
  // El bloque del saneo esta dentro del try cuya falla VACIA la tabla (RULE-SUP-048). El 22P02 del
  // 2026-10-05 se produjo justo ahi, asi que un saneo que revienta por su cuenta repetiria el
  // defecto: la tabla en cero, por un arreglo. Con `PP_saneaTipos_` tirandolo (lo que pasaria en un
  // despliegue a medias donde `PP_bool_` todavia no existe), las filas tienen que ir COMO VINIERON
  // y el aviso tiene que decir que el saneo no corrio.
  const acciones = accionesCompletas();
  const { r, base, escrituras } = correrIngesta({
    acciones, previas: { work_orders: 213 }, saneaFalla: ["work_orders"]
  });
  const escritura = escrituras.find((e) => e.tabla === "work_orders");
  assert.ok(escritura, "work_orders se escribio igual: " + JSON.stringify(r.vaciadas));
  assert.equal(escritura.enviadas, 2, "las dos filas llegaron al espejo, sin sanear");
  assert.equal(base.work_orders, 2, "y la tabla quedo con lo escrito, NO en cero");
  assert.ok(!r.vaciadas.includes("work_orders"), "y no esta en la lista de vaciadas: " + JSON.stringify(r.vaciadas));
  assert.ok(r.errores.some((e) => /saneo de tipos NO se pudo correr/.test(e)),
    "el fallo del saneo va a errores, porque aqui la escritura SI se hizo con el payload sin sanear: " + JSON.stringify(r.errores));
  assert.ok(r.errores.some((e) => /PP_bool_ is not defined/.test(e)),
    "con el motivo, no solo con que fallo: " + JSON.stringify(r.errores));
});

test("una corrida completa reescribe las SIETE tablas y no deja ninguna con lo anterior", () => {
  const previas = Object.fromEntries(TABLAS_DE_LA_INGESTA.map((t) => [t, 9]));
  const { r, base, escrituras } = correrIngesta({ acciones: accionesCompletas(), previas });
  assert.equal(r.ok, true, "siete tablas escritas y ningun fallo, la corrida es ok");
  assert.equal(r.ejecutada, true);
  assert.deepEqual(structuredClone(r.vaciadas), [], "no se vacio ninguna: todas se reescribieron");
  assert.deepEqual(structuredClone(r.noSePudoVaciar), []);
  for (const t of TABLAS_DE_LA_INGESTA) {
    assert.equal(base[t], 2, t + " quedo con lo que devolvio NetSuite, no con las 9 filas anteriores");
  }
  // El espejo BORRA antes de escribir: en las siete escrituras el borrado es el conteo previo.
  assert.equal(escrituras.length, 7, "y se escribieron las siete, una llamada cada una");
  for (const e of escrituras) assert.equal(e.borradas, 9, e.tabla + ": el espejo borro lo que habia");
});

test("una tabla que NetSuite NO devuelve se VACIA: no conserva lo anterior", () => {
  // Este es el caso que motiva la regla. MEDIDO en la base viva el 2026-10-04: lo que queda de
  // la corrida pasada se ve en la hoja de inspeccion igual que un dato fresco.
  const acciones = accionesCompletas();
  delete acciones.materiales;                                    // la accion no vino
  acciones.inventario = { ok: false, rows: [], error: "SuiteQL fallo" };  // vino pero fallo
  const { r, base, escrituras } = correrIngesta({
    acciones, previas: { materials: 328, inventory: 1935 },
  });
  assert.equal(base.materials, 0, "materials quedo VACIA: no se quedo con las 328 filas de la corrida anterior");
  assert.equal(base.inventory, 0, "y lo mismo con la que vino pero fallo");
  assert.deepEqual(structuredClone(r.vaciadas), ["materials", "inventory"]);
  assert.equal(r.ok, false, "y la corrida NO es ok: se escribieron cinco de siete");
  // El aviso tiene que NOMBRAR LA TABLA, no el nombre de la accion de NetSuite: materiales y
  // materials no son lo mismo para quien va a buscarla en la base.
  assert.ok(r.errores.some((e) => /materials/.test(e) && /VACIO/.test(e)),
    "el error dice la tabla (materials) y que quedo vacia: " + JSON.stringify(r.errores));
  // Y las dos se vaciaron por el MISMO RPC con payload vacio, no por un borrado aparte.
  const vacios = escrituras.filter((e) => e.enviadas === 0);
  assert.deepEqual(vacios.map((e) => e.tabla).sort(), ["inventory", "materials"],
    "vaciar es el espejo con el payload vacio: no hay un segundo camino de borrado");
  assert.ok(!/method:\s*["']DELETE["']/.test(server),
    "y la ingesta no tiene un DELETE propio: el unico que borra es el RPC (si lo tuviera, seria otra regla)");
});

test("una escritura que se cae NO vacia la tabla: conserva lo anterior y lo nombra (decision del usuario 2026-10-06)", () => {
  // MEDIDO lo que costaba lo contrario: el 2026-10-05 una sola fila de 513 con `cantidad` en ""
  // dio 22P02, y el vaciado borro las 213 OTs que estaban bien. El dato viejo que la regla
  // queria evitar era la foto de las OTs que la persona estaba trabajando. Volvio a pasar el
  // 2026-10-06 a las 21:16. CORTA LA SEGUNDA MITAD DE RULE-SUP-048: una escritura que falla no
  // toca la tabla. La PRIMERA mitad se queda: si NetSuite no trae la tabla, se vacia (test de
  // arriba), porque ahi vacio es la verdad.
  const { r, base } = correrIngesta({
    acciones: accionesCompletas(), previas: { operations: 2232 }, escribirFalla: ["operations"],
  });
  assert.equal(base.operations, 2232,
    "el espejo de operations se cayo y la tabla CONSERVA las 2232 filas que tenia");
  assert.ok(!r.vaciadas.includes("operations"),
    "y no se reporta como vaciada: no se vacio, seria mentira");
  assert.equal(r.noSePudoVaciar.length, 1, "va en la lista de 'conserva lo anterior'");
  assert.equal(r.noSePudoVaciar[0].tabla, "operations");
  assert.equal(r.ok, false, "y la corrida se declara NO buena");
  assert.ok(r.errores.some((e) => /operations/.test(e) && /ERROR al escribir/.test(e)),
    "el aviso distingue 'no se pudo escribir' de 'NetSuite no la devolvio': " + JSON.stringify(r.errores));
  assert.ok(r.log.some((e) => /operations/.test(e) && /NO se toco la tabla/.test(e)),
    "y el aviso DICE que la tabla no se toco: " + JSON.stringify(r.log));
  assert.ok(r.log.some((l) => /operations/.test(l) && /\(2 filas de esta corrida quedaron sin escribir\)/.test(l)),
    "el aviso dice cuantas filas TRAJO la corrida y no se pudieron escribir (2), no cuantas "
    + "quedaron en la tabla (2232): son dos numeros distintos y confundirlos seria el diagnostico "
    + "equivocado: " + JSON.stringify(r.log.filter((l) => /operations/.test(l))));
});

test("si NI el vaciado se puede hacer, la tabla conserva lo anterior y APARECE CON SU NOMBRE", () => {
  // Este es el unico estado peligroso: en pantalla hay datos y parecen frescos. Por eso la
  // corrida lo lleva en una lista propia y la pagina lo nombra (RULE-SUP-048). Sigue siendo
  // alcanzable, pero ya NO por una escritura que se cae (esa no vacia nada desde el
  // 2026-10-06): llega cuando NetSuite no devuelve la tabla y el vaciado a proposito falla.
  const acciones = accionesCompletas();
  delete acciones.operaciones;                                     // NetSuite no la devolvio
  const { r, base } = correrIngesta({
    acciones, previas: { operations: 2232 }, vaciarFalla: ["operations"],
  });
  assert.equal(base.operations, 2232, "no se pudo borrar nada: la tabla sigue con lo que tenia");
  assert.ok(!r.vaciadas.includes("operations"), "y NO se reporta como vaciada: seria mentira");
  assert.equal(r.noSePudoVaciar.length, 1);
  assert.equal(r.noSePudoVaciar[0].tabla, "operations");
  assert.match(r.noSePudoVaciar[0].motivo, /Supabase no responde/,
    "el motivo viaja con la tabla: 'conserva lo anterior' sin motivo no se puede corregir");
  assert.equal(r.ok, false);
});

test("una escritura que se cae NO intenta vaciar: vaciarFalla no puede tocar esa tabla", () => {
  // Antes de la decision del 2026-10-06 este camino vaciaba, asi que `vaciarFalla` alcanzaba a
  // dispararse. Ahora no: si la escritura se cae, no hay ni un segundo intento de borrar. Esta
  // prueba es la que vigila que `PP_vaciaTabla_` no vuelva a aparecer en el `catch`.
  const { r, base, escrituras } = correrIngesta({
    acciones: accionesCompletas(), previas: { operations: 2232 },
    escribirFalla: ["operations"], vaciarFalla: ["operations"],
  });
  assert.equal(base.operations, 2232, "la tabla conserva sus 2232 filas");
  assert.equal(r.noSePudoVaciar[0].motivo, "columna no existe en materials",
    "y el motivo es el de la ESCRITURA, no el del vaciado: el vaciado no se intento");
  const deOperations = escrituras.filter((e) => e.tabla === "operations");
  assert.equal(deOperations.length, 0,
    "no hubo ni una llamada al RPC para operations: ni escritura ni vaciado, porque la escritura revento");
});

test("si NINGUNA accion vino bien, no se toca ninguna tabla y se dice por que", () => {
  // La excepcion medida y deliberada de la regla. "Una tabla fallo" y "el origen no respondio"
  // no son lo mismo: ante cero acciones usables (caida de red, o el RESTlet desplegado con otro
  // shape) vaciar las siete deja el panel en blanco sin una sola OT, que en el taller se lee
  // como "se borro todo". Aqui la corrida ni se cuenta como corrida.
  const acciones = accionesCompletas();
  for (const k of Object.keys(acciones)) acciones[k] = { ok: false, error: "no such table" };
  const previas = Object.fromEntries(TABLAS_DE_LA_INGESTA.map((t) => [t, 7]));
  const { r, base, escrituras } = correrIngesta({ acciones, previas });
  assert.equal(r.ejecutada, false, "no hubo corrida");
  assert.equal(r.motivo, "sin_acciones");
  assert.equal(r.ok, false);
  assert.equal(escrituras.length, 0, "CERO escrituras: ni una tabla se toco");
  for (const t of TABLAS_DE_LA_INGESTA) assert.equal(base[t], 7, t + " conserva lo anterior");
  assert.deepEqual(structuredClone(r.vaciadas), [], "y no se reporta ninguna como vaciada");
});

test("el conteo por tabla es un conteo por tabla, no el arreglo de filas de la ultima", () => {
  // MEDIDO 2026-10-04, el defecto que estas pruebas destaparon. El contador se llamaba filas,
  // el mismo nombre que las filas del bucle, y lo tapaba: el return devolvia el ARREGLO de la
  // ultima tabla. La pagina hacia Object.keys() de ese arreglo (o sea, un indice por renglon) y
  // decia "indice filas". Se fija la forma exacta que la pagina consume.
  const { r } = correrIngesta({ acciones: accionesCompletas() });
  assert.ok(!Array.isArray(r.filas), "filas NO puede ser un arreglo: la pagina cuenta Object.keys()");
  assert.deepEqual(structuredClone(r.filas), {
    work_orders: 2, operations: 2, materials: 2, items: 2, machines: 2, inventory: 2, sales_orders: 2,
  }, "y son las SIETE tablas con su conteo, con el nombre de la TABLA");
});

test("el dedupe por clave natural cuenta lo que se ESCRIBE, no lo que vino", () => {
  // El conteo que se devuelve tiene que ser el de lo que llego a la base. Materiales con dos
  // renglones del BOM y una copia se escriben dos veces: la copia se quita, el renglon no.
  const acciones = accionesCompletas();
  acciones.materiales = { ok: true, rows: [
    { ot: "3776", componente: "MP00094", line_id: "2" },
    { ot: "3776", componente: "MP00094", line_id: "3" },
    { ot: "3776", componente: "MP00094", line_id: "2" },
  ] };
  const { r, base } = correrIngesta({ acciones });
  assert.equal(r.filas.materials, 2, "los dos renglones REALES se conservan y la copia no se escribe");
  assert.equal(base.materials, 2);
});

test("PP_vaciaTabla_ NO se fia del RPC: si devuelve filas, tira el error", () => {
  // Sin esta comprobacion la corrida reportaria "vaciada" sobre una tabla con filas, que es
  // exactamente la mentira que la regla viene a quitar.
  const contexto = { JSON, Object, Array, String, Number, Error };
  contexto.globalThis = contexto;
  createContext(contexto);
  const desde = server.indexOf("function PP_vaciaTabla_(");
  runInContext(server.slice(desde, server.indexOf("// ======", desde)), contexto);
  let pedido = null;
  contexto.PP_supabaseMirror_ = (tabla, filas) => { pedido = { tabla, filas: filas.length }; return { escritas: 0, borradas: 3 }; };
  const r = contexto.PP_vaciaTabla_("materials", {});
  assert.equal(r.borradas, 3);
  assert.equal(pedido.tabla, "materials");
  assert.equal(pedido.filas, 0, "vaciar es el espejo con el payload VACIO, no un DELETE aparte");

  contexto.PP_supabaseMirror_ = () => ({ escritas: 4, borradas: 3 });
  assert.throws(() => contexto.PP_vaciaTabla_("materials", {}), /no vacio materials/,
    "y un espejo que devuelve filas al vaciar es un fallo DICHO, no una tabla reportada como vacia");
});

test("la respuesta de la corrida lleva las dos listas en TODAS sus salidas", () => {
  // doPost es la unica puerta que usa la pagina, asi que si las listas no viajan por ahi, la
  // pagina no puede distinguirlas aunque el servidor las sepa.
  assert.match(server, /salida\.vaciadas = Array\.isArray\(resultado\.vaciadas\) \? resultado\.vaciadas : \[\]/,
    "doPost reenvia vaciadas");
  assert.match(server, /salida\.noSePudoVaciar = Array\.isArray\(resultado\.noSePudoVaciar\) \? resultado\.noSePudoVaciar : \[\]/,
    "doPost reenvia noSePudoVaciar");
  assert.match(server, /vaciadas: \[\],\n\s*noSePudoVaciar: \[\]/,
    "y la salida de excepcion las declara vacias: ahi no hubo corrida y no se inventa ninguna tabla");

  // El cliente las pasa sin resumirlas: "conserva lo anterior" tiene que poder leerse con el
  // nombre de la tabla, no como un numero.
  assert.match(gate, /const vaciadas = Array\.isArray\(json\.vaciadas\) \? json\.vaciadas\.filter\(Boolean\) : \[\];/);
  assert.match(gate, /const noSePudoVaciar = Array\.isArray\(json\.noSePudoVaciar\) \? json\.noSePudoVaciar\.filter\(Boolean\) : \[\];/);
  assert.match(gate, /Estas tablas conservan lo anterior: /,
    "y el caso que NO se puede resumir en un conteo va PRIMERO, con la tabla adentro");
});

test("la pagina nombra los tres estados, y el que se ve con datos VIEJOS tiene su propio aviso", () => {
  assert.match(app, /vaciadas\.length \? " \| VACIADAS \(NetSuite no las devolvio\): "/,
    "las vaciadas se nombran aparte de las escritas");
  assert.match(app, /sinVaciar\.length \? " \| CON LO ANTERIOR \(no se pudo vaciar\): "/,
    "y las que conservan lo anterior tambien: es el estado que no se puede dejar mudo");
  assert.match(app, /al dia, \$\{vaciadas\.length\} vacias, \$\{sinVaciar\.length\} con lo anterior/,
    "el toast lleva los tres conteos");
});

test("el .gs suelto de la raiz NO vuelve: era una copia que nadie despliega", async () => {
  // MEDIDO 2026-10-04: el build de Apps Script copia src/server/*.js a dist/ y el workflow
  // despliega dist/, o sea que appscript-ingesta-supabase.gs en la raiz no llego nunca a
  // produccion (63 funciones desplegadas, y la funcion ingesta no estaba entre ellas). Se
  // quedaba como una segunda fuente con su propio continue silencioso, y dos documentos la
  // senalaban como el codigo vivo. Se borro; estas pruebas son las que impiden que vuelva.
  const { access } = await import("node:fs/promises");
  await assert.rejects(() => access(new URL("../appscript-ingesta-supabase.gs", import.meta.url)),
    "appscript-ingesta-supabase.gs no debe existir en la raiz: la copia muerta que no despliega nadie");

  // Y ningun documento puede presentarlo como el codigo que corre. Se permite MENTIONARLO, porque
  // el doc tiene que explicar por que se borro; lo que no se permite es presentarlo como vivo.
  for (const doc of ["../docs/integrations/netsuite-supabase-sync.md", "../docs/schema-supabase-sync-netsuite.sql"]) {
    const texto = await readFile(new URL(doc, import.meta.url), "utf8");
    const citas = texto.split("\n").filter((l) => /appscript-ingesta-supabase\.gs/.test(l));
    for (const linea of citas) {
      assert.match(linea, /elimin|nunca se desplega|senalaba|señalaba|copia muerta|vivia en la raiz/,
        doc + ": menciona el archivo borrado como si fuera el codigo vivo -> " + linea.trim());
    }
  }
  // Y el doc tiene que senalar el archivo real, que es donde vive la ingesta que se despliega.
  const sync = await readFile(new URL("../docs/integrations/netsuite-supabase-sync.md", import.meta.url), "utf8");
  assert.match(sync, /src\/server\/19-appscript-ingesta-supabase\.js/, "el doc apunta al archivo que el build publica");
});
