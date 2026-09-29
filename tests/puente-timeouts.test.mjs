// Los timeouts del puente tienen que ser MAYORES que lo que el metodo tarda de
// verdad, y eso hay que medirlo, no suponerlo.
//
// QUE PASABA. MEDIDO 2026-09-29 abriendo la pagina de verdad en un navegador:
// getAppState AGOTABA el tiempo generico (CALL_TIMEOUT_MS = 120 s). Cuando eso
// pasa, la app hace lo que el codigo dice: se queda con el cache local, avisa por
// consola, y sigue. En un navegador recien abierto el cache esta vacio, asi que la
// pagina aparece SIN operaciones, SIN OTs y SIN catalogo. MEDIDO: 0 de cada uno.
//
// Y no era una vez. Con el techo quitado, en la misma corrida: getAppState 11,3 s y
// getAppStateIfChanged 197 s. O sea 3 minutos 17 segundos. Con eso, 120 s no es un
// margen corto: es MENOS que el peor caso observado. Cortar a los 120 s no es
// prudence, es Discardar la respuesta.
//
// QUE HACE ESTE TEST. Fija que los metodos que se midieron lentos tengan entrada
// propia en METHOD_TIMEOUT_MS y que sea MAYOR que el peor caso medido. Si alguien
// los borra 'porque tardan mucho', el fallo vuelve a ser una pagina vacia y el
// unico rastro es un console.warn.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const cliente = await readFile(new URL("../src/web/shared/apps-script-bridge-client.js", import.meta.url), "utf8");

/** Los timeouts declarados, tal cual. */
function timeouts() {
  const i = cliente.indexOf("const METHOD_TIMEOUT_MS = {");
  const j = cliente.indexOf("\n};", i);
  const bloque = cliente.slice(i, j);
  const out = {};
  for (const m of bloque.matchAll(/^\s{4}([A-Za-z_$][\w$]*):\s*(\d+),/gm)) out[m[1]] = Number(m[2]);
  return out;
}

test("los metodos medidos lentos tienen timeout propio, por encima de lo que tardan", () => {
  const t = timeouts();
  // MEDIDO 2026-09-29 con el techo quitado. El margen se calcula a ojo sobre el
  // peor caso, no sobre la mediana: getAppStateIfChanged tardo 197 s una vez, y esa
  // vez es la que hace falta cubrir.
  const medido = { getAppState: 11.3, getAppStateIfChanged: 197 };
  for (const [metodo, segundos] of Object.entries(medido)) {
    assert.ok(t[metodo] !== undefined, `${metodo} no tiene timeout propio: hereda el generico de 120 s y se corta antes de responder`);
    assert.ok(
      t[metodo] / 1000 > segundos * 1.5,
      `${metodo} tiene ${t[metodo] / 1000} s y se ha medido en ${segundos} s: el margen es thinner que el peor caso`,
    );
  }
});

test("el generico sigue siendo 120 s, que es lo que se aplica a lo demas", () => {
  // No es que el generico este mal: es que no sirve para estos dos. Si se sube el
  // generico para arreglar esto, todos los demas metodos empiezan a esperar tres
  // minutos cuando fallan, y el error tarda tres minutos en verse.
  assert.match(cliente, /const CALL_TIMEOUT_MS = 120000;/);
});

test("el timeout se usa de verdad: METHOD_TIMEOUT_MS se consulta antes del generico", () => {
  assert.match(
    cliente,
    /const timeoutMs = METHOD_TIMEOUT_MS\[method\] \|\| CALL_TIMEOUT_MS;/,
    "si la consulta cambia de orden, la tabla de timeouts deja de mandar",
  );
});

test("la razon medida queda escrita junto al timeout, no solo en un commit", () => {
  // Un numero sin motivo se 'simplifica' en seis meses. El motivo esta en el mismo
  // archivo y menciona las dos cifras medidas.
  const i = cliente.indexOf("getAppState: 420000");
  const antes = cliente.slice(Math.max(0, i - 1600), i);
  assert.match(antes, /11,3 s/, "falta el tiempo medido de getAppState");
  assert.match(antes, /197 s/, "falta el peor caso medido de getAppStateIfChanged");
  assert.match(antes, /420 s|420000/, "falta decir por que 420");
});
