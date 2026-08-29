import { chromium } from "playwright";
const SITE = "https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=1ac4b2d#planning";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("dialog", (d) => d.accept().catch(() => {}));
await page.goto(SITE, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForFunction(() => typeof state !== "undefined" && (state.operations||[]).length > 300, null, { timeout: 180000, polling: 2000 });
const r = await page.evaluate(() => {
  const fns = ["machineCandidates","toolCatalogForOperation","validBendingMachine","unscheduledCause","operatorCandidates","isBendingOperation"];
  const out = {};
  for (const f of fns) out[f] = typeof window[f];
  out.machinesLen = (state.machines||[]).length;
  out.machinesIds = (state.machines||[]).slice(0,8).map(m => m.id || m.machine || m.maquina);
  // find an empty-maquina bending op and test machineCandidates if available
  const bendEmpty = (state.operations||[]).find(op => (String(op.ct)==="5459"||String(op.ct)==="5527") && !String(op.maquina||"").trim());
  if (typeof window.machineCandidates === "function" && bendEmpty) {
    out.testOp = { ot: bendEmpty.ot, ct: bendEmpty.ct, maquina: bendEmpty.maquina };
    out.testMc = window.machineCandidates(state, bendEmpty);
    out.testVb = typeof window.validBendingMachine==="function" ? window.validBendingMachine(bendEmpty.maquina, bendEmpty.ct) : "n/a";
  } else {
    out.note = "machineCandidates not global; cannot introspect";
  }
  return out;
});
console.log(JSON.stringify(r, null, 2));
await browser.close();
