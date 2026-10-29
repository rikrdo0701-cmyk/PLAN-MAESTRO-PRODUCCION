import fs from "node:fs";
const s = fs.readFileSync("src/web/planning/app.js", "utf8");
// Search for syncReleaseRealBtn
const found = s.includes("syncReleaseRealBtn");
console.log("syncReleaseRealBtn in app.js:", found);
// Search for els list
const elsMatch = s.match(/els\s*=\s*\{[\s\S]*?\}/);
console.log("els list found:", elsMatch ? "yes" : "no");
if (elsMatch) {
  console.log("els list length:", elsMatch[0].length);
  console.log("has syncReleaseRealBtn:", elsMatch[0].includes("syncReleaseRealBtn"));
}