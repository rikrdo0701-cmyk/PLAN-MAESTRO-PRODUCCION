# Informe Tarea 1: Build portable y artefacto verificable

## Estado

DONE.

## Archivos cambiados

- `scripts/build-appscript.mjs`: `read(relativePath)` normaliza CRLF a LF tras leer UTF-8.
- `tests/build.test.mjs`: verifica que `site/index.html` contiene `PlannerCore`, `scheduleCurrentPlan` y `subcontractWindowEnd`, y que no es la portada Jekyll generada desde el README. La expectativa obsoleta `getAppStateIfChanged` se alineo con el cliente actual, `getAppState`.

## Evidencia RED

Comando:

```text
node --test tests/build.test.mjs
```

Resultado antes de modificar produccion: FAIL, 0/1 pruebas. El build se detuvo con `Error: No se encontro la carga inicial para recuperar el borrador` en `patchPlanningApp`, confirmando que el marcador LF no coincidia con la fuente CRLF de Windows.

## Evidencia GREEN

Comando focalizado final:

```text
node --test tests/build.test.mjs
```

Resultado: PASS, 1/1 pruebas, 0 fallos.

Suite completa:

```text
npm.cmd test
```

Resultado: PASS, 4/4 pruebas, 0 fallos.

Revision del diff:

```text
git diff --check
git diff -- scripts/build-appscript.mjs tests/build.test.mjs
```

Resultado: sin errores de whitespace; el diff se limita al helper portable y las aserciones del artefacto.

## Self-review

- No se agregaron dependencias.
- No se modifico el backend de Apps Script.
- No se cambio el directorio publicado.
- La normalizacion ocurre de forma centralizada para todas las fuentes UTF-8 leidas por el build y no altera LF existente.
- Las pruebas inspeccionan el `site/index.html` realmente generado.

## Commit

Mensaje: `Hacer portable el build de GitHub Pages`.

El hash se registra en la respuesta al coordinador, porque el informe se escribe antes de crear el commit.

## Preocupaciones

- `scripts/check-project.mjs` conserva una validacion obsoleta de `getAppStateIfChanged` en `Index.html`, aunque el cliente actual usa `getAppState`. Se deja intacto por el alcance de esta tarea y debe corregirse en la Tarea 2.
- `package-lock.json` ya estaba modificado al comenzar y no forma parte de este commit.
