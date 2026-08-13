# ADR-0001 — Project Memory and private independent Git

Status: Accepted

## Context

AI agents must not repeatedly reconstruct stable rules, data schemas, module boundaries and integration sources by reading large portions of the repository. Concurrent work also needs a durable baseline and rollback history.

## Decision

- Project Memory is mandatory and versioned with code.
- Git local is mandatory.
- A project without `origin` gets its own independent private remote repository.
- One writer per repository.
- Documentation is part of the completion gate.
- Push occurs only after final approval and secret scan.

## Consequences

Stable context can be retrieved cheaply, discovered knowledge accumulates over time, and every approved change has a recoverable remote history.

Project: plangit
