# Inspection Routes Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar el editor de tramo/dibujo para escritorio y agregar una sección en Catálogos desde la que se puedan buscar y editar los tramos existentes.

**Architecture:** El servicio de inspección seguirá siendo la única puerta de acceso a la hoja `Tramos`. `InspectionCore` concentrará normalización, filtrado y construcción de payloads; la vista de Catálogos consumirá esas funciones y la vista de inspección tendrá un diálogo propio que guarda el dibujo del artículo y los tramos de materiales sin duplicar reglas.

**Tech Stack:** JavaScript ES2020 sin framework, HTML `<dialog>`, CSS del proyecto, Google Apps Script, pruebas `node:test`.

## Global Constraints

- Prioridad visual para computadora, especialmente anchos de 1,024 px o mayores.
- El guardado mantiene la clave funcional artículo + material.
- Catálogos permite editar tramos, pero no dibujos ni eliminar registros.
- El editor de inspección conserva dibujo y tramos en un solo flujo.
- No se modifica el esquema de Google Sheets ni la hoja imprimible.
- Los errores de guardado no cierran el diálogo ni borran lo capturado.
- No agregar dependencias.

---

## File Map

- `src/server/16-inspection-service.js`: lectura y escritura de la hoja `Tramos`.
- `src/web/inspection/inspection-core.js`: transformaciones puras compartidas por Catálogos e Inspección.
- `src/web/inspection/inspection-app.js`: estado y eventos del diálogo de edición de la hoja.
- `src/web/inspection/inspection.css`: aspecto responsive del diálogo de inspección.
- `src/web/planning/index.template.html`: sección de Catálogos y estructura del diálogo.
- `src/web/planning/app.js`: carga, búsqueda, render y guardado del catálogo de tramos.
- `src/web/planning/styles.css`: tabla, toolbar y diálogo del catálogo.
- `tests/inspection-core.test.mjs`: pruebas unitarias de filtro y payload.
- `tests/inspection-service.test.mjs`: contrato de lectura/escritura del servidor.
- `tests/build.test.mjs`: verificación de integración del HTML generado.

---

### Task 1: Contrato estable para listar y guardar tramos

**Files:**
- Modify: `src/server/16-inspection-service.js`
- Test: `tests/inspection-service.test.mjs`

**Interfaces:**
- Consumes: hoja `Tramos` con encabezados `Articulo`, `Materia prima`, `Tramo`, `DIBUJO`, `Ultima modificacion`.
- Produces: `getInspectionDrawingRoutes(article)` → `{ ok, data: Array<{ ARTICULO, MATERIAL, TRAMO, DIBUJO, ACTUALIZADO }> }`.
- Produces: `saveInspectionLink(payload)` preservando la celda DIBUJO cuando `drawing` se omite; sólo la cambia o limpia cuando la propiedad está presente, incluida `drawing: ""`.

- [ ] **Step 1: Escribir la prueba fallida de listado completo**

Agregar a `tests/inspection-service.test.mjs` una prueba que prepare dos artículos y llame sin filtro:

```js
test("lista todo el catalogo de tramos sin filtro y conserva dibujo", () => {
  const context = loadService();
  context.PP_Inspection_routeIndex_ = () => ({
    "A-100|MP-1": {
      ARTICULO: "A-100", MATERIAL: "MP-1", TRAMO: "650 mm",
      DIBUJO: "a100.pdf", ACTUALIZADO: "01/07/2026 08:00:00",
    },
    "B-200|MP-2": {
      ARTICULO: "B-200", MATERIAL: "MP-2", TRAMO: "420 mm",
      DIBUJO: "b200.pdf", ACTUALIZADO: "02/07/2026 09:00:00",
    },
  });

  const result = context.getInspectionDrawingRoutes("");

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.map((row) => ({
    article: row.ARTICULO,
    material: row.MATERIAL,
    route: row.TRAMO,
    drawing: row.DIBUJO,
  })), [
    { article: "A-100", material: "MP-1", route: "650 mm", drawing: "a100.pdf" },
    { article: "B-200", material: "MP-2", route: "420 mm", drawing: "b200.pdf" },
  ]);
});
```

- [ ] **Step 2: Ejecutar la prueba y confirmar el estado inicial**

Run:

```powershell
node --test --test-name-pattern="lista todo el catalogo" tests/inspection-service.test.mjs
```

Expected: la prueba pasa con el contrato actual o falla mostrando una discrepancia real del fixture. No modificar producción hasta observar el resultado.

- [ ] **Step 3: Evitar reconstruir el índice por cada fila**

Reemplazar `getInspectionDrawingRoutes` por una sola lectura:

```js
function getInspectionDrawingRoutes(article) {
  return PP_Inspection_result_(function() {
    const key = PP_normalizeKey_(article);
    const routes = PP_Inspection_routeIndex_();
    return Object.keys(routes)
      .map(function(indexKey) { return routes[indexKey]; })
      .filter(function(row) { return !key || PP_normalizeKey_(row.ARTICULO) === key; });
  });
}
```

- [ ] **Step 4: Ejecutar pruebas del servicio**

Run:

```powershell
node --test tests/inspection-service.test.mjs
```

Expected: todas las pruebas del archivo pasan.

- [ ] **Step 5: Commit**

```powershell
git add src/server/16-inspection-service.js tests/inspection-service.test.mjs
git commit -m "Optimizar catalogo de tramos de inspeccion"
```

---

### Task 2: Lógica pura compartida para el catálogo

**Files:**
- Modify: `src/web/inspection/inspection-core.js`
- Test: `tests/inspection-core.test.mjs`

**Interfaces:**
- Consumes: filas crudas del servicio con claves mayúsculas o camelCase.
- Produces: `inspectionRouteRows(rows)` → filas normalizadas `{ article, material, route, drawing, updated }`.
- Produces: `filterInspectionRouteRows(rows, query)` → filas ordenadas y filtradas.
- Produces: `inspectionRouteSavePayload(row, route)` → `{ article, material, route }`; Catálogos nunca envía un dibujo cacheado.

- [ ] **Step 1: Escribir pruebas fallidas de normalización, búsqueda y payload route-only**

Agregar a `tests/inspection-core.test.mjs`:

```js
test("normaliza y filtra el catalogo de tramos por articulo o material", () => {
  const rows = core.inspectionRouteRows([
    { ARTICULO: "B-200", MATERIAL: "MP-2", TRAMO: "420 mm", DIBUJO: "b.pdf", ACTUALIZADO: "02/07/2026" },
    { article: "A-100", material: "TUBO 1", route: "650 mm", drawing: "a.pdf", updated: "01/07/2026" },
  ]);

  assert.deepEqual(structuredClone(rows.map((row) => row.article)), ["A-100", "B-200"]);
  assert.deepEqual(
    structuredClone(core.filterInspectionRouteRows(rows, "mp-2").map((row) => row.material)),
    ["MP-2"],
  );
  assert.deepEqual(
    structuredClone(core.filterInspectionRouteRows(rows, "a-100").map((row) => row.article)),
    ["A-100"],
  );
});

test("el payload de catalogos envia solo el tramo", () => {
  assert.deepEqual(structuredClone(core.inspectionRouteSavePayload({
    article: "A-100",
    material: "MP-1",
    route: "600 mm",
    drawing: "a100.pdf",
  }, "650 mm")), {
    article: "A-100",
    material: "MP-1",
    route: "650 mm",
  });
});
```

- [ ] **Step 2: Ejecutar las pruebas y verificar que fallen**

Run:

```powershell
node --test --test-name-pattern="catalogo de tramos|payload de catalogos" tests/inspection-core.test.mjs
```

Expected: FAIL porque las tres funciones no existen.

- [ ] **Step 3: Implementar las funciones mínimas**

Agregar antes de la exportación de `InspectionCore`:

```js
function inspectionRouteRows(rows) {
  return (rows || []).map((row) => ({
    article: String(row?.ARTICULO ?? row?.article ?? "").trim(),
    material: String(row?.MATERIAL ?? row?.material ?? "").trim(),
    route: String(row?.TRAMO ?? row?.route ?? "").trim(),
    drawing: String(row?.DIBUJO ?? row?.drawing ?? "").trim(),
    updated: String(row?.ACTUALIZADO ?? row?.updated ?? "").trim(),
  })).filter((row) => row.article && row.material)
    .sort((a, b) => a.article.localeCompare(b.article, "es", { sensitivity: "base" })
      || a.material.localeCompare(b.material, "es", { sensitivity: "base" }));
}

function filterInspectionRouteRows(rows, query) {
  const term = String(query || "").trim().toLocaleLowerCase("es");
  if (!term) return rows || [];
  return (rows || []).filter((row) =>
    `${row.article} ${row.material}`.toLocaleLowerCase("es").includes(term));
}

function inspectionRouteSavePayload(row, route) {
  return {
    article: String(row?.article || "").trim(),
    material: String(row?.material || "").trim(),
    route: String(route || "").trim(),
  };
}
```

Exportar las tres funciones en `root.InspectionCore`.

- [ ] **Step 4: Ejecutar las pruebas del núcleo**

Run:

```powershell
node --test tests/inspection-core.test.mjs
```

Expected: todas las pruebas pasan.

- [ ] **Step 5: Commit**

```powershell
git add src/web/inspection/inspection-core.js tests/inspection-core.test.mjs
git commit -m "Agregar nucleo para catalogo de tramos"
```

---

### Task 3: Sección “Tramos de inspección” en Catálogos

**Files:**
- Modify: `src/web/planning/index.template.html`
- Modify: `src/web/planning/app.js`
- Modify: `src/web/planning/styles.css`
- Test: `tests/build.test.mjs`

**Interfaces:**
- Consumes: `InspectionCore.inspectionRouteRows`, `filterInspectionRouteRows`, `inspectionRouteSavePayload`.
- Consumes: `callAppsScript("getInspectionDrawingRoutes", "")` y `callAppsScript("saveInspectionLink", payload)`.
- Produces: `loadInspectionRouteCatalog()`, `renderInspectionRouteCatalog()`, `editInspectionRoute(index)`.

- [ ] **Step 1: Escribir prueba fallida de integración**

Agregar a `tests/build.test.mjs`:

```js
test("catalogos permite buscar y editar tramos de inspeccion", async () => {
  const template = await readFile(path.join(process.cwd(), "src", "web", "planning", "index.template.html"), "utf8");
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");

  assert.match(template, /id="inspectionRouteCatalogSearch"/);
  assert.match(template, /id="inspectionRouteCatalogTable"/);
  assert.match(app, /callAppsScript\("getInspectionDrawingRoutes",\s*""\)/);
  assert.match(app, /function editInspectionRoute\(index\)/);
  assert.match(app, /InspectionCore\.inspectionRouteSavePayload/);
  assert.match(app, /callAppsScript\("saveInspectionLink",\s*payload\)/);
});
```

- [ ] **Step 2: Ejecutar la prueba y verificar que falle**

Run:

```powershell
node --test --test-name-pattern="catalogos permite buscar" tests/build.test.mjs
```

Expected: FAIL porque la sección y las funciones aún no existen.

- [ ] **Step 3: Agregar la estructura HTML**

En `catalogs-view`, antes de “Objetivo semanal”, insertar:

```html
<div class="config-section inspection-routes-catalog">
  <div class="section-heading">
    <div>
      <h2>Tramos de inspección</h2>
      <span>Valores guardados por artículo y material para la hoja de inspección</span>
    </div>
    <button id="reloadInspectionRoutesBtn" class="button small secondary" type="button">Actualizar</button>
  </div>
  <div class="catalog-search">
    <label>
      <span>Buscar artículo o material</span>
      <input id="inspectionRouteCatalogSearch" type="search" placeholder="Ej. C 590 UADA o MP00098" />
    </label>
  </div>
  <div class="table-wrap config-table">
    <table id="inspectionRouteCatalogTable"></table>
  </div>
</div>
```

- [ ] **Step 4: Registrar elementos y estado**

Agregar a la lista de IDs de `cacheElements()`:

```js
"inspectionRouteCatalogSearch",
"inspectionRouteCatalogTable",
"reloadInspectionRoutesBtn",
```

Agregar estado de módulo cerca de las variables de diálogo:

```js
let inspectionRouteCatalog = [];
let inspectionRouteCatalogLoaded = false;
let inspectionRouteCatalogLoading = false;
```

- [ ] **Step 5: Implementar carga y render**

Agregar:

```js
async function loadInspectionRouteCatalog(force = false) {
  if (inspectionRouteCatalogLoading || (inspectionRouteCatalogLoaded && !force)) return;
  inspectionRouteCatalogLoading = true;
  renderInspectionRouteCatalog();
  try {
    const result = await callAppsScript("getInspectionDrawingRoutes", "");
    if (!result?.ok) throw new Error(result?.error || "No se pudo cargar el catálogo de tramos");
    inspectionRouteCatalog = window.InspectionCore.inspectionRouteRows(result.data || []);
    inspectionRouteCatalogLoaded = true;
  } catch (error) {
    showToast(error.message);
  } finally {
    inspectionRouteCatalogLoading = false;
    renderInspectionRouteCatalog();
  }
}

function renderInspectionRouteCatalog() {
  if (!els.inspectionRouteCatalogTable) return;
  if (inspectionRouteCatalogLoading) {
    els.inspectionRouteCatalogTable.innerHTML = `<tbody>${emptyTableRow(5, "Cargando tramos...")}</tbody>`;
    return;
  }
  const rows = window.InspectionCore.filterInspectionRouteRows(
    inspectionRouteCatalog,
    els.inspectionRouteCatalogSearch?.value,
  );
  const body = rows.map((row) => {
    const index = inspectionRouteCatalog.indexOf(row);
    return `<tr>
      <td><strong>${escapeHtml(row.article)}</strong></td>
      <td>${escapeHtml(row.material)}</td>
      <td>${escapeHtml(row.route || "Sin tramo")}</td>
      <td>${escapeHtml(row.updated || "Sin modificaciones registradas")}</td>
      <td><button class="button small secondary" type="button" data-edit-inspection-route="${index}">Editar</button></td>
    </tr>`;
  }).join("");
  els.inspectionRouteCatalogTable.innerHTML =
    `<thead><tr><th>Artículo</th><th>Material</th><th>Tramo</th><th>Última modificación</th><th></th></tr></thead>
     <tbody>${body || emptyTableRow(5, "No hay tramos que coincidan con la búsqueda")}</tbody>`;
  els.inspectionRouteCatalogTable.querySelectorAll("[data-edit-inspection-route]")
    .forEach((button) => button.addEventListener("click", () => editInspectionRoute(Number(button.dataset.editInspectionRoute))));
}
```

Llamar `loadInspectionRouteCatalog()` cuando `renderConfiguration()` muestre Catálogos.

- [ ] **Step 6: Implementar editor con guardado route-only**

El payload de Catálogos contiene exactamente `article`, `material` y `route`. La preservación de DIBUJO es responsabilidad de `saveInspectionLink`: omitir `drawing` conserva la celda vigente, mientras que enviar la propiedad explícitamente permite cambiarla o limpiarla.

Agregar:

```js
async function editInspectionRoute(index) {
  const row = inspectionRouteCatalog[index];
  if (!row) return;
  const result = await openPlanningDialog({
    title: "Editar tramo",
    summary: `${row.article} · ${row.material}`,
    body: `<div id="inspectionRouteEditForm" class="inspection-route-edit-form">
      <label><span>Artículo</span><input value="${escapeHtml(row.article)}" readonly></label>
      <label><span>Material</span><input value="${escapeHtml(row.material)}" readonly></label>
      <label><span>Tramo</span><input name="route" value="${escapeHtml(row.route)}" placeholder="Ej. 650 mm" autofocus></label>
    </div>`,
    confirmLabel: "Guardar tramo",
  });
  if (!result) return;
  const payload = window.InspectionCore.inspectionRouteSavePayload(row, result.route);
  try {
    const saved = await callAppsScript("saveInspectionLink", payload);
    if (!saved?.ok) throw new Error(saved?.error || "No se pudo guardar el tramo");
    Object.assign(row, {
      route: saved.data?.route ?? payload.route,
      drawing: saved.data?.drawing ?? row.drawing,
      updated: saved.data?.updated ?? row.updated,
    });
    renderInspectionRouteCatalog();
    showToast("Tramo actualizado");
  } catch (error) {
    row.route = payload.route;
    showToast(error.message);
    await editInspectionRoute(index);
  }
}
```

El diálogo existente devuelve `Object.fromEntries(new FormData(els.planningDialogForm).entries())`, por lo que `result.route` contiene el valor antes de cerrar. El bloque `catch` copia el intento en la fila y vuelve a abrir el editor con ese valor.

- [ ] **Step 7: Agregar eventos y estilos**

Registrar:

```js
els.inspectionRouteCatalogSearch?.addEventListener("input", renderInspectionRouteCatalog);
els.reloadInspectionRoutesBtn?.addEventListener("click", () => loadInspectionRouteCatalog(true));
```

Agregar a `styles.css`:

```css
.inspection-routes-catalog .section-heading { align-items: center; }
.catalog-search { max-width: 520px; margin-bottom: 14px; }
.catalog-search label,
.inspection-route-edit-form label { display: grid; gap: 6px; color: var(--muted); font-size: 12px; font-weight: 700; }
.catalog-search input,
.inspection-route-edit-form input { width: 100%; min-height: 40px; border: 1px solid var(--line); border-radius: 8px; padding: 0 12px; background: #fff; color: var(--ink); font: inherit; }
.inspection-route-edit-form { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 8px 0 14px; }
.inspection-route-edit-form label:last-child { grid-column: 1 / -1; }
.inspection-route-edit-form input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); outline: 0; }
@media (max-width: 720px) {
  .inspection-route-edit-form { grid-template-columns: 1fr; }
  .inspection-route-edit-form label:last-child { grid-column: auto; }
}
```

- [ ] **Step 8: Ejecutar prueba focal y build**

Run:

```powershell
node --test --test-name-pattern="catalogos permite buscar" tests/build.test.mjs
npm.cmd run check
```

Expected: prueba focal PASS y “Validacion correcta”.

- [ ] **Step 9: Commit**

```powershell
git add src/web/planning/index.template.html src/web/planning/app.js src/web/planning/styles.css tests/build.test.mjs
git commit -m "Agregar edicion de tramos en catalogos"
```

---

### Task 4: Modal compacto de tramo y dibujo en Hoja de inspección

**Files:**
- Modify: `src/web/planning/index.template.html`
- Modify: `src/web/inspection/inspection-app.js`
- Modify: `src/web/inspection/inspection.css`
- Test: `tests/build.test.mjs`

**Interfaces:**
- Consumes: `InspectionCore.inspectionMaterials`, `operationKey`, `inspectionRouteSavePayload`.
- Consumes: `saveInspectionLink`.
- Produces: diálogo `#inspectionLinkDialog`, `openInspectionLinkDialog()`, `saveInspectionLinks()`.

- [ ] **Step 1: Escribir prueba fallida de estructura y eventos**

Agregar a `tests/build.test.mjs`:

```js
test("hoja de inspeccion usa un editor compacto de dibujo y tramos", async () => {
  const template = await readFile(path.join(process.cwd(), "src", "web", "planning", "index.template.html"), "utf8");
  const app = await readFile(path.join(process.cwd(), "src", "web", "inspection", "inspection-app.js"), "utf8");

  assert.match(template, /id="inspectionLinkDialog"/);
  assert.match(template, /id="inspectionLinkForm"/);
  assert.match(app, /function openInspectionLinkDialog\(\)/);
  assert.match(app, /async function saveInspectionLinks\(\)/);
  assert.doesNotMatch(app, /root\.prompt\("Tramo"/);
  assert.doesNotMatch(app, /root\.prompt\("URL del dibujo"/);
});
```

- [ ] **Step 2: Ejecutar la prueba y verificar que falle**

Run:

```powershell
node --test --test-name-pattern="editor compacto de dibujo" tests/build.test.mjs
```

Expected: FAIL porque el diálogo no existe y todavía se usa `prompt`.

- [ ] **Step 3: Agregar diálogo semántico**

Después de `planningDialog`, agregar:

```html
<dialog id="inspectionLinkDialog" class="inspection-link-dialog" aria-labelledby="inspectionLinkDialogTitle">
  <form id="inspectionLinkForm" method="dialog">
    <header>
      <div>
        <h2 id="inspectionLinkDialogTitle">Editar tramo y dibujo</h2>
        <p id="inspectionLinkDialogSummary"></p>
      </div>
      <button id="inspectionLinkDialogClose" class="dialog-close" type="button" aria-label="Cerrar">&times;</button>
    </header>
    <div id="inspectionLinkDialogBody" class="inspection-link-dialog-body"></div>
    <footer>
      <button id="inspectionLinkDialogCancel" class="button secondary" type="button">Cancelar</button>
      <button id="inspectionLinkDialogSave" class="button primary" type="submit">Guardar tramo/dibujo</button>
    </footer>
  </form>
</dialog>
```

- [ ] **Step 4: Renderizar el formulario compacto**

Reemplazar `editMaterialLink` por:

```js
function openInspectionLinkDialog() {
  const detail = state.detail;
  if (!detail?.workOrder) return;
  const job = detail.workOrder;
  const materials = root.InspectionCore.inspectionMaterials(detail.materials || []);
  byId("inspectionLinkDialogTitle").textContent = `Editar tramo/dibujo · WO ${job.wo || ""}`;
  byId("inspectionLinkDialogSummary").textContent = job.article || "";
  byId("inspectionLinkDialogBody").innerHTML = `
    <section class="inspection-link-summary">
      <strong>${escape(job.article || "-")}</strong>
      <span>El dibujo aplica a toda la OT. Los tramos se guardan por artículo y material.</span>
    </section>
    <section class="inspection-drawing-editor">
      <label><span>Dibujo del artículo</span>
        <input name="drawing" value="${escape(currentDrawing())}" placeholder="Ruta de red, URL o liga de Drive">
      </label>
    </section>
    <div class="inspection-material-editor" role="list">
      ${materials.map((material, index) => `
        <label class="inspection-material-edit-row" role="listitem">
          <span class="inspection-material-identity">
            <strong>${escape(material.material || "-")}</strong>
            <small>${escape(material.description || "")}</small>
          </span>
          <span class="inspection-material-required">${escape(material.required ?? "-")}</span>
          <span class="inspection-material-route">
            <span>Tramo</span>
            <input name="route-${index}" value="${escape(material.route || "")}" placeholder="Ej. 650 mm">
          </span>
        </label>`).join("")}
    </div>`;
  byId("inspectionLinkDialog").showModal();
}
```

- [ ] **Step 5: Guardar sin cerrar al fallar**

Implementar:

```js
async function saveInspectionLinks() {
  const detail = state.detail;
  const dialog = byId("inspectionLinkDialog");
  if (!detail?.workOrder || !dialog) return;
  const materials = root.InspectionCore.inspectionMaterials(detail.materials || []);
  const drawing = dialog.querySelector('[name="drawing"]')?.value.trim() || "";
  byId("inspectionLinkDialogSave").disabled = true;
  try {
    for (let index = 0; index < materials.length; index += 1) {
      const material = materials[index];
      const route = dialog.querySelector(`[name="route-${index}"]`)?.value || "";
      const result = await call("saveInspectionLink", {
        article: detail.workOrder.article,
        material: material.material,
        route,
        drawing: index === 0 ? drawing : (material.drawing || drawing),
      });
      if (!result?.ok) throw new Error(result?.error || `No se pudo guardar ${material.material}`);
      material.route = route.trim();
      material.drawing = result.data?.drawing || material.drawing;
    }
    detail.workOrder.drawing = drawing;
    dialog.close();
    renderDetail();
  } catch (error) {
    reportError(error);
  } finally {
    byId("inspectionLinkDialogSave").disabled = false;
  }
}
```

La implementación debe evitar escrituras innecesarias comparando valores iniciales y finales antes de cada llamada.

- [ ] **Step 6: Conectar eventos y eliminar prompts**

Registrar:

```js
byId("inspectionEditLink").addEventListener("click", openInspectionLinkDialog);
byId("inspectionLinkDialogClose").addEventListener("click", () => byId("inspectionLinkDialog").close());
byId("inspectionLinkDialogCancel").addEventListener("click", () => byId("inspectionLinkDialog").close());
byId("inspectionLinkForm").addEventListener("submit", (event) => {
  event.preventDefault();
  saveInspectionLinks();
});
```

Eliminar `editMaterialLink(index)` y `firstInspectionMaterialIndex()`.

- [ ] **Step 7: Implementar estilos de escritorio y adaptación estrecha**

Agregar a `inspection.css`:

```css
.inspection-link-dialog { width: min(1100px, calc(100vw - 48px)); max-width: none; max-height: min(820px, calc(100vh - 48px)); padding: 0; overflow: hidden; border: 0; border-radius: 14px; background: #fff; box-shadow: 0 24px 70px rgba(15,23,42,.28); }
.inspection-link-dialog::backdrop { background: rgba(15,23,42,.48); backdrop-filter: blur(2px); }
.inspection-link-dialog form { display: flex; max-height: inherit; flex-direction: column; }
.inspection-link-dialog header { display: flex; align-items: flex-start; justify-content: space-between; padding: 18px 22px; border-bottom: 1px solid #dbe3ea; }
.inspection-link-dialog h2 { margin: 0; color: #102a43; font-size: 18px; }
.inspection-link-dialog header p { margin: 4px 0 0; color: #627d98; font-size: 12px; }
.inspection-link-dialog-body { overflow: auto; padding: 18px 22px; }
.inspection-link-summary { display: grid; grid-template-columns: minmax(180px, .35fr) 1fr; gap: 20px; align-items: center; padding: 12px 14px; border: 1px solid #dbeafe; border-radius: 10px; background: #f8fbff; }
.inspection-link-summary span { color: #486581; font-size: 12px; }
.inspection-drawing-editor { margin-top: 16px; padding-bottom: 16px; border-bottom: 1px solid #e5eaf0; }
.inspection-drawing-editor label,
.inspection-material-route { display: grid; gap: 6px; color: #486581; font-size: 11px; font-weight: 800; }
.inspection-link-dialog input { width: 100%; min-height: 40px; border: 1px solid #bcccdc; border-radius: 8px; padding: 0 11px; background: #fff; color: #102a43; font: inherit; }
.inspection-link-dialog input:focus { border-color: #0f8f84; box-shadow: 0 0 0 3px rgba(15,143,132,.16); outline: 0; }
.inspection-material-editor { margin-top: 4px; }
.inspection-material-edit-row { display: grid; grid-template-columns: minmax(280px, 1fr) 100px minmax(220px, 320px); gap: 18px; align-items: center; padding: 12px 4px; border-bottom: 1px solid #edf1f5; }
.inspection-material-identity { display: grid; gap: 3px; min-width: 0; }
.inspection-material-identity strong { color: #102a43; font-size: 13px; }
.inspection-material-identity small { overflow: hidden; color: #627d98; text-overflow: ellipsis; white-space: nowrap; }
.inspection-material-required { justify-self: center; color: #102a43; font-weight: 800; }
.inspection-link-dialog footer { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 22px; border-top: 1px solid #dbe3ea; background: #f7f9fb; }
@media (max-width: 760px) {
  .inspection-link-dialog { width: calc(100vw - 20px); max-height: calc(100vh - 20px); }
  .inspection-link-summary,
  .inspection-material-edit-row { grid-template-columns: 1fr; gap: 8px; }
  .inspection-material-required { justify-self: start; }
}
```

- [ ] **Step 8: Ejecutar pruebas focales y suite completa**

Run:

```powershell
node --test --test-name-pattern="editor compacto de dibujo" tests/build.test.mjs
npm.cmd test
npm.cmd run check
git diff --check
```

Expected: prueba focal PASS, suite completa sin fallos, “Validacion correcta” y `git diff --check` sin errores.

- [ ] **Step 9: Verificación visual**

Iniciar:

```powershell
npm.cmd run preview:pages
```

Verificar a 1440×900 y 720×900:

- el modal permanece centrado;
- encabezado y pie siguen visibles al desplazar materiales;
- no hay recortes horizontales en escritorio;
- el formulario se apila en ventana estrecha;
- `Escape`, Cancelar y cerrar funcionan;
- un error simulado conserva el valor escrito;
- búsqueda y edición de Catálogos actualizan la fila.

- [ ] **Step 10: Commit**

```powershell
git add src/web/planning/index.template.html src/web/inspection/inspection-app.js src/web/inspection/inspection.css tests/build.test.mjs
git commit -m "Redisenar editor de tramos de inspeccion"
```

---

### Task 5: Revisión final integrada

**Files:**
- Review only: all files changed in Tasks 1–4.

**Interfaces:**
- Consumes: servicio, núcleo y UI terminados.
- Produces: evidencia final de pruebas y revisión visual.

- [ ] **Step 1: Ejecutar verificación limpia**

```powershell
npm.cmd test
npm.cmd run check
git diff --check HEAD~4
```

Expected: 0 fallos, validación correcta y ningún error de espacios.

- [ ] **Step 2: Revisar alcance**

Confirmar en el diff:

- no existe eliminación de tramos;
- Catálogos no edita dibujos;
- la hoja imprimible no cambió;
- no se agregaron dependencias;
- los payloads de Catálogos omiten `drawing` y el servidor preserva DIBUJO cuando la propiedad no existe;
- los cambios locales previos ajenos al plan no fueron incluidos.

- [ ] **Step 3: Preparar revisión**

```powershell
git status --short
git log -5 --oneline
```

Expected: los commits del plan aparecen separados y cualquier cambio previo del usuario permanece identificado.
