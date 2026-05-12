/**
 * tech-stack.ts
 *
 * Tech-stack detection for Phase 1 Discovery.
 * Pure function — no CDP dependency. Parses raw HTML and response headers
 * using static signal registries to produce a multi-value { category: value[] } dict.
 *
 * Conventions followed: docs/architecture/08-existing-conventions.md
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum characters of rawHtml scanned for tech signals.
 * Tech markers (__NEXT_DATA__, window.Shopify, etc.) live in <head> or early
 * <body>. Capping the scan prevents CPU spikes on anomalous multi-MB pages.
 */
const HTML_SCAN_LIMIT = 250_000;

/**
 * Maximum length accepted for useRawValue header values.
 * Prevents giant encoded strings (e.g. JWT blobs in x-powered-by) from
 * bloating the final report.
 */
const MAX_RAW_HEADER_LENGTH = 100;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Flat map of detected tech stack categories to all detected values.
 * Multiple values per category are supported — e.g. a Next.js page returns
 * { Framework: ['Next.js', 'React'] } because both signals are present.
 */
export type TechStackResult = Record<string, string[]>;

// ─── Internal Registry Types ──────────────────────────────────────────────────

interface HtmlSignal {
  pattern: RegExp;
  category: string;
  value: string;
}

/**
 * Discriminated union — when useRawValue is true, no value string is needed
 * because the actual header value is used at runtime.
 */
type HeaderSignal =
  | {
      header: string;
      contains?: string;
      equals?: string;
      category: string;
      value: string;
      useRawValue?: false;
    }
  | {
      header: string;
      contains?: string;
      equals?: string;
      category: string;
      useRawValue: true;
    };

// ─── HTML Signal Registry ─────────────────────────────────────────────────────

/**
 * Every matching signal is recorded — all values accumulate per category.
 * Order still matters for human readability of the output array, but no
 * longer determines which signal "wins".
 */
const HTML_SIGNALS: HtmlSignal[] = [
  // Frameworks — Next.js listed before generic React (Next pages include both markers)
  { pattern: /__NEXT_DATA__/,               category: 'Framework', value: 'Next.js' },
  { pattern: /__NUXT__|window\.__nuxt/,      category: 'Framework', value: 'Nuxt' },
  { pattern: /data-reactroot/,               category: 'Framework', value: 'React' },
  { pattern: /data-v-[a-f0-9]/,              category: 'Framework', value: 'Vue' },

  // CMS / e-commerce platforms
  { pattern: /window\.Shopify\s*=/,          category: 'CMS', value: 'Shopify' },
  { pattern: /window\.Magento\s*=/,          category: 'CMS', value: 'Magento' },
  { pattern: /window\._mstConfig\s*=|window\.SalesforceInteractions/, category: 'CMS', value: 'Salesforce CC' },

  // A/B testing tools
  { pattern: /window\.optimizely|window\.Optimizely/, category: 'AB Testing', value: 'Optimizely' },
  { pattern: /window\.VWO\b/,                category: 'AB Testing', value: 'VWO' },
  { pattern: /window\.ABTasty\s*=/,          category: 'AB Testing', value: 'ABTasty' },
  { pattern: /window\.google_optimize/,      category: 'AB Testing', value: 'Google Optimize' },

  // Tag management / data layer
  { pattern: /window\.dataLayer\s*=/,        category: 'Tag Manager', value: 'GTM' },

  // Performance / delivery features
  { pattern: /<script[^>]+type=["']speculationrules["']/, category: 'Speculation Rules', value: 'Yes' },
  { pattern: /SW_BAQEND|["']baqend["']/,                  category: 'Speed Kit',         value: 'Active' },
];

// ─── Header Signal Registry ───────────────────────────────────────────────────

/**
 * CDN and server detection from response headers.
 * Mirrors the detectCDN logic in get-headers.ts — kept co-located here
 * so tech-stack detection has no cross-command import dependency.
 *
 * useRawValue: true — use the actual header value rather than a fixed string.
 * Used for x-powered-by and x-generator where the value is site-specific.
 */
const HEADER_SIGNALS: HeaderSignal[] = [
  // CDN detection
  { header: 'cf-ray',                                       category: 'CDN', value: 'Cloudflare' },
  { header: 'x-amz-cf-id',                                 category: 'CDN', value: 'CloudFront' },
  { header: 'x-akamai-transformed',                        category: 'CDN', value: 'Akamai' },
  { header: 'x-served-by',      contains: 'cache-',        category: 'CDN', value: 'Fastly' },
  { header: 'x-cdn',            equals:   'imperva',       category: 'CDN', value: 'Imperva' },
  { header: 'via',              contains: 'cloudfront',    category: 'CDN', value: 'CloudFront' },
  { header: 'via',              contains: 'varnish',       category: 'CDN', value: 'Varnish' },
  { header: 'server',           contains: 'cloudflare',    category: 'CDN', value: 'Cloudflare' },
  { header: 'server',           contains: 'akamai',        category: 'CDN', value: 'Akamai' },
  { header: 'x-cache-status',                              category: 'CDN', value: 'Generic CDN' },

  // Server / framework via headers — raw header value used directly
  { header: 'x-powered-by', category: 'Server', useRawValue: true },
  { header: 'x-generator',  category: 'CMS',    useRawValue: true },
];

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Append value to result[category], skipping exact duplicates.
 *
 * Insertion order is intentionally preserved — HTML_SIGNALS is ordered
 * most-specific-first (e.g. Next.js before React), so the output array
 * naturally lists the primary technology first.
 */
function push(result: TechStackResult, category: string, value: string): void {
  if (!result[category]) result[category] = [];
  if (!result[category].includes(value)) result[category].push(value);
}

// ─── Function ─────────────────────────────────────────────────────────────────

/**
 * Detect tech stack from raw HTML and response headers.
 *
 * Pure function — no CDP, no async. Fully unit-testable without a browser.
 * Returns a multi-value dict: every matching signal is recorded, so a site
 * running Next.js (which embeds React) correctly yields
 * { Framework: ['Next.js', 'React'] }.
 *
 * Called by:
 *   - runPhase1Discovery(): step 10, after page load + Network.getResponseBody()
 */
export function detectTechStack(
  rawHtml: string,
  headers: Record<string, string>,
): TechStackResult {
  const result: TechStackResult = {};

  // ── HTML signals ────────────────────────────────────────────────────────────
  // Scan only the leading slice — tech markers live in <head> / early <body>
  const searchSpace = rawHtml.slice(0, HTML_SCAN_LIMIT);

  for (const signal of HTML_SIGNALS) {
    if (signal.pattern.test(searchSpace)) {
      push(result, signal.category, signal.value);
    }
  }

  // ── Header signals ──────────────────────────────────────────────────────────
  const lowerHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    lowerHeaders[k.toLowerCase()] = v;
  }

  for (const signal of HEADER_SIGNALS) {
    const headerValue = lowerHeaders[signal.header];
    if (headerValue === undefined) continue;

    const lv = headerValue.toLowerCase();
    if (signal.contains && !lv.includes(signal.contains.toLowerCase())) continue;
    if (signal.equals   && lv !== signal.equals.toLowerCase())           continue;

    if (signal.useRawValue) {
      if (headerValue.length > MAX_RAW_HEADER_LENGTH) continue;
      push(result, signal.category, headerValue);
    } else {
      push(result, signal.category, signal.value);
    }
  }

  return result;
}
