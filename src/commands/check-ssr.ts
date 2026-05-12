import { createNewTarget, DEVICE_PROFILES, DeviceType } from '../cdp/connection';
import { createRunDir, saveHtml, saveJson, extractDomain } from '../utils/artifacts';
import { detectBotWall, dismissConsentDialog } from './discover-phase1';

export interface CheckSSROptions {
  url: string;
  device?: DeviceType;
  saveToFile?: boolean;
}

export interface SSRCheckResult {
  url: string;
  rawHtml: {
    length: number;
    hasContent: boolean;
    contentIndicators: ContentIndicators;
  };
  renderedHtml: {
    length: number;
    hasContent: boolean;
    contentIndicators: ContentIndicators;
  };
  analysis: {
    isSSR: boolean;
    isCSR: boolean;
    isHybrid: boolean;
    confidence: 'high' | 'medium' | 'low';
    reasoning: string;
  };
  savedTo?: string;
}

interface ContentIndicators {
  hasMainContent: boolean;
  hasProductData: boolean;
  hasTextContent: boolean;
  hasImages: boolean;
  hasEmptyBody: boolean;
  hasLoadingPlaceholders: boolean;
  hasHydrationMarkers: boolean;
  textContentLength: number;
  visibleTextSample: string;
}

/**
 * Check if a page uses Server-Side Rendering by comparing raw HTML vs rendered DOM
 */
export async function checkSSR(options: CheckSSROptions): Promise<SSRCheckResult> {
  const { url, device = 'desktop', saveToFile = false } = options;

  const deviceProfile = DEVICE_PROFILES[device];
  const connection = await createNewTarget();
  const { client } = connection;

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

    // Capture raw HTML from network response
    let rawHtml = '';
    let mainRequestId = '';

    client.Network.responseReceived((params) => {
      if (params.type === 'Document') {
        mainRequestId = params.requestId;
      }
    });

    await client.Page.navigate({ url });
    await client.Page.loadEventFired();

    // Get raw HTML from response body
    if (mainRequestId) {
      try {
        const bodyResponse = await client.Network.getResponseBody({
          requestId: mainRequestId,
        });
        rawHtml = bodyResponse.base64Encoded
          ? Buffer.from(bodyResponse.body, 'base64').toString('utf-8')
          : bodyResponse.body;
      } catch {
        console.warn('Could not get response body for raw HTML');
      }
    }

    // Dismiss consent banner before reading rendered DOM so real content is visible
    await dismissConsentDialog(client);

    // Wait for JavaScript to execute
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Get rendered HTML from DOM
    const renderedResult = await client.Runtime.evaluate({
      expression: 'document.documentElement.outerHTML',
      returnByValue: true,
    });
    const renderedHtml = renderedResult.result.value as string;

    // Bot wall safety gate — must run before any heuristic analysis
    const botWall = await detectBotWall(rawHtml);
    if (botWall.isWall) {
      console.warn(`⚠ Bot wall detected (${botWall.type}, ${botWall.confidence} confidence). SSR result unreliable.`);
      console.warn(`  Evidence: ${botWall.evidence.join(', ')}`);
    }

    // Analyze both versions
    const rawIndicators = analyzeContent(rawHtml);
    const renderedIndicators = analyzeContent(renderedHtml);

    // Determine SSR status
    const analysis = determineSSRStatus(rawIndicators, renderedIndicators, rawHtml, renderedHtml);

    // Demote confidence if a bot wall was detected
    if (botWall.isWall && analysis.confidence !== 'low') {
      analysis.confidence = 'low';
      analysis.reasoning = `[BOT WALL DETECTED: ${botWall.type}] ${analysis.reasoning}`;
    }

    let savedTo: string | undefined;
    if (saveToFile) {
      const runDir = createRunDir(extractDomain(url));
      saveHtml(runDir, 'raw-html.html', rawHtml);
      saveHtml(runDir, 'rendered-html.html', renderedHtml);
      savedTo = saveJson(runDir, 'ssr-analysis.json', {
        url,
        rawHtmlLength: rawHtml.length,
        renderedHtmlLength: renderedHtml.length,
        rawIndicators,
        renderedIndicators,
        analysis,
      });
    }

    return {
      url,
      rawHtml: {
        length: rawHtml.length,
        hasContent: rawIndicators.hasMainContent,
        contentIndicators: rawIndicators,
      },
      renderedHtml: {
        length: renderedHtml.length,
        hasContent: renderedIndicators.hasMainContent,
        contentIndicators: renderedIndicators,
      },
      analysis,
      savedTo,
    };
  } finally {
    await connection.close();
  }
}

function analyzeContent(html: string): ContentIndicators {
  // Remove scripts and styles for text analysis
  const htmlWithoutScripts = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Extract text content
  const textContent = htmlWithoutScripts
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Check for various content indicators
  const hasMainContent = !!(
    html.includes('<main') ||
    html.includes('id="main') ||
    html.includes('class="main') ||
    html.includes('<article') ||
    html.includes('role="main"')
  );

  const hasProductData = !!(
    html.includes('product') ||
    html.includes('price') ||
    html.includes('itemprop=') ||
    html.includes('schema.org/Product') ||
    html.includes('data-product')
  );

  const hasTextContent = textContent.length > 500;

  const hasImages = (html.match(/<img/gi) || []).length > 3;

  // Check for empty or minimal body
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : '';
  const bodyTextOnly = bodyContent.replace(/<[^>]+>/g, '').replace(/\s+/g, '').trim();
  const hasEmptyBody = bodyTextOnly.length < 100;

  // Check for loading placeholders
  const hasLoadingPlaceholders = !!(
    html.includes('loading') ||
    html.includes('skeleton') ||
    html.includes('placeholder') ||
    html.includes('spinner')
  );

  // Check for hydration markers (React, Vue, Next.js, Nuxt)
  const hasHydrationMarkers = !!(
    html.includes('__NEXT_DATA__') ||
    html.includes('__NUXT__') ||
    html.includes('data-reactroot') ||
    html.includes('data-react-helmet') ||
    html.includes('data-server-rendered') ||
    html.includes('data-v-') // Vue SSR markers
  );

  // Get visible text sample
  const visibleTextSample = textContent.substring(0, 300);

  return {
    hasMainContent,
    hasProductData,
    hasTextContent,
    hasImages,
    hasEmptyBody,
    hasLoadingPlaceholders,
    hasHydrationMarkers,
    textContentLength: textContent.length,
    visibleTextSample,
  };
}

function determineSSRStatus(
  raw: ContentIndicators,
  rendered: ContentIndicators,
  rawHtml: string,
  renderedHtml: string
): SSRCheckResult['analysis'] {
  // Calculate content difference
  const lengthDifference = renderedHtml.length - rawHtml.length;
  const lengthRatio = rawHtml.length > 0 ? renderedHtml.length / rawHtml.length : 0;
  const textDifferenceRatio = rendered.textContentLength > 0
    ? raw.textContentLength / rendered.textContentLength
    : 0;

  let isSSR = false;
  let isCSR = false;
  let isHybrid = false;
  let confidence: 'high' | 'medium' | 'low' = 'low';
  const reasons: string[] = [];

  // Strong SSR indicators
  if (raw.hasHydrationMarkers) {
    isSSR = true;
    reasons.push('Hydration markers found in raw HTML');
    confidence = 'high';
  }

  if (raw.textContentLength > 1000 && textDifferenceRatio > 0.7) {
    isSSR = true;
    reasons.push(`Raw HTML has substantial text content (${raw.textContentLength} chars, ${Math.round(textDifferenceRatio * 100)}% of rendered)`);
    confidence = confidence === 'high' ? 'high' : 'medium';
  }

  if (raw.hasProductData && raw.hasMainContent) {
    isSSR = true;
    reasons.push('Raw HTML contains product data and main content structure');
    confidence = confidence === 'low' ? 'medium' : confidence;
  }

  // Strong CSR indicators
  if (raw.hasEmptyBody && rendered.hasTextContent) {
    isCSR = true;
    reasons.push('Raw HTML body is empty/minimal but rendered version has content');
    confidence = 'high';
  }

  if (lengthRatio > 5 && raw.textContentLength < 200) {
    isCSR = true;
    reasons.push(`Rendered HTML is ${lengthRatio.toFixed(1)}x larger than raw HTML`);
    confidence = 'high';
  }

  if (!raw.hasTextContent && rendered.hasTextContent) {
    isCSR = true;
    reasons.push('No meaningful text in raw HTML, but present after JS execution');
    confidence = confidence === 'high' ? 'high' : 'medium';
  }

  // Hybrid detection
  if (isSSR && lengthRatio > 1.5) {
    isHybrid = true;
    reasons.push('Has SSR content but significant additional content added by JavaScript');
  }

  // Default reasoning if unclear
  if (!isSSR && !isCSR) {
    if (raw.textContentLength > 500) {
      isSSR = true;
      reasons.push('Raw HTML contains reasonable text content');
      confidence = 'low';
    } else {
      isCSR = true;
      reasons.push('Limited content in raw HTML suggests CSR');
      confidence = 'low';
    }
  }

  return {
    isSSR,
    isCSR: isCSR && !isSSR,
    isHybrid,
    confidence,
    reasoning: reasons.join('. '),
  };
}

/**
 * CLI handler for check-ssr command
 */
export async function handleCheckSSRCommand(url: string, options: {
  device?: string;
  save?: boolean;
}): Promise<void> {
  const result = await checkSSR({
    url,
    device: (options.device as DeviceType) || 'desktop',
    saveToFile: options.save,
  });

  console.log('\n=== SSR Analysis ===');
  console.log(`URL: ${result.url}`);

  console.log('\n--- Raw HTML (Server Response) ---');
  console.log(`Length: ${result.rawHtml.length} chars`);
  console.log(`Has Main Content: ${result.rawHtml.contentIndicators.hasMainContent}`);
  console.log(`Has Product Data: ${result.rawHtml.contentIndicators.hasProductData}`);
  console.log(`Has Text Content: ${result.rawHtml.contentIndicators.hasTextContent}`);
  console.log(`Text Length: ${result.rawHtml.contentIndicators.textContentLength} chars`);
  console.log(`Empty Body: ${result.rawHtml.contentIndicators.hasEmptyBody}`);
  console.log(`Hydration Markers: ${result.rawHtml.contentIndicators.hasHydrationMarkers}`);

  console.log('\n--- Rendered HTML (After JS) ---');
  console.log(`Length: ${result.renderedHtml.length} chars`);
  console.log(`Has Main Content: ${result.renderedHtml.contentIndicators.hasMainContent}`);
  console.log(`Text Length: ${result.renderedHtml.contentIndicators.textContentLength} chars`);

  console.log('\n--- Analysis ---');
  console.log(`SSR: ${result.analysis.isSSR ? 'YES' : 'NO'}`);
  console.log(`CSR Only: ${result.analysis.isCSR ? 'YES' : 'NO'}`);
  console.log(`Hybrid: ${result.analysis.isHybrid ? 'YES' : 'NO'}`);
  console.log(`Confidence: ${result.analysis.confidence.toUpperCase()}`);
  console.log(`\nReasoning: ${result.analysis.reasoning}`);

  console.log('\n--- Text Sample from Raw HTML ---');
  console.log(result.rawHtml.contentIndicators.visibleTextSample || '(no visible text)');

  if (result.savedTo) {
    console.log(`\nSaved to: ${result.savedTo}`);
  }
}
