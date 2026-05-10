/**
 * Execution Report Generator
 * Creates a CC session report with CLI metrics and user-provided observations
 */

import * as fs from 'fs';
import * as path from 'path';
import { ExecutionMetrics } from './full-check';

export interface ExecutionReportOptions {
  outputDir?: string;
  inputTokens?: number;
  outputTokens?: number;
  workedWell?: string[];
  improvements?: string[];
  promptSuggestions?: string[];
  save?: boolean;
}

export interface ExecutionReportResult {
  report: string;
  savedTo?: string;
}

/**
 * Find the most recent output directory
 */
function findLatestOutputDir(): string | undefined {
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

/**
 * Load execution metrics from a directory
 */
function loadMetrics(dir: string): ExecutionMetrics | null {
  const metricsPath = path.join(dir, 'execution-metrics.json');

  if (!fs.existsSync(metricsPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(metricsPath, 'utf-8');
    return JSON.parse(content) as ExecutionMetrics;
  } catch {
    return null;
  }
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
 * Estimate cost based on token usage (Claude pricing)
 */
function estimateCost(inputTokens: number, outputTokens: number): string {
  // Claude Sonnet pricing (approximate)
  const inputCost = (inputTokens / 1000000) * 3;  // $3 per 1M input tokens
  const outputCost = (outputTokens / 1000000) * 15; // $15 per 1M output tokens
  const total = inputCost + outputCost;
  return `$${total.toFixed(4)}`;
}

/**
 * Generate the execution report
 */
export function generateExecutionReport(
  metrics: ExecutionMetrics,
  options: ExecutionReportOptions
): string {
  const lines: string[] = [];

  // Get URL from the report.md if available
  let targetUrl = 'Unknown';
  if (options.outputDir) {
    const reportPath = path.join(options.outputDir, 'report.md');
    if (fs.existsSync(reportPath)) {
      const reportContent = fs.readFileSync(reportPath, 'utf-8');
      const urlMatch = reportContent.match(/\*\*URL:\*\*\s*(.+)/);
      if (urlMatch) {
        targetUrl = urlMatch[1].trim();
      }
    }
  }

  lines.push('# Execution Report');
  lines.push('');
  lines.push('## Overview');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push(`| Target URL | ${targetUrl} |`);
  lines.push(`| Start Time | ${new Date(metrics.startTime).toLocaleString()} |`);
  lines.push(`| End Time | ${new Date(metrics.endTime).toLocaleString()} |`);
  lines.push(`| Total CLI Duration | ${formatDuration(metrics.totalDurationMs)} |`);
  lines.push('');

  // Check Timings
  lines.push('## CLI Check Timings');
  lines.push('');
  lines.push('| Check | Duration | Status |');
  lines.push('|-------|----------|--------|');

  const checkOrder = ['htmlComparison', 'ssrCheck', 'imageCheck', 'headerCheck', 'navigationCheck', 'wpt'] as const;
  for (const key of checkOrder) {
    const timing = metrics.checks[key as keyof typeof metrics.checks];
    if (timing) {
      const statusIcon = timing.status === 'success' ? '✅' : timing.status === 'failed' ? '❌' : '⏭️';
      lines.push(`| ${timing.name} | ${formatDuration(timing.durationMs)} | ${statusIcon} ${timing.status} |`);
    }
  }
  lines.push('');

  // Errors section
  if (metrics.errors.length > 0) {
    lines.push('## CLI Errors');
    lines.push('');
    metrics.errors.forEach(err => {
      lines.push(`- **${err.check}**: ${err.message}`);
    });
    lines.push('');
  }

  // Warnings section
  if (metrics.warnings.length > 0) {
    lines.push('## CLI Warnings');
    lines.push('');
    metrics.warnings.forEach(warn => {
      lines.push(`- ${warn}`);
    });
    lines.push('');
  }

  // CC Session Notes
  lines.push('## CC Session Notes');
  lines.push('');

  // Token Usage
  lines.push('### Token Usage');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');

  const inputTokens = options.inputTokens ?? 0;
  const outputTokens = options.outputTokens ?? 0;

  lines.push(`| Input Tokens | ${inputTokens > 0 ? inputTokens.toLocaleString() : '_not provided_'} |`);
  lines.push(`| Output Tokens | ${outputTokens > 0 ? outputTokens.toLocaleString() : '_not provided_'} |`);

  if (inputTokens > 0 && outputTokens > 0) {
    lines.push(`| Estimated Cost | ${estimateCost(inputTokens, outputTokens)} |`);
  } else {
    lines.push('| Estimated Cost | _not provided_ |');
  }
  lines.push('');

  // Process Observations
  lines.push('### Process Observations');
  lines.push('');

  lines.push('**What worked well:**');
  lines.push('');
  if (options.workedWell && options.workedWell.length > 0) {
    options.workedWell.forEach(item => {
      lines.push(`- ${item}`);
    });
  } else {
    lines.push('- _No observations provided_');
  }
  lines.push('');

  lines.push('**What could be improved:**');
  lines.push('');
  if (options.improvements && options.improvements.length > 0) {
    options.improvements.forEach(item => {
      lines.push(`- ${item}`);
    });
  } else {
    lines.push('- _No observations provided_');
  }
  lines.push('');

  // Prompt Improvements
  lines.push('### Prompt Improvement Suggestions');
  lines.push('');
  if (options.promptSuggestions && options.promptSuggestions.length > 0) {
    options.promptSuggestions.forEach(item => {
      lines.push(`- ${item}`);
    });
  } else {
    lines.push('- _No suggestions provided_');
  }
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('*Generated by prevetting-checker execution-report*');

  return lines.join('\n');
}

/**
 * Create execution report
 */
export async function createExecutionReport(options: ExecutionReportOptions): Promise<ExecutionReportResult> {
  // Find output directory
  let outputDir = options.outputDir;

  if (!outputDir) {
    outputDir = findLatestOutputDir();
    if (!outputDir) {
      throw new Error('No output directory found. Run full-check with -s first.');
    }
    console.log(`Using latest output directory: ${outputDir}`);
  }

  // Load metrics
  const metrics = loadMetrics(outputDir);
  if (!metrics) {
    throw new Error(`No execution-metrics.json found in ${outputDir}`);
  }

  // Generate report
  const report = generateExecutionReport(metrics, { ...options, outputDir });

  let savedTo: string | undefined;
  if (options.save !== false) {
    const reportPath = path.join(outputDir, 'execution-report.md');
    fs.writeFileSync(reportPath, report);
    savedTo = reportPath;
    console.log(`Execution report saved to: ${reportPath}`);
  }

  return { report, savedTo };
}

/**
 * CLI handler for execution-report command
 */
export async function handleExecutionReportCommand(options: {
  dir?: string;
  inputTokens?: string;
  outputTokens?: string;
  workedWell?: string[];
  improvements?: string[];
  promptSuggestions?: string[];
  noSave?: boolean;
  print?: boolean;
}): Promise<void> {
  try {
    const result = await createExecutionReport({
      outputDir: options.dir,
      inputTokens: options.inputTokens ? parseInt(options.inputTokens, 10) : undefined,
      outputTokens: options.outputTokens ? parseInt(options.outputTokens, 10) : undefined,
      workedWell: options.workedWell,
      improvements: options.improvements,
      promptSuggestions: options.promptSuggestions,
      save: !options.noSave,
    });

    if (options.print) {
      console.log('');
      console.log(result.report);
    }
  } catch (error) {
    console.error('Error:', (error as Error).message);
    process.exit(1);
  }
}
