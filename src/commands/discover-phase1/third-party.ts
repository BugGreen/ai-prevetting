/**
 * third-party.ts
 *
 * Detects third-party domains loaded on the page by scanning rawHtml for
 * external <script src>, <link href>, <img src>, and <iframe src> attributes.
 *
 * Pure function — no CDP dependency.
 *
 * Conventions followed: docs/architecture/08-existing-conventions.md
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ThirdPartyResult {
  domains: Array<{
    domain: string;
    count: number;
    types: string[];  // 'script' | 'link' | 'img' | 'iframe'
  }>;
}

// ─── Internals ───────────────────────────────────────────────────────────────

/**
 * Matches src="..." or href="..." attributes containing absolute URLs.
 * Captures: [1] = element name (script|link|img|iframe), [2] = URL
 */
const RESOURCE_PATTERN = /<(script|link|img|iframe)\b[^>]*?\b(?:src|href)=["'](https?:\/\/[^"']+)["']/gi;

// ─── Function ────────────────────────────────────────────────────────────────

/**
 * Extract all external (third-party) domains referenced in the page HTML.
 *
 * Called by:
 *   - runPhase1Discovery(): after detectTechStack(), pure function
 */
export function detectThirdPartyDomains(
  rawHtml: string,
  origin: string,
): ThirdPartyResult {
  let originHost: string;
  try {
    originHost = new URL(origin).hostname;
  } catch {
    return { domains: [] };
  }

  const domainMap = new Map<string, { count: number; types: Set<string> }>();
  let match: RegExpExecArray | null;

  // Reset lastIndex for global regex
  RESOURCE_PATTERN.lastIndex = 0;

  while ((match = RESOURCE_PATTERN.exec(rawHtml)) !== null) {
    const elementType = match[1].toLowerCase();
    const url = match[2];

    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      continue;
    }

    // Skip same-origin
    if (hostname === originHost || hostname === `www.${originHost}` || `www.${hostname}` === originHost) {
      continue;
    }

    const entry = domainMap.get(hostname);
    if (entry) {
      entry.count++;
      entry.types.add(elementType);
    } else {
      domainMap.set(hostname, { count: 1, types: new Set([elementType]) });
    }
  }

  const domains = Array.from(domainMap.entries())
    .map(([domain, { count, types }]) => ({
      domain,
      count,
      types: Array.from(types),
    }))
    .sort((a, b) => b.count - a.count);

  return { domains };
}
