# Hoja de inspección Replica Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replicar el módulo original de Hoja de inspección y su impresión MP FO 08 V23, agregando selección temporal y compacta de operaciones.

**Architecture:** Mantener el módulo aislado en `src/web/inspection`: funciones puras de distribución en `inspection-core.js`, renderizado y eventos en `inspection-app.js`, y fidelidad visual en `inspection.css`. El servidor existente sigue entregando OTs, materiales, operaciones, dibujos e historial; no se modifica el motor de planeación.

**Tech Stack:** JavaScript ES2020, HTML, CSS de impresión, Node.js `node:test`, Apps Script, GitHub Pages.

## Global Constraints

- Replicar el panel lateral y el documento impreso del módulo original ubicado en `nesesidades prod`.
- Conservar `Cargar`, `Ver dibujo`, `Editar liga` e `Imprimir`; integrar `Seleccionar operaciones` con el mismo lenguaje visual.
- La selección es temporal, inicia con todas las operaciones de NetSuite y se reinicia al cambiar o recargar la OT.
- Las operaciones ocultas no dejan filas intermedias; las filas libres aparecen después de la última operación visible.
- La impresión debe caber en una sola hoja horizontal MP FO 08 V23.
- No modificar Gantt, motor, planes ni reportes.

---

### Task 1: Distribución compacta de operaciones

**Files:**
- Modify: `src/web/inspection/inspection-core.js`
- Modify: `tests/inspection-core.test.mjs`

**Interfaces:**
- Consumes: operaciones `{id, code, operation, workCenter}` y mapa `{[operationKey]: boolean}`.
- Produces: `operationKey(operation, index)`, `initialOperationSelection(operations)`, `printableOperations(operations, selection)` y `inspectionRows(operations, selection, minimumRows)`.

- [ ] **Step 1: Escribir pruebas fallidas de claves estables y filas compactas**

```js
test("compacta operaciones visibles y agrega vacias solamente al final", () => {
  const operations = [{ id: "a", code: "10C" }, { id: "b", code: "20C" }, { id: "c", code: "30C" }];
  const rows = core.inspectionRows(operations, { a: true, b: false, c: true }, 4);
  assert.deepEqual(structuredClone(rows).map((row) => row.operation?.code || ""), ["10C", "30C", "", ""]);
});

test("reiniciar seleccion incluye todas las operaciones", () => {
  assert.deepEqual(structuredClone(core.initialOperationSelection([{ id: "x" }, { code: "20C" }])), { x: true, "20C": true });
});
```

- [ ] **Step 2: Ejecutar la prueba y comprobar el fallo**

Run: `node --test tests/inspection-core.test.mjs`
Expected: FAIL con `core.inspectionRows is not a function`.

- [ ] **Step 3: Implementar la distribución mínima**

```js
function operationKey(operation, index) {
  return String(operation?.id || operation?.code || index);
}
function inspectionRows(operations, selection, minimumRows) {
  const visible = printableOperations(operations, selection).map((operation) => ({ operation }));
  while (visible.length < minimumRows) visible.push({ operation: null });
  return visible;
}
root.InspectionCore = { operationKey, initialOperationSelection, printableOperations, inspectionRows };
```

- [ ] **Step 4: Ejecutar prueba y suite completa**

Run: `node --test tests/inspection-core.test.mjs && npm.cmd test`
Expected: todas las pruebas PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/inspection/inspection-core.js tests/inspection-core.test.mjs
git commit -m "Probar filas compactas de inspeccion"
```

### Task 2: Replicar estructura del panel y documento

**Files:**
- Modify: `src/web/planning/index.template.html:404`
- Modify: `src/web/inspection/inspection-app.js`

**Interfaces:**
- Consumes: `getInspectionWorkOrders`, `getInspectionWorkOrder`, `getInspectionHistory`, `getInspectionDrawingRoutes`, `saveInspectionLink`, `recordInspectionPrint`.
- Produces: panel original, semáforo `ok|warn|block`, selector temporal y cuadrícula MP FO 08 V23.

- [ ] **Step 1: Añadir una prueba estructural fallida al build**

En `tests/build.test.mjs`, comprobar:

```js
assert.match(site, /id="inspectionPrintCheck"/);
assert.match(site, /id="inspectionSecondCapture"/);
assert.match(site, /id="inspectionReleaseFooter"/);
assert.match(site, /MP FO 08 V23/);
```

- [ ] **Step 2: Ejecutar la prueba y comprobar el fallo**

Run: `node --test tests/build.test.mjs`
Expected: FAIL porque faltan los nuevos identificadores.

- [ ] **Step 3: Sustituir la plantilla simplificada por la estructura original**

Construir dentro de `#hoja-inspeccion`:

```html
<aside class="inspection-controls">
  <h2 id="inspectionTitle">Hoja Inspec</h2>
  <p>Selecciona una WO para generar la hoja de inspección con materiales, tramos, operaciones y dibujo ligado.</p>
  <label>TRABAJO WO<select id="inspectionWorkOrder"></select></label>
  <label>BUSCAR WO<input id="inspectionSearch" placeholder="Ej. 28, CM 350"></label>
  <section id="inspectionJobStatus" class="inspection-side-card"></section>
  <section id="inspectionHistory" class="inspection-side-card"></section>
  <section id="inspectionPrintCheck" class="inspection-side-card"></section>
  <div class="inspection-actions">
    <button id="inspectionReload">Cargar</button><button id="inspectionDrawing">Ver dibujo</button>
    <button id="inspectionEditLink">Editar liga</button><button id="inspectionPrint">Imprimir</button>
    <button id="inspectionSelectOps">Seleccionar operaciones</button>
  </div>
  <div id="inspectionOperationChoices" hidden></div>
</aside>
<article id="inspectionDocument" class="inspection-sheet">
  <div class="inspection-grid" id="inspectionSheetGrid"></div>
  <section id="inspectionSecondCapture"></section>
  <footer id="inspectionReleaseFooter"></footer>
</article>
```

- [ ] **Step 4: Portar renderizado original y conectar selección**

Usar `InspectionCore.inspectionRows(detail.operations, state.selection, 16)`. Al cambiar `inspectionWorkOrder` o ejecutar `loadDetail`, reemplazar `state.selection` con `initialOperationSelection(detail.operations)`. Renderizar materiales, encabezados y los 18 campos productivos del formato original; el botón de selección solamente alterna las casillas.

- [ ] **Step 5: Ejecutar pruebas y validación**

Run: `node --test tests/build.test.mjs tests/inspection-core.test.mjs && npm.cmd run check`
Expected: PASS y mensaje `Validacion correcta`.

- [ ] **Step 6: Commit**

```bash
git add src/web/planning/index.template.html src/web/inspection/inspection-app.js tests/build.test.mjs
git commit -m "Replicar estructura de hoja de inspeccion"
```

### Task 3: Fidelidad visual e impresión horizontal

**Files:**
- Modify: `src/web/inspection/inspection.css`
- Reference: `nesesidades prod/index.html:247-401`
- Reference: `C:/Users/plane/Documents/Necesidades de Produccion.pdf`

**Interfaces:**
- Consumes: clases e identificadores creados en Task 2.
- Produces: panel lateral original y una hoja horizontal escalada mediante `--inspection-print-scale`.

- [ ] **Step 1: Portar estilos de pantalla del panel original**

Replicar tarjetas, tipografía, radios, colores y cuadrícula de botones de la captura; mantener el área del documento desplazable sin reducir la hoja en pantalla.

- [ ] **Step 2: Portar cuadrícula y proporciones del documento original**

Usar bordes negros de `1px/1.5px`, celdas compactas, columnas equivalentes y encabezados agrupados para setup, inactividad y producción. No usar la tabla simplificada de nueve columnas.

- [ ] **Step 3: Portar reglas de impresión**

```css
@page { size: landscape; margin: 3mm 8mm 5mm 9mm; }
@media print {
  body.printing-inspection .sidebar,
  body.printing-inspection .topbar,
  body.printing-inspection .inspection-controls { display: none !important; }
  body.printing-inspection .inspection-document-wrap { position: fixed; inset: 0; padding: 0; overflow: hidden; }
  body.printing-inspection .inspection-sheet {
    width: calc(100% / var(--inspection-print-scale, 1));
    transform: scale(var(--inspection-print-scale, 1));
    transform-origin: top left;
    box-shadow: none;
  }
}
```

- [ ] **Step 4: Añadir cálculo de escala antes de imprimir**

En `inspection-app.js`, medir `scrollWidth/scrollHeight` contra el área imprimible, limitar la escala a `Math.min(1, widthRatio, heightRatio)`, asignar `--inspection-print-scale` y retirarla en `afterprint`.

- [ ] **Step 5: Generar PDF y comparar visualmente**

Abrir `#hoja-inspeccion`, cargar una OT con materiales y al menos diez operaciones, ocultar dos operaciones intermedias, imprimir a PDF y renderizar:

```powershell
pdftoppm -png -f 1 -singlefile output/pdf/hoja-inspeccion.pdf tmp/pdfs/hoja-inspeccion
```

Expected: una página horizontal; bloques completos; operaciones visibles contiguas; sin texto cortado, solapamientos ni filas intermedias vacías.

- [ ] **Step 6: Commit**

```bash
git add src/web/inspection/inspection.css src/web/inspection/inspection-app.js
git commit -m "Replicar impresion MP FO 08 V23"
```

### Task 4: QA integral y publicación

**Files:**
- Modify only if QA finds a defect: `src/web/inspection/inspection-app.js`, `src/web/inspection/inspection.css`, `src/web/planning/index.template.html`, `tests/inspection-core.test.mjs`, `tests/build.test.mjs`

**Interfaces:**
- Consumes: implementación completa de Tasks 1-3.
- Produces: evidencia de navegador, PDF verificado y despliegue público.

- [ ] **Step 1: Ejecutar suite completa**

Run: `npm.cmd test && npm.cmd run check`
Expected: cero fallos y `Validacion correcta`.

- [ ] **Step 2: QA de navegador**

Flujo: abrir Hoja de inspección → seleccionar OT → Cargar → abrir selección → ocultar operación intermedia → confirmar cuadrícula compacta → Ver dibujo → cerrar/editar liga sin guardar → Imprimir. Revisar identidad, DOM no vacío, consola, captura y cambio visible tras la interacción.

- [ ] **Step 3: QA visual del PDF**

Comparar PNG del resultado con `tmp/pdfs/necesidades-reference.png`; corregir únicamente diferencias de estructura, proporción, corte o legibilidad. Confirmar una página con `pdfinfo output/pdf/hoja-inspeccion.pdf`.

- [ ] **Step 4: Commit final si QA exigió ajustes**

```bash
git add src/web/inspection src/web/planning/index.template.html tests
git commit -m "Ajustar fidelidad de hoja de inspeccion"
```

- [ ] **Step 5: Publicar y comprobar producción**

```bash
git push origin main
```

Expected: workflows de validación, Apps Script y GitHub Pages en `success`; la vista pública carga sin errores y conserva la selección temporal.
