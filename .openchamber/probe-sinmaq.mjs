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
  const sum = res?.summary || {};
  // Determine scheduled op signatures
  const schedKeys = new Set();
  (sum.scheduledOperations||[]).forEach(o=>schedKeys.add(String(o.ot||"")+"|"+String(o.index??o.idx??"")));
  (sum.scheduledOts||[]).forEach(k=>schedKeys.add(String(k)));
  const total = (state.operations||[]).length;
  const uns = (state.operations||[]).filter(op=>{
    if(!op) return false;
    const k = String(op.ot||"")+"|"+(op.index!==undefined?op.index:(op.idx!==undefined?op.idx:""));
    return !schedKeys.has(k) && !schedKeys.has(String(op.ot||""));
  });
  // Replicate unscheduledCause machine logic for bending ops
  function norm(s){return String(s||"").trim().toLowerCase().replace(/\s+/g,"_");}
  function validBending(m,ct){const v=String(m||"").trim();return Boolean(v)&&norm(v)!=="sin_maquina"&&!(String(ct)==="5459"&&v==="1");}
  function machineCands(op){ if(!(String(op.ct)==="5459"||String(op.ct)==="5527")) return [""]; const am=String(op.maquina||"").trim(); if(am&&norm(am)!=="sin_maquina"){return validBending(am,op.ct)?[am]:[];} const cat=(state.machines||[]).filter(m=>m.active!==false).map(m=>m.id||m.machine||m.maquina).filter(Boolean); return [...new Set([op.maquina,...cat].filter(Boolean))].filter(m=>norm(m)!=="sin_maquina"&&!(String(op.ct)==="5459"&&String(m)==="1")); }
  const bend = uns.filter(op=>String(op.ct)==="5459"||String(op.ct)==="5527");
  const sinMaq = bend.filter(op=>!machineCands(op).length);
  const mc = {};
  for(const op of sinMaq){const m=String(op.maquina||"").trim()||"(empty)";mc[m]=(mc[m]||0)+1;}
  return { totalOps: total, unsCount: uns.length, bendUns: bend.length, sinMaqCount: sinMaq.length, sinMaqMaquina: mc, sinMaqSample: sinMaq.slice(0,8).map(op=>({ot:op.ot,ct:op.ct,maquina:op.maquina,herr:op.herramental||op.tool})) };
});
console.log(JSON.stringify(r,null,2));
await browser.close();
