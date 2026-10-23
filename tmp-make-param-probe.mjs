// Genera una variante parametrizada de tmp-inspect-print-check.mjs
import fs from "fs";

let s = fs.readFileSync("tmp-inspect-print-check.mjs", "utf8");
s = s.replace(
  'const BASE = "http://127.0.0.1:4173/index.html";',
  'const BASE = process.env.PROBE_BASE || "http://127.0.0.1:4173/index.html";',
);
s = s.replace(
  'const N_OPERACIONES = 40;',
  'const N_OPERACIONES = Number(process.env.PROBE_N || 40);',
);
s = s.replace(
  'const OUT = "C:/Users/plane/AppData/Local/Temp/opencode/inspeccion-real-check.pdf";',
  'const OUT = `C:/Users/plane/AppData/Local/Temp/opencode/inspeccion-real-${N_OPERACIONES}.pdf`;',
);
fs.writeFileSync("tmp-probe-param.mjs", s);
console.log("ok");
