/**
 * PELIGRO MEDIDO, Y TODAVIA NO RESUELTO. LEER ANTES DE USAR ESTE MODULO.
 *
 * `operations`, `work_orders` y `materials` NO son solo el plan: hoy las escribe
 * la ingesta del RESTlet 2246, y MEDIDO el 2026-09-29 hay 1000 filas en
 * `operations` con operation_id de la forma `ns-29354`, que es el id de link de
 * NetSuite (08-netsuite.js:1066 lo construye como 'ns-' + ID (link)). El mismo
 * prefijo y el mismo key usa la web: 02-storage.js:830 saca el id con una expresion
 * regular que empieza por ns- y sigue con digitos.
 * O sea que el navegador y NetSuite comparten las mismas filas y las mismas
 * claves, y por eso el modelo de espejo (borrar la tabla y reinsertar) es
 * DESASTROSO en esas tres tablas, por una razon que no es la de la transaccion:
 *
 *   Si la persona tiene la pagina abierta desde ayer y mientras tanto corrio una
 *   sincronizacion de NetSuite que metio 200 operaciones nuevas, su estado en el
 *   navegador NO las tiene. Un borrar-todo seguido de insertar lo que tiene
 *   borra esas 200 filas, que son mas nuevas que las que el navegador conoce.
 *   No es perder el trabajo de la persona: es perder datos del ERP que ella
 *   todavia no ha visto. Y no da ningun error, porque el borrado fue con exito.
 *
 * Las cuatro tablas donde el espejo SI es correcto, porque solo las escribe la
 * persona y no hay un segundo escritor: `selected_ots`, `locked_ots`,
 * `operation_plan_statuses` y `app_state`.
 *
 * Como se resuelve es una decision del usuario, no mia, y esta pendiente: para
 * las tres del ERP lo correcto es un UPSERT por clave natural en vez de un
 * borrado, y decidir que pasa con una operacion que la persona saca del plan (una
 * marca, no un borrado de fila). Hasta que eso se decida, este modulo NO debe
 * guardar en `operations`, `work_orders` ni `materials`, y el arranque tiene que
 * decirlo en pantalla. La razon esta escrita tambien en RULE-SUP-024.
 *
 * ------------------------------------------------------------------
 *
 * El plan se escribe en Supabase desde la pagina, con la sesion de la persona.
 * No por el puente de Apps Script.
 *
 * QUE ES ESTE MODULO Y POR QUE AHORA. La lectura ya sale de Supabase
 * (supabase-reader.js). Este es el otro lado: el guardado. Con la sesion de
 * correo (supabase-auth.js) el navegador es `authenticated`, y la politica
 * `escritura_app` (`for all to authenticated using (true) with check (true)`)
 * deja escribir el estado del plan. O sea que la pagina puede guardar en
 * Supabase lo que la persona acaba de cambiar, sin pasar por Apps Script, que
 * se midio en 1311 ms por llamada contra 123 ms de Supabase (RULE-SUP-020).
 *
 * EL TOKEN, Y POR QUE NUNCA SE ESCRIBE SIN EL. El JWT sale de
 * PPSupabaseAuth.token(), que lo renueva si va a caducar. Va en `Authorization:
 * Bearer`, que es el header del que RLS lee el rol. La clave publicable viaja
 * en el bundle publico de GitHub Pages, asi que escribir solo con ella seria
 * escribir con una credencial que lee cualquiera que abra la URL. Por eso, si no
 * hay token, este modulo NO ESCRIBE NADA y devuelve el motivo.
 *
 * NOTA HONESTA SOBRE LOS DOS HEADERS. `apikey` lleva la clave publicable, que es
 * lo que documenta Supabase y lo que hace el resto del proyecto (supabase-reader.js
 * y todas las sondas). `Authorization` lleva el JWT de sesion. Poner el JWT en
 * `apikey` tambien funciona en algunas instalaciones, pero no se puede medir aqui
 * (este modulo no tiene acceso a la base), asi que se queda lo que esta medido en
 * el resto del proyecto. Lo que NO se negocia es que sin JWT no se escribe.
 *
 * COMO SE ESCRIBE: POR TABLAS, Y SIN TRANSACCION. El mecanismo atomico de este
 * proyecto es el RPC public.ingesta_mirror, que borra e inserta DENTRO de una
 * transaccion. Ese RPC esta REVOCADO para el navegador a proposito: borra la
 * tabla que le digan, y una pagina que puede llamarlo puede vaciar el plan
 * (docs/schema-supabase-plan.sql, seccion 5; y RULE-SUP-021, que es la vez que
 * un uso de prueba borro dos tablas de produccion). Y aunque no estuviera
 * revocado, aqui no se puede crear uno: no hay acceso a la base de datos.
 *
 * POR CONSECUENCIA ESTO NO ES ATOMICO, Y NO SE DISIMULA. Para las tablas que son
 * espejo del estado completo (operations, work_orders, materials, selected_ots,
 * locked_ots, operation_plan_statuses) el patron es borrar y reinsertar, en dos
 * peticiones HTTP: `DELETE ...?id=neq.00000000-...` y despues el POST. Si el
 * proceso se muere entre las dos, la tabla queda VACIA. No hay rollback. La
 * transaccion de verdad necesita un RPC o una funcion de Postgres, y esa es la
 * tarea que queda pendiente y hay que hacer desde el panel de Supabase.
 *
 * EL BORRADO LLEVA LA TAUTOLOGIA A PROPOSITO. PostgREST rechaza un DELETE sin
 * WHERE (MEDIDO 2026-09-29, issue supabase-py #534) y ningun id vale el uuid
 * nulo, asi que `id=neq.00000000-0000-0000-0000-000000000000` borra todo y es
 * valido. Es el mismo truco que usa el propio RPC (schema-supabase-plan.sql:323).
 *
 * UN ESTADO VACIO NO ES "BORRA TODO". Si el estado llega sin filas, la tabla NO se
 * borra y el informe lo dice. La razon es RULE-SUP-021: un payload vacio no es un
 * error, se instala. Un guardado que fallo al leer y llega con cero operaciones
 * vaciaria el plan entero, y eso es peor que dejar el anterior. Quien sepa que
 * el vacio es de verdad lo pide con `vaciarSiEstaVacio`. El espejo de catalogos
 * (16-supabase-catalogo.js) hace lo mismo: hoja inexistente, se salta, no se
 * espeja vacio.
 *
 * LOS EVENTOS NO SE BORRAN NUNCA. `operation_events` es un FLUJO, no un atributo
 * (docs/schema-supabase-plan.sql seccion 2): es el log de la app y se consulta
 * por OT, por tipo y por fecha. Por eso se inserta evento por evento con un POST
 * cada uno, y nunca se borra. Para que eso NO rompa la idempotencia, cada evento
 * lleva un id DETERMINISTA derivado de (operacion, tipo, indice, mensaje): el
 * mismo evento sale SIEMPRE con el mismo id, y `Prefer: resolution=merge-duplicates`
 * con `on_conflict=id` hace que el segundo POST actualice en vez de duplicar.
 * Guardar dos veces con el mismo estado deja la tabla de eventos igual.
 *
 * LO QUE NO SE REINTENTA, Y POR QUE. Este es el mismo criterio de
 * supabase-catalog-boot.js y esta copiado por el mismo motivo: un 401 o un 403 no
 * mejora esperando (la sesion no esta, el JWT no sirve, o RLS cerro la puerta) y
 * un 404 tampoco (la tabla no existe). Reintentarlos tres veces solo convierte un
 * fallo instantaneo en un fallo lento, y deja a la persona mirando una pantalla
 * que no va a cambiar. Lo que SI se reintenta es lo transitorio: red, 5xx, 429.
 *
 * LO QUE NO SE IMPRIME. Ni el token ni la clave, ni en un error ni en el informe:
 * todo texto que venga de fuera pasa por sano(), que los reemplaza por
 * [oculto]. Un token en un log es una credencial filtrada.
 */
(function (root) {
  "use strict";

  // El build reemplaza estos dos marcadores (scripts/build-appscript.mjs). Si
  // quedan asi, este modulo esta apagado, igual que el lector.
  const DEFAULT_URL = "__PP_SUPABASE_URL__";
  const DEFAULT_ANON_KEY = "__PP_SUPABASE_ANON_KEY__";

  const config = { url: DEFAULT_URL, anonKey: DEFAULT_ANON_KEY };

  const INTENTOS = 3;
  const ESPERAS_MS = [400, 1200, 3000];
  const TIMEOUT_POR_INTENTO_MS = 30000;
  // Mismo presupuesto que el espejo de catalogos (PP_CATALOGO_PRESUPUESTO_MS en
  // 16-supabase-catalogo.js) y por la misma razon: si Supabase esta lento o
  // caido, un guardado no puede quedarse colgado. Lo que se queda fuera se dice
  // en el informe; no se traga.
  const PRESUPUESTO_MS = 20000;
  const UUID_NULO = "00000000-0000-0000-0000-000000000000";
  // El separador del log de la app (OP_LOG_SEPARATOR, app.js:13704).
  const SEPARADOR_LOG = " | ";

  /**
   * Tablas que son ESPEJO del estado completo: se borran y se reescriben.
   * Cada una con la columna de su clave natural, que es la que usa on_conflict.
   * work_orders NO esta en el mapa: no tiene ningun indice unico (docs/schema-
   * supabase.sql:192-221 y el delta de sync-netsuite.sql), y `id` es el uuid que
   * pone la base. Sin on_conflict, PostgREST usa la primary key, que aqui nunca
   * se manda, asi que cada fila entra con uuid nuevo y no puede chocar.
   */
  const ESPEJO = ["operations", "work_orders", "materials", "selected_ots", "locked_ots", "operation_plan_statuses"];
  const CLAVE_NATURAL = {
    operations: "operation_id",
    materials: "ot,line_id",
    selected_ots: "ot",
    locked_ots: "ot",
    operation_plan_statuses: "key",
  };

  /**
   * Las tres tablas que tienen UN SEGUNDO ESCRITOR: la ingesta del RESTlet 2246.
   * MEDIDO 2026-09-29: `operations` tiene 1000 filas con operation_id `ns-XXXXX`,
   * que es el id de link de NetSuite (08-netsuite.js:1066), y el navegador usa el
   * mismo key (02-storage.js:830, ns- seguido de digitos). Por eso aqui NO se borra:
   * se hace UPSERT por clave natural. Ver el PELIGRO MEDIDO de la cabecera.
   */
  const ERP_COMPARTIDA = { operations: true, work_orders: true, materials: true };

  // Ids de los eventos que ya salieron en ESTA pagina. Sirve para que un guardado
  // que se topa con el presupuesto no repita (y no vuelva a pagar) lo que ya
  // esta escrito: el corte avanza de verdad en vez de estarse reenviando lo mismo.
  const eventosEnviados = new Set();

  // ---------------------------------------------------------------------------
  // Configuracion
  // ---------------------------------------------------------------------------

  function configure(patch) {
    if (patch && typeof patch === "object") {
      if (patch.url != null) config.url = String(patch.url).replace(/\/+$/, "");
      if (patch.anonKey != null) config.anonKey = String(patch.anonKey);
    }
    return configActual();
  }

  function configActual() {
    return { url: config.url, anonKey: config.anonKey };
  }

  function isConfigured() {
    return Boolean(
      config.url && config.anonKey &&
      String(config.url).indexOf("__PP_") !== 0 && String(config.anonKey).indexOf("__PP_") !== 0
    );
  }

  // ---------------------------------------------------------------------------
  // Red
  // ---------------------------------------------------------------------------

  /** Lo que no se reintenta y por que esta en el comentario de la cabecera. */
  function noReintentar(status) {
    if (status === 401 || status === 403 || status === 404) return true;
    return false;
  }

  const dormir = (ms) => new Promise((r) => root.setTimeout(r, ms));

  function recorte(valor, maximo) {
    const salida = String(valor == null ? "" : valor).trim();
    const tope = maximo || 300;
    return salida.length > tope ? salida.slice(0, tope) + "..." : salida;
  }

  /**
   * Unico lugar por donde sale un texto ajeno al informe. Quita el token y la
   * clave si por lo que sea vinieran dentro: la garantia es que el informe NO
   * puede contenerlos, no que hoy no contenga ninguno.
   */
  function sano(valor, secretos) {
    let salida = recorte(valor, 300);
    (secretos || []).forEach((secreto) => {
      if (!secreto) return;
      salida = salida.split(String(secreto)).join("[oculto]");
    });
    return salida;
  }

  function cabeceras(token, prefer) {
    const base = {
      // La clave publicable identifica el proyecto ante el gateway (es lo que
      // documenta Supabase y lo que ya hace supabase-reader.js).
      apikey: config.anonKey,
      // Y el rol sale de aqui: el JWT de la sesion. Nunca la clave sola.
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    };
    return prefer ? Object.assign(base, { Prefer: prefer }) : base;
  }

  function construirUrl(tabla, opciones) {
    const opts = opciones || {};
    const partes = [];
    if (opts.onConflict) partes.push("on_conflict=" + encodeURIComponent(opts.onConflict));
    if (opts.columna) partes.push(encodeURIComponent(opts.columna) + "=" + opts.valor);
    if (opts.condicion) partes.push(opts.condicion);
    return config.url + "/rest/v1/" + encodeURIComponent(tabla) + (partes.length ? "?" + partes.join("&") : "");
  }

  /**
   * Una escritura a la Data API, con reintentos. Devuelve la respuesta si la
   * llamada salio; lanza con un mensaje que dice el status y el detalle de
   * PostgREST (que es donde esta la causa: columna que no existe, RLS, etc.).
   */
  async function pedir(token, metodo, tabla, opciones) {
    const opts = opciones || {};
    const destino = construirUrl(tabla, opts);
    const cuerpo = opts.cuerpo === undefined ? undefined : JSON.stringify(opts.cuerpo);
    const cabecerasPeticion = cabeceras(token, opts.prefer);
    let ultimo = null;
    for (let intento = 0; intento < INTENTOS; intento += 1) {
      if (intento > 0) await dormir(ESPERAS_MS[intento - 1] || ESPERAS_MS[ESPERAS_MS.length - 1]);
      const control = new AbortController();
      const temporizador = root.setTimeout(() => control.abort(), TIMEOUT_POR_INTENTO_MS);
      try {
        const respuesta = await root.fetch(destino, {
          method: metodo,
          headers: cabecerasPeticion,
          body: cuerpo,
          signal: control.signal,
          cache: "no-store",
        });
        if (respuesta.ok) return respuesta;
        let detalle = "";
        try { detalle = await respuesta.text(); } catch { detalle = ""; }
        ultimo = new Error("HTTP " + respuesta.status + (detalle ? ": " + detalle : ""));
        ultimo.status = respuesta.status;
        if (noReintentar(respuesta.status)) throw ultimo;
      } catch (error) {
        // Si es el que acabamos de armar con un status que no se reintenta, sale
        // aqui mismo y no vuelve al for.
        if (error === ultimo) throw ultimo;
        ultimo = error;
      } finally {
        root.clearTimeout(temporizador);
      }
    }
    throw ultimo || new Error("HTTP ? sin respuesta");
  }

  // ---------------------------------------------------------------------------
  // Las tres formas de escribir
  // ---------------------------------------------------------------------------

  /**
   * Espejo: borra las filas y reinserta las del estado. SIN transaccion: son dos
   * peticiones y no hay rollback (esta en la cabecera, y no se disimula).
   *
   * `borrar` es un parametro y NO un supuesto, porque en las tres tablas del ERP
   * el borrado es un riesgo de perder datos: ver el PELIGRO MEDIDO de la cabecera.
   * Ahi `escribirEspejo` se llama con borrar:false y el POST queda siendo un
   * UPSERT por clave natural, que actualiza lo que la persona toco y no toca lo
   * que el navegador no conoce.
   */
  async function escribirEspejo(ctx, tabla, filas, vaciar, borrar) {
    if (!filas.length && !vaciar) {
      return { insertadas: 0, error: "sin filas: no se borra la tabla (vaciarSiEstaVacio lo hace explicito)" };
    }
    try {
      if (borrar) await pedir(ctx.token, "DELETE", tabla, { condicion: "id=neq." + UUID_NULO });
      if (!filas.length) return { insertadas: filas.length, error: null, borradas: borrar ? 0 : 0 };
      await pedir(ctx.token, "POST", tabla, {
        cuerpo: filas,
        onConflict: CLAVE_NATURAL[tabla],
        prefer: "resolution=merge-duplicates,return=minimal",
      });
      return { insertadas: filas.length, error: null };
    } catch (error) {
      return { insertadas: 0, error: sano((error && error.message) || error, ctx.secretos) };
    }
  }

  /**
   * Anexo: se sube o se pisa por su clave natural y NUNCA se borra. Lo usan los
   * snapshots, que son historial de planes publicados (RULE-OT-005).
   */
  async function escribirAnexo(ctx, tabla, filas, onConflict) {
    if (!filas.length) return { insertadas: 0, error: null };
    try {
      await pedir(ctx.token, "POST", tabla, {
        cuerpo: filas,
        onConflict: onConflict,
        prefer: "resolution=merge-duplicates,return=minimal",
      });
      return { insertadas: filas.length, error: null };
    } catch (error) {
      return { insertadas: 0, error: sano((error && error.message) || error, ctx.secretos) };
    }
  }

  /**
   * app_state tiene UNA fila (id integer, check id = 1): se ACTUALIZA, no se
   * inserta. Un POST crearia una fila que el check del DDL no deja crear, y un
   * borrado previo dejaria la pagina sin revision.
   */
  async function parchearAppState(ctx, fila) {
    try {
      await pedir(ctx.token, "PATCH", "app_state", { cuerpo: fila, columna: "id", valor: "eq.1" });
      return { insertadas: 0, error: null };
    } catch (error) {
      return { insertadas: 0, error: sano((error && error.message) || error, ctx.secretos) };
    }
  }

  /**
   * operation_events: UN POST POR EVENTO, y jamas un DELETE. Con el id
   * determinista y resolution=merge-duplicates, repetir el mismo evento actualiza
   * la fila en vez de duplicarla, asi que el flujo sigue siendo idempotente.
   * `at` no se manda a proposito: lo pone el default now() en el INSERT y, al no
   * venir en el payload, el DO UPDATE lo conserva; asi la segunda pasada del mismo
   * evento no le cambia la hora.
   */
  async function escribirEventos(ctx, filas) {
    let insertadas = 0;
    let omitidas = 0;
    let corte = false;
    for (const fila of filas) {
      // Un evento que ya salio de ESTA pagina esta en la tabla: su id es
      // determinista y lo que se mando fue un upsert. No se vuelve a pedir, que
      // seria pagar otra vez una escritura que no cambia nada.
      if (eventosEnviados.has(fila.id)) { insertadas += 1; continue; }
      if (corte) { omitidas += 1; continue; }
      if (Date.now() - ctx.t0 > PRESUPUESTO_MS) { corte = true; omitidas += 1; continue; }
      try {
        await pedir(ctx.token, "POST", "operation_events", {
          cuerpo: [fila],
          onConflict: "id",
          prefer: "resolution=merge-duplicates,return=minimal",
        });
        eventosEnviados.add(fila.id);
        insertadas += 1;
      } catch (error) {
        // Un evento que falla no se come el guardado entero: se cuenta y se sigue.
        omitidas += 1;
        if (!corte) corte = true;
        ctx.avisos.push(sano((error && error.message) || error, ctx.secretos));
      }
    }
    const error = omitidas
      ? "se omitieron " + omitidas + " evento(s) tras " + PRESUPUESTO_MS + " ms: " + (ctx.avisos[0] || "sin detalle")
      : null;
    // insertadas son los eventos del estado que quedan en la tabla al terminar,
    // no los POST que salieron: por eso dos guardados seguidos dan el mismo
    // numero. Un guardado en una pagina nueva los manda otra vez, y el
    // upsert sobre el mismo id no crea filas nuevas.
    return { insertadas: insertadas, error: error };
  }

  // ---------------------------------------------------------------------------
  // Conversiones
  // ---------------------------------------------------------------------------

  function texto(valor) { return String(valor == null ? "" : valor).trim(); }

  function numero(valor, porDefecto) {
    const defecto = porDefecto === undefined ? 0 : porDefecto;
    if (valor === null || valor === undefined || texto(valor) === "") return defecto;
    const n = Number(valor);
    return isFinite(n) ? n : defecto;
  }

  function booleano(valor, porDefecto) {
    if (valor === true || valor === false) return valor;
    const t = texto(valor).toUpperCase();
    if (t === "TRUE" || t === "VERDADERO" || t === "SI" || t === "1") return true;
    if (t === "FALSE" || t === "FALSO" || t === "NO" || t === "0") return false;
    return porDefecto;
  }

  /**
   * jsonb: pasa el objeto tal cual. Acepta tambien un texto que ya sea JSON
   * (viene de las Hojas, donde se guardaba como cadena) y, si no es JSON, cae en
   * el valor por defecto. Nunca manda una cadena suelta: una columna jsonb con
   * texto que no es JSON revienta el INSERT entero y, sin transaccion, deja la
   * tabla a medio escribir.
   */
  function jsonb(valor, porDefecto) {
    if (valor === null || valor === undefined) return porDefecto;
    if (typeof valor === "object") return valor;
    const t = texto(valor);
    if (!t) return porDefecto;
    try { return JSON.parse(t); } catch { return porDefecto; }
  }

  /**
   * fecha + hora del estado -> un instante ISO en UTC.
   *
   * En el estado la fecha y la hora van separadas (PP_OPERATION_FIELDS:
   * fechaInicio / horaInicio) y en Supabase la columna es timestamptz, o sea que
   * hay que unirlas. Mismo criterio que isoFechaHora_ del RESTlet 2246
   * (netsuite-restlet-unificado-supabase.js:396): la hora de la pared se toma
   * como UTC, porque las fechas de la hoja no llevan zona.
   *
   * A diferencia de ahi, lo que no es una fecha devuelve null en vez del texto
   * crudo: un texto que Postgres no acepta revienta el INSERT de la tabla
   * entera (RULE-SUP-021) y no hay rollback que lo arregle.
   */
  function instante(fecha, hora) {
    const f = texto(fecha);
    if (!f) return null;
    const h = texto(hora);
    // Una fecha que YA trae zona (el estado guarda savedAt, syncedAt y completedAt
    // con el Z de toISOString) es inequivoca: se respeta tal cual y la hora del
    // estado no interviene. Un instante CON zona no se reinterpreta como hora de
    // pared, que es lo que se hace con las fechas que no la traen.
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/i.test(f)) {
      const directo = new Date(f);
      return isNaN(directo.getTime()) ? null : directo.toISOString();
    }
    let anio = 0;
    let mes = 0;
    let dia = 0;
    let hh = 0;
    let mm = 0;
    let ss = 0;
    let conHora = false;
    const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(f);
    if (iso) {
      anio = Number(iso[1]);
      mes = Number(iso[2]) - 1;
      dia = Number(iso[3]);
      if (iso[4]) { hh = Number(iso[4]); mm = Number(iso[5]); ss = iso[6] ? Number(iso[6]) : 0; conHora = true; }
    } else {
      // "dd/MM/aaaa" tambien llega de NetSuite y de las hojas.
      const lat = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(f);
      if (!lat) return null;
      dia = Number(lat[1]);
      mes = Number(lat[2]) - 1;
      anio = Number(lat[3]);
    }
    // La hora del estado manda si la hubo, porque en PP_OPERATION_FIELDS la
    // fecha y la hora son campos distintos y la tabla tiene una columna para cada
    // uno. Si la fecha ya traia hora (fichero de la ingesta), esa gana.
    if (!conHora && h) {
      const hm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(h);
      if (!hm) return null;
      hh = Number(hm[1]);
      mm = Number(hm[2]);
      ss = hm[3] ? Number(hm[3]) : 0;
    }
    // Hora fuera de rango se rechaza en vez de dejarse rodar: Date.UTC(99, 99)
    // devuelve una fecha de otro dia, y se estaria guardando una fecha que nadie
    // escribio. El estado llega con horas crudas de la hoja.
    if (hh > 23 || mm > 59 || ss > 59) return null;
    const d = new Date(Date.UTC(anio, mes, dia, hh, mm, ss));
    if (isNaN(d.getTime())) return null;
    // Date.UTC normaliza el 31 de un mes corto rodandolo; se devuelve null en vez
    // de la fecha corrida.
    if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes || d.getUTCDate() !== dia) return null;
    return d.toISOString();
  }

  // ---------------------------------------------------------------------------
  // Mapeo: shape del estado -> columnas de la tabla
  //
  // Los nombres de columna NO son inventados: salen de .openchamber/esquema-
  // supabase.json (el esquema medido), de docs/schema-supabase-plan.sql (el DDL
  // del plan) y del sentido contrario, que ya esta escrito y probado, en
  // supabase-reader.js y en el espejo de catalogos (16-supabase-catalogo.js).
  // Los nombres de campo del estado son los de PP_OPERATION_FIELDS y
  // PP_mapWorkOrder_/PP_mapMaterial_ (02-storage.js).
  // ---------------------------------------------------------------------------

  function filasOperations(state, revision) {
    const filas = [];
    const vistas = new Set();
    (Array.isArray(state.operations) ? state.operations : []).forEach((op) => {
      if (!op || typeof op !== "object") return;
      // operation_id es NOT NULL UNIQUE (el id estable de la operacion). Una
      // operacion sin id no se puede escribir y no se le inventa uno: se sale.
      const operationId = texto(op.id);
      if (!operationId) return;
      if (vistas.has(operationId)) return;
      vistas.add(operationId);
      const inicio = instante(op.fechaInicio, op.horaInicio);
      const fin = instante(op.fechaFin, op.horaFin);
      filas.push({
        operation_id: operationId,
        ot: texto(op.ot),
        secuencia: Math.round(numero(op.secuencia, 0)),
        ct: texto(op.ct),
        descripcion: texto(op.descripcion),
        operador: texto(op.operador),
        maquina: texto(op.maquina),
        herramental: texto(op.herramental),
        kit: texto(op.kitHerramental),
        cant_total: Math.round(numero(op.cantTotal, 0)),
        cant_pendiente: Math.round(numero(op.cantPendiente, 0)),
        tiempo_ciclo: numero(op.tiempoCiclo, 0),
        tiempo_setup: numero(op.tiempoSetup, 0),
        tiempo_prod: numero(op.tiempoProd, 0),
        fecha_inicio: inicio,
        // hora_inicio es timestamptz, no una hora suelta: lleva el mismo instante
        // que fecha_inicio, porque el estado los separa y la tabla no.
        hora_inicio: inicio,
        fecha_fin: fin,
        hora_fin: fin,
        tipo_insercion: texto(op.tipoInsercion) || "OPERACION",
        estatus: texto(op.estatus) || "PLAN",
        locked: booleano(op.locked, false),
        auto_frozen: booleano(op.autoFrozen, false),
        subcontract_type: texto(op.subcontractType),
        subcontract_days: Math.round(numero(op.subcontractDays, 0)),
        // Columnas que agrega el DDL del plan (docs/schema-supabase-plan.sql:60-67).
        num: Math.round(numero(op.num, 0)),
        parte: texto(op.parte),
        contenido: texto(op.contenido),
        // prioridad es TEXT y no integer porque la app acepta numero o palabra
        // (normalizePriority); mandarla como texto vale para las dos.
        prioridad: texto(op.prioridad),
        fecha_req: texto(op.fechaReq),
        comentario: texto(op.comentario),
        tiempo_fallback: numero(op.tiempoFallback, 0),
        kit_pending: booleano(op.kitPending, false),
        revision: revision,
      });
    });
    return filas;
  }

  function filasWorkOrders(state, revision) {
    const filas = [];
    const vistas = new Set();
    (Array.isArray(state.workOrders) ? state.workOrders : []).forEach((wo) => {
      if (!wo || typeof wo !== "object") return;
      const ot = texto(wo.ot);
      if (!ot) return;
      if (vistas.has(ot)) return;
      vistas.add(ot);
      filas.push({
        ot: ot,
        wo_internal_id: texto(wo.workOrderId),
        articulo: texto(wo.item),
        descripcion: texto(wo.description),
        foto_url: texto(wo.photoUrl),
        // Estas tres son timestamptz y en el estado son fecha sin hora.
        fecha_inicio_ns: instante(wo.startDate, ""),
        fecha_fin_ns: instante(wo.endDate, ""),
        fecha_vencimiento: instante(wo.dueDate, ""),
        due_date_override: texto(wo.dueDateOverride),
        cantidad: Math.round(numero(wo.quantity, 0)),
        estatus: texto(wo.status),
        cliente: texto(wo.customer),
        cant_ensamblada: Math.round(numero(wo.builtQuantity, 0)),
        cant_pendiente: Math.round(numero(wo.pendingQuantity, 0)),
        precio_promedio_venta: numero(wo.averageSalePrice, 0),
        precio_ultima_venta: numero(wo.lastSalePrice, 0),
        // precio_desde y precio_hasta NO se escriben. El DDL las declara numeric
        // y la app lleva en esos dos campos una VENTANA DE FECHAS
        // (normalizeWorkOrders los pasa por normalizeOtDate). Mandar una fecha en
        // una columna numeric revienta el INSERT entero. Es un conflicto real de
        // tipos entre el DDL y el estado, y se declara en vez de adivinar.
        revision: revision,
      });
    });
    return filas;
  }

  function filasMaterials(state, revision) {
    const filas = [];
    const vistas = new Set();
    (Array.isArray(state.materials) ? state.materials : []).forEach((m) => {
      if (!m || typeof m !== "object") return;
      const ot = texto(m.ot);
      // line_id es la segunda mitad del UNIQUE (ot, line_id) que se corrigio el
      // 2026-09-29. En la ingesta es el id del renglon de NetSuite, que la app
      // no trae; el identificador de fila que la app SI tiene es `id`, y es el
      // que se usa aqui para que el UNIQUE se cumpla y el espejo sea idempotente.
      const linea = texto(m.id);
      if (!ot || !linea) return;
      const clave = ot + "|" + linea;
      if (vistas.has(clave)) return;
      vistas.add(clave);
      filas.push({
        ot: ot,
        wo_internal_id: texto(m.workOrderId),
        ensamble: texto(m.assembly),
        line_id: linea,
        componente_id: texto(m.componentId),
        componente: texto(m.component),
        descripcion: texto(m.description),
        unidad: texto(m.unit),
        requerido: Math.round(numero(m.required, 0)),
        emitido: Math.round(numero(m.issued, 0)),
        pendiente: Math.round(numero(m.pending, 0)),
        revision: revision,
      });
    });
    return filas;
  }

  function filasSelectedOts(state) {
    const filas = [];
    const vistas = new Set();
    (Array.isArray(state.selectedOts) ? state.selectedOts : []).forEach((valor) => {
      const ot = texto(typeof valor === "object" && valor ? valor.ot : valor);
      if (!ot || vistas.has(ot)) return;
      vistas.add(ot);
      // posicion es NOT NULL y es el orden manual de la cola (RULE-OT-005), o sea
      // que viaja el indice del array y no la posicion dentro de lo que si paso
      // el filtro de unicidad.
      filas.push({ ot: ot, posicion: filas.length });
    });
    return filas;
  }

  function filasLockedOts(state) {
    const filas = [];
    const vistas = new Set();
    (Array.isArray(state.lockedOts) ? state.lockedOts : []).forEach((valor) => {
      const ot = texto(typeof valor === "object" && valor ? valor.ot : valor);
      if (!ot || vistas.has(ot)) return;
      vistas.add(ot);
      filas.push({ ot: ot });
    });
    return filas;
  }

  function filasPlanStatuses(state, revision) {
    const filas = [];
    const vistas = new Set();
    const fuente = state.operationPlanStatuses;
    const lista = Array.isArray(fuente) ? fuente : Object.keys(fuente && typeof fuente === "object" ? fuente : {}).map((k) => fuente[k]);
    lista.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const key = texto(item.key);
      if (!key) return;
      if (vistas.has(key)) return;
      vistas.add(key);
      filas.push({
        key: key,
        ot: texto(item.ot),
        secuencia: Math.round(numero(item.sequence, 0)),
        ct: texto(item.ct),
        status: texto(item.status) || "PENDIENTE",
        origin: texto(item.origin) || "draft",
        fecha_completado: instante(item.completedAt, ""),
        fecha_reapertura: instante(item.reopenedAt, ""),
        revision: revision,
      });
    });
    return filas;
  }

  /**
   * app_state: la fila unica. Solo las columnas que el DDL de
   * docs/schema-supabase.sql:257-271 tiene; las demas del estado (operators,
   * matrix, machines, settings de la matriz...) viven en sus propias tablas de
   * catalogo y no se aplanan aqui.
   */
  function filaAppState(state, revision) {
    return {
      revision: revision,
      saved_at: instante(state.savedAt, ""),
      synced_at: instante(state.syncedAt, ""),
      plan_start: texto(state.planStart),
      horizon_days: Math.round(numero(state.horizonDays, 15)),
      report_week_start: texto(state.reportWeekStart),
      report_filters: jsonb(state.reportFilters, {}),
      settings: jsonb(state.settings, {}),
      plant: jsonb(state.plant, {}),
      operation_catalog_warning: texto(state.operationCatalogWarning),
      last_schedule: jsonb(state.lastSchedule, null),
    };
  }

  function filasSnapshots(lista) {
    const filas = [];
    const vistas = new Set();
    (Array.isArray(lista) ? lista : []).forEach((s) => {
      if (!s || typeof s !== "object") return;
      // snapshot_id es NOT NULL UNIQUE ('draft' o un uuid).
      const snapshotId = texto(s.snapshotId || s.snapshot_id);
      if (!snapshotId || vistas.has(snapshotId)) return;
      vistas.add(snapshotId);
      filas.push({
        snapshot_id: snapshotId,
        operations: Array.isArray(s.operations) ? s.operations : [],
        generated_at: instante(s.generatedAt, ""),
        plan_start: texto(s.planStart),
        version: texto(s.version),
        usuario: texto(s.usuario),
        change_summary: jsonb(s.changeSummary, null),
        published_at: instante(s.publishedAt, ""),
        publication_reason: texto(s.publicationReason),
      });
    });
    return filas;
  }

  /**
   * El log de cada operacion, partido en eventos. `kind` es el primer token
   * ("MAQUINA_OT_APP", "CAMBIO_HERR_KIT", ...), que es justo por donde se filtra
   * la vista de debug (docs/schema-supabase-plan.sql:95-104). El resto del evento
   * va en payload jsonb, porque su forma la decide la app.
   */
  function filasEventos(state, actor) {
    const filas = [];
    const vistas = new Set();
    (Array.isArray(state.operations) ? state.operations : []).forEach((op) => {
      if (!op || typeof op !== "object") return;
      const operationId = texto(op.id);
      if (!operationId) return;
      const crudo = texto(op.log);
      if (!crudo) return;
      crudo.split(SEPARADOR_LOG).forEach((mensaje, indice) => {
        const entrada = texto(mensaje);
        if (!entrada) return;
        const kind = (entrada.split(" ")[0] || "LOG").toUpperCase();
        const id = uuidDe(operationId + "|" + kind + "|" + indice + "|" + entrada);
        if (vistas.has(id)) return;
        vistas.add(id);
        filas.push({
          id: id,
          operation_id: operationId,
          ot: texto(op.ot),
          secuencia: Math.round(numero(op.secuencia, 0)),
          ct: texto(op.ct),
          kind: kind,
          actor: actor,
          payload: {
            mensaje: entrada,
            operador: texto(op.operador),
            maquina: texto(op.maquina),
            herramental: texto(op.herramental),
            kit: texto(op.kitHerramental),
            fecha_inicio: texto(op.fechaInicio),
            hora_inicio: texto(op.horaInicio),
            fecha_fin: texto(op.fechaFin),
            hora_fin: texto(op.horaFin),
          },
        });
      });
    });
    return filas;
  }

  /**
   * El `actor` de un evento es el auth.uid() de quien hizo el cambio cuando la
   * escritura viene del navegador con sesion (docs/schema-supabase-plan.sql:100-
   * 104). Se saca del `sub` del JWT, que es el identificador PUBLICO del usuario
   * dentro del token; el token entero no se copia, se imprime ni se guarda en
   * ningun sitio. Si no se puede leer, se escribe "web": es mejor un actor
   * generico que perder la trazabilidad.
   */
  function actorDe(token) {
    try {
      const partes = String(token || "").split(".");
      if (partes.length < 2 || typeof root.atob !== "function") return "web";
      let base64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");
      while (base64.length % 4) base64 += "=";
      const cuerpo = JSON.parse(root.atob(base64));
      return texto(cuerpo && cuerpo.sub) || "web";
    } catch { return "web"; }
  }

  // FNV-1a de 32 bits con cuatro semillas: 128 bits en total, repartidos con el
  // formato de un uuid (8-4-4-4-12) porque la columna `id` de operation_events es
  // uuid. 128 bits hace la collision practicamente nula para el volumen de un log.
  function hash32(entrada, semilla) {
    let h = (2166136261 ^ semilla) >>> 0;
    for (let i = 0; i < entrada.length; i += 1) {
      h = Math.imul(h ^ entrada.charCodeAt(i), 16777619) >>> 0;
    }
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }

  function uuidDe(entrada) {
    const h = (n) => (n >>> 0).toString(16).padStart(8, "0");
    const p1 = h(hash32(entrada, 0x00000000));
    const p2 = h(hash32(entrada, 0x9e3779b1));
    const p3 = h(hash32(entrada, 0x85ebca6b));
    const p4 = h(hash32(entrada, 0xc2b2ae35));
    return p1 + "-" + p2.slice(0, 4) + "-" + p3.slice(0, 4) + "-" + p4.slice(0, 4) + "-" + p2.slice(4) + p3.slice(4) + p4.slice(4);
  }

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------

  function cerrar(informe, t0) {
    informe.ms = Date.now() - t0;
    informe.ok = Object.keys(informe.tablas).every((t) => !informe.tablas[t].error);
    return informe;
  }

  function sinEscribir(informe, t0, motivo) {
    // No pasa por cerrar(): alli `ok` se recalcula sobre las tablas, y un informe
    // sin tablas saldria en verde, que es justo lo que no paso.
    informe.ok = false;
    informe.motivo = motivo;
    informe.ms = Date.now() - t0;
    return informe;
  }

  /**
   * Escribe el estado del plan en Supabase y devuelve el informe.
   *
   * El informe es {ok, tablas:{tabla:{insertadas,error}}, ms} y, si no se pudo
   * ni empezar, un `motivo` con el por que. `insertadas` es el numero de filas
   * que quedan escritas de esa tabla al terminar: con `Prefer: return=minimal`
   * PostgREST no devuelve el cuerpo, asi que el numero es lo que se mando y no lo
   * que la base acepto (eso solo se sabria con return=representation, pagando el
   * doble de ancho de banda). Solo tiene sentido con `error` en null.
   *
   * `opciones.vaciarSiEstaVacio` hace explicito el borrado de una tabla espejo
   * cuyas filas salieron vacias. `opciones.snapshots` es la lista de
   * plan_snapshots; si no se pasa, esa tabla no se toca.
   */
  async function guardar(state, opciones) {
    const opts = opciones || {};
    const t0 = Date.now();
    const informe = { ok: true, tablas: {}, ms: 0 };
    const datos = state && typeof state === "object" ? state : {};
    const vaciar = opts.vaciarSiEstaVacio === true;

    if (!isConfigured()) {
      return sinEscribir(informe, t0, "Supabase no esta configurado en este build: faltan la URL o la clave publicable");
    }
    const auth = root.PPSupabaseAuth;
    if (!auth || typeof auth.token !== "function") {
      return sinEscribir(informe, t0, "no esta PPSupabaseAuth: no hay quien pida el token de sesion");
    }
    const token = await auth.token();
    if (!token) {
      return sinEscribir(informe, t0, "no hay sesion de Supabase: entra con tu correo para poder guardar. No se escribe nada");
    }

    // Los dos secretos que este modulo maneja. sano() los borra de cualquier
    // texto que vaya a salir en el informe, y no hay otro lugar donde se copien.
    const ctx = { token: token, secretos: [token, config.anonKey].filter(Boolean), t0: t0, avisos: [] };
    const revision = Math.round(numero(datos.revision, 0));

    // Primero las filas y al FINAL app_state. La razon no es estetica: la
    // revision es lo que la pagina lee para saber que version tiene, y si el
    // guardado se parte a la mitad, dejarla atras hace que se note en vez de que
    // parezca un guardado bueno con datos viejos.
    for (const tabla of ESPEJO) {
      let filas = [];
      if (tabla === "operations") filas = filasOperations(datos, revision);
      else if (tabla === "work_orders") filas = filasWorkOrders(datos, revision);
      else if (tabla === "materials") filas = filasMaterials(datos, revision);
      else if (tabla === "selected_ots") filas = filasSelectedOts(datos);
      else if (tabla === "locked_ots") filas = filasLockedOts(datos);
      else filas = filasPlanStatuses(datos, revision);
      // Las tres del ERP se escriben SIN borrar mientras el usuario no lo pida
      // explicitamente. Ver el PELIGRO MEDIDO de la cabecera: un borrado desde un
      // navegador con estado viejo se lleva las filas que la persona todavia no
      // ha visto, y no da ningun error. El opt-in se llama
      // `permitirBorradoErp` justamente para que en el codigo se lea que es una
      // decision y no un olvido.
      const borrar = !ERP_COMPARTIDA[tabla] || opts.permitirBorradoErp === true;
      if (!borrar) {
        informe.avisos = informe.avisos || [];
        informe.avisos.push(
          tabla + " se actualizo fila por fila y NO se borro: las filas que el navegador no " +
            "conoce (ingesta de NetSuite posterior a esta carga) se dejaron intactas. " +
            "Una operacion que la persona haya quitado del plan NO se borra; queda el valor viejo."
        );
      }
      informe.tablas[tabla] = await escribirEspejo(ctx, tabla, filas, vaciar && borrar, borrar);
    }

    informe.tablas.operation_events = await escribirEventos(ctx, filasEventos(datos, actorDe(token)));

    if (Array.isArray(opts.snapshots)) {
      informe.tablas.plan_snapshots = await escribirAnexo(ctx, "plan_snapshots", filasSnapshots(opts.snapshots), "snapshot_id");
    }

    informe.tablas.app_state = await parchearAppState(ctx, filaAppState(datos, revision));
    return cerrar(informe, t0);
  }

  root.PPSupabaseWriter = {
    guardar: guardar,
    configure: configure,
    config: configActual,
    isConfigured: isConfigured,
    // Se exporta el mapeo para poder compararlo contra el esquema sin abrir la
    // red: es el mismo criterio que usa tests/supabase-reader-machines.test.mjs.
    mapear: {
      operations: filasOperations,
      workOrders: filasWorkOrders,
      materials: filasMaterials,
      selectedOts: filasSelectedOts,
      lockedOts: filasLockedOts,
      operationPlanStatuses: filasPlanStatuses,
      appState: filaAppState,
      snapshots: filasSnapshots,
      events: filasEventos,
    },
    ESPEJO: ESPEJO,
    CLAVE_NATURAL: CLAVE_NATURAL,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
