import { createNewTarget, DEVICE_PROFILES, DeviceType } from '../cdp/connection';
import { createRunDir, saveJson, extractDomain } from '../utils/artifacts';

export interface HeadersOptions {
  url: string;
  device?: DeviceType;
  saveToFile?: boolean;
}

export interface HeadersResult {
  url: string;
  statusCode: number;
  headers: Record<string, string>;
  analysis: {
    csp: string | null;
    cspReportOnly: string | null;
    contentType: string | null;
    cacheControl: string | null;
    server: string | null;
    cdn: string | null;
    xPoweredBy: string | null;
    securityHeaders: Record<string, string>;
  };
  savedTo?: string;
}

/**
 * Get response headers for a URL
 */
export async function getHeaders(options: HeadersOptions): Promise<HeadersResult> {
  const { url, device = 'desktop', saveToFile = false } = options;

  const deviceProfile = DEVICE_PROFILES[device];
  const connection = await createNewTarget();
  const { client } = connection;

  try {
    await Promise.all([
      client.Network.enable({}),
      client.Page.enable(),
    ]);

    await client.Network.setBypassServiceWorker({ bypass: true });

    await client.Emulation.setUserAgentOverride({
      userAgent: deviceProfile.userAgent,
    });

    let responseHeaders: Record<string, string> = {};
    let statusCode = 0;

    client.Network.responseReceived((params) => {
      if (params.type === 'Document') {
        responseHeaders = params.response.headers as Record<string, string>;
        statusCode = params.response.status;
      }
    });

    await client.Page.navigate({ url });
    await client.Page.loadEventFired();

    // Normalize header names to lowercase
    const normalizedHeaders: Record<string, string> = {};
    Object.entries(responseHeaders).forEach(([key, value]) => {
      normalizedHeaders[key.toLowerCase()] = value;
    });

    const analysis = analyzeHeaders(normalizedHeaders);

    let savedTo: string | undefined;
    if (saveToFile) {
      const runDir = createRunDir(extractDomain(url));
      savedTo = saveJson(runDir, 'headers.json', {
        url,
        statusCode,
        headers: responseHeaders,
        analysis,
      });
    }

    return {
      url,
      statusCode,
      headers: responseHeaders,
      analysis,
      savedTo,
    };
  } finally {
    await connection.close();
  }
}

/**
 * Analyze headers for important values
 */
function analyzeHeaders(headers: Record<string, string>): HeadersResult['analysis'] {
  // Detect CDN from headers
  const cdnDetection = detectCDN(headers);

  // Extract security headers
  const securityHeaders: Record<string, string> = {};
  const securityHeaderNames = [
    'strict-transport-security',
    'x-frame-options',
    'x-content-type-options',
    'x-xss-protection',
    'referrer-policy',
    'permissions-policy',
  ];

  securityHeaderNames.forEach(name => {
    if (headers[name]) {
      securityHeaders[name] = headers[name];
    }
  });

  return {
    csp: headers['content-security-policy'] || null,
    cspReportOnly: headers['content-security-policy-report-only'] || null,
    contentType: headers['content-type'] || null,
    cacheControl: headers['cache-control'] || null,
    server: headers['server'] || null,
    cdn: cdnDetection,
    xPoweredBy: headers['x-powered-by'] || null,
    securityHeaders,
  };
}

/**
 * Detect CDN from response headers
 */
function detectCDN(headers: Record<string, string>): string | null {
  // Check common CDN headers
  if (headers['cf-ray']) return 'Cloudflare';
  if (headers['x-cdn'] === 'Imperva') return 'Imperva';
  if (headers['x-served-by']?.includes('cache-')) return 'Fastly';
  if (headers['x-amz-cf-id']) return 'CloudFront';
  if (headers['x-akamai-transformed']) return 'Akamai';
  if (headers['x-cache']?.includes('MISS') || headers['x-cache']?.includes('HIT')) {
    if (headers['via']?.includes('varnish')) return 'Varnish';
    if (headers['via']?.includes('cloudfront')) return 'CloudFront';
  }
  if (headers['server']?.toLowerCase().includes('cloudflare')) return 'Cloudflare';
  if (headers['server']?.toLowerCase().includes('akamai')) return 'Akamai';
  if (headers['x-cache-status']) return 'Generic CDN';

  return null;
}

/**
 * CLI handler for headers command
 */
export async function handleHeadersCommand(url: string, options: {
  device?: string;
  save?: boolean;
}): Promise<void> {
  const result = await getHeaders({
    url,
    device: (options.device as DeviceType) || 'desktop',
    saveToFile: options.save,
  });

  console.log('\n=== Response Headers Analysis ===');
  console.log(`URL: ${result.url}`);
  console.log(`Status: ${result.statusCode}`);

  console.log('\n--- Key Headers ---');
  console.log(`Content-Type: ${result.analysis.contentType || 'Not set'}`);
  console.log(`Cache-Control: ${result.analysis.cacheControl || 'Not set'}`);
  console.log(`Server: ${result.analysis.server || 'Not set'}`);
  console.log(`CDN Detected: ${result.analysis.cdn || 'None detected'}`);
  console.log(`X-Powered-By: ${result.analysis.xPoweredBy || 'Not set'}`);

  console.log('\n--- Content Security Policy ---');
  if (result.analysis.csp) {
    console.log('CSP: YES');
    console.log(result.analysis.csp.substring(0, 200));
    if (result.analysis.csp.length > 200) console.log('... (truncated)');
  } else {
    console.log('CSP: NOT SET');
  }

  if (result.analysis.cspReportOnly) {
    console.log('\nCSP Report-Only: YES');
  }

  console.log('\n--- Security Headers ---');
  const secHeaders = result.analysis.securityHeaders;
  if (Object.keys(secHeaders).length > 0) {
    Object.entries(secHeaders).forEach(([key, value]) => {
      console.log(`${key}: ${value}`);
    });
  } else {
    console.log('No security headers detected');
  }

  console.log('\n--- All Headers ---');
  Object.entries(result.headers).forEach(([key, value]) => {
    console.log(`${key}: ${value.substring(0, 100)}${value.length > 100 ? '...' : ''}`);
  });

  if (result.savedTo) {
    console.log(`\nSaved to: ${result.savedTo}`);
  }
}
