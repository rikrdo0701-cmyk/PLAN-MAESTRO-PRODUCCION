# Reporte Tarea 4: Restaurar borrador en Plan semanal

## Implementacion

- Se agrego `Restaurar borrador` a las acciones de Plan semanal y se oculta fuera de esa vista.
- `openRestoreDraftDialog` carga y muestra exclusivamente instantaneas publicadas historicas con fecha/hora, usuario, inicio del plan y numero de operaciones.
- El flujo muestra la ultima sincronizacion y permite sincronizar antes de restaurar, continuar con los datos cargados o cancelar.
- `previewDraftRestore` obtiene la instantanea y presenta las seis metricas de `reconcilePublishedPlan` antes de pedir confirmacion explicita.
- `confirmDraftRestore` llama `restorePublishedPlanAsDraft`, adopta el estado editable devuelto, limpia `reportSnapshot`, guarda/renderiza y muestra el mensaje requerido.
- Lectura, sincronizacion y escritura usan la accion ocupada `restore`, mutuamente excluyente con programacion y sincronizacion. Los errores anteriores a una respuesta exitosa no reemplazan el borrador.
- El flujo no llama al motor de programacion ni a publicacion.
- Tras recargar el catalogo de instantaneas, `reportSnapshot` se limpia al final para que no quede una seleccion automatica residual, y la interfaz vuelve explicitamente a Plan semanal.
- Las tres entradas del flujo rechazan ejecucion si alguna sincronizacion NetSuite ya esta activa; el estado visual de sincronizacion tambien deshabilita el boton de restaurar.

## TDD

- RED: `node --test tests/build.test.mjs` fallo al no encontrar `restoreDraftBtn`.
- GREEN: la misma prueba paso despues de agregar UI y comportamiento.
- Review RED/GREEN: se agregaron aserciones de orden, guardas de sincronizacion y navegacion; fallaron contra la primera implementacion y pasaron tras corregirla.

## Verificacion

- `npm.cmd test`: 58 pruebas, 58 aprobadas, 0 fallas.
- `npm.cmd run build`: Apps Script y GitHub Pages generados correctamente (16 archivos de servidor, 4 vistas y 5 paginas).
- `git diff --check`: sin errores; solo advertencias informativas de conversion LF/CRLF.

## Consideraciones

- La restauracion efectiva depende del bridge de Apps Script y de una instantanea publicada con `fullState`, conforme al contrato del backend existente.
