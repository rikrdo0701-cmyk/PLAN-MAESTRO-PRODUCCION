// Candado del aviso por tabla. MEDIDO 2026-09-30, dos veces:
//
// 1. El aviso de "no se borro" era UNO para operations, work_orders y materials, y para
//    materials era FALSO. Decia "Una operacion que la persona haya quitado del plan NO se
//    borra", pero de materials la pagina escribe UNA columna (`emitido`) y no decide que
//    materiales tiene una OT: eso lo pone la ingesta de NetSuite.
//
// 2. Cuando se corrigio con un texto por tabla, el texto era un PARRAFA y el toast tiene
//    max-width: 360px, con lo que salia cortado a media palabra, sin final. Un aviso que no
//    cabe no se lee, y uno que no se lee es peor que no tenerlo.
//
// LAS DOS LECCIONES JUNTAS: un aviso dice QUE PASO, en una frase, y lo que la pagina controla
// en ESA tabla. El porque se queda en el codigo.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const escritor = await readFile(new URL("../src/web/shared/supabase-writer.js", import.meta.url), "utf8");

/**
 * El texto de una tabla, tal como lo devuelve queSeEscribioDe.
 *
 * MEDIDO 2026-09-30: operations NO tiene rama propia, es el return de reserva, porque es la
 * unica de las tres que de verdad son operaciones del plan. Buscar tabla === "operations" en
 * el fuente daria null, y el test fallaria por una razon que no tiene que ver con lo que
 * afirma, que es la razon por la que un test tiene que decir DE QUE FALLA.
 */
function textoDe(tabla) {
  const propio = escritor.match(new RegExp('tabla === "' + tabla + '"\\) return "([^"]*)"'));
  if (propio) return propio[1];
  const cuerpo = escritor.slice(escritor.indexOf("function queSeEscribioDe"));
  const reserva = cuerpo.match(/\r?\n\s+return "([^"]*)";/);
  return reserva ? reserva[1] : null;
}

test("cada tabla del ERP tiene SU texto, y dice que escribe la pagina", () => {
  // materials: la pagina no decide componentes. Es lo que hacia falso el texto viejo.
  assert.match(textoDe("materials") || "", /solo se marco que material se emitio/,
    "materials tiene que decir que la pagina solo marca emitido");
  assert.match(textoDe("materials") || "", /la lista es de NetSuite/,
    "y que la lista de materiales es del ERP, no de la pagina");

  // work_orders: la pagina escribe fechas y precio; el resto es del ERP.
  assert.match(textoDe("work_orders") || "", /solo fechas y precio/,
    "work_orders tiene que decir que la pagina escribe solo fechas y precio");
  assert.match(textoDe("work_orders") || "", /el resto es de NetSuite/,
    "y que el resto es del ERP");

  // operations: aqui si es cierto lo de las operaciones del plan.
  assert.match(textoDe("operations") || "", /no se borro nada/,
    "operations dice que no se borro nada");
  assert.match(textoDe("operations") || "", /la ingesta de NetSuite tambien escribe aqui/,
    "y por que: la ingesta es la segunda escritora");
});

test("ningun texto cabe truncado en un toast de 360px", () => {
  // MEDIDO 2026-09-30: el toast tiene max-width: 360px y font-size: 11px. El texto de
  // materials como parrafo salia cortado a media palabra. El limite de 110 caracteres es
  // aproximado a dos lineas de ese ancho; se mide en el texto, no en el toast, porque un
  // toast que se agranda tapa mas pantalla y el problema es el texto, no la caja.
  for (const tabla of ["materials", "work_orders", "operations"]) {
    const t = textoDe(tabla);
    assert.ok(t, "no se encontro el texto de " + tabla);
    assert.ok(t.length <= 110,
      tabla + ": su texto tiene " + t.length + " caracteres y no cabe en un toast. Se acorta el texto, no se agranda la caja.");
  }
});

test("el aviso viejo, UNO para las tres, no puede volver", () => {
  // Ese texto es el que aparecio en produccion dos veces sin que nadie entendiera de que
  // hablaba. Si vuelve como texto unico, el problema vuelve con el.
  assert.doesNotMatch(escritor, /tabla \+ " se actualizo fila por fila y NO se borro: las filas que el navegador no "/,
    "el texto unico no puede volver: describe mal lo que la pagina controla en materials");
});

test("las tres del ERP siguen sin borrarse, y eso NO cambio con el texto", () => {
  // El aviso se reescribio para que se entienda, no para aflojar nada. Cambiar la regla aqui
  // seria tirar el suelo debajo del 2026-09-30, que borro 76 filas de ot_configurations por
  // exactamente este motivo: comparar lo leido con lo que hay.
  assert.match(escritor, /const ERP_COMPARTIDA = \{ operations: true, work_orders: true, materials: true \}/,
    "las tres del ERP siguen siendo de escritura compartida: no se borran");
  assert.match(escritor, /const borrar = !ERP_COMPARTIDA\[tabla\] \|\| opts\.permitirBorradoErp === true;/,
    "y la condicion de borrado no cambio: solo con el opt-in explicito");
});
