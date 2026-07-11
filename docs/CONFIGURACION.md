# Configuración inicial

## 1. Vincular la hoja

Ejecuta en Apps Script:

```javascript
setProductionPlanningSpreadsheet('SPREADSHEET_ID');
```

La función crea o valida las hojas requeridas y guarda el ID en `PLANNING_SPREADSHEET_ID`.

## 2. Fotografías

```javascript
setProductionPlanningPhotoFolder('DRIVE_FOLDER_ID');
```

Los archivos se relacionan por el nombre del artículo o número de parte.

## 3. NetSuite

Agrega las propiedades `NS_ACCOUNT_ID`, `NS_CONSUMER_KEY`, `NS_CONSUMER_SECRET`, `NS_TOKEN` y `NS_TOKEN_SECRET` desde la configuración de Apps Script. No las incluyas en archivos del repositorio.

## 4. Verificación

Ejecuta:

```javascript
getDeploymentStatus();
runProductionReadinessCheck({});
verifyProductionPlanningDatabase();
getPhotoSourceStatus();
```
