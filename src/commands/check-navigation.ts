import { createNewTarget, DEVICE_PROFILES, DeviceType } from '../cdp/connection';
import { createRunDir, saveJson, extractDomain } from '../utils/artifacts';
import { dismissBlockingModals } from './discover-phase1';

export interface NavigationCheckOptions {
  startUrl: string;
  targetUrl: string;
  device?: DeviceType;
  clickSelector?: string;
  forceNavigate?: boolean;
  saveToFile?: boolean;
}

export interface NavigationCheckResult {
  startUrl: string;
  targetUrl: string;
  navigationType: 'hard' | 'soft' | 'unknown';
  navigationMethod: 'click-explicit' | 'click-auto' | 'page-navigate';
  evidence: {
    documentRequestMade: boolean;
    documentRequestCount: number;
    apiRequestsOnly: boolean;
    urlChanged: boolean;
    historyApiUsed: boolean;
    pageReloaded: boolean;
    linkSelector?: string;
    linkMatchStrategy?: string;
    forceNavigateUsed: boolean;
    autoLinkSearchPerformed: boolean;
  };
  requests: Array<{
    url: string;
    type: string;
    method: string;
  }>;
  timing: {
    navigationDuration: number;
  };
  analysis: string;
  savedTo?: string;
}

interface LinkMatch {
  index: number;
  href: string;
  matchStrategy: 'exact' | 'path-only' | 'path-segment';
  text: string;
}

/**
 * Find a matching <a> link on the page for the target URL.
 * Tries three strategies: exact URL, path-only, last path segment.
 */
async function findMatchingLink(client: any, targetUrl: string): Promise<LinkMatch | null> {
  const result = await client.Runtime.evaluate({
    expression: `
      (() => {
        const target = new URL('${targetUrl.replace(/'/g, "\\'")}');
        const links = Array.from(document.querySelectorAll('a[href]'));

        // Strategy 1: Exact URL match
        for (let i = 0; i < links.length; i++) {
          try {
            const href = links[i].href;
            if (href === target.href) {
              return { index: i, href, matchStrategy: 'exact', text: links[i].textContent?.trim().substring(0, 80) || '' };
            }
          } catch {}
        }

        // Strategy 2: Path-only match (ignore query/hash)
        for (let i = 0; i < links.length; i++) {
          try {
            const linkUrl = new URL(links[i].href);
            if (linkUrl.origin === target.origin && linkUrl.pathname === target.pathname) {
              return { index: i, href: links[i].href, matchStrategy: 'path-only', text: links[i].textContent?.trim().substring(0, 80) || '' };
            }
          } catch {}
        }

        // Strategy 3: Last path segment match
        const targetSegments = target.pathname.split('/').filter(Boolean);
        const lastSegment = targetSegments[targetSegments.length - 1];
        if (lastSegment && lastSegment.length > 1) {
          for (let i = 0; i < links.length; i++) {
            try {
              const linkUrl = new URL(links[i].href);
              if (linkUrl.origin === target.origin && linkUrl.pathname.endsWith('/' + lastSegment)) {
                return { index: i, href: links[i].href, matchStrategy: 'path-segment', text: links[i].textContent?.trim().substring(0, 80) || '' };
              }
            } catch {}
          }
        }

        return null;
      })()
    `,
    returnByValue: true,
  });
  return result.result.value as LinkMatch | null;
}

/**
 * Wait for SPA framework hydration (max 5s).
 * Checks for Next.js, Nuxt, React markers, or sufficient link count.
 */
async function waitForHydration(client: any): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const check = await client.Runtime.evaluate({
      expression: `
        !!(
          window.__NEXT_DATA__ ||
          document.getElementById('__next') ||
          window.__NUXT__ ||
          document.querySelector('[data-reactroot]') ||
          document.querySelectorAll('a[href]').length > 5
        )
      `,
      returnByValue: true,
    });
    if (check.result.value === true) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

/**
 * Check if navigation between two URLs is hard (full page load) or soft (SPA)
 */
export async function checkNavigation(options: NavigationCheckOptions): Promise<NavigationCheckResult> {
  const {
    startUrl,
    targetUrl,
    device = 'desktop',
    clickSelector,
    forceNavigate = false,
    saveToFile = false,
  } = options;

  const deviceProfile = DEVICE_PROFILES[device];
  const connection = await createNewTarget();
  const { client } = connection;

  const requests: NavigationCheckResult['requests'] = [];
  let documentRequestMade = false;
  let documentRequestCount = 0;
  let historyApiUsed = false;
  let pageReloaded = false;
  let navigationMethod: NavigationCheckResult['navigationMethod'] = 'page-navigate';
  let linkSelector: string | undefined;
  let linkMatchStrategy: string | undefined;
  let autoLinkSearchPerformed = false;
  const startTime = Date.now();

  try {
    await Promise.all([
      client.Network.enable({}),
      client.Page.enable(),
      client.Runtime.enable(),
    ]);

    await client.Network.setBypassServiceWorker({ bypass: true });

    await client.Emulation.setUserAgentOverride({
      userAgent: deviceProfile.userAgent,
    });

    await client.Emulation.setDeviceMetricsOverride({
      width: deviceProfile.viewport.width,
      height: deviceProfile.viewport.height,
      deviceScaleFactor: deviceProfile.deviceScaleFactor,
      mobile: deviceProfile.mobile,
    });

    // First navigate to start URL
    console.log(`Navigating to start URL: ${startUrl}`);
    await client.Page.navigate({ url: startUrl });
    await client.Page.loadEventFired();
    await waitForHydration(client);

    // Dismiss any blocking modals (routing, consent) so links are clickable
    await dismissBlockingModals(client);

    // Clear any previous requests
    requests.length = 0;
    documentRequestMade = false;
    documentRequestCount = 0;

    // Set up listeners for the second navigation
    client.Network.requestWillBeSent((params) => {
      requests.push({
        url: params.request.url,
        type: params.type || 'unknown',
        method: params.request.method,
      });

      if (params.type === 'Document') {
        documentRequestMade = true;
        documentRequestCount++;
      }
    });

    // Inject history API monitoring
    await client.Runtime.evaluate({
      expression: `
        window.__historyPushState = false;
        window.__historyReplaceState = false;
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;
        history.pushState = function() {
          window.__historyPushState = true;
          return originalPushState.apply(this, arguments);
        };
        history.replaceState = function() {
          window.__historyReplaceState = true;
          return originalReplaceState.apply(this, arguments);
        };
      `,
    });

    // Listen for page reload
    client.Page.frameNavigated((params) => {
      if (params.type === 'Navigation') {
        pageReloaded = true;
      }
    });

    // Perform the navigation
    console.log(`Navigating to target URL: ${targetUrl}`);

    if (clickSelector) {
      // Branch 1: Explicit click selector provided
      navigationMethod = 'click-explicit';
      linkSelector = clickSelector;
      console.log(`  Using explicit click selector: ${clickSelector}`);
      await client.Runtime.evaluate({
        expression: `document.querySelector('${clickSelector.replace(/'/g, "\\'")}')?.click()`,
      });
    } else if (forceNavigate) {
      // Branch 2: Force Page.navigate() with warning
      navigationMethod = 'page-navigate';
      console.log('  ⚠ WARNING: Using Page.navigate() (--force-navigate). This bypasses client-side routers and will always appear as HARD navigation on SPAs.');
      await client.Page.navigate({ url: targetUrl });
    } else {
      // Branch 3: Auto-discover matching <a> link, click it, fallback to Page.navigate()
      autoLinkSearchPerformed = true;
      console.log('  Searching for matching <a> link on page...');
      const linkMatch = await findMatchingLink(client, targetUrl);

      if (linkMatch) {
        navigationMethod = 'click-auto';
        linkSelector = `a[href] (index ${linkMatch.index})`;
        linkMatchStrategy = linkMatch.matchStrategy;
        console.log(`  Found link (${linkMatch.matchStrategy}): "${linkMatch.text}" → ${linkMatch.href}`);
        await client.Runtime.evaluate({
          expression: `document.querySelectorAll('a[href]')[${linkMatch.index}]?.click()`,
        });
      } else {
        navigationMethod = 'page-navigate';
        console.log('  ⚠ WARNING: No matching <a> link found on page. Falling back to Page.navigate().');
        console.log('    This bypasses client-side routers — result may be inaccurate for SPAs.');
        console.log('    Consider using -c <selector> to click a specific element.');
        await client.Page.navigate({ url: targetUrl });
      }
    }

    // Wait for navigation to complete
    try {
      await Promise.race([
        client.Page.loadEventFired(),
        new Promise(resolve => setTimeout(resolve, 5000)),
      ]);
    } catch {
      // May timeout for soft navigations, that's expected
    }

    // Additional wait for SPA route changes
    await new Promise(resolve => setTimeout(resolve, 2000));

    const navigationDuration = Date.now() - startTime;

    // Check if history API was used
    const historyCheck = await client.Runtime.evaluate({
      expression: `({ pushState: window.__historyPushState, replaceState: window.__historyReplaceState })`,
      returnByValue: true,
    });
    const historyResult = historyCheck.result.value as { pushState: boolean; replaceState: boolean };
    historyApiUsed = historyResult?.pushState || historyResult?.replaceState || false;

    // Get current URL
    const currentUrlResult = await client.Runtime.evaluate({
      expression: 'window.location.href',
      returnByValue: true,
    });
    const currentUrl = currentUrlResult.result.value as string;
    const urlChanged = currentUrl !== startUrl;

    // Determine navigation type
    const apiRequestsOnly = requests.length > 0 &&
      !documentRequestMade &&
      requests.every(r => r.type === 'XHR' || r.type === 'Fetch' || r.type === 'Script' || r.type === 'Image');

    let navigationType: 'hard' | 'soft' | 'unknown' = 'unknown';
    let analysis = '';

    // Build method description for analysis
    const methodLabel = navigationMethod === 'click-explicit' ? `click (explicit: ${linkSelector})`
      : navigationMethod === 'click-auto' ? `click (auto-discovered, ${linkMatchStrategy})`
      : forceNavigate ? 'Page.navigate (forced)' : 'Page.navigate (fallback, no link found)';

    if (documentRequestMade && documentRequestCount >= 1) {
      navigationType = 'hard';
      analysis = `Hard navigation detected via ${methodLabel}. ${documentRequestCount} document request(s) made. Full page reload occurred.`;
    } else if (apiRequestsOnly && (historyApiUsed || urlChanged)) {
      navigationType = 'soft';
      analysis = `Soft navigation detected via ${methodLabel}. No document requests, only API calls. ${historyApiUsed ? 'History API was used.' : 'URL changed without page reload.'}`;
    } else if (!documentRequestMade && urlChanged) {
      navigationType = 'soft';
      analysis = `Soft navigation detected via ${methodLabel}. URL changed without document request.`;
    } else if (documentRequestMade) {
      navigationType = 'hard';
      analysis = `Hard navigation detected via ${methodLabel}.`;
    } else {
      analysis = `Could not definitively determine navigation type (via ${methodLabel}). May need manual verification.`;
    }

    if (navigationMethod === 'page-navigate' && !forceNavigate && autoLinkSearchPerformed) {
      analysis += ' WARNING: No matching link was found, so Page.navigate() was used as fallback. This always triggers a Document request and may produce a false-positive HARD result on SPAs.';
    }
    if (forceNavigate) {
      analysis += ' NOTE: --force-navigate was used, bypassing client-side routers. This always triggers a Document request.';
    }

    const evidence = {
      documentRequestMade,
      documentRequestCount,
      apiRequestsOnly,
      urlChanged,
      historyApiUsed,
      pageReloaded,
      linkSelector,
      linkMatchStrategy,
      forceNavigateUsed: forceNavigate,
      autoLinkSearchPerformed,
    };

    let savedTo: string | undefined;
    if (saveToFile) {
      const runDir = createRunDir(extractDomain(startUrl));
      savedTo = saveJson(runDir, 'navigation-check.json', {
        startUrl,
        targetUrl,
        navigationType,
        navigationMethod,
        evidence,
        requests: requests.slice(0, 50), // Limit for readability
        analysis,
      });
    }

    return {
      startUrl,
      targetUrl,
      navigationType,
      navigationMethod,
      evidence,
      requests,
      timing: {
        navigationDuration,
      },
      analysis,
      savedTo,
    };
  } finally {
    await connection.close();
  }
}

/**
 * CLI handler for check-nav command
 */
export async function handleCheckNavCommand(startUrl: string, targetUrl: string, options: {
  click?: string;
  forceNavigate?: boolean;
  save?: boolean;
}): Promise<void> {
  const result = await checkNavigation({
    startUrl,
    targetUrl,
    clickSelector: options.click,
    forceNavigate: options.forceNavigate,
    saveToFile: options.save,
  });

  console.log('\n=== Navigation Type Check ===');
  console.log(`Start URL: ${result.startUrl}`);
  console.log(`Target URL: ${result.targetUrl}`);
  console.log(`Method: ${result.navigationMethod}`);
  console.log(`\nNavigation Type: ${result.navigationType.toUpperCase()}`);
  console.log(`\nAnalysis: ${result.analysis}`);

  console.log('\n--- Evidence ---');
  console.log(`Document Request Made: ${result.evidence.documentRequestMade}`);
  console.log(`Document Request Count: ${result.evidence.documentRequestCount}`);
  console.log(`API Requests Only: ${result.evidence.apiRequestsOnly}`);
  console.log(`URL Changed: ${result.evidence.urlChanged}`);
  console.log(`History API Used: ${result.evidence.historyApiUsed}`);
  console.log(`Page Reloaded: ${result.evidence.pageReloaded}`);
  if (result.evidence.linkSelector) {
    console.log(`Link Selector: ${result.evidence.linkSelector}`);
  }
  if (result.evidence.linkMatchStrategy) {
    console.log(`Link Match Strategy: ${result.evidence.linkMatchStrategy}`);
  }

  console.log('\n--- Requests During Navigation ---');
  const docRequests = result.requests.filter(r => r.type === 'Document');
  const apiRequests = result.requests.filter(r => r.type === 'XHR' || r.type === 'Fetch');
  const otherRequests = result.requests.filter(r => r.type !== 'Document' && r.type !== 'XHR' && r.type !== 'Fetch');

  console.log(`Document Requests: ${docRequests.length}`);
  docRequests.forEach(r => console.log(`  - ${r.method} ${r.url.substring(0, 80)}...`));

  console.log(`\nAPI Requests (XHR/Fetch): ${apiRequests.length}`);
  apiRequests.slice(0, 10).forEach(r => console.log(`  - ${r.method} ${r.url.substring(0, 80)}...`));
  if (apiRequests.length > 10) console.log(`  ... and ${apiRequests.length - 10} more`);

  console.log(`\nOther Requests: ${otherRequests.length}`);

  console.log(`\nNavigation Duration: ${result.timing.navigationDuration}ms`);

  if (result.savedTo) {
    console.log(`\nSaved to: ${result.savedTo}`);
  }
}
