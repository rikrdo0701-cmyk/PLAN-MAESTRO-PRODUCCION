# GitHub Actions Node.js 24 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar los avisos de Node.js 20 actualizando todas las acciones oficiales de los workflows.

**Architecture:** Una prueba inspeccionará los YAML y exigirá las versiones aprobadas. Los workflows conservarán sus eventos, permisos, comandos y valores `node-version`.

**Tech Stack:** GitHub Actions YAML, Node.js `node:test`.

## Global Constraints

- `actions/checkout@v6` y `actions/setup-node@v6` en todos los workflows.
- Pages usa `actions/configure-pages@v6`, `actions/upload-pages-artifact@v5` y `actions/deploy-pages@v5`.
- Conservar cada `node-version` actual.
- No modificar IDs, secretos, permisos, eventos ni comandos de despliegue.
- No tocar el Apps Script protegido.

---

### Task 1: Actualizar acciones y cubrir versiones

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/deploy-appscript.yml`
- Modify: `.github/workflows/deploy-pages.yml`
- Modify: `.github/workflows/npm-publish-github-packages.yml`
- Modify: `tests/build.test.mjs`

**Interfaces:**
- Consumes: workflows YAML existentes.
- Produces: workflows equivalentes con acciones basadas en Node.js 24.

- [ ] **Step 1: Escribir la prueba fallida**

Agregar en `tests/build.test.mjs`:

```js
test("todos los workflows usan acciones compatibles con Node.js 24", async () => {
  const workflowNames = ["ci.yml", "deploy-appscript.yml", "deploy-pages.yml", "npm-publish-github-packages.yml"];
  const workflows = await Promise.all(workflowNames.map((name) =>
    readFile(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8")
  ));
  for (const workflow of workflows) {
    assert.doesNotMatch(workflow, /actions\/checkout@v[45]\b/);
    assert.doesNotMatch(workflow, /actions\/setup-node@v[45]\b/);
  }
  assert.match(workflows[2], /actions\/configure-pages@v6\b/);
  assert.match(workflows[2], /actions\/upload-pages-artifact@v5\b/);
  assert.match(workflows[2], /actions\/deploy-pages@v5\b/);
});
```

- [ ] **Step 2: Confirmar RED**

Run: `node --test tests/build.test.mjs`

Expected: FAIL por versiones `v4`/`v5` antiguas.

- [ ] **Step 3: Actualizar únicamente referencias `uses`**

Reemplazar:

```yaml
actions/checkout@v4|v5                  -> actions/checkout@v6
actions/setup-node@v4|v5                -> actions/setup-node@v6
actions/configure-pages@v5              -> actions/configure-pages@v6
actions/upload-pages-artifact@v3        -> actions/upload-pages-artifact@v5
actions/deploy-pages@v4                 -> actions/deploy-pages@v5
```

No cambiar los bloques `with`, incluidos `node-version: "20"`, `node-version: 20` y `node-version: "24"`.

- [ ] **Step 4: Confirmar GREEN**

Run: `node --test tests/build.test.mjs`

Expected: PASS.

- [ ] **Step 5: Verificación completa**

Run: `npm.cmd test`

Expected: todas las pruebas PASS.

Run: `npm.cmd run check`

Expected: `Validacion correcta`.

Run: `git diff --check`

Expected: sin salida.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/deploy-appscript.yml .github/workflows/deploy-pages.yml .github/workflows/npm-publish-github-packages.yml tests/build.test.mjs docs/superpowers/plans/2026-07-19-github-actions-node24.md
git commit -m "ci: actualizar acciones a Node 24"
```
