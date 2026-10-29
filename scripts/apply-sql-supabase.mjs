#!/usr/bin/env node
/**
 * Aplica un archivo .sql al proyecto Supabase de la ingesta.
 *
 * Uso:
 *   $env:SUPABASE_DB_PASSWORD = '<tu password de postgres>'
 *   node scripts/apply-sql-supabase.mjs docs/rpc-ingesta-mirror.sql
 *
 * Para NO dejar la contraseña en el historial de PowerShell ni en un archivo, usar
 * el envoltorio, que la pide en un prompt enmascarado y la pasa solo por la
 * memoria de este proceso:
 *   powershell -NoProfile -File scripts\aplicar-ddl-cierre.ps1
 *
 * MODO DIAGNOSTICO (no cambia nada: ejecuta cada sentencia por separado dentro de
 * SAVEPOINTs, lista TODOS los fallos y hace rollback). Postgres se detiene en el
 * primer error de un lote, así que sin esto un DDL con varios ALTER obliga a una
 * corrida por cada error:
 *   powershell -NoProfile -File scripts\aplicar-ddl-cierre.ps1 -Diagnosticar
 *
 * NO imprime credenciales.
 */
import fs from "node:fs";
import pg from "pg";

const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) { console.error("Falta SUPABASE_DB_PASSWORD"); process.exit(1); }
const archivo = process.argv[2];
if (!archivo) { console.error("Falta el archivo .sql"); process.exit(1); }
if (!fs.existsSync(archivo)) { console.error("No existe: " + archivo); process.exit(1); }

const ref = "xtgtfjcwxcoxvixholpj";
const conn = `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;
const sql = fs.readFileSync(archivo, "utf8");

const diagnosticar = process.argv.includes("--diagnosticar") || process.env.DIAG === "1";

/**
 * Divide el SQL en sentencias respetando literales, dollar-quoting Y COMENTARIOS.
 *
 * MEDIDO 2026-09-29: la primera version solo sabia de literales y $$...$$, y el
 * diagnostico reporto 10 fallos, la mayoria FALSOS ("syntax error at or near
 * el", "column codigo does not exist", "unterminated dollar-quoted string"). La
 * causa: un ';' dentro de un comentario -- partia la sentencia, y una comilla
 * dentro de un comentario entraba en modo literal y se comia el resto del
 * archivo. Un diagnostico que inventa errores es PEOR que no diagnosticar, porque
 * hace perseguir bugs que no existen. Por eso los comentarios son un estado mas
 * de la maquina, y hay tests que lo fijan (tests/apply-sql-split.test.mjs).
 *
 * Un '--' dentro de un cuerpo $$...$$ NO es comentario: es texto del cuerpo, y un
 * ';' ahi tampoco corta. Por eso dollar se comprueba PRIMERO y los comentarios
 * solo se miran fuera de literales y de cuerpos.
 *
 * No se exporta: el archivo se ejecuta al importarlo (conecta y aplica), asi que
 * los tests lo evaluan con node:vm sobre su fuente.
 */
export function dividir(texto) {
  const partes = [];
  let actual = "";
  let enComillaSimple = false;
  let etiqueta = null; // dollar-quoting: $$ o $tag$
  let enLinea = false; // dentro de un comentario -- ... hasta el fin de linea
  let enBloque = false; // dentro de un /* ... */

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];

    if (etiqueta) {
      // MEDIDO 2026-09-29: aqui se perdia el segundo '$' del cierre. Se hacia
      // 'actual += c' (un solo caracter) y luego se pretendia completar con
      // texto.slice(i+1, i+1), que es cadena vacia: el cuerpo llegaba a
      // Postgres terminando en '$' y la respuesta era 'unterminated
      // dollar-quoted string'. Se anexa el delimitador ENTERO.
      if (c === "$" && texto.startsWith(etiqueta, i)) {
        actual += etiqueta;
        i += etiqueta.length - 1;
        etiqueta = null;
        continue;
      }
      actual += c;
      continue;
    }
    if (enLinea) {
      actual += c;
      if (c === "\n") enLinea = false;
      continue;
    }
    if (enBloque) {
      actual += c;
      if (c === "*" && texto[i + 1] === "/") { actual += "/"; i++; enBloque = false; }
      continue;
    }
    if (enComillaSimple) {
      actual += c;
      if (c === "'") {
        if (texto[i + 1] === "'") { actual += "'"; i++; }
        else enComillaSimple = false;
      }
      continue;
    }

    // Desde aqui estamos fuera de todo. El orden importa.
    if (c === "-" && texto[i + 1] === "-") { enLinea = true; actual += "--"; i++; continue; }
    if (c === "/" && texto[i + 1] === "*") { enBloque = true; actual += "/*"; i++; continue; }
    if (c === "'") { enComillaSimple = true; actual += c; continue; }
    const dollar = texto.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
    if (dollar) { etiqueta = dollar[0]; actual += dollar[0]; i += dollar[0].length - 1; continue; }
    if (c === ";") { if (actual.trim()) partes.push(actual.trim()); actual = ""; continue; }
    actual += c;
  }
  if (actual.trim()) partes.push(actual.trim());
  return partes;
}

/**
 * Una sentencia que no sea solo comentarios tiene que empezar por una palabra
 * clave de SQL. Es el detector de una division rota: si un fragmento empieza por
 * texto de comentario ("el codigo es el identificador..."), el divisor metio la
 * pata aunque la base no diga nada.
 */
const PALABRAS_SQL = /^(alter|create|comment|revoke|grant|drop|select|update|insert|delete|do|begin|commit|rollback|truncate|with|set|analyze|vacuum|refresh)\b/i;

function diagnosticoDeFragmentos(sentencias) {
  const malos = [];
  for (let i = 0; i < sentencias.length; i++) {
    const sinComentarios = sentencias[i]
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .trim();
    if (!sinComentarios) continue; // era solo un comentario
    if (!PALABRAS_SQL.test(sinComentarios)) {
      malos.push("#" + (i + 1) + "  " + sinComentarios.split("\n")[0].slice(0, 110));
    }
  }
  return malos;
}

async function diagnosticarTodas(client) {
  const sentencias = dividir(sql);

  // Antes de tocar la base, el archivo se audita a si mismo. Un fragmento que no
  // empieza por una palabra clave significa que el divisor se parto mal, y sus
  // errores serian FALSOS: mejor no ejecutar nada y decirlo.
  const malos = diagnosticoDeFragmentos(sentencias);
  if (malos.length) {
    console.log("El divisor de sentencias quedo mal: " + malos.length + " fragmento(s) no empiezan por SQL.");
    for (const m of malos) console.log("  " + m);
    console.log("");
    console.log("NO se ejecuto nada. Arregla el divisor antes de diagnostear la base:");
    console.log("un diagnostico con fragmentos rotos reporta errores que no existen.");
    return 2;
  }

  console.log("Diagnostico: " + sentencias.length + " sentencias. Se ejecutan y se revierten una por una.");
  const fallos = [];
  await client.query("BEGIN");
  try {
    for (let i = 0; i < sentencias.length; i++) {
      const s = sentencias[i];
      const punto = "pp_sp_" + i;
      await client.query("SAVEPOINT " + punto);
      try {
        await client.query(s);
        await client.query("RELEASE " + punto);
      } catch (e) {
        await client.query("ROLLBACK TO " + punto);
        await client.query("RELEASE " + punto);
        const primera = s.split(/\r?\n/).find((l) => l.trim() && !l.trim().startsWith("--")) || "";
        fallos.push({ n: i + 1, sql: primera.trim().slice(0, 110), msg: resumen(e) });
      }
    }
  } finally {
    await client.query("ROLLBACK");
  }
  console.log("");
  if (fallos.length === 0) {
    console.log("OK: las " + sentencias.length + " sentencias se aplicarian sin error. No se cambio nada.");
    return 0;
  }
  console.log("FALLAN " + fallos.length + " de " + sentencias.length + ":");
  for (const f of fallos) {
    console.log("");
    console.log("  #" + f.n + "  " + f.sql);
    console.log("      -> " + f.msg);
  }
  console.log("");
  console.log("ROLLBACK: no se cambio nada en la base.");
  return 1;
}

// TLS: antes era ssl:{rejectUnauthorized:false} fijo, o sea cifrado pero con el
// certificado SIN verificar y sin decir nada: cualquier proxy de red aceptaba la
// conexion. Ahora se verifica primero. Si el certificado no valida, se reintenta
// una vez sin verificar y se avisa en mayusculas, para no perder la operacion ni
// fingir que la conexion fue segura. SUPABASE_DB_SSL_INSECURE=1 lo fija sin reintento.
const inseguro = process.env.SUPABASE_DB_SSL_INSECURE === "1";
const cliente = (ssl) => new pg.Client({ connectionString: conn, ssl });

function esErrorDeCertificado(e) {
  return /certificate|self.signed|unable to verify|UNABLE_TO_VERIFY|DEPTH_ZERO/i.test(String((e && e.message) || e));
}
function resumen(e) {
  return String((e && e.message) || e).slice(0, 300);
}

async function conectar() {
  if (inseguro) {
    console.log("AVISO: SUPABASE_DB_SSL_INSECURE=1 -> se conecta SIN verificar el certificado.");
    const c = cliente({ rejectUnauthorized: false });
    await c.connect();
    return c;
  }
  try {
    const c = cliente({ rejectUnauthorized: true });
    await c.connect();
    return c;
  } catch (e) {
    if (!esErrorDeCertificado(e)) throw e;
    console.warn("AVISO: el certificado del pooler no valida contra las CA de Node (" + resumen(e) + ").");
    console.warn("       Se reintenta SIN verificar el certificado. Cifrado si, verificado no.");
    const c = cliente({ rejectUnauthorized: false });
    await c.connect();
    return c;
  }
}

let client;
try {
  client = await conectar();
} catch (e) {
  console.error("ERROR al conectar: " + resumen(e));
  process.exit(1);
}
try {
  if (diagnosticar) {
    process.exitCode = await diagnosticarTodas(client);
  } else {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("OK: aplicado " + archivo);
  }
} catch (e) {
  try { await client.query("ROLLBACK"); } catch { }
  console.error("ERROR: " + resumen(e));
  process.exit(1);
} finally {
  await client.end();
}
