# Flow-Balanced Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reducir el tiempo en proceso de cada OT y aprovechar mejor los recursos, sin alterar las restricciones ni degradar el resultado actual.

**Architecture:** Agregar `flow_balanced` como una evaluación opcional y aislada. El motor conserva sus estrategias actuales y sólo selecciona la nueva cuando su puntuación común es estrictamente mejor; ante empate, error o desactivación conserva el resultado anterior.

**Tech Stack:** JavaScript ES modules, Node test runner, HTML/CSS, Apps Script build.

## Global Constraints

- No modificar el Apps Script `1ew3Nqi0e8SHid_zWv1z5cl6ATCZzqVLqc2lkbfox5CMNsh8FH5tL8zKx`.
- Preservar precedencias, calendarios, capacidades, solapamientos, operaciones bloqueadas/completadas, exclusiones, habilidades, máquinas, herramientas, kits y subcontrato.
- `flowBalancedEnabled` predeterminado `true`; `flowWipTarget` predeterminado `10`, rango 1–50.
- Máximo una evaluación adicional por generación. Empates favorecen la estrategia existente.
- No agregar OTs automáticamente desde Backlog.

---

### Task 1: Métricas comunes y protección de regresión

**Files:**
- Modify: `src/web/planning/planner-core.js`
- Test: `tests/planner-core.test.mjs`

- [ ] Añadir primero pruebas que verifiquen: métricas finitas; `flowBalancedEnabled:false` produce las mismas operaciones/fechas/recursos que antes; un empate conserva la estrategia existente.
- [ ] Ejecutar `node --test tests/planner-core.test.mjs`; esperar fallo por campos/ajustes inexistentes.
- [ ] Extraer métricas puras desde `evaluatePlan(state)`: tardanza ponderada, flujo promedio por OT (`fin último - inicio primero`), huecos evitables, cambios de herramienta, WIP máximo y utilización por recurso. Mantener conflictos y no programadas como penalizaciones duras.
- [ ] Calcular una puntuación comparable y determinista: 45% tardanza, 30% flujo, 15% huecos, 10% cambios; normalizar cada término con denominadores compartidos entre candidatos, no por candidato.
- [ ] Ordenar por restricciones duras, luego puntuación; usar el orden original como desempate.
- [ ] Ejecutar la prueba focal y confirmar éxito.
- [ ] Commit: `git commit -m "test: protect planner strategy selection"`

### Task 2: Estrategia `flow_balanced`

**Files:**
- Modify: `src/web/planning/planner-core.js`
- Test: `tests/planner-core.test.mjs`

- [ ] Crear fixtures fallidos para: menor flujo promedio/WIP; apertura de otra OT cuando ninguna activa tiene operación elegible; reparto entre operadores equivalentes; operación sin tiempo mantiene fallback existente; precedencia y bloqueos intactos.
- [ ] Ejecutar `node --test tests/planner-core.test.mjs`; esperar que `flow_balanced` aún no exista.
- [ ] Añadirla al conjunto sólo si está habilitada y sin superar una evaluación adicional.
- [ ] En `compareReadyCandidates`, priorizar en orden: menor holgura/atraso, OT activa más próxima a terminar, mayor trabajo sucesor desbloqueado, encaje en hueco sin retrasar una OT más urgente y menor cambio de herramienta.
- [ ] Aplicar WIP flexible: favorecer OTs activas hasta `flowWipTarget`; permitir abrir otra si ninguna activa es elegible. Definir OT activa como iniciada/programada y aún no terminada.
- [ ] En `compareAssignments`, elegir el recurso equivalente con menor carga proyectada, respetando rendimiento, categoría, disponibilidad, matriz y máquina.
- [ ] Encapsular la evaluación nueva en `try/catch`; si falla, excluirla y continuar con las actuales.
- [ ] Ejecutar prueba focal y confirmar que todos los casos pasan.
- [ ] Commit: `git commit -m "feat: add flow balanced scheduling strategy"`

### Task 3: Configuración y diagnóstico visible

**Files:**
- Modify: `src/web/planning/app.js`
- Modify: `src/web/planning/index.template.html`
- Test: `tests/build.test.mjs`

- [ ] Añadir pruebas de fuente/build para el interruptor, WIP 1–50, valores predeterminados y texto de estrategia/métricas.
- [ ] Ejecutar `node --test tests/build.test.mjs`; esperar fallo por controles ausentes.
- [ ] Normalizar `state.settings.flowBalancedEnabled` y `flowWipTarget`; reutilizar la persistencia existente de `settings`.
- [ ] Agregar controles compactos en Configuración y enlazarlos sin renderizados globales innecesarios.
- [ ] Mostrar tras generar: estrategia elegida, flujo promedio, WIP máximo, huecos evitables, cambios de herramienta y utilización. No cambiar la vista del programa.
- [ ] Ejecutar `node scripts/build-appscript.mjs` y luego `node --test tests/build.test.mjs`.
- [ ] Commit: `git commit -m "feat: expose flow balance settings and metrics"`

### Task 4: Validación integral, rendimiento y reversión

**Files:**
- Modify only if a failing test proves necessary: `src/web/planning/planner-core.js`, `src/web/planning/app.js`
- Test: `tests/planner-core.test.mjs`, `tests/build.test.mjs`

- [ ] Añadir una prueba que cuente estrategias: habilitado = como máximo una adicional; deshabilitado = conjunto anterior exacto.
- [ ] Añadir regresiones para subcontrato, exclusiones, operaciones completadas/bloqueadas, calendarios, máquinas, herramientas y capacidad finita/no finita.
- [ ] Comparar fixture representativo: la nueva estrategia sólo gana con puntuación estrictamente menor y sin más conflictos/no programadas.
- [ ] Ejecutar `node --test tests/planner-core.test.mjs tests/build.test.mjs`.
- [ ] Ejecutar `npm.cmd test`, `npm.cmd run check` y `git diff --check`; corregir sólo fallos relacionados.
- [ ] Registrar en `lastSchedule.optimization` estrategias evaluadas, selección y métricas para auditoría/reversión.
- [ ] Commit: `git commit -m "test: verify flow balanced planner safeguards"`

## Acceptance

- Desactivar la opción reproduce el comportamiento anterior.
- Ninguna restricción dura empeora y no aumentan conflictos ni operaciones sin programar.
- La estrategia nueva sólo se selecciona cuando mejora la puntuación común.
- El motor hace como máximo una pasada adicional y la interfaz permanece responsiva.
- El plan publicado conserva inicio y fin global de cada OT.
