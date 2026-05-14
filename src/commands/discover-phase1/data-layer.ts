/**
 * data-layer.ts
 *
 * Detects window.dataLayer (GTM) presence and extracts interesting keys
 * related to user state, experiments, payments, and currency.
 *
 * CDP-dependent — requires an active client connection.
 *
 * Conventions followed: docs/architecture/08-existing-conventions.md
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DataLayerResult {
  hasDataLayer: boolean;
  entryCount: number;
  interestingKeys: string[];
}

// ─── Registry ────────────────────────────────────────────────────────────────

/**
 * Substrings that mark a dataLayer key as "interesting" for pre-vetting.
 */
const INTERESTING_KEY_PATTERNS = [
  'user',
  'payment',
  'test',
  'variant',
  'experiment',
  'currency',
  'abtest',
  'personali',
  'segment',
];

// ─── Function ────────────────────────────────────────────────────────────────

/**
 * Detect GTM dataLayer and extract interesting keys.
 *
 * Called by:
 *   - runPhase1Discovery(): after detectServiceWorkers(), CDP-dependent
 */
export async function detectDataLayer(client: any): Promise<DataLayerResult> {
  const { result } = await client.Runtime.evaluate({
    expression: `
      (function() {
        if (!window.dataLayer || !Array.isArray(window.dataLayer)) return JSON.stringify(null);
        var keys = new Set();
        window.dataLayer.forEach(function(entry) {
          if (entry && typeof entry === 'object') {
            Object.keys(entry).forEach(function(k) { keys.add(k); });
          }
        });
        return JSON.stringify({ entryCount: window.dataLayer.length, keys: Array.from(keys) });
      })()
    `,
    returnByValue: true,
  });

  const parsed = JSON.parse(result.value || 'null');

  if (!parsed) {
    return { hasDataLayer: false, entryCount: 0, interestingKeys: [] };
  }

  const interestingKeys = (parsed.keys as string[]).filter(key =>
    INTERESTING_KEY_PATTERNS.some(pattern => key.toLowerCase().includes(pattern)),
  );

  return {
    hasDataLayer: true,
    entryCount: parsed.entryCount,
    interestingKeys,
  };
}
