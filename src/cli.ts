#!/usr/bin/env ts-node

import * as dotenv from 'dotenv';
dotenv.config();

import { Command } from 'commander';
import {
  handleRawHtmlCommand,
  handleCompareHtmlCommand,
  handleHeadersCommand,
  handleCheckNavCommand,
  handleCheckImagesCommand,
  handleCheckSSRCommand,
  handleCheckFiltersCommand,
  handleRunWPTCommand,
  handleWPTResultsCommand,
  handleFullCheckCommand,
  handleExecutionReportCommand,
} from './commands';
import { listTargets } from './cdp/connection';

const program = new Command();

program
  .name('prevetting-checker')
  .description('Speed Kit Pre-Vetting Step 2 Analysis Tool - CDP-based checks')
  .version('1.0.0');

// Start Chrome with remote debugging
program
  .command('start-chrome')
  .description('Start Chrome with remote debugging enabled (port 9222)')
  .option('-u, --url <url>', 'URL to open on startup')
  .action(async (options) => {
    const { exec, execSync } = await import('child_process');
    const os = await import('os');

    // First check if CDP is already available on port 9222
    try {
      const targets = await listTargets();
      console.log('✓ Chrome is already running with Remote Debugging on port 9222');
      console.log(`  Targets: ${targets.length} tab(s) open`);
      return;
    } catch {
      // CDP not available, continue to start Chrome
    }

    // Check if port 9222 is already in use (not if Chrome is running)
    // This allows running a normal Chrome alongside the debug instance
    try {
      if (os.platform() === 'darwin') {
        execSync('lsof -i :9222 | grep LISTEN', { stdio: 'ignore' });
      } else if (os.platform() === 'win32') {
        execSync('netstat -an | findstr ":9222.*LISTENING"', { stdio: 'ignore' });
      } else {
        execSync('lsof -i :9222 | grep LISTEN', { stdio: 'ignore' });
      }
      console.error('⚠️  Port 9222 is in use but not responding to CDP.');
      console.error('   Close the process using port 9222, then try again.');
      process.exit(1);
    } catch {
      // Port 9222 is free, continue
    }

    const homeDir = os.homedir();
    const profileDir = `${homeDir}/.chrome-debug-profile`;
    const url = options.url || 'about:blank';

    let chromePath: string;
    if (os.platform() === 'darwin') {
      chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    } else if (os.platform() === 'win32') {
      chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    } else {
      chromePath = 'google-chrome';
    }

    const args = [
      `--remote-debugging-port=9222`,
      `--user-data-dir="${profileDir}"`,
      '--no-first-run',
      '--no-default-browser-check',
      url,
    ];

    console.log('Starting Chrome with remote debugging on port 9222...');
    console.log('  (Your normal Chrome can continue running separately)');

    const child = exec(`"${chromePath}" ${args.join(' ')}`, (error) => {
      if (error && !error.killed) {
        console.error('Failed to start Chrome:', error.message);
      }
    });

    child.unref();

    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      const targets = await listTargets();
      console.log('✓ Chrome started with Remote Debugging on port 9222');
      console.log(`  Profile: ${profileDir}`);
      console.log(`  Targets: ${targets.length} tab(s) open`);
      console.log('');
      console.log('💡 Tip: You can now open your normal Chrome separately!');
    } catch {
      console.error('⚠️  Chrome started but CDP is not responding.');
      console.error('   Try closing all Chrome windows and run again.');
    }
  });

// List CDP targets
program
  .command('targets')
  .description('List available CDP targets (browser tabs)')
  .action(async () => {
    try {
      const targets = await listTargets();
      console.log('\n=== Available CDP Targets ===\n');
      targets.forEach((t, i) => {
        console.log(`[${i}] ${t.type}: ${t.title || '(no title)'}`);
        console.log(`    URL: ${t.url}`);
        console.log(`    ID: ${t.id}`);
        console.log('');
      });
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  });

// Get raw HTML
program
  .command('raw-html <url>')
  .description('Fetch raw HTML from URL (bypassing ServiceWorker)')
  .option('-d, --device <type>', 'Device type: desktop, mobile, mobileIPhone', 'desktop')
  .option('-s, --save', 'Save HTML to output folder')
  .action(async (url: string, options) => {
    try {
      await handleRawHtmlCommand(url, options);
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  });

// Compare Mobile vs Desktop HTML
program
  .command('compare-html <url>')
  .description('Compare raw HTML between mobile and desktop devices')
  .option('--no-save', 'Do not save artifacts')
  .action(async (url: string, options) => {
    try {
      await handleCompareHtmlCommand(url, options);
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  });

// Get response headers
program
  .command('headers <url>')
  .description('Get response headers (CSP, cache-control, etc.)')
  .option('-d, --device <type>', 'Device type: desktop, mobile', 'desktop')
  .option('-s, --save', 'Save headers to output folder')
  .action(async (url: string, options) => {
    try {
      await handleHeadersCommand(url, options);
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  });

// Check navigation type
program
  .command('check-nav <start-url> <target-url>')
  .description('Check if navigation is hard (full page) or soft (SPA)')
  .option('-c, --click <selector>', 'Click on element to trigger navigation instead of direct URL')
  .option('-f, --force-navigate', 'Force Page.navigate() instead of auto-link-discovery (always shows HARD on SPAs)')
  .option('-s, --save', 'Save analysis to output folder')
  .action(async (startUrl: string, targetUrl: string, options) => {
    try {
      await handleCheckNavCommand(startUrl, targetUrl, options);
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  });

// Check image optimization
program
  .command('check-images <url>')
  .description('Check image optimization (WebP, AVIF, CDN)')
  .option('-d, --device <type>', 'Device type: desktop, mobile', 'desktop')
  .option('-s, --save', 'Save analysis to output folder')
  .action(async (url: string, options) => {
    try {
      await handleCheckImagesCommand(url, options);
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  });

// Check SSR
program
  .command('check-ssr <url>')
  .description('Check if page uses SSR (compare raw HTML vs rendered DOM)')
  .option('-d, --device <type>', 'Device type: desktop, mobile', 'desktop')
  .option('-s, --save', 'Save analysis to output folder')
  .action(async (url: string, options) => {
    try {
      await handleCheckSSRCommand(url, options);
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  });

// Check PLP Filters
program
  .command('check-filters <url>')
  .description('Check if PLP filters are URL-based or session-based')
  .option('-d, --device <type>', 'Device type: desktop, mobile', 'desktop')
  .option('-c, --selector <selector>', 'CSS selector for filter element to click')
  .option('-w, --wait <ms>', 'Wait time after filter click (ms)', '3000')
  .option('-s, --save', 'Save analysis to output folder')
  .action(async (url: string, options) => {
    try {
      await handleCheckFiltersCommand(url, {
        device: options.device,
        selector: options.selector,
        wait: parseInt(options.wait, 10),
        save: options.save,
      });
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  });

// Run WebPageTest
program
  .command('run-wpt <url>')
  .description('Run WebPageTest and extract waterfall insights')
  .option('-m, --mobile', 'Run mobile test instead of desktop')
  .option('-r, --runs <number>', 'Number of test runs', '1')
  .option('-l, --location <location>', 'WPT location', 'ec2-eu-central-1:Chrome')
  .option('-s, --save', 'Save results to output folder')
  .action(async (url: string, options) => {
    try {
      await handleRunWPTCommand(url, {
        mobile: options.mobile,
        runs: parseInt(options.runs, 10),
        location: options.location,
        save: options.save,
      });
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  });

// Get WPT results by test ID (for manually started tests)
program
  .command('wpt-results <testId>')
  .description('Get WebPageTest results by test ID (use after manual test submission)')
  .option('-s, --save', 'Save results to output folder')
  .action(async (testId: string, options) => {
    try {
      await handleWPTResultsCommand(testId, { save: options.save });
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  });

// Full Pre-Vetting Check (all checks in parallel)
program
  .command('full-check [url]')
  .description('Run all pre-vetting checks in parallel and generate a Markdown report')
  .option('-i, --import-phase1 <file>', 'Import a Phase 1 report file instead of running autonomous discovery')
  .option('-m, --mobile', 'Test mobile instead of desktop')
  .option('--skip-wpt', 'Skip WebPageTest')
  .option('--wpt-key <key>', 'WPT API key (overrides .env)')
  .option('-s, --save', 'Save report to output folder')
  .action(async (url: string | undefined, options) => {
    try {
      await handleFullCheckCommand(url, {
        importPhase1: options.importPhase1,
        mobile: options.mobile,
        skipWpt: options.skipWpt,
        wptKey: options.wptKey,
        save: options.save,
      });
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  });

// Generate CC Session Execution Report
program
  .command('execution-report')
  .description('Generate execution report for CC session (uses latest full-check output)')
  .option('-d, --dir <path>', 'Output directory to use (default: latest)')
  .option('--input-tokens <n>', 'Estimated input tokens used')
  .option('--output-tokens <n>', 'Estimated output tokens used')
  .option('-w, --worked-well <items...>', 'What worked well (multiple values)')
  .option('-i, --improvements <items...>', 'What could be improved (multiple values)')
  .option('-p, --prompt-suggestions <items...>', 'Prompt improvement suggestions (multiple values)')
  .option('--no-save', 'Do not save report to file')
  .option('--print', 'Print report to console')
  .action(async (options) => {
    try {
      await handleExecutionReportCommand({
        dir: options.dir,
        inputTokens: options.inputTokens,
        outputTokens: options.outputTokens,
        workedWell: options.workedWell,
        improvements: options.improvements,
        promptSuggestions: options.promptSuggestions,
        noSave: !options.save,
        print: options.print,
      });
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  });

// Parse arguments
program.parse();
