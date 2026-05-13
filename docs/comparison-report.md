# Autonomous vs Two-Step Pre-Vetting: Trade-off Analysis

**Date:** 2026-05-13
**Subject:** fritz-berger.de
**Branch:** `feature/cdp-refactor`

---

## 1. Methodology

This analysis compares three approaches to Speed Kit pre-vetting, using
fritz-berger.de as the test subject:

| Approach | Description | Data Source |
|---|---|---|
| **Cowork Step 1** | Claude Cowork + Chrome Extension. Human copies prompt, reviews output, pastes into CLI. | `output/fritz-berger-prevetting-step1.md` |
| **Two-Step Final** | Cowork Step 1 report fed into CLI Step 2. Claude Code follows `prompts/step2-prompt.md` to run `full-check --import-phase1`, interpret results, and write the final report. | `output/fritz-berger-prevetting-step2.md` |
| **Autonomous** | Single `full-check <url>` invocation — Phase 1 orchestrator + Phase 2 CDP checks. Zero human involvement. | 3 fresh runs (2026-05-13T15:02–15:13Z) |

**Important architectural note:** In the two-step workflow, `prompts/step2-prompt.md`
is the instruction set that Claude Code follows during Step 2. It tells Claude Code
to run `full-check`, interpret the results alongside the Step 1 report, and write
a consolidated report following a specific output format. The autonomous path makes
this prompt unnecessary for **data collection** — the Phase 1 orchestrator replaces
Cowork, and the same `full-check` CLI runs the same CDP checks. However, the
**report writing** part of the prompt (sections 1–11, Beta sections) still requires
Claude Code to interpret and narrate the raw data. Our autonomous path currently
outputs structured data and a summary to the console — it does not produce the
rich narrative report that `step2-prompt.md` templates.

**Limitations:** The Cowork report and the two-step final report were generated
on 2026-05-13. All autonomous runs used the same Chrome instance on
localhost:9222. CrUX API key was not configured for the autonomous runs.

---

## 2. Speed

### Raw Timing Data (3 autonomous runs)

| Check | Run 1 | Run 2 | Run 3 | Mean | σ |
|---|---|---|---|---|---|
| **Phase 1 Discovery** | 94.7s | 73.9s | 69.2s | **79.3s** | 13.6s |
| HTML Comparison | 34.0s | 31.3s | 31.0s | 32.1s | 1.7s |
| SSR Check | 143.9s | 79.4s | 89.8s | 104.4s | 34.7s |
| Image Check | 135.9s | 120.6s | 120.2s | 125.6s | 9.0s |
| Headers Check | 80.9s | 122.8s | 124.3s | 109.3s | 24.7s |
| Navigation Check | 171.7s | 158.6s | 159.2s | 163.2s | 7.4s |
| **Total (wall clock)** | **172.0s** | **158.8s** | **159.5s** | **163.4s** | 7.5s |

Phase 2 checks run in parallel, so wall-clock time is driven by the slowest
check (Navigation Check, ~163s mean).

### End-to-End Comparison

| Metric | Two-Step | Autonomous |
|---|---|---|
| Step 1 / Phase 1 | ~30 min (human + Cowork session) | ~79s (orchestrator) |
| Step 2 / Phase 2 | ~140s (CLI) | ~163s (same CLI checks) |
| Total | **~32 minutes** | **~2 min 43s** |
| Human involvement | Required (copy-paste between tools) | Zero |
| Runs per hour (theoretical) | ~2 | ~22 |

The autonomous path is **~12x faster** end-to-end. The speed difference is
almost entirely in Phase 1: the orchestrator replaces a 30-minute human+Cowork
session with a 79-second programmatic sequence. Phase 2 timing is comparable
because both approaches run the same CDP checks.

---

## 3. Quality — Trade-off Analysis by Theme

### Theme A: Deterministic / Machine-Readable Data

**Categories covered:** Tech Stack, Bot Protection, Service Workers, Data Layer,
Languages, Query Params, Third-Party Domains, Speculation Rules, CSPs, SSR,
Images, Navigation Type, PLP Filters.

These categories produce factual, machine-readable signals — either a vendor is
present or it isn't, either SSR content exists in raw HTML or it doesn't.

**Autonomous path strengths:**

- **CDP-verified raw data.** SSR detection compares raw HTML size to rendered DOM
  size, not heuristic guesses from rendered content. Headers are read directly from
  `Network.responseReceived`, not inferred from visible page behavior.
- **Registry-based detection is deterministic.** `detectTechStack()` applies the
  same regex patterns every run. If OneTrust's `cookielaw.org` script is in the
  HTML, it will always be detected. No variability from LLM inference.
- **Structured output.** `discoverPageTypes()` returns a typed `pageTypes[]` array.
  `detectLanguages()` returns `{ htmlLang, hreflangTags[] }`. The downstream code
  consumes these directly — no serialization/deserialization step.

**Autonomous path blind spots:**

- **Visually blind.** The autonomous path cannot assess "above the fold" content.
  It cannot determine whether an A/B test modifies the hero banner, whether
  personalization affects visible product tiles, or whether lazy-loaded images
  are in the viewport. These require rendering the page and interpreting the
  visual layout — something CDP can technically do (via `Page.captureScreenshot`)
  but the current implementation does not.
- **Static regex registries.** `detectTechStack()` only recognizes vendors whose
  patterns are in the `HTML_SIGNALS` and `HEADER_SIGNALS` arrays. A novel
  personalization tool not in the registry goes undetected. The Cowork approach
  can recognize unfamiliar tools by reasoning about script names, URLs, and
  code patterns contextually.
- **Timing-dependent DOM snapshots.** The orchestrator captures HTML at a single
  point in time (after the Smart Wait). Scripts that inject content after the
  15-second soft timeout window are missed. This is a deliberate trade-off —
  waiting longer would risk hanging on tracker-heavy sites.

**Cowork path strengths:**

- Can reason about unfamiliar code patterns and infer vendor identity from context.
- Can read and interpret JavaScript source code, not just pattern-match against it.
- The fritz-berger.de Cowork report correctly identified `eTailer` as the e-commerce
  platform by correlating the CDN domain (`etailercdn.de`), Android package name
  (`de.etailer.fritzbergerapp`), and media URL patterns — a chain of reasoning
  the autonomous path cannot replicate.

**Cowork path blind spots:**

- Findings are heuristic guesses from rendered DOM, not CDP-verified raw data.
  For example, Step 1 could not verify Mobile vs Desktop HTML differences
  (workspace `curl` was blocked by an allowlist proxy), while Step 2's CDP
  `compare-html` confirmed the server performs UA-based device detection
  (`var _isMobile = '1'` vs `''`) with +113/-90 lines of structural HTML
  differences — a critical finding for cache configuration that Cowork alone
  could not produce.
- Results are non-reproducible — different Cowork sessions produce different
  findings on the same site.

### Theme B: Subjective / Strategic Analysis

**Categories covered:** Speed Kit Scope, Risk Assessment, Personalization depth,
A/B testing ATF impact, Native App, Sister Sites.

These categories require human judgment, external knowledge, or visual inspection.

**Cowork path strengths:**

The Cowork Step 1 report included analysis that the autonomous path has no
mechanism to produce:

- **Sister site discovery.** Identified that `fritz-berger.at` and
  `berger-camping.ch` share the same Baqend Speed Kit backend
  (`fritz-berger.app.baqend.com`). This required navigating to related domains
  and inspecting their script sources — cross-origin investigation that the
  single-tab orchestrator does not attempt.
- **Native app assessment.** Found iOS app (`id 434824753`) and Android app
  (`de.etailer.fritzbergerapp`) via app store lookup. Inferred it is likely a
  webview wrapper based on the package naming pattern. This required web search
  capabilities.
- **Strategic recommendations.** Produced a 10-point "Key Findings for Speed Kit"
  section with business-relevant analysis (e.g., "TTFB is the headline problem",
  "architecture is ideal — pure SSR, dynamic state isolated behind `/personal.json`").
  These require understanding Speed Kit's product positioning, not just technical facts.

**Autonomous path limitations:**

These are **inherent architectural limitations**, not implementation gaps. The
autonomous path operates within a single Chrome tab on a single origin. It cannot:
- Search the web for app store listings
- Navigate to sister domains and compare their stacks
- Produce subjective business recommendations
- Assess the visual impact of A/B tests on user experience

These capabilities would require fundamentally different tools (web search API,
multi-origin crawling, visual regression testing) that go beyond the CDP toolkit's scope.

### Theme C: External API Data (CrUX / Performance)

The Cowork Step 1 report manually navigated to `cruxvis.withgoogle.com` and
produced rich CrUX field data — LCP, CLS, INP, TTFB for mobile/desktop/overall
with distribution buckets (Good/NI/Poor percentages) and sister-site comparisons.

The autonomous path calls the PageSpeed Insights API via `fetchCruxData()` but
returned `null` in all 3 runs because `CRUX_API_KEY` was not configured.

This is a **configuration gap**, not an architectural one. With the API key set,
the autonomous path would produce equivalent metric data — and faster, since it
calls the API programmatically rather than navigating a web UI. The distribution
bucket detail (Good/NI/Poor percentages) would require parsing the full PSI
response, which the current implementation does not do.

---

## 4. Resilience & The Edge Case

### The Problem: Tracker Bloat Kills Page Load

fritz-berger.de loads a heavy stack of third-party trackers: GTM (`GTM-5VZQDH`),
GA4 (`G-25PL1RZJ5Z`), AB Tasty, Epoq Inspire, SearchHub, OneTrust, Google Ads,
and Trusted Shops. These scripts make dozens of network requests to external
domains, and some of them never fully resolve.

The original autonomous implementation waited for `Page.loadEventFired()` — the
CDP event that fires when all resources (including third-party scripts) have
finished loading. On fritz-berger.de, this event **never fires** within a
reasonable timeout. The tracker bloat causes an indefinite hang, and the 30-second
fatal timeout kills the run.

This is not unique to fritz-berger.de. Any tracker-heavy e-commerce site with
consent management, analytics, and personalization scripts is likely to exhibit
the same behavior.

### The Evolution of the Fix

**Attempt 1: Strict `loadEventFired`**
```
Page.navigate(url) → loadEventFired() → [30s fatal timeout]
```
Result: fritz-berger.de crashed with "timed out after 30000ms". The load event
never fires because third-party pixel requests hang indefinitely.

**Attempt 2: Strict `domContentEventFired`**
```
Page.navigate(url) → domContentEventFired() → capture HTML
```
Result: Too fast. `domContentEventFired` fires the moment the DOM is parsed,
before any deferred JavaScript executes. The consent banner (OneTrust), language
selector, and recommendation widgets (Epoq) were not yet injected into the DOM.
The `detectTechStack()` registry patterns that depend on these scripts missed them.

**Attempt 3: Smart Wait (the engineered solution)**
```
Page.navigate(url)
    │
    ▼
domContentEventFired()          ← mandatory baseline (DOM is parsed)
    │
    ▼
Promise.race([
  loadEventFired(),             ← optimistic: capture deferred JS
  setTimeout(15_000)            ← soft timeout: bypass tracker bloat
])
    │
    ▼                             30s fatal timeout wraps entire block
Capture rawHtml + proceed
```

Three scenarios:

| Scenario | Behavior |
|---|---|
| Load event fires in < 15s | Full page captured, best quality |
| Load event hangs (trackers) | Soft timeout at 15s, warn + proceed with DOM state |
| DOM never parses (network down) | Fatal timeout at 30s, error thrown |

In our 3 variance runs, the Smart Wait soft timeout triggered in 2 of 3 runs
(the third loaded before 15s). All 3 runs produced identical detection results,
confirming that 15 seconds is sufficient to capture deferred JS injections on
this site.

### Why This Matters for the Comparison

The two-step approach never encountered this issue because Cowork uses the Chrome
Extension, which does not rely on CDP page lifecycle events. The extension sees the
rendered page after the browser has handled all resource loading natively.

The autonomous path **must** handle this because it controls navigation
programmatically via CDP. If it cannot load the page, every downstream detection
step fails — `detectBotWall` gets no HTML to scan, `detectTechStack` gets no
patterns to match, `discoverPageTypes` gets no links to crawl.

The Smart Wait is documented in detail at
[`docs/discover-phase1/architecture/orchestrator.md`](discover-phase1/architecture/orchestrator.md)
§Smart Wait Strategy, with test coverage in
`src/__tests__/discover-phase1/runPhase1Discovery.test.ts` (8 tests including
the soft timeout and fatal timeout scenarios).

**Note:** The Phase 2 `compare-mobile-desktop.ts` check still uses strict
`loadEventFired` and failed in all 3 runs with "Page load timeout". This is an
open issue — the Smart Wait pattern should be extended to Phase 2 checks in a
future iteration.

---

## 5. Consistency & The Parser Break

### The Brittle Middle: Markdown as Interface

The two-step approach has a hidden fragility at the boundary between Step 1 and
Step 2. Step 1 (Cowork) produces free-form Markdown. Step 2 (CLI) must parse
that Markdown back into structured data via `parseStep1Report()` in
[`src/utils/artifacts.ts`](../src/utils/artifacts.ts):232–263.

This function runs five sequential regex extraction passes, each targeting a
different section of the report. None of them throw on failure — they silently
produce empty values if the pattern doesn't match.

### The Real Parser Break on fritz-berger.de

The Cowork Step 1 report formats its page types table as:

```markdown
## Page Types Found

| Body class | URL pattern | Live TTFB |
|---|---|---|
| `body-seite body-startpage` (Homepage) | `/` | 71 ms |
| `body-warengruppe body-warengruppe-detail` (PLP / Category) | `/zelte/campingzelte/` | Fast |
...
```

The parser's table regex expects:
```javascript
/\|\s*(?:Page\s*)?Type\s*\|.*?URL.*?\n/i
```

The column header `Body class` does not match `Type`. The parser silently
produces `pageTypes: []` — zero entries. The report contains 6 rich page type
entries with body classes, URL patterns, and live TTFB measurements. Phase 2
sees none of them.

**Downstream impact:** `findNavigationTargetUrl()` in `full-check.ts` reads
`step1Report.pageTypes` to determine where to navigate for the navigation check.
With `pageTypes: []`, it has no target URL. The navigation check is silently
skipped or falls back to a generic homepage-to-homepage check — which misses
the actual cross-page-type navigation behavior.

This is not a hypothetical failure mode. It is what actually happens when the
fritz-berger.de Cowork report is fed to the CLI parser. The LLM chose a richer
format (body classes as column names, TTFB as a third column) that the regex
was not designed for.

### How the Autonomous Path Eliminates This

`runPhase1Discovery()` produces `Step1ParsedReport` directly as a TypeScript
struct — no Markdown serialization, no regex parsing, no format drift:

```
Cowork path:     LLM → free-form Markdown → regex parser → Step1ParsedReport
                          ↑ format drift           ↑ silent failure

Autonomous path: CDP → discoverPageTypes() → Step1ParsedReport
                       (typed return value, no serialization)
```

The data never passes through a lossy text representation. `discoverPageTypes()`
returns `[{ name: 'Homepage', urlPattern: '...' }, { name: 'PLP', urlPattern: '...' }]`
directly in memory. The schema is enforced by TypeScript at compile time.

### Variance Across 3 Autonomous Runs

| Field | Run 1 | Run 2 | Run 3 | Stable? |
|---|---|---|---|---|
| Page Types | 2 (Homepage + PLP) | 2 (Homepage + PLP) | 2 (Homepage + PLP) | Yes |
| SSR | Yes (medium) | Yes (medium) | Yes (medium) | Yes |
| Navigation | HARD | HARD | HARD | Yes |
| Image Optimization | 81% | 81% | 81% | Yes |
| ATF Lazy Issues | 1 | 1 | 1 | Yes |
| CDN | None | None | None | Yes |
| CSP | Yes | Yes | Yes | Yes |
| Smart Wait triggered | Yes | Yes | No | Minor variance |
| Phase 1 duration | 94.7s | 73.9s | 69.2s | ±13.6s variance |
| Total duration | 172.0s | 158.8s | 159.5s | ±7.5s variance |
| HTML Comparison | Failed | Failed | Failed | Consistent failure |

**All detection results were identical across 3 runs.** The only variance was in
timing (expected — network latency varies) and whether the Smart Wait soft timeout
triggered (expected — whether `loadEventFired` fires before 15s depends on
third-party tracker response times).

Contrast this with the Cowork approach, which produces entirely different prose
each session — different heading levels, different table layouts, different bullet
styles, different column names. Each run risks a new parser incompatibility.

---

## 6. When to Use What

The two approaches are complementary, not competing. Each has a role in a
mature pre-vetting workflow.

### Recommended Hybrid Workflow

| Scenario | Recommended Approach | Rationale |
|---|---|---|
| **Standard pre-vetting** (majority of sites) | Autonomous | Fast (2.7min), deterministic, zero human bottleneck. Covers ~80% of the checklist with machine-verifiable data. |
| **Aggressive bot protection** (DataDome, Cloudflare challenge pages) | Two-Step (Cowork first) | Human can solve CAPTCHAs and interact with challenge pages. The Cowork Chrome Extension operates within the browser's normal execution context, bypassing bot walls that raw CDP cannot. The autonomous path's `detectBotWall()` correctly identifies these walls and throws `BotWallError` — the two-step path is the designed escalation. |
| **Visual ATF analysis required** | Autonomous + manual review | Run the autonomous path for data collection, then have a human review the site's above-the-fold content for personalization, A/B test visibility, and layout shift concerns. |
| **Strategic scope assessment** | Autonomous + analyst overlay | Let the autonomous path collect all technical facts (tech stack, SSR, headers, images, filters). An analyst then interprets the business implications — Speed Kit scope, risk assessment, customer recommendations. |
| **New/unknown tech stacks** | Autonomous + Cowork supplement | When the autonomous registry doesn't recognize a site's technology (e.g., a custom-built framework), run Cowork to identify vendors through contextual reasoning, then add them to the registry for future runs. |

### The Key Insight

The autonomous path is a **data-collection pipeline** — fast, reliable, repeatable.
The Cowork path is an **analytical tool** — flexible, contextual, subjective.

For a production deployment (Task 4), the autonomous path should be the default
pipeline. The two-step approach becomes an escalation mechanism for:
1. Sites blocked by bot protection (`BotWallError` → manual bypass)
2. Engagements requiring strategic recommendations beyond technical facts
3. Registry expansion — Cowork identifies new vendors, developers add patterns

---

## 7. Future Work

Concrete improvements to close the autonomous path's remaining gaps:

### High Priority

1. **Configure CrUX API key.** Add `CRUX_API_KEY` to deployment configuration.
   Eliminates the CrUX data gap entirely. The `fetchCruxData()` function is already
   implemented and tested — this is purely a configuration step.
   *(Low effort, high value)*

2. **Extend Smart Wait to Phase 2 checks.** `compare-mobile-desktop.ts` still uses
   strict `loadEventFired` and failed in all 3 variance runs. Apply the same
   `Promise.race([loadEventFired, softTimeout])` pattern.
   *(Medium effort, high value — eliminates the only consistent failure)*

### Medium Priority

3. **ATF screenshot capture.** Use CDP's `Page.captureScreenshot()` during Phase 1
   to take above-the-fold screenshots. Store them alongside the execution metrics.
   Enables post-run human review of visual layout without running a full Cowork session.
   *(Medium effort — closes the "visually blind" gap)*

4. **Dynamic vendor registry.** Allow tech stack patterns to be loaded from a JSON
   configuration file in addition to the compiled registry. New vendors can be added
   without code changes or redeployment.
   *(Medium effort — reduces maintenance burden)*

5. **Sister site / hreflang crawling.** Extend `detectLanguages()` to follow
   hreflang links and check whether sister domains share the same Speed Kit backend
   or tech stack. Cross-origin, so requires spawning additional CDP tabs.
   *(Medium effort — partially closes the strategic analysis gap)*

### Lower Priority

6. **Smart Wait tuning.** Replace the fixed 15-second soft timeout with an adaptive
   strategy based on observed network activity (e.g., proceed when no new requests
   have arrived for 2 seconds). Sites with fewer trackers could proceed faster;
   sites with more deferred JS could wait longer.
   *(High effort, marginal improvement)*

7. **PSI distribution buckets.** Extend `fetchCruxData()` to parse the full
   PageSpeed Insights response including Good/NI/Poor distribution percentages,
   matching the detail level of the Cowork CrUX analysis.
   *(Low effort, low priority — current summary metrics are sufficient for most assessments)*

---

## Appendix: Raw Data References

| Artifact | Path |
|---|---|
| Cowork Step 1 report | `output/fritz-berger-prevetting-step1.md` |
| Two-step final report | `output/fritz-berger-prevetting-step2.md` |
| Step 2 prompt template | `prompts/step2-prompt.md` |
| Autonomous run 1 metrics | `output/fritz-berger_de_2026-05-13T15-05-12-273Z/execution-metrics.json` |
| Autonomous run 2 metrics | `output/fritz-berger_de_2026-05-13T15-09-12-445Z/execution-metrics.json` |
| Autonomous run 3 metrics | `output/fritz-berger_de_2026-05-13T15-13-08-195Z/execution-metrics.json` |
| Smart Wait documentation | `docs/discover-phase1/architecture/orchestrator.md` |
| Parser implementation | `src/utils/artifacts.ts:232–263` |
| Phase 1 orchestrator | `src/commands/discover-phase1/orchestrator.ts` |
| Orchestrator tests (8) | `src/__tests__/discover-phase1/runPhase1Discovery.test.ts` |
