# Catálogo integral de reglas de negocio

## Objetivo

Investigar y documentar todas las reglas de negocio relevantes del repositorio en un catálogo canónico, trazable y sin duplicados. El resultado debe servir tanto a personas como a agentes: `docs/REGLAS.md` será el índice legible y `.project-memory/rules.json` la representación estructurada.

## Alcance

La investigación cubrirá Project Memory, documentación, código de producción, pruebas, scripts, SQL/SuiteQL y configuración. Incluirá, sin limitarse a ellos, OT, planeación y secuenciación, doblado, herramentales, máquinas, capacidades, operadores, calendarios, balanceo, materiales/BOM, subcontratos, sincronización NetSuite, persistencia, publicación, terminación, reportes, inspección y permisos o restricciones operativas.

No se documentarán detalles puramente técnicos salvo que condicionen una decisión de negocio, la integridad de datos o el flujo operativo.

## Método de investigación

1. Leer primero `.project-memory/indexes.json` y los registros relacionados.
2. Inventariar fuentes candidatas por dominio y abrir solamente archivos o símbolos dirigidos.
3. Contrastar cada regla con al menos una fuente exacta. Cuando existan código y prueba, registrar ambas.
4. Distinguir claramente:
   - `DOCUMENTADA`: declarada explícitamente en una fuente escrita.
   - `IMPLEMENTADA`: comprobada en código o pruebas.
   - `INFERIDA`: deducida de evidencia indirecta y pendiente de confirmación.
   - `AMBIGUA`: evidencia incompleta o contradictoria.
5. Registrar contradicciones y vacíos sin inventar una resolución.

## Modelo canónico

Cada regla tendrá un ID globalmente único `RULE-<DOMINIO>-NNN`, nombre, estado, texto normativo, dominio, clasificación y fuentes exactas. Una regla compartida tendrá una sola definición; otros dominios usarán una referencia al ID canónico.

Las fuentes citarán rutas existentes y, cuando sea estable, símbolos o rangos de líneas. No se aceptarán referencias genéricas como “el código” o “los tests”.

## Artefactos

- `docs/REGLAS.md`: índice humano por dominio, referencias cruzadas, ambigüedades y contradicciones.
- `.project-memory/rules.json`: reglas estructuradas con IDs y evidencia.
- `.project-memory/data-sources.json`: completar orígenes, hojas/tablas, campos, lectores, escritores y reglas cuando la investigación aporte evidencia verificable.
- `.project-memory/modules.json` e `.project-memory/integrations.json`: actualizar solamente los módulos e integraciones cuya responsabilidad o restricción quede demostrada.
- `CHANGELOG.md` y `docs/changes/<TASK-ID>.md`: trazabilidad del trabajo.

## Manejo de errores y límites

- La falta de evidencia se documentará como tal; no se convertirá en una regla definitiva.
- Fuentes contradictorias producirán una entrada de contradicción con ambas referencias.
- IDs duplicados, fuentes inexistentes o JSON inválido bloquearán la aprobación.
- No se modificará código funcional ni se ejecutará despliegue.

## Validación

La tarea deberá demostrar:

1. IDs `RULE-*` globalmente únicos en documentación y Project Memory.
2. Correspondencia entre las reglas canónicas de `docs/REGLAS.md` y `.project-memory/rules.json`.
3. Existencia de todas las rutas citadas.
4. JSON válido para todos los archivos de Project Memory modificados.
5. Cobertura de cada dominio relevante encontrado, o explicación explícita de por qué no contiene reglas.
6. Ausencia de duplicados semánticos y referencias cruzadas correctas.
7. Documentation Gate, secret scan y pruebas documentales aprobadas.
8. Diff limitado a documentación, Project Memory, plan, journal y changelog autorizados.

## Criterios de aceptación

- Una persona puede localizar la regla aplicable, su estado y su evidencia sin inspeccionar todo el repositorio.
- Un agente puede consumir las mismas reglas desde Project Memory sin reinterpretar silenciosamente el código.
- Ninguna regla definitiva carece de una fuente exacta.
- Las ambigüedades y contradicciones permanecen visibles.
- El catálogo no repite una misma regla bajo IDs distintos.
