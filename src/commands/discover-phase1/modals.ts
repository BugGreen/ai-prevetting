/**
 * modals.ts
 *
 * Blocking-modal dismissal for Phase 1 Discovery.
 * Handles any pre-content overlay in sequence: geo-routing modals, GDPR/cookie
 * banners, newsletter gates, etc. Loops until no registered modal is visible
 * (max 3 iterations) so stacked modals are cleared in one call.
 *
 * Detection strategy (per iteration, in priority order):
 *   1. Dynamic routing check — if targetHostname is provided, looks for any
 *      visible button whose innerText contains the target domain. Catches
 *      language/geo routing modals on any site without hardcoded registry entries.
 *   2. Static registry — known CMP selectors (Cookiebot, OneTrust, TrustArc, …).
 *
 * Static registry (BLOCKING_MODAL_REGISTRY) and execution logic are co-located —
 * the registry is an internal implementation detail of this function only.
 *
 * Conventions followed: docs/architecture/08-existing-conventions.md
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DismissResult {
  dismissed: boolean;
  /** Total number of modals cleared in this call */
  count: number;
  /** Ordered list of method labels, one per cleared modal */
  methods: string[];
}

interface BlockingModalEntry {
  /** CSS selector for the dismiss/accept button */
  selector: string;
  /** When set, the element's innerText must also match this pattern */
  matchText?: RegExp;
  /**
   * When set, this entry is only evaluated on pages whose hostname ends with
   * one of these domains. Omit to apply globally.
   */
  targetDomains?: string[];
  category: 'consent' | 'routing' | 'newsletter' | 'age-gate';
  /** Descriptive label used in DismissResult.methods */
  method: string;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

/**
 * Registry of known blocking-modal dismiss targets, evaluated after the
 * dynamic routing check each iteration.
 *
 * To add a new modal: append one entry — the function body never changes.
 * For site-specific entries, use targetDomains so the entry is a no-op on
 * unrelated pages.
 */
const BLOCKING_MODAL_REGISTRY: BlockingModalEntry[] = [
  // ── Consent / GDPR banners ───────────────────────────────────────────────
  { selector: '#CybotCookiebotDialogBodyButtonAccept',  category: 'consent', method: 'cookiebot' },
  { selector: '.onetrust-accept-btn-handler',           category: 'consent', method: 'onetrust' },
  { selector: '#onetrust-accept-btn-handler',           category: 'consent', method: 'onetrust' },
  { selector: '.trustarc-agree-btn',                    category: 'consent', method: 'trustarc' },
  { selector: '[data-consent-accept]',                  category: 'consent', method: 'generic-accept' },
];

// ─── Function ─────────────────────────────────────────────────────────────────

/**
 * Dismiss all visible blocking modals on the currently loaded page.
 * Runs up to MAX_ITERATIONS times, clearing one modal per iteration.
 *
 * @param client        CDP client (already connected, page loaded)
 * @param targetHostname  Hostname of the page under test (e.g. 'www.fritz-berger.de').
 *                        When provided, enables dynamic routing-modal detection:
 *                        any visible <button> whose text contains this hostname is
 *                        clicked first, before the static registry is checked.
 *                        Also used to filter targetDomains registry entries.
 *
 * Each iteration makes two Runtime.evaluate calls:
 *   1. Probe — find the first visible, matching element
 *   2. Click — click that element (skipped when probe finds nothing)
 *
 * Called by:
 *   - check-images.ts    : after loadEventFired() + 2s wait, before DOM queries
 *   - check-ssr.ts       : after loadEventFired(), before 3s wait
 *   - check-navigation.ts: after waitForHydration, before findMatchingLink()
 */
export async function dismissBlockingModals(
  client: any,
  targetHostname?: string,
): Promise<DismissResult> {
  const MAX_ITERATIONS = 3;
  const methods: string[] = [];

  // Filter static registry to entries applicable to this hostname
  const applicableRegistry = BLOCKING_MODAL_REGISTRY.filter(entry =>
    !entry.targetDomains ||
    (targetHostname !== undefined &&
      entry.targetDomains.some(domain => targetHostname.endsWith(domain)))
  );

  // Serialise static registry once (RegExp → { source, flags } for JSON)
  const serialisedRegistry = applicableRegistry.map(entry => ({
    selector: entry.selector,
    matchText: entry.matchText?.source ?? null,
    matchTextFlags: entry.matchText?.flags ?? '',
    method: entry.method,
  }));
  const registryJson = JSON.stringify(serialisedRegistry);

  // Escape targetHostname for safe use in RegExp inside the page context.
  // Uses simple string.includes() for the probe (no escaping needed there)
  // but the returned matchText must be regex-safe for the click expression.
  const regexSafeHostname = targetHostname
    ? targetHostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    : '';

  // Build the dynamic routing block injected at the top of each probe expression.
  // Empty string when no hostname is provided — dynamic check is skipped entirely.
  const dynamicRoutingBlock = targetHostname
    ? `
      // Dynamic routing check — find any visible button containing the target hostname
      var targetHostLower = ${JSON.stringify(targetHostname.toLowerCase())};
      var routingEls = document.querySelectorAll('button,[role="button"]');
      for (var d = 0; d < routingEls.length; d++) {
        var rel = routingEls[d];
        var rrect = rel.getBoundingClientRect();
        if (rrect.width === 0 || rrect.height === 0) continue;
        if ((rel.innerText || '').toLowerCase().includes(targetHostLower)) {
          return {
            found: true,
            selector: 'button,[role="button"]',
            matchText: ${JSON.stringify(regexSafeHostname)},
            matchTextFlags: 'i',
            method: 'dynamic-routing',
          };
        }
      }
    `
    : '';

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // ── Call 1: probe ─────────────────────────────────────────────────────
    const probeResult = await client.Runtime.evaluate({
      expression: `(function() {
        ${dynamicRoutingBlock}
        // Static registry check
        var registry = ${registryJson};
        for (var r = 0; r < registry.length; r++) {
          var entry = registry[r];
          var els = document.querySelectorAll(entry.selector);
          for (var e = 0; e < els.length; e++) {
            var el = els[e];
            var rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            if (entry.matchText) {
              var re = new RegExp(entry.matchText, entry.matchTextFlags);
              if (!re.test((el.innerText || '').trim())) continue;
            }
            return {
              found: true,
              selector: entry.selector,
              matchText: entry.matchText,
              matchTextFlags: entry.matchTextFlags,
              method: entry.method,
            };
          }
        }
        return { found: false };
      })()`,
      returnByValue: true,
    });

    const probe = probeResult.result.value as {
      found: boolean;
      selector?: string;
      matchText?: string | null;
      matchTextFlags?: string;
      method?: string;
    };

    if (!probe.found) break;

    // ── Call 2: click ─────────────────────────────────────────────────────
    await client.Runtime.evaluate({
      expression: `(function() {
        var selector = ${JSON.stringify(probe.selector)};
        var matchText = ${probe.matchText ? JSON.stringify(probe.matchText) : 'null'};
        var matchTextFlags = ${JSON.stringify(probe.matchTextFlags ?? '')};
        var els = document.querySelectorAll(selector);
        for (var e = 0; e < els.length; e++) {
          var el = els[e];
          if (matchText) {
            var re = new RegExp(matchText, matchTextFlags);
            if (!re.test((el.innerText || '').trim())) continue;
          }
          el.click();
          return true;
        }
        return false;
      })()`,
      returnByValue: true,
    });

    methods.push(probe.method!);

    // Allow banner animation to complete before the next probe
    await new Promise(resolve => setTimeout(resolve, 800));
  }

  return { dismissed: methods.length > 0, count: methods.length, methods };
}
