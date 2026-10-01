// Candado del aviso por tabla. MEDIDO 2026-09-30: el aviso de "no se borro" era UNO para
// operations, work_orders y materials, y para materials era FALSO. Decia "Una operacion que la
// persona haya quitado del plan NO se borra", pero de materials la pagina escribe UNA columna
// (`emitido`) y no decide que materiales tiene una OT.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const escritor = await readFile(new URL("../src/web/shared/supabase-writer.js", import.meta.url), "utf8");

test("cada tabla del ERP dice QUE escribe la pagina, no el mismo texto para las tres", () => {
  assert.match(escritor, /function queSeEscribioDe\(tabla\)/,
    "tiene que haber un texto por tabla, no uno para todas");
  // materials: la pagina no decide componentes. Es lo que hace que el texto viejo fuera falso.
  assert.match(escritor, /tabla === "materials"[\s\S]{0,400}?solo marca si un material se emitio/,
    "materials tiene que decir que la pagina solo marca emitido");
  assert.match(escritor, /tabla === "materials"[\s\S]{0,400}?no decide cuales son/,
    "y que no decide cuales son: eso es lo del ERP");
  // work_orders: la pagina escribe fechas y precio; el resto es del ERP.
  assert.match(escritor, /tabla === "work_orders"[\s\S]{0,400}?fechas y el precio/,
    "work_orders tiene que decir que la pagina escribe fechas y precio");
  // operations: aqui si aplica lo de las operaciones del plan.
  assert.match(escritor, /Una operacion que la persona haya quitado del plan NO se borra/,
    "operations conserva lo de las operaciones, que si es cierto ahi");
});

test("el aviso viejo, UNO para las tres, no puede volver", () => {
  // Ese texto es el que se mostro en produccion y no describia lo que hace la pagina con
  // materials. Si vuelve como texto unico, el problema vuelve con el.
  assert.doesNotMatch(escritor, /tabla \+ " se actualizo fila por fila y NO se borro: las filas que el navegador no "/,
    "el texto unico no puede volver: describe mal lo que la pagina controla en materials");
});

test("las tres del ERP siguen sin borrarse, y eso no cambio con el texto", () => {
  // El aviso se reescribio, no la regla. Cambiar la regla aqui seria tirar el suelo debajo
  // del 2026-09-30, que borro 76 filas de ot_configurations por exactamente esto.
  assert.match(escritor, /const ERP_COMPARTIDA = \{ operations: true, work_orders: true, materials: true \}/,
    "las tres del ERP siguen siendo de escritura compartida: no se borran");
  assert.match(escritor, /const borrar = !ERP_COMPARTIDA\[tabla\] \|\| opts\.permitirBorradoErp === true;/,
    "y la condicion de borrado no cambio: solo con el opt-in explicito");
});
