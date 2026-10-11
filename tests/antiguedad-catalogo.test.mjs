// Candado de la antiguedad. MEDIDO 2026-09-30: el aviso de "Datos viejos en Supabase" decia
// que operators llevaba 70 h sin escribirse, con el disparador de updated_at YA PUESTO y
// funcionando (probado con una escritura real). El aviso seguia mintiendo por una razon sola:
// antiguedadDe pedia created_at, y created_at no se toca en un UPSERT.
//
// O sea: el arreglo del disparador estaba bien y no le faltaba nada excepto el LECTOR. Un
// arreglo correcto al que no le falta el lector es lo mas dificil de notar, porque el codigo
// que escribe esta bien y el aviso que avisa tambien parece estar.
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const boot = (await readFile(new URL("../src/web/shared/supabase-catalog-boot.js", import.meta.url), "utf8"))
  .replace(/\r\n/g, "\n");
const readerSource = await readFile(new URL("../src/web/shared/supabase-reader.js", import.meta.url), "utf8");
const ddl = (await readFile(new URL("../docs/schema-supabase-cierre-catalogos.sql", import.meta.url), "utf8"))
  .replace(/\r\n/g, "\n");

test("la antiguedad se mide con la columna de la ULTIMA escritura", () => {
  // created_at responde "cuando se creo esta tabla por primera vez". Los catalogos se
  // escriben con UPSERT, que no la toca. La pregunta util es "cuando se escribio por ultima
  // vez", y esa columna es updated_at.
  assert.match(boot, /COLUMNA_DE_ANTIGUEDAD\s*=\s*\["updated_at", "actualizado", "created_at"\]/,
    "las columnas se prueban en orden: updated_at, luego actualizado, created_at al final");
  assert.doesNotMatch(boot, /select=created_at&order=created_at\.desc/,
    "no se puede pedir created_at sola: es la del primer insert y no se mueve con un UPSERT");
  assert.match(boot, /order=\$\{columna\}\.desc/,
    "el orden tiene que ser por la columna que se pidio, si no devuelve la fila mas antigua");
});

test("una columna que la tabla no tiene NO es un fallo", () => {
  // machine_planning_overrides no tenia updated_at, y pedirla es un 400. Si eso se tratara como
  // error, la tabla se quedaria sin medir y el aviso callaria justo en la que hay que mirar.
  assert.match(boot, /if \(!r\.ok\) return null;/,
    "una columna ausente tiene que devolver null y dejar que se pruebe la siguiente");
  assert.match(boot, /for \(const columna of COLUMNA_DE_ANTIGUEDAD\)/,
    "y tiene que haber un bucle que pruebe la siguiente");
  assert.match(boot, /function antiguedadConColumna\(/,
    "la peticion se hace por columna, no una sola con la primera de la lista");
});

test("las nueve tablas de catalogo tienen updated_at y su disparador", () => {
  // MEDIDO 2026-09-30, aplicado y verificado con una escritura real (updated_at se movio,
  // actualizado NO, y el UPDATE fue valor = valor). machine_planning_overrides se sumo
  // ese dia: era la unica sin updated_at, y por eso su aviso no podia funcionar.
  const disparadores = [...ddl.matchAll(/create trigger trg_tocar_updated_at before update on public\.(\w+)/g)].map((m) => m[1]);
  const esperadas = ["article_configurations", "calendar_exceptions", "capabilities",
    "machine_planning_overrides", "matrix", "operators", "ot_configurations", "subcontracts", "tools"];
  assert.deepEqual(disparadores.slice().sort(), esperadas.slice().sort(),
    "los disparadores tienen que ser las nueve tablas de catalogo, ni una mas ni una menos");
  assert.match(ddl, /machine_planning_overrides/,
    "machine_planning_overrides tiene que estar: es la que uso actualizado y quedaba fuera");
});

test("el DDL explica que actualizado NO se mueve con un UPSERT", () => {
  // La razon por la que esa tabla necesita updated_at: el escritor le manda actualizado, y eso
  // si se lee, pero un UPSERT de la PAGINA no lo manda, asi que actualizado solo se mueve si la
  // ingesta toca esa fila. updated_at con el disparador se mueve con los dos escritores.
  assert.match(ddl, /actualizado/,
    "la columna actualizado tiene que seguir nombrada en el DDL, es la que la pagina manda");
  assert.match(ddl, /tocar_updated_at/,
    "y la regla tiene que ser la del disparador, que es la que cubre a los dos escritores");
});

// ---------------------------------------------------------------------------
// RULE-SUP-074. El sondeo de antiguedad consultaba la REBANADA DE ESTADO como si
// fuera el nombre de la tabla. MEDIDO 2026-10-11 en produccion: la consola se llenaba
// de 404 de /rest/v1/operatorCapacity, /rest/v1/hiddenCapabilities, /rest/v1/cts...
// (claves de `catalogs`, no tablas) y, peor, el aviso de "Datos viejos" NUNCA veia esos
// catalogos. La tabla real viene en el mapa rebanada->tabla que ahora publica el lector.
function leerYArrancar() {
  const pedidas = [];
  const sondeos = [];
  const contenido = { operators: [{ operador: "A", minutos_capacidad: 10 }] };
  const contexto = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    JSON, Object, Array, Promise, Date, String, Number, Boolean, Error, encodeURIComponent, setTimeout, clearTimeout, AbortController,
    fetch: async (url) => {
      const texto = String(url);
      const tabla = texto.split("/rest/v1/")[1].split("?")[0];
      const params = new URLSearchParams(texto.split("?")[1] || "");
      const esSondeo = params.get("select") === "updated_at";
      pedidas.push(tabla);
      if (esSondeo) sondeos.push(tabla);
      const filas = esSondeo ? [{ updated_at: "2026-10-11T00:00:00.000Z" }] : (contenido[tabla] || []);
      return { ok: true, status: 200, headers: { get: () => "" }, json: async () => filas };
    },
    PPSupabaseAuth: { token: async () => "jwt-de-prueba" },
  };
  contexto.globalThis = contexto;
  vm.createContext(contexto);
  vm.runInContext(readerSource, contexto, { filename: "supabase-reader.js" });
  contexto.PPSupabaseReader.configure({ url: "https://ejemplo.supabase.co", anonKey: "publicable-de-pruebas" });
  vm.runInContext(boot, contexto, { filename: "supabase-catalog-boot.js" });
  return { contexto, pedidas, sondeos };
}

test("cada rebanada de catalogs declara su tabla de origen, y es una tabla que el lector pide (RULE-SUP-074)", async () => {
  const { contexto, pedidas } = leerYArrancar();
  const leido = await contexto.PPSupabaseReader.readCatalogs();
  const fuentes = contexto.PPSupabaseReader.FUENTES_DE_CATALOGO;
  const rebanadas = Object.keys(leido.catalogs);
  assert.ok(rebanadas.length >= 20, `el lector devolvio ${rebanadas.length} rebanadas`);
  for (const rebanada of rebanadas) {
    assert.ok(fuentes[rebanada], `${rebanada} no tiene tabla de origen en FUENTES_DE_CATALOGO`);
  }
  // Toda tabla de origen tiene que ser una tabla que el lector de verdad pide: si el mapa
  // nombra una tabla que no existe, el 404 vuelve por la puerta de atras.
  const tablasPedidas = new Set(pedidas);
  for (const tabla of Object.values(fuentes)) {
    assert.ok(tablasPedidas.has(tabla), `la fuente ${tabla} no es una tabla que el lector pida`);
  }
});

test("el sondeo de antiguedad golpea la tabla real, nunca la rebanada de estado (RULE-SUP-074)", async () => {
  const { contexto, sondeos } = leerYArrancar();
  const leido = await contexto.PPSupabaseReader.readCatalogs();
  const fuentes = contexto.PPSupabaseReader.FUENTES_DE_CATALOGO;
  const tablasEsperadas = [...new Set(Object.keys(leido.catalogs).map((rebanada) => fuentes[rebanada]))].sort();
  sondeos.length = 0;
  const informe = await contexto.PPCatalogBoot.correr();
  // Exactamente una peticion por TABLA (no por rebanada: las cuatro de operador son una).
  assert.deepEqual(sondeos.slice().sort(), tablasEsperadas,
    "el sondeo tiene que pedir cada tabla de origen una sola vez");
  // Y ninguno de los nombres inventados que generaban los 404.
  for (const malo of ["operatorCapacity", "operatorPerformance", "operatorProfiles", "hiddenCapabilities",
    "configuredCapabilities", "capacityModes", "cts", "operationCatalog", "otTypes", "toolCatalog",
    "calendarExceptions", "otConfigurations", "articleConfigurations", "machines", "matrixFull"]) {
    assert.equal(sondeos.includes(malo), false, `no puede sondearse ${malo}: es una rebanada, no una tabla`);
  }
  // El informe se indexa por tabla, que es la pregunta que el aviso contesta.
  assert.ok(informe.viejo.operators, "operators (la tabla) tiene que traer su antiguedad");
  assert.equal(informe.viejo.operatorCapacity, undefined, "la rebanada no puede aparecer como tabla");
});
