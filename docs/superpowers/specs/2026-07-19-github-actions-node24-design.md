# Actualización de GitHub Actions a Node.js 24

## Objetivo

Eliminar los avisos de acciones basadas en Node.js 20 actualizando las acciones oficiales, sin cambiar el runtime Node.js con el que se prueba o publica la aplicación.

## Cambios

- En todos los workflows:
  - `actions/checkout` → `v6`
  - `actions/setup-node` → `v6`
- En el despliegue de GitHub Pages:
  - `actions/configure-pages` → `v6`
  - `actions/upload-pages-artifact` → `v5`
  - `actions/deploy-pages` → `v5`
- Conservar cada `node-version` existente:
  - CI, Pages y publicación npm: Node.js 20.
  - Apps Script: Node.js 24.

## Archivos

- `.github/workflows/ci.yml`
- `.github/workflows/deploy-appscript.yml`
- `.github/workflows/deploy-pages.yml`
- `.github/workflows/npm-publish-github-packages.yml`
- Prueba automatizada de versiones en `tests/build.test.mjs`.

## Verificación

- Una prueba debe fallar mientras quede alguna acción antigua.
- `npm test` y `npm run check` deben pasar.
- Tras publicar, los workflows de validación, Apps Script y Pages deben finalizar correctamente y sin avisos de Node.js 20.

## Restricciones

- No modificar IDs, secretos, permisos, eventos ni comandos de despliegue.
- No cambiar la versión Node.js de la aplicación.
- No tocar el Apps Script protegido.
