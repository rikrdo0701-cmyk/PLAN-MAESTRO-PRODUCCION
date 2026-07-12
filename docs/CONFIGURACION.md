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

---

# Registro de incidencias y cambios — julio de 2026

## Contexto

Se migró el frontend del Plan Maestro de Producción a GitHub Pages, manteniendo Google Apps Script como backend para Google Sheets, NetSuite y Google Drive.

Frontend público:

```text
https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/
```

Backend:

```text
https://script.google.com/macros/s/AKfycbyCrdM3g-ixxjbvqjysQ7pdO59Bn6NQA6PECUC_YI-ByfwzC1ueWcQFx1hErWqTHVoSxw/exec
```

## Errores detectados

### 1. El frontend mostraba datos demo o desactualizados

Síntomas:

- Operadores, capacidades y matriz visibles en la página no coincidían con Google Sheets.
- `GOOGLE SHEETS` devolvía datos correctos, pero `PÁGINA` conservaba cantidades diferentes.
- El catálogo de operaciones sí coincidía, pero operadores, capacidades y asignaciones no.

Causa:

- El frontend mantenía estado local antiguo.
- La carga inicial podía conservar datos locales cuando la revisión coincidía.
- `performance-client.js` interfería con la carga principal y permitía conservar datos anteriores.

Corrección:

- Se forzó la carga completa de `getAppState` desde Apps Script.
- Se cambió `preserveLocalPlanning` a `false` durante la carga inicial compartida.
- Se aseguró que Google Sheets fuera la fuente principal de catálogos, matriz y operadores.

### 2. El borrador no aparecía en GitHub Pages

Síntomas:

- Las OTs seleccionadas existían en un borrador, pero no aparecían al abrir GitHub Pages.
- Apps Script y GitHub Pages usaban orígenes distintos de `localStorage`.

Causa:

- El estado local de Apps Script no era compartido con el origen de GitHub Pages.
- El arranque no recuperaba correctamente un borrador guardado o una instantánea reciente.

Corrección:

- Se agregó recuperación del borrador desde:
  - `lastSchedule.scheduledOts`;
  - operaciones ya programadas;
  - instantáneas compartidas del plan.
- Se restauran OTs seleccionadas, operaciones, bloqueos, expansión y metadatos del borrador.

### 3. Advertencias por fechas inválidas en campos HTML

Síntoma:

```text
The specified value "29/04/2026" does not conform to the required format, "yyyy-MM-dd".
```

Causa:

- Los campos HTML `type="date"` requieren `yyyy-MM-dd`.
- Algunas fechas llegaban como `dd/mm/yyyy`.

Impacto:

- Eran advertencias del navegador.
- No eran la causa principal de que no cargaran catálogos o matriz.

Pendiente recomendado:

- Normalizar siempre las fechas antes de colocarlas en inputs `type="date"`.

### 4. El despliegue mostraba el README en lugar de la aplicación

Síntoma:

La URL pública mostraba:

```text
PLAN-MAESTRO-PRODUCCION
Plan Maestro de Producción — GitHub Pages + Google Apps Script
```

Causa:

- GitHub Pages estaba configurado como `Deploy from a branch`, usando `main / root`.
- GitHub renderizaba `README.md` como página principal.

Corrección requerida en GitHub:

```text
Settings → Pages → Build and deployment → Source: GitHub Actions
```

Después se debe ejecutar manualmente:

```text
Actions → Desplegar frontend en GitHub Pages → Run workflow
```

### 5. El workflow no generaba correctamente el sitio

Causa inicial:

- El workflow subía la carpeta `site` sin garantizar que antes se ejecutara la compilación.

Corrección:

- Se agregó `npm run build` antes de `upload-pages-artifact`.
- El workflow final publica la carpeta `site`.

Flujo esperado:

```text
npm install
npm run build
configure-pages
upload-pages-artifact
publish
```

### 6. Caché PWA conservaba versiones antiguas

Síntomas:

- La página seguía mostrando una versión anterior del HTML.
- Los cambios podían no aparecer incluso usando un parámetro `?v=`.

Causa:

- El Service Worker usaba estrategia `cache-first` también para navegación.
- `index.html` podía quedar servido desde una caché anterior.

Correcciones:

- Se incrementó el nombre del caché PWA.
- Para navegación se cambió a estrategia `network-first` con `cache: "no-store"`.
- Se mantuvo caché como respaldo cuando no hay red.

Procedimiento de limpieza manual, cuando sea necesario:

```javascript
navigator.serviceWorker.getRegistrations()
  .then(registrations => Promise.all(registrations.map(r => r.unregister())))
  .then(() => caches.keys())
  .then(keys => Promise.all(keys.map(key => caches.delete(key))))
  .then(() => location.reload());
```

### 7. La aplicación se congelaba al mover tarjetas

Síntomas:

- Al mover una tarjeta entre backlog y planeado, la página se congelaba.
- En algunos casos todo desaparecía y después volvía a aparecer.
- Reordenar varias tarjetas producía bloqueos visibles.

Causas detectadas:

- Cada movimiento reconstruía completamente el backlog.
- `getPriorityJobs()` recorría repetidamente operaciones, materiales y órdenes.
- `materialsForOt()` filtraba toda la lista de materiales por cada tarjeta.
- `workOrderForOt()` buscaba linealmente la OT en cada render.
- El historial de deshacer copiaba una parte muy grande del estado.
- `localStorage.setItem(JSON.stringify(state))` podía bloquear el hilo principal.
- El guardado remoto podía coincidir con renderizados pesados.
- Un error de guardado podía devolver temporalmente una OT al backlog.

## Optimizaciones aplicadas

### Guardado en segundo plano

Se implementó una cola de guardado con:

- Debounce aproximado de 850 ms.
- Reintentos progresivos.
- Guardados secuenciales.
- Consolidación de varios movimientos en una sola escritura.
- Mantener la tarjeta en pantalla aunque el guardado remoto quede pendiente.

Reintentos configurados:

```text
1.2 s
2.5 s
5 s
10 s
20 s
```

### Guardado parcial por alcance

Se separaron cargas para:

- Planificación.
- Catálogos.
- Matriz y habilidades.

Esto evita enviar todos los catálogos y materiales cada vez que se mueve una tarjeta.

### Optimización de caché local

- El guardado en `localStorage` se difiere con `requestIdleCallback` cuando está disponible.
- Los materiales no se duplican en el estado local compacto usado para caché.

### Renderizado de tarjetas

- Se agruparon renderizados con `requestAnimationFrame`.
- El backlog se puede renderizar en tiempo inactivo.
- Se agregó `content-visibility: auto`.
- Las imágenes usan carga diferida y decodificación asíncrona.

### Índices en memoria

Se agregaron índices por OT para:

- Materiales.
- Órdenes de trabajo.

Esto evita recorrer todos los arreglos en cada tarjeta.

### Historial de deshacer reducido

Para movimientos de cola se guarda solamente:

- OTs seleccionadas.
- OTs bloqueadas.
- OTs expandidas.
- Prioridades y estado de bloqueo de las operaciones.

Ya no se copia todo el estado en cada movimiento.

## Marcador de optimización

La versión de optimización fluida incluye:

```javascript
window.__PP_FLUID_BUILD__
```

Valor esperado:

```text
fluid-2026-07-11-03
```

En consola también debe aparecer:

```text
[Plan Maestro] optimizacion activa fluid-2026-07-11-03
```

## Commits relevantes

```text
50e8b5fc0b941ffab0c26fe322960d45d8060a88  Puente y fotografías
8d5468e770cdfeb638da6d14a8be5c0f58a8ee3d  Ajustes del puente
324c9403602191d3c6c96cf128607c4d53935116  Versión 2.41.1
526c7f55dd0d7860727b63409e7fb65c5b85b7a1  Caché PWA 2.41.1
a2f55118fa66bf0137155670ca528a8ff6af8db6  Importación de workOrders y colecciones
7bea821d5171e882a87739e7fbb44c13f6cbfd2e  Recuperación de borradores
3e36b57ced698328880831dcebe2f9eb6be0e3f8  Build antes de publicar Pages
178fe9178d1ff806cfafff372e4d144469a1285f  Carga completa desde Google Sheets
35461bf5c1554ca403c4fd6ab7136fb32b77199c  Guardado en segundo plano y optimización inicial
bfa20f8ffb02d5ec27c65418a047ee30bf4be234  Cliente de optimización fluida
6c15959a1e7a84e978b17535d900601d294b6113  Integración del cliente fluido y renovación PWA
```

## Verificación final recomendada

1. Confirmar `Source: GitHub Actions` en Settings → Pages.
2. Ejecutar el workflow manualmente.
3. Confirmar que `build` y `deploy` estén en verde.
4. Abrir la URL pública.
5. Verificar en consola:

```javascript
window.__PP_FLUID_BUILD__
```

6. Comparar backend contra página:

```javascript
PPAppsScriptBridge.call("getAppState", []).then(s => {
  console.log("GOOGLE SHEETS:", {
    operadores: s.operators?.length || 0,
    capacidades: s.configuredCapabilities?.length || 0,
    catalogoOperaciones: s.operationCatalog?.length || 0,
    clavesMatriz: Object.keys(s.matrix || {}).length
  });

  console.log("PÁGINA:", {
    operadores: state.operators?.length || 0,
    capacidades: state.configuredCapabilities?.length || 0,
    catalogoOperaciones: state.operationCatalog?.length || 0,
    clavesMatriz: Object.keys(state.matrix || {}).length
  });
});
```

7. Probar movimientos rápidos entre backlog y planeado.
8. Recargar y confirmar que el orden final se conservó.
9. Verificar que el borrador se recupere.

## Observaciones importantes

- Los cambios de GitHub Pages no actualizan automáticamente Apps Script.
- Para modificar el backend se requiere:

```powershell
git pull origin main
npm install
npm run build
clasp push --force
```

- Después de `clasp push`, se debe publicar una nueva versión de la aplicación web de Apps Script.
- El frontend y Apps Script tienen orígenes distintos y no comparten `localStorage`.
- Google Sheets debe considerarse la fuente principal del estado compartido.
