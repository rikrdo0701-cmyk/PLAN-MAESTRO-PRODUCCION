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
const ddl = cierre + "\n" + plan;

/** Los `clave:` del escritor, en el orden en que aparecen. */
function clavesDeCatalogos() {
  const out = [];
  const re = /tabla:\s*"([a-z_]+)",\s*(?:\/\/[^\n]*\n\s*)*clave:\s*"([a-z_,]+)"/g;
  let m;
  while ((m = re.exec(escritor))) out.push({ tabla: m[1], clave: m[2] });
  return out;
}

test("el escritor y el DDL declaran los mismos catalogos", () => {
  const delEscritor = clavesDeCatalogos();
  assert.ok(delEscritor.length >= 6, `esperaba al menos 6 catalogos con clave y hay ${delEscritor.length}`);
  for (const { tabla } of delEscritor) {
    assert.match(ddl, new RegExp(`create (unique )?index[^;]*on public\\.${tabla}\\b`, "i"),
      `el escritor escribe ${tabla} pero no hay ningun indice declarado para ella`);
  }
});

test("cada on_conflict del escritor apunta a un indice UNICO y COMPLETO", () => {
  // POR QUE "COMPLETO" Y POR QUE ESTE TEST. MEDIDO 2026-09-30 en produccion: 4 de las 6
  // tablas de catalogo devolvieron HTTP 400 42P01, "there is no unique or exclusion
  // constraint matching the ON CONFLICT specification". Para tools y subcontracts el indice
  // EXISTIA pero era PARCIAL (`where codigo <> ''`), y PostgreSQL no puede inferir un indice
  // parcial desde ON CONFLICT (columna): hace falta el mismo predicado escrito igual, y
  // PostgREST no lo manda. Para calendar_exceptions y ot_configurations no habia indice
  // ninguno, aunque el escritor ya mandaba on_conflict hacia ellas.
  //
  // O sea que "hay un indice" NO era suficiente. Tiene que ser unico y sin predicado. Por eso
  // este test no busca el nombre del indice: mira la DEFINICION, que es lo que PostgreSQL
  // evalua, y falla si aparece un `where` entre el `(columnas)` y el `;`.
  // El DDL parte las definiciones en varias lineas (`create unique index if not exists X` /
  // `on public.T (cols);`), asi que el parseo es sobre el TEXTO COMPLETO y no linea por linea.
  const vistas = {};
  const re = /create (unique )?index (?:if not exists )?\S+\s+on public\.([a-z_]+)\s*\(([^)]*)\)([^;]*);/gi;
  let m;
  while ((m = re.exec(ddl))) {
    vistas[m[2].toLowerCase()] = { unique: Boolean(m[1]), cols: m[3], resto: m[4] || "" };
  }

  for (const { tabla, clave } of clavesDeCatalogos()) {
    const idx = vistas[tabla];
    assert.ok(idx, `no hay ningun indice declarado para ${tabla}, y el escritor le manda on_conflict=${clave}`);
    assert.ok(idx.unique, `el indice de ${tabla} NO es UNIQUE, asi que on_conflict=${clave} no puede deduplicar`);
    assert.doesNotMatch(idx.resto, /\bwhere\b/i,
      `el indice de ${tabla} es PARCIAL (${idx.resto.trim()}) y ON CONFLICT (${clave}) no lo puede inferir. ` +
      "Un indice unico parcial exige que el INSERT repita el mismo predicado, y PostgREST no lo manda.");

    // Y las columnas que el escritor manda tienen que estar en el indice. Un ON CONFLICT con
    // una columna que el indice no cubre falla con el mismo 42P01, asi que esto tambien cuenta.
    const delIndice = idx.cols.split(",").map((c) => c.trim().replace(/^["']|["']$/g, "").toLowerCase());
    const pedidas = clave.split(",").map((c) => c.trim().toLowerCase());
    for (const col of pedidas) {
      assert.ok(delIndice.includes(col),
        `el escritor manda on_conflict=${clave} en ${tabla}, pero su indice cubre (${idx.cols}) y no a ${col}`);
    }
  }
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
