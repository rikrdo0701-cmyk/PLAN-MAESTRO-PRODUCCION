# Canonical Business Rules Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use Hybrid Orchestrator read-only specialists to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a canonical, non-duplicating index of verified business rules already implemented or documented in the repository.

**Architecture:** `docs/REGLAS.md` is the human index, `.project-memory/indexes.json` is machine navigation, and existing source documents/code remain authoritative. Read-only specialists audit separate domains; one executor writes the consolidated result.

**Tech Stack:** Markdown, JSON, repository source/tests/configuration, PowerShell validation.

## Global Constraints

- Do not modify application logic, tests, SQL, or configuration.
- Do not duplicate full rule text.
- Cite exact repository-relative files and symbols/headings.
- Never promote inferred or ambiguous behavior to a definitive rule.
- Preserve `OT_RULES.md` as the specialized OT authority.

---

### Task 1: Audit rule sources by domain

**Files:**
- Read: repository documentation, source, tests, fixtures, SQL/SuiteQL, and configuration
- Modify: none

**Interfaces:**
- Consumes: existing repository evidence
- Produces: structured findings for OT, doblado, herramentales, máquinas, matriz de capacidad, balanceo, and BOM

- [ ] Search each domain independently using Hybrid read-only specialists.
- [ ] Record exact source path, symbol/heading, concise behavior, and evidence strength.
- [ ] Classify every finding as `DOCUMENTADA`, `IMPLEMENTADA`, `INFERIDA`, or `AMBIGUA`.
- [ ] Record duplicates and contradictions without resolving them silently.

### Task 2: Verify existing machine-readable project navigation

**Files:**
- Read only: `.project-memory/indexes.json`

**Interfaces:**
- Consumes: Task 1 findings
- Produces: validation evidence for the existing project memory; no project-memory writes

- [ ] Preserve all `.project-memory` files byte-for-byte.
- [ ] Use the existing read order as discovery context without expanding write scope.
- [ ] Parse with PowerShell: `Get-Content -Raw .project-memory/indexes.json | ConvertFrom-Json | Out-Null`.

### Task 3: Populate the canonical rules index

**Files:**
- Modify: `docs/REGLAS.md`

**Interfaces:**
- Consumes: Task 1 findings and `.project-memory/indexes.json`
- Produces: human-readable canonical index with stable IDs and source links

- [ ] Define the index purpose, status vocabulary, ID convention, and non-duplication policy.
- [ ] Add sections for all seven domains.
- [ ] Add one row per verified finding: ID, summary, status, and exact source.
- [ ] Explicitly mark domains or behaviors with insufficient evidence.
- [ ] Add a contradictions/ambiguities section when applicable.

### Task 4: Validate coverage and integrity

**Files:**
- Verify: `.project-memory/indexes.json`
- Verify: `docs/REGLAS.md`

**Interfaces:**
- Consumes: completed indexes
- Produces: deterministic validation evidence

- [ ] Verify JSON parses successfully.
- [ ] Verify every `RULE-*` ID is unique.
- [ ] Verify each referenced repository path exists.
- [ ] Verify all seven domain headings exist.
- [ ] Review that summaries do not copy full source rules and no application file changed.

<!-- HYBRID_TASK
{
  "id": "TASK-20260809-125520-4FE9",
  "objective": "Create the canonical non-duplicating index in docs/REGLAS.md using business rules verified across documentation, code, tests, SQL/configuration for OT, doblado, herramentales, máquinas, matriz de capacidad, balanceo, and BOM; preserve the existing project memory unchanged.",
  "allowed_files": ["docs/REGLAS.md"],
  "requirements": [
    "Reuse reports/TASK-20260809-114212-1B33.hybrid-subagents.json and its context packet as read-only evidence; do not repeat broad discovery unless a cited source needs verification.",
    "Use docs/REGLAS.md as the human canonical index and preserve OT_RULES.md as specialized OT authority.",
    "Audit documentation, code, tests, fixtures, SQL/SuiteQL, and configuration with segmented read-only specialists.",
    "Use stable RULE-* IDs, concise summaries, classification, and exact source links without duplicating full rules.",
    "Classify findings as DOCUMENTADA, IMPLEMENTADA, INFERIDA, or AMBIGUA and record contradictions explicitly.",
    "Cover OT, doblado, herramentales, máquinas, matriz de capacidad, balanceo, and BOM without changing application behavior."
  ],
  "acceptance_criteria": [
    "Existing .project-memory files remain unchanged and are treated as read-only project context.",
    "docs/REGLAS.md contains all seven domains and unique RULE-* IDs.",
    "Every definitive entry cites an existing exact repository source; insufficient evidence is marked explicitly.",
    "Only docs/REGLAS.md is modified by the executor.",
    "No deployment is performed."
  ],
  "plan_review": {"required": false},
  "execution_plan": {
    "executor_mode": "balanced",
    "max_attempts": 2,
    "smoke_test_commands": [
      "powershell -NoProfile -Command \"Get-Content -Raw .project-memory/indexes.json | ConvertFrom-Json | Out-Null\"",
      "powershell -NoProfile -Command \"if ((Select-String -Path docs/REGLAS.md -Pattern '^## (OT|Doblado|Herramentales|Máquinas|Matriz de capacidad|Balanceo|BOM)$').Count -ne 7) { exit 1 }\""
    ]
  },
  "validation_plan": {
    "syntax": {"required": true, "commands": ["powershell -NoProfile -Command \"Get-Content -Raw .project-memory/indexes.json | ConvertFrom-Json | Out-Null\""]},
    "functional_tests": {"required": true, "commands": ["powershell -NoProfile -Command \"$ids = Select-String -Path docs/REGLAS.md -Pattern 'RULE-[A-Z0-9-]+' -AllMatches | ForEach-Object { $_.Matches.Value }; if (($ids | Sort-Object -Unique).Count -ne $ids.Count) { exit 1 }\""]},
    "technical_review": {"required": true, "reviewer": "laguna"},
    "visual_review": {"required": false, "reviewer": "mimo", "files": []}
  },
  "hybrid_subagents": {
    "mode": "auto",
    "strategy": "read_only_specialists"
  },
  "documentation_plan": {
    "rules_affected": ["OT", "doblado", "herramentales", "máquinas", "matriz de capacidad", "balanceo", "BOM"],
    "data_sources_affected": [],
    "module_docs": ["docs/REGLAS.md"],
    "adr_required": false,
    "changelog_required": true,
    "task_journal_required": true
  },
  "commit_message": "docs(rules): add canonical business rules index",
  "cloud_allowed": true
}
HYBRID_TASK_END -->
