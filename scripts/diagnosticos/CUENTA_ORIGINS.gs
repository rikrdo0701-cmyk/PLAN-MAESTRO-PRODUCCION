/**
 * CUENTA_ORIGINS - responde cuantos origins de ESTADOS_OPERACION_PLAN son filas HUERFANAS, o sea
 * estados cuyo plan publicado YA SE BORRO.
 *
 * POR QUE IMPORTA, Y POR QUE NO ES LO QUE PARECE.
 *
 * publishedPlanStatuses es el mapa de "estado de cada operacion" agrupado por ORIGEN, y el ORIGEN
 * es el snapshotId del plan publicado al que pertenece esa fila (planStatusOriginForSource en
 * app.js:1863: reportSnapshot?.snapshotId || "draft"). O sea que hay un origin por cada version
 * publicada que se haya tocado.
 *
 * LO QUE NO SE SABIA Y SE MIDIO EN EL CODIGO, NO EN LA SUPOSICION:
 *
 *  1. PP_publishDraftPlan_ (05-publishing-service.js:1) YA BORRA los planes publicados anteriores
 *     de la MISMA semana: llama a PP_prunePublishedSnapshots_ con el snapshotId nuevo, y esa
 *     funcion (linea 17) borra TODOS los demas de esa semana menos el recien publicado.
 *     O sea que la politica vigente es de un solo plan publicado por semana.
 *
 *  2. PERO PP_deletePlanSnapshot_ (02-storage.js:1208) borra las filas de PLANES_HISTORICOS y de
 *     BORRADOR_PLAN con ese SNAPSHOT_ID, borra el payload, y quita el registro del manifiesto.
 *     NO toca ESTADOS_OPERACION_PLAN. O sea que las filas de estado de un plan ya borrado se
 *     quedan en la hoja, con un ORIGEN que ya no corresponde a nada.
 *
 *  3. Y PEOR: no es que se queden y ya. PP_preservePublishedPlanStatuses_ (02-storage.js:792)
 *     vuelve a escribir en cada guardado TODOS los origins no-draft que encuentra en la hoja,
 *     precisamente cuando el payload no trae ninguno. O sea que los huerfanos no solo se quedan:
 *     se REGRABAN en cada sincronizacion, indefinidamente.
 *
 *  4. Y no se pueden alcanzar desde la interfaz. La lista de versiones que se pueden elegir
 *     sale de listPlanSnapshots (app.js:7109, que llama a PP_listPlanSnapshots_), o sea del
 *     manifiesto de snapshots, NO de los origins. Un origin cuyo snapshot fue borrado no aparece
 *     en el selector, y por lo tanto sus filas no se pueden ni ver ni editar.
 *
 * CONCLUSION QUE ESTA SONDA COMPRUEBA, NO DA POR HECHO: si la mayoria de los origins son
 * huerfanos, podarlos no es "limpiar historia", es limpiar filas que ya no apuntan a nada. Y eso
 * NO se decide leyendo codigo: se cuenta.
 *
 * LO QUE NO HACE. No escribe ni una celda, no borra ningun origin, no toca CONFIG y no llama a
 * syncNetSuiteWorkOrdersLite ni a syncNetSuiteData. Solo lee.
 */
function CUENTA_ORIGINS() {
  var log = function (m) { Logger.log(String(m)); };
  var norm = function (v) {
    return String(v === undefined || v === null ? '' : v).trim().toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  };
  var texto = function (v) { return String(v === undefined || v === null ? '' : v).trim(); };

  log('CUENTA_ORIGINS: cuantos origins de ESTADOS_OPERACION_PLAN son huerfanos?');
  log('');

  // ---------------------------------------------------------------- 1. los origins que hay
  var hoja;
  try {
    hoja = PP_getWorkbook_().getSheetByName('ESTADOS_OPERACION_PLAN');
  } catch (e1) {
    log('   no se pudo abrir ESTADOS_OPERACION_PLAN: ' + String(e1 && e1.message || e1));
    log('');
    log('CUENTA_ORIGINS: sin hoja no hay veredicto. No se afirma nada.');
    return;
  }
  if (!hoja) {
    log('   ESTADOS_OPERACION_PLAN no existe en el libro. No se puede contar nada.');
    log('');
    log('CUENTA_ORIGINS: sin hoja no hay veredicto. No se afirma nada.');
    return;
  }
  var filas = PP_readRows_(hoja);
  log('1) ESTADOS_OPERACION_PLAN tiene ' + filas.length + ' filas.');
  if (!filas.length) {
    // Sin filas NO hay nada que contar. La version anterior de esta sonda seguia adelante y
    // llegaba al veredicto con "0 huerfanos", o sea que afirmaba que no hay nada que limpiar
    // cuando en realidad no miró nada. Es el error de fondo de RULE-OT-051 aplicado a una sonda:
    // ausencia de informacion convertida en veredicto. Y aqui es especialmente engañoso,
    // porque "0 huerfanos" parece una buena noticia.
    log('');
    log('   ATENCION: la hoja esta vacia, o no se pudo leer. SIN FILAS NO HAY NADA QUE CONTAR.');
    log('   No se afirma que no haya huerfanos: se afirma que no se pudo mirar.');
    log('');
    log('CUENTA_ORIGINS: sin datos no hay veredicto. No se afirma nada.');
    return;
  }

  var porOrigin = {};
  filas.forEach(function (row) {
    var o = texto(row.ORIGEN) || 'draft';
    if (!porOrigin[o]) porOrigin[o] = { filas: 0, operaciones: {}, completadas: 0, bytes: 0 };
    porOrigin[o].filas += 1;
    porOrigin[o].bytes += texto(row.KEY).length + texto(row.ORIGEN).length;
    var k = texto(row.KEY);
    porOrigin[o].operaciones[k] = (porOrigin[o].operaciones[k] || 0) + 1;
    if (/COMPLET/.test(norm(row.ESTATUS_PLAN))) porOrigin[o].completadas += 1;
  });

  var nombres = Object.keys(porOrigin).sort();
  log('   origins distintos: ' + nombres.length + (nombres.length ? ' -> ' + nombres.join(', ') : ''));
  log('');

  // ------------------------------------------------------------------- 2. cuales existen de verdad
  // La lista de versiones seleccionables. Esta es la que define si un origin es alcanzable.
  var snapshots = [];
  try {
    snapshots = PP_listPlanSnapshots_(PP_getWorkbook_()) || [];
  } catch (e2) {
    log('   AVISO: no se pudo leer el manifiesto de snapshots: ' + String(e2 && e2.message || e2));
    log('   SIN ESTA LISTA NO SE PUEDE DECIR NADA: seria justo asumir que no hay snapshots.');
    log('');
    log('CUENTA_ORIGINS: sin manifiesto no hay veredicto. No se afirma nada.');
    return;
  }
  var ids = {};
  (Array.isArray(snapshots) ? snapshots : []).forEach(function (s) {
    var id = texto(s && s.snapshotId);
    if (id) ids[id] = s;
  });
  log('2) PLANES PUBLICADOS QUE EXISTEN EN EL MANIFIEST: ' + Object.keys(ids).length);
  Object.keys(ids).forEach(function (id) {
    log('   ' + id + '  (' + texto(ids[id].weekStart || ids[id].planStart || 'sin semana')
      + ', ' + texto(ids[id].generatedAt || 'sin fecha') + ')');
  });
  log('');

  // ----------------------------------------------------------------- 3. origen por origen
  log('3) CADA ORIGEN, Y SI SU PLAN PUBLICO TODAVIA EXISTE:');
  var huerfanos = 0;
  var vivos = 0;
  var bytesHuerfanos = 0;
  var filasHuerfanas = 0;
  var detalle = [];
  nombres.forEach(function (o) {
    var d = porOrigin[o];
    var existe = o === 'draft' || Boolean(ids[o]);
    var etiqueta = existe ? (o === 'draft' ? 'BORRADOR (siempre vivo)' : 'VIVO') : 'HUERFANO';
    if (existe) { vivos += 1; } else { huerfanos += 1; bytesHuerfanos += d.bytes; filasHuerfanas += d.filas; }
    detalle.push({ origin: o, filas: d.filas, completadas: d.completadas, bytes: d.bytes, existe: existe, etiqueta: etiqueta });
    log('   ' + texto(o).slice(0, 40) + '  ' + etiqueta);
    log('      filas=' + d.filas + '  completadas=' + d.completadas + '  bytes de KEY+ORIGEN=' + d.bytes);
  });
  log('');

  // ------------------------------------------------- 4. el reparto de ORIGEN repetido por fila
  var repetido = 0;
  nombres.forEach(function (o) { repetido += porOrigin[o].filas * texto(o).length; });
  log('4) EL ORIGEN SE REPITE EN CADA FILA DE SU GRUPO:');
  log('   bytes gastados en repetir el ORIGEN: ' + repetido + ' de ' + filas.length + ' filas');
  log('   o sea el ' + (filas.length ? Math.round((repetido / Math.max(1, filas.length)) * 100) : 0) + '% de la columna ORIGEN es el mismo texto repetido.');
  log('   Esto se podria quitar SIN borrar nada, moviendo el ORIGEN a nivel de grupo.');
  log('');

  // -------------------------------------------------------------------------- 5. veredicto
  log('5) VEREDICTO:');
  log('   origins HUERFANOS: ' + huerfanos + '  (filas ' + filasHuerfanas
    + ', ' + bytesHuerfanos + ' bytes de KEY+ORIGEN)');
  log('   origins VIVOS o de trabajo: ' + vivos);
  if (!huerfanos) {
    log('');
    log('   No hay huerfanos: todos los origins apuntan a un plan que existe.');
    log('   Entonces podarlos SI perderia informacion, y la decision es de negocio:');
    log('   cuantos planes publicados viejos quiere conservar la planta?');
  } else {
    log('');
    log('   HAY ' + huerfanos + ' ORIGEN(S) HUERFANO(S). Sus snapshots ya fueron borrados por');
    log('   PP_prunePublishedSnapshots_ (esa es la politica vigente: un plan publicado por semana),');
    log('   PP_deletePlanSnapshot_ no toca ESTADOS_OPERACION_PLAN, y PP_preservePublishedPlanStatuses_');
    log('   los vuelve a escribir en cada guardado. O sea que no son historia: son filas cuya fila');
    log('   de Plan ya no existe y que ademas se regraban solas.');
    log('');
    log('   NO SE PUEDEN VER DESDE LA APP: el selector de versiones sale de listPlanSnapshots, no');
    log('   de los origins, asi que un origin huerfano no se puede seleccionar ni editar.');
    log('');
    log('   OJO, Y ESTA ES LA PREGUNTA QUE HAY QUE RESPONDER ANTES DE PODAR:');
    log('   hay ' + detalle.filter(function (d) { return !d.existe; })
      .reduce(function(s, d) { return s + d.completadas; }, 0) + ' operaciones marcadas COMPLETADAS');
    log('   dentro de origins huerfanos. Si esas operaciones seHabian completado de verdad y se');
    log('   quiere ese historial, podarlos lo borra. No se puede saber si son reales solo con');
    log('   mirar la hoja: hay que compararlos con ESTATUS de las operaciones en OPERACIONES.');
  }
}
