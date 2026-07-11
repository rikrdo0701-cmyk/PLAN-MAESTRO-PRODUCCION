# Configuración inicial

## 1. Vincular la hoja

Ejecuta en Apps Script:

```javascript
setProductionPlanningSpreadsheet('SPREADSHEET_ID');
```

## 2. Autorizar el frontend de GitHub Pages

El origen predeterminado ya es el correspondiente al propietario del repositorio:

```javascript
setProductionPlanningFrontendOrigin('https://rikrdo0701-cmyk.github.io');
```

La propiedad guardada es `FRONTEND_ORIGIN`. Debe contener únicamente esquema y dominio, sin la ruta del repositorio.

## 3. Fotografías

```javascript
setProductionPlanningPhotoFolder('DRIVE_FOLDER_ID');
```

## 4. NetSuite

Agrega las propiedades `NS_ACCOUNT_ID`, `NS_CONSUMER_KEY`, `NS_CONSUMER_SECRET`, `NS_TOKEN` y `NS_TOKEN_SECRET` desde la configuración de Apps Script. No las incluyas en GitHub.

## 5. Desplegar backend

```powershell
npm run check
clasp push
```

Después actualiza la implementación web existente para que la URL `/exec` incluya `Bridge.html` y el nuevo `doGet`.

## 6. Activar GitHub Pages

En el repositorio abre **Settings → Pages → Build and deployment** y selecciona **GitHub Actions**. El workflow `Desplegar frontend en GitHub Pages` publicará `site/` con cada push a `main`.

La URL esperada es:

```text
https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/
```

## 7. Verificación

Ejecuta en Apps Script:

```javascript
getDeploymentStatus();
runProductionReadinessCheck({});
verifyProductionPlanningDatabase();
getPhotoSourceStatus();
```

`getDeploymentStatus()` debe mostrar `frontendOrigin: "https://rikrdo0701-cmyk.github.io"`.
