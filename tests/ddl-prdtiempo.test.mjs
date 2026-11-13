// EL DDL DE `prdtiempo_registros` TIENE QUE DECIR LO MISMO QUE LA PAGINA Y QUE EL
// LECTOR DE SUPABASE. Son tres archivos que comparten un contrato que hoy solo vive
// en prosa (docs/schema-prdtiempo.sql, src/web/prd/prd-core.js y
// src/web/shared/supabase-reader.js). Sin este test, el dia que uno se mueva solo,
// nadie avisa y el fallo aparece en el piso: una OT que dice "cerrada" cuando no lo
// esta, o una corrida que no se puede reiniciar despues de finalizar.
//
// QUE SE COMPRUEBA, Y CADA COSA POR QUE.
//
// 1. LA TABLA EXISTE CON SUS COLUMNAS Y SUS DOS REGLAS DE COHERENCIA. `cantidad > 0`
//    y `hora_fin >= hora_inicio` son las unicas que protegen el ciclo por pieza de
//    un 0 o de un tiempo negativo; si se borran del DDL, la base acepta basura y la
//    pantalla la pinta igual.
//
// 2. EL UNICO ES **PARCIAL** (`where hora_fin is null`). Es el corazon del diseno:
//    una corrida abierta por OT + operacion, y despues de finalizar se puede
//    iniciar otra (retrabajo o segunda tanda). Un unique COMPLETO sobre el par
//    impediria la segunda corrida, que es una decision explicita del usuario.
//
// 3. RLS ENCENDIDO, CERO POLITICAS Y SIN GRANTS DE TABLA. La pagina no tiene login
//    todavia: si la tabla tuviera una politica para `anon`, cualquiera con el
//    enlace leeria y escribiria CUALQUIER fila, incluido borrar. El unico camino
//    son las tres funciones.
//
// 4. LAS TRES FUNCIONES SON `security definer` CON `search_path` FIJO Y `grant` A
//    `anon`. Sin `security definer` no pueden escribir con la tabla revocada; sin
//    `search_path` fijo, una funcion creada por `anon` en otro esquema podria
//    ganarle la resolucion de nombres.
//
// 5. LA LISTA DE ESTATUS CERRADOS ES LA MISMA QUE `workOrderCerrada`. Vive dos
//    veces (SQL para el escaneo, JS para el plan) y este test las compara palabra
//    por palabra. Ya paso en este repo que dos copias de una regla se separen.
//
// 6. `updated_at` TIENE DISPARADOR. Sin el, la columna se queda con el valor del
//    INSERT y "cuando se cerro esta corrida" responde una mentira.
//
// 7. LA TABLA NO ENTRA EN EL ESPEJO. `ingesta_mirror` BORRA e INSERTA: si estas
//    corridas entraran ahi, una sincronizacion de NetSuite las perderia.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = fileURLToPath(new URL("../", import.meta.url));
const DDL = await readFile(path.join(RAIZ, "docs/schema-prdtiempo.sql"), "utf8");
const LECTOR = await readFile(path.join(RAIZ, "src/web/shared/supabase-reader.js"), "utf8");

const TABLA = "prdtiempo_registros";

/** El DDL sin comentarios: se afirma sobre SENTENCIAS, no sobre lo que el archivo
 *  dice que hace. Un regex encuentra el texto DENTRO del comentario que explica el
 *  bug y el test falla por su propia explicacion (mismo criterio que
 *  tests/ddl-inspection-routes.test.mjs y tests/ddl-claves-catalogo.test.mjs). */
function sqlSinComentarios(texto) {
  return texto.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
}

const ddl = sqlSinComentarios(DDL);

/** Columnas reales del CREATE TABLE. El cuerpo se saca contando parentesis: la
 *  primera columna trae `default gen_random_uuid()` y un patron que se para en el
 *  primer `)` se queda con media tabla. */
function columnasDeLaTabla() {
  const inicio = ddl.search(new RegExp(`create table (?:if not exists )?public\\.${TABLA}\\s*\\(`, "i"));
  assert.notEqual(inicio, -1, `el DDL no crea public.${TABLA}`);
  let depth = 0;
  let fin = -1;
  for (let i = ddl.indexOf("(", inicio); i < ddl.length; i += 1) {
    if (ddl[i] === "(") depth += 1;
    else if (ddl[i] === ")") {
      depth -= 1;
      if (depth === 0) { fin = i; break; }
    }
  }
  assert.ok(fin > inicio, "no se pudo cerrar el CREATE TABLE");
  const cols = new Set();
  // Desde el parentesis de apertura, no desde `create table`: si no, la primera
  // "columna" que se lee es la palabra `create`.
  for (const linea of ddl.slice(ddl.indexOf("(", inicio) + 1, fin).split(",")) {
    const m = linea.trim().match(/^([a-z_]+)\s/i);
    if (m) cols.add(m[1].toLowerCase());
  }
  return cols;
}

const COLUMNAS = columnasDeLaTabla();

test("1. la tabla trae las columnas que lee y escribe la pagina", () => {
  // Las que el registro necesita para no volver a consultar nada al finalizar: el
  // articulo, la operacion y el objetivo se copian al iniciar.
  const esperadas = [
    "id", "ot", "articulo", "articulo_descripcion", "cantidad_ot",
    "operacion_id", "operacion_secuencia", "operacion_descripcion", "maquina",
    "ciclo_objetivo_min", "hora_inicio", "hora_fin", "cantidad", "tiempo_ciclo_min",
    "dispositivo", "created_at", "updated_at",
  ];
  const faltantes = esperadas.filter((c) => !COLUMNAS.has(c));
  assert.deepEqual(faltantes, [], `faltan columnas en ${TABLA}: ${faltantes.join(", ")}`);

  // Las dos reglas que protegen el calculo del ciclo.
  assert.match(ddl, /cantidad is null or cantidad > 0/i,
    "falta el CHECK de cantidad > 0: un 0 divide entre cero y un negativo da un ciclo sin sentido");
  assert.match(ddl, /hora_fin is null or hora_fin >= hora_inicio/i,
    "falta el CHECK de hora_fin >= hora_inicio: un fin antes del inicio da un ciclo negativo");
});

test("2. el unico de (ot, operacion_id) es PARCIAL: una corrida abierta, y se puede reiniciar", () => {
  const indices = [...ddl.matchAll(new RegExp(`create (unique )?index (?:if not exists )?(\\S+)\\s+on public\\.${TABLA}\\s*\\(([^)]*)\\)([^;]*);`, "gi"))]
    .map((m) => ({ unique: Boolean(m[1]), nombre: m[2], cols: m[3], resto: m[4] || "" }));

  const delPar = indices.filter((i) => {
    const cols = i.cols.split(",").map((c) => c.trim().toLowerCase());
    return cols.length === 2 && cols.includes("ot") && cols.includes("operacion_id");
  });

  assert.equal(delPar.length > 0, true, "no hay ningun indice sobre (ot, operacion_id)");
  const unico = delPar.find((i) => i.unique);
  assert.ok(unico, "el indice de (ot, operacion_id) tiene que ser UNIQUE o dos telefonos abren dos corridas del mismo par");

  // El predicado es lo que hace que el unique NO impida reiniciar despues de
  // finalizar. Sin el, la segunda tanda falla con 23505 y la pagina no puede hacer
  // nada al respecto.
  assert.match(unico.resto, /where\s+hora_fin\s+is\s+null/i,
    "el unico de (ot, operacion_id) no es parcial: prohibiria volver a iniciar la misma operacion despues de finalizarla");

  // Y el DDL no puede traer ademas un unique COMPLETO del mismo par: ese si
  // bloquearia el reinicio y ademas el `on conflict ... where hora_fin is null` del
  // RPC no lo podria inferir.
  const completo = delPar.filter((i) => i.unique && !/where/i.test(i.resto));
  assert.deepEqual(completo.map((i) => i.nombre), [], "hay un unique completo de (ot, operacion_id): mata el reinicio despues de finalizar");
});

test("3. RLS encendido, cero politicas y sin permisos de tabla para anon", () => {
  assert.match(ddl, new RegExp(`alter table public\\.${TABLA}\\s+enable row level security`, "i"),
    "la tabla tiene que tener RLS encendido aunque no haya politicas: es lo que deja la Data API sin filas");

  const politicas = [...ddl.matchAll(new RegExp(`create policy\\s+(\\S+)\\s+on public\\.${TABLA}`, "gi"))];
  assert.deepEqual(politicas.map((m) => m[1]), [],
    `la tabla no puede tener politicas: cualquier politica para anon deja leer y escribir CUALQUIER fila con solo el enlace publico`);

  for (const rol of ["anon", "authenticated"]) {
    assert.match(ddl, new RegExp(`revoke all on table public\\.${TABLA} from ${rol}`, "i"),
      `falta el revoke de la tabla para ${rol}: sin el, PostgREST responde con lo que diga RLS (vacio) en vez de negar, y sobre todo deja el camino abierto a un grant futuro`);
  }
});

test("4. las tres funciones son security definer, con search_path fijo y ejecutables por anon", () => {
  const funciones = [
    { nombre: "prdtiempo_escanear", firma: "prdtiempo_escanear\\(text\\)" },
    { nombre: "prdtiempo_iniciar", firma: "prdtiempo_iniciar\\(text, text, timestamptz, text\\)" },
    { nombre: "prdtiempo_finalizar", firma: "prdtiempo_finalizar\\(uuid, integer, timestamptz\\)" },
  ];

  for (const f of funciones) {
    // El cuerpo de la funcion: desde su CREATE hasta el `$fn$;` que lo cierra.
    const desde = ddl.search(new RegExp(`create (?:or replace )?function public\\.${f.nombre}\\s*\\(`, "i"));
    assert.notEqual(desde, -1, `no existe public.${f.nombre}`);
    const hasta = ddl.indexOf("$fn$;", desde);
    const cuerpo = ddl.slice(desde, hasta > 0 ? hasta : undefined);

    assert.match(cuerpo, /security definer/i, `${f.nombre} tiene que ser security definer: la tabla esta revocada y sin eso no puede escribir`);
    assert.match(cuerpo, /set search_path = public, pg_temp/i, `${f.nombre} tiene que fijar search_path: si no, la resolucion de nombres depende de quien la llama`);
    assert.match(ddl, new RegExp(`grant execute on function public\\.${f.firma}\\s+to\\s+anon`, "i"),
      `${f.nombre} no esta concedida a anon: la pagina no tiene sesion y no podria llamarla`);
  }

  // La funcion auxiliar NO se expone: no la necesita el navegador.
  assert.match(ddl, /revoke all on function public\.prdtiempo_estatus_cerrado\(text\) from public, anon, authenticated/i,
    "prdtiempo_estatus_cerrado quedo al alcance de anon");
});

test("5. la lista de estatus cerrados es la MISMA que workOrderCerrada del lector", () => {
  const enJs = LECTOR.match(/PALABRAS_OT_CERRADA\s*=\s*\[([^\]]*)\]/);
  assert.ok(enJs, "no se encontro PALABRAS_OT_CERRADA en supabase-reader.js");
  const palabrasJs = [...enJs[1].matchAll(/"([^"]+)"/g)].map((m) => m[1].toUpperCase()).sort();

  const desde = ddl.search(/create (?:or replace )?function public\.prdtiempo_estatus_cerrado/i);
  const hasta = ddl.indexOf("$fn$;", desde);
  const cuerpo = ddl.slice(desde, hasta > 0 ? hasta : undefined);
  const palabrasSql = [...cuerpo.matchAll(/position\('([^']+)'\s+in/gi)].map((m) => m[1].toUpperCase()).sort();

  assert.deepEqual(palabrasSql, palabrasJs,
    "el SQL y el lector decidieron distinto que es una OT cerrada: la pagina dejaria trabajar una OT cerrada o bloquearia una abierta");

  // La normalizacion tambien tiene que cubrir acentos: "CANCELACIÓN" tiene que caer
  // en CANCEL igual que en JS, donde se hace normalize("NFD") y se quitan las marcas.
  assert.match(cuerpo, /translate\([\s\S]{0,120}?[áéíóú][^']*',\s*'aeiouuAEIOUU'\)/i,
    "la funcion no quita acentos: 'CANCELACIÓN' no coincidiria con CANCEL y la OT cerrada se podria trabajar");
});

test("6. updated_at se mueve con el disparador del repo", () => {
  assert.equal(COLUMNAS.has("updated_at"), true);
  assert.match(ddl, new RegExp(`create trigger\\s+prdtiempo_set_updated_at[\\s\\S]*?before update on public\\.${TABLA}[\\s\\S]*?execute function public\\.pp_set_updated_at\\(\\)`, "i"),
    "falta el disparador de updated_at, o llama a una funcion que no es la del repo");
});

test("7. la tabla NO entra al espejo de ingesta", () => {
  // ingesta_mirror BORRA e INSERTA la tabla completa: estas corridas se acumulan y
  // un espejo las perderia. El DDL no puede meterlas en la whitelist.
  assert.doesNotMatch(ddl, new RegExp(`insert into public\\.ingesta_mirror_whitelist[^;]*'${TABLA}'`, "i"),
    "la tabla quedo en la whitelist de ingesta_mirror: la siguiente sincronizacion borraria las corridas");
  assert.doesNotMatch(ddl, new RegExp(`insert into public\\.operaciones_whitelist[^;]*'${TABLA}'`, "i"));
});

test("8. el ciclo se calcula igual en SQL y en la pagina (minutos / piezas, 2 decimales)", () => {
  // El SQL: segundos entre inicio y fin, entre 60, entre piezas, redondeado a 2.
  const desde = ddl.search(/create (?:or replace )?function public\.prdtiempo_finalizar/i);
  const hasta = ddl.indexOf("$fn$;", desde);
  const cuerpo = ddl.slice(desde, hasta > 0 ? hasta : undefined);

  assert.match(cuerpo, /extract\(epoch from \(p_hora_fin - v_actual\.hora_inicio\)\)\s*\/\s*60\.0\s*\/\s*p_cantidad/i,
    "la formula del ciclo en SQL no es (segundos / 60 / piezas)");
  assert.match(cuerpo, /round\(\s*[\s\S]*?,\s*2\s*\)/i,
    "el ciclo en SQL no se redondea a 2 decimales: la pagina y la base mostrarian numeros distintos");

  // La guarda de carrera: solo actualiza si la corrida sigue abierta.
  assert.match(cuerpo, /where id = p_id\s+and hora_fin is null/i,
    "el UPDATE no exige hora_fin is null: dos telefonos finalizando a la vez se sobrescribirian");
});
