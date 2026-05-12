# Claude Instructions

## Language

All project artifacts must be in English: code, comments, documentation, commit messages.

## Workflow

- Before critical changes (refactoring, major rewrites): **commit first** to enable rollback
- Test new features before marking them complete
- Run CLI commands via `npx ts-node src/cli.ts <command>`

## Project

CDP-based toolkit for Speed Kit Pre-Vetting. Connects to Chrome on port 9222.

---

## Architecture

### Project Structure

```
src/
├── cli.ts                 # Main CLI entry point
├── cdp/
│   └── connection.ts      # Chrome DevTools Protocol connection
├── commands/
│   ├── index.ts           # Command exports
│   ├── full-check.ts      # Main pre-vetting command (parallel checks)
│   ├── execution-report.ts # CC session report generator
│   ├── get-raw-html.ts    # Fetch raw HTML
│   ├── compare-mobile-desktop.ts
│   ├── check-ssr.ts       # SSR/CSR detection
│   ├── check-images.ts    # Image optimization analysis
│   ├── check-navigation.ts
│   ├── check-filters.ts   # PLP filter detection
│   ├── get-headers.ts     # Response headers
│   ├── run-wpt.ts         # WebPageTest integration
│   └── discover-phase1/   # Phase 1 autonomous discovery (feature directory)
│       ├── index.ts       # Public barrel — all consumers import from here
│       ├── bot-wall.ts    # detectBotWall + BOT_DETECTORS registry
│       ├── modals.ts      # dismissBlockingModals + BLOCKING_MODAL_REGISTRY
│       └── ...            # One file per future Phase 1 function
└── utils/
    ├── artifacts.ts       # File saving utilities
    └── diff.ts            # HTML diff utilities
```

### Phase 1 Discovery Module Convention

Every Phase 1 function lives in its own file under `src/commands/discover-phase1/`.
Static registry data (pattern arrays, selector lists) and the execution logic that
consumes it are **co-located in the same file** — the registry is an internal
implementation detail of the function, not a shared configuration resource.

```
src/commands/discover-phase1/
├── index.ts        ← ONLY file consumers import from; re-exports everything
├── bot-wall.ts     ← BOT_DETECTORS registry + detectBotWall()
├── modals.ts       ← BLOCKING_MODAL_REGISTRY + dismissBlockingModals()
├── <next>.ts       ← Add one file per new Phase 1 function here
```

**Rule:** When adding a new Phase 1 module, create a new `.ts` file in this directory
with its registry and function co-located, then add the re-export to `index.ts`.
Do not create a top-level `src/config/` or `src/utils/discovery/` for these.

### Key Interfaces

```typescript
// Execution metrics tracked by full-check
interface ExecutionMetrics {
  startTime: string;
  endTime: string;
  totalDurationMs: number;
  checks: {
    htmlComparison: CheckTiming;
    ssrCheck: CheckTiming;
    imageCheck: CheckTiming;
    headerCheck: CheckTiming;
    wpt: CheckTiming | null;
  };
  errors: ExecutionError[];
  warnings: string[];
}

interface CheckTiming {
  name: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
}
```

### Data Flow

1. **full-check** runs all checks in parallel
2. Saves `report.md` (website analysis) and `execution-metrics.json` (timing data)
3. **execution-report** reads metrics + user-provided observations
4. Generates `execution-report.md` (CC session documentation)

---

## Pre-Vetting Workflow

### Quick Start

```bash
# 1. Start Chrome with remote debugging (normal Chrome can stay open)
npx ts-node src/cli.ts start-chrome

# 2. Run full check (all tests in parallel)
npx ts-node src/cli.ts full-check <url> -s

# 3. After session, generate execution report
npx ts-node src/cli.ts execution-report --input-tokens 50000 --output-tokens 15000
```

> **Note:** The debug Chrome uses a separate profile (`~/.chrome-debug-profile`), so your normal Chrome can continue running.

### Full Check Command

Runs all checks in parallel and generates a consolidated Markdown report:

```bash
# Option 1: Pass URL directly
npx ts-node src/cli.ts full-check <url> [options]

# Option 2: Extract URL from Step 1 report file
npx ts-node src/cli.ts full-check --report <file.md> [options]

Options:
  -r, --report <file>  Extract URL from Step 1 report file
  -m, --mobile         Test mobile instead of desktop
  --skip-wpt           Skip WebPageTest
  --wpt-key <key>      WPT API key (overrides .env)
  -s, --save           Save report to output folder
```

**URL Extraction** from report supports these formats:
- `**Website:** example.com`
- `**URL:** https://example.com`
- `| Website | example.com |` (table format)
- First https:// URL in document

**Checks performed:**
- Mobile/Desktop HTML comparison
- SSR detection
- Image optimization & lazy loading analysis
- Response headers (CDN, CSP, caching)
- WebPageTest (optional)

**Console output includes:**
- Summary of findings
- Execution metrics (duration per check)
- Warnings (e.g., WPT skipped)

### Individual Commands

| Command | Description |
|---------|-------------|
| `start-chrome` | Start Chrome with remote debugging |
| `targets` | List available CDP targets |
| `raw-html <url>` | Fetch raw HTML |
| `compare-html <url>` | Compare mobile/desktop HTML |
| `check-ssr <url>` | Detect SSR vs CSR |
| `check-images <url>` | Analyze image optimization |
| `headers <url>` | Get response headers |
| `check-nav <from> <to>` | Check navigation type (hard/soft) |
| `check-filters <plp-url>` | Detect filter type (URL/session) |
| `run-wpt <url>` | Run WebPageTest |
| `wpt-results <testId>` | Get WPT results by ID |
| `execution-report` | Generate CC session execution report |

### Configuration

Create a `.env` file in the project root (copy from `.env.example`):

```bash
# WebPageTest API Key
# Get your key at: https://www.webpagetest.org/getkey.php
WPT_API_KEY=your-key-here
```

Or pass via CLI: `--wpt-key your-key-here`

### Output Files

When using `-s` (save), `full-check` creates files in `output/<domain>_<timestamp>/`:

| File | Description |
|------|-------------|
| `report.md` | Main pre-vetting report (website analysis) |
| `execution-metrics.json` | CLI timing data (durations, errors, warnings) |
| `execution-report.md` | CC session report (created by `execution-report` command) |

---

## Execution Report

The execution report tracks the CC (Claude Code) session for quality assurance and process improvement.

### Purpose

- Document CLI performance (timing, errors)
- Track token usage and costs
- Capture learnings for prompt improvements
- Enable retrospective analysis of pre-vetting sessions

### Command

```bash
npx ts-node src/cli.ts execution-report [options]

Options:
  -d, --dir <path>              Output directory (default: latest)
  --input-tokens <n>            Estimated input tokens used
  --output-tokens <n>           Estimated output tokens used
  -w, --worked-well <items...>  What worked well
  -i, --improvements <items...> What could be improved
  -p, --prompt-suggestions <items...>  Prompt improvement suggestions
  --no-save                     Do not save report
  --print                       Print report to console
```

### Example Usage

```bash
# After full-check, generate execution report with observations
npx ts-node src/cli.ts execution-report \
  --input-tokens 50000 \
  --output-tokens 15000 \
  -w "Parallel checks ran efficiently" "SSR detection was accurate" \
  -i "WPT often times out" \
  -p "Add retry logic for WPT API"
```

### Report Contents

The generated `execution-report.md` includes:

1. **Overview**: Target URL, start/end time, total CLI duration
2. **CLI Check Timings**: Duration per check with status (success/failed/skipped)
3. **CLI Errors/Warnings**: Issues encountered during the run
4. **CC Session Notes**:
   - Token usage (estimated, with cost calculation based on Claude pricing)
   - Process observations (what worked well, what could be improved)
   - Prompt improvement suggestions for future runs

### Token Cost Estimation

The report calculates estimated costs based on Claude Sonnet pricing:
- Input: $3 per 1M tokens
- Output: $15 per 1M tokens

---

## Step 2 Workflow

When user provides a Step 1 report or says "full-check":

1. If Step 1 report is provided as file:
   ```bash
   npx ts-node src/cli.ts full-check --report step1-report.md -s
   ```
   URL will be automatically extracted from the report.

2. If URL is known directly:
   ```bash
   npx ts-node src/cli.ts full-check https://<domain> -s
   ```

3. Use `prompts/step2-prompt.md` for the Step 2 checklist
4. Combine Step 1 findings with Step 2 CDP-verified results
5. Generate final consolidated report

### Prompt Files

| File | Description |
|------|-------------|
| `prompts/prevetting.md` | Full checklist (Step 1 + Step 2 combined) |
| `prompts/step2-prompt.md` | Step 2 specific prompt (CDP verification) |

**Placeholders:**
- `{{WEBSITE}}` - Target domain (in prevetting.md)
- `{{URL}}` - Full URL (in step2-prompt.md)
