# GitHub Pages Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar únicamente el planificador generado y evitar que Jekyll lo reemplace con el README.

**Architecture:** `deploy-pages.yml` será el único workflow con permisos para GitHub Pages. El generador normalizará finales de línea al leer fuentes para producir el mismo resultado en Windows y Linux, y las pruebas comprobarán que el artefacto contiene la aplicación y el motor actualizado.

**Tech Stack:** GitHub Actions, Node.js 20+, `node:test`, JavaScript ESM, GitHub Pages.

## Global Constraints

- No añadir dependencias.
- No modificar el backend de Apps Script.
- No publicar la raíz del repositorio como alternativa.
- El despliegue debe detenerse si falla test, check, build o validación del artefacto.

---

### Task 1: Build portable y artefacto verificable

**Files:**
- Modify: `scripts/build-appscript.mjs`
- Modify: `tests/build.test.mjs`

**Interfaces:**
- Consumes: fuentes de `src/web/planning` leídas como UTF-8.
- Produces: `buildProject()` genera `site/index.html` con `PlannerCore`, `scheduleCurrentPlan` y `subcontractWindowEnd`.

- [ ] **Step 1: Fortalecer la prueba del artefacto**

Añadir a `tests/build.test.mjs`, después de leer el HTML generado:

```js
assert.match(siteIndex, /PlannerCore/);
assert.match(siteIndex, /scheduleCurrentPlan/);
assert.match(siteIndex, /subcontractWindowEnd/);
assert.doesNotMatch(siteIndex, /<h1[^>]*>PLAN-MAESTRO-PRODUCCION<\/h1>/i);
```

- [ ] **Step 2: Ejecutar la prueba y confirmar el fallo actual**

Run: `node --test tests/build.test.mjs`

Expected: FAIL con `No se encontro la carga inicial para recuperar el borrador` en Windows.

- [ ] **Step 3: Normalizar finales de línea al leer fuentes**

Cambiar el helper `read` de `scripts/build-appscript.mjs`:

```js
async function read(relativePath) {
  const content = await readFile(path.join(projectRoot, relativePath), "utf8");
  return content.replace(/\r\n/g, "\n");
}
```

- [ ] **Step 4: Verificar el build portable**

Run: `node --test tests/build.test.mjs`

Expected: PASS y `site/index.html` contiene el planificador.

- [ ] **Step 5: Commit de la unidad**

```bash
git add scripts/build-appscript.mjs tests/build.test.mjs
git commit -m "Hacer portable el build de GitHub Pages"
```

### Task 2: Propietario único de GitHub Pages

**Files:**
- Delete: `.github/workflows/jekyll-gh-pages.yml`
- Modify: `.github/workflows/deploy-pages.yml`

**Interfaces:**
- Consumes: `site/` generado por `npm run build`.
- Produces: un único despliegue al entorno `github-pages`.

- [ ] **Step 1: Eliminar el workflow competidor**

Eliminar completamente `.github/workflows/jekyll-gh-pages.yml` para que ningún evento pueda publicar la raíz mediante Jekyll.

- [ ] **Step 2: Añadir validaciones antes del empaquetado**

En `.github/workflows/deploy-pages.yml`, sustituir instalación y build por:

```yaml
      - run: npm ci
      - run: npm test
      - run: npm run check
      - run: npm run build
      - name: Verificar frontend generado
        run: |
          test -f site/index.html
          grep -q "PlannerCore" site/index.html
          grep -q "scheduleCurrentPlan" site/index.html
          grep -q "subcontractWindowEnd" site/index.html
```

- [ ] **Step 3: Verificar localmente el proyecto completo**

Run: `npm.cmd test`

Expected: todos los tests PASS.

Run: `npm.cmd run check`

Expected: exit 0.

Run: `npm.cmd run build`

Expected: exit 0 y creación de `site/index.html`.

- [ ] **Step 4: Revisar el diff y errores de espacios**

Run: `git diff --check`

Expected: exit 0.

- [ ] **Step 5: Commit de workflows**

```bash
git add .github/workflows/deploy-pages.yml .github/workflows/jekyll-gh-pages.yml
git commit -m "Evitar despliegues concurrentes de GitHub Pages"
```

### Task 3: Publicación y validación en producción

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: commits verificados en `main`.
- Produces: aplicación visible en la URL pública.

- [ ] **Step 1: Subir los commits**

Run: `git push origin main`

Expected: actualización de `origin/main`.

- [ ] **Step 2: Esperar el despliegue de Pages**

Comprobar periódicamente la URL pública hasta que el HTML contenga `subcontractWindowEnd`, con un límite razonable de diez minutos.

- [ ] **Step 3: Validar la página en navegador**

Abrir `https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/` y comprobar:

```text
Título y controles del planificador visibles
README no visible como página principal
Sin errores relevantes en consola
```

- [ ] **Step 4: Simular OT 1325**

Con una sesión limpia, cargar únicamente la OT 1325, configurar MAKA con 15 días y programar. Confirmar que el final del subcontrato rebasa el horizonte visible cuando sea necesario y registrar cualquier hueco restante junto con el recurso que lo provoca.
