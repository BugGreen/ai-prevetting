# Pre-Vetting CLI — Documentation Index

## Quick Start

```bash
npm install
npx ts-node src/cli.ts start-chrome

# Integrated path (Phase 1 discovery + Phase 2 checks)
npx ts-node src/cli.ts full-check <url> -s

# Manual path (import existing Step 1 report, run Phase 2 only)
npx ts-node src/cli.ts full-check <url> -i <step1-report.md> -s
```

## Task Deliverables

| Task | Description | Deliverable | What's in it |
|------|-------------|-------------|--------------|
| 1 | Run pre-vetting for fritz-berger.de | [`output/fritz-berger-prevetting-step1.md`](../output/fritz-berger-prevetting-step1.md), [`output/fritz-berger_de_2026-05-13_step2_report.md`](../output/fritz-berger_de_2026-05-13_step2_report.md) | Two-step workflow: Cowork research (Step 1) + CDP verification (Step 2), 12 page types, 22 tech stack items, 10 key findings |
| 2 | Understand and document the project | [`docs/architecture/`](architecture/), [`docs/discover-phase1/`](discover-phase1/README.md) | 8 architecture docs (big picture through testing strategy), Phase 1 module index with execution order |
| 3 | Autonomous vs two-step comparison | [`docs/comparison-report.md`](comparison-report.md) + 3 runs in `output/fritz-berger_de_2026-05-14T*/` | 18x speedup analysis, gap-by-gap parity assessment, hybrid workflow recommendation, V2/V3 roadmap |
| 4 | Docker deployment proposal | [`docs/docker-deployment-strategy.md`](docker-deployment-strategy.md) | Sidecar architecture, async queue with BullMQ, webhook delivery, tini init system, incremental migration path |
| 5 | Bot management proposal | [`docs/bot-management-strategy.md`](bot-management-strategy.md) | Three-option analysis (evasion / middle ground / cooperation), structured BotWallError response design, Docker NAT Gateway integration |

## Conclusions

- **Speed.** The autonomous pipeline completes in ~2.5 min (σ=4.8s across 3 runs) vs ~45 min for the two-step workflow — an ~18x speedup with identical detection results across runs. See [`comparison-report.md §5`](comparison-report.md#5-consistency-analysis-three-autonomous-runs).

- **Parity gaps.** Three gaps remain open: page types (2/12 discovered), tech stack (2/22 vendors detected), and mobile/desktop HTML comparison (failed all 3 runs due to strict `loadEventFired` timeout). See [`comparison-report.md §7`](comparison-report.md#7-can-the-autonomous-path-match-the-manual-one) parity table.

- **Hybrid workflow.** Autonomous recommended as default screening pipeline; two-step reserved for customer-facing deliverables, bot-blocked sites (`BotWallError` → manual bypass), and vendor registry expansion. See [`comparison-report.md §6`](comparison-report.md#6-when-to-use-what).

- **V2 priorities.** Extend Smart Wait to Phase 2 checks (fixes mobile/desktop — the single largest quality gap), add sitemap + nav-menu crawling (page types 2→8-10), add post-hydration DOM scan (tech stack 2→15-20); these three close ~70% of the quality gap. See [`comparison-report.md §8`](comparison-report.md#8-future-work).

- **Docker deployment.** Sidecar pattern (Chrome isolated from API server) with async BullMQ queue for ~2.5 min audits and webhook delivery; core check functions (`checkSSR()`, `checkImages()`, etc.) require zero changes — they already return typed, serializable results. Migration requires addressing filesystem paths, process lifecycle, and Chrome launch assumptions. See [`docker-deployment-strategy.md §2-3`](docker-deployment-strategy.md#2-proposed-architecture-three-options).

- **Bot management.** Evasion ruled out on commercial grounds — WAF vendors and their clients are Baqend's customer base; transparent cooperation (static IPs via NAT Gateway, custom `SpeedKit-PreVetting/1.0` UA) recommended. When blocked, `BotWallError` returns partial results + whitelist path instead of aborting. See [`bot-management-strategy.md §2-4`](bot-management-strategy.md#2-three-options).
