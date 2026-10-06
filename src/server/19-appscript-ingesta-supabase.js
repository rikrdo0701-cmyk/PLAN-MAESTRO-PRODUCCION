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
 * NO QUEDAN VALORES PREVIOS, NI SI UNO FALLA (RULE-SUP-048). Decision del usuario
 * el 2026-10-04: "todas las ingestas deberian borrar los valores previos y
 * reescribirse". Aplicado asi: si NetSuite NO devuelve una tabla (accion ausente o
 * `ok:false`), esa tabla se VACIA con el mismo RPC en vez de conservar lo de la corrida
 * pasada, porque lo anterior se veria en pantalla como si fuera de ahora. Y si la
 * escritura de una tabla revienta, se intenta vaciarla igual. Con la excepcion
 * MEDIDA y deliberada del bloque `sin_acciones`: si NINGUNA de las siete acciones vino
 * bien, la corrida se considera que no ocurrio y no se toca ninguna tabla (ver el
 * comentario de ahi, que es el unico caso donde se conservan valores previos).
 *
 * LO QUE NO SE PUEDE VACIAR SE DICE. Si ni el vaciado funciona (Supabase caido, RPC
 * con error), la tabla SI conserva lo anterior, y por eso la corrida devuelve
 * `noSePudoVaciar` con el nombre de la tabla y el motivo: "queda lo anterior" es
 * informacion que hay que poder leer, no un silencio.
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
  const cuerpo = res.getContentText();
  const json = JSON.parse(cuerpo);
  if (res.getResponseCode() !== 200) {
    // MEDIDO 2026-10-06: el mensaje usa el cuerpo CRUDO, no el parseado, para que lo que NetSuite
    // contesto se lea tal cual. Antes de agregar `__http` (abajo) era indistinguible; ahora, si se
    // imprimiera el parseado, el `__http` que se le pega al objeto apareceria dentro del mensaje
    // de error y taparia parte de lo que la cuenta de verdad dijo.
    throw new Error('RESTlet ' + res.getResponseCode() + ': ' + cuerpo.slice(0, 300));
  }
  // MEDIDO 2026-10-06: el codigo HTTP viaja con la respuesta. La corrida del 20:59 recibio un
  // 200 con un cuerpo que no era `{ ok, acciones }` y el unico sintoma fue un TypeError mas
  // abajo, que no decia ni el codigo ni el cuerpo. Con `__http` aqui, el aviso que arma
  // `PP_ingesta_` puede decir los dos. Es una propiedad con prefijo `__` a proposito: no puede
  // chocar con un campo del RESTlet, y el aviso de "SIN acciones" la saca de la lista de claves
  // que si trajo, porque ahi solo interesa lo que puso el otro lado.
  if (json && typeof json === 'object') json.__http = res.getResponseCode();
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

/**
 * VACIA UNA TABLA, Y COMPRUEBA QUE QUEDO VACIA. El vaciado ES el espejo con el payload
 * vacio: el RPC borra las filas y no inserta ninguna (docs/rpc-ingesta-mirror.sql:128,
 * la rama `if jsonb_array_length(p_filas) > 0`). No hay un segundo camino para borrar, y
 * ese es el punto: vaciar y reescribir son la misma llamada con dos payloads, asi que no
 * puede haber un "borrado" que se ejecute con otras reglas que el espejo.
 *
 * POR QUE COMPRUEBA EL RESULTADO Y NO SE FIA. El RPC devuelve `insertadas`, asi que un
 * vaciado que devolviera filas tiene un motivo que solo se ve aca. Sin esta comprobacion
 * la corrida reportaria `vaciada` sobre una tabla con filas, que es exactamente el
 * mentira que RULE-SUP-048 viene a quitar: por eso se tira el error y la tabla queda en
 * `noSePudoVaciar`.
 */
function PP_vaciaTabla_(tabla, config) {
  const r = PP_supabaseMirror_(tabla, [], config);
  if (r.escritas !== 0) {
    throw new Error('el espejo no vacio ' + tabla + ': devolvio ' + r.escritas + ' filas con el payload vacio');
  }
  return r;
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
// QUE NUNCA LE LLEGA A POSTGRES UN VALOR QUE NO PUEDA TOMAR
// =============================================================================

/**
 * MEDIDO 2026-10-05 a las 07:52, Y SALIO UNA TABLA EN CERO. La corrida llevo 513 filas a
 * `work_orders` (213 abiertas + 300 cerradas: la ventana de OTs cerradas de RULE-SUP-050
 * funcionando, y de paso verificadas `SYSDATE - 90`, `NULLS LAST` y `FETCH NEXT n ROWS ONLY`
 * en la cuenta) y la escritura se cayo assim:
 *
 *   work_orders: ERROR al escribir: Supabase rpc ingesta_mirror work_orders 400:
 *   codigo 22P02 | invalid input syntax for type integer: "
 *   work_orders: se intento escribir y no se pudo; se VACIO igual (213 filas borradas)
 *
 * `work_orders.cantidad` es `integer not null` (docs/schema-supabase.sql:179) y ALGUNA fila
 * trajo `cantidad` con la cadena vacia. Postgres no castea "" a entero: 22P02. Y como la
 * escritura fallo, RULE-SUP-048 vacio la tabla igual. O sea que un valor mal escrito en UNA fila
 * de 513 dejo a la pagina sin una sola OT de las 213 que tenia, y el espejo es la unica fuente:
 * no hay de donde recuperar.
 *
 * QUE HACE ESTE PASO, Y QUE NO HACE. No decide si el dato es correcto: decide que a Postgres le
 * llegue algo del TIPO que la columna declara. Un valor que no se puede leer va como 0 en las
 * columnas `not null default 0` (que es el default de la columna, o sea el mismo valor que ya
 * tiene la tabla cuando nadie escribe esa columna) y a `null` en las que admiten null. Y
 * CUENTA cuantas filas toco, con el nombre de la tabla y de las columnas, al `log` de la corrida:
 * un 0 puesto a mano sin que nadie lo diga es peor que un error.
 *
 * LA LISTA DE COLUMNAS ESTA ESCRITA CONTRA EL DDL, no adivinada: sale de `docs/schema-supabase.sql`
 * y `docs/schema-supabase-sync-netsuite.sql` (las siete tablas del espejo estan repartidas en los
 * dos). `tests/espejo-tipos-ddl.test.mjs` la COMPARA con esos DDL, asi que si el esquema gana una
 * columna numerica y esta lista no, ese test se cae.
 */
const COLUMNAS_NUMERICAS_ = {
  work_orders: ['cantidad', 'cant_ensamblada', 'cant_pendiente', 'precio_promedio_venta', 'precio_ultima_venta', 'revision'],
  operations: ['secuencia', 'cant_total', 'cant_pendiente', 'tiempo_ciclo', 'tiempo_setup', 'tiempo_prod', 'subcontract_days', 'revision'],
  materials: ['requerido', 'emitido', 'pendiente', 'revision'],
  items: ['clase', 'revision'],
  machines: [],
  inventory: ['disponible', 'fisico', 'comprometido', 'pickeado', 'en_transito', 'revision'],
  sales_orders: ['cliente_id', 'total', 'moneda', 'revision']
};

// Las fechas de las siete tablas del espejo son todas NULLABLE (docs/schema-supabase.sql:208-210
// y 231-232, `schema-supabase-sync-netsuite.sql` `fecha` y `ultima_modificacion`), asi que aqui un
// valor ilegible va a null y no a 0.
const COLUMNAS_FECHA_ = {
  work_orders: ['fecha_inicio_ns', 'fecha_fin_ns', 'fecha_vencimiento'],
  operations: ['fecha_inicio', 'fecha_fin', 'hora_inicio', 'hora_fin'],
  materials: [],
  items: ['ultima_modificacion'],
  machines: [],
  inventory: [],
  sales_orders: ['fecha']
};

const COLUMNAS_BOOL_ = {
  work_orders: [],
  operations: [],
  materials: [],
  items: ['es_ensamblaje', 'inactivo'],
  machines: ['activa'],
  inventory: [],
  sales_orders: []
};

/**
 * Una fecha solo pasa si es ISO. Un "01/10/2026" SI se parsea en un motor de JS (como octubre) y
 * se escribiria la FECHA EQUIVOCADA, que es peor que no tenerla: null es lo que ya hay en la
 * columna cuando no se sabe.
 */
function PP_fechaISO_(valor) {
  if (valor === null || valor === undefined) return null;
  const s = String(valor).trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  return isFinite(Date.parse(s)) ? s : null;
}

// El booleano NO se declara aqui: `PP_bool_` ya existe en 02-storage.js:2411 y los dos archivos
// van al mismo proyecto de Apps Script, asi que declararlo otra vez aqui no daria una segunda
// regla sino una funcin muerta que ademas gana la ultima en silencio
// (tests/appscript-ambito-global.test.mjs es el que avisa de eso). Se usa el de ahi, con `false`
// como valor cuando no se sabe: en el espejo, un booleano ilegible no se inventa.

/**
 * Deja las filas con el tipo que el DDL declara. Devuelve las filas nuevas (las de entrada NO se
 * tocan) y el conteo de lo que se corrigio, con el detalle por columna para el log.
 */
function PP_saneaTipos_(tabla, filas) {
  const numeros = COLUMNAS_NUMERICAS_[tabla] || [];
  const fechas = COLUMNAS_FECHA_[tabla] || [];
  const bools = COLUMNAS_BOOL_[tabla] || [];
  const tocadas = {};
  let corregidas = 0;
  const marcar = function (col) { tocadas[col] = (tocadas[col] || 0) + 1; corregidas++; };

  const salida = (filas || []).map(function (fila) {
    const copia = Object.assign({}, fila);
    for (const col of numeros) {
      if (!(col in copia)) continue;
      const v = copia[col];
      // Solo un numero, o un TEXTO que sea un numero. Un booleano no: `Number(true)` es 1, y
      // escribir 1 en una columna de cantidad porque llego un `true` es inventar un dato.
      const n = typeof v === 'number' ? v : (typeof v === 'string' ? (v.trim() !== '' ? Number(v) : 0) : NaN);
      if (typeof n === 'number' && isFinite(n)) {
        if (typeof v !== 'number') { copia[col] = n; marcar(col); }
      } else {
        copia[col] = 0; marcar(col);
      }
    }
    for (const col of fechas) {
      if (!(col in copia)) continue;
      const limpio = PP_fechaISO_(copia[col]);
      if (limpio !== copia[col]) { copia[col] = limpio; marcar(col); }
    }
    for (const col of bools) {
      if (!(col in copia)) continue;
      const v = PP_bool_(copia[col], false);
      if (v !== copia[col]) { copia[col] = v; marcar(col); }
    }
    return copia;
  });

  const detalle = Object.keys(tocadas).sort().map(function (c) { return c + ' ' + tocadas[c]; }).join(', ');
  return { filas: salida, corregidas: corregidas, detalle: detalle };
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
 *
 * LO QUE DEVUELVE, Y POR QUE HAY DOS LISTAS DE TABLAS QUE NO SE ESCRIBIERON (RULE-SUP-048).
 *   - `filas`    : tabla -> filas escritas. Solo las que se reescribieron de verdad.
 *   - `errores`  : una cosa que salio mal, sea cual sea. Define el `ok`.
 *   - `vaciadas` : tablas que esta corrida NO reescribio y que quedaron VACIAS a proposito.
 *   - `noSePudoVaciar` : tablas que conservan lo ANTERIOR porque ni el vaciado se pudo hacer.
 * Las dos ultimas no se pueden fundir en `errores`: una tabla vaciada se ve vacia y una que
 * quedo con lo anterior se ve CON DATOS VIEJOS, y quien mira la pantalla tiene que poder
 * distinguir esos dos casos.
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
    return { ok: true, ejecutada: false, motivo: 'fuera_de_horario', filas: {}, errores: [], log: [],
      vaciadas: [], noSePudoVaciar: [] };
  }

  // Una sola llamada al RESTlet unificado
  console.log('Llamando al RESTlet unificado (2246)...');
  const respuesta = PP_restletUnificado_('todas', config);
  // MEDIDO 2026-10-06, escribiendo la prueba que faltaba: `!respuesta` va primero porque
  // `PP_restletUnificado_` puede devolver `null` si el 200 trae un cuerpo `null` literal, y
  // `null.ok` es un TypeError que no dice nada del cuerpo. Con `!respuesta` primero, ese caso
  // cae en el mismo aviso que el resto y sale `RESTlet no ok: null`, que si lo dice.
  if (!respuesta || !respuesta.ok) {
    throw new Error('RESTlet no ok: ' + JSON.stringify(respuesta).slice(0, 300));
  }

  const acciones = respuesta.acciones;
  const log = [];
  // MEDIDO 2026-10-04: este contador se llamaba `filas` y lo tapaba el `let filas` de las filas
  // que se escriben en el bucle. Ver el comentario de ahi: la pagina recibia un arreglo en vez
  // de un conteo por tabla. Se llama `conteo` para que no se puedan volver a tapar.
  const conteo = {};
  const errores = [];
  // RULE-SUP-048: los dos inventarios de tablas que NO quedaron escritas en esta corrida.
  // `vaciadas` se vaciaron a proposito (NetSuite no las devolvio, o la escritura se cayo);
  // `noSePudoVaciar` son las que conservan lo anterior porque ni el vaciado funciono. La
  // diferencia importa en la pagina: las primeras se ven vacias, las segundas se ven con
  // datos VIEJOS, que es lo que hay que avisar.
  const vaciadas = [];
  const noSePudoVaciar = [];

  // MEDIDO 2026-10-06 20:59 (produccion). La corrida se murio con "TypeError: Cannot read
  // properties of undefined (reading 'workorders')" en la linea donde se indexa
  // `acciones[nombre]`. El `if (!respuesta.ok)` de mas arriba NO habia saltado, o sea que el
  // RESTlet contesto 200 con un cuerpo que no trae `acciones`: `acciones` no se comprobaba
  // nunca antes de indexarlo, y el unico filtro era `respuesta.ok`, que no dice nada de la
  // forma que esta corrida necesita.
  //
  // POR QUE NO SE DELEGA EL TypeError. Su mensaje no dice que se recibio, solo que falta una
  // clave, y con la traza parece un bug de la ingesta cuando lo mas probable es que lo
  // desplegado en NetSuite no sea este 2246. Este mensaje dice que se recibio, cuantas claves
  // trajo y que se esperaba, que es lo que hace falta para seguir sin adivinar.
  //
  // QUE SE HACE, Y QUE NO. Se avisa y se devuelve `ok:false` SIN escribir nada, igual que la
  // rama `sin_acciones` de mas abajo: no hay una sola tabla que reescribir, y vaciar las siete
  // seria el incidente de RULE-SUP-048. Se exige `{ ok, acciones }` porque eso es lo que
  // `accion: 'todas'` devuelve (netsuite-restlet-unificado-supabase.js:27-33).
  if (!acciones || typeof acciones !== 'object' || Array.isArray(acciones)) {
    const claves = (respuesta && typeof respuesta === 'object' ? Object.keys(respuesta) : [])
      .filter(function(k) { return k.slice(0, 2) !== '__'; });
    const msg = 'el RESTlet contesto ' + (respuesta && respuesta.__http ? respuesta.__http : 200) +
      ' SIN "acciones": claves que si trajo = [' + claves.join(', ') +
      '], contenido = ' + JSON.stringify(respuesta).slice(0, 300) +
      '. Se espera { ok, acciones } para accion:"todas" (netsuite-restlet-unificado-supabase.js:27-33): ' +
      'lo que esta desplegado en NetSuite no es este archivo. No se toco ninguna tabla.';
    console.log(msg);
    console.log('=== INGESTA END ===');
    return { ok: false, ejecutada: false, motivo: 'restlet_sin_acciones', mensaje: msg,
      filas: {}, errores: [msg], log: [msg], vaciadas: vaciadas, noSePudoVaciar: noSePudoVaciar };
  }

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

  // EL UNICO CASO EN EL QUE SE CONSERVAN VALORES PREVIOS, Y POR QUE. RULE-SUP-048 vacia
  // toda tabla que esta corrida no reescribio, asi que hay que decidir el caso en el que la
  // corrida no ocurrio: si NINGUNA de las siete acciones vino bien, la respuesta del RESTlet
  // no es "esta tabla fallo", es "este origen no respondio" — y las dos cosas piden lo
  // contrario. MEDIDO por que se distingue: una caida de red o un despliegue del RESTlet con
  // otro shape llega aqui con `respuesta.ok` en true y cero acciones usables, y vaciar las
  // siete tablas en ese caso deja la pagina EN BLANCO sin una sola OT, que en el taller se ve
  // como "se borro todo" y no como "no se pudo leer". Conservar lo anterior y reportar
  // `sin_acciones` deja la pagina con el dato viejo y un aviso que si dice la verdad.
  //
  // O sea: la regla es "toda tabla que esta corrida no reescribio queda vacia", y esta corrida
  // no se conto como corrida. El `ok:false` va en las dos salidas, con y sin vaciar.
  const accionesUsables = Object.keys(TABLAS).filter(function(nombre) {
    const a = acciones[nombre];
    return a && a.ok === true;
  });
  if (!accionesUsables.length) {
    const detalle = Object.keys(TABLAS).map(function(nombre) {
      const a = acciones[nombre];
      return nombre + ':' + (a ? ('ok=' + a.ok) : 'ausente');
    }).join(', ');
    const msg = 'el RESTlet no devolvio ninguna accion utilizable (' + detalle + '): no se toco ninguna tabla';
    console.log(msg);
    console.log('=== INGESTA END ===');
    return { ok: false, ejecutada: false, motivo: 'sin_acciones', mensaje: msg,
      filas: {}, errores: [msg], log: [msg], vaciadas: vaciadas, noSePudoVaciar: noSePudoVaciar };
  }
  console.log('Acciones utilizables del RESTlet: ' + accionesUsables.length + ' de ' + Object.keys(TABLAS).length);

  for (const nombre in TABLAS) {
    const def = TABLAS[nombre];
    try {
      const accion = acciones[nombre];
      if (!accion || !accion.ok) {
        // RULE-SUP-048, primera mitad: NetSuite no entrego esta tabla, entonces NO se conservan
        // las filas de la corrida anterior. Se vacia con el mismo RPC (payload vacio) y la tabla
        // queda en cero. Antes de esta regla la tabla se saltaba con un `continue` mudo: la
        // pagina seguia mostrando los datos viejos y el aviso decia "2 sin tocar" sin decir
        // cuales; ahora se vacia y se dice el nombre de la TABLA, no el de la accion de NetSuite.
        const causa = accion && accion.ok === false
          ? ('ok=' + accion.ok + ' ' + JSON.stringify(accion).slice(0, 80))
          : 'accion ausente en la respuesta del RESTlet';
        const r = PP_vaciaTabla_(def.tabla, config);
        const msg = def.tabla + ': NetSuite no la devolvio (' + causa + ') y se VACIO (' + r.borradas + ' filas borradas)';
        vaciadas.push(def.tabla);
        log.push(msg);
        errores.push(msg);
        console.log(msg);
        continue;
      }
      // MEDIDO 2026-10-04, UN DEFECTO QUE ESTA AQUI MISMO: el contador de filas por tabla se
      // llamaba `filas`, el MISMO nombre que usan las filas que se estan por escribir, y lo
      // tapaba dentro del bucle. Con el contador tapado, `filas[def.tabla] = r.escritas`
      // escribia una propiedad sobre el arreglo de filas que se iba a mandar al espejo, y el
      // `return { filas: filas }` devolvia ESE arreglo: las filas de la ULTIMA tabla del bucle
      // (sales_orders), no el conteo por tabla. Lo que llegaba a la pagina era un arreglo, y
      // su cuenta de "tablas al dia" era el numero de renglones de sales_orders con cada
      // renglon de detalle en "undefined filas". El contador ahora se llama `conteo` y las
      // filas se quedan con `filas`: el campo publico del return sigue llamandose `filas`.
      let filas = accion.rows || [];
      console.log(nombre + ': ' + filas.length + ' filas recibidas');
      // Lo que el 2246 dice de la ventana de OTs CERRADAS (RULE-SUP-050). Va al LOG y no a
      // `errores` a proposito: si la consulta de cerradas fallo, las abiertas si se escribieron
      // y la corrida es valida; lo que se pierde es la evidencia de cierre, y eso lo va a
      // decir el toast de inspeccion cuando vuelva a aparecer. Meterlo en `errores` diria que
      // la corrida fallo, y eso no fue.
      if (accion.cerradas) {
        log.push(nombre + ': ' + accion.cerradas.incluidas + ' OTs cerradas de ' + accion.cerradas.dias +
          ' dias (tope ' + accion.cerradas.tope + ')');
      }
      if (accion.aviso) log.push(nombre + ': ' + accion.aviso);
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
      if (nombre === 'items') filas = deduplicar_(filas, function(f) { return f.codigo; });
      if (nombre === 'materiales') filas = deduplicar_(filas, function(f) { return f.ot + '#' + f.line_id; });
      if (nombre === 'inventario') filas = deduplicar_(filas, function(f) { return f.item + '#' + f.ubicacion; });
      // Mirror atómico de NetSuite: el RPC borra la tabla completa y escribe lo
      // nuevo en una sola transacción, para que no queden filas de corridas
      // anteriores ni ventanas con la tabla vacía.
      //
      // ANTES de escribir, y por lo que paso el 2026-10-05: una fila con `cantidad` en "" hizo
      // que Postgres tirara 22P02 y que la tabla quedara VACIA (arriba, el porque). El saneo no
      // adivina el dato: le da a Postgres el TIPO que el DDL declara, y avisa cuantos valores toco.
      //
      // Va en SU PROPIO try/catch, y no es paranoia. Este bloque esta dentro del try cuya falla
      // VACIA la tabla (RULE-SUP-048, segunda mitad): si el saneo llegara a fallar -un despliegue
      // a medias donde `PP_bool_` todavia no existe, o una fila que no es un objeto- fallaria por
      // lo mismo que fallo el 22P02, o sea por su propia cuenta. Un arreglo de la escritura que
      // puede tumbar la escritura no es un arreglo. Si falla, las filas van COMO VINIERON (que es
      // como se comportaba antes) y el log lo dice con el motivo: un saneo que no corrio tiene que
      // ser visible, no un 22P02 a los dos segundos.
      try {
        const saneadas = PP_saneaTipos_(def.tabla, filas);
        filas = saneadas.filas;
        if (saneadas.corregidas) {
          const aviso = def.tabla + ': ' + saneadas.corregidas + ' valores que no eran del tipo que el DDL declara (' +
            saneadas.detalle + ') se escribieron con el valor por omision de la columna; el espejo es exacto y no se corrige a mano';
          log.push(aviso);
          console.log(aviso);
        }
      } catch (error) {
        const msg = def.tabla + ': el saneo de tipos NO se pudo correr (' +
          String(error && error.message || error).slice(0, 120) + '); las filas van como vinieron';
        log.push(msg);
        errores.push(msg);
        console.log(msg);
      }
      const r = PP_supabaseMirror_(def.tabla, filas, config);
      conteo[def.tabla] = r.escritas;
      log.push(def.tabla + ': ' + r.escritas + ' filas (mirror, ' + r.borradas + ' borradas)');
      console.log(def.tabla + ': ' + r.escritas + ' escritas / ' + r.borradas + ' borradas (mirror atomico)');
    } catch (e) {
      // RULE-SUP-048, segunda mitad: la escritura de esta tabla se cayo, y tampoco se conservan
      // los valores anteriores. Se intenta el vaciado con el mismo RPC. Lo que NO se hace es
      // tragarselo: si el vaciado tambien falla, la tabla queda en `noSePudoVaciar` con su
      // motivo, porque "queda lo anterior" es un dato que hay que poder leer.
      const msg = def.tabla + ': ERROR al escribir: ' + String(e.message || e).slice(0, 100);
      log.push(msg);
      errores.push(msg);
      console.log(msg);
      try {
        const r = PP_vaciaTabla_(def.tabla, config);
        vaciadas.push(def.tabla);
        const aviso = def.tabla + ': se intento escribir y no se pudo; se VACIO igual (' + r.borradas + ' filas borradas)';
        log.push(aviso);
        console.log(aviso);
      } catch (e2) {
        const motivo = String(e2.message || e2).slice(0, 100);
        const aviso = def.tabla + ': NO SE PUDO VACIAR, conserva lo anterior: ' + motivo;
        log.push(aviso);
        errores.push(aviso);
        noSePudoVaciar.push({ tabla: def.tabla, motivo: motivo });
        console.log(aviso);
      }
    }
  }
  console.log('Ingesta: ' + log.join(' | '));
  console.log('=== INGESTA END ===');
  // ok:false si AL MENOS una tabla fallo. La corrida del ACTIVADOR tambien lo trae y no lo mira:
  // antes escribia el error en el log y seguia, y eso se conserva. Lo que cambia es que quien
  // la pidio (la pagina) ahora puede enterarse de una sincronizacion a medias en vez de leer
  // "sincronizado" sobre una tabla que no se toco.
  //
  // `vaciadas` y `noSePudoVaciar` van aparte de `errores` porque NO SON LO MISMO y la pagina
  // los muestra distinto: una tabla vaciada se ve vacia (dato honesto) y una que quedo con lo
  // anterior se ve con datos VIEJOS (dato que hay que marcar). Juntas en `errores` las dos
  // clases se perderian.
  return { ok: errores.length === 0, ejecutada: true, filas: conteo, errores: errores, log: log,
    vaciadas: vaciadas, noSePudoVaciar: noSePudoVaciar };
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
    // Las dos listas de RULE-SUP-048 viajan en la respuesta, no solo en el log de Apps Script:
    // quien pide la corrida es la pagina, y "esta tabla quedo vacia" y "esta tabla quedo con
    // lo anterior" son dos hechos que solo se pueden mostrar si llegan hasta ella.
    salida.vaciadas = Array.isArray(resultado.vaciadas) ? resultado.vaciadas : [];
    salida.noSePudoVaciar = Array.isArray(resultado.noSePudoVaciar) ? resultado.noSePudoVaciar : [];
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
      // Una excepcion antes de entrar al bucle (configuracion a medias, o el RESTlet que no.ok)
      // deja las siete tablas SIN TOCAR. No es una corrida a medias: es que no hubo corrida, asi
      // que las dos listas de RULE-SUP-048 van vacias y no se inventa ninguna tabla que se haya
      // vaciado. Lo que no cabe es devolver esto como si fuera exito, y por eso ok:false va
      // primero.
      vaciadas: [],
      noSePudoVaciar: [],
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
