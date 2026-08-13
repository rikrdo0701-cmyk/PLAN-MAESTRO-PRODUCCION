# REBUILD — Reconstrucción del proyecto desde cero

> Guía paso a paso para que otra IA (o persona) reconstruya, configure y despliegue el sistema
> **plangit** partiendo solo de esta documentación y del código fuente. No se incluyen secretos:
> todos los valores confidenciales se referencian por nombre y se configuran en Apps Script.

## 0. Requisitos previos

- Node.js >= 20 (`package.json` → `engines.node`).
- Cuenta de Google con Apps Script.
- Cuenta NetSuite con acceso OAuth 1.0a (REST Record API + SuiteQL) y los RESTlets propios.
- Repositorio de GitHub (frontend en GitHub Pages).
- `npm install` en la raíz del proyecto.

## 1. Estructura mínima del repositorio

```text
src/
├─ server/              # Backend Apps Script (19 módulos numerados)
└─ web/                 # Frontend (planning, operator, skills, inspection, shared, bridge)
scripts/                # build-appscript.mjs, check-project.mjs
tests/                  # Suite de pruebas (node --test)
appsscript.json         # Manifest de Apps Script
package.json
```

Archivos raíz legacy (pipeline "Plan Maestro" fuera de `src/server`): `PRINCIPAL.js`,
`global.js`, `parser_*.js`, `modelo_logico.js`, `SCHEDULER.js`, `WRITTER.js`,
`* FINAL.js` (alimentadores NetSuite), `NetSuiteOAuth.js`, `NETAUTHSUITEQL.js`,
`utility.js`, `OT_RULES.md`.

## 2. Configuración del backend en Apps Script

### 2.1 Propiedades del script (PropertiesService → Script Properties)

| Propiedad | Uso |
|---|---|
| `PLANNING_SPREADSHEET_ID` | ID del Google Sheets de la aplicación (requerido) |
| `PHOTO_FOLDER_ID` | ID de la carpeta de fotografías en Drive |
| `FRONTEND_ORIGIN` | `https://rikrdo0701-cmyk.github.io` (sin la ruta del repo) |
| `NS_ACCOUNT_ID` | Cuenta NetSuite |
| `NS_CONSUMER_KEY` | Consumer key OAuth |
| `NS_CONSUMER_SECRET` | Consumer secret OAuth |
| `NS_TOKEN` | Token OAuth |
| `NS_TOKEN_SECRET` | Token secret OAuth |
| `NS_LOCATION_ID` | `'1'` (Planta MM del Llano; fija, `configureNetSuiteCredentials_` rechaza otros) |
| `INSPECTION_SPREADSHEET_ID` | Workbook de inspección (default hardcodeado en `16-inspection-service.js`) |
| `NS_WO_INSPECTION_SCRIPT` | Script RESTlet de inspección (default `'2080'`) |
| `NS_WO_INSPECTION_DEPLOY` | Deploy del RESTlet (default `'1'`) |

### 2.2 Comandos de configuración (ejecutar una vez en Apps Script)

```javascript
setProductionPlanningSpreadsheet('SPREADSHEET_ID');   // crea el workbook (setup)
setProductionPlanningFrontendOrigin('https://rikrdo0701-cmyk.github.io');
setProductionPlanningPhotoFolder('DRIVE_FOLDER_ID');
configureNetSuiteCredentials({ /* NS_* */ });          // no documentar los valores
```

La hoja de cálculo se crea y se siembra automáticamente (`PP_ensureWorkbook_`):
hojas con headers, formato, `CONFIG`, `SUBCONTRATOS` (cromado/metokote/maka) y
`TIPOS_OT` (oem/especial/linea) por defecto.

## 3. Build y pruebas

```powershell
npm install
npm run check      # ejecuta el build completo y valida dist/ y site/
npm test           # 347 pruebas con node --test
npm run build      # genera dist/ (Apps Script) y site/ (GitHub Pages)
```

`npm run check` falla si: faltan archivos en `dist/`, hay error de sintaxis, falta la URL del
backend o los marcadores del build, o `appsscript.json` cambia de `runtimeVersion`/`webapp`.

## 4. Publicación del backend (Apps Script)

1. `npm run build` (regenera `dist/`).
2. Configurar `~/.clasprc.json` y `.clasp.json`:

```json
{ "scriptId": "TU_SCRIPT_ID", "rootDir": "dist" }
```

3. `clasp status` (verificar el Script ID correcto).
4. `clasp push --force`.
5. Apps Script → Implementar → Administrar implementaciones → Editar la implementación existente →
   **Nueva versión** → Implementar. Conservar la misma URL `/exec`.
6. La URL pública del backend es de la forma:
   `https://script.google.com/macros/s/<deployment-id>/exec` y se inyecta en el build
   (`src/web/bridge/Bridge.html` la usa como origen del iframe).

> Tres estados independientes: (1) fuente en GitHub, (2) código subido con clasp, (3) versión
> web publicada en `/exec`. Deben coincidir. Ver `docs/APPS_SCRIPT_DEPLOYMENT_Y_BYPASS.md`.

## 5. Publicación del frontend (GitHub Pages)

1. En el repositorio: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. El workflow `.github/workflows/deploy-pages.yml` se dispara con push a `main`
   (paths de `src/web/**`, `tests/**`, scripts, package, workflow) o manualmente.
3. El build publica `site/` (index.html, operator.html, skills.html, manifest.webmanifest,
   sw.js, .nojekyll).
4. URL esperada: `https://<owner>.github.io/<repo>/`.

## 6. Verificación

En la consola del frontend publicado:

```javascript
PPAppsScriptBridge.ensureReady().then(() => console.log('PUENTE OK'));

PPAppsScriptBridge.call('getDeploymentStatus', []).then(console.log);
PPAppsScriptBridge.call('getAppState', []).then(s => console.log({
  operadores: s.operators?.length, capacidades: s.configuredCapabilities?.length,
  catalogoOperaciones: s.operationCatalog?.length, clavesMatriz: Object.keys(s.matrix || {}).length
}));
```

Desde Apps Script:

```javascript
getDeploymentStatus();
runProductionReadinessCheck({});
verifyProductionPlanningDatabase();
getPhotoSourceStatus();
```

## 7. Checklist previo a cada release

```text
[ ] npm run check  → verde
[ ] npm test       → verde (347 pruebas)
[ ] npm run build
[ ] clasp status   → Script ID correcto
[ ] clasp push --force
[ ] Apps Script: nueva versión de la implementación
[ ] URL /exec responde
[ ] GitHub Pages: build + deploy verdes
[ ] PUENTE OK en consola
[ ] getDeploymentStatus correcto
[ ] Catálogos, matriz y borrador coinciden en la página
```

## 8. Notas de seguridad

- No versionar: `.clasp.json`, `.clasprc.json`, credenciales NetSuite, IDs de libros, `.env`.
- **Acción pendiente**: varios scripts legacy de la raíz (`TRABAJOS FINAL.js`,
  `OPERACION FINAL.js`, `MATERIALES FINAL.js`, `INVENTARIO FINAL.js`,
  `CALENDARIO VACACIONES.js`, `EXISTENCIAS INV.js`, `probar tablas sql.js`,
  `testoperaciones.js`) contienen **credenciales OAuth hardcodeadas** y un ID de libro
  (`Actualizador herramentales.js`). Deben migrarse a Script Properties y rotarse.
  Ver `docs/data/sources.md` (sección de conflictos y pendientes).
