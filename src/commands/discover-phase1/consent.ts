/**
 * consent.ts
 *
 * Consent-banner dismissal for Phase 1 Discovery.
 * Static registry (CONSENT_REGISTRY) and execution logic (dismissConsentDialog)
 * are co-located here — the registry is an internal implementation detail of
 * this function and is not shared with any other module.
 *
 * Conventions followed: docs/architecture/08-existing-conventions.md
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConsentResult {
  dismissed: boolean;
  /** null when dismissed is false */
  method: 'cookiebot' | 'onetrust' | 'trustarc' | 'generic-accept' | null;
  /** The CSS selector that was clicked, null when dismissed is false */
  selector: string | null;
}

interface ConsentEntry {
  selector: string;
  method: ConsentResult['method'];
}

// ─── Registry ─────────────────────────────────────────────────────────────────

/**
 * Registry of known consent-banner selectors, tried in order.
 * To add a new CMP: append one entry here — the function body never changes.
 */
const CONSENT_REGISTRY: ConsentEntry[] = [
  { selector: '#CybotCookiebotDialogBodyButtonAccept',  method: 'cookiebot' },
  { selector: '.onetrust-accept-btn-handler',           method: 'onetrust' },
  { selector: '#onetrust-accept-btn-handler',           method: 'onetrust' },
  { selector: '.trustarc-agree-btn',                    method: 'trustarc' },
  { selector: '[data-consent-accept]',                  method: 'generic-accept' },
];

// ─── Function ─────────────────────────────────────────────────────────────────

/**
 * Probe-and-click a consent banner using a registry of known CMP selectors.
 * Pure CDP — no navigation. Operates on the currently loaded page.
 *
 * Two Runtime.evaluate calls:
 *   1. Probe   — find the first visible matching element; return { found, selector, method }
 *   2. Click   — click that element (only called when found=true)
 *
 * Uses a Registry pattern: adding a new CMP = appending one entry to
 * CONSENT_REGISTRY above. The function body itself never changes.
 *
 * Called by:
 *   - check-images.ts   : after loadEventFired() + 2s wait, before DOM queries
 *   - check-ssr.ts      : after loadEventFired(), before 3s wait
 *   - check-navigation.ts: after waitForHydration, before findMatchingLink()
 */
export async function dismissConsentDialog(client: any): Promise<ConsentResult> {
  // Serialise the registry for injection into the page context
  const registryJson = JSON.stringify(CONSENT_REGISTRY);

  // --- Call 1: probe — find first visible, matching selector ---
  const probeResult = await client.Runtime.evaluate({
    expression: `(function() {
      var registry = ${registryJson};
      for (var i = 0; i < registry.length; i++) {
        var el = document.querySelector(registry[i].selector);
        if (el) {
          var rect = el.getBoundingClientRect();
          var visible = rect.width > 0 && rect.height > 0;
          if (visible) {
            return { found: true, selector: registry[i].selector, method: registry[i].method };
          }
        }
      }
      return { found: false, selector: null, method: null };
    })()`,
    returnByValue: true,
  });

  const probe = probeResult.result.value as {
    found: boolean;
    selector: string | null;
    method: ConsentResult['method'];
  };

  if (!probe.found || !probe.selector) {
    return { dismissed: false, method: null, selector: null };
  }

  // --- Call 2: click the found element ---
  await client.Runtime.evaluate({
    expression: `(function() {
      var el = document.querySelector(${JSON.stringify(probe.selector)});
      if (el) { el.click(); return true; }
      return false;
    })()`,
    returnByValue: true,
  });

  // Give the banner animation time to finish before the caller reads the DOM
  await new Promise(resolve => setTimeout(resolve, 800));

  return { dismissed: true, method: probe.method, selector: probe.selector };
}
