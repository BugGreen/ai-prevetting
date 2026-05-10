import { diffLines, createTwoFilesPatch } from 'diff';

export interface DiffResult {
  hasDifferences: boolean;
  addedLines: number;
  removedLines: number;
  changedLines: number;
  summary: string;
  patch: string;
  structuralDiff: StructuralDiff;
}

export interface StructuralDiff {
  headDiff: boolean;
  bodyDiff: boolean;
  scriptDiff: boolean;
  styleDiff: boolean;
  metaDiff: boolean;
  linkDiff: boolean;
}

/**
 * Compare two HTML strings and generate a diff report
 */
export function compareHtml(html1: string, html2: string, label1: string = 'File 1', label2: string = 'File 2'): DiffResult {
  const changes = diffLines(html1, html2);

  let addedLines = 0;
  let removedLines = 0;

  changes.forEach(change => {
    const lineCount = (change.value.match(/\n/g) || []).length;
    if (change.added) {
      addedLines += lineCount;
    } else if (change.removed) {
      removedLines += lineCount;
    }
  });

  const changedLines = Math.max(addedLines, removedLines);
  const hasDifferences = addedLines > 0 || removedLines > 0;

  // Generate unified diff patch
  const patch = createTwoFilesPatch(label1, label2, html1, html2, '', '', { context: 3 });

  // Analyze structural differences
  const structuralDiff = analyzeStructuralDiff(html1, html2);

  const summary = generateSummary(addedLines, removedLines, structuralDiff);

  return {
    hasDifferences,
    addedLines,
    removedLines,
    changedLines,
    summary,
    patch,
    structuralDiff,
  };
}

/**
 * Analyze structural differences between two HTML documents
 */
function analyzeStructuralDiff(html1: string, html2: string): StructuralDiff {
  return {
    headDiff: extractSection(html1, 'head') !== extractSection(html2, 'head'),
    bodyDiff: extractSection(html1, 'body') !== extractSection(html2, 'body'),
    scriptDiff: extractAllTags(html1, 'script') !== extractAllTags(html2, 'script'),
    styleDiff: extractAllTags(html1, 'style') !== extractAllTags(html2, 'style'),
    metaDiff: extractAllTags(html1, 'meta') !== extractAllTags(html2, 'meta'),
    linkDiff: extractAllTags(html1, 'link') !== extractAllTags(html2, 'link'),
  };
}

/**
 * Extract a section from HTML (e.g., <head>...</head>)
 */
function extractSection(html: string, tagName: string): string {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i');
  const match = html.match(regex);
  return match ? match[1].trim() : '';
}

/**
 * Extract all occurrences of a tag
 */
function extractAllTags(html: string, tagName: string): string {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>|<${tagName}[^>]*/>`, 'gi');
  const matches = html.match(regex) || [];
  return matches.sort().join('\n');
}

/**
 * Generate a human-readable summary of differences
 */
function generateSummary(added: number, removed: number, structural: StructuralDiff): string {
  const parts: string[] = [];

  if (added === 0 && removed === 0) {
    return 'No differences found between the two HTML documents.';
  }

  parts.push(`Lines changed: +${added} / -${removed}`);

  const structuralChanges: string[] = [];
  if (structural.headDiff) structuralChanges.push('<head>');
  if (structural.bodyDiff) structuralChanges.push('<body>');
  if (structural.scriptDiff) structuralChanges.push('<script> tags');
  if (structural.styleDiff) structuralChanges.push('<style> tags');
  if (structural.metaDiff) structuralChanges.push('<meta> tags');
  if (structural.linkDiff) structuralChanges.push('<link> tags');

  if (structuralChanges.length > 0) {
    parts.push(`Structural changes in: ${structuralChanges.join(', ')}`);
  }

  return parts.join('\n');
}

/**
 * Extract and compare scripts between two HTML documents
 */
export function compareScripts(html1: string, html2: string): {
  onlyIn1: string[];
  onlyIn2: string[];
  common: string[];
} {
  const scripts1 = extractScriptSrcs(html1);
  const scripts2 = extractScriptSrcs(html2);

  const set1 = new Set(scripts1);
  const set2 = new Set(scripts2);

  return {
    onlyIn1: scripts1.filter(s => !set2.has(s)),
    onlyIn2: scripts2.filter(s => !set1.has(s)),
    common: scripts1.filter(s => set2.has(s)),
  };
}

/**
 * Extract script src attributes from HTML
 */
function extractScriptSrcs(html: string): string[] {
  const regex = /<script[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi;
  const srcs: string[] = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    srcs.push(match[1]);
  }
  return srcs;
}

/**
 * Highlight key differences in a condensed format
 */
export function generateCondensedDiff(html1: string, html2: string): string {
  const lines1 = html1.split('\n');
  const lines2 = html2.split('\n');

  const differences: string[] = [];
  const maxLines = Math.max(lines1.length, lines2.length);
  let diffCount = 0;
  const maxDiffs = 50; // Limit output

  for (let i = 0; i < maxLines && diffCount < maxDiffs; i++) {
    const line1 = lines1[i] || '';
    const line2 = lines2[i] || '';

    if (line1 !== line2) {
      diffCount++;
      if (line1 && !line2) {
        differences.push(`Line ${i + 1}: REMOVED: ${line1.substring(0, 100)}...`);
      } else if (!line1 && line2) {
        differences.push(`Line ${i + 1}: ADDED: ${line2.substring(0, 100)}...`);
      } else {
        differences.push(`Line ${i + 1}: CHANGED`);
        differences.push(`  - ${line1.substring(0, 80)}...`);
        differences.push(`  + ${line2.substring(0, 80)}...`);
      }
    }
  }

  if (diffCount >= maxDiffs) {
    differences.push(`... and more differences (truncated at ${maxDiffs})`);
  }

  return differences.join('\n');
}
