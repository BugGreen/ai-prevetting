/**
 * page-types.ts
 *
 * Page-type discovery for Phase 1 Discovery.
 * Calls crawlSiteLinks(), then selects one representative URL per inferred type
 * to produce Step1ParsedReport.pageTypes — the field that enables
 * findNavigationTargetUrl() and unlocks the navigation check.
 *
 * Conventions followed: docs/architecture/08-existing-conventions.md
 */

import { SiteLink, crawlSiteLinks } from './crawl';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PageType {
  /** Human-readable canonical name used in Step1ParsedReport */
  name: string;
  /** Representative URL for this page type */
  urlPattern: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Links with score below this threshold are excluded from page-type selection */
export const MIN_CONFIDENCE_THRESHOLD = 0.5;

// ─── Mapping ──────────────────────────────────────────────────────────────────

const TYPE_NAMES: Record<NonNullable<Exclude<SiteLink['inferredType'], 'home' | 'other'>>, string> = {
  plp: 'PLP',
  pdp: 'PDP',
  content: 'Content',
};

// ─── Pure Selection Logic ─────────────────────────────────────────────────────

/**
 * Pure function: select one representative PageType per inferred type from a
 * pre-collected SiteLink array.
 *
 * Sorting, threshold filtering, deduplication, and warning emission all live
 * here — fully testable without a Chrome instance.
 *
 * Called by:
 *   - discoverPageTypes(): wraps this after crawlSiteLinks()
 */
export function selectPageTypes(links: SiteLink[], baseUrl: string): PageType[] {
  // 1. Explicit sort DESC so caller doesn't need to pre-sort
  const sorted = [...links].sort((a, b) => b.score - a.score);

  // Homepage is always the first entry — it is the audit scope anchor
  const result: PageType[] = [
    { name: 'Homepage', urlPattern: baseUrl },
  ];

  const seen = new Set<string>(['home']);

  for (const link of sorted) {
    const type = link.inferredType;

    // Skip homepage (already added), other (not a useful navigation target),
    // and null (shouldn't occur after classifyLink, but guard anyway)
    if (!type || type === 'home' || type === 'other') continue;

    // 2. Minimum quality gate — ignore low-confidence classifications
    if (link.score < MIN_CONFIDENCE_THRESHOLD) continue;

    if (seen.has(type)) continue;

    seen.add(type);
    result.push({
      name: TYPE_NAMES[type as keyof typeof TYPE_NAMES],
      urlPattern: link.href,
    });
  }

  // 3. Warn on missing high-value types so callers notice incomplete discovery
  if (!result.find(t => t.name === 'PLP')) {
    console.warn('discoverPageTypes: no confident PLP could be identified from crawled links');
  }
  if (!result.find(t => t.name === 'PDP')) {
    console.warn('discoverPageTypes: no confident PDP could be identified from crawled links');
  }

  return result;
}

// ─── Async Wrapper ────────────────────────────────────────────────────────────

/**
 * Discover the canonical page types present on the site by crawling and
 * classifying all visible homepage links.
 *
 * Thin async wrapper: calls crawlSiteLinks() then delegates to selectPageTypes().
 * All selection logic lives in selectPageTypes() for testability.
 *
 * Called by:
 *   - runPhase1Discovery(): step 9, after dismissBlockingModals()
 */
export async function discoverPageTypes(
  client: any,
  baseUrl: string,
): Promise<PageType[]> {
  const links = await crawlSiteLinks(client, baseUrl);
  return selectPageTypes(links, baseUrl);
}
