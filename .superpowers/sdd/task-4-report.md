# Task 4 — QA integral de Hoja de inspección

## Estado

**DONE_WITH_CONCERNS.** La suite y la validación de build pasan, y la referencia quedó caracterizada. La validación renderizada integral de la vista de inspección quedó bloqueada por el navegador integrado no disponible y por una shell PWA persistente en el fallback Chromium; no se presenta el PDF del fallback como evidencia válida.

No se hizo `git push`, por instrucción del controlador. Después del QA, el review Important sí exigió ajustes de fidelidad, panel, tolerancia de auxiliares y navegación inicial; se implementaron con pruebas.

## Flujo objetivo

Abrir Hoja de inspección → seleccionar WO → Cargar → abrir selección → ocultar una operación intermedia → confirmar cuadrícula compacta → Ver dibujo → cerrar/editar liga sin guardar → Imprimir.

## Suite y build

- `npm.cmd test`: 85 pruebas, 85 aprobadas, 0 fallas.
- `npm.cmd run check`: código 0, `Validacion correcta. Index.html: 611 KiB; Apps Script: 22 archivos; Pages listo.`
- `npm.cmd run build`: código 0; generó `dist/` y `site/`.
- Los cambios productivos posteriores al review se incluyen en el commit de corrección.

## Navegador

### Ruta preferida

- Habilidad usada: `frontend-testing-debugging` y, por estar disponible en el catálogo, `browser:control-in-app-browser`.
- La conexión obligatoria al Browser integrado falló exactamente con: `Browser is not available: iab`.
- Clasificación: **Browser invocation failed**.

### Fallback Chromium headless

- Binario: `C:\Users\plane\AppData\Local\ms-playwright\chromium-1228\chrome-win64\chrome.exe` (Chromium 149).
- URL intentada: `http://127.0.0.1:4173/?qaFixture=1#hoja-inspeccion`, repetida en `localhost` y con cache-busting.
- Viewports intentados: 1440×1000 y 390×844.
- Se construyó un fixture temporal con una WO, 2 materiales y 12 operaciones; interceptaba solamente la interfaz local `PPAppsScriptBridge.call` y no alteraba ni fingía solicitudes externas. Fue retirado al finalizar.
- Resultado DOM repetible: `fixtureBlock=false`, `qaReady=false`, `data-view=plan`; la shell servida permaneció en Plan semanal. Por ello las capturas `tmp/qa/inspection-desktop.png`, `inspection-mobile.png` y `hoja-inspeccion.pdf` corresponden a la shell previa y **no son evidencia válida de Hoja de inspección**.
- El log de consola sólo mostró `[Plan Maestro] optimizacion activa fluid-2026-07-11-03`; no mostró overlay ni excepción, lo cual es coherente con una shell PWA persistente y no con la ejecución del fixture nuevo.

## Matriz de checks renderizados

| Check | Estado | Evidencia |
|---|---:|---|
| Identidad de página | Bloqueado | Browser integrado no disponible; fallback quedó en Plan semanal |
| DOM no vacío | PASS parcial | La aplicación renderizó contenido real, pero no la vista objetivo |
| Overlay de framework | PASS parcial | No apareció overlay en capturas del fallback |
| Consola | PASS parcial | Sin errores de aplicación relevantes; sólo log informativo |
| Captura de inspección | Bloqueado | Capturas descartadas por identidad incorrecta |
| Selección/compactación | PASS automatizado | `tests/inspection-core.test.mjs`: selección inicial y compactación pasan |
| Dibujo/edición sin guardar | Bloqueado | Fixture no llegó al flujo objetivo |
| Impresión de inspección | Bloqueado | PDF del fallback era Plan semanal, no inspección |

## Referencia PDF

- Fuente: `C:\Users\plane\Documents\Necesidades de Produccion.pdf`.
- `pdfinfo`: 1 página, A4 horizontal, 841.92 × 594.96 pt, PDF 1.4.
- Render: `pdftoppm -png -singlefile -r 144 ... tmp/qa/reference.png`.
- Evidencia válida: `tmp/qa/reference.png` muestra una hoja horizontal de una página, cuadrícula de operaciones, segunda captura y pie de liberación.
- Mismatch ledger: no fue posible comparar contra un render válido de inspección. El PDF de fallback también fue una página A4 horizontal, pero su contenido era Plan semanal y fue descartado.

Poppler usado: `C:\Users\plane\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin\pdfinfo.exe` y `pdftoppm.exe`.

## Riesgos pendientes

- Falta confirmar visualmente estructura, proporción, corte y legibilidad de una impresión real de Hoja de inspección.
- Falta ejercitar en navegador Ver dibujo, cancelación de edición y registro previo a impresión contra una WO adecuada.
- El service worker/caché persistente del entorno de Chromium puede ocultar builds nuevos durante QA local; conviene repetir con Browser integrado disponible o un perfil Chromium limpio y controlable.
- No se comprobó producción ni workflows remotos y no se hizo push.

## Correcciones posteriores al review Important

- El encabezado `MP FO 08 V23` conserva fecha de entrega y, para ambos materiales, material, descripción, tramo y Tubo/pzas; los campos vacíos conservan su celda.
- El panel muestra cuatro verificaciones separadas: Tramos, Dibujo, Material y Pendientes. El historial muestra Total, Última impresión y Folio/fecha.
- La cuadrícula de acciones mantiene Cargar/Ver dibujo en la primera fila, Editar liga/Imprimir en la segunda y sólo Seleccionar operaciones a ancho completo.
- El detalle y su selección se renderizan antes de consultar rutas. El auxiliar `getInspectionDrawingRoutes` tolera rechazo sin impedir el documento; historial también degrada a resumen vacío.
- La vista indicada por el hash inicial se aplica antes de `loadAppStateInBackground`, evitando que `#hoja-inspeccion` quede temporalmente en Plan semanal.
- TDD RED: la prueba focalizada de build falló por ausencia de `Fechas de entrega:`. GREEN: la misma prueba pasó después de los cambios.

## Correcciones finales de fidelidad al original

- Se comparó la implementación con `nesesidades prod/index.html`: Pendientes vuelve a significar materiales con cantidad requerida, sin depender de operaciones ocultas; sólo falta de tramo en cantidades fraccionadas bloquea, mientras dibujo, déficit o ausencia de pendientes piden revisión.
- La impresión bloqueada informa y abre edición sin registrar. Las advertencias piden confirmación, y un fallo al registrar historial permite confirmar impresión sin registro.
- El pie recupera encabezados individuales Oper, N° OPER, Cantidad NC, Clave, FTY, Sello liberación, Observaciones, Entrega, Cant. y Recibe, más tres filas y sello con `rowspan` de tres.
- Para dos materiales o menos se agrega una segunda fila vacía; para más materiales se imprimen pares adicionales.
- El panel recupera títulos, píldoras, estados por fila, iconos de acciones y la nota sobre persistencia de dibujo/tramo.
- TDD RED: dos pruebas core fallaron porque `inspectionPrintDiagnostic` no existía y la prueba de build falló por la píldora ausente. GREEN: core 5/5 y build focalizado 1/1.
- La revisión independiente detectó que faltaban dos detalles de datos del original: `deficitNeto || deficit` y el filtro de materiales “costo 0”/sin requerido. Se agregaron regresiones RED, el servicio conserva `requiredOriginal`, `deficit` y `netDeficit`, y tanto hoja como diagnóstico usan la lista filtrada. GREEN: core 6/6 y build focalizado 1/1.
