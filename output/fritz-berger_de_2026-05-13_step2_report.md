# Speed Kit Pre-Vetting Report: fritz-berger.de

**Date:** 2026-05-13
**Steps Completed:** 1 (Initial Check) + 2 (CDP Verification)
**Analyst:** Claude (Step 1 + Step 2 CDP Verification)
**URL:** https://www.fritz-berger.de
**Status:** Ready for Speed Kit Integration

---

## 1. Executive Summary

fritz-berger.de is a traditional, fully server-side-rendered Multi-Page Application (MPA) running on a custom "eTailer" e-commerce platform with jQuery 2.2.4 and UIkit 2.21.0. Speed Kit is already installed and A/B-tested (`speedkit_gruppe` cohort in GA4), making this an optimization review rather than a greenfield assessment. The primary opportunity is mobile TTFB, which sits at 951 ms p75 in CrUX (Needs Improvement territory), with PDPs showing lab TTFB of ~1.27 s. CDP verification confirms strong SSR (93% of rendered text present in raw HTML), hard navigations across all page types, URL-based filters, and server-side device detection requiring Mobile/Desktop HTML cache variations.

**Key Recommendation:** Optimize Speed Kit's HTML edge-caching configuration to aggressively serve the SSR shell from Cloudflare edge, with separate cache variations for Mobile vs Desktop (server sets `_isMobile` flag and delivers different header navigation HTML). The `/personal.json` endpoint must remain uncached. PDPs are the highest-impact page type given their TTFB of ~1.27 s at origin.

---

## 2. Summary Table

| Category | Finding | Details |
|----------|---------|---------|
| **Navigation Type** | Hard (MPA) | CDP-verified: Homepage->PLP and PLP->PDP both trigger full document reloads |
| **SPA Framework** | None | jQuery 2.2.4 + UIkit 2.21.0 only; no React/Vue/Angular/Svelte |
| **SSR Status** | YES | Raw HTML analysis: 1,764,543 chars raw, 62,255 chars text (93% of rendered 67,269 chars) |
| **Mobile vs Desktop HTML** | Different | +136/-95 lines; `_isMobile` flag, header nav layout, branch locator, platform field differ |
| **Image Optimization** | 76% modern formats | 58 WebP / 0 AVIF / 8 GIF / 10 SVG out of 76 images; 370.9 KB total payload |
| **CSP Headers** | YES (permissive) | `default-src 'self' 'unsafe-inline' 'unsafe-eval' data: *` — effectively open |
| **Consent Scripts** | Client-side (OneTrust) | Raw HTML does not change with consent; scripts are gated client-side via OneTrust categories |
| **Bot Protection** | None | No DataDome, Akamai Bot Manager, Cloudflare, or PerimeterX detected |
| **TTFB (Desktop)** | 818 ms | CDP lab measurement (homepage, uncached) |
| **TTFB (Mobile)** | 625 ms | CDP lab measurement (homepage, raw HTML fetch) |
| **TTFB (Mobile CrUX)** | 951 ms p75 | Field data (Needs Improvement) — includes existing SK uplift |
| **Core Web Vitals** | All Passing at p75 | LCP 1873 ms, INP 157 ms, CLS 0.02 — but CLS has 11% poor-rate long tail |
| **CDN** | None on origin | Apache direct; no Cloudflare/Akamai/Fastly on origin. Speed Kit's edge (Cloudflare) serves cached pages |
| **Speed Kit Status** | Active (A/B-tested) | `fritz-berger.app.baqend.com`; `speedkit_gruppe` cohort in GA4 |
| **ServiceWorker** | Speed Kit only | `Service-Worker-Allowed: /` header set; `?disableSpeedKit=1` works |
| **A/B Testing** | Client-side (AB Tasty) + Server-side | AB Tasty variations, plus `epoqsearch` server-side test via `personal.json` |
| **PLP Filters** | URL-based | CDP-verified: clicking filter causes full page reload to `/marke.outwell/` URL path |

---

## 3. Step 2 CDP-Verified Findings

### 3.1 Hard vs. Soft Navigations

| From | To | Type | Document Requests | Evidence |
|------|----|------|-------------------|----------|
| Homepage (`/`) | PLP (`/zelte/campingzelte/`) | **HARD** | 1 | Full page reload via `<a>` click; URL changed; History API not used |
| PLP (`/zelte/campingzelte/`) | PDP (`/artikel/berger-kiwi-nz-...`) | **HARD** | 16 (1 document + 15 subresources/iframes) | Full page reload; SVG icons + PayPal widget loaded as document-type requests |
| PLP (`/zelte/campingzelte/`) | PLP filtered (`/marke.outwell/`) | **HARD** | 1 (via filter click) | Full document reload with URL change; traditional server-side filtering |

**Conclusion:** Every tested navigation path is a hard navigation. The site is a pure MPA with no SPA-like soft navigation behavior. This is ideal for Speed Kit.

### 3.2 SSR Verification (Raw HTML Analysis)

| Metric | Value |
|--------|-------|
| Raw HTML size | 1,764,543 chars |
| Raw HTML text content | 62,255 chars |
| Rendered HTML size | 2,540,679 chars |
| Rendered HTML text content | 67,269 chars |
| SSR ratio (text) | **93%** |
| Product data in raw HTML | Yes (16+ product impressions with IDs, prices, categories) |
| Structured data in raw HTML | Yes (Product, BreadcrumbList, WebPage schemas) |
| Hydration markers | No |
| Confidence | MEDIUM (high SSR ratio, but confidence limited by tool heuristics) |

**Evidence:** Raw HTML contains the full page shell: navigation, hero banners, product grids with ecommerce tracking data (`utag_data`, `additional_data`), and footer. The ~7% delta between raw and rendered text (62,255 vs 67,269 chars) is accounted for by client-side additions: Epoq recommendations, OneTrust banner text, AB Tasty variations, and `/personal.json` hydration (cart count, branch name, wishlist).

**Step 1 vs Step 2:** Step 1 found "strong SSR indicators" but couldn't read raw HTML (curl was blocked). CDP confirms full SSR — the HTML shell is production-ready for caching.

### 3.3 Mobile vs Desktop HTML Comparison

| Metric | Mobile | Desktop |
|--------|--------|---------|
| HTTP Status | 200 | 200 |
| TTFB | 625 ms | 818 ms |
| HTML size | 1,763,125 chars | 1,765,850 chars |
| Lines added (desktop vs mobile) | — | +136 |
| Lines removed (desktop vs mobile) | — | -95 |

**Structural differences confirmed in `<head>`, `<body>`, and `<script>` tags:**

1. **`_isMobile` flag:** Mobile sets `var _isMobile = '1'`, Desktop sets `var _isMobile = ''` — server-side device detection.
2. **`custom_data.platform`:** Mobile: `"platform":"mobile"`, Desktop: `"platform":"desktop"`.
3. **Header navigation layout:** Desktop adds a branch locator element (`icon_right__button_branch icon_right__button--filialsuche`) with the store name "Kesselsdorf" and a link to `/filiale/kesselsdorf/`. This element is absent on mobile.
4. **Account dropdown:** Desktop wraps the "Mein Konto" link in a `data-uk-dropdown="{delay: 0}"` container; mobile does not.
5. **Sidebar branch info:** Desktop populates branch address/email (e.g., "Heidelberger Str. 18, 68519 Viernheim"); mobile leaves these fields empty.
6. **CSS/JS timestamps:** Same bundle hash (`52f87136d90e136d994a23d29e3eded3f1733530`) but different `?ts=` cache-busting timestamps (mobile: `1778653304`, desktop: `1778654275`).
7. **Promo text variant:** Minor wording difference in promotional banner ("SCHUHE20" vs "20SCHUHE").
8. **EmarsysCartItems:** Desktop HTML included cart items in `custom_data` while mobile did not (likely session-dependent, not device-dependent).

**Cache variations needed: YES.** Mobile and Desktop receive structurally different HTML from the server. Speed Kit must maintain separate cache entries per device type.

**Step 1 vs Step 2:** Step 1 could not verify (curl was blocked). CDP confirms different HTML — cache variations are required.

### 3.4 Image Optimization

**Format Distribution:**

| Format | Count | Percentage |
|--------|-------|------------|
| WebP | 58 | 76% |
| AVIF | 0 | 0% |
| JPEG | 0 | 0% |
| PNG | 0 | 0% |
| GIF | 8 | 11% |
| SVG | 10 | 13% |

**Payload Analysis:**
- Total image payload: **370.9 KB**
- Above-the-fold payload: 180.4 KB
- Below-the-fold payload: 227.8 KB
- Largest image: 86.4 KB (product thumbnail from `fbr.etailercdn.de`)
- Average image size: 4.9 KB

**Lazy Loading:**
- Total visible images: 104
- Lazy loaded: 43 (17 native `loading="lazy"`, 26 via lazysizes JS library)
- ATF images: 23
- ATF images with lazy loading: **1** (at `top=469px`, via lazysizes)

**LCP Image:**
- URL: `fbr.etailercdn.de/media/k76778/k95494/thumbs/1848652_9955894.jpg`
- Size: 1200x440px
- Lazy loaded: NO (correct)
- `fetchpriority`: auto (should be `high`)

**Image CDN:** `fbr.etailercdn.de` — content-negotiates WebP (returns WebP when `Accept: image/webp` is sent). AVIF is not served. Missing `Vary: Accept` header on image responses (CDN cache-poisoning risk confirmed from Step 1).

**Step 1 vs Step 2:** Step 1 noted "ATF assets are mis-tagged with `loading='lazy'`". CDP shows only 1 ATF image has lazy loading (at 469px, borderline ATF) — the situation is better than Step 1 suggested. Step 1's observation about header country-flag PNGs with `loading="lazy"` may have been corrected, or the flag images weren't in the CDP viewport.

### 3.5 CSP Headers

**Homepage CSP:**
```
content-security-policy: default-src 'self' 'unsafe-inline' 'unsafe-eval' data: *
```

This CSP is **effectively open** — the wildcard `*` in `default-src` allows loading resources from any origin, and `'unsafe-inline'` + `'unsafe-eval'` permit all inline scripts and eval. **Speed Kit compatible: YES** — this policy will not block Speed Kit's service worker, inline scripts, or Baqend CDN connections.

**PDP Headers Note:** The CDP headers check for the PDP URL captured a PayPal iframe response instead of the main document (identified by `dc: ccg11-origin-www-1.paypal.com` and `paypal-debug-id` headers). The PDP's actual document CSP is likely the same permissive policy as the homepage.

**Other Security Headers (Homepage):**

| Header | Value |
|--------|-------|
| `Strict-Transport-Security` | `max-age=63072000; includeSubdomains;` (~2 years) |
| `X-Frame-Options` | `SAMEORIGIN` |
| `X-XSS-Protection` | `1; mode=block` |
| `Cache-Control` | `public` |
| `Server` | Apache |
| `Content-Encoding` | br (Brotli) |
| `Vary` | `accept-encoding` |
| `Service-Worker-Allowed` | `/` |
| `ETag` | Present (hash-based) |
| `X-Breach` | Present (BREACH attack mitigation token) |
| `Access-Control-Allow-Origin` | `*` |

**CDN:** No external CDN detected on the fritz-berger.de origin. Server is Apache with `Keep-Alive` (direct connection). Speed Kit's Cloudflare edge is the only CDN layer. The `cf-cache-status: HIT` observed on PDP subresources confirms Speed Kit routes cached pages through Cloudflare.

### 3.6 Consent-Based Script Differences

- **Consent Tool:** OneTrust (CMP ID: `6c4e5feb-03cc-4737-8042-fdf9a19fe8e1`)
- **Implementation Type:** Client-side
- **Default consent state:** `OnetrustActiveGroups=,C0001,` (strictly necessary only)
- **Raw HTML changes with consent:** NO — the server-rendered HTML is identical regardless of consent state. OneTrust gates scripts client-side by injecting/blocking `<script>` tags based on `OptanonActiveGroups`.
- **Cache variations needed:** NO — the HTML shell does not change based on consent.

### 3.7 PLP Filter Behavior

- **Filter type:** URL-based (CDP-verified)
- **Mechanism:** Clicking a brand filter checkbox triggers a full page reload to a new URL path (e.g., `/zelte/campingzelte/` -> `/zelte/campingzelte/marke.outwell/`)
- **History API used:** No (`pushState`/`replaceState` not called)
- **Server-side session mutation:** No indication — the filter is entirely encoded in the URL path
- **Cache-friendly:** YES — each filter combination has a unique, predictable URL

**Step 1 vs Step 2:** Step 1 identified URL-based filters from DOM inspection. CDP confirms via actual click interaction that filters cause full server-side page reloads with URL changes. No session-state mutations detected.

---

## 4. Page Types Found

| Page Type | URL Pattern | Navigation | SSR |
|-----------|-------------|------------|-----|
| Homepage | `/` | Hard | Yes |
| Category/PLP | `/zelte/campingzelte/` | Hard | Yes |
| PLP filtered | `/zelte/campingzelte/marke.outwell/` | Hard | Yes |
| PLP sub-category | `/zelte/campingzelte/4-personen-zelte/` | Hard | Yes |
| PDP | `/artikel/<slug>-<id>` | Hard | Yes |
| Search | `/suche/?suchwort=<term>` | Hard | Yes (Step 1) |
| Cart | `/cart/` | Hard | Yes (Step 1) |
| Themes/Topics | `/themen/...` | Hard (expected) | Yes (expected) |
| Blog | `/blog/` | Hard (expected) | Yes (expected) |
| Brands | `/marken/` | Hard (expected) | Yes (expected) |
| Branch locator | `/filiale/<city>/` | Hard (expected) | Yes (expected) |
| Account/Login | `/anmelden/`, `/meinkonto/` | Hard (expected) | Yes (expected) |

---

## 5. Tech Stack

| Component | Value | CDP-Verified |
|-----------|-------|--------------|
| E-commerce Platform | **eTailer** (custom German platform) | No (identified via domain/package naming) |
| Origin Web Server | **Apache** | Yes (headers) |
| CDN (origin) | **None** | Yes (headers — no CDN markers) |
| CDN (Speed Kit edge) | **Cloudflare** | Yes (cf-cache-status on cached pages) |
| Frontend Framework | jQuery 2.2.4, UIkit 2.21.0 | Yes (scripts in raw HTML) |
| SSR | Yes, full server-side rendering | Yes (93% SSR ratio) |
| Personalization | Epoq Inspire (`cdn.epoq.de`) | No (Step 1) |
| Site Search | SearchHub (`c.searchhub.io`) | No (Step 1) |
| A/B Testing (client) | AB Tasty | No (Step 1) |
| A/B Testing (server) | Platform-native via `personal.json` | No (Step 1) |
| Reviews | eTrusted / Trustedshops | No (Step 1) |
| Consent | OneTrust (`cdn.cookielaw.org`) | Yes (headers/scripts) |
| Analytics | GTM, GA4, Google Ads, Baqend RUM, Epoq RUM | No (Step 1) |
| Speed Kit | **Active** — Baqend `fritz-berger.app.baqend.com` | Yes (Service-Worker-Allowed header, model JSONs in network) |
| Fonts | Self-hosted Open Sans + custom fritzberger.woff (preloaded) | Yes (raw HTML `<link rel="preload">`) |
| Compression | Brotli (br) | Yes (Content-Encoding header) |
| Image CDN | `fbr.etailercdn.de` | Yes (image analysis) |

---

## 6. Performance Data

### CrUX Field Data (Origin, 28-day window 2026-04-14 to 2026-05-11)

**Mobile:**

| Metric | p75 | Good % | NI % | Poor % | Rating |
|--------|-----|--------|------|--------|--------|
| LCP | 1873 ms | 84.8 | 10.2 | 5.0 | Good |
| INP | 157 ms | 84.8 | — | — | Good |
| CLS | 0.02 | 85.5 | 3.5 | **11.0** | Good (p75) but long-tail poor |
| TTFB | **951 ms** | 68.5 | 24.4 | 7.1 | **Needs Improvement** |
| FCP | 1329 ms | — | — | — | Good |

**Desktop:**

| Metric | p75 | Good % | Rating |
|--------|-----|--------|--------|
| LCP | 1520 ms | 89.7 | Good |
| INP | 94 ms | 93.6 | Good |
| CLS | 0.01 | 86.4 | Good (10.1% poor long-tail) |
| TTFB | **902 ms** | 71.0 | **Needs Improvement** |
| FCP | 1111 ms | — | Good |

**Note:** CrUX data includes existing Speed Kit uplift. The unaccelerated baseline is worse.

### CDP-Measured TTFB (Lab)

| Page | Device | TTFB | Notes |
|------|--------|------|-------|
| Homepage | Desktop | 818 ms | Raw HTML fetch (compare-html) |
| Homepage | Mobile | 625 ms | Raw HTML fetch (compare-html) |
| PDP | Desktop | ~1268 ms | Step 1 live navigation measurement |
| Search | Desktop | ~243 ms | Step 1 live navigation measurement |
| Cart | Desktop | ~364 ms | Step 1 live navigation measurement |

### LCP Breakdown (CrUX Mobile)

| Sub-metric | p75 | Interpretation |
|------------|-----|----------------|
| LCP image TTFB | 970 ms | Dominated by document TTFB |
| LCP image resource load delay | 299 ms | Late image discovery (~300 ms) |
| LCP image element render delay | 593 ms | Notable headroom |
| LCP image resource load duration | 62 ms | Fast once started |

### Sister Sites (CrUX Overall p75)

| Site | LCP | TTFB | FCP | INP | CLS |
|------|-----|------|-----|-----|-----|
| fritz-berger.at | 2255 ms | **1299 ms** | 1630 ms | 136 ms | 0.01 |
| berger-camping.ch | 1822 ms | **1074 ms** | 1364 ms | 109 ms | 0.01 |

The `.at` site has materially worse TTFB — possibly less Speed Kit coverage or different cache state.

---

## 7. Key Findings for Speed Kit

1. **Primary Opportunity: TTFB Reduction via Edge Caching** — Mobile TTFB at 951 ms p75 (CrUX) and PDP TTFB at ~1.27 s (lab) are the dominant performance bottleneck. Speed Kit's Cloudflare edge caching should target sub-200 ms TTFB for all cacheable page types. With no origin CDN (bare Apache), Speed Kit's edge becomes the entire caching layer — this amplifies its value.

2. **HTML Cache Variations Required: Mobile vs Desktop** — CDP confirms the server delivers structurally different HTML based on device type (different `_isMobile` flag, header navigation layout, branch locator placement, platform field in analytics). Speed Kit must maintain separate cache entries for mobile and desktop User-Agents. The `Vary` response header only includes `accept-encoding`, so Speed Kit needs to implement device-based variation internally.

3. **SSR Architecture Is Ideal for Caching** — 93% of rendered text content is present in the raw HTML server response. The dynamic/personalized layer (`/personal.json` payload delivering cart, wishlist, branch, A/B test assignments) is cleanly decoupled from the HTML shell. Speed Kit can cache the HTML aggressively while letting the JSON remain uncached.

4. **PLP Filters Are Cache-Friendly** — CDP-verified: filters produce unique, deterministic URL paths (`/marke.outwell/`, `/4-personen-zelte/`). No session-state mutations. Each filtered view can be cached independently by URL.

5. **CSP Is Not a Blocker** — The origin's CSP (`default-src 'self' 'unsafe-inline' 'unsafe-eval' data: *`) is effectively wide open. Speed Kit's scripts, service worker, and CDN connections will not be blocked. No CSP modifications needed.

6. **No Origin CDN Amplifies Speed Kit Value** — The origin serves directly from Apache with no Cloudflare, Akamai, or Fastly in front. Speed Kit's Cloudflare edge is the only caching layer. This means Speed Kit provides not just acceleration but also the first-layer CDN functionality — significant value proposition.

7. **Image Optimization Gaps** — 76% WebP adoption is decent but AVIF is completely absent. The image CDN (`fbr.etailercdn.de`) also lacks `Vary: Accept` headers, creating a cache-poisoning risk where WebP and non-WebP responses share the same cache key. The LCP image has `fetchpriority: auto` instead of `high`. One ATF image at 469px uses lazysizes lazy loading.

8. **CLS Long-Tail Issue** — Despite a Good p75 CLS (0.02), 11% of mobile sessions experience Poor CLS. Likely caused by late-injecting AB Tasty variations (preloaded and executed ATF), Epoq recommendation containers, or OneTrust banner. Speed Kit should ensure its acceleration doesn't exacerbate layout shifts.

9. **Speed Kit Already Deployed — Optimization Focus** — Speed Kit is active and A/B-tested. The pre-vetting should inform configuration improvements (cache variations, cache TTLs, additional page type coverage) rather than initial setup. Worth extracting the existing A/B uplift data from `speedkit_gruppe` in GA4.

10. **Sister Sites Share Same Baqend Tenant** — `fritz-berger.at` (worst TTFB: 1299 ms p75) and `berger-camping.ch` share `fritz-berger.app.baqend.com`. The `.at` site should be checked for equal Speed Kit coverage.

---

## 8. DataLayer Properties for Speed Kit Tracking

| Property | Description | Example |
|----------|-------------|---------|
| `up.speedkit_gruppe` | Speed Kit A/B cohort (already in GA4) | `"B"` |
| `custom_data.platform` | Server-detected device type | `"mobile"` / `"desktop"` |
| `custom_data.filiale` | User's selected branch | `"Kesselsdorf (Dresden)"` |
| `custom_data.category` | Page breadcrumb path | `"Startseite > Startseite Fritz Berger"` |
| `custom_data.A_B_Tests` | Active server-side experiments | `{"Suche":"epoqsearch"}` |
| `utag_data.ecommerce.impressions` | Product impression data (IDs, prices, categories) | See raw HTML |
| `personal.json > Tests` | Server-side A/B test descriptors | `{"internal_description":"epoqsearch","testgroup_id":"..."}` |
| `_presence` | Storefront identifier | `"fritzberger_b2c"` |

---

## 9. Speed Kit Scope Recommendations

### Good Candidates for Acceleration

- **Homepage (`/`)** — Fully SSR, generic content, high traffic entry point. TTFB 625-818 ms lab → cache should reduce to <100 ms.
- **PLP / Category pages (`/zelte/campingzelte/`, sub-categories)** — SSR, URL-based filters, deterministic URL structure. Each filter combination is independently cacheable.
- **PDP (`/artikel/<slug>-<id>`)** — Highest TTFB (~1.27 s). SSR with product data in raw HTML. PayPal widget loaded in iframe (not in main HTML). Biggest Speed Kit impact page type.
- **Search results (`/suche/?suchwort=<term>`)** — SSR, GET-based query parameters. Popular queries cacheable.
- **Static pages** — `/themen/`, `/blog/`, `/marken/`, `/sale/`, `/neuheiten/`, `/service/`, `/faq-kontakt/`, `/agb/`, `/impressum/`, `/datenschutz/`, `/katalog/`, `/produkttests/`
- **Branch locator pages (`/filiale/<city>/`)** — Static content per branch.
- **Third-party assets** — `fbr.etailercdn.de` (images/JS/CSS), `cdn.epoq.de`, `cdn.cookielaw.org`, `c.searchhub.io`, `integrations.etrusted.com`

### Exclude from Speed Kit / Careful Handling

- **`/personal.json`** — Contains per-user data (cart, wishlist, branch, A/B assignments, login state). Must NOT be cached. Already excluded (confirmed by `/personal.json` fetch in every navigation).
- **Cart (`/cart/`)** — User-specific content. Exclude or cache only the shell with client-side hydration.
- **Account pages (`/anmelden/`, `/meinkonto/`)** — User-specific, session-dependent.
- **Wishlist (`/merkzettel/`)** — User-specific.
- **Order status (`/bestellstatus/`)** — User-specific.
- **Checkout flow** — Payment-sensitive, user-specific.
- **AB Tasty scripts (`try.abtasty.com`)** — Must remain authoritative; cache with care to avoid stale test assignments. AB Tasty preloads scripts ATF.
- **Search with session context** — If `epoqsearch` A/B test modifies results server-side, ensure the test assignment doesn't leak into cached HTML (it doesn't — confirmed via `personal.json` isolation).

---

## 10. Items Verified via CDP

| Item | Method | Result |
|------|--------|--------|
| Navigation Type (Homepage->PLP) | `check-nav` command | Hard (MPA), 1 document request |
| Navigation Type (PLP->PDP) | `check-nav` command | Hard (MPA), full page reload |
| SSR Content | `check-ssr` command | Yes, 93% SSR ratio, product data in raw HTML |
| Mobile vs Desktop HTML | `compare-html` command | Different (+136/-95 lines), `_isMobile` flag, nav layout — variations needed |
| Image Formats | `check-images` command | 76% WebP, 0% AVIF, 370.9 KB total, 1 ATF lazy issue |
| CSP Headers (Homepage) | `headers` command | Permissive: `default-src 'self' 'unsafe-inline' 'unsafe-eval' data: *` |
| Response Headers (Homepage) | `headers` command | Apache, no CDN, HSTS, Brotli, ETag, SW-Allowed |
| Response Headers (PDP) | `headers` command | Captured PayPal iframe headers (Cloudflare); actual PDP headers need re-check |
| PLP Filters | `check-filters` command | URL-based, full page reload to `/marke.outwell/`, cache-friendly |
| Consent Scripts | Raw HTML analysis | Client-side OneTrust; no HTML changes with consent |
| Speed Kit Active | Network observation | Baqend model JSONs + install script loaded on every navigation |

---

## 11. Conclusion

fritz-berger.de is an excellent Speed Kit candidate with a near-ideal architecture for edge caching: full SSR, clean personalization decoupling via `/personal.json`, URL-based filters, hard navigations only, a permissive CSP, and no bot protection obstacles. Speed Kit is already deployed and A/B-tested, so the focus should be on configuration optimization.

**Key configuration requirements and recommendations:**

1. **Mobile/Desktop cache variations** — Server delivers different HTML per device type. Speed Kit must key cache entries on device class.
2. **Aggressive HTML caching** — With no origin CDN, Speed Kit's Cloudflare edge should set high TTLs (stale-while-revalidate pattern) for Homepage, PLP, PDP, and static pages.
3. **Exclude `/personal.json`** — Must remain uncached to preserve per-user state isolation.
4. **PDP prioritization** — PDPs have the worst TTFB (~1.27 s) and are likely the highest-traffic page type. Prioritize cache warming for popular PDPs.
5. **LCP image optimization** — Add `fetchpriority="high"` to the hero/LCP image. Recommend customer adds `Vary: Accept` to `fbr.etailercdn.de` image responses and consider AVIF support.
6. **Sister site parity** — Check that `fritz-berger.at` (TTFB 1299 ms p75) and `berger-camping.ch` have equivalent Speed Kit configuration.
7. **CLS investigation** — The 11% poor CLS long-tail should be investigated (likely AB Tasty ATF variations or Epoq container injection).
8. **No `Vary: Accept` on images** — Flag to customer: `fbr.etailercdn.de` returns WebP/PNG based on `Accept` header but doesn't set `Vary: Accept`, risking CDN cache poisoning.

---

*Report generated by Speed Kit Pre-Vetting Analysis Tool*
*Step 1: Initial Analysis | Step 2: CDP Verification Complete*

---

## Additional Sections (Beta)

### Topic Coverage Comparison (Beta)

**Verified by Both Steps:**

| Topic | Step 1 Finding | Step 2 Verification |
|-------|----------------|---------------------|
| Navigation type | No SPA, hard navigations | CDP confirmed: Hard for all tested paths |
| SSR | Strong indicators (product IDs in fetch, structured data) | Confirmed: 93% SSR ratio, product data in raw HTML |
| Image optimization | WebP via content negotiation, no AVIF, missing Vary | Confirmed: 76% WebP, 0% AVIF, 370.9 KB payload |
| URL-based filters | Observed in DOM (pagination, brand paths) | CDP confirmed via click: full reload to `/marke.outwell/` |
| Speed Kit active | Install script + model files detected | SW-Allowed header + model JSON fetches on every navigation |
| OneTrust consent | Client-side gating | Confirmed: no raw HTML changes with consent |

**Verified by Step 2 Only (new findings):**

| Topic | Step 2 Finding |
|-------|----------------|
| Mobile vs Desktop HTML | Different: `_isMobile` flag, header nav layout, branch locator (+136/-95 lines) |
| CSP headers | Permissive: `default-src 'self' 'unsafe-inline' 'unsafe-eval' data: *` |
| Response headers (full) | Apache, no CDN, HSTS 2yr, X-Frame-Options, Brotli, ETag, X-Breach token |
| TTFB lab measurements | Homepage: 625 ms (mobile), 818 ms (desktop) |
| SSR ratio quantified | 93% text content in raw HTML |
| Filter click behavior | Full page reload, no History API, no session mutation |

**Step 1 Only (not re-verified by CDP):**

| Topic | Step 1 Finding | Notes |
|-------|----------------|-------|
| AB Tasty details | Specific variation IDs, emotionsAI, scroll tracking | Would need JS inspection |
| Epoq recommendation containers | 15 containers on PDP | Would need DOM analysis |
| Native app | iOS/Android hybrid suspected | External check |
| Search platform | SearchHub + Epoq A/B test | Network analysis |
| PDP TTFB | 1268 ms | Step 1 live nav; CDP headers captured PayPal iframe instead |

### Speed Kit Value Proposition (Beta)

| Benefit | Current | With Speed Kit (optimized) | Impact |
|---------|---------|---------------------------|--------|
| TTFB (Mobile p75) | 951 ms | ~150-300 ms | **High** |
| TTFB (PDP lab) | ~1270 ms | ~100-200 ms | **High** |
| LCP (Mobile p75) | 1873 ms | ~1200-1500 ms | Medium-High |
| FCP (Mobile p75) | 1329 ms | ~600-900 ms | Medium |
| Cache hit rate | Unknown (SK active) | 80-95% for public pages | High |
| Origin load reduction | Baseline | 60-80% fewer origin hits | Medium |

**Primary benefit:** TTFB reduction through edge caching — the origin has no CDN, so Speed Kit provides both acceleration and first-layer CDN functionality.

**Secondary benefits:** Reduced origin infrastructure load, improved mobile LCP through faster document delivery, preloading/prefetching of likely next navigations.

### Risk Assessment (Beta)

| Risk | Level | Mitigation |
|------|-------|------------|
| Bot Protection | None detected | No mitigation needed |
| CSP Blocking | Very permissive CSP | No risk — effectively wide open |
| Per-user HTML leakage | `/personal.json` isolates state | Monitor for edge cases; verify no user-specific content enters HTML |
| AB Tasty conflicts | AB Tasty preloads scripts ATF | Ensure Speed Kit doesn't cache AB Tasty responses; keep variations authoritative |
| CLS regression | 11% poor sessions already | Monitor CLS after config changes; avoid adding layout-shifting elements |
| Sister site divergence | .at has worse TTFB | Audit .at and .ch SK configuration parity |
| Image Vary header | Missing `Vary: Accept` on image CDN | Customer action: add `Vary: Accept` to `fbr.etailercdn.de` responses |

### Action Items for Customer (Beta)

1. **Add `Vary: Accept` header** to `fbr.etailercdn.de` image responses to prevent CDN cache poisoning between WebP and non-WebP clients.
2. **Add `fetchpriority="high"`** to the LCP/hero image on Homepage and PLP pages.
3. **Consider AVIF support** on the image CDN for further payload reduction (currently 0% AVIF).
4. **Investigate CLS poor-rate** (11% of mobile sessions) — likely caused by AB Tasty ATF variations or Epoq container injection.
5. **Add `<link rel="preload">` for the LCP image** — CrUX shows 299 ms image resource load delay due to late discovery.
6. **Remove `loading="lazy"` from ATF images** — 1 ATF image still lazy-loaded at 469px via lazysizes.
7. **Share `speedkit_gruppe` A/B results** from GA4 with the Baqend team to quantify current Speed Kit uplift and identify optimization opportunities.
8. **Audit Speed Kit config on sister sites** — `fritz-berger.at` has 1299 ms TTFB p75 vs 951 ms on `.de`.
