/**
 * Sonda web de PRODUCCION: genera un plan de verdad, con el boton y los dialogos de verdad, y
 * reporta cada error que aparezca. El objetivo es el del usuario: PODER HACER UN PLAN.
 *
 * POR QUE EXISTE. La sonda local (scripts/web-probe.mjs) ya ejercita generar plan contra un stub,
 * y ahi todo sale verde. Eso no dice nada de produccion, que es donde viven las tres cosas que
 * rompen un plan: la red (el puente Apps Script, que ya dio un tiempo agotado de 120 s el
 * 2026-09-27), el volumen real (25 OTs y 314 operaciones, no las 40 de la sonda) y los datos que
 * NetSuite todavia no entrego. Esta sonda corre el flujo completo en el sitio desplegado.
 *
 * ORDEN, Y POR QUE EN ESE ORDEN. Escribir en produccion no es reversible con un boton, asi que:
 *   1. RESPALDO. Se copia el estado y el borrador actuales a artifacts/ ANTES de tocar nada, y se
 *      anota el snapshotId del borrador. Si la generacion deja el plan peor, con el respaldo se
 *      puede comparar folio por folio y saber que cambio.
 *   2. ARRANQUE. Se espera a que la app quede lista (#generatePlanBtn habilitado). El tiempo que
 *      tarda es en si mismo un dato: es el arranque que dio "Tiempo agotado al ejecutar
 *      getAppState" y que se corrigio en 2.51.0.
 *   3. CORRIDA EN SECO. window.runPlanningPerformanceDryRun corre el motor de programacion SIN
 *      escribir nada y devuelve metricas y diagnosticos. Si aqui ya hay operaciones sin hueco o
 *      conflictos, se sabe antes de escribir, y el fallo es del motor y no de la red.
 *   4. GENERACION REAL. Se pulsa #generatePlanBtn y se contestan los dialogos. Esto SI escribe:
 *      programa, guarda el borrador y persiste el estado.
 *   5. VERIFICACION. Cola, OTs pendientes de programar, avisos, Gantt, y una segunda corrida en
 *      seco para ver como quedo.
 *
 * LOS DIALOGOS, Y POR QUE NO SE CONTESTAN A LO VOLA. Generar plan abre el dialogo de semana y, si
 * falta informacion, abre mas (RULE-ASKCONF-001: pedir, no bloquear). Se aceptan los que se
 * pueden aceptar sin inventar datos. Hay UN caso donde la app se niega a continuar: si pide un
 * precio unitario manual y las tres fuentes estan en cero, confirmZeroManualPrice (app.js:3881)
 * bloquea con un aviso. ESO NO SE RELLENA: un precio es un dato de negocio y la sonda no lo
 * inventa. Se reporta y se detiene, que es la respuesta honesta.
 *
 * LO QUE NO HACE. No publica el plan, no sincroniza NetSuite, no borra OTs, no inventa precios. El
 * unico dato que cambia es el propio plan que se pidio generar, y el respaldo queda en artifacts.
 *
 * Aviso: generar plan ESCRIBE en produccion (programa, guarda el borrador y persiste el estado).
 * Por eso el respaldo va primero y por eso --dry existe para diagnosticar sin escribir.
 *
 * --asignar, Y POR QUE NO SE ADIVINA. La app se niega a generar el plan cuando una capacidad no
 * tiene operador (RULE-ASKCONF-001). Que operador le corresponde a cada capacidad es un dato de
 * negocio que NO esta en el codigo ni en NetSuite: lo decide la persona. Por eso la sonda no lo
 * deduce: lo recibe por --asignar y solo marca las casillas que se le pasaron. Si se equivoca la
 * asignacion, el error es de quien la paso, no de la sonda, y el artefacto deja escrito cual fue.
 * MEDIDO el 2026-09-27: la capacidad 5493::55OTD : ARMADO DE RACK estaba sin operador y bloqueaba
 * el plan; las dos operaciones que la necesitan (OT 3487 sec 17 y OT 3562 sec 6) ya traian
 * operador PUNTEADOR, y PUNTEADOR ya atendia 22OTD y 31OTD. La persona confirmo PUNTEADOR.
 *
 * Uso:  node scripts/web-probe-generar-plan.mjs [--url=...] [--dry] [--headed] [--timeout=900000]
 *       [--asignar="<clave_capacidad>=<OPERADOR>[,<OPERADOR>]"]   (repetible)
 * Salida: artifacts/web-probe-generar-plan-<sello>.json. Sale con codigo 1 si hay fallos.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = (name) => args.includes(`--${name}`);

// Cada --asignar es "<clave_capacidad>=<OPERADOR>[,<OPERADOR>]". Se acumulan si viene repetido.
const ASIGNACIONES = args
  .filter((value) => value.startsWith("--asignar="))
  .map((value) => {
    const [clave, operadores] = value.slice("--asignar=".length).split("=");
    return { clave: String(clave || "").trim(), operadores: String(operadores || "").split(",").map((o) => o.trim()).filter(Boolean) };
  })
  .filter((item) => item.clave && item.operadores.length);

const URL_BASE = flag("url", "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION");
const TIMEOUT_MS = Number(flag("timeout", 900000));
const SOLO_SECO = has("dry");
const HEADED = has("headed");
const MAX_DIALOGOS = 12;

const sello = new Date().toISOString().replace(/[:.]/g, "-");
const OUT = `artifacts/web-probe-generar-plan-${sello}.json`;

const fallos = [];
const paso = (msg) => console.log("  " + msg);

const browser = await chromium.launch({ headless: !HEADED });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

// Todo lo que la app diga, se guarda. Un error que solo sale en consola es un error que el
// usuario no ve, y es justo el que hay que encontrar.
await page.addInitScript(() => {
  window.__log = { toasts: [], errores: [], warnings: [], rechazos: [] };
  const doc = window.document;
  const obs = new MutationObserver(() => {
    const t = doc.querySelector("#toast");
    const msg = t ? String(t.textContent || "").trim() : "";
    if (msg && window.__log.toasts[window.__log.toasts.length - 1] !== msg) {
      window.__log.toasts.push(msg);
    }
  });
  const arranque = () => {
    const nodo = doc.querySelector("#toast");
    if (nodo) {
      obs.observe(nodo, { childList: true, characterData: true, subtree: true });
    } else {
      setTimeout(arranque, 200);
    }
  };
  arranque();
  const oe = console.error, ow = console.warn;
  console.error = (...a) => { window.__log.errores.push(a.map(String).join(" ").slice(0, 400)); oe(...a); };
  console.warn = (...a) => { window.__log.warnings.push(a.map(String).join(" ").slice(0, 400)); ow(...a); };
  window.addEventListener("error", (e) => window.__log.errores.push("window.error: " + String(e.message).slice(0, 400)));
  window.addEventListener("unhandledrejection", (e) => window.__log.rechazos.push(String((e.reason && e.reason.message) || e.reason).slice(0, 400)));
});

const llamada = (method, args = []) => page.evaluate(async (p) => {
  const t0 = performance.now();
  try {
    const r = await window.PPAppsScriptBridge.call(p.method, p.args);
    return { ms: Math.round(performance.now() - t0), ok: true, result: r };
  } catch (e) {
    return { ms: Math.round(performance.now() - t0), ok: false, error: String(e?.message || e).slice(0, 400) };
  }
}, { method, args });

const informe = {
  url: URL_BASE, at: new Date().toISOString(), soloSeco: SOLO_SECO, fallos: [],
  asignacionesPedidas: ASIGNACIONES, asignacionesAplicadas: [],
};

console.log("\n=== web-probe-generar-plan ===");
console.log("url:", URL_BASE, SOLO_SECO ? "(solo corrida en seco, no escribe)" : "(ESCRIBE: genera el plan)");
if (ASIGNACIONES.length) {
  console.log("asignaciones autorizadas:", JSON.stringify(ASIGNACIONES));
}

// ------------------------------------------------------------------ 1. RESPALDO
await page.goto(URL_BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
paso("pagina cargada, esperando que la app quede lista...");

const tArranque = Date.now();
try {
  // El boton arranca deshabilitado y se habilita cuando la app puede trabajar. Este es el tiempo
  // de arranque medido en produccion, que es el que dio "Tiempo agotado al ejecutar getAppState".
  await page.waitForFunction(() => {
    const b = document.querySelector("#generatePlanBtn");
    return Boolean(b) && !b.disabled;
  }, { timeout: TIMEOUT_MS });
  informe.arranqueMs = Date.now() - tArranque;
  paso(`app lista en ${informe.arranqueMs} ms`);
} catch (e) {
  informe.arranqueMs = Date.now() - tArranque;
  informe.fallos.push({ punto: "arranque", msg: `la app no quedo lista en ${informe.arranqueMs} ms: ${String(e.message || e).slice(0, 200)}` });
  paso(`FALLO de arranque: ${String(e.message || e).slice(0, 200)}`);
}

await page.waitForTimeout(3000);

const estadoAntes = await llamada("getAppState", []);
if (!estadoAntes.ok) {
  informe.fallos.push({ punto: "respaldo", msg: `getAppState fallo: ${estadoAntes.error}` });
} else {
  const st = estadoAntes.result?.state || estadoAntes.result;
  const resumen = {
    ms: estadoAntes.ms,
    fichas: (st.workOrders || []).length,
    seleccionadas: (st.selectedOts || []).length,
    operaciones: (st.operations || []).length,
    planStart: st.planStart || null,
    lastSchedule: st.lastSchedule ? { at: st.lastSchedule.at, programadas: (st.lastSchedule.scheduledOts || []).length } : null,
    borradorSnapshotId: st.draftSnapshotId || null,
  };
  informe.respaldo = resumen;
  // El estado completo, para poder comparar despues. Es la unica copia de lo que se va a
  // sobreescribir, asi que se guarda entero.
  await mkdir("artifacts", { recursive: true });
  await writeFile(OUT.replace(/\.json$/, "-estado-antes.json"), JSON.stringify(st, null, 2), "utf8");
  paso(`respaldo: ${resumen.seleccionadas} OTs, ${resumen.operaciones} operaciones, `
    + `borrador ${resumen.borradorSnapshotId || "sin id"} -> ${OUT.replace(/\.json$/, "-estado-antes.json")}`);
}

const borradorAntes = await llamada("getPlanSnapshotLight", ["draft"]);
if (borradorAntes.ok) {
  const L = borradorAntes.result?.data || borradorAntes.result?.result || borradorAntes.result;
  informe.borradorAntes = {
    ms: borradorAntes.ms, snapshotId: L?.snapshotId || null, generadoEn: L?.generatedAt || null,
    planStart: L?.planStart || null, operaciones: (L?.operations || []).length,
  };
  await writeFile(OUT.replace(/\.json$/, "-borrador-antes.json"), JSON.stringify(L, null, 2), "utf8");
  paso(`borrador actual: ${informe.borradorAntes.operaciones} operaciones, generado ${informe.borradorAntes.generadoEn || "?"}`);
} else {
  informe.fallos.push({ punto: "borrador-antes", msg: `getPlanSnapshotLight fallo: ${borradorAntes.error}` });
}

// ------------------------------------------------------ 2. ESTADO DE LA COLA ANTES
const colaAntes = await page.evaluate(() => document.querySelectorAll(".queue-item").length);
const pendientesAntes = await page.evaluate(() => document.querySelectorAll(".queue-item.pending-schedule").length);
informe.colaAntes = { cola: colaAntes, pendientes: pendientesAntes };
paso(`cola: ${colaAntes} OTs, ${pendientesAntes} sin programar`);

// ------------------------------------------------------ 3. CORRIDA EN SECO (NO ESCRIBE)
// El motor de programacion, sin tocar nada. Si aqui hay operaciones sin hueco, el fallo es del
// motor y no de la red, y se sabe antes de escribir.
informe.rotulo = "antes";
informe.secoAntes = await page.evaluate(async (t) => {
  const t0 = performance.now();
  try {
    const r = await window.runPlanningPerformanceDryRun({ timeoutMs: t });
    return { ms: Math.round(performance.now() - t0), ok: true, metrics: r.metrics, timings: r.timings };
  } catch (e) {
    return { ms: Math.round(performance.now() - t0), ok: false, error: String(e?.message || e).slice(0, 400) };
  }
}, Math.min(TIMEOUT_MS, 300000));
if (informe.secoAntes.ok) {
  const m = informe.secoAntes.metrics || {};
  paso(`en seco: ${m.scheduledOperationsCount}/${m.includedOperationsCount} programadas, `
    + `${m.unscheduledOperationsCount} sin hueco, ${m.scheduledOtsCount} OTs, `
    + `diagnosticos ${JSON.stringify(m.diagnosticsByCode || {})}`);
} else {
  paso(`en seco FALLO: ${informe.secoAntes.error}`);
  informe.fallos.push({ punto: "en-seco", msg: `la corrida en seco fallo: ${informe.secoAntes.error}` });
}

if (SOLO_SECO) {
  paso("solo corrida en seco: no se pulsa el boton, no se escribe nada");
} else {
  // ------------------------------------------------------ 4. GENERACION REAL
  const dialogos = [];
  let bloqueadoPorPrecio = null;
  let bloqueadoPorValidacion = null;
  const tGen = Date.now();
  paso("pulsando #generatePlanBtn...");

  await page.evaluate(() => { const b = document.querySelector("#generatePlanBtn"); if (b) b.click(); });

  // Bucle de dialogos. Generar plan abre el de semana y puede abrir mas por falta de datos. Se
  // contesta lo que se puede contestar sin inventar nada, y se detiene ante el precio manual.
  const limite = Date.now() + TIMEOUT_MS;
  while (Date.now() < limite) {
    const abierto = await page.evaluate(() => {
      const d = document.querySelector("#planningDialog");
      if (!d || !d.open) return null;
      const precio = d.querySelector('input[name="ot_manual_price"]');
      return {
        titulo: String(d.querySelector("#planningDialogTitle")?.textContent || "").trim(),
        resumen: String(d.querySelector("#planningDialogSummary")?.textContent || "").trim(),
        cuerpo: String(d.querySelector("#planningDialogBody")?.textContent || "").trim().slice(0, 400),
        etiquetaConfirmar: String(d.querySelector("#planningDialogConfirm")?.textContent || "").trim(),
        confirmDeshabilitado: Boolean(d.querySelector("#planningDialogConfirm")?.disabled),
        cancelVisible: !d.querySelector("#planningDialogCancel")?.hidden,
        campos: [...d.querySelectorAll("input,select,textarea")].map((e) => ({
          name: e.name, type: e.type, value: String(e.value ?? "").slice(0, 60),
        })),
        precioPedido: precio ? Number(precio.value || 0) : null,
      };
    });
    if (!abierto) {
      // Sin dialogo: puede que este programando. Se espera a que el boton vuelva a estar libre.
      const ocupado = await page.evaluate(() => {
        const b = document.querySelector("#generatePlanBtn");
        return Boolean(b && (b.disabled || b.dataset.busy === "true"));
      });
      if (!ocupado) break;
      await page.waitForTimeout(1000);
      continue;
    }
    dialogos.push(abierto);
    paso(`dialogo: "${abierto.titulo}" | confirm=${abierto.etiquetaConfirmar} | campos=${abierto.campos.map((c) => c.name).join(",") || "ninguno"}`);

    // ASIGNACIONES AUTORIZADAS. Solo se marca lo que se paso por --asignar. El nombre del checkbox
    // es g_op_<clave_capabilidad> y su value es el nombre del operador (app.js:3323), asi que se
    // busca por esas dos cosas en vez de por selector, para no escapear una clave que trae "::",
    // espacios y "/". Si no aparece la casilla, el operador no esta entre los registrados: se
    // reporta y NO se usa el campo de operador nuevo, porque eso seria escribir un nombre nuevo.
    if (ASIGNACIONES.length) {
      const aplicadas = await page.evaluate((asignaciones) => {
        const hechas = [];
        const noEncontradas = [];
        const noAplica = [];
        const d = document.querySelector("#planningDialog");
        if (!d) return { hechas, noEncontradas, noAplica };
        const casillas = [...d.querySelectorAll("input[type=checkbox]")];
        for (const a of asignaciones) {
          const nombre = "g_op_" + a.clave;
          const delDialogo = casillas.filter((input) => input.name === nombre);
          // Si el dialogo no trae la seccion de esta capacidad, NO es un fallo: es otro dialogo
          // (el de la semana, o el de otra OT con otra capacidad). La asignacion se intenta cuando
          // aparezca la seccion, y no antes.
          if (!delDialogo.length) { noAplica.push(a.clave); continue; }
          for (const operador of a.operadores) {
            const casilla = delDialogo.find((input) => input.value === operador);
            if (!casilla) { noEncontradas.push({ clave: a.clave, operador }); continue; }
            if (!casilla.checked) casilla.click();
            hechas.push({ clave: a.clave, operador });
          }
        }
        return { hechas, noEncontradas, noAplica };
      }, ASIGNACIONES);
      for (const h of aplicadas.hechas) paso(`  marcada por --asignar: ${h.clave} -> ${h.operador}`);
      for (const n of aplicadas.noEncontradas) {
        paso(`  FALLO: --asignar pidio ${n.operador} para ${n.clave} y no hay casilla con ese nombre. No se usa el campo de operador nuevo.`);
      }
      informe.asignacionesAplicadas = [...(informe.asignacionesAplicadas || []), ...aplicadas.hechas];
      if (aplicadas.noEncontradas.length) {
        bloqueadoPorValidacion = {
          titulo: abierto.titulo,
          aviso: `--asignar no encontro casilla para ${aplicadas.noEncontradas.map((n) => n.clave + "=" + n.operador).join(", ")}`,
          sinElegir: aplicadas.noEncontradas.map((n) => n.clave),
        };
        break;
      }
    }

    // El precio manual en cero bloquea la app por diseño (app.js:3881). NO se inventa.
    if (abierto.precioPedido !== null && abierto.precioPedido < 1) {
      bloqueadoPorPrecio = abierto;
      paso("FALLO: la app pide un precio unitario manual y las tres fuentes estan en cero. Se detiene (no se inventa un precio).");
      break;
    }
    if (abierto.confirmDeshabilitado) {
      paso("el boton de confirmar esta deshabilitado: falta algo por llenar. Se detiene.");
      bloqueadoPorPrecio = abierto;
      break;
    }
    if (dialogos.length > MAX_DIALOGOS) {
      paso(`FALLO: mas de ${MAX_DIALOGOS} dialogos, eso no es el flujo normal. Se detiene.`);
      break;
    }
    await page.click("#planningDialogConfirm").catch(() => {});
    await page.waitForTimeout(600);

    // SI EL DIALOGO SIGUE ABIERTO, ES QUE FALTO UNA VALIDACION. Ese es el dato que falta de
    // verdad, y se copia tal cual: la app no lo deduce de la capacidad, lo pide. Insistir aqui es
    // lo que hacia esta sonda antes: 12 veces el mismo dialogo y ningun dato nuevo.
    const sigue = await page.evaluate(() => {
      const d = document.querySelector("#planningDialog");
      const aviso = String(document.querySelector("#toast")?.textContent || "").trim();
      return { abierto: Boolean(d && d.open), aviso };
    });
    if (sigue.abierto && /selecciona|seleccione|captura|requerid|falta/i.test(sigue.aviso)) {
      bloqueadoPorValidacion = {
        titulo: abierto.titulo,
        aviso: sigue.aviso,
        // Los campos sin seleccionar son la capacidad o el dato que falta.
        sinElegir: abierto.campos.filter((c) => c.type !== "hidden" && !String(c.value || "").trim()).map((c) => c.name),
      };
      paso(`FALLO DE VALIDACION: la app se niega y lo dice: "${sigue.aviso}"`);
      paso(`  dialogo: ${abierto.titulo} | campos sin elegir: ${bloqueadoPorValidacion.sinElegir.length}`);
      break;
    }
  }

  informe.generacion = {
    ms: Date.now() - tGen,
    dialogos,
    bloqueadoPorPrecio: bloqueadoPorPrecio ? { titulo: bloqueadoPorPrecio.titulo, campos: bloqueadoPorPrecio.campos } : null,
    bloqueadoPorValidacion,
  };
  paso(`generacion: ${informe.generacion.ms} ms, ${dialogos.length} dialogo(s)`);
  if (bloqueadoPorValidacion) {
    informe.fallos.push({
      punto: "dato-faltante",
      msg: `NO SE PUDO GENERAR EL PLAN: la app pide un dato que falta y lo dice: `
        + `"${bloqueadoPorValidacion.aviso}" (dialogo "${bloqueadoPorValidacion.titulo}"). `
        + `${bloqueadoPorValidacion.sinElegir.length} campo(s) sin elegir. `
        + "Es RULE-ASKCONF-001 pidiendo informacion, no un fallo del motor. Hay que resolverlo en la matriz.",
    });
  }
  if (bloqueadoPorPrecio) {
    informe.fallos.push({ punto: "generacion", msg: "la generacion se detuvo en un dialogo: " + (bloqueadoPorPrecio.titulo || "sin titulo") });
  }
}

// --------------------------------------------------------- 5. VERIFICACION
await page.waitForTimeout(4000);
informe.avisos = String((await page.locator("#planAlerts").textContent().catch(() => "")) || "").trim();
informe.colaDespues = {
  cola: await page.evaluate(() => document.querySelectorAll(".queue-item").length),
  pendientes: await page.evaluate(() => document.querySelectorAll(".queue-item.pending-schedule").length),
  filasGantt: await page.evaluate(() => document.querySelectorAll("#ganttCanvas [data-ot], #ganttCanvas tr, #ganttCanvas .gantt-row").length),
  sinHuecoEnGantt: await page.evaluate(() => document.querySelectorAll("#ganttCanvas .unscheduled, #ganttCanvas [data-unscheduled='true']").length),
};
paso(`despues: cola ${informe.colaDespues.cola}, sin programar ${informe.colaDespues.pendientes}, Gantt ${informe.colaDespues.filasGantt} filas`);

if (informe.avisos) paso("avisos en pantalla: " + informe.avisos.slice(0, 300));

if (!SOLO_SECO && !informe.generacion?.bloqueadoPorPrecio) {
  informe.rotulo = "despues";
  informe.secoDespues = await page.evaluate(async (t) => {
    const t0 = performance.now();
    try {
      const r = await window.runPlanningPerformanceDryRun({ timeoutMs: t });
      return { ms: Math.round(performance.now() - t0), ok: true, metrics: r.metrics };
    } catch (e) {
      return { ms: Math.round(performance.now() - t0), ok: false, error: String(e?.message || e).slice(0, 400) };
    }
  }, Math.min(TIMEOUT_MS, 300000));
  if (informe.secoDespues.ok) {
    const m = informe.secoDespues.metrics || {};
    paso(`en seco (despues): ${m.scheduledOperationsCount}/${m.includedOperationsCount} programadas, `
      + `${m.unscheduledOperationsCount} sin hueco, diagnosticos ${JSON.stringify(m.diagnosticsByCode || {})}`);
  } else {
    paso(`en seco (despues) FALLO: ${informe.secoDespues.error}`);
  }
}

// QUE LA ASIGNACION QUEDE ESCRITA, NO SOLO MARCADA. Marcar la casilla no es cambiar la matriz:
// eso lo hace persistPlanningConfigurationChanges (app.js:3276), que es el unico escritor. Se lee
// el estado despues y se compara con lo que se autorizo, para saber si el guardado ocurrio de
// verdad o si la app acepto el dialogo y tiro el cambio.
if (ASIGNACIONES.length) {
  const estadoFinal = await llamada("getAppState", []);
  if (estadoFinal.ok) {
    const st = estadoFinal.result?.state || estadoFinal.result;
    const matriz = st.matrix || {};
    informe.matrizVerificada = {};
    for (const a of ASIGNACIONES) {
      const guardado = Array.isArray(matriz[a.clave]) ? matriz[a.clave].map((v) => String(v)) : null;
      informe.matrizVerificada[a.clave] = { guardado, pedido: a.operadores };
      const contiene = a.operadores.every((op) => (guardado || []).includes(op));
      paso(`matriz ${a.clave}: ${JSON.stringify(guardado)} (pedido: ${JSON.stringify(a.operadores)}) `
        + `${contiene ? "ESCRITO" : "NO ESCRITO"}`);
      if (!contiene) {
        informe.fallos.push({
          punto: "matriz",
          msg: `se marco ${a.clave}=${a.operadores.join(",")} en el dialogo pero la matriz guardada `
            + `no lo contiene: ${JSON.stringify(guardado)}`,
        });
      }
    }
  } else {
    informe.fallos.push({ punto: "matriz", msg: `no se pudo leer el estado para verificar la matriz: ${estadoFinal.error}` });
  }
}

const borradorDespues = await llamada("getPlanSnapshotLight", ["draft"]);
if (borradorDespues.ok) {
  const L = borradorDespues.result?.data || borradorDespues.result?.result || borradorDespues.result;
  informe.borradorDespues = {
    ms: borradorDespues.ms, snapshotId: L?.snapshotId || null, generadoEn: L?.generatedAt || null,
    planStart: L?.planStart || null, operaciones: (L?.operations || []).length,
  };
  const antes = informe.borradorAntes || {};
  const cambio = antes.snapshotId !== informe.borradorDespues.snapshotId
    || antes.operaciones !== informe.borradorDespues.operaciones;
  paso(`borrador despues: ${informe.borradorDespues.operaciones} operaciones, `
    + `snapshot ${informe.borradorDespues.snapshotId || "?"} (${cambio ? "CAMBIO" : "sin cambio"})`);
  if (!SOLO_SECO && !cambio) {
    informe.fallos.push({ punto: "borrador", msg: "se pulso generar plan pero el borrador no cambio: mismo snapshotId y mismo numero de operaciones" });
  }
} else {
  informe.fallos.push({ punto: "borrador-despues", msg: `getPlanSnapshotLight fallo: ${borradorDespues.error}` });
}

// El log de la app es parte del resultado: ahi esta el error que el usuario no ve.
informe.log = await page.evaluate(() => window.__log);
paso(`consola: ${informe.log.errores.length} error(es), ${informe.log.rechazos.length} rechazo(s) de promesa, ${informe.log.warnings.length} aviso(s)`);
for (const e of informe.log.errores.slice(0, 12)) paso("  error: " + e.slice(0, 220));
for (const r of informe.log.rechazos.slice(0, 8)) paso("  rechazo: " + r.slice(0, 220));
paso("avisos Emerging: " + JSON.stringify((informe.log.toasts || []).slice(0, 20)));

// Juicios, con su numero. El motor, la red y la interfaz por separado.
const fallosDeJuicio = [];
const s = informe.secoAntes?.metrics;
if (s) {
  // "sin hueco" SI es un fallo: son operaciones que debian tener hora y no la tienen.
  if (Number(s.unscheduledOperationsCount || 0) > 0) {
    fallosDeJuicio.push(`el motor dejo ${s.unscheduledOperationsCount} operacion(es) sin hueco de ${s.includedOperationsCount}`);
  }
  // Lo que NO se comprueba aqui, a proposito: scheduledOperationsCount + unscheduledOperationsCount
  // contra includedOperationsCount. Parecen el mismo denominador y no lo son. El plan final se arma
  // con inactive + preservedCompletedChanges + fixed + generatedChanges + scheduled + unscheduled +
  // excluded + excludedCapabilityOperations (planner-core.js:578), y lastSchedule solo cuenta
  // scheduled y unscheduled. includedOperationsCount cuenta el plan completo. Compararlos da un
  // numero de notifiedas que no significa nada, y fue justo el falso fallo que reporto la primera
  // corrida de esta sonda. Lo que se revisa es que no queden operaciones sin hueco y que las OTs
  // queden programadas.
  if (!Number(s.scheduledOtsCount || 0)) fallosDeJuicio.push("ninguna OT quedo programada");
}
if (informe.colaDespues.pendientes > 0) {
  fallosDeJuicio.push(`${informe.colaDespues.pendientes} OT(s) de la cola quedaron sin programar`);
}
if (informe.colaDespues.sinHuecoEnGantt > 0) {
  fallosDeJuicio.push(`el Gantt marca ${informe.colaDespues.sinHuecoEnGantt} operacion(es) sin hueco`);
}
if (/datos de OTs sin sincronizar|No se pudo verificar NetSuite/i.test(informe.avisos || "")) {
  fallosDeJuicio.push("la app avisa que faltan datos de OTs: " + informe.avisos.slice(0, 160));
}
if (informe.log.errores.length) {
  fallosDeJuicio.push(`${informe.log.errores.length} error(es) en consola`);
}
if (informe.log.rechazos.length) {
  fallosDeJuicio.push(`${informe.log.rechazos.length} promesa(s) rechazada(s) sin capturar`);
}
informe.fallos.push(...fallosDeJuicio.map((msg) => ({ punto: "juicio", msg })));

informe.fallos.forEach((f) => paso("FALLO [" + f.punto + "] " + f.msg));
paso("fallos totales: " + informe.fallos.length);

await writeFile(OUT, JSON.stringify(informe, null, 2), "utf8");
console.log("\nartifact:", OUT);
await browser.close();
process.exit(informe.fallos.length ? 1 : 0);
