import { chromium } from "playwright";
const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=1ac4b2d#planning";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("dialog", (d) => d.accept().catch(() => {}));
await page.goto(SITE, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && (state.operations||[]).length > 300, null, { timeout: 180000, polling: 2000 });
const r = await page.evaluate(async () => {
  const ots = [...new Set((state.operations||[]).filter(op=>op&&op.ot&&op.tipoInsercion!=="CAMBIO_HERRAMENTAL").map(op=>String(op.ot).trim()).filter(Boolean))].slice(0,140);
  state.selectedOts = ots; state.planStart="2026-08-28";
  const res = await runPlanningPerformanceDryRun({ timeoutMs: 300000, collectStats: true, progressEveryMs: 15000 });
  const schedSet = new Set((res?.summary?.scheduledOts||[]).map(x=>String(x).trim()));
  const uns = (state.operations||[]).filter(op=>op && !schedSet.has(String(op.ot).trim()));
  const bend = uns.filter(op=>String(op.ct)==="5459"||String(op.ct)==="5527");
  const suspect = bend.filter(op=>{ const m=String(op.maquina||"").trim(); return m!=="" && m.toUpperCase()!=="SIN_MAQUINA"; });
  const counts = {};
  for (const op of suspect) { const m=String(op.maquina||"").trim(); counts[m]=(counts[m]||0)+1; }
  const sample = suspect.slice(0,10).map(op=>({ot:op.ot,ct:op.ct,maquina:op.maquina,herr:op.herramental||op.tool,tipo:op.tipoInsercion}));
  return { bendUnscheduled: bend.length, suspectNonEmptyInvalid: suspect.length, maquinaCounts: counts, sample };
});
console.log(JSON.stringify(r,null,2));
await browser.close();
