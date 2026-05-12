# dismissConsentDialog()

**File:** `src/commands/discover-phase1/consent.ts`
**Tests:** `src/__tests__/discover-phase1/dismissConsentDialog.test.ts` (3 tests)
**Status:** Implemented ✅

---

## Purpose

A content-visibility gate that must run on a loaded page **before any DOM-reading check begins**.

Without this, cookie/GDPR banners can hide real page content, causing:

| Check | Without gate | With gate |
|---|---|---|
| `check-images.ts` | ATF images may be zero (banner covers viewport) | Banner dismissed; real ATF image count |
| `check-ssr.ts` | Rendered DOM reflects banner overlay, not real content | Real rendered content analysed |
| `check-navigation.ts` | Nav links may be blocked/obscured by banner | Links are accessible and clickable |

---

## Diagram 1 — Registry Execution Flow

```mermaid
flowchart TD
    START(["dismissConsentDialog(client)"])

    START --> PROBE["Call 1 — probe
    Iterate CONSENT_REGISTRY
    Find first visible selector"]

    PROBE --> HIT{element found
    and visible?}

    HIT -->|No| CLEAN["return dismissed=false
    method=null, selector=null"]

    HIT -->|Yes| CLICK["Call 2 — click
    el.click()"]

    CLICK --> WAIT["setTimeout 800ms
    Wait for banner animation"]

    WAIT --> RESULT["return dismissed=true
    method + selector populated"]

    style CLEAN fill:#ccffcc,stroke:#006600,color:#000
    style RESULT fill:#ccffcc,stroke:#006600,color:#000
    style START fill:#fffacd,stroke:#999,color:#000
```

---

## Diagram 2 — Integration Points

```mermaid
flowchart TD
    subgraph IMG["check-images.ts"]
        direction TB
        I1["Page.loadEventFired()
        + 2s wait"] --> I2["dismissConsentDialog(client)"]
        I2 --> I3{dismissed?}
        I3 -->|Yes| I4["Banner gone
        Real content visible"]
        I3 -->|No| I5["No banner present
        Proceed normally"]
        I4 --> I6["detectBotWall()
        DOM image queries
        → CheckImagesResult"]
        I5 --> I6
    end

    subgraph SSR["check-ssr.ts"]
        direction TB
        S1["Page.loadEventFired()"] --> S2["dismissConsentDialog(client)"]
        S2 --> S3["3s wait for JS"]
        S3 --> S4["Runtime.evaluate outerHTML
        → renderedHtml"]
        S4 --> S5["analyzeContent()
        determineSSRStatus()
        → SSRCheckResult"]
    end

    subgraph NAV["check-navigation.ts"]
        direction TB
        N1["Page.loadEventFired()
        + waitForHydration()"] --> N2["dismissConsentDialog(client)"]
        N2 --> N3["findMatchingLink()
        Click link
        Detect nav type
        → NavigationCheckResult"]
    end

    style I4 fill:#ccffcc,stroke:#006600,color:#000
    style I5 fill:#ccffcc,stroke:#006600,color:#000
```

---

## Signature

```typescript
export async function dismissConsentDialog(client: any): Promise<ConsentResult>

export interface ConsentResult {
  dismissed: boolean;
  method: 'cookiebot' | 'onetrust' | 'trustarc' | 'generic-accept' | null;
  selector: string | null;
}
```

---

## Implementation Pattern: Registry

The function uses a **Registry pattern** — every known CMP (Consent Management Platform)
is described as a data object in the `CONSENT_REGISTRY` array. The function body itself
is a two-call CDP sequence that never needs to change:

```typescript
const CONSENT_REGISTRY: ConsentEntry[] = [
  { selector: '#CybotCookiebotDialogBodyButtonAccept',  method: 'cookiebot' },
  { selector: '.onetrust-accept-btn-handler',           method: 'onetrust' },
  { selector: '#onetrust-accept-btn-handler',           method: 'onetrust' },
  { selector: '.trustarc-agree-btn',                    method: 'trustarc' },
  { selector: '[data-consent-accept]',                  method: 'generic-accept' },
];
```

**To add a new CMP:** append one `ConsentEntry` object to `CONSENT_REGISTRY`.
Nothing else changes.

---

## Two-Call Design

The probe and click are separated into two `Runtime.evaluate` calls deliberately:

| Call | Purpose | Returns |
|---|---|---|
| Call 1 — probe | Find first visible selector in CONSENT_REGISTRY | `{ found, selector, method }` |
| Call 2 — click | Click the found element | `true \| false` |

Separating them avoids injecting untrusted selector strings into a single `eval`-style
expression that both queries and acts. The selector from Call 1 is `JSON.stringify`-escaped
before being passed to Call 2.

**Short-circuit:** If `found=false`, Call 2 is never made. No timeout, no delay.

---

## Visibility Check

The probe only matches elements that are **currently visible on screen**:

```javascript
var rect = el.getBoundingClientRect();
var visible = rect.width > 0 && rect.height > 0;
```

This prevents false positives from CMPs that leave hidden fallback buttons in the DOM
after the banner has already been dismissed by a previous session cookie.

---

## 800ms Wait

After clicking, the function waits 800 ms to allow:
- CSS fade/slide animations to complete
- Any overlay `z-index` layers to be removed
- Subsequent DOM reads to see real page content

In tests, `jest.useFakeTimers()` + `jest.runAllTimersAsync()` are used to skip this wait.

---

## Supported CMPs

| CMP | Selector |
|---|---|
| Cookiebot | `#CybotCookiebotDialogBodyButtonAccept` |
| OneTrust (class) | `.onetrust-accept-btn-handler` |
| OneTrust (id) | `#onetrust-accept-btn-handler` |
| TrustArc | `.trustarc-agree-btn` |
| Generic | `[data-consent-accept]` |

---

## Extending

```typescript
// Example: add Usercentrics CMP
{ selector: '[data-testid="uc-accept-all-button"]', method: 'generic-accept' },

// Example: add a site-specific banner
{ selector: '#cookie-banner-accept', method: 'generic-accept' },
```

---

## fritz-berger.de Status

Consent banner: **NOT DETECTED in baseline run (May 2026)**.
The site does not appear to serve a GDPR banner to desktop clients from current test
location. The gate runs and returns `{ dismissed: false }` with no side effects.
