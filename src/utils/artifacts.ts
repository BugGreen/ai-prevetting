import * as fs from 'fs';
import * as path from 'path';

const OUTPUT_DIR = path.join(process.cwd(), 'output');

/**
 * Ensure output directory exists
 */
export function ensureOutputDir(): string {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  return OUTPUT_DIR;
}

/**
 * Create a timestamped subdirectory for a run
 */
export function createRunDir(siteName: string): string {
  ensureOutputDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sanitizedName = siteName.replace(/[^a-zA-Z0-9-]/g, '_');
  const runDir = path.join(OUTPUT_DIR, `${sanitizedName}_${timestamp}`);
  fs.mkdirSync(runDir, { recursive: true });
  return runDir;
}

/**
 * Save HTML content to file
 */
export function saveHtml(dir: string, filename: string, content: string): string {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Save JSON data to file
 */
export function saveJson(dir: string, filename: string, data: unknown): string {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return filePath;
}

/**
 * Save text content to file
 */
export function saveText(dir: string, filename: string, content: string): string {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Save screenshot (base64 encoded)
 */
export function saveScreenshot(dir: string, filename: string, base64Data: string): string {
  const filePath = path.join(dir, filename);
  const buffer = Buffer.from(base64Data, 'base64');
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

/**
 * Extract domain name from URL for folder naming
 */
export function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch {
    return 'unknown';
  }
}

/**
 * Get the output directory path
 */
export function getOutputDir(): string {
  return OUTPUT_DIR;
}

/**
 * Extract URL from Step 1 report content
 * Looks for common patterns like "Website:", "URL:", or standalone URLs
 */
export function extractUrlFromReport(content: string): string | null {
  // Pattern 1: **Website:** or **URL:** in markdown
  const markdownPattern = /\*\*(?:Website|URL|Target):\*\*\s*<?([^\s<>\n]+)>?/i;
  let match = content.match(markdownPattern);
  if (match) {
    return normalizeUrl(match[1]);
  }

  // Pattern 2: Website: or URL: without markdown
  const plainPattern = /(?:Website|URL|Target):\s*<?([^\s<>\n]+)>?/i;
  match = content.match(plainPattern);
  if (match) {
    return normalizeUrl(match[1]);
  }

  // Pattern 3: Table format | Website | value | (handles optional **bold** around key)
  const tablePattern = /\|\s*\*{0,2}(?:Website|URL|Target)\*{0,2}\s*\|\s*<?([^\s|<>\n]+)>?\s*\|/i;
  match = content.match(tablePattern);
  if (match) {
    return normalizeUrl(match[1]);
  }

  // Pattern 4: First line starting with # that contains a domain (supports multi-part TLDs like genius.tv)
  const headerPattern = /^#.*?([a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z]{2,})+)/m;
  match = content.match(headerPattern);
  if (match) {
    return normalizeUrl(match[1]);
  }

  // Pattern 5: Any https URL in the first 500 chars
  const urlPattern = /(https?:\/\/[^\s<>"]+)/i;
  match = content.substring(0, 500).match(urlPattern);
  if (match) {
    return match[1];
  }

  return null;
}

/**
 * Normalize URL (add https:// if missing)
 */
function normalizeUrl(url: string): string {
  url = url.trim();
  // Remove trailing punctuation
  url = url.replace(/[,;.]+$/, '');

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`;
  }
  return url;
}

/**
 * Read report content from file or return input if already content
 */
export function readReportContent(input: string): string {
  // Check if input is a file path
  if (fs.existsSync(input)) {
    return fs.readFileSync(input, 'utf-8');
  }
  // Otherwise treat as direct content
  return input;
}

/**
 * Parsed Step 1 Report structure
 */
export interface Step1ParsedReport {
  url: string;
  domain: string;
  summaryTable: Record<string, string>;  // Category → Finding
  pageTypes: Array<{ name: string; urlPattern: string }>;
  techStack: Record<string, string>;
  cruxData?: { mobile: Record<string, string>; desktop: Record<string, string> };
  rawContent: string;
  thirdPartyDomains?: import('../commands/discover-phase1/third-party').ThirdPartyResult;
  languages?: import('../commands/discover-phase1/languages').LanguageResult;
  queryParams?: import('../commands/discover-phase1/query-params').QueryParamResult;
  serviceWorkers?: import('../commands/discover-phase1/service-workers').ServiceWorkerResult;
  dataLayer?: import('../commands/discover-phase1/data-layer').DataLayerResult;
  filterSelector?: string | null;
}

/**
 * Parse Step 1 report content into structured data
 */
export function parseStep1Report(content: string): Step1ParsedReport {
  const result: Step1ParsedReport = {
    url: '',
    domain: '',
    summaryTable: {},
    pageTypes: [],
    techStack: {},
    rawContent: content,
  };

  // Extract URL
  const extractedUrl = extractUrlFromReport(content);
  if (extractedUrl) {
    result.url = extractedUrl;
    result.domain = extractDomain(extractedUrl);
  }

  // Parse Summary Table (look for tables with Category/Finding columns)
  const summaryTableRegex = /\|\s*Category\s*\|.*?\n\|[-|\s]+\n([\s\S]*?)(?=\n\n|\n##|\n#|$)/i;
  const summaryMatch = content.match(summaryTableRegex);
  if (summaryMatch) {
    const tableContent = summaryMatch[1];
    const rows = tableContent.split('\n').filter(line => line.trim().startsWith('|'));
    for (const row of rows) {
      const cells = row.split('|').map(c => c.trim()).filter(c => c.length > 0);
      if (cells.length >= 2) {
        const category = cells[0].replace(/\*\*/g, '').trim();
        const finding = cells[1].replace(/\*\*/g, '').trim();
        if (category && finding) {
          result.summaryTable[category] = finding;
        }
      }
    }
  }

  // Alternative: Parse key-value style findings
  const findingPatterns = [
    { key: 'SSR', patterns: [/SSR[:\s]+([^\n]+)/i, /Server-Side Rendering[:\s]+([^\n]+)/i] },
    { key: 'Navigation', patterns: [/Navigation[:\s]+([^\n]+)/i, /Soft Navigation[:\s]+([^\n]+)/i] },
    { key: 'Images', patterns: [/Image[s]?\s*Optimization[:\s]+([^\n]+)/i, /WebP[:\s]+([^\n]+)/i] },
    { key: 'CSP', patterns: [/CSP[:\s]+([^\n]+)/i, /Content.?Security.?Policy[:\s]+([^\n]+)/i] },
    { key: 'CDN', patterns: [/CDN[:\s]+([^\n]+)/i] },
    { key: 'Mobile/Desktop', patterns: [/Mobile.*Desktop[:\s]+([^\n]+)/i, /Responsive[:\s]+([^\n]+)/i] },
  ];

  for (const { key, patterns } of findingPatterns) {
    if (!result.summaryTable[key]) {
      for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match) {
          result.summaryTable[key] = match[1].trim();
          break;
        }
      }
    }
  }

  // Parse Page Types section
  const pageTypesRegex = /Page\s*Types?\s*(?:Found)?[\s\S]*?\n((?:\s*[-*]\s*.+\n?)+)/i;
  const pageTypesMatch = content.match(pageTypesRegex);
  if (pageTypesMatch) {
    const lines = pageTypesMatch[1].split('\n');
    for (const line of lines) {
      const itemMatch = line.match(/[-*]\s*\*?\*?([^:*]+)\*?\*?:\s*(.+)/);
      if (itemMatch) {
        result.pageTypes.push({
          name: itemMatch[1].trim(),
          urlPattern: itemMatch[2].trim(),
        });
      }
    }
  }

  // Parse table format for page types
  const pageTypesTableRegex = /\|\s*(?:Page\s*)?Type\s*\|.*?URL.*?\n\|[-|\s]+\n([\s\S]*?)(?=\n\n|\n##|\n#|$)/i;
  const pageTypesTableMatch = content.match(pageTypesTableRegex);
  if (pageTypesTableMatch && result.pageTypes.length === 0) {
    const tableContent = pageTypesTableMatch[1];
    const rows = tableContent.split('\n').filter(line => line.trim().startsWith('|'));
    for (const row of rows) {
      const cells = row.split('|').map(c => c.trim()).filter(c => c.length > 0);
      if (cells.length >= 2) {
        result.pageTypes.push({
          name: cells[0].replace(/\*\*/g, '').replace(/`/g, '').trim(),
          urlPattern: cells[1].replace(/\*\*/g, '').replace(/`/g, '').trim(),
        });
      }
    }
  }

  // Parse Tech Stack
  const techStackRegex = /Tech(?:nology)?\s*Stack[\s\S]*?\n((?:\s*[-*]\s*.+\n?)+)/i;
  const techStackMatch = content.match(techStackRegex);
  if (techStackMatch) {
    const lines = techStackMatch[1].split('\n');
    for (const line of lines) {
      const itemMatch = line.match(/[-*]\s*\*?\*?([^:*]+)\*?\*?:\s*(.+)/);
      if (itemMatch) {
        result.techStack[itemMatch[1].trim()] = itemMatch[2].trim();
      }
    }
  }

  // Parse CrUX data if present
  const cruxRegex = /CrUX[\s\S]*?\|\s*Metric\s*\|.*?Mobile.*?\|.*?Desktop.*?\|\n\|[-|\s]+\n([\s\S]*?)(?=\n\n|\n##|\n#|$)/i;
  const cruxMatch = content.match(cruxRegex);
  if (cruxMatch) {
    result.cruxData = { mobile: {}, desktop: {} };
    const rows = cruxMatch[1].split('\n').filter(line => line.trim().startsWith('|'));
    for (const row of rows) {
      const cells = row.split('|').map(c => c.trim()).filter(c => c.length > 0);
      if (cells.length >= 3) {
        const metric = cells[0].replace(/\*\*/g, '').trim();
        result.cruxData.mobile[metric] = cells[1].trim();
        result.cruxData.desktop[metric] = cells[2].trim();
      }
    }
  }

  return result;
}

/**
 * Find the most recent output directory
 */
export function findLatestOutputDir(): string | undefined {
  const outputBase = path.join(process.cwd(), 'output');

  if (!fs.existsSync(outputBase)) {
    return undefined;
  }

  const dirs = fs.readdirSync(outputBase)
    .map(name => ({
      name,
      path: path.join(outputBase, name),
      stat: fs.statSync(path.join(outputBase, name)),
    }))
    .filter(d => d.stat.isDirectory())
    .sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime());

  return dirs.length > 0 ? dirs[0].path : undefined;
}
