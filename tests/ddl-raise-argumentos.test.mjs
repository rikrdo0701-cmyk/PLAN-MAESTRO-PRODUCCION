import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * NINGUN RAISE TIENE MAS MARCADORES % QUE ARGUMENTOS.
 *
 * ERROR REAL DEL USUARIO, 2026-09-29, la cuarta vez que Postgres rechazaba este DDL:
 *   ERROR: too few parameters specified for RAISE
 * La linea era un `raise exception` con el comodin de LIKE escrito tal cual:
 *   'operation_events: hay % indices con nombre operation_events% y tienen que ser 4'
 * Dos marcadores y un argumento, porque plpgsql trata TODO % del mensaje como marcador
 * y para un % literal hay que escribir %%.
 *
 * La leccion de fondo es la de siempre y ya va cuatro veces: un DDL puede estar
 * estructuralmente perfecto, con los bloques $$ cuadrados, los % bien colocados y las
 * funciones con RETURNS, y Postgres lo rechaza igual. Lo que ninguno de esas
 * comprobaciones mira es si los ARGUMENTOS cuadran con el mensaje, y eso es tan
 * mecanico como lo otro.
 *
 * EL DETECTOR TAMBIEN SE PRUEBA A SI MISMO, en las dos direcciones, y eso no es
 * adorno. La primera version de este detector decia 6 RAISE descuadrados y UNO era
 * real: los otros cinco eran falsos positivos, por contar el `;` final como argumento
 * y por partir las comas de `coalesce(a, 'null')` como si fueran dos. Un detector que
 * llora lobo entrena a ignorarlo, y ese es el modo de fallo mas caro de una red: no
 * que falle, sino que aparezca gritando cosas que no son. Por eso hay casos que TIENEN
 * que salir bien, y si el detector se queja de uno de ellos, el test falla.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Cuenta los marcadores de un mensaje. %% es un % literal y no cuenta. */
function marcadores(mensaje) {
  return (mensaje.replace(/%%/g, "").match(/%/g) || []).length;
}

/** Parte los argumentos por comas de primer nivel, sin el `;` final. */
function argumentos(trozo) {
  let s = trozo.split(/,\s*using\b/i)[0].replace(/;\s*$/, "");
  const partes = [];
  let prof = 0;
  let dentro = false;
  let actual = "";
  for (const c of s) {
    if (c === "'") dentro = !dentro;
    if (!dentro) {
      if (c === "(") prof++;
      else if (c === ")") prof--;
      else if (c === "," && prof === 0) {
        partes.push(actual);
        actual = "";
        continue;
      }
    }
    actual += c;
  }
  if (actual.trim()) partes.push(actual);
  return partes.map((x) => x.trim()).filter((x) => x.length > 0);
}

function imbalanceComillas(s) {
  let dentro = false;
  for (const c of s) {
    if (c === "'") dentro = !dentro;
  }
  return dentro;
}

/** Devuelve los RAISE descuadrados de un DDL. */
function revisarRaise(ddl) {
  const lineas = ddl.split(/\r?\n/);
  const problemas = [];
  let total = 0;
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (linea.trim().startsWith("--")) continue;
    if (!/\braise\b/i.test(linea)) continue;
    let trozo = linea;
    let j = i;
    while (imbalanceComillas(trozo) && j + 1 < lineas.length) {
      j++;
      trozo += " " + lineas[j].trim();
    }
    const comillas = [...trozo.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    if (!comillas.length) {
      i = j;
      continue;
    }
    const mensaje = comillas[0];
    const m = marcadores(mensaje);
    const desde = trozo.indexOf("'") + mensaje.length + 2;
    const a = argumentos(trozo.slice(desde));
    total++;
    if (m !== a.length) problemas.push({ linea: i + 1, marcadores: m, argumentos: a.length, texto: trozo.trim().slice(0, 130) });
    i = j;
  }
  return { total, problemas };
}

const DDLS = [
  ["docs/schema-supabase-plan.sql", "la del plan"],
  ["docs/schema-supabase-login-correo.sql", "la del login"],
];

for (const [rel, nombre] of DDLS) {
  test(nombre + ": ningun RAISE tiene mas marcadores % que argumentos", async () => {
    const ddl = await fs.promises.readFile(path.join(RAIZ, rel), "utf8");
    const r = revisarRaise(ddl);
    // Umbral 1 y no mas: lo que importa es que el archivo tenga RAISE que revisar y que
    assert.ok(r.total >= 1, "no hay ningun RAISE que revisar: el archivo cambio de forma importante");
    // ninguno este descuadrado. Se puso 5 al principio porque el DDL del plan tiene 20 y
    // eso hace creer que el del login deberia llegar, y el del login tiene 2. Un minimo
    // arbitrado mas alto que la realidad hace que el test falle por un numero, que es
    // como un test deja de informar.
    assert.deepEqual(
      r.problemas.map((p) => p.linea + ": " + p.texto),
      [],
      "estos RAISE estan descuadrados y Postgres los rechaza con too few parameters specified for RAISE"
    );
  });
}

test("el detector NO marca los RAISE que estan bien, incluidos los que lo confundian", () => {
  // Los cinco falsos positivos de la primera version, uno por uno. Si alguno vuelve a
  // marcarse, el detector es inutil sobre este DDL y hay que arreglarlo antes que
  // confiar en el.
  const buenos = [
    "raise exception 'texto sin marcadores';",
    "raise exception 'no se creo operation_events';",
    "raise exception 'plan_guardar no existe';",
    "raise exception 'plan_guardar tiene EXECUTE para anon';",
    "raise exception 'hay % de 4', n;",
    "raise exception 'no es un array, no %', coalesce(jsonb_typeof(p_filas), 'null');",
    "raise exception 'la tabla % no tiene las columnas %', v_tabla, v_queried;",
    "raise exception 'un %% literal y un % real', n;",
    "  raise exception 'multi',\n    linea;",
  ];
  const falsos = [];
  for (const b of buenos) {
    const r = revisarRaise(b);
    if (r.problemas.length) falsos.push(b.replace(/\n/g, " ") + "  ->  " + JSON.stringify(r.problemas[0]));
  }
  assert.deepEqual(falsos, [], "el detector se queja de RAISE que estan correctos, y con eso deja de avisar de los que no lo estan");
});

test("el detector SI marca el RAISE roto de verdad, con el %% ya puesto", () => {
  // El caso real, con la forma ya corregida, para comprobar que el detector lo pilla
  // si alguien vuelve a quitar el %% del comodin.
  const roto = "raise exception 'hay % indices con nombre operation_events% y tienen que ser 4', n;";
  const r = revisarRaise(roto);
  assert.equal(r.problemas.length, 1, "tiene que marcar exactamente uno");
  assert.equal(r.problemas[0].marcadores, 2);
  assert.equal(r.problemas[0].argumentos, 1);

  // Y el mismo con el %% puesto, tiene que salir limpio.
  const bueno = "raise exception 'hay % indices con nombre operation_events%% y tienen que ser 4', n;";
  assert.equal(revisarRaise(bueno).problemas.length, 0);
});
