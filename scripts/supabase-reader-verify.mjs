#!/usr/bin/env node
// Sonda de SOLO LECTURA del lector del frontend (src/web/shared/supabase-reader.js), fase 3 de
// docs/plan-migracion-supabase.md. Prueba el MISMO codigo que se inyecta en la pagina de GitHub
// Pages, contra el Supabase real, con la clave PUBLICABLE (cliente): es el camino que usara la web.
//
//   $env:SUPABASE_URL = "https://<ref>.supabase.co"
//   $env:SUPABASE_ANON_KEY = "<clave publicable del cliente>"
//   node scripts/supabase-reader-verify.mjs
//
// Tambien acepta --url= y --key=. Sin configuracion sale con codigo 0 y avisa (no es un fallo del
// lector: es que no hay credencial). Con configuracion, si una tabla esperada falla o viene vacia,
// sale con codigo 1. No imprime ninguna clave.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function flag(name) {
  const prefijo = `--${name}=`;
  const encontrado = process.argv.slice(2).find((arg) => arg.startsWith(prefijo));
  return encontrado ? encontrado.slice(prefijo.length) : "";
}

const url = (flag("url") || process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const anonKey = flag("key") || process.env.SUPABASE_ANON_KEY || "";

function mask(value) {
  const texto = String(value || "");
  if (texto.length <= 8) return texto ? "(corta)" : "";
  return `${texto.slice(0, 4)}...${texto.slice(-4)} (${texto.length} car.)`;
}

if (!url || !anonKey) {
  console.log("Lector de Supabase: SIN CONFIGURAR.");
  console.log("Pasa SUPABASE_URL y SUPABASE_ANON_KEY (o --url/--key) para probarlo de verdad.");
  console.log("Sin credencial el lector queda apagado y la pagina sigue por el puente de Apps Script.");
  process.exit(0);
}

await import(pathToFileURL(path.join(root, "src", "web", "shared", "supabase-reader.js")).href);
const reader = globalThis.PPSupabaseReader;
if (!reader) {
  console.error("El modulo no expuso PPSupabaseReader");
  process.exit(1);
}

const estado = reader.configure({ url, anonKey });
console.log(`Lector de Supabase: ${estado.url} (clave ${mask(anonKey)})`);
console.log(`Configurado: ${estado.configured}`);

let fallos = 0;

// 1) Estado por tabla (conteos reales).
const status = await reader.status();
console.log("\n== status ==");
for (const [tabla, info] of Object.entries(status.tables).sort()) {
  if (info.error) {
    console.log(`  ${tabla.padEnd(24)} ERROR ${info.error}`);
    fallos += 1;
  } else {
    console.log(`  ${tabla.padEnd(24)} ${info.count} filas`);
  }
}

// 2) Lectura + mapeo de catalogos (el codigo que correra en Pages).
const slice = await reader.readCatalogs();
console.log("\n== catalogs ==");
const c = slice.catalogs;
console.log(`  operators              ${c.operators.length}`);
console.log(`  configuredCapabilities ${c.configuredCapabilities.length}`);
console.log(`  hiddenCapabilities     ${c.hiddenCapabilities.length}`);
console.log(`  operationCatalog       ${c.operationCatalog.length}`);
console.log(`  matrix (capacidades)   ${Object.keys(c.matrix).length}`);
console.log(`  machines               ${c.machines.length}  (muestra: ${JSON.stringify(c.machines[0] || null)})`);
console.log(`  otTypes                ${c.otTypes.length}`);
console.log(`  subcontracts           ${c.subcontracts.length}`);
console.log(`  cts                    ${c.cts.length}`);
console.log(`  workOrders             ${slice.workOrders.length}`);
console.log(`  materials              ${slice.materials.length}  (muestra: ${JSON.stringify(slice.materials[0] || null)})`);

console.log("\n== faltantes (vacias en Supabase: siguen por el puente) ==");
console.log(`  ${slice.missing.join(", ") || "(ninguna)"}`);

if (Object.keys(slice.errors).length) {
  console.log("\n== errores ==");
  for (const [tabla, error] of Object.entries(slice.errors)) console.log(`  ${tabla}: ${error}`);
  fallos += Object.keys(slice.errors).length;
}

// 3) Invariante del mapeo: configuredCapabilities debe caber en capacityModes y las claves de la
//    matriz deben existir en el catalogo. Si esto falla, el shape no es el que espera la app.
const sinModo = c.configuredCapabilities.filter((key) => !(key in c.capacityModes));
if (sinModo.length) {
  console.log(`\nERROR: ${sinModo.length} capacidades configuradas sin capacityModes (ej. ${sinModo[0]})`);
  fallos += 1;
}
console.log(`\nHuecos de mapeo declarados: ${Object.keys(reader.MAPPING_GAPS).join(", ")}`);

if (fallos) {
  console.error(`\nSonda del lector: ${fallos} problema(s).`);
  process.exit(1);
}
console.log("\nSonda del lector: OK.");
