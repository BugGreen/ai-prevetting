/**
 * Full Pre-Vetting Check
 * Runs all checks in parallel and generates a consolidated Markdown report
 * Combines Step 1 findings with Step 2 CDP-verified results
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import * as os from 'os';
import { compareMobileDesktop, CompareHtmlResult } from './compare-mobile-desktop';
import { checkSSR, SSRCheckResult } from './check-ssr';
import { checkImages, CheckImagesResult } from './check-images';
import { getHeaders, HeadersResult } from './get-headers';
import { checkNavigation, NavigationCheckResult } from './check-navigation';
import { runWPT } from './run-wpt';
import { runPhase1Discovery, BotWallError } from './discover-phase1';
import {
  extractDomain,
  createRunDir,
  extractUrlFromReport,
  readReportContent,
  parseStep1Report,
  Step1ParsedReport,
} from '../utils/artifacts';
import { generateReport } from '../utils/report-generator';
import { DeviceType, listTargets } from '../cdp/connection';

export interface FullCheckOptions {
  url: string;
  mobile?: boolean;
  skipWpt?: boolean;
  save?: boolean;
  wptKey?: string;
  step1Report?: Step1ParsedReport;
  phase1Timing?: CheckTiming | null;
}

/**
 * Execution metrics for tracking CLI run performance
 */
export interface ExecutionMetrics {
  startTime: string;
  endTime: string;
  totalDurationMs: number;
  checks: {
    phase1Discovery: CheckTiming | null;
    htmlComparison: CheckTiming;
    ssrCheck: CheckTiming;
    imageCheck: CheckTiming;
    headerCheck: CheckTiming;
    navigationCheck: CheckTiming | null;
    wpt: CheckTiming | null;
  };
  errors: ExecutionError[];
  warnings: string[];
}

export interface CheckTiming {
  name: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
}

export interface ExecutionError {
  check: string;
  message: string;
  timestamp: string;
}

export interface FullCheckResult {
  url: string;
  timestamp: string;
  htmlComparison: CompareHtmlResult | null;
  ssrCheck: SSRCheckResult | null;
  imageCheck: CheckImagesResult | null;
  headerCheck: HeadersResult | null;
  navigationCheck: NavigationCheckResult | null;
  wptResult: Record<string, unknown> | null;
  step1Report: Step1ParsedReport | null;
  executionMetrics: ExecutionMetrics;
  savedTo?: string;
}

/**
 * Ensure Chrome is running with remote debugging on port 9222
 * Automatically starts Chrome if not running
 */
async function ensureChromeRunning(): Promise<void> {
  try {
    await listTargets();
    console.log('✓ Chrome is running on port 9222');
    return;
  } catch {
    // Chrome not running, need to start it
  }

  console.log('Starting Chrome with remote debugging...');

  const homeDir = os.homedir();
  const profileDir = `${homeDir}/.chrome-debug-profile`;

  let chromePath: string;
  if (os.platform() === 'darwin') {
    chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  } else if (os.platform() === 'win32') {
    chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  } else {
    chromePath = 'google-chrome';
  }

  const args = [
    '--remote-debugging-port=9222',
    `--user-data-dir="${profileDir}"`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ];

  return new Promise((resolve, reject) => {
    const child = exec(`"${chromePath}" ${args.join(' ')}`, (error) => {
      if (error && !error.killed) {
        // Don't reject on exit, Chrome runs in background
      }
    });

    child.unref();

    // Wait for Chrome to start and verify CDP is available
    const maxAttempts = 10;
    let attempts = 0;

    const checkChrome = async () => {
      attempts++;
      try {
        await listTargets();
        console.log('✓ Chrome started with remote debugging on port 9222');
        resolve();
      } catch {
        if (attempts >= maxAttempts) {
          reject(new Error('Failed to start Chrome with remote debugging. Please start Chrome manually.'));
        } else {
          setTimeout(checkChrome, 500);
        }
      }
    };

    setTimeout(checkChrome, 1000);
  });
}

/**
 * Get WPT API Key from CLI option or environment
 */
function getWptApiKey(cliKey?: string): string {
  return cliKey || process.env.WPT_API_KEY || '';
}

/**
 * Helper to track timing of a check
 */
async function trackCheck<T>(
  name: string,
  fn: () => Promise<T>,
  baseTime: number
): Promise<{ result: T | null; timing: CheckTiming }> {
  const startMs = Date.now() - baseTime;
  try {
    const result = await fn();
    const endMs = Date.now() - baseTime;
    return {
      result,
      timing: {
        name,
        startMs,
        endMs,
        durationMs: endMs - startMs,
        status: 'success',
      },
    };
  } catch (err) {
    const endMs = Date.now() - baseTime;
    return {
      result: null,
      timing: {
        name,
        startMs,
        endMs,
        durationMs: endMs - startMs,
        status: 'failed',
        error: (err as Error).message,
      },
    };
  }
}

/**
 * Find a navigation target URL from Step 1 report page types
 */
function findNavigationTargetUrl(step1Report: Step1ParsedReport | null, baseUrl: string): string | null {
  if (!step1Report || step1Report.pageTypes.length === 0) {
    return null;
  }

  // Look for PLP, Category, or Collection pages (most common for navigation testing)
  const navigationTargets = ['plp', 'category', 'collection', 'listing', 'search', 'products'];

  for (const target of navigationTargets) {
    const found = step1Report.pageTypes.find(p =>
      p.name.toLowerCase().includes(target)
    );
    if (found && found.urlPattern) {
      try {
        // Try to construct full URL
        const urlPattern = found.urlPattern;
        if (urlPattern.startsWith('http')) {
          return urlPattern;
        }
        // Relative URL
        const baseUrlObj = new URL(baseUrl);
        return new URL(urlPattern, baseUrlObj.origin).href;
      } catch {
        continue;
      }
    }
  }

  // If no PLP found, try any page that isn't the homepage
  const nonHomepage = step1Report.pageTypes.find(p =>
    !p.name.toLowerCase().includes('home') &&
    !p.name.toLowerCase().includes('homepage') &&
    p.urlPattern &&
    p.urlPattern !== '/'
  );

  if (nonHomepage && nonHomepage.urlPattern) {
    try {
      const urlPattern = nonHomepage.urlPattern;
      if (urlPattern.startsWith('http')) {
        return urlPattern;
      }
      const baseUrlObj = new URL(baseUrl);
      return new URL(urlPattern, baseUrlObj.origin).href;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Run all pre-vetting checks in parallel
 */
export async function runFullCheck(options: FullCheckOptions): Promise<FullCheckResult> {
  const { url, mobile = false, skipWpt = false, save = false, wptKey, step1Report = null } = options;
  const device: DeviceType = mobile ? 'mobile' : 'desktop';
  const startTime = new Date();
  const timestamp = startTime.toISOString();
  const baseTime = startTime.getTime();

  const errors: ExecutionError[] = [];
  const warnings: string[] = [];

  // Ensure Chrome is running
  await ensureChromeRunning();

  console.log('');
  console.log('=== Full Pre-Vetting Check ===');
  console.log(`URL: ${url}`);
  console.log(`Device: ${device}`);
  console.log(`Step 1 Report: ${step1Report ? 'Provided' : 'None'}`);
  console.log(`Skip WPT: ${skipWpt}`);
  console.log('');

  // Phase 1: Run parallel checks (all independent)
  console.log('Starting parallel checks...');

  // Determine navigation target URL for nav check
  const navTargetUrl = findNavigationTargetUrl(step1Report, url);
  if (navTargetUrl) {
    console.log(`  Navigation target: ${navTargetUrl}`);
  } else {
    console.log('  Navigation check: skipped (no target URL found)');
  }

  // Build parallel check promises
  const checkPromises: Promise<unknown>[] = [
    trackCheck('HTML Comparison', () => compareMobileDesktop({ url, saveArtifacts: false }), baseTime)
      .then(r => {
        if (r.timing.status === 'success') {
          console.log(`  ✓ HTML Comparison complete (${r.timing.durationMs}ms)`);
        } else {
          console.log(`  ✗ HTML Comparison failed: ${r.timing.error}`);
          errors.push({ check: 'htmlComparison', message: r.timing.error!, timestamp: new Date().toISOString() });
        }
        return r;
      }),
    trackCheck('SSR Check', () => checkSSR({ url, device, saveToFile: false }), baseTime)
      .then(r => {
        if (r.timing.status === 'success') {
          console.log(`  ✓ SSR Check complete (${r.timing.durationMs}ms)`);
        } else {
          console.log(`  ✗ SSR Check failed: ${r.timing.error}`);
          errors.push({ check: 'ssrCheck', message: r.timing.error!, timestamp: new Date().toISOString() });
        }
        return r;
      }),
    trackCheck('Image Check', () => checkImages({ url, device, saveToFile: false }), baseTime)
      .then(r => {
        if (r.timing.status === 'success') {
          console.log(`  ✓ Image Check complete (${r.timing.durationMs}ms)`);
        } else {
          console.log(`  ✗ Image Check failed: ${r.timing.error}`);
          errors.push({ check: 'imageCheck', message: r.timing.error!, timestamp: new Date().toISOString() });
        }
        return r;
      }),
    trackCheck('Headers Check', () => getHeaders({ url, device, saveToFile: false }), baseTime)
      .then(r => {
        if (r.timing.status === 'success') {
          console.log(`  ✓ Headers Check complete (${r.timing.durationMs}ms)`);
        } else {
          console.log(`  ✗ Headers Check failed: ${r.timing.error}`);
          errors.push({ check: 'headerCheck', message: r.timing.error!, timestamp: new Date().toISOString() });
        }
        return r;
      }),
  ];

  // Add navigation check if we have a target URL
  const navCheckPromise = navTargetUrl
    ? trackCheck('Navigation Check', () => checkNavigation({ startUrl: url, targetUrl: navTargetUrl }), baseTime)
        .then(r => {
          if (r.timing.status === 'success') {
            console.log(`  ✓ Navigation Check complete (${r.timing.durationMs}ms)`);
          } else {
            console.log(`  ✗ Navigation Check failed: ${r.timing.error}`);
            warnings.push(`Navigation Check failed: ${r.timing.error}`);
          }
          return r;
        })
    : Promise.resolve(null);

  checkPromises.push(navCheckPromise);

  const [htmlResult, ssrResult, imageResult, headerResult, navResult] = await Promise.all(checkPromises) as [
    { result: CompareHtmlResult | null; timing: CheckTiming },
    { result: SSRCheckResult | null; timing: CheckTiming },
    { result: CheckImagesResult | null; timing: CheckTiming },
    { result: HeadersResult | null; timing: CheckTiming },
    { result: NavigationCheckResult | null; timing: CheckTiming } | null
  ];

  // Warn about failures but continue so metrics are always saved
  const failedChecks = [
    !htmlResult.result && 'HTML Comparison',
    !ssrResult.result && 'SSR Check',
    !imageResult.result && 'Image Check',
    !headerResult.result && 'Headers Check',
  ].filter(Boolean);

  if (failedChecks.length > 0) {
    console.warn(`Warning: ${failedChecks.join(', ')} failed — continuing to save metrics.`);
    warnings.push(`Failed checks: ${failedChecks.join(', ')}`);
  }

  console.log('');

  // Phase 2: WPT (optional, separate due to API limits and longer runtime)
  let wptResult: Record<string, unknown> | null = null;
  let wptTiming: CheckTiming | null = null;

  if (!skipWpt) {
    const apiKey = getWptApiKey(wptKey);
    if (!apiKey) {
      console.log('⚠️  WPT skipped: No API key found. Set WPT_API_KEY in .env or use --wpt-key');
      warnings.push('WPT skipped: No API key configured');
      wptTiming = {
        name: 'WebPageTest',
        startMs: Date.now() - baseTime,
        endMs: Date.now() - baseTime,
        durationMs: 0,
        status: 'skipped',
      };
    } else {
      console.log('Starting WebPageTest...');
      // Temporarily set the API key if provided via CLI
      if (wptKey) {
        process.env.WPT_API_KEY = wptKey;
      }
      const wptTracked = await trackCheck('WebPageTest', () => runWPT(url, { mobile, save: false }), baseTime);
      wptTiming = wptTracked.timing;
      if (wptTracked.result) {
        wptResult = wptTracked.result;
        console.log(`  ✓ WPT complete (${wptTiming.durationMs}ms)`);
      } else {
        console.log(`  ✗ WPT failed: ${wptTiming.error}`);
        warnings.push(`WPT failed: ${wptTiming.error}`);
      }
    }
  } else {
    console.log('WPT skipped (--skip-wpt)');
    wptTiming = {
      name: 'WebPageTest',
      startMs: Date.now() - baseTime,
      endMs: Date.now() - baseTime,
      durationMs: 0,
      status: 'skipped',
    };
  }

  console.log('');

  const endTime = new Date();
  const executionMetrics: ExecutionMetrics = {
    startTime: timestamp,
    endTime: endTime.toISOString(),
    totalDurationMs: endTime.getTime() - baseTime,
    checks: {
      phase1Discovery: options.phase1Timing ?? null,
      htmlComparison: htmlResult.timing,
      ssrCheck: ssrResult.timing,
      imageCheck: imageResult.timing,
      headerCheck: headerResult.timing,
      navigationCheck: navResult?.timing || null,
      wpt: wptTiming,
    },
    errors,
    warnings,
  };

  let savedTo: string | undefined;
  if (save) {
    const runDir = createRunDir(extractDomain(url));

    // Save execution metrics as JSON
    const metricsPath = path.join(runDir, 'execution-metrics.json');
    fs.writeFileSync(metricsPath, JSON.stringify(executionMetrics, null, 2));

    // Generate and save Markdown report
    const fullResult: FullCheckResult = {
      url,
      timestamp,
      htmlComparison: htmlResult.result ?? null,
      ssrCheck: ssrResult.result ?? null,
      imageCheck: imageResult.result ?? null,
      headerCheck: headerResult.result ?? null,
      navigationCheck: navResult?.result || null,
      wptResult,
      step1Report,
      executionMetrics,
    };
    const reportMd = generateReport(fullResult);
    const reportPath = path.join(runDir, 'report.md');
    fs.writeFileSync(reportPath, reportMd);

    savedTo = runDir;
    console.log(`Report saved to: ${reportPath}`);
    console.log(`Execution metrics saved to: ${metricsPath}`);
  }

  return {
    url,
    timestamp,
    htmlComparison: htmlResult.result ?? null,
    ssrCheck: ssrResult.result ?? null,
    imageCheck: imageResult.result ?? null,
    headerCheck: headerResult.result ?? null,
    navigationCheck: navResult?.result || null,
    wptResult,
    step1Report,
    executionMetrics,
    savedTo,
  };
}

/**
 * Format milliseconds to human readable duration
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

/**
 * CLI handler for full-check command
 */
export async function handleFullCheckCommand(urlArg: string | undefined, options: {
  importPhase1?: string;
  mobile?: boolean;
  skipWpt?: boolean;
  wptKey?: string;
  save?: boolean;
}): Promise<void> {
  try {
    let url = urlArg;
    let step1Report: Step1ParsedReport | null = null;
    let phase1Timing: CheckTiming | null = null;
    const handlerStart = Date.now();

    if (options.importPhase1) {
      // ── Manual fallback path ──────────────────────────────────────────────
      console.log(`Importing Phase 1 report from: ${options.importPhase1}`);
      const reportContent = readReportContent(options.importPhase1);
      step1Report = parseStep1Report(reportContent);

      if (!url && step1Report.url) {
        url = step1Report.url;
        console.log(`Extracted URL: ${url}`);
      }

      console.log(`Page types found: ${step1Report.pageTypes.length}`);
      console.log('');
    } else {
      // ── Autonomous path ───────────────────────────────────────────────────
      if (!url) {
        throw new Error('URL required. Provide as argument or use --import-phase1 <file>.');
      }
      console.log('Running autonomous Phase 1 discovery...');
      const startMs = Date.now() - handlerStart;
      try {
        step1Report = await runPhase1Discovery(url);
        const endMs = Date.now() - handlerStart;
        phase1Timing = {
          name: 'Phase 1 Discovery',
          startMs,
          endMs,
          durationMs: endMs - startMs,
          status: 'success',
        };
        console.log(`Page types found: ${step1Report.pageTypes.length}`);
        console.log('');
      } catch (err) {
        const endMs = Date.now() - handlerStart;
        if (err instanceof BotWallError) {
          console.error(`Bot wall detected on ${url}.`);
          console.error(`  Type: ${err.wallType}, Confidence: ${err.wallConfidence}`);
          console.error('Manual bypass required. Use --import-phase1 with a Phase 1 report.');
          throw err;
        }
        // Non-BotWallError: record failed timing, warn, continue
        phase1Timing = {
          name: 'Phase 1 Discovery',
          startMs,
          endMs,
          durationMs: endMs - startMs,
          status: 'failed',
          error: (err as Error).message,
        };
        console.warn(`Phase 1 discovery failed: ${(err as Error).message}`);
        console.warn('Continuing without Phase 1 data — navigation check will be skipped.');
        console.log('');
      }
    }

    if (!url) {
      throw new Error('URL required. Provide as argument or use --import-phase1 <file>.');
    }

    const result = await runFullCheck({
      url,
      mobile: options.mobile,
      skipWpt: options.skipWpt,
      wptKey: options.wptKey,
      save: options.save,
      step1Report: step1Report || undefined,
      phase1Timing,
    });

    console.log('');
    console.log('=== Report Preview ===');
    console.log('');

    // Print a condensed version to console
    console.log(`URL: ${result.url}`);
    console.log('');
    console.log('Summary:');
    if (result.ssrCheck) {
      console.log(`  SSR: ${result.ssrCheck.analysis.isSSR ? 'Yes' : 'No'} (${result.ssrCheck.analysis.confidence})`);
    }
    if (result.htmlComparison) {
      console.log(`  HTML Diff: ${result.htmlComparison.comparison.hasDifferences ? 'Yes' : 'No'}`);
    }
    if (result.navigationCheck) {
      console.log(`  Navigation: ${result.navigationCheck.navigationType.toUpperCase()} (via ${result.navigationCheck.navigationMethod})`);
    }
    if (result.imageCheck) {
      console.log(`  Image Optimization: ${result.imageCheck.summary.optimizedPercentage}%`);
      console.log(`  ATF Lazy Issues: ${result.imageCheck.lazyLoadAnalysis.aboveTheFoldLazyLoaded.length}`);
    }
    if (result.headerCheck) {
      console.log(`  CDN: ${result.headerCheck.analysis.cdn || 'None'}`);
      console.log(`  CSP: ${result.headerCheck.analysis.csp ? 'Yes' : 'No'}`);
    }

    if (result.wptResult) {
      const insights = result.wptResult.insights as Record<string, unknown>;
      const metrics = insights?.metrics as Record<string, number> | undefined;
      if (metrics) {
        console.log(`  LCP: ${metrics.LCP}ms`);
        console.log(`  CLS: ${metrics.CLS}`);
      }
    }

    // Print execution metrics
    console.log('');
    console.log('=== Execution Metrics ===');
    console.log(`Total Duration: ${formatDuration(result.executionMetrics.totalDurationMs)}`);
    console.log('Check Timings:');
    const checks = result.executionMetrics.checks;
    if (checks.phase1Discovery) {
      console.log(`  Phase 1 Discovery: ${formatDuration(checks.phase1Discovery.durationMs)}`);
    }
    console.log(`  HTML Comparison: ${formatDuration(checks.htmlComparison.durationMs)}`);
    console.log(`  SSR Check: ${formatDuration(checks.ssrCheck.durationMs)}`);
    console.log(`  Image Check: ${formatDuration(checks.imageCheck.durationMs)}`);
    console.log(`  Headers Check: ${formatDuration(checks.headerCheck.durationMs)}`);
    if (checks.navigationCheck) {
      console.log(`  Navigation Check: ${formatDuration(checks.navigationCheck.durationMs)}`);
    }
    if (checks.wpt) {
      console.log(`  WPT: ${checks.wpt.status === 'skipped' ? 'skipped' : formatDuration(checks.wpt.durationMs)}`);
    }

    if (result.executionMetrics.warnings.length > 0) {
      console.log('');
      console.log('Warnings:');
      result.executionMetrics.warnings.forEach(w => console.log(`  - ${w}`));
    }

    if (result.savedTo) {
      console.log('');
      console.log('Saved files:');
      console.log(`  Report:       ${result.savedTo}/report.md`);
      console.log(`  Metrics JSON: ${result.savedTo}/execution-metrics.json`);
    }
  } catch (error) {
    if (error instanceof BotWallError) {
      throw error;
    }
    console.error('Error:', (error as Error).message);
    process.exit(1);
  }
}
