import { createNewTarget, DEVICE_PROFILES, DeviceType } from '../cdp/connection';
import { createRunDir, saveJson, extractDomain } from '../utils/artifacts';

export interface FilterCheckOptions {
  url: string;
  device?: DeviceType;
  filterSelector?: string; // Optional: specific filter selector to click
  waitTime?: number; // Time to wait after filter click (ms)
  saveToFile?: boolean;
}

export interface FilterElement {
  selector: string;
  type: 'checkbox' | 'radio' | 'select' | 'link' | 'button' | 'unknown';
  text: string;
  name?: string;
  value?: string;
}

export interface FilterCheckResult {
  url: string;
  urlBeforeFilter: string;
  urlAfterFilter: string;
  filterType: 'url-based' | 'session-based' | 'hybrid' | 'unknown';
  evidence: {
    urlChanged: boolean;
    queryParamsAdded: boolean;
    hashChanged: boolean;
    historyApiUsed: boolean;
    pushStateUsed: boolean;
    replaceStateUsed: boolean;
    documentRequestMade: boolean;
    ajaxRequestsMade: boolean;
    ajaxRequestCount: number;
  };
  urlAnalysis: {
    paramsBefore: Record<string, string>;
    paramsAfter: Record<string, string>;
    newParams: string[];
    changedParams: string[];
    removedParams: string[];
  };
  requests: Array<{
    url: string;
    type: string;
    method: string;
  }>;
  filterElementsFound: FilterElement[];
  filterClicked?: FilterElement;
  analysis: string;
  recommendation: string;
  savedTo?: string;
}

/**
 * Parse URL query parameters
 */
function parseQueryParams(url: string): Record<string, string> {
  try {
    const urlObj = new URL(url);
    const params: Record<string, string> = {};
    urlObj.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    return params;
  } catch {
    return {};
  }
}

/**
 * Compare two parameter objects
 */
function compareParams(before: Record<string, string>, after: Record<string, string>): {
  newParams: string[];
  changedParams: string[];
  removedParams: string[];
} {
  const newParams: string[] = [];
  const changedParams: string[] = [];
  const removedParams: string[] = [];

  // Find new and changed params
  for (const key of Object.keys(after)) {
    if (!(key in before)) {
      newParams.push(key);
    } else if (before[key] !== after[key]) {
      changedParams.push(key);
    }
  }

  // Find removed params
  for (const key of Object.keys(before)) {
    if (!(key in after)) {
      removedParams.push(key);
    }
  }

  return { newParams, changedParams, removedParams };
}

/**
 * Check how PLP filters work - URL-based or session-based
 */
export async function checkFilters(options: FilterCheckOptions): Promise<FilterCheckResult> {
  const {
    url,
    device = 'desktop',
    filterSelector,
    waitTime = 3000,
    saveToFile = false,
  } = options;

  const deviceProfile = DEVICE_PROFILES[device];
  const connection = await createNewTarget();
  const { client } = connection;

  const requests: FilterCheckResult['requests'] = [];
  let documentRequestMade = false;
  let historyPushStateUsed = false;
  let historyReplaceStateUsed = false;

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

    // Navigate to PLP URL
    console.log(`Navigating to PLP: ${url}`);
    await client.Page.navigate({ url });
    await client.Page.loadEventFired();
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get URL before filter
    const urlBeforeResult = await client.Runtime.evaluate({
      expression: 'window.location.href',
      returnByValue: true,
    });
    const urlBeforeFilter = urlBeforeResult.result.value as string;
    const paramsBefore = parseQueryParams(urlBeforeFilter);

    // Find filter elements on the page
    console.log('Searching for filter elements...');
    const filterElementsResult = await client.Runtime.evaluate({
      expression: `
        (function() {
          const filters = [];

          // Common filter selectors
          const selectors = [
            // Checkboxes in filter containers
            '[data-filter] input[type="checkbox"]',
            '.filter input[type="checkbox"]',
            '.facet input[type="checkbox"]',
            '[class*="filter"] input[type="checkbox"]',
            '[class*="facet"] input[type="checkbox"]',

            // Radio buttons
            '[data-filter] input[type="radio"]',
            '.filter input[type="radio"]',

            // Select dropdowns
            '[data-filter] select',
            '.filter select',
            '.facet select',

            // Filter links
            '.filter a[href*="filter"]',
            '.facet a',
            '[data-filter-value]',
            '[data-facet-value]',

            // Buttons
            '.filter button',
            '[data-filter] button',

            // Generic filter-looking elements
            '[class*="filter-option"]',
            '[class*="facet-option"]',
            '[class*="filter-item"]',
            '[class*="facet-item"]',
          ];

          for (const selector of selectors) {
            try {
              const elements = document.querySelectorAll(selector);
              elements.forEach((el, idx) => {
                const tagName = el.tagName.toLowerCase();
                let type = 'unknown';

                if (tagName === 'input') {
                  type = el.type || 'unknown';
                } else if (tagName === 'select') {
                  type = 'select';
                } else if (tagName === 'a') {
                  type = 'link';
                } else if (tagName === 'button') {
                  type = 'button';
                }

                // Get visible text
                let text = el.textContent?.trim() || '';
                if (tagName === 'input') {
                  // For inputs, try to find associated label
                  const label = el.labels?.[0] ||
                    el.closest('label') ||
                    el.parentElement?.querySelector('span, label');
                  text = label?.textContent?.trim() || el.value || '';
                }

                // Create unique selector
                let uniqueSelector = '';
                if (el.id) {
                  uniqueSelector = '#' + el.id;
                } else if (el.name && tagName === 'input') {
                  uniqueSelector = selector + '[name="' + el.name + '"]';
                } else {
                  uniqueSelector = selector + ':nth-of-type(' + (idx + 1) + ')';
                }

                if (text && !filters.some(f => f.selector === uniqueSelector)) {
                  filters.push({
                    selector: uniqueSelector,
                    type,
                    text: text.substring(0, 100),
                    name: el.name || undefined,
                    value: el.value || undefined,
                  });
                }
              });
            } catch (e) {}
          }

          return filters.slice(0, 20); // Limit to first 20
        })()
      `,
      returnByValue: true,
    });

    const filterElementsFound: FilterElement[] = filterElementsResult.result.value as FilterElement[] || [];
    console.log(`Found ${filterElementsFound.length} potential filter elements`);

    // Set up listeners before clicking filter
    requests.length = 0;
    documentRequestMade = false;

    client.Network.requestWillBeSent((params) => {
      requests.push({
        url: params.request.url,
        type: params.type || 'unknown',
        method: params.request.method,
      });

      if (params.type === 'Document') {
        documentRequestMade = true;
      }
    });

    // Inject history API monitoring
    await client.Runtime.evaluate({
      expression: `
        window.__filterCheck = {
          pushState: false,
          replaceState: false,
          pushStateCount: 0,
          replaceStateCount: 0,
          urlChanges: []
        };

        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = function(state, title, url) {
          window.__filterCheck.pushState = true;
          window.__filterCheck.pushStateCount++;
          if (url) window.__filterCheck.urlChanges.push({ type: 'pushState', url: url.toString() });
          return originalPushState.apply(this, arguments);
        };

        history.replaceState = function(state, title, url) {
          window.__filterCheck.replaceState = true;
          window.__filterCheck.replaceStateCount++;
          if (url) window.__filterCheck.urlChanges.push({ type: 'replaceState', url: url.toString() });
          return originalReplaceState.apply(this, arguments);
        };
      `,
    });

    // Click on a filter element
    let filterClicked: FilterElement | undefined;
    const selectorToClick = filterSelector || (filterElementsFound.length > 0 ? filterElementsFound[0].selector : null);

    if (selectorToClick) {
      console.log(`Clicking filter: ${selectorToClick}`);
      filterClicked = filterElementsFound.find(f => f.selector === selectorToClick) || {
        selector: selectorToClick,
        type: 'unknown',
        text: 'Custom selector',
      };

      try {
        await client.Runtime.evaluate({
          expression: `
            (function() {
              const el = document.querySelector('${selectorToClick.replace(/'/g, "\\'")}');
              if (el) {
                el.scrollIntoView({ behavior: 'instant', block: 'center' });
                el.click();
                return true;
              }
              return false;
            })()
          `,
        });
      } catch (e) {
        console.log(`Failed to click filter: ${e}`);
      }
    } else {
      console.log('No filter elements found to click');
    }

    // Wait for filter to be applied
    console.log(`Waiting ${waitTime}ms for filter to apply...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));

    // Check if history API was used
    const historyCheck = await client.Runtime.evaluate({
      expression: `window.__filterCheck`,
      returnByValue: true,
    });
    const historyResult = historyCheck.result.value as {
      pushState: boolean;
      replaceState: boolean;
      pushStateCount: number;
      replaceStateCount: number;
      urlChanges: Array<{ type: string; url: string }>;
    };

    historyPushStateUsed = historyResult?.pushState || false;
    historyReplaceStateUsed = historyResult?.replaceState || false;

    // Get URL after filter
    const urlAfterResult = await client.Runtime.evaluate({
      expression: 'window.location.href',
      returnByValue: true,
    });
    const urlAfterFilter = urlAfterResult.result.value as string;
    const paramsAfter = parseQueryParams(urlAfterFilter);

    // Analyze URL changes
    const urlChanged = urlBeforeFilter !== urlAfterFilter;
    const { newParams, changedParams, removedParams } = compareParams(paramsBefore, paramsAfter);
    const queryParamsAdded = newParams.length > 0 || changedParams.length > 0;

    // Check if hash changed
    const hashBefore = new URL(urlBeforeFilter).hash;
    const hashAfter = new URL(urlAfterFilter).hash;
    const hashChanged = hashBefore !== hashAfter;

    // Count AJAX requests
    const ajaxRequests = requests.filter(r => r.type === 'XHR' || r.type === 'Fetch');
    const ajaxRequestsMade = ajaxRequests.length > 0;
    const ajaxRequestCount = ajaxRequests.length;

    // Determine filter type
    let filterType: FilterCheckResult['filterType'] = 'unknown';
    let analysis = '';
    let recommendation = '';

    if (documentRequestMade) {
      // Full page reload on filter - traditional MPA
      filterType = urlChanged ? 'url-based' : 'session-based';
      if (urlChanged) {
        analysis = 'Full page reload with URL change. Traditional server-side filtering with URL parameters.';
        recommendation = 'Good for caching - filters are in URL. Speed Kit can cache filtered PLPs if URL patterns are predictable.';
      } else {
        analysis = 'Full page reload WITHOUT URL change. Filters likely stored in session/cookies.';
        recommendation = 'PROBLEMATIC for caching - filter state not in URL. Consider requesting URL-based filters from customer, or implement cache bypass for filtered views.';
      }
    } else if (ajaxRequestsMade) {
      // AJAX-based filtering (SPA-style)
      if (historyPushStateUsed || historyReplaceStateUsed) {
        filterType = 'url-based';
        analysis = `SPA-style filtering with History API. ${historyPushStateUsed ? 'pushState' : 'replaceState'} used. URL reflects filter state.`;
        recommendation = 'Good for caching - filters update URL via History API. Speed Kit can cache based on full URL including filter params.';
      } else if (urlChanged || hashChanged) {
        filterType = hashChanged ? 'hybrid' : 'url-based';
        analysis = `AJAX filtering with ${hashChanged ? 'hash' : 'URL'} change. Filter state reflected in ${hashChanged ? 'URL hash' : 'URL'}.`;
        recommendation = hashChanged
          ? 'Hash-based filtering - Speed Kit may need to consider hash as part of cache key.'
          : 'URL-based AJAX filtering - good for caching.';
      } else {
        filterType = 'session-based';
        analysis = 'AJAX filtering WITHOUT URL change. Filter state likely stored in session, cookies, or client-side state only.';
        recommendation = 'PROBLEMATIC for caching - filter state not in URL. Cached PLP may show wrong products. Consider cache bypass or requesting URL-based filters.';
      }
    } else if (filterClicked) {
      // No requests at all - purely client-side filtering
      if (urlChanged || hashChanged) {
        filterType = 'url-based';
        analysis = 'Client-side filtering with URL update. Products likely pre-loaded and filtered in JS.';
        recommendation = 'Good for caching - filter state in URL. All products may be in initial HTML/API response.';
      } else {
        filterType = 'session-based';
        analysis = 'Client-side filtering without URL change. Pure JS filtering of pre-loaded products.';
        recommendation = 'Neutral for caching - filtering happens client-side. Ensure initial product list is cached.';
      }
    } else {
      analysis = 'Could not determine filter behavior - no filter element was clicked.';
      recommendation = 'Manual testing required. Try clicking a filter element on the page.';
    }

    const result: FilterCheckResult = {
      url,
      urlBeforeFilter,
      urlAfterFilter,
      filterType,
      evidence: {
        urlChanged,
        queryParamsAdded,
        hashChanged,
        historyApiUsed: historyPushStateUsed || historyReplaceStateUsed,
        pushStateUsed: historyPushStateUsed,
        replaceStateUsed: historyReplaceStateUsed,
        documentRequestMade,
        ajaxRequestsMade,
        ajaxRequestCount,
      },
      urlAnalysis: {
        paramsBefore,
        paramsAfter,
        newParams,
        changedParams,
        removedParams,
      },
      requests,
      filterElementsFound,
      filterClicked,
      analysis,
      recommendation,
    };

    if (saveToFile) {
      const runDir = createRunDir(extractDomain(url));
      result.savedTo = saveJson(runDir, 'filter-check.json', result);
    }

    return result;

  } finally {
    await connection.close();
  }
}

/**
 * CLI handler for check-filters command
 */
export async function handleCheckFiltersCommand(url: string, options: {
  device?: DeviceType;
  selector?: string;
  wait?: number;
  save?: boolean;
}): Promise<void> {
  const result = await checkFilters({
    url,
    device: options.device,
    filterSelector: options.selector,
    waitTime: options.wait,
    saveToFile: options.save,
  });

  console.log('\n=== PLP Filter Check ===');
  console.log(`URL: ${result.url}`);
  console.log(`\nFilter Type: ${result.filterType.toUpperCase()}`);

  console.log('\n--- URL Analysis ---');
  console.log(`URL Before: ${result.urlBeforeFilter}`);
  console.log(`URL After:  ${result.urlAfterFilter}`);
  console.log(`URL Changed: ${result.evidence.urlChanged}`);

  if (result.evidence.queryParamsAdded) {
    console.log(`\nNew Params: ${result.urlAnalysis.newParams.join(', ') || 'none'}`);
    console.log(`Changed Params: ${result.urlAnalysis.changedParams.join(', ') || 'none'}`);
  }

  if (result.evidence.hashChanged) {
    console.log(`Hash Changed: YES`);
  }

  console.log('\n--- Evidence ---');
  console.log(`History API (pushState): ${result.evidence.pushStateUsed}`);
  console.log(`History API (replaceState): ${result.evidence.replaceStateUsed}`);
  console.log(`Document Request Made: ${result.evidence.documentRequestMade}`);
  console.log(`AJAX Requests Made: ${result.evidence.ajaxRequestsMade} (${result.evidence.ajaxRequestCount} requests)`);

  if (result.filterClicked) {
    console.log('\n--- Filter Clicked ---');
    console.log(`Selector: ${result.filterClicked.selector}`);
    console.log(`Type: ${result.filterClicked.type}`);
    console.log(`Text: ${result.filterClicked.text}`);
  }

  console.log('\n--- Filter Elements Found ---');
  if (result.filterElementsFound.length === 0) {
    console.log('No filter elements automatically detected. Try using --selector option.');
  } else {
    result.filterElementsFound.slice(0, 10).forEach((f, i) => {
      console.log(`  [${i + 1}] ${f.type}: "${f.text}" (${f.selector.substring(0, 60)}${f.selector.length > 60 ? '...' : ''})`);
    });
    if (result.filterElementsFound.length > 10) {
      console.log(`  ... and ${result.filterElementsFound.length - 10} more`);
    }
  }

  if (result.evidence.ajaxRequestsMade) {
    console.log('\n--- AJAX Requests ---');
    const ajaxRequests = result.requests.filter(r => r.type === 'XHR' || r.type === 'Fetch');
    ajaxRequests.slice(0, 5).forEach(r => {
      console.log(`  ${r.method} ${r.url.substring(0, 80)}${r.url.length > 80 ? '...' : ''}`);
    });
    if (ajaxRequests.length > 5) {
      console.log(`  ... and ${ajaxRequests.length - 5} more`);
    }
  }

  console.log('\n--- Analysis ---');
  console.log(result.analysis);

  console.log('\n--- Recommendation ---');
  console.log(result.recommendation);

  if (result.savedTo) {
    console.log(`\nSaved to: ${result.savedTo}`);
  }
}
