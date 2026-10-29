# Limpieza del borrador, reportes y doblado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Respaldar y reconstruir el borrador sin datos antiguos, corregir reportes diarios e impedir que doblado desaparezca.

**Architecture:** Primero se corrige y prueba el código; después se crea un respaldo completo de Sheets y se limpian solo tablas/campos transaccionales. La resincronización final reconstruye OTs/operaciones, mientras configuraciones e históricos permanecen intactos.

**Tech Stack:** JavaScript, Google Sheets/Drive, Apps Script, NetSuite RESTlets, Node tests, GitHub Pages.

## Global Constraints

- Ninguna limpieza sin copia de respaldo confirmada.
- No modificar catálogos, configuraciones ni `PLANES_HISTORICOS`.
- Borrador visible limitado a `selectedOts`.
- Comentarios editables solo en borrador; Completado oculto solo al imprimir.

---

### Task 1: Coherencia visible del borrador

**Files:**
- Modify: `src/web/planning/planning-workflow-core.js`
- Modify: `src/web/planning/app.js`
- Test: `tests/planning-workflow-core.test.mjs`

**Interfaces:**
- Produces: `draftScheduledOperations(state)` y `draftReportOperations(state)` filtradas por `selectedOts`.

- [ ] Escribir pruebas fallidas con operaciones seleccionadas, backlog, históricas y completadas.
- [ ] Ejecutar `node --test tests/planning-workflow-core.test.mjs`; esperar FAIL.
- [ ] Implementar helpers y usarlos en Gantt, KPI, cargas y reportes del borrador.
- [ ] Repetir pruebas; esperar PASS.
- [ ] Commit `fix: scope every draft projection to selected jobs`.

### Task 2: Reporte editable e impresión

**Files:**
- Modify: `src/web/planning/app.js`
- Modify: `src/web/planning/styles.css`
- Test: `tests/build.test.mjs`

**Interfaces:**
- Produce clase `report-status-action-column` y editor de comentario persistente en borrador.

- [ ] Añadir prueba fallida para input editable en borrador, texto fijo publicado y CSS `@media print` que oculte encabezado/celdas de estado.
- [ ] Ejecutar build test; esperar FAIL.
- [ ] Implementar clases en encabezados/celdas y persistencia de comentario; ocultar columna completa al imprimir.
- [ ] Ejecutar build test; esperar PASS.
- [ ] Commit `fix: print daily plans without completion actions`.

### Task 3: Doblado sincronizado sin descarte

**Files:**
- Modify: `src/web/planning/planner-core.js`
- Modify: `src/web/planning/app.js`
- Test: `tests/planner-core.test.mjs`

**Interfaces:**
- Produce operación doblado programada, cambio completo o diagnóstico `MISSING_MACHINE|MISSING_TOOL|MISSING_KIT|MISSING_ADJUSTER`.

- [ ] Crear fixture fallido basado en CT 5459 de Sheets con máquina/herramental/kit vacíos.
- [ ] Ejecutar planner test; comprobar que falla por descarte/diagnóstico insuficiente.
- [ ] Conservar operación `UNSCHEDULED`, solicitar preparación precargada y generar cambio cuando se completa configuración.
- [ ] Ejecutar pruebas; esperar ambos doblados y cambio o diagnóstico exacto.
- [ ] Commit `fix: retain synchronized bending operations`.

### Task 4: Respaldo y limpieza transaccional de PLANDATA

**Files:**
- External: Google Sheet `1iLG8aRuVPhYQ9e-1SVrD79k22ZV5zo111MIC08hF8D0`.

**Interfaces:**
- Consumes: código aprobado de Tasks 1–3.

- [ ] Crear copia completa `PLANDATA - respaldo antes de limpieza <fecha-hora>` y verificar URL/ID distinto.
- [ ] Registrar conteos de configuraciones, catálogos e históricos antes de limpiar.
- [ ] Vaciar filas de datos de `OPERACIONES`, `MATERIALES`, `ESTADOS_OPERACION_PLAN` conservando encabezados.
- [ ] Restablecer en `CONFIG` solo `selectedOts=[]`, `lockedOts=[]`, `expandedOts=[]`, `lastSchedule={}`, `draftVersionId=""` y programación temporal.
- [ ] Volver a leer rangos y comprobar tablas transaccionales vacías y conteos preservados.

### Task 5: Resincronizar, verificar y publicar

**Files:**
- Test: `tests/*.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–4.

- [ ] Ejecutar suite, build, `node --check` y `git diff --check`; esperar cero errores.
- [ ] Publicar código en `main` y esperar GitHub Pages.
- [ ] Pulsar Sincronizar; verificar OTs/operaciones vigentes y ausencia de programación anterior.
- [ ] Probar borrador, comentario, impresión y escenario de doblado.
- [ ] Confirmar consola limpia y `main...origin/main` sin cambios.

## Self-review

- Respaldo obligatorio precede a toda limpieza.
- La limpieza enumera exactamente tablas/campos permitidos.
- Código, datos externos y QA están separados en tareas verificables.
