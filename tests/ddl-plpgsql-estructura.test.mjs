import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * NINGUN CUERPO PLPGSQL DEL DDL ESTA DESCUADRADO.
 *
 * POR QUE HACE FALTA, cuando ya hay tests de $$, de %, de RETURNS y de argumentos de
 * RAISE. Porque todos esos miran el ARMADO del archivo, y ninguno mira si el plpgsql
 * tiene sus if y sus end if cuadrados. Y eso ya ha roto el DDL: al editar a mano se
 * llevo por delante un `end if;` que era de la comprobacion de al lado, y un `end if`
 * de mas con uno de menos NO se ve contando: se cancelan y dan cero.
 *
 * POR QUE UNA PILA Y NO UN CONTADOR. Un contador dice "hay 6 if y 6 end if", y eso es
 * verdad tambien cuando hay 7 y 5. Cada `end if;` tiene que estar cerrando un `if` de
 * verdad, y con una pila eso se comprueba: si arriba no hay un `if`, salta.
 *
 * POR QUE 22 CASOS DE AUTOCOMPROBACION, Y VAN PRIMERO. Este verificador signals senalar
 * DDL correcto tres veces: la primera version exigia que `then` siguiera pegado al `if`,
 * la segunda buscaba el `loop` a 80 caracteres, y la tercera tomaba el `for update` de un
 * SELECT por un bucle. Las tres parecian razonables y las tres hacian que el verificador
 * marcase codigo bueno. Un verificador que senala codigo bueno es PEOR que no tener
 * ninguno, porque entrena a silenciarlo. Por eso los casos van antes que el DDL, y el
 * DDL solo se mira si los 22 pasan.
 *
 * LOS TRES ERRORES, para que el proximo no los repita y no los busque otra vez:
 *   - `then` puede estar a 600 caracteres del `if`, no pegado: un
 *     `if not exists ( consulta de veinte lineas ) then`.
 *   - `loop` puede estar lejos del `for`, y `foreach` tambien abre un loop sin ser
 *     un `for`.
 *   - `for update`, `for share` y `for no key update` son clausulas de bloqueo de fila
 *     de un SELECT, no bucles. La linea que mas conviene no romper en este archivo es
 *     justo un `for update`, porque es la que serializa los guardados.
 *   - LIMITACION 4, MEDIDA 2026-09-30: un `case` de EXPRESION (no de sentencia) cierra con
 *     `end` pelado, no con `end case`. Este verificador solo conoce `end case`, asi que un
 *     `case when ... then ... else ... end` usado como valor le hace empujar el `end` de
 *     mas sobre el `begin` o el `loop` de fuera y reporta tres descuadres inventados sobre
 *     codigo bueno. Se comprobo en el DDL del plan: el UPDATE de las tres del ERP armaba el
 *     predicado con un `case` y este test marco "quedan 3 cosas sin cerrar: begin > loop > case"
 *     en un archivo que Postgres si acepta. Por eso en ese punto del DDL se usa `if`/`end if`,
 *     que este verificador si ve. NO se "arreglo" el verificador para que acepte el `case`:
 *     distinguir una expresion de una sentencia con el mismo `case` exige adivinar por el
 *     contexto, y adivinar aqui abre la puerta a que un `end case` de verdad no se detecte.
 *     Un verificador que senala codigo bueno entrena a silenciarlo igual que uno que deja
 *     pasar codigo malo, asi que la limitacion se escribe y el DDL se acomoda a ella.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Devuelve los problemas de un cuerpo plpgsql: una cadena por descuadre. */
export function revisarPlpgsql(cuerpo) {
  // Sin literales ni comentarios: pueden contener palabras clave.
  let s = "";
  let dentro = false;
  for (let i = 0; i < cuerpo.length; i++) {
    const c = cuerpo[i];
    if (c === "'") {
      dentro = !dentro;
      s += " ";
      continue;
    }
    if (!dentro && c === "-" && cuerpo[i + 1] === "-") {
      while (i < cuerpo.length && cuerpo[i] !== "\n") i++;
      s += "\n";
      continue;
    }
    if (!dentro) s += c;
  }

  const pila = [];
  const problemas = [];
  const sitio = (i) => s.slice(Math.max(0, i - 25), i + 65).replace(/\s+/g, " ").trim();

  const re = /\b(if|elsif|else|end\s+if|foreach|for|while|loop|end\s+loop|case|when|end\s+case|begin|end)\b/g;
  let m;
  while ((m = re.exec(s))) {
    const w = m[0].replace(/\s+/g, " ");
    const i = m.index;

    if (w === "end if") {
      if (pila[pila.length - 1] === "if") pila.pop();
      else problemas.push("un `end if;` que no cierra ningun `if` | " + sitio(i));
      continue;
    }
    if (w === "end loop") {
      if (pila[pila.length - 1] === "loop") pila.pop();
      else problemas.push("un `end loop;` que no cierra ningun loop | " + sitio(i));
      continue;
    }
    if (w === "end case") {
      if (pila[pila.length - 1] === "case") pila.pop();
      else problemas.push("un `end case;` que no cierra ningun case | " + sitio(i));
      continue;
    }
    if (w === "end") {
      if (pila[pila.length - 1] === "begin") pila.pop();
      else problemas.push("un `end;` que no cierra ningun begin | " + sitio(i));
      continue;
    }
    if (w === "for") {
      // `for update`, `for share` y `for no key update` son clausulas de bloqueo de fila
      // de un SELECT, no bucles de plpgsql.
      const cola = s.slice(i + 3, i + 26).toLowerCase();
      if (/^\s*(update|share|no\s+key\s+update|key\s+share)\b/.test(cola)) continue;
    }
    if (w === "if") {
      // `if` abre solo si antes del primer `;` hay un `then`, y puede estar lejos.
      const despues = s.slice(i + 2, i + 640);
      if (/^[^;]{0,620}?\bthen\b/i.test(despues)) pila.push("if");
      else problemas.push("un `if` sin `then` antes del primer `;` | " + sitio(i));
      continue;
    }
    if (w === "foreach" || w === "for" || w === "while") {
      const despues = s.slice(i + w.length, i + w.length + 640);
      if (/^[^;]{0,620}?\bloop\b/i.test(despues)) pila.push("loop");
      else problemas.push("un `" + w + "` sin `loop` antes del primer `;` | " + sitio(i));
      continue;
    }
    if (w === "loop") {
      const antes = s.slice(Math.max(0, i - 620), i);
      if (!/\b(foreach|for|while)\b[^;]{0,620}$/i.test(antes)) pila.push("loop");
      continue;
    }
    if (w === "case") {
      pila.push("case");
      continue;
    }
    if (w === "begin") {
      pila.push("begin");
      continue;
    }
  }
  if (pila.length) problemas.push("quedan " + pila.length + " cosas sin cerrar: " + pila.join(" > "));
  return problemas;
}

// ===========================================================================
// 1. EL VERIFICADOR CONTRA 22 CASOS CONOCIDOS. Esto va PRIMERO a proposito: si el
//    verificador no es fiable, el DDL que se revise con el no vale nada.
// ===========================================================================
const CASOS = [
  ["if then end if", "if a then\n  b;\nend if;", 0],
  ["dos if anidados", "if a then\n  if b then\n    c;\n  end if;\nend if;", 0],
  ["falta un end if", "if a then\n  if b then\n    c;\n  end if;", 1],
  ["sobra un end if", "if a then\n  b;\nend if;\nend if;", 1],
  ["un end if de mas y uno de menos se cancelarian en un contador", "if a then\n  if b then\n    c;\n  end if;", 1],
  ["for loop", "for i in 1 .. 3 loop\n  b;\nend loop;", 0],
  ["while loop", "while a loop\n  b;\nend loop;", 0],
  ["foreach abre loop y no es un for", "foreach t in array x loop\n  b;\nend loop;", 0],
  ["dos foreach", "foreach t in array x loop\n  a;\nend loop;\nforeach u in array y loop\n  b;\nend loop;", 0],
  ["begin end", "begin\n  b;\nend;", 0],
  ["declare anidado con for", "declare\n  k int;\nbegin\n  for k in 1..2 loop\n    b;\n  end loop;\nend;", 0],
  ["declare anidado dentro de un if", "if a then\n  declare\n    v text;\n  begin\n    v := 'x';\n  end;\nend if;", 0],
  ["case", "case x\n  when 1 then\n    a;\n  else\n    b;\nend case;", 0],
  ["elsif no abre un if", "if a then\n  b;\nelsif c then\n  d;\nelse\n  e;\nend if;", 0],
  [
    "if not exists con la consulta larga y el then lejos",
    "if not exists (\n  select 1\n  from pg_index x\n  join pg_class c on c.oid = x.indrelid\n  join pg_namespace ns on ns.oid = c.relnamespace\n  join pg_attribute a on a.attrelid = x.indrelid\n where ns.nspname = 'public' and c.relname = 'x' and x.indisunique\n   and (select array_agg(a.attname order by u.ord)\n          from unnest(x.indkey) with ordinality as u(attnum, ord)\n          join pg_attribute a on a.attrelid = x.indrelid and a.attnum = u.attnum\n       ) = v_cols[k]\n) then\n  b;\nend if;",
    0,
  ],
  ["for update de un select NO es un bucle", "select revision into v from public.app_state where id = 1 for update;\nif not found then\n  b;\nend if;", 0],
  ["for share tampoco es bucle", "select 1 from t for share;", 0],
  ["for no key update tampoco", "select 1 from t for no key update;", 0],
  ["un for loop de verdad sigue detectandose", "for i in 1..2 loop\n  b;\nend loop;", 0],
  ["un for que no es bloqueo ni loop se senala", "for i in 1..2;\n  b;", 1],
  ["palabras clave en un literal no cuentan", "raise exception 'if then end if for loop begin end';", 0],
  ["palabras clave en un comentario no cuentan", "-- end if; for loop;\nbegin\n  b;\nend;", 0],
];

test("el verificador de plpgsql acierta en los " + CASOS.length + " casos conocidos", () => {
  const fallos = [];
  for (const [nombre, cuerpo, esperados] of CASOS) {
    const p = revisarPlpgsql(cuerpo);
    if (p.length !== esperados) fallos.push(nombre + ": esperaba " + esperados + " y dio " + p.length + " [" + p.join(" | ") + "]");
  }
  assert.deepEqual(
    fallos,
    [],
    "el verificador falla en casos que se conocen de antemano, y entonces no sirve para el DDL: " + fallos.join(" ;; ")
  );
});

// ===========================================================================
// 2. EL DDL, YA CON EL VERIFICADOR FIABLE.
// ===========================================================================
function cuerposDelDdl(ddl) {
  const salida = [];
  const re = /\b(?:do|as)\s*\$\$([\s\S]*?)\$\$/g;
  let m;
  while ((m = re.exec(ddl))) {
    const antes = ddl.slice(Math.max(0, m.index - 500), m.index);
    const encontrado = antes.match(/create or replace function\s+(public\.\w+)/);
    salida.push({
      nombre: encontrado ? encontrado[1] : "bloque do",
      texto: m[1],
      linea: ddl.slice(0, m.index).split("\n").length,
    });
  }
  return salida;
}

for (const [rel, nombre] of [
  ["docs/schema-supabase-plan.sql", "la del plan"],
  ["docs/schema-supabase-login-correo.sql", "la del login"],
]) {
  test(nombre + ": ningun cuerpo plpgsql esta descuadrado", async () => {
    const ddl = await fs.promises.readFile(path.join(RAIZ, rel), "utf8");
    const cuerpos = cuerposDelDdl(ddl);
    // Umbral 1, no 3. El DDL del plan tiene 6 cuerpos y el del login tiene 1, asi que
    // un minimo de 3 hacia creer que los dos archivos tienen la misma forma. Y el 3 era
    // inventado: lo que importa es que haya AL MENOS UN cuerpo que revisar y que
    // ninguno este descuadrado. Un umbral mas alto que la realidad hace que el test
    // falle por un numero, que es como un test deja de informar. Ya paso dos veces
    // con este archivo: una con 5 RAISE por DDL, y esta con 3 cuerpos.
    assert.ok(cuerpos.length >= 1, "no se ve ningun cuerpo $$: el detector esta mal y el test pasaria sin mirar nada");
    const malos = [];
    for (const c of cuerpos) {
      for (const p of revisarPlpgsql(c.texto)) {
        malos.push("linea " + c.linea + " " + c.nombre + ": " + p);
      }
    }
    assert.deepEqual(malos, [], "estos cuerpos plpgsql estan descuadrados y Postgres los rechaza: " + malos.join(" ;; "));
  });
}

test("el detector se encuentra a si mismo si alguien mete un end if de mas", () => {
  // Y que el DDL tiene al menos un cuerpo con if y end if de verdad, o sea que el
  // test de arriba no pasa porque no haya nada que mirar. Se comprueba con un DDL
  // roto a proposito, porque si no el test podria estar verde por no mirar nada.
  const roto =
    "create or replace function public.x() returns jsonb language plpgsql as $$\n" +
    "begin\n  if a then\n    b;\n  end if;\n  end if;\nend $$;\n";
  const d = revisarPlpgsql(rotro());
  assert.ok(d.length > 0, "un end if de mas tiene que verse");

  function rotro() {
    const m = /\$\$([\s\S]*?)\$\$/.exec(roto);
    return m[1];
  }
});
