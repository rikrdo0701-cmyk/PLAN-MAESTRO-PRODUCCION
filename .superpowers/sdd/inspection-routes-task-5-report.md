# Task 5 — Verificación integrada y correcciones de revisión final

## Estado: DONE

Base de la ola final: `b92aa36`. Commit objetivo: `Corregir revision final de tramos`.

## Resultado

- Catálogos construye un payload route-only; no puede restaurar un dibujo obsoleto desde caché.
- `saveInspectionLink` preserva DIBUJO cuando `drawing` se omite y todavía permite cambiarlo o limpiarlo cuando la propiedad está presente.
- El editor de tramo permanece abierto durante la RPC, deshabilita Guardar, conserva el valor y muestra el error dentro del diálogo. Sólo Éxito o Cancelar lo cierran.
- La respuesta se aplica a la colección vigente por clave normalizada artículo + material, aunque una recarga haya reemplazado las referencias.
- Las dos definiciones públicas de listado devuelven una fila por clave normalizada y eligen la última fila física.
- El modal de inspección tiene nombre accesible mediante `aria-labelledby` y un título `h2` estable.
- Un fallo de carga queda visible con Reintentar y no elimina filas cacheadas.

## Evidencia TDD

1. RED route-only:
   - servidor: `'' !== 'dibujo-b.pdf'` al guardar sólo tramo;
   - core: el payload todavía incluía `drawing: 'a100.pdf'`.
2. GREEN route-only:
   - payload exacto `{ article, material, route }`;
   - el servidor conserva `dibujo-b.pdf`;
   - una propiedad `drawing: ""` limpia la celda.
3. RED concurrencia/diálogo:
   - `TypeError: core.applyInspectionRouteSave is not a function`;
   - build sin estado persistente, submit asíncrono ni nombre accesible.
4. GREEN concurrencia/diálogo:
   - unidad pura aplica la respuesta a una colección reemplazada por clave normalizada;
   - el submit asíncrono retorna `false` en error y conserva el DOM.
5. RED duplicados:
   - la definición pública de `17-inspection-drawing-service.js` devolvió dos filas físicas.
6. GREEN duplicados:
   - ambas definiciones devuelven sólo la última fila, incluso con diferencias de mayúsculas.

## Verificación automatizada

| Comando | Resultado |
| --- | --- |
| `node --test tests\inspection-service.test.mjs tests\inspection-core.test.mjs tests\build.test.mjs` | 25 aprobadas, 0 fallidas |
| `npm.cmd test` | 106 aprobadas, 0 fallidas |
| `npm.cmd run check` | `Validacion correcta. Index.html: 650 KiB; Apps Script: 23 archivos; Pages listo.` |
| `git diff --check` | salida 0; sólo avisos informativos LF/CRLF |

## QA visual

Browser plugin no disponible; se usó Playwright del runtime con Chrome local y el build real servido en `http://127.0.0.1:4173/`.

- Viewports: 1440×900 y 800×900.
- Catálogos permaneció abierto durante una promesa pendiente, con Guardar deshabilitado.
- El payload capturado fue `{ article: "A-100", material: "MP-1", route: "650 mm" }`, sin dibujo.
- Tras error RPC, el diálogo siguió abierto, el tramo capturado permaneció y apareció error inline; al éxito cerró y actualizó la fila.
- Una actualización fallida conservó la fila cacheada y mostró mensaje persistente con Reintentar.
- El modal de inspección expuso `aria-labelledby="inspectionLinkDialogTitle"` hacia un `H2`.
- Ambos diálogos quedaron centrados y sin overflow horizontal en escritorio y 800 px.
- Consola: sin errores; un warning esperado del bridge local no conectado antes de inyectar el stub.

Capturas:

- `C:\Users\plane\.codex\visualizations\2026\07\17\019f703e-6115-7382-b936-131c2f7e30f8\inspection-routes-catalog-error-final.png`
- `C:\Users\plane\.codex\visualizations\2026\07\17\019f703e-6115-7382-b936-131c2f7e30f8\inspection-routes-load-error-final.png`
- `C:\Users\plane\.codex\visualizations\2026\07\17\019f703e-6115-7382-b936-131c2f7e30f8\inspection-link-dialog-accessible-final.png`
- `C:\Users\plane\.codex\visualizations\2026\07\17\019f703e-6115-7382-b936-131c2f7e30f8\inspection-routes-catalog-error-800-final.png`
- `C:\Users\plane\.codex\visualizations\2026\07\17\019f703e-6115-7382-b936-131c2f7e30f8\inspection-link-dialog-800-final.png`

## Alcance y preocupación residual

- Sin dependencias, cambios de esquema, eliminación de tramos ni cambios a la hoja imprimible.
- Catálogos continúa editando sólo tramos.
- No se ejecutó contra una hoja real de Apps Script; la prueba server-side, el bridge controlado y la suite cubren el contrato, pero sigue siendo recomendable una pasada conectada antes del despliegue productivo.
