import { chromium } from "playwright";

const APP_URL = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=367245a";
const STATS_FN = `
  const iso = (d) => (d ? String(d).slice(0, 10) : "");
  const weekOf = (d) => { if (!d) return null; const [y,m,dd] = String(d).slice(0,10).split("-").map(Number); const dt = new Date(Date.UTC(y,m-1,dd)); const day=(dt.getUTCDay()+6)%7; const mon=new Date(dt); mon.setUTCDate(dt.getUTCDate()-day); return mon.toISOString().slice(0,10); };
  const stats = (ops, startDate) => { const withDates=ops.filter(o=>o.fechaInicio); const sorted=withDates.map(o=>iso(o.fechaInicio)).sort(); const byWeek={}; let beforeStart=0,onStart=0; for(const o of withDates){const d=iso(o.fechaInicio); const w=weekOf(d); byWeek[w]=(byWeek[w]||0)+1; if(startDate&&d<startDate)beforeStart++;} return { opsCount:ops.length, minFechaInicio:sorted[0]||null, maxFechaInicio:sorted[sorted.length-1]||null, byWeek, beforeStart }; };
`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.goto(`${APP_URL}#planning`, { waitUntil: "networkidle", timeout: 90000 });
await page.waitForFunction(() => typeof state !== "undefined" && state.planStart && state.operations && state.operations.length > 0, null, { timeout: 240000, polling: 3000 }).catch(() => null);
await page.waitForTimeout(4000);

const out = await page.evaluate(`(() => { ${STATS_FN}
  const d = (el) => ({ id: el.id, type: el.type, value: el.value, placeholder: el.placeholder||"", label: (el.closest("label")?.textContent||"").trim().slice(0,50), name: el.getAttribute("name")||"" });
  const dateInputs = [...document.querySelectorAll("input")].filter(i=>i.type==="date").map(d);
  const ps = state?.planStart;
  const chosen = dateInputs.find(i=>i.value===ps) || dateInputs.find(i=>/planstart|inicio/i.test(i.id+" "+i.label+" "+i.name)) || dateInputs[0] || null;
  const snap = typeof reportSnapshot !== "undefined" && reportSnapshot ? { id: reportSnapshot.snapshotId, planStart: reportSnapshot.planStart } : null;
  return { planStart: ps, dateInputs, chosenId: chosen?.id || null, stats: stats(state.operations, "2026-08-28"), snap, opsOn28: state.operations.filter(o=>String(o.fechaInicio).slice(0,10)==="2026-08-28").length };
})()`);
console.log(JSON.stringify(out, null, 2));
await browser.close();