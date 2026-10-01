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
 * COMO SE ESCRIBE HOY: UNA PETICION, O VARIAS. El DDL del plan define
 * public.plan_guardar(p_payload, p_revision_esperada, p_actor) en
 * docs/schema-supabase-plan.sql, y ESA es la via de verdad: una sola llamada a
 * /rest/v1/rpc/plan_guardar con las nueve tablas del estado, y dentro una
 * transaccion que se escribe entera o no se escribe. No es un detalle de forma:
 * es la razon de que la funcion exista.
 *
 * POR QUE ESTA FUNCION Y NO public.ingesta_mirror, que ya existia. ingesta_mirror
 * borra la tabla que le digan sin mirar quien llama, y por eso sigue REVOCADO
 * para el navegador a proposito: una pagina que puede llamarlo puede vaciar el
 * plan (docs/schema-supabase-plan.sql seccion 5, y RULE-SUP-021, que es la vez
 * que un uso de prueba borro dos tablas de produccion). plan_guardar no borra
 * nada: en operations, work_orders y materials solo hace UPDATE sobre filas que ya
 * existen, y si la revision no coincide no escribe nada.
 *
 * EL DDL AUN NO ESTA APLICADO, Y ESO TIENE UN CAMINO. El 2026-09-29 la funcion
 * esta escrita en docs/schema-supabase-plan.sql y SIN APLICAR, asi que la llamada
 * devuelve 404 con PGRST202 (PostgREST no la encuentra en la cache del esquema).
 * Eso NO es un fallo de red: es que todavia no se puede usar. El modulo lo
 * distingue, lo dice con un aviso que la pagina tiene que mostrar, y se va por el
 * CAMINO VIEJO. Un 404 no se reintenta, ni aqui ni en la funcion: repreguntarle a
 * una base que no tiene la funcion es hacer esperar a la persona sin cambiar el
 * resultado. Y no se repregunta en cada guardado, porque la respuesta no va a
 * cambiar mientras la pagina siga abierta: se recuerda una vez y ya.
 *
 * POR QUE LA DEGRADACION ESTA EN LA CABECERA Y NO EN UNA CONSTANTE. Un modulo que
 * se degrada en silencio parece que funciona: la pagina guardaria sin
 * transaccion y nadie lo sabria, que es exactamente el estado de cosas que el
 * DDL viene a arreglar. El aviso existe para que se vea, y el texto dice que
 * falta aplicar el DDL.
 *
 * POR CONSECUENCIA, EL CAMINO VIEJO NO ES ATOMICO, Y NO SE DISIMULA. Son varias
 * peticiones HTTP: para las tablas espejo, un `DELETE ...?id=neq.00000000-...` y
 * despues el POST; para las del ERP, un UPSERT por clave natural sin borrar
 * (ver el PELIGRO MEDIDO de mas arriba). Si el proceso se muere en medio, la tabla
 * queda a medias y no hay rollback. Por eso el aviso lo dice en pantalla en vez de
 * dejar que el guardado parezca bueno.
 *
 * ------------------------------------------------------------------
 *
 * DE DONDE SALE LA REVISION, Y POR QUE NO LA FABRICA ESTE MODULO. La revision es
 * el numero de version del plan y la lleva la pagina en `state.revision`:
 * src/web/planning/app.js:181 la declara en el estado inicial, app.js:1293 la
 * normaliza a numero, y app.js:9124 es donde la pagina ya manda ESA misma
 * revision al puente. El navegador no la aumenta: la comprueba. Viaja como
 * p_revision_esperada, que es lo que la funcion compara contra la fila unica de
 * app_state DENTRO de la transaccion, con un bloqueo de fila (`for update`,
 * docs/schema-supabase-plan.sql:562). Si no coincide, la funcion no escribe nada
 * y contesta ok false con conflicto CONFLICT_REVISION. Este modulo no fabrica una
 * revision "nueva" para escribir: inventarla seria justo el fallo que la funcion
 * existe para evitar, porque las dos paginas compararian la misma cifra y las dos
 * pasarian.
 *
 * QUIEN INCREMENTA LA REVISION Y QUE HAY QUE HACER CON EL NUMERO QUE VUELVE. La
 * funcion, y solo ella: app_state.revision = v_actual + 1 en la misma
 * transaccion (docs/schema-supabase-plan.sql:701). El modulo NO escribe la
 * revision en app_state y devuelve ese numero en `informe.revision` para que la
 * pagina lo guarde en su estado. Si la pagina no lo guarda, el siguiente guardado
 * manda la revision vieja y choca contra su propio guardado anterior, o sea que
 * el numero no se queda dentro del modulo por comodidad: sale.
 *
 * NOTA HONESTA SOBRE LA COLUMNA `revision` DE LAS FILAS. Las filas de operations,
 * work_orders, materials y operation_plan_statuses llevan su propia columna
 * `revision`, y la funcion la escribe porque esta en la lista de columnas de
 * plan_tabla_escritura. Ahi va la revision que la pagina tiene, o sea la
 * anterior: en esas filas la columna va un guardado por detras de app_state. No
 * se manda una revision inventada para taparlo, porque un numero inventado es
 * peor que uno documentado. El arreglo es del lado del DDL (que reste la columna
 * de la lista y la ponga la funcion con v_nueva) y queda anotado como pendiente.
 *
 * UN CONFLICTO NO ES UN FALLO DE RED, Y CONFUNDIRLOS HACE PERDER TRABAJO. Si la
 * funcion contesta ok false con conflicto CONFLICT_REVISION, la llamada SALIO
 * bien y la escritura no se hizo a proposito: otra persona, u otra pestana,
 * guardo despues de que esta cargo, y seguir escribiendo seria pisar su trabajo.
 * Reintentar sin recargar no lo arregla, porque la revision que manda esta pagina
 * sigue siendo la vieja. Al reves, un 500 o un fallo de red SI se reintenta. El
 * informe separa las dos cosas de forma que la pagina no pueda confundirlas:
 *
 *   informe.conflicto   esta SOLO en el conflicto de revision. Si existe, el
 *                       guardado NO se escribio y hay que recargar antes de
 *                       reintentar. Es el unico caso en el que reintentar sin
 *                       recargar es un error.
 *   informe.motivo      esta cuando la llamada fallo (red, 5xx, 401, 403). Solo en
 *                       el transitorio tiene sentido reintentar, y el propio
 *                       motivo lo dice: un 401 no mejora esperando.
 *   informe.camino      "rpc" o "viejo": por donde se escribio de verdad.
 *   informe.revision    la revision que hay en la base ahora: la nueva si se
 *                       guardo, la que tiene la otra persona si hubo conflicto.
 *
 * El conflicto sale tambien en `informe.avisos`, que es lo que la pagina
 * muestra: un aviso que diga "recarga", no un error generico.
 *
 * ------------------------------------------------------------------
 *
 * LAS COLUMNAS DE RETIRADA NO LAS MANDA EL NAVEGADOR. `retirada_en` y
 * `retirada_por` (docs/schema-supabase-plan.sql:434-440) las pone la funcion, y
 * por dos razones. La primera es que no estan en la lista de columnas escribibles
 * de plan_tabla_escritura, asi que la funcion no las moveria ni aunque se
 * mandaran. La segunda, que es la que importa, es que el navegador NO SABE quien
 * retira: en el estado no existe ninguna lista de operaciones retiradas. La
 * fuente real de que una operacion salio del plan es que su OT salio de
 * `selected_ots`, y comparar la cola que hay con la que llega es lo que hace la
 * funcion (docs/schema-supabase-plan.sql:590-599). Mandar esas columnas seria
 * escribir un dato que el navegador no tiene.
 *
 * ------------------------------------------------------------------
 *
 * UN ESTADO VACIO NO ES "BORRA TODO", Y CON EL RPC TAMPOCO. La funcion sustituye
 * las tres tablas donde la persona es la unica escritora con un `delete` y un
 * `insert` SIN CONDICION (docs/schema-supabase-plan.sql:664): si la lista llega
 * vacia, la tabla queda vacia. Un guardado que fallo al leer y llega con cero
 * operaciones vaciaria el plan entero, y eso es peor que dejar el anterior
 * (RULE-SUP-021). Por eso el freno se comprueba ANTES de llamar a la funcion y no
 * despues: si alguna de esas tres llega vacia y la pagina no lo pidio con
 * `vaciarSiEstaVacio`, no se llama a plan_guardar y se va por el camino viejo,
 * que si sabe saltarse esa tabla. Quien sepa que el vacio es de verdad lo pide
 * con `vaciarSiEstaVacio`, y entonces si se llama a la funcion. Las tres del ERP
 * no entran en este freno: en la funcion son modo `actualiza`, o sea UPDATE y
 * nunca DELETE, asi que una lista vacia ahi no toca nada.
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

  // El RPC del plan. La ruta va como dos trozos porque construirUrl() escapa el
  // nombre de tabla y aqui la barra es parte de la ruta: /rpc/plan_guardar, no
  // /rpc%2Fplan_guardar. La funcion esta en docs/schema-supabase-plan.sql, en la
  // seccion que se llama plan_guardar.
  const RUTA_RPC = "rpc/plan_guardar";
  // El codigo con el que la funcion dice "la revision no es la que traias". No es
  // un fallo: es una respuesta buena a una pregunta rara, y por eso viaja hasta
  // el informe con su nombre.
  // MEDIDO 2026-09-30: el borrado automatico de filas de catalogo esta APAGADO, y esta bandera
  // es la unica que lo manda. El bloque del borrado en guardarCatalogos explica por que se
  // apago (76 filas de ot_configurations borradas) y que hace falta para reactivarlo: llevar la
  // cuenta de lo que se borro A PROPOSITO en esta sesion.
  const BorradoDeCatalogosHabilitado = false;

  const CONFLICTO_REVISION = "CONFLICT_REVISION";
  // Con un solo POST el corte deja de ser de tiempo y pasa a ser de tamano. Sin
  // tope, un plan con 1000 operaciones y tres entradas de log cada una mete 3000
  // eventos en un cuerpo, y un cuerpo que no entra es un guardado que no se
  // escribe. Se mandan primero los que NO han salido de esta pagina, que son los
  // unicos que hay que escribir de verdad, y lo que no cabe se dice en el informe
  // en vez de tragar.
  const MAX_EVENTOS_POR_GUARDADO = 400;

  /**
   * Las NUEVE claves del payload de plan_guardar, con el nombre de la tabla en
   * Supabase y no el del estado. Se declaran aqui y se usan tanto para armar el
   * payload como para comprobarlo, para que anadir una tabla nueva sea un cambio
   * en un arreglo y no un olvido en medio de un objeto.
   */
  const CLAVES_PAYLOAD = [
    "operations",
    "work_orders",
    "materials",
    "selected_ots",
    "locked_ots",
    "operation_plan_statuses",
    "operation_events",
    "plan_snapshots",
    "app_state",
  ];

  /**
   * Tablas que son ESPEJO del estado completo: se borran y se reescriben.
   * Cada una con la columna de su clave natural, que es la que usa on_conflict.
   * work_orders NO esta en el mapa: no tiene ningun indice unico (docs/schema-
   * supabase.sql:192-221 y el delta de sync-netsuite.sql), y `id` es el uuid que
   * pone la base. Sin on_conflict, PostgREST usa la primary key, que aqui nunca
   * se manda, asi que cada fila entra con uuid nuevo y no puede chocar.
   */
  const ESPEJO = ["operations", "work_orders", "materials", "selected_ots", "locked_ots", "operation_plan_statuses"];
  /**
   * Las TRES de las que plan_guardar hace `delete` y luego `insert` SIN CONDICION
   * (docs/schema-supabase-plan.sql:664), o sea las unicas que un estado vacio
   * puede dejar vacias. Las tres del ERP son modo `actualiza` (UPDATE y nada mas)
   * y no necesitan freno: una lista vacia ahi no toca una sola fila.
   */
  const ESPEJO_QUE_SE_VACIA = ["selected_ots", "locked_ots", "operation_plan_statuses"];

  /**
   * La clave con la que cada tabla hace UPSERT en el camino viejo (la Data API). Es la MISMA
   * clave que declara `plan_tabla_escritura` en el DDL del plan, y por eso sale de ahi y no de
   * lo que parezca natural: lo que el DDL indexa y lo que el navegador pone en `on_conflict`
   * tienen que ser la misma lista de columnas o el UPSERT no resuelve.
   *
   * MEDIDO 2026-09-30: aqui faltaba `work_orders`. Sin entrada, `escribirEspejo` mandaba el
   * POST SIN `on_conflict`, o sea un INSERT pelado, y la base contestaba
   * `23505 duplicate key value violates unique constraint "work_orders_ot_key"` en 18 de 18
   * guardados: las 222 ordenes de trabajo NUNCA se guardaron por el camino viejo, y como
   * `cerrar()` mira los errores por tabla, ese 409 bajaba a `ok:false` y la pagina avisaba que
   * no se guardo el plan. La clave es `wo_internal_id` y no `ot` porque es la que indexa el DDL
   * (`work_orders_wo_internal_id_key`), y `ot` esta indexada aparte porque el RESTlet 2246
   * tambien escribe estas filas.
   */
  const CLAVE_NATURAL = {
    operations: "operation_id",
    work_orders: "wo_internal_id",
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

  /**
   * El detalle del 404 del RPC, o null mientras no se sepa. En cuanto se sabe que
   * plan_guardar no existe, NO se vuelve a preguntar: la respuesta no va a cambiar
   * mientras la pagina siga abierta, y repreguntar es un gasto que la persona
   * paga en cada guardado. No es memoria del resultado de un guardado, es memoria
   * de una caracteristica de la base, y por eso tiene su propio sitio y no se
   * confunde con no reintentar un 5xx, que si se reintenta. Se reinicia con
   * configure(), que es cuando de verdad puede haber cambiado algo.
   */
  let rpcAusente = null;

  // ---------------------------------------------------------------------------
  // Configuracion
  // ---------------------------------------------------------------------------

  function configure(patch) {
    if (patch && typeof patch === "object") {
      if (patch.url != null) config.url = String(patch.url).replace(/\/+$/, "");
      if (patch.anonKey != null) config.anonKey = String(patch.anonKey);
    }
    // Configurar de nuevo es la unica vez en que se vuelve a preguntar por el
    // RPC: si la URL cambio, es otro proyecto y puede tener el DDL aplicado.
    rpcAusente = null;
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
   *
   * `opciones.destino` existe para el RPC: la ruta /rpc/plan_guardar lleva una
   * barra que construirUrl() escaparia, y meterla en un parametro en vez de
   * parchear el constructor mantiene las dos formas de escribir con el MISMO
   * reintento, el mismo timeout y la misma regla de no reintentar.
   */
  async function pedir(token, metodo, tabla, opciones) {
    const opts = opciones || {};
    const destino = opts.destino || construirUrl(tabla, opts);
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
      // MEDIDO 2026-09-30 en produccion: esto NO es un error. Es el freno del vacio
      // funcionando: la tabla se deja intacta a proposito. Pero `cerrar()` contaba
      // cualquier `error` como ok=false, y el toast decia "No se pudo guardar el plan"
      // cuando el plan SI se guardo. Ahora es una nota, no un error.
      return { insertadas: 0, error: null, nota: "sin filas: no se borra la tabla (vaciarSiEstaVacio lo hace explicito)" };
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
      const crudo = sano((error && error.message) || error, ctx.secretos);
      // MEDIDO 2026-09-30 en produccion, 4 catalogos con HTTP 400 y este texto:
      //   there is no unique or exclusion constraint matching the ON CONFLICT specification
      // O sea: el on_conflict que mandamos no lo puede inferir la base. Las dos causas
      // posibles, y las dos se arreglan con DDL, no con codigo: el indice no existe, o es
      // un indice UNICO PARCIAL (PostgreSQL solo infiere indices sin predicado, y PostgREST
      // no manda el predicado). Sin este texto, quien lo lee tiene que saber de Postgres
      // para saber que hacer; con el, sabe que tiene que aplicar el DDL.
      const sinRestriccion = /no unique or exclusion constraint matching the ON CONFLICT/i.test(crudo);
      if (sinRestriccion) {
        return {
          insertadas: 0,
          error: crudo,
          nota: `a ${tabla} le falta un indice unico COMPLETO sobre (${onConflict}), o el que hay es parcial. `
            + "Es un cambio de schema, no de la pagina: aplica docs/schema-supabase-cierre-catalogos.sql",
        };
      }
      return { insertadas: 0, error: crudo };
    }
  }

  // ---------------------------------------------------------------------------
  // CATALOGOS: lo que edita la persona en la pestana Catalogos
  // ---------------------------------------------------------------------------
  //
  // QUE ES Y QUE NO ES. Estas seis tablas NO son un espejo del estado: son
  // CATALOGOS, y el estado es la vista que de ellas tiene la pagina. Por eso aqui NO
  // se borra la tabla entera y se reescribe (el modelo de las seis de plan_guardar):
  // se hace UPSERT por clave natural de lo que hay en el estado, y se borran SOLO
  // las filas cuya clave estaba en la ultima lectura y ya no esta en el estado, que
  // es exactamente lo que la persona quito. La razon esta medida: `tools`,
  // `subcontracts`, `calendar_exceptions`, `ot_configurations` y
  // `article_configurations` los escribe TAMBIEN el espejo de las Hojas
  // (16-supabase-catalogo.js), o sea que hay un segundo escritor y un borrado masivo
  // desde un navegador con estado viejo se llevaria filas que la persona todavia no
  // ha visto. Es el mismo peligro medido de la cabecera para operations/work_orders/
  // materials, aqui con un escritor menos visible.
  //
  // POR QUE EL BORRADO NECESITA `clavesLeidas` Y NO PUEDE HACERSE SOLO. Para saber
  // que fila hay que borrar hay que compararla con lo que se leyo AL ARRANCAR. Sin
  // ese dato, "lo que no esta en el estado" incluye todo lo que la pagina todavia no
  // conoce, y borrarlo seria perder filas. Por eso quien llama (supabase-catalog-
  // apply.js) pasa `clavesLeidas`, que es lo que el lector vio, y sin ese argumento
  // NO se borra nada: solo se sube lo que hay. Quitar sin guardar el estado previo es
  // una operacion que no se puede hacer bien, y se dice con un aviso en vez de
  // adivinar.
  //
  // LO QUE NO SE ESCRIBE, Y POR QUE. La pestana de Matriz (operators, capabilities,
  // operation_catalog y matrix) NO se escribe desde aqui: su forma en el estado es
  // indexada y con reglas derivadas (operationRules, capacityModes, cts), y mapearla
  // entera al reves sin medir cada columna seria inventar el contrato. Se declara
  // como no escrito y la pagina lo avisa, en vez de fingir que se guardo.
  //
  // MEDIDO 2026-09-29: con la sesion, RLS DEJA ESCRIBIR estas tablas. La sonda
  // .openchamber/sonda-rls-escritura.mjs manda un DELETE con un filtro que no puede
  // matchear nada y solo pregunta por el permiso: HTTP 204 en las 11 tablas de
  // catalogo y en las del plan, o sea que hay politica de escritura para
  // `authenticated`. Por eso la escritura desde el navegador es posible y no hace
  // falta el puente para ningun catalogo.

  /**
   * Las seis tablas, su clave natural y el mapeo desde el estado. El mapeo es el
   * INVERSO EXACTO de mapTools, mapSubcontracts, mapCalendar, mapOtConfigurations y
   * mapArticleConfigurations en supabase-reader.js: si uno de los dos lados cambia un
   * nombre, el otro tiene que cambiarlo en la misma TASK, porque un guardado y su
   * lectura tienen que cerrar.
   */
  const CATALOGOS = [
    {
      tabla: "tools",
      clave: "codigo",
      mapear: function (state) {
        return (Array.isArray(state.toolCatalog) ? state.toolCatalog : []).map(function (item) {
          return {
            codigo: texto(item.id),
            parte: texto(item.part),
            herramental: texto(item.herramental),
            kit: texto(item.kitHerramental),
            tiempo_ajuste_herr: Math.round(numero(item.toolSetupMinutes, 0)),
            tiempo_ajuste_kit: Math.round(numero(item.kitSetupMinutes, 0)),
            activo: booleano(item.active, true),
          };
        }).filter(function (fila) { return Boolean(fila.codigo); });
      },
    },
    {
      tabla: "subcontracts",
      clave: "codigo",
      mapear: function (state) {
        return (Array.isArray(state.subcontracts) ? state.subcontracts : []).map(function (item) {
          return {
            codigo: texto(item.id),
            parte: texto(item.part || "*") || "*",
            tipo: texto(item.name),
            dias_habiles: Math.round(numero(item.days, 3)) || 3,
            activo: booleano(item.active, true),
          };
        }).filter(function (fila) { return Boolean(fila.codigo) && Boolean(fila.tipo); });
      },
    },
    {
      tabla: "calendar_exceptions",
      // MEDIDO 2026-09-30 contra la base real, con un INSERT de prueba dentro de un
      // begin/rollback (no se escribio nada):
      //   on_conflict (fecha_inicio, concepto, maquina) -> ERROR 42P01
      //   on_conflict (fecha,        concepto, maquina) -> ok
      // El indice que YA existe es calendar_exceptions_fecha_concepto_maquina_key, sobre
      // (fecha, concepto, maquina). O sea que el problema nunca fue que faltara el indice,
      // que es lo que suponia el DDL de este repo: es que la clave que mandaba aqui era la
      // columna equivocada. `fecha` es NOT NULL y el espejo la pone igual a `fecha_inicio`,
      // asi que los dos valores coinciden fila por fila y el indice sobre `fecha` deduplica
      // exactamente lo mismo.
      //
      // Se corrige el ESCRITOR y no la base, al reves de lo que se penso. Agregar un indice
      // sobre (fecha_inicio, concepto, maquina) habria dejado DOS indices unicos para lo
      // mismo, y el segundo se llenaria de NULL, que en PostgreSQL no se consideran iguales
      // entre si (NULL != NULL), o sea que no habria deduplicado nada.
      clave: "fecha,concepto,maquina",
      mapear: function (state) {
        return (Array.isArray(state.calendarExceptions) ? state.calendarExceptions : []).map(function (item) {
          const inicio = texto(item.startDate);
          const fin = texto(item.endDate) || inicio;
          return {
            // `fecha` es NOT NULL y parte del unique (fecha, concepto, maquina): se
            // iguala al inicio de la ventana, que es lo que hace el espejo.
            fecha: inicio || fin || "1970-01-01",
            fecha_inicio: inicio || null,
            hora_inicio: texto(item.start),
            fecha_fin: fin || null,
            hora_fin: texto(item.end),
            concepto: texto(item.concepto || item.concept) || "GENERAL",
            maquina: texto(item.machine),
            motivo: texto(item.reason),
            activo: booleano(item.active, true),
          };
        }).filter(function (fila) { return Boolean(fila.fecha_inicio); });
      },
    },
    {
      tabla: "ot_configurations",
      clave: "ot",
      mapear: function (state) {
        const out = [];
        Object.keys(state.otConfigurations && typeof state.otConfigurations === "object" ? state.otConfigurations : {}).forEach(function (k) {
          const item = state.otConfigurations[k];
          if (!item || typeof item !== "object") return;
          const ot = texto(item.ot || k);
          if (!ot) return;
          out.push({
            ot: ot,
            maquina: texto(item.machine),
            kit: texto(item.kitHerramental),
            kit_pendiente: booleano(item.kitPending, false),
            tipo_subcontrato: texto(item.subcontractType),
            dias_subcontrato: Math.round(numero(item.subcontractDays, 0)),
            herramental: texto(item.herramental),
            // jsonb: SIEMPRE arreglo, nunca cadena. Una columna jsonb con texto que no
            // es JSON revienta el INSERT de la tabla entera (ver jsonb()).
            herramentales_extra: listaDeHerramentales(item.additionalHerramentales),
            actualizado: instante(texto(item.updatedAt) || new Date().toISOString()),
          });
        });
        return out;
      },
    },
    {
      tabla: "article_configurations",
      clave: "articulo",
      mapear: function (state) {
        const out = [];
        Object.keys(state.articleConfigurations && typeof state.articleConfigurations === "object" ? state.articleConfigurations : {}).forEach(function (k) {
          const item = state.articleConfigurations[k];
          if (!item || typeof item !== "object") return;
          const articulo = texto(item.article || k).toUpperCase();
          if (!articulo) return;
          out.push({
            articulo: articulo,
            tipo_ot: texto(item.jobType).toUpperCase(),
            tipo_trabajo: texto(item.planningType).toUpperCase(),
            precio_manual: numero(item.manualUnitPrice, 0),
            // precio_ref_venta NO se escribe: lo baja el sync con el precio de venta de
            // NetSuite (RULE-REP-021) y es distinto del PRECIO_MANUAL que escribe una
            // persona. Mandarlo seria pisar el dato del ERP con el de la pagina.
            actualizado: instante(texto(item.updatedAt) || new Date().toISOString()),
          });
        });
        return out;
      },
    },
    {
      tabla: "operators",
      // MEDIDO 2026-09-30 contra la base: clave unica nombre, 18 filas, con politica de
      // escritura para authenticated. La base estaba preparada; faltaba el escritor.
      clave: "nombre",
      mapear: function (state) {
        const nombres = Array.isArray(state.operators) ? state.operators : [];
        const capacidad = state.operatorCapacity || {};
        const rendimiento = state.operatorPerformance || {};
        const perfiles = state.operatorProfiles || {};
        return nombres.map(function (nombre) {
          const n = texto(nombre);
          if (!n) return null;
          const perfil = perfiles[n] || {};
          return {
            nombre: n,
            // nombre_real es el NOMBRE de la persona; el lector cae al OPERADOR cuando esta
            // vacio, asi que se devuelve igual para no perder el nombre real.
            nombre_real: texto(perfil.name) || n,
            categoria: texto(perfil.category),
            // activo: el estado.trae SOLO los activos, asi que la lista ES la lista de
            // activos. Un operador que se desmarco no esta en state.operators y su fila se
            // queda como estaba, que es lo correcto con el borrado apagado.
            activo: true,
            minutos_capacidad: Math.round(numero(capacidad[n], 2400)),
            rendimiento_pct: Math.round(numero(rendimiento[n], 100)),
          };
        }).filter(Boolean);
      },
    },
    {
      tabla: "matrix",
      // MEDIDO 2026-09-30 contra la base: clave unica (capability_key, operator), 97 filas.
      //
      // ESTA ES LA QUE HACE QUE DESMARCAR EXISTA. Se mapea matrixFull, que trae la rejilla
      // COMPLETA (marcada y sin marcar), y no state.matrix, que solo trae las marcadas. Un no
      // no se puede expresar como una ausencia: con el borrado apagado, mandar solo las
      // marcadas dejaria las desmarcadas marcadas para siempre. Mandando false, no hace
      // falta borrar nada nunca.
      clave: "capability_key,operator",
      mapear: function (state) {
        const rejilla = Array.isArray(state.matrixFull) ? state.matrixFull : [];
        const vistos = new Set();
        return rejilla.map(function (celda) {
          const key = texto(celda && celda.capabilityKey);
          const operador = texto(celda && celda.operator);
          if (!key || !operador) return null;
          // Una pareja repetida se manda una vez. Sin esto, dos filas con la misma clave en el
          // mismo POST darian 23505 y se perderia el guardado entero de la matriz.
          const id = key + "|" + operador;
          if (vistos.has(id)) return null;
          vistos.add(id);
          return {
            capability_key: key,
            operator: operador,
            habilitado: Boolean(celda && celda.habilitado),
          };
        }).filter(Boolean);
      },
    },
    {
      tabla: "machine_planning_overrides",
      clave: "machine_nombre",
      // Una fila por maquina APARTADA, y solo esas: la tabla registra la decision de
      // no agendar en una maquina (RULE-SUP-017). `machines` NO se escribe desde
      // aqui porque la reescribe entera el RESTlet 2246 cada 15 minutos.
      mapear: function (state) {
        const out = [];
        (Array.isArray(state.machines) ? state.machines : []).forEach(function (item) {
          const nombre = texto(item.id);
          if (!nombre) return;
          if (item.excluded !== true) return;
          out.push({ machine_nombre: nombre.toUpperCase(), excluida: true, actualizado: instante(new Date().toISOString()) });
        });
        return out;
      },
    },
  ];

  /** HERRAMENTALES_EXTRA_JSON: el estado trae un arreglo y la columna es jsonb. */
  function listaDeHerramentales(valor) {
    if (Array.isArray(valor)) {
      const out = [];
      const vistos = {};
      valor.forEach(function (item) {
        const t = texto(item);
        if (!t || vistos[t]) return;
        vistos[t] = true;
        out.push(t);
      });
      return out;
    }
    return jsonb(valor, []);
  }

  /**
   * El filtro de un DELETE por clave natural COMPUESTA, en el `and=(...)` que
   * PostgREST entiende. Sin comillas porque los tres valores de la clave de
   * calendar_exceptions son fecha, concepto y maquina: texto sin espacios ni
   * comas, que es justo lo que se valida antes de armar el filtro.
   */
  function condicionDeClave(def, clave) {
    // MEDIDO 2026-09-30 en produccion: esta funcion usaba el VALOR de la clave como nombre de
    // COLUMNA. Con una clave como 1905 generaba un filtro del tipo columna-igual-a-1905 usando
    // 1905 en los dos lados, y Postgres contestaba 42703 diciendo que no existia una columna con
    // ese numero. El DELETE de lo que la persona quito no habia funcionado para NINGUNA tabla
    // salvo calendar_exceptions, que tenia un caso especial escrito a mano. Nadie lo noto
    // porque el informe mezclaba el error del POST con el del DELETE en un solo campo.
    //
    // Ahora el nombre de la columna sale de def.clave partido por comas, y el valor sale de la
    // clave partido por el separador. No queda ningun nombre de columna escrito a mano, que es
    // lo que dejo pasar el bug: al cambiar la clave de un catalogo, un caso especial con el
    // nombre viejo queda colgando sin que nada lo avise.
    const columnas = String((def && def.clave) || "").split(",").map((c) => c.trim()).filter(Boolean);
    if (!columnas.length) return null;
    const valores = String(clave == null ? "" : clave).split("|");
    if (valores.length !== columnas.length) return null;
    if (columnas.length === 1) return columnas[0] + "=eq." + encodeURIComponent(valores[0]);
    return "and=(" + columnas.map((c, i) => c + ".eq." + encodeURIComponent(valores[i])).join(",") + ")";
  }

  /** La clave de la fila, tal como se guarda en las claves que se leyeron al arrancar. */
  function claveDeFila(def, fila) {
    // MEDIDO 2026-09-30: esta funcion comparaba contra la clave VIEJA de calendar_exceptions,
    // la de fecha_inicio. Al cambiarla por la de fecha (que es la del indice real de la base,
    // MEDIDO con un INSERT de prueba) el caso especial dejo de aplicar, la tabla cayo a leer
    // una propiedad llamada con la clave entera, que es undefined: sus claves salian vacias y
    // sus DELETES salian como clave natural ilegible.
    //
    // Ahora sale de def.clave partido por comas, igual que condicionDeClave.
    const columnas = String((def && def.clave) || "").split(",").map((c) => c.trim()).filter(Boolean);
    if (!columnas.length) return "";
    if (columnas.length === 1) return texto(fila[columnas[0]]);
    const partes = columnas.map((c) => texto(fila[c]));
    // Una clave compuesta con alguna parte vacia NO es una clave: es una fila que el
    // navegador no ha terminado de llenar. Se devuelve cadena vacia para que la fila no
    // entre en las claves y por lo tanto no se pueda borrar por una condicion a medias, que
    // seria peor que no borrarla.
    if (partes.some((p) => p === "")) return "";
    return partes.join("|");
  }

  /**
   * Lo que la pagina va a escribir. Devuelve tambien las claves: las nuevas y las
   * que ya estaban, que es lo que permite distinguir "agrego" de "quito".
   */
  /**
   * Que escribe la pagina en cada tabla del ERP, y por que no se borra. MEDIDO 2026-09-30:
   * esto era un solo texto para las tres, y para materials no era cierto.
   *
   * operations: la pagina decide cuando, donde, con que y en que orden. Si una operacion se
   *   quita del plan, su fila NO se borra, porque la ingesta de NetSuite es la segunda
   *   escritora y el borrado se llevaria tambien las que la persona todavia no ha visto.
   * work_orders: la pagina escribe las fechas y el precio. Articulo, cantidad y cliente son
   *   del ERP.
   * materials: la pagina NO decide que materiales tiene una OT. Escribe una sola columna,
   *   emitido, que es si el material salio. Las filas las pone la ingesta.
   */
  /**
   * Que se escribio en cada tabla del ERP, en UNA FRASE. MEDIDO 2026-09-30.
   *
   *   materials: la pagina solo marca que material se emitio. NO decide cuales son: la lista
   *     la pone la ingesta de NetSuite, que es la segunda escritora. Por eso no se borra
   *     nada: un borrado se llevaria los materiales que la ingesta metio despues de esta
   *     carga, que son mas nuevos que lo que el navegador sabe.
   *   work_orders: la pagina escribe las fechas y el precio de una orden. Articulo, cantidad
   *     y cliente son del ERP.
   *   operations: la pagina decide cuando, donde, con que y en que orden. Si una operacion
   *     se quita del plan, su fila NO se borra: el valor viejo se queda, que es lo unico
   *     seguro mientras haya dos escritores.
   *
   * POR QUE UNA FRASE Y NO UN PARRAFO. Un toast dice QUE PASO; el porque se queda aqui. El
   * texto largo de la primera version salia cortado a media palabra, y el de materials
   * ademas describia algo que no pasaba (decia de operaciones del plan en una tabla donde la
   * pagina no decide componentes). Un aviso que no cabe no se lee, y uno que describe mal
   * hace sospechar de algo que no esta pasando.
   */
  function queSeEscribioDe(tabla) {
    if (tabla === "materials") return "materials: solo se marco que material se emitio; la lista es de NetSuite";
    if (tabla === "work_orders") return "work_orders: se actualizaron solo fechas y precio; el resto es de NetSuite";
    return "operations: no se borro nada; la ingesta de NetSuite tambien escribe aqui";
  }

  function armarCatalogos(state) {
    const out = {};
    CATALOGOS.forEach(function (def) {
      let filas = [];
      try { filas = def.mapear(state) || []; } catch (error) { filas = []; }
      const claves = {};
      filas.forEach(function (fila) {
        const clave = claveDeFila(def, fila);
        if (clave) claves[clave] = true;
      });
      out[def.tabla] = { definicion: def, filas: filas, claves: claves };
    });
    return out;
  }

  /**
   * ESCRIBE LOS CATALOGOS. Devuelve el informe con la misma forma que el del plan
   * (ok, tablas, avisos, ms) para que quien llama no tenga dos caminos distintos
   * para leer un resultado.
   *
   * `opciones.clavesLeidas` es lo que el lector vio al arrancar: { tabla: [claves] }.
   * Sin el, no se borra nada (ver el bloque de arriba).
   */
  async function guardarCatalogos(state, opciones) {
    const opts = opciones || {};
    const t0 = Date.now();
    const informe = { ok: true, tablas: {}, ms: 0, avisos: [], camino: "catalogos" };
    const datos = state && typeof state === "object" ? state : {};

    if (!isConfigured()) {
      return sinEscribir(informe, t0, "Supabase no esta configurado en este build: faltan la URL o la clave publicable");
    }
    const auth = root.PPSupabaseAuth;
    if (!auth || typeof auth.token !== "function") {
      return sinEscribir(informe, t0, "no esta PPSupabaseAuth: no hay quien pida el token de sesion");
    }
    const token = await auth.token();
    if (!token) {
      return sinEscribir(informe, t0, "no hay sesion de Supabase: entra con tu correo para poder guardar los catalogos. No se escribe nada");
    }
    const ctx = { token: token, secretos: [token, config.anonKey].filter(Boolean), t0: t0, avisos: [] };

    const armado = armarCatalogos(datos);
    for (const tabla of Object.keys(armado)) {
      const parte = armado[tabla];
      const def = parte.definicion;
      // Subir lo que hay. Anexo, no espejo: nunca borra (ver el bloque de arriba).
      informe.tablas[tabla] = await escribirAnexo(ctx, tabla, parte.filas, def.clave);

      // Borrar lo que la persona quito, y solo eso.
      const leidas = opts.clavesLeidas && opts.clavesLeidas[tabla];
      if (!Array.isArray(leidas)) {
        if (parte.filas.length) {
          informe.avisos.push(
            tabla + ": se.subieron " + parte.filas.length + " fila(s), pero NO se borro ninguna: esta pagina no " +
            "tiene la lista de lo que se leyo al arrancar, y borrar a ciegas se llevaria filas que la persona " +
            "todavia no ha visto. Quitar una fila del catalogo en esta carga no se refleja hasta recargar."
          );
        }
        continue;
      }
      // -----------------------------------------------------------------------------
      // BORRADO APAGADO. MEDIDO 2026-09-30: borro 76 filas de ot_configurations.
      //
      // La comparacion de abajo decidia que filas borrar comparando las claves que el
      // navegador leyo al arrancar contra las que tiene ahora, y las DOS SALEN DEL MISMO
      // ESTADO. Si el estado pierde 76 otConfigurations entre la carga y el guardado, esas 76
      // se ven como "la persona las quito" y se borran. No hay forma de distinguirlo aqui: el
      // estado tiene el resultado, no la intencion.
      //
      // Esto funcionaba por accidente hasta hoy, porque el DELETE fallaba con 42703 en todas
      // las tablas: el filtro usaba el valor de la clave como nombre de columna. Arreglar ese
      // bug quito la red. Un fallo documentado como riesgo y no apagado es un fallo que espera
      // a que alguien lo arregle.
      //
      // Para reactivarlo hace falta un modelo que lleve la cuenta de lo que se borro A
      // PROPOSITO en esta sesion, no de lo que falta. Es un cambio de modelo, no un parche, y
      // no se hace a las carreras con 76 filas ya perdidas de por medio.
      const fuera = leidas.filter(function (clave) { return !parte.claves[clave]; });
      if (!BorradoDeCatalogosHabilitado) {
        if (fuera.length) {
          informe.avisos.push(
            tabla + ": se.subieron " + parte.filas.length + " fila(s). NO se borro ninguna, y hay " +
              fuera.length + " fila(s) que el navegador ya no tiene. El borrado automatico esta apagado: "
              + "el 2026-09-30 borro 76 filas de ot_configurations con el comparativo anterior, porque "
              + "comparar lo leido con lo que hay no distingue que la persona haya quitado una fila "
              + "de que el navegador simplemente no la tenga. La proxima subida vuelve a mandar las que "
              + "hay, y las que faltan vuelven con el siguiente espejo de la ingesta."
          );
        }
        continue;
      }
      if (!fuera.length) continue;
      // Una condicion por fila, y cada una con su propia peticion: un `or=(...)` con
      // claves compuestas se pone ilegible rapido, y borrar de mas es el fallo caro.
      let borradas = 0;
      let error = null;
      for (const clave of fuera) {
        const cond = condicionDeClave(def, clave);
        if (!cond) { error = "clave natural ilegible: " + recorte(clave, 60); continue; }
        try {
          await pedir(ctx.token, "DELETE", tabla, { condicion: cond });
          borradas += 1;
        } catch (e) {
          error = sano((e && e.message) || e, ctx.secretos);
          break;
        }
      }
      const previo = informe.tablas[tabla];
      // MEDIDO 2026-09-30: esto era un solo campo, `error: error || previo.error`, que
      // mezclaba el fallo del POST con el del DELETE. Con un 42P01 del POST tapado, el 42703
      // del DELETE no se veia. Dos escrituras, un campo: el toast senalaba al sistema
      // equivocado. Ahora los dos van por separado y el de arriba sigue siendo el primero que
      // fallo, para que el toast no cambie de lo que ya se acostumbro la gente.
      informe.tablas[tabla] = {
        insertadas: previo.insertadas,
        borradas: borradas,
        error: error || previo.error || null,
        errorPost: previo.error || null,
        errorDelete: error || null,
        paso: error ? "borrado de lo que quitaste" : (previo.error ? "subida de lo que hay" : null),
      };
    }

    // Lo que NO se escribe, dicho. La pagina lo muestra: un "guardado" que se
    // tragase la mitad de lo que se toco es peor que uno que avisa.
    if (opts.ambito === "matrix") {
      informe.avisos.push(
        // MEDIDO 2026-09-30: esto eran ~470 caracteres y el toast tiene max-width: 360px con
        // font-size: 11px: salia cortado por abajo y sin final. Es el MISMO fallo que el de los
        // avisos del ERP, y lo cometi dos veces porque no habia un candado que lo midiera. Hay
        // un test que mide el largo de los avisos del escritor.
        //
        // EL CORTO DICE QUE SE GUARDARON DOS Y QUE NO SE GUARDAN OTRAS DOS. El por que de
        // cada una esta arriba, en los comments de los catalogos.
        //
        // MEDIDO 2026-10-01, CORRECCION DE UN MOTIVO QUE ESTABA MAL. Este texto decia que
        // "a capabilities le faltan dos columnas a la pagina (ct y operacion, y el lector no
        // las trae por capacidad, asi que escribirla las mandaria vacias en 76 filas)". Es
        // FALSO: mapCapabilities (supabase-reader.js) SI lee las dos columnas de la tabla.
        // El motivo real es otro y es mas grave: PP_buildState_ (02-storage.js:480-493), que
        // es el CONTRATO del estado, no guarda el CT por capacidad. Solo lo mete en una lista
        // plana `state.cts` (sin decir a que clave pertenece) y guarda OPERACION como `label`
        // DENTRO de customCapabilities, y solo cuando custom es true. O sea que la
        // associacion clave -> ct se DESTRUYE al leer: despues de un viaje de ida y vuelta no
        // hay forma de saber que CT le tocaba a cada capacidad, ni aunque el lector trajera la
        // columna. Escribirla exigiria 76 filas a las que se les pondria un CT equivocado, que
        // es peor que no escribirla: el plan asignaria maquinas por una capacidad ajena.
        // Para cerrarlo habria que cambiar el CONTRATO del estado (guardar ct y operacion por
        // clave) y todos los que lo consumen, no solo el escritor.
        //
        // Y operation_catalog es el listado de operaciones DE NETSUITE: si la pagina lo
        // escribiera, pisaria el ERP con lo local.
        "Matriz: se guardaron operators y matrix. NO capabilities ni operation_catalog (de NetSuite)."
      );
    }
    return cerrar(informe, t0);
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
        // Columnas nuevas del plan: completado, tipo, precio, clasificacion
        completado: booleano(op.completado, false),
        tipo: texto(op.tipo),
        precio: numero(op.precio, 0),
        clasificacion: texto(op.clasificacion),
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
        // foto_url NO se escribe desde aqui, por el mismo motivo por el que machines no se
        // escribe (RULE-SUP-010, un solo escritor por tabla). MEDIDO 2026-10-01: la foto la
        // produce la INGESTA (src/server/09-photos.js, PP_enrichPhotoRows_, la URL de Drive) y
        // la unica pagina que pinta la foto es esta, que no tiene ningun control para ponerla.
        // O sea que este `texto(wo.photoUrl)` era un eco: devolvia lo que la pagina acaba de
        // LEER, y cuando la foto_url guardada no era una URL que safePhotoUrl acepta
        // (http, una ruta de red, un id viejo) el eco no era la foto, era la CADENA VACIA, y
        // el upsert la dejaba en ''. Con eso, guardar el plan borraba la foto de Drive de
        // esas OTs y no regresaba hasta la siguiente ingesta, sin decir nada. El lector ya
        // trae foto_url (supabase-reader.js, mapWorkOrders) y la pagina ya la muestra.
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
   * unconfirmed_work_orders: las marcas de OT "por confirmar" (RULE-OT-051 capa 2).
   *
   * POR QUE SE SUBEN COMO ANEXO Y NO COMO ESPEJO. La columna `ot` es UNIQUE, asi que
   * escribir por clave natural es idempotente y dos paginas no se pisan. Y NO se borra
   * lo que la pagina ya no trae: una marca que esta en la base y no en esta pantalla
   * puede ser de OT que esta cerrada en NetSuite y que la pagina todavia no sabe; si se
   * borrara, se perderia el contador `misses` que es justamente lo que decide cuando la
   * marca es real (ver mergeUnconfirmedWorkOrderMarks en app.js).
   *
   * `first_seen_at` y `last_seen_at` tienen default now() en el DDL, pero se mandan
   * explicitas: el instante de cuando ESTA pagina vio la OT es el dato, no el de cuando
   * se escribio la fila.
   */
  function filasUnconfirmedWorkOrders(state) {
    const marcas = state && typeof state.unconfirmedWorkOrders === "object" ? state.unconfirmedWorkOrders : {};
    const filas = [];
    Object.keys(marcas).forEach((clave) => {
      const marca = marcas[clave];
      if (!marca || typeof marca !== "object") return;
      const ot = texto(marca.ot !== undefined ? marca.ot : clave);
      if (!ot) return;
      filas.push({
        ot: ot,
        first_seen_at: instante(marca.firstSeenAt, ""),
        last_seen_at: instante(marca.lastSeenAt, ""),
        misses: Math.round(numero(marca.misses, 1)) || 1,
      });
    });
    return filas;
  }

  /**
   * closed_work_order_summaries: lo que se recuerda de una OT que se cerro (item, cantidad,
   * cuando se detecto el cierre). La columna `summary` es jsonb y la forma la fija
   * mergeClosedWorkOrderSummaries en app.js, que es quien la consume al volver a cargar.
   */
  function filasClosedWorkOrderSummaries(state) {
    const resumenes = state && typeof state.closedWorkOrderSummaries === "object" ? state.closedWorkOrderSummaries : {};
    const filas = [];
    Object.keys(resumenes).forEach((clave) => {
      const resumen = resumenes[clave];
      if (!resumen || typeof resumen !== "object") return;
      const ot = texto(resumen.ot !== undefined ? resumen.ot : clave);
      if (!ot) return;
      filas.push({ ot: ot, summary: jsonb(resumen, {}) });
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

  /**
   * app_state para plan_guardar: la MISMA fila sin `revision`.
   *
   * Por que sin revision: la funcion la incrementa y la escribe ella
   * (docs/schema-supabase-plan.sql:701). Si el payload trajera una, el
   * `jsonb_populate_recordset` la traeria a NULL y la columna se quedaria sin
   * valor, porque en la sentencia de app_state la revision se pone a mano
   * (v_nueva) y no desde el payload. Mandarla seria escribir un dato que la
   * funcion va a pisar dos lineas despues.
   */
  function appStateRpc(state) {
    const fila = filaAppState(state, null);
    delete fila.revision;
    return fila;
  }

  /**
   * Cuantos eventos caben en ESTE guardado, y cuales. Solo los que NO han salido
   * de esta pagina: son los unicos que hay que escribir de verdad, y meter los
   * otros en el cuerpo solo lo hace mas grande, porque la funcion los ignora con
   * on conflict do nothing. El corte se come, por tanto, lo pendiente y no lo que
   * ya esta, y lo que no cabe sale en el siguiente guardado en vez de perderse.
   *
   * Recargar la pagina si que los vuelve a mandar todos, porque este conjunto es
   * de la pagina y no de la base. No es un problema: la funcion los deduplica por
   * id, y el id es determinista.
   */
  function repartoDeEventos(filas) {
    const nuevos = (Array.isArray(filas) ? filas : []).filter((fila) => !eventosEnviados.has(fila.id));
    const elegidas = nuevos.slice(0, MAX_EVENTOS_POR_GUARDADO);
    return { filas: elegidas, omitidos: nuevos.length - elegidas.length };
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
   * plan_snapshots para plan_guardar, que es OTRO contrato y no una copia del de
   * arriba. La funcion inserta solo tres columnas: snapshot_id, payload y
   * created_at (docs/schema-supabase-plan.sql:688), con el snapshot entero dentro
   * de la columna jsonb `payload`. Por eso el objeto de la pagina va tal cual: la
   * forma de un borrador la decide la app y la funcion no la toca, y separarla en
   * columnas seria escribir un DDL nuevo cada vez que el borrador tenga un campo
   * mas.
   *
   * created_at se manda con el instante del snapshot para que recargar la pagina
   * no cambie la hora de un borrador ya guardado, y con null cuando no hay ninguna
   * fecha, que es lo que la funcion convierte en now().
   */
  function filasSnapshotsRpc(lista) {
    const filas = [];
    const vistas = new Set();
    (Array.isArray(lista) ? lista : []).forEach((s) => {
      if (!s || typeof s !== "object") return;
      const snapshotId = texto(s.snapshotId || s.snapshot_id);
      if (!snapshotId || vistas.has(snapshotId)) return;
      vistas.add(snapshotId);
      filas.push({
        snapshot_id: snapshotId,
        payload: s,
        created_at: instante(s.generatedAt || s.publishedAt || s.createdAt, ""),
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

  /**
   * Los eventos tal como los espera plan_guardar: SIN `actor`.
   *
   * No es que el navegador no sepa quien es: lo sabe, es el mismo auth.uid() que
   * sale del JWT, y va en p_actor. Es que la funcion es la que lo pone en cada
   * fila (docs/schema-supabase-plan.sql:679, `actor` sale de v_actor y no del
   * payload), o sea que mandarlo seria mandar un valor que se pisa. Y como el
   * p_actor lo lee del JWT que ya esta en la cabecera, el dato no sale de aqui.
   */
  function eventosRpc(filas) {
    return (Array.isArray(filas) ? filas : []).map((fila) => ({
      id: fila.id,
      operation_id: fila.operation_id,
      ot: fila.ot,
      ct: fila.ct,
      secuencia: fila.secuencia,
      kind: fila.kind,
      payload: fila.payload,
    }));
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

  function cerrar(informe, t0, ok) {
    // `ok` explicito cuando la decision NO sale de las tablas: el RPC decide
    // dentro de la transaccion, y un conflicto es un ok false con el guardado
    // entero sin escribir, no una tabla con error.
    informe.ok = ok === undefined ? Object.keys(informe.tablas).every((t) => !informe.tablas[t].error) : ok;
    informe.ms = Date.now() - t0;
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
   * EL PAYLOAD DE plan_guardar: el estado mapeado, con las tablas de Supabase
   * como claves de primer nivel. Siempre las nueve, aunque alguna vaya vacia: la
   * funcion lee `p_payload -> 'tabla'`, y una clave que no esta llega como NULL,
   * que no es lo mismo que una lista vacia.
   */
  function armarPayload(state, revision, opciones) {
    const opts = opciones || {};
    const eventos = repartoDeEventos(eventosRpc(filasEventos(state, null)));
    return {
      payload: {
        operations: filasOperations(state, revision),
        work_orders: filasWorkOrders(state, revision),
        materials: filasMaterials(state, revision),
        selected_ots: filasSelectedOts(state),
        locked_ots: filasLockedOts(state),
        operation_plan_statuses: filasPlanStatuses(state, revision),
        operation_events: eventos.filas,
        plan_snapshots: filasSnapshotsRpc(opts.snapshots),
        app_state: appStateRpc(state),
      },
      eventos: eventos.filas,
      eventosOmitidos: eventos.omitidos,
    };
  }

  /**
   * Se puede llamar a la funcion con este estado?
   *
   * El freno se mira el payload YA MAPEADO y no el estado en crudo, y no es
   * purismo: el mapa descarta filas sin clave natural (una OT sin ot, un estado sin
   * key). Una lista cruda con una fila inservible llegaria "con datos" al freno y
   * vaciaria igual, que es justo lo que el freno evita.
   *
   * Las tres del ERP no se miran: en la funcion son modo `actualiza` (UPDATE y
   * nada mas), asi que una lista vacia ahi no toca una sola fila.
   */
  function frenoDelRpc(payload, opciones) {
    if ((opciones || {}).vaciarSiEstaVacio === true) return null;
    const vacias = [];
    ESPEJO_QUE_SE_VACIA.forEach((tabla) => {
      if (!Array.isArray(payload[tabla]) || !payload[tabla].length) vacias.push(tabla);
    });
    if (!vacias.length) return null;
    return "llego vacia y sin que nadie lo pidiera con vaciarSiEstaVacio: " + vacias.join(", ");
  }

  /**
   * UNA SOLA PETICION, la que decide. Nunca llama a public.ingesta_mirror: ese RPC
   * borra la tabla que le digan y sigue revocado para el navegador (ver la
   * cabecera). Lo unico que se llama es plan_guardar, que no borra nada del ERP y
   * compara la revision dentro de la transaccion.
   *
   * Devuelve {estado, ...} y el `estado` es lo que decide el camino:
   *   ok        la funcion escribio y devolvio el informe.
   *   conflicto la revision no era la que traiamos. NO se escribio nada.
   *   ausente   404: la funcion no existe todavia. Se va por el camino viejo.
   *   error     cualquier otra cosa. NO se degrada: caer al camino viejo
   *              despues de un 500 seria escribir sin transaccion justo cuando la
   *              base acaba de decir que le pasa algo, y encima sin saber si la
   *              transaccion de la funcion llego a commitar.
   */
  async function guardarPorRpc(ctx, armado, revision, actor) {
    let respuesta;
    try {
      respuesta = await pedir(ctx.token, "POST", RUTA_RPC, {
        destino: config.url + "/rest/v1/" + RUTA_RPC,
        cuerpo: { p_payload: armado.payload, p_revision_esperada: revision, p_actor: actor },
      });
    } catch (error) {
      const status = error && error.status ? Number(error.status) : 0;
      const detalle = sano((error && error.message) || error, ctx.secretos);
      if (status === 404) return { estado: "ausente", detalle: detalle };
      return { estado: "error", status: status, detalle: detalle };
    }

    let cuerpo = null;
    try { cuerpo = await respuesta.json(); } catch { cuerpo = null; }
    if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) {
      return {
        estado: "error",
        status: respuesta.status,
        detalle: "plan_guardar contesto HTTP " + respuesta.status + " sin el jsonb del informe: no se sabe si se guardo",
      };
    }
    if (cuerpo.conflicto === CONFLICTO_REVISION) return { estado: "conflicto", cuerpo: cuerpo };
    if (cuerpo.ok !== true) {
      return {
        estado: "error",
        status: respuesta.status,
        detalle: sano("plan_guardar contesto ok " + JSON.stringify(cuerpo), ctx.secretos),
      };
    }
    return { estado: "ok", cuerpo: cuerpo };
  }

  /**
   * El informe de la funcion, en la misma forma que el del camino viejo: por
   * tabla, con el numero de filas y sin error. El `modo` que devuelve la funcion
   * se copia tal cual (`actualiza`, `espejo`, `anexo`, `flujo`) porque es el dato
   * que dice QUE se hizo, no solo cuantas filas.
   *
   * Lo que la funcion ademas reporta y no es una tabla (las marcas de retirada y
   * las reintegraciones) se deja en `informe.marcas`, crudo. Perderlo seria tirar
   * informacion que la base calculo: es la respuesta a "que paso con las OTs que
   * salieron del plan".
   */
  function aplicarInformeDelRpc(informe, cuerpo) {
    const tablas = cuerpo && cuerpo.tablas && typeof cuerpo.tablas === "object" ? cuerpo.tablas : {};
    Object.keys(tablas).forEach((tabla) => {
      const entrada = tablas[tabla] && typeof tablas[tabla] === "object" ? tablas[tabla] : {};
      if (entrada.modo) {
        informe.tablas[tabla] = { modo: texto(entrada.modo), insertadas: numero(entrada.filas, 0), error: null };
      } else {
        informe.marcas = informe.marcas || {};
        informe.marcas[tabla] = entrada;
      }
    });
    return informe;
  }

  function avisoDeAusencia(detalle) {
    return "La escritura va por el camino viejo, SIN TRANSACCION, porque falta aplicar el DDL: " +
      "plan_guardar no existe todavia en la base (" + (detalle || "404") + "). Se escribe tabla por " +
      "tabla y, si algo falla en medio, el plan puede quedar a medias. Aplica el DDL del plan " +
      "(docs/schema-supabase-plan.sql) en el panel de Supabase y esto se acaba. Esto no es un fallo " +
      "de red: no se reintenta, porque una base sin la funcion no deja de estar sin ella.";
  }

  function avisoDeFreno(motivo) {
    return "No se llamo a plan_guardar porque " + motivo + ". La funcion borra esas tablas antes de " +
      "reinsertarlas, y un guardado que fallo al leer no puede vaciar el plan entero (RULE-SUP-021). " +
      "Se fue por el camino viejo, que si respeta el freno. Si el vacio es de verdad, guardalo con " +
      "vaciarSiEstaVacio.";
  }

  /**
   * EL CAMINO VIEJO: varias peticiones, sin transaccion. Cada tabla por su cuenta,
   * con los reintentos y el freno de "un estado vacio no borra la tabla". Se usa
   * cuando el RPC no existe y cuando el freno del estado vacio impide llamarlo.
   *
   * Primero las filas y al FINAL app_state. La razon no es estetica: la revision
   * es lo que la pagina lee para saber que version tiene, y si el guardado se parte
   * a la mitad, dejarla atras hace que se note en vez de que parezca un guardado
   * bueno con datos viejos.
   */
  async function guardarPorTablas(ctx, datos, opts, informe, t0, vaciar) {
    const revision = Math.round(numero(datos.revision, 0));
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
        // MEDIDO 2026-09-30: este texto era UNO para operations, work_orders y materials, y
        // para materials era FALSO. Decia "Una operacion que la persona haya quitado del plan
        // NO se borra", pero de materials la pagina escribe UNA columna, emitido (lo dice
        // plan_tabla_escritura: la pagina no decide componentes, solo que material se emitio).
        // No hay operaciones de plan en esa tabla, y quitar un material no es una decision de
        // la pagina. Un aviso que describe mal lo que la pagina controla hace que la persona
        // sospeche de algo que no esta pasando.
        informe.avisos.push(queSeEscribioDe(tabla));
      }
      informe.tablas[tabla] = await escribirEspejo(ctx, tabla, filas, vaciar && borrar, borrar);
    }

    informe.tablas.operation_events = await escribirEventos(ctx, filasEventos(datos, ctx.actor));

    if (Array.isArray(opts.snapshots)) {
      informe.tablas.plan_snapshots = await escribirAnexo(ctx, "plan_snapshots", filasSnapshots(opts.snapshots), "snapshot_id");
    }

    // Las marcas de OT y el resumen de OTs cerradas. Se suben SIEMPRE, no solo con snapshots.
    // DECIDIDO 2026-09-30: antes de esto, quien las persistia era
    // `callAppsScript("saveWorkOrderSyncState")`, o sea las Hojas, y solo al pulsar
    // Sincronizar OTs. Con el sync escribiendo a Supabase, si estas dos no se subieran aqui
    // las marcas "por confirmar" (RULE-OT-051) y la retencion de OTs cerradas se quedarian
    // solo en memoria: una recarga las perderia y una OT sin ficha se caeria de la cola.
    // ANEXO y no espejo: nunca se borra una fila que la pagina ya no conoce (ver la cabecera).
    informe.tablas.unconfirmed_work_orders = await escribirAnexo(
      ctx,
      "unconfirmed_work_orders",
      filasUnconfirmedWorkOrders(datos),
      "ot"
    );
    informe.tablas.closed_work_order_summaries = await escribirAnexo(
      ctx,
      "closed_work_order_summaries",
      filasClosedWorkOrderSummaries(datos),
      "ot"
    );

    informe.tablas.app_state = await parchearAppState(ctx, filaAppState(datos, revision));
    return cerrar(informe, t0);
  }

  /**
   * Escribe el estado del plan en Supabase y devuelve el informe.
   *
   * El camino de verdad es UN POST a /rest/v1/rpc/plan_guardar (docs/schema-
   * supabase-plan.sql), con las nueve tablas del estado y la revision de la
   * pagina, y la transaccion la hace la funcion. Si el DDL no esta aplicado, el
   * modulo lo detecta en el 404 y escribe por el camino viejo, avisando en
   * pantalla; si el estado llega vacio, no llama a la funcion ni con el DDL
   * aplicado, porque la funcion vaciaria las tablas de espejo.
   *
   * EL INFORME, Y QUE HAY QUE MIRAR EN EL:
   *   ok          true si se escribio. Un ok false sin `conflicto` es un fallo de
   *               la llamada; con `conflicto` NO se puede reintentar sin recargar.
   *   camino      "rpc" o "viejo": por donde se escribio de verdad.
   *   revision    la revision que hay en la base ahora. Con el RPC es la que
   *               incremento la funcion, y la pagina tiene que guardarla en su
   *               estado o el siguiente guardado choca contra si mismo.
   *   conflicto   esta SOLO en el conflicto de revision: {codigo, revision_actual,
   *               revision_esperada, mensaje}. Su presencia significa que NO se
   *               escribio nada porque otra persona guardo antes.
   *   motivo      por que fallo la llamada. Solo en el transitorio (red, 5xx, 429)
   *               tiene sentido reintentar, y el motivo mismo lo dice.
   *   tablas      por tabla, {modo?, insertadas, error}. `insertadas` en el
   *               camino viejo es lo que se mando y no lo que la base acepto (con
   *               return=minimal PostgREST no devuelve el cuerpo); en el RPC es el
   *               numero que la funcion conto. Solo tiene sentido con error null.
   *   marcas      lo que la funcion reporto y no es una tabla: las OTs que salieron
   *               del plan y las que volvieron.
   *   msRpc       los milisegundos que tardo la funcion, que no son los del
   *               navegador: `ms` es el total, red incluida.
   *   avisos      lineas para la persona. El aviso de conflicto y el de degradacion
   *               van aqui, no solo en el motivo, porque son los dos que se
   *               tienen que ver en pantalla.
   *
   * `opciones.vaciarSiEstaVacio` hace explicito el borrado de una tabla espejo
   * cuyas filas salieron vacias, y con el RPC ademas habilita la llamada.
   * `opciones.snapshots` es la lista de plan_snapshots; si no se pasa, esa tabla no
   * se toca. `opciones.permitirBorradoErp` solo aplica al camino viejo: la funcion
   * declara las tres del ERP en modo `actualiza` y no puede borrarlas ni aunque se
   * le pida.
   */
  async function guardar(state, opciones) {
    const opts = opciones || {};
    const t0 = Date.now();
    const informe = { ok: true, tablas: {}, ms: 0, avisos: [], camino: null };
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
    // La revision se LEE del estado y no se fabrica. `state.revision` es el
    // numero de version del plan que la pagina tiene (app.js:181 lo declara,
    // app.js:1293 lo normaliza y app.js:9124 ya lo manda al puente), o sea la
    // version desde la que esta persona esta trabajando. Este modulo no la sube:
    // subirla aqui seria hacer que dos paginas comparen la misma cifra y las dos
    // pasen, que es lo que la funcion existe para impedir.
    const revision = Math.round(numero(datos.revision, 0));
    const actor = actorDe(token);
    ctx.actor = actor;

    const armado = armarPayload(datos, revision, opts);
    if (opts.permitirBorradoErp === true) {
      // El opt-in es del camino viejo. En la funcion no puede existir: el DDL
      // declara operations, work_orders y materials en modo `actualiza`, o sea
      // UPDATE sobre filas que ya estan, y ahi no hay ni INSERT ni DELETE que
      // habilitar. Decirlo es mejor que dejar que alguien crea que el opt-in
      // ocurrio y no ocurrio.
      informe.avisos.push(
        "permitirBorradoErp no tiene efecto con plan_guardar: el DDL declara operations, work_orders y " +
          "materials en modo actualiza, y ahi la funcion no puede borrar ni insertar ni aunque se le pida. " +
          "Es la mejora: con la funcion, ese opt-in ya no es ni siquiera posible."
      );
    }

    // Limpiar el cache de rpcAusente en cada intento: la funcion puede haber sido
    // creada/aplicada (DDL) desde el ultimo guardado. El cache permanente impedia
    // detectar el DDL aplicado despues de que la pagina ya cargara.
    rpcAusente = null;

    if (false) { // nunca entra: el cache se limpia arriba
      // Nunca se entra aqui porque lo limpiamos arriba. Se deja por seguridad.
      informe.avisos.push(avisoDeAusencia(rpcAusente));
    } else {
      const freno = frenoDelRpc(armado.payload, opts);
      if (freno) {
        informe.avisos.push(avisoDeFreno(freno));
      } else {
        const rpc = await guardarPorRpc(ctx, armado, revision, actor);
        informe.camino = "rpc";
        if (rpc.estado === "ok") {
          aplicarInformeDelRpc(informe, rpc.cuerpo);
          // Los eventos que salieron se apuntan, y con eso el siguiente guardado
          // no los vuelve a pagar. La funcion los ignora con on conflict do
          // nothing, o sea que mandarlos dos veces no duplica nada.
          armado.eventos.forEach((evento) => eventosEnviados.add(evento.id));
          // El corte se dice aqui y no antes, porque solo existe en este camino:
          // en el viejo el corte es de tiempo y lo cuenta escribirEventos(). Si no
          // se avisa, el corte se traga un trozo del log sin que nadie lo sepa.
          if (armado.eventosOmitidos > 0) {
            informe.avisos.push(
              "se omitieron " + armado.eventosOmitidos + " evento(s) del log: un guardado manda como " +
                "mucho " + MAX_EVENTOS_POR_GUARDADO + " eventos por peticion. Los que no se mande salen " +
                "en el siguiente guardado, con el mismo id, asi que la base no se queda sin ellos."
            );
          }
          informe.revision = numero(rpc.cuerpo.revision, revision);
          informe.actor = texto(rpc.cuerpo.actor) || actor;
          informe.msRpc = numero(rpc.cuerpo.ms, 0);
          return cerrar(informe, t0, true);
        }
        if (rpc.estado === "conflicto") {
          const cuerpo = rpc.cuerpo;
          // Un conflicto NO es un fallo de red. La llamada salio bien, la funcion
          // NO escribio nada a proposito, y reintentar con la misma revision
          // falla otra vez: hay que recargar. Por eso NO lleva `motivo` (que es el
          // campo del fallo, el que si se reintenta) sino `conflicto`, y los dos
          // son excluyentes: quien lea el informe no puede confundirlos.
          informe.conflicto = {
            codigo: CONFLICTO_REVISION,
            revision_actual: numero(cuerpo.revision_actual, 0),
            revision_esperada: numero(cuerpo.revision_esperada, revision),
            mensaje: texto(cuerpo.mensaje) || "El plan cambio desde la ultima carga.",
          };
          informe.revision = informe.conflicto.revision_actual;
          informe.avisos.push(
            "NO se guardo nada: el plan cambio desde la ultima carga, asi que otra persona u otra " +
              "pestana guardo antes. La base esta en la revision " + informe.conflicto.revision_actual +
              " y esta pagina seguia en la " + informe.conflicto.revision_esperada + ". Tu cambio sigue " +
              "aqui, en la pagina; lo que hay que recargar es la base. Recarga y vuelve a guardar: " +
              "reintentar sin recargar vuelve a fallar igual. Esto no es un fallo de red."
          );
          return cerrar(informe, t0, false);
        }
        if (rpc.estado === "ausente") {
          rpcAusente = rpc.detalle;
          informe.avisos.push(avisoDeAusencia(rpc.detalle));
        } else {
          // Aqui NO se degrada. Un 401, un 403, un 5xx o un corte de red no son
          // "el DDL no esta aplicado": son fallos, y caerse al camino viejo
          // despues de uno seria escribir sin transaccion justo cuando la base
          // esta fallando, sin saber si la transaccion llego a commitear.
          const reintentable = !noReintentar(rpc.status);
          informe.avisos.push("plan_guardar fallo y no se probo por el camino viejo: " + rpc.detalle);
          return sinEscribir(informe, t0, "plan_guardar fallo (HTTP " + rpc.status + "): " + rpc.detalle +
            ". No se probo el camino viejo a proposito: un fallo de la funcion no es un fallo del DDL, y " +
            "escribir tabla por tabla con la base en ese estado deja el plan a medias. " +
            (reintentable
              ? "Es transitorio (red, 5xx, 429): se puede reintentar el guardado tal cual."
              : "Un 401, un 403 o un 404 no mejoran esperando: hay que arreglar la sesion, no reintentar."));
        }
      }
    }

    informe.camino = "viejo";
    return guardarPorTablas(ctx, datos, opts, informe, t0, vaciar);
  }

  root.PPSupabaseWriter = {
    guardar: guardar,
    guardarCatalogos: guardarCatalogos,
    // armarCatalogos() sin red, para probar el mapeo y las claves contra el esquema
    // sin abrir nada (mismo criterio que armarPayload para el plan).
    armarCatalogos: armarCatalogos,
    CATALOGOS: CATALOGOS,
    configure: configure,
    config: configActual,
    isConfigured: isConfigured,
    // Se exporta el mapeo para poder compararlo contra el esquema sin abrir la
    // red: es el mismo criterio que usa tests/supabase-reader-machines.test.mjs.
    // Los tres con sufijo Rpc son la forma que espera plan_guardar, que para tres
    // tablas no es la misma que la de la Data API: sin `revision` en app_state,
    // sin `actor` en los eventos y con el snapshot entero dentro de `payload`.
    mapear: {
      operations: filasOperations,
      workOrders: filasWorkOrders,
      materials: filasMaterials,
      selectedOts: filasSelectedOts,
      lockedOts: filasLockedOts,
      operationPlanStatuses: filasPlanStatuses,
      // DECIDIDO 2026-09-30: el sync de OTs escribe a Supabase, asi que las marcas de
      // "por confirmar" (RULE-OT-051) y la retencion de OTs cerradas tienen que salir por
      // aqui. Antes las persistia `saveWorkOrderSyncState` en las Hojas.
      unconfirmedWorkOrders: filasUnconfirmedWorkOrders,
      closedWorkOrderSummaries: filasClosedWorkOrderSummaries,
      appState: filaAppState,
      snapshots: filasSnapshots,
      events: filasEventos,
      appStateRpc: appStateRpc,
      snapshotsRpc: filasSnapshotsRpc,
      eventsRpc: eventosRpc,
    },
    // armpalo() devuelve el payload sin red, para poder comprobar las nueve claves
    // y el freno del estado vacio contra el esquema sin abrir nada.
    armpalo: armarPayload,
    ESPEJO: ESPEJO,
    CLAVE_NATURAL: CLAVE_NATURAL,
    CLAVES_PAYLOAD: CLAVES_PAYLOAD,
    // Si el RPC dio 404, se recuerda para no volver a preguntar en cada guardado.
    rpcAusente: () => rpcAusente,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
