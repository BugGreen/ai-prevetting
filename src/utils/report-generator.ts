/**
 * Report Generator
 *
 * Generates a structured Markdown report from FullCheckResult data.
 * Produces a factual, data-driven report that can be directly compared
 * with the two-step (prompt2) narrative report.
 */

import { FullCheckResult } from '../commands/full-check';
import { extractDomain } from './artifacts';

/**
 * Generate a complete Markdown pre-vetting report from structured check results.
 */
export function generateReport(result: FullCheckResult): string {
  const domain = extractDomain(result.url);
  const date = result.timestamp.split('T')[0];
  const sections: string[] = [];

  sections.push(generateHeader(result, domain, date));
  sections.push(generateSummaryTable(result));
  sections.push(generateCDPFindings(result));
  sections.push(generatePageTypes(result));
  sections.push(generateTechStack(result));
  sections.push(generatePerformanceData(result));
  sections.push(generateKeyFindings(result));
  sections.push(generateDataLayer(result));
  sections.push(generateScopeRecommendations(result));
  sections.push(generateItemsVerified(result));
  sections.push(generateConclusion(result, domain));
  sections.push(generateFooter());

  return sections.join('\n\n---\n\n');
}

// ── Section Generators ────────────────────────────────────────────────────────

function generateHeader(result: FullCheckResult, domain: string, date: string): string {
  const hasIssues = result.executionMetrics.errors.length > 0;
  const status = hasIssues ? 'Needs Further Review' : 'Ready for Speed Kit Integration';

  return `# Speed Kit Pre-Vetting Report: ${domain}

**Date:** ${date}
**Steps Completed:** Autonomous (Phase 1 Discovery + Phase 2 CDP Verification)
**Analyst:** CLI Autonomous Pipeline
**URL:** ${result.url}
**Status:** ${status}`;
}

function generateSummaryTable(result: FullCheckResult): string {
  const rows: string[] = [];
  const { ssrCheck, htmlComparison, imageCheck, headerCheck, navigationCheck, step1Report } = result;

  // Navigation Type
  if (navigationCheck) {
    rows.push(`| **Navigation Type** | ${navigationCheck.navigationType.toUpperCase()} | CDP-verified: ${navigationCheck.analysis} |`);
  } else {
    rows.push(`| **Navigation Type** | Not tested | Navigation check skipped |`);
  }

  // SPA Framework
  const spaFramework = step1Report?.techStack?.['Frontend Framework'] || step1Report?.techStack?.['Frontend framework'] || 'Unknown';
  rows.push(`| **SPA Framework** | ${spaFramework} | ${step1Report ? 'Phase 1 detection' : 'Not checked'} |`);

  // SSR
  if (ssrCheck) {
    const ssrStatus = ssrCheck.analysis.isSSR ? 'YES' : 'NO';
    const rawLen = ssrCheck.rawHtml.length.toLocaleString();
    const rawText = ssrCheck.rawHtml.contentIndicators.textContentLength.toLocaleString();
    const renderedText = ssrCheck.renderedHtml.contentIndicators.textContentLength.toLocaleString();
    const ratio = renderedText !== '0'
      ? Math.round((ssrCheck.rawHtml.contentIndicators.textContentLength / ssrCheck.renderedHtml.contentIndicators.textContentLength) * 100)
      : 0;
    rows.push(`| **SSR Status** | ${ssrStatus} | Raw HTML: ${rawLen} chars, text ${rawText} chars (${ratio}% of rendered ${renderedText}) |`);
  } else {
    rows.push(`| **SSR Status** | Not tested | SSR check failed |`);
  }

  // Mobile vs Desktop
  if (htmlComparison) {
    const diff = htmlComparison.comparison.hasDifferences ? 'Different' : 'Same';
    const details = htmlComparison.comparison.hasDifferences
      ? `+${htmlComparison.comparison.addedLines}/-${htmlComparison.comparison.removedLines} lines`
      : 'No differences found';
    rows.push(`| **Mobile vs Desktop HTML** | ${diff} | ${details} |`);
  } else {
    rows.push(`| **Mobile vs Desktop HTML** | Not tested | HTML comparison failed |`);
  }

  // Images
  if (imageCheck) {
    const pct = imageCheck.summary.optimizedPercentage;
    rows.push(`| **Image Optimization** | ${pct}% modern formats | ${imageCheck.summary.webp} WebP, ${imageCheck.summary.avif} AVIF out of ${imageCheck.summary.total} images |`);
  }

  // CSP
  if (headerCheck) {
    const hasCSP = headerCheck.analysis.csp ? 'YES' : 'NO';
    const cspDetails = headerCheck.analysis.csp
      ? truncate(headerCheck.analysis.csp, 80)
      : 'No CSP header present';
    rows.push(`| **CSP Headers** | ${hasCSP} | ${cspDetails} |`);
  }

  // CDN
  if (headerCheck) {
    rows.push(`| **CDN** | ${headerCheck.analysis.cdn || 'None'} | ${headerCheck.analysis.server || 'Unknown'} server |`);
  }

  // TTFB
  if (htmlComparison) {
    rows.push(`| **TTFB (Desktop)** | ${htmlComparison.desktop.timing.ttfb} ms | Lab measurement |`);
    rows.push(`| **TTFB (Mobile)** | ${htmlComparison.mobile.timing.ttfb} ms | Lab measurement |`);
  }

  // CrUX
  if (step1Report?.cruxData) {
    const mobileTTFB = step1Report.cruxData.mobile?.['TTFB'] || step1Report.cruxData.mobile?.['ttfb'];
    if (mobileTTFB) {
      rows.push(`| **TTFB (Mobile CrUX)** | ${mobileTTFB} | Field data |`);
    }
  }

  // Service Workers
  if (step1Report?.serviceWorkers) {
    const sw = step1Report.serviceWorkers;
    const swStatus = sw.hasServiceWorker ? `Yes (${sw.registrations.length} registration(s))` : 'None';
    rows.push(`| **ServiceWorker** | ${swStatus} | Phase 1 detection |`);
  }

  return `## 1. Summary Table

| Category | Finding | Details |
|----------|---------|---------|
${rows.join('\n')}`;
}

function generateCDPFindings(result: FullCheckResult): string {
  const subsections: string[] = [];

  // 3.1 Navigation
  subsections.push(generateNavSection(result));

  // 3.2 SSR
  subsections.push(generateSSRSection(result));

  // 3.3 Mobile vs Desktop
  subsections.push(generateMobileDesktopSection(result));

  // 3.4 Images
  subsections.push(generateImageSection(result));

  // 3.5 CSP / Headers
  subsections.push(generateHeadersSection(result));

  return `## 2. CDP-Verified Findings

${subsections.join('\n\n')}`;
}

function generateNavSection(result: FullCheckResult): string {
  const nav = result.navigationCheck;
  if (!nav) {
    return `### 2.1 Hard vs. Soft Navigations

Navigation check was not performed (no target URL found or check failed).`;
  }

  return `### 2.1 Hard vs. Soft Navigations

| From | To | Type | Document Requests | Evidence |
|------|----|------|-------------------|----------|
| ${nav.startUrl} | ${nav.targetUrl} | **${nav.navigationType.toUpperCase()}** | ${nav.evidence.documentRequestCount} | ${nav.analysis} |

**Navigation method:** ${nav.navigationMethod}
**History API used:** ${nav.evidence.historyApiUsed ? 'Yes' : 'No'}
**Duration:** ${nav.timing.navigationDuration}ms`;
}

function generateSSRSection(result: FullCheckResult): string {
  const ssr = result.ssrCheck;
  if (!ssr) {
    return `### 2.2 SSR Verification

SSR check failed or was not performed.`;
  }

  const ratio = ssr.renderedHtml.contentIndicators.textContentLength > 0
    ? Math.round((ssr.rawHtml.contentIndicators.textContentLength / ssr.renderedHtml.contentIndicators.textContentLength) * 100)
    : 0;

  return `### 2.2 SSR Verification (Raw HTML Analysis)

| Metric | Value |
|--------|-------|
| Raw HTML size | ${ssr.rawHtml.length.toLocaleString()} chars |
| Raw HTML text content | ${ssr.rawHtml.contentIndicators.textContentLength.toLocaleString()} chars |
| Rendered HTML size | ${ssr.renderedHtml.length.toLocaleString()} chars |
| Rendered HTML text content | ${ssr.renderedHtml.contentIndicators.textContentLength.toLocaleString()} chars |
| SSR ratio (text) | **${ratio}%** |
| Product data in raw HTML | ${ssr.rawHtml.contentIndicators.hasProductData ? 'Yes' : 'No'} |
| Hydration markers | ${ssr.rawHtml.contentIndicators.hasHydrationMarkers ? 'Yes' : 'No'} |
| Confidence | ${ssr.analysis.confidence.toUpperCase()} |

**Reasoning:** ${ssr.analysis.reasoning}`;
}

function generateMobileDesktopSection(result: FullCheckResult): string {
  const cmp = result.htmlComparison;
  if (!cmp) {
    return `### 2.3 Mobile vs Desktop HTML Comparison

HTML comparison failed (likely due to page load timeout). This check uses strict \`loadEventFired\` and may fail on tracker-heavy sites.`;
  }

  const structural = cmp.comparison.structuralDiff;
  const diffs: string[] = [];
  if (structural.headDiff) diffs.push('`<head>`');
  if (structural.bodyDiff) diffs.push('`<body>`');
  if (structural.scriptDiff) diffs.push('`<script>`');
  if (structural.styleDiff) diffs.push('`<style>`');
  if (structural.metaDiff) diffs.push('`<meta>`');
  if (structural.linkDiff) diffs.push('`<link>`');

  let scriptSection = '';
  if (cmp.comparison.scriptComparison.onlyInMobile.length > 0 || cmp.comparison.scriptComparison.onlyInDesktop.length > 0) {
    scriptSection = `

**Scripts only in Mobile:** ${cmp.comparison.scriptComparison.onlyInMobile.length || 'None'}
**Scripts only in Desktop:** ${cmp.comparison.scriptComparison.onlyInDesktop.length || 'None'}`;
  }

  return `### 2.3 Mobile vs Desktop HTML Comparison

| Metric | Mobile | Desktop |
|--------|--------|---------|
| HTTP Status | ${cmp.mobile.statusCode} | ${cmp.desktop.statusCode} |
| TTFB | ${cmp.mobile.timing.ttfb} ms | ${cmp.desktop.timing.ttfb} ms |
| HTML size | ${cmp.mobile.html.length.toLocaleString()} chars | ${cmp.desktop.html.length.toLocaleString()} chars |
| Lines added (desktop vs mobile) | — | +${cmp.comparison.addedLines} |
| Lines removed (desktop vs mobile) | — | -${cmp.comparison.removedLines} |

**Structural differences in:** ${diffs.length > 0 ? diffs.join(', ') : 'None detected'}
**Cache variations needed:** ${cmp.comparison.hasDifferences ? 'YES' : 'NO'}${scriptSection}

${cmp.comparison.summary}`;
}

function generateImageSection(result: FullCheckResult): string {
  const img = result.imageCheck;
  if (!img) {
    return `### 2.4 Image Optimization

Image check failed or was not performed.`;
  }

  const ll = img.lazyLoadAnalysis;
  const sz = img.sizeAnalysis;

  let lcpSection = '';
  if (ll.lcpImage) {
    lcpSection = `
**LCP Image:**
- URL: \`${truncate(ll.lcpImage.src, 80)}\`
- Size: ${ll.lcpImage.naturalWidth}x${ll.lcpImage.naturalHeight}px
- Lazy loaded: ${ll.lcpImageIsLazy ? 'YES (issue)' : 'NO (correct)'}
- \`fetchpriority\`: ${ll.lcpImage.fetchPriority || 'auto'}`;
  }

  let warningSection = '';
  if (img.warnings.length > 0) {
    warningSection = `\n\n**Warnings:** ${img.warnings.join('; ')}`;
  }

  return `### 2.4 Image Optimization

**Format Distribution:**

| Format | Count | Percentage |
|--------|-------|------------|
| WebP | ${img.summary.webp} | ${pct(img.summary.webp, img.summary.total)} |
| AVIF | ${img.summary.avif} | ${pct(img.summary.avif, img.summary.total)} |
| JPEG | ${img.summary.jpeg} | ${pct(img.summary.jpeg, img.summary.total)} |
| PNG | ${img.summary.png} | ${pct(img.summary.png, img.summary.total)} |
| GIF | ${img.summary.gif} | ${pct(img.summary.gif, img.summary.total)} |
| SVG | ${img.summary.svg} | ${pct(img.summary.svg, img.summary.total)} |

**Payload Analysis:**
- Total image payload: **${sz.totalFormatted}**
- Above-the-fold payload: ${sz.aboveTheFoldFormatted}
- Below-the-fold payload: ${sz.belowTheFoldFormatted}
- Average image size: ${sz.averageFormatted}
${sz.largestImage ? `- Largest image: ${sz.largestImage.formatted} (\`${truncate(sz.largestImage.url, 60)}\`)` : ''}

**Lazy Loading:**
- Total visible images: ${ll.totalImages}
- Lazy loaded: ${ll.lazyLoadedCount} (${ll.nativeLazyCount} native, ${ll.jsLazyCount} JS-based)
- ATF images: ${ll.aboveTheFoldImages.length}
- ATF images with lazy loading: **${ll.aboveTheFoldLazyLoaded.length}**${lcpSection}${warningSection}`;
}

function generateHeadersSection(result: FullCheckResult): string {
  const hdr = result.headerCheck;
  if (!hdr) {
    return `### 2.5 Response Headers

Headers check failed or was not performed.`;
  }

  const secHeaders = Object.entries(hdr.analysis.securityHeaders)
    .map(([k, v]) => `| \`${k}\` | ${truncate(v, 60)} |`)
    .join('\n');

  return `### 2.5 Response Headers & CSP

**CSP:**
${hdr.analysis.csp ? '```\n' + hdr.analysis.csp + '\n```' : 'No Content-Security-Policy header present.'}

**Other Headers:**

| Header | Value |
|--------|-------|
| Server | ${hdr.analysis.server || 'Not disclosed'} |
| CDN | ${hdr.analysis.cdn || 'None detected'} |
| Cache-Control | ${hdr.analysis.cacheControl || 'Not set'} |
| Content-Type | ${hdr.analysis.contentType || 'Not set'} |
${secHeaders}`;
}

function generatePageTypes(result: FullCheckResult): string {
  const pageTypes = result.step1Report?.pageTypes || [];

  if (pageTypes.length === 0) {
    return `## 3. Page Types Found

No page types were discovered during Phase 1.`;
  }

  const navType = result.navigationCheck?.navigationType.toUpperCase() || 'Unknown';
  const isSSR = result.ssrCheck?.analysis.isSSR ? 'Yes' : 'Unknown';

  const rows = pageTypes.map(p =>
    `| ${p.name} | ${p.urlPattern} | ${navType} | ${isSSR} |`
  ).join('\n');

  return `## 3. Page Types Found

| Page Type | URL Pattern | Navigation | SSR |
|-----------|-------------|------------|-----|
${rows}`;
}

function generateTechStack(result: FullCheckResult): string {
  const techStack = result.step1Report?.techStack || {};
  const headerCheck = result.headerCheck;

  const rows: string[] = [];

  for (const [component, value] of Object.entries(techStack)) {
    rows.push(`| ${component} | ${value} | Yes (Phase 1) |`);
  }

  // Add header-verified entries if not already present
  if (headerCheck) {
    if (headerCheck.analysis.server && !techStack['Server'] && !techStack['Origin Web Server']) {
      rows.push(`| Origin Web Server | ${headerCheck.analysis.server} | Yes (headers) |`);
    }
    if (headerCheck.analysis.cdn && !techStack['CDN']) {
      rows.push(`| CDN | ${headerCheck.analysis.cdn} | Yes (headers) |`);
    }
  }

  if (rows.length === 0) {
    return `## 4. Tech Stack

No tech stack information available.`;
  }

  return `## 4. Tech Stack

| Component | Value | CDP-Verified |
|-----------|-------|--------------|
${rows.join('\n')}`;
}

function generatePerformanceData(result: FullCheckResult): string {
  const parts: string[] = [];

  // CrUX data
  if (result.step1Report?.cruxData) {
    const crux = result.step1Report.cruxData;
    if (crux.mobile && Object.keys(crux.mobile).length > 0) {
      const mobileRows = Object.entries(crux.mobile)
        .map(([metric, value]) => `| ${metric} | ${value} |`)
        .join('\n');
      parts.push(`**CrUX (Mobile):**\n\n| Metric | p75 |\n|--------|-----|\n${mobileRows}`);
    }
    if (crux.desktop && Object.keys(crux.desktop).length > 0) {
      const desktopRows = Object.entries(crux.desktop)
        .map(([metric, value]) => `| ${metric} | ${value} |`)
        .join('\n');
      parts.push(`**CrUX (Desktop):**\n\n| Metric | p75 |\n|--------|-----|\n${desktopRows}`);
    }
  } else {
    parts.push('**CrUX:** No field data available (API key not configured or data not found).');
  }

  // Lab TTFB
  if (result.htmlComparison) {
    parts.push(`**CDP-Measured TTFB (Lab):**

| Page | Device | TTFB |
|------|--------|------|
| Homepage | Desktop | ${result.htmlComparison.desktop.timing.ttfb} ms |
| Homepage | Mobile | ${result.htmlComparison.mobile.timing.ttfb} ms |`);
  }

  return `## 5. Performance Data

${parts.join('\n\n')}`;
}

function generateKeyFindings(result: FullCheckResult): string {
  const findings: string[] = [];
  let n = 1;

  // TTFB opportunity
  if (result.htmlComparison) {
    const desktopTTFB = result.htmlComparison.desktop.timing.ttfb;
    const mobileTTFB = result.htmlComparison.mobile.timing.ttfb;
    const maxTTFB = Math.max(desktopTTFB, mobileTTFB);
    if (maxTTFB > 500) {
      findings.push(`${n++}. **TTFB Reduction Opportunity** --- Desktop TTFB is ${desktopTTFB}ms, Mobile is ${mobileTTFB}ms. Speed Kit edge caching can reduce this to sub-200ms for cacheable pages.`);
    }
  }

  // Mobile vs Desktop cache variations
  if (result.htmlComparison?.comparison.hasDifferences) {
    findings.push(`${n++}. **HTML Cache Variations Required** --- Server delivers different HTML for Mobile vs Desktop (+${result.htmlComparison.comparison.addedLines}/-${result.htmlComparison.comparison.removedLines} lines). Speed Kit must maintain separate cache entries per device type.`);
  }

  // SSR architecture
  if (result.ssrCheck?.analysis.isSSR) {
    findings.push(`${n++}. **SSR Architecture** --- Server-side rendering confirmed (${result.ssrCheck.analysis.confidence} confidence). The HTML shell can be cached aggressively.`);
  }

  // Navigation type
  if (result.navigationCheck?.navigationType === 'hard') {
    findings.push(`${n++}. **Hard Navigations (MPA)** --- All tested navigations are full page reloads. Ideal for Speed Kit's HTML caching.`);
  }

  // No CDN
  if (result.headerCheck && !result.headerCheck.analysis.cdn) {
    findings.push(`${n++}. **No Origin CDN** --- Server (${result.headerCheck.analysis.server || 'unknown'}) has no CDN in front. Speed Kit's edge becomes the entire caching layer.`);
  }

  // CSP compatibility
  if (result.headerCheck?.analysis.csp) {
    const csp = result.headerCheck.analysis.csp;
    const isPermissive = csp.includes('*') || csp.includes('unsafe-inline');
    findings.push(`${n++}. **CSP ${isPermissive ? 'Compatible' : 'May Require Changes'}** --- ${isPermissive ? 'Permissive CSP will not block Speed Kit.' : 'CSP may need modification to allow Speed Kit scripts.'}`);
  }

  // Image optimization gaps
  if (result.imageCheck) {
    const gaps: string[] = [];
    if (result.imageCheck.summary.avif === 0) gaps.push('no AVIF');
    if (result.imageCheck.lazyLoadAnalysis.aboveTheFoldLazyLoaded.length > 0) {
      gaps.push(`${result.imageCheck.lazyLoadAnalysis.aboveTheFoldLazyLoaded.length} ATF image(s) with lazy loading`);
    }
    if (result.imageCheck.lazyLoadAnalysis.lcpImageIsLazy) gaps.push('LCP image is lazy-loaded');
    if (gaps.length > 0) {
      findings.push(`${n++}. **Image Optimization Gaps** --- ${gaps.join(', ')}. ${result.imageCheck.summary.optimizedPercentage}% modern format adoption.`);
    }
  }

  // Failed checks
  const failedChecks = result.executionMetrics.errors.map(e => e.check);
  if (failedChecks.length > 0) {
    findings.push(`${n++}. **Failed Checks** --- ${failedChecks.join(', ')} failed during this run. Results may be incomplete.`);
  }

  if (findings.length === 0) {
    findings.push('1. No significant findings detected. Manual review recommended.');
  }

  return `## 6. Key Findings for Speed Kit

${findings.join('\n\n')}`;
}

function generateDataLayer(result: FullCheckResult): string {
  const dl = result.step1Report?.dataLayer;
  if (!dl || !dl.hasDataLayer) {
    return `## 7. DataLayer Properties for Speed Kit Tracking

No relevant DataLayer properties detected.`;
  }

  const rows: string[] = [];
  for (const key of dl.interestingKeys) {
    rows.push(`| \`${key}\` | Detected in dataLayer | — |`);
  }

  return `## 7. DataLayer Properties for Speed Kit Tracking

DataLayer detected with ${dl.entryCount} entries. ${dl.interestingKeys.length} interesting keys found.

| Property | Description | Example |
|----------|-------------|---------|
${rows.join('\n')}`;
}

function generateScopeRecommendations(result: FullCheckResult): string {
  const pageTypes = result.step1Report?.pageTypes || [];
  const isSSR = result.ssrCheck?.analysis.isSSR;
  const isHard = result.navigationCheck?.navigationType === 'hard';

  const good: string[] = [];
  const exclude: string[] = [];

  for (const pt of pageTypes) {
    const name = pt.name.toLowerCase();
    if (name.includes('cart') || name.includes('account') || name.includes('login')
        || name.includes('checkout') || name.includes('wishlist')) {
      exclude.push(`- **${pt.name}** (\`${pt.urlPattern}\`) --- User-specific content, must not be cached.`);
    } else {
      const reasons: string[] = [];
      if (isSSR) reasons.push('SSR');
      if (isHard) reasons.push('hard navigation');
      good.push(`- **${pt.name}** (\`${pt.urlPattern}\`) --- ${reasons.length ? reasons.join(', ') : 'Review needed'}.`);
    }
  }

  if (good.length === 0 && exclude.length === 0) {
    return `## 8. Speed Kit Scope Recommendations

Insufficient data to generate scope recommendations. Run with more page types discovered.`;
  }

  return `## 8. Speed Kit Scope Recommendations

**Good Candidates for Acceleration:**

${good.length > 0 ? good.join('\n') : '- No candidates identified.'}

**Exclude from Speed Kit / Careful Handling:**

${exclude.length > 0 ? exclude.join('\n') : '- No exclusions identified. Review user-specific page types manually.'}`;
}

function generateItemsVerified(result: FullCheckResult): string {
  const items: string[] = [];
  const { ssrCheck, htmlComparison, imageCheck, headerCheck, navigationCheck, step1Report } = result;

  if (step1Report) {
    items.push(`| Phase 1 Discovery | \`runPhase1Discovery()\` | ${step1Report.pageTypes.length} page types, ${Object.keys(step1Report.techStack).length} tech stack entries |`);
  }

  if (navigationCheck) {
    items.push(`| Navigation Type | \`check-nav\` | ${navigationCheck.navigationType.toUpperCase()} (${navigationCheck.navigationMethod}) |`);
  }

  if (ssrCheck) {
    const ratio = ssrCheck.renderedHtml.contentIndicators.textContentLength > 0
      ? Math.round((ssrCheck.rawHtml.contentIndicators.textContentLength / ssrCheck.renderedHtml.contentIndicators.textContentLength) * 100)
      : 0;
    items.push(`| SSR Content | \`check-ssr\` | ${ssrCheck.analysis.isSSR ? 'Yes' : 'No'}, ${ratio}% SSR ratio |`);
  }

  if (htmlComparison) {
    const diff = htmlComparison.comparison.hasDifferences
      ? `Different (+${htmlComparison.comparison.addedLines}/-${htmlComparison.comparison.removedLines})`
      : 'Same';
    items.push(`| Mobile vs Desktop HTML | \`compare-html\` | ${diff} |`);
  } else {
    items.push(`| Mobile vs Desktop HTML | \`compare-html\` | Failed (page load timeout) |`);
  }

  if (imageCheck) {
    items.push(`| Image Formats | \`check-images\` | ${imageCheck.summary.optimizedPercentage}% modern, ${imageCheck.lazyLoadAnalysis.aboveTheFoldLazyLoaded.length} ATF lazy issues |`);
  }

  if (headerCheck) {
    items.push(`| Response Headers | \`headers\` | ${headerCheck.analysis.cdn || 'No CDN'}, ${headerCheck.analysis.csp ? 'CSP present' : 'No CSP'} |`);
  }

  return `## 9. Items Verified via CDP

| Item | Method | Result |
|------|--------|--------|
${items.join('\n')}`;
}

function generateConclusion(result: FullCheckResult, domain: string): string {
  const pros: string[] = [];
  const cons: string[] = [];

  if (result.ssrCheck?.analysis.isSSR) pros.push('full SSR');
  if (result.navigationCheck?.navigationType === 'hard') pros.push('hard navigations (MPA)');
  if (result.headerCheck && !result.headerCheck.analysis.cdn) pros.push('no origin CDN (Speed Kit provides the edge layer)');
  if (result.headerCheck?.analysis.csp?.includes('*')) pros.push('permissive CSP');

  if (result.executionMetrics.errors.length > 0) {
    cons.push(`${result.executionMetrics.errors.length} check(s) failed during this run`);
  }
  if (result.htmlComparison?.comparison.hasDifferences) {
    cons.push('Mobile/Desktop cache variations required');
  }

  const verdict = pros.length >= 2 && cons.length <= 1
    ? `${domain} appears to be a good Speed Kit candidate`
    : `${domain} requires further review`;

  return `## 10. Conclusion

${verdict}: ${pros.length > 0 ? pros.join(', ') : 'insufficient data to assess'}.

${cons.length > 0 ? '**Configuration requirements:**\n' + cons.map((c, i) => `${i + 1}. ${c}`).join('\n') : ''}`;
}

function generateFooter(): string {
  return `---

*Report generated by Speed Kit Pre-Vetting CLI (Autonomous Pipeline)*
*Phase 1: Discovery + Phase 2: CDP Verification*`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

function pct(count: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((count / total) * 100)}%`;
}
