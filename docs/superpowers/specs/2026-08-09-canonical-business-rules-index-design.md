# Canonical Business Rules Index Design

## Objective

Create a non-duplicating, traceable index of business rules already present in the repository.

## Design

- `docs/REGLAS.md` is the human-readable canonical index.
- `OT_RULES.md` remains the specialized authority for OT mapping.
- `.project-memory/indexes.json` is the machine-readable navigation layer and points to the canonical index and source files.
- Full rule text stays in its original source. The index stores only a stable `RULE-*` ID, domain, concise summary, status, and exact source link.

## Discovery

Hybrid read-only specialists audit these domains independently: OT, doblado, herramentales, máquinas, matriz de capacidad, balanceo, and BOM. They inspect documentation, source code, tests, fixtures, SQL/SuiteQL, and configuration. One writer merges verified findings.

## Classification

- `DOCUMENTADA`: an explicit authoritative document exists.
- `IMPLEMENTADA`: behavior is verified in code/tests but lacks a formal rule document.
- `INFERIDA`: evidence suggests behavior but does not establish it conclusively.
- `AMBIGUA`: sources conflict or a required decision is absent.

`IMPLEMENTADA` entries link directly to the file and symbol. `INFERIDA` and `AMBIGUA` entries must state the evidence gap and must not be presented as definitive behavior.

## Validation

- Every index entry has a unique stable ID and an existing source link.
- No full rule is copied into the index.
- Contradictions are recorded, never silently reconciled.
- All seven domains are represented, even when the result is explicitly “no verified rule found”.
- JSON project memory parses successfully and links back to `docs/REGLAS.md`.

## Scope

This task changes documentation and project memory only. It does not change application behavior or deploy anything.
