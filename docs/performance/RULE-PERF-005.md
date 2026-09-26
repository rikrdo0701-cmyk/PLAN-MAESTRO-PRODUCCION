# RULE-PERF-005 — Reportes, PDF y publicación

## Estado al 2026-09-12

Corrección de invalidación implementada; optimización integral y medición de los tres flujos pendientes. Este registro corrige el diagnóstico anterior de bloqueo universal del arranque headless.

## Evidencia y límites

- La comprobación remota encontró `origin/main=1238fad` y `main=6ab303f`, cuatro commits locales por delante. El HTML publicado no incluía la memo de RULE-PERF-003; el bundle local sí. Los tiempos de producción de ~1.1–1.3 s en reportes repetidos no evalúan esa memo local.
- RULE-PERF-003 registra históricamente 254/216 ms en pruebas locales. No son una nueva medición de este cambio.
- `compactLocalState` excluye el plan del almacenamiento local. Cero operaciones allí no implica cero operaciones en memoria. El arranque real usa el bridge Apps Script, `performance-client.js` y los parches de `scripts/build-appscript.mjs`.
- Abrir con `file://` produjo un error de origen `null` en `postMessage`; esa prueba no establece un fallo de hidratación por HTTP.

## Error reproducido y corrección

`reportOperatorLoadsSourceMemoized` vaciaba el Map semanal al detectar invalidación, pero podía devolver el memo anterior si coincidían array y semana. Ahora borra también `reportOperatorLoadsRenderMemo` antes del retorno rápido.

Prueba determinista en `tests/report-loads-cache.test.mjs`: con carga 50 y capacidad 100, el resultado es 50 %. Al reemplazar el calendario con capacidad 200, antes devolvía incorrectamente 50 %; debe devolver 25 %. También verifica otra semana almacenada, una mutación del origen con incremento de versión y reutilización sin cambios. Se ejecutan las funciones reales de caché con un cálculo de carga controlado; no es un benchmark del motor ni una prueba de PDF completo.

## Origen y propiedad de los datos

- Fuente: `reportOperationsSource()` devuelve operaciones del borrador actual o del snapshot publicado. El borrador persistido procede de `BORRADOR_PLAN`; los publicados, de `PLANES_HISTORICOS` mediante el bridge y la carga de snapshots. Los contratos de esas hojas siguen en `.project-memory/data-sources.json`.
- Entradas del memo: array de operaciones, semana normalizada y configuración de `state`. La firma existente usa identidad de operación, operador, inicio, fin y capacidad finita. Las guardas existentes comparan referencias de operaciones, operadores, perfiles, programación, selección, modos de capacidad, horario, descansos, excepciones, snapshot y versión de mutación.
- Único escritor del resultado derivado: `reportOperatorLoadsSourceMemoized`. Lectores: `weeklyExecutiveSummary` y `renderReportOperatorLoads`.
- Almacenamiento: memoria del navegador; Map limitado a cuatro semanas y memo del último origen/semana. Esta corrección no escribe columnas ni filas de Sheets.
- Restricción: los cambios in-place deben respetar la invalidación por versión existente; esta prueba no demuestra cobertura de todos los escritores de configuración.

## PDF y publicación

`generatePlanPdf` (`app.js`) selecciona/carga el snapshot o construye el borrador, puede persistir un snapshot en una ruta sin plan seleccionado, renderiza reportes, espera 50 ms y llama `window.print()`. Medir solo el clic no mide la preparación ni el guardado del archivo por el navegador.

Los 35.5 ms y 1,533,049 bytes registrados para `createAppSheetPayload` correspondenn solo a la preparación cliente. No representan guardado, lock, transporte ni confirmación del servidor.

## Medición integral 2026-09-26 (cierra los puntos 3 y 4 de la lista de validación)

Medido con Playwright en modo solo lectura, contra GitHub Pages con el estado real de producción (27 OTs en el backlog al arrancar, 2 131 operaciones en el estado). No se hizo clic en Publicar plan ni en Guardar: en RULE-PERF-007 un solo clic de la sonda dejó el plan real modificado.

### Punto 3 — preparación del PDF

`generatePlanPdf` (`app.js:6420-6504`) **no arma un PDF**: selecciona o carga el snapshot, renderiza reportes, pone `body[data-print-context=plan]`, espera 50 ms y llama a `window.print()`. El archivo lo produce el diálogo de impresión del navegador, fuera del código.

Lo medible es `renderReports`, que es lo que se fuerza antes de imprimir:

| Corrida | Min | Mediana | Max |
|---|---|---|---|
| `renderReports` (5 corridas) | 114.3 ms | **127 ms** | 144.5 ms |

Mejora frente a RULE-PERF-003 (~250 ms cold, ~216 ms warm), y la causa está medida: el catálogo de operaciones bajó a 2 131 desde los 1 478–1 527 de aquella fecha.

### Punto 4 — separar preparación cliente de backend

**Preparación cliente:** `createAppSheetPayload` (`app.js:12999`) arma el payload en 0.2–0.3 ms —es perezoso— y el `JSON.stringify` cuesta **7.2–19.9 ms**. La preparación no es un problema.

**Tamaño del payload:** 2 548 799 B (2.43 MiB) en una corrida y 1 204 280 B (1.15 MiB) en otra, con 2 131 operaciones. No es el mismo estado: la app sincroniza mientras se mide. Desglose del caso grande:

| Campo | Bytes | Peso |
|---|---|---|
| `operations` | 1 852 063 | 73 % |
| `publishedPlanStatuses` | 308 218 | 12 % |
| `workOrders` | 97 482 | 4 % |
| `materials` | 60 950 | 2 % |
| `operationPlanStatuses` | 54 092 | 2 % |
| `otConfigurations` | 51 405 | 2 % |

Son **869 B por operación**, el mismo ritmo que midieron las auditorías del 09-21 (833 B/op) y del 09-22 (845 B/op): **no hay regresión de bytes por operación**. `publishedPlanStatuses` es el espejo del schema de `ESTADOS_OPERACION_PLAN` y por RULE-PERF-007 no se toca.

**Red + Apps Script:** medida con `getAppStateIfChanged` por el mismo puente (solo lectura), mediana **10 277 ms** para 2.99 MiB de respuesta, o sea **~3 435 ms por MiB** de ida y vuelta. Con ese ritmo, el payload de publicar se va en ~4 s de red contra 8–20 ms de cálculo.

**Conclusión:** el total del botón **domina la red, no el código**. El cálculo es menos del 1 % del tiempo. Eso explica por qué los clics de la auditoría del 09-22 salían en 13–34 ms —no tocan la red— mientras publicar se va en segundos.

### Lo que quedó sin medir, y por qué

El **tiempo real del botón Publicar plan** con su escritura a la hoja. Medirlo exige hacer clic en Publicar, que escribe en la hoja; queda fuera de una sonda. La cifra de ~4 s es una extrapolación desde la tasa de transferencia medida, no una medición del botón.

Para cerrarla del todo hace falta que la midas en tu sesión, o dar autorización explícita a una sonda para publicar.

### Riesgo observado de paso

Una de las tres corridas de `getAppStateIfChanged` dio **65 328 ms** contra una mediana de 10 277 ms: una cola de ~6×. No se determinó la causa. Con el timeout del puente en 420 s no llega a ser un corte, solo una espera larga. Si se repite, hay que mirar si es la primera lectura tras cargar (trae 2.99 MiB) o una lectura incremental.

## Validación pendiente del objetivo de rendimiento

Verificación de la corrección: el test nuevo falló antes del cambio (50 % frente a 25 % esperado). Tras corregir la invalidación, `npm test` pasó 504/504; `npm run check` y `npm run build` finalizaron correctamente.

1. ~~Comparar bundle publicado y local por HTTP~~ — el desfase de cuatro commits que que se registro aquí ya no existe.
2. Medir primera apertura, repetición y cambio de semana; contrastar resultados con cálculo sin memo.
3. ~~Medir preparación PDF hasta `window.print`~~ — **hecho 2026-09-26**: `renderReports` 127 ms; el resto es el diálogo del navegador.
4. ~~Separar preparación cliente y tiempo del backend~~ — **hecho 2026-09-26**: 8–20 ms de cliente contra ~4 s de red extrapolados; el cálculo es <1 %.
5. Optimizar los costes que persistan y registrar resultados funcionales y tiempos antes/después.

Los puntos 3 y 4 ya no necesitan medición. El objetivo de «casi instantáneo» **no** se cumple en publicar plan, y la medición dice que la causa es la red y el backend, no el código del cliente: bajar eso exige reducir el tamaño del payload o el tiempo del backend, no optimizar el render.
