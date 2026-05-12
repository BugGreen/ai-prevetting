/**
 * crawl.ts
 *
 * Homepage link crawler for Phase 1 Discovery.
 * Collects all visible, same-origin anchor links from the current page via a
 * single Runtime.evaluate call per attempt, then classifies and scores them
 * in pure TypeScript.
 *
 * Safety mechanisms:
 *   - Visibility filter: elements with zero bounding rect are skipped in the
 *     evaluate expression, excluding hidden mobile menus and off-screen drawers.
 *   - SPA hydration polling: if evaluate returns 0 links, the function waits
 *     POLL_INTERVAL_MS and retries, up to MAX_POLL_ATTEMPTS times. This ensures
 *     CSR apps have finished rendering before links are extracted.
 *
 * The pure classification logic (classifyLink) is intentionally separate from
 * the CDP call so it is fully unit-testable without a browser.
 *
 * Conventions followed: docs/architecture/08-existing-conventions.md
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum evaluate attempts before returning whatever we have.
 * Each attempt waits POLL_INTERVAL_MS, so max total wait is
 * (MAX_POLL_ATTEMPTS - 1) * POLL_INTERVAL_MS.
 */
const MAX_POLL_ATTEMPTS = 6;

/** Milliseconds to wait between polling attempts. */
const POLL_INTERVAL_MS = 500;

/**
 * Hard ceiling on how many visible anchor elements the evaluate expression
 * will collect from the DOM. Intentionally much larger than the default
 * maxLinks (200) so that scoring and slicing happen in TypeScript after
 * sorting — high-score links are never crowded out by mega-menu noise that
 * appears first in DOM order.
 */
const DOM_EXTRACTION_CEILING = 2000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SiteLink {
  href: string;
  text: string;
  /** 0.0–1.0 heuristic confidence that the inferred type is correct */
  score: number;
  inferredType: 'plp' | 'pdp' | 'home' | 'content' | 'other' | null;
}

// ─── Classification Patterns ──────────────────────────────────────────────────

const EXCLUSION_PATTERNS: RegExp[] = [
  /\/cart\b/i,
  /\/checkout\b/i,
  /\/account\b/i,
  /\/login\b/i,
  /\/signin\b/i,
  /\/signup\b/i,
  /\/register\b/i,
  /\/logout\b/i,
  /\/auth\b/i,
  /\/wishlist\b/i,
];

const PLP_PATTERNS: RegExp[] = [
  /\/categor(y|ies)(\/|$)/i,       // /category/, /categories/
  /\/collections?(\/|$)/i,          // /collection/, /collections/
  /\/shop(\/|$)/i,                  // /shop/
  /\/department(s)?(\/|$)/i,
  /\/aisle(s)?(\/|$)/i,
  /\/browse(\/|$)/i,
  /\/c(\/|$)/,                      // /c/ (short PLP segment)
  /\/katalog(\/|$)/i,               // German: catalogue
  /\/kategori(e|en)(\/|$)/i,        // German: category
  /\/sortiment(\/|$)/i,             // German: assortment
];

const PDP_PATTERNS: RegExp[] = [
  /\/products?(\/|$)/i,             // /product/, /products/
  /\/p(\/|$)/,                      // /p/ (short PDP segment)
  /\/items?(\/|$)/i,
  /\/detail(s)?(\/|$)/i,
  /\/dp(\/|$)/i,                    // Amazon-style
  /\/produkt(e)?(\/|$)/i,           // German: product
];

// ─── Pure Classification Logic ────────────────────────────────────────────────

/**
 * Classify a single href against known URL patterns.
 * Pure function — no CDP, no network. Returns null to signal exclusion.
 */
export function classifyLink(
  href: string,
  origin: string,
): { score: number; inferredType: SiteLink['inferredType'] } | null {
  let pathname: string;

  try {
    const parsed = new URL(href);
    if (parsed.origin !== origin) return null;         // external domain
    if (parsed.hash && !parsed.pathname) return null;  // fragment-only
    pathname = parsed.pathname;
  } catch {
    return null;                                       // unparseable href
  }

  if (/^(mailto|tel|javascript):/i.test(href)) return null;
  if (href.startsWith('#')) return null;
  if (EXCLUSION_PATTERNS.some(p => p.test(pathname))) return null;

  if (pathname === '/' || pathname === '') {
    return { score: 0.1, inferredType: 'home' };
  }

  if (PLP_PATTERNS.some(p => p.test(pathname))) {
    return { score: 0.8, inferredType: 'plp' };
  }

  if (PDP_PATTERNS.some(p => p.test(pathname))) {
    return { score: 0.6, inferredType: 'pdp' };
  }

  return { score: 0.2, inferredType: 'other' };
}

// ─── Function ─────────────────────────────────────────────────────────────────

/**
 * Collect and classify all visible, same-origin links from the currently loaded page.
 *
 * Visibility: only elements with a non-zero bounding rect are returned by the
 * evaluate expression. This excludes hidden mobile menus, off-screen drawers,
 * and display:none fallbacks that are present in the DOM but not rendered.
 * Note: getBoundingClientRect() is used (not offsetParent) because offsetParent
 * is null for position:fixed elements even when they are visually rendered.
 *
 * SPA hydration: if the evaluate returns 0 links, the function waits
 * POLL_INTERVAL_MS and retries up to MAX_POLL_ATTEMPTS times before returning
 * an empty array. This ensures CSR apps have time to render their nav before
 * link extraction runs.
 *
 * @param client    CDP client (page already navigated and loadEventFired)
 * @param baseUrl   Full URL of the page — used to derive same-origin filter
 * @param maxLinks  Max anchor elements to read from DOM (default 200)
 *
 * Called by:
 *   - discoverPageTypes(): passes result directly for PLP/PDP classification
 *   - runPhase1Discovery(): step 8
 */
export async function crawlSiteLinks(
  client: any,
  baseUrl: string,
  maxLinks = 200,
): Promise<SiteLink[]> {
  const origin = new URL(baseUrl).origin;

  let rawLinks: { href: string; text: string }[] = [];
  let previousCount = -1;

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const evalResult = await client.Runtime.evaluate({
      expression: `(function() {
        var els = document.querySelectorAll('a[href]');
        var links = [];
        for (var i = 0; i < els.length && links.length < ${DOM_EXTRACTION_CEILING}; i++) {
          var el = els[i];
          var rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          links.push({
            href: el.href,
            text: (el.innerText || el.textContent || '').trim().slice(0, 120),
          });
        }
        return links;
      })()`,
      returnByValue: true,
    });

    const current = evalResult.result.value as { href: string; text: string }[];
    if (!Array.isArray(current)) return [];

    const currentCount = current.length;
    rawLinks = current;

    // Stabilization: two consecutive polls with the same non-zero count means
    // the DOM has settled. A count of 0 is never considered stable — it means
    // the page is still loading. A count change (app shell → hydrated content)
    // means we must keep waiting.
    if (currentCount > 0 && currentCount === previousCount) break;

    previousCount = currentCount;

    if (attempt < MAX_POLL_ATTEMPTS - 1) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  const seen = new Set<string>();
  const result: SiteLink[] = [];

  for (const raw of rawLinks) {
    if (!raw.href || seen.has(raw.href)) continue;
    seen.add(raw.href);

    const classification = classifyLink(raw.href, origin);
    if (classification === null) continue;

    result.push({
      href: raw.href,
      text: raw.text,
      score: classification.score,
      inferredType: classification.inferredType,
    });
  }

  // Sort by score descending, then enforce the caller's maxLinks budget.
  // Slicing after sorting guarantees high-score links (PLP/PDP) are never
  // displaced by low-score mega-menu links that happen to appear first in DOM order.
  return result.sort((a, b) => b.score - a.score).slice(0, maxLinks);
}
