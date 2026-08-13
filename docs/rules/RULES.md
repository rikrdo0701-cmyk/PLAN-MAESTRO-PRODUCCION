# Rules registry

Registro de todas las reglas con ID estable `RULE-<DOMINIO>-NNN`. Cada regla tiene una sola
fuente canónica y una clasificación: **DOCUMENTADA**, **IMPLEMENTADA**, **INFERIDA** o
**AMBIGUA** (ver `docs/REGLAS.md`). La versión machine-readable vive en
`.project-memory/rules.json`.

## Gobernanza

| ID | Nombre | Estado | Fuente |
|---|---|---|---|
| `RULE-GOV-001` | Project Memory first | DOCUMENTADA | ADR-0001 |
| `RULE-GOV-002` | Single writer | DOCUMENTADA | ADR-0001 |
| `RULE-GOV-003` | Document discovered knowledge | DOCUMENTADA | ADR-0001 |
| `RULE-GIT-001` | Private independent remote | DOCUMENTADA | ADR-0001 |
| `RULE-GIT-002` | Push only through Git Gate | DOCUMENTADA | ADR-0001 |

## OT

| ID | Nombre | Estado | Fuente |
|---|---|---|---|
| `RULE-OT-001` | Mapeo de hojas (Control → Trabajos → Operaciones) | DOCUMENTADA | `OT_RULES.md` |
| `RULE-OT-002` | Normalización de TRABAJO/Folio | DOCUMENTADA | `OT_RULES.md` |
| `RULE-OT-003` | ID Interno como cadena | DOCUMENTADA | `OT_RULES.md` |
| `RULE-OT-004` | Agrupación por secuencia | DOCUMENTADA | `OT_RULES.md` |
| `RULE-OT-005` | Coherencia del borrador (`selectedOts`) | DOCUMENTADA | spec 2026-07-12 |
| `RULE-OT-006` | Sincronización ligera del backlog | IMPLEMENTADA | `planning/app.js` |
| `RULE-OT-007` | Exclusión mutua de sync/programación | IMPLEMENTADA | task-2-report |
| `RULE-OT-008` | OTs cerradas conservadas (`CLOSED_KEPT`) | IMPLEMENTADA | task-2-report |
| `RULE-OT-009` | Tipos de trabajo (PROTOTIPO/URGENTE/EXPEDITACION) | IMPLEMENTADA | `legacy/IndexPlanning.html` |
| `RULE-OT-010` | Persistencia de `CONFIGURACION_OT` mientras OT abierta | DOCUMENTADA | definición de usuario 2026-08-12 |

## Doblado

| ID | Nombre | Estado | Fuente |
|---|---|---|---|
| `RULE-DOB-001` | Precarga CT 5459/5527 en preparación de OT | DOCUMENTADA | spec 2026-07-12 |

## Herramentales

| ID | Nombre | Estado | Fuente |
|---|---|---|---|
| `RULE-HER-001` | Preservación de `HERRAMENTALES` | DOCUMENTADA | spec 2026-07-12 |
| `RULE-HER-002` | Herramental en doblado (complemento DOB-001) | INFERIDA | spec 2026-07-12 |
| `RULE-HER-003` | Múltiples herramentales simultáneos en doblado | IMPLEMENTADA | definición de usuario 2026-08-12 |

## Máquinas

| ID | Nombre | Estado | Fuente |
|---|---|---|---|
| `RULE-MAQ-001` | Preservación de `MAQUINAS` | DOCUMENTADA | spec 2026-07-12 |
| `RULE-MAQ-002` | Programa semanal = vista Gantt por máquina | IMPLEMENTADA | `legacy/IndexPlanning.html` |
| `RULE-MAQ-003` | Cada operación tiene máquina asignada | IMPLEMENTADA | `legacy/IndexPlanning.html` |

## Matriz de capacidad

| ID | Nombre | Estado | Fuente |
|---|---|---|---|
| `RULE-MAT-001` | Catálogo maestro SuiteQL | DOCUMENTADA | spec 2026-07-26 |
| `RULE-MAT-002` | Dedupe y filtro de activos | DOCUMENTADA | spec 2026-07-26 |
| `RULE-MAT-003` | Fallback del catálogo (nunca lista vacía) | DOCUMENTADA | spec 2026-07-26 |
| `RULE-MAT-004` | No modificar RESTlets/Apps Script | DOCUMENTADA | spec 2026-07-26 |
| `RULE-MAT-005` | Exclusión de subcontratos especiales | DOCUMENTADA | spec 2026-07-26 |
| `RULE-MAT-006` | Buscador de operaciones | DOCUMENTADA | spec 2026-07-26 |
| `RULE-MAT-007` | Exclusiones globales (`excludedCapabilities`) | DOCUMENTADA | spec 2026-07-26 |
| `RULE-MAT-008` | Memorización de operaciones incluidas | IMPLEMENTADA | spec 2026-07-27 |
| `RULE-MAT-009` | Catálogo con caché 1 h | IMPLEMENTADA | spec 2026-07-27 |

## Balanceo

| ID | Nombre | Estado | Fuente |
|---|---|---|---|
| `RULE-BAL-001` | KPIs de carga | IMPLEMENTADA | `legacy/IndexPlanning.html` |
| `RULE-BAL-002` | Cargas coherentes con `selectedOts` (misma regla OT-005) | DOCUMENTADA | spec 2026-07-12 |
| `RULE-BAL-003` | Agrupación por máquina y herramental en doblado | DOCUMENTADA | definición de usuario 2026-08-12 |
| `RULE-BAL-004` | Menor tiempo de OT en producción para reducir WIP | DOCUMENTADA | definición de usuario 2026-08-12 |

## BOM

| ID | Nombre | Estado | Fuente |
|---|---|---|---|
| `RULE-BOM-001` | `MATERIALES` en limpieza del borrador | DOCUMENTADA | spec 2026-07-12 |
| `RULE-BOM-002` | `materialsForOt()` filtra por OT | IMPLEMENTADA | `CONFIGURACION.md` |

## Pendientes y ambigüedades

- Balanceo y BOM carecen de reglas explícitas más allá de lo listado (evidencia insuficiente).
- Los enlaces a líneas/archivos pueden quedar obsoletos; este registro referencia fuentes, no las reescribe.
