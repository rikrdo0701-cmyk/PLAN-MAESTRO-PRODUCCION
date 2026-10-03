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
  const conTablas = literales.filter((t) => /tocadas|filas al dia|tablas/.test(t));
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