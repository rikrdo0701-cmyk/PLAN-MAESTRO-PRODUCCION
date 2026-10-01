// Candado del mensaje de la OT fantasma. MEDIDO 2026-09-30: la OT 3331 estaba en selected_ots
// sin estar en work_orders ni en operations, y el mensaje pedia "Reintenta", que no podia
// funcionar nunca porque la OT ya no existia en NetSuite.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");

test("el mensaje separa la OT que NO EXISTE de la que no tiene operaciones", () => {
  // Son dos acciones distintas y el mensaje las mezclaba en una sola frase que ademas pedia
  // reintentar las dos. Reintentar una OT que el ERP no tiene no puede funcionar.
  assert.match(app, /const noExisten = \[\]/, "tiene que haber un grupo para las que no existen");
  assert.match(app, /const sinOperaciones = \[\]/, "y otro para las que no tienen operaciones");
  assert.match(app, /if \(!conFicha\.has\(key\)\) noExisten\.push/, "la decia mirando si la OT tiene ficha");
  // Y cada grupo dice lo suyo.
  assert.match(app, /ya no esta en NetSuite y se quito del plan/,
    "la que no existe dice que no esta y que se quito, no que se reintente");
  assert.match(app, /falta sincronizar operaciones de OT .* \(reintenta\)/,
    "la que no tiene operaciones si puede reintentarse, y el mensaje lo dice");
});

test("ya no hay un 'Reintenta' que se aplique a las dos", () => {
  // El fallo original, literal: un unico mensaje con un unico Reintenta para los dos casos.
  assert.doesNotMatch(app, /falta sincronizar operaciones de OT \$\{missingApt\.join[\s\S]{0,40}Reintenta\./,
    "el mensaje viejo, que pide reintentar tambien la OT que no existe, no puede seguir ahi");
});

test("una OT que el ERP no tiene SE QUITA del plan, no solo se avisa", () => {
  // MEDIDO: mientras 3331 siguiera en selected_ots, el plan no se podia generar nunca, porque
  // generatePlan la veia, pedia sus operaciones y no las encontraba. Avisar sin quitar deja el
  // plan bloqueado, y avisar sin quitar es lo que hacia el toast anterior.
  assert.match(app, /state\.selectedOts = siguen/, "tiene que quitar la OT del plan de verdad");
  assert.match(app, /queueAppSheetSave\("plan"\)/, "y guardar el cambio, para que no vuelva en la recarga");
  // Y el filtro tiene que quedarse con las demas, no vaciar el plan.
  assert.match(app, /filter\(function \(ot\) \{ return noExisten\.indexOf\(normalizeStatus\(ot\)\) < 0; \}\)/,
    "el filtro tiene que conservar el resto del plan y quitar solo las que no existen");
});

test("el aviso nombra la OT en los dos casos", () => {
  // El mensaje anterior recortaba la lista a lo que cupiera en el toast, y con muchas OTs se
  // perdia justo el nombre de la que hay que arreglar. Ademas la OT no aparecia en la lista
  // de Planeado / No planeado, porque esa lista exige ficha: el mensaje nominaba algo que la
  // persona no podia ver.
  assert.match(app, /noExisten\.join\(", "\)/, "el aviso tiene que decir QUE OT es la que no existe");
  assert.match(app, /sinOperaciones\.join\(", "\)/, "y cual es la que solo falta sincronizar");
});
