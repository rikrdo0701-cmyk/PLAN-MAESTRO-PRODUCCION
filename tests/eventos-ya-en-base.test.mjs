// Candado de RULE-SUP-076. MEDIDO 2026-10-11 en produccion: el guardado del plan
// avisaba "se omitieron 5898 evento(s) del log" con un plan de ~6.300 eventos.
//
// LA CAUSA, que no era el tope sino su alcance. `eventosEnviados` (supabase-writer.js)
// es el conjunto de ids de evento "ya mandados", y era de la PAGINA: se vaciaba al
// recargar. Cada recarga volvia a mandar los MISMOS primeros 400 eventos, y los que
// pasaban del tope solo salian si se guardaba ~16 veces en la MISMA sesion. O sea que
// el tope de 400 lograba que el log NO avanzara con el uso normal (un guardado y
// recargar).
//
// EL ARREGLO. Antes de armar el payload, el escritor le pide al LECTOR los ids que
// `operation_events` ya tiene para las OTs del plan (PPSupabaseReader.readEventIds) y
// los marca en `eventosEnviados`: asi "ya escrito" quiere decir "ya esta en la base", el
// guardado manda solo lo que falta y el aviso de omision cuenta solo lo NUEVO.
//
// QUE SE COMPRUEBA AQUI. (1) El lector arma bien el `ot=in.(...)`, pagina y no repite.
// (2) El escritor no reenvia lo que el lector dice que ya esta. (3) Pregunta una sola vez
// por sesion. (4) Si la lectura falla, el guardado SIGUE y lo dice: esto es una
// optimizacion, no un requisito para guardar.
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const writerSource = await readFile(new URL("../src/web/shared/supabase-writer.js", import.meta.url), "utf8");
const readerSource = (await readFile(new URL("../src/web/shared/supabase-reader.js", import.meta.url), "utf8"))
  .replace(/\r\n/g, "\n");

const URL_FALSA = "https://ejemplo.supabase.co";
const CLAVE_FALSA = "sb_publishable_no-real";
const JWT_FALSO = "jwt.eyJzdWIiOiJ1dWlkLWRlLXBydWViYSJ9.firma";

function contestando(status, cuerpo) {
  const texto = typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo);
  return { ok: status >= 200 && status < 300, status, text: async () => texto, json: async () => JSON.parse(texto) };
}

// ---------------------------------------------------------------------------
// EL LECTOR: readEventIds
// ---------------------------------------------------------------------------

/** Levanta el lector con un fetch de mentira que anota cada URL y contesta filas. */
function lector({ responder }) {
  const llamadas = [];
  const contexto = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    JSON, Object, Array, Promise, Date, String, Number, Boolean, Error, encodeURIComponent, setTimeout, clearTimeout, AbortController,
    fetch: async (url) => {
      const texto = String(url);
      llamadas.push(texto);
      const filas = responder(texto, llamadas.length);
      return { ok: true, status: 200, headers: { get: () => "" }, json: async () => filas };
    },
    PPSupabaseAuth: { token: async () => "jwt-de-prueba" },
  };
  contexto.globalThis = contexto;
  vm.createContext(contexto);
  vm.runInContext(readerSource, contexto, { filename: "supabase-reader.js" });
  contexto.PPSupabaseReader.configure({ url: URL_FALSA, anonKey: CLAVE_FALSA });
  return { reader: contexto.PPSupabaseReader, llamadas };
}

test("readEventIds pide por ot=in.(...) y devuelve los ids (RULE-SUP-076)", async () => {
  const { reader, llamadas } = lector({ responder: () => [{ id: "a" }, { id: "b" }] });
  const ids = await reader.readEventIds(["3177", "3631"]);
  assert.deepEqual([...ids], ["a", "b"]);
  assert.equal(llamadas.length, 1, "una peticion cuando todo cabe en una pagina");
  const url = llamadas[0];
  assert.match(url, /\/rest\/v1\/operation_events\?/);
  assert.match(url, /select=id/, "solo se pide la clave: el payload es lo caro");
  assert.match(url, /order=id\.asc/, "sin orden estable la paginacion salta filas");
  // Los valores van entre comillas (asi el parser de PostgREST no corta una OT con
  // coma) y codificados (acentos y espacios no rompen la URL).
  assert.match(url, /ot=in\.\(%223177%22,%223631%22\)/);
  assert.match(url, /limit=1000/);
});

test("readEventIds pagina la tabla entera y no repite ids", async () => {
  const primera = Array.from({ length: 1000 }, (_, i) => ({ id: "id-" + i }));
  // La segunda pagina repite id-0 a proposito: los que ya se vieron no cuentan dos veces.
  const { reader, llamadas } = lector({ responder: (url, n) => (n === 1 ? primera : [{ id: "id-0" }, { id: "id-1000" }]) });
  const ids = await reader.readEventIds(["3177"]);
  assert.equal(llamadas.length, 2, "una pagina llena obliga a la siguiente");
  assert.match(llamadas[1], /offset=1000/);
  assert.equal(ids.length, 1001, "1000 de la primera vuelta mas 1 nueva; la repetida no cuenta");
});

test("readEventIds parte las OTs en trozos para no armar una URL enorme", async () => {
  const { reader, llamadas } = lector({ responder: () => [] });
  const ots = Array.from({ length: 60 }, (_, i) => "OT" + i);
  assert.deepEqual([...(await reader.readEventIds(ots))], []);
  assert.equal(llamadas.length, 3, "60 OTs en trozos de 25: 25 + 25 + 10");
  for (const url of llamadas) assert.match(url, /ot=in\.\(/);
});

test("readEventIds sin OTs (o solo vacias) no sale a la red", async () => {
  const { reader, llamadas } = lector({ responder: () => [] });
  assert.deepEqual([...(await reader.readEventIds([]))], []);
  assert.deepEqual([...(await reader.readEventIds(["  ", ""]))], []);
  assert.equal(llamadas.length, 0, "sin OTs no hay nada que preguntar");
});

// ---------------------------------------------------------------------------
// EL ESCRITOR: la siembra antes de armar el payload
// ---------------------------------------------------------------------------

/** El estado minimo del camino RPC: con selected_ots y operation_plan_statuses no
 *  vacios, para que el freno del vacio (RULE-SUP-021) deje llamar a plan_guardar. */
function estadoConPlan() {
  return {
    revision: 42,
    selectedOts: ["3177"],
    lockedOts: [],
    operations: [{ id: "ns-3177-1", ot: "3177", secuencia: 10, ct: "1", log: "A | B" }],
    workOrders: [],
    materials: [],
    operationPlanStatuses: {
      "OP|3177|10|1": { key: "OP|3177|10|1", ot: "3177", sequence: 10, ct: "1", status: "PLAN", origin: "draft" },
    },
  };
}

/**
 * Levanta el escritor con un lector de mentira. `readEventIds` es lo que el escritor le
 * pide a la base: si es null, el contexto NO monta PPSupabaseReader (el caso del build
 * sin lector y de las pruebas que no lo necesitan), y entonces no se siembra.
 */
function escritor({ readEventIds = null } = {}) {
  const llamadas = [];
  const siembras = [];
  const contexto = {
    console, JSON, Object, Array, Promise, Date, String, Number, Boolean, Error, encodeURIComponent,
    setTimeout, clearTimeout, AbortController, atob,
    PPSupabaseAuth: { token: async () => JWT_FALSO },
    fetch: async (url, opciones) => {
      const texto = String(url);
      const metodo = (opciones && opciones.method) || "GET";
      const tabla = texto.indexOf("/rest/v1/") >= 0 ? texto.split("/rest/v1/")[1].split("?")[0] : "";
      let cuerpo = null;
      if (opciones && opciones.body) { try { cuerpo = JSON.parse(opciones.body); } catch { cuerpo = null; } }
      llamadas.push({ url: texto, metodo, tabla, cuerpo });
      if (tabla.indexOf("rpc/plan_guardar") >= 0) {
        return contestando(200, {
          ok: true, revision: 43, actor: "uuid-de-prueba",
          tablas: { operation_events: { modo: "flujo", filas: 2 } }, ms: 5,
        });
      }
      return contestando(204, "");
    },
  };
  if (readEventIds) {
    contexto.PPSupabaseReader = {
      readEventIds: async (ots) => { siembras.push(ots.slice()); return readEventIds(ots); },
    };
  }
  contexto.globalThis = contexto;
  vm.createContext(contexto);
  vm.runInContext(writerSource, contexto, { filename: "supabase-writer.js" });
  const writer = contexto.PPSupabaseWriter;
  writer.configure({ url: URL_FALSA, anonKey: CLAVE_FALSA });
  return { writer, llamadas, siembras };
}

const payloadRpc = (llamadas) => {
  const rpc = llamadas.find((c) => c.tabla === "rpc/plan_guardar");
  assert.ok(rpc, "tiene que haber llamado a plan_guardar");
  return rpc.cuerpo.p_payload;
};

test("el guardado NO reenvia los eventos que ya estan en la base (RULE-SUP-076)", async () => {
  // Los ids que el plan va a generar, calculados SIN sembrar (el lector ausente no
  // cambia el conjunto). Es lo que la base ya tendria de un guardado anterior.
  const limpio = escritor();
  const idsYaEnLaBase = limpio.writer.armpalo(estadoConPlan(), 42).eventos.map((e) => e.id);
  assert.equal(idsYaEnLaBase.length, 2, "el log 'A | B' da dos eventos");

  const { writer, llamadas, siembras } = escritor({ readEventIds: async () => idsYaEnLaBase });
  const informe = await writer.guardar(estadoConPlan());

  assert.equal(informe.ok, true, JSON.stringify(informe));
  assert.deepEqual(JSON.parse(JSON.stringify(siembras)), [["3177"]], "se pregunta por las OTs del plan, sin repetir");
  assert.equal(payloadRpc(llamadas).operation_events.length, 0,
    "los eventos que ya estaban en la base no se vuelven a mandar");
  assert.equal(informe.avisos.some((a) => /omitieron/.test(a)), false,
    "y no se avisa de omision: no se omitio nada nuevo");
});

test("con el lector ausente el comportamiento es el de siempre: manda sus eventos", async () => {
  const { writer, llamadas } = escritor();
  const informe = await writer.guardar(estadoConPlan());
  assert.equal(informe.ok, true, JSON.stringify(informe));
  assert.equal(payloadRpc(llamadas).operation_events.length, 2, "sin lector no hay siembra y salen los dos");
});

test("la consulta de lo ya guardado se hace UNA vez por sesion", async () => {
  const { writer, siembras } = escritor({ readEventIds: async () => [] });
  await writer.guardar(estadoConPlan());
  await writer.guardar(estadoConPlan());
  assert.equal(siembras.length, 1, "no se pregunta a la base en cada guardado");
});

test("si la consulta falla, el guardado SIGUE, manda sus eventos y lo dice", async () => {
  const { writer, llamadas } = escritor({ readEventIds: async () => { throw new Error("HTTP 500"); } });
  const informe = await writer.guardar(estadoConPlan());
  assert.equal(informe.ok, true, "no se cae el guardado por no poder optimizar");
  assert.ok(informe.avisos.some((a) => /no se pudo comprobar/.test(a)), JSON.stringify(informe.avisos));
  assert.equal(payloadRpc(llamadas).operation_events.length, 2, "sin siembra vuelve a mandar los suyos");
});

test("el escritor consulta al lector ANTES de armar el payload (estructura, RULE-SUP-076)", () => {
  const iSiembra = writerSource.indexOf("await asegurarEventosSembrados(");
  const iArmado = writerSource.indexOf("const armado = armarPayload(");
  assert.ok(iSiembra > 0, "el escritor tiene que sembrar los eventos ya escritos");
  assert.ok(iArmado > iSiembra, "y tiene que hacerlo ANTES de armar el payload, o el corte no lo ve");
  assert.match(writerSource, /reader\.readEventIds\(ots\)/, "la lectura la hace el lector, no el escritor");
});
