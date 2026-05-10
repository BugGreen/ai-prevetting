# Speed Kit Integration Pre-Vetting

**Website:** {{WEBSITE}}

**Step:** 2

---

The Pre-Vetting is done in a two step process: Step 1 is "initial check" with the following limitations:

## Technical Constraints

You are using the Claude Chrome Extension which can:

- ✅ Take screenshots and interact with UI (click cookie banners, navigate, etc.)
- ✅ See network requests (URL, Method, Status Code only)
- ✅ Execute arbitrary JavaScript in page context
- ✅ Read the rendered DOM and accessibility tree
- ❌ **Cannot** read raw HTML responses or response headers from navigation
- ❌ **Cannot** do device emulation (Mobile vs Desktop)
- ❌ **Cannot** read response bodies from Network tab

Workaround available:

- Use `curl` for raw HTML if bot protection allows

If curl is not blocked and the results are conclusive already, skip step 2 a do everything in step 1. Be clear in your summary whether step 2 should still be done.

Step 2 uses the prevetting-checker CLI toolkit which connects to Chrome via CDP on port 9222. Claude Code runs the toolkit commands via Bash (npx ts-node src/cli.ts <command>) to fetch raw HTML, compare mobile/desktop responses, check headers, detect navigation types, and verify SSR. It receives the Step 1 results as input context and produces a final report combining both the initial findings and the new CDP-verified results. Use the available toolkit for the checks, not just raw CDP access.

## Toolkit Commands

| Command | Description | Options |
|---------|-------------|---------|
| `start-chrome` | Start Chrome with remote debugging (port 9222) | `-u, --url <url>` |
| `targets` | List available CDP targets (browser tabs) | |
| `raw-html <url>` | Fetch raw HTML (bypassing ServiceWorker) | `-d, --device <desktop\|mobile\|mobileIPhone>`, `-s, --save` |
| `compare-html <url>` | Compare mobile vs desktop HTML | `--no-save` |
| `headers <url>` | Get response headers (CSP, cache-control, etc.) | `-d, --device`, `-s, --save` |
| `check-nav <start-url> <target-url>` | Check hard vs soft navigation | `-c, --click <selector>`, `-s, --save` |
| `check-images <url>` | Check image optimization, lazy loading, ATF/BTF, LCP | `-d, --device`, `-s, --save` |
| `check-ssr <url>` | Check if page uses SSR | `-d, --device`, `-s, --save` |
| `check-filters <url>` | Check if PLP filters are URL-based or session-based | `-d, --device`, `-c, --selector`, `-w, --wait <ms>`, `-s, --save` |
| `full-check <url>` | Run all checks in parallel, generate report | `-m, --mobile`, `-s, --save` |

---

## Checklist Step 2 (CDP Required)

These items require raw HTML access, response headers, or device emulation and must be verified via Chrome DevTools Protocol:

### Hard vs. Soft Navigations

- Does the site use Soft Navigations (and is it primarily an SPA)? Do not rely only on JS check, do navigations and look if an HTML was delivered or only API calls were made.

### SSR

- Is the site mostly client-rendered (i.e. white/broken without JavaScript)? Check raw HTML response, not only rendered DOM! Make no assumptions, check if the raw HTML contains some form of SSR content.

### Mobile vs Desktop HTML

- Does the server deliver different HTML for Mobile vs Desktop? (Proper device emulation/request with same headers, language etc. but different device type) - if they differ (e.g. other HTML tags for mobile) and should not be served for the other device type, Speed Kit needs to be configured for this through HTML cache variations
- Check Raw HTML via DevTools Protocol (bypass ServiceWorker)
- Diff the HTMLs and report/summarize what changes between the variation on HTML level

### Image Optimization

- Are images optimized (WebP, AVIF)? (check via response headers/content types)

### CSPs

- Are the HTMLs served with CSPs?

### Consent

- Are the scripts on HTML level (raw not parsed) different depending on whether consent was given?

### PLP Filters

- Are PLP filters set explicitly via URL parameters? (Beware if it is an SPA/soft navigation, then the check is different!)
- Or are filters stored implicitly in the session? (problematic for caching)

---

## Checklist Step 1

> Important: If Speed Kit is already active on the site, disable it by adding `?disableSpeedKit=1` in the beginning (stays persistent for session).

### Navigation & Rendering

- What SPA framework is used (React, Vue, Next.js, Nuxt, etc.)?
- Which SSR framework (if any) and rehydration method is used?

### A/B Testing Stack

- Client-side A/B testing tools (Optimizely, VWO, AB Tasty, Google Optimize, etc.)
- Server-side A/B testing (e.g. certain tags, markers, tools, data layer properties)
- Are there above-the-fold A/B tests?

### Personalization

- Is there above-the-fold personalization?
- Is the product listing (PLP) personalized? Client-side, server-side, both?
- What personalization/recommendation engine is used?

### Bot Protection

- What bot blocking tools are active (Akamai Bot Manager, DataDome, Cloudflare, PerimeterX, etc.)?
- Does bot protection interfere with testing?

### Performance (TTFB & CrUX)

- Check TTFB during navigation (is it slow?)
- Check CrUX data via https://cruxvis.withgoogle.com/#/?view=loadingperf&url=https%3A%2F%2F{{WEBSITE}}%2F&identifier=origin&device=PHONE&periodStart=0&periodEnd=-1&display=both
- Does the customer have a TTFB problem? (Speed Kit helps most here)
- What are the Core Web Vitals (LCP, INP, CLS)? Report both traffic light and p75. Report Mobile/Desktop/Overall. Name from when the data is.

### Page Types

- List all page types (Homepage, PLP, PDP, Search, Cart, Checkout, etc.)
- Navigate through each page type to validate findings

### Image Optimization

- What image optimization tool/CDN is used?
- Is there Lazy Loading?
- Define which "important" images (i.e. hero banners, product images, product tiles) should be checked in step 2 for image optimization.
- Is Lazy Loading applied to above-the-fold content?

### Tech Stack Summary

- E-commerce platform (Shopify, Magento, SFCC, Shopware, etc.)
- CDN provider (Cloudflare, Fastly, Akamai, etc.)
- Hosting provider
- Frontend framework
- RUM and APM tools
- Any other relevant technologies

### Speed Kit Status

- Is Speed Kit already installed? (If yes, disable with `?disableSpeedKit=1` for all tests)
- Is there any other ServiceWorker already active (e.g. Workbox)?

### Data Layer

- Which interesting things from the data layer should Speed Kit probably track (e.g. different user types, payment methods, active A/B tests etc.)
- Summary of things in the data layer

### Language/Domains

- Is the website available in different languages and currencies? Are they split by URL, e.g. /en /de or domain?
- Are there different sub- or sister-brands that are actually the same site and stack?

### Scope for Speed Kit

- Are there any parts that Speed Kit will probably not be good at accelerating apart from the usual cart/checkout/account pages, things like flight search or contract management

### CSPs

- Are the HTMLs served with CSPs?

### Consent

- Are the scripts on HTML level (raw not parsed) different depending on whether consent was given?

### App

- Check (e.g. using web search) if there is an app for the website and try to find out if it just a webview wrapper or a "real" native app.

### Speculation Rules

- Does the site already use Speculation Rules? (check for `<script type="speculationrules">` in DOM)

### Query Parameters

- Which tracking parameters are used during navigation? (utm_*, fbclid, gclid, etc. - observe URLs)

### Static 3rd Party Assets

- Which static 3rd-party domains are loaded? (fonts, libraries - for potential 3P acceleration)

---

## Output Format

### Summary Table

> Be precise but detailed and technical

| Category | Finding | Details |
|----------|---------|---------|
| SPA / Soft Navigation | Yes/No | Framework: ... |
| SSR | Yes/No | Method: ... |
| Mobile/Desktop HTML | Same/Different | Differences: ... |
| Image Optimization | WebP/AVIF/None | CDN: ... |
| CSP | Yes/No | Policy: ... |
| Bot Protection | Type | Impact: ... |
| ... | ... | ... |

### Page Types Found

- Homepage
- Category/PLP
- Product/PDP
- Search
- Cart
- ...

### Tech Stack

| Component | Value |
|-----------|-------|
| E-commerce Platform | ... |
| CDN | ... |
| Hosting | ... |
| Frontend Framework | ... |
| Personalization Engine | ... |
| Search Provider | ... |
| ... | ... |

### Key Findings for Speed Kit

1. ...
2. ...
3. ...

### Items That Could Not Be Determined

- ... (reason: bot protection / other)

---

## Instructions

1. Always click through ALL different page types to validate findings. Add items to cart or perform actions like search if needed.
2. Use Raw HTML (network response) not parsed DOM for Mobile/Desktop check
3. If something cannot be determined (e.g., due to bot protection), explicitly state this instead of guessing
4. Provide all results in English
5. Summarize in tables for easy review
6. Prefer being very technical and thorough over being fast (don't be afraid to take 30 mins or more)
7. You are allowed to store files locally if it helps, e.g. for diffing
