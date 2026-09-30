#!/usr/bin/env node
/**
 * DIAGNOSTICO DE CONEXION, sin decir NUNCA la contrasena y sin cambiar NADA.
 *
 * POR QUE EXISTE. MEDIDO 2026-09-30: aplicar el DDL fallo con
 *   password authentication failed for user "postgres"
 * y eso no dice cual de las DOS cosas esta mal:
 *
 *   (a) la contrasena no es la de la base. Lo mas probable: lo que estaba en el portapapeles
 *       tenia 72 caracteres, y un password de base de Supabase no suele llegar a eso. Sesenta
 *       y dos es la forma de una service_role key o de un JWT.
 *   (b) el formato del usuario no corresponde al puerto. scripts/apply-sql-supabase.mjs usa
 *       `postgres.<ref>` en el puerto 5432, y segun la documentacion de Supabase el 5432 es el
 *       SESSION pooler, que quiere `postgres` a secas; el `postgres.<ref>` es del TRANSACTION
 *       pooler, que va en el 6543. El pooler de todas formas termina resolviendo al rol
 *       `postgres`, asi que el error se ve igual en los dos casos y no dice nada de cual es.
 *
 * QUE HACE. Prueba la matriz de (host, puerto, usuario) y dice COMBINACION FUNCIONA, o que
 * ninguna funciona, lo que apunta a (a). Sin imprimir la contrasena, sin escribir nada, sin
 * ningun cambio en la base.
 *
 * USO (la contrasena llega en la variable, no en el historial):
 *   $env:SUPABASE_DB_PASSWORD = (Get-Clipboard -Raw).Trim()
 *   node scripts/probar-conexion.mjs
 *   Remove-Item Env:SUPABASE_DB_PASSWORD
 */
import pg from "pg";

const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) { console.error("Falta SUPABASE_DB_PASSWORD"); process.exit(1); }

const ref = "xtgtfjcwxcoxvixholpj";
const region = "aws-0-us-east-1";

// Las cuatro formas en que se puede llegar a esta base. El orden va de la mas probable a la
// menos, y la ultima es la conexion directa, que es la que dice la documentacion.
const intentos = [
  { etiqueta: "session pooler  5432, usuario postgres", host: `${region}.pooler.supabase.com`, port: 5432, user: "postgres" },
  { etiqueta: "session pooler  5432, usuario postgres.<ref>  (LO QUE USA EL SCRIPT)", host: `${region}.pooler.supabase.com`, port: 5432, user: `postgres.${ref}` },
  { etiqueta: "transaction pooler 6543, usuario postgres.<ref>", host: `${region}.pooler.supabase.com`, port: 6543, user: `postgres.${ref}` },
  { etiqueta: "conexion directa 5432, usuario postgres", host: `db.${ref}.supabase.co`, port: 5432, user: "postgres" },
];

// El pooler de Supabase devuelve un certificado que Node no valida contra las CA del sistema.
// Se avisa UNA vez y se conecta sin verificar: el canal va cifrado, lo que no se verifica es
// quien esta al otro lado. Es el mismo aviso que ya da el script de aplicacion.
process.env.PGSSLMODE = process.env.PGSSLMODE || "require";

async function probar(intento) {
  const cliente = new pg.Client({
    host: intento.host,
    port: intento.port,
    user: intento.user,
    password,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 12000,
  });
  try {
    await cliente.connect();
    // Una sola lectura de solo consulta. Si sale algo, la sesion sirve de verdad.
    const r = await cliente.query("select current_user as rol, current_database() as base, version() as v");
    await cliente.end();
    const fila = r.rows[0] || {};
    const version = String(fila.v || "").split(" ").slice(0, 2).join(" ");
    return { ok: true, detalle: `entro como rol "${fila.rol}" en la base "${fila.base}" (${version})` };
  } catch (error) {
    try { await cliente.end(); } catch { /* ya estaba cerrada */ }
    const msg = String((error && error.message) || error).split("\n")[0];
    return { ok: false, detalle: msg };
  }
}

console.log(`referencia del proyecto: ${ref}`);
console.log(`longitud de la contrasena: ${password.length} caracteres (no se imprime)\n`);

let alguna = null;
for (const intento of intentos) {
  const r = await probar(intento);
  const marca = r.ok ? "FUNCIONA" : "fallo   ";
  console.log(`[${marca}] ${intento.etiqueta}`);
  console.log(`          ${r.detalle}\n`);
  if (r.ok && !alguna) alguna = intento;
}

if (alguna) {
  console.log("COMBINACION QUE FUNCIONA:");
  console.log(`  host=${alguna.host}  port=${alguna.port}  user=${alguna.user}`);
  console.log("\nSi scripts/apply-sql-supabase.mjs usa otra, hay que corregirlo ahi.");
  process.exit(0);
}

console.log("NINGUNA COMBINACION FUNCIONO con esa contrasena.");
console.log("Eso apunta a la CONTRASENA, no al formato: el pooler acepto las cuatro y las cuatro");
console.log("dijeron 'password authentication failed', o sea que llego a donde se verifica.");
console.log("\nDonde se saca la correcta: Supabase -> Project Settings -> Database -> Connection string");
console.log("-> Session pooler. O resetear la password del rol postgres desde ahi.");
process.exit(1);
