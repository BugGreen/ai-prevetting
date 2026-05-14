/**
 * crux.ts
 *
 * Fetches Chrome UX Report (CrUX) field data via the PageSpeed Insights API.
 * Runs two requests (mobile + desktop) and returns core web vitals metrics.
 *
 * No CDP dependency — uses HTTP fetch.
 * Requires a CRUX_API_KEY environment variable.
 *
 * Conventions followed: docs/architecture/08-existing-conventions.md
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CruxResult {
  mobile: Record<string, string> | null;
  desktop: Record<string, string> | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PSI_API_BASE = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

const METRIC_MAP: Record<string, string> = {
  LARGEST_CONTENTFUL_PAINT_MS: 'LCP',
  CUMULATIVE_LAYOUT_SHIFT_SCORE: 'CLS',
  INTERACTION_TO_NEXT_PAINT: 'INP',
  EXPERIMENTAL_TIME_TO_FIRST_BYTE: 'TTFB',
};

// ─── Internals ───────────────────────────────────────────────────────────────

async function fetchStrategy(
  url: string,
  apiKey: string,
  strategy: 'mobile' | 'desktop',
): Promise<Record<string, string> | null> {
  const params = new URLSearchParams({
    url,
    key: apiKey,
    strategy,
    category: 'performance',
  });

  const response = await fetch(`${PSI_API_BASE}?${params}`);
  if (!response.ok) return null;

  const data: any = await response.json();
  const metrics = data?.loadingExperience?.metrics;
  if (!metrics) return null;

  const result: Record<string, string> = {};
  for (const [apiName, shortName] of Object.entries(METRIC_MAP)) {
    const metric = metrics[apiName];
    if (metric) {
      result[shortName] = `${metric.percentile} (${metric.category})`;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

// ─── Function ────────────────────────────────────────────────────────────────

/**
 * Fetch CrUX field data from the PageSpeed Insights API.
 *
 * Called by:
 *   - runPhase1Discovery(): after connection.close(), HTTP-only
 */
export async function fetchCruxData(
  url: string,
  apiKey?: string,
): Promise<CruxResult | null> {
  const key = apiKey || process.env.CRUX_API_KEY;
  if (!key) return null;

  const [mobile, desktop] = await Promise.all([
    fetchStrategy(url, key, 'mobile'),
    fetchStrategy(url, key, 'desktop'),
  ]);

  if (!mobile && !desktop) return null;

  return { mobile, desktop };
}
