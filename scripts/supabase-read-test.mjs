/**
 * Test de LECTURA de Supabase. No escribe nada: solo comprueba que el proyecto responde y que
 * se pueden leer filas de una tabla por la Data API.
 *
 * DOS HOSTS, NO UNO (la confusion mas comun con estos connection strings)
 *   Data API / panel / auth:  https://<ref>.supabase.co        <- SIN prefijo db.
 *   Postgres directo 5432:    db.<ref>.supabase.co             <- CON prefijo db.
 * Pegar el host con "db." en la URL de la API es el error tipico: ese host no publica registro A
 * (en proyectos con IPv4 desactivado solo existe AAAA) y el resultado es un ENOTFOUND que parece
 * "no hay internet" cuando el proyecto esta perfectamente bien. Por eso este test separa --url
 * (API) de --db-host (Postgres) y, si un nombre no resuelve, consulta un resolver publico para
 * distinguir NODATA de NXDOMAIN en lugar de adivinar.
 *
 * POR QUE ESTE SCRIPT Y NO UNA INTEGRACION EN EL PRODUCTO
 * El proyecto no tiene integracion en el producto (ver .project-memory/integrations.json,
 * INT-SUPABASE): hoy el unico consumidor es este test. Por eso NO se hardcodea ninguna clave y
 * TODO se resuelve por entorno o bandera. La contrasena y la clave anon NO se guardan en el
 * repo y no se imprimen: solo se enmascaran en el reporte.
 *
 * QUE MIDE, en orden (cada paso es independiente; uno caido no oculta los demas):
 *   0. dns             el host de la API resuelve; si no, se clasifica con DoH y se dice si el
 *                      nombre no existe (NXDOMAIN) o no tiene registro A (NODATA).
 *   1. auth.health     GET {url}/auth/v1/health        -> el proyecto existe y GoTrue responde.
 *   2. rest.openapi    GET {url}/rest/v1/              -> la Data API responde y que tablas
 *                                                       estan expuestas (Data API settings).
 *   3. plan.esquema    contrasta lo expuesto contra docs/schema-supabase.sql (el esquema
 *                      objetivo de docs/plan-migracion-supabase.md): cuantas tablas del plan
 *                      existen, cuales faltan y cuales sobran, es decir en que fase de la
 *                      migracion esta el proyecto.
 *   4. rest.table      GET {url}/rest/v1/{tabla}       -> lectura de filas reales con
 *                                                       count exacto, columnas y una muestra.
 *   5. postgres        conexion directa (opcional)    -> version de Postgres y tablas de public.
 *                                                       Requiere SUPABASE_DB_PASSWORD y el
 *                                                       paquete `pg`; si falta alguno se salta
 *                                                       con el motivo, no se oculta.
 *
 * USO
 *   node scripts/supabase-read-test.mjs --list
 *   node scripts/supabase-read-test.mjs --table=work_orders --limit=5
 *   node scripts/supabase-read-test.mjs --table=work_orders --columns=id,ot,status
 *
 * ENTORNO
 *   SUPABASE_PROJECT_REF     xtgtfjcwxcoxvixholpj      (equivale a --ref=)
 *   SUPABASE_URL             https://<ref>.supabase.co  (equivale a --url=)
 *   SUPABASE_ANON_KEY        clave anon publica del proyecto (equivale a --key=)
 *   SUPABASE_SERVICE_ROLE_KEY clave service_role; solo si hay RLS que la requiere
 *   SUPABASE_TABLE           tabla a leer (equivale a --table=)
 *   SUPABASE_SCHEMA          esquema, por omision public (--schema=)
 *   SUPABASE_DB_HOST         db.<ref>.supabase.co (equivale a --db-host=)
 *   SUPABASE_DB_PASSWORD     contrasena del usuario postgres, solo para el paso 4
 *
 * SALIDA
 *   Tabla por consola y artifacts/supabase-read-<sello>.json. Codigo de salida: 0 = todo paso
 *   evaluable paso; 1 = hay fallos; 3 = no hay credenciales, la corrida se salta (no es un fallo
 *   del proyecto). Con --list se imprime el catalogo de tablas expuestas y se sale.
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { lookup } from "node:dns/promises";
import path from "node:path";

const DEFAULT_PROJECT_REF = "xtgtfjcwxcoxvixholpj";
const TIMEOUT_MS = 30000;
const root = path.resolve(".");
const artifactsDir = path.join(root, "artifacts");

const args = process.argv.slice(2);
const flag = (name, fallback = "") => {
  const hit = args.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = (name) => args.includes(`--${name}`);

const projectRef = flag("ref") || process.env.SUPABASE_PROJECT_REF || DEFAULT_PROJECT_REF;
// Si el host de Postgres se pega donde va la URL de la API, se quita el prefijo db. en lugar de
// terminar con un ENOTFOUND que no explica nada.
const rawApiUrl = String(flag("url") || process.env.SUPABASE_URL || `https://${projectRef}.supabase.co`).replace(/\/+$/, "");
const baseUrl = rawApiUrl.replace(/^(https?:\/\/)db\./, "$1");
const urlWasFixed = baseUrl !== rawApiUrl;
const dbHost = flag("db-host") || process.env.SUPABASE_DB_HOST || (projectRef.startsWith("db.") ? projectRef : `db.${projectRef}.supabase.co`);
const key = flag("key") || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const keyKind = (process.env.SUPABASE_SERVICE_ROLE_KEY && !flag("key") && !process.env.SUPABASE_ANON_KEY) ? "service_role" : "anon";
const schema = flag("schema") || process.env.SUPABASE_SCHEMA || "public";
const table = flag("table") || process.env.SUPABASE_TABLE || "";
const limit = Number(flag("limit", "5"));
const expectedColumns = String(flag("columns", "")).split(",").map((value) => value.trim()).filter(Boolean);

const checks = [];
const notes = [];
let failures = 0;
let skipped = 0;

function record(kind, name, detail, extra = {}) {
  const entry = { kind, name, detail, at: new Date().toISOString(), ...extra };
  checks.push(entry);
  if (kind === "fail") failures += 1;
  if (kind === "skip") skipped += 1;
  const mark = kind === "fail" ? "FALLA" : kind === "skip" ? "SIN DATOS" : kind === "warn" ? "AVISO" : "ok";
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
  return entry;
}

/** Las claves no se imprimen completas: con 6 caracteres alcanza para distinguir una de otra. */
function maskKey(value) {
  const text = String(value || "");
  if (!text) return "(sin clave)";
  return `${text.slice(0, 6)}…${text.slice(-4)} (${text.length} chars)`;
}

function headers(extra = {}) {
  const out = { accept: "application/json", ...extra };
  if (key) {
    out.apikey = key;
    out.authorization = `Bearer ${key}`;
  }
  return out;
}

/**
 * Un fallo de red y un 401 son cosas distintas: el primero dice que el proyecto no responde,
 * el segundo que la credencial falta o no tiene permisos. Se separan para que el reporte diga
 * que arreglar.
 */
async function request(url, options = {}) {
  const started = Date.now();
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* respuesta no JSON */ }
    return { ok: response.ok, status: response.status, text, json, headers: response.headers, ms: Date.now() - started, networkError: null };
  } catch (error) {
    // "fetch failed" no dice nada: la causa real (ENOTFOUND, ECONNREFUSED, TLS) viene en cause.
    const cause = error?.cause;
    return {
      ok: false, status: 0, text: "", json: null, headers: null, ms: Date.now() - started,
      networkError: [String(error?.message || error), cause ? (cause.code || cause.message || String(cause)) : ""].filter(Boolean).join(": "),
    };
  }
}

/**
 * Consulta un resolver publico por DNS-over-HTTPS para decir POR QUE no resuelve. Sin esto, un
 * ENOTFOUND local no distingue "el proyecto no existe" de "este equipo no puede resolverlo", y
 * son dos problemas opuestos: uno se arregla en la consola de Supabase y el otro en la red.
 */
async function dohLookup(host) {
  for (const endpoint of ["https://dns.google/resolve", "https://cloudflare-dns.com/dns-query"]) {
    try {
      const url = `${endpoint}?name=${encodeURIComponent(host)}&type=A`;
      const response = await fetch(url, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(10000) });
      const json = await response.json();
      const answers = (json.Answer || []).map((item) => item.data).filter(Boolean);
      // Status 0 sin respuestas = NODATA: el nombre esta en la zona pero sin registro A.
      // Status 3 = NXDOMAIN: el nombre no existe.
      const kind = json.Status === 3 ? "NXDOMAIN (el nombre no existe)" : answers.length ? "A" : "NODATA (sin registro A; tipico de IPv4 desactivado o de host equivocado)";
      return { resolver: endpoint.split("/")[2], status: Number(json.Status), kind, answers };
    } catch (error) {
      // Se intenta el siguiente resolver: que falle la red no debe hiding el diagnostico.
      if (endpoint.includes("cloudflare")) return { error: String(error?.message || error) };
    }
  }
  return { error: "ningun resolver respondio" };
}

async function checkDns() {
  const host = new URL(baseUrl).hostname;
  if (urlWasFixed) notes.push(`La URL ${rawApiUrl} traia el prefijo db.; se uso ${baseUrl} (el prefijo db. es solo del puerto 5432).`);
  let resolved = [];
  let localError = "";
  try {
    resolved = await lookup(host, { all: true });
  } catch (error) {
    localError = String(error?.code || error?.message || error);
  }
  if (resolved.length) {
    const v4 = resolved.filter((item) => item.family === 4).map((item) => item.address);
    const v6 = resolved.filter((item) => item.family === 6).map((item) => item.address);
    record("ok", "dns", `${host} resuelve: ${v4.length} IPv4${v4.length ? ` (${v4.join(", ")})` : ""}${v6.length ? ` · ${v6.length} IPv6` : ""}`, { host, v4, v6 });
    if (!v4.length) notes.push(`${host} no tiene registro A: solo IPv6. Desde una red sin IPv6 global el puerto 443 no es alcanzable.`);
    return true;
  }
  const doh = await dohLookup(host);
  if (doh.error) {
    record("fail", "dns", `${host} no resuelve en este equipo (${localError}) y no se pudo confirmar con un resolver publico: ${doh.error}`, { host, localError });
    return false;
  }
  const detail = `${host}: ${localError} aqui; en ${doh.resolver} es ${doh.kind}${doh.answers.length ? ` (${doh.answers.join(", ")})` : ""}`;
  if (doh.status === 3) {
    record("fail", "dns", `${detail}. El proyecto no existe con ese ref: re-copiar el connection string y el project ref de la consola.`, { host, localError, doh });
    return false;
  }
  if (doh.answers.length) {
    record("warn", "dns", `${detail}. El nombre existe publicamente: el problema es el resolver de esta red, no el proyecto.`, { host, localError, doh });
    return false;
  }
  record("fail", "dns", `${detail}. Sin registro A: o el proyecto tiene IPv4 desactivado, o el host lleva el prefijo db. (que es solo del puerto 5432), o el ref esta mal copiado.`, { host, localError, doh });
  return false;
}

/** Las definiciones del OpenAPI traen el nombre real de las columnas; las filas, solo las que hay. */
function schemaColumns(spec) {
  const schemas = spec?.components?.schemas || spec?.definitions || {};
  const entry = schemas[table];
  if (!entry) return [];
  const properties = entry.properties || {};
  if (Array.isArray(properties)) return properties;
  if (typeof properties === "object" && properties.keys) return properties.keys;
  return Object.keys(properties);
}

async function checkAuthHealth() {
  const url = `${baseUrl}/auth/v1/health`;
  const res = await request(url, { method: "GET", headers: headers() });
  if (res.networkError) {
    return record("fail", "auth.health", `sin salida a ${url} — ${res.networkError}`, { url, ms: res.ms });
  }
  if (res.status === 401 || res.status === 403) {
    // Sin clave, un 401 no es un defecto del proyecto: es la respuesta normal de un Supabase
    // sano. Se reporta como "sin datos" para que el codigo de salida 3 signifique exactamente
    // "llego ypidio, pero falta la credencial" y no "esta roto".
    if (!key) return record("skip", "auth.health", `${res.status}: el proyecto responde y exige apikey. Falta la clave anon (--key= o SUPABASE_ANON_KEY)`, { url, status: res.status, ms: res.ms });
    return record("fail", "auth.health", `${res.status}: la clave no es valida o no tiene permiso (${maskKey(key)})`, { url, status: res.status, ms: res.ms });
  }
  if (!res.ok) {
    return record("fail", "auth.health", `${res.status} ${res.text.slice(0, 160)}`, { url, status: res.status, ms: res.ms });
  }
  const detail = res.json ? Object.entries(res.json).map(([name, value]) => `${name}=${value}`).join(", ") : res.text.slice(0, 120);
  return record("ok", "auth.health", `${res.status} en ${res.ms} ms — ${detail}`, { url, status: res.status, ms: res.ms, body: res.json });
}

/** Ademas de la salud, el OpenAPI dice que tablas ve la Data API: eso es lo que se puede leer. */
async function checkRestOpenApi() {
  const url = `${baseUrl}/rest/v1/`;
  const res = await request(url, { method: "GET", headers: headers({ accept: "application/openapi+json, application/json" }) });
  if (res.networkError) {
    return record("fail", "rest.openapi", `sin salida a ${url} — ${res.networkError}`, { url, ms: res.ms });
  }
  if (res.status === 401 || res.status === 403) {
    if (!key) return record("skip", "rest.openapi", `${res.status}: sin apikey no se puede ver el catalogo de tablas`, { url, status: res.status, ms: res.ms });
    return record("fail", "rest.openapi", `${res.status}: la clave no es valida o no tiene permiso (${maskKey(key)})`, { url, status: res.status, ms: res.ms });
  }
  if (!res.ok) {
    return record("fail", "rest.openapi", `${res.status} ${res.text.slice(0, 160)}`, { url, status: res.status, ms: res.ms });
  }
  const spec = res.json || {};
  const info = spec.info || {};
  const paths = Object.keys(spec.paths || {}).filter((key) => !key.includes("{"));
  const schemas = Object.keys(spec.components?.schemas || spec.definitions || {}).filter((name) => name !== "pg_stat_activity");
  const exposed = paths.length > 0 ? paths : schemas;
  record("ok", "rest.openapi", `${res.status} en ${res.ms} ms — ${info.title || "sin titulo"} ${info.version || ""}; ${exposed.length} recurso(s) expuesto(s)`, { url, status: res.status, ms: res.ms, info, exposed });
  if (table && !exposed.includes(table)) {
    record("fail", "la tabla esta expuesta en la Data API", `${schema}.${table} NO aparece entre ${exposed.length} recurso(s): ${exposed.slice(0, 8).join(", ")} (o no hay exposicion automatica en Data API settings)`, { table, exposed: exposed.slice(0, 60) });
  }
  return { spec, exposed };
}

/**
 * El esquema objetivo ya esta escrito en el repo: docs/schema-supabase.sql, derivado de
 * .project-memory/data-sources.json (docs/plan-migracion-supabase.md, fase 1). Se lee ese archivo
 * en vez de tener una lista de tablas another vez aqui: si el plan cambia, el test sigue midiendo
 * lo que el plan dice, y no una copia congelada que nadie actualiza.
 */
async function loadPlanSchema() {
  const file = flag("schema-file", "") || path.join(root, "docs", "schema-supabase.sql");
  const absolute = path.isAbsolute(file) ? file : path.join(root, file);
  if (!existsSync(absolute)) return null;
  const sql = await readFile(absolute, "utf8");
  const tables = {};
  const pattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;
  let match = pattern.exec(sql);
  while (match) {
    // Se recorre el parentesis para quedarse con el bloque de definicion de esa tabla.
    const open = sql.indexOf("(", match.index);
    let depth = 0;
    let end = open;
    for (let i = open; i < sql.length; i += 1) {
      if (sql[i] === "(") depth += 1;
      if (sql[i] === ")") { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    const block = sql.slice(open + 1, end);
    const columns = [];
    for (const line of block.split("\n")) {
      const hit = line.match(/^\s{2}([a-z_][a-z0-9_]*)\s+[a-z]/i);
      if (hit) columns.push(hit[1]);
    }
    tables[match[1]] = columns;
    match = pattern.exec(sql);
  }
  return { file: path.relative(root, absolute), tables };
}

let planSchema = null;

/**
 * El plan y el SQL son dos archivos y pueden separarse sin que nadie se avise. Se contrastan
 * entre si (seccion 3 del plan contra los create table del .sql) porque una tabla que el plan
 * promete y el SQL no crea se descubre el dia de la migracion, cuando ya cuesta caro.
 */
async function checkPlanDocument() {
  const file = flag("plan-file", "") || path.join(root, "docs", "plan-migracion-supabase.md");
  const absolute = path.isAbsolute(file) ? file : path.join(root, file);
  if (!existsSync(absolute)) {
    record("skip", "plan.documento", `no se encontro ${path.relative(root, absolute)}`);
    return;
  }
  const markdown = await readFile(absolute, "utf8");
  // El corte va anclado a inicio de linea a proposito: "### 3.1" CONTIENE la cadena "## 3.", y
  // un split por substring parte el documento por los subapartados y se lleva las tablas.
  const start = markdown.search(/^##\s+3\./m);
  const end = markdown.search(/^##\s+4\./m);
  const section = start >= 0 ? markdown.slice(start, end > start ? end : undefined) : "";
  const documented = [];
  // La primera celda puede traer texto detras del nombre ("| `app_state` (una fila) |"), asi que
  // se acepta lo que siga hasta el separador: si no, esa fila se pierde y el plan parece
  // incompleto cuando no lo esta.
  const rowPattern = /^\|\s*`([a-z_][a-z0-9_]*)`[^|]*\|/gm;
  let hit = rowPattern.exec(section);
  while (hit) {
    if (!documented.includes(hit[1])) documented.push(hit[1]);
    hit = rowPattern.exec(section);
  }
  if (!documented.length) {
    record("skip", "plan.documento", "la seccion 3 del plan no lista tablas con el formato esperado");
    return;
  }
  const declared = planSchema ? Object.keys(planSchema.tables) : [];
  const sinSql = declared.length ? documented.filter((name) => !declared.includes(name)) : [];
  const sinDoc = declared.length ? declared.filter((name) => !documented.includes(name)) : [];
  const detail = `${documented.length} tablas en el plan · ${declared.length} en el SQL${sinSql.length ? ` · en el plan y NO en el SQL: ${sinSql.join(", ")}` : ""}${sinDoc.length ? ` · en el SQL y no en el plan: ${sinDoc.join(", ")}` : ""}`;
  record(sinSql.length ? "fail" : "ok", "plan.documento", detail, { source: path.relative(root, absolute), documented, declared, missingInSql: sinSql, missingInDoc: sinDoc });
}

/** Compara lo que la Data API expone con lo que el plan dice. */
function checkPlanSchema(openApi) {
  if (!planSchema) {
    record("skip", "plan.esquema", "no se encontro docs/schema-supabase.sql: no hay contra que comparar lo expuesto");
    return;
  }
  const expected = Object.keys(planSchema.tables);
  const exposed = new Set(openApi?.exposed || []);
  const missing = expected.filter((name) => !exposed.has(name));
  const extra = (openApi?.exposed || []).filter((name) => !planSchema.tables[name]);
  const kind = missing.length === 0 ? "ok" : exposed.size === 0 ? "skip" : "warn";
  record(kind, "plan.esquema", `${expected.length - missing.length}/${expected.length} tablas del plan expuestas; faltan ${missing.length}${missing.length ? `: ${missing.join(", ")}` : ""}${extra.length ? ` · no previstas: ${extra.join(", ")}` : ""}`, {
    source: planSchema.file, expected: expected.length, missing, extra,
  });
  if (table && planSchema.tables[table] && !missing.includes(table)) {
    // Las columnas esperadas salen del plan, no de un supuesto del test.
    if (!expectedColumns.length) {
      expectedColumns.push(...planSchema.tables[table]);
      notes.push(`Columnas esperadas de ${table} tomadas de ${planSchema.file} (${expectedColumns.length}).`);
    }
  }
}

async function checkTable(openApi) {
  if (!table) {
    record("skip", "rest.table", "sin tabla: pasa --table=<nombre> o SUPABASE_TABLE");
    return null;
  }
  const url = `${baseUrl}/rest/v1/${encodeURIComponent(table)}?select=*&limit=${limit}`;
  const res = await request(url, { method: "GET", headers: headers({ prefer: "count=exact", range: `0-${Math.max(0, limit - 1)}` }) });
  if (res.networkError) return record("fail", "rest.table", `sin salida — ${res.networkError}`, { url, ms: res.ms });
  if (res.status === 404) return record("fail", "rest.table", `404: ${schema}.${table} no existe o no esta expuesta`, { url, status: res.status });
  if (res.status === 401 || res.status === 403) return record("fail", "rest.table", `${res.status}: sin permiso de lectura (RLS) o clave invalida`, { url, status: res.status, body: res.json || res.text.slice(0, 200) });
  if (res.status === 400) return record("fail", "rest.table", `400: ${res.text.slice(0, 200)}`, { url, status: res.status, body: res.json || null });
  if (!res.ok) return record("fail", "rest.table", `${res.status} ${res.text.slice(0, 160)}`, { url, status: res.status });

  const rows = Array.isArray(res.json) ? res.json : [];
  const contentRange = res.headers?.get?.("content-range") || "";
  const exactCount = Number(String(contentRange).split("/")[1] ?? NaN);
  const rowColumns = rows.length ? Object.keys(rows[0]) : [];
  const declaredColumns = openApi ? schemaColumns(openApi.spec) : [];
  const columns = declaredColumns.length ? declaredColumns : rowColumns;

  record("ok", "rest.table", `${res.status} en ${res.ms} ms — ${rows.length} fila(s) leida(s)${Number.isFinite(exactCount) ? ` de ${exactCount}` : ""}`, {
    url, status: res.status, ms: res.ms, rowsRead: rows.length, contentRange, columns: columns.slice(0, 60),
  });
  if (rows.length === 0) {
    // Cero filas NO es un fallo de lectura: puede ser una tabla vacia o RLS que oculta todo.
    // Se deja dicho cual de las dos cosas hay que mirar.
    record(Number.isFinite(exactCount) && exactCount === 0 ? "warn" : "warn", "la tabla tiene filas", `0 filas${contentRange ? ` (${contentRange})` : ""}: revisa si la tabla esta vacia o si RLS filtra para el rol ${keyKind}`);
  }
  const missing = expectedColumns.filter((column) => !columns.includes(column));
  if (expectedColumns.length) {
    record(missing.length === 0 ? "ok" : "fail", "columnas esperadas", missing.length ? `faltan: ${missing.join(", ")} (declaradas: ${columns.slice(0, 20).join(", ")})` : `${expectedColumns.length}/${expectedColumns.length} presentes`, { expectedColumns, columns: columns.slice(0, 60) });
  }
  const sample = rows.slice(0, 2).map((row) => Object.fromEntries(Object.entries(row).map(([name, value]) => [name, typeof value === "string" && value.length > 60 ? `${value.slice(0, 60)}…` : value])));
  if (sample.length) console.log(`  muestra: ${JSON.stringify(sample, null, 2).split("\n").join("\n  ")}`);
  return { rowsRead: rows.length, contentRange, columns, sample };
}

/**
 * Conexion directa a Postgres. Es opcional a proposito: la contrasena no esta en el repo y el
 * paquete `pg` tampoco. Si falta algo, el paso se salta con el motivo (no se marca como fallo,
 * porque no es un defecto del proyecto).
 */
async function checkPostgres() {
  const password = process.env.SUPABASE_DB_PASSWORD || "";
  if (!password) return record("skip", "postgres", "sin SUPABASE_DB_PASSWORD (opcional; el paso 4 es directo a la base, no a la Data API)");
  let pg;
  try {
    pg = await import("pg");
  } catch {
    return record("skip", "postgres", "falta el paquete `pg`: npm i -D pg (o la API REST ya cubre la lectura)");
  }
  const connectionString = `postgresql://postgres:${encodeURIComponent(password)}@${dbHost}:5432/postgres`;
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: TIMEOUT_MS, ssl: { rejectUnauthorized: false } });
  const started = Date.now();
  try {
    await client.connect();
    const version = await client.query("select version()");
    const tables = await client.query("select table_name from information_schema.tables where table_schema = $1 order by table_name", [schema]);
    const names = tables.rows.map((row) => row.table_name);
    record("ok", "postgres", `conectado en ${Date.now() - started} ms — ${String(version.rows[0]?.version || "").split(" on ")[0]}; ${names.length} tabla(s) en ${schema}`, { tables: names.slice(0, 80), version: String(version.rows[0]?.version || "") });
    if (table) {
      record(names.includes(table) ? "ok" : "fail", "la tabla existe", names.includes(table) ? `${schema}.${table}` : `${schema}.${table} no existe; hay: ${names.slice(0, 12).join(", ")}`, { table, tables: names.slice(0, 80) });
    }
    await client.end();
  } catch (error) {
    await client.end().catch(() => {});
    const message = String(error?.message || error);
    const isAuth = /password authentication|pg_hba|ENOTFOUND|ECONNREFUSED|timeout/i.test(message);
    record("fail", "postgres", `${isAuth ? "conexion rechazada" : "fallo"}: ${message.slice(0, 200)}`, { ms: Date.now() - started });
  }
}

async function main() {
  console.log(`Prueba de lectura de Supabase: ${baseUrl} (proyecto ${projectRef}, clave ${maskKey(key)}${key ? ` [${keyKind}]` : ""})`);
  if (urlWasFixed) console.log(`Aviso: se recibio ${rawApiUrl}; el prefijo db. es del puerto 5432, no de la Data API. Se usa ${baseUrl}.`);
  if (!key) notes.push("Sin clave: se espera 401/403 en los pasos 1-3. Pasa --key= o SUPABASE_ANON_KEY.");
  if (keyKind === "service_role") notes.push("Se esta usando la clave service_role: evita RLS. Sirve para diagnostico, no para produccion.");
  planSchema = await loadPlanSchema();
  if (planSchema) console.log(`Esquema del plan: ${Object.keys(planSchema.tables).length} tablas en ${planSchema.file}`);
  // Este contraste es de archivos locales: no necesita credenciales ni red, asi que se hace
  // primero y siempre. Es el unico paso que puede correr sin clave.
  await checkPlanDocument();

  const dns = await checkDns();
  let openApi = null;
  if (!dns) {
    // Sin resolucion no tiene sentido pedir pasos HTTP: se dicen los siguientes como omitidos
    // para que el reporte deje claro que no se evaluaron, no que fallaron.
    record("skip", "auth.health", "sin resolucion de nombre: no se puede evaluar");
    record("skip", "rest.openapi", "sin resolucion de nombre: no se puede evaluar");
    record("skip", "plan.esquema", "sin resolucion de nombre: no se puede evaluar");
    record("skip", "rest.table", "sin resolucion de nombre: no se puede evaluar");
  } else {
    const health = await checkAuthHealth();
    if (health.kind === "ok") {
      openApi = await checkRestOpenApi();
      if (openApi) {
        checkPlanSchema(openApi);
        await checkTable(openApi);
      } else {
        record("skip", "plan.esquema", "sin el OpenAPI no hay con que comparar el plan");
        record("skip", "rest.table", "sin el OpenAPI no se puede validar la exposicion de la tabla");
      }
    } else {
      notes.push(health.kind === "skip" ? "Se salta rest.openapi: falta la credencial." : "Se salta rest.openapi: auth.health no paso.");
      record("skip", "rest.openapi", health.kind === "skip" ? "sin apikey no se puede ver el catalogo de tablas" : "auth.health no paso");
      record("skip", "plan.esquema", "sin el catalogo expuesto no se puede comparar con el plan");
      record("skip", "rest.table", "sin el OpenAPI no se puede validar la exposicion de la tabla");
    }
  }
  await checkPostgres();

  if (has("list")) {
    const exposed = openApi?.exposed || [];
    console.log(`\nTablas/recursos expuestos por la Data API (${exposed.length}):`);
    for (const name of exposed) console.log(`  - ${name}${planSchema?.tables[name] ? "" : "  (no esta en el plan)"}`);
    const expected = planSchema ? Object.keys(planSchema.tables) : [];
    if (expected.length) {
      console.log(`\nTablas del plan (${planSchema.file}) que NO estan expuestas (${expected.filter((name) => !exposed.includes(name)).length}):`);
      for (const name of expected.filter((item) => !exposed.includes(item))) console.log(`  - ${name}`);
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await mkdir(artifactsDir, { recursive: true });
  const artifact = path.join(artifactsDir, `supabase-read-${stamp}.json`);
  const report = {
    generatedAt: new Date().toISOString(),
    target: { baseUrl, projectRef, dbHost, keyKind, hasKey: Boolean(key), schema, table, limit },
    summary: { total: checks.length, failures, skipped, passed: checks.length - failures - skipped },
    notes,
    checks,
  };
  await writeFile(artifact, JSON.stringify(report, null, 2));

  console.log(`\n${failures ? `${failures} fallo(s)` : "Sin fallos"} · ${skipped} sin datos · ${checks.length} comprobaciones`);
  console.log(`Reporte: ${path.relative(root, artifact)}`);
  if (!key && !failures) {
    console.log("Sin credenciales: la corrida queda SIN DATOS, no aprobada. Codigo 3.");
    process.exitCode = 3;
    return;
  }
  process.exitCode = failures ? 1 : 0;
}

main().catch((error) => {
  console.error(`La prueba no pudo ejecutarse: ${String(error?.stack || error)}`);
  process.exitCode = 1;
});
