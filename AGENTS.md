# Project instructions — plangit

## Context order

1. Read `.project-memory/indexes.json`.
2. Read the relevant rule/data/module records.
3. Open only the code files/symbols referenced by Project Memory or required to verify a gap.
4. If code reveals missing or stale knowledge, update Project Memory and the corresponding docs in the same TASK.

## Non-negotiable

- Do not infer a business rule silently from implementation.
- Document exact data origin, table/sheet, columns/fields, readers, writers, relationships and restrictions.
- Preserve one writer per repository.
- New remotes are private and independent.
- Git push is performed only by Git Gate after Codex APPROVE.
