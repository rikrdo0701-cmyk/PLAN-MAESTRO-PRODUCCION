import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
console.log("loading planning view...");
await page.goto("https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/?v=367245a#planning", { waitUntil: "networkidle", timeout: 120000 });
const res = await page.evaluate(() => {
  const wait = new Promise((done) => {
    let n = 0;
    const t = setInterval(() => {
      n += 500;
      if ((typeof state !== "undefined" && state.planStart && state.operations && state.operations.length > 0) || n > 60000) {
        clearInterval(t);
        done();
      }
    }, 500);
  });
  return wait.then(() => {
    const ops = (typeof state !== "undefined" && state.operations) ? state.operations : [];
    const hasSelect = !!document.querySelector("#planSnapshotSelect");
    return {
      stateDefined: typeof state !== "undefined",
      planStart: state ? state.planStart : undefined,
      opsCount: ops.length,
      hasSnapshotSelect: hasSelect,
      snapshotsLoaded: typeof planSnapshots !== "undefined" ? planSnapshots.length : "n/a",
    };
  });
});
console.log(JSON.stringify(res, null, 2));
await browser.close();