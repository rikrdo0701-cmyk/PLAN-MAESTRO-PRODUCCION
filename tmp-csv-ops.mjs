import fs from "fs";

const text = fs.readFileSync("plan-produccion (54).csv", "utf8");
const lines = text.split(/\r?\n/).filter((l) => l.trim());
const head = lines[0].split(",").map((s) => s.replace(/^"|"$/g, "").trim());
console.log(head.join(" | "));
const idxOt = head.findIndex((h) => /^OT$/i.test(h));
const counts = {};
for (const line of lines.slice(1)) {
  const cells = line.split(",").map((s) => s.replace(/^"|"$/g, "").trim());
  const ot = cells[idxOt];
  counts[ot] = (counts[ot] || 0) + 1;
}
const top = Object.entries(counts).sort((a, b) => b[1] - a[1]);
console.log("OTs:", Object.keys(counts).length);
console.log("top:", top.slice(0, 8).map(([o, n]) => `${o}=${n}`).join("  "));
