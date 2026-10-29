# Business Rules Evidence Replan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the Hybrid Orchestrator service. Required read-only specialists must finish before the single writer starts.

**Goal:** Verify and deduplicate the existing business-rule inventory, then synchronize the canonical documentation and Project Memory with deterministic evidence.

**Architecture:** Phase 1 produces a source-verified rule matrix and duplicate map without repository writes. Phase 2 permits one executor to write only rules supported by that matrix, update durable Project Memory, and run strict structural, source, scope, and Documentation Gate checks.

**Tech Stack:** Markdown, JSON, JavaScript/Google Apps Script evidence, PowerShell validation.

## Global Constraints

- No production code, tests, runtime configuration, SQL, or deployment changes.
- No definitive rule without an existing exact source.
- Preserve valid existing IDs; use one canonical definition per semantic rule.
- Treat missing or conflicting evidence explicitly as `INFERIDA` or `AMBIGUA`.
- Project Memory and `docs/REGLAS.md` must agree on canonical IDs and meanings.

---

### Task 1: Evidence gate (read-only)

**Files:** Read Project Memory first, then targeted documentation, production symbols, tests, SQL/SuiteQL, and configuration.

- [ ] Inventory every current canonical definition in `docs/REGLAS.md` and `.project-memory/rules.json`.
- [ ] For each candidate, record domain, normalized meaning, classification, exact sources, verified symbol/test, contradictions, and confidence.
- [ ] Produce a duplicate map identifying aliases, cross-domain duplicates, and ID collisions.
- [ ] Reject `IMPLEMENTADA` when no production symbol or test supports it.
- [ ] Identify additional relevant rules only from targeted verified evidence.

### Task 2: Canonical synchronization (single writer)

**Files:**
- Modify: `docs/REGLAS.md`
- Modify: `.project-memory/rules.json`
- Modify when verified knowledge exists: `.project-memory/data-sources.json`
- Modify when verified knowledge exists: `.project-memory/modules.json`
- Modify when verified knowledge exists: `.project-memory/integrations.json`

- [ ] Replace duplicate definitions with one canonical definition and non-defining references.
- [ ] Correct invalid source paths and downgrade unsupported classifications.
- [ ] Add all verified relevant rules from the evidence matrix.
- [ ] Synchronize structured records using fields `rule_id`, `name`, `status`, `rule`, `domain`, `classification`, and `sources`.
- [ ] Complete data-source readers, writers, fields, relationships, and restrictions only where exact evidence exists.

### Task 3: Deterministic closure

**Files:**
- Modify: `CHANGELOG.md`
- Create: `docs/changes/TASK-20260809-144118-CFA9.md`

- [ ] Parse every modified Project Memory JSON file.
- [ ] Verify canonical definition IDs are unique in each store and the human/structured ID sets match.
- [ ] Verify every cited repository path exists.
- [ ] Verify every `IMPLEMENTADA` rule cites a production source or test.
- [ ] Run scope validation, technical review, Documentation Gate, and secret scan.
- [ ] Record ambiguous evidence, unresolved contradictions, no-deployment status, and exact validation results.

<!-- HYBRID_TASK
{
  "id": "TASK-20260809-144118-CFA9",
  "objective": "Verify and deduplicate all relevant business rules, then synchronize the canonical catalog and Project Memory with exact evidence and deterministic validation.",
  "allowed_files": [
    "docs/REGLAS.md",
    ".project-memory/rules.json",
    ".project-memory/data-sources.json",
    ".project-memory/modules.json",
    ".project-memory/integrations.json",
    "CHANGELOG.md",
    "docs/changes/TASK-20260809-144118-CFA9.md"
  ],
  "requirements": [
    "Complete the read-only evidence matrix and semantic duplicate map before any write.",
    "Document every relevant verified business rule discovered across Project Memory, documentation, code, tests, SQL/SuiteQL, and configuration.",
    "Every definitive rule must cite an exact existing repository path; IMPLEMENTADA also requires production-symbol or test evidence.",
    "Use one globally unique canonical RULE ID per semantic rule and references for cross-domain reuse.",
    "Synchronize docs/REGLAS.md and .project-memory/rules.json.",
    "Do not modify runtime code, tests, configuration, SQL, or deployment files."
  ],
  "acceptance_criteria": [
    "Required specialist evidence covers the current 24-rule inventory, duplicate candidates, incorrect sources, unsupported classifications, and additional relevant verified rules.",
    "All modified Project Memory files parse as JSON.",
    "Canonical RULE definition IDs are unique and the human and structured catalogs contain the same canonical ID set.",
    "All cited paths exist and IMPLEMENTADA rules have code or test evidence.",
    "Documentation Gate, scope validation, secret scan, and technical review pass.",
    "No deployment is executed."
  ],
  "plan_review": {"required": false},
  "execution_plan": {
    "executor_mode": "balanced",
    "max_attempts": 2,
    "smoke_test_commands": [
      "powershell -NoProfile -Command \"Get-Content -Raw .project-memory/rules.json | ConvertFrom-Json | Out-Null; Get-Content -Raw .project-memory/data-sources.json | ConvertFrom-Json | Out-Null; Get-Content -Raw .project-memory/modules.json | ConvertFrom-Json | Out-Null; Get-Content -Raw .project-memory/integrations.json | ConvertFrom-Json | Out-Null\"",
      "powershell -NoProfile -Command \"$docIds = Select-String -Path docs/REGLAS.md -Pattern '^- \\*\\*(RULE-[A-Z0-9_-]+-\\d{3})\\*\\*' | ForEach-Object { $_.Matches[0].Groups[1].Value }; if (($docIds | Group-Object | Where-Object Count -gt 1).Count) { exit 1 }; $memoryIds = (Get-Content -Raw .project-memory/rules.json | ConvertFrom-Json).rules.rule_id; if (($memoryIds | Group-Object | Where-Object Count -gt 1).Count) { exit 1 }; if (Compare-Object ($docIds | Sort-Object) ($memoryIds | Sort-Object)) { exit 1 }\""
    ]
  },
  "validation_plan": {
    "syntax": {"required": true, "commands": ["powershell -NoProfile -Command \"Get-Content -Raw .project-memory/rules.json | ConvertFrom-Json | Out-Null; Get-Content -Raw .project-memory/data-sources.json | ConvertFrom-Json | Out-Null; Get-Content -Raw .project-memory/modules.json | ConvertFrom-Json | Out-Null; Get-Content -Raw .project-memory/integrations.json | ConvertFrom-Json | Out-Null\""]},
    "functional_tests": {"required": true, "commands": ["powershell -NoProfile -Command \"$docIds = Select-String -Path docs/REGLAS.md -Pattern '^- \\*\\*(RULE-[A-Z0-9_-]+-\\d{3})\\*\\*' | ForEach-Object { $_.Matches[0].Groups[1].Value }; $memoryIds = (Get-Content -Raw .project-memory/rules.json | ConvertFrom-Json).rules.rule_id; if (($docIds | Group-Object | Where-Object Count -gt 1).Count -or ($memoryIds | Group-Object | Where-Object Count -gt 1).Count -or (Compare-Object ($docIds | Sort-Object) ($memoryIds | Sort-Object))) { exit 1 }\""]},
    "technical_review": {"required": true, "reviewer": "laguna"},
    "visual_review": {"required": false, "reviewer": "mimo", "files": []}
  },
  "specialist_plan": [
    {"id": "inventory_audit", "role": "Audit every existing rule, source, classification, and ID", "required": true, "depends_on": []},
    {"id": "planning_evidence", "role": "Verify planning, resources, capacity, calendar, lifecycle, and production rules against symbols and tests", "required": true, "depends_on": ["inventory_audit"]},
    {"id": "boundary_evidence", "role": "Verify NetSuite, storage, reporting, inspection, publishing, and data-integrity rules against symbols and tests", "required": true, "depends_on": ["inventory_audit"]},
    {"id": "semantic_dedup", "role": "Produce the canonical duplicate map, corrected classifications, source fixes, and proposed canonical ID set", "required": true, "depends_on": ["planning_evidence", "boundary_evidence"]},
    {"id": "acceptance_review", "role": "Check evidence completeness and deterministic acceptance coverage before writer execution", "required": true, "depends_on": ["semantic_dedup"]}
  ],
  "documentation_plan": {
    "rules_affected": ["all verified business-rule domains"],
    "data_sources_affected": ["all verified rule-bearing repository data sources"],
    "module_docs": ["docs/REGLAS.md", ".project-memory/rules.json", ".project-memory/data-sources.json", ".project-memory/modules.json", ".project-memory/integrations.json"],
    "adr_required": false,
    "changelog_required": true,
    "task_journal_required": true
  },
  "commit_message": "docs(rules): verify and synchronize canonical catalog",
  "hybrid_subagents": {"mode": "auto", "strategy": "read_only_specialists"},
  "cloud_allowed": true
}
HYBRID_TASK_END -->
