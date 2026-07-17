# Task 4 — Rediseño del modal de tramo/dibujo

## Estado

Completado. El modal existente conserva su flujo de apertura, foco, validación, guardado, mensajes, cierre y estado deshabilitado; sólo se refinó el markup generado y su CSS.

## Cambios

- `src/web/inspection/inspection-app.js`
  - Encabezado compacto con título, WO, artículo y cierre.
  - Cuerpo desplazable independiente con regla de guardado y dibujo destacado.
  - Materiales en filas con columnas para código/descripción, cantidad, tramo y estado.
  - Estado textual `Falta tramo` / `Tramo capturado`.
  - Mensajes y acciones en un pie siempre visible.
- `src/web/inspection/inspection.css`
  - Diálogo centrado de hasta 1,100 px, fondo blanco, backdrop atenuado y sombra discreta.
  - Layout de tres filas para inmovilizar encabezado y pie.
  - Filas separadas sin tarjetas anidadas, foco teal visible y controles tipográficos explícitos.
  - Adaptación bajo 760 px sin overflow horizontal.
- `tests/build.test.mjs`
  - Prueba focal de la estructura nueva, scroll interno, tabla, foco, breakpoint y ausencia de `prompt()`.

No se modificaron impresión, diagnóstico, servicios, esquema ni Catálogos.

## TDD

1. RED: `node --test --test-name-pattern="el editor de tramo usa un panel compacto sin prompts" tests/build.test.mjs`
   - Falló al no encontrar `inspection-link-context`.
2. GREEN: el mismo comando pasó tras agregar la estructura y CSS mínimos.
3. RED adicional: se exigió conservar `El tramo se guarda por articulo + material.` y la prueba falló al no encontrar el copy.
4. GREEN adicional: el copy se restauró como nota única de la tabla y la prueba pasó.

## Pruebas

- `node --test tests/build.test.mjs` — 6/6 pasan.
- `npm.cmd test` — 102/102 pasan.
- `npm.cmd run check` — `Validacion correcta`; Apps Script y Pages listos.
- `git diff --check` — sin errores.

## QA visual

Browser plugin no disponible. Playwright está disponible, pero su Chromium administrado no está instalado; se utilizó Playwright con Chrome local, sin instalar dependencias.

El estado real del modal requiere el bridge/backend de Apps Script. Se usó un harness en memoria, no guardado en el repositorio, con el CSS de producción y el mismo HTML dinámico del modal, más 16 materiales para forzar desplazamiento.

- 1440 × 900: diálogo 1,100 × 840, centrado en `(170, 30)`, sin overflow horizontal.
- 720 × 900: diálogo 682 × 884, centrado en `(19, 8)`, filas apiladas y sin overflow horizontal.
- Escritorio: cuerpo `701 / 1429 px`; scroll final `728 px`.
- Móvil: cuerpo `713 / 2511 px`; scroll final `1798 px`.
- Antes/después del scroll, encabezado y pie conservaron exactamente sus coordenadas.
- Consola: 0 warnings/errores relevantes.
- Foco: cierre con outline visible de 3 px.
- Escape: cerró el diálogo nativo y los 16 valores permanecieron en el DOM.

## Screenshots

- `C:\Users\plane\.codex\visualizations\2026\07\17\019f703e-6115-7382-b936-131c2f7e30f8\inspection-link-dialog-1440x900.png`
- `C:\Users\plane\.codex\visualizations\2026\07\17\019f703e-6115-7382-b936-131c2f7e30f8\inspection-link-dialog-1440x900-scrolled.png`
- `C:\Users\plane\.codex\visualizations\2026\07\17\019f703e-6115-7382-b936-131c2f7e30f8\inspection-link-dialog-720x900.png`

## Correcciones posteriores al review

- Breakpoint ampliado de 759 a 820 px para cubrir el intervalo 760–801 con las filas apiladas.
- Foco cambiado de `#2dd4bf` a `#0f766e`; la prueba calcula un contraste mínimo de 3:1 sobre blanco y `#edf3f7`.
- `updateInspectionRouteStatus` sincroniza texto y clases en cada evento `input`, sin intervenir en el guardado.
- El estado tiene `aria-live="polite"` para anunciar el cambio.
- Se agregaron tres pruebas estructurales específicas y se observaron sus fallos RED antes de implementar.

QA adicional con Playwright y Chrome local:

- 760 × 900: sin overflow horizontal en documento, diálogo ni cuerpo; scroll interno `1798 px`.
- 800 × 900: sin overflow horizontal en documento, diálogo ni cuerpo; scroll interno `1782 px`.
- 1440 × 900: layout de cuatro columnas conservado y sin overflow.
- En los tres tamaños, encabezado y pie conservaron sus coordenadas después del scroll.
- En 800 px, escribir un tramo cambió `Falta tramo/is-pending` a `Tramo capturado/is-ready`; borrar revirtió texto y clases.
- El navegador reportó el foco como `rgb(15, 118, 110)` y no registró warnings ni errores.

Capturas posteriores al review:

- `C:\Users\plane\.codex\visualizations\2026\07\17\019f703e-6115-7382-b936-131c2f7e30f8\inspection-link-dialog-1440x900-review.png`
- `C:\Users\plane\.codex\visualizations\2026\07\17\019f703e-6115-7382-b936-131c2f7e30f8\inspection-link-dialog-800x900-review.png`
- `C:\Users\plane\.codex\visualizations\2026\07\17\019f703e-6115-7382-b936-131c2f7e30f8\inspection-link-dialog-760x900-review.png`

## Auto-revisión y preocupaciones

- Se confirmó en el diff que `saveEditModal`, `closeLinkDialog` y los listeners existentes no cambiaron; sólo se agregó el listener `input` de estado.
- El copy de ayuda de tramo se conserva una vez, evitando repetirlo en cada material.
- No se pudo ejercitar un guardado real contra Apps Script desde el navegador local; la suite automatizada y la preservación literal de la lógica reducen ese riesgo.
- La captura usa datos de ejemplo y Chrome local; conviene una pasada final en el despliegue conectado cuando haya una WO real disponible.
