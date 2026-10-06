import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";

/**
 * NINGUN SCRIPT DE NETSUITE PUEDE USAR SINTAXIS POSTERIOR A ES2017.
 *
 * POR QUE ESTA PRUEBA EXISTE. MEDIDO 2026-10-06: al cargar el RESTlet 2240 en la cuenta,
 * NetSuite respondio "SyntaxError: missing ; before statement". El archivo NO tenia un punto y
 * coma mal puesto: tenia cuatro `??` (`body.pageSize ?? 200`, `r.id ?? ''`,
 * `r.sequence ?? ''`), que son ES2020. El parser de SuiteScript, despues de `body.pageSize`,
 * espera un `;` y se encuentra un `?`. Y como el parser de NetSuite NO es el de V8,
 * `node --check` daba exit 0 sobre el archivo con el defecto: la comprobacion de sintaxis que
 * se corria en este repo era la equivocada para este destino.
 *
 * QUE ES LO QUE SE PUDO COMPROBAR. El 2246 (que SI corre en produccion, y del que la ingesta
 * recibio 520 work_orders el 2026-10-05) usa `const`, `let`, arrow functions y plantillas de
 * texto: ES6 entra bien. El unico sintaxis posterior a ES2017 en los nueve archivos de
 * NetSuite estaba en el 2240, en forma de `??`. Por eso la frontera que se fija aqui es
 * ES2017 y no ES5: mas alla seria inventar una regla sin evidencia.
 *
 * POR QUE SE BUSCA EN EL CODIGO, NO EN EL TEXTO CRUDO. Un `??` dentro de un comentario o de
 * una cadena de SuiteQL no rompe la carga, asi que esta prueba primero quita comentarios y
 * literales. Un guardia que marca los comentarios haria que la primera vez que alguien
 * explicara el defecto en una nota, la prueba se pusiera en rojo.
 */

const CARPETA = new URL("../", import.meta.url);

/** Los nueve scripts que se suben a la cuenta de NetSuite. */
const ARCHIVOS = (await readdir(new URL(".", CARPETA)))
  .filter((nombre) => /^netsuite-.*\.js$/.test(nombre))
  .sort();

/**
 * Quita comentarios y literales de cadena, y deja el codigo. No es un parser: es
 * suficiente para que un guardia de sintaxis no se confunda con la prosa y con el SQL.
 */
function soloCodigo(fuente) {
  const marcas = [];
  let out = "";
  for (let i = 0; i < fuente.length; i += 1) {
    const c = fuente[i];
    const dos = fuente.slice(i, i + 2);
    if (dos === "//") {
      const fin = fuente.indexOf("\n", i);
      i = fin === -1 ? fuente.length : fin - 1;
      out += " ";
      continue;
    }
    if (dos === "/*") {
      const fin = fuente.indexOf("*/", i + 2);
      i = fin === -1 ? fuente.length : fin + 1;
      out += " ";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const comilla = c;
      let j = i + 1;
      while (j < fuente.length) {
        if (fuente[j] === "\\") { j += 2; continue; }
        if (fuente[j] === comilla) break;
        j += 1;
      }
      marcas.push(i);
      out += '""';
      i = j;
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * Los sintaxis posteriores a ES2017, con el nombre de lo que son. Todos hacen que el parser
 * de SuiteScript responda al cargar el archivo, y ninguno se puede probar con V8.
 */
const POSTERIOR_A_ES2017 = [
  { patron: /\?\?/, que: "?? (nullish coalescing, ES2020)" },
  { patron: /[A-Za-z0-9_)\]]\?\./, que: "?. (optional chaining, ES2020)" },
  { patron: /&&=|\|\|=|\?\?=/, que: "asignacion logica (ES2021)" },
  { patron: /catch\s*\{/, que: "catch sin binding (ES2019)" },
  { patron: /\(\?<[=!]/, que: "lookbehind en regex (ES2018)" },
  { patron: /\d+n\b/, que: "literal BigInt (ES2020)" },
  { patron: /\b\d+_\d/, que: "separador numerico (ES2021)" },
  { patron: /\{\s*\.\.\./, que: "object rest/spread (ES2018)" },
];

test("hay scripts de NetSuite que vigilar", () => {
  // Si el patron del nombre cambia y esto deja de encontrar archivos, la prueba de abajo
  // pasaria sin comprobar nada. Un guardia que no puede ver nada no es un guardia.
  assert.ok(ARCHIVOS.length >= 9, "se esperaban al menos 9 scripts netsuite-*.js y hay " + ARCHIVOS.length);
});

test("ningun script de NetSuite usa sintaxis posterior a ES2017", async () => {
  const hallazgos = [];
  for (const nombre of ARCHIVOS) {
    const fuente = await readFile(new URL(nombre, CARPETA), "utf8");
    const codigo = soloCodigo(fuente);
    for (const regla of POSTERIOR_A_ES2017) {
      const m = regla.patron.exec(codigo);
      if (!m) continue;
      // NO se reporta el numero de linea: `soloCodigo` convierte cada comentario de varias
      // lineas en un solo espacio, asi que el numero de linea del codigo limpio no es el del
      // archivo. Un guardia que senala la linea 6 cuando el defecto esta en la 66 hace que
      // se busca en el lugar equivocado. Se da la posicion del texto limpio, que si es real.
      hallazgos.push(nombre + " (offset " + m.index + " en el codigo sin comentarios) usa " + regla.que);
    }
  }
  assert.deepEqual(
    hallazgos,
    [],
    "el parser de SuiteScript no entiende esto y el archivo no carga:\n  " + hallazgos.join("\n  ")
  );
});

test("el guardia ve un `??` de verdad y no se hace el tonto con los comentarios", () => {
  // El guardia tiene que distinguishable un defecto de una nota que lo describe. Si el
  // `soloCodigo` se pasara de listo y dejara pasar un `??` real, esta prueba lo delata.
  assert.ok(/body\.pageSize \?\? 200/.test(soloCodigo("const a = body.pageSize ?? 200;")));
  assert.equal(soloCodigo("// body.pageSize ?? 200\nconst a = 1;").includes("??"), false);
  assert.equal(soloCodigo("const s = 'WHERE a ?? b';").includes("??"), false);
  assert.equal(soloCodigo("/* ?? */ const a = 1;").includes("??"), false);
});