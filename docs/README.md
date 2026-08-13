# Documentación de plangit

Índice maestro de la documentación del proyecto. Su propósito es que otra IA (o una persona)
pueda **reconstruir el proyecto desde cero** a partir de esta documentación sin tener que
re-descubrir reglas, fuentes, tablas o arquitectura leyendo todo el código.

> Regla de oro: esta documentación es una **fuente viva**. Cuando una tarea defina una fuente
> de datos nueva, una regla, o un cambio de arquitectura, debe actualizar el documento
> correspondiente **en la misma tarea** (ver [Política de mantenimiento](#política-de-mantenimiento)).

## Qué es plangit

Sistema de **Plan Maestro de Producción** (planificación semanal de una planta de manufactura):

- **Frontend**: sitio estático en **GitHub Pages** (`src/web/`).
- **Backend**: **Google Apps Script** (`src/server/`) sobre **Google Sheets**, **NetSuite** y **Google Drive**.
- **Comunicación**: el frontend invoca el backend a través de un **iframe puente** (`Bridge.html`)
  usando `window.postMessage`; dentro del puente se usa `google.script.run`.
- **Origen**: `https://rikrdo0701-cmyk.github.io/PLAN-MAESTRO-PRODUCCION/`.

Existe además un **pipeline legacy** en la raíz del repositorio (parsers + modelo lógico +
scheduler en `.js` sueltos) que alimenta una hoja "Plan Maestro" desde NetSuite. Está fuera de
`src/server` y se documenta por separado porque tiene su propio esquema de hojas.

## Orden de lectura recomendado para una IA

Seguir este orden da el contexto completo sin redundancia:

1. `.project-memory/indexes.json` — navegación de la memoria del proyecto (machine-readable).
2. `.project-memory/project.json`, `rules.json`, `data-sources.json`, `modules.json`, `integrations.json`, `structure.json`.
3. `docs/README.md` — este índice (orden de lectura).
4. `docs/PLAN-MAESTRO.md` — documento maestro: visión, capas, flujos, estados, versiones.
5. `docs/project/architecture.md` — arquitectura detallada y separación de responsabilidades.
6. `docs/project/module-map.md` — mapa de módulos con propósitos y entry points.
7. `docs/data/sources.md` — todas las fuentes de datos (hojas, columnas, readers, writers).
8. `docs/data/relationships.md` — relaciones, joins y mapeos entre tablas/hojas.
9. `docs/REGLAS.md` — catálogo canónico de reglas de negocio.
10. `OT_RULES.md` — autoridad especializada del mapeo de OT (hojas Control → Trabajos → Operaciones).
11. `docs/rules/RULES.md` — registro de reglas (índice).
12. `docs/operations/git-and-documentation-gates.md` — gobernanza de cambios y gates.
13. `docs/CONFIGURACION.md` — configuración del entorno y verificación.
14. `docs/REBUILD.md` — reconstrucción desde cero paso a paso.
15. `docs/APPS_SCRIPT_DEPLOYMENT_Y_BYPASS.md` — despliegue de Apps Script y el bridge.
16. `docs/RENDIMIENTO_GITHUB_PAGES.md` — rendimiento y caché del frontend.

## Mapa de documentos

| Documento | Contenido | Autoridad |
|---|---|---|
| `docs/PLAN-MAESTRO.md` | Visión, capas, flujos, estados, versiones | Maestro |
| `docs/project/architecture.md` | Arquitectura y responsabilidades | Arquitectura |
| `docs/project/module-map.md` | Módulos, propósitos, entry points | Estructura |
| `docs/project/glossary.md` | Glosario de términos | Terminología |
| `docs/data/sources.md` | Fuentes de datos y esquemas | Datos |
| `docs/data/relationships.md` | Relaciones y mapeos | Datos |
| `docs/REGLAS.md` | Reglas de negocio canónicas | Reglas de negocio |
| `OT_RULES.md` | Mapeo OT (hojas Control → Trabajos → Operaciones) | Reglas OT |
| `docs/rules/RULES.md` | Índice de reglas | Gobernanza |
| `docs/operations/git-and-documentation-gates.md` | Gates y política de git | Gobernanza |
| `docs/CONFIGURACION.md` | Configuración y verificación | Operación |
| `docs/REBUILD.md` | Reconstrucción desde cero | Operación |
| `docs/APPS_SCRIPT_DEPLOYMENT_Y_BYPASS.md` | Deploy Apps Script + bridge | Operación |
| `docs/RENDIMIENTO_GITHUB_PAGES.md` | Rendimiento del frontend | Operación |
| `.project-memory/*.json` | Memoria estructurada del proyecto | Machine-readable |

## Dónde está la fuente estructurada

La versión estructurada (JSON) vive en `.project-memory/` y es la que una IA debe consultar antes
de navegar código. Los documentos Markdown de `docs/` son la versión humana y deben estar
sincronizados con ella.

- Reglas: `.project-memory/rules.json` ↔ `docs/REGLAS.md` + `docs/rules/RULES.md`.
- Fuentes de datos: `.project-memory/data-sources.json` ↔ `docs/data/sources.md`.
- Módulos: `.project-memory/modules.json` ↔ `docs/project/module-map.md`.
- Integraciones: `.project-memory/integrations.json`.
- Estructura: `.project-memory/structure.json`.

## Política de mantenimiento

Toda tarea que toque el proyecto debe:

1. Leer `.project-memory/indexes.json` y los registros relevantes antes de navegar código.
2. Si descubre una regla, fuente, columna, tabla, relación o estructura nueva, **escribirla** en
   `.project-memory/` y en el documento `docs/` correspondiente **en la misma tarea**
   (Regla `RULE-GOV-003`).
3. No inferir una regla de negocio silenciosamente de la implementación: clasificarla como
   `DOCUMENTADA`, `IMPLEMENTADA`, `INFERIDA` o `AMBIGUA` y citar su fuente exacta.
4. No duplicar definiciones semánticas: cada regla tiene un solo ID canónico `RULE-<DOMINIO>-NNN`.
5. Pasar los gates de documentación y git antes de cerrar la tarea.
