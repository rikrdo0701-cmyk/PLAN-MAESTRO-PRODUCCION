# Git and Documentation Gates

> Gobernanza de cambios de **plangit**. Complementa `AGENTS.md` (orden de contexto y reglas
> no negociables) y el ADR `docs/architecture/decisions/ADR-0001-project-memory-private-git.md`.

## 1. Reglas no negociables

| Regla | Contenido |
|---|---|
| `RULE-GIT-001` | Todo proyecto sin remote recibe un repositorio **remoto independiente y privado**. Nunca se reutiliza el remote de otro proyecto. |
| `RULE-GIT-002` | El **push a origin** se ejecuta solo a través del **Git Gate**: validación, Documentation Gate, secret scan y APPROVE final (Codex). |
| `RULE-GOV-001` | **Project Memory first**: consultar `.project-memory/indexes.json` y los registros relevantes antes de navegar código; abrir solo el código puntual necesario. |
| `RULE-GOV-002` | **Single writer**: un solo writer modifica el repositorio a la vez; los especialistas son read-only. |
| `RULE-GOV-003` | **Document discovered knowledge**: cualquier regla, fuente, columna, tabla, relación o estructura descubierta leyendo código se escribe en `.project-memory/` y en el doc `docs/` correspondiente **en la misma TASK**. |

## 2. Ciclo de una TASK

```text
1. Contexto    → leer indexes.json + registros relevantes (nunca explorar el repo en frío)
2. Alcance     → solo los archivos/modulos/hojas de la TASK
3. Tests       → ejecutar la suite (npm test, 347 pruebas) y/o pruebas dirigidas
4. Build       → npm run build / npm run check en verde
5. Documentation Gate → si se descubrió conocimiento, actualizar memoria + docs en la misma TASK
6. Secret scan → verificar que no se versionan credenciales (.clasp.json, NS_*, IDs de libros)
7. Commit      → commit scoped a la TASK, mensaje descriptivo en el idioma del repo
8. APPROVE     → revisión y aprobación final (Codex) antes de cualquier push
9. Push        → solo el Git Gate envía a origin del proyecto
```

## 3. Documentation Gate — checklist

- [ ] `.project-memory/indexes.json` apunta a los registros correctos y `updated_at` vigente.
- [ ] Reglas nuevas/descubiertas: `.project-memory/rules.json` ↔ `docs/REGLAS.md` ↔ `docs/rules/RULES.md`.
- [ ] Fuentes nuevas/descubiertas: `.project-memory/data-sources.json` ↔ `docs/data/sources.md` ↔ `docs/data/relationships.md`.
- [ ] Módulos nuevos: `.project-memory/modules.json` ↔ `docs/project/module-map.md`.
- [ ] Si cambió arquitectura/topología: `docs/project/architecture.md` (+ ADR si aplica).
- [ ] `docs/README.md` actualizado (mapa de documentos y orden de lectura) si se añadió/renombró un doc.

## 4. Convenciones de git

- **Remotes**: privados e independientes; `origin` del proyecto es único.
- **Commit**: scoped a la TASK, sin mezclar cambios no relacionados; nunca commitear secretos.
- **Push**: exclusivamente tras APPROVE y secret scan; sin `--force`.
- **Rollback**: el historial remoto es la fuente de recuperación (ADR-0001).
