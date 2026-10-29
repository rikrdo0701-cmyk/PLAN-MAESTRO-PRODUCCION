// ESTE ARCHIVO YA NO CONFIGURA NADA: fija que el puente de Apps Script NO VUELVA A TENER
// relojes, y conserva las mediciones que justificaron quitarlos.
//
// QUE PASABA, y por que este archivo existia. MEDIDO 2026-09-29 abriendo la pagina de verdad
// en un navegador: getAppState AGOTABA el tiempo generico (CALL_TIMEOUT_MS = 120 s). Cuando
// eso pasa, la app hacia lo que el codigo decia: se quedaba con el cache local, avisaba por
// consola y seguia. En un navegador recien abierto el cache esta vacio, asi que la pagina
// aparecia SIN operaciones, SIN OTs y SIN catalogo. MEDIDO: 0 de cada uno. Y no era una vez:
// con el techo quitado, en la misma corrida, getAppState tardaba 11,3 s y getAppStateIfChanged
// 197 s, o sea 3 minutos 17 segundos. Con eso, 120 s no era un margen corto: era MENOS que el
// peor caso observado, y cortarlo no era prudencia sino descartar la respuesta.
//
// QUE HACE ESTE TEST AHORA. La version anterior de este archivo FIJABA que los metodos
// medidos lentos tuvieran entrada propia en METHOD_TIMEOUT_MS y que esa entrada fuera mayor
// que el peor caso medido. Eso era lo correcto mientras el puente existia. Con el puente
// deshabilitado (RULE-SUP-030) la entrada no tiene que existir: no hay llamada que cronometrar.
// Asi que el test afirma la AUSENCIA, que es la un forma honesta de fijar "esto no se
// reintroduce": si alguien vuelve a meter presupuestos por metodo del puente, es porque
// volvio el iframe, y este test lo dice.
//
// Y las cifras no se pierden. Un numero medido que solo vive en un commit se pierde con el
// commit. Por eso hay un test que exige que 11,3 s, 197 s y las 74 llamadas por carga sigan
// escritos EN EL ARCHIVO, junto a la puerta que las sustituyo.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const cliente = await readFile(new URL("../src/web/shared/apps-script-bridge-client.js", import.meta.url), "utf8");

/** El cliente sin comentarios: lo que se afirma es CODIGO, no prosa. */
function codigo() {
  return cliente.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
}

test("el puente no tiene ningun reloj: no hay llamada que cronometrar", () => {
  const c = codigo();
  assert.doesNotMatch(c, /METHOD_TIMEOUT_MS/, "el puente no declara presupuestos por metodo");
  assert.doesNotMatch(c, /CALL_TIMEOUT_MS|READY_TIMEOUT_MS/, "el puente no declara presupuesto generico");
  assert.doesNotMatch(c, /setTimeout|clearTimeout/, "el puente no programa temporizadores");
});

test("el puente no monta nada: sin iframe no hay a quien preguntar ni cuando", () => {
  const c = codigo();
  assert.doesNotMatch(c, /createElement\(\s*["']iframe["']/, "el puente no crea iframes");
  assert.doesNotMatch(c, /postMessage/, "el puente no habla por postMessage");
  assert.doesNotMatch(c, /addEventListener\(\s*["']message["']/, "el puente no escucha respuestas");
  assert.doesNotMatch(c, /exec\?app=bridge|app["'],\s*["']bridge/, "el puente no navega al web app");
});

test("las dos puertas rechazan, y dicen cual es el motivo", () => {
  const c = codigo();
  assert.match(c, /El puente de Apps Script esta deshabilitado/, "el motivo tiene que quedar escrito");
  // Las dos, no una: `call` es la que usaba la app y `ensureReady` la que montaba el iframe.
  // Dejar pasar la segunda es como volvio la dependencia en 2026-09-30.
  const rechazos = (c.match(/Promise\.reject\(/g) || []).length;
  assert.ok(rechazos >= 3, `se esperaban tres rechazos (call, ensureReady, callAppsScript) y hay ${rechazos}`);
  assert.match(c, /isAppsScriptRuntime\s*=\s*function\s*\(\)\s*\{\s*return false/, "el runtime de Apps Script se niega");
});

test("las mediciones que justificaron quitarlo siguen escritas en el archivo", () => {
  // Sin esto, el comentario con los numeros se va a "simplificar" en seis meses y nadie
  // vuelve a saber por que el puente no debe volver. Se exige el numero, no la frase.
  assert.match(cliente, /11,3 s/, "falta el tiempo medido de getAppState");
  assert.match(cliente, /197 s/, "falta el peor caso medido de getAppStateIfChanged");
  assert.match(cliente, /74 llamadas al puente en una sola carga/, "falta el conteo de llamadas por carga");
  assert.match(cliente, /239 ms en Supabase/, "falta la cifra que lo quita de raiz: leer de Supabase");
});
