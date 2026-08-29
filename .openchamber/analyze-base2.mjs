import { chromium } from "playwright";
const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=d6a16c6";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
await page.goto(SITE + "#reportes", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && (state.operations || []).length > 300, null, { timeout: 180000, polling: 2000 });
await page.waitForTimeout(6000);

const out = await page.evaluate(() => (async () => {
  const iso = (d) => (d ? String(d).slice(0, 10) : "");
  const weekOf = (d) => { if (!d) return null; const [y, m, dd] = String(d).slice(0, 10).split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, dd)); const mon = new Date(dt); mon.setUTCDate(dt.getUTCDate() - (dt.getUTCDay() + 6) % 7); return mon.toISOString().slice(0, 10); };
  const HIST = /HISTORICO|PUBLICAD|GUARDAD/i;
  function analyze(raw, id) {
    const ops = (Array.isArray(raw?.operations) ? raw.operations : []);
    const byWeek = {}; for (const op of ops) { const w = weekOf(op.fechaInicio); if (w) byWeek[w] = (byWeek[w] || 0) + 1; }
    const byWeekNonHist = {}; for (const op of ops) { if (HIST.test(op.planStatus || op.operationState || "")) continue; const w = weekOf(op.fechaInicio); if (w) byWeekNonHist[w] = (byWeekNonHist[w] || 0) + 1; }
    const fixture = ["2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-28"];
    const mk = (o) => Object.fromEntries(fixture.map((w) => [suffix(w), o[w] ?? 0]));
    const suffix = (w) => w.slice(8, 10);
    const ot = (n) => ops.filter((o) => String(o.ot) === n).map((o) => ({ fi: iso(o.fechaInicio), hi: o.horaInicio, sec: o.secuencia, ps: o.planStatus, os: o.operationState }));
    const fiAll = ops.map((o) => iso(o.fechaInicio)).filter(Boolean).sort();
    return {
      id: raw?.snapshotId || id, ops: ops.length, minFi: fiAll[0] || null,
      startingInWeek24: ops.filter((o) => weekOf(o.fechaInicio) === "2026-08-24").length,
      startingInWeek24NonHist: ops.filter((o) => !HIST.test(o.planStatus || o.operationState || "") && weekOf(o.fechaInicio) === "2026-08-24").length,
      opsBeforePlanStart: ops.filter((o) => iso(o.fechaInicio) < "2026-08-28").length,
      opsBeforePlanStartNonHist: ops.filter((o) => !HIST.test(o.planStatus || o.operationState || "") && iso(o.fechaInicio) < "2026-08-28").length,
      byWeek: mk(byWeek), byWeekNonHist: mk(byWeekNonHist),
      ot2233: ot("2233"), ot3143: ot("3143"),
    };
  }
  const rawA = await callAppsScript("getPlanSnapshot", "1e0cc75b-ddb9-413b-8e4d-9e78add0aa8c");
  const rawB = await callAppsScript("getPlanSnapshot", "9378167d-c026-46cc-8aab-547aab304f9b");
  const rawC = await callAppsScript("getPlanSnapshot", "e1277731-6256-4fcf-9c0c-9c11079585da");
  return { A: analyze(rawA, "1e0cc75b"), B: analyze(rawB, "9378167d"), C: analyze(rawC, "e1277731") };
})());
console.log(JSON.stringify(out, null, 2));
await browser.close();
console.log("DONE");