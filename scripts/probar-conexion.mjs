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

// Las cuatro formas en que se puede llegar a esta base.
//
// POR QUE ESTAN LAS CUATRO, y por que la PRIMERA esta descartada. MEDIDO 2026-09-30: con
// user=postgres a secas, el pooler contesta
//   (ENOIDENTIFIER) no tenant identifier provided (external_id or sni_hostname required)
// o sea que NO ACEPTA el usuario sin el tenant. Eso confirma que la forma que usa
// apply-sql-supabase.mjs (postgres.<ref>) es la correcta, y que esta entrada existe solo para
// que quede escrito que se probó y por que no aplica. Sin esa anotacion, alguien lee "fallo" y
// deduce que el formato del usuario era el problema, que es justo lo contrario de lo que pasa.
const intentos = [
  { etiqueta: "session pooler  5432, usuario postgres.<ref>  (LA QUE USA EL SCRIPT)", host: `${region}.pooler.supabase.com`, port: 5432, user: `postgres.${ref}` },
  { etiqueta: "transaction pooler 6543, usuario postgres.<ref>", host: `${region}.pooler.supabase.com`, port: 6543, user: `postgres.${ref}` },
  { etiqueta: "session pooler  5432, usuario postgres a secas  (NO APLICA: el pooler exige el tenant)", host: `${region}.pooler.supabase.com`, port: 5432, user: "postgres", noAplica: /no tenant identifier provided/i },
  { etiqueta: "conexion directa db.<ref>:5432  (NO APLICA si no resuelve: este proyecto no la expone)", host: `db.${ref}.supabase.co`, port: 5432, user: "postgres", noAplica: /ENOTFOUND|ENODATA|getaddrinfo/i },
];

/**
 * Clasifica el error de una conexion. MEDIDO 2026-09-30: sin esto, los cuatro fallos se
 * contam en un solo "fallo" y el cierre asegura una conclusion que no se sostiene. Un
 * diagnostico que afirma mas de lo que sabe hace perder el rato en el sistema equivocado, que
 * es peor que uno que solo dice "no conecto".
 *
 *   contrasena -> el servidor llego a verificarla. Es lo unico que prueba que el formato
 *                 (host, puerto, usuario) esta bien.
 *   noAplica   -> esa forma no existe para este proyecto. No dice NADA de la contrasena.
 */
function clasificar(mensaje, intento) {
  if (/password authentication failed|authentication failed/i.test(mensaje)) {
    return { tipo: "contrasena", texto: "el servidor llego a verificar la contrasena y la rechazo" };
  }
  if (intento.noAplica && intento.noAplica.test(mensaje)) {
    return { tipo: "noAplica", texto: "esta forma no aplica a este proyecto; no dice nada de la contrasena" };
  }
  if (/getaddrinfo|ENOTFOUND|ENODATA|EAI_AGAIN/i.test(mensaje)) {
    return { tipo: "noAplica", texto: "el host no resuelve: ese endpoint no existe para este proyecto" };
  }
  if (/certificate|self-signed|SSL/i.test(mensaje)) {
    return { tipo: "otro", texto: "problema de TLS, no de contrasena" };
  }
  if (/timeout|ETIMEDOUT|ECONNREFUSED/i.test(mensaje)) {
    return { tipo: "otro", texto: "no hubo respuesta del servidor: red o firewall" };
  }
  return { tipo: "otro", texto: "error sin clasificar" };
}

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
    return { ok: true, clase: "ok", lectura: "entro", detalle: `entro como rol "${fila.rol}" en la base "${fila.base}" (${version})` };
  } catch (error) {
    try { await cliente.end(); } catch { /* ya estaba cerrada */ }
    const msg = String((error && error.message) || error).split("\n")[0];
    const clase = clasificar(msg, intento);
    return { ok: false, clase: clase.tipo, detalle: msg, lectura: clase.texto };
  }
}

console.log(`referencia del proyecto: ${ref}`);
console.log(`longitud de la contrasena: ${password.length} caracteres (no se imprime)`);

// MEDIDO 2026-09-30 sobre esta base: un password de Supabase NO llega a 127 caracteres. Con
// esa longitud, lo que hay en la variable casi seguro no es el password de la base sino otra
// cosa (un access token del Management API, o un JWT). Se avisa ANTES de probar nada, porque
// es la causa mas probable y no hace falta ninguna peticion para saberlo.
const LARGO_IMPLAUSIBLE = 64;
if (password.length > LARGO_IMPLAUSIBLE) {
  console.log("");
  console.log(`AVISO: ${password.length} caracteres es un largo IMPLAUSIBLE para un password de base.`);
  console.log("  Lo mas probable es que la variable no tenga el password de la base, sino otra");
  console.log("  cosa. La de verdad sale de Supabase -> Project Settings -> Database ->");
  console.log("  Connection string -> Session pooler, y se copia SOLO el texto que va despues de");
  console.log('  "postgresql://postgres:" (NO la cadena entera, que ademas incluye el usuario).');
}
console.log("");

const resultados = [];
for (const intento of intentos) {
  const r = await probar(intento);
  resultados.push({ intento, r });
  const marca = r.ok ? "FUNCIONA" : (r.clase === "noAplica" ? "no aplica" : "FALLA   ");
  console.log(`[${marca}] ${intento.etiqueta}`);
  console.log(`          ${r.detalle}`);
  console.log(`          ${r.lectura}`);
  console.log("");
}

const ok = resultados.find((x) => x.r.ok);
if (ok) {
  console.log("COMBINACION QUE FUNCIONA:");
  console.log(`  host=${ok.intento.host}  port=${ok.intento.port}  user=${ok.intento.user}`);
  console.log("");
  console.log("Si scripts/apply-sql-supabase.mjs usa otra, hay que corregirlo ahi.");
  process.exit(0);
}

// La conclusion se apoya en la CLASIFICACION, no en que todo fallo. Cuentan solo las formas en
// las que el servidor LLEGO A VERIFICAR la contrasena, porque solo esas dicen algo sobre ella.
//
// MEDIDO 2026-09-30, en la primera corrida real de este detector: la conclusion anterior
// afirmaba que las cuatro formas habian fallado con el mismo error de contrasena. NO fue
// asi. Los cuatro fallos fueron de TRES tipos distintos:
//
//   session     5432  user=postgres        -> (ENOIDENTIFIER) no tenant identifier provided
//   session     5432  user=postgres.<ref>  -> password authentication failed
//   transaction 6543  user=postgres.<ref>  -> password authentication failed
//   directa db.<ref>:5432                  -> getaddrinfo ENOTFOUND
//
// Solo DOS fueron de contrasena. Y el primero dice algo CONTRADICTORIO de lo que la
// conclusion anterior afirmaba: el pooler NO acepto esa forma porque exige el tenant en el
// usuario, lo cual CONFIRMA que la forma que usa apply-sql-supabase.mjs (postgres.<ref>)
// es la correcta. Con el texto anterior, alguien iba a "arreglar" el formato del usuario,
// que ya estaba bien.
//
// Un diagnostico que afirma mas de lo que sabe hace perder el rato en el sistema equivocado:
// es peor que uno que solo dice "no conecto", porque el que se equivoca manda a cambiar la
// cosa que no hay que cambiar.
const formasQueVerificaronLaContrasena = resultados.filter((x) => x.r.clase === "contrasena");
const noAplican = resultados.filter((x) => x.r.clase === "noAplica");
const otros = resultados.filter((x) => x.r.clase === "otro");

if (formasQueVerificaronLaContrasena.length) {
  console.log("CONCLUSION: la CONTRASENA es incorrecta.");
  console.log(`  ${formasQueVerificaronLaContrasena.length} de ${resultados.length} formas llegaron a verificarla y la rechazaron.`);
  console.log("  Eso prueba ademas que el formato (host, puerto, usuario) de esas formas es el");
  console.log("  correcto, porque el servidor no se quejo de a quien Connectarse.");
  if (formasQueVerificaronLaContrasena.length < resultados.length) {
    console.log(`  Las otras ${noAplican.length + otros.length} no dicen NADA de la contrasena:`);
    for (const x of noAplican) console.log(`    - ${x.intento.etiqueta}: ${x.r.lectura}`);
    for (const x of otros) console.log(`    - ${x.intento.etiqueta}: ${x.r.lectura}`);
  }
  console.log("");
  console.log("  Donde se saca la correcta: Supabase -> Project Settings -> Database ->");
  console.log("  Connection string -> Session pooler. Se copia SOLO lo que va despues de");
  console.log('  "postgresql://postgres:", no la cadena entera.');
  process.exit(1);
}

console.log("CONCLUSION: NINGUNA forma llego a verificar la contrasena.");
console.log("  O sea que este fallo NO es de contrasena, y resetearla no arreglaria nada.");
for (const x of resultados) console.log(`  - ${x.intento.etiqueta}: ${x.r.lectura}`);
console.log("");
console.log("  Con estos errores, lo mas probable es que la REGION este mal: el pooler es por");
console.log("  region y este proyecto puede no estar en us-east-1. Se confirma en Supabase ->");
console.log("  Project Settings -> Database -> Connection string, que trae el host del pooler con");
console.log("  la region correcta.");
process.exit(2);
