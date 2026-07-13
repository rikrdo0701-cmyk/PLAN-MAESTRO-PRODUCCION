# Precio temporal y resaltado semanal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir editar o eliminar el precio temporal desde la tabla de artículos y resaltar en el reporte semanal las filas PROTOTIPO y EXPEDITADO.

**Architecture:** Se reutilizará `articleConfigurations` como fuente única del precio y tipo de trabajo. La vista semanal obtendrá una clase semántica por fila mediante una función pura, y CSS aplicará colores equivalentes en pantalla e impresión.

**Tech Stack:** JavaScript sin framework, HTML/CSS, Node.js test runner, build estático para GitHub Pages y Apps Script.

## Global Constraints

- Vacío o cero guarda `manualUnitPrice: 0`.
- Editar el precio no modifica Tipo comercial ni Tipo de trabajo.
- La resolución de precio conserva el orden factura, temporal mayor que cero, cero.
- PROTOTIPO usa morado; EXPEDITADO usa naranja; NORMAL conserva el estilo actual.
- Los colores deben imprimirse con `print-color-adjust: exact`.

---

### Task 1: Precio temporal editable en catálogo

**Files:**
- Modify: `src/web/planning/app.js`
- Test: `tests/build.test.mjs`

**Interfaces:**
- Consumes: `articleConfigurationFor(article)`, `saveAndRender(message, "catalogs")`.
- Produces: campos `.article-temporary-price-input` con `data-article-price` y guardado mediante `updateTemporaryArticlePrice(article, value)`.

- [ ] **Step 1: Escribir la prueba fallida**

Agregar a `tests/build.test.mjs` verificaciones para el campo editable y el manejador:

```js
assert.match(pagesIndex, /class="article-temporary-price-input"/);
assert.match(pagesIndex, /function updateTemporaryArticlePrice\(article, value\)/);
assert.match(pagesIndex, /config\.manualUnitPrice = Number\.isFinite\(numeric\) && numeric > 0 \? numeric : 0/);
```

- [ ] **Step 2: Ejecutar la prueba y confirmar RED**

Run: `node --test tests/build.test.mjs`

Expected: FAIL porque no existe el campo editable.

- [ ] **Step 3: Implementar el guardado mínimo**

En `renderArticleConfigurationTable()`, reemplazar el texto del precio por:

```js
<input class="article-temporary-price-input" data-article-price="${escapeHtml(item.article)}"
  type="number" min="0" step="0.01"
  value="${item.manualUnitPrice > 0 ? escapeHtml(item.manualUnitPrice) : ""}"
  aria-label="Precio temporal ${escapeHtml(item.article)}">
```

Enlazar `change` y guardar solo el precio:

```js
function updateTemporaryArticlePrice(article, value) {
  const config = articleConfigurationFor(article);
  const numeric = Number(value);
  config.manualUnitPrice = Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
  config.updatedAt = new Date().toISOString();
  saveAndRender(config.manualUnitPrice > 0 ? "Precio temporal actualizado" : "Precio temporal eliminado", "catalogs");
}
```

- [ ] **Step 4: Ejecutar la prueba y confirmar GREEN**

Run: `node --test tests/build.test.mjs`

Expected: PASS.

### Task 2: Clasificación visual de filas semanales

**Files:**
- Modify: `src/web/planning/planning-workflow-core.js`
- Modify: `src/web/planning/app.js`
- Test: `tests/planning-workflow-core.test.mjs`

**Interfaces:**
- Produces: `weeklyPlanningTypeClass(value): "weekly-row--prototype" | "weekly-row--expedited" | ""`.
- Consumes: `row.planningType` o `articleConfigurationValue(row.part).planningType`.

- [ ] **Step 1: Escribir la prueba fallida**

```js
test("clasifica el tipo de trabajo para resaltado semanal", () => {
  assert.equal(core.weeklyPlanningTypeClass("PROTOTIPO"), "weekly-row--prototype");
  assert.equal(core.weeklyPlanningTypeClass("EXPEDITADO"), "weekly-row--expedited");
  assert.equal(core.weeklyPlanningTypeClass("NORMAL"), "");
});
```

- [ ] **Step 2: Ejecutar la prueba y confirmar RED**

Run: `node --test tests/planning-workflow-core.test.mjs`

Expected: FAIL con función inexistente.

- [ ] **Step 3: Implementar la función pura y aplicarla**

```js
function weeklyPlanningTypeClass(value) {
  const type = normalize(value);
  if (type === "PROTOTIPO") return "weekly-row--prototype";
  if (type === "EXPEDITADO") return "weekly-row--expedited";
  return "";
}
```

En `renderWeeklyJobDays`, resolver y agregar la clase:

```js
const planningType = row.planningType || articleConfigurationValue(row.part).planningType;
const rowClass = window.PlanningWorkflowCore.weeklyPlanningTypeClass(planningType);
return `<tr class="${rowClass}">...</tr>`;
```

- [ ] **Step 4: Ejecutar pruebas y confirmar GREEN**

Run: `node --test tests/planning-workflow-core.test.mjs tests/build.test.mjs`

Expected: PASS.

### Task 3: Estilos de pantalla e impresión

**Files:**
- Modify: `src/web/planning/styles.css`
- Test: `tests/build.test.mjs`

**Interfaces:**
- Consumes: `.weekly-row--prototype` y `.weekly-row--expedited`.

- [ ] **Step 1: Escribir la prueba fallida**

```js
assert.match(pagesIndex, /\.weekly-row--prototype td/);
assert.match(pagesIndex, /\.weekly-row--expedited td/);
assert.match(pagesIndex, /print-color-adjust: exact/);
```

- [ ] **Step 2: Ejecutar la prueba y confirmar RED**

Run: `node --test tests/build.test.mjs`

Expected: FAIL por clases inexistentes.

- [ ] **Step 3: Implementar estilos**

```css
.weekly-day-table .weekly-row--prototype td { background: #eee5ff; border-color: #8b5cf6; }
.weekly-day-table .weekly-row--expedited td { background: #fff0dd; border-color: #f28c28; }
@media print {
  .weekly-row--prototype td,
  .weekly-row--expedited td { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}
```

- [ ] **Step 4: Verificación completa**

Run: `npm test && npm run build && git diff --check`

Expected: todas las pruebas PASS, build correcto y diff limpio.

- [ ] **Step 5: QA en navegador**

Abrir `#reportes`, confirmar edición y eliminación del precio, filas morada/naranja y vista previa de impresión sin errores de consola.

