# Task 3 — Eliminar cambios automáticos antiguos

## Resultado

- Se agregaron dos regresiones en `tests/planner-core.test.mjs`.
- Un cambio pendiente generado por `PLANNER_CORE_V2` de una ejecución anterior desaparece y no bloquea al `AJUSTADOR` a las 07:00.
- Un cambio generado completado permanece como historial, conserva sus fechas y no bloquea al `AJUSTADOR` a las 07:00.
- No fue necesario cambiar la lógica productiva: `planner-core.js` ya separa los cambios completados y excluye los pendientes generados antes de regenerar.

## Evidencia TDD

Las pruebas nuevas pasaron inmediatamente por la lógica existente. Para demostrar que la primera regresión era sensible, se quitó temporalmente la exclusión `op.generatedBy !== GENERATED_BY` y se ejecutó el patrón focalizado:

```text
tests 2; pass 1; fail 1
un cambio antiguo pendiente desaparece y no reserva capacidad
AssertionError: true !== false
```

La exclusión se restauró inmediatamente. Evidencia final:

```powershell
node --test --test-name-pattern="cambio antiguo" tests/planner-core.test.mjs
```

```text
tests 2; pass 2; fail 0
```

```powershell
node --test tests/planner-core.test.mjs
```

```text
tests 16; pass 16; fail 0
```

## Auto-revisión

- Alcance limitado a las dos regresiones solicitadas y este reporte.
- Las pruebas verifican tanto presencia/ausencia como consumo de capacidad a las 07:00.
- El caso completado verifica además fechas históricas y ausencia de conflictos de operador.
- No se agregó trazabilidad, tooltip ni comportamiento de tareas posteriores.
- No se incluyeron archivos de tareas anteriores.
