/**
 * orchestrator.ts
 *
 * runPhase1Discovery() — Phase 1 autonomous discovery entry point.
 * Opens one Chrome tab, runs every Phase 1 helper in sequence, closes the tab,
 * and returns a Step1ParsedReport directly in memory — no Markdown, no
 * parseStep1Report() needed.
 *
 * Conventions followed: docs/architecture/08-existing-conventions.md
 */

import { createNewTarget } from '../../cdp/connection';
import { Step1ParsedReport, extractDomain } from '../../utils/artifacts';
import { detectBotWall, BotWallResult } from './bot-wall';
import { dismissBlockingModals } from './modals';
import { discoverPageTypes } from './page-types';
import { detectTechStack } from './tech-stack';
import { detectThirdPartyDomains } from './third-party';
import { detectLanguages } from './languages';
import { detectQueryParams } from './query-params';
import { detectServiceWorkers } from './service-workers';
import { detectDataLayer } from './data-layer';
import { discoverFilterSelector } from './filter-selector';
import { fetchCruxData } from './crux';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum time (ms) allowed for the page navigate + loadEventFired sequence.
 * Sites with broken assets or slow network responses can hang indefinitely
 * without this guard.
 */
const PAGE_LOAD_TIMEOUT_MS = 30_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Runs `operation()` and rejects with a clear message if it does not settle
 * within `ms` milliseconds.
 *
 * Unlike a raw Promise.race with a floating setTimeout, this wrapper holds a
 * reference to the timer and calls clearTimeout in a finally block the moment
 * the operation completes — so a fast page load (e.g. 2 s) does not leave a
 * 30-second timer dragging on the Node event loop.
 */
async function withTimeout<T>(
  operation: () => Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });

  try {
    return await Promise.race([operation(), timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * Thrown when runPhase1Discovery detects a bot wall / challenge page.
 * Caught by handleFullCheckCommand → logged + run aborted with a clear message.
 */
export class BotWallError extends Error {
  constructor(
    public readonly targetUrl: string,
    public readonly wallType: BotWallResult['type'],
    public readonly wallConfidence: BotWallResult['confidence'],
  ) {
    super(
      `Bot wall detected on ${targetUrl} (${wallType}, ${wallConfidence} confidence). ` +
      `Manual bypass required.`,
    );
    this.name = 'BotWallError';
  }
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Autonomous Phase 1 discovery — replaces the human analyst for the mechanical
 * parts of the pre-vetting workflow.
 *
 * Execution sequence (single Chrome tab, sequential):
 *   1. createNewTarget()              → fresh isolated tab
 *   2. Network/Page/Runtime.enable()  → subscribe to events
 *   3. Page.navigate(url)             → load homepage   ┐ race vs
 *   4. Page.loadEventFired()          → wait for load   ┘ 30s timeout
 *   5. Network.getResponseBody()      → capture rawHtml + response headers
 *                                       FATAL if rawHtml is empty
 *   6. detectBotWall(rawHtml)         → ABORT with BotWallError if wall detected
 *   7. dismissBlockingModals()        → dismiss consent / routing modals
 *                                       NON-FATAL: warns and continues on failure
 *   8. discoverPageTypes()            → crawl + classify → pageTypes[]
 *                                       NON-FATAL: warns and returns [] on failure
 *   9. detectTechStack()              → rawHtml + headers → techStack{}
 *  10. detectThirdPartyDomains()      → rawHtml → external domains
 *                                       NON-FATAL: warns and continues on failure
 *  11. detectLanguages()              → rawHtml → html lang + hreflang tags
 *                                       NON-FATAL: warns and continues on failure
 *  12. detectQueryParams()            → rawHtml → tracking params
 *                                       NON-FATAL: warns and continues on failure
 *  13. detectServiceWorkers()         → CDP Runtime.evaluate → SW registrations
 *                                       NON-FATAL: warns and continues on failure
 *  14. detectDataLayer()              → CDP Runtime.evaluate → GTM dataLayer
 *                                       NON-FATAL: warns and continues on failure
 *  15. discoverFilterSelector()        → CDP Runtime.evaluate → filter selector
 *                                       NON-FATAL: warns and continues on failure
 *                                       SKIPPED: if no PLP found in pageTypes
 *  16. connection.close()             → destroy tab (always, via finally)
 *  17. fetchCruxData()                → PageSpeed Insights API → CrUX field data
 *                                       NON-FATAL: warns and continues on failure
 *                                       SKIPPED: if no CRUX_API_KEY env var
 *  18. return Step1ParsedReport
 *
 * Called by:
 *   - handleFullCheckCommand() in full-check.ts when no --report flag is passed
 */
async function runPhase1DiscoveryCDP(url: string): Promise<Step1ParsedReport> {
  const connection = await createNewTarget();
  const { client } = connection;

  try {
    await Promise.all([
      client.Network.enable({}),
      client.Page.enable(),
      client.Runtime.enable(),
    ]);

    // Capture main document request ID and response headers via Network events
    let mainRequestId = '';
    let responseHeaders: Record<string, string> = {};

    client.Network.responseReceived((params: any) => {
      if (params.type === 'Document') {
        mainRequestId = params.requestId;
        for (const [k, v] of Object.entries(params.response?.headers ?? {})) {
          responseHeaders[k.toLowerCase()] = v as string;
        }
      }
    });

    // ── Step 3+4: Navigate + wait for load, with timeout guard ───────────────
    await withTimeout(
      async () => {
        await client.Page.navigate({ url });
        await client.Page.loadEventFired();
      },
      PAGE_LOAD_TIMEOUT_MS,
      `Page.loadEventFired for ${url}`,
    );

    // ── Step 5: Capture raw HTML — fatal if empty ─────────────────────────────
    // An empty rawHtml passed to detectBotWall is a false negative (bot wall
    // goes undetected). An empty rawHtml passed to detectTechStack produces a
    // vacuously empty result that looks valid. Fail fast rather than silently.
    let rawHtml = '';
    if (mainRequestId) {
      try {
        const body = await client.Network.getResponseBody({ requestId: mainRequestId });
        rawHtml = body.base64Encoded
          ? Buffer.from(body.body, 'base64').toString('utf-8')
          : body.body;
      } catch {
        // fall through — empty rawHtml triggers the guard below
      }
    }

    if (!rawHtml) {
      throw new Error(`Failed to retrieve page HTML for ${url}`);
    }

    // ── Step 6: Bot wall safety gate ──────────────────────────────────────────
    const botWall = await detectBotWall(rawHtml);
    if (botWall.isWall) {
      throw new BotWallError(url, botWall.type, botWall.confidence);
    }

    // ── Step 7: Dismiss blocking modals (non-fatal) ───────────────────────────
    try {
      await dismissBlockingModals(client, new URL(url).hostname);
    } catch (err) {
      console.warn(
        `runPhase1Discovery: dismissBlockingModals failed — continuing without dismissal. ` +
        `(${(err as Error).message})`,
      );
    }

    // ── Step 8: Discover page types (non-fatal) ───────────────────────────────
    let pageTypes: Step1ParsedReport['pageTypes'] = [];
    try {
      pageTypes = await discoverPageTypes(client, url);
    } catch (err) {
      console.warn(
        `runPhase1Discovery: discoverPageTypes failed — continuing with empty pageTypes. ` +
        `(${(err as Error).message})`,
      );
    }

    // ── Step 9: Detect tech stack ─────────────────────────────────────────────
    const techStackMulti = detectTechStack(rawHtml, responseHeaders);

    // Flatten multi-value tech stack to string for Step1ParsedReport compatibility
    // e.g. { Framework: ['Next.js', 'React'] } → { Framework: 'Next.js, React' }
    const techStack: Record<string, string> = {};
    for (const [category, values] of Object.entries(techStackMulti)) {
      techStack[category] = values.join(', ');
    }

    // ── Step 10: Detect third-party domains (pure, non-fatal) ─────────────────
    let thirdPartyDomains: Step1ParsedReport['thirdPartyDomains'];
    try {
      thirdPartyDomains = detectThirdPartyDomains(rawHtml, new URL(url).origin);
    } catch (err) {
      console.warn(
        `runPhase1Discovery: detectThirdPartyDomains failed — continuing without third-party data. ` +
        `(${(err as Error).message})`,
      );
    }

    // ── Step 11: Detect languages (pure, non-fatal) ─────────────────────────
    let languages: Step1ParsedReport['languages'];
    try {
      languages = detectLanguages(rawHtml);
    } catch (err) {
      console.warn(
        `runPhase1Discovery: detectLanguages failed — continuing without language data. ` +
        `(${(err as Error).message})`,
      );
    }

    // ── Step 12: Detect query params (pure, non-fatal) ──────────────────────
    let queryParams: Step1ParsedReport['queryParams'];
    try {
      queryParams = detectQueryParams(rawHtml);
    } catch (err) {
      console.warn(
        `runPhase1Discovery: detectQueryParams failed — continuing without query param data. ` +
        `(${(err as Error).message})`,
      );
    }

    // ── Step 13: Detect service workers (CDP, non-fatal) ──────────────────
    let serviceWorkers: Step1ParsedReport['serviceWorkers'];
    try {
      serviceWorkers = await detectServiceWorkers(client);
    } catch (err) {
      console.warn(
        `runPhase1Discovery: detectServiceWorkers failed — continuing without SW data. ` +
        `(${(err as Error).message})`,
      );
    }

    // ── Step 14: Detect data layer (CDP, non-fatal) ─────────────────────
    let dataLayer: Step1ParsedReport['dataLayer'];
    try {
      dataLayer = await detectDataLayer(client);
    } catch (err) {
      console.warn(
        `runPhase1Discovery: detectDataLayer failed — continuing without data layer info. ` +
        `(${(err as Error).message})`,
      );
    }

    // ── Step 15: Discover filter selector (CDP, non-fatal, only if PLP found) ─
    let filterSelector: string | null | undefined;
    const plp = pageTypes.find(pt => /plp|category|listing/i.test(pt.name));
    if (plp) {
      try {
        const filterResult = await discoverFilterSelector(client, plp.urlPattern);
        filterSelector = filterResult.selector;
      } catch (err) {
        console.warn(
          `runPhase1Discovery: discoverFilterSelector failed — continuing without filter selector. ` +
          `(${(err as Error).message})`,
        );
      }
    }

    // Build partial report before closing the tab
    const report: Step1ParsedReport = {
      url,
      domain: extractDomain(url),
      summaryTable: {},
      pageTypes,
      techStack,
      rawContent: '',
      thirdPartyDomains,
      languages,
      queryParams,
      serviceWorkers,
      dataLayer,
      filterSelector: filterSelector ?? null,
    };

    return report;
  } finally {
    // Always destroy the tab — even if BotWallError, timeout, or empty HTML error is thrown
    await connection.close();
  }
}

/**
 * Full Phase 1 discovery including post-CDP steps (CrUX API).
 * Wraps runPhase1DiscoveryCDP and appends CrUX data after the tab is closed.
 */
export async function runPhase1Discovery(url: string): Promise<Step1ParsedReport> {
  const report = await runPhase1DiscoveryCDP(url);

  // ── Step 16: Fetch CrUX data (external API, non-fatal, after tab closed) ─
  try {
    const cruxData = await fetchCruxData(url);
    if (cruxData) {
      report.cruxData = {
        mobile: cruxData.mobile ?? {},
        desktop: cruxData.desktop ?? {},
      };
    }
  } catch (err) {
    console.warn(
      `runPhase1Discovery: fetchCruxData failed — continuing without CrUX data. ` +
      `(${(err as Error).message})`,
    );
  }

  return report;
}
