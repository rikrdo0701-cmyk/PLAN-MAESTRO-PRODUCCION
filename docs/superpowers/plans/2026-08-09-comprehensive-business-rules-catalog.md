# Comprehensive Business Rules Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the Hybrid Orchestrator service to implement this plan task-by-task. Specialists are read-only and one executor is the sole writer.

**Goal:** Build a complete, evidence-backed, non-duplicating catalog of all relevant business rules in the repository.

**Architecture:** Read Project Memory first, then use segmented read-only investigation across documentation, production code, tests, SQL/SuiteQL, and configuration. Merge findings into one canonical rule model, written by one executor to human-readable documentation and structured Project Memory.

**Tech Stack:** Markdown, JSON, JavaScript/Google Apps Script repository evidence, PowerShell validation.

## Global Constraints

- Do not modify production code, tests, configuration, SQL, or deployment files.
- Every definitive rule must cite an existing exact repository path and a symbol or line range when stable.
- Use globally unique `RULE-<DOMAIN>-NNN` identifiers.
- Define each semantic rule once; cross-domain occurrences reference the canonical ID.
- Mark insufficient evidence as `INFERIDA` or `AMBIGUA`; never invent a rule.
- Keep Project Memory JSON valid and synchronized with `docs/REGLAS.md`.
- Do not deploy.

---

### Task 1: Build the evidence inventory

**Files:**
- Read: `.project-memory/*.json`, `docs/**/*.md`, `src/**/*.js`, `src/**/*.html`, `tests/**/*`, root `*.js`, `*.gs`, `*.json`, and SQL/SuiteQL-bearing sources
- Produce through merged specialist evidence: no repository write

**Interfaces:**
- Consumes: `.project-memory/indexes.json` read order and the approved design specification.
- Produces: findings with domain, candidate rule text, classification, exact sources, conflicts, and duplicate candidates.

- [ ] Read Project Memory in the prescribed order and map known rules, sources, modules, and integrations.
- [ ] Investigate planning domains: OT lifecycle, selection, sequencing, precedence, finite capacity, balancing, calendars, machines, operators, tooling, bending, subcontracting, materials/BOM, completion, and publishing.
- [ ] Investigate system-boundary domains: NetSuite synchronization, persistence, reports, inspections, permissions/restrictions, error fallback, and data integrity.
- [ ] Cross-check documentation claims against targeted production symbols and tests.
- [ ] Mark unsupported claims and contradictions explicitly.

### Task 2: Normalize and deduplicate the rule model

**Files:**
- Modify: `docs/REGLAS.md`
- Modify: `.project-memory/rules.json`

**Interfaces:**
- Consumes: Task 1 findings.
- Produces: one canonical record per semantic rule with globally unique IDs and cross-references.

- [ ] Group findings by business meaning rather than by source file.
- [ ] Assign stable domain prefixes and globally unique numeric IDs.
- [ ] Preserve existing valid IDs when their meaning is unchanged; remove or replace duplicate semantic definitions with references.
- [ ] Write `docs/REGLAS.md` by domain with classifications, exact evidence, ambiguity, contradiction, and cross-reference sections.
- [ ] Write matching structured records to `.project-memory/rules.json` with `rule_id`, `name`, `status`, `rule`, `domain`, `classification`, and `sources`.

### Task 3: Complete durable source and boundary knowledge

**Files:**
- Modify: `.project-memory/data-sources.json`
- Modify: `.project-memory/modules.json`
- Modify: `.project-memory/integrations.json`

**Interfaces:**
- Consumes: verified Task 1 evidence and canonical IDs from Task 2.
- Produces: source origins, sheets/tables/endpoints, fields, readers, writers, relationships, restrictions, and rule references where evidence exists.

- [ ] Merge duplicate source records that differ only by capitalization while preserving all verified references.
- [ ] Fill exact fields, readers, writers, relationships, and restrictions only when demonstrated by repository evidence.
- [ ] Replace `needs_documentation` only for modules whose responsibilities were verified.
- [ ] Link integrations and data sources to canonical rule IDs without duplicating rule text.

### Task 4: Validate and record the catalog

**Files:**
- Modify: `CHANGELOG.md`
- Create: `docs/changes/TASK-20260809-143203-2350.md`

**Interfaces:**
- Consumes: Tasks 2 and 3 artifacts.
- Produces: deterministic evidence packet for technical review and Documentation Gate.

- [ ] Validate all modified Project Memory files with `ConvertFrom-Json`.
- [ ] Extract all `RULE-*` IDs and fail on duplicates within each canonical store or mismatched canonical sets.
- [ ] Verify every cited repository path exists.
- [ ] Check every relevant discovered domain is represented or explicitly documented as having insufficient evidence.
- [ ] Check semantic duplicate candidates and cross-references manually during technical review.
- [ ] Record scope, evidence, limitations, and no-deployment status in changelog and task journal.
- [ ] Run Documentation Gate, secret scan, scope validation, and the commands below.

```powershell
Get-Content -Raw .project-memory/rules.json | ConvertFrom-Json | Out-Null
Get-Content -Raw .project-memory/data-sources.json | ConvertFrom-Json | Out-Null
Get-Content -Raw .project-memory/modules.json | ConvertFrom-Json | Out-Null
Get-Content -Raw .project-memory/integrations.json | ConvertFrom-Json | Out-Null
$ids = Select-String -Path docs/REGLAS.md -Pattern 'RULE-[A-Z0-9_-]+-\d{3}' -AllMatches | ForEach-Object { $_.Matches.Value }; if (($ids | Group-Object | Where-Object Count -gt 1).Count) { exit 1 }
```

<!-- HYBRID_TASK
{
  "id": "TASK-20260809-143203-2350",
  "objective": "Investigate and document every relevant business rule in the repository as a canonical, evidence-backed, non-duplicating catalog synchronized with Project Memory.",
  "allowed_files": [
    "docs/REGLAS.md",
    ".project-memory/rules.json",
    ".project-memory/data-sources.json",
    ".project-memory/modules.json",
    ".project-memory/integrations.json",
    "CHANGELOG.md",
    "docs/changes/TASK-20260809-143203-2350.md"
  ],
  "requirements": [
    "Read Project Memory before targeted repository evidence.",
    "Cover every business-rule domain relevant to planning and system boundaries, not only the original seven domains.",
    "Every definitive rule cites an exact existing repository source.",
    "Use globally unique RULE identifiers and define each semantic rule only once.",
    "Synchronize docs/REGLAS.md with structured Project Memory.",
    "Do not modify production code, tests, deployment files, or runtime configuration."
  ],
  "acceptance_criteria": [
    "All modified Project Memory JSON parses successfully.",
    "Canonical RULE IDs are globally unique and human/structured catalogs agree.",
    "Every relevant discovered domain is covered or explicitly marked as lacking sufficient evidence.",
    "All definitive rules have exact existing sources; ambiguities and contradictions remain visible.",
    "Documentation Gate, scope validation, secret scan, and technical review pass.",
    "No deployment is executed."
  ],
  "plan_review": {"required": false},
  "execution_plan": {
    "executor_mode": "balanced",
    "max_attempts": 2,
    "smoke_test_commands": [
      "powershell -NoProfile -Command \"Get-Content -Raw .project-memory/rules.json | ConvertFrom-Json | Out-Null; Get-Content -Raw .project-memory/data-sources.json | ConvertFrom-Json | Out-Null; Get-Content -Raw .project-memory/modules.json | ConvertFrom-Json | Out-Null; Get-Content -Raw .project-memory/integrations.json | ConvertFrom-Json | Out-Null\"",
      "powershell -NoProfile -Command \"if (-not (Test-Path docs/REGLAS.md)) { exit 1 }; if ((Select-String -Path docs/REGLAS.md -Pattern 'RULE-' -AllMatches).Count -eq 0) { exit 1 }\""
    ]
  },
  "validation_plan": {
    "syntax": {"required": true, "commands": ["powershell -NoProfile -Command \"Get-Content -Raw .project-memory/rules.json | ConvertFrom-Json | Out-Null; Get-Content -Raw .project-memory/data-sources.json | ConvertFrom-Json | Out-Null; Get-Content -Raw .project-memory/modules.json | ConvertFrom-Json | Out-Null; Get-Content -Raw .project-memory/integrations.json | ConvertFrom-Json | Out-Null\""]},
    "functional_tests": {"required": true, "commands": ["powershell -NoProfile -Command \"$ids = Select-String -Path docs/REGLAS.md -Pattern 'RULE-[A-Z0-9_-]+-\\d{3}' -AllMatches | ForEach-Object { $_.Matches.Value }; if (($ids | Group-Object | Where-Object Count -gt 1).Count) { exit 1 }\""]},
    "technical_review": {"required": true, "reviewer": "laguna"},
    "visual_review": {"required": false, "reviewer": "mimo", "files": []}
  },
  "specialist_plan": [
    {"id": "scope_map", "role": "Map Project Memory and rule-bearing repository domains", "required": true, "depends_on": []},
    {"id": "planning_rules", "role": "Extract and cross-check planning, capacity, resources, calendars, and lifecycle rules", "required": true, "depends_on": ["scope_map"]},
    {"id": "data_integration_rules", "role": "Extract and cross-check data-source, NetSuite, persistence, reporting, and inspection rules", "required": true, "depends_on": ["scope_map"]},
    {"id": "test_coverage", "role": "Verify candidate rules against tests and identify contradictions or missing acceptance evidence", "required": true, "depends_on": ["planning_rules", "data_integration_rules"]},
    {"id": "dedup_review", "role": "Detect semantic duplicates, ID collisions, unsupported claims, and cross-domain references", "required": true, "depends_on": ["test_coverage"]}
  ],
  "documentation_plan": {
    "rules_affected": ["all relevant business-rule domains discovered in repository evidence"],
    "data_sources_affected": ["verified sheets, endpoints, configuration stores, and NetSuite sources"],
    "module_docs": ["docs/REGLAS.md", ".project-memory/rules.json", ".project-memory/data-sources.json", ".project-memory/modules.json", ".project-memory/integrations.json"],
    "adr_required": false,
    "changelog_required": true,
    "task_journal_required": true
  },
  "commit_message": "docs(rules): catalog verified business rules",
  "hybrid_subagents": {"mode": "auto", "strategy": "read_only_specialists"},
  "cloud_allowed": true
}
HYBRID_TASK_END -->
