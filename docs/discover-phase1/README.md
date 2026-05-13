# Phase 1 Discovery — Module Index

Autonomous Phase 1 discovery replaces the manual analyst for the mechanical
parts of pre-vetting. One Chrome tab, sequential execution, structured output.

**Entry point:** `src/commands/discover-phase1/index.ts` (barrel)
**Orchestrator:** `src/commands/discover-phase1/orchestrator.ts`
**Tests:** `src/__tests__/discover-phase1/`

---

## Architecture

| Document | Description |
|---|---|
| [orchestrator.md](architecture/orchestrator.md) | Execution sequence, tab lifecycle, BotWallError, output shape |
| [integration.md](architecture/integration.md) | How the orchestrator plugs into `full-check.ts`, timing slots |

---

## Pure Functions — No CDP Dependency

These take `rawHtml` and/or response headers. Instant execution, no side effects.

| Document | Source | Tests |
|---|---|---|
| [detect-bot-wall.md](pure-functions/detect-bot-wall.md) | `bot-wall.ts` | 4 tests |
| [detect-tech-stack.md](pure-functions/detect-tech-stack.md) | `tech-stack.ts` | 12 tests |
| [detect-third-party-domains.md](pure-functions/detect-third-party-domains.md) | `third-party.ts` | 2 tests |
| [detect-languages.md](pure-functions/detect-languages.md) | `languages.ts` | 2 tests |
| [detect-query-params.md](pure-functions/detect-query-params.md) | `query-params.ts` | 2 tests |

---

## CDP Functions — Require Active Chrome Tab

These use `client` (CDP connection) for DOM interaction or `Runtime.evaluate`.

| Document | Source | Tests |
|---|---|---|
| [dismiss-blocking-modals.md](cdp-functions/dismiss-blocking-modals.md) | `modals.ts` | 3 tests |
| [crawl-site-links.md](cdp-functions/crawl-site-links.md) | `crawl.ts` | 4 tests |
| [discover-page-types.md](cdp-functions/discover-page-types.md) | `page-types.ts` | 2 tests |
| [detect-service-workers.md](cdp-functions/detect-service-workers.md) | `service-workers.ts` | 2 tests |
| [detect-data-layer.md](cdp-functions/detect-data-layer.md) | `data-layer.ts` | 2 tests |
| [discover-filter-selector.md](cdp-functions/discover-filter-selector.md) | `filter-selector.ts` | 2 tests |

---

## API Functions — External HTTP Calls

These use `fetch()` to call external APIs. Run after the Chrome tab is closed.

| Document | Source | Tests |
|---|---|---|
| [fetch-crux-data.md](api-functions/fetch-crux-data.md) | `crux.ts` | 2 tests |

---

## Execution Order

```
 1. createNewTarget()              — fresh Chrome tab
 2. Network/Page/Runtime.enable()
 3. Page.navigate(url)
 4. Smart Wait:
    a. domContentEventFired()      — mandatory (DOM parsed)
    b. race(loadEventFired, 15s)   — optimistic wait or soft timeout
    Entire block wrapped in 30s fatal timeout
 5. Capture rawHtml               — Network.getResponseBody + DOM fallback
                                     FATAL if empty
 6. detectBotWall()                — FATAL if wall detected
 7. dismissBlockingModals()        — NON-FATAL
 8. discoverPageTypes()            — NON-FATAL
 9. detectTechStack()              — pure
10. detectThirdPartyDomains()      — pure, NON-FATAL
11. detectLanguages()              — pure, NON-FATAL
12. detectQueryParams()            — pure, NON-FATAL
13. detectServiceWorkers()         — CDP, NON-FATAL
14. detectDataLayer()              — CDP, NON-FATAL
15. discoverFilterSelector()       — CDP, NON-FATAL (only if PLP found)
16. connection.close()             — always (finally block)
17. fetchCruxData()                — HTTP, NON-FATAL (only if API key set)
18. return Step1ParsedReport
```
