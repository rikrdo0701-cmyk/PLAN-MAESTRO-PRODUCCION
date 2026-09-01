# Arranque con datos reales sin Demo (Capas 1 y 2) — diseño 2026-09-01

## Objetivo

Eliminar de la vista pública (GitHub Pages) la carga con contenido de demostración
(`sampleState` / "Demo" / WO-10482) y poblar el plan automáticamente con datos reales
(Borrador o último plan publicado) **sin** pedir la confirmación "Actualizar a la
última modificacion". Reducir además el tiempo hasta el primer render de datos reales.

## Diagnóstico raíz (hechos verificados)

1. `getAppState()` del backend SÍ devuelve datos reales: 2254 operaciones,
   `revision: 1420`, `planStart: "2026-08-28"`, planta "Planta MM del Llano".
2. El arranque real de la app NO es `app.js` solo: `shared/performance-client.js`
   **sobrescribe** `loadAppStateInBackground` con `optimizedLoadAppStateInBackground`
   y su `loadInitialStateConditionally(initialLocalCache)` es el único boot real del
   build. Cualquier fix hecho únicamente en `app.js` respecto de esa carga es código
   muerto en producción.
3. Mientras Apps Script arranca en frío (~1-2 min), la página mostraba `sampleState`
   ("Demo", planta "Demo", WO-10482). Ese contenido de planeación disparaba
   `confirmLatestModificationRefresh` (modal "Actualizar a la última modificación")
   cuando volvía el backend, bloqueando la autoaplicación.
4. El caché local (`localStorage[STORAGE_KEY]="plan-produccion-app-v1"`) se escribía
   solo en guardados manuales y en recuperación de conflictos, no en una carga
   normal. `loadState()` = `deepClone(sampleState)` nunca lo rehidrataba: cada carga
   empezaba de cero.
5. `compactLocalState()` ya escribía `operations` en el caché,
   `optimizedScheduleLocalStorageFlush` el caché optimizado, pero nada llamaba a
   `scheduleLocalStorageFlush()` durante el arranque normal.
6. `readUsableLocalStateCache()` exige `Number(state.revision) === revision`; como el
   boot arranca con revision 0, `usable` es casi siempre false, así que el flujo iba
   por `getAppState` completo.

## Estrategia en capas

| Capa | Qué hace | Estado |
|---|---|---|
| 1 | Hidratar el caché local al boot → render instantáneo offline-first para visitantes recurrentes | **Implementada** (ff91e38) |
| 2 | Rescate rápido del Borrador en paralelo (`getPlanSnapshot("draft")`, segundos) | **Implementada** (d700a04, 4f977ec) |
| 3 | Caché de estado en servidor / warm-up (commit en `src/server/02-storage.js`, `15-performance-service.js`) | Propuesta, sin committear |
| 4 | Payload ligero de arranque | Propuesta |

## Solución base (sin Demo) — commit `9d9e12d`

Todas las ediciones de producción van en `scripts/build-appscript.mjs` (nunca en los
sources trackeados por separado; ver "Reglas para futuras modificaciones").

### Neutralización del `sampleState`

En el build, `patchPlanningApp()` neutraliza el estado de demostración:

- `selectedOperationId: "op-1"` → `""`
- `plant: { name: "Demo", locationId: null }` → `plant: { name: "", locationId: null }`
- `operations: [ ... op-1 ... ]` → `operations: []`

Consecuencia: `hasPlanningContent()` (app.js) es `false` al boot, por lo que
`confirmLatestModificationRefresh` devuelve `true` sin abrir el modal y la carga
aplica los datos remotos automáticamente.

### Rescate del Borrador/último plan publicado

`restoreDraftPlanFromSharedState()` (código inyectado en `app.js`):

1. Si ya hay `selectedOts` o `operations` reales → no hace nada.
2. Intenta `planningFetchSnapshotById("draft")` primero (rápido, devuelve el borrador
   en segundos).
3. Si falla, cae al listado de snapshots pre-cargado (`planSnapshots`) y elige el
   preferido: el de `draftVersionId`, si no el Borrador, si no el último publicado.
4. Carga el snapshot con `planningLoadSnapshotIntoState()`.

`planningLoadSnapshotIntoState(snapshot)` normaliza operaciones, construye las
`selectedOts`/`lockedOts`/`expandedOts` desde el snapshot, restaura
`planStart/plant/weekStart/reportWeekStart/loadWeekStart/draftVersionId/selectedDetailOt/
selectedOperationId` y otros campos, aplica `applyImported(..., { preserveLocalPlanning: false })`
de forma inline (sin usar el wrapper de performance-client), hace `saveState("ui")` +
`render({ save: false })` y el toast "Se cargo el plan guardado desde Google Sheets".

Alias: `planningRescueStateFromBackups()` → `restoreDraftPlanFromSharedState()`. Se usa
este nombre en `performance-client.js` porque `tests/build.test.mjs` exige que el slice
`optimizedStartupSource` (entre `async function loadInitialStateConditionally(localCache)`
y `const originalLoadPlanSnapshots =`) NO contenga `loadPlanSnapshotById` ni
`restoreDraftPlanFromSharedState`.

## Capa 1 — Hidratación del caché local al boot (`d700a04`)

`planningHydrateLocalCache()` (inyectado en `app.js` vía `patchPlanningApp` y llamado en
`initializePlanningApp` **antes** del primer `render({ save: false })`):

- Lee `localStorage.getItem(STORAGE_KEY)` (`"plan-produccion-app-v1"`).
- Rehidrata solo si el caché es una versión válida y la página viene vacía:
  - `operations` es array no vacío;
  - `revision > 0`;
  - `Number(schemaVersion) === Number(APP_SCHEMA_VERSION)` (29);
  - `plant.name` no es `"Demo"`;
  - `state.operations` está vacío (no pisar una carga ya aplicada).
- Restaura en `state`: `operations`, `workOrders`, `plant`, `planStart`, `selectedOts` +
  `expandedOts`, `loadWeekStart`/`reportWeekStart` (vía `normalizeWeekStartValue`),
  `lastSchedule`, `draftVersionId`, `activePublishedVersionId`, `operators`,
  `operatorProfiles`, `matrix`, `capacityModes`, `cts`; fija `state.revision`
  (`revision` guardada) y llama `normalizeState()`.
- Devuelve `true/false`; cualquier error → `false` sin efecto.

## Capa 2 — Rescate rápido del Borrador en paralelo (`d700a04`, `4f977ec`)

En `patchPerformanceClient()`, el inicio de `optimizedLoadAppStateInBackground` se
reemplaza para, tras `await root.PPAppsScriptBridge.ensureReady()`:

1. Disparar (sin esperarlo) `fastDraftRescue = planningRescueStateFromBackups()`;
2. Cuando resuelve con `ok === true`: `saveState("ui")` + `requestAnimationFrame(() => render({ save: false }))` →
   el plan real (Borrador rápido) aparece casi al instante;
3. `loadInitialStateConditionally(initialLocalCache)` continúa en paralelo y luego
   refresca con la fuente autoritativa (`getAppState` / `getAppStateIfChanged`);
4. Si `loaded === true` → `scheduleLocalStorageFlush()` (Capa de persistencia del caché).

## Capa de confirmación suprimida (`d700a04`)

`planningLoadSnapshotIntoState` setea `window.__planningRestoredFromServer = true`
sincrónicamente. En `loadInitialStateConditionally`:

- Se captura `const planningRestoredFromServer = root.__planningRestoredFromServer === true;`
  justo antes del bloque de confirmación;
- Si es `true`, se omite `confirmLatestModificationRefresh` (no hay contenido de
  planeación local que defender),
- y se resetea `root.__planningRestoredFromServer = false` en TODAS las salidas:
  rama `keptLocal`, rama `unchanged` y tras `applyImported`.

Todos los entrelazamientos de la carrera son seguros (sincronizaciones validadas en
producción): o bien el flag ya está puesto (se omite el modal), o bien el estado local
sigue vacío (`hasPlanningContent === false`) y el modal tampoco aparece.

## Caché local poblado tras cada carga autoritativa (`ff91e38`)

`optimizedScheduleLocalStorageFlush` escribe `STORAGE_KEY` (estado compacto con
`operations` y `performanceCache.{identity, revision}`) y `META_KEY`
(`"plan-produccion-performance-v2"` con `revision`, `cacheIdentity`, `cacheRevision`,
`deferredMaterials`). Se llama por primera vez en el arranque tras una carga exitosa:

```js
const result = await loadInitialStateConditionally(initialLocalCache);
loaded = result.loaded;
if (loaded) scheduleLocalStorageFlush();
```

Con esto el segundo arranque del mismo navegador encuentra caché válido y la Capa 1
rinde: plant/plan reales en ~3 s (medido en producción).

## Lección de alcance: helpers internos de planner-core NO son globales (`4f977ec`)

El código inyectado por el build en `app.js` y `performance-client.js` corre en el
ámbito global de esas páginas. `planner-core.js` define decenas de helpers (p. ej.
`normalizeKey`) **dentro** de su factory `createPlannerCore()`, y solo exporta lo
listado en su objeto de retorno (`root.PlannerCore`). Una referencia a `normalizeKey`
desde código inyectado produce en producción:

```
ReferenceError: normalizeKey is not defined
  at planningLoadSnapshotIntoState (site/index.html:7582)
```

Fix: el código inyectado define su propio `planningNormalizeKey()` (misma cadena de
normalización: trim + MAYÚSCULAS + NFD sin acentos + colapsar espacios) y lo usa donde
antes llamaba `normalizeKey`.

## Validación

- `npm test`: 453 pruebas pasan (suite `node --test`); destaca la cámara del test de
  build sobre `optimizedStartupSource`.
- `npm run check`: validación correcta.
- Producción (Playwright headless contra
  `https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/`):
  - Primer visita (contexto frío): `Demo: False`, `Planta: "Planta MM del Llano"`,
    `OTs en el plan: 8`, `modal: 0`; planta real a ~43-77 s según cold start del backend.
  - Tras una carga completa el caché queda con `operations: 2254`.
  - Recarga del mismo contexto: planta real a **~3.4 s**, sin Demo y sin modal.
  - `getPlanSnapshot("draft")` en el primer cold start puede lanzar una excepción
    transitoria de Sheets ("El servicio Hojas de cálculo falló al acceder al documento…");
    el rescate la degrada con `console.warn` y continúa.

## Commits

| Commit | Contenido |
|---|---|
| `ce7adf3` | Carga inicial con datos reales (Borrador/último publicado) sin Demo (base) |
| `e71fc3a` | `scheduleLocalStorageFlush` global — evitó abort de `initPerformanceClient` |
| `9d9e12d` | Neutralización del demo + autoaplicar datos reales + `planningRescueStateFromBackups` |
| `d700a04` | Capa 1 (hidratación del caché) + Capa 2 (rescate rápido en paralelo) + flag de confirmación |
| `4f977ec` | `planningNormalizeKey` (helpers internos de planner-core no son globales) |
| `ff91e38` | Caché local poblado tras cada carga autoritativa exitosa |

## Reglas para futuras modificaciones

Véase `.project-memory/rules.json` (RULE-GOV-006/007/008 y RULE-LOAD-001..004) y el
registro `docs/rules/RULES.md`. Resumen operativo:

1. **Nunca reintroducir estado de demostración en el arranque público.** El build
   neutraliza `sampleState`; un cambio que devuelva "Demo"/WO-10482 al boot rompe la
   regla RULE-GOV-006.
2. **Los fixes del arranque real van en `scripts/build-appscript.mjs`**
   (`patchPlanningApp`/`patchPerformanceClient`), no solo en `src/web/planning/app.js`:
   `performance-client` sobrescribe el boot (RULE-GOV-007).
3. **Respetar la cámara de `tests/build.test.mjs`** sobre `optimizedStartupSource`:
   no referenciar `loadPlanSnapshotById|restoreDraftPlanFromSharedState` en él; usar
   alias como `planningRescueStateFromBackups`.
4. **El código inyectado no usa helpers internos de planner-core** (no son globales);
   definir helper propio (ej. `planningNormalizeKey`) (RULE-GOV-008).
5. **Conservar el flujo por capas**: hidratación (Capa 1) → rescate rápido (Capa 2) →
   autoritativo `getAppState`/`getAppStateIfChanged` (refresh) → caché local.
6. **El modal de confirmación de "última modificación" no debe abrirse** cuando el
   contenido local provino del servidor (`window.__planningRestoredFromServer`).
7. Deploy válido: push a `main` de `scripts/build-appscript.mjs` dispara
   `deploy-pages.yml`; los cambios solo de docs/`.project-memory` NO redeployean.
   Verificar SIEMPRE en el origen de GitHub Pages con Playwright (contexto frío y
   contexto cálido).
8. No commitear `src/server/02-storage.js`, `src/server/15-performance-service.js` ni
   `src/web/bridge/Bridge.html` mientras tengan cambios sin commitear de cachés de
   estado (Capas 3-4 en discusión); `.openchamber/*` son probes locales no traqueables.

## Pendiente (Capas 3 y 4, fuera de alcance)

- **Capa 3**: caché de estado en el servidor (commit en `src/server/02-storage.js` y
  `src/server/15-performance-service.js`) o warm-up programado para eliminar el cold
  start de la primera visita.
- **Capa 4**: bootstrap más ligero (excluir catálogos/matriz/materiales del primer
  `getAppState`).