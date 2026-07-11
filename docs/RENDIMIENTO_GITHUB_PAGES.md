# Migración a GitHub Pages y optimización de rendimiento

## Objetivo

Separar la aplicación en dos capas:

- **Frontend:** GitHub Pages, responsable de HTML, CSS, JavaScript, renderizado y caché del navegador.
- **Backend:** Google Apps Script, responsable de Google Sheets, NetSuite, Drive, reglas de persistencia y control de revisiones.

La URL pública del frontend será:

```text
https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/
```

El backend permanece en:

```text
https://script.google.com/macros/s/AKfycbyCrdM3g-ixxjbvqjysQ7pdO59Bn6NQA6PECUC_YI-ByfwzC1ueWcQFx1hErWqTHVoSxw/exec
```

## Trabajo realizado

### 1. Conversión del proyecto a GitHub + Apps Script

El proyecto original estaba compuesto por archivos `.js` y HTML administrados directamente en Apps Script. Se reorganizó con esta estructura:

```text
src/
├─ server/              Backend para Google Apps Script
└─ web/
   ├─ planning/         Interfaz principal y motor de planeación
   ├─ operator/         Vista de operador
   ├─ skills/           Matriz de habilidades
   ├─ bridge/           Puente seguro con Apps Script
   └─ shared/           Clientes compartidos
scripts/                Compilación y validaciones
tests/                  Pruebas automáticas
docs/                   Documentación
site/                   Build generado para GitHub Pages
dist/                   Build generado para Apps Script
```

`dist/` y `site/` son generados; no deben editarse manualmente.

### 2. Frontend alojado en GitHub Pages

El workflow `.github/workflows/deploy-pages.yml`:

1. Descarga el repositorio.
2. Instala Node.js.
3. Ejecuta las validaciones.
4. Genera `site/`.
5. Publica `site/` en GitHub Pages.

El usuario entra por GitHub Pages. Apps Script deja de servir la interfaz principal y queda como backend.

### 3. Puente entre GitHub Pages y Apps Script

`google.script.run` solo funciona dentro de una página servida por Apps Script. Para conservar las funciones existentes se agregó un puente:

```text
GitHub Pages
    │ postMessage
    ▼
iframe oculto /exec?app=bridge
    │ google.script.run
    ▼
Funciones de Apps Script
```

El puente valida el origen permitido mediante `FRONTEND_ORIGIN` y solo permite métodos registrados explícitamente.

Configurar una vez en Apps Script:

```javascript
setProductionPlanningFrontendOrigin('https://rikrdo0701-cmyk.github.io');
```

## Mejoras de rendimiento implementadas

### 1. Renderizado inmediato desde caché local

La aplicación conserva el último estado en `localStorage`. Al abrirse:

1. Renderiza inmediatamente el último estado disponible.
2. Inicia la conexión con Apps Script en segundo plano.
3. Consulta únicamente la revisión actual.
4. Descarga el estado completo solo cuando la revisión cambió.

Esto aplica el patrón **stale-while-revalidate**: se muestra información local de inmediato y después se valida contra el servidor.

### 2. Consulta ligera de revisión

Se añadió:

```javascript
getAppRevision()
```

Esta función solo lee la tabla `CONFIG` y devuelve:

- revisión;
- versión de esquema;
- versión de aplicación;
- fecha de guardado;
- fecha de sincronización.

Cuando la revisión local y remota coinciden, no se descarga nuevamente el estado completo.

### 3. Estado incremental

Se añadió:

```javascript
getAppStateIfChanged(clientRevision, options)
```

Comportamiento:

- Si la revisión no cambió, devuelve `unchanged: true`.
- Si cambió, devuelve el estado actualizado.
- Los materiales se excluyen del arranque inicial para reducir el tamaño de la respuesta.

### 4. Materiales bajo demanda

Los materiales dejaron de formar parte obligatoria del bootstrap inicial. Cuando el usuario abre el detalle de una OT se llama:

```javascript
getMaterialsForOt(ot, revision)
```

Solo se descargan los componentes de la OT seleccionada. El resultado se integra al caché local.

Al generar un plan se mantiene la sincronización completa de operaciones y materiales, porque el motor necesita datos actualizados para programar.

### 5. Históricos cargados solo al abrir Reportes

La lista de snapshots ya no se solicita durante el arranque. Se carga la primera vez que el usuario entra a **Reportes**.

Esto elimina una lectura innecesaria de `PLANES_HISTORICOS` durante la apertura normal de la aplicación.

### 6. Sincronización automática de NetSuite limitada

Antes, la aplicación intentaba sincronizar OTs en cada apertura. Ahora solo se hace automáticamente cuando:

- no existe caché de órdenes; o
- la última sincronización tiene 15 minutos o más.

La sincronización manual continúa disponible y no está limitada por este intervalo.

### 7. Respuesta reducida para sincronización de OTs

Se añadió:

```javascript
syncNetSuiteWorkOrdersLite()
```

Actualiza las OTs en Apps Script, pero devuelve al navegador únicamente:

- órdenes de trabajo;
- estatus de operación;
- metadatos de planta;
- revisión y fecha de sincronización.

No devuelve operaciones, materiales, catálogos y configuraciones que el navegador ya posee.

### 8. Guardado parcial del plan

El guardado anterior ejecutaba `saveAppState()`, reescribía numerosas tablas y luego volvía a leer todo el estado para devolverlo al navegador.

Se añadió:

```javascript
savePlanningStateOptimized(payload)
```

Para cambios normales del plan solo actualiza:

- `CONFIG`;
- `OPERACIONES`;
- `ORDENES_TRABAJO`;
- `CONFIGURACION_OT`;
- `ESTADOS_OPERACION_PLAN`;
- `AUDITORIA`.

No reescribe:

- materiales;
- calendario;
- herramentales;
- matriz;
- operadores;
- subcontratos;
- tipos de OT.

Los catálogos y la matriz siguen usando sus guardados parciales propios:

```javascript
saveCatalogState()
saveSkillState()
```

### 9. Caché estático y modo instalable

GitHub Pages genera:

```text
site/manifest.webmanifest
site/sw.js
```

El service worker almacena el shell de la aplicación:

- página principal;
- vista de operador;
- vista de habilidades;
- manifiesto.

Esto acelera visitas posteriores y permite abrir la interfaz básica aunque la red sea lenta. Las operaciones que necesitan Sheets o NetSuite continúan requiriendo conexión con Apps Script.

## Flujo de apertura optimizado

```text
1. El navegador abre GitHub Pages.
2. El service worker entrega el frontend desde caché cuando está disponible.
3. localStorage muestra el último plan inmediatamente.
4. El frontend consulta getAppRevision().
5. Si la revisión coincide, no descarga el estado.
6. Si cambió, descarga un bootstrap sin materiales.
7. Los materiales se solicitan al abrir una OT.
8. Los históricos se solicitan al abrir Reportes.
9. NetSuite se sincroniza automáticamente solo si los datos están vencidos.
```

## Flujo de desarrollo y despliegue

### Cambios de frontend

```powershell
npm run check
npm test
git add .
git commit -m "Descripcion del cambio"
git push
```

GitHub Actions publica automáticamente el frontend en GitHub Pages.

### Cambios de backend

```powershell
npm run check
npm test
npm run build
clasp push
```

Después se debe actualizar la implementación existente:

```text
Apps Script → Implementar → Administrar implementaciones
→ Editar → Nueva versión → Implementar
```

### Cambios que afectan ambas capas

Ejecutar ambos flujos: `git push` y `clasp push`.

## Validación

Antes de publicar se ejecutan:

```powershell
npm run check
npm test
```

Las validaciones comprueban:

- sintaxis del backend;
- generación de Apps Script;
- generación de GitHub Pages;
- presencia del puente;
- presencia de carga incremental;
- presencia del guardado optimizado;
- generación del manifest y service worker;
- pruebas del motor de planeación.

## Seguridad

No se publican en GitHub:

- `.clasp.json`;
- `.clasprc.json`;
- credenciales de NetSuite;
- IDs configurados mediante Propiedades del script.

El puente solo acepta el origen configurado y una lista cerrada de funciones.

## Limitaciones actuales

- La primera consulta de Apps Script después de un periodo de inactividad puede tener arranque en frío.
- Las sincronizaciones completas de NetSuite siguen dependiendo del tiempo de los RESTlets.
- El service worker acelera archivos estáticos, no consultas de Sheets o NetSuite.
- La aplicación muestra el último caché mientras valida la revisión; durante unos instantes puede verse información anterior, que se reemplaza si hubo cambios.

## Indicadores recomendados

Para medir la mejora conviene registrar:

- tiempo hasta primer render;
- tiempo de `getAppRevision()`;
- porcentaje de aperturas sin descarga completa;
- tamaño del bootstrap;
- tiempo de carga de materiales por OT;
- duración de guardado del plan;
- duración de sincronización de NetSuite.

