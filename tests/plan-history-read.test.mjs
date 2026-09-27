/**
 * PP_readMachineToolHistory_ lee solo las columnas que usa. El resultado tiene que ser IDÉNTICO
 * al de la lectura completa, con muchas menos celdas.
 *
 * POR QUÉ NO SE ACOTA POR FILAS, Y POR QUÉ ESTE ARCHIVO LO DICE. La función termina en
 * .slice(-2000): de 138 715 filas se quedan 2 000, así que acortar la lectura parece
 * evidente. Se intentó, con un bucle que sube el tamaño hasta llegar a 2 000 filas válidas, y
 * el test lo desmintió: la lectura completa devolvía fechas de fin MÁS NUEVAS (2026-09-28, del
 * snapshot 060) que la cola (2026-09-26, del snapshot 088). La hoja se anexa por orden de
 * GENERACIÓN y la función ordena por FECHA DE FIN DE LA OPERACIÓN, y una operación puede
 * terminar antes que otra de un snapshot más nuevo. Recortar filas cambia el resultado.
 * El arreglo correcto es que la hoja no crezca, y eso es borrar snapshots: decisión de la
 * persona, no del código. El test de abajo fija ese hallazgo para que nadie lo reintente.
 *
 * LO QUE SÍ SE HACE, Y ES EQUIVALENTE POR CONSTRUCCIÓN: leer 8 de las 31 columnas. La función
 * mira SNAPSHOT_ID, NUM, OT, MAQ_AREA, HERRAMENTAL, KIT_HERRAMENTAL, F_FIN y H_FIN, y las otras
 * 23 no pueden cambiar un slice. Es la misma aritmética con menos celdas.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const src = await readFile(new URL("../src/server/02-storage.js", import.meta.url), "utf8");

function extraer(nombre, conConst = false) {
  if (conConst) {
    // Se saca hasta el primer ';' de la linea. Acepta tanto un literal de arreglo como
    // PP_SHEETS.algo, para que la mutacion que devuelve la proyeccion a "las 31 columnas" sea
    // carregable y el guard del ahorro pueda comprobarla, en vez de que el test muera al
    // intentar extraerla.
    const i = src.search(new RegExp(`^const ${nombre}_ = `, "m"));
    assert.notEqual(i, -1, `no encontre la constante ${nombre}`);
    const fin = src.indexOf(";", i);
    assert.ok(fin > i, `no encontre el final de ${nombre}`);
    return src.slice(i, fin + 1);
  }
  const i = src.search(new RegExp(`^function ${nombre}\\(`, "m"));
  assert.notEqual(i, -1, `no encontre ${nombre}`);
  const abre = src.indexOf("{", i);
  let nivel = 0, comillas = null;
  for (let k = abre; k < src.length; k += 1) {
    const c = src[k];
    if (comillas) { if (c === "\\") { k += 1; continue; } if (c === comillas) comillas = null; continue; }
    if (c === '"' || c === "'" || c === "`") { comillas = c; continue; }
    if (c === "{") nivel += 1;
    if (c === "}") { nivel -= 1; if (nivel === 0) return src.slice(i, k + 1); }
  }
  throw new Error(`sin cerrar en ${nombre}`);
}

const COLS = extraer("PP_PLAN_HISTORY_COLS", true);
const NUEVA = extraer("PP_readMachineToolHistory_");
const COLSREADER = extraer("PP_readRowsCols_");
const ROWS = extraer("PP_readRows_");

/** Las 31 columnas reales de PP_SHEETS.PLANES_HISTORICOS, para que la prueba sea realista. */
const PP_SHEETS_HISTORICOS = [
  "SNAPSHOT_ID", "FECHA_GENERACION", "USUARIO", "PLAN_INICIO", "HORIZONTE_DIAS", "NUM", "OT", "PARTE",
  "OP", "MAQ_AREA", "OPERADOR", "TC_MIN", "TIEMPO_SETUP", "TIEMPO_PROD", "F_INICIO", "H_INICIO",
  "F_FIN", "H_FIN", "COMENTARIOS", "PRIORIDAD", "ESTATUS", "BLOQUEADA", "HERRAMENTAL", "KIT_HERRAMENTAL",
  "TIPO_SUBCONTRATO", "DIAS_SUBCONTRATO", "PZAS_PENDIENTES", "TIPO_OT", "PRECIO_UNITARIO", "MONTO",
  "COMPLETION_KEY",
];
assert.equal(PP_SHEETS_HISTORICOS.length, 31, "la hoja real tiene 31 columnas");

/** Hoja falsa que cuenta las celdas que se leen de verdad. */
function hojaDe(filas, columnas = PP_SHEETS_HISTORICOS) {
  const estado = { celdasLeidas: 0, llamadasRango: 0 };
  const celda = (fila, c) => {
    const v = (filas[fila - 1] || [])[c];
    return v === undefined ? "" : String(v);
  };
  return {
    estado,
    getLastRow: () => filas.length + 1,
    getLastColumn: () => columnas.length,
    getRange(fila, columna, numFilas, numColumnas) {
      const ancho = numColumnas || columnas.length;
      estado.llamadasRango += 1;
      estado.celdasLeidas += numFilas * ancho;
      const valores = [];
      for (let f = fila; f < fila + numFilas; f += 1) {
        if (f === 1) { valores.push(columnas.slice()); continue; }
        valores.push(Array.from({ length: ancho }, (_, k) => celda(f - 1, columna - 1 + k)));
      }
      return { getDisplayValues: () => valores, getValues: () => valores };
    },
    getDataRange() {
      estado.celdasLeidas += (filas.length + 1) * columnas.length;
      return {
        getDisplayValues: () => [columnas.slice()].concat(filas.map((f) => columnas.map((_, c) => (f[c] === undefined ? "" : String(f[c]))))),
        getValues: () => [columnas.slice()].concat(filas),
      };
    },
  };
}

/** Snapshot con m operaciones. Fecha de fin CORRELACIONADA con el numero de snapshot, como en la vida real. */
function generar(snapshots, porSnapshot) {
  const filas = [];
  for (let s = 0; s < snapshots; s += 1) {
    const id = `snap-${String(s).padStart(3, "0")}`;
    for (let o = 0; o < porSnapshot; o += 1) {
      const fila = Array(31).fill("");
      fila[0] = id;                                   // SNAPSHOT_ID
      fila[5] = String(o + 1);                          // NUM
      fila[6] = `OT-${s}-${o}`;                        // OT
      const valida = o % 7 !== 3;
      fila[9] = valida ? `MAQ-${o % 9}` : "";           // MAQ_AREA
      fila[22] = valida ? `HERR-${o % 40}` : "";         // HERRAMENTAL
      fila[23] = valida ? `KIT-${o % 5}` : "";          // KIT_HERRAMENTAL
      // La fecha de fin AVANZA con el numero de snapshot: un snapshot mas nuevo tiene
      // operaciones que terminan mas tarde. Esto es lo que hace que ordenar por fecha de fin
      // coincida (casi) con el orden de las filas, y por eso la prueba de equivalencia es
      // significativa. El caso contrario esta en el test de abajo.
      fila[16] = `2026-${String(1 + Math.floor(s / 4)).padStart(2, "0")}-${String((o % 28) + 1).padStart(2, "0")}`;
      fila[17] = "08:00";                              // H_FIN
      filas.push(fila);
    }
  }
  return filas;
}

function contexto() {
  const ctx = { console, JSON, Math, String, Number, Object, Array, isFinite, isNaN, Utilities: {}, Session: {}, PP_SHEETS: { PLANES_HISTORICOS: PP_SHEETS_HISTORICOS } };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(
    `${ROWS}\n${COLS}\n${COLSREADER}\n${NUEVA}\n` +
    "this.PP_readRows_=PP_readRows_;this.PP_readMachineToolHistory_=PP_readMachineToolHistory_;this.COLS=PP_PLAN_HISTORY_COLS_;",
    ctx,
  );
  return ctx;
}

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** PP_readMachineToolHistory_ recibe el spreadsheet, no la hoja. */
const libro = (hoja) => ({ getSheetByName: () => hoja });

/** La version de ANTES, tal cual estaba, para comparar salidas. */
function versionVieja(ctx, sheet) {
  return ctx.PP_readRows_(sheet).map(function(row, index) {
    const machine = String(row.MAQ_AREA || "").trim().toUpperCase();
    const herramental = String(row.HERRAMENTAL || "").trim();
    const kit = String(row.KIT_HERRAMENTAL || "").trim();
    const endDate = String(row.F_FIN || "").trim();
    const endTime = String(row.H_FIN || "").trim();
    if (!machine || /^CT\s+/i.test(machine) || !herramental || !endDate || !endTime) return null;
    return {
      id: "history-" + String(row.SNAPSHOT_ID || "") + "-" + (index + 1),
      operationId: "snapshot-" + String(row.SNAPSHOT_ID || "") + "-" + String(row.NUM || index + 1),
      snapshotId: String(row.SNAPSHOT_ID || ""), ot: String(row.OT || ""), machine, herramental, kitHerramental: kit, endDate, endTime,
    };
  }).filter((x) => x !== null).sort((a, b) => (a.endDate + " " + a.endTime).localeCompare(b.endDate + " " + b.endTime)).slice(-2000);
}

test("solo pide las 8 columnas que usa, de las 31 que tiene la hoja", () => {
  const ctx = contexto();
  assert.equal(PP_SHEETS_HISTORICOS.length, 31);
  assert.equal(ctx.COLS.length, 8, "la proyección es de 8 columnas");
  for (const c of ctx.COLS) {
    assert.ok(PP_SHEETS_HISTORICOS.includes(c), `la columna ${c} existe en la hoja real`);
  }
});

test("hoja ENORME: resultado IDÉNTICO al de la versión que leía las 31 columnas", () => {
  // 100 snapshots x 1 400 operaciones = 140 000 filas, como las 138 715 medidas.
  const filas = generar(100, 1400);
  const h1 = hojaDe(filas);
  const ctx = contexto();
  const nueva = ctx.PP_readMachineToolHistory_(libro(h1));
  const vieja = versionVieja(ctx, h1);

  assert.ok(igual(nueva, vieja),
    `tienen que salir identicas. nueva[0]=${JSON.stringify(nueva[0])} vieja[0]=${JSON.stringify(vieja[0])} longitudes ${nueva.length}/${vieja.length}`);
  assert.equal(nueva.length, vieja.length);
});

test("y lee muchas menos celdas: el ahorro es real, no declarativo", () => {
  const filas = generar(100, 1400);
  const hNueva = hojaDe(filas);
  const hVieja = hojaDe(filas);
  const ctx = contexto();
  ctx.PP_readMachineToolHistory_(libro(hNueva));
  versionVieja(ctx, hVieja);

  const leidasNuevas = hNueva.estado.celdasLeidas;
  const leidasViejas = hVieja.estado.celdasLeidas;
  assert.ok(leidasNuevas < leidasViejas * 0.4,
    `nuevas ${leidasNuevas} vs viejas ${leidasViejas}: 8 de 31 columnas deberia ser ~26 %`);
});

test("una columna que NO existe en la hoja no rompe la carga", () => {
  // Dos casos distintos y los dos importan.
  // (a) La hoja NO tiene la columna H_FIN en su encabezado. Ahi el indice es -1 y la columna se
  //     tiene que tratar como cadena vacia, no reventar: getAppState no puede caerse porque una
  //     hoja vieja no tenga una columna.
  // (b) La hoja TIENE la columna pero sus valores estan vacios. Ahi es el filtro de filas no
  //     validas, que es otra cosa.
  const sinColumna = hojaDe(generar(3, 200), PP_SHEETS_HISTORICOS.filter((c) => c !== "H_FIN"));
  const ctx = contexto();
  const a = ctx.PP_readMachineToolHistory_(libro(sinColumna));
  assert.ok(Array.isArray(a), "una hoja sin H_FIN no puede romper la carga");
  assert.equal(a.length, 0, "y sin H_FIN no hay ninguna fila valida");

  const conValoresVacios = generar(3, 200).map((f) => { const g = f.slice(); g[17] = ""; return g; });
  const h2 = hojaDe(conValoresVacios);
  const b = ctx.PP_readMachineToolHistory_(libro(h2));
  assert.ok(Array.isArray(b));
  assert.equal(b.length, 0, "con la columna presente pero vacia, tampoco hay filas validas");
});

test("hoja vacia, de una sola fila, o sin la hoja: no revienta", () => {
  const ctx = contexto();
  for (const filas of [[], generar(1, 1)]) {
    const h = hojaDe(filas);
    assert.ok(Array.isArray(ctx.PP_readMachineToolHistory_(libro(h))));
  }
  const sinHoja = null;
  assert.ok(igual(ctx.PP_readMachineToolHistory_(libro(sinHoja)), []));
});

test("HALLAZGO QUE IMPIDE ACOTAR POR FILAS: el orden de las filas NO es el de las fechas de fin", () => {
  // Este es el motivo por el que la lectura acotada por filas se deshizo. Aqui el snapshot 001
  // tiene operaciones que terminan DESPUES que las del snapshot 099, y estan antes en la hoja. Con
  // orden de filas NO se Strand supposed las 2 000 mas recientes por fecha; con orden de filas, si.
  const filas = [];
  for (const [snap, dia] of [["nuevo", 1], ["viejo", 28]]) {
    for (let o = 0; o < 2500; o += 1) {
      const f = Array(31).fill("");
      f[0] = snap; f[5] = String(o + 1); f[6] = `OT-${snap}-${o}`;
      f[9] = "MAQ-1"; f[22] = "HERR-1"; f[23] = "KIT-1";
      f[16] = `2026-09-${String(dia).padStart(2, "0")}`; f[17] = "08:00";
      filas.push(f);
    }
  }
  // "nuevo" esta PRIMERO en la hoja pero tiene fecha de fin ANTIGUA.
  const h = hojaDe(filas);
  const ctx = contexto();
  const r = ctx.PP_readMachineToolHistory_(libro(h));
  const conViejo = r.filter((x) => x.snapshotId === "viejo").length;
  assert.equal(r.length, 2000);
  assert.equal(conViejo, 2000,
    "las 2 000 que se quedan SON las de fecha mas nueva, aunque esten al final de la hoja. " +
    "Un recorte por filas habria devuelto las de 'nuevo', que son las MAS ANTIGUAS. Por eso no se acota por filas.");
});
