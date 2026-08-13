# Reglas y logica del sistema 

> Índice canónico y no duplicador de reglas de negocio.
> Cada regla se referencia a su fuente exacta; no se reescriben reglas completas.
> Clasificación: **DOCUMENTADA** (fuente escrita), **IMPLEMENTADA** (verificada en código/pruebas), **INFERIDA** (deducida de evidencia indirecta), **AMBIGUA** (evidencia insuficiente o contradictoria).
> Evidencia base (solo lectura): `reports/TASK-20260809-114212-1B33.hybrid-subagents.json` y su context packet.

## OT

- **Nota:** `docs/OT_RULES.md` es la autoridad especializada del mapeo OT; este índice solo la referencia.
- **RULE-OT-001** — Mapeo de hojas (DOCUMENTADA): Control de trabajos (TRABAJO) → Trabajos programados (Folio de trabajo → ID Interno) → Operaciones programadas (Orden de trabajo = ID Interno). Fuente: `docs/OT_RULES.md:1-100`.
- **RULE-OT-002** — Normalización de TRABAJO/Folio (DOCUMENTADA): eliminar prefijos `OT-`, `O.T.`, `ot-`; eliminar caracteres no alfanuméricos; trim; `"05"` → `"5"`; usar el texto mostrado de HYPERLINK. Fuente: `docs/OT_RULES.md:1-100`.
- **RULE-OT-003** — ID Interno (DOCUMENTADA): tratarlo como cadena con trim(); si está vacío, el trabajo no puede mapearse: detectar y reportar. Fuente: `docs/OT_RULES.md:1-100`.
- **RULE-OT-004** — Agrupación de operaciones (DOCUMENTADA): las operaciones de un mismo ID Interno se agrupan por secuencia (1, 2, ...). Fuente: `docs/OT_RULES.md:1-100`.
- **RULE-OT-005** — Coherencia del borrador (DOCUMENTADA): Gantt, KPI, backlog, Planeado/Por planear, cargas y reportes usan la misma lista `selectedOts`; una OT no seleccionada no aparece como parte del borrador programado. Fuente: `docs/superpowers/specs/2026-07-12-limpieza-borrador-y-reportes-design.md:1-48`.
- **RULE-OT-006** — Sincronización ligera del backlog (IMPLEMENTADA): `syncBacklogWorkOrders()` usa únicamente `syncNetSuiteWorkOrdersLite` con el timeout existente, compara antes de aplicar, confirma una sola vez los cambios planeados y persiste estado/snapshot. Fuente: `.superpowers/sdd-restore/task-2-report.md:1-47`, `src/web/planning/app.js`.
- **RULE-OT-007** — Exclusión mutua (IMPLEMENTADA): sincronización ligera, sincronización completa y programación no pueden ejecutarse simultáneamente. Fuente: `.superpowers/sdd-restore/task-2-report.md:1-47`.
- **RULE-OT-008** — OTs cerradas conservadas (IMPLEMENTADA): una `CLOSED_KEPT` permanece visible sin entrar al motor ni poda. Fuente: `.superpowers/sdd-restore/task-2-report.md:1-47`.
- **RULE-OT-009** — Tipos de trabajo (IMPLEMENTADA): `PROTOTIPO`, `URGENTE`, `EXPEDITACION` determinan la clasificación visual de riesgo. Fuente: `legacy/IndexPlanning.html:701-800`.

## Doblado

- **RULE-DOB-001** — Operaciones CT 5459/5527 (DOCUMENTADA): las operaciones sincronizadas sin máquina, herramental o kit no se descartan; la preparación de la OT solicita esos datos precargando el catálogo del artículo. Fuente: `docs/superpowers/specs/2026-07-12-limpieza-borrador-y-reportes-design.md:1-48`.

## Herramentales

- **RULE-HER-001** — Preservación de herramentales (DOCUMENTADA): la hoja `HERRAMENTALES` se preserva durante la limpieza del borrador (configuración maestra). Fuente: `docs/superpowers/specs/2026-07-12-limpieza-borrador-y-reportes-design.md:1-48`.
- **RULE-HER-002** — Herramental en doblado (INFERIDA; complementa RULE-DOB-001): el herramental de las operaciones de doblado CT 5459/5527 se precarga desde el catálogo del artículo durante la preparación de la OT. Fuente: `docs/superpowers/specs/2026-07-12-limpieza-borrador-y-reportes-design.md:1-48`.

## Máquinas

- **RULE-MAQ-001** — Preservación de máquinas (DOCUMENTADA): la hoja `MAQUINAS` se preserva durante la limpieza del borrador (configuración maestra). Fuente: `docs/superpowers/specs/2026-07-12-limpieza-borrador-y-reportes-design.md:1-48`.
- **RULE-MAQ-002** — Vista Gantt por máquina (IMPLEMENTADA): el "Programa semanal" es una vista de borrador por máquina (p. ej. `Dobladora 209`). Fuente: `legacy/IndexPlanning.html:601-700`.
- **RULE-MAQ-003** — Asignación de operaciones a máquinas (IMPLEMENTADA): cada operación del plan tiene una máquina asignada (p. ej. Corte en máquina `1`, Doblez en `Dobladora 209`). Fuente: `legacy/IndexPlanning.html:701-800`.

## Matriz de capacidad

- **RULE-MAT-001** — Catálogo maestro SuiteQL (DOCUMENTADA): consulta los pasos de rutas de manufactura activas unidas a rutas y centros de trabajo activos; entrada `{key, ct, label, source: NETSUITE_MASTER, active}`. Fuente: `docs/superpowers/specs/2026-07-26-matrix-search-catalog-exclusions-design.md:1-100`.
- **RULE-MAT-002** — Deduplicación y filtro de activos (DOCUMENTADA): dedupe por CT y nombre normalizado; conservar únicamente registros, rutas y centros activos. Fuente: `docs/superpowers/specs/2026-07-26-matrix-search-catalog-exclusions-design.md:1-100`.
- **RULE-MAT-003** — Fallback del catálogo (DOCUMENTADA): si la consulta falla, conservar el último catálogo válido y devolver advertencia; nunca reemplazarlo por una lista vacía. Fuente: `docs/superpowers/specs/2026-07-26-matrix-search-catalog-exclusions-design.md:1-100`.
- **RULE-MAT-004** — No modificar RESTlets ni Apps Script (DOCUMENTADA): el catálogo y las exclusiones no modifican los RESTlets actuales ni el Apps Script protegido. Fuente: `docs/superpowers/specs/2026-07-26-matrix-search-catalog-exclusions-design.md:1-100` y `:101-109`.
- **RULE-MAT-005** — Exclusión de subcontratos especiales (DOCUMENTADA): el selector Agregar operación no muestra operaciones clasificadas como subcontrato especial. Fuente: `docs/superpowers/specs/2026-07-26-matrix-search-catalog-exclusions-design.md:1-100`.
- **RULE-MAT-006** — Buscador de operaciones (DOCUMENTADA): coincidencia parcial por nombre o CT; normalización sin mayúsculas, espacios adicionales ni acentos; contador `N de M`; botón limpiar; mensaje sin coincidencias; solo afecta la vista. Fuente: `docs/superpowers/specs/2026-07-26-matrix-search-catalog-exclusions-design.md:1-100`.
- **RULE-MAT-007** — Exclusiones globales (DOCUMENTADA): `excludedCapabilities` excluye operaciones globalmente; la reactivación restaura la programación; la exclusión intermedia reconstruye precedencias; se persiste e importa. Fuente: `docs/superpowers/specs/2026-07-26-matrix-search-catalog-exclusions-design.md:101-109`.
- **RULE-MAT-008** — Memorización de operaciones incluidas (IMPLEMENTADA): `currentPlanOperations()` (26 invocaciones) se memoriza con clave = referencia de operaciones + firma normalizada de `excludedCapabilities`; se invalida al normalizar, importar, sincronizar, programar o cambiar exclusiones. Fuente: `docs/superpowers/specs/2026-07-27-frontend-progressive-loading-design.md:1-86`.
- **RULE-MAT-009** — Catálogo reutilizable con caché (IMPLEMENTADA): `CacheService` de Apps Script por 1 hora, separado por cuenta y ubicación; una respuesta inválida nunca reemplaza el catálogo anterior. Fuente: `docs/superpowers/specs/2026-07-27-frontend-progressive-loading-design.md:1-86`.

## Balanceo

- **RULE-BAL-001** — KPIs de carga (IMPLEMENTADA): el borrador muestra métricas de "Horas programadas" y "Riesgo alto". Fuente: `legacy/IndexPlanning.html:601-700`.
- **RULE-BAL-002** — Cargas coherentes con `selectedOts` (DOCUMENTADA; misma regla que RULE-OT-005): las cargas del borrador usan la misma lista `selectedOts` que Gantt, KPI, backlog y reportes. Fuente: `docs/superpowers/specs/2026-07-12-limpieza-borrador-y-reportes-design.md:1-48`.
- **Nota:** no se encontró evidencia de una regla explícita de balanceo de cargas (p. ej. algoritmo de nivelación); solo métricas de horas programadas y cargas. Evidencia insuficiente.

## BOM

- **RULE-BOM-001** — Hoja MATERIALES (DOCUMENTADA): `MATERIALES` es la hoja de materiales del borrador; sus filas que representan el estado sincronizado/programado actual se limpian en la limpieza del borrador. Fuente: `docs/superpowers/specs/2026-07-12-limpieza-borrador-y-reportes-design.md:1-48`.
- **RULE-BOM-002** — `materialsForOt()` (IMPLEMENTADA): filtra la lista de materiales por OT; se optimizó para evitar recorridos repetidos por tarjeta. Fuente: `docs/CONFIGURACION.md:201-300`.
- **Nota:** no se encontró evidencia de reglas explícitas de BOM más allá de la hoja `MATERIALES` y `materialsForOt()`. Evidencia insuficiente.

## Contradicciones y ambigüedades

- No se detectaron contradicciones directas entre las fuentes de la evidencia.
- Ambigüedad: los dominios Balanceo y BOM carecen de reglas explícitas en la evidencia; solo hay métricas de horas/cargas y la hoja `MATERIALES` con `materialsForOt()`.
- Riesgo de divergencia: los enlaces a líneas/archivos pueden quedar obsoletos; este índice referencia las fuentes, no reescribe las reglas.
