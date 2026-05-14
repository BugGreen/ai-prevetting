# Speed Kit Pre-Vetting Report: fritz-berger.de

**Date:** 2026-05-14
**Steps Completed:** Autonomous (Phase 1 Discovery + Phase 2 CDP Verification)
**Analyst:** CLI Autonomous Pipeline
**URL:** https://www.fritz-berger.de
**Status:** Needs Further Review

---

## 1. Summary Table

| Category | Finding | Details |
|----------|---------|---------|
| **Navigation Type** | HARD | CDP-verified: Hard navigation detected via click (auto-discovered, exact). 2 document request(s) made. Full page reload occurred. |
| **SPA Framework** | Unknown | Phase 1 detection |
| **SSR Status** | YES | Raw HTML: 1,764,945 chars, text 62,523 chars (92% of rendered 67,811) |
| **Mobile vs Desktop HTML** | Not tested | HTML comparison failed |
| **Image Optimization** | 80% modern formats | 55 WebP, 0 AVIF out of 69 images |
| **CSP Headers** | YES | default-src 'self' 'unsafe-inline' 'unsafe-eval' data: * |
| **CDN** | None | Apache server |
| **TTFB (Mobile CrUX)** | 753 (FAST) | Field data |
| **ServiceWorker** | Yes (1 registration(s)) | Phase 1 detection |

---

## 2. CDP-Verified Findings

### 2.1 Hard vs. Soft Navigations

| From | To | Type | Document Requests | Evidence |
|------|----|------|-------------------|----------|
| https://www.fritz-berger.de | https://www.fritz-berger.de/katalog/ | **HARD** | 2 | Hard navigation detected via click (auto-discovered, exact). 2 document request(s) made. Full page reload occurred. |

**Navigation method:** click-auto
**History API used:** No
**Duration:** 141229ms

### 2.2 SSR Verification (Raw HTML Analysis)

| Metric | Value |
|--------|-------|
| Raw HTML size | 1,764,945 chars |
| Raw HTML text content | 62,523 chars |
| Rendered HTML size | 2,220,367 chars |
| Rendered HTML text content | 67,811 chars |
| SSR ratio (text) | **92%** |
| Product data in raw HTML | Yes |
| Hydration markers | No |
| Confidence | MEDIUM |

**Reasoning:** Raw HTML has substantial text content (62523 chars, 92% of rendered). Raw HTML contains product data and main content structure

### 2.3 Mobile vs Desktop HTML Comparison

HTML comparison failed (likely due to page load timeout). This check uses strict `loadEventFired` and may fail on tracker-heavy sites.

### 2.4 Image Optimization

**Format Distribution:**

| Format | Count | Percentage |
|--------|-------|------------|
| WebP | 55 | 80% |
| AVIF | 0 | 0% |
| JPEG | 0 | 0% |
| PNG | 1 | 1% |
| GIF | 3 | 4% |
| SVG | 10 | 14% |

**Payload Analysis:**
- Total image payload: **405.1 KB**
- Above-the-fold payload: 180.4 KB
- Below-the-fold payload: 188.0 KB
- Average image size: 5.9 KB
- Largest image: 86.4 KB (`https://fbr.etailercdn.de/media/k76778/k95494/thumbs/1844...`)

**Lazy Loading:**
- Total visible images: 104
- Lazy loaded: 43 (17 native, 26 JS-based)
- ATF images: 23
- ATF images with lazy loading: **1**
**LCP Image:**
- URL: `https://fbr.etailercdn.de/media/k76778/k95494/thumbs/1848652_9955894.jpg`
- Size: 1200x440px
- Lazy loaded: NO (correct)
- `fetchpriority`: auto

### 2.5 Response Headers & CSP

**CSP:**
```
default-src 'self' 'unsafe-inline' 'unsafe-eval' data: *
```

**Other Headers:**

| Header | Value |
|--------|-------|
| Server | Apache |
| CDN | None detected |
| Cache-Control | public |
| Content-Type | text/html; charset=UTF-8 |
| `strict-transport-security` | max-age=63072000; includeSubdomains; |
| `x-frame-options` | SAMEORIGIN |
| `x-xss-protection` | 1; mode=block |

---

## 3. Page Types Found

| Page Type | URL Pattern | Navigation | SSR |
|-----------|-------------|------------|-----|
| Homepage | https://www.fritz-berger.de | HARD | Yes |
| PLP | https://www.fritz-berger.de/katalog/ | HARD | Yes |

---

## 4. Tech Stack

| Component | Value | CDP-Verified |
|-----------|-------|--------------|
| CDN | Fastly | Yes (Phase 1) |
| Origin Web Server | Apache | Yes (headers) |

---

## 5. Performance Data

**CrUX (Mobile):**

| Metric | p75 |
|--------|-----|
| LCP | 1321 (FAST) |
| CLS | 2 (FAST) |
| INP | 188 (FAST) |
| TTFB | 753 (FAST) |

**CrUX (Desktop):**

| Metric | p75 |
|--------|-----|
| LCP | 976 (FAST) |
| CLS | 2 (FAST) |
| INP | 94 (FAST) |
| TTFB | 472 (FAST) |

---

## 6. Key Findings for Speed Kit

1. **SSR Architecture** --- Server-side rendering confirmed (medium confidence). The HTML shell can be cached aggressively.

2. **Hard Navigations (MPA)** --- All tested navigations are full page reloads. Ideal for Speed Kit's HTML caching.

3. **No Origin CDN** --- Server (Apache) has no CDN in front. Speed Kit's edge becomes the entire caching layer.

4. **CSP Compatible** --- Permissive CSP will not block Speed Kit.

5. **Image Optimization Gaps** --- no AVIF, 1 ATF image(s) with lazy loading. 80% modern format adoption.

6. **Failed Checks** --- htmlComparison failed during this run. Results may be incomplete.

---

## 7. DataLayer Properties for Speed Kit Tracking

DataLayer detected with 8 entries. 2 interesting keys found.

| Property | Description | Example |
|----------|-------------|---------|
| `tests` | Detected in dataLayer | — |
| `A_B_Tests` | Detected in dataLayer | — |

---

## 8. Speed Kit Scope Recommendations

**Good Candidates for Acceleration:**

- **Homepage** (`https://www.fritz-berger.de`) --- SSR, hard navigation.
- **PLP** (`https://www.fritz-berger.de/katalog/`) --- SSR, hard navigation.

**Exclude from Speed Kit / Careful Handling:**

- No exclusions identified. Review user-specific page types manually.

---

## 9. Items Verified via CDP

| Item | Method | Result |
|------|--------|--------|
| Phase 1 Discovery | `runPhase1Discovery()` | 2 page types, 1 tech stack entries |
| Navigation Type | `check-nav` | HARD (click-auto) |
| SSR Content | `check-ssr` | Yes, 92% SSR ratio |
| Mobile vs Desktop HTML | `compare-html` | Failed (page load timeout) |
| Image Formats | `check-images` | 80% modern, 1 ATF lazy issues |
| Response Headers | `headers` | No CDN, CSP present |

---

## 10. Conclusion

fritz-berger.de appears to be a good Speed Kit candidate: full SSR, hard navigations (MPA), no origin CDN (Speed Kit provides the edge layer), permissive CSP.

**Configuration requirements:**
1. 1 check(s) failed during this run

---

---

*Report generated by Speed Kit Pre-Vetting CLI (Autonomous Pipeline)*
*Phase 1: Discovery + Phase 2: CDP Verification*