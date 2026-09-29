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
    throw new Error('Supabase rpc ingesta_mirror ' + tabla + ' ' + code + ': ' + res.getContentText().slice(0, 300));
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

/** Borra los activadores de la ingesta. Para deshacer PP_creaTriggerIngesta_(). */
function PP_borraTriggerIngesta_() {
  const t = ScriptApp.getProjectTriggers().filter(function(x) { return x.getHandlerFunction() === 'ingesta'; });
  t.forEach(function(x) { ScriptApp.deleteTrigger(x); });
  return 'Activadores de ingesta borrados: ' + t.length;
}

// =============================================================================
// Punto de entrada
// =============================================================================

function ingesta() {
  console.log('=== INGESTA START ===');
  const config = PP_config_();
  PP_verificaConfigIngesta_(config);
  console.log('Config OK. Account: ' + config.accountId);

  const ahora = new Date();
  const dia = ahora.getDay();
  const hora = ahora.getHours();
  console.log('Hora: ' + ahora.toISOString() + ' (dia=' + dia + ', hora=' + hora + ')');
  if (dia === 0 || dia === 6 || hora < 7 || hora >= 17) {
    console.log('Fuera de horario laboral. Saliendo.');
    return;
  }

  // Una sola llamada al RESTlet unificado
  console.log('Llamando al RESTlet unificado (2246)...');
  const respuesta = PP_restletUnificado_('todas', config);
  if (!respuesta.ok) {
    throw new Error('RESTlet no ok: ' + JSON.stringify(respuesta).slice(0, 300));
  }

  const acciones = respuesta.acciones;
  const log = [];

  // Mapeo de accion -> tabla, clave natural, y funcion de transformacion
  const TABLAS = {
    workorders: { tabla: 'work_orders', clave: 'ot' },
    operaciones: { tabla: 'operations', clave: 'operation_id' },
    // materials: la identidad es (ot, line_id). comp.id de NetSuite es el numero de
    // linea DENTRO de la OT y se repite entre OTs (medido 2026-09-29): con line_id
    // solo el upsert y el dedupe descartaban materiales de otras OTs.
    materiales: { tabla: 'materials', clave: 'ot,line_id' },
    items: { tabla: 'items', clave: 'codigo' },
    centros: { tabla: 'machines', clave: 'nombre' },
    inventario: { tabla: 'inventory', clave: 'item,ubicacion' },
    ordenes_venta: { tabla: 'sales_orders', clave: 'folio' }
  };

  for (const nombre in TABLAS) {
    try {
      const accion = acciones[nombre];
      if (!accion || !accion.ok) {
        log.push(nombre + ': ERROR ' + JSON.stringify(accion).slice(0, 100));
        console.log(nombre + ': ERROR ' + JSON.stringify(accion).slice(0, 200));
        continue;
      }
      let filas = accion.rows || [];
      console.log(nombre + ': ' + filas.length + ' filas recibidas');
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
      log.push(nombre + ': ' + r.escritas + ' filas (mirror, ' + r.borradas + ' borradas)');
      console.log(nombre + ': ' + r.escritas + ' escritas / ' + r.borradas + ' borradas (mirror atomico)');
    } catch (e) {
      log.push(nombre + ': ERROR ' + String(e.message || e).slice(0, 100));
      console.log(nombre + ': ERROR ' + String(e.message || e).slice(0, 200));
    }
  }
  console.log('Ingesta: ' + log.join(' | '));
  console.log('=== INGESTA END ===');
}
