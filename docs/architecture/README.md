# Baseline Architecture — Pre-Refactor Documentation

These 8 documents describe the codebase **as it existed before the autonomous
refactoring work** (Task 3). They were written during Task 2 ("understand the
project") to map every module, identify assumptions, and locate the gaps that
the Phase 1 discovery module would need to fill.

**Audience:** Anyone reading the code for the first time, or reviewing what
existed before the autonomous path was added.

## Documents

| # | Document | Covers | Key file(s) |
|---|----------|--------|-------------|
| 1 | [Big Picture](01-big-picture.md) | Two-phase workflow (Cowork → CDP), module dependency graph | — |
| 2 | [CDP Connection Layer](02-cdp-connection.md) | `connectToCDP()`, `createNewTarget()`, `DEVICE_PROFILES`, tab lifecycle | `src/cdp/connection.ts` |
| 3 | [CLI Entry Point](03-cli-entrypoint.md) | Commander.js routing, command registration, option parsing | `src/cli.ts` |
| 4 | [Full Check Orchestrator](04-full-check-orchestrator.md) | `Promise.all()` parallel execution, `runFullCheck()`, timing metrics | `src/commands/full-check.ts` |
| 5 | [Individual Checks](05-individual-checks.md) | SSR, HTML comparison, headers, images, navigation — one section per check | `src/commands/check-*.ts` |
| 6 | [Artifacts & Report Layer](06-artifacts-report-layer.md) | `parseStep1Report()`, `createRunDir()`, report generation, diff utilities | `src/utils/artifacts.ts`, `src/utils/diff.ts` |
| 7 | [Gap Analysis](07-gap-analysis.md) | Refactor specification: what exists, what's partial, what must be built | — |
| 8 | [Existing Conventions](08-existing-conventions.md) | Function signature patterns, interface conventions, error handling in `check-*.ts` | `src/commands/check-*.ts` |

## Reading Order

- **Start with 01** for the two-phase workflow and dependency graph.
- **04 + 05** are the core runtime: how checks run in parallel and what each check does.
- **06** explains how Step 1 reports are parsed — the contract that Phase 1 discovery had to match.
- **07** is the gap analysis that directly informed the `discover-phase1/` implementation.
- **08** documents the coding conventions that new modules had to follow.

## Relationship to `discover-phase1/`

These docs describe the *input* to the refactoring. The [`discover-phase1/`](../discover-phase1/README.md)
docs describe the *output* — the 12 autonomous functions that replaced the manual Cowork step.
The gap analysis in [07](07-gap-analysis.md) is the bridge between the two: it identifies what
was missing, and `discover-phase1/` documents what was built to fill those gaps.
