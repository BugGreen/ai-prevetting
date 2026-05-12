# Module 4 — The Full Check Orchestrator (CRITICAL)

**File:** `src/commands/full-check.ts`

This is the file you will modify for the refactor.

---

## Concept 1 — Promise.all() / Parallel Execution

### ELI5
Imagine you need to make dinner: bake a cake, boil pasta, and toss a salad.
You could do them one at a time — finish the cake, then start the pasta, then the salad.
Total time: 60 minutes. Or you could put the cake in the oven, boil the pasta while it bakes,
and toss the salad at the same time. Total time: ~20 minutes (the slowest task).
`Promise.all()` is the second approach — it starts all the checks simultaneously and
waits for the last one to finish before collecting all the results.

### Technical
`Promise.all(arrayOfPromises)` returns a single Promise that resolves when ALL input
Promises have resolved, collecting results **in order** into an array. If ANY Promise
rejects, `Promise.all()` rejects immediately and discards the others.

This is identical to Python's `asyncio.gather()`. In this codebase:

```typescript
// full-check.ts:346
const [htmlResult, ssrResult, imageResult, headerResult, navResult] =
  await Promise.all(checkPromises);
```

Each check runs in its own Chrome tab (via `createNewTarget()`). All four tabs are
open and navigating simultaneously. Total wall-clock time ≈ the slowest individual
check, not the sum of all checks.

**Critical nuance:** the checks do NOT share a Chrome tab.
`Promise.all()` is safe here precisely because of the tab isolation in `createNewTarget()`.
If they shared a tab, parallel navigation would corrupt each other's data.

### Refactor Implications
If autonomous page discovery is added (crawling the homepage to find a nav target URL),
that discovery step MUST complete BEFORE `Promise.all()` starts — because the
navigation check depends on its result. Discovery cannot run in parallel with the
nav check itself.

---

## Concept 2 — trackCheck() / The Timing Wrapper

### ELI5
Every check is wrapped in a function called `trackCheck`. Think of it as a
stopwatch + error catcher combined. It presses start before the check runs, presses stop
when it finishes (or crashes), and always hands back the result AND the timing data —
even if the check crashed. That way the orchestrator always gets a full picture,
not just a success/failure boolean.

### Technical

```typescript
// full-check.ts:161
async function trackCheck<T>(
  name: string,
  fn: () => Promise<T>,
  baseTime: number
): Promise<{ result: T | null; timing: CheckTiming }>
```

The `<T>` is a TypeScript generic — equivalent to Python's `TypeVar`. It means:
"I don't know what type `fn` returns, but whatever it is, I'll preserve it in my output."
This lets a single wrapper function handle `CompareHtmlResult`, `SSRCheckResult`,
`CheckImagesResult`, etc., without losing type safety.

The key design decision: **`trackCheck` NEVER re-throws errors.** A crashed check
returns `{ result: null, timing: { status: 'failed', error: "..." } }` and resolves
normally. This is why `Promise.all()` never rejects due to a single check failure
— all timing data is always collected, even for failed checks.

The exception is the post-gather check at line 355:
```typescript
if (!htmlResult.result || !ssrResult.result || !imageResult.result || !headerResult.result) {
  throw new Error('One or more critical checks failed.');
}
```
HTML comparison, SSR, images, and headers are "critical" — if any of them fail,
the entire run aborts. Navigation check failure is demoted to a warning instead.

### Refactor Implications
Any new check added (e.g., page discovery, bot wall detection) should also be
wrapped in `trackCheck`. This provides timing data for free and ensures a discovery
failure doesn't crash the entire run.

---

## Concept 3 — ExecutionMetrics / The Run's Paper Trail

### Technical

```typescript
// full-check.ts:39
interface ExecutionMetrics {
  startTime: string;            // ISO 8601 timestamp
  endTime: string;
  totalDurationMs: number;      // wall-clock duration
  checks: {
    htmlComparison: CheckTiming;
    ssrCheck:       CheckTiming;
    imageCheck:     CheckTiming;
    headerCheck:    CheckTiming;
    navigationCheck: CheckTiming | null;  // null = skipped
    wpt:             CheckTiming | null;  // null = not run
  };
  errors:   ExecutionError[];   // critical failures (check name + message)
  warnings: string[];           // non-critical issues
}

interface CheckTiming {
  name:       string;
  startMs:    number;   // ms since run start (not wall clock)
  endMs:      number;
  durationMs: number;
  status:     'success' | 'failed' | 'skipped';
  error?:     string;
}
```

`startMs`/`endMs` are relative to `baseTime` (the run's start epoch). This means
you can reconstruct a Gantt chart of which checks ran concurrently from a single
JSON file. The `execution-report` command reads this file to generate the CC session
documentation and cost estimates.

### Refactor Implications
The `ExecutionMetrics` interface will need a new `CheckTiming` slot for any new
pre-step added (e.g., page discovery). It also requires a new `warnings` entry
for the case where discovery runs but finds no suitable nav target.

---

## Concept 4 — findNavigationTargetUrl() / THE GAP

### ELI5
This function is the structural engineer asking: "Which part of the land should I
drill into?" Without the architect's sketch (the Step 1 report), it has no idea
where to drill and simply tells the engineer to skip the soil test entirely.
It looks at the list of page types the analyst found in Phase 1 — "PLP at /shoes",
"Homepage at /", "PDP at /shoes/nike-air-max" — and returns the URL of the
most diagnostic page to test navigation against.

### Technical

```typescript
// full-check.ts:199
function findNavigationTargetUrl(
  step1Report: Step1ParsedReport | null,
  baseUrl: string
): string | null
```

**Decision logic (in order of priority):**

1. If `step1Report` is null, or `step1Report.pageTypes` is empty → **return null immediately**
2. Search `pageTypes` for a name containing: `plp`, `category`, `collection`, `listing`, `search`, `products`
3. If found with a `urlPattern` → resolve to full URL (prepend origin if relative)
4. If no PLP found → take the first non-homepage page with a `urlPattern !== '/'`
5. If still nothing → **return null**

When null is returned, at `full-check.ts:331`:
```typescript
const navCheckPromise = navTargetUrl
  ? trackCheck('Navigation Check', () => checkNavigation(...), baseTime)
  : Promise.resolve(null);   // ← silently skipped
```

The navigation check produces no data. `FullCheckResult.navigationCheck` is null.
The Claude Code session receives no information about hard vs. soft navigation.

**This is the exact gap the refactor must close.**

### Refactor Implications
The fix lives here. We need to replace the null path with a call to a new
function — something like `discoverNavigationTarget(url)` — that autonomously
crawls the homepage, scores candidate links by URL pattern heuristics
(contains `/category/`, `/collection/`, `/c/`, `/shop/`, etc.), picks the
highest-confidence candidate, and returns its URL. That function runs as a
pre-step before `Promise.all()` begins.

---

## Diagram 1 — Parallel Execution Timeline (sequenceDiagram)

```mermaid
sequenceDiagram
    participant FC as full-check.ts
    participant CT1 as Chrome Tab 1<br/>HTML Comparison
    participant CT2 as Chrome Tab 2<br/>SSR Check
    participant CT3 as Chrome Tab 3<br/>Image Check
    participant CT4 as Chrome Tab 4<br/>Headers Check
    participant CT5 as Chrome Tab 5<br/>Nav Check
    participant WPT as WebPageTest API

    Note over FC: ensureChromeRunning() ~1s
    Note over FC: findNavigationTargetUrl()<br/>⚠️ STEP 1 DATA REQUIRED HERE

    Note over FC: Promise.all() starts — all tabs open simultaneously

    FC->>CT1: createNewTarget() + navigate
    FC->>CT2: createNewTarget() + navigate
    FC->>CT3: createNewTarget() + navigate
    FC->>CT4: createNewTarget() + navigate
    FC->>CT5: createNewTarget() + navigate (if nav target found)

    Note over CT4: Headers Check ~2-3s (fastest)
    CT4-->>FC: HeadersResult ✓

    Note over CT2: SSR Check ~4-6s
    CT2-->>FC: SSRCheckResult ✓

    Note over CT1: HTML Comparison ~5-8s
    CT1-->>FC: CompareHtmlResult ✓

    Note over CT5: Nav Check ~5-8s
    CT5-->>FC: NavigationCheckResult ✓

    Note over CT3: Image Check ~6-10s (slowest core check)
    CT3-->>FC: CheckImagesResult ✓

    Note over FC: Promise.all() resolves — all 5 results collected
    Note over FC: Check for critical failures (HTML/SSR/Images/Headers)

    alt --skip-wpt not set AND WPT_API_KEY present
        FC->>WPT: POST /runtest (sequential, ~60-180s)
        WPT-->>FC: WPT results
    else WPT skipped
        Note over FC: wptTiming.status = 'skipped'
    end

    Note over FC: Build ExecutionMetrics
    Note over FC: Write execution-metrics.json (if --save)
    FC-->>FC: return FullCheckResult
```

---

## Diagram 2 — findNavigationTargetUrl() Decision Logic

```mermaid
flowchart TD
    START(["findNavigationTargetUrl(step1Report, baseUrl)"])

    START --> A{step1Report\nis null?}
    A -->|Yes| SKIP["return null
    ⚠️ Nav check will be SKIPPED"]

    A -->|No| B{step1Report
    .pageTypes
    is empty?}
    B -->|Yes| SKIP

    B -->|No| C["Search pageTypes for name containing:
    'plp' · 'category' · 'collection'
    'listing' · 'search' · 'products'"]

    C --> D{Match\nfound?}
    D -->|Yes| E{urlPattern\nexists?}
    E -->|No| F[try next candidate in list]
    F --> D

    E -->|Yes| G{urlPattern\nstarts with http?}
    G -->|Yes| H["return urlPattern as-is"]
    G -->|No| I["return new URL(urlPattern, origin).href
    prepend base URL's origin"]

    D -->|No match in priority list| J["Search pageTypes for ANY page where:
    name ≠ 'home' / 'homepage'
    AND urlPattern ≠ '/' or empty"]

    J --> K{Fallback\nfound?}
    K -->|Yes| G
    K -->|No| SKIP

    style SKIP fill:#ffcccc,stroke:#cc0000,color:#000
    style START fill:#fffacd,stroke:#999,color:#000

    subgraph CRITICAL["⚠️  THIS IS WHERE STEP 1 COWORK DATA IS REQUIRED"]
        C
        D
        J
        K
    end
```

---

## What FullCheckResult Contains

```typescript
// full-check.ts:70
interface FullCheckResult {
  url:             string;
  timestamp:       string;
  htmlComparison:  CompareHtmlResult;        // mobile vs desktop HTML diff
  ssrCheck:        SSRCheckResult;           // isSSR, confidence, evidence
  imageCheck:      CheckImagesResult;        // format stats, lazy load issues
  headerCheck:     HeadersResult;            // CDN, CSP, cache-control
  navigationCheck: NavigationCheckResult | null;  // 'hard'|'soft', method
  wptResult:       Record<string, unknown> | null; // LCP, CLS, waterfall
  step1Report:     Step1ParsedReport | null; // raw Phase 1 data, passed through
  executionMetrics: ExecutionMetrics;        // timing + errors + warnings
  savedTo?:        string;                   // output dir path if --save
}
```

Note that `step1Report` travels all the way through to the output. The Claude Code
session (driven by `step2-prompt.md`) receives this entire object and uses the
Phase 1 findings alongside the Phase 2 CDP results to write the final report.
When Phase 1 is automated, this field will be populated programmatically.

---

## The Refactor's Insertion Point

```
runFullCheck()
│
├── ensureChromeRunning()
│
├── ← INSERT HERE: discoverNavigationTarget(url)
│     runs BEFORE Promise.all()
│     populates navTargetUrl autonomously
│     wrapped in trackCheck() for timing + error safety
│
├── findNavigationTargetUrl()     ← modify to use discovered URL as fallback
│
└── Promise.all([
      htmlCheck, ssrCheck, imageCheck, headerCheck,
      navCheck  ← now has a target URL from discovery
    ])
```
