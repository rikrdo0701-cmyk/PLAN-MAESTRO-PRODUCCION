#!/usr/bin/env node
/**
 * Dump del esquema REAL de las 7 tablas de la ingesta en Supabase.
 *
 * Uso:
 *   $env:SUPABASE_DB_PASSWORD = '<tu password de postgres>'
 *   node scripts/dump-schema-supabase.mjs
 *
 * Solo lee information_schema: NO escribe nada.
 * Imprime las columnas EXACTAS de cada tabla, que es contra lo que PostgREST
 * valida el payload. Si una columna que emite el RESTlet no esta aqui, la
 * escritura dara 400 PGRST204 "Could not find the '<columna>' column".
 */
import pg from "pg";

const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) { console.error("Falta SUPABASE_DB_PASSWORD"); process.exit(1); }
const ref = "xtgtfjcwxcoxvixholpj";
const host = "aws-0-us-east-1.pooler.supabase.com";
const conn = `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${host}:5432/postgres`;

const TABLAS = ["work_orders", "operations", "materials", "machines", "items", "inventory", "sales_orders"];

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();

for (const t of TABLAS) {
  const r = await client.query(
    `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [t]
  );
  const unicos = await client.query(
    `SELECT c.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage c
         ON c.constraint_name = tc.constraint_name
      WHERE tc.table_schema = 'public' AND tc.table_name = $1
        AND tc.constraint_type IN ('UNIQUE','PRIMARY KEY')`,
    [t]
  );
  console.log("=== " + t + " ===");
  if (!r.rows.length) { console.log("  (NO EXISTE)"); continue; }
  const uniq = new Set(unicos.rows.map((x) => x.column_name));
  for (const col of r.rows) {
    const marca = uniq.has(col.column_name) ? "  [UNIQUE]" : "";
    console.log("  " + col.column_name + "  " + col.data_type + (col.is_nullable === "YES" ? " NULL" : " NOT NULL") + marca);
  }
  console.log("");
}

await client.end();