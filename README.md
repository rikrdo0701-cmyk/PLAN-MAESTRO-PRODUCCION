# Plan Maestro de Producción — GitHub + Google Apps Script

Proyecto reorganizado para que **GitHub sea la fuente de verdad** y Google Apps Script reciba únicamente los archivos generados en `dist/`.

## Estructura

```text
src/
├─ server/                   # Backend de Apps Script
└─ web/
   ├─ planning/              # HTML, CSS, motor y aplicación principal separados
   ├─ operator/              # Vista de operador
   └─ skills/                # Matriz de habilidades
scripts/                     # Build y validaciones
tests/                       # Pruebas del motor y del build
dist/                        # Generado; no se versiona
legacy/                      # Prototipo anterior no desplegado
.github/workflows/           # Validación y despliegue manual
```

La ruta principal sirve `Index.html`. También están disponibles:

- `?app=operator` — plan de operador.
- `?app=skills` — matriz de habilidades.

## Requisitos

- Node.js 20 o superior.
- Git.
- `clasp`: `npm install -g @google/clasp`.
- Apps Script API habilitada en la cuenta de Google.

## Preparación local

```powershell
npm run check
npm test
clasp login
Copy-Item .clasp.json.example .clasp.json
```

Edita `.clasp.json` y sustituye `REEMPLAZA_CON_TU_SCRIPT_ID` por el ID del proyecto de Apps Script.

## Configuración de Apps Script

Los IDs y credenciales no se guardan en GitHub. En **Configuración del proyecto → Propiedades del script**, agrega:

| Propiedad | Uso |
|---|---|
| `PLANNING_SPREADSHEET_ID` | ID del Google Sheets usado como base de datos |
| `PHOTO_FOLDER_ID` | Carpeta de Drive con fotografías, opcional |
| `NS_ACCOUNT_ID` | Cuenta de NetSuite |
| `NS_CONSUMER_KEY` | Consumer key de NetSuite |
| `NS_CONSUMER_SECRET` | Consumer secret de NetSuite |
| `NS_TOKEN` | Token de NetSuite |
| `NS_TOKEN_SECRET` | Token secret de NetSuite |

También puedes ejecutar una vez desde el editor:

```javascript
setProductionPlanningSpreadsheet('ID_DE_TU_GOOGLE_SHEETS');
setProductionPlanningPhotoFolder('ID_DE_LA_CARPETA');
```

## Compilar y subir

```powershell
npm run build
clasp push
clasp open-script
```

`npm run build` combina:

- `src/web/planning/index.template.html`
- `src/web/planning/styles.css`
- `src/web/planning/planner-core.js`
- `src/web/planning/app.js`

El resultado es el `dist/Index.html` compatible con Apps Script.

## Publicar como aplicación web

En Apps Script:

1. **Implementar → Nueva implementación**.
2. Tipo: **Aplicación web**.
3. Ejecutar como: el propietario del proyecto.
4. Seleccionar el nivel de acceso permitido por la cuenta o dominio.
5. Implementar y conservar la URL `/exec`.

Después de cambiar código:

```powershell
npm run push
```

Actualiza la implementación desde Apps Script o crea una nueva versión con `clasp version` y `clasp deploy`.

## Flujo de GitHub

```powershell
git init
git add .
git commit -m "Convertir plan maestro a GitHub y Apps Script"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
git push -u origin main
```

El workflow `Validar proyecto` ejecuta el build, revisa sintaxis y corre pruebas en cada push o pull request.

### Despliegue manual desde GitHub Actions

El workflow `Desplegar a Apps Script` requiere dos secretos del repositorio:

- `CLASPRC_JSON`: contenido de `~/.clasprc.json`.
- `CLASP_JSON`: contenido de `.clasp.json`.

No publiques estos archivos ni sus tokens.

## Archivos que no deben editarse

No edites `dist/` ni los HTML directamente dentro de Apps Script. Modifica `src/`, ejecuta `npm run check` y después `clasp push`.
