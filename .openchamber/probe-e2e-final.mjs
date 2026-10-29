import { chromium } from "playwright";
import fs from "node:fs";

const APP_URL = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=367245a";
const TARGET_DATE = "2026-08-28";
const SHOT_DIR = "C:/Users/plane/Downloads/plangit/.openchamber/screenshots";
fs.mkdirSync(SHOT_DIR, { recursive: true });

const log = (...a) => console.log(new Date().toISOString(), ...a);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console.error: ${m.text()}`); });
page.on("requestfailed", (r) => {
  const url = r.url();
  if (/plan-snapshots|prod.s?cript|apps\.script|googleusercontent/i.test(url)) {
    errors.push(`requestfailed: ${url} :: ${r.failure()?.errorText || ""}`);
  }
});
page.on("dialog", async (d) => {
  log("NATIVE DIALOG:", d.message());
  await d.dismiss().catch(() => null);
});

const sleep = (ms) => page.waitForTimeout(ms);

const STATS_FN = `
  const iso = (d) => (d ? String(d).slice(0, 10) : "");
  const weekOf = (d) => {
    if (!d) return null;
    const [y, m, dd] = String(d).slice(0, 10).split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, dd));
    const day = (dt.getUTCDay() + 6) % 7;
    const mon = new Date(dt);
    mon.setUTCDate(dt.getUTCDate() - day);
    return mon.toISOString().slice(0, 10);
  };
  const stats = (ops, startDate) => {
    const WINDOW_END = "2026-09-30";
    const withDates = ops.filter((o) => o.fechaInicio);
    const sorted = withDates.map((o) => iso(o.fechaInicio)).sort();
    const byWeek = {};
    const onDay = {};
    let beforeStart = 0, onStart = 0;
    for (const o of withDates) {
      const d = iso(o.fechaInicio);
      const w = weekOf(d);
      byWeek[w] = (byWeek[w] || 0) + 1;
      onDay[d] = (onDay[d] || 0) + 1;
      if (startDate && d < startDate) beforeStart++;
      if (startDate && d === startDate) onStart++;
    }
    const uniqueDays = sorted.filter((v, i, a) => i === 0 || v !== a[i - 1]);
    let maxGap = { days: 0, from: null, to: null };
    const bigGaps = [];
    let prev = null;
    for (const d of uniqueDays) {
      if (startDate && (d < startDate || d > "2026-09-30")) continue;
      if (prev) {
        const [y1, m1, dd1] = prev.split("-").map(Number);
        const [y2, m2, dd2] = d.split("-").map(Number);
        const diff = Math.round((Date.UTC(y2, m2 - 1, dd2) - Date.UTC(y1, m1 - 1, dd1)) / 86400000);
        if (diff > maxGap.days) maxGap = { days: diff, from: prev, to: d };
        if (diff > 3) bigGaps.push({ from: prev, to: d, days: diff, between: Math.max(0, diff - 1) });
      }
      prev = d;
    }
    const weeks = {};
    for (const w of ["2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07"]) weeks[w] = byWeek[w] || 0;
    return {
      opsCount: ops.length, withFechaInicio: withDates.length,
      minFechaInicio: sorted[0] || null, maxFechaInicio: sorted[sorted.length - 1] || null,
      byWeek, weeks, onDay, beforeStart, onStart, uniqueDaysInWindow: uniqueDays.length,
      maxGapInWindow: maxGap, bigGaps,
    };
  };
`;

const report = { appUrl: APP_URL, targetDate: TARGET_DATE };

try {
  // ---------- 1) LOAD PLANNING, record BEFORE ----------
  log("Loading planning view...");
  await page.goto(`${APP_URL}#planning`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForFunction(() => {
    return typeof state !== "undefined" && state.planStart && state.operations && state.operations.length > 0;
  }, null, { timeout: 240000, polling: 3000 }).catch(() => null);
  await sleep(5000);

  {
    const fn = `(() => { ${STATS_FN}
      const ops = (typeof state !== "undefined" && state.operations) ? state.operations : [];
      return {
        planStart: state?.planStart,
        planEnd: state?.planEnd || "",
        horizonDays: state?.horizonDays,
        selectedOts: (state?.selectedOts || []).length,
        lockedOts: (state?.lockedOts || []).length,
        opsCount: ops.length,
        stats: stats(ops, "2026-08-28"),
        scheduledOtsSize: state?.lastSchedule?.scheduledOts?.length ?? "n/a",
        planStartInputValue: document.querySelector("#planStartInput")?.value || "",
      };
    })()`;
    report.before = await page.evaluate(fn);
  }
  log("BEFORE:", JSON.stringify(report.before));
  await page.screenshot({ path: `${SHOT_DIR}/gen-plan-before.png` });

  // ---------- 2) FIND + SET "Inicio" (plan start) to 2026-08-28 ----------
  const inicio = await page.evaluate((target) => {
    const d = (el) => ({ id: el.id, type: el.type, value: el.value, placeholder: el.placeholder || "", label: el.closest("label")?.textContent.trim().slice(0, 50) || "", name: el.getAttribute("name") || "" });
    const dateInputs = [...document.querySelectorAll("input")].filter((i) => i.type === "date").map(d);
    const ps = state?.planStart;
    const chosen = dateInputs.find((i) => /^planstart|planstart$/i.test(i.id) || /^inicio$/i.test(i.label.trim()))
      || dateInputs.find((i) => /planstart|inicio/i.test(`${i.id} ${i.label} ${i.name}`))
      || dateInputs.find((i) => i.id && i.value === ps)
      || dateInputs[0] || null;
    return { planStart: ps, dateInputs: dateInputs.slice(0, 6), chosenId: chosen?.id || null, chosenLabel: chosen?.label || "" };
  }, TARGET_DATE);
  report.inicioDiscovery = inicio;
  log("Inicio discovery:", JSON.stringify(inicio));
  if (!inicio.chosenId) throw new Error("No se encontro el campo de fecha 'Inicio' (ningun date input)");

  await page.fill(`#${inicio.chosenId}`, TARGET_DATE);
  await page.dispatchEvent(`#${inicio.chosenId}`, "change");
  const applied = await page.waitForFunction((t) => state?.planStart === t, TARGET_DATE, { timeout: 20000, polling: 400 }).then(() => true).catch(() => false);
  await sleep(1200);
  report.inicio = await page.evaluate(({ t, id }) => ({
    statePlanStart: state?.planStart,
    inputValue: document.querySelector(`#${id}`)?.value,
  }), { t: TARGET_DATE, id: inicio.chosenId });
  report.inicio.applied = applied;
  log("INICIO:", JSON.stringify(report.inicio));
  if (!applied || report.inicio.statePlanStart !== TARGET_DATE) throw new Error("state.planStart no cambio a " + TARGET_DATE);

  // ---------- 3) FIND + CLICK "Generar plan", wait until it finishes ----------
  log("Waiting for planning idle (button enabled, no sync in flight)...");
  const idle = await page.waitForFunction(() => {
    const btn = document.querySelector("#generatePlanBtn");
    const busy = typeof planningActionsBusy === "string" ? planningActionsBusy : "";
    return btn && !btn.disabled && !btn.classList.contains("is-running") && busy === ""
      && /^Generar plan$/i.test(btn.querySelector("[data-schedule-label]")?.textContent?.trim() || "");
  }, null, { timeout: 900000, polling: 4000 }).then(() => true).catch(() => false);
  report.preGenerateIdle = idle ? "idle" : "never-idle";
  if (!idle) {
    report.preGenerateState = await page.evaluate(() => ({
      btnDisabled: document.querySelector("#generatePlanBtn")?.disabled,
      label: document.querySelector("#generatePlanBtn [data-schedule-label]")?.textContent || "",
      planningActionsBusy: typeof planningActionsBusy === "string" ? planningActionsBusy : "n/a",
      netSuiteSyncInFlight: typeof netSuiteSyncInFlight === "boolean" ? netSuiteSyncInFlight : "n/a",
      netSuitePlanningSyncInFlight: typeof netSuitePlanningSyncInFlight === "boolean" ? netSuitePlanningSyncInFlight : "n/a",
      toast: document.querySelector("#toast")?.textContent || "",
    }));
    throw new Error("El boton Generar plan nunca quedo habilitado (sync en curso muy larga o error)");
  }
  await sleep(3000);

  const genBtn = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const byLabel = btns.find((b) => /^Generar plan$/i.test((b.textContent || "").trim()) || (b.textContent || "").trim().toLowerCase() === "generar plan");
    const byId = btns.find((b) => b.id === "generatePlanBtn");
    const chosen = byLabel || byId;
    if (!chosen) return null;
    return { id: chosen.id, text: chosen.textContent.trim().slice(0, 60), disabled: chosen.disabled, isRunning: chosen.classList.contains("is-running") };
  });
  report.generateBtn = genBtn;
  log("Generar plan button:", JSON.stringify(genBtn));
  if (!genBtn) throw new Error("No se encontro boton 'Generar plan'");

  log("Clicking Generar plan...");
  await page.locator(`#${genBtn.id}`).click({ timeout: 10000, force: true }).catch(() => page.evaluate((id) => document.getElementById(id).click(), genBtn.id));
  const started = await page.waitForFunction(() => {
    const l = document.querySelector("#generatePlanBtn [data-schedule-label]")?.textContent || "";
    return l.startsWith("Optimizando") || (typeof planningActionsBusy === "string" && planningActionsBusy === "schedule");
  }, null, { timeout: 120000, polling: 1000 }).then(() => true).catch(() => false);
  report.generateStart = {
    started,
    label: await page.evaluate(() => document.querySelector("#generatePlanBtn [data-schedule-label]")?.textContent || ""),
    toast: await page.evaluate(() => document.querySelector("#toast")?.textContent || ""),
  };
  log("Generate started? ", JSON.stringify(report.generateStart));
  if (!started) throw new Error("Generar plan no arranco. Toast: " + report.generateStart.toast);

  log("Waiting for scheduler to finish (OT syncs + engine up to 10 min budget)...");
  const GEN_DEADLINE = Date.now() + 2700000;
  let genDone = false;
  let lastLabel = "";
  while (Date.now() < GEN_DEADLINE) {
    const st = await page.evaluate(() => {
      const btn = document.querySelector("#generatePlanBtn");
      const label = btn?.querySelector("[data-schedule-label]")?.textContent || "";
      const busy = typeof planningActionsBusy === "string" ? planningActionsBusy : "";
      const toast = document.querySelector("#toast")?.textContent || "";
      return {
        done: !btn.disabled && !btn.classList.contains("is-running") && busy === "" && /^Generar plan$/i.test(label.trim()),
        disabled: btn?.disabled, isRunning: btn?.classList.contains("is-running"), busy, label, toast, t: new Date().toISOString(),
      };
    });
    if (st.done) { genDone = true; log("Generate completion state:", JSON.stringify(st)); break; }
    if (st.label !== lastLabel) {
      lastLabel = st.label;
      log("progress:", JSON.stringify(st));
    }
    await sleep(15000);
  }
  if (!genDone) {
    const st = await page.evaluate(() => {
      const btn = document.querySelector("#generatePlanBtn");
      return { label: btn?.querySelector("[data-schedule-label]")?.textContent || "", busy: typeof planningActionsBusy === "string" ? planningActionsBusy : "", toast: document.querySelector("#toast")?.textContent || "" };
    });
    log("Generate timeout state:", JSON.stringify(st));
    throw new Error("Generar plan no termino en el tiempo esperado");
  }
  await sleep(3000);

  log("Waiting for draft snapshot persistence...");
  const draftPersisted = await page.waitForFunction(() => Boolean(state?.draftVersionId), null, { timeout: 150000, polling: 3000 }).then(() => true).catch(() => false);
  report.draftPersisted = draftPersisted;

  // ---------- 4) AFTER-generate state ----------
  {
    const fn = `(() => { ${STATS_FN}
      const T = "2026-08-28";
      const ops = (typeof state !== "undefined" && state.operations) ? state.operations : [];
      let draft = [];
      try { draft = (typeof currentDraftScheduledOperations === "function") ? currentDraftScheduledOperations() : []; } catch (_) {}
      return {
        planStart: state?.planStart,
        planStartInputValue: document.querySelector("#planStartInput")?.value || "",
        planEnd: state?.planEnd || "",
        draftVersionId: state?.draftVersionId || "",
        lastSchedule: state?.lastSchedule ? {
          scheduled: state.lastSchedule.scheduled, unscheduled: state.lastSchedule.unscheduled,
          strategy: state.lastSchedule.optimization?.selectedStrategy, scheduledOts: state.lastSchedule.scheduledOts?.length,
        } : null,
        stateOps: stats(ops, T),
        draftOps: stats(draft, T),
        toast: document.querySelector("#toast")?.textContent || "",
      };
    })()`;
    report.afterGenerate = await page.evaluate(fn);
  }
  log("AFTER-GENERATE:", JSON.stringify(report.afterGenerate));
  await page.screenshot({ path: `${SHOT_DIR}/gen-plan-after-board.png` });

  // ---------- 5) PUBLISH (single). Generate already persisted the draft. ----------
  const pubBtn = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const byLabel = btns.find((b) => /^Publicar\b/i.test((b.textContent || "").trim()) || (b.textContent || "").trim() === "Publicar plan");
    const byId = btns.find((b) => b.id === "publishPlanBtn");
    const chosen = byLabel || byId;
    if (!chosen) return null;
    return { id: chosen.id, text: chosen.textContent.trim().slice(0, 60), disabled: chosen.disabled };
  });
  report.publishBtn = pubBtn;
  log("Publicar button:", JSON.stringify(pubBtn));
  if (!pubBtn) throw new Error("No se encontro boton 'Publicar'");

  const prePub = await page.evaluate(() => ({
    versions: (state?.publishedVersions || []).map((v) => ({ week: v.weekStart, version: v.version, id: v.snapshotId, status: v.status })),
    active: state?.activePublishedVersionId || "",
  }));
  report.publish = { pre: prePub };
  log("Pre-publish versions:", JSON.stringify(prePub));

  log("Clicking Publicar...");
  await page.locator(`#${pubBtn.id}`).click({ timeout: 10000, force: true }).catch(() => page.evaluate((id) => document.getElementById(id).click(), pubBtn.id));
  const dialogOpened = await page.waitForFunction(() => document.querySelector("#planningDialog")?.open === true, null, { timeout: 25000, polling: 400 }).then(() => true).catch(() => false);
  report.publish.dialogOpened = dialogOpened;
  if (dialogOpened) {
    report.publish.dialog = await page.evaluate(() => ({
      title: document.querySelector("#planningDialogTitle")?.textContent,
      summary: document.querySelector("#planningDialogSummary")?.textContent,
      bodySnippet: document.querySelector("#planningDialogBody")?.textContent.trim().slice(0, 120),
      confirmLabel: document.querySelector("#planningDialogConfirm")?.textContent,
    }));
    log("Publish dialog:", JSON.stringify(report.publish.dialog));
    await page.fill("#planningDialog textarea[name=publication_reason]", "E2E real: validar fechas con Inicio 2026-08-28");
    await page.click("#planningDialogConfirm");
    await sleep(1000);
  }

  log("Waiting for publish to finish...");
  const pubDone = await page.waitForFunction(() => {
    const btn = document.querySelector("#publishPlanBtn");
    const toast = document.querySelector("#toast")?.textContent || "";
    const active = (typeof state !== "undefined") ? state.activePublishedVersionId || "" : "";
    return btn && !btn.disabled && (toast.includes("Plan publicado") || (active && active !== "draft"));
  }, null, { timeout: 1200000, polling: 5000 }).then(() => true).catch(() => false);
  if (!pubDone) {
    report.publish.toast = await page.evaluate(() => document.querySelector("#toast")?.textContent || "");
    throw new Error("Publicacion no completo. Toast: " + report.publish.toast);
  }
  await sleep(4000);
  report.publish.toast = await page.evaluate(() => document.querySelector("#toast")?.textContent || "");
  report.publish.active = await page.evaluate(() => state?.activePublishedVersionId || "");
  log("Publish complete:", JSON.stringify(report.publish));

  // ---------- 6) Go to #reportes, refresh snapshots, load new snapshot ----------
  log("Switching to #reportes...");
  await page.evaluate(() => { window.location.hash = "reportes"; });
  await sleep(2500);
  await page.locator("#refreshSnapshotsBtn").click({ timeout: 10000 }).catch(() => page.evaluate(() => document.getElementById("refreshSnapshotsBtn")?.click()));
  const snapsReady = await page.waitForFunction(() => {
    const s = document.querySelector("#planSnapshotSelect");
    return s && s.options.length > 1 && typeof planSnapshots !== "undefined" && planSnapshots.length > 0;
  }, null, { timeout: 300000, polling: 3000 }).then(() => true).catch(() => false);
  if (!snapsReady) throw new Error("No cargaron snapshots en reportes");
  await sleep(3000);

  const selState = await page.evaluate(() => ({
    activePublishedVersionId: state?.activePublishedVersionId || "",
    reportSnapshotId: reportSnapshot?.snapshotId || "",
    selectValue: document.querySelector("#planSnapshotSelect")?.value || "",
  }));
  report.snapSelectState = selState;
  log("Snapshot select:", JSON.stringify(selState));

  const newSnapshotId = selState.activePublishedVersionId || selState.reportSnapshotId;
  if (newSnapshotId && newSnapshotId !== "draft" && selState.selectValue !== newSnapshotId) {
    await page.selectOption("#planSnapshotSelect", newSnapshotId).catch((e) => log("selectOption err:", String(e)));
    const loaded = await page.waitForFunction((id) => reportSnapshot?.snapshotId === id, newSnapshotId, { timeout: 90000, polling: 2000 }).then(() => true).catch(() => false);
    log("New snapshot loaded in reportes?", loaded);
    await sleep(2500);
  }

  {
    const fn = `(() => { ${STATS_FN}
      const T = "2026-08-28";
      const snaps = (typeof planSnapshots !== "undefined" ? planSnapshots : []);
      const rId = reportSnapshot?.snapshotId || state?.activePublishedVersionId || "";
      const matched = snaps.find((s) => s.snapshotId === rId) || snaps.find((s) => s.snapshotId === state?.activePublishedVersionId) || null;
      const rOps = (reportSnapshot?.operations) ? reportSnapshot.operations : [];
      const firstOps = rOps.slice().sort((a, b) => String(a.fechaInicio).localeCompare(String(b.fechaInicio) || "")).slice(0, 6).map((op) => ({
        ot: op.ot, sec: op.secuencia, fi: iso(op.fechaInicio), hi: op.horaInicio, ff: iso(op.fechaFin), hf: op.horaFin, ct: op.ct, desc: (op.descripcion || "").slice(0, 40),
      }));
      const core = (s) => ({
        snapshotId: s?.snapshotId, weekStart: s?.weekStart, planStart: s?.planStart,
        operations: Number(s?.operations ?? s?.operationCount ?? 0),
        generatedAt: s?.generatedAt, publishedAt: s?.publishedAt || s?.published_at || "", version: s?.version, status: s?.status || s?.planStatus,
      });
      const loadedStats = stats(rOps, T);
      return {
        newSnapshot: core(matched),
        snapshotList: snaps.map(core).slice(-8),
        loadedSnapshot: {
          snapshotId: reportSnapshot?.snapshotId,
          planStart: reportSnapshot?.planStart,
          weekStart: reportSnapshot?.weekStart,
          version: reportSnapshot?.version,
          generatedAt: reportSnapshot?.generatedAt,
          stats: loadedStats,
          firstOps,
          perOtKeys: Object.keys(rOps.reduce((a, o) => (a[o.ot] = 1, a), {})).length,
        },
        checks: {
          planStartIsTarget: reportSnapshot?.planStart === T,
          weekStartIs_Mon24: (reportSnapshot?.weekStart || "").slice(0, 10) === "2026-08-24",
          opsPositive: rOps.length > 0,
          minFechaInicioGteTarget: loadedStats.minFechaInicio >= T,
        },
      };
    })()`;
    report.published = await page.evaluate(fn);
  }
  log("PUBLISHED:", JSON.stringify(report.published));
  await page.screenshot({ path: `${SHOT_DIR}/published-snapshot-loaded.png` });

  // ---------- 7) REPORT populates for week 2026-08-24 ----------
  report.report = await page.evaluate(() => {
    const week = document.querySelector("#weekReport")?.innerText || "";
    const summary = document.querySelector("#weekExecutiveSummary")?.innerText || "";
    const opText = document.querySelector("#operatorReport")?.innerText || "";
    const opRows = document.querySelector("#operatorReport tbody")?.children.length || 0;
    return {
      reportWeekStartInput: document.querySelector("#weekReportStartInput")?.value || "",
      selectValue: document.querySelector("#planSnapshotSelect")?.value || "",
      reportSnapshotMeta: document.querySelector("#reportSnapshotMeta")?.textContent || "",
      hasSinOtsThisWeek: week.includes("Sin OTs para esta semana"),
      hasNoPublishedWarning: week.includes("No hay un plan publicado cargado"),
      summaryMoneyZeroCount: (summary.match(/\$0\.00/g) || []).length,
      summarySample: summary.slice(0, 220),
      weekSample: week.slice(0, 220),
      operatorRows: opRows,
      operatorSample: opText.slice(0, 220),
    };
  });
  log("REPORT:", JSON.stringify(report.report));
  await page.screenshot({ path: `${SHOT_DIR}/report-week.png` });

  report.errors = errors.slice(0, 25);
  const shotPaths = ["gen-plan-before.png", "gen-plan-after-board.png", "published-snapshot-loaded.png", "report-week.png"]
    .map((f) => `${SHOT_DIR.replaceAll("/", "\\")}\\${f}`);
  report.screenshots = shotPaths;
  console.log("\n=====E2E_RESULT=====");
  console.log(JSON.stringify(report, null, 1));
} catch (err) {
  report.error = String(err?.stack || err);
  report.errors = errors.slice(0, 25);
  console.log("\n=====E2E_FAILED=====");
  console.log(JSON.stringify(report, null, 1));
  console.log("ERR:", String(err?.stack || err));
} finally {
  await browser.close();
}