// Un cambio hecho con la pagina todavia cargandose no puede perderse.
//
// MEDIDO 2026-09-29. El usuario anadio una maquina en la pestana de catalogos y
// aviso de que "GitHub se tardo en cargar la informacion". El guardado NO llego
// nunca a Apps Script: getAppRevision seguia en 4142 con savedAt 15:30, igual que
// antes, y los 11 catalogos de Supabase seguian con la fecha del 2026-09-28.
// Tres defectos en la misma cadena:
//
//  1. queueAppSheetSave se devolvia con `if (!appSheetAvailable) return;` ANTES de
//     llamar a appSheetMarkDirtyScope. Con el puente sin conectar, el ambito
//     nunca se marcaba: el cambio no se guardaba, no se avisaba y no quedaba en
//     cola. Perdido entero.
//
//  2. Al terminar un guardado, el `finally` reencolaba con queueAppSheetSave() sin
//     ambito. Su valor por omision es "plan", que se mete en appSheetDirtyScopes.
//     Si lo pendiente era "catalogs", el conjunto quedaba {catalogs, plan} y
//     appSheetSaveMethodForScopes caia en saveAppState en vez de saveCatalogState.
//     Y saveAppState -> PP_writeState_ no escribe las hojas de catalogo ni dispara
//     el espejo: el cambio se guardaba a medias sin decir nada.
//
//  3. No habia nada que volcara lo pendiente cuando el puente quedaba disponible.
//
// Estos tests SACAN las funciones del cuerpo de app.js y las corren en un vm con
// dobles, como hace tests/article-price-separation.test.mjs. Reimplementarlas
// probaria el test, no el codigo.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const app = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");

/** Saca un bloque de app.js desde `desde` hasta la siguiente function de primer nivel. */
function bloque(desde, hasta) {
  const i = app.indexOf(desde);
  assert.ok(i > 0, `no se encontro ${desde}`);
  const f = app.indexOf(hasta, i);
  assert.ok(f > i, `no se encontro el final de ${desde}`);
  return app.slice(i, f);
}

const FUENTES = [
  bloque("function queueAppSheetSave(", "/**"),
  bloque("function appSheetMarkDirtyScope(", "function appSheetConsumeDirtyScopes"),
  bloque("function appSheetFlushPendingScopes(", "function appSheetConsumeDirtyScopes"),
  bloque("function appSheetConsumeDirtyScopes(", "function appSheetSaveMethodForScopes"),
  bloque("function appSheetSaveMethodForScopes(", "function purgeClosedWorkOrderRetention"),
].join("\n");

/** Monta el contexto con el estado que describe el escenario. */
function escenario({ disponible = false, enVuelo = false, sucias = [] } = {}) {
  const guardados = [];
  const temporizadores = [];
  const ctx = {
    appSheetAvailable: disponible,
    appSheetSaveInFlight: enVuelo,
    appSheetSavePending: false,
    appSheetSaveTimer: null,
    operationStatusSavesInFlight: false,
    appSheetDirtyScopes: new Set(sucias),
    window: {
      clearTimeout: (t) => temporizadores.push(["clear", t]),
      setTimeout: (fn, ms) => {
        temporizadores.push(["set", ms, fn]);
        return temporizadores.length;
      },
    },
    saveAppSheet: () => guardados.push("saveAppSheet"),
    queueAppSheetSave: undefined, // la fuente lo define
    Set, String, Object, Array, JSON, Math, Date, Number, Boolean,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(FUENTES, ctx);
  return { ctx, guardados, temporizadores };
}

test("un cambio con el puente sin conectar NO se pierde: queda marcado", () => {
  const { ctx } = escenario({ disponible: false });
  ctx.queueAppSheetSave("catalogs");
  assert.ok(
    ctx.appSheetDirtyScopes.has("catalogs"),
    "el ambito tiene que quedar marcado aunque el puente no este listo: es lo unico que sobrevive"
  );
});

test("un cambio con el puente sin conectar NO programa guardado todavia", () => {
  const { ctx, guardados } = escenario({ disponible: false });
  ctx.queueAppSheetSave("catalogs");
  assert.deepEqual([...guardados], [], "no se puede guardar sin puente, y no se debe intentar");
});

test("al quedar disponible el puente, lo pendiente se guarda con SU ambito", () => {
  const { ctx, guardados } = escenario({ disponible: false });
  ctx.queueAppSheetSave("catalogs"); // se pierde si no queda marcado
  ctx.appSheetAvailable = true;
  const programo = ctx.appSheetFlushPendingScopes();
  assert.equal(programo, true, "deberia programar el guardado de lo pendiente");
  const temporizadores = ctx.window.setTimeout.mock;
  assert.ok(ctx.appSheetSaveTimer !== null, "dejo un temporizador pendiente");
  // Y lo que se guarda es lo pendiente, con el metodo que corresponde a "catalogs".
  // El array lo crea la funcion DENTRO del vm, o sea en otro realm: con
  // assert/strict, deepEqual compara prototipos y dos Arrays de realms distintos no
  // son iguales aunque tengan lo mismo. Se copia al realm del test con spread.
  const ambitos = [...ctx.appSheetConsumeDirtyScopes()];
  assert.deepEqual(ambitos, ["catalogs"]);
  assert.equal(ctx.appSheetSaveMethodForScopes(ambitos), "saveCatalogState");
  assert.deepEqual([...guardados], [], "el setTimeout aun no se ha ejecutado");
});

test("el metodo se elige por el ambito: catalogs no cae en saveAppState", () => {
  // Este es el defecto 2. Con "plan" metido por el reencolado del finally, el
  // conjunto es {catalogs, plan} y el metodo se va a saveAppState, que no escribe
  // las hojas de catalogo ni dispara el espejo.
  const { ctx } = escenario({ disponible: true });
  ctx.appSheetDirtyScopes.add("catalogs");
  ctx.appSheetDirtyScopes.add("plan");
  assert.equal(ctx.appSheetSaveMethodForScopes([...ctx.appSheetDirtyScopes]), "saveAppState");
  // Y el veto: sin "plan" de por omision, el ambito llega solo.
  const limpio = escenario({ disponible: true });
  limpio.ctx.appSheetDirtyScopes.add("catalogs");
  assert.equal(limpio.ctx.appSheetSaveMethodForScopes(["catalogs"]), "saveCatalogState");
});

test("el finally NO mete 'plan' de por omision al reencolar", () => {
  // Estructural a proposito: el comportamiento esta en el finally de saveAppSheet,
  // que hace await de red y no cabe en este arnes. Lo que se fija es que la
  // llamada SIN ambito, que es la que mete "plan" en appSheetDirtyScopes, solo
  // aparezca en la rama de "no hay nada marcado".
  //
  // El recorte va desde la firma de saveAppSheet hasta la siguiente function de
  // primer nivel. Buscar el if suelto por todo el archivo no sirve: hay mas de una
  // ocurrencia de "if (appSheetSavePending) {" y el test se comia el bloque
  // equivocado, con lo que pasaba por una razon distinta a la que creia.
  const i = app.indexOf("async function saveAppSheet");
  assert.ok(i > 0, "no se encontro saveAppSheet");
  const f = app.indexOf("\nfunction appSheetMarkDirtyScope", i);
  assert.ok(f > i, "no se encontro el final de saveAppSheet");
  const cuerpo = app.slice(i, f);

  const sinAmbito = cuerpo.match(/queueAppSheetSave\(\);/g) || [];
  assert.equal(sinAmbito.length, 1, "una sola llamada sin ambito, y tiene que estar en la rama de 'no hay nada marcado'");
  assert.match(
    cuerpo,
    /if \(appSheetDirtyScopes\.size\) \{[\s\S]*?saveAppSheet\(false\);[\s\S]*?\} else \{\s*queueAppSheetSave\(\);/,
    "con ambitos marcados hay que reprogramar el temporizador, no reencolar con 'plan': reencolar con 'plan' mete \"plan\" en el conjunto y appSheetSaveMethodForScopes cae en saveAppState, que no escribe las hojas de catalogo ni dispara el espejo"
  );
});

test("volcar sin nada pendiente no programa un guardado de la nada", () => {
  // Sin este if, cada carga de pagina escribiria el plan entero para solo subir la
  // revision, sin que nadie haya tocado nada.
  const { ctx } = escenario({ disponible: true, sucias: [] });
  assert.equal(ctx.appSheetFlushPendingScopes(), false);
  assert.equal(ctx.appSheetSaveTimer, null, "no debe quedar temporizador");
});

test("volcar con un guardado en curso no pisa el que ya esta corriendo", () => {
  const { ctx } = escenario({ disponible: true, enVuelo: true, sucias: ["catalogs"] });
  assert.equal(ctx.appSheetFlushPendingScopes(), false);
  assert.deepEqual([...ctx.appSheetDirtyScopes], ["catalogs"], "las marcas se conservan: las consume el guardado en curso");
});

test("los ambitos 'local' y 'ui' no se guardan en el servidor", () => {
  const { ctx } = escenario({ disponible: true });
  ctx.queueAppSheetSave("local");
  ctx.queueAppSheetSave("ui");
  assert.equal(ctx.appSheetDirtyScopes.size, 0, "estos ambitos son solo de la interfaz");
});
