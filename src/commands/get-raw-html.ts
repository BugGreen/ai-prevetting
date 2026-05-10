import { createNewTarget, DEVICE_PROFILES, DeviceType } from '../cdp/connection';
import { createRunDir, saveHtml, extractDomain } from '../utils/artifacts';

export interface RawHtmlOptions {
  url: string;
  device?: DeviceType;
  bypassServiceWorker?: boolean;
  saveToFile?: boolean;
  timeout?: number;
}

export interface RawHtmlResult {
  url: string;
  device: DeviceType;
  html: string;
  responseHeaders: Record<string, string>;
  statusCode: number;
  savedTo?: string;
  timing: {
    ttfb: number;
    total: number;
  };
}

/**
 * Fetch raw HTML from a URL using CDP, bypassing ServiceWorker
 * This gets the actual HTML response from the server, not the rendered DOM
 */
export async function getRawHtml(options: RawHtmlOptions): Promise<RawHtmlResult> {
  const {
    url,
    device = 'desktop',
    bypassServiceWorker = true,
    saveToFile = false,
    timeout = 30000,
  } = options;

  const deviceProfile = DEVICE_PROFILES[device];
  const startTime = Date.now();
  let ttfbTime = 0;

  // Create a new tab for this request
  const connection = await createNewTarget();
  const { client } = connection;

  try {
    // Enable required domains
    await Promise.all([
      client.Network.enable({}),
      client.Page.enable(),
      client.Runtime.enable(),
    ]);

    // Bypass ServiceWorker if requested
    if (bypassServiceWorker) {
      await client.Network.setBypassServiceWorker({ bypass: true });
    }

    // Set device emulation
    await client.Emulation.setUserAgentOverride({
      userAgent: deviceProfile.userAgent,
    });

    await client.Emulation.setDeviceMetricsOverride({
      width: deviceProfile.viewport.width,
      height: deviceProfile.viewport.height,
      deviceScaleFactor: deviceProfile.deviceScaleFactor,
      mobile: deviceProfile.mobile,
    });

    // Track the main document response
    let responseHeaders: Record<string, string> = {};
    let statusCode = 0;
    let responseBody = '';
    let mainRequestId = '';

    // Listen for the main document response
    client.Network.responseReceived((params) => {
      if (params.type === 'Document') {
        mainRequestId = params.requestId;
        responseHeaders = params.response.headers as Record<string, string>;
        statusCode = params.response.status;
        ttfbTime = Date.now() - startTime;
      }
    });

    // Navigate to the URL
    const navResult = await client.Page.navigate({ url });

    if (navResult.errorText) {
      throw new Error(`Navigation failed: ${navResult.errorText}`);
    }

    // Wait for load
    await Promise.race([
      client.Page.loadEventFired(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Page load timeout')), timeout)
      ),
    ]);

    // Small delay to ensure response is captured
    await new Promise(resolve => setTimeout(resolve, 500));

    // Get the response body using Network.getResponseBody
    if (mainRequestId) {
      try {
        const bodyResponse = await client.Network.getResponseBody({
          requestId: mainRequestId,
        });
        responseBody = bodyResponse.base64Encoded
          ? Buffer.from(bodyResponse.body, 'base64').toString('utf-8')
          : bodyResponse.body;
      } catch (e) {
        // Fallback: get HTML from DOM (not ideal but better than nothing)
        console.warn('Could not get response body, falling back to DOM HTML');
        const result = await client.Runtime.evaluate({
          expression: 'document.documentElement.outerHTML',
          returnByValue: true,
        });
        responseBody = result.result.value as string;
      }
    }

    const totalTime = Date.now() - startTime;

    // Save to file if requested
    let savedTo: string | undefined;
    if (saveToFile) {
      const runDir = createRunDir(extractDomain(url));
      savedTo = saveHtml(runDir, `raw-html-${device}.html`, responseBody);
    }

    return {
      url,
      device,
      html: responseBody,
      responseHeaders,
      statusCode,
      savedTo,
      timing: {
        ttfb: ttfbTime,
        total: totalTime,
      },
    };
  } finally {
    await connection.close();
  }
}

/**
 * CLI handler for raw-html command
 */
export async function handleRawHtmlCommand(url: string, options: {
  device?: string;
  save?: boolean;
}): Promise<void> {
  const device = (options.device as DeviceType) || 'desktop';
  const result = await getRawHtml({
    url,
    device,
    saveToFile: options.save,
  });

  console.log('\n=== Raw HTML Result ===');
  console.log(`URL: ${result.url}`);
  console.log(`Device: ${result.device}`);
  console.log(`Status: ${result.statusCode}`);
  console.log(`TTFB: ${result.timing.ttfb}ms`);
  console.log(`Total: ${result.timing.total}ms`);
  console.log(`HTML Length: ${result.html.length} characters`);

  if (result.savedTo) {
    console.log(`Saved to: ${result.savedTo}`);
  }

  // Print key headers
  console.log('\n--- Response Headers ---');
  const importantHeaders = ['content-type', 'content-security-policy', 'cache-control', 'server', 'x-powered-by'];
  importantHeaders.forEach(h => {
    const value = result.responseHeaders[h] || result.responseHeaders[h.toLowerCase()];
    if (value) {
      console.log(`${h}: ${value}`);
    }
  });

  // Print HTML preview
  console.log('\n--- HTML Preview (first 500 chars) ---');
  console.log(result.html.substring(0, 500));
  console.log('...');
}
