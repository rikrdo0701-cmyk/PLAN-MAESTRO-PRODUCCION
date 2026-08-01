# OT Performance Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Acelerar agregar y editar OTs mediante precarga/caché, render parcial y desplazamiento estable.

**Architecture:** Reutilizar el cargador individual existente y agregarle una cola priorizada con caché temporal. Mantener los estados operativos fuera de esa caché y actualizar solo la fila editada. Separar navegación manual de reaplicación de vista en segundo plano.

**Tech Stack:** JavaScript, Google Apps Script bridge, Node.js test runner.

## Global Constraints

- Precargar 5 OTs recientes, concurrencia máxima 2, caché 10 minutos.
- Búsqueda exacta tiene prioridad; caché y promesas se comparten entre detalle y agregado.
- Consulta no precargada vence en 30 segundos, libera tarjeta y permite reintentar.
- Completar/reabrir actualiza solo la fila y revierte ante error.
- Actualizaciones de fondo preservan scroll; navegación manual inicia arriba.
- No tocar el Apps Script protegido `1ew3Nqi0e8SHid_zWv1z5cl6ATCZzqVLqc2lkbfox5CMNsh8FH5tL8zKx`.

---

### Task 1: Precarga, caché y feedback

**Files:**
- Modify: `src/web/planning/app.js`
- Modify: `src/web/shared/performance-client.js`
- Test: `tests/performance-client-calls.test.mjs`

**Interfaces:** Produce `prefetchRecentPlanningWorkOrders`, prioridad exacta y estados visibles de `individualPlanningActions`.

- [ ] Agregar pruebas fallidas que ejecuten: cinco OTs recientes, concurrencia 2, prioridad exacta, TTL 10 minutos, promesa compartida, timeout 30 segundos y reintento.
- [ ] Ejecutar `node --test tests/performance-client-calls.test.mjs`; esperar fallos nuevos.
- [ ] Implementar constantes `5`, `2`, `10 * 60 * 1000` y `30 * 1000`; reutilizar `ensureWorkOrderPlanningData` sin llamadas duplicadas.
- [ ] Renderizar en la tarjeta `Cargando`, `Guardando`, `Guardado` o `Error`; capturar el flujo completo de `selectJob` y mostrar errores inesperados.
- [ ] Ejecutar prueba focalizada; esperar PASS.
- [ ] Commit: `perf: prefetch recent work order routes`.

### Task 2: Edición de operación por fila

**Files:**
- Modify: `src/web/planning/app.js`
- Modify: `src/web/shared/performance-client.js`
- Test: `tests/performance-client-calls.test.mjs`

**Interfaces:** Conserva `saveOperationPlanStatus`; produce actualización optimista y reversión localizada.

- [ ] Agregar pruebas fallidas: clic actualiza una fila sin `render()`, guarda atómicamente, confirma en segundo plano y revierte solo esa fila ante error.
- [ ] Ejecutar la prueba focalizada; esperar fallos por render amplio o falta de reversión localizada.
- [ ] Aplicar el estado local inmediatamente, renderizar la fila/detalle afectado y diferir resumen/alertas/cargas mediante trabajo ocioso ya existente.
- [ ] Mantener fotografías con carga diferida nativa y eliminar animación suave de estos estados.
- [ ] Ejecutar prueba focalizada; esperar PASS.
- [ ] Commit: `perf: update operation completion locally`.

### Task 3: Desplazamiento estable y artefactos

**Files:**
- Modify: `src/web/planning/app.js`
- Modify: `src/web/shared/performance-client.js`
- Modify: `scripts/build-appscript.mjs`
- Test: `tests/build.test.mjs`
- Test: `tests/performance-client-calls.test.mjs`

**Interfaces:** `showWorkspaceView(section, tab, { scrollToTop })`, con `true` solo para navegación manual.

- [ ] Agregar pruebas fallidas para navegación manual a `top: 0` y carga remota tardía sin `scrollTo` en cliente base, optimizado y generado.
- [ ] Ejecutar pruebas focalizadas; esperar que la carga de fondo todavía desplace arriba.
- [ ] Pasar `{ scrollToTop: false }` en reaplicaciones de fondo; conservar `true` en clic/hash manual.
- [ ] Ejecutar `node --test tests/build.test.mjs tests/performance-client-calls.test.mjs`; esperar PASS.
- [ ] Ejecutar `npm.cmd test`, `npm.cmd run check` y `git diff --check`; esperar cero fallos.
- [ ] Commit: `fix: preserve scroll during background updates`.
