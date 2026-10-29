/**
 * DISPARAR LA INGESTA DE NETSUITE.
 *
 * QUE ES Y QUE NO ES. Este modulo NO lee datos. Hace UNA cosa: pedirle al proyecto de Apps
 * Script que corra la ingesta, que es la que llama al RESTlet y escribe las siete tablas de
 * NetSuite en Supabase con el RPC ingesta_mirror. Lo que la pagina muestra DESPUES sale de
 * Supabase por el lector de siempre (PPSupabaseBridgeReplacement / PPSupabaseReader).
 *
 * POR QUE EXISTE, EN UNA FRASE. Antes los botones Sincronizar y Sincronizar OTs se limits a
 * leer lo que ya estaba en las tablas, asi que sincronizar era RALENTIZAR: pulsar el boton
 * noacia que NetSuite corriera. Con RULE-SUP-030 (la app no habla con NetSuite, NetSuite
 * carga a Supabase) un boton llamado Sincronizar que no dispara la ingesta no sincroniza
 * nada: solo vuelve a pintar lo viejo. Este modulo es la mitad que faltaba.
 *
 * ESTO NO ES EL PUENTE. El puente (apps-script-bridge-client.js) esta DESHABILITADO y sus 24
 * metodos rechazan: por el no se piden datos, NUNCA se devuelve un dato de NetSuite al
 * navegador, y esta puerta no se puede usar para leer nada porque lo unico que acepta es
 * `accion: 'ingesta'`. La URL es la misma que ya estaba embebida en el bundle; no hay una
 * segunda configuracion que mantener.
 *
 * ---------------------------------------------------------------------------------------------
 * LO QUE NO SE PUEDE HACER EN UN WEB APP DE APPS SCRIPT, Y POR QUE ESTA TAN COMMENTADO
 * ---------------------------------------------------------------------------------------------
 *
 * 1) EL POST VA COMO text/plain, NO COMO application/json. MEDIDO: es la razon de que
 *    `application/json` no sirva. Mandar application/json hace que el navegador envie primero
 *    un OPTIONS (preflight), porque JSON no es un "simple request", y Apps Script NO responde
 *    al preflight con las cabeceras CORS. El fetch muere en el navegador y no hay ni
 *    respuesta ni cuerpo ni error que leer: la pagina solo ve "Failed to fetch" y no puede
 *    distinguir eso de que se cayo la red. Con text/plain no hay preflight. El cuerpo sigue
 *    siendo JSON, pero viaja como texto y el servidor lo parsea a mano (ver doPost).
 *
 * 2) r.ok SIEMPRE DA VERDE, Y NO SE PUEDE MIRAR. Un web app en /exec no admite codigo de
 *    estado: ContentService responde 200 siempre. Lo unico que produce un 4xx/5xx de verdad
 *    es una excepcion sin capturar, y llega como una pagina HTML de error de Google. O sea que
 *    si este modulo juzgara la corrida por r.ok, un fallo de Supabase o del RESTlet se
 *    tragaria como una sincronizacion buena, y el toast diria "sincronizado" con tres tablas
 *    sin tocar. Por eso el veredicto es el campo `ok` DEL JSON, que el servidor pone en todas
 *    las salidas, incluida la excepcion. Este modulo es el unico que puede leerlo, y por eso
 *    el modulo se llama antes de leer nada de Supabase: si la ingesta fallo a medias, pintar
 *    las tablas viejas como si fueran nuevas seria mentir dos veces.
 *
 * 3) SIN doPost, ESTA URL RESPONDE UNA PAGINA HTML, NO UN ERROR. MEDIDO 2026-09-30 contra el
 *    proyecto desplegado:
 *      "No se encontro la funcion de la secuencia de comandos: doPost"
 *    con un 200 y el cuerpo de la pagina de error de Google. Sin el caso de mas abajo, un
 *    despliegue viejo se veria como "la ingesta fallo" y llevaria a mirar NetSuite, cuando el
 *    problema es que Apps Script esta en la version anterior. Es el mismo patron de dos veces
 *    en este repo: un mensaje que no senala el lugar del fallo manda a revisar el sistema
 *    equivocado (RULE-SUP-027).
 *
 * ---------------------------------------------------------------------------------------------
 * LO QUE ESTA EXPUESTO, DICHO EN SU NOMBRE PROPIO
 * ---------------------------------------------------------------------------------------------
 * La URL del web app es publica (esta en el bundle y su deployment es ANYONE_ANONYMOUS), y
 * ahora se puede pedir una corrida de ingesta con ella: una llamada al RESTlet. No se le
 * pone secreto porque no hay forma de ocultarlo sin escribirlo en el repo, que esta
 * prohibido, y porque el puente que se deshabilito el 2026-09-30 exponia 24 metodos sin
 * ninguno. Del lado del servidor hay un LockService: dos peticiones simultaneas no hacen dos
 * llamadas, y la segunda recibe un motivo DICHO ("ocupada") en vez de un error generico.
 */
(function initIngestaTrigger(root) {
  "use strict";

  /**
   * MEDIDO: una corrida de ingesta es una llamada al RESTlet unificado y siete espejos a
   * Supabase por el RPC ingesta_mirror (work_orders 199, operations 2111, materials 328...).
   * El limite de un web app en /exec es de 6 minutos por peticion, asi que el techo del
   * cliente va por debajo de ese limite a proposito: si el cliente espera 6 minutos, se queda
   * esperando una respuesta que ya no va a llegar y el unico sintoma seria un boton que
   * "se queda pensando" sin decir nada. 5 min 30 s deja medio minuto de margen para que el
   * corte lo decida el cliente, que puede decir algo, y no el servidor, que no puede.
   */
  const TIEMPO_MAXIMO_MS = 330000;
  const NOMBRE_FALLO_POR_TIEMPO = "La ingesta no respondio en 5 min 30 s. Puede seguir corriendo en Apps Script: revisa el contador de work_orders, y si subio, ya termino.";

  /**
   * La URL del web app. Se pide al cliente del puente en vez de duplicarla aqui: es el unico
   * sitio donde vive, y el build la sustituye una sola vez (build-appscript.mjs). Si aqui se
   * escribiera a mano, cualquier cambio de despliegue dejaria este modulo apuntando al
   * proyecto viejo, que es la clase de fallo que ya costo una vez (MEDIDO 2026-09-29: dos
   * despliegues dijeron "Pushed 26 files" y el proyecto seguia con la version anterior).
   */
  function urlDeIngesta() {
    const url = String(root.PPAppsScriptBridge && root.PPAppsScriptBridge.getBackendUrl
      ? root.PPAppsScriptBridge.getBackendUrl()
      : "").trim();
    return /^https:\/\/script\.google\.com\/macros\/s\//.test(url) ? url : "";
  }

  /** Los errores se comprimen en una frase corta: esto va dentro de un toast de 110 caracteres. */
  function textoDelError(json) {
    const motivo = String(json?.motivo || "");
    const mensaje = String(json?.mensaje || "").trim();
    const errores = Array.isArray(json?.errores) ? json.errores.filter(Boolean) : [];
    const noSePudoVaciar = Array.isArray(json?.noSePudoVaciar) ? json.noSePudoVaciar.filter(Boolean) : [];
    if (motivo === "ocupada") return "Ya hay una ingesta corriendo. Espera a que termine";
    // MEDIDO 2026-10-04: este texto era igual para "una tabla quedo vacia" y "una tabla quedo con
    // lo anterior", que son estados opuestos para quien esta mirando la pantalla: en el primero
    // no ve nada (y es la verdad), en el segundo ve datos de la corrida pasada creyendo que son
    // de ahora. Por eso el caso que NO se puede resumir en un conteo va PRIMERO y con el nombre
    // de la tabla adentro, no como numero.
    if (noSePudoVaciar.length) {
      return "Estas tablas conservan lo anterior: " + noSePudoVaciar[0].tabla;
    }
    if (errores.length) return "La ingesta fallo en " + errores.length + " tabla(s): " + errores[0].slice(0, 60);
    if (mensaje) return mensaje.slice(0, 100);
    if (motivo) return "La ingesta no corrio: " + motivo;
    return "La ingesta fallo y Apps Script no dijo por que";
  }

  /**
   * El cuerpo de Apps Script cuando doPost NO existe. Se busca el texto de Google y la palabra
   * doPost juntos: "No se encontro la funcion" solo aparece en esa pagina, y anadir doPost
   * evita que un error de Supabase que por casualidad traiga esas palabras se reporte como
   * "falta desplegar".
   */
  function esFaltaDeDoPost(texto) {
    return /no se encontr/i.test(texto) && /doPost/i.test(texto);
  }

  /**
   * Dispara la ingesta y DEVUELVE el veredicto. No lanza por una corrida que fallo: el motivo
   * esta en el objeto, para que quien llame decida si sigue leyendo de Supabase o avisa. Lanza
   * solo cuando no hay ni veredicto (sin URL, timeout, respuesta que no es JSON), que son
   * fallos del canal y no de la corrida: esos no se pueden convertir en "sincronizado".
   *
   * `forzado` viaja en el cuerpo y es lo que salta el filtro de horario laboral de
   * PP_ingesta_. Sin el, un boton pulsado a las 20:00 haria que la ingesta se saliera sin
   * escribir nada y devolviera ok:true, y el toast diria que se sincronizo.
   */
  async function dispararIngesta(opciones = {}) {
    const url = urlDeIngesta();
    if (!url) {
      throw new Error("No hay URL del proyecto de Apps Script en este build: la ingesta no se puede disparar");
    }
    const control = new AbortController();
    const reloj = root.setTimeout(() => control.abort(), Number(opciones.timeoutMs) > 0
      ? Number(opciones.timeoutMs)
      : TIEMPO_MAXIMO_MS);
    let r;
    let texto = "";
    try {
      r = await root.fetch(url, {
        method: "POST",
        // Ver el punto 1 de la cabecera. Este comentario es el unico sitio donde se puede
        // cambiar a application/json, y ese cambio es el que rompe la pagina.
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ accion: "ingesta", forzado: opciones.forzado !== false }),
        cache: "no-store",
        credentials: "omit",
        signal: control.signal,
      });
      texto = await r.text();
    } catch (error) {
      if (error && (error.name === "AbortError" || String(error.message || error).includes("aborted"))) {
        throw new Error(NOMBRE_FALLO_POR_TIEMPO);
      }
      throw new Error("No se pudo contactar la ingesta: " + String(error?.message || error).slice(0, 80));
    } finally {
      root.clearTimeout(reloj);
    }

    // Ver el punto 3 de la cabecera.
    if (esFaltaDeDoPost(texto)) {
      throw new Error("Apps Script esta en la version de antes: no tiene doPost. Despliega (npm run deploy) y reintenta");
    }

    let json = null;
    try {
      json = JSON.parse(texto);
    } catch {
      json = null;
    }
    if (!json || typeof json !== "object") {
      // r.ok se mira aqui, y SOLO aqui, y unicamente como senal de que lo que volvio no es lo
      // que este modulo espera. El veredicto de la corrida se lee en json.ok, nunca en r.ok.
      const prefijo = r.ok
        ? "Apps Script respondio algo que no es JSON"
        : "Apps Script respondio " + r.status + " sin JSON";
      throw new Error(prefijo + ": " + String(texto).replace(/\s+/g, " ").slice(0, 80));
    }

    // Un cuerpo sin `ok` no es un veredicto. Tratarlo como exito seria el fallo que todo este
    // modulo existe para evitar, y por eso se separa de los errores de las tablas.
    if (typeof json.ok !== "boolean") {
      throw new Error("La ingesta respondio sin veredicto (sin campo ok): " + String(texto).slice(0, 80));
    }
    if (!json.ejecutada) {
      return {
        ok: false,
        ejecutada: false,
        motivo: String(json.motivo || "sin ejecutar"),
        filas: {},
        errores: [],
        mensaje: textoDelError(json),
      };
    }

    const filas = json.filas && typeof json.filas === "object" ? json.filas : {};
    const total = Object.values(filas).reduce((suma, n) => suma + (Number(n) || 0), 0);
    // Las dos listas de RULE-SUP-048 llegan tal cual. No se resume su largo porque quien las
    // muestra es el panel de alertas, que no se corta, y reducir "noSePudoVaciar" a un numero
    // seria justo el silencio que la regla viene a quitar: una tabla que conserva lo anterior
    // tiene que poder leerse con su nombre.
    const vaciadas = Array.isArray(json.vaciadas) ? json.vaciadas.filter(Boolean) : [];
    const noSePudoVaciar = Array.isArray(json.noSePudoVaciar) ? json.noSePudoVaciar.filter(Boolean) : [];
    return {
      ok: json.ok === true,
      ejecutada: true,
      motivo: String(json.motivo || ""),
      filas,
      errores: Array.isArray(json.errores) ? json.errores.filter(Boolean) : [],
      vaciadas,
      noSePudoVaciar,
      totalFilas: total,
      inicio: String(json.inicio || ""),
      fin: String(json.fin || ""),
      mensaje: json.ok === true ? `${total} filas desde NetSuite` : textoDelError(json),
    };
  }

  root.PPIngestaTrigger = {
    dispararIngesta,
    urlDeIngesta,
    TIEMPO_MAXIMO_MS,
  };
})(window);