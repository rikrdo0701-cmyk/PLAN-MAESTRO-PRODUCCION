import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.goto("https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=367245a#reportes", { waitUntil: "networkidle", timeout: 90000 });
await page.locator("#refreshSnapshotsBtn").click();
await page.waitForFunction(() => {
  const s = document.querySelector("#planSnapshotSelect");
  return s && s.options.length > 1 && s.value !== "draft";
}, null, { timeout: 300000, polling: 3000 }).catch(() => null);
await page.waitForTimeout(5000);
const out = await page.evaluate(() => {
  const snapshots = (typeof planSnapshots !== "undefined" ? planSnapshots : []);
  const ops = (typeof reportSnapshot !== "undefined" && reportSnapshot.operations) ? reportSnapshot.operations : [];
  const csvOts = ["3143", "3144", "3108", "3112", "3113", "3124", "3123", "3202", "2958"];
  const otProbe = {};
  for (const ot of csvOts) {
    const hits = ops.filter((o) => String(o.ot) === ot);
    otProbe[ot] = hits.map((o) => ({
      fi: o.fechaInicio, hi: o.horaInicio, ff: o.fechaFin, hf: o.horaFin,
      parte: o.parte, desc: o.descripcion, maq: o.maquina, log: (o.log || "").slice(0, 60),
    }));
  }
  const minOps = ops.slice().sort((a, b) => String(a.fechaInicio).localeCompare(String(b.fechaInicio) || "")).slice(0, 8);
  return {
    selectValue: document.querySelector("#planSnapshotSelect")?.value,
    snapshotList: snapshots.map((s) => ({
      id: s.snapshotId, ops: s.operations, planStart: s.planStart, week: s.weekStart, gen: s.generatedAt,
    })),
    loadedSnapshotId: reportSnapshot?.snapshotId,
    loadedOpsCount: ops.length,
    loadedPlanStart: reportSnapshot?.planStart,
    firstOps: minOps.map((o) => ({ ot: o.ot, fi: o.fechaInicio, hi: o.horaInicio, desc: (o.descripcion || "").slice(0, 30) })),
    otProbe,
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();