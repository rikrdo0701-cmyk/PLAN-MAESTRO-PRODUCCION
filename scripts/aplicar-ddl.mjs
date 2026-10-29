#!/usr/bin/env node
/**
 * APLICA EL DDL CON UN ACCESS TOKEN DE SUPABASE, y lo diagnostica antes de tocar nada.
 *
 * POR QUE ESTA VIA Y NO LA DE LA CONTRASENA. MEDIDO 2026-09-30: el password de la base no
 * esta disponible (lo que hay en el portapapeles era un access token, 127 caracteres, que no
 * es un password de base: no llega a eso). Un access token del Management API SI alcanza para
 * ejecutar SQL: es `POST /v1/projects/{ref}/database/query`. O sea que con el token que ya se
 * tiene se puede DIAGNOSTICAR y APLICAR sin pedirle a nadie que resetee una password, que es un
 * cambio real en la base hecho por un problema de credenciales.
 *
 * USO. El token llega en la variable, nunca en el historial ni en el repo:
 *   $env:SUPABASE_ACCESS_TOKEN = (Get-Clipboard -Raw).Trim()
 *   node scripts/aplicar-ddl.mjs              # aplica
 *   node scripts/aplicar-ddl.mjs --diagnosticar  # solo lee, no escribe NADA
 *   Remove-Item Env:SUPABASE_ACCESS_TOKEN
 *
 * EL DIAGNOSTICO NO ES UN ADorno. Este script tiene un MODO DIAGNOSTICO de verdad, que no
 * escribe nada y responde las preguntas que el DDL necesita antes de aplicarse:
 *   1. Que indices unicos existen HOY en cada tabla de catalogo, y si son PARCIALES. Un indice
 *      unico parcial es lo que hace que ON CONFLICT no se pueda inferir (42P01).
 *   2. Si hay filas duplicadas en la clave natural de cada una. Si las hay, el `create unique
 *      index` va a FALLAR, y eso hay que saberlo antes de aplicarlo, no despues.
 *   3. Cuantas filas tienen `codigo` vacio en tools y subcontracts, que es lo que el `update`
 *      del DDL va a renombrar a LEGADO-<id>. Si son cero, ese update no toca nada.
 *
 * POR QUE NO BORRA NADA NI DESPUES DE APLICAR. Por el PELIGRO MEDIDO de RULE-SUP-021: un
 * script que "limpia" duplicados borra filas que nadie pidio borrar. Si el diagnostico trouve
 * duplicados, este script PARA y los lista. Que sobreviva una fila u otra lo decide alguien
 * que mire las dos, no un delete de noche.
 *
 * NO IMPRIME EL TOKEN. Nunca. Ni en un error, ni en un log, ni con una excepcion de fetch.
 */
import { readFileSync } from "node:fs";

const token = String(process.env.SUPABASE_ACCESS_TOKEN || "").trim();
if (!token) {
  console.error("Falta SUPABASE_ACCESS_TOKEN");
  process.exit(1);
}

// QUE SE ESTA COPIANDO, MEDIDO 2026-09-30 dos veces seguidas.
//
// La primera: se copio un texto de 98 caracteres que empezaba con "El proye..." y el API
// contesto 401 "Format is Authorization: Bearer [token]". La segunda: se copio algo de 127
// caracteres que NO era un access token sino otra cosa. Los dos errores son el MISMO, y no
// dicen que el valor este mal: dicen que el formato del encabezado esta mal, que es un sintoma
// de Authorization, no del token. Un error que no dice la causa hace perder un viaje entero.
//
// Por eso se valida el PREFIJO antes de hacer nada. Un access token del Management API empieza
// con sbp_. Un password de base no. Una service_role key no. Una frase copiada por error no.
// Con esto, el error dice la causa en el primer segundo y sin salir a la red.
const pareceAccessToken = /^sbp_[A-Za-z0-9_-]{20,}$/.test(token);
if (!pareceAccessToken) {
  console.error("El valor de SUPABASE_ACCESS_TOKEN no parece un access token de Supabase.");
  console.error("  largo: " + token.length + " caracteres");
  console.error('  empieza con: "' + token.slice(0, 8) + '..."');
  console.error("");
  console.error("Un access token del Management API empieza con sbp_ y no lleva espacios.");
  console.error("Se saca de Supabase -> Account Preferences -> Access Tokens -> Generate new token.");
  console.error("  Ojo: es un token DE CUENTA, no del proyecto. El de proyecto es la service_role key.");
  console.error("");
  console.error("Lo que NO sirve para esto:");
  console.error("  - la service_role key, que empieza con sb_secret_");
  console.error("  - la publishable key, sb_publishable_");
  console.error("  - el password de la base, que no tiene prefijo");
  console.error("  - la connection string completa");
  process.exit(2);
}

const REF = "xtgtfjcwxcoxvixholpj";
const API = "https://api.supabase.com/v1/projects";
const SOLO_LEER = process.argv.includes("--diagnosticar");
const archivoDdl = process.argv.find((a) => a.endsWith(".sql")) || "docs/schema-supabase-cierre-catalogos.sql";

/** Ejecuta SQL contra la base. Es la unica salida: todo pasa por aqui. */
async function sql(consulta) {
  const r = await fetch(`${API}/${REF}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: consulta }),
  });
  const texto = await r.text();
  let datos = null;
  try { datos = JSON.parse(texto); } catch { datos = null; }
  if (!r.ok) {
    // SeCleanza el mensaje de toda referencia al token por si el API lo devolviera en un error.
    const limpio = String(texto || r.statusText).split(token).join("[redactado]");
    throw new Error(limpio.slice(0, 400));
  }
  return datos;
}

/**
 * El divisor de sentencias de apply-sql-supabase.mjs, SIN ejecutar ese archivo.
 *
 * POR QUE NO SE HACE import. MEDIDO 2026-09-30: importarlo corrio el archivo entero, que
 * conecta a la base con SUPABASE_DB_PASSWORD y sale con process.exit(1) si no la encuentra.
 * O sea que abortaba este script antes de aplicar nada, y decia 'Falta SUPABASE_DB_PASSWORD'
 * en un script que no la necesita: usa un access token.
 *
 * SE RECUERDA POR QUE SE USA EL MISMO DIVISOR Y NO UNO NUEVO: tiene que entender
 * comentarios, literales y dollar-quoting. Un segundo divisor parecido seria un segundo juego
 * de reglas que puede partir un cuerpo $ por la mitad, y el cuerpo de ingesta_mirror es
 * exactamente eso. Uno solo, con sus 19 tests, usado por los dos scripts.
 */
function obtenerDivisor() {
  const fuente = readFileSync(new URL("./apply-sql-supabase.mjs", import.meta.url), "utf8");
  const desde = fuente.indexOf("export function dividir(");
  if (desde < 0) throw new Error("no se encontro la funcion dividir en apply-sql-supabase.mjs");
  const hasta = fuente.indexOf("\n  return partes;", desde);
  if (hasta < 0) throw new Error("no se pudo localizar el final de dividir");
  // MEDIDO 2026-09-30: el corte tiene que INCLUIR la llave de cierre. Con indexOf("\n}") como
  // limite exclusivo, el cuerpo salia terminado en `return partes;` y new Function tiraba
  // "Unexpected token ')'". Un error de sintaxis en un recorte de texto dice muy poco de donde
  // viene, asi que el recorte se hace explicito y se comprueba con una asercion.
  const corte = fuente.indexOf("\n}", hasta);
  if (corte < 0) throw new Error("no se encontro la llave de cierre de dividir");
  const cuerpo = fuente.slice(desde, corte + 2);
  const limpio = cuerpo.replace("export function dividir", "function dividir");
  if (!/^\s*function dividir[\s\S]*\}\s*$/.test(limpio)) {
    throw new Error("el recorte de dividir no quedo balanceado; no se aplica nada");
  }
  return { dividir: new Function(limpio + "; return dividir;")() };
}
const caja = (t) => console.log(`\n=== ${t} ${"=".repeat(Math.max(0, 62 - t.length))}`);

async function verificarAcceso() {
  caja("ACCESO");
  const r = await fetch(`${API}/${REF}`, {
    headers: { Authorization: `Bearer ${token}`, apikey: token },
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`el token no alcanza el proyecto ${REF}: HTTP ${r.status} ${t.split(token).join("[redactado]").slice(0, 200)}`);
  }
  const p = await r.json();
  console.log(`proyecto: ${p.name} (${p.id})`);
  console.log(`region:   ${p.region}`);
  console.log(`estado:   ${p.status}`);
  return p;
}

async function diagnostico() {
  caja("1. INDICES UNICOS HOY (por que falla el on_conflict)");
  const idx = await sql(`
    select
      coalesce(t.relname, '')                       as tabla,
      i.relname                                    as indice,
      ix.indisunique                              as unico,
      (ix.indpred is not null)                     as parcial,
      pg_get_indexdef(ix.indexrelid)               as definicion
    from pg_index ix
    join pg_class i on i.oid = ix.indexrelid
    join pg_class t on t.oid = ix.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname in ('tools','subcontracts','calendar_exceptions','ot_configurations',
                        'article_configurations','machine_planning_overrides')
    order by t.relname, i.relname;
  `);
  const porTabla = {};
  for (const r of idx) (porTabla[r.tabla] ||= []).push(r);
  for (const tabla of ["tools", "subcontracts", "calendar_exceptions", "ot_configurations", "article_configurations", "machine_planning_overrides"]) {
    const lista = porTabla[tabla] || [];
    if (!lista.length) { console.log(`  ${tabla.padEnd(30)} SIN NINGUN INDICE`); continue; }
    for (const r of lista) {
      const marcas = [r.unico ? "UNIQUE" : "no unique", r.parcial ? "PARCIAL  <-- no lo infiere ON CONFLICT" : "completo"];
      console.log(`  ${tabla.padEnd(30)} ${r.indice.padEnd(38)} ${marcas.join(", ")}`);
    }
  }

  caja("2. DUPLICADOS EN LA CLAVE NATURAL (si hay, el create index FALLA)");
  // Cada consulta cuenta los grupos repetidos, no las filas: lo que decide si el indice se puede
  // crear es si hay mas de una fila con la misma clave.
  const duplicados = [
    ["tools", "codigo", "codigo is not null and btrim(codigo) <> ''", "codigo"],
    ["subcontracts", "codigo", "codigo is not null and btrim(codigo) <> ''", "codigo"],
    ["calendar_exceptions", "(fecha_inicio, concepto, maquina)", "fecha_inicio is not null", "coalesce(fecha_inicio::text,'') || '|' || coalesce(concepto,'') || '|' || coalesce(maquina,'')"],
    ["ot_configurations", "ot", "ot is not null and btrim(ot) <> ''", "ot"],
    ["article_configurations", "articulo", "articulo is not null and btrim(articulo) <> ''", "articulo"],
    ["machine_planning_overrides", "machine_nombre", "machine_nombre is not null and btrim(machine_nombre) <> ''", "machine_nombre"],
  ];
  let hayDuplicados = 0;
  for (const [tabla, clave, donde, expr] of duplicados) {
    const r = await sql(`select count(*)::int as grupos from (select ${expr} from public.${tabla} where ${donde} group by ${expr} having count(*) > 1) x;`);
    const n = Number(r?.[0]?.grupos || 0);
    if (n) { hayDuplicados += n; console.log(`  ${tabla.padEnd(30)} ${String(n).padStart(4)} clave(s) repetida(s)  <-- BLOQUEA el indice`); }
    else { console.log(`  ${tabla.padEnd(30)}    0 sin duplicados`); }
  }

  caja("3. FILAS CON codigo VACIO (lo que el update del DDL renombra a LEGADO-<id>)");
  for (const tabla of ["tools", "subcontracts"]) {
    const r = await sql(`select count(*)::int as vacias, count(*)::int as total from public.${tabla};`);
    const fila = r?.[0] || {};
    const total = Number(fila.total || 0);
    const soloVacias = await sql(`select count(*)::int as n from public.${tabla} where codigo is null or btrim(codigo) = '';`);
    const v = Number(soloVacias?.[0]?.n || 0);
    console.log(`  ${tabla.padEnd(30)} ${v} de ${total} sin codigo` + (v ? "  -> el update las renombra (se puede deshacer: el id no cambia)" : "  -> el update no toca nada"));
  }

  caja("4. EL RPC DEL ESPEJO (23502 en las 7 tablas)");
  const rpc = await sql(`
    select p.proname,
      pg_get_functiondef(p.oid) like '%insert into public.%I select%' as usa_star,
      pg_get_functiondef(p.oid) like '%v_cols_i%' as usa_columnas
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('ingesta_mirror','plan_guardar');
  `);
  for (const r of rpc) {
    console.log(`  ${String(r.proname).padEnd(16)} declara el INSERT con columnas nombradas: ${r.usa_columnas === true || r.usa_columnas === "t" ? "SI" : "NO (usa el .* que rompe con 23502)"}`);
  }

  caja("5. CONTEOS (de contexto)");
  for (const tabla of ["operations", "materials", "work_orders", "tools", "subcontracts", "calendar_exceptions", "ot_configurations"]) {
    const r = await sql(`select count(*)::int as n from public.${tabla};`);
    console.log(`  ${tabla.padEnd(30)} ${String(r?.[0]?.n ?? "?").padStart(8)} filas`);
  }

  return hayDuplicados;
}

// ---------------------------------------------------------------------------

try {
  console.log(`token: ${token.length} caracteres, prefijo ${token.slice(0, 4)}... (no se imprime)`);
  const p = await verificarAcceso();

  if (p.status && p.status !== "ACTIVE_HEALTHY") {
    console.log(`\nAVISO: el proyecto esta en estado "${p.status}".`);
  }

  const duplicados = await diagnostico();

  if (SOLO_LEER) {
    caja("FIN DEL DIAGNOSTICO");
    if (duplicados) {
      console.log(`HAY ${duplicados} CLAVE(S) DUPLICADA(S). El DDL va a FALLAR en el create unique index,`);
      console.log("y NO se van a borrar filas para forzar el indice: eso lo decide alguien mirando las dos.");
      console.log("Hay que resolver eso antes de aplicar.");
      process.exit(3);
    }
    console.log("Sin duplicados: el DDL se puede aplicar. Correr sin --diagnosticar para aplicarlo.");
    process.exit(0);
  }

  caja("APLICANDO " + archivoDdl);
  const { dividir } = obtenerDivisor();
  const partes = dividir(readFileSync(archivoDdl, "utf8"));
  console.log(`${partes.length} sentencias\n`);
  let ok = 0;
  const fallos = [];
  for (let i = 0; i < partes.length; i += 1) {
    const s = partes[i].replace(/^\s*(--[^\n]*\n)+/, "").trim();
    if (!s) continue;
    const primera = s.split("\n")[0].slice(0, 74);
    try {
      await sql(s);
      ok += 1;
      console.log(`  [ok   ${String(i + 1).padStart(2)}] ${primera}`);
    } catch (error) {
      fallos.push({ n: i + 1, sql: primera, msg: error.message });
      console.log(`  [FALLA${String(i + 1).padStart(2)}] ${primera}`);
      console.log(`          ${error.message.slice(0, 220)}`);
    }
  }
  caja("RESULTADO");
  console.log(`${ok} de ${partes.length} sentencias aplicadas.`);
  if (fallos.length) {
    console.log("\nFALLARON:");
    for (const f of fallos) console.log(`  ${f.n}. ${f.sql}\n     ${f.msg.slice(0, 200)}`);
    process.exit(1);
  }
  console.log("\nAhora corre de nuevo con --diagnosticar: los indices tienen que salir UNIQUE y sin PARCIAL.");
  process.exit(0);
} catch (error) {
  console.error("\nERROR: " + String(error.message || error).split(token).join("[redactado]"));
  process.exit(1);
}
