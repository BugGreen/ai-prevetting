/**
 * query-params.ts
 *
 * Detects known tracking/marketing query parameters referenced in page HTML
 * by scanning href attributes for utm_*, gclid, fbclid, etc.
 *
 * Pure function — no CDP dependency.
 *
 * Conventions followed: docs/architecture/08-existing-conventions.md
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QueryParamResult {
  trackingParams: string[];
}

// ─── Registry ────────────────────────────────────────────────────────────────

/**
 * Known tracking/marketing query parameter names.
 */
const KNOWN_TRACKING_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'msclkid',
  'dclid',
  'twclid',
  'ttclid',
  'mc_cid',
  'mc_eid',
];

// ─── Internals ───────────────────────────────────────────────────────────────

const HREF_PATTERN = /href=["']([^"']*\?[^"']*)["']/gi;

// ─── Function ────────────────────────────────────────────────────────────────

/**
 * Detect tracking query parameters present in page links.
 *
 * Called by:
 *   - runPhase1Discovery(): after detectTechStack(), pure function
 */
export function detectQueryParams(rawHtml: string): QueryParamResult {
  const found = new Set<string>();

  HREF_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = HREF_PATTERN.exec(rawHtml)) !== null) {
    const href = match[1];
    for (const param of KNOWN_TRACKING_PARAMS) {
      if (href.includes(`${param}=`) || href.includes(`&${param}=`)) {
        found.add(param);
      }
    }
  }

  return { trackingParams: Array.from(found) };
}
