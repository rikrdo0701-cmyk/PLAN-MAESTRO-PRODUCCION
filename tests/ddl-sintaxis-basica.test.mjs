import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

/**
 * NINGUN % DEL DDL QUEDA FUERA DE UN LITERAL, salvo en un bloque $$ donde plpgsql lo
 * admita, o en un comentario.
 *
 * ERROR REAL DEL USUARIO, dos veces seguidas. La primera:
 *   ERROR: syntax error at or near "%"
 * Venia de un `insert into public.%I select (jsonb_populate_recordset(...))` al que se
 * le habia perdido el format() y las comillas al copiarlo, asi que Postgres parseaba
 * `public.%I` como un identificador.
 *
 * Por que este control y no contar comillas por linea: los literales de este archivo
 * ocupan varias lineas (los textos de format() llevan saltos), y un conteo por linea
 * descuadra el estado y marca como sospechoso un % que SI esta en un literal. Un
 * detector que se queja de lo legitimo entrena a ignorar sus propias quejas, que es
 * exactamente como se cuela un % de verdad. Por eso se recorre caracter aacter, llevando
 * el estado de literal, comentario y bloque $$.
 *
 * La regla: un marcador de format() SIEMPRE esta dentro de un literal. Fuera de ahi no
 * hay ningun uso legitimo de % en este DDL.
 */

/** Recorre el DDL y devuelve los % problematicos, con su linea. */
function percentajesSueltos(ddl) {
  const problemas = [];
  let enComilla = false;
  let enComentario = false;
  let enDollar = false;
  let linea = 1;
  let i = 0;
  while (i < ddl.length) {
    const c = ddl[i];
    const c2 = ddl.slice(i, i + 2);
    if (c === "\n") { linea++; enComentario = false; i++; continue; }
    if (enComentario) { i++; continue; }
    if (c2 === "$$") { enDollar = !enDollar; i += 2; continue; }
    // El guion doble abre comentario tambien dentro de un bloque $$, porque plpgsql los
    // admite. Si no se contempla, el comentario que documenta un error anterior se lee
    // como codigo y el detector se queja de su propia explicacion.
    if (c2 === "--") { enComentario = true; i += 2; continue; }
    if (c === "'") {
      if (enComilla && ddl[i + 1] === "'") { i += 2; continue; }
      enComilla = !enComilla;
      i++;
      continue;
    }
    if (c === "%" && !enComilla) {
      const desde = ddl.lastIndexOf("\n", i) + 1;
      const hasta = ddl.indexOf("\n", i);
      problemas.push({ linea, texto: ddl.slice(desde, hasta < 0 ? undefined : hasta).trim().slice(0, 110) });
    }
    i++;
  }
  return problemas;
}

const DDLS = [
  ["docs/schema-supabase-plan.sql", "../docs/schema-supabase-plan.sql"],
  ["docs/schema-supabase-login-correo.sql", "../docs/schema-supabase-login-correo.sql"],
];

for (const [nombre, ruta] of DDLS) {
  test(nombre + ": ningun % queda fuera de un literal, un comentario o un bloque $$", async () => {
    const ddl = await fs.promises.readFile(new URL(ruta, import.meta.url), "utf8");
    assert.ok(ddl.length > 0, "el archivo esta vacio: el test pasaria sin comprobar nada");
    const malos = percentajesSueltos(ddl);
    assert.deepEqual(
      malos.map((m) => m.linea + "  " + m.texto),
      [],
      "estos % estan fuera de un literal y Postgres los rechaza con syntax error at or near %"
    );
  });

  test(nombre + ": el detector NO se queja de los % legitimos", async () => {
    // La red de la red. Si el detector marcara un % que si es valido, dejaria de
    // servir: habria que dejar de mirarlo. Se comprueba con un caso de cada clase.
    const bueno = [
      "execute format('alter table public.%I enable row level security', t);",
      "raise exception 'quedan % politicas', n;",
      "  -- un comentario con public.%I y otro con %",
      "do $$ begin raise exception 'hay % de 5', 1; end $$;",
      "v_sql := format(",
      "  'with ex as (select * from jsonb_populate_recordset(null::public.%I, $1))",
      "   update public.%I t set %s from ex', v_tabla);",
    ].join("\n");
    assert.deepEqual(percentajesSueltos(bueno), [], "el detector se equivoca con un DDL correcto");
  });

  test(nombre + ": el detector SI encuentra un % suelto de verdad", async () => {
    // Y tiene que encontrarlo, o el test de arriba no probaria nada. Este es el
    // fragmento exacto que fallo.
    const malo = "  insert into public.%I\n  select (jsonb_populate_recordset(null::public.%I, p_filas)).*;";
    const hallados = percentajesSueltos(malo);
    assert.equal(hallados.length, 2, "tiene que encontrar los dos % del fragmento roto");
    assert.match(hallados[0].texto, /insert into public\.%I/);
  });
}
