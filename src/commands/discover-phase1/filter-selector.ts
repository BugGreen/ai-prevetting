/**
 * filter-selector.ts
 *
 * Navigates to a PLP URL and probes the DOM for filter/facet elements
 * using heuristic selectors. Returns the first matching selector.
 *
 * CDP-dependent — requires an active client connection.
 * Requires an extra navigation to the PLP page.
 *
 * Conventions followed: docs/architecture/08-existing-conventions.md
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FilterSelectorResult {
  found: boolean;
  selector: string | null;
  method: string;
}

// ─── Registry ────────────────────────────────────────────────────────────────

/**
 * Heuristic selectors for filter/facet containers, ordered by specificity.
 * The first match wins.
 */
const FILTER_SELECTORS = [
  '[data-filter-panel]',
  '[data-facet]',
  '[data-filters]',
  '.filter-panel',
  '.facet-panel',
  '.product-filter',
  '.product-filters',
  '#filter-sidebar',
  '#facet-sidebar',
  '[class*="filter"][class*="panel"]',
  '[class*="facet"]',
  'aside[class*="filter"]',
  'nav[class*="filter"]',
  'form[class*="filter"]',
];

// ─── Function ────────────────────────────────────────────────────────────────

/**
 * Discover a filter/facet selector on a PLP page.
 *
 * Called by:
 *   - runPhase1Discovery(): only if pageTypes includes a PLP, CDP-dependent
 */
export async function discoverFilterSelector(
  client: any,
  plpUrl: string,
): Promise<FilterSelectorResult> {
  await client.Page.navigate({ url: plpUrl });
  await client.Page.loadEventFired();

  const selectors = JSON.stringify(FILTER_SELECTORS);

  const { result } = await client.Runtime.evaluate({
    expression: `
      (function() {
        var selectors = ${selectors};
        for (var i = 0; i < selectors.length; i++) {
          if (document.querySelector(selectors[i])) {
            return selectors[i];
          }
        }
        return null;
      })()
    `,
    returnByValue: true,
  });

  const selector = result.type !== 'undefined' && result.value ? result.value : null;

  return {
    found: selector !== null,
    selector,
    method: selector ? 'heuristic-selector' : 'none',
  };
}
