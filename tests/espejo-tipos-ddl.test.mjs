// NINGUN LECTOR DEL ESPEJO PUEDE ENTREGAR UNA CADENA VACIA EN UNA COLUMNA QUE EL DDL
// DECLARE ENTERA. ESTE TEST EXISTE PORQUE UN ESPEJO REAL BORRO LA TABLA, MEDIDO 2026-10-05.
//
// QUE PASÓ, CON LAS HORAS DEL LOG DE LA CORRIDA DE LAS 07:52. La ventana de OTs cerradas del
// 2246 SI FUNCIONÓ: `workorders: 513 filas recibidas` son 213 abiertas + 300 cerradas, y 300 es
// exactamente `MAX_OT_CERRADAS`, o sea que el tope entró. Eso deja VERIFICADOS en la cuenta Su
// los tres pedazos de SQL que el repo no podía comprobar: `SYSDATE - 90`, `NULLS LAST` y
// `FETCH NEXT n ROWS ONLY`.
//
// Y a los dos segundos la escritura falló:
//
//   work_orders: ERROR al escribir: Supabase rpc ingesta_mirror work_orders 400:
//   codigo 22P02 | invalid input syntax for type integer: "
//
// `work_orders.cantidad` es `integer not null` (docs/schema-supabase.sql:179), y una cadena
// vacía no se puede castear a entero: Postgres 22P02. Alguna fila del payload traía `cantidad`
// con `""`. Y entonces, por RULE-SUP-048 (si NetSuite no entregó esta tabla, la tabla se vacía
// con el mismo RPC), `work_orders` quedó en CERO. MEDIDO después: 0 filas.
//
// POR QUE ESTE TEST, Y POR QUE NO CULPA AL ARCHIVO DEL REPO. El mapeo de este repositorio es
// `cantidad: Number(r.cantidad) || 0` (netsuite-restlet-unificado-supabase.js:112), que de "",
// de null, de NaN y de "1,200" sale 0 o un número, SIEMPRE un número. Y las dos ramas (abiertas
// y cerradas) usan el MISMO `filaWorkOrder_`. Un payload con `cantidad: ""` no puede salir de
// este archivo. Conclusión, y es una deducción, no una sospecha: el 2246 que corre NO es este
// archivo (la ventana de cerradas entro, pero por otra consulta, con otro mapeo de fila).
//
// QUE HACE ESTE TEST, EN DOS PARTES. (1) Contra el DDL, no de memoria: lee
// `docs/schema-supabase.sql`, saca las columnas que declara `integer` de cada tabla del espejo,
// y les pasa una fila de SuiteQL llena de valores basura (`''`, null, NaN, "1,200") para exigir
// que lo que sale de la fila es un número. (2) Una fila de verdad por.reader, para que agregar
// una columna entera nueva al DDL sin/mapear en el lector la rompa en la misma corrida que la
// vacio.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";

const raiz = new URL("../", import.meta.url);
const fuente = await readFile(new URL("netsuite-restlet-unificado-supabase.js", raiz), "utf8");
const ddl = await readFile(new URL("docs/schema-supabase.sql", raiz), "utf8");
const ingesta = await readFile(new URL("src/server/19-appscript-ingesta-supabase.js", raiz), "utf8");

const TABLAS_DEL_ESPEJO = [
  "work_orders", "operations", "materials", "items", "machines", "inventory", "sales_orders"
];

/** Las columnas que el DDL declara numéricas enteras en una tabla, tal como las declara. */
function columnasEnterasDDL(tabla) {
  const bloque = ddl.match(new RegExp("create table public\\." + tabla + " \\(([\\s\\S]*?)\\n\\);"));
  assert.ok(bloque, "el DDL tiene que tener la tabla " + tabla + "; si no, este test miente");
  const salida = [];
  for (const linea of bloque[1].split("\n")) {
    // Cada columna es `  nombre tipo [modificadores] -- comentario`. Se ignoran las lineas de
    // constraints (`primary key (...)`, `unique`) porque no son columnas.
    const m = /^\s{2}([a-z_][a-z0-9_]*)\s+([a-z0-9_]+)/i.exec(linea);
    if (!m) continue;
    const tipo = m[2].toLowerCase();
    if (/^(smallint|integer|int|int2|int4|int8|bigint|serial|bigserial)$/.test(tipo)) salida.push(m[1]);
  }
  return salida;
}

/**
 * Las columnas NUMERICAS de una tabla del espejo, leidas del DDL. Incluye `numeric(18,6)`: el
 * parentesis de la precision va pegado al tipo, asi que sin quitarlo `numeric(18,6)` no se
 * reconoce como numero y la columna se escaparia de la cuenta.
 *
 * Las siete tablas NO estan todas en `docs/schema-supabase.sql`: `items`, `inventory` y
 * `sales_orders` viven en `docs/schema-supabase-sync-netsuite.sql`, y por eso se buscan en los
 * dos. Si el esquema se mueve, esta lista de archivos es lo que hay que mover con el.
 */
function columnasNumericasDDL(tabla) {
  const salida = [];
  for (const archivo of ["docs/schema-supabase.sql", "docs/schema-supabase-sync-netsuite.sql"]) {
    const texto = ddlPorArchivo[archivo];
    const re = new RegExp("create table (?:if not exists )?public\\." + tabla + " \\(([\\s\\S]*?)\\n\\);", "g");
    let m;
    while ((m = re.exec(texto)) !== null) {
      for (const linea of m[1].split("\n")) {
        const limpio = linea.replace(/--.*$/, "").replace(/,\s*$/, "").trim();
        if (!limpio || /^(constraint|primary|unique|foreign|check)\b/i.test(limpio)) continue;
        const partes = limpio.split(/\s+/);
        if (partes.length < 2) continue;
        const tipo = partes[1].toLowerCase().replace(/\(.*\)/, "");
        if (/^(smallint|integer|int|int2|int4|int8|bigint|serial|bigserial|numeric|decimal|real|double precision|money)$/.test(tipo)) {
          if (!salida.includes(partes[0])) salida.push(partes[0]);
        }
      }
    }
  }
  return salida.sort();
}

const ddlPorArchivo = {
  "docs/schema-supabase.sql": ddl,
  "docs/schema-supabase-sync-netsuite.sql": await readFile(new URL("docs/schema-supabase-sync-netsuite.sql", raiz), "utf8")
};

/**
 * Las tres listas de columnas de la ingesta, tal como estan escritas en el archivo. Se corta el
 * bloque y se evalua SOLO ese bloque: correr el archivo entero en un vm exigira prestarle
 * PropertiesService y demas, y lo que se quiere leer aqui son constantes, no comportamiento.
 */
function listasDeLaIngesta() {
  const desde = ingesta.indexOf("const COLUMNAS_NUMERICAS_ =");
  // El bloque va hasta el FIN de `COLUMNAS_POR_OMISION_`, que es la ultima de las cuatro tablas
  // de columnas. Terminar en `COLUMNAS_BOOL_` la dejaba fuera y esta prueba compararia una lista
  // que el archivo ya no tiene: un vacio que no falla, que es la peor forma de fallar.
  const hasta = ingesta.indexOf("\n};", ingesta.indexOf("const COLUMNAS_POR_OMISION_ =")) + 3;
  assert.ok(desde > 0 && hasta > desde, "la ingesta tiene que seguir declarando las cuatro listas");
  const ctx = {};
  createContext(ctx);
  runInContext(ingesta.slice(desde, hasta) +
    "\nglobalThis.__salida = { COLUMNAS_NUMERICAS_, COLUMNAS_FECHA_, COLUMNAS_BOOL_, COLUMNAS_POR_OMISION_, COLUMNAS_ENTERAS_, PP_MAX_VALORES_REDONDEADOS_ };", ctx);
  // Se vuelve a pasar por JSON por una razon tonta pero real: los arreglos que salen de un `vm`
  // tienen otro `Array.prototype`, y `deepEqual` en modo estricto compara el prototipo tambien.
  // Sin esto, dos listas identicas se declaran distintas.
  return JSON.parse(JSON.stringify(ctx.__salida));
}

/**
 * Las columnas de TIPO NUMERICO del DDL, con el tipo exacto que declara.
 *
 * MEDIDO 2026-10-06 22:09: `numeric` y `integer` son cosas distintas, y tratar igual a las dos
 * llevo el 22P02 de `work_orders.cantidad`. Por eso el DDL se lee aqui con el TIPO, no solo con
 * el nombre: la pregunta que hace la prueba de abajo es "de las columnas numericas que la ingesta
 * sanea, cuales son enteras", y eso no se puede responder con una lista escrita a mano.
 */
function columnasNumericasDelDdl(tabla) {
  const salida = {};
  for (const texto of Object.values(ddlPorArchivo)) {
    const re = new RegExp("create table (?:if not exists )?public\\." + tabla + " \\(([\\s\\S]*?)\\n\\);", "g");
    let m;
    while ((m = re.exec(texto)) !== null) {
      for (const linea of m[1].split("\n")) {
        const limpio = linea.replace(/--.*$/, "").trim().replace(/,$/, "");
        const c = /^([a-z_][a-z0-9_]*)\s+([a-z0-9_]+(?:\([^)]*\))?)\s+(.*)$/i.exec(limpio);
        if (!c) continue;
        // Un tipo numerico es `integer`/`int`/`bigint`/`smallint` o `numeric`/`decimal`/`real`,
        // con o sin escala. `serial` NO se cuenta: es un `integer` con un default de secuencia, y
        // sus valores los pone la secuencia, no el espejo.
        if (/^(int|integer|bigint|smallint|numeric|decimal|real|double precision)$/i.test(c[2])) {
          salida[c[1]] = c[2].toLowerCase();
        }
      }
    }
  }
  return salida;
}

/**
 * Las columnas `not null` QUE TIENEN UN DEFAULT LITERAL en el DDL, con el valor del default.
 *
 * "LITERAL" es la palabra que importa, y por que: `now()` y `gen_random_uuid()` son valores que
 * la BASE pone cada vez, y meterlos en una tabla de omisiones seria congelarlos en el instante del
 * INSERT (y `id` ni siquiera es una columna que se pueda escribir). Un default que sale de una
 * funcion no se puede copiar al JSON: se excluye. Y eso solo son `id`, `created_at` y
 * `updated_at`, los tres que la base es duena.
 *
 * Se leer en los DOS archivos de DDL porque las siete tablas no estan todas en el primero.
 */
function columnasConDefaultLiteral(tabla) {
  const salida = {};
  for (const texto of Object.values(ddlPorArchivo)) {
    const re = new RegExp("create table (?:if not exists )?public\\." + tabla + " \\(([\\s\\S]*?)\\n\\);", "g");
    let m;
    while ((m = re.exec(texto)) !== null) {
      for (const linea of m[1].split("\n")) {
        const limpio = linea.replace(/--.*$/, "").trim().replace(/,$/, "");
        const c = /^([a-z_][a-z0-9_]*)\s+([a-z0-9_]+(?:\([^)]*\))?)\s+(.*)$/i.exec(limpio);
        if (!c) continue;
        const resto = c[3].toLowerCase();
        if (resto.indexOf("not null") === -1 || resto.indexOf("default") === -1) continue;
        const d = /default\s+(.+)$/i.exec(c[3].trim());
        if (!d) continue;
        const crudo = d[1].trim();
        if (/\(\s*\)$/.test(crudo)) continue;              // now() / gen_random_uuid(): valor de la base
        // `'[]'::jsonb` y `'PLAN'` y `0` y `true`: se quita el cast y se lee el literal de verdad.
        const sinCast = crudo.replace(/::[a-z0-9_ ]+$/i, "").trim();
        let valor;
        if (/^'.*'$/s.test(sinCast)) {
          const texto = sinCast.slice(1, -1).replace(/''/g, "'");
          // En una columna `jsonb` el default es TEXTO que Postgres va a interpretar como JSON:
          // `'[]'` quiere decir "el array vacio", no "la cadena con dos corchetes". Mandarle la
          // cadena escribiria un jsonb que es el texto `[]`, que no es lo mismo y no se lee igual.
          if (/^(jsonb|json)$/i.test(c[2])) valor = JSON.parse(texto);
          else valor = texto;
        }
        else if (sinCast === "true") valor = true;
        else if (sinCast === "false") valor = false;
        else if (/^-?[0-9]+(\.[0-9]+)?$/.test(sinCast)) valor = Number(sinCast);
        else continue;                                      // otro default: ni es literal ni es mio
        salida[c[1]] = valor;
      }
    }
  }
  return salida;
}

function restlet(alResponder) {
  let modulo = null;
  const define = (deps, factory) => {
    modulo = factory({
      runSuiteQL(args) {
        const r = alResponder(String(args && args.query));
        if (r instanceof Error) throw r;
        return { asMappedResults: () => r || [] };
      },
    });
  };
  const contexto = { console, JSON, Math, String, Number, Boolean, Date, Error, parseInt, parseFloat, isNaN, define };
  contexto.globalThis = contexto;
  createContext(contexto);
  runInContext(fuente, contexto, { filename: "netsuite-restlet-unificado-supabase.js" });
  return modulo.post;
}

/**
 * Una fila de SuiteQL donde CADA columna llega en la peor forma posible: cadena vacía. El
 * lector tiene que salir con números, porque el espejo castea a `integer` y una cadena vacía ahí
 * es 22P02 (que, con RULE-SUP-048, es la tabla en cero).
 */
function filaBasura() {
  return {
    wo_internal_id: "", ot: "", articulo: "", descripcion: "", cantidad: "",
    estatus: "", cliente: "", fecha_vencimiento: "",
    operation_id: "", secuencia: "", ct: "", operador: "", maquina: "",
    cant_total: "", cant_pendiente: "", tiempo_ciclo: "", tiempo_setup: "", tiempo_prod: "",
  };
}

const plano = (v) => JSON.parse(JSON.stringify(v));

test("el DDL declara las columnas enteras que este test supone (si el DDL cambia, esto se entera)", () => {
  // Se anotan a mano a proposito: si alguien cambia el tipo de una columna en el DDL y el lector
  // no se entera, la cuenta de esta lista deja de coincidir con la realidad y el resto del test
  // pasa por encima del hueco.
  assert.deepEqual(columnasEnterasDDL("work_orders"), ["cantidad", "cant_ensamblada", "cant_pendiente", "revision"]);
  assert.ok(columnasEnterasDDL("operations").includes("cant_total"));
  assert.ok(columnasEnterasDDL("operations").includes("cant_pendiente"));
  assert.ok(columnasEnterasDDL("operations").includes("secuencia"));
});

test("workorders: de cadena vacia y de texto sale un numero, en TODA columna entera del DDL", () => {
  // Cada valor de la lista es un caso. `cantidad: ""` es el que tumbó la tabla.
  const casos = ["", null, "no es numero", "1,200", "0"];
  for (const valor of casos) {
    const post = restlet(() => [{
      wo_internal_id: 1, ot: "3302", articulo: "A", descripcion: "D",
      cantidad: valor, estatus: "Orden de trabajo : Cerrada", cliente: "C", fecha_vencimiento: "01/10/2026",
    }]);
    const salida = plano(post({ accion: "workorders" }));
    for (const fila of salida.rows) {
      const entero = columnasEnterasDDL("work_orders").find((c) => c in fila);
      if (!entero) continue;
      assert.equal(typeof fila[entero], "number",
        "con cantidad=" + JSON.stringify(valor) + " la columna " + entero + " salio " +
        JSON.stringify(fila[entero]) + " (" + typeof fila[entero] + "), y el espejo la castea a " +
        "integer: 22P02 y la tabla VACIA");
      assert.ok(Number.isFinite(fila[entero]), "y no puede ser NaN: " + JSON.stringify(fila[entero]));
    }
  }
});

test("workorders: ni una fila sale con una cadena vacia en una columna del DDL que sea entera", () => {
  // Esta es la forma general del mismo guard, y no depende de que el lector se llame igual: se
  // recorre la fila que sale y se compara CONTRA EL DDL. Una columna `integer` que llegue como
  // `""` es un 22P02 garantizado, y un 22P02 con RULE-SUP-048 es una tabla en cero.
  const post = restlet(() => [filaBasura()]);
  const salida = plano(post({ accion: "workorders" }));
  for (const fila of salida.rows) {
    for (const [col, valor] of Object.entries(fila)) {
      if (typeof valor !== "string") continue;
      const enteras = columnasEnterasDDL("work_orders");
      if (!enteras.includes(col)) continue;
      assert.fail("work_orders." + col + " salio con la cadena " + JSON.stringify(valor) +
        " y el DDL la declara integer: el espejo la va a rechazar con 22P02");
    }
  }
});

test("operations: tampoco, y tampoco en las de tiempo", () => {
  const post = restlet(() => [{
    operation_id: "ns-1", ot: "3302", secuencia: "", ct: "1", descripcion: "D", operador: "1",
    maquina: "1", cant_total: "", cant_pendiente: "", tiempo_ciclo: "", tiempo_setup: "", tiempo_prod: "",
    fecha_inicio: "01/10/2026", fecha_fin: "01/10/2026",
  }]);
  const salida = plano(post({ accion: "operaciones" }));
  const enteras = columnasEnterasDDL("operations");
  for (const fila of salida.rows) {
    for (const [col, valor] of Object.entries(fila)) {
      if (!enteras.includes(col)) continue;
      if (valor === null || valor === "") {
        assert.fail("operations." + col + " salio como " + JSON.stringify(valor) + " y el DDL la declara integer");
      }
      assert.equal(typeof valor, "number", "operations." + col + " salio " + JSON.stringify(valor));
    }
  }
});

test("el lector de workorders NO inventa columnas que el DDL no tiene", () => {
  // La otra mitad del mismo problema: una clave que no existe en la tabla la levanta el RPC con
  // su propio `raise` (docs/rpc-ingesta-mirror.sql:140), y eso tambria la corrida entera.
  const bloque = ddl.match(/create table public\.work_orders \(([\s\S]*?)\n\);/)[1];
  const columnas = new Set();
  for (const linea of bloque.split("\n")) {
    const m = /^\s{2}([a-z_][a-z0-9_]*)\s+[a-z0-9_]+/i.exec(linea);
    if (m) columnas.add(m[1]);
  }
  const post = restlet(() => [{ wo_internal_id: 1, ot: "1", cantidad: 1 }]);
  const salida = plano(post({ accion: "workorders" }));
  for (const clave of Object.keys(salida.rows[0])) {
    assert.ok(columnas.has(clave), "el lector emite " + clave + " y el DDL de work_orders no la tiene");
  }
});

test("las columnas que la ingesta sanea son EXACTAMENTE las numericas del DDL, en las siete tablas", () => {
  // La ingesta corrige los valores antes de mandarlos (PP_saneaTipos_), y su lista esta escrita a
  // mano. Este test la compara con los DDL de las siete tablas del espejo: si el esquema gana una
  // columna numerica y la lista no, HERE se cae, y no un dia a las 07:52 con la tabla en cero.
  const { COLUMNAS_NUMERICAS_ } = listasDeLaIngesta();
  assert.deepEqual(Object.keys(COLUMNAS_NUMERICAS_).sort(), TABLAS_DEL_ESPEJO.slice().sort(),
    "la lista de la ingesta tiene que traer las siete tablas del espejo, ni una mas ni una menos");
  for (const tabla of TABLAS_DEL_ESPEJO) {
    assert.deepEqual(COLUMNAS_NUMERICAS_[tabla].slice().sort(), columnasNumericasDDL(tabla),
      "las columnas que la ingesta sanea de " + tabla + " no son las que el DDL declara numericas");
  }
});

test("una columna numerica que el DDL declara y la ingesta NO sanea se reporta con su archivo", () => {
  // Si este test se cae por una diferencia, el mensaje tiene que decir DE QUE DDL salio la columna,
  // porque las siete tablas estan en dos archivos y sin eso la correccion empieza por buscar.
  const { COLUMNAS_NUMERICAS_ } = listasDeLaIngesta();
  const faltantes = [];
  for (const tabla of TABLAS_DEL_ESPEJO) {
    for (const col of columnasNumericasDDL(tabla)) {
      if (!COLUMNAS_NUMERICAS_[tabla].includes(col)) {
        const donde = Object.entries(ddlPorArchivo).filter(([, t]) =>
          new RegExp("^\\s{2}" + col + "\\s+numeric", "im").test(t)).map(([a]) => a);
        faltantes.push(tabla + "." + col + " (ddl: " + (donde.join(", ") || "?") + ")");
      }
    }
  }
  assert.equal(faltantes.length, 0, "columnas numericas del DDL que la ingesta no sanea: " + faltantes.join(", "));
});

test("las fechas y los booleanos que la ingesta sanea existen en el DDL de su tabla", () => {
  // El saneo de fechas manda a `null` y el de booleanos a `false`, asi que una columna que no
  // exista (o que no sea de ese tipo) significa que la lista quedo viejo: se tocaria una clave que
  // la tabla no tiene y el RPC la levanta con su propio `raise`.
  const { COLUMNAS_FECHA_, COLUMNAS_BOOL_ } = listasDeLaIngesta();
  for (const tabla of TABLAS_DEL_ESPEJO) {
    const columnas = new Set();
    for (const texto of Object.values(ddlPorArchivo)) {
      const re = new RegExp("create table (?:if not exists )?public\\." + tabla + " \\(([\\s\\S]*?)\\n\\);", "g");
      let m;
      while ((m = re.exec(texto)) !== null) {
        for (const linea of m[1].split("\n")) {
          const c = /^\s{2}([a-z_][a-z0-9_]*)\s+([a-z]+)/i.exec(linea);
          if (c) columnas.add(c[1]);
        }
      }
    }
    assert.ok(columnas.size > 0, "hay que poder leer el DDL de " + tabla);
    for (const col of COLUMNAS_FECHA_[tabla]) {
      assert.ok(columnas.has(col), "la ingesta sanea la fecha " + tabla + "." + col + " y el DDL no la tiene");
    }
    for (const col of COLUMNAS_BOOL_[tabla]) {
      assert.ok(columnas.has(col), "la ingesta sanea el booleano " + tabla + "." + col + " y el DDL no la tiene");
    }
  }
});

// =============================================================================
// ENTERA CONTRA NUMERICA: EL 22P02 QUE EL SANEO DE TIPOS DEJABA PASAR
// =============================================================================

test("de las columnas que la ingesta sanea, las ENTERAS son las que el DDL declara `integer`", () => {
  // MEDIDO 2026-10-06 22:09, en produccion:
  //
  //   work_orders: ERROR al escribir: Supabase rpc ingesta_mirror work_orders 400:
  //   codigo 22P02 | invalid input syntax for type integer: "0.01"
  //
  // El `""` del 2026-10-05 ya estaba cubierto; este es el otro caso del MISMO codigo. El saneo
  // comprobaba `typeof n === "number" && isFinite(n)`, y 0.01 es las dos cosas: un decimal es un
  // numero finito, asi que pasaba de largo y `work_orders.cantidad` (`integer`) recibia un 0.01.
  //
  // La lista sale del DDL y no de memoria, porque el riesgo real es en la OTRA direccion: si
  // alguien mete `materials.requerido` o `inventory.disponible` en la lista de enteras, el
  // redondeo traga el 123.9504 de un tubo de 6 metros y es el RULE-SUP-046 al reves.
  const { COLUMNAS_NUMERICAS_, COLUMNAS_ENTERAS_ } = listasDeLaIngesta();
  for (const tabla of TABLAS_DEL_ESPEJO) {
    const delDdl = columnasNumericasDelDdl(tabla);
    const enterasDelDdl = Object.keys(delDdl)
      .filter((col) => delDdl[col] === "integer")
      .filter((col) => (COLUMNAS_NUMERICAS_[tabla] || []).indexOf(col) !== -1)
      .sort();
    assert.deepEqual((COLUMNAS_ENTERAS_[tabla] || []).slice().sort(), enterasDelDdl,
      "las columnas enteras que redondea la ingesta de " + tabla +
      " no son las `integer` del DDL (de sus " + Object.keys(delDdl).length + " columnas numericas)");
  }
});

test("NINGUNA columna `numeric` del DDL entra en la de enteras, en las siete tablas", () => {
  // El RULE-SUP-046 al reves, escrito por nombre porque es el fallo que de verdad da miedo:
  // `materials.requerido`/`emitido`/`pendiente` son `numeric(18,6)` A PROPOSITO (el DDL las
  // cambio de `integer` justamente porque el 2246 las redondeaba a 0 y el tubo llegaba como 0
  // piezas), y `inventory` deja sus cinco cantidades en `numeric` a proposito tambien.
  const { COLUMNAS_ENTERAS_ } = listasDeLaIngesta();
  const fraccionarias = {
    materials: ["requerido", "emitido", "pendiente"],
    inventory: ["disponible", "fisico", "comprometido", "pickeado", "en_transito"],
    work_orders: ["precio_promedio_venta", "precio_ultima_venta"],
    operations: ["tiempo_ciclo", "tiempo_setup", "tiempo_prod"],
    sales_orders: ["total"],
  };
  for (const tabla of Object.keys(fraccionarias)) {
    for (const col of fraccionarias[tabla]) {
      assert.equal((COLUMNAS_ENTERAS_[tabla] || []).indexOf(col), -1,
        tabla + "." + col + " es `numeric` en el DDL y redondearla perderia el decimal a proposito (RULE-SUP-046)");
    }
  }
});

test("la lista de enteras no se come ninguna columna que la ingesta no sanee", () => {
  // Las dos listas tienen que estar anidadas: una columna entera que `COLUMNAS_NUMERICAS_` no
  // lista nunca pasa por el saneo, asi que buscarla en la de enteras es una columna que no hace
  // nada. Y al reves tampoco: una columna de `COLUMNAS_ENTERAS_` que no sea numerica de verdad
  // significa que la tabla y el DDL ya no cuentan la misma historia.
  const { COLUMNAS_NUMERICAS_, COLUMNAS_ENTERAS_ } = listasDeLaIngesta();
  for (const tabla of TABLAS_DEL_ESPEJO) {
    const enteras = COLUMNAS_ENTERAS_[tabla] || [];
    const numeros = COLUMNAS_NUMERICAS_[tabla] || [];
    for (const col of enteras) {
      assert.ok(numeros.indexOf(col) !== -1,
        tabla + "." + col + " esta en la lista de enteras pero NO en la de numericas: nunca se sanea");
    }
    assert.ok(enteras.length <= numeros.length,
      tabla + " tiene mas columnas enteras que columnas numericas");
  }
});

test("`work_orders.cantidad` esta en la de enteras (es la columna del 22P02 medido)", () => {
  // Una asercion sobre un nombre puntual. Su valor esta en que si alguien renombra la columna o la
  // saca de la lista por una buena razon, esta prueba obliga a que la razon quede escrita EN LA
  // PRUEBA, en vez de desaparecer en un commit sin comentario.
  const { COLUMNAS_ENTERAS_ } = listasDeLaIngesta();
  assert.ok((COLUMNAS_ENTERAS_.work_orders || []).indexOf("cantidad") !== -1,
    "cantidad es `integer not null default 0` en el DDL y necesita el redondeo; si esto cambia, "
    + "el 22P02 del 2026-10-06 vuelve");
});

test("el tope de valores del log es un numero entero y pequeno", () => {
  // Un tope de 0 o negativo dejaria el detalle vacio (un `slice(0, -1)` de un arreglo de 3 quita
  // el ultimo), que es peor que no tener tope: el aviso diria "0 celdas". Y uno enorme devuelve
  // al problema que el tope evita, que es un log de 3000 caracteres que nadie lee entero.
  const { PP_MAX_VALORES_REDONDEADOS_ } = listasDeLaIngesta();
  assert.equal(typeof PP_MAX_VALORES_REDONDEADOS_, "number", "tiene que ser un numero");
  assert.ok(PP_MAX_VALORES_REDONDEADOS_ >= 1 && PP_MAX_VALORES_REDONDEADOS_ <= 20,
    "el tope tiene que estar entre 1 y 20, y es " + PP_MAX_VALORES_REDONDEADOS_);
});

// =============================================================================
// LA COLUMNA AUSENTE: EL 23502 QUE EL SANEO DE TIPOS NO CUBRIA
// =============================================================================

test("las columnas que la ingesta RELLENA son exactamente las `not null` con default del DDL", () => {
  // `COLUMNAS_POR_OMISION_` se escribe a mano y su valor es lo que se manda a Postgres cuando una
  // fila no trae la clave. Si la lista se desincroniza del DDL pasa una de dos cosas, y las dos
  // son malas: o se rellena una columna que ya no existe (el RPC la levanta con su `raise` y tumba
  // la corrida entera), o se deja sin rellenar una que si existe (23502, y desde el 2026-10-06 la
  // tabla ya no se vacia pero la corrida tampoco sale buena).
  const { COLUMNAS_POR_OMISION_ } = listasDeLaIngesta();
  assert.deepEqual(Object.keys(COLUMNAS_POR_OMISION_).sort(), TABLAS_DEL_ESPEJO.slice().sort(),
    "la tabla de omisiones tiene que traer las siete tablas del espejo, ni una mas ni una menos");
  for (const tabla of TABLAS_DEL_ESPEJO) {
    assert.deepEqual(COLUMNAS_POR_OMISION_[tabla], columnasConDefaultLiteral(tabla),
      "las columnas que la ingesta rellena de " + tabla + " no son las `not null` con default del DDL");
  }
});

test("una CLAVE NATURAL `not null` sin default NO se rellena en ninguna de las siete", () => {
  // La parte de la tabla de omisiones que NO se deduce del DDL, y por eso necesita su propia prueba.
  //
  // Una clave natural es `not null` SIN default: `work_orders.ot`, `operations.operation_id`,
  // `operations.ot`, `materials.ot`, `items.codigo`, `machines.nombre`, `inventory.item`,
  // `inventory.ubicacion`, `sales_orders.folio`. A esas no se les puede inventar un valor, porque
  // el valor inventado no es "un dato que falta": es OTRA fila. Rellenar `ot` con `""` haria que
  // dos OTs sin folio colisionaran en el UNIQUE, o peor, que una OT se escribiera con el folio de
  // otra y el plan programara el material equivocado sin que nada lo diga.
  const { COLUMNAS_POR_OMISION_ } = listasDeLaIngesta();
  const naturales = {
    work_orders: ["ot"],
    operations: ["operation_id", "ot"],
    materials: ["ot"],
    items: ["codigo"],
    machines: ["nombre"],
    inventory: ["item", "ubicacion"],
    sales_orders: ["folio"],
  };
  for (const tabla of TABLAS_DEL_ESPEJO) {
    for (const col of naturales[tabla]) {
      assert.ok(!(col in COLUMNAS_POR_OMISION_[tabla]),
        tabla + "." + col + " es clave natural y el DDL no le da default: si la ingesta la rellena, " +
        "una fila sin folio se escribe con el folio de otra");
      // Y la prueba se apoya en que la ausencia es real, no en que la lista este vieja.
      assert.ok(!(col in columnasConDefaultLiteral(tabla)),
        "si el DDL le pondria un default a " + tabla + "." + col + ", hay que quitarlo de naturales " +
        "y ponerlo en la tabla de omisiones: la primera prueba lo diria con menos palabras");
    }
  }
});

test("las tres columnas que la BASE pone (id, created_at, updated_at) no estan en la de omisiones", () => {
  // `now()` y `gen_random_uuid()` no son valores que se puedan mandar en un INSERT: el instante
  // tiene que ser el de la escritura y el id tiene que ser el de la fila. Si aparecieran en la
  // tabla, el relleno congelaria el `created_at` de cada fila en el momento en que se escribio por
  // ultima vez, que es exactamente el campo que sirve para saber cuando se escribio.
  const { COLUMNAS_POR_OMISION_ } = listasDeLaIngesta();
  for (const tabla of TABLAS_DEL_ESPEJO) {
    for (const col of ["id", "created_at", "updated_at"]) {
      assert.ok(!(col in COLUMNAS_POR_OMISION_[tabla]),
        tabla + "." + col + " la pone la base en cada escritura; rellenarla la congelaria");
    }
  }
});
