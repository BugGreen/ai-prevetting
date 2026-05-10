/**
 * WebPageTest Integration
 * Runs WPT tests and extracts waterfall/performance data
 */

import * as fs from 'fs';
import * as path from 'path';

const WPT_API_BASE = 'https://www.webpagetest.org';
const POLL_INTERVAL = 10000; // 10 seconds
const MAX_WAIT_TIME = 300000; // 5 minutes

interface WPTOptions {
  mobile?: boolean;
  runs?: number;
  save?: boolean;
  location?: string;
}

interface WPTResult {
  testId: string;
  testUrl: string;
  statusCode: number;
  statusText: string;
  data?: {
    summary: string;
    testUrl: string;
    from: string;
    runs: Record<string, WPTRunData>;
    median?: WPTRunData;
  };
}

interface WPTRunData {
  firstView: WPTViewData;
  repeatView?: WPTViewData;
}

interface WPTViewData {
  TTFB: number;
  loadTime: number;
  fullyLoaded: number;
  firstContentfulPaint: number;
  largestContentfulPaint: number;
  cumulativeLayoutShift: number;
  totalBlockingTime: number;
  SpeedIndex: number;
  requests: WPTRequest[];
  domains: Record<string, { requests: number; bytes: number }>;
}

interface WPTRequest {
  url: string;
  host: string;
  type: string;
  bytesIn: number;
  ttfb_ms: number;
  load_ms: number;
  responseCode: number;
}

function getApiKey(): string {
  const key = process.env.WPT_API_KEY;
  if (!key) {
    throw new Error(
      'WPT_API_KEY environment variable not set.\n' +
      'Set it with: export WPT_API_KEY="your-key-here"\n' +
      'Or add to ~/.zshrc / ~/.bashrc for persistence.'
    );
  }
  return key;
}

interface WPTStartResponse {
  statusCode: number;
  statusText: string;
  data?: {
    testId: string;
    jsonUrl: string;
  };
}

async function startTest(url: string, options: WPTOptions): Promise<{ testId: string; jsonUrl: string }> {
  const apiKey = getApiKey();

  const params = new URLSearchParams({
    url,
    k: apiKey,
    f: 'json',
    runs: String(options.runs || 1),
    location: options.location || 'ec2-eu-central-1:Chrome',
    mobile: options.mobile ? '1' : '0',
    video: '1',
    lighthouse: '1',
  });

  const response = await fetch(`${WPT_API_BASE}/runtest.php?${params}`);
  const text = await response.text();

  // Check if response is HTML (Cloudflare block)
  if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
    throw new Error(
      'WPT API blocked by Cloudflare.\n' +
      'This often happens when requests come from cloud IPs.\n\n' +
      'Workaround: Run the test manually in your browser:\n' +
      `  1. Open: ${WPT_API_BASE}/?url=${encodeURIComponent(url)}\n` +
      '  2. Start the test and copy the test ID\n' +
      '  3. Run: npx ts-node src/cli.ts wpt-results <testId>'
    );
  }

  let data: WPTStartResponse;
  try {
    data = JSON.parse(text) as WPTStartResponse;
  } catch {
    throw new Error(`Invalid JSON response from WPT: ${text.substring(0, 200)}`);
  }

  if (data.statusCode !== 200 || !data.data) {
    throw new Error(`WPT Error: ${data.statusText}`);
  }

  return {
    testId: data.data.testId,
    jsonUrl: data.data.jsonUrl,
  };
}

async function pollResults(jsonUrl: string): Promise<WPTResult> {
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_WAIT_TIME) {
    const response = await fetch(jsonUrl);
    const data = await response.json() as WPTResult;

    if (data.statusCode === 200) {
      return data;
    }

    if (data.statusCode >= 400) {
      throw new Error(`WPT Error: ${data.statusText}`);
    }

    // Status 100-199 means test is still running
    process.stdout.write('.');
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
  }

  throw new Error('WPT test timed out after 5 minutes');
}

function extractWaterfallInsights(data: WPTResult): Record<string, unknown> {
  const run = data.data?.median?.firstView || data.data?.runs?.['1']?.firstView;

  if (!run) {
    return { error: 'No run data available' };
  }

  const requests = run.requests || [];

  // Group by type
  const byType: Record<string, { count: number; bytes: number; avgTtfb: number }> = {};
  for (const req of requests) {
    const type = req.type || 'other';
    if (!byType[type]) {
      byType[type] = { count: 0, bytes: 0, avgTtfb: 0 };
    }
    byType[type].count++;
    byType[type].bytes += req.bytesIn || 0;
    byType[type].avgTtfb += req.ttfb_ms || 0;
  }

  // Calculate averages
  for (const type of Object.keys(byType)) {
    byType[type].avgTtfb = Math.round(byType[type].avgTtfb / byType[type].count);
  }

  // Find slow requests (TTFB > 500ms)
  const slowRequests = requests
    .filter(r => r.ttfb_ms > 500)
    .map(r => ({ url: r.url.substring(0, 80), ttfb: r.ttfb_ms, type: r.type }))
    .slice(0, 10);

  // Find large requests (> 100KB)
  const largeRequests = requests
    .filter(r => r.bytesIn > 100000)
    .map(r => ({ url: r.url.substring(0, 80), size: Math.round(r.bytesIn / 1024) + 'KB', type: r.type }))
    .slice(0, 10);

  // Third-party domains
  const thirdPartyDomains = Object.entries(run.domains || {})
    .filter(([domain]) => !domain.includes('karkkainen'))
    .map(([domain, stats]) => ({ domain, requests: stats.requests, bytes: Math.round(stats.bytes / 1024) + 'KB' }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 15);

  return {
    metrics: {
      TTFB: run.TTFB,
      FCP: run.firstContentfulPaint,
      LCP: run.largestContentfulPaint,
      CLS: run.cumulativeLayoutShift,
      TBT: run.totalBlockingTime,
      SpeedIndex: run.SpeedIndex,
      loadTime: run.loadTime,
      fullyLoaded: run.fullyLoaded,
    },
    requestSummary: {
      total: requests.length,
      byType,
    },
    slowRequests,
    largeRequests,
    thirdPartyDomains,
  };
}

export async function getWPTResults(testId: string): Promise<Record<string, unknown>> {
  const jsonUrl = `${WPT_API_BASE}/jsonResult.php?test=${testId}`;

  console.log(`Fetching results for test: ${testId}`);

  const response = await fetch(jsonUrl);
  const text = await response.text();

  if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
    throw new Error('WPT API blocked by Cloudflare. Try again later or use a different network.');
  }

  const results = JSON.parse(text) as WPTResult;

  if (results.statusCode !== 200) {
    if (results.statusCode >= 100 && results.statusCode < 200) {
      throw new Error(`Test still running. Status: ${results.statusText}`);
    }
    throw new Error(`WPT Error: ${results.statusText}`);
  }

  const insights = extractWaterfallInsights(results);

  return {
    testId,
    url: results.data?.testUrl,
    resultsUrl: `${WPT_API_BASE}/result/${testId}/`,
    waterfallUrl: `${WPT_API_BASE}/result/${testId}/1/details/`,
    filmstripUrl: `${WPT_API_BASE}/video/compare.php?tests=${testId}`,
    summary: results.data?.summary,
    insights,
  };
}

export async function runWPT(url: string, options: WPTOptions = {}): Promise<Record<string, unknown>> {
  console.log(`Starting WebPageTest for: ${url}`);
  console.log(`  Location: ${options.location || 'ec2-eu-central-1:Chrome'}`);
  console.log(`  Mobile: ${options.mobile ? 'Yes' : 'No'}`);
  console.log(`  Runs: ${options.runs || 1}`);
  console.log('');

  const { testId, jsonUrl } = await startTest(url, options);
  console.log(`Test started: ${testId}`);
  console.log(`Results URL: ${WPT_API_BASE}/result/${testId}/`);
  console.log('Waiting for results', '');

  const results = await pollResults(jsonUrl);
  console.log(' Done!\n');

  const insights = extractWaterfallInsights(results);

  return {
    testId,
    url,
    resultsUrl: `${WPT_API_BASE}/result/${testId}/`,
    waterfallUrl: `${WPT_API_BASE}/result/${testId}/1/details/`,
    filmstripUrl: `${WPT_API_BASE}/video/compare.php?tests=${testId}`,
    summary: results.data?.summary,
    insights,
  };
}

export async function handleWPTResultsCommand(testId: string, options: { save?: boolean }): Promise<void> {
  try {
    const result = await getWPTResults(testId);
    printWPTResults(result, options.save, testId);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

function printWPTResults(result: Record<string, unknown>, save?: boolean, testIdOverride?: string): void {
  console.log('=== WebPageTest Results ===');
  console.log(`URL: ${result.url}`);
  console.log(`Test ID: ${result.testId}`);
  console.log('');

  const insights = result.insights as Record<string, unknown>;
  const metrics = insights.metrics as Record<string, number>;

  console.log('--- Core Web Vitals ---');
  console.log(`TTFB: ${metrics.TTFB}ms`);
  console.log(`FCP: ${metrics.FCP}ms`);
  console.log(`LCP: ${metrics.LCP}ms`);
  console.log(`CLS: ${metrics.CLS}`);
  console.log(`TBT: ${metrics.TBT}ms`);
  console.log(`Speed Index: ${metrics.SpeedIndex}`);
  console.log('');

  const requestSummary = insights.requestSummary as Record<string, unknown>;
  console.log('--- Request Summary ---');
  console.log(`Total Requests: ${requestSummary.total}`);
  const byType = requestSummary.byType as Record<string, { count: number; bytes: number; avgTtfb: number }>;
  for (const [type, stats] of Object.entries(byType)) {
    console.log(`  ${type}: ${stats.count} requests, ${Math.round(stats.bytes / 1024)}KB, avg TTFB: ${stats.avgTtfb}ms`);
  }
  console.log('');

  const slowRequests = insights.slowRequests as Array<{ url: string; ttfb: number; type: string }>;
  if (slowRequests.length > 0) {
    console.log('--- Slow Requests (TTFB > 500ms) ---');
    for (const req of slowRequests) {
      console.log(`  [${req.type}] ${req.ttfb}ms - ${req.url}`);
    }
    console.log('');
  }

  const largeRequests = insights.largeRequests as Array<{ url: string; size: string; type: string }>;
  if (largeRequests.length > 0) {
    console.log('--- Large Requests (> 100KB) ---');
    for (const req of largeRequests) {
      console.log(`  [${req.type}] ${req.size} - ${req.url}`);
    }
    console.log('');
  }

  const thirdPartyDomains = insights.thirdPartyDomains as Array<{ domain: string; requests: number; bytes: string }>;
  if (thirdPartyDomains.length > 0) {
    console.log('--- Third-Party Domains ---');
    for (const domain of thirdPartyDomains) {
      console.log(`  ${domain.domain}: ${domain.requests} requests, ${domain.bytes}`);
    }
    console.log('');
  }

  console.log('--- Links ---');
  console.log(`Results: ${result.resultsUrl}`);
  console.log(`Waterfall: ${result.waterfallUrl}`);
  console.log(`Filmstrip: ${result.filmstripUrl}`);

  if (save) {
    const url = result.url as string;
    const hostname = url ? new URL(url).hostname.replace(/\./g, '_') : 'unknown';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputDir = path.join(process.cwd(), 'output', `${hostname}_${timestamp}`);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, 'wpt-results.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`\nSaved to: ${outputPath}`);
  }
}

export async function handleRunWPTCommand(url: string, options: WPTOptions): Promise<void> {
  try {
    const result = await runWPT(url, options);
    printWPTResults(result, options.save);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
