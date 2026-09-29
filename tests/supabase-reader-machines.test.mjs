import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

/**
 * La pagina puede APARTAR una maquina que NetSuite da por activa (decision del
 * usuario 2026-09-29, RULE-SUP-017). El flag no va en `machines` —esa tabla la
 * reescribe entera el RESTlet 2246 cada 15 minutos y se llevaria cualquier
 * columna de la app— sino en `machine_planning_overrides`.
 *
 * Aqui se prueba la UNION de las dos: `machines` trae la verdad de NetSuite
 * (entitygroup.isinactive) y la tabla del override trae la decision de la
 * planificacion, y el lector tiene que combinarlas en la bandera EFECTIVA
 * `active` que consume el frontend. Si la union se rompe por una diferencia de
 * mayusculas o espacios, la maquina apartada se volveria a agendar sola: el
 * fallo es silencioso y por eso queda fijo aqui.
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
  const leido = await reader.readCatalogs({ tables: ["machines", "machine_planning_overrides"] });
  return leido.catalogs.machines;
}

test("la bandera efectiva de una maquina es NetSuite MENOS lo que la planificacion aparto", async () => {
  const lista = await maquinas({
    machines: [
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
    machines: [{ nombre: "ab11 : troquelado", activa: true }],
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
    machines: [{ nombre: "GH44 : TROQUEL", activa: true }],
    machine_planning_overrides: [{ machine_nombre: "otra", excluida: true }],
  });
  assert.equal(lista.length, 1);
  assert.equal(lista[0].active, true);
  assert.equal(lista[0].excluded, false);
});

test("sin la tabla del override el lector sigue entregando maquinas utilizables", async () => {
  // La tabla todavia NO existe en el proyecto (falta aplicar el DDL de cierre):
  // readCatalogs la reporta en `errors` y el mapeo no puede romperse.
  const { reader } = lector({ machines: [{ nombre: "AB11 : TROQUELADO", activa: true }] });
  const leido = await reader.readCatalogs({ tables: ["machines", "machine_planning_overrides"] });
  assert.equal(leido.catalogs.machines.length, 1);
  assert.equal(leido.catalogs.machines[0].active, true);
  assert.equal(leido.errors.machine_planning_overrides, "Supabase machine_planning_overrides: HTTP 404");
  assert.ok(leido.missing.includes("machine_planning_overrides"));
});

test("el override NO puede forzar el uso de una maquina que NetSuite da por inactiva", async () => {
  // Solo se autorizo APARTAR. Si alguien pone excluida=false en una maquina
  // inactiva, sigue sin usarse: la direccion contraria no existe.
  const lista = await maquinas({
    machines: [{ nombre: "EF33 : ENSAMBLE", activa: false }],
    machine_planning_overrides: [{ machine_nombre: "EF33 : ENSAMBLE", excluida: false }],
  });
  assert.equal(lista[0].active, false);
});

test("el lector pide machine_planning_overrides entre las tablas de catalogo", async () => {
  const { reader, pedido } = lector({ machines: [], machine_planning_overrides: [] });
  await reader.readCatalogs();
  assert.ok(pedido.includes("machines"), "machines debe seguir en la lista de lectura");
  assert.ok(
    pedido.includes("machine_planning_overrides"),
    "si no se pide, la columna EXCLUIDA nunca llega a la pagina y el toggle no hace nada"
  );
  assert.equal(reader.MAPPING_GAPS.machines, undefined, "la union de maquinas ya no es un hueco de mapeo");
});
