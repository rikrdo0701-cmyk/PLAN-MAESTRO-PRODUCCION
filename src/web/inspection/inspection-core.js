(function inspectionCoreFactory(root) {
  "use strict";
  function operationKey(operation, index) {
    return String(operation?.id || operation?.code || index);
  }
  function initialOperationSelection(operations) {
    return (operations || []).reduce((selection, operation, index) => {
      selection[operationKey(operation, index)] = true;
      return selection;
    }, {});
  }
  function printableOperations(operations, selection) {
    return (operations || []).filter((operation, index) => selection?.[operationKey(operation, index)] !== false);
  }
  function inspectionRows(operations, selection, minimumRows) {
    const visible = printableOperations(operations, selection).map((operation) => ({ operation }));
    while (visible.length < minimumRows) visible.push({ operation: null });
    return visible;
  }
  function inspectionMaterials(materials) {
    return (materials || []).filter((material) => {
      const name = String(material?.material || "");
      return name && !name.toLowerCase().startsWith("costo 0") && Number(material?.requiredOriginal || material?.required || 0) > 0;
    });
  }
  function inspectionPrintDiagnostic(materials, hasDrawing) {
    const normalized = inspectionMaterials(materials);
    const pending = normalized.filter((material) => Number(material?.required) > 0);
    const missingRoutes = normalized.filter((material) => {
      const required = Number(material?.required);
      return Number.isFinite(required) && required > 0 && Math.abs(required - Math.round(required)) > 0.00001 && !String(material?.route || "").trim();
    });
    const deficit = normalized.filter((material) => Number(material?.deficitNeto || material?.netDeficit || material?.deficit || 0) > 0);
    const alerts = [];
    if (missingRoutes.length) alerts.push("Falta tramo");
    if (!hasDrawing) alerts.push("Sin dibujo");
    if (deficit.length) alerts.push("Déficit material");
    if (!pending.length) alerts.push("Sin materiales pendientes");
    const status = missingRoutes.length ? "block" : (alerts.length ? "warn" : "ok");
    return { status, label: status === "block" ? "Bloqueado" : (status === "warn" ? "Revisar" : "OK para imprimir"), alerts, materials: normalized, pending, missingRoutes, withoutDrawing: !hasDrawing, deficit };
  }
  function inspectionRouteValue(row, field) {
    const aliases = {
      article: ["article", "ARTICULO"],
      material: ["material", "MATERIAL"],
      route: ["route", "TRAMO"],
      drawing: ["drawing", "DIBUJO"],
      updated: ["updated", "ACTUALIZADO"]
    };
    const value = aliases[field].map((name) => row?.[name]).find((item) => item !== undefined && item !== null);
    return String(value || "").trim();
  }
  /**
   * Normaliza las filas del catalogo de tramos y las ordena.
   *
   * MEDIDO 2026-10-01, POR QUE EL FILTRO ES `row.article` Y NO `row.article &&
   * row.material` (RULE-INS-001). Antes la pagina leia los tramos de `materials`,
   * y en `materials` la columna de material SIEMPRE viene llena: es el componente
   * de la linea de la OT. El filtro de las dos columnas nunca-bitaba y por eso
   * nadie lo habia questioned.
   *
   * Con `inspection_routes` si bite, porque la tabla tiene una fila CON MATERIAL
   * VACIO que es el DIBUJO A NIVEL DE ORDEN DE TRABAJO: es la que usa
   * PP_Inspection_articleDrawingMatchV2_ (17-inspection-drawing-service.js:97-100),
   * que busca la clave `articulo + '|'` sin material. Dejarla fuera del catalogo
   * no seria "no mostrar una fila incompleta": seria quitarle a la pagina la
   * fila que le dice como se ve el articulo entero, y eso se nota al imprimir.
   *
   * O sea: el filtro nuevo es MAS PERMISIVO a proposito, y lo que sigue exige es
   * el ARTICULO, que es la columna que no puede faltar porque sin ella no hay
   * clave y la fila no existe.
   */
  function inspectionRouteRows(rows) {
    return (rows || []).map((row) => ({
      article: inspectionRouteValue(row, "article"),
      material: inspectionRouteValue(row, "material"),
      route: inspectionRouteValue(row, "route"),
      drawing: inspectionRouteValue(row, "drawing"),
      updated: inspectionRouteValue(row, "updated")
    })).filter((row) => row.article).sort((left, right) => left.article.localeCompare(right.article, "es", { sensitivity: "base" }) || left.material.localeCompare(right.material, "es", { sensitivity: "base" }));
  }
  function filterInspectionRouteRows(rows, query) {
    const term = String(query || "").trim().toLocaleLowerCase("es");
    if (!term) return rows;
    return (rows || []).filter((row) => `${row.article} ${row.material}`.toLocaleLowerCase("es").includes(term));
  }
  function inspectionRouteSavePayload(row, route) {
    return {
      article: inspectionRouteValue(row, "article"),
      material: inspectionRouteValue(row, "material"),
      route: String(route || "").trim()
    };
  }
  /**
   * La clave de una fila del catalogo de tramos: `articulo|material`, con la misma
   * normalizacion que el escritor de la tabla (`PPSupabaseWriter.guardarInspectionRoute`
   * la calcula con su propia copia de `normalizeKey`) y con la del servidor
   * (`PP_Inspection_routeKey_`, 16-inspection-service.js:198). Que las TRES sean la
   * misma regla no es casualidad: es la que hace que la fila que se guarda, la que se
   * lee y la que se empareja sean la misma fila. Si esta dejara de usar
   * `inspectionRouteNormalize`, `applyInspectionRouteSave` (abajo) seguiria funcionando
   * —porque compara claves con la misma regla— pero la fila que se pinta despues de
   * guardar seria otra: el guardado se veria correcto y la tabla no.
   */
  function inspectionRouteKey(row) {
    return `${inspectionRouteNormalize(inspectionRouteValue(row, "article"))}|${inspectionRouteNormalize(inspectionRouteValue(row, "material"))}`;
  }

  /**
   * trim + mayusculas + sin acentos + espacios como "_".
   *
   * LA TERCERA COPIA DEL MISMO NOMBRE, Y POR QUE SIGUE SIENDO UNA COPIA:
   *   PP_normalizeKey_        src/server/02-storage.js:2419   (escritor de la hoja)
   *   normalizeKey            src/web/shared/supabase-reader.js
   *   normalizeKey            src/web/shared/supabase-writer.js
   * Que la usen los tres por separado no es descuido: si el lector llamara a la del
   * escritor, el escritor dejaria de escribir en cuanto el lector se apaga por no
   * tener sesion, que es un fallo de escritura disfrazado de lectura. Y si
   * `inspectionRouteKey` (abajo) dejara de usar esta, la clave de la fila del
   * catalogo y la del emparejamiento serian dos reglas distintas con el mismo nombre.
   */
  function inspectionRouteNormalize(value) {
    return String(value == null ? "" : value).trim().toUpperCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_");
  }

  /**
   * LA CLAVE LAXA: sin acentos, sin puntuacion, sin espacios, en mayusculas.
   *
   * Copia de `PP_Inspection_routeLooseKey_` (16-inspection-service.js:202). Es el
   * SEGUNDO nivel del emparejamiento y existe por una medicion, no por gusto: la hoja
   * `Tramos` traia dos filas que solo se diferencian en como estan escritas
   * ("A-100" y "a100"), y con la clave normalizada sola una de las dos no encontraba
   * su fila.
   */
  function inspectionRouteLooseKey(value) {
    return String(value == null ? "" : value)
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  }

  /**
   * El texto del dibujo, limpio de las comillas que la hoja arrastra.
   *
   * Copia de `PP_Inspection_cleanDrawing_` (16-inspection-service.js:225), con el
   * mismo orden: primero el recorte a 1000 caracteres, despues las comillas. MEDIDO
   * 2026-10-01: la columna DIBUJO de la hoja a veces llega con una comilla simple o
   * doble al principio y al final, y sin quitarla la liga no abre. Se limpia AL
   * LEER y no al guardar, para no reescribir la fila de la tabla solo por quitar unas
   * comillas: el que se guardo es el texto que la persona escribio.
   *
   * NOTA: esto NO es `cleanDrawingInput` de inspection-app.js. Esa además desenvuelve
   * `HYPERLINK("...")`, que es una cosa de la hoja de Apps Script y no del dato; esta
   * es la limpieza minima del valor, y por eso puede vivir en el nucleo.
   */
  function inspectionCleanDrawing(value) {
    return String(value == null ? "" : value).trim().slice(0, 1000).replace(/^['"]+|['"]+$/g, "").trim();
  }

  /**
   * EL INDICE DE TRAMOS, con los tres niveles de emparejamiento.
   *
   * POR QUE VIVE EN LA PAGINA Y NO SE PIDE AL SERVIDOR. MEDIDO 2026-10-01: la hoja de
   * inspeccion pedia su detalle por el puente de Apps Script, que esta deshabilitado
   * (RULE-SUP-030). El tramo de cada material salia de `PP_Inspection_routeIndexV2_`
   * (17-inspection-drawing-service.js:76), que es indice en memoria sobre el catalogo.
   * El catalogo ya esta en Supabase (`inspection_routes`, RULE-INS-001), asi que el
   * indice se arma en el navegador con la MISMA forma y las MISMAS reglas. Duplicar
   * las reglas era inevitable: no hay un "¿me armas el indice?" que se pueda llamar
   * por red sin volver a poner el puente en el medio. Lo que si se puede es que las dos
   * copias se puedan comparar, y por eso esta vive al lado de `inspectionRouteRows`
   * y no dentro de la capa de red.
   *
   * LAS TRES CLAVES QUE SE GUARDAN POR FILA, Y QUE SON TRES NIVELES:
   *   1. `articulo| material` con la clave normalizada  — el match exacto.
   *   2. `articulo| material` con la clave laxa         — "A-100" encuentra "a100".
   *   3. `articulo|`                                     — SOLO si el material esta
   *      vacio y hay dibujo. Es el dibujo a NIVEL DE ORDEN DE TRABAJO (RULE-INS-001):
   *      una fila mas, no un dato incompleto.
   * Y aparte, `byMaterialDrawing[materialLaxo]`: el primer dibujo que aparece para un
   * material, IGNORANDO el articulo. Es el tercer nivel del dibujo
   * (PP_Inspection_materialDrawingMatchV2_) y es el unico que se llena "si no hay":
   * por eso es `if (... && !index.byMaterialDrawing[...])` y no una asignacion.
   *
   * GANA LA ULTIMA en los niveles 1, 2 y 3, que es como armaba el indice la hoja
   * (RULE-INS-001: la deduplicacion del importador deja la ultima). En el 4 gana la
   * PRIMERA, y esa asimetria es del servidor: `PP_Inspection_routeIndexV2_` tiene el
   * mismo `if` ahi. No se unifica porque unificarla cambiaria que dibujo se ve en una
   * OT que usa dos articulos con el mismo material.
   *
   * `rows` sale de `inspectionRouteRows`, o sea que las filas sin articulo ya estan
   * fuera y los dibujos ya vienen limpios de la lectura del mapa. Un indice con
   * `byMaterialDrawing` pero sin claves es un indice valido y solo sirve para el
   * nivel 4: es lo que pasa cuando el catalogo esta vacio.
   */
  function inspectionRoutesIndex(rows) {
    const index = { byMaterialDrawing: {}, rows: [] };
    const porClave = {};
    inspectionRouteRows(rows).forEach((row) => {
      const articuloKey = inspectionRouteNormalize(row.article);
      const materialKey = inspectionRouteNormalize(row.material);
      const articuloLaxo = inspectionRouteLooseKey(row.article);
      const materialLaxo = inspectionRouteLooseKey(row.material);
      index[`${articuloKey}|${materialKey}`] = row;
      index[`${articuloLaxo}|${materialLaxo}`] = row;
      if (!row.material && row.drawing) {
        index[`${articuloKey}|`] = row;
        index[`${articuloLaxo}|`] = row;
      }
      if (row.material && row.drawing && !index.byMaterialDrawing[materialLaxo]) {
        index.byMaterialDrawing[materialLaxo] = row;
      }
      porClave[`${articuloKey}|${materialKey}`] = row;
    });
    index.rows = Object.keys(porClave).map((key) => porClave[key]);
    return index;
  }

  /**
   * ¿ESTA FILA DE `materials` ES UN RENGLON DEL BOM DE NETSUITE?
   *
   * MEDIDO 2026-10-04 en la base en vivo (697 filas). El id de renglon de NetSuite
   * (`comp.id`, que es lo que la ingesta escribe en `line_id`) es SIEMPRE un entero:
   * medidos '2', '3', '4', '24'. Las 348 filas que creo la pagina tienen un UUID, porque
   * `filasMaterials` usaba el `id` de la fila como `line_id` (corregido; ver ahi el por que).
   *
   * POR QUE HACE FALTA DISTINGUIRLAS Y POR QUE NO ES "QUE HAYA DOS MP". Hay un caso
   * medido en el que la MISMA MP tiene DOS renglones de verdad en el BOM de la misma OT: la
   * OT 3776 tiene MP00094 (item 1961) en `comp.id` 2 con 6.27 y en `comp.id` 3 con 330. Son
   * dos lineas con cantidades distintas, no un duplicado, y juntarlas perderia el 330 (o
   * sumaria 336.27, que no existe en ninguna parte). Ese es UN caso de 348, y es la razon
   * por la que la deduplicacion de abajo NO usa el nombre del componente como clave, sino
   * esta pregunta.
   *
   * UNA FILA SIN `lineId` NO ES DEL ERP, PERO TAMPOCO SE TIRA. `lineId` solo existe si la
   * fila viene por `mapMaterials` (supabase-reader.js); un material de otro origen (un
   * import, un estado viejo) llega sin el. Por eso el que decide es el grupo entero y no
   * cada fila suelta: si no hay NINGUN renglon del ERP para ese componente, se conserva
   * uno. Medido: hoy no hay ningun (ot, componente) sin renglon del ERP (0 de 348), o sea
   * que ese respaldo no se esta usando; esta para que un origen nuevo no borre la hoja.
   */
  function inspectionLineaDelBom(lineId) {
    return /^\d+$/.test(String(lineId == null ? "" : lineId).trim());
  }

  /**
   * UNA MP, UNA VEZ: quita las COPIAS y deja los RENGLONES DEL BOM (medido 2026-10-04).
   *
   * LO QUE PASABA. La base `materials` tenia DOS filas por cada (ot, componente): 697
   * filas para 348 materiales. La hoja de inspeccion pinta los materiales en pares (uno a
   * la izquierda, otro a la derecha), asi que cada MP salia DOS VECES en la misma
   * impresion, lado a lado. Medido en la OT 3374 (C 290 UID, 20 piezas): dos filas de
   * MP00153, y las dos en la hoja.
   *
   * DE DONDE SALIAN LAS COPIAS (medido tambien el 2026-10-04, no es una suposicion).
   * `materials` tiene DOS escritores y NO usaban la misma clave:
   *   - la ingesta (RESTlet 2246, `netsuite-restlet-unificado-supabase.js` materiales_)
   *     escribe `line_id` = `comp.id`, el id de renglon de NetSuite. Ejemplos medidos:
   *     '2', '3', '4', '24'.
   *   - la pagina (`filasMaterials`, supabase-writer.js) escribia `line_id` = `id`, el
   *     UUID de la fila que acababa de LEER. Medido: la fila con `line_id` 'c1f3421a-...'
   *     tiene `id` '68d0519a-...', y la otra fila de esa misma MP tiene `id`
   *     'c1f3421a-...': o sea que la copia se creo con el id de la original como clave.
   * El UNIQUE es `(ot, line_id)`, y con dos claves distintas para el mismo renglon de BOM
   * ese UNIQUE no puede emparejar las dos filas: el merge-duplicates INSERTA en vez de
   * actualizar. MEDIDO: 348 (ot, componente) distintos, 348 con mas de una fila, 349
   * filas de mas, y UN caso con tres filas (cada guardado anade otra copia). Corregido en
   * `filasMaterials`: la pagina ahora escribe el `line_id` que LYO, que es el del ERP.
   *
   * POR QUE ESTA DEDUPLICACION EXISTE AUNQUE EL ESCRITOR ESTE ARREGLADO. Las 348 copias ya
   * estan en la base y la ingesta no las borra (es un upsert por clave natural, y esas
   * claves no aparecen en NetSuite). Ademas, una hoja donde la misma MP sale dos veces es
   * exactamente lo que la persona que la lee no puede dejar pasar: el aviso es "una MP, una
   * vez", y eso tiene que valer aunque la base todavia este sucia.
   *
   * QUE SE PISA Y QUE NO. La `description` de una fila superviviente se completa con la de
   * las copias si venia vacia (medido: las copias son copias byte a byte salvo 3 que
   * difieren en un espacio al final, y ninguno traia la descripcion vacia; el respaldo es
   * para que un texto faltante no se pierda). `route` y `drawing` NO se tocan: los dos
   * salen de `inspectionRouteMatch` POR COMPONENTE, o sea que las copias los traian iguales
   * y no hay nada que rescatar. Y las CANTIDADES no se suman ni se eligen: cada renglon del
   * BOM se queda con las suyas.
   *
   * LA CLAVE DEL GRUPO ES EL COMPONENTE NORMALIZADO (`inspectionRouteNormalize`), no el
   * crudo: "MP00153" y "mp00153 " son la misma MP y la hoja no puede ensinarla dos veces.
   * Y NO SE REORDENA: cada grupo conserva la posicion de su PRIMERA fila, asi que la hoja
   * se sigue llenando en el orden de la tabla de materiales, que es lo que se pidio.
   */
  function inspectionMaterialsUnicos(materials) {
    const porComponente = new Map();
    (materials || []).forEach((material) => {
      const clave = inspectionRouteNormalize(material?.material);
      if (!clave) return;
      if (!porComponente.has(clave)) porComponente.set(clave, []);
      porComponente.get(clave).push(material);
    });
    const salida = [];
    porComponente.forEach((grupo) => {
      const delBom = grupo.filter((material) => inspectionLineaDelBom(material?.lineId));
      const supervivientes = delBom.length ? delBom : grupo.slice(0, 1);
      const copias = grupo.filter((material) => !supervivientes.includes(material));
      supervivientes.forEach((material) => {
        if (String(material?.description || "").trim()) { salida.push(material); return; }
        const rescues = copias.map((copia) => String(copia?.description || "").trim()).find(Boolean);
        salida.push(rescues ? { ...material, description: rescues } : material);
      });
    });
    return salida;
  }

  /** Una fila de tramo vacia. NUEVA en cada llamada, y no una constante compartida:
   *  quien recibe un `{}` como "no hubo match" puede escribirle sin romper la
   *  siguiente llamada de otro material. */
  function sinFilaDeTramo() {
    return { article: "", material: "", route: "", drawing: "", updated: "" };
  }

  /** El TRAMO de (articulo, material). Niveles 1 y 2. Copia de PP_Inspection_routeMatchV2_. */
  function inspectionRouteMatch(index, article, material) {
    if (!index) return sinFilaDeTramo();
    return index[`${inspectionRouteNormalize(article)}|${inspectionRouteNormalize(material)}`]
      || index[`${inspectionRouteLooseKey(article)}|${inspectionRouteLooseKey(material)}`]
      || sinFilaDeTramo();
  }

  /** El DIBUJO a nivel de orden de trabajo. Nivel 3. Copia de PP_Inspection_articleDrawingMatchV2_. */
  function inspectionArticleDrawingMatch(index, article) {
    if (!index) return sinFilaDeTramo();
    return index[`${inspectionRouteNormalize(article)}|`]
      || index[`${inspectionRouteLooseKey(article)}|`]
      || sinFilaDeTramo();
  }

  /** El DIBUJO de un material, sin mirar el articulo. Nivel 4. Copia de PP_Inspection_materialDrawingMatchV2_. */
  function inspectionMaterialDrawingMatch(index, material) {
    if (!index || !index.byMaterialDrawing) return sinFilaDeTramo();
    return index.byMaterialDrawing[inspectionRouteLooseKey(material)] || sinFilaDeTramo();
  }

  /**
   * Una fecha larga en espanol, como la que pondia la hoja en la columna de entrega.
   *
   * Copia de `PP_Inspection_longDate_` (16-inspection-service.js:98). Se queda porque
   * la hoja de inspeccion imprime "jueves, 15 de octubre de 2026" y no "2026-10-15":
   * el formato es lo que se entrega en la planta. Sin razon para cambiarlo aqui, asi
   * que se copia en vez de inventar un `toLocaleDateString` que ademas dependeria del
   * idioma del navegador.
   */
  function inspectionLongDate(value) {
    if (!value) return "";
    const crudo = String(value).trim();
    let coincidencia = crudo.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!coincidencia) {
      const corto = crudo.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (corto) coincidencia = [corto[0], corto[3], corto[2], corto[1]];
    }
    const fecha = coincidencia
      ? new Date(Number(coincidencia[1]), Number(coincidencia[2]) - 1, Number(coincidencia[3]))
      : new Date(value);
    if (isNaN(fecha.getTime())) return crudo;
    const dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
    const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    return `${dias[fecha.getDay()]}, ${fecha.getDate()} de ${meses[fecha.getMonth()]} de ${fecha.getFullYear()}`;
  }

  /**
   * EL DETALLE DE UNA OT, con la forma que la hoja de impresion necesita.
   *
   * POR QUE SE ARMA AQUI Y NO EN LA CAPA DE RED. Las cuatro entradas llegan YA
   * mapeadas por el lector (work_order, materiales, operaciones) y el indice de
   * tramos ya viene armado, y lo que queda es reglas: que cantidad se imprime, como
   * se empareja el tramo, de donde sale el dibujo. Puestas en la capa de red serian
   * Codigo que solo se puede probar abriendo la base; aqui son funciones puras y se
   * prueban con filas sueltas. Es la misma razon por la que
   * `inspectionPrintDiagnostic` esta en este archivo y no en la pagina.
   *
   * QUE ES Y QUE NO ES ESTA FORMA. Es la de `getInspectionWorkOrder`
   * (17-inspection-drawing-service.js:130), que es la que leia la pagina:
   *   detail = { workOrder: {...}, materials: [...], operations: [...] }
   * Y es la que el REEMPLAZO DEL PUENTE no daba: devolvia
   * `{workOrder, materials, drawing}` plano. Con esa forma `loadDetail` haria
   * `state.detail = bundle.detail` con `detail` undefined y la pagina se quedaria en
   * blanco, y `drawingFromBundle` (planning/app.js:8555) leeria
   * `result.data.detail.workOrder.drawing` de un objeto que no lo tiene, o sea que el
   * boton de dibujo de la OT tampoco abriria. MEDIDO 2026-10-01.
   *
   * `revision` VIENE VACIA A PROPOSITO. La celda REV de la hoja quiere la revision del
   * BOM de NetSuite ('Revision'/'bomRevision'), y `work_orders.revision` NO la guarda:
   * la pagina escribe ahi la REVISION DEL PLAN (filasWorkOrders,
   * supabase-writer.js:1645), que es un contador de guardado. Meter ese numero en una
   * celda REV seria un dato que no es. Se deja "" y la hoja imprime "A", que es lo que
   * imprimia cuando NetSuite no traia revision. Esta en MAPPING_GAPS.work_orders.
   *
   * `workOrder` VACIO SI NO HAY FILA, Y NO ES LO MISMO QUE UN ERROR. La pagina pide el
   * detalle de una OT que eligio de una lista que venia de la misma tabla, asi que el
   * caso normal es que exista; si no existe, lo honesto es devolver un detalle sin OT
   * (la hoja ensena las operaciones y los materiales, y el titulo sale vacio) en vez
   * de inventar un objeto con folio, articulo y cantidad en cero.
   */
  function inspectionDetail(lectura) {
    const entrada = lectura || {};
    const indice = entrada.routes || { byMaterialDrawing: {}, rows: [] };
    const disponibles = entrada.disponibles || {};
    const articulo = String(entrada.workOrder?.item == null ? "" : entrada.workOrder.item).trim();
    const folio = String(entrada.workOrder?.ot == null ? "" : entrada.workOrder.ot).trim();

    // MEDIDO 2026-10-01: `materialStatus` y `materialBadge` de la pagina ya usan
    // `available` sin pedirlo por red, o sea que el DIBUJO del material se resolvia
    // contra una columna que no existe. Sin esto, cada material saldria sin tramo y
    // la impresion quedaria bloqueada siempre. El primer dibujo que exista gana, y es
    // el de la fila con material vacio del mismo articulo (nivel 3): es la fila que
    // existe precisamente para eso (RULE-INS-001).
    const dibujoDeLaOt = inspectionCleanDrawing(inspectionArticleDrawingMatch(indice, articulo).drawing);
    let dibujoDeRespaldo = "";
    // MEDIDO 2026-10-04: la deduplicacion va AQUI y no en el filtro de `inspectionMaterials`,
    // porque el duplicado nace en la LECTURA (dos filas del mismo material en `materials`) y
    // la hoja no es el unico que la sufre: el dialogo de editar tramo/dibujo
    // (`openEditModal`) recorre `detail.materials` y abriria dos filas para la misma MP, y
    // el contador de `renderJobStatus` ("N materiales") diria el doble de los que hay.
    // `inspectionMaterials` sigue siendo solo el filtro de "lo que se imprime".
    const materials = inspectionMaterialsUnicos((entrada.materials || []).map((material) => {
      const nombre = String(material?.component == null ? "" : material.component).trim();
      const fila = inspectionRouteMatch(indice, articulo, nombre);
      const dibujo = inspectionCleanDrawing(fila.drawing)
        || inspectionCleanDrawing(inspectionMaterialDrawingMatch(indice, nombre).drawing);
      if (!dibujoDeRespaldo && dibujo) dibujoDeRespaldo = dibujo;
      // `required` es lo que va en la columna "Tubo/pzas" y es lo que decide si el
      // material cuenta como pendiente y si falta tramo (inspectionPrintDiagnostic).
      // La regla del servidor era `pendiente === '' ? requerido : max(0, pendiente)`:
      // esa rama no se puede reproducir aca porque `materials.pendiente` es
      // `integer not null default 0` y un 0 de verdad es indistinguible de uno que
      // nadie escribio. Se usa `pendiente` tal cual, que es la MISMA columna que ya
      // lee la pagina de planeacion sin ningun alternativa (app.js:4319 lo pinta
      // como "complete" cuando es 0, y app.js:8347 cuenta los pendientes con
      // `Number(item.pending) > 0`). Inventar un max(0, ...) aqui seria tapar el
      // defecto del otro lado.
      const requerido = Number(material?.required) || 0;
      const pendiente = Number(material?.pending) || 0;
      const disponible = Number(disponibles[nombre] ?? disponibles[inspectionRouteLooseKey(nombre)] ?? 0) || 0;
      return {
        material: nombre,
        description: String(material?.description == null ? "" : material.description).trim(),
        required: Math.max(0, pendiente),
        requiredOriginal: requerido,
        issued: Number(material?.issued) || 0,
        // `available` sale de `inventory` (la suma del `disponible` del item en todas
        // sus ubicaciones) y `deficit` / `deficitNeto` SE CALCULAN aqui. MEDIDO
        // 2026-10-01: en Supabase no hay columna de deficit, y las que traia NetSuite
        // (`deficit`, `deficitNeto`) no tienen su formula escrita en ningun archivo de
        // este repo. Se usan las dos lecturas mas simples de cada nombre y se DECLARA
        // que son un calculo de la pagina: `deficit` contra el total del BOM y
        // `deficitNeto` contra lo que queda pendiente. Si `inventory` esta vacio,
        // `available` sale 0 y todos los materiales salen en rojo con "Déficit
        // material": es un fallo ruidoso y visible, no uno silencioso, y el tooltip del
        // material enseña el disponible para que se vea de donde sale. La pagina no
        // bloquea la impresion por deficit (solo por falta de tramo), asi que el peor
        // caso es una advertencia que se puede revisar, no una hoja que no sale.
        available: disponible,
        deficit: Math.max(0, requerido - disponible),
        deficitNeto: Math.max(0, Math.max(0, pendiente) - disponible),
        route: String(fila.route || "").trim(),
        drawing: dibujo,
        // MEDIDO 2026-10-04: `lineId` viaja para que `inspectionMaterialsUnicos` sepa
        // cual de las filas del mismo componente es un RENGLON DEL BOM de NetSuite y cual
        // es una COPIA que creo el escritor de la pagina. Sin el, la hoja tendria que
        // adivinarlo por el nombre del componente, y eso borraria de la OT 3776 la segunda
        // linea real de MP00094 (6.27 y 330). Es el dato, no un adorno.
        lineId: String(material?.lineId == null ? "" : material.lineId).trim(),
      };
    }));

    // MEDIDO 2026-10-01, por que el id NO es `folio + '-' + secuencia + '-' + indice`
    // como armaba el servidor: ese id cambia de posicion si la lista se reordena, y
    // `operationKey` lo usa para saber que operaciones siguen marcadas entre una
    // carga y otra. `operations.operation_id` (`ns-<id>`, la clave natural de la fila,
    // ver mapOperations) es estable entre recargas. Solo si la fila no trae la clave se
    // cae al formato viejo, que para una fila sin clave natural es lo mejor que hay.
    const operations = (entrada.operations || []).map((operation, index) => {
      const secuencia = Number(operation?.secuencia) || index + 1;
      const texto = String(operation?.descripcion == null ? "" : operation.descripcion).trim();
      const estable = String(operation?.id == null ? "" : operation.id).trim();
      return {
        id: estable || `${folio}-${secuencia}-${index}`,
        code: texto.split(":")[0].trim() || texto,
        operation: texto,
        sequence: secuencia,
        // El servidor dejaba el centro de trabajo VACIO a proposito: en la hoja de
        // impresion la columna "No. Maquina" la escribe la persona a mano. Ponerle
        // `operations.ct` llenaria una celda que hoy se deja en blanco para que la
        // lean, y no es un dato que la pagina pueda validar.
        workCenter: "",
      };
    }).filter((item) => item.operation).sort((left, right) => left.sequence - right.sequence);

    const workOrder = entrada.workOrder;
    const cantidad = Number(workOrder?.quantity) || 0;
    const ensamblada = Math.max(0, Number(workOrder?.builtQuantity) || 0);
    return {
      workOrder: {
        wo: folio,
        article: articulo,
        description: String(workOrder?.description == null ? "" : workOrder.description).trim(),
        quantity: cantidad,
        builtQuantity: ensamblada,
        // Misma regla del servidor: si la fuente no trae el pendiente, sale
        // `cantidad - ensamblada`. `mapWorkOrders` ya resolvio esa falta (y la
        // documento en MAPPING_GAPS), asi que aqui solo se respeta lo que llega.
        pendingQuantity: Math.max(0, Number(workOrder?.pendingQuantity) || 0),
        dueDate: inspectionLongDate(workOrder?.dueDate),
        status: String(workOrder?.status == null ? "" : workOrder.status).trim(),
        revision: String(workOrder?.revision == null ? "" : workOrder.revision).trim(),
        drawing: dibujoDeLaOt || dibujoDeRespaldo,
      },
      materials: materials,
      operations: operations,
    };
  }

  root.InspectionCore = { operationKey, initialOperationSelection, printableOperations, inspectionRows, inspectionMaterials, inspectionMaterialsUnicos, inspectionLineaDelBom, inspectionPrintDiagnostic, inspectionRouteRows, filterInspectionRouteRows, inspectionRouteSavePayload, applyInspectionRouteSave, inspectionRouteNormalize, inspectionRouteLooseKey, inspectionCleanDrawing, inspectionRoutesIndex, inspectionRouteMatch, inspectionArticleDrawingMatch, inspectionMaterialDrawingMatch, inspectionLongDate, inspectionDetail };

  function inspectionRouteSavedValue(saved, field, fallback) {
    const aliases = {
      route: ["route", "TRAMO"],
      drawing: ["drawing", "DIBUJO"],
      updated: ["updated", "ACTUALIZADO"]
    };
    const name = aliases[field].find((alias) => Object.prototype.hasOwnProperty.call(saved || {}, alias));
    return name ? String(saved[name] ?? "").trim() : fallback;
  }
  function applyInspectionRouteSave(rows, reference, saved) {
    const key = inspectionRouteKey(reference);
    return (rows || []).map((row) => {
      if (inspectionRouteKey(row) !== key) return row;
      return {
        ...row,
        route: inspectionRouteSavedValue(saved, "route", row.route),
        drawing: inspectionRouteSavedValue(saved, "drawing", row.drawing),
        updated: inspectionRouteSavedValue(saved, "updated", row.updated)
      };
    });
  }
  // MEDIDO 2026-10-01, POR QUE ESTA ASIGNACION SE ARRIBA Y NO AL FINAL. Estas cuatro
  // funciones (`inspectionRouteRows`...`applyInspectionRouteSave`) se anadieron DESPUES
  // de que este archivo ya tuviera su `root.InspectionCore = {...}` al final, y el
  // export se anadio alli otra vez con la lista VIEJA de funciones. Como esa segunda
  // asignacion corre DESPUES de la primera, `InspectionCore.inspectionDetail` era
  // `undefined` en la pagina: `getInspectionCore()` (supabase-bridge-replacement.js)
  // lanzaba "InspectionCore no esta disponible" y el detalle de la OT se caia entero.
  // Lo encontro este test, no la pagina, porque la pagina no lo ejecutaba todavia.
  // Hay UNA sola asignacion en el archivo: la de arriba, que es la unica que lista todo.
})(typeof window !== "undefined" ? window : globalThis);
