#!/usr/bin/env node
/**
 * Aplica un archivo .sql al proyecto Supabase de la ingesta.
 *
 * Uso:
 *   $env:SUPABASE_DB_PASSWORD = '<tu password de postgres>'
 *   node scripts/apply-sql-supabase.mjs docs/rpc-ingesta-mirror.sql
 *
 * Para NO dejar la contraseña en el historial de PowerShell ni en un archivo,
 * usar el envoltorio, que la pide en un prompt enmascarado y la pasa solo por la
 * memoria de este proceso:
 *   powershell -NoProfile -File scripts\aplicar-ddl-cierre.ps1
 *
 * MODO DIAGNOSTICO (no cambia nada: ejecuta cada sentencia por separado dentro
 * de SAVEPOINTs, lista TODOS los fallos y hace rollback). Postgres se detiene en
 * el primer error de un lote, asi que sin esto un DDL con varios ALTER obliga a
 * una corrida por cada error:
 *   powershell -NoProfile -File scripts\aplicar-ddl-cierre.ps1 -Diagnosticar
 *
 * NO imprime credenciales. Ejecuta el archivo como un solo lote; si falla una
 * declaracion las anteriores del lote quedan por su cuenta de todas formas
 * (Postgres no hace transaccion implicita por lote via pg), asi que los DDL
 * de aqui estan pensados para ser idempotentes o de una sola pieza.
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

// Modo diagnostico: NO cambia nada. Postgres se detiene en el primer error de un
// lote, asi que un DDL con varios ALTER entrega un fallo por corrida y obliga a
// repetir (y a volver a teclear la contrasena) por cada uno. Este modo corre cada
// sentencia por separado dentro de SAVEPOINTs, recoge TODOS los fallos y luego
// hace ROLLBACK de todo: es una lista de lo que habria fallado, no un estado.
const diagnosticar = process.argv.includes("--diagnosticar") || process.env.DIAG === "1";

/**
 * Divide el SQL en sentencias respetando literales y cuerpos $$...$$.
 * Un split ingenuo por ';' rompe el cuerpo de ingesta_mirror (tiene ';' dentro
 * del cuerpo de la funcion) y daria errores que no existen.
 */
function dividir(texto) {
  const partes = [];
  let actual = "";
  let enComillaSimple = false;
  let etiqueta = null; // dollar-quoting: $$ o $tag$
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (etiqueta) {
      actual += c;
      if (c === "$" && texto.startsWith(etiqueta, i)) {
        actual += texto.slice(i + 1, i + etiqueta.length - 1);
        i += etiqueta.length - 1;
        etiqueta = null;
      }
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
    if (c === "'") { enComillaSimple = true; actual += c; continue; }
    const dollar = texto.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
    if (dollar) { etiqueta = dollar[0]; actual += dollar[0]; i += dollar[0].length - 1; continue; }
    if (c === ";") { if (actual.trim()) partes.push(actual.trim()); actual = ""; continue; }
    actual += c;
  }
  if (actual.trim()) partes.push(actual.trim());
  return partes;
}

async function diagnosticarTodas(client) {
  const sentencias = dividir(sql);
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

async function conectar() {
  if (inseguro) {
    console.log("AVISO: SUPABASE_DB_SSL_INSECURE=1 -> se conecta SIN verificar el certificado.");
    return cliente({ rejectUnauthorized: false });
  }
  try {
    return await cliente({ rejectUnauthorized: true }).connect().then((c) => c);
  } catch (e) {
    if (!esErrorDeCertificado(e)) throw e;
    console.warn("AVISO: el certificado del pooler no valida contra las CA de Node (" + resumen(e) + ").");
    console.warn("       Se reintenta SIN verificar el certificado. Cifrado si, verificado no.");
    const c = cliente({ rejectUnauthorized: false });
    await c.connect();
    return c;
  }
}

function esErrorDeCertificado(e) {
  return /certificate|self.signed|unable to verify|UNABLE_TO_VERIFY|DEPTH_ZERO/i.test(String((e && e.message) || e));
}
function resumen(e) {
  return String((e && e.message) || e).slice(0, 160);
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