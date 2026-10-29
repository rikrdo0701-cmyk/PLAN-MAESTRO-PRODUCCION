// La lectura de Supabase tiene que occurir DE VERDAD, no solo estar en el bundle.
//
// QUE PASABA. MEDIDO 2026-09-29: src/web/shared/supabase-catalog-boot.js leia
// `lector.configured` y `lector.config`, pero supabase-reader.js NO exportaba
// ninguna de las dos cosas: exporta `isConfigured()` y nada mas. Con
// `lector.configured` en undefined, la primera linea del arranque era
// `if (!lector || !lector.configured || ...) return { activo: false }`, o sea que
// la lectura se apagaba siempre. MEDIDO: ni un solo catalogo llego nunca desde
// Supabase, aunque el modulo estuviera desplegado y en su sitio en el bundle.
//
// POR QUE NO LO ATRAPO NINGUN TEST. tests/supabase-catalog-boot.test.mjs usaba un
// doble que exponia `configured` y `config`, o sea un doble escrito a la medida de
// mi suposicion equivocada. El test comprobaba que el modulo llamara a lo que yo
// creia que el lector tenia, y los dos eran erroneos a la vez, asi que passaba. Un
// doble que reproduce el error no mide nada: hay que usar el modulo real.
//
// QUE COMPRUEBA ESTE ARCHIVO. Corre el LECTOR REAL junto al ARRANQUE REAL, con un
// fetch de mentira, y comprueba que se llega a pedir las tablas. Si vuelve a haber
// un desajuste entre lo que uno llama y lo que el otro expone, este test falla.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const lector = readFileSync(new URL("../src/web/shared/supabase-reader.js", import.meta.url), "utf8");
const boot = readFileSync(new URL("../src/web/shared/supabase-catalog-boot.js", import.meta.url), "utf8");

/** Los dos modulos de verdad, con un fetch que registra a que URL se le pide. */
function conLosModulosReales({ conCredenciales = true, sesion = "buena" } = {}) {
  const pedidas = [];
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, AbortController, Promise, JSON, Date, Math, String, Number, Boolean, Object, Array, Error, RegExp,
    fetch: async (destino) => {
      const ruta = String(destino);
      pedidas.push(ruta);
      if (ruta.includes("created_at")) return { ok: true, status: 200, json: async () => [{ created_at: new Date().toISOString() }] };
      return { ok: true, status: 200, json: async () => [] };
    },
    document: {
      readyState: "complete", getElementById: () => null,
      createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }),
      head: { appendChild() {} }, body: { appendChild() {} },
    },
    // MEDIDO 2026-09-29: el arranque real exige sesion ANTES de leer (si no, la
    // Data API responde 200 con cero filas y la pagina creeria que la base esta
    // vacia). Sin este doble, el arranque se apagaba con "sin sesion" y este test
    // volvia a pasar sin haber pedido una sola tabla: el mismo falso verde que
    // este archivo existe para cazar.
    PPSupabaseAuth: sesion === "ninguna" ? null : { token: async () => (sesion === "caducada" ? Promise.reject(new Error("JWT expirado")) : "jwt-de-prueba") },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(lector.replace("__PP_SUPABASE_URL__", conCredenciales ? "https://x.supabase.co" : "").replace("__PP_SUPABASE_ANON_KEY__", conCredenciales ? "sb_publishable_x" : ""), ctx);
  vm.runInContext(boot, ctx);
  return { ctx, pedidas };
}

test("el lector REAL y el arranque REAL se entienden: la lectura ocurre", async () => {
  const { ctx, pedidas } = conLosModulosReales();
  assert.equal(typeof ctx.PPSupabaseReader, "object", "el lector no se instalo");
  assert.equal(typeof ctx.PPCatalogBoot, "object", "el arranque no se instalo");

  const informe = await ctx.PPCatalogBoot.correr();

  // ESTA es la comprobacion que hacia falta: no que el modulo este, sino que se
  // haya PEDIDO algo. Un informe 'activo: false' con cero peticiones es exactamente
  // el fallo que se dio.
  assert.equal(informe.activo, true, `el arranque se apago: ${informe.motivo || "sin motivo"}`);
  assert.ok(pedidas.length > 0, "no se pidio NINGUNA tabla: el arranque se apago antes de leer");
  assert.ok(pedidas.some((p) => p.includes("rest/v1/")), `las peticiones no son de la Data API: ${JSON.stringify(pedidas.slice(0, 3))}`);
});

test("sin sesion el arranque REAL no pide NINGUNA tabla, y lo dice", async () => {
  // El otro falso verde: con el token del anon la Data API responde HTTP 200 con
  // cero filas en las 22 tablas, y eso es indistinguible de una base vacia. Por eso
  // el arranque pide sesion antes, y por eso esto se comprueba con los modulos REALES.
  const { ctx, pedidas } = conLosModulosReales({ sesion: "ninguna" });
  const informe = await ctx.PPCatalogBoot.correr();
  assert.equal(informe.activo, false);
  assert.match(String(informe.motivo), /sesion/);
  assert.deepEqual(pedidas, [], "sin sesion no debe leer: la respuesta vacia pareceria una base vacia");
});

test("con una sesion caducada el arranque REAL tampoco lee", async () => {
  const { ctx, pedidas } = conLosModulosReales({ sesion: "caducada" });
  const informe = await ctx.PPCatalogBoot.correr();
  assert.equal(informe.activo, false);
  assert.match(String(informe.motivo), /sesion/);
  assert.deepEqual(pedidas, []);
});

test("el lector real exporta lo que el arranque le pide, y se fija por nombre", () => {
  // La asercion de arriba ya lo caza en ejecucion. Esta la deja escrita, porque un
  // test que depende de que otro test pase es fragil: si alguien cambia el nombre
  // y el orden, el primero puede seguir en verde por el motivo equivocado.
  const exporta = lector.slice(lector.lastIndexOf("return {"));
  for (const nombre of ["isConfigured", "config", "readCatalogs", "readTable"]) {
    assert.match(exporta, new RegExp(`\\b${nombre}\\b`), `el lector deja de exportar ${nombre} y el arranque lo necesita`);
  }
  // Y el arranque no invoca nombres que el lector no tenga.
  for (const llamada of boot.matchAll(/lector\.([A-Za-z_$][\w$]*)/g)) {
    const nombre = llamada[1];
    if (["config", "isConfigured", "readCatalogs", "readTable", "countTable", "status", "TABLES", "CATALOG_TABLES", "MAPPING_GAPS", "normalizeKey", "normalizeCapabilityKey", "configure"].includes(nombre)) continue;
    assert.match(exporta, new RegExp(`\\b${nombre}\\b`), `el arranque llama lector.${nombre} y el lector no lo expone`);
  }
});

test("sin credenciales el arranque se apaga y NO pide nada, y dice por que", async () => {
  const { ctx, pedidas } = conLosModulosReales({ conCredenciales: false });
  const informe = await ctx.PPCatalogBoot.correr();
  assert.equal(informe.activo, false);
  assert.match(informe.motivo, /no configurado/i);
  assert.deepEqual(pedidas, [], "sin credenciales no debe salir a la red");
});
