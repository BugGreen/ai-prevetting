# prevetting-checker

Speed Kit Pre-Vetting Step 2 Analysis Tool - CDP-based checks for verifying website characteristics that require raw HTML access, response headers, or device emulation.

## Prerequisites

- Node.js 18+
- Google Chrome installed

## Installation

```bash
npm install
```

## Usage

### 1. Start Chrome with Remote Debugging

```bash
npx ts-node src/cli.ts start-chrome
```

Or with a URL:

```bash
npx ts-node src/cli.ts start-chrome -u "https://example.com"
```

> **Note:** Chrome must be completely closed before running this command. Use Cmd+Q (Mac) or close all Chrome windows (Windows/Linux).

### 2. Run Analysis Commands

```bash
npx ts-node src/cli.ts <command> [options]
```

## Commands

| Command | Description |
|---------|-------------|
| `start-chrome` | Start Chrome with remote debugging enabled (port 9222) |
| `targets` | List available CDP targets (browser tabs) |
| `raw-html <url>` | Fetch raw HTML (bypassing ServiceWorker) |
| `compare-html <url>` | Compare mobile vs desktop HTML |
| `headers <url>` | Get response headers (CSP, cache-control, etc.) |
| `check-nav <start-url> <target-url>` | Check hard vs soft navigation |
| `check-images <url>` | Check image optimization (WebP, AVIF, CDN) |
| `check-ssr <url>` | Check if page uses SSR |
| `check-filters <url>` | Check if PLP filters are URL-based or session-based |

## Command Details

### start-chrome

Start Chrome with remote debugging enabled on port 9222.

```bash
npx ts-node src/cli.ts start-chrome [options]

Options:
  -u, --url <url>  URL to open on startup
```

### targets

List all available CDP targets (browser tabs).

```bash
npx ts-node src/cli.ts targets
```

### raw-html

Fetch raw HTML from a URL, bypassing any ServiceWorker.

```bash
npx ts-node src/cli.ts raw-html <url> [options]

Options:
  -d, --device <type>  Device type: desktop, mobile, mobileIPhone (default: "desktop")
  -s, --save           Save HTML to output folder
```

### compare-html

Compare raw HTML between mobile and desktop devices to detect server-side device detection.

```bash
npx ts-node src/cli.ts compare-html <url> [options]

Options:
  --no-save  Do not save artifacts
```

**Output includes:**
- HTML size comparison
- Line diff statistics
- Structural differences (head, body, scripts, styles)
- Scripts unique to each device type

### headers

Get response headers including CSP, cache-control, and security headers.

```bash
npx ts-node src/cli.ts headers <url> [options]

Options:
  -d, --device <type>  Device type: desktop, mobile (default: "desktop")
  -s, --save           Save headers to output folder
```

### check-nav

Check if navigation between two URLs is hard (full page load) or soft (SPA-style).

```bash
npx ts-node src/cli.ts check-nav <start-url> <target-url> [options]

Options:
  -c, --click <selector>  Click on element to trigger navigation instead of direct URL
  -s, --save              Save analysis to output folder
```

**Detects:**
- Document requests (hard navigation)
- History API usage (pushState/replaceState)
- XHR/Fetch requests only (soft navigation)

### check-images

Check image optimization including format detection and CDN usage.

```bash
npx ts-node src/cli.ts check-images <url> [options]

Options:
  -d, --device <type>  Device type: desktop, mobile (default: "desktop")
  -s, --save           Save analysis to output folder
```

**Reports:**
- Image format breakdown (WebP, AVIF, JPEG, PNG, SVG, GIF)
- Optimization percentage
- CDN detection

### check-ssr

Check if a page uses Server-Side Rendering by comparing raw HTML vs rendered DOM.

```bash
npx ts-node src/cli.ts check-ssr <url> [options]

Options:
  -d, --device <type>  Device type: desktop, mobile (default: "desktop")
  -s, --save           Save analysis to output folder
```

**Determines:**
- Full SSR (content in raw HTML)
- CSR only (empty body, JS-rendered)
- Hybrid (partial SSR with client hydration)

### check-filters

Check if PLP (Product Listing Page) filters are URL-based or session-based.

```bash
npx ts-node src/cli.ts check-filters <url> [options]

Options:
  -d, --device <type>        Device type: desktop, mobile (default: "desktop")
  -c, --selector <selector>  CSS selector for filter element to click
  -w, --wait <ms>            Wait time after filter click (default: "3000")
  -s, --save                 Save analysis to output folder
```

**Filter Types:**
- `url-based` - Filters reflected in URL (good for caching)
- `session-based` - Filters stored in session/cookies (problematic for caching)
- `hybrid` - Hash-based filtering

## Examples

### Full Pre-Vetting Workflow

```bash
# 1. Start Chrome
npx ts-node src/cli.ts start-chrome

# 2. Check SSR
npx ts-node src/cli.ts check-ssr "https://example.com" -s

# 3. Compare Mobile vs Desktop HTML
npx ts-node src/cli.ts compare-html "https://example.com"

# 4. Check navigation type
npx ts-node src/cli.ts check-nav "https://example.com" "https://example.com/category" -s

# 5. Check PLP filters
npx ts-node src/cli.ts check-filters "https://example.com/category" -s

# 6. Check image optimization
npx ts-node src/cli.ts check-images "https://example.com" -s

# 7. Check headers/CSP
npx ts-node src/cli.ts headers "https://example.com" -s
```

### Disable Speed Kit for Testing

If Speed Kit is already installed on the site, add `?disableSpeedKit=1` to URLs:

```bash
npx ts-node src/cli.ts check-ssr "https://example.com?disableSpeedKit=1" -s
```

## Output

Results are saved to the `output/` folder with timestamped directories:

```
output/
  example_com_2026-01-15T12-00-00-000Z/
    ssr-analysis.json
    headers.json
    images.json
    navigation-check.json
    filter-check.json
    desktop.html
    mobile.html
    diff.patch
    diff-condensed.txt
```

## Architecture

This tool connects directly to Chrome via the Chrome DevTools Protocol (CDP) using the `chrome-remote-interface` npm package.

```
┌─────────────────────────────┐
│   prevetting-checker CLI    │
│  (npx ts-node src/cli.ts)   │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  chrome-remote-interface    │
│         (npm)               │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│      Chrome Browser         │
│  --remote-debugging-port    │
│          =9222              │
└─────────────────────────────┘
```

## License

MIT
