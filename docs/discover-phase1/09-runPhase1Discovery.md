# runPhase1Discovery()

**File:** `src/commands/discover-phase1/orchestrator.ts`
**Tests:** `src/__tests__/discover-phase1/runPhase1Discovery.test.ts` (3 tests)
**Status:** Implemented ✅

---

## Purpose

Top-level entry point that replaces the human analyst for the mechanical parts
of Phase 1 pre-vetting. Orchestrates all Phase 1 helpers in a single Chrome tab
and returns a `Step1ParsedReport` directly in memory — no Markdown file, no
`parseStep1Report()` call needed.

This is the function `full-check.ts` calls when no `--report` flag is provided,
converting the tool from a two-phase workflow into a fully autonomous run.

---

## Diagram 1 — Execution Sequence

```mermaid
sequenceDiagram
    participant FC as full-check.ts
    participant O as orchestrator.ts
    participant CDP as Chrome Tab
    participant BW as bot-wall.ts
    participant M as modals.ts
    participant PT as page-types.ts
    participant TS as tech-stack.ts
    participant TP as third-party.ts
    participant LG as languages.ts
    participant QP as query-params.ts

    FC->>O: runPhase1Discovery(url)
    O->>CDP: createNewTarget()
    O->>CDP: Network + Page + Runtime enable
    O->>CDP: Page.navigate(url)
    O->>CDP: Page.loadEventFired()
    O->>CDP: Network.getResponseBody()
    CDP-->>O: rawHtml + responseHeaders

    O->>BW: detectBotWall(rawHtml)
    BW-->>O: BotWallResult

    alt isWall = true
        O-->>CDP: connection.close()
        O-->>FC: throw BotWallError
    end

    O->>M: dismissBlockingModals(client, hostname)
    M-->>O: DismissResult

    O->>PT: discoverPageTypes(client, url)
    PT-->>O: PageType[]

    O->>TS: detectTechStack(rawHtml, headers)
    TS-->>O: TechStackResult

    O->>TP: detectThirdPartyDomains(rawHtml, origin)
    TP-->>O: ThirdPartyResult

    O->>LG: detectLanguages(rawHtml)
    LG-->>O: LanguageResult

    O->>QP: detectQueryParams(rawHtml)
    QP-->>O: QueryParamResult

    O->>CDP: connection.close()
    O-->>FC: Step1ParsedReport
```

---

## Diagram 2 — Integration Points

```mermaid
flowchart TD
    subgraph FULLCHECK["full-check.ts — handleFullCheckCommand()"]
        direction TB
        F1{"--report flag\nprovided?"}
        F1 -->|"Yes — manual path"| F2["parseStep1Report()\nreads Markdown file"]
        F1 -->|"No — autonomous path"| F3["runPhase1Discovery(url)"]
        F2 --> F4["Step1ParsedReport in memory"]
        F3 --> F4
        F4 --> F5["runFullCheck() — CDP checks in parallel"]
    end

    subgraph PHASE1["runPhase1Discovery() internals"]
        direction TB
        P1["detectBotWall()"]
        P2["dismissBlockingModals()"]
        P3["discoverPageTypes()"]
        P4["detectTechStack()"]
        P5["detectThirdPartyDomains()"]
        P6["detectLanguages()"]
        P7["detectQueryParams()"]
        P1 --> P2 --> P3 --> P4 --> P5 --> P6 --> P7
    end

    F3 --> P1
    P7 --> F4

    style F4 fill:#ccffcc,stroke:#006600,color:#000
    style F3 fill:#cce5ff,stroke:#0055cc,color:#000
```

---

## Signatures

```typescript
export async function runPhase1Discovery(url: string): Promise<Step1ParsedReport>

export class BotWallError extends Error {
  constructor(
    public readonly targetUrl: string,
    public readonly wallType: BotWallResult['type'],
    public readonly wallConfidence: BotWallResult['confidence'],
  )
  // message: "Bot wall detected on <url> (<type>, <confidence> confidence). Manual bypass required."
  // name: 'BotWallError'
}
```

---

## Execution Sequence

| Step | Action | Aborts on failure? |
|---|---|---|
| 1 | `createNewTarget()` — fresh isolated tab | Yes — connection error |
| 2 | `Network` + `Page` + `Runtime` enable | Yes |
| 3 | `Page.navigate(url)` | Yes |
| 4 | `Page.loadEventFired()` | Yes |
| 5 | `Network.getResponseBody()` — capture `rawHtml` + `responseHeaders` | No — warns and continues with empty string |
| 6 | `detectBotWall(rawHtml)` — safety gate | Yes — throws `BotWallError` |
| 7 | `dismissBlockingModals(client, hostname)` — consent / routing modals | No |
| 8 | `discoverPageTypes(client, url)` — crawl + classify → `pageTypes[]` | No |
| 9 | `detectTechStack(rawHtml, responseHeaders)` → `techStack{}` | Yes |
| 10 | `detectThirdPartyDomains(rawHtml, origin)` → external domains | No |
| 11 | `detectLanguages(rawHtml)` → html lang + hreflang tags | No |
| 12 | `detectQueryParams(rawHtml)` → tracking params | No |
| 13 | `connection.close()` — destroy tab | Always — runs in `finally` |

---

## Tab Lifecycle

The Chrome tab is always destroyed, regardless of outcome:

```typescript
try {
  // steps 2–12
} finally {
  await connection.close();  // runs even if BotWallError is thrown
}
```

This prevents tab leaks on both the success path and all error paths
(bot wall abort, CDP timeout, unexpected errors).

---

## Tech Stack Flattening

`detectTechStack()` returns `Record<string, string[]>` (multi-value).
`Step1ParsedReport.techStack` is `Record<string, string>` (single string per category).

The orchestrator flattens by joining values with `', '`:

```
{ Framework: ['Next.js', 'React'] }  →  { Framework: 'Next.js, React' }
```

This preserves backwards compatibility with the manual `--report` path, where
a human analyst always writes a single string per category.

---

## BotWallError

When `detectBotWall()` returns `isWall: true`, the orchestrator throws
`BotWallError` before any heuristic analysis runs. This prevents silent
false positives:

- SSR check would report false SSR positive (bot wall HTML has server-rendered content)
- Image check would report vacuously perfect score on zero real images

`BotWallError` is caught in `handleFullCheckCommand()` in `full-check.ts`,
logged clearly, and the run exits without producing a corrupted report.

---

## Output

Returns the same `Step1ParsedReport` interface consumed by `runFullCheck()`:

```typescript
{
  url:          'https://fritz-berger.de',
  domain:       'fritz-berger.de',
  summaryTable: {},                          // populated by CDP checks downstream
  pageTypes: [
    { name: 'Homepage', urlPattern: 'https://fritz-berger.de' },
    { name: 'PLP',      urlPattern: 'https://fritz-berger.de/kategorie/zelte' },
    { name: 'PDP',      urlPattern: 'https://fritz-berger.de/produkt/iglu-zelt-x' },
  ],
  techStack: {
    Framework:    'Next.js, React',
    CDN:          'Cloudflare',
    'Tag Manager': 'GTM',
  },
  thirdPartyDomains: {
    domains: [
      { domain: 'cdn.shopify.com', count: 12, types: ['script', 'link'] },
      { domain: 'www.googletagmanager.com', count: 3, types: ['script'] },
    ],
  },
  languages: {
    htmlLang: 'de',
    hreflangTags: [
      { lang: 'de', href: 'https://fritz-berger.de/' },
      { lang: 'x-default', href: 'https://fritz-berger.de/' },
    ],
  },
  queryParams: {
    trackingParams: ['utm_source', 'utm_medium'],
  },
  rawContent: '',
}
```

`summaryTable` is returned empty — it is populated by the individual CDP checks
(`check-ssr`, `check-images`, etc.) that run in parallel after Phase 1 completes.

The `thirdPartyDomains`, `languages`, and `queryParams` fields are optional —
they are `undefined` if their respective detection step fails (non-fatal).
