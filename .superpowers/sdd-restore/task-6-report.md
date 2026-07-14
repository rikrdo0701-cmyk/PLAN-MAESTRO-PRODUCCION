# Tarea 6: Costo semanal y Costo P/P

## Resultado

- Se agrego `weeklyFinishingCost(rows)` al workflow core como fuente unica para piezas, costo total y costo por pieza.
- El calculo deduplica OTs normalizadas y conserva `amount: 0` y `unitPrice: 0` como valores explicitos.
- Si falta `amount`, usa `unitPrice * pendingPieces`; con cero piezas devuelve costo por pieza 0.
- El resumen ejecutivo semanal consume exclusivamente `summary.finishes` para sus cantidades economicas.
- `weeklyJobSummary` conserva `amount` y `unitPrice` ausentes como `null`.
- El agrupamiento por tipo y los totales diarios reutilizan `weeklyFinishingCost`.
- Se elimino el calculo principal basado en `Number(row.amount || 0)`.

## TDD

RED confirmado con 4 fallos esperados: tres por ausencia de `weeklyFinishingCost` y uno porque el build aun contenia la logica anterior.

GREEN confirmado con las pruebas focalizadas: 39 pruebas aprobadas, 0 fallos.

## Verificacion final

- `npm.cmd test`: 63 aprobadas, 0 fallos.
- `npm.cmd run check`: validacion correcta.
- `npm.cmd run build`: Apps Script y GitHub Pages generados correctamente.
- `git diff --check`: sin errores.

## Correcciones de revision

- La columna MONTO renderiza `effectiveFinishingAmount(row)`, por lo que un `amount` ausente muestra el mismo fallback `unitPrice * pendingPieces` usado por totales y costo por pieza.
- `pendingPieces`, `amount` y `unitPrice` se validan con `Number.isFinite`; `NaN` e infinitos nunca llegan a los indicadores.
- `weeklyFinishingRowsByType` deduplica globalmente por OT antes de agrupar. Ante tipos contradictorios conserva deterministamente el primer registro, y la suma de grupos coincide con el total semanal.
- RED de revision: 4 fallos esperados por render anterior, API ausente, contaminacion con infinitos y agrupamiento sin deduplicacion global.
- GREEN focalizado: 42 aprobadas, 0 fallos.
- Verificacion final posterior a la revision: `npm.cmd test` 66 aprobadas; `npm.cmd run check`, `npm.cmd run build` y `git diff --check` correctos.
