import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

/**
 * La pagina puede APARTAR una maquina que NetSuite da por activa (decision del
 * usuario 2026-09-29, RULE-SUP-017). El flag no va en `machine_catalog` —esa tabla
 * la escribe la pagina (guardarCatalogos) y se llevaria cualquier columna de la
 * app— sino en `machine_planning_overrides`.
 *
 * Aqui se prueba la UNION de las dos: `machine_catalog` trae el catalogo manual
 * de la pagina y la tabla del override trae la decision de la planificacion, y el
 * lector tiene que combinarlas en la bandera EFECTIVA `active` que consume el
 * frontend. Si la union se rompe por una diferencia de mayusculas o espacios, la
 * maquina apartada se volveria a agendar sola: el fallo es silencioso y por eso
 * queda fijo aqui.
 *
 * MEDIDO 2026-10-01, DECISION DEL USUARIO: el catalogo de maquinas es un dato
 * MANUAL. Antes la union era `machines` (NetSuite) + `machine_planning_overrides`;
 * ahora es `machine_catalog` (manual) + `machine_planning_overrides`.
 */

const readerSource = await readFile(new URL("../src/web/shared/supabase-reader.js", import.meta.url), "utf8");

/** Levanta el lector con un fetch de mentira que devuelve `filas` por tabla. */
function lector(filas) {
  const pedido = [];
  const contexto = {
    console,
    JSON,
    Object,
    Array,
    Promise,
    Date,
    String,
    Number,
    Boolean,
    Error,
    encodeURIComponent,
    fetch: async (url) => {
      const tabla = decodeURIComponent(String(url).split("/rest/v1/")[1].split("?")[0]);
      pedido.push(tabla);
      const hay = Object.prototype.hasOwnProperty.call(filas, tabla);
      return {
        ok: hay,
        status: hay ? 200 : 404,
        json: async () => (hay ? filas[tabla] : []),
      };
    },
  };
  contexto.globalThis = contexto;
  vm.createContext(contexto);
  vm.runInContext(readerSource, contexto, { filename: "supabase-reader.js" });
  const reader = contexto.PPSupabaseReader;
  reader.configure({ url: "https://ejemplo.supabase.co", anonKey: "publicable-de-pruebas" });
  return { reader, pedido };
}

async function maquinas(filas) {
  const { reader } = lector(filas);
  const leido = await reader.readCatalogs({ tables: ["machine_catalog", "machine_planning_overrides"] });
  return leido.catalogs.machines;
}

test("la bandera efectiva de una maquina es NetSuite MENOS lo que la planificacion aparto", async () => {
  const lista = await maquinas({
    machine_catalog: [
      { nombre: "AB11 : TROQUELADO", activa: true },
      { nombre: "CD22 : PINTADO", activa: true },
      { nombre: "EF33 : ENSAMBLE", activa: false },
    ],
    machine_planning_overrides: [
      { machine_nombre: "CD22 : PINTADO", excluida: true },
      { machine_nombre: "AB11 : TROQUELADO", excluida: false },
      { machine_nombre: "EF33 : ENSAMBLE", excluida: false },
    ],
  });
  const por = Object.fromEntries(lista.map((m) => [m.id, m]));
  assert.equal(por["AB11 : TROQUELADO"].active, true, "NetSuite activa y nadie la aparto: se usa");
  assert.equal(por["CD22 : PINTADO"].active, false, "la planificacion la aparto aunque NetSuite la de activa");
  assert.equal(por["CD22 : PINTADO"].excluded, true);
  assert.equal(por["EF33 : ENSAMBLE"].active, false, "NetSuite la da inactiva: no se usa aunque nadie la aparte");
  assert.equal(por["EF33 : ENSAMBLE"].excluded, false);
});

test("la union tolera mayusculas y espacios distintos en el nombre", async () => {
  // El state normaliza a mayusculas (app.js:1345) y los entitygroup de NetSuite
  // vienen con su formato. Si la union fuera exacta, "ab11" no encontraria su
  // override y la maquina apartada se agendaria sola: fallo silencioso.
  const lista = await maquinas({
    machine_catalog: [{ nombre: "ab11 : troquelado", activa: true }],
    machine_planning_overrides: [{ machine_nombre: "  AB11 : TROQUELADO  ", excluida: true }],
  });
  assert.equal(lista.length, 1);
  assert.equal(lista[0].active, false, "el override debe encontrar a la maquina aunque el nombre no coincida exacto");
  assert.equal(lista[0].excluded, true);
  // El id que sale es el de `machines` (la verdad de NetSuite), no el del override.
  assert.equal(lista[0].id, "ab11 : troquelado");
});

test("una maquina sin fila de override se puede agendar", async () => {
  // Ausencia de fila = no apartada. Por eso el espejo escribe la fila de TODAS
  // las maquinas: para que "no hay fila" nunca signifique "nadie decidio".
  const lista = await maquinas({
    machine_catalog: [{ nombre: "GH44 : TROQUEL", activa: true }],
    machine_planning_overrides: [{ machine_nombre: "otra", excluida: true }],
  });
  assert.equal(lista.length, 1);
  assert.equal(lista[0].active, true);
  assert.equal(lista[0].excluded, false);
});

test("sin la tabla del override el lector sigue entregando maquinas utilizables", async () => {
  // La tabla todavia NO existe en el proyecto (falta aplicar el DDL de cierre):
  // readCatalogs la reporta en `errors` y el mapeo no puede romperse.
  const { reader } = lector({ machine_catalog: [{ nombre: "AB11 : TROQUELADO", activa: true }] });
  const leido = await reader.readCatalogs({ tables: ["machine_catalog", "machine_planning_overrides"] });
  assert.equal(leido.catalogs.machines.length, 1);
  assert.equal(leido.catalogs.machines[0].active, true);
  assert.equal(leido.errors.machine_planning_overrides, "Supabase machine_planning_overrides: HTTP 404");
  assert.ok(leido.missing.includes("machine_planning_overrides"));
});

test("el override NO puede forzar el uso de una maquina que NetSuite da por inactiva", async () => {
  // Solo se autorizo APARTAR. Si alguien pone excluida=false en una maquina
  // inactiva, sigue sin usarse: la direccion contraria no existe.
  const lista = await maquinas({
    machine_catalog: [{ nombre: "EF33 : ENSAMBLE", activa: false }],
    machine_planning_overrides: [{ machine_nombre: "EF33 : ENSAMBLE", excluida: false }],
  });
  assert.equal(lista[0].active, false);
});

test("el lector pide machine_planning_overrides entre las tablas de catalogo", async () => {
  const { reader, pedido } = lector({ machine_catalog: [], machine_planning_overrides: [] });
  await reader.readCatalogs();
  assert.ok(pedido.includes("machine_catalog"), "machine_catalog debe seguir en la lista de lectura");
  assert.ok(
    pedido.includes("machine_planning_overrides"),
    "si no se pide, la columna EXCLUIDA nunca llega a la pagina y el toggle no hace nada"
  );
  assert.equal(reader.MAPPING_GAPS.machine_catalog, undefined, "la union de maquinas ya no es un hueco de mapeo");
});

// LA PRUEBA QUE MUERDE. MEDIDO 2026-10-01, DECISION DEL USUARIO: el catalogo de maquinas es
// un dato MANUAL, no informacion de ingesta (RULE-MAQ-004). Antes salia de `machines`, que
// el RESTlet 2246 escribia desde NetSuite cada 15 minutos.
//
// POR QUE HACE FALTA UNA PRUEBA Y NO ALCANZA CON QUE EL CODIGO LO DIGA. El resto de este
// archivo comprobaba que la UNION funciona, y esa union funciona igual de bien con las dos
// tablas: el mapeo no distingue de donde vienen las filas. Si alguien revierte solo la
// FUENTE, todas esas pruebas siguen verdes y la pagina vuelve a leer una tabla que la
// ingestion reescribe. Lo unico que se entera es que el catalogo dejo de ser manual, y eso
// no se ve hasta que alguien edita una maquina y a los 15 minutos desaparece.
//
// Las dos mitades: el lector NO pide `machines` para el catalogo, y el escritor SI escribe
// `machine_catalog`.
test("el catalogo de maquinas sale de machine_catalog, y NO de machines (que es de ingesta)", async () => {
  const { reader, pedido } = lector({
    machine_catalog: [{ nombre: "Dobladora 209", activa: true }],
    machine_planning_overrides: [],
  });
  const leido = await reader.readCatalogs();

  // Una: la tabla manual se lee y trae el catalogo.
  assert.ok(pedido.includes("machine_catalog"), "machine_catalog tiene que estar en la lectura");
  assert.equal(leido.catalogs.machines.length, 1);
  assert.equal(leido.catalogs.machines[0].id, "Dobladora 209",
    "el nombre de la maquina sale de machine_catalog, que es el catalogo manual");

  // Dos: `machines` NO se pide. Si se pidiera, el catalogo volveria a depender de la ingesta.
  // Este es el que muerde: revertir la fuente deja de dar error y solo cambia de tabla.
  assert.ok(!pedido.includes("machines"),
    "el catalogo NO puede leer `machines`: esa tabla la reescribe entera el RESTlet 2246 cada 15 minutos (RULE-MAQ-004)");
});

test("la pagina escribe machine_catalog: es la unica que escribe el catalogo manual", async () => {
  const escritor = await readFile(new URL("../src/web/shared/supabase-writer.js", import.meta.url), "utf8");
  const ingreso = await readFile(new URL("../src/server/19-appscript-ingesta-supabase.js", import.meta.url), "utf8");

  // El escritor declara machine_catalog con su clave, que es lo que hace que el guardado
  // de catalogos la escriba de verdad y no solo la mencione.
  assert.match(escritor, /tabla:\s*["']machine_catalog["']/,
    "guardarCatalogos tiene que escribir machine_catalog: es lo que hace que el catalogo sea manual");
  assert.match(escritor, /clave:\s*["']nombre["']/,
    "machine_catalog se identifica por nombre, que es lo que hace unique su indice");

  // Y la pagina NO escribe `machines`: si lo hiciera, serian dos escritores peleandose la
  // tabla (RULE-SUP-010, un solo escritor por repositorio).
  assert.doesNotMatch(escritor, /tabla:\s*["']machines["']/,
    "la pagina no escribe machines: esa tabla es del RESTlet 2246. El catalogo manual es machine_catalog");

  // Y la ingesta sigue escribiendo `machines` (el dato de NetSuite), pero ESO ya no es el
  // catalogo de la pagina. Se afirma para que quede escrito de donde sale cada cosa.
  assert.match(ingreso, /centros:\s*\{\s*tabla:\s*'machines'/,
    "la ingesta sigue escribiendo `machines` como dato de NetSuite; ya no alimenta el catalogo de la pagina");
});

test("machine_catalog tiene su DDL con la tabla, el indice unico y la migracion", async () => {
  // El DDL tiene que dejar el estado ACTUAL de la base, no el que conocia cuando se escribio
  // (RULE-SUP-037). Estas son las tres cosas sin las cuales el cambio no funciona: la tabla
  // no existe, el ON CONFLICT no tiene indice (42P01, medido), o las 202 maquinas que ya
  // estan en uso se pierden.
  const ddl = await readFile(new URL("../docs/schema-machine-catalog.sql", import.meta.url), "utf8");
  assert.match(ddl, /create table if not exists public\.machine_catalog/i, "falta la tabla");
  assert.match(ddl, /create unique index if not exists machine_catalog_nombre_uniq/i,
    "falta el indice unico por nombre: sin el, ON CONFLICT (nombre) da 42P01");
  assert.match(ddl, /insert into public\.machine_catalog[\s\S]*select[\s\S]*from public\.machines/i,
    "falta la migracion: sin copiar las maquinas que ya existen, el catalogo se queda vacio");
  assert.match(ddl, /on conflict \(nombre\) do nothing/i,
    "la migracion tiene que ser idempotente: aplicarla dos veces no puede fallar ni duplicar");
  assert.match(ddl, /row level security/i, "la tabla necesita RLS, como todas las de catalogo");
});
