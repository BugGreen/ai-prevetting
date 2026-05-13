# crawlSiteLinks()

**File:** `src/commands/discover-phase1/crawl.ts`
**Tests:** `src/__tests__/discover-phase1/crawlSiteLinks.test.ts` (7 tests)
**Status:** Implemented ✅

---

## Purpose

Foundation utility that collects and scores every visible, same-origin link on the
currently loaded page. Its output feeds `discoverPageTypes()` directly — without
this, there is no input for PLP/PDP classification.

---

## Diagram 1 — Execution Flow

```mermaid
flowchart TD
    START(["crawlSiteLinks(client, baseUrl, maxLinks)"])

    START --> POLL["for attempt = 0..MAX_POLL_ATTEMPTS-1"]

    POLL --> EVAL["Runtime.evaluate\nquerySelectorAll('a[href]')\n+ visibility filter (getBoundingClientRect)\n→ [{ href, text }]"]

    EVAL --> EMPTY{rawLinks\n.length === 0?}

    EMPTY -->|"Yes (0 links)"| WAIT["setTimeout(POLL_INTERVAL_MS)\nDOM not ready — keep waiting"]
    WAIT --> POLL

    EMPTY -->|"No (count > 0)"| STABLE{"count ===\npreviousCount?"}
    STABLE -->|No — count changed| UPDATE["previousCount = count\nDOM still hydrating"]
    UPDATE --> WAIT2["setTimeout(POLL_INTERVAL_MS)"]
    WAIT2 --> POLL
    STABLE -->|Yes — two polls agree| BREAK["break — DOM stable"]
    POLL -->|"attempt = MAX_POLL_ATTEMPTS"| BREAK

    BREAK --> LOOP["For each raw link"]

    LOOP --> DEDUP{already\nseen href?}
    DEDUP -->|Yes| SKIP[skip]
    DEDUP -->|No| CLASSIFY["classifyLink(href, origin)"]

    CLASSIFY --> NULL{returns\nnull?}
    NULL -->|Yes| SKIP2["filtered out\n(external / excluded)"]
    NULL -->|No| PUSH["push SiteLink\n{ href, text, score, inferredType }"]

    PUSH --> LOOP
    SKIP --> LOOP
    SKIP2 --> LOOP

    LOOP -->|done| SORT["sort by score DESC"]
    SORT --> RETURN["return SiteLink[]"]

    style RETURN fill:#ccffcc,stroke:#006600,color:#000
    style START fill:#fffacd,stroke:#999,color:#000
    style WAIT fill:#fff3cd,stroke:#cc8800,color:#000
```

---

## Diagram 2 — classifyLink Decision Tree

```mermaid
flowchart TD
    IN(["classifyLink(href, origin)"])

    IN --> EXT{different\norigin?}
    EXT -->|Yes| NULL1["return null"]

    EXT -->|No| PROTO{mailto / tel\n/ javascript?}
    PROTO -->|Yes| NULL2["return null"]

    PROTO -->|No| EXCL{matches\nEXCLUSION\nPATTERNS?}
    EXCL -->|Yes| NULL3["return null\n(cart / checkout / account…)"]

    EXCL -->|No| HOME{pathname\n=== '/'?}
    HOME -->|Yes| RH["{ score: 0.1, inferredType: 'home' }"]

    HOME -->|No| PLP{matches\nPLP_PATTERNS?}
    PLP -->|Yes| RP["{ score: 0.8, inferredType: 'plp' }"]

    PLP -->|No| PDP{matches\nPDP_PATTERNS?}
    PDP -->|Yes| RD["{ score: 0.6, inferredType: 'pdp' }"]

    PDP -->|No| RO["{ score: 0.2, inferredType: 'other' }"]

    style NULL1 fill:#ffcccc,stroke:#cc0000,color:#000
    style NULL2 fill:#ffcccc,stroke:#cc0000,color:#000
    style NULL3 fill:#ffcccc,stroke:#cc0000,color:#000
    style RP fill:#ccffcc,stroke:#006600,color:#000
    style RD fill:#cce5ff,stroke:#0055cc,color:#000
    style RH fill:#fff3cd,stroke:#cc8800,color:#000
```

---

## Diagram 3 — Integration Points

```mermaid
flowchart TD
    subgraph PHASE1["runPhase1Discovery()"]
        direction TB
        P1["Page.navigate(url)
        Page.loadEventFired()"] --> P2["dismissBlockingModals(client, hostname)"]
        P2 --> P3["crawlSiteLinks(client, baseUrl)"]
        P3 --> P4["discoverPageTypes(siteLinks)
        → Step1ParsedReport.pageTypes"]
    end

    subgraph CRAWL["crawl.ts internals"]
        direction TB
        C1["Runtime.evaluate
        querySelectorAll + visibility filter"] --> C2{0 links?}
        C2 -->|Yes, retry| C1
        C2 -->|No| C3["classifyLink() × N
        pure TypeScript scoring"]
        C3 --> C4["SiteLink[] sorted by score"]
    end

    P3 --> C1

    style P4 fill:#ccffcc,stroke:#006600,color:#000
```

---

## Signature

```typescript
export async function crawlSiteLinks(
  client: any,
  baseUrl: string,   // full URL — used to derive same-origin filter
  maxLinks?: number, // default: 200
): Promise<SiteLink[]>

export interface SiteLink {
  href: string;
  text: string;
  score: number;          // 0.0–1.0 heuristic confidence
  inferredType: 'plp' | 'pdp' | 'home' | 'content' | 'other' | null;
}
```

---

## Safety Mechanisms

### Visibility Filter

The evaluate expression checks `getBoundingClientRect()` on every anchor element
before including it. Elements with `width === 0 && height === 0` are skipped.

This excludes:
- Mobile nav menus rendered off-screen on desktop viewports
- `display: none` elements (e.g. hidden tab panels, collapsed accordions)
- Off-screen drawers and flyout menus that share DOM with the visible nav

`getBoundingClientRect()` is used instead of `offsetParent === null` because
`offsetParent` returns `null` for `position: fixed` elements (sticky navs,
floating CTAs) even when they are fully visible on screen.

### SPA Hydration Polling — Stabilization Strategy

| Constant | Value | Purpose |
|---|---|---|
| `MAX_POLL_ATTEMPTS` | 6 | Hard cap on evaluate calls |
| `POLL_INTERVAL_MS` | 500 ms | Wait between attempts |

The loop runs until the visible link count is **identical across two consecutive polls**
and is non-zero. This handles three distinct loading patterns:

| Pattern | Behaviour |
|---|---|
| **SSR** — all links on first attempt | attempt 0 → N links, attempt 1 → N links (stable) → break. 1 extra poll (500ms overhead). |
| **SPA empty shell** — no links initially | count stays 0 (not stable); retries until links appear, then waits for stability. |
| **App shell trap** — header nav renders first, main content hydrates later | count changes (3 → 35); loop continues until count stabilises at 35. |

A count of `0` never triggers a break — zero links is never considered stable.
A count change between polls means the DOM is still populating — keep waiting.
Worst-case wait: 5 × 500ms = 2.5s (6 attempts, gap only between first 5).

---

## Extraction Pipeline

```
Runtime.evaluate                classifyLink() × N        sort + slice
─────────────────               ──────────────────        ────────────
Collect all visible             Score every link          Sort DESC by score
links up to                     in TypeScript.            then slice to maxLinks.
DOM_EXTRACTION_CEILING          Filter exclusions.
(default 2000).                 Deduplicate hrefs.
     ↑ browser                       ↑ pure TypeScript        ↑ pure TypeScript
```

`maxLinks` is enforced **after** sorting, not inside the evaluate expression.
This ensures high-score PLP/PDP links from the `<main>` content area are never
crowded out by mega-menu noise that happens to appear first in DOM order.

| Constant | Value | Purpose |
|---|---|---|
| `DOM_EXTRACTION_CEILING` | 2000 | Hard cap on DOM extraction — prevents memory overflow on pathological pages |
| `maxLinks` (parameter) | 200 (default) | Budget applied after sort — controls result size, not extraction scope |

All scoring, filtering, and deduplication run in TypeScript — no browser dependency.
`classifyLink` is fully unit-testable without a Chrome instance.

---

## Scoring

| inferredType | Score | Matched by |
|---|---|---|
| `plp` | 0.8 | `/category/`, `/categories/`, `/collection(s)/`, `/shop/`, `/c/`, `/department/`, `/browse/`, `/kategorie(n)/`, `/sortiment/` |
| `pdp` | 0.6 | `/product(s)/`, `/p/`, `/item(s)/`, `/detail(s)/`, `/dp/`, `/produkt(e)/` |
| `home` | 0.1 | pathname === `/` |
| `other` | 0.2 | same-origin, not excluded, no pattern match |

Result is sorted by score descending so highest-confidence links come first.

---

## Exclusions

Filtered out entirely (return `null` from `classifyLink`):

`/cart`, `/checkout`, `/account`, `/login`, `/signin`, `/signup`, `/register`,
`/logout`, `/auth`, `/wishlist`, external origins, `mailto:` / `tel:` / `javascript:`,
pure `#` fragments.

---

## Deduplication

Each unique `href` appears at most once in the result. Duplicate anchors (e.g. the
same PLP linked from header nav and footer) are deduplicated on first occurrence.
