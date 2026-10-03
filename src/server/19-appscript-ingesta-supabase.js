/**
 * Ingesta NetSuite -> Supabase: la corrida periodica que llama al RESTlet unificado.
 *
 * QUE ES Y POR QUE ESTA EN ESTE ARCHIVO. Este codigo vivia suelto en la raiz del
 * repo, en appscript-ingesta-supabase.gs, y por eso NUNCA llego a production:
 * el build de Apps Script solo copia src/server/*.js a dist/, y el workflow
 * despliega dist/. Un .gs en la raiz no lo publica nadie. MEDIDO el 2026-09-29:
 * el proyecto desplegado exponia 63 funciones y `ingesta` no estaba entre ellas,
 * o sea que la ingesta no corria desde Apps Script. Este archivo es el mismo
 * codigo, pero dentro de src/server/ para que lo publique el CI.
 *
 * NO ESCRIBE EN NETSUITE. Solo lee de NetSuite y escribe en Supabase.
 *
 * MIRROR EXACTO ATOMICO: cada corrida llama al RPC public.ingesta_mirror
 * (docs/rpc-ingesta-mirror.sql), que BORRA cada tabla completa y reescribe lo
 * que devuelve NetSuite en UNA transaccion: no quedan datos antiguos y, si algo
 * falla, el rollback deja la tabla con los datos anteriores (nunca vacia).
 *
 * UN ESCRITOR POR TABLA (RULE-SUP-015). Este archivo escribe las 7 tablas de
 * NetSuite y nada mas. Los catalogos los escribe 16-supabase-catalogo.js desde un
 * guardado, y `machines` en particular NO se toca aqui desde el espejo de
 * catalogos, porque la escribe este archivo. Que los dos caminos coexistieran
 * sobre la misma tabla seria pelearla cada 15 minutos.
 *
 * CREDENCIALES. Este archivo NO declara la clave de Supabase a proposito: la
 * service role key vive en un archivo aparte del proyecto (supabase-config.gs)
 * que pega el usuario en el editor de Apps Script. Por que NO se pone aqui ni en src/server/: porque el
 * build copia todo src/server/ a dist/ y el CI sube dist/ en cada push, o sea
 * que cualquier clave en el repo se publicaria y ademas se volveria a subir en
 * cada despliegue. Lo que se le pide al que configura es sustituir los tres
 * valores de ese archivo. `ingesta()` comprueba que no siga el placeholder y se
 * detiene con un mensaje claro, en vez de fallar siete veces con un 401 de
 * Supabase que no dice nada util.
 *
 * NetSuite si se lee de Propiedades del script (NS_*), que es lo que ya hace
 * 08-netsuite.js. Esas no se pueden poner en el codigo por la misma razon.
 *
 * POR QUE NO SE REDECLARA EL CODIGO OAUTH. Este archivo usaba sus propias
 * PP_oauthHeader_ y PP_oauthEncode_. Esas dos funciones ya existen en
 * 08-netsuite.js y son IDENTICAS (OAuth 1.0a TBA, HMAC-SHA256, mismo
 * accountId/consumerKey/token/secret). Declararlas otra vez no rompia nada: en
 * JavaScript una funcion repetida es legal y gana la ultima, sin aviso (este repo
 * ya tiene dos pares asi, y el proyecto compila). Lo que dejaria es una segunda
 * copia que diverge en silencio: se corrige una y el comportamiento no cambia, o
 * se corrige la otra y tampoco. Por eso este archivo usa las que ya hay. Si
 * alguien copia este archivo a un proyecto que NO tiene 08-netsuite.js, tiene que
 * copiar tambien esas dos funciones.
 *
 * TRIGGER. El header del archivo decia "cada 15 minutos, lun-vie, 7am-5pm" pero
 * el activador no existia. El horario lo hace el propio codigo, en ingesta(), y
 * el activador se crea con PP_creaTriggerIngesta_(), que hay que ejecutar a mano
 * una vez desde el editor: no se puede crear un activador desde fuera.
 *
 * ORIGEN DE DATOS. El RESTlet 2246 deploy 1 es el unico que lee NetSuite, con
 * accion:'todas' (una sola llamada). El filtro de ubicacion (RULE-SUP-013,
 * ail.location = 1) lo aplica el RESTlet, no este codigo, y por eso aqui no se
 * usa UBICACION: mandarla y no mandarla daria el mismo resultado.
 */

// =============================================================================
// El RESTlet unificado
// =============================================================================

// MEDIDO 2026-09-29: el archivo suelto de la raiz declaraba estos tres y el nuevo
// los USA sin declararlos, porque se dio por hecho que venian de ahi. Con el .gs
// de la raiz sin desplegar, ingesta() moria con "RESTLET_URL is not defined" en
// tiempo de ejecucion, y nada lo delata antes: referenciar un global no declarado
// NO es error de parse, el proyecto compila, el puente web funciona y el workflow
// sale en verde. Solo revienta cuando alguien ejecuta ingesta(), que es justo lo
// que no se puede probar desde aqui. Por eso hay un test que comprueba que no se
// usa nada sin declarar.
const RESTLET_URL = 'https://11103874.restlets.api.netsuite.com/app/site/hosting/restlet.nl';
const RESTLET_SCRIPT = '2246';
const RESTLET_DEPLOY = '1';

// =============================================================================
// Configuracion — NS_* de las Script Properties + Supabase del archivo aparte
// =============================================================================

/**
 * Lee la configuracion de la corrida. Los NS_* vienen de Propiedades del
 * script (los pone el usuario en la interfaz, no en el codigo). Los tres valores
 * de Supabase vienen de supabase-config.gs, un archivo aparte pegado en el
 * proyecto: SUPABASE_URL, SUPABASE_KEY (service role) y UBICACION.
 */
function PP_config_() {
  const p = PropertiesService.getScriptProperties();
  return {
    accountId: p.getProperty('NS_ACCOUNT_ID'),
    consumerKey: p.getProperty('NS_CONSUMER_KEY'),
    consumerSecret: p.getProperty('NS_CONSUMER_SECRET'),
    token: p.getProperty('NS_TOKEN'),
    tokenSecret: p.getProperty('NS_TOKEN_SECRET'),
    supabaseUrl: SUPABASE_URL,
    supabaseKey: SUPABASE_KEY,
    ubicacion: UBICACION
  };
}

/**
 * Falla pronto y con un mensaje util si el proyecto quedo a medio configurar.
 * Sin esto, la clave de placeholder se descubre como siete 401 seguidos de
 * Supabase, que dicen 'Invalid API key' sin señalar el archivo culpable.
 */
function PP_verificaConfigIngesta_(config) {
  const faltan = [];
  if (!config.supabaseUrl) faltan.push('SUPABASE_URL (en supabase-config.gs)');
  if (!config.supabaseKey) faltan.push('SUPABASE_KEY (en supabase-config.gs)');
  if (!config.consumerKey || !config.consumerSecret || !config.token || !config.tokenSecret) {
    faltan.push('NS_* en Propiedades del script (NS_CONSUMER_KEY, NS_CONSUMER_SECRET, NS_TOKEN, NS_TOKEN_SECRET)');
  }
  if (faltan.length) {
    throw new Error('Ingesta sin configurar, falta: ' + faltan.join(' | '));
  }
  if (/^TU_|PLACEHOLDER|^<|^xxx/i.test(String(config.supabaseKey))) {
    throw new Error('SUPABASE_KEY sigue con el valor de ejemplo "' + config.supabaseKey +
      '". Abre supabase-config.gs en el proyecto de Apps Script y pega la service role key real.');
  }
}

// =============================================================================
// Llamada al RESTlet unificado
// =============================================================================

function PP_restletUnificado_(accion, config) {
  const endpoint = RESTLET_URL;
  const query = { script: RESTLET_SCRIPT, deploy: RESTLET_DEPLOY };
  const url = endpoint + '?' + Object.keys(query).map(function(key) {
    return PP_oauthEncode_(key) + '=' + PP_oauthEncode_(query[key]);
  }).join('&');
  const res = UrlFetchApp.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': PP_oauthHeader_('POST', endpoint, query, config),
      'Prefer': 'transient'
    },
    payload: JSON.stringify({ accion: accion }),
    muteHttpExceptions: true
  });
  const json = JSON.parse(res.getContentText());
  if (res.getResponseCode() !== 200) {
    throw new Error('RESTlet ' + res.getResponseCode() + ': ' + JSON.stringify(json).slice(0, 300));
  }
  return json;
}

// =============================================================================
// Supabase (PostgREST)
// =============================================================================

// MEDIDO 2026-10-02: POR QUE ESTE AYUDANTE EXISTE. El error del RPC se cortaba con
// res.getContentText().slice(0, 300), y un 23502 salia MUDO. Postgres responde a una violacion NOT
// NULL con el cuerpo siguiente:
//
//   {"code":"23502","details":"Failing row contains (4e97d1...","hint":null,
//    "message":"null value in column \"foto_url\" of relation \"work_orders\" violates not-null ..."}
//
// El campo que DICE LA COLUMNA es 'message', y va AL FINAL: antes de el viene 'details', que es la
// fila repetida y ocupa cientos de caracteres. O sea que el corte se comia exactamente la parte util
// y conservaba la que no dice nada. La consecuencia fue que el diagnostico dio "algo fallo con 23502"
// durante una TAsk entera sin poder nombrar la columna, y hubo que deducirla del DDL.
//
// Este ayudante lee 'message' cuando el cuerpo es JSON de PostgREST y, si no lo es, devuelve el
// FINAL del texto en vez del principio: en un error de Postgres y de PostgREST lo que dice que
// paso esta al final casi siempre.
function PP_errorPostgREST_(res) {
  const texto = String(res.getContentText() || '');
  try {
    const j = JSON.parse(texto);
    const partes = [];
    if (j.code) partes.push('codigo ' + j.code);
    if (j.message) partes.push(j.message);
    if (j.hint) partes.push('pista: ' + j.hint);
    if (partes.length) return partes.join(' | ');
  } catch (error) {}
  return texto.length > 300 ? '...' + texto.slice(-300) : texto;
}

function PP_supabaseMirror_(tabla, filas, config) {
  // MIRROR ATOMICO via el RPC public.ingesta_mirror (docs/rpc-ingesta-mirror.sql):
  // borra todas las filas e inserta las nuevas DENTRO de una sola transaccion de
  // Postgres. Si el insert falla, el rollback revierte el borrado y la tabla
  // queda con los datos anteriores (nunca vacia ni a medias). El DELETE+POST que
  // habia antes (commit c883d5e) dejaba la tabla vacia si el POST fallaba.
  const url = config.supabaseUrl + '/rest/v1/rpc/ingesta_mirror';
  const res = UrlFetchApp.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': config.supabaseKey,
      'Authorization': 'Bearer ' + config.supabaseKey
    },
    payload: JSON.stringify({ p_tabla: tabla, p_filas: filas }),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('Supabase rpc ingesta_mirror ' + tabla + ' ' + code + ': ' + PP_errorPostgREST_(res));
  }
  const r = JSON.parse(res.getContentText());
  return { escritas: r.insertadas || 0, borradas: r.borradas || 0 };
}

// =============================================================================
// Utilidades
// =============================================================================

function deduplicar_(filas, claveFn) {
  const vistos = {};
  const out = [];
  filas.forEach(function(f) {
    const k = claveFn(f);
    if (vistos[k]) return;
    vistos[k] = true;
    out.push(f);
  });
  return out;
}

// =============================================================================
// El activador (se crea a mano, ver PP_creaTriggerIngesta_)
// =============================================================================

const PP_INGESTA_CADA_MINUTOS_ = 15;

/**
 * Crea el activador de la ingesta, o lo deja como estaba si ya habia uno.
 * Hay que ejecutarla A MANO una vez desde el editor: los activadores son del
 * proyecto y no se pueden crear desde fuera de Apps Script.
 *
 * Borra los activadores previos de ingesta antes de crear el nuevo. Sin eso,
 * ejecutarla dos veces deja DOS activadores y la ingesta corre el doble cada 15
 * minutos: no corrompe datos porque el mirror es atomico e idempotente, pero
 * duplica las llamadas al RESTlet, que es lo que mas cuesta.
 */
function PP_creaTriggerIngesta_() {
  const existentes = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === 'ingesta';
  });
  existentes.forEach(function(t) { ScriptApp.deleteTrigger(t); });
  const nuevo = ScriptApp.newTrigger('ingesta').timeBased().everyMinutes(PP_INGESTA_CADA_MINUTOS_).create();
  return 'Trigger de ingesta: cada ' + PP_INGESTA_CADA_MINUTOS_ + ' minutos' +
    (existentes.length ? ' (se reemplazaron ' + existentes.length + ')' : ' (nuevo)') +
    '. El filtro de horario lo hace ingesta(): lunes a viernes, 7:00 a 17:00.';
}

/**
 * DICE SI EL ACTIVADOR ESTA INSTALADO. Solo lectura: llama a ScriptApp.getProjectTriggers() y
 * no crea ni borra nada.
 *
 * MEDIDO 2026-10-02, POR QUE ESTA FUNCION EXISTE. El sintoma era doble y la mitad no se podia
 * mirar: la ingesta no corria sola. `clasp push` sube el CODIGO pero NO crea activadores, porque
 * son del proyecto y no del archivo; sin una lectura de ellos, la unica manera de saber si el
 * activador estaba puesto era adivinar. MEDIDO que no lo esta: entre las 07:00 y las 17:00 de un
 * viernes ( America/Monterrey, UTC-6 ) debieron dispararse unas 21 veces y work_orders seguia con
 * la escritura del 2026-10-01T05:40:21Z, o sea que no habia corrido ninguna.
 *
 * POR QUE DICE LO QUE DICE Y NO MAS. Apps Script NO expone la proxima ejecucion de un activador de
 * reloj, asi que aqui no se inventa ese dato: `getNextRunTime` no existe. Lo que este metodo
 * responde es 'esta instalado y con que frecuencia', que es justo lo que faltaba. Si la respuesta
 * es que si esta puesto y aun asi no escribe, el culpable pasa a ser la entrega (cuota, zona, o el
 * filtro de horario) y eso se mide en otro lado.
 *
 * `dentroDeHorario` usa EL MISMO criterio que PP_ingesta_ (linea 292: domingo o sabado fuera, y
 * hora < 7 o >= 17 fuera), para que el que pregunta no tenga que recalcularlo y comparar dos
 * reglas distintas.
 */
function getTriggerStatus() {
  const ahora = new Date();
  const dia = ahora.getDay();
  const hora = ahora.getHours();
  const todos = ScriptApp.getProjectTriggers();
  const activadores = todos.map(function(t) {
    return { handler: t.getHandlerFunction(), tipo: t.getEventType(), uid: t.getUniqueId() };
  });
  const deIngesta = activadores.filter(function(a) { return a.handler === 'ingesta'; });
  const dentro = dia !== 0 && dia !== 6 && hora >= 7 && hora < 17;
  return {
    ahora: ahora.toISOString(),
    zona: Session.getScriptTimeZone(),
    dia: dia,
    hora: hora,
    dentroDeHorario: dentro,
    cadaMinutos: PP_INGESTA_CADA_MINUTOS_,
    activadores: activadores,
    deIngesta: deIngesta.length,
    // Lo que hay que hacer, dicho en una linea, porque un 0 sin nombre no se corrige.
    veredicto: deIngesta.length === 0
      ? 'NO hay activador de ingesta: ejecuta PP_creaTriggerIngesta_() a mano desde el editor.'
      : (deIngesta.length > 1
        ? 'HAY ' + deIngesta.length + ' activadores de ingesta (sobran ' + (deIngesta.length - 1) +
          '): ejecuta PP_creaTriggerIngesta_() para dejar uno solo.'
        : 'El activador de ingesta esta instalado. Si aun asi no escribe, el problema NO es que falte.')
  };
}

/** Borra los activadores de la ingesta. Para deshacer PP_creaTriggerIngesta_(). */
function PP_borraTriggerIngesta_() {
  const t = ScriptApp.getProjectTriggers().filter(function(x) { return x.getHandlerFunction() === 'ingesta'; });
  t.forEach(function(x) { ScriptApp.deleteTrigger(x); });
  return 'Activadores de ingesta borrados: ' + t.length;
}

// =============================================================================
// Punto de entrada
// =============================================================================

/**
 * El punto de entrada del ACTIVADOR. NO lleva filtro de horario forzado: un disparo manual
 * en este camino seria identico al de las 15 minutos.
 */
function ingesta() {
  return PP_ingesta_(false);
}

/**
 * El cuerpo de la ingesta. `forzado` salta el filtro de horario laboral.
 *
 * MEDIDO 2026-09-30: el filtro era un `return` sin nada, dentro de la funcion, y por eso no se
 * podia saltar. La consecuencia seria: el boton Sincronizar de la pagina dispara la ingesta a
 * las 20:00, ingesta() ve que no es hora laborable, `return` sin devolver nada, doPost responde
 * 200 con un cuerpo vacio y la pagina se diria "sincronizado". O sea: un exito FALSO, con el
 * toast mintiendo y las OTs viejas en pantalla sin que nada lo diga. Por eso el filtro es un
 * parametro y no un return: la corrida manual va marcada como forzada y el log lo dice, y la
 * corrida del activador sigue respetando el horario de siempre.
 *
 * MEDIDO 2026-09-30 (lo otro): el cuerpo de este return tambien era `undefined`, o sea que
 * el activador no podia reportar nada de su propia corrida. Ahora devuelve un objeto con las
 * filas por tabla y los errores, que es lo que la pagina necesita para no mentir.
 */
function PP_ingesta_(forzado) {
  console.log('=== INGESTA START ===' + (forzado ? ' (FORZADA, desde la pagina)' : ''));
  const config = PP_config_();
  PP_verificaConfigIngesta_(config);
  console.log('Config OK. Account: ' + config.accountId);

  const ahora = new Date();
  const dia = ahora.getDay();
  const hora = ahora.getHours();
  console.log('Hora: ' + ahora.toISOString() + ' (dia=' + dia + ', hora=' + hora + ')');
  if (!forzado && (dia === 0 || dia === 6 || hora < 7 || hora >= 17)) {
    console.log('Fuera de horario laboral. Saliendo.');
    return { ok: true, ejecutada: false, motivo: 'fuera_de_horario', filas: {}, errores: [], log: [] };
  }

  // Una sola llamada al RESTlet unificado
  console.log('Llamando al RESTlet unificado (2246)...');
  const respuesta = PP_restletUnificado_('todas', config);
  if (!respuesta.ok) {
    throw new Error('RESTlet no ok: ' + JSON.stringify(respuesta).slice(0, 300));
  }

  const acciones = respuesta.acciones;
  const log = [];
  const filas = {};
  const errores = [];

  // Mapeo de accion -> tabla, clave natural, y funcion de transformacion
  const TABLAS = {
    workorders: { tabla: 'work_orders', clave: 'ot' },
    operaciones: { tabla: 'operations', clave: 'operation_id' },
    // materials: la identidad es (ot, line_id). comp.id de NetSuite es el numero de
    // linea DENTRO de la OT y se repite entre OTs (medido 2026-09-29): con line_id
    // solo el upsert y el dedupe descartaban materiales de otras OTs.
    materiales: { tabla: 'materials', clave: 'ot,line_id' },
    items: { tabla: 'items', clave: 'codigo' },
    // MEDIDO 2026-10-01, DECISION DEL USUARIO: el catalogo de maquinas es un dato
    // MANUAL. La pagina lee el catalogo de `machine_catalog` (la pagina lo escribe),
    // no de `machines`. PERO la ingesta sigue escribiendo `machines`: el RESTlet 2246
    // la escribe directamente en Supabase y la ingesta la escribe tambien, para que la
    // tabla de NetSuite exista. Ya no alimenta el catalogo de la pagina, pero sigue
    // siendo la tabla de NetSuite. Ver docs/schema-machine-catalog.sql.
    centros: { tabla: 'machines', clave: 'nombre' },
    inventario: { tabla: 'inventory', clave: 'item,ubicacion' },
    ordenes_venta: { tabla: 'sales_orders', clave: 'folio' }
  };

  for (const nombre in TABLAS) {
    try {
      const accion = acciones[nombre];
      if (!accion || !accion.ok) {
        const msg = nombre + ': ERROR ' + JSON.stringify(accion).slice(0, 100);
        log.push(msg);
        errores.push(msg);
        console.log(nombre + ': ERROR ' + JSON.stringify(accion).slice(0, 200));
        continue;
      }
      let filas = accion.rows || [];
      console.log(nombre + ': ' + filas.length + ' filas recibidas');
      // FOTOS DE GOOGLE DRIVE, Y POR QUE ESTA AQUI.
      //
      // MEDIDO 2026-10-01: la foto_url que la pagina muestra sale de GOOGLE DRIVE
      // (09-photos.js:35 arma 'https://drive.google.com/thumbnail?id=<id>&sz=w400', buscado por el
      // nombre del articulo dentro de la carpeta PHOTO_FOLDER_ID). MEDIDO tambien: la unica funcion
      // que pegaba esa foto a las filas, PP_enrichWorkOrderPhotos_, tenia solo dos llamadores y los
      // dos estaban en 08-netsuite.js:64 y :98, o sea en el camino del PUENTE de Apps Script, que
      // la pagina ya no usa. Esta ingesta no la llamaba: escribia `accion.rows` tal cual, y el
      // mirror se lleva la foto_url de NetSuite (que puede venir vacia) y nada de Drive. Por eso
      // las tarjetas de la pagina decia "Sin foto" con el dato entero disponible en Drive.
      //
      // Va ANTES del mirror porque despues del mirror ya se escribieron las filas en la base y no
      // hay punto de escritura. Solo para 'workorders': en materials u operations el articulo no es
      // la clave de la foto y la columna foto_url ni existe.
      if (nombre === 'workorders') {
        try {
          const fotos = PP_enrichPhotoRows_(filas);
          filas = fotos.filas;
          // Si Drive no esta configurado o no se pudo leer la carpeta, esto dice 0 y POR QUE, en
          // vez de dejar que el 0 se vea solo en la pantalla. La foto no puede tumbar la ingesta:
          // 199 filas de OTs validas valen mas que su foto.
          //
          // MEDIDO 2026-10-01: "0 con foto" era una sola linea para TRES causas que piden tres
          // acciones distintas, y con esa linea no se podia saber cual era. Ahora el por que se
          // arma con los conteos del catalogo, que son lo que las separa:
          //   - no hay `carpeta`  -> falta la Script Property PHOTO_FOLDER_ID.
          //   - claves == 0       -> la carpeta no devolvio archivos: id equivocado, vacia, o sin
          //                          permiso para esta cuenta de servicio.
          //   - claves > 0, 0 con  -> el archivo NO se llama como el articulo. Van 3 nombres
          //                          reales de archivo para compararlos sin abrir Drive.
          log.push('fotos: ' + fotos.conFoto + ' de ' + filas.length + ' con foto de Drive'
            + PP_photoMotivoCero_(fotos));
          console.log('fotos: ' + fotos.conFoto + '/' + filas.length
            + ' (carpeta=' + fotos.carpeta + ' claves=' + fotos.claves
            + ' archivos=' + fotos.archivos + ' carpetas=' + fotos.carpetas + ')');
        } catch (error) {
          log.push('fotos: no se pudieron pegar (' + String(error && error.message || error).slice(0, 120) + ')');
          console.log('fotos: ERROR ' + String(error && error.message || error));
        }
      }
      if (filas.length) {
        console.log(nombre + ': columnas = ' + Object.keys(filas[0]).join(', '));
        console.log(nombre + ': muestra = ' + JSON.stringify(filas[0]).slice(0, 300));
      }
      // Deduplicar por clave natural
      const def = TABLAS[nombre];
      if (nombre === 'items') filas = deduplicar_(filas, function(f) { return f.codigo; });
      if (nombre === 'materiales') filas = deduplicar_(filas, function(f) { return f.ot + '#' + f.line_id; });
      if (nombre === 'inventario') filas = deduplicar_(filas, function(f) { return f.item + '#' + f.ubicacion; });
      // Mirror atómico de NetSuite: el RPC borra la tabla completa y escribe lo
      // nuevo en una sola transacción, para que no queden filas de corridas
      // anteriores ni ventanas con la tabla vacía.
      const r = PP_supabaseMirror_(def.tabla, filas, config);
      filas[def.tabla] = r.escritas;
      log.push(nombre + ': ' + r.escritas + ' filas (mirror, ' + r.borradas + ' borradas)');
      console.log(nombre + ': ' + r.escritas + ' escritas / ' + r.borradas + ' borradas (mirror atomico)');
    } catch (e) {
      const msg = nombre + ': ERROR ' + String(e.message || e).slice(0, 100);
      log.push(msg);
      errores.push(msg);
      console.log(nombre + ': ERROR ' + String(e.message || e).slice(0, 200));
    }
  }
  console.log('Ingesta: ' + log.join(' | '));
  console.log('=== INGESTA END ===');
  // ok:false si AL MENOS una tabla fallo. La corrida del ACTIVADOR tambien lo trae y no lo mira:
  // antes escribia el error en el log y seguia, y eso se conserva. Lo que cambia es que quien
  // la pidio (la pagina) ahora puede enterarse de una sincronizacion a medias en vez de leer
  // "sincronizado" sobre una tabla que no se toco.
  return { ok: errores.length === 0, ejecutada: true, filas: filas, errores: errores, log: log };
}


// =============================================================================
// La puerta que la pagina usa para disparar la ingesta
// =============================================================================

/**
 * doPost: la pagina dispara la ingesta por aqui. No existia antes de 2026-09-30, y MEDIDO el
 * error que devolvia la URL del web app sin esta funcion:
 *
 *   "No se encontro la funcion de la secuencia de comandos: doPost"
 *
 * en una pagina HTML de Google, no en JSON. Ese es el caso que el cliente de la pagina tiene que
 * reconocer aparte: si lo tratara como un error generico, diria "no se pudo sincronizar" y
 * apuntaria a NetSuite, cuando el problema es que el proyecto de Apps Script esta en la version
 * de antes. Por eso el mensaje esta aqui y no en el cliente.
 *
 * QUE NO HACE ESTA PUERTA, Y POR QUE. No lee nada de NetSuite para la pagina y no devuelve
 * datos: la ingesta escribe en Supabase y la pagina lee de Supabase (RULE-SUP-030). Esta puerta
 * solo ORDENA la corrida. Lo que la pagina lee despues sale de las tablas de Supabase por el
 * lector de siempre, o sea que el boton Sincronizar quedaria leyendo lo que ya esta en la base
 * aunque el despliegue viejo siga sirviendo.
 *
 * EL CUERPO LLEGA COMO TEXTO PLANO, A PROPOSITO. Si se manda `Content-Type: application/json`,
 * el navegador manda primero un OPTIONS (preflight) porque JSON no es un "simple request", y
 * Apps Script no responde al preflight con las cabeceras CORS: el fetch muere en el navegador y
 * no hay error que leer porque nunca hubo respuesta. Con `text/plain` no hay preflight y la
 * peticion sale. Por eso el body es JSON COMO TEXTO y aqui se parsea a mano. MEDIDO: es la
 * unica forma de que un POST a un web app de Apps Script funcione desde el navegador.
 *
 * LO QUE ESTA EXPUESTO, DICHO. Esta URL es la MISMA que ya estaba publicada en el bundle
 * (build-appscript.mjs) y su deployment es `ANYONE_ANONYMOUS` + `USER_DEPLOYING`, o sea que
 * cualquiera que tenga la URL puede pedir una corrida: una llamada al RESTlet. No se le pone
 * secreto porque no hay forma de ocultarlo sin escribirlo en el repo, que esta prohibido, y
 * porque el puente que se deshabilito el 2026-09-30 exponia 24 metodos sin ninguno. Lo que si
 * se pone es un cerrojo: LockService, para que dos peticiones simultaneas no hagan dos
 * llamadas al RESTlet. La segunda recibe un motivo dicho, no un error generico.
 *
* LO QUE NO PUEDE HACER ESTA RESPUESTA, Y POR QUE IMPORTA. Un web app en /exec NO admite
 * codigo de estado: ContentService responde siempre 200, y lo unico que produce un 4xx/5xx de
 * verdad es una excepcion sin capturar, que llega como una pagina HTML de error de Google sin
 * texto util. O sea que el cliente NO PUEDE mirar r.ok para saber si la ingesta fallo: siempre
 * va a dar verde. Tiene que leer el campo `ok` del JSON, y por eso ese campo va primero y en
 * todas las salidas, incluida la excepcion. Un cliente que se fie de r.ok se tragaria un fallo
 * de Supabase como una sincronizacion buena.
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(1000)) {
      return PP_jsonIngesta_({ ok: false, ejecutada: false, motivo: 'ocupada', mensaje: 'Ya hay una ingesta corriendo' });
    }
  } catch (error) {
    return PP_jsonIngesta_({ ok: false, ejecutada: false, motivo: 'sin_cerrojo', mensaje: String(error && error.message || error) });
  }

  let cuerpo = {};
  try {
    // Con text/plain el cuerpo llega crudo en postData.contents. Con form-data estaria en
    // e.parameter, y con json en postData.contents tambien: se aceptan los dos para que un
    // cambio en el cliente no se convierta en un cuerpo vacio que se lee como accion desconocida.
    const crudo = e && e.postData && e.postData.contents ? String(e.postData.contents) : '';
    if (crudo) {
      try {
        cuerpo = JSON.parse(crudo);
      } catch (error) {
        return PP_jsonIngesta_({ ok: false, ejecutada: false, motivo: 'cuerpo_invalido', mensaje: 'El cuerpo no es JSON' });
      }
    }
    const accion = String(cuerpo.accion || 'ingesta').trim().toLowerCase();
    if (accion !== 'ingesta') {
      // Un nombre de accion desconocido se rechaza DICHO. Sin esto, caeria en la pagina de
      // error de Google, que no dice ni que se pidio ni por que.
      return PP_jsonIngesta_({ ok: false, ejecutada: false, motivo: 'accion_desconocida', accion: accion, mensaje: 'Accion no soportada: ' + accion });
    }
    const inicio = new Date().toISOString();
    const resultado = PP_ingesta_(cuerpo.forzado === true) || {};
    const salida = {};
    salida.ok = resultado.ok === true;
    salida.ejecutada = resultado.ejecutada === true;
    salida.accion = accion;
    salida.motivo = resultado.motivo || '';
    salida.filas = resultado.filas || {};
    salida.errores = resultado.errores || [];
    salida.log = resultado.log || [];
    salida.inicio = inicio;
    salida.fin = new Date().toISOString();
    return PP_jsonIngesta_(salida);
  } catch (error) {
    // El mensaje del error SI viaja en el cuerpo. Sin esto, la pagina solo podria decir
    // "no se pudo sincronizar", que es el aviso que no senala el lugar del fallo (RULE-SUP-027).
    return PP_jsonIngesta_({
      ok: false,
      ejecutada: false,
      accion: String(cuerpo && cuerpo.accion || 'ingesta'),
      motivo: 'error',
      mensaje: String(error && error.message || error).slice(0, 400),
      filas: {},
      errores: [String(error && error.message || error).slice(0, 100)],
      log: [],
      fin: new Date().toISOString()
    });
  } finally {
    try { lock.releaseLock(); } catch (error) { /* ya estaba soltado */ }
  }
}

/**
 * Respuesta JSON de la ingesta. Google sirve ContentService con `Access-Control-Allow-Origin: *`,
 * que es lo que deja que el navegador la lea; si se montara una respuesta a mano habria que poner
 * esa cabecera y no se puede desde un web app normal.
 *
 * MEDIDO 2026-09-30: esta se llamaba `PP_json_`, y YA HABIA OTRA CON ESE NOMBRE en
 * 16-supabase-catalogo.js: `PP_json_(valor, porDefecto)`, que devuelve un texto json validado
 * con respaldo y la usa el catalogo de herramientas. En Apps Script una funcion repetida gana
 * la ULTIMA que carga, y 19 va despues de 16, o sea que esta la tapaba y
 * `PP_json_(r.HERRAMENTALES_EXTRA_JSON, '[]')` devolvia un ContentService donde el catalogo
 * esperaba una cadena. El rename no es por gusto del nombre: es porque el proyecto tiene una
 * regla de una sola definicion por nombre y aqui se estaba rompiendo en silencio. Lo detecto el
 * test de funciones duplicadas de src/server/, que existe justo para esto.
 */
function PP_jsonIngesta_(datos) {
  return ContentService
    .createTextOutput(JSON.stringify(datos))
    .setMimeType(ContentService.MimeType.JSON);
}
