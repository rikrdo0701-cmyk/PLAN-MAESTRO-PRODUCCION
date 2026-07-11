# Plan Maestro de Producción — GitHub Pages + Google Apps Script

El proyecto usa **GitHub Pages para alojar el frontend** y **Google Apps Script como backend** para Google Sheets, NetSuite y Drive.

## URLs

Frontend público:

```text
https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/
```

Backend de Apps Script:

```text
https://script.google.com/macros/s/AKfycbyCrdM3g-ixxjbvqjysQ7pdO59Bn6NQA6PECUC_YI-ByfwzC1ueWcQFx1hErWqTHVoSxw/exec
```

El backend no expone credenciales. El navegador se comunica con un iframe oculto de Apps Script mediante `postMessage`; dentro de ese iframe se utiliza `google.script.run`.

## Estructura

```text
src/
├─ server/                    # Backend de Apps Script
└─ web/
   ├─ planning/               # Interfaz principal
   ├─ operator/               # Vista de operador
   ├─ skills/                 # Matriz de habilidades
   ├─ shared/                 # Cliente del puente remoto
   └─ bridge/                 # HTML mínimo servido por Apps Script
scripts/                      # Build y validaciones
tests/                        # Pruebas
site/                         # Generado para GitHub Pages; no se versiona
dist/                         # Generado para clasp; no se versiona
```

## Instalación

```powershell
npm install
npm run check
npm test
```

## Actualizar Apps Script

```powershell
npm run build
clasp push
```

Después actualiza la implementación web existente en Apps Script. La misma URL `/exec` puede conservarse.

## Publicar el frontend

El workflow `.github/workflows/deploy-pages.yml` construye y publica el frontend automáticamente cuando hay un push a `main`.

La primera vez, configura el repositorio en:

**Settings → Pages → Build and deployment → Source: GitHub Actions**

También puedes generar y probar localmente:

```powershell
npm run build:pages
npm run preview:pages
```

Abre `http://localhost:4173`. El puente permite `localhost` para desarrollo.

## Configuración de Apps Script

En **Propiedades del script**:

| Propiedad | Uso |
|---|---|
| `PLANNING_SPREADSHEET_ID` | Google Sheets de la aplicación |
| `PHOTO_FOLDER_ID` | Carpeta de fotografías |
| `FRONTEND_ORIGIN` | `https://rikrdo0701-cmyk.github.io` |
| `NS_ACCOUNT_ID` | Cuenta NetSuite |
| `NS_CONSUMER_KEY` | Consumer key |
| `NS_CONSUMER_SECRET` | Consumer secret |
| `NS_TOKEN` | Token |
| `NS_TOKEN_SECRET` | Token secret |

Puedes configurar el origen ejecutando:

```javascript
setProductionPlanningFrontendOrigin('https://rikrdo0701-cmyk.github.io');
```

## Flujo normal de cambios

```powershell
npm run check
npm test
clasp push

git add .
git commit -m "Descripcion del cambio"
git push
```

`clasp push` actualiza el backend. `git push` activa el despliegue del frontend en GitHub Pages.
