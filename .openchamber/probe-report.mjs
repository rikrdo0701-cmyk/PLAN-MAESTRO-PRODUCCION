import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.goto("https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=367245a#reportes", { waitUntil: "networkidle", timeout: 90000 });
await page.locator("#refreshSnapshotsBtn").click();
await page.waitForFunction(() => {
  const s = document.querySelector("#planSnapshotSelect");
  return s && s.options.length > 1 && s.value !== "draft";
}, null, { timeout: 240000, polling: 3000 }).catch(() => null);
await page.waitForTimeout(6000);
const out = await page.evaluate(() => {
  const ops = (typeof reportSnapshot !== "undefined" && reportSnapshot.operations) ? reportSnapshot.operations : [];
  const first = ops.slice(0, 6).map((op) => ({
    ot: op.ot, parte: op.parte, descripcion: op.descripcion, operador: op.operador,
    fi: op.fechaInicio, hi: op.horaInicio, ff: op.fechaFin, hf: op.horaFin, seq: op.secuencia,
  }));
  return {
    hasReportSnapshot: typeof reportSnapshot !== "undefined",
    reportSnapshotId: reportSnapshot?.snapshotId,
    reportOps: ops.length,
    planStart: reportSnapshot?.planStart || "",
    weekStart: reportSnapshot?.weekStart || "",
    version: reportSnapshot?.version,
    stateReportWeekStart: typeof state !== "undefined" ? state.reportWeekStart : "n/a",
    statePlanStart: typeof state !== "undefined" ? state.planStart : "n/a",
    first,
    snapshots: (typeof planSnapshots !== "undefined" ? planSnapshots : []).map((s) => ({
      id: s.snapshotId, ops: s.operations, planStart: s.planStart, week: s.weekStart, gen: s.generatedAt,
    })),
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();