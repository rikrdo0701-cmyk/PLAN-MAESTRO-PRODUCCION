// =============================================================================
// EL 2246 DESPLEGADO TIENE QUE TRAER LAS OTs CERRADAS (RULE-SUP-050, capa del espejo)
// =============================================================================
//
// POR QUE ESTE ARCHIVO EXISTE Y NO ES DUPLICADO DEL DE `restlet-supabase-sync`. MEDIDO
// 2026-10-05, con la sesion del navegador y solo lectura:
//
//   - `work_orders` tiene 213 filas, las 213 con `created_at` del MISMO minuto
//     (2026-10-04T18:49:14Z), y `estatus` solo de dos valores: "Orden de trabajo : En curso"
//     (103) y "Orden de trabajo : Liberada" (110). Ni una cerrada.
//   - `fecha_vencimiento` esta poblada en las 213 y `fecha_fin_ns` en NINGUNA, aunque el
//     repositorio tiene un archivo que emite las dos desde el mismo `t.enddate`
//     (`netsuite-restlet-supabase-sync.js:354-355`). El unico lector de `work_orders` que
//     emite `fecha_vencimiento` y NO `fecha_fin_ns` es `netsuite-restlet-unificado-supabase.js`,
//     que tiene ocho columnas y ni una de mas. Ese es el que corrio.
//   - El documento `docs/integrations/netsuite-supabase-sync.md` (lineas 10-23) lo dice de
//     otra manera y no lo dice de oidas: el camino que CORRE es Apps Script -> RESTlet
//     unificado 2246 -> Supabase, y la arquitectura de User Events (Suitelet + RESTlet
//     `netsuite-restlet-supabase-sync.js` + ScheduledScript) es el DISENO PROPUESTO y no
//     esta desplegada; su despliegue no sustituye al 2246.
//
// O sea: el fix de RULE-SUP-050 del 2026-10-05 quedo en el archivo que no corre. Este
// archivo lo pone donde si corre, y el ultimo test ata las dos copias para que no vuelvan a
// divergir en la ventana.
//
// QUE SE PRUEBA. El SQL no se puede correr desde aca (no hay cuenta), asi que se prueba lo
// que si se puede: (a) que la accion `workorders` lance DOS consultas, la de abiertas y la de
// cerradas, y que las dos traigan filas; (b) que el SQL de cerradas diga lo que tiene que
// decir -las tres palabras de estatus, la planta 1, la ventana de 90 dias con las
// `enddate IS NULL` adentro, el orden y el tope-; (c) que el estatus crudo de las cerradas
// llegue intacto, que es justo el dato que faltaba; (d) que si la consulta de cerradas
// falla la accion NO se caiga, porque caida significa que la ingesta vacie `work_orders`
// entera (RULE-SUP-048); (e) que si falla la de abiertas la accion SI se caiga, porque ahi
// degradar seria mentir.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";

const raiz = new URL("../", import.meta.url);
const fuente = await readFile(new URL("netsuite-restlet-unificado-supabase.js", raiz), "utf8");
const fuenteSync = await readFile(new URL("netsuite-restlet-supabase-sync.js", raiz), "utf8");

/**
 * Levanta el RESTlet REAL (el `post` que Apps Script invoca) con un `N/query` de mentira
 * que registra el SuiteQL que le llega y contesta lo que el caso necesita. Los objetos que
 * se comparan con `deepEqual` se pasan por `plano()`: los que nacen dentro del `vm` tienen
 * prototipo distinto y `assert.deepEqual` los distingue aunque sean iguales campo por campo.
 */
function restlet(alResponder) {
  const consultas = [];
  let modulo = null;
  const define = (deps, factory) => {
    const query = {
      runSuiteQL(args) {
        consultas.push(String(args && args.query));
        const r = alResponder(String(args && args.query), consultas.length);
        if (r instanceof Error) throw r;
        return { asMappedResults: () => r || [] };
      },
    };
    modulo = factory(query);
  };
  const contexto = { console, JSON, Math, String, Number, Boolean, Date, Error, parseInt, parseFloat, isNaN, define };
  contexto.globalThis = contexto;
  createContext(contexto);
  runInContext(fuente, contexto, { filename: "netsuite-restlet-unificado-supabase.js" });
  return { post: modulo.post, consultas };
}

const plano = (v) => JSON.parse(JSON.stringify(v));

/** Fila cruda de SuiteQL, con la forma que devuelve `asMappedResults`. */
function cruda(ot, estatus, extra) {
  return Object.assign({
    wo_internal_id: 90000 + Number(ot),
    ot: String(ot),
    articulo: "ART-" + ot,
    descripcion: "Pieza " + ot,
    cantidad: "10",
    estatus: estatus,
    cliente: "Cliente Uno",
    fecha_vencimiento: "01/10/2026",
  }, extra || {});
}

const ABIERTA = "Orden de trabajo : En curso";
const CERRADA = "Orden de trabajo : Cerrada";

/**
 * Cual de las dos consultas es la de CERRADAS. No basta con buscar `%CERRAD%`: la consulta de
 * ABIERTAS tambien lo trae, en `NOT LIKE`, y con un `test` a secas las dos caian en el mismo
 * cubo y los casos probaban dos veces lo mismo.
 */
function esCerrada(sql) {
  return /LIKE '%CERRAD%'/.test(sql) && !/NOT LIKE '%CERRAD%'/.test(sql);
}

/**
 * La tercera consulta de la accion: la que suma las transacciones `Build` por OT. Se reconoce
 * por su columna de salida, que ninguna de las dos principales tiene.
 */
function esEnsamblada(sql) {
  return /AS cant_ensamblada/.test(sql);
}

/** Reparte las consultas del par: la primera abiertas, la segunda cerradas, la tercera builds. */
function porPosicion(abiertas, cerradas, ensamblada) {
  return (sql) => {
    if (esEnsamblada(sql)) return typeof ensamblada === "function" ? ensamblada(sql) : (ensamblada || []);
    return esCerrada(sql) ? cerradas : abiertas;
  };
}

test("la accion workorders consulta abiertas Y cerradas, en ese orden", () => {
  const r = restlet(porPosicion([cruda("2624", ABIERTA)], [cruda("3302", CERRADA)], [
    { wo_internal_id: 92624, cant_ensamblada: 10 },
  ]));
  const salida = plano(r.post({ accion: "workorders" }));
  assert.equal(r.consultas.length, 3, " abiertas, cerradas y la suma de Build");
  assert.match(r.consultas[0], /NOT LIKE '%CERRAD%'/);
  assert.match(r.consultas[1], /LIKE '%CERRAD%'/);
  assert.ok(esEnsamblada(r.consultas[2]), " la tercera es la de la cantidad ensamblada");
  assert.equal(salida.ok, true);
  assert.equal(salida.totalRows, 2);
  assert.deepEqual(salida.rows.map((f) => f.ot), ["2624", "3302"]);
  assert.deepEqual(salida.cerradas, { incluidas: 1, dias: 90, tope: 300 });
});

test("el estatus crudo de la cerrada llega intacto: es el dato que faltaba", () => {
  const r = restlet(porPosicion([cruda("2624", ABIERTA)], [cruda("3302", CERRADA)]));
  const salida = plano(r.post({ accion: "workorders" }));
  const cerrada = salida.rows[1];
  // Si esto volviera con un texto normalizado ("Cerrada"), el predicado del lector tendria
  // que cambiar y el espejo estaria diciendo otra cosa que NetSuite. No se toca.
  assert.equal(cerrada.estatus, CERRADA);
  assert.equal(cerrada.fecha_vencimiento, "2026-10-01");
  assert.equal(cerrada.cantidad, 10);
  assert.equal(cerrada.wo_internal_id, "93302");
});

test("el SQL de cerradas: tres palabras de estatus, planta 1, ventana de 90 y tope", () => {
  const r = restlet(porPosicion([], []));
  r.post({ accion: "workorders" });
  const sql = r.consultas[1];
  // Las MISMAS tres palabras que hacen "abierta", para que los dos conjuntos sean disjuntos
  // y una OT no pueda salir dos veces en el mismo espejo.
  assert.match(sql, /LIKE '%CERRAD%'/);
  assert.match(sql, /LIKE '%CLOSED%'/);
  assert.match(sql, /LIKE '%COMPLET%'/);
  assert.doesNotMatch(sql, /NOT LIKE/);
  // La planta 1, como en las abiertas: el app no trabaja la 2 (decision 2026-09-29).
  assert.match(sql, /tl\.location = 1/);
  // La ventana: 90 dias, y las que no tienen fecha entran (sin ellas la evidencia de
  // RULE-OT-051 vuelve a faltar justo en las que NetSuite cerro sin fecha).
  assert.match(sql, /\(t\.enddate IS NULL OR t\.enddate >= SYSDATE - 90\)/);
  // Orden y tope: si hay que recortar, se pierden las viejas; el tope es PROPIO para que
  // un trimestre lleno de cerradas no se coma el lugar de las abiertas.
  assert.match(sql, /ORDER BY t\.enddate DESC NULLS LAST, t\.tranid/);
  assert.match(sql, /FETCH NEXT 300 ROWS ONLY/);
});

test("el SQL de abiertas no cambio: sigue siendo el de antes, sin ventana ni tope", () => {
  const r = restlet(porPosicion([], []));
  r.post({ accion: "workorders" });
  const sql = r.consultas[0];
  assert.match(sql, /NOT LIKE '%CERRAD%'/);
  assert.match(sql, /NOT LIKE '%CLOSED%'/);
  assert.match(sql, /NOT LIKE '%COMPLET%'/);
  assert.match(sql, /ORDER BY t\.tranid/);
  assert.doesNotMatch(sql, /SYSDATE/);
  assert.doesNotMatch(sql, /FETCH NEXT/);
});

test("si la consulta de CERRADAS falla, la accion se degrada a abiertas y lo dice", () => {
  const r = restlet((sql) => {
    if (esCerrada(sql)) throw new Error("Failed to parse SQL");
    return [cruda("2624", ABIERTA)];
  });
  const salida = plano(r.post({ accion: "workorders" }));
  assert.equal(salida.ok, true, " degradar es lo correcto: la ingesta escribe igual");
  assert.equal(salida.totalRows, 1);
  assert.equal(salida.rows[0].ot, "2624");
  assert.equal(salida.cerradas.incluidas, 0);
  assert.match(salida.aviso, /No se pudieron leer las OTs CERRADAS/);
  assert.match(salida.aviso, /Failed to parse SQL/, " el aviso tiene que decir POR QUE, no solo que fallo");
});

test("si la consulta de ABIERTAS falla, la accion se cae (degradar ahi seria vaciar la tabla)", () => {
  const r = restlet((sql) => {
    if (esCerrada(sql)) return [cruda("3302", CERRADA)];
    throw new Error("Failed to parse SQL");
  });
  assert.throws(() => r.post({ accion: "workorders" }), /Failed to parse SQL/);
});

test("sin cerrada no hay aviso, y las diez columnas del espejo no se multiplican", () => {
  const r = restlet(porPosicion([cruda("2624", ABIERTA)], [], [
    { wo_internal_id: 92624, cant_ensamblada: 10 },
  ]));
  const salida = plano(r.post({ accion: "workorders" }));
  assert.equal("aviso" in salida, false, " el aviso es solo para el fallo, no para el cero");
  assert.deepEqual(salida.headers, [
    "wo_internal_id", "ot", "articulo", "descripcion", "cantidad", "estatus", "cliente", "fecha_vencimiento",
    "cant_ensamblada", "cant_pendiente",
  ]);
  assert.deepEqual(Object.keys(salida.rows[0]).sort(), salida.headers.slice().sort());
});

test("la cantidad ensamblada sale de sumar las transacciones Build de cada OT", () => {
  // MEDIDO EN VIVO 2026-10-25 contra el 2244: 3764 = 10 de 10, 3789 = 5 de 15, 3786 = 0 de 5.
  const r = restlet(porPosicion(
    [cruda("3764", CERRADA, { cantidad: "10" }), cruda("3789", CERRADA, { cantidad: "15" }), cruda("3786", ABIERTA, { cantidad: "5" })],
    [],
    [
      { wo_internal_id: 93764, cant_ensamblada: 10 },
      { wo_internal_id: 93789, cant_ensamblada: 5 },
    ],
  ));
  const salida = plano(r.post({ accion: "workorders" }));
  const porOt = Object.fromEntries(salida.rows.map((f) => [f.ot, f]));
  assert.equal(porOt["3764"].cant_ensamblada, 10);
  assert.equal(porOt["3764"].cant_pendiente, 0);
  assert.equal(porOt["3789"].cant_ensamblada, 5);
  assert.equal(porOt["3789"].cant_pendiente, 10, " 15 de cantidad menos 5 ensambladas");
  // La 3786 no tiene ningun Build: 0 ensamblado y el pendiente ENTERO, no 0. Un 0/0 haria que
  // el lector creyera que nadie escribio las columnas.
  assert.equal(porOt["3786"].cant_ensamblada, 0);
  assert.equal(porOt["3786"].cant_pendiente, 5);
});

test("la consulta de Build pide las dos columnas del espejo y agrupa por OT", () => {
  const r = restlet(porPosicion([cruda("2624", ABIERTA)], [], []));
  r.post({ accion: "workorders" });
  const sql = r.consultas.find(esEnsamblada);
  assert.ok(sql, " tiene que haber una consulta de Build");
  assert.match(sql, /SUM\(ABS\(NVL\(bl\.quantity, 0\)\)\) AS cant_ensamblada/);
  assert.match(sql, /b\.createdfrom IN \(/);
  assert.match(sql, /GROUP BY b\.createdfrom/);
  assert.match(sql, /b\.type = 'Build'/);
});

test("si la consulta de Build falla, la accion sigue y lo dice (no se vacia work_orders)", () => {
  const r = restlet((sql) => {
    if (esEnsamblada(sql)) throw new Error("Unknown identifier createdfrom");
    if (esCerrada(sql)) return [cruda("3302", CERRADA)];
    return [cruda("2624", ABIERTA)];
  });
  const salida = plano(r.post({ accion: "workorders" }));
  assert.equal(salida.ok, true);
  assert.equal(salida.totalRows, 2, " las OTs se siguen escribiendo");
  assert.equal(salida.rows[0].cant_ensamblada, 0);
  assert.match(salida.aviso, /cantidad ensamblada/);
  assert.match(salida.aviso, /Unknown identifier createdfrom/, " el aviso dice POR QUE");
});

test("si la primera estrategia no devuelve filas, se usa la de la linea y se dice", () => {
  const r = restlet((sql) => {
    if (esEnsamblada(sql)) {
      if (/GROUP BY b\.createdfrom/.test(sql)) return [];
      return [{ wo_internal_id: 92624, cant_ensamblada: 7 }];
    }
    if (esCerrada(sql)) return [];
    return [cruda("2624", ABIERTA, { cantidad: "10" })];
  });
  const salida = plano(r.post({ accion: "workorders" }));
  assert.equal(salida.rows[0].cant_ensamblada, 7);
  assert.equal(salida.rows[0].cant_pendiente, 3);
  assert.match(salida.aviso, /transactionline\.createdfrom/);
});

test("si las dos de Build fallan, la tercera usa la ultima operacion y la acota a la cantidad", () => {
  const r = restlet((sql) => {
    if (esEnsamblada(sql)) {
      if (/manufacturingoperationtask/.test(sql)) return [{ wo_internal_id: 92624, cant_ensamblada: 40 }];
      throw new Error("Unknown identifier createdfrom");
    }
    if (esCerrada(sql)) return [];
    return [cruda("2624", ABIERTA, { cantidad: "10" })];
  });
  const salida = plano(r.post({ accion: "workorders" }));
  // MEDIDO en la cuenta: MAX(mot.completedquantity) puede exceder la cantidad de la OT
  // (folio 2204: cantidad 3000, MAX 4200). Se acota a proposito; no se publica un ensamblado
  // mayor que la orden.
  assert.equal(salida.rows[0].cant_ensamblada, 10);
  assert.equal(salida.rows[0].cant_pendiente, 0);
  assert.match(salida.aviso, /manufacturingoperationtask/);
});

test("accion 'todas': los siete sub-resultados, y el de workorders con la ventana", () => {
  const r = restlet(porPosicion([cruda("2624", ABIERTA)], [cruda("3302", CERRADA)]));
  const salida = plano(r.post({ accion: "todas" }));
  assert.equal(salida.ok, true);
  for (const nombre of ["workorders", "operaciones", "materiales", "items", "centros", "inventario", "ordenes_venta"]) {
    assert.ok(salida.acciones[nombre], " falta el resultado de " + nombre);
  }
  assert.equal(salida.acciones.workorders.cerradas.incluidas, 1);
});

test("las dos copias del espejo declaran la MISMA ventana", () => {
  // El archivo desplegado y el diseno propuesto comparten el numero. Si uno cambia y el otro
  // no, el proximo que despliegue el otro entra con otra ventana sin que nadie lo note.
  const enUnificado = fuente.match(/const DIAS_OT_CERRADAS = (\d+);/);
  const enSync = fuenteSync.match(/const DIAS_OT_CERRADAS = (\d+);/);
  assert.ok(enUnificado, " el 2246 tiene que declarar DIAS_OT_CERRADAS");
  assert.ok(enSync, " el diseno propuesto declara DIAS_OT_CERRADAS");
  assert.equal(enUnificado[1], enSync[1]);
  const topeUnificado = fuente.match(/const MAX_OT_CERRADAS = (\d+);/);
  const topeSync = fuenteSync.match(/maxScanCerradas: (\d+)/);
  assert.ok(topeUnificado && topeSync);
  assert.equal(topeUnificado[1], topeSync[1]);
});

test("el 2246 es el unico que emite work_orders, y ahora tambien la cantidad ensamblada", () => {
  // Este era el hallazgo que corrigio el archivo equivocado: el 2246 declaraba ocho columnas y
  // `fecha_fin_ns` no estaba entre ellas, que es por eso que en Supabase esa columna esta
  // vacia en las 213 filas mientras `fecha_vencimiento` esta llena. Si alguien "arregla" el
  // 2246 agregandole columnas, este test obliga a decidirlo a conscious.
  //
  // DECIDIDO EL 2026-10-25: se agregan `cant_ensamblada` y `cant_pendiente` -las dos que el
  // espejo nunca llenaba, y por eso la columna Ensamblado salia 0 en TODAS las OTs-, y NO
  // `fecha_fin_ns`, que sigue siendo del otro archivo.
  assert.doesNotMatch(fuente, /fecha_fin_ns/);
  assert.match(fuente, /'fecha_vencimiento'/);
  assert.match(fuente, /'cant_ensamblada', 'cant_pendiente'/);
  // Y el que trae las dos columnas de fecha es el otro archivo, el del diseno propuesto.
  assert.match(fuenteSync, /fecha_fin_ns: isoFecha\(r\.fecha_fin\)/);
});