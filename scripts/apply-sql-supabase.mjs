#!/usr/bin/env node
/**
 * Aplica un archivo .sql al proyecto Supabase de la ingesta.
 *
 * Uso:
 *   $env:SUPABASE_DB_PASSWORD = '<tu password de postgres>'
 *   node scripts/apply-sql-supabase.mjs docs/rpc-ingesta-mirror.sql
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

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  console.log("OK: aplicado " + archivo);
} catch (e) {
  await client.query("ROLLBACK");
  console.error("ERROR: " + String(e.message || e).slice(0, 500));
  process.exit(1);
} finally {
  await client.end();
}