// LA FRESCURA DE LA IMPORTACION, PROBADA COMO PREDICADO Y NO COMO TEXTO.
//
// QUE PASABA (MEDIDO 2026-10-05 en produccion). La condicion era
//   `currentScheduleAtMs > 0 && importedScheduleAtMs > 0 && currentScheduleAtMs > importedScheduleAtMs`
// y en el arranque el payload se pide mientras `app_state.last_schedule` es NULL, o sea
// `importedScheduleAtMs = 0`. La comparacion salia FALSA POR FALTA DE DATO, no por antiguedad, y la
// importacion de fondo se llevaba `operations`, `planStart`, `loadWeekStart`, `reportWeekStart`,
// `selectedOts` y `lockedOts` del espejo. Medido: el rescate de RULE-PLAN-015 escribia `app_state`
// (revision 1 -> 2 a las 03:15:50Z y 2 -> 3 a las 03:48:56Z, con
// `last_schedule.restoredFromSnapshot = true`) y la pantalla seguia mostrando el espejo (Gantt con
// 8 operaciones de la 2624 y la ventana `29-jun a 13-jul` = `app_state.plan_start`, no los
// `2026-09-28` del borrador).
//
// POR QUE ESTA PRUEBA NO SE QUEDA EN UN REGEX. build.test.mjs ya comprueba la FORMA de la linea. Si
// aqui se ejecutara el texto y no la regla, cambiarla a mano volveria a pasar el build sin que nadie
// midiera el cambio: por eso se saca del fuente el bloque entero tal cual se desplego y se EVALUA
// con los relojes de cada caso. Un reloj en cero significa "el servidor no trae plan"
// (RULE-PLAN-012), no "el servidor trae un plan mas viejo".
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");

/** El bloque de frescura TAL COMO ESTA en app.js, envuelto para devolver el booleano. */
function predicadoDeFrescura() {
  const bloque = app.match(/const currentScheduleAtMs = [\s\S]*?const importedIsStaleSchedule = [\s\S]*?;/);
  assert.ok(bloque, "no encontre el bloque de frescura de applyImported en app.js");
  const fuente = bloque[0];
  assert.match(fuente, /importedScheduleAtMs/, "el bloque tiene que traer los dos relojes");
  // eslint-disable-next-line no-new-func -- es justo lo que se quiere: correr la regla desplegada.
  return new Function("state", "imported", `${fuente}\nreturn importedIsStaleSchedule;`);
}

const BORRADOR = "2026-10-02T01:38:40.191Z";
const SELLO = "2026-10-02T01:38:40.192Z"; // el +1 ms del arreglo B de RULE-PLAN-015

test("el plan en memoria gana cuando el servidor NO trae reloj (el caso medido)", () => {
  const esViejo = predicadoDeFrescura();
  const conPlan = { lastSchedule: { generatedAt: SELLO } };

  assert.equal(esViejo(conPlan, { lastSchedule: null }), true);
  assert.equal(esViejo(conPlan, {}), true);
});

test("con reloj en los dos lados manda el mas nuevo, y el empate aplica el import", () => {
  const esViejo = predicadoDeFrescura();

  assert.equal(esViejo({ lastSchedule: { generatedAt: SELLO } }, { lastSchedule: { generatedAt: BORRADOR } }), true,
    "local mas nuevo (el sello de +1 ms) -> el import no pisa el plan");
  assert.equal(esViejo({ lastSchedule: { generatedAt: BORRADOR } }, { lastSchedule: { generatedAt: SELLO } }), false,
    "el servidor trae un plan mas nuevo -> entra");
  assert.equal(esViejo({ lastSchedule: { generatedAt: BORRADOR } }, { lastSchedule: { generatedAt: BORRADOR } }), false,
    "empate: el import aplica, que es lo de siempre");
});

test("sin plan en memoria el import SIEMPRE aplica: el arranque no se queda sin espejo", () => {
  const esViejo = predicadoDeFrescura();
  const sinPlan = { lastSchedule: null };

  assert.equal(esViejo(sinPlan, { lastSchedule: { generatedAt: BORRADOR } }), false);
  assert.equal(esViejo(sinPlan, { lastSchedule: null }), false);
  assert.equal(esViejo({}, {}), false);
  assert.equal(esViejo({ lastSchedule: {} }, { lastSchedule: {} }), false);
});

test("un `generatedAt` que no es fecha cuenta como CERO, no como antiguedad", () => {
  const esViejo = predicadoDeFrescura();

  // `Date.parse("")` es NaN y `NaN || 0` da 0; lo mismo con un texto de reloj corrupto. Tratarlo
  // como "no hay reloj" es lo que evita que un guardado con reloj roto pise un plan en pantalla.
  assert.equal(esViejo({ lastSchedule: { generatedAt: "no-es-fecha" } }, { lastSchedule: null }), false);
  assert.equal(esViejo({ lastSchedule: { generatedAt: SELLO } }, { lastSchedule: { generatedAt: "tampoco" } }), true);
});