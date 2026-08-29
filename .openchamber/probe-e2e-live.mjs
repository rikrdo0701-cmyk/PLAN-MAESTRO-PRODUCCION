import { chromium } from "playwright";
import fs from "node:fs";

const SHOT_DIR = "C:/Users/plane/Downloads/plangit/.openchamber/screenshots";
const START_DATE = "2026-08-28";
fs.mkdirSync(SHOT_DIR, { recursive: true });

const log = (...args) => console.log(new Date().toISOString(), ...args);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console.error: ${m.text()}`); });
page.on("dialog", async (d) => { log("NATIVE DIALOG:", d.message()); await d.dismiss().catch(() => null); });

const report = { startDate: START_DATE, steps: {} };

try {
  log("Loading planning view...");
  await page.goto("https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=367245a#planning", { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForFunction(() => typeof state !== "undefined" && state.planStart && state.operations && state.operations.length > 0, null, { timeout: 240000, polling: 3000 });
  await page.waitForTimeout(4000);

  log("Capturing BEFORE state");
  report.steps.before = await page.evaluate(() => {
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
    const stats = (ops) => {
      const withDates = ops.filter((o) => o.fechaInicio);
      const sorted = withDates.map((o) => iso(o.fechaInicio)).sort();
      const byWeek = {};
      for (const o of withDates) { const w = weekOf(o.fechaInicio); byWeek[w] = (byWeek[w] || 0) + 1; }
      return { opsCount: ops.length, withFechaInicio: withDates.length, minFechaInicio: sorted[0] || null, maxFechaInicio: sorted[sorted.length - 1] || null, byWeek };
    };
    const ops = (typeof state !== "undefined" && state.operations) ? state.operations : [];
    return {
      planStart: state?.planStart,
      planEnd: state?.planEnd || "",
      horizonDays: state?.horizonDays,
      selectedOtsCount: state?.selectedOts?.length || 0,
      lockedOtsCount: state?.lockedOts?.length || 0,
      stats: stats(ops),
      scheduledByState: (typeof currentDraftScheduledOperations === "function" ? currentDraftScheduledOperations().length : "n/a"),
      publishedVersions: (state?.publishedVersions || []).map((v) => ({
        snapshotId: v.snapshotId, weekStart: v.weekStart, planStart: v.planStart,
        version: v.version, status: v.status, ops: v.operations,
        generatedAt: v.generatedAt || v.publishedAt || "",
      })),
      activePublishedVersionId: state?.activePublishedVersionId || "",
      planSnapshotsGlobalCount: (typeof planSnapshots !== "undefined" ? planSnapshots.length : "n/a"),
      planStartInputValue: document.querySelector("#planStartInput")?.value || "",
    };
  });
  await page.screenshot({ path: `${SHOT_DIR}/gen-plan-before.png` });
  log("BEFORE:", JSON.stringify(report.steps.before));

  log("Setting Inicio to", START_DATE);
  await page.fill("#planStartInput", START_DATE);
  await page.dispatchEvent("#planStartInput", "change");
  const startApplied = await page.waitForFunction((d) => state?.planStart === d, START_DATE, { timeout: 20000, polling: 500 }).then(() => true).catch(() => false);
  await page.waitForTimeout(1500);
  report.steps.inicio = await page.evaluate(() => ({
    statePlanStart: state?.planStart,
    inputValue: document.querySelector("#planStartInput")?.value,
  }));
  report.steps.inicio.applied = startApplied;
  log("INICIO:", JSON.stringify(report.steps.inicio));
  if (!startApplied) throw new Error("state.planStart did not become " + START_DATE);

  log("Clicking Generar plan...");
  await page.locator("#generatePlanBtn").click({ timeout: 10000 }).catch(() => page.evaluate(() => document.getElementById("generatePlanBtn").click()));
  const started = await page.waitForFunction(() => {
    const l = document.querySelector("#generatePlanBtn [data-schedule-label]")?.textContent || "";
    return l.startsWith("Optimizando") || (typeof planningActionsBusy === "string" && planningActionsBusy === "schedule");
  }, null, { timeout: 90000, polling: 1000 }).then(() => true).catch(() => false);
  report.steps.generate = { started };
  log("Generate started?", started);
  if (!started) {
    report.steps.generate.toast = await page.evaluate(() => document.querySelector("#toast")?.textContent || "");
    throw new Error("Generar plan did not start (early return). Toast: " + report.steps.generate.toast);
  }
  log("Waiting for scheduler to finish (may take minutes)...");
  const done = await page.waitForFunction(() => {
    const btn = document.querySelector("#generatePlanBtn");
    return btn && !btn.disabled && !btn.classList.contains("is-running");
  }, null, { timeout: 3000000, polling: 5000 }).then(() => true).catch(() => false);
  if (!done) throw new Error("Generate timed out after polling");
  await page.waitForTimeout(5000);

  log("Capturing AFTER-generate state");
  report.steps.afterGenerate = await page.evaluate(() => {
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
    const stats = (ops) => {
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
        if (d < "2026-08-28") beforeStart++;
        if (d === "2026-08-28") onStart++;
      }
      const inWeek24_30 = withDates.filter((o) => iso(o.fechaInicio) >= "2026-08-24" && iso(o.fechaInicio) <= "2026-08-30").length;
      const uniqueDays = sorted.filter((v, i, a) => i === 0 || v !== a[i - 1]);
      let maxGap = { days: 0, from: null, to: null };
      const bigGaps = [];
      let prev = null;
      for (const d of uniqueDays) {
        if (d < "2026-08-28" || d > "2026-09-30") continue;
        if (prev) {
          const [y1, m1, dd1] = prev.split("-").map(Number);
          const [y2, m2, dd2] = d.split("-").map(Number);
          const diff = Math.round((Date.UTC(y2, m2 - 1, dd2) - Date.UTC(y1, m1 - 1, dd1)) / 86400000);
          if (diff > maxGap.days) maxGap = { days: diff, from: prev, to: d };
          if (diff >= 3) bigGaps.push({ from: prev, to: d, days: diff });
        }
        prev = d;
      }
      return {
        opsCount: ops.length, withFechaInicio: withDates.length,
        minFechaInicio: sorted[0] || null, maxFechaInicio: sorted[sorted.length - 1] || null,
        byWeek, onDay, beforeStart, onStart, inWeek2026_08_24_30: inWeek24_30,
        maxGapInWindow: maxGap, bigGaps,
      };
    };
    const classify = (ops) => {
      const before = ops.filter((o) => o.fechaInicio && iso(o.fechaInicio) < "2026-08-28");
      return {
        count: before.length,
        byReason: {
          lockedOt: before.filter((o) => o.locked === true || o.otLocked).length,
          planCompleted: before.filter((o) => String(o.planStatus || "").toUpperCase() === "COMPLETADA_PLAN").length,
          autoFrozen: before.filter((o) => o.autoFrozen === true).length,
          historical: before.filter((o) => /PUBLICAD|GUARDAD|HISTORIC/i.test(String(o.planStatus || ""))).length,
          notProgrammedByEngine: before.filter((o) => !String(o.log || "").includes("PROGRAMADO_PLANNER_CORE")).length,
        },
        sample: before.slice(0, 12).map((o) => ({
          ot: o.ot, sec: o.secuencia, fi: iso(o.fechaInicio), estatus: o.estatus,
          planStatus: o.planStatus, locked: o.locked, autoFrozen: o.autoFrozen,
          log: String(o.log || "").split("\n").filter(Boolean).slice(-2).join(" | ").slice(0, 90),
        })),
      };
    };
    const ops = (typeof state !== "undefined" && state.operations) ? state.operations : [];
    const draft = (typeof currentDraftScheduledOperations === "function" ? currentDraftScheduledOperations() : []);
    return {
      planStart: state?.planStart,
      planStartInputValue: document.querySelector("#planStartInput")?.value,
      planEnd: state?.planEnd || "",
      draftSnapshotId: state?.draftVersionId,
      lastSchedule: state?.lastSchedule ? {
        scheduled: state.lastSchedule.scheduled,
        unscheduled: state.lastSchedule.unscheduled,
        strategy: state.lastSchedule.optimization?.selectedStrategy,
        scheduledOts: state.lastSchedule.scheduledOts?.length,
      } : null,
      stateOps: stats(ops),
      stateOpsClassify: classify(ops),
      draftScheduled: stats(draft),
      draftScheduledClassify: classify(draft),
      toast: document.querySelector("#toast")?.textContent || "",
    };
  });
  log("AFTER-GENERATE:", JSON.stringify(report.steps.afterGenerate));
  await page.screenshot({ path: `${SHOT_DIR}/gen-plan-after-board.png` });

  log("Checking published versions before publish...");
  const prePub = await page.evaluate(() => ({
    versions: (state?.publishedVersions || []).map((v) => ({ week: v.weekStart, version: v.version, id: v.snapshotId, status: v.status })),
    active: state?.activePublishedVersionId,
  }));
  report.steps.publish = { pre: prePub };
  log("Pre-publish versions:", JSON.stringify(prePub));

  log("Clicking Publicar plan...");
  await page.locator("#publishPlanBtn").click({ timeout: 10000 }).catch(() => page.evaluate(() => document.getElementById("publishPlanBtn").click()));

  const dialogOpened = await page.waitForFunction(() => document.querySelector("#planningDialog")?.open === true, null, { timeout: 15000, polling: 500 }).then(() => true).catch(() => false);
  report.steps.publish.dialogOpened = dialogOpened;
  if (dialogOpened) {
    const dlg = await page.evaluate(() => ({
      title: document.querySelector("#planningDialogTitle")?.textContent,
      summary: document.querySelector("#planningDialogSummary")?.textContent,
      confirmLabel: document.querySelector("#planningDialogConfirm")?.textContent,
    }));
    report.steps.publish.dialog = dlg;
    log("Publish dialog:", JSON.stringify(dlg));
    await page.fill("#planningDialog textarea[name=publication_reason]", "E2E validacion de fechas con INICIO 2026-08-28 (prueba real solicitada)");
    await page.click("#planningDialogConfirm");
  }

  const pubDone = await page.waitForFunction(() => {
    const btn = document.querySelector("#publishPlanBtn");
    const toast = document.querySelector("#toast")?.textContent || "";
    const snap = typeof reportSnapshot !== "undefined" ? reportSnapshot : null;
    return btn && !btn.disabled && (toast.includes("Plan publicado") || (snap && snap.snapshotId && snap.snapshotId !== "draft"));
  }, null, { timeout: 900000, polling: 5000 }).then(() => true).catch(() => false);
  if (!pubDone) throw new Error("Publish did not complete in time");
  await page.waitForTimeout(4000);
  report.steps.publish.toast = await page.evaluate(() => document.querySelector("#toast")?.textContent || "");
  log("Publish complete:", JSON.stringify(report.steps.publish));

  log("Switching to #reportes...");
  await page.evaluate(() => { window.location.hash = "reportes"; });
  await page.waitForTimeout(2500);
  log("Refreshing snapshots...");
  await page.locator("#refreshSnapshotsBtn").click({ timeout: 10000 }).catch(() => page.evaluate(() => document.getElementById("refreshSnapshotsBtn")?.click()));
  const snapLoaded = await page.waitForFunction(() => {
    const s = document.querySelector("#planSnapshotSelect");
    return s && s.options.length > 1;
  }, null, { timeout: 300000, polling: 3000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(4000);

  const activeId = await page.evaluate(() => ({
    activePublishedVersionId: state?.activePublishedVersionId || "",
    reportSnapshotId: reportSnapshot?.snapshotId || "",
    selectValue: document.querySelector("#planSnapshotSelect")?.value || "",
  }));
  log("Snapshot select state:", JSON.stringify(activeId));
  if (activeId.reportSnapshotId && activeId.reportSnapshotId !== "draft" && activeId.selectValue !== activeId.reportSnapshotId) {
    await page.selectOption("#planSnapshotSelect", activeId.reportSnapshotId);
    await page.waitForTimeout(3500);
  }

  report.steps.published = await page.evaluate(() => {
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
    const stats = (ops) => {
      const withDates = ops.filter((o) => o.fechaInicio);
      const sorted = withDates.map((o) => iso(o.fechaInicio)).sort();
      const byWeek = {};
      let beforeStart = 0;
      for (const o of withDates) {
        const w = weekOf(o.fechaInicio);
        byWeek[w] = (byWeek[w] || 0) + 1;
        if (iso(o.fechaInicio) < "2026-08-28") beforeStart++;
      }
      return { opsCount: ops.length, withFechaInicio: withDates.length, minFechaInicio: sorted[0] || null, maxFechaInicio: sorted[sorted.length - 1] || null, byWeek, beforeStart };
    };
    const snap = (typeof planSnapshots !== "undefined" ? planSnapshots : []);
    const activeId = typeof state !== "undefined" ? state.activePublishedVersionId : "";
    const matched = snap.find((s) => s.snapshotId === activeId) || snap.filter((s) => /PUBLICAD/i.test(String(s.status || s.planStatus || ""))).sort((a, b) => String(b.publishedAt || b.generatedAt || "").localeCompare(String(a.publishedAt || a.generatedAt || "")))[0] || null;
    const rOps = (typeof reportSnapshot !== "undefined" && reportSnapshot.operations) ? reportSnapshot.operations : [];
    const perOt = {};
    for (const op of rOps) perOt[op.ot] = (perOt[op.ot] || 0) + 1;
    const firstOps = rOps.slice().sort((a, b) => String(a.fechaInicio).localeCompare(String(b.fechaInicio) || "")).slice(0, 6).map((op) => ({
      ot: op.ot, sec: op.secuencia, fi: iso(op.fechaInicio), hi: op.horaInicio, ff: iso(op.fechaFin), hf: op.horaFin,
      ct: op.ct, estatus: op.estatus, desc: (op.descripcion || "").slice(0, 40),
    }));
    const core = (s) => ({
      snapshotId: s?.snapshotId, weekStart: s?.weekStart, planStart: s?.planStart,
      operations: Number(s?.operations ?? s?.operationCount ?? 0),
      generatedAt: s?.generatedAt, publishedAt: s?.publishedAt, version: s?.version,
      status: s?.status || s?.planStatus,
    });
    return {
      matchedSnapshot: core(matched),
      snapshotList: snap.map(core).slice(-6),
      reportSnapshot: {
        snapshotId: reportSnapshot?.snapshotId,
        planStart: reportSnapshot?.planStart,
        weekStart: reportSnapshot?.weekStart,
        version: reportSnapshot?.version,
        generatedAt: reportSnapshot?.generatedAt,
        stats: stats(rOps),
        firstOps,
        perOtTop: Object.entries(perOt).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([ot, n]) => ({ ot, n })),
        perOtKeys: Object.keys(perOt).length,
      },
    };
  });
  log("PUBLISHED:", JSON.stringify(report.steps.published));
  await page.screenshot({ path: `${SHOT_DIR}/published-snapshot-loaded.png` });

  report.steps.report = await page.evaluate(() => {
    const week = document.querySelector("#weekReport")?.innerText || "";
    const summary = document.querySelector("#weekExecutiveSummary")?.innerText || "";
    const startPanel = document.querySelector("#weekReport section.weekly-job-panel:nth-of-type(2)")?.innerText || "";
    const finishPanel = document.querySelector("#weekReport section.weekly-job-panel.finish")?.innerText || "";
    const loadsPanel = document.querySelector("#weekReport section.weekly-job-panel.loads")?.innerText || "";
    const opRows = document.querySelector("#operatorReport tbody")?.children.length || 0;
    const opText = document.querySelector("#operatorReport")?.innerText || "";
    return {
      reportWeekStart: document.querySelector("#weekReportStartInput")?.value || "",
      reportMeta: document.querySelector("#reportSnapshotMeta")?.textContent || "",
      snapshotSelect: document.querySelector("#planSnapshotSelect")?.value || "",
      summaryEmpty: /No hay un plan publicado cargado/.test(summary),
      summaryMoney: (summary.match(/\$0\.00/g) || []).length,
      summaryText: summary.slice(0, 900),
      weekEmptyStates: {
        noOts: week.includes("Sin OTs para esta semana"),
        noPublicado: week.includes("No hay un plan publicado cargado"),
        noCargas: week.includes("No hay cargas programadas en la semana"),
      },
      startPanel: startPanel.slice(0, 900),
      finishPanel: finishPanel.slice(0, 900),
      loadsPanel: loadsPanel.slice(0, 700),
      operatorRows: opRows,
      operatorHeading: opText.slice(0, 250),
      operatorReportStart: document.querySelector("#operatorReportStartInput")?.value || "",
    };
  });
  log("REPORT:", JSON.stringify(report.steps.report));
  await page.screenshot({ path: `${SHOT_DIR}/report-week.png` });

  report.errors = errors;
  console.log("\n=====E2E_RESULT=====");
  console.log(JSON.stringify(report, null, 1));
} catch (err) {
  report.error = String(err?.stack || err);
  report.errors = errors;
  console.log("\n=====E2E_FAILED=====");
  console.log(JSON.stringify(report, null, 1));
  console.log("ERR:", String(err?.stack || err));
} finally {
  await browser.close();
}