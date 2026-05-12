/**
 * modals.ts
 *
 * Blocking-modal dismissal for Phase 1 Discovery.
 * Handles any pre-content overlay in sequence: geo-routing modals, GDPR/cookie
 * banners, newsletter gates, etc. Loops until no registered modal is visible
 * (max 3 iterations) so stacked modals are cleared in one call.
 *
 * Static registry (BLOCKING_MODAL_REGISTRY) and execution logic
 * (dismissBlockingModals) are co-located — the registry is an internal
 * implementation detail of this function only.
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
 * Registry of known blocking-modal dismiss targets, evaluated in order.
 * To add a new modal: append one entry — the function body never changes.
 *
 * Ordering matters: entries that appear first are probed first each iteration.
 * Put routing modals before consent banners because routing modals typically
 * appear before the GDPR layer is rendered.
 */
const BLOCKING_MODAL_REGISTRY: BlockingModalEntry[] = [

  // ── Routing / geo-language modals ────────────────────────────────────────
  {
    selector: 'button',
    matchText: /stay on www\.fritz-berger\.de/i,
    targetDomains: ['fritz-berger.de'],
    category: 'routing',
    method: 'fritz-berger-routing',
  },

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
 * Each iteration makes two Runtime.evaluate calls:
 *   1. Probe — find the first visible, matching element
 *   2. Click — click that element (skipped when probe finds nothing)
 *
 * targetDomains filtering happens in TypeScript before any CDP call, so
 * site-specific entries are never sent to unrelated pages.
 *
 * Called by:
 *   - check-images.ts    : after loadEventFired() + 2s wait, before DOM queries
 *   - check-ssr.ts       : after loadEventFired(), before 3s wait
 *   - check-navigation.ts: after waitForHydration, before findMatchingLink()
 */
export async function dismissBlockingModals(client: any): Promise<DismissResult> {
  const MAX_ITERATIONS = 3;
  const methods: string[] = [];

  // Resolve current hostname once — used to filter targetDomains entries
  const hostnameResult = await client.Runtime.evaluate({
    expression: 'window.location.hostname',
    returnByValue: true,
  });
  const hostname: string = hostnameResult.result.value ?? '';

  // Filter registry to entries applicable to this domain
  const applicableRegistry = BLOCKING_MODAL_REGISTRY.filter(entry =>
    !entry.targetDomains ||
    entry.targetDomains.some(domain => hostname.endsWith(domain))
  );

  // Serialise once (RegExp → { source, flags } so JSON.stringify works)
  const serialised = applicableRegistry.map(entry => ({
    selector: entry.selector,
    matchText: entry.matchText?.source ?? null,
    matchTextFlags: entry.matchText?.flags ?? '',
    method: entry.method,
  }));
  const registryJson = JSON.stringify(serialised);

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // ── Call 1: probe ─────────────────────────────────────────────────────
    const probeResult = await client.Runtime.evaluate({
      expression: `(function() {
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
