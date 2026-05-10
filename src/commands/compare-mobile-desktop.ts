import { getRawHtml } from './get-raw-html';
import { compareHtml, compareScripts, generateCondensedDiff } from '../utils/diff';
import { createRunDir, saveHtml, saveText, extractDomain } from '../utils/artifacts';

export interface CompareHtmlOptions {
  url: string;
  saveArtifacts?: boolean;
}

export interface CompareHtmlResult {
  url: string;
  mobile: {
    html: string;
    statusCode: number;
    timing: { ttfb: number; total: number };
  };
  desktop: {
    html: string;
    statusCode: number;
    timing: { ttfb: number; total: number };
  };
  comparison: {
    hasDifferences: boolean;
    addedLines: number;
    removedLines: number;
    summary: string;
    structuralDiff: {
      headDiff: boolean;
      bodyDiff: boolean;
      scriptDiff: boolean;
      styleDiff: boolean;
      metaDiff: boolean;
      linkDiff: boolean;
    };
    scriptComparison: {
      onlyInMobile: string[];
      onlyInDesktop: string[];
      common: string[];
    };
  };
  savedTo?: string;
}

/**
 * Compare raw HTML between mobile and desktop devices
 * This checks if the server delivers different HTML based on user agent
 */
export async function compareMobileDesktop(options: CompareHtmlOptions): Promise<CompareHtmlResult> {
  const { url, saveArtifacts = true } = options;

  console.log('Fetching desktop HTML...');
  const desktopResult = await getRawHtml({
    url,
    device: 'desktop',
    bypassServiceWorker: true,
  });

  console.log('Fetching mobile HTML...');
  const mobileResult = await getRawHtml({
    url,
    device: 'mobile',
    bypassServiceWorker: true,
  });

  console.log('Comparing HTML...');
  const diff = compareHtml(mobileResult.html, desktopResult.html, 'mobile.html', 'desktop.html');
  const scriptDiff = compareScripts(mobileResult.html, desktopResult.html);

  let savedTo: string | undefined;
  if (saveArtifacts) {
    const runDir = createRunDir(extractDomain(url));
    saveHtml(runDir, 'mobile.html', mobileResult.html);
    saveHtml(runDir, 'desktop.html', desktopResult.html);
    saveText(runDir, 'diff.patch', diff.patch);
    saveText(runDir, 'diff-condensed.txt', generateCondensedDiff(mobileResult.html, desktopResult.html));
    savedTo = runDir;
  }

  return {
    url,
    mobile: {
      html: mobileResult.html,
      statusCode: mobileResult.statusCode,
      timing: mobileResult.timing,
    },
    desktop: {
      html: desktopResult.html,
      statusCode: desktopResult.statusCode,
      timing: desktopResult.timing,
    },
    comparison: {
      hasDifferences: diff.hasDifferences,
      addedLines: diff.addedLines,
      removedLines: diff.removedLines,
      summary: diff.summary,
      structuralDiff: diff.structuralDiff,
      scriptComparison: {
        onlyInMobile: scriptDiff.onlyIn1,
        onlyInDesktop: scriptDiff.onlyIn2,
        common: scriptDiff.common,
      },
    },
    savedTo,
  };
}

/**
 * CLI handler for compare-html command
 */
export async function handleCompareHtmlCommand(url: string, options: {
  noSave?: boolean;
}): Promise<void> {
  const result = await compareMobileDesktop({
    url,
    saveArtifacts: !options.noSave,
  });

  console.log('\n=== Mobile vs Desktop HTML Comparison ===');
  console.log(`URL: ${result.url}`);

  console.log('\n--- Mobile ---');
  console.log(`Status: ${result.mobile.statusCode}`);
  console.log(`TTFB: ${result.mobile.timing.ttfb}ms`);
  console.log(`HTML Size: ${result.mobile.html.length} chars`);

  console.log('\n--- Desktop ---');
  console.log(`Status: ${result.desktop.statusCode}`);
  console.log(`TTFB: ${result.desktop.timing.ttfb}ms`);
  console.log(`HTML Size: ${result.desktop.html.length} chars`);

  console.log('\n--- Comparison ---');
  console.log(`Has Differences: ${result.comparison.hasDifferences ? 'YES' : 'NO'}`);

  if (result.comparison.hasDifferences) {
    console.log(`Lines Added: ${result.comparison.addedLines}`);
    console.log(`Lines Removed: ${result.comparison.removedLines}`);
    console.log(`\nSummary:\n${result.comparison.summary}`);

    console.log('\n--- Structural Differences ---');
    const struct = result.comparison.structuralDiff;
    console.log(`<head> differs: ${struct.headDiff ? 'YES' : 'NO'}`);
    console.log(`<body> differs: ${struct.bodyDiff ? 'YES' : 'NO'}`);
    console.log(`<script> tags differ: ${struct.scriptDiff ? 'YES' : 'NO'}`);
    console.log(`<style> tags differ: ${struct.styleDiff ? 'YES' : 'NO'}`);
    console.log(`<meta> tags differ: ${struct.metaDiff ? 'YES' : 'NO'}`);
    console.log(`<link> tags differ: ${struct.linkDiff ? 'YES' : 'NO'}`);

    const scripts = result.comparison.scriptComparison;
    if (scripts.onlyInMobile.length > 0) {
      console.log(`\nScripts only in Mobile (${scripts.onlyInMobile.length}):`);
      scripts.onlyInMobile.slice(0, 5).forEach(s => console.log(`  - ${s}`));
      if (scripts.onlyInMobile.length > 5) console.log(`  ... and ${scripts.onlyInMobile.length - 5} more`);
    }

    if (scripts.onlyInDesktop.length > 0) {
      console.log(`\nScripts only in Desktop (${scripts.onlyInDesktop.length}):`);
      scripts.onlyInDesktop.slice(0, 5).forEach(s => console.log(`  - ${s}`));
      if (scripts.onlyInDesktop.length > 5) console.log(`  ... and ${scripts.onlyInDesktop.length - 5} more`);
    }
  }

  if (result.savedTo) {
    console.log(`\nArtifacts saved to: ${result.savedTo}`);
  }
}
