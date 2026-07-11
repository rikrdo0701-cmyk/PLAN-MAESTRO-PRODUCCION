import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildProject } from "../scripts/build-appscript.mjs";

test("el build genera las tres aplicaciones de Apps Script", async () => {
  const result = await buildProject();
  assert.deepEqual(result.htmlFiles, ["Index.html", "IndexOperator.html", "IndexSkills.html"]);
  const index = await readFile(path.join(result.distDir, "Index.html"), "utf8");
  assert.match(index, /<title>Planeacion de Produccion<\/title>/);
  assert.match(index, /function doGet|google\.script\.run/);
});
