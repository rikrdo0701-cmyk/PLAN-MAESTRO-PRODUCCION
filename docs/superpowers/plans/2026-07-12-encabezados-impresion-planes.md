# Encabezados compactos de impresión Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplificar la impresión individual de planes diarios y semanal con encabezado corporativo compacto, tablas centradas y sin resumen global.

**Architecture:** Cada bloque imprimible incluirá un encabezado reutilizable con logo, título y metadatos. La función de impresión actualizará la fecha y activará una clase de documento que permitirá a CSS mostrar solo el reporte seleccionado, sin tocar la ruta independiente de Generar PDF.

**Tech Stack:** HTML, CSS de impresión, JavaScript sin framework, Node.js test runner y build estático.

## Global Constraints

- Código fijo: `MP CD 28-02 V02`.
- Título diario: `PLAN DE PRODUCCIÓN DIARIO INDIVIDUAL`.
- Título semanal: `PLAN DE PRODUCCIÓN SEMANAL`.
- Máximo 25 filas y formato A4.
- Generar PDF conserva resumen, alertas y métricas.

---

### Task 1: Encabezado reutilizable

**Files:**
- Modify: `src/web/planning/app.js`
- Test: `tests/build.test.mjs`

**Interfaces:**
- Produces: `printPlanHeader(title)` y elementos `.individual-print-header`, `.individual-print-code`, `.individual-print-date`.

- [ ] Escribir pruebas que exijan los títulos, logo, código y fecha.
- [ ] Ejecutar `node --test tests/build.test.mjs` y confirmar fallo.
- [ ] Implementar:

```js
function printPlanHeader(title) {
  return `<header class="individual-print-header">
    <strong class="individual-print-logo">MALDONADO</strong>
    <h2>${escapeHtml(title)}</h2>
    <div><small class="individual-print-code">MP CD 28-02 V02</small><strong class="individual-print-date"></strong></div>
  </header>`;
}
```

- [ ] Insertarlo en Plan semanal, operador, ajustador y subcontratos.
- [ ] Ejecutar la prueba y confirmar éxito.

### Task 2: Actualización y aislamiento de impresión

**Files:**
- Modify: `src/web/planning/app.js`
- Test: `tests/build.test.mjs`

**Interfaces:**
- Produces: `prepareIndividualPrint(target)` y clase corporal `printing-individual-plan`.

- [ ] Escribir prueba para actualización de `.individual-print-date` y confirmar fallo.
- [ ] Implementar fecha con `formatDateTime(new Date())` antes de `window.print()`.
- [ ] Asegurar que la clase se retire después de imprimir.
- [ ] Verificar que `generatePdf()` y su contenido ejecutivo no cambien.

### Task 3: CSS A4 centrado y ocultamiento

**Files:**
- Modify: `src/web/planning/styles.css`
- Test: `tests/build.test.mjs`

**Interfaces:**
- Consumes: `.individual-print-header`, `.printing-individual-plan`, `.print-target`.

- [ ] Añadir pruebas para grid de tres columnas, centrado de `th/td` y ocultamiento del resumen.
- [ ] Confirmar fallo con `node --test tests/build.test.mjs`.
- [ ] Implementar estilos de pantalla mínimos y `@media print`:

```css
.individual-print-header { display: none; }
@media print {
  body.printing-individual-plan .individual-print-header { display: grid; grid-template-columns: 1fr 2fr 1fr; }
  body.printing-individual-plan .summary-strip,
  body.printing-individual-plan .plan-alerts,
  body.printing-individual-plan .draft-executive,
  body.printing-individual-plan .report-toolbar { display: none !important; }
  body.printing-individual-plan .report-table th,
  body.printing-individual-plan .report-table td { text-align: center; }
}
```

- [ ] Ejecutar `npm test`, `npm run build` y `git diff --check`.
- [ ] Verificar en navegador impresión semanal y diaria, y confirmar que Generar PDF conserva el resumen.

