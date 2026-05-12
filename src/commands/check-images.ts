import { createNewTarget, DEVICE_PROFILES, DeviceType } from '../cdp/connection';
import { createRunDir, saveJson, extractDomain } from '../utils/artifacts';
import { detectBotWall, dismissConsentDialog } from './discover-phase1';

export interface CheckImagesOptions {
  url: string;
  device?: DeviceType;
  saveToFile?: boolean;
}

export interface ImageInfo {
  url: string;
  contentType: string | null;
  format: 'webp' | 'avif' | 'jpeg' | 'png' | 'gif' | 'svg' | 'unknown';
  size: number;
  status: number;
  isOptimized: boolean;
  fromCDN: boolean;
  cdnProvider: string | null;
}

export interface DOMImageInfo {
  src: string;
  currentSrc: string;
  naturalWidth: number;
  naturalHeight: number;
  displayWidth: number;
  displayHeight: number;
  loading: string | null; // 'lazy' | 'eager' | null
  decoding: string | null;
  fetchPriority: string | null;
  isLazyLoaded: boolean;
  lazyLoadMethod: string | null; // 'native' | 'data-src' | 'data-lazy' | 'lazysizes' | etc.
  isAboveTheFold: boolean;
  distanceFromViewport: number; // negative = above viewport, positive = below
  rect: { top: number; left: number; width: number; height: number };
  alt: string;
  isVisible: boolean;
  isLCP: boolean;
}

export interface ImageSizeAnalysis {
  totalBytes: number;
  totalFormatted: string;
  aboveTheFoldBytes: number;
  aboveTheFoldFormatted: string;
  belowTheFoldBytes: number;
  belowTheFoldFormatted: string;
  lazyLoadedBytes: number;
  lazyLoadedFormatted: string;
  eagerBytes: number;
  eagerFormatted: string;
  averageImageSize: number;
  averageFormatted: string;
  largestImage: { url: string; size: number; formatted: string } | null;
}

export interface LazyLoadAnalysis {
  totalImages: number;
  lazyLoadedCount: number;
  nativeLazyCount: number;
  jsLazyCount: number;
  eagerCount: number;
  aboveTheFoldImages: DOMImageInfo[];
  aboveTheFoldLazyLoaded: DOMImageInfo[];
  lazyLoadMethods: Record<string, number>;
  lcpImage: DOMImageInfo | null;
  lcpImageIsLazy: boolean;
  recommendation: string;
}

export interface CheckImagesResult {
  url: string;
  images: ImageInfo[];
  domImages: DOMImageInfo[];
  lazyLoadAnalysis: LazyLoadAnalysis;
  sizeAnalysis: ImageSizeAnalysis;
  summary: {
    total: number;
    webp: number;
    avif: number;
    jpeg: number;
    png: number;
    gif: number;
    svg: number;
    other: number;
    optimizedPercentage: number;
    fromCDN: number;
  };
  analysis: string;
  /** Populated when a bot wall or challenge page is detected — results may be unreliable */
  warnings: string[];
  savedTo?: string;
}

/**
 * Check image optimization on a page
 */
export async function checkImages(options: CheckImagesOptions): Promise<CheckImagesResult> {
  const { url, device = 'desktop', saveToFile = false } = options;

  const deviceProfile = DEVICE_PROFILES[device];
  const connection = await createNewTarget();
  const { client } = connection;

  const images: ImageInfo[] = [];

  try {
    await Promise.all([
      client.Network.enable({}),
      client.Page.enable(),
      client.Runtime.enable(),
      client.DOM.enable(),
    ]);

    await client.Network.setBypassServiceWorker({ bypass: true });

    // Disable cache to get accurate transfer sizes
    await client.Network.setCacheDisabled({ cacheDisabled: true });

    await client.Emulation.setUserAgentOverride({
      userAgent: deviceProfile.userAgent,
    });

    await client.Emulation.setDeviceMetricsOverride({
      width: deviceProfile.viewport.width,
      height: deviceProfile.viewport.height,
      deviceScaleFactor: deviceProfile.deviceScaleFactor,
      mobile: deviceProfile.mobile,
    });

    // Track main document request (for bot wall detection)
    let mainRequestId = '';
    const warnings: string[] = [];

    // Track image responses
    const responseMap = new Map<string, {
      headers: Record<string, string>;
      status: number;
      contentLength: number;
      encodedDataLength: number;
    }>();
    const requestUrls = new Map<string, string>();

    client.Network.responseReceived((params) => {
      if (params.type === 'Document') {
        mainRequestId = params.requestId;
      }
      if (params.type === 'Image') {
        const headers = params.response.headers as Record<string, string>;
        // Try to get content-length from response
        const contentLength = parseInt(headers['content-length'] || headers['Content-Length'] || '0', 10);
        responseMap.set(params.requestId, {
          headers,
          status: params.response.status,
          contentLength,
          encodedDataLength: params.response.encodedDataLength || 0,
        });
      }
    });

    client.Network.requestWillBeSent((params) => {
      if (params.type === 'Image') {
        requestUrls.set(params.requestId, params.request.url);
      }
    });

    client.Network.loadingFinished((params) => {
      const response = responseMap.get(params.requestId);
      const imageUrl = requestUrls.get(params.requestId);
      if (response && imageUrl) {
        const contentType = response.headers['content-type'] || response.headers['Content-Type'] || null;
        const format = detectImageFormat(contentType, imageUrl);
        const cdnInfo = detectImageCDN(imageUrl, response.headers);

        // Use the best available size: loadingFinished > responseReceived > content-length header
        const size = params.encodedDataLength ||
                     response.encodedDataLength ||
                     response.contentLength ||
                     0;

        images.push({
          url: imageUrl,
          contentType,
          format,
          size,
          status: response.status,
          isOptimized: format === 'webp' || format === 'avif',
          fromCDN: cdnInfo.fromCDN,
          cdnProvider: cdnInfo.provider,
        });
      }
    });

    await client.Page.navigate({ url });
    await client.Page.loadEventFired();

    // Wait for initial render
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Dismiss consent banner before DOM queries so real content is visible
    await dismissConsentDialog(client);

    // Bot wall safety gate — run before DOM queries so vacuous results are flagged
    if (mainRequestId) {
      try {
        const bodyResponse = await client.Network.getResponseBody({ requestId: mainRequestId });
        const rawHtml = bodyResponse.base64Encoded
          ? Buffer.from(bodyResponse.body, 'base64').toString('utf-8')
          : bodyResponse.body;
        const botWall = await detectBotWall(rawHtml);
        if (botWall.isWall) {
          const msg = `Bot wall detected (${botWall.type}, ${botWall.confidence} confidence): ${botWall.evidence.join(', ')}. Image results may be empty or misleading.`;
          warnings.push(msg);
          console.warn(`⚠ ${msg}`);
        }
      } catch {
        // getResponseBody can fail for cached responses — non-fatal
      }
    }

    // Analyze DOM images BEFORE scrolling to get accurate above-the-fold info
    const domImagesResult = await client.Runtime.evaluate({
      expression: `
        (function() {
          const viewportHeight = window.innerHeight;
          const viewportWidth = window.innerWidth;
          const images = [];

          // Get all img elements
          document.querySelectorAll('img').forEach((img, index) => {
            const rect = img.getBoundingClientRect();
            const style = window.getComputedStyle(img);

            // Check various lazy loading methods
            let isLazyLoaded = false;
            let lazyLoadMethod = null;

            // Native lazy loading
            if (img.loading === 'lazy') {
              isLazyLoaded = true;
              lazyLoadMethod = 'native';
            }

            // data-src pattern (common JS lazy loaders)
            if (img.dataset.src || img.dataset.lazySrc) {
              isLazyLoaded = true;
              lazyLoadMethod = 'data-src';
            }

            // lazysizes library
            if (img.classList.contains('lazyload') || img.classList.contains('lazyloading') || img.classList.contains('lazyloaded')) {
              isLazyLoaded = true;
              lazyLoadMethod = 'lazysizes';
            }

            // lozad library
            if (img.classList.contains('lozad')) {
              isLazyLoaded = true;
              lazyLoadMethod = 'lozad';
            }

            // data-lazy pattern
            if (img.dataset.lazy) {
              isLazyLoaded = true;
              lazyLoadMethod = 'data-lazy';
            }

            // WordPress lazy loading
            if (img.classList.contains('lazy') || img.dataset.lazyType) {
              isLazyLoaded = true;
              lazyLoadMethod = lazyLoadMethod || 'class-lazy';
            }

            // Check for placeholder src (common lazy loading pattern)
            const src = img.src || '';
            if (src.includes('data:image') || src.includes('placeholder') || src.includes('blank.gif') || src.includes('1x1')) {
              if (img.dataset.src) {
                isLazyLoaded = true;
                lazyLoadMethod = lazyLoadMethod || 'placeholder-src';
              }
            }

            // Intersection Observer hint
            if (img.dataset.observe || img.dataset.intersect) {
              isLazyLoaded = true;
              lazyLoadMethod = lazyLoadMethod || 'intersection-observer';
            }

            // Calculate if above the fold
            const isAboveTheFold = rect.top < viewportHeight && rect.bottom > 0 && rect.left < viewportWidth && rect.right > 0;
            const distanceFromViewport = rect.top - viewportHeight; // negative = visible or above

            // Check visibility
            const isVisible = style.display !== 'none' &&
                             style.visibility !== 'hidden' &&
                             style.opacity !== '0' &&
                             rect.width > 0 &&
                             rect.height > 0;

            images.push({
              src: img.src || '',
              currentSrc: img.currentSrc || img.src || '',
              naturalWidth: img.naturalWidth,
              naturalHeight: img.naturalHeight,
              displayWidth: rect.width,
              displayHeight: rect.height,
              loading: img.loading || null,
              decoding: img.decoding || null,
              fetchPriority: img.fetchPriority || null,
              isLazyLoaded,
              lazyLoadMethod,
              isAboveTheFold: isAboveTheFold && isVisible,
              distanceFromViewport: Math.round(distanceFromViewport),
              rect: {
                top: Math.round(rect.top),
                left: Math.round(rect.left),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
              },
              alt: img.alt || '',
              isVisible,
              isLCP: false // Will be determined separately
            });
          });

          return images;
        })()
      `,
      returnByValue: true,
    });

    const domImages: DOMImageInfo[] = domImagesResult.result.value as DOMImageInfo[] || [];

    // Try to identify LCP image
    const lcpResult = await client.Runtime.evaluate({
      expression: `
        (function() {
          // Try to find the largest visible image above the fold
          const viewportHeight = window.innerHeight;
          let largestImage = null;
          let largestArea = 0;

          document.querySelectorAll('img').forEach(img => {
            const rect = img.getBoundingClientRect();
            const style = window.getComputedStyle(img);
            const isVisible = style.display !== 'none' &&
                             style.visibility !== 'hidden' &&
                             rect.width > 0 &&
                             rect.height > 0;
            const isAboveTheFold = rect.top < viewportHeight && rect.bottom > 0;

            if (isVisible && isAboveTheFold) {
              const area = rect.width * rect.height;
              if (area > largestArea) {
                largestArea = area;
                largestImage = img.src || img.currentSrc;
              }
            }
          });

          return largestImage;
        })()
      `,
      returnByValue: true,
    });

    const lcpImageSrc = lcpResult.result.value as string | null;

    // Mark LCP image
    if (lcpImageSrc) {
      const lcpImg = domImages.find(img => img.src === lcpImageSrc || img.currentSrc === lcpImageSrc);
      if (lcpImg) {
        lcpImg.isLCP = true;
      }
    }

    // Scroll to trigger lazy loading and capture more images
    await client.Runtime.evaluate({
      expression: `window.scrollTo(0, document.body.scrollHeight / 2);`,
    });
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Calculate lazy loading analysis
    const lazyLoadAnalysis = analyzeLazyLoading(domImages);

    // Calculate size analysis
    const sizeAnalysis = analyzeImageSizes(images, domImages);

    // Calculate network image summary
    const summary = calculateSummary(images);
    const analysis = generateAnalysis(summary, lazyLoadAnalysis, sizeAnalysis);

    let savedTo: string | undefined;
    if (saveToFile) {
      const runDir = createRunDir(extractDomain(url));
      savedTo = saveJson(runDir, 'images.json', {
        url,
        summary,
        sizeAnalysis,
        lazyLoadAnalysis,
        analysis,
        images: images.slice(0, 100),
        domImages: domImages.slice(0, 100),
      });
    }

    return {
      url,
      images,
      domImages,
      lazyLoadAnalysis,
      sizeAnalysis,
      summary,
      analysis,
      warnings,
      savedTo,
    };
  } finally {
    await connection.close();
  }
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Analyze image sizes
 */
function analyzeImageSizes(
  images: ImageInfo[],
  domImages: DOMImageInfo[]
): ImageSizeAnalysis {
  // Create a map from URL to size from network images
  const sizeMap = new Map<string, number>();
  images.forEach(img => {
    sizeMap.set(img.url, img.size);
  });

  // Calculate totals
  let totalBytes = 0;
  let aboveTheFoldBytes = 0;
  let belowTheFoldBytes = 0;
  let lazyLoadedBytes = 0;
  let eagerBytes = 0;
  let largestImageUrl = '';
  let largestImageSize = 0;

  // Sum up network image sizes
  images.forEach(img => {
    totalBytes += img.size;
    if (img.size > largestImageSize) {
      largestImageUrl = img.url;
      largestImageSize = img.size;
    }
  });

  // Correlate DOM images with network sizes for ATF/BTF analysis
  domImages.forEach(domImg => {
    // Try to find matching network image
    const size = sizeMap.get(domImg.src) || sizeMap.get(domImg.currentSrc) || 0;

    if (domImg.isAboveTheFold && domImg.isVisible) {
      aboveTheFoldBytes += size;
    } else if (domImg.isVisible) {
      belowTheFoldBytes += size;
    }

    if (domImg.isLazyLoaded) {
      lazyLoadedBytes += size;
    } else {
      eagerBytes += size;
    }
  });

  const averageImageSize = images.length > 0 ? Math.round(totalBytes / images.length) : 0;

  return {
    totalBytes,
    totalFormatted: formatBytes(totalBytes),
    aboveTheFoldBytes,
    aboveTheFoldFormatted: formatBytes(aboveTheFoldBytes),
    belowTheFoldBytes,
    belowTheFoldFormatted: formatBytes(belowTheFoldBytes),
    lazyLoadedBytes,
    lazyLoadedFormatted: formatBytes(lazyLoadedBytes),
    eagerBytes,
    eagerFormatted: formatBytes(eagerBytes),
    averageImageSize,
    averageFormatted: formatBytes(averageImageSize),
    largestImage: largestImageSize > 0 ? {
      url: largestImageUrl,
      size: largestImageSize,
      formatted: formatBytes(largestImageSize),
    } : null,
  };
}

function analyzeLazyLoading(domImages: DOMImageInfo[]): LazyLoadAnalysis {
  const visibleImages = domImages.filter(img => img.isVisible);
  const lazyLoadedImages = visibleImages.filter(img => img.isLazyLoaded);
  const aboveTheFoldImages = visibleImages.filter(img => img.isAboveTheFold);
  const aboveTheFoldLazyLoaded = aboveTheFoldImages.filter(img => img.isLazyLoaded);

  // Count lazy load methods
  const lazyLoadMethods: Record<string, number> = {};
  lazyLoadedImages.forEach(img => {
    const method = img.lazyLoadMethod || 'unknown';
    lazyLoadMethods[method] = (lazyLoadMethods[method] || 0) + 1;
  });

  // Find LCP image
  const lcpImage = domImages.find(img => img.isLCP) || null;
  const lcpImageIsLazy = lcpImage?.isLazyLoaded || false;

  // Native vs JS lazy loading
  const nativeLazyCount = visibleImages.filter(img => img.loading === 'lazy').length;
  const jsLazyCount = lazyLoadedImages.length - nativeLazyCount;
  const eagerCount = visibleImages.filter(img => img.loading === 'eager').length;

  // Generate recommendation
  let recommendation = '';

  if (aboveTheFoldLazyLoaded.length > 0) {
    recommendation = `WARNING: ${aboveTheFoldLazyLoaded.length} above-the-fold image(s) have lazy loading. `;
    recommendation += 'This delays LCP and hurts Core Web Vitals. ';
    recommendation += 'Remove lazy loading from hero images and other above-the-fold content.';
  } else if (aboveTheFoldImages.length > 0) {
    recommendation = 'Good: Above-the-fold images are not lazy loaded. ';
    if (lazyLoadedImages.length > 0) {
      recommendation += `${lazyLoadedImages.length} below-the-fold images use lazy loading, which is correct.`;
    }
  } else {
    recommendation = 'No significant above-the-fold images detected.';
  }

  if (lcpImageIsLazy) {
    recommendation += ' CRITICAL: The likely LCP image is lazy loaded - this severely impacts LCP score!';
  }

  return {
    totalImages: visibleImages.length,
    lazyLoadedCount: lazyLoadedImages.length,
    nativeLazyCount,
    jsLazyCount,
    eagerCount,
    aboveTheFoldImages,
    aboveTheFoldLazyLoaded,
    lazyLoadMethods,
    lcpImage,
    lcpImageIsLazy,
    recommendation,
  };
}

function detectImageFormat(contentType: string | null, url: string): ImageInfo['format'] {
  if (contentType) {
    const ct = contentType.toLowerCase();
    if (ct.includes('webp')) return 'webp';
    if (ct.includes('avif')) return 'avif';
    if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpeg';
    if (ct.includes('png')) return 'png';
    if (ct.includes('gif')) return 'gif';
    if (ct.includes('svg')) return 'svg';
  }

  // Fallback to URL extension
  const urlLower = url.toLowerCase();
  if (urlLower.includes('.webp')) return 'webp';
  if (urlLower.includes('.avif')) return 'avif';
  if (urlLower.includes('.jpg') || urlLower.includes('.jpeg')) return 'jpeg';
  if (urlLower.includes('.png')) return 'png';
  if (urlLower.includes('.gif')) return 'gif';
  if (urlLower.includes('.svg')) return 'svg';

  return 'unknown';
}

function detectImageCDN(url: string, headers: Record<string, string>): { fromCDN: boolean; provider: string | null } {
  const urlLower = url.toLowerCase();

  // Check URL patterns
  if (urlLower.includes('cloudinary.com')) return { fromCDN: true, provider: 'Cloudinary' };
  if (urlLower.includes('imgix.net')) return { fromCDN: true, provider: 'imgix' };
  if (urlLower.includes('fastly.net')) return { fromCDN: true, provider: 'Fastly' };
  if (urlLower.includes('akamaihd.net')) return { fromCDN: true, provider: 'Akamai' };
  if (urlLower.includes('cloudfront.net')) return { fromCDN: true, provider: 'CloudFront' };
  if (urlLower.includes('scene7.com')) return { fromCDN: true, provider: 'Scene7' };
  if (urlLower.includes('optimole.com')) return { fromCDN: true, provider: 'Optimole' };
  if (urlLower.includes('sirv.com')) return { fromCDN: true, provider: 'Sirv' };
  if (urlLower.includes('twimg.com')) return { fromCDN: true, provider: 'Twitter CDN' };
  if (urlLower.includes('fbcdn.net')) return { fromCDN: true, provider: 'Facebook CDN' };

  // Check headers
  if (headers['cf-ray']) return { fromCDN: true, provider: 'Cloudflare' };
  if (headers['x-served-by']?.includes('cache-')) return { fromCDN: true, provider: 'Fastly' };
  if (headers['x-amz-cf-id']) return { fromCDN: true, provider: 'CloudFront' };

  return { fromCDN: false, provider: null };
}

function calculateSummary(images: ImageInfo[]): CheckImagesResult['summary'] {
  const total = images.length;
  const webp = images.filter(i => i.format === 'webp').length;
  const avif = images.filter(i => i.format === 'avif').length;
  const jpeg = images.filter(i => i.format === 'jpeg').length;
  const png = images.filter(i => i.format === 'png').length;
  const gif = images.filter(i => i.format === 'gif').length;
  const svg = images.filter(i => i.format === 'svg').length;
  const other = images.filter(i => i.format === 'unknown').length;
  const fromCDN = images.filter(i => i.fromCDN).length;

  const optimized = webp + avif;
  const optimizedPercentage = total > 0 ? Math.round((optimized / total) * 100) : 0;

  return {
    total,
    webp,
    avif,
    jpeg,
    png,
    gif,
    svg,
    other,
    optimizedPercentage,
    fromCDN,
  };
}

function generateAnalysis(
  summary: CheckImagesResult['summary'],
  lazyLoad: LazyLoadAnalysis,
  sizeAnalysis: ImageSizeAnalysis
): string {
  const parts: string[] = [];

  if (summary.total === 0) {
    return 'No images detected on the page.';
  }

  parts.push(`Found ${summary.total} images (${sizeAnalysis.totalFormatted} total).`);

  if (summary.optimizedPercentage >= 80) {
    parts.push(`Excellent image optimization: ${summary.optimizedPercentage}% use modern formats (WebP/AVIF).`);
  } else if (summary.optimizedPercentage >= 50) {
    parts.push(`Moderate image optimization: ${summary.optimizedPercentage}% use modern formats. Room for improvement.`);
  } else if (summary.optimizedPercentage > 0) {
    parts.push(`Limited image optimization: Only ${summary.optimizedPercentage}% use modern formats.`);
  } else {
    parts.push('No modern image formats (WebP/AVIF) detected. Consider optimizing images.');
  }

  if (summary.fromCDN > 0) {
    parts.push(`${summary.fromCDN} images served from CDN.`);
  }

  // Add size analysis
  if (sizeAnalysis.totalBytes > 2 * 1024 * 1024) {
    parts.push(`WARNING: High image payload (${sizeAnalysis.totalFormatted}).`);
  }

  // Add lazy loading analysis
  if (lazyLoad.aboveTheFoldLazyLoaded.length > 0) {
    parts.push(`WARNING: ${lazyLoad.aboveTheFoldLazyLoaded.length} above-the-fold images are lazy loaded!`);
  }

  if (lazyLoad.lcpImageIsLazy) {
    parts.push('CRITICAL: LCP image is lazy loaded - severely impacts performance!');
  }

  return parts.join(' ');
}

/**
 * CLI handler for check-images command
 */
export async function handleCheckImagesCommand(url: string, options: {
  device?: string;
  save?: boolean;
}): Promise<void> {
  const result = await checkImages({
    url,
    device: (options.device as DeviceType) || 'desktop',
    saveToFile: options.save,
  });

  console.log('\n=== Image Optimization Check ===');
  console.log(`URL: ${result.url}`);

  console.log('\n--- Size Analysis ---');
  console.log(`Total Image Payload: ${result.sizeAnalysis.totalFormatted}`);
  console.log(`  Above-the-fold: ${result.sizeAnalysis.aboveTheFoldFormatted}`);
  console.log(`  Below-the-fold: ${result.sizeAnalysis.belowTheFoldFormatted}`);
  console.log(`  Eager loaded: ${result.sizeAnalysis.eagerFormatted}`);
  console.log(`  Lazy loaded: ${result.sizeAnalysis.lazyLoadedFormatted}`);
  console.log(`Average Image Size: ${result.sizeAnalysis.averageFormatted}`);
  if (result.sizeAnalysis.largestImage) {
    console.log(`Largest Image: ${result.sizeAnalysis.largestImage.formatted}`);
    console.log(`  ${result.sizeAnalysis.largestImage.url.substring(0, 70)}...`);
  }

  console.log('\n--- Format Summary ---');
  console.log(`Total Images: ${result.summary.total}`);
  console.log(`WebP: ${result.summary.webp}`);
  console.log(`AVIF: ${result.summary.avif}`);
  console.log(`JPEG: ${result.summary.jpeg}`);
  console.log(`PNG: ${result.summary.png}`);
  console.log(`GIF: ${result.summary.gif}`);
  console.log(`SVG: ${result.summary.svg}`);
  console.log(`Other: ${result.summary.other}`);
  console.log(`\nOptimized (WebP/AVIF): ${result.summary.optimizedPercentage}%`);
  console.log(`From CDN: ${result.summary.fromCDN}`);

  console.log('\n--- Lazy Loading Analysis ---');
  console.log(`Total Visible Images: ${result.lazyLoadAnalysis.totalImages}`);
  console.log(`Lazy Loaded: ${result.lazyLoadAnalysis.lazyLoadedCount}`);
  console.log(`  - Native (loading="lazy"): ${result.lazyLoadAnalysis.nativeLazyCount}`);
  console.log(`  - JavaScript-based: ${result.lazyLoadAnalysis.jsLazyCount}`);
  console.log(`Eager (loading="eager"): ${result.lazyLoadAnalysis.eagerCount}`);

  if (Object.keys(result.lazyLoadAnalysis.lazyLoadMethods).length > 0) {
    console.log('\nLazy Load Methods:');
    Object.entries(result.lazyLoadAnalysis.lazyLoadMethods).forEach(([method, count]) => {
      console.log(`  - ${method}: ${count}`);
    });
  }

  console.log('\n--- Above-the-Fold Images ---');
  console.log(`Total ATF Images: ${result.lazyLoadAnalysis.aboveTheFoldImages.length}`);
  console.log(`ATF Images with Lazy Loading: ${result.lazyLoadAnalysis.aboveTheFoldLazyLoaded.length}`);

  if (result.lazyLoadAnalysis.aboveTheFoldLazyLoaded.length > 0) {
    console.log('\n⚠️  PROBLEM: Above-the-fold images with lazy loading:');
    result.lazyLoadAnalysis.aboveTheFoldLazyLoaded.slice(0, 5).forEach(img => {
      console.log(`  - ${img.src.substring(0, 70)}...`);
      console.log(`    Method: ${img.lazyLoadMethod}, Position: top=${img.rect.top}px`);
    });
  }

  if (result.lazyLoadAnalysis.lcpImage) {
    console.log('\n--- LCP Image (Likely) ---');
    const lcp = result.lazyLoadAnalysis.lcpImage;
    console.log(`URL: ${lcp.src.substring(0, 80)}...`);
    console.log(`Size: ${lcp.displayWidth}x${lcp.displayHeight}px`);
    console.log(`Lazy Loaded: ${lcp.isLazyLoaded ? 'YES ⚠️' : 'NO ✓'}`);
    if (lcp.isLazyLoaded) {
      console.log(`Lazy Method: ${lcp.lazyLoadMethod}`);
    }
    console.log(`fetchpriority: ${lcp.fetchPriority || 'not set'}`);
  }

  console.log('\n--- Recommendation ---');
  console.log(result.lazyLoadAnalysis.recommendation);

  console.log('\n--- Analysis ---');
  console.log(result.analysis);

  console.log('\n--- Sample Images ---');
  result.images.slice(0, 10).forEach(img => {
    const size = img.size > 1024 ? `${(img.size / 1024).toFixed(1)}KB` : `${img.size}B`;
    console.log(`  [${img.format.toUpperCase()}] ${size} - ${img.url.substring(0, 60)}...`);
    if (img.fromCDN) console.log(`    CDN: ${img.cdnProvider}`);
  });

  if (result.images.length > 10) {
    console.log(`  ... and ${result.images.length - 10} more images`);
  }

  if (result.savedTo) {
    console.log(`\nSaved to: ${result.savedTo}`);
  }
}
