
// MEDIDO 2026-10-01: la lectura de las 25 tablas paso a exigir sesion (schema-supabase-login-correo.sql),
// pero tres DDL del repo seguian declarando `create policy "lectura_web" ... to anon`, y el de
// cierre se aplico DESPUES del de login y reabrio machine_planning_overrides. Reaplicar cualquiera de
// los tres vuelve a abrir lo que se cerro, sin error y sin aviso.
//
// Este guard mira TODO el DDL del repo y falla si queda un `create policy "lectura_web"`. La razon de
// que sea de archivo entero y no de una tabla: el defecto no estaba en una tabla, estaba en que tres
// archivos declaraban politicas que se contradicen y no habia nadie que los comparara.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const RAIZ = path.resolve(import.meta.dirname, "..");

test("ningun DDL del repo abre lectura a anon: la pagina exige sesion", () => {
  const archivos = readdirSync(path.join(RAIZ, "docs")).filter((f) => f.endsWith(".sql"));
  const culpables = [];
  for (const f of archivos) {
    const txt = readFileSync(path.join(RAIZ, "docs", f), "utf8");
    for (const linea of txt.split("\n")) {
      // Solo codigo: una linea de comentario que nombre la politica no es una politica.
      const codigo = linea.replace(/--.*$/, "");
      if (/create\s+policy\s+"?lectura_web"?/i.test(codigo)) {
        culpables.push(`docs/${f}: ${linea.trim()}`);
      }
    }
  }
  assert.deepEqual(culpables, [],
    "estas sentencias abririan la lectura a cualquiera sin sesion:\n" + culpables.join("\n"));
});

test("toda politica de lectura que quede en el DDL es para authenticated", () => {
  const archivos = readdirSync(path.join(RAIZ, "docs")).filter((f) => f.endsWith(".sql"));
  const paraAnon = [];
  for (const f of archivos) {
    const txt = readFileSync(path.join(RAIZ, "docs", f), "utf8");
    for (const linea of txt.split("\n")) {
      const codigo = linea.replace(/--.*$/, "");
      if (/create\s+policy/i.test(codigo) && /\bto\s+anon\b/i.test(codigo)) {
        paraAnon.push(`docs/${f}: ${linea.trim()}`);
      }
    }
  }
  assert.deepEqual(paraAnon, [],
    "estas politicas son para anon:\n" + paraAnon.join("\n"));
});
