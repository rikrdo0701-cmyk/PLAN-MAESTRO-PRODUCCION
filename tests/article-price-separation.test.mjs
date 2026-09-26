import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

/**
 * RULE-REP-021: el precio de venta que deja el sync y el precio que escribe una persona
 * SON DOS COSAS DISTINTAS y no pueden compartir columna.
 *
 * QUE PASABA. persistReferencePricesFromSync escribia el precio de venta de NetSuite en
 * manualUnitPrice, con un Math.max que solo subi. Como ese campo es tambien el que usan el
 * dialogo de "preparar trabajo" y la tabla de Catalogos, un precio de venta equivocado
 * quedaba pegado en CONFIG para siempre y el reporte lo tomaba como si alguien lo hubiera
 * escrito a mano. Cuando se arreglo la conversion por tipo de cambio (RULE-REP-020), los
 * precios de venta se corrigieron solos, pero los valores que el ratchet ya habia grabado
 * NO se corrigen solos: no hay forma de que bajen.
 *
 * QUE SE HACE. El sync escribe en referenceSalePrice, que SI se actualiza en ambos sentidos.
 * manualUnitPrice queda solo para lo que escriba una persona.
 */

const app = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");
const storage = await readFile(new URL("../src/server/02-storage.js", import.meta.url), "utf8");

// Se extrae la funcion del cuerpo de app.js tal cual, sin reimplementarla.
function extraerPersistReferencePrices() {
  const inicio = app.indexOf("function persistReferencePricesFromSync(");
  assert.ok(inicio > 0, "no se encontro persistReferencePricesFromSync");
  // Se toma hasta la siguiente declaracion de funcion de primer nivel.
  const fin = app.indexOf("\nfunction setNetSuiteSyncPhaseLabel", inicio);
  assert.ok(fin > inicio, "no se encontro el final de persistReferencePricesFromSync");
  return app.slice(inicio, fin);
}

function correrSync({ workOrders, configuracionesIniciales = {} }) {
  const fuente = extraerPersistReferencePrices();
  const articleConfigurations = JSON.parse(JSON.stringify(configuracionesIniciales));
  const guardadas = [];
  const ctx = {
    // persistReferencePricesFromSync lee state.workOrders de su propio cierre, no un
    // argumento, asi que el arnes los tiene que poner ahi.
    state: { articleConfigurations, workOrders },
    articleKeyForPart: (part) => String(part || "").trim().toUpperCase(),
    articleConfigurationFor: (article) => {
      if (!articleConfigurations[article]) articleConfigurations[article] = { article, jobType: "", planningType: "", manualUnitPrice: 0, referenceSalePrice: 0, updatedAt: "" };
      return articleConfigurations[article];
    },
    articleForOt: (ot) => {
      const w = workOrders.find((x) => x.ot === ot);
      return w ? w.item : "";
    },
    Math, Object, JSON, String, Number, Array, Date, isNaN, isFinite, Date: class extends Date {},
    queueAppSheetSave: (vista) => guardadas.push(vista),
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(`${fuente}\npersistReferencePricesFromSync();`, ctx);
  return { articleConfigurations, guardadas };
}

test("el sync escribe en referenceSalePrice y NO toca manualUnitPrice", () => {
  const { articleConfigurations } = correrSync({
    workOrders: [{ ot: "3424", item: "TR 350", lastSalePrice: 280, averageSalePrice: 275 }],
    configuracionesIniciales: {
      "TR 350": { article: "TR 350", jobType: "LINEA", planningType: "NORMAL", manualUnitPrice: 999, referenceSalePrice: 0, updatedAt: "" },
    },
  });

  const conf = articleConfigurations["TR 350"];
  assert.equal(conf.manualUnitPrice, 999, "un precio escrito por una persona no se toca");
  assert.equal(conf.referenceSalePrice, 280, "el precio de venta va a su propio campo");
});

test("referenceSalePrice BAJA cuando el precio de venta baja (esto es lo que el ratchet no podia)", () => {
  const { articleConfigurations } = correrSync({
    workOrders: [{ ot: "1", item: "M66-8602", lastSalePrice: 1376, averageSalePrice: 1414 }],
    configuracionesIniciales: {
      // Un valor inflado de cuando el sync los grababa en manualUnitPrice.
      "M66-8602": { article: "M66-8602", jobType: "", planningType: "", manualUnitPrice: 24607, referenceSalePrice: 24607, updatedAt: "" },
    },
  });

  const conf = articleConfigurations["M66-8602"];
  assert.equal(conf.referenceSalePrice, 1414, "el precio de venta corregido debe bajar a su campo");
  assert.ok(conf.referenceSalePrice < 24607, "ya no puede quedarse pegado en el maximo historico");
  assert.equal(conf.manualUnitPrice, 24607, "el valor historico queda como estaba, sin borrarlo de golpe");
});

test("no escribe si el precio de venta no cambio, para no guardar la hoja en cada sync", () => {
  const corrida = correrSync({
    workOrders: [{ ot: "1", item: "P-1", lastSalePrice: 500, averageSalePrice: 500 }],
    configuracionesIniciales: {
      "P-1": { article: "P-1", jobType: "", planningType: "", manualUnitPrice: 0, referenceSalePrice: 500, updatedAt: "" },
    },
  });
  assert.deepEqual(corrida.guardadas, [], "mismo precio, no hay nada que guardar");
});

test("una venta sin precio no borra el ultimo precio conocido", () => {
  const { articleConfigurations } = correrSync({
    workOrders: [{ ot: "1", item: "P-2", lastSalePrice: 0, averageSalePrice: 0 }],
    configuracionesIniciales: {
      "P-2": { article: "P-2", jobType: "", planningType: "", manualUnitPrice: 0, referenceSalePrice: 333, updatedAt: "" },
    },
  });
  assert.equal(articleConfigurations["P-2"].referenceSalePrice, 333, "sin venta nueva se conserva el ultimo conocido");
});

test("la hoja CONFIGURACION_ARTICULO tiene columnas separadas para los dos precios", () => {
  const fila = storage.match(/CONFIGURACION_ARTICULO:\s*\[([^\]]+)\]/);
  assert.ok(fila, "no se encontro la definicion de CONFIGURACION_ARTICULO");
  const columnas = fila[1];
  assert.match(columnas, /'PRECIO_MANUAL'/, "debe existir la columna del precio manual");
  assert.match(columnas, /'PRECIO_REF_VENTA'/, "debe existir la columna del precio de venta del sync");
  const iManual = columnas.indexOf("'PRECIO_MANUAL'");
  const iRef = columnas.indexOf("'PRECIO_REF_VENTA'");
  assert.notEqual(iManual, iRef, "no pueden ser la misma columna");
});

test("el servidor lee y escribe los dos precios por separado", () => {
  // Lectura: la fila de la hoja alimenta los dos campos.
  assert.match(storage, /manualUnitPrice: Number\(row\.PRECIO_MANUAL \|\| 0\)/);
  assert.match(storage, /referenceSalePrice: Number\(row\.PRECIO_REF_VENTA \|\| 0\)/);
  // Escritura: las dos columnas viajan en su orden.
  assert.match(storage, /Number\(item\.manualUnitPrice \|\| item\.precioManual \|\| 0\),\s*\n\s*Number\(item\.referenceSalePrice \|\| item\.precioRefVenta \|\| 0\)/);
});

test("el max del reporte usa el precio de venta del sync solo cuando no hay uno vivo", () => {
  const i = app.indexOf("const livePrice = invoiceUnitPriceForOt(ot) || null;");
  assert.ok(i > 0, "no se encontro el bloque de unitPrices del reporte semanal");
  const bloque = app.slice(i, i + 700);
  assert.match(bloque, /livePrice \? null : configuration\.referenceSalePrice/,
    "el precio del sync es el respaldo cuando no hay precio vivo, no una fuente mas del max");
  assert.match(bloque, /configuration\.manualUnitPrice/, "el precio manual sigue siendo fuente del max");
  // Y no debe existir ya el ratchet que escribia en manualUnitPrice.
  assert.doesNotMatch(app, /configuration\.manualUnitPrice = price;/,
    "el sync no debe volver a escribir el precio de venta en manualUnitPrice");
});
