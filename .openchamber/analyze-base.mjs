import { chromium } from "playwright";
const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=d6a16c6";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("dialog", (d) => d.accept().catch(() => {}));
await page.goto(SITE + "#reportes", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && (state.operations || []).length > 300, null, { timeout: 180000, polling: 2000 });
await page.waitForTimeout(6000);

const out = await page.evaluate(() => (async () => {
  const list = await callAppsScript("listPlanSnapshots");
  const meta = Array.isArray(list) ? list.map((s) => ({
    id: s.snapshotId, week: s.weekStart, start: s.planStart, ops: s.operations,
    gen: s.generatedAt, pub: s.publishedAt, version: s.version,
    status: s.status || s.planStatus, label: s.label,
  })).filter((s) => s.pub || s.status === "PUBLICADO") : list;
  const week = "2026-08-24";
  const weekCandidates = meta.filter((s) => (s.week || s.start) && new Date(`${(s.week || s.start).slice(0,10)}T00:00:00Z`).toISOString().slice(0,10) === week);
  meta.sort((a, b) => String(b.pub || b.gen || "").localeCompare(String(a.pub || a.gen || "")));

  async function load(snapId) {
    const raw = await callAppsScript("getPlanSnapshot", snapId);
    const ops = Array.isArray(raw?.operations) ? raw.operations : [];
    const iso = (d) => (d ? String(d).slice(0, 10) : "");
    const fi = ops.map((o) => o.fechaInicio).filter(Boolean).sort();
    const weekOf = (d) => { if (!d) return null; const [y, m, dd] = String(d).slice(0, 10).split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, dd)); const mon = new Date(dt); mon.setUTCDate(dt.getUTCDate() - (dt.getUTCDay() + 6) % 7); return mon.toISOString().slice(0, 10); };
    const byWeek = {}; for (const op of ops) { const w = weekOf(op.fechaInicio); byWeek[w] = (byWeek[w] || 0) + 1; }
    const inWk = ops.filter((o) => weekOf(o.fechaInicio) === week);
    return {
      id: raw?.snapshotId, ops: ops.length, minFi: iso(fi[0]),
      startingInWeek: inWk.length,
      ot2233: ops.filter((o) => String(o.ot) === "2233").map((o) => ({ fi: iso(o.fechaInicio), hi: o.horaInicio, sec: o.secuencia, ps: o.planStatus, op: o.operationState })),
      inWeekOps: inWk.slice(0, 20).map((o) => ({ ot: o.ot, fi: iso(o.fechaInicio), hi: o.horaInicio, sec: o.secuencia, ps: o.planStatus })),
      lockedOts: (raw?.lockedOts || []).slice(0, 30),
      selectedCount: (raw?.selectedOts || []).length,
      has2233Locked: (raw?.lockedOts || []).some((o) => String(o) === "2233"),
    };
  }

  const chosen = await load((weekCandidates[0] || {}).id);
  return { meta, weekCandidates, chosenId: (weekCandidates[0] || {}).id, chosen };
})());
console.log(JSON.stringify(out, null, 2));
await browser.close();
console.log("DONE");