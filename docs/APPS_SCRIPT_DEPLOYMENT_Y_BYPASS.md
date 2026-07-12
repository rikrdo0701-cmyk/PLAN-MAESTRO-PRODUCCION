# Apps Script: copia en Git, deployment y bypass mediante Bridge

## Objetivo

Este documento registra cómo se conserva el código de Google Apps Script dentro del repositorio, cómo se compila y publica el backend, y cómo funciona el bypass utilizado por GitHub Pages para invocar `google.script.run` sin exponer credenciales.

## 1. Copia de Apps Script dentro de GitHub

Sí existe una copia editable de los scripts de Apps Script en el repositorio.

### Backend editable

Los archivos principales están en:

```text
src/server/
```

Ahí se encuentran los módulos que después se suben a Apps Script, entre ellos:

```text
01-code.js
02-storage.js
03-planning-service.js
04-publishing-service.js
05-completion-service.js
...
13-configuration.js
14-pages-bridge.js
```

El archivo `src/server/01-code.js` contiene `doGet`, lectura y guardado del estado, snapshots, sincronización de NetSuite y verificaciones de despliegue.

El archivo `src/server/14-pages-bridge.js` contiene la configuración del origen permitido y genera la salida HTML del puente.

### HTML del puente

El HTML utilizado por Apps Script para recibir llamadas desde GitHub Pages está en:

```text
src/web/bridge/Bridge.html
```

### Manifest de Apps Script

El manifest está en:

```text
appsscript.json
```

Configuración actual registrada:

```json
{
  "timeZone": "America/Monterrey",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8"
}
```

### Archivos generados

El comando:

```powershell
npm run build
```

genera dos carpetas:

```text
dist/   -> archivos para Apps Script y clasp
site/   -> frontend estático para GitHub Pages
```

Estas carpetas están en `.gitignore`, por lo que GitHub conserva las fuentes editables, no necesariamente los archivos compilados más recientes.

## 2. Flujo correcto de compilación y publicación de Apps Script

### Script ID activo esperado

El proyecto de Apps Script utilizado para el backend actual es:

```text
1HFWb7JgrmhUb6bp8W-cztQHnQgFYX7-4K3d0nqen-008lqdnD1amb3l_
```

### URL de la aplicación web

```text
https://script.google.com/macros/s/AKfycbyCrdM3g-ixxjbvqjysQ7pdO59Bn6NQA6PECUC_YI-ByfwzC1ueWcQFx1hErWqTHVoSxw/exec
```

### Comandos de publicación

```powershell
git pull origin main
npm install
npm run check
npm run build
clasp push --force
```

Después de `clasp push`, se debe publicar una nueva versión de la aplicación web:

```text
Apps Script
→ Implementar
→ Administrar implementaciones
→ Editar la implementación existente
→ Nueva versión
→ Implementar
```

Se debe editar la implementación existente para conservar la misma URL `/exec`.

### Diferencia entre push y deployment

`clasp push` actualiza los archivos del proyecto de Apps Script, pero no siempre actualiza la versión pública que atiende la URL `/exec`.

Por eso se necesitan ambos pasos:

```text
1. clasp push
2. Nueva versión de la implementación web
```

Si se omite el segundo paso, GitHub Pages puede seguir comunicándose con código anterior aunque el editor de Apps Script ya muestre los archivos nuevos.

## 3. Error detectado en `.clasp.json`

El archivo actualmente registrado en GitHub contiene:

```json
{
  "scriptId": "1ew3Nqi0e8SHid_zWv1z5cl6ATCZzqVLqc2lkbfox5CMNsh8FH5tL8zKx",
  "rootDir": ""
}
```

Esto no coincide con la configuración esperada del backend actual.

La configuración local correcta para publicar el build debe apuntar al Script ID activo y a la carpeta `dist`:

```json
{
  "scriptId": "1HFWb7JgrmhUb6bp8W-cztQHnQgFYX7-4K3d0nqen-008lqdnD1amb3l_",
  "rootDir": "dist"
}
```

### Riesgo

Ejecutar `clasp push` con el archivo actual puede:

- subir archivos al proyecto equivocado;
- subir fuentes sin compilar;
- mezclar archivos de GitHub con archivos generados;
- no incluir correctamente `Bridge.html`;
- actualizar un Apps Script distinto del que atiende la URL `/exec` actual.

Antes de usar `clasp push`, se debe verificar siempre:

```powershell
clasp status
clasp open-script
```

## 4. Qué significa el bypass

El bypass no desactiva la seguridad de Apps Script y no expone credenciales.

Su función es evitar dos limitaciones técnicas:

1. `google.script.run` solo existe en páginas servidas por Apps Script.
2. GitHub Pages no puede llamar directamente a `google.script.run` y una API directa puede presentar restricciones de CORS, sesión o autenticación.

La solución usa un iframe oculto servido por Apps Script.

## 5. Flujo del Bridge

```text
GitHub Pages
    |
    | postMessage
    v
iframe oculto de Apps Script
?app=bridge
    |
    | google.script.run
    v
Funciones del backend
    |
    v
Google Sheets / NetSuite / Drive
```

### Ruta especial

El frontend crea el iframe hacia:

```text
https://script.google.com/macros/s/AKfycbyCrdM3g-ixxjbvqjysQ7pdO59Bn6NQA6PECUC_YI-ByfwzC1ueWcQFx1hErWqTHVoSxw/exec?app=bridge
```

En `doGet(e)` se detecta `app=bridge` y se responde con `Bridge.html`.

### Configuración necesaria

En Apps Script debe estar configurado el origen del frontend:

```javascript
setProductionPlanningFrontendOrigin('https://rikrdo0701-cmyk.github.io');
```

La propiedad guardada es:

```text
FRONTEND_ORIGIN
```

Debe contener únicamente:

```text
https://rikrdo0701-cmyk.github.io
```

No debe incluir:

```text
/PLAN-MAESTRO-PRODUCCION/
```

## 6. Controles de seguridad del bypass

El puente valida:

- origen permitido;
- referencia de la ventana que envía el mensaje;
- identificador de canal aleatorio por pestaña;
- lista cerrada de métodos permitidos;
- coincidencia del canal antes de ejecutar una llamada.

El iframe se genera con:

```javascript
.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
```

Esto permite incrustar únicamente la página Bridge dentro del frontend, pero el JavaScript del Bridge sigue validando el origen autorizado.

### Métodos permitidos registrados

Entre los métodos permitidos están:

```text
getAppState
getAppRevision
getAppStateIfChanged
getMaterialsForOt
savePlanningStateOptimized
saveAppState
saveCatalogState
saveSkillState
savePlanSnapshot
listPlanSnapshots
getPlanSnapshot
syncNetSuitePlant
syncNetSuiteWorkOrders
syncNetSuiteWorkOrdersLite
syncNetSuitePlanningData
publishDraftPlan
getDeploymentStatus
getPhotoSourceStatus
PP_getActiveOperatorPlan
PP_completeOperation
PP_registerSubassemblyPicking
PP_saveSkillMatrix
```

Una función que no esté en esta lista será rechazada con:

```text
Metodo no permitido
```

## 7. Pruebas del Bridge

### Verificar inicialización

En la consola de GitHub Pages:

```javascript
PPAppsScriptBridge.ensureReady()
  .then(() => console.log('PUENTE OK'))
  .catch(error => console.error('PUENTE ERROR:', error));
```

Resultado esperado:

```text
PUENTE OK
```

### Probar una función sencilla

```javascript
PPAppsScriptBridge.call('getDeploymentStatus', [])
  .then(console.log)
  .catch(console.error);
```

### Probar lectura completa

```javascript
PPAppsScriptBridge.call('getAppState', [])
  .then(state => console.log({
    operadores: state.operators?.length || 0,
    capacidades: state.configuredCapabilities?.length || 0,
    catalogoOperaciones: state.operationCatalog?.length || 0,
    clavesMatriz: Object.keys(state.matrix || {}).length
  }))
  .catch(console.error);
```

## 8. Errores detectados relacionados con deployment y bypass

### Código subido pero deployment antiguo

Síntoma:

- El editor de Apps Script muestra cambios nuevos.
- La URL `/exec` sigue respondiendo con la versión anterior.

Causa:

- Se ejecutó `clasp push`, pero no se creó una nueva versión de la implementación web.

Corrección:

- Editar la implementación existente y seleccionar `Nueva versión`.

### Bridge no disponible

Síntomas posibles:

```text
PUENTE ERROR
Origen no autorizado
Metodo no permitido
```

Causas posibles:

- `FRONTEND_ORIGIN` incorrecto;
- deployment sin `Bridge.html`;
- deployment antiguo;
- método ausente en `ALLOWED_METHODS`;
- `.clasp.json` apuntando a otro proyecto;
- build no ejecutado antes de `clasp push`.

### Mensaje de ventana inesperada

Advertencia observada:

```text
dropping postMessage.. was from unexpected window
```

Este mensaje puede aparecer cuando existen iframes o mensajes de Google que no pertenecen al canal del Bridge. El puente debe ignorar mensajes cuya ventana, origen, fuente o canal no coincidan.

### Caché del frontend

Aunque el backend esté correctamente desplegado, el navegador puede conservar un HTML anterior de GitHub Pages.

Limpieza manual:

```javascript
navigator.serviceWorker.getRegistrations()
  .then(registrations => Promise.all(registrations.map(item => item.unregister())))
  .then(() => caches.keys())
  .then(keys => Promise.all(keys.map(key => caches.delete(key))))
  .then(() => location.reload());
```

## 9. Discrepancia detectada en `getDeploymentStatus`

La documentación anterior indicaba que `getDeploymentStatus()` debía devolver:

```text
frontendOrigin: "https://rikrdo0701-cmyk.github.io"
```

Sin embargo, la implementación actual de `getDeploymentStatus()` devuelve versión, esquema, hoja configurada, NetSuite, fotografías y usuario, pero no incluye `frontendOrigin`.

Para verificar el origen actual se puede ejecutar directamente:

```javascript
PropertiesService.getScriptProperties().getProperty('FRONTEND_ORIGIN')
```

O se debe actualizar `getDeploymentStatus()` para incluir:

```javascript
frontendOrigin: PP_frontendOrigin_()
```

## 10. Checklist antes de publicar

```text
[ ] Confirmar Script ID activo
[ ] Confirmar rootDir = dist
[ ] npm install
[ ] npm run check
[ ] npm run build
[ ] clasp status
[ ] clasp push --force
[ ] Apps Script → Administrar implementaciones
[ ] Editar implementación existente
[ ] Nueva versión
[ ] Implementar
[ ] Confirmar la misma URL /exec
[ ] Ejecutar PPAppsScriptBridge.ensureReady()
[ ] Ejecutar getDeploymentStatus
[ ] Ejecutar getAppState
[ ] Confirmar catálogos, matriz y borrador en GitHub Pages
```

## 11. Archivos relevantes

```text
.clasp.json
appsscript.json
scripts/build-appscript.mjs
src/server/01-code.js
src/server/14-pages-bridge.js
src/web/bridge/Bridge.html
src/web/shared/apps-script-bridge-client.js
docs/CONFIGURACION.md
```

## 12. Nota importante

GitHub contiene la fuente editable del backend, pero no debe asumirse que el código visible en GitHub ya está publicado en Apps Script.

Son tres estados independientes:

```text
1. Código fuente en GitHub
2. Código compilado y enviado con clasp
3. Versión web publicada en /exec
```

Los tres deben coincidir para que GitHub Pages use realmente la versión más reciente del backend.
