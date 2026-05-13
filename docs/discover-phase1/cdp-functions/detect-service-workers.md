# detectServiceWorkers()

**File:** `src/commands/discover-phase1/service-workers.ts`
**Tests:** `src/__tests__/discover-phase1/detectServiceWorkers.test.ts` (2 tests)
**Status:** Implemented

---

## Purpose

Detects active service worker registrations in the current page context via CDP
`Runtime.evaluate` and classifies each by its scriptURL pattern. This is critical
for Speed Kit pre-vetting — knowing whether the site already has a service worker
(and what kind) determines compatibility and integration strategy.

---

## Signature

```typescript
export interface ServiceWorkerResult {
  hasServiceWorker: boolean;
  registrations: Array<{ scriptURL: string; type: 'speed-kit' | 'workbox' | 'custom' }>;
}

export async function detectServiceWorkers(client: any): Promise<ServiceWorkerResult>
```

---

## How It Works

```mermaid
flowchart LR
    CDP["client.Runtime.evaluate"] --> SW["navigator.serviceWorker\n.getRegistrations()"]
    SW --> URLS["Extract scriptURL\nfrom each registration"]
    URLS --> CLASSIFY["Classify: speed-kit\nworkbox, or custom"]
    CLASSIFY --> OUT["ServiceWorkerResult"]
```

1. Evaluates `navigator.serviceWorker.getRegistrations()` in the page context
2. Extracts `scriptURL` from each registration (active, installing, or waiting)
3. Classifies each URL:
   - Contains `speed-kit` → `'speed-kit'`
   - Contains `workbox` → `'workbox'`
   - Otherwise → `'custom'`

---

## Classification Rules

| Pattern | Type | Meaning |
|---|---|---|
| `/speed-kit/i` | `speed-kit` | Speed Kit already installed |
| `/workbox/i` | `workbox` | Google Workbox-based SW |
| *(default)* | `custom` | Custom service worker |

---

## Integration

Called by `runPhase1Discovery()` in `orchestrator.ts` as Step 13 (non-fatal).
Result stored in `Step1ParsedReport.serviceWorkers`.

CDP-dependent — requires an active client connection.

---

## Tests

| Test | What it verifies |
|---|---|
| SW registrations found | Detects and classifies speed-kit, workbox, and custom workers |
| No SW registered | Returns `hasServiceWorker: false` with empty registrations |
