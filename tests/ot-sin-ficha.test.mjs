import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// =============================================================================
// QUE SE VEA
// =============================================================================

const app = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");

// `app.js` no se puede cargar en una prueba (es un archivo de pagina con DOM de arranque), asi
// que la convencion del repo es leer el fuente. EXCEPTO la funcion de la razon, que si se puede
// ejecutar sola, y esa parte se ejecuta de verdad: un texto que dice lo correcto no es lo mismo
// que un texto que sale de la regla.

/** Saca `jobNoProgramablePor_` del fuente y la devuelve como funcionecutable. */
function razon() {
  const desde = app.indexOf("function jobNoProgramablePor_(job) {");
  assert.ok(desde !== -1, "app.js tiene que tener jobNoProgramablePor_");
  const hasta = app.indexOf("\n}", desde);
  assert.ok(hasta > desde, "y se tiene que poder cortar hasta su llave de cierre");
  // eslint-disable-next-line no-new-func
  return new Function(app.slice(desde, hasta + 2) + "\nreturn jobNoProgramablePor_;")();
}

test("la razon de una OT sin ficha dice la AUSENCIA, no el estatus", () => {
  // MEDIDO 2026-10-05 con la sonda: la OT 3092 tiene operaciones y NO tiene fila en
  // `work_orders`. Salia en el backlog con el boton `+` ACTIVO y el title "No disponible por
  // estatus En curso". El estatus era correcto y la razon estaba completa fuera: lo que le
  // faltaba era la ficha, o sea el articulo, la fecha y la cantidad.
  const por = razon();
  const texto = por({ sinFicha: true, movable: false, status: "En curso" });
  assert.match(texto, /no tiene ficha de la OT en NetSuite/, "nombra la falta de ficha");
  assert.doesNotMatch(texto, /estatus/, "y NO culpa al estatus, que no es la causa");
});

test("una OT sin ficha dice POR QUE en terminos que dejan ver que faltan los datos", () => {
  // "No disponible" solo no sirve: la persona tiene que saber que la accion es esperar a la
  // ingesta, no cambiar el estatus de la OT.
  const texto = razon()({ sinFicha: true, movable: false, status: "En curso" });
  for (const dato of ["articulo", "fecha", "cantidad"]) {
    assert.ok(texto.indexOf(dato) !== -1, "menciona " + dato + ": " + texto);
  }
  assert.match(texto, /work_orders/, "y dice de donde sale la ficha: " + texto);
});

test("una OT programable no tiene razon, y una bloqueada por estatus sigue diciendo el estatus", () => {
  const por = razon();
  assert.equal(por({ sinFicha: false, movable: true, status: "En curso" }), "",
    "una OT que se puede agregar no necesita motivo");
  const porEstatus = por({ sinFicha: false, movable: false, status: "Cerrada" });
  assert.match(porEstatus, /por estatus Cerrada/, "el otro motivo no cambio: " + porEstatus);
});

// =============================================================================
// QUE SE PUEDA AGREGAR
// =============================================================================

test("sin ficha, `movable` es falso aunque el estatus sea programable", () => {
  // El boton `+` se pinta con `disabled` cuando `job.movable` es falso (app.js:2653) y el drag
  // tambien (2647). Si `movable` no mirara la ficha, la tarjeta ofreceria una accion que su
  // propio resultado revoca: el camino de "Generar plan" saca del plan las OTs sin ficha
  // (app.js:6057-6077) y avisa "ya no esta en NetSuite".
  assert.match(
    app,
    /movable: Boolean\(workOrder\) && isMovablePlanningStatus\(jobStatusParaTarjeta\(job\.ot\)\)/,
    "`movable` exige ficha Y estatus programable (la ficha manda cuando existe y esta abierta)"
  );
  assert.match(app, /sinFicha: !workOrder,/, "y la tarjeta lleva el dato para poder explicar el motivo");
});

test("las tres palabras del boton salen de UNA funcion", () => {
  // MEDIDO: habia tres textos para un mismo hecho, y ninguno era el hecho. El `title` del boton
  // decia una cosa, el toast de performSelectJob otra, y el camino de la OT individual una
  // tercera. Tres textos que pueden divergir son tres reglas, y solo una es la regla.
  // La cuenta es de LLAMADAS, no de apariciones: la definicion tambien trae `(job)` y si se
  // contara sin excluirla, el numero seria uno mas y la prueba valdria para cualquier cantidad.
  const llamadas = (app.match(/(?<!function )jobNoProgramablePor_\(job\)/g) || []).length;
  assert.equal(llamadas, 3,
    "el helper se llama en los tres lugares (el boton del backlog, el toast y el camino individual)");
  assert.match(app, /function jobNoProgramablePor_\(job\) \{/, "y existe una sola definicion");

  // Estas dos afirmaciones son sobre CODIGO, no sobre prosa: el comentario de la funcion nueva
  // CITA el texto viejo para explicar por que existia, asi que buscarlo en el archivo entero
  // daria positivo aunque el texto no estuviera en ninguna parte viva.
  const codigo = app.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  assert.doesNotMatch(codigo, /No disponible por estatus/, "el texto viejo sale del codigo");
  assert.doesNotMatch(codigo, /no puede agregarse al plan por estatus/, "y el toast viejo tambien");
  assert.match(app, /no puede agregarse al plan por estatus/, "el texto viejo se CONSERVA en el comentario: la razon queda escrita");
});

test("la tarjeta sin ficha NO dice 'SIN ARTICULO': esa etiqueta confunde 'cerrada' con 'perdida'", () => {
  // `work_orders` vacia es lo que produjo el vaciado de RULE-SUP-048, y ahi todas las tarjetas
  // decian "SIN ARTICULO", que parece un dato de NetSuite y es una falta del espejo. "SIN FICHA"
  // dice la verdad: no hay ficha.
  const etiquetas = app.match(/job\.sinFicha \? "SIN FICHA" : job\.parte \|\| "SIN ARTICULO"/g) || [];
  assert.equal(etiquetas.length, 2, "las dos tarjetas que muestran el articulo (backlog y cola)");
});
