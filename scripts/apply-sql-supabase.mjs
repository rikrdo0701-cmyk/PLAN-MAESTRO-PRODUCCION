#!/usr/bin/env node
/**
 * Aplica un archivo .sql al proyecto Supabase de la ingesta.
 *
 * Uso:
 *   $env:SUPABASE_DB_PASSWORD = '<tu password de postgres>'
 *   node scripts/apply-sql-supabase.mjs docs/rpc-ingesta-mirror.sql
 *
 * Para NO dejar la contraseña en el historial de PowerShell ni en un archivo,
 * usar el envoltorio, que la pide en un prompt oculto y la pasa solo por la
 * memoria de este proceso:
 *   powershell -File scripts\aplicar-ddl-cierre.ps1
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
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  console.log("OK: aplicado " + archivo);
} catch (e) {
  await client.query("ROLLBACK");
  console.error("ERROR: " + resumen(e));
  process.exit(1);
} finally {
  await client.end();
}