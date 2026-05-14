# 08 — Existing Conventions (check-*.ts)

Reference: `check-ssr.ts`, `check-images.ts`, `check-filters.ts`.
New code in `discover-phase1.ts` **must** follow these patterns exactly.

---

## 1. Function Signature Pattern

Each check module exports **two functions** and **two interfaces**:

```typescript
// Options — always an object (never positional args)
export interface Check<X>Options {
  url: string;
  device?: DeviceType;        // default: 'desktop'
  saveToFile?: boolean;        // default: false
  // ...check-specific fields
}

// Result — always a typed interface, never any/unknown at the top level
export interface Check<X>Result {
  url: string;
  // ...check-specific fields
  savedTo?: string;            // present only when saveToFile was true
}

// Main programmatic function
export async function check<X>(options: Check<X>Options): Promise<Check<X>Result>

// CLI handler — thin wrapper, prints to console, returns void
export async function handleCheck<X>Command(
  url: string,
  options: { device?: string; save?: boolean; /* ... */ }
): Promise<void>
```

Destructure options at the top of the main function with defaults:
```typescript
const { url, device = 'desktop', saveToFile = false } = options;
```

---

## 2. Error Handling Convention

| Scenario | Convention |
|---|---|
| Non-critical inner failure (e.g., can't get response body) | `try/catch` + `console.warn('message')`, continue execution |
| Click/interaction failure | `try/catch` + `console.log('Failed to ...: ' + e)`, continue |
| Fatal error | Let it propagate naturally (no swallowing, no `Result` union type) |
| Connection cleanup | **Always** in a `finally` block — never conditional |

Pattern:
```typescript
try {
  // ... all check logic
  return result;
} finally {
  await connection.close();   // guaranteed cleanup
}
```

There is **no** `Result<T, E>` / `Either` type. Functions either return the result or throw.

---

## 3. Logging Style

- **No logger module.** Use `console.log()` and `console.warn()` directly.
- `console.warn()` for recoverable issues inside the core check function.
- `console.log()` for user-facing progress messages inside the core function (only when the check has interactive steps, e.g., navigating, waiting, clicking).
- All formatted output (sections, tables, summaries) goes in `handleCheck*Command` using `console.log()`.

Section headers use this style:
```
console.log('\n=== Section Title ===')
console.log('\n--- Subsection ---')
```

---

## 4. CDP Client Usage

The client is **created internally** — never injected as a parameter.

```typescript
const connection = await createNewTarget();   // creates a new Chrome tab
const { client } = connection;

// Enable domains upfront in parallel
await Promise.all([
  client.Network.enable({}),
  client.Page.enable(),
  client.Runtime.enable(),
]);

// Standard setup
await client.Network.setBypassServiceWorker({ bypass: true });
await client.Emulation.setUserAgentOverride({ userAgent: deviceProfile.userAgent });
```

Key rules:
- Import `createNewTarget`, `DEVICE_PROFILES`, `DeviceType` from `'../cdp/connection'`.
- Resolve the device profile at the top: `const deviceProfile = DEVICE_PROFILES[device]`.
- Register event listeners (`client.Network.responseReceived(...)`) **before** `Page.navigate`.
- Wait for load: `await client.Page.loadEventFired()`.
- Always close in `finally`: `await connection.close()`.

---

## 5. Runtime.evaluate Pattern

```typescript
const result = await client.Runtime.evaluate({
  expression: `
    (function() {
      // Multi-statement expressions always use IIFE
      const items = [];
      document.querySelectorAll('a[href]').forEach(el => {
        items.push(el.href);
      });
      return items;
    })()
  `,
  returnByValue: true,   // always present — never rely on remote object handles
});
const data = result.result.value as SomeType;  // cast required; CDP response is untyped
```

**Invariants:**
- Multi-statement expressions always use IIFE: `(function() { ... })()`
- `returnByValue: true` is always set
- Cast result: `result.result.value as SomeType`
- Null/undefined fallback: `|| []` or `|| null` on the cast expression
- Internal helper functions that receive `client` type it as `any`: `async function fn(client: any, ...)`

---

## 6. Connection Ownership Rule

Every core check function creates its own connection and closes it in `finally`.
Helper functions that need CDP receive `client: any` as a parameter — they do NOT open or close connections.

**Standard pattern (core function owns connection):**
```typescript
export async function checkSSR(options: CheckSSROptions): Promise<SSRCheckResult> {
  const connection = await createNewTarget();
  const { client } = connection;
  try {
    // ... all work including calls to helpers that receive client
    return result;
  } finally {
    await connection.close();
  }
}
// Helper receives client, never opens/closes on its own
function analyzeLinks(client: any, url: string): Promise<...>
```

**Exception — `discover-phase1.ts`:** `runPhase1Discovery()` opens one connection,
then passes `client` to `crawlSiteLinks()`, `dismissConsentDialog()`, `discoverPageTypes()`, etc.
Those helpers do NOT own the connection. Only `runPhase1Discovery()` calls `connection.close()`.
This pattern is intentional to avoid opening 5 tabs when one is sufficient for discovery.

---

## 7. File Saving Pattern

```typescript
import { createRunDir, saveJson, saveHtml, extractDomain } from '../utils/artifacts';

let savedTo: string | undefined;
if (saveToFile) {
  const runDir = createRunDir(extractDomain(url));
  savedTo = saveJson(runDir, 'filename.json', payload);
}

return { ...result, savedTo };
```

`savedTo` is optional on the result interface and only set when `saveToFile` is true.
