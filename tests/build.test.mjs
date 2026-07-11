import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildProject } from "../scripts/build-appscript.mjs";

test("el build genera Apps Script y GitHub Pages", async () => {
  const result = await buildProject();
  assert.deepEqual(result.htmlFiles, ["Index.html", "IndexOperator.html", "IndexSkills.html", "Bridge.html"]);
  assert.deepEqual(result.pagesFiles, ["index.html", "operator.html", "skills.html", "manifest.webmanifest", "sw.js"]);
  const index = await readFile(path.join(result.distDir, "Index.html"), "utf8");
  assert.match(index, /<title>Planeacion de Produccion<\/title>/);
  assert.match(index, /google\.script\.run/);
  assert.match(index, /PPAppsScriptBridge/);
  assert.match(index, /getAppStateIfChanged/);
  assert.match(index, /savePlanningStateOptimized/);
  const pagesIndex = await readFile(path.join(result.siteDir, "index.html"), "utf8");
  assert.match(pagesIndex, /script\.google\.com\/macros\/s\//);
  assert.match(pagesIndex, /manifest\.webmanifest/);
  assert.match(pagesIndex, /serviceWorker\.register/);
});
