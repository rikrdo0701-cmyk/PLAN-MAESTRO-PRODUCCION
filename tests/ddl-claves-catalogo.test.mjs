// La clave que el escritor manda en on_conflict tiene que existir COMO INDICE UNICO
// COMPLETO en el DDL. MEDIDO 2026-09-30: no era cierto para 4 de 6 tablas, y el guardado de
// catalogos fallo con 42P01 en las cuatro. Este test es el que hace que eso no se repita.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = fileURLToPath(new URL("../", import.meta.url));
const escritor = await readFile(path.join(RAIZ, "src/web/shared/supabase-writer.js"), "utf8");
const cierre = await readFile(path.join(RAIZ, "docs/schema-supabase-cierre-catalogos.sql"), "utf8");
const plan = await readFile(path.join(RAIZ, "docs/schema-supabase-plan.sql"), "utf8");
// El DDL sin comentarios, para las afirmaciones que son sobre SENTENCIAS. Ver el helper.
const sentencias = sqlSinComentarios(cierre);

/**
 * Los indices declarados en el DDL, por tabla: si son UNIQUE y si tienen predicado. El
 * predicado es lo que separa un indice utilizable de uno que no: PostgreSQL no infiere un
 * indice PARCIAL desde ON CONFLICT (columna), porque haria falta repetir el mismo
 * predicado en la clausula y PostgREST no lo manda.
 *
 * El DDL parte las definiciones en varias lineas (create unique index if not exists X / on
 * public.T (cols);), asi que el parseo es sobre el TEXTO COMPLETO y no linea por linea. Se
 * aceptan las dos formas del create, con y sin if not exists: la forma sin el es la de los
 * indices que se TIRAN y se recrean, y un parser que solo entendiera una de las dos no
 * podria afirmar sobre las dos.
 */
const vistas = {};
for (const m of sentencias.matchAll(/create (unique )?index (?:if not exists )?\S+\s+on public\.([a-z_]+)\s*\(([^)]*)\)([^;]*);/gi)) {
  vistas[m[2].toLowerCase()] = { unique: Boolean(m[1]), cols: m[3], resto: m[4] || "" };
}
const ddl = cierre + "\n" + plan;

/**
 * El DDL SIN sus comentarios. Para afirmar sobre SENTENCIAS, no sobre lo que el archivo dice
 * que hace. MEDIDO 2026-09-30: sin esto, el regex /create unique index[^;]*fecha_inicio/
 * encuentra el texto DENTRO del comentario que explica por que no se crea ese indice, y el
 * test falla por su propia explicacion. Pasa dos veces el mismo dia, aqui y en
 * tests/probar-conexion.test.mjs: cuando un comentario cita el bug que se corrige, o se
 * reescribe el comentario o se afirma sobre el codigo. Se afirma sobre el codigo, una vez, con
 * este helper. Un "--" dentro de un literal es el unico caso en que esto mentiria, y en este
 * DDL no hay ninguno en las lineas que se afirman.
 */
function sqlSinComentarios(texto) {
  return texto.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
}

/** Los `clave:` del escritor, en el orden en que aparecen. */
function clavesDeCatalogos() {
  const out = [];
  const re = /tabla:\s*"([a-z_]+)",\s*(?:\/\/[^\n]*\n\s*)*clave:\s*"([a-z_,]+)"/g;
  let m;
  while ((m = re.exec(escritor))) out.push({ tabla: m[1], clave: m[2] });
  return out;
}

test("el escritor manda una clave que EXISTE en la base, y el DDL solo declara lo que falta", () => {
  // POR QUE ESTE TEST CAMBIO DE FORMA. MEDIDO 2026-09-30 contra la base real, con un INSERT de
  // prueba dentro de un begin/rollback (no se escribio nada):
  //
  //   on_conflict (codigo)      en tools        -> ERROR, el indice es PARCIAL
  //   on_conflict (codigo)      en subcontracts -> ERROR, el indice es PARCIAL
  //   on_conflict (fecha_inicio, concepto, maquina) -> ERROR, columna equivocada
  //   on_conflict (fecha,        concepto, maquina) -> ok
  //   on_conflict (ot)          en ot_configurations      -> ok
  //   on_conflict (articulo)    en article_configurations -> ok
  //
  // La version anterior de este test exigia que el DDL declarara un indice para las seis
  // tablas. Cuatro de esas YA LO TENIAN en la base, creado a mano fuera de estos archivos, asi
  // que el test pedia indices de mas: aplicarlo habria dejado dos indices unicos sobre las
  // mismas columnas en cada tabla, que es ruido que no deduplica nada.
  //
  // Lo que se afirma ahora son las DOS mitades de la verdad:
  //   - el DDL declara indice SOLO para las dos tablas que no lo tienen completo (tools y
  //     subcontracts, y solo por el drop+create que convierte el parcial en completo),
  //   - y el escritor manda claves que el DDL NO tiene que declarar, porque ya estan.
  const delEscritor = clavesDeCatalogos();
  assert.equal(delEscritor.length, 6, "esperaba los seis catalogos con clave");

  // Las dos que el DDL tiene que arreglar: indice PARCIAL, que ON CONFLICT no infiere.
  for (const tabla of ["tools", "subcontracts"]) {
    const idx = vistas[tabla];
    assert.ok(idx, `el DDL tiene que declarar el indice de ${tabla}`);
    assert.ok(idx.unique, `el indice de ${tabla} tiene que ser UNIQUE`);
    assert.doesNotMatch(idx.resto, /\bwhere\b/i,
      `el indice de ${tabla} no puede seguir siendo PARCIAL: es lo que hace que ON CONFLICT (${idx.cols}) no se pueda inferir`);
  }

  // Las cuatro que ya estaban: el DDL NO debe volver a declararlas. Un segundo indice unico
  // sobre las mismas columnas no deduplica mas nada, solo encarece los INSERT.
  for (const tabla of ["calendar_exceptions", "ot_configurations", "article_configurations", "machine_planning_overrides"]) {
    assert.doesNotMatch(sentencias, new RegExp(`create unique index[^;]*on public\\.${tabla}\\b`, "i"),
      `${tabla} ya tiene su indice unico en la base; volver a declararlo deja dos para lo mismo`);
  }

  // Y el indice que el DDL crea para calendar_exceptions... no crea ninguno, y eso es lo
  // correcto: el que hay es sobre (fecha, concepto, maquina) y lo cambia el ESCRITOR.
  //
  // MEDIDO 2026-09-30: esta linea vivia aqui con `cierre` y con /fecha_inicio/ a secas, y
  // fallaba por su propio comentario, que cita el indice viejo para explicar por que no se
  // crea. Se afirma sobre `sentencias` (sin comentarios) y sobre la SENTENCIA, no la palabra.
  // MEDIDO 2026-09-30: esta afirmacion era doesNotMatch(/fecha_inicio/) a secas, y es falsa
  // de dos maneras. Una: el comentario del DDL cita el indice viejo sobre fecha_inicio para
  // explicar por que no se crea. Dos, y mas grave: la palabra aparece LEGITIMAMENTE en el
  // "add column if not exists fecha_inicio date", que es la migracion que creo la columna.
  // Borrarla del DDL seria perder la ventana de varios dias de la hoja CALENDARIO
  // (FECHA_INICIO/FECHA_FIN), que es justo lo que la migracion del 2026-09-29 vino a
  // arreglar. Lo que se afirma son las DOS mitades: no hay indice sobre fecha_inicio, y la
  // columna se sigue agregando.
  assert.doesNotMatch(sentencias, /create unique index[^;]*fecha_inicio/i,
    "el SQL del DDL no debe crear un indice sobre fecha_inicio: el que hay va sobre fecha");
  assert.match(sentencias, /add column if not exists fecha_inicio/,
    "el DDL tiene que seguir agregando fecha_inicio: es la que guarda la ventana de varios dias");
});

test("la clave de calendar_exceptions es la del indice que hay, no la que habia", () => {
  // Este es un bug del ESCRITOR, no del schema, asi que se afirma aqui y no en el DDL.
  // MEDIDO 2026-09-30: con on_conflict (fecha_inicio, concepto, maquina) Postgres contesta
  // 42P10/42P01, y con (fecha, concepto, maquina) acepta. El indice que existe es
  // calendar_exceptions_fecha_concepto_maquina_key.
  const cal = clavesDeCatalogos().find((c) => c.tabla === "calendar_exceptions");
  assert.ok(cal, "no se encontro calendar_exceptions en el escritor");
  assert.equal(cal.clave, "fecha,concepto,maquina",
    "la clave tiene que coincidir con el indice calendar_exceptions_fecha_concepto_maquina_key");
  // La afirmacion es sobre la SENTENCIA, no sobre la palabra. El comentario de arriba CITA el
  // indice viejo (sobre fecha_inicio) para explicar por que no se crea, y un test que buscara
  // la palabra entera obligaria a borrar la explicacion. La version anterior hacia justo eso, y
  // fallaba por su propio comentario.
  assert.doesNotMatch(sentencias, /create unique index[^;]*fecha_inicio/i,
    "el DDL no debe crear un indice sobre fecha_inicio: el que hay va sobre fecha, y el bug estaba en el escritor");
});

test("el DDL explica por que los indices tienen que ser completos", () => {
  // Un indice unico parcial es lo natural que se escribe cuando hay filas vacias, y es un
  // error que no se ve hasta que alguien manda on_conflict. El motivo tiene que estar escrito
  // en el archivo, no solo en un commit.
  assert.match(cierre, /42P01/, "falta el codigo de error medido");
  assert.match(cierre, /indice UNICO PARCIAL no lo puede inferir ON CONFLICT/i,
    "falta la explicacion de por que un indice parcial no sirve con on_conflict");
  assert.match(cierre, /LEGADO-/, "falta decir como se desatasca el codigo vacio antes de crear el indice");
});

test("el indice que se completa se TIRA antes de recrearse", () => {
  // MEDIDO 2026-09-30, escribiendome el DDL: primero puse
  //   create unique index if not exists tools_codigo_uniq on public.tools (codigo)
  // creyendo que el if not exists convertia el indice PARCIAL en uno completo. NO lo hace: si
  // el nombre ya existe la sentencia no hace nada, sin avisar. O sea que el archivo decia
  // "arreglado" mientras la base seguia con el indice parcial, que es el que no puede inferir
  // ON CONFLICT. Aplicarlo no habria cambiado el 42P01 y el repo habria seguido contradiciendo
  // a la base sin que nadie lo notara. Un DDL que parece arreglado y no lo esta es peor que uno
  // que no existe, porque el que existe da por hecho que se aplico.
  for (const nombre of ["tools_codigo_uniq", "subcontracts_codigo_uniq"]) {
    const tabla = nombre.split("_")[0];
    const drop = cierre.indexOf(`drop index if exists public.${nombre};`);
    assert.ok(drop > 0, `falta el drop de ${nombre}: sin el, el create no reemplaza el indice parcial`);
    const create = cierre.search(new RegExp(`create unique index ${nombre}\\b`));
    assert.ok(create > drop, `el create de ${nombre} tiene que ir DESPUES de su drop`);
    // Y el create no puede llevar if not exists: eso es lo que lo hacia un no-op silencioso.
    assert.doesNotMatch(cierre.slice(create, create + 60), /if not exists/,
      `${nombre}: con if not exists el create no hace nada si el nombre ya existe`);
    assert.ok(new RegExp(`create unique index ${nombre}\\s*\\n\\s*on public\\.${tabla}\\s*\\(\\s*codigo\\s*\\)`).test(cierre),
      `${nombre}: tiene que ser un indice completo sobre (codigo)`);
  }
});
