# Task 2 — Reporte

## Estado

Implementada la conservación de OTs seleccionadas y bloqueadas, su reserva de capacidad y el rechazo centralizado de retiro al backlog.

## RED

Comando:

```powershell
node --test tests/planner-core.test.mjs tests/planning-workflow-core.test.mjs tests/build.test.mjs
```

Resultado inicial: 39 aprobadas, 3 fallidas.

- Planner core: la OT bloqueada conservaba fechas, horas y operador, pero perdía la máquina.
- Workflow core: `canRemoveSelectedOt` no existía.
- Build: `app.js` no consultaba el helper ni mostraba `showToast(removal.reason)`.

## GREEN

Cambios mínimos:

- Las operaciones fijas conservan máquina, herramental y kit durante normalización/configuración.
- `canRemoveSelectedOt(state, ot)` normaliza OT y `lockedOts`, y devuelve el motivo exacto requerido.
- `selectJob` consulta el helper antes de checkpoint, prioridades, operaciones o retiro.
- Se añadieron pruebas de capacidad, workflow y estructura del build.

Verificación final:

```powershell
node --test tests/planner-core.test.mjs tests/planning-workflow-core.test.mjs tests/build.test.mjs
git diff --check
```

Resultado: 42 aprobadas, 0 fallidas; `git diff --check` sin errores.

## Auto-revisión

- El rechazo ocurre antes de cualquier mutación, por lo que conserva `selectedOts`, prioridades y operaciones.
- La regla de bloqueo está centralizada en workflow core y usa claves normalizadas.
- La capacidad del operador bloqueado queda reservada y la OT movible no se solapa.
- No se implementó trazabilidad de espera ni tooltip.
- No se detectaron cambios fuera del alcance funcional de Task 2.
