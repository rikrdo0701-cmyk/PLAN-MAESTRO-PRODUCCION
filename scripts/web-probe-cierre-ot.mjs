/**
 * Sonda web de PRODUCCION: comprueba si una OT cerrada sale del plan, y si el mecanismo que
 * deberia accomplishinglo existe, esta permitido y se ha ejercitado alguna vez.
 *
 * POR QUE OTRA SONDA, Y POR QUE ESTA. VERIFICA_CIERRE_OT.gs ya existe y verifica que la funcion
 * del servidor (confirmWorkOrderClosures) consulta bien a NetSuite folio por folio. Ese es el
 * LADO DEL SERVIDOR. Esta sonda es el LADO DE LA WEB, que es donde se rompio: la app corre en
 * GitHub Pages, dentro del navegador, y ahi ese mecanismo no existe. Medido el 2026-09-27:
 *   - el puente responde "Metodo no permitido: confirmWorkOrderClosures" en 1 ms, porque el
 *     metodo no esta en ALLOWED_METHODS (src/web/bridge/Bridge.html:17-56);
 *   - la unica llamada a confirmUnconfirmedWorkOrderClosures() esta en la rama de Apps Script de
 *     syncNetSuiteData (src/web/planning/app.js:10002). La rama del navegador (linea 10003) no la
 *     llama, y la ruta que el boton "Sincronizar OTs" usa de verdad (syncBacklogWorkOrders,
 *     linea 9394) tampoco;
 *   - por eso lastWorkOrderClosureCheck llega null desde el servidor: la funcion escribe ese campo
 *     tanto en exito como en error, asi que null prueba que nunca se intento.
 *
 * Y por que eso importa mas de lo que parece. TODAS las rutas de listado usan onlyOpen:true
 * (src/server/08-netsuite.js:54, 87, 116, 119 y 15-performance-service.js:295). Una OT cerrada no
 * llega: se pierde del payload. Y desde el 2026-09-26 (RULE-OT-051) la ausencia ya NO poda: solo
 * marca unconfirmedWorkOrders y espera que NetSuite lo confirme. Si el que confirma nunca se
 * llama, la OT se queda en el plan para siempre, con su aviso de "sin confirmar". Eso es
 * exactamente "una OT cerrada que following ahi".
 *
 * QUE MIDE, Y POR QUE CADA PUNTO ES DECISIVO
 *   1. PUERTA. Si el puente responde "Metodo no permitido" a confirmWorkOrderClosures, la via
 *      oficial no existe desde la web. Es un fallo por si mismo, aunque no haya ninguna OT
 *      cerrada hoy: es un mecanismo ausente, no uno que todavia no ha definido nada.
 *   2. EJERCITADO. Si lastWorkOrderClosureCheck es null, el mecanismo nunca se ha corrido. Un
 *      mecanismo que nunca se ha corrido no esta verificado, solo presente.
 *   3. FALLO REAL, CON FOLIO. Para cada OT del borrador generado y para cada OT marcada por
 *      confirmar, se le pregunta a NetSuite su estatus por el 2244 detail (getInspectionWorkOrder,
 *      que SI esta permitido y hace la misma llamada que confirmWorkOrderClosures). Toda OT que
 *      NetSuite declare cerrada y que ademas siga en el plan o en el borrador es el fallo, con
 *      nombre. Esto es lo que el usuario ve y no puede explicar.
 *
 * LO QUE NO HACE. No escribe nada: no sincroniza, no genera plan, no guarda, no poda. Solo lee
 * el borrador, el estado y pregunta estatus a NetSuite. La unica llamada que podria tener efecto
 * (confirmWorkOrderClosures) es de solo lectura por definicion, y si el puente la admitiera
 * seguiria sin efecto: podar es del cliente, no del servidor.
 *
 * REGLA DE LA SONDA, Y NO ES DECORATIVA. Se juzga solo lo que se pregunto. Si el tope de folios
 * deja OTs sin preguntar, se reportan como "sin juicio" y NO como fallo ni como exito. Es la
 * leccion de RULE-OT-051 aplicada a la propia sonda: la ausencia de una consulta no es evidencia.
 *
 * CUANTO GASTA. Una llamada al 2244 por folio, con tope de 20 folios por omision (--max=), que es
 * el mismo tope que impone el servidor. Un ciclo completo de arranque mas getAppState mas borrador
 * mas N folios. Contra la cuota de 20 000 UrlFetch/dia es poco, pero se dice cuantos folios
 * quedaron sin preguntar para que el dato sea completo.
 *
 * Uso:  node scripts/web-probe-cierre-ot.mjs [--url=...] [--max=20] [--headed]
 * Salida: artifacts/web-probe-cierre-ot-<sello>.json. Sale con codigo 1 si hay fallos.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = (name) => args.includes(`--${name}`);

const URL_BASE = flag("url", "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION");
const MAX_FOLIOS = Math.max(1, Number(flag("max", 20)));
const HEADED = has("headed");

// Las palabras del SERVIDOR (PP_CONFIRMED_CLOSED_WORDS_, src/server/16-inspection-service.js:247),
// no las del cliente. La pregunta es "dice NetSuite que esta cerrada", no "la app lo cree".
const CERRADAS = ["CERRAD", "CLOSED", "COMPLET", "CANCELAD", "CANCELED", "CANCELLED"];
const norm = (value) => String(value ?? "")
  .trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
const diceCerrada = (status) => {
  const n = norm(status);
  if (!n) return null; // NetSuite no devolvio estatus: no se sabe nada, no es "abierta"
  return CERRADAS.some((palabra) => n.includes(palabra));
};

const sello = new Date().toISOString().replace(/[:.]/g, "-");
const OUT = `artifacts/web-probe-cierre-ot-${sello}.json`;

const browser = await chromium.launch({ headless: !HEADED });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const llamada = (method, args = []) => page.evaluate(async (p) => {
  const t0 = performance.now();
  try {
    const r = await window.PPAppsScriptBridge.call(p.method, p.args);
    return { ms: Math.round(performance.now() - t0), ok: true, result: r };
  } catch (e) {
    return { ms: Math.round(performance.now() - t0), ok: false, error: String(e?.message || e).slice(0, 300) };
  }
}, { method, args });

const fallos = [];
const notas = [];
const destino = (n) => String(n ?? "").trim().toUpperCase();

await page.goto(URL_BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(15000);

const informe = { url: URL_BASE, at: new Date().toISOString(), maxFolios: MAX_FOLIOS, fallos: [], notas: [] };

// ---------------------------------------------------------------- 1. LA PUERTA
// Si el puente no admite el metodo, la via oficial no existe desde la web. Se pregunta igual, con
// un folio de prueba, porque el rechazo es la evidencia y no hace falta que el folio sea real.
const puerta = await llamada("confirmWorkOrderClosures", [[]]);
informe.puerta = { ok: puerta.ok, ms: puerta.ms, error: puerta.error || null };
if (!puerta.ok) {
  const falta = /Metodo no permitido/i.test(puerta.error || "");
  const msg = falta
    ? "el puente NO admite confirmWorkOrderClosures (no esta en ALLOWED_METHODS de Bridge.html): "
      + "la unica via con la que NetSuite confirma un cierre no existe desde la web"
    : "confirmWorkOrderClosures fallo de otra manera: " + puerta.error;
  informe.fallos.push({ punto: "1-puerta", msg });
  notas.push(`1) ${msg} (${puerta.ms} ms)`);
} else {
  notas.push("1) bien: el puente admite confirmWorkOrderClosures.");
}

// ------------------------------------------------------- 2. EL ESTADO Y SI SE EJERCITO
const appState = await llamada("getAppState", []);
if (!appState.ok) {
  informe.fallos.push({ punto: "2-estado", msg: `getAppState fallo: ${appState.error}` });
  notas.push(`2) getAppState fallo: ${appState.error}`);
} else {
  const st = appState.result?.state || appState.result;
  const check = st?.lastWorkOrderClosureCheck ?? null;
  const sinConfirmar = Object.keys(st?.unconfirmedWorkOrders || {});
  const avisos = st?.workOrderSyncWarnings || [];
  informe.estado = {
    ms: appState.ms,
    fichas: (st?.workOrders || []).length,
    seleccionadas: (st?.selectedOts || []).length,
    operaciones: (st?.operations || []).length,
    resumenesCerradas: Object.keys(st?.closedWorkOrderSummaries || {}).length,
    sinConfirmar,
    avisosSinConfirmar: avisos.length,
    lastWorkOrderClosureCheck: check,
  };
  notas.push(`2) estado: ${informe.estado.fichas} fichas, ${informe.estado.seleccionadas} en el plan, `
    + `${informe.estado.operaciones} operaciones, ${informe.estado.sinConfirmar.length} por confirmar, `
    + `lastWorkOrderClosureCheck=${check ? "presente" : "null"}`);

  if (!check) {
    informe.fallos.push({
      punto: "2-ejercitado",
      msg: "lastWorkOrderClosureCheck es null: la confirmacion folio por folio NUNCA se ha corrido "
        + "desde la web. La funcion escribe ese campo tambien cuando falla, asi que null prueba "
        + "que no se intento, no que se intento sin exito.",
    });
  }
}

// ------------------------------------------------------------ 3. EL BORRADOR GENERADO
// Es el artefacto donde el usuario vio la OT cerrada. El estado es otro distinto, y medirlos por
// separado es lo que hacia falta: una OT puede estar en el plan y no en el borrador, o al reves.
const borrador = await llamada("getPlanSnapshotLight", ["draft"]);
const foliosBorrador = [];
let borradorMs = null;
if (!borrador.ok) {
  informe.fallos.push({ punto: "3-borrador", msg: `getPlanSnapshotLight fallo: ${borrador.error}` });
  notas.push(`3) no se pudo leer el borrador: ${borrador.error}`);
} else {
  borradorMs = borrador.ms;
  const L = borrador.result?.data || borrador.result?.result || borrador.result;
  const ops = L?.operations || [];
  foliosBorrador.push(...[...new Set(ops.map((o) => destino(o?.ot)).filter(Boolean))]);
  informe.borrador = {
    ms: borrador.ms,
    snapshotId: L?.snapshotId || null,
    generadoEn: L?.generatedAt || null,
    planStart: L?.planStart || null,
    operaciones: ops.length,
    otDistintas: new Set(foliosBorrador).size,
    // Estatus que declara el propio borrador. Si aqui hubiera "CERRADO" seria un fallo local, sin
    // necesidad de preguntar a nadie.
    estatusOperaciones: ops.reduce((acc, o) => {
      const e = norm(o?.estatus) || "(vacio)";
      acc[e] = (acc[e] || 0) + 1;
      return acc;
    }, {}),
  };
  notas.push(`3) borrador: ${ops.length} operaciones, ${informe.borrador.otDistintas} OTs, `
    + `generado ${informe.borrador.generadoEn || "sin fecha"} (${borrador.ms} ms)`);
  if (informe.borrador.estatusOperaciones.CERRADO) {
    informe.fallos.push({
      punto: "3-borrador-estatus",
      msg: `el borrador trae ${informe.borrador.estatusOperaciones.CERRADO} operacion(es) con estatus CERRADO. `
        + "Con RULE-OT-051 una operacion cerrada NO borra la OT, pero debe haber aviso, no un "
        + "silencio. Sin folio no se puede judge cual.",
    });
  }
}

// --------------------------------------- 4. PREGUNTAR A NETSUITE, Y JUZGAR SOLO LO PREGUNTADO
// Orden de prioridad: primero las que el app ya sospecha (por confirmar), luego las del borrador,
// luego las del plan. Se cubre lo que se pueda con el tope y se reporta lo que quede fuera.
const st = appState.ok ? (appState.result?.state || appState.result) : {};
const sospechosas = Object.values(st?.unconfirmedWorkOrders || {}).map((item) => destino(item?.ot)).filter(Boolean);
const enPlan = (st?.selectedOts || []).map(destino).filter(Boolean);
const candidatos = [];
const agregar = (ot, origen) => { if (ot && !candidatos.some((c) => c.ot === ot)) candidatos.push({ ot, origen }); };
sospechosas.forEach((ot) => agregar(ot, "marcada-por-confirmar"));
[...new Set(foliosBorrador)].forEach((ot) => agregar(ot, "borrador"));
enPlan.forEach((ot) => agregar(ot, "en-el-plan"));

const consultadas = candidatos.slice(0, MAX_FOLIOS);
const sinPreguntar = candidatos.slice(MAX_FOLIOS).map((c) => c.ot);
informe.netsuite = {};
for (const { ot, origen } of consultadas) {
  const r = await llamada("getInspectionWorkOrder", [ot]);
  if (!r.ok) {
    informe.netsuite[ot] = { origen, error: r.error };
    notas.push(`4) ${ot}: ERROR ${r.error}`);
    continue;
  }
  const d = r.result?.data || r.result?.result || r.result || {};
  const wo = d.workOrder || d.trabajo || {};
  const ops = d.operations || [];
  const status = wo.status || wo.estatus || null;
  informe.netsuite[ot] = {
    origen,
    ms: r.ms,
    status,
    diceCerrada: diceCerrada(status),
    opsDevueltas: ops.length,
    opsCerradas: ops.filter((o) => diceCerrada(o?.estatus ?? o?.status)).length,
    enElPlan: enPlan.includes(ot),
    enElBorrador: foliosBorrador.includes(ot),
  };
  notas.push(`4) ${ot} (${origen}): ${status || "(sin estatus)"}`
    + ` cerrada=${informe.netsuite[ot].diceCerrada} opsCerradas=${informe.netsuite[ot].opsCerradas}/${ops.length}`);
}

informe.veredicto = {
  candidatos: candidatos.length,
  preguntados: consultadas.length,
  sinPreguntar,
  conError: Object.entries(informe.netsuite).filter(([, v]) => v.error).map(([ot, v]) => ({ ot, error: v.error })),
  // EL FALLO REAL: cerrada en NetSuite y todavia en el plan o en el borrador.
  cerradasQueSiguen: Object.entries(informe.netsuite)
    .filter(([, v]) => v.diceCerrada === true && (v.enElPlan || v.enElBorrador))
    .map(([ot, v]) => ({ ot, status: v.status, enElPlan: v.enElPlan, enElBorrador: v.enElBorrador })),
  cerradasConfirmadas: Object.entries(informe.netsuite).filter(([, v]) => v.diceCerrada === true).map(([ot]) => ot),
  abiertas: Object.entries(informe.netsuite).filter(([, v]) => v.diceCerrada === false).map(([ot]) => ot),
  sinEstatus: Object.entries(informe.netsuite).filter(([, v]) => v.diceCerrada === null && !v.error).map(([ot]) => ot),
  cerradasPorUnaOperacion: Object.entries(informe.netsuite).filter(([, v]) => v.opsCerradas > 0).map(([ot]) => ot),
};

if (informe.veredicto.cerradasQueSiguen.length) {
  informe.fallos.push({
    punto: "4-fallo-real",
    msg: `${informe.veredicto.cerradasQueSiguen.length} OT(s) que NetSuite da por CERRADAS siguen en el plan `
      + `o en el borrador: ${informe.veredicto.cerradasQueSiguen.map((c) => c.ot).join(", ")}. `
      + "Es el fallo con nombre que pediste detectar.",
  });
}
if (informe.veredicto.sinPreguntar.length) {
  // No es un fallo: es el limite de la corrida, y se dice para que el dato sea completo.
  informe.notas.push(`4) ${informe.veredicto.sinPreguntar.length} OT(s) NO se preguntaron por el tope de `
    + `${MAX_FOLIOS}, y de esas no se afirma nada: ${informe.veredicto.sinPreguntar.join(", ")}`);
}
if (informe.veredicto.sinEstatus.length) {
  informe.fallos.push({
    punto: "4-sin-estatus",
    msg: `${informe.veredicto.sinEstatus.length} OT(s) volvieron SIN estatus de NetSuite. Sin estatus no se `
      + "puede juzgar el cierre; es un estado degradado seguro, pero hay que saberlo.",
  });
}

informe.fallos = informe.fallos;
informe.costo = { getAppState: appState.ms, borrador: borradorMs, consultasNetSuite: Object.keys(informe.netsuite).length };

console.log("\n=== web-probe-cierre-ot ===");
console.log("url:", URL_BASE);
for (const n of notas) console.log("  " + n);
if (informe.notas.length) for (const n of informe.notas) console.log("  nota: " + n);
console.log("\n--- veredicto ---");
console.log(JSON.stringify(informe.veredicto, null, 1));
console.log("\n--- fallos: " + informe.fallos.length + " ---");
for (const f of informe.fallos) console.log("  [" + f.punto + "] " + f.msg);

await mkdir("artifacts", { recursive: true });
await writeFile(OUT, JSON.stringify(informe, null, 2), "utf8");
console.log("\nartifact:", OUT);

await browser.close();
process.exit(informe.fallos.length ? 1 : 0);
