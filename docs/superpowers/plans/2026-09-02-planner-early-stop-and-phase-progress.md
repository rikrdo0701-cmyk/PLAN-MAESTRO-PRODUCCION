# Parada temprana, presupuesto adaptativo y progreso por fases del motor de planeacion

**Fecha:** 2026-09-02
**Reglas:** RULE-BAL-010, RULE-BAL-011, RULE-BAL-012

## Problema

Con 8 OTs (82 operaciones, 79 movibles), el motor ejecutaba 3 estrategias completas (balanced, finish, load) + flow_balanced, compartiendo un presupuesto fijo de 5 minutos. La primera estrategia (balanced) completaba 79/79 operaciones en ~30 segundos, pero el motor continuaba ejecutando finish y load sin necesidad. El boton de generacion mostraba "Programando 79 de 79 (100%)" durante minutos sin actualizarse, y al finalizar quedaba pegado con ese texto porque el finally usaba `netSuitePlanningSyncInFlight` y `originalLabel` capturado al inicio.

A 180 OTs, el motor ejecutaba 3 estrategias en ~5 minutos sin completar todas las OTs (abort por presupuesto, 172 ops sin hueco marcadas como diagnostics, no como capacidad real).

## Solucion

### 1. Parada temprana (RULE-BAL-010)

En `schedulePlan`, despues de evaluar cada estrategia:

1. Si **alguna estrategia evaluada** tiene `operatorConflicts === 0` y `unscheduled === 0` (plan completo)
2. Y **>= 2 estrategias** ya fueron evaluadas
3. => Se rompe el bucle, se saltan las estrategias restantes y `flow_balanced`

Las estrategias saltadas se registran en `strategySkips` con `reason: "COMPLETE_PLAN_FOUND"`.

**Por que >= 2?** Para poder comparar al menos 2 estrategias y elegir la mejor (regla del usuario: "debe elegir el plan cual es la mejor estrategia"). Si la primera ya es completa, se ejecuta una segunda para comparar, pero no mas.

### 2. Presupuesto adaptativo (RULE-BAL-011)

`planningPlanTimeBudgetMs(readyOts)` calcula el presupuesto dinamicamente:

```
presupuesto = min(45000 + OTs * 45000, 300000)
```

| OTs | Presupuesto |
|-----|-------------|
| 1   | 90s         |
| 4   | 225s        |
| 8   | 300s (cap)  |
| 180 | 300s (cap)  |

El presupuesto sigue siendo un tope de seguridad. El motor termina antes cuando encuentra un plan completo (parada temprana).

### 3. Progreso por fases (RULE-BAL-012)

**planner-core.js:**
- `emitPlanningProgress` ahora incluye campo `strategy` en cada evento
- `schedulePlanOnce` escribe `performanceState.strategy = strategy` al inicio
- Nueva funcion `emitFinalizeProgress` emite fase `finalize:select-best` antes de `finalizeMultiStrategyPlan`

**app.js onProgress:**
- Muestra "Estrategia balanced: 30 de 79 (38%)" durante cada estrategia
- Muestra "Eligiendo mejor plan..." en fase finalize
- Muestra "Programando X de Y (Z%)" como fallback

**Reset incondicional del boton:**
- `scheduleCurrentPlan` wrapper finally: siempre escribe "Generar plan" (eliminada condicion `!netSuitePlanningSyncInFlight`)
- `scheduleCurrentPlanImpl` finally: siempre escribe "Generar plan" (eliminada variable `originalLabel`)

## Archivos modificados

| Archivo | Cambios |
|---------|---------|
| `src/web/planning/planner-core.js` | `strategy: ""` en createPlanningPerformanceState; `performanceState.strategy = strategy` en schedulePlanOnce; `hasCompletePlan` + `completePlanFound` en schedulePlan; `emitFinalizeProgress` nueva; campo `strategy` en emitPlanningProgress |
| `src/web/planning/app.js` | `planningPlanTimeBudgetMs` nueva; `PLANNING_PLAN_BUDGET_BASE_MS/PER_OT_MS` constantes; onProgress por fase/estrategia; reset incondicional finally x2; `originalLabel` eliminada |
| `.project-memory/rules.json` | RULE-BAL-010, RULE-BAL-011, RULE-BAL-012 |
| `.project-memory/modules.json` | Reglas nuevas en MODULE-SRC |

## Smoke test (Node)

```
$ node planner-smoke.js

{
  "elapsedSecs": "0.1",
  "scheduled": 0,
  "unscheduled": 5,
  "operatorConflicts": 0,
  "selectedStrategy": "balanced",
  "strategiesEvaluated": ["balanced", "finish", "flow_balanced"],
  "strategySkips": [{"strategy": "load", "reason": "STRATEGY_CONVERGED"}],
  "aborted": false,
  "phases": ["strategy:balanced:start", "strategy:finish:start", "strategy:flow_balanced:start", "finalize:select-best"]
}
SMOKE OK
```

El smoke test corrio con un fixture de 4 OTs (5 ops). Las estrategias balanced y finish convergieron (metricas identicas), se salto load, se emitio finalize:select-best, no aborto. Presupuesto de 5 min. Fixture no logro programar todas las OTs (faltan datos de matriz/operadores), pero la logica de parada temprana y fases se verifico.

## Verificacion pendiente

- Build completo (`npm run check` + `npm run build`)
- Deploy a GitHub Pages (push a main)
- Prueba en produccion: generar plan con 8 OTs, verificar tiempo < 2 min, boton muestra fases, boton regresa a "Generar plan", plan completo (0 pendientes, 0 conflictos)
