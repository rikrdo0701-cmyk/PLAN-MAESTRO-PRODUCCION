# Tarea 1 — Funciones puras de sincronización ligera

## Estado

DONE

## Evidencia RED

```powershell
node --test --test-name-pattern="compareWorkOrderLite|applyConfirmedWorkOrderChanges" tests/planning-workflow-core.test.mjs
```

Resultado inicial: 3 pruebas ejecutadas, 0 aprobadas y 3 fallidas porque `compareWorkOrderLite` todavía no existía.

## Evidencia GREEN

El mismo comando enfocado terminó con 3 pruebas aprobadas y 0 fallidas.

```powershell
npm.cmd test
```

Resultado final: 56 pruebas aprobadas, 0 fallidas.

```powershell
git diff --check
```

Resultado: sin errores.

## Archivos cambiados

- `src/web/planning/planning-workflow-core.js`
- `tests/planning-workflow-core.test.mjs`
- `.superpowers/sdd-restore/task-1-report.md`

## Cambios

- Comparación ligera normalizada sin mutar estado ni argumentos.
- Conservación de campos UI al combinar los campos autoritativos de NetSuite.
- Clasificación de cambios directos, cantidades planeadas y OTs planeadas ausentes.
- Aplicación inmutable de decisiones de cantidad y cierre.
- Reprogramación exclusiva de operaciones pendientes no bloqueadas.
- Advertencias persistentes para rechazos e incompatibilidades bloqueadas.
- Retiro de OTs cerradas aun bloqueadas, conservando únicamente operaciones completadas como historial.

## Commit

Mensaje: `Agregar reconciliacion ligera de OTs`. El hash final se informa en la entrega del controlador.

## Auto-revisión y preocupaciones

No se agregó UI ni backend. No se modificaron archivos fuera del alcance. Sin preocupaciones abiertas.
