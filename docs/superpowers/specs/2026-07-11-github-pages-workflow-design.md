# Diseño: publicación única de GitHub Pages

## Objetivo

Garantizar que la URL pública sirva el planificador generado desde `src/web/planning` y evitar que otro workflow lo reemplace con la documentación del repositorio.

## Causa confirmada

Dos workflows publican en el mismo entorno de GitHub Pages:

- `deploy-pages.yml` construye y publica `site/`, que contiene la aplicación.
- `jekyll-gh-pages.yml` publica la raíz mediante Jekyll, que muestra el README.

El último despliegue en terminar reemplaza al anterior. La URL pública actualmente muestra la documentación y no contiene el motor corregido.

## Diseño aprobado

1. Eliminar `.github/workflows/jekyll-gh-pages.yml`.
2. Mantener `.github/workflows/deploy-pages.yml` como único propietario de GitHub Pages.
3. Hacer que `scripts/build-appscript.mjs` procese de forma consistente archivos con finales de línea LF o CRLF.
4. Mantener CI separado para validación, sin permisos de despliegue.
5. Verificar antes de publicar que `site/index.html` contiene la aplicación y el motor del planificador.

## Flujo de publicación

Un `push` a `main` que modifique el frontend ejecutará:

1. Checkout.
2. Instalación reproducible de dependencias.
3. Pruebas y validación del proyecto.
4. Build de `site/`.
5. Comprobación del artefacto generado.
6. Publicación única mediante GitHub Pages.

## Manejo de errores

Si fallan pruebas, build o comprobación del artefacto, no se ejecutará el despliegue. El workflow no publicará la raíz del repositorio como alternativa.

## Verificación

- `npm test` debe finalizar sin fallos.
- `npm run check` debe finalizar sin fallos.
- `npm run build` debe generar `site/index.html`.
- El HTML generado debe contener `PlannerCore`, `scheduleCurrentPlan` y la corrección `subcontractWindowEnd`.
- Tras publicar, la URL debe mostrar el planificador y no el README.
- Una simulación limpia de la OT 1325 debe calcular 15 días hábiles para MAKA.

## Alcance

Este cambio corrige exclusivamente la publicación y su validación. El análisis detallado de huecos entre operaciones se realizará después sobre la aplicación ya desplegada, con una sesión limpia y el motor vigente.
