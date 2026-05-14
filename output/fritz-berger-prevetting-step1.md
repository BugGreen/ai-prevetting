# Speed Kit Pre-Vetting — Step 1 Report

**Website:** https://www.fritz-berger.de
**Date:** 2026-05-13
**Step:** 1 (initial check). Step 2 (CDP toolkit) **IS REQUIRED** — workspace `curl` was blocked (`X-Proxy-Error: blocked-by-allowlist`), so raw HTML, response headers, CSP, and Mobile/Desktop HTML diffs still need CDP verification.

---

## TL;DR for Speed Kit

- Speed Kit (Baqend) is **already installed and running A/B**: install script `fritz-berger.app.baqend.com/v1/speedkit/install.js` and an in-house GA4 split with `up.speedkit_gruppe=B` were observed. CrUX numbers reported here include that uplift already; the unaccelerated baseline is worse.
- **TTFB is the headline problem.** Origin CrUX p75 TTFB is ~951 ms (mobile) / ~902 ms (desktop) — both Needs Improvement. PDP TTFB measured live: ~1.27 s. Homepage measured live: ~71 ms (heavily cached). This is the classic Speed Kit case.
- Site is a classical, fully **server-rendered multi-page app** (no SPA framework, jQuery 2.2.4 + UIkit 2.21.0 only). Soft navigations effectively **don't exist** — every page is a hard navigation. Easy fit for Speed Kit.
- Filters and pagination are **URL-based** (`?page=2`, `marke.<brand>`, `1-personen-zelte`, `?suchwort=zelt`). Cache-friendly.
- Personalization, cart state, A/B test assignment, and per-user content arrive via a **separate `/personal.json` payload** that hydrates the SSR shell. Excellent decoupling for caching — but means Speed Kit must continue to NOT cache the JSON, only the HTML shell.
- Image CDN (`fbr.etailercdn.de`) **does content-negotiate WebP** (Accept-based, no `Vary: Accept`). AVIF is **not** served. Many ATF assets carry `loading="lazy"`.
- One service-worker scope was reserved (`Service-Worker-Allowed: /`) so Speed Kit's SW can take over the full origin — already in place.

The site is a strong Speed Kit candidate. The main residual risks are CSP rules (need Step 2 to read headers), the in-flight A/B-Tasty client-side tests (some appear ATF), and CLS at p75 mobile (11% poor users despite a 0.02 p75 — long-tail layout shift to investigate).

---

## Summary Table (Step 1 Checklist)

| Category | Finding | Details |
|---|---|---|
| SPA / Soft Navigation | **No** | No React/Vue/Next/Nuxt/Angular/Svelte. jQuery 2.2.4 + UIkit 2.21.0. All page changes are full document loads. |
| SSR | **Yes (strong indicators)** | Raw `<h1>` present in initial document; ~32 product IDs found in raw HTML (`fetch('/')`); ~26 `<script>` tags; SEO-ready structured data (`Product`, `BreadcrumbList`, `WebPage`) rendered server-side. Final SSR vs CSR verdict requires Step 2 raw-HTML check. |
| Mobile/Desktop HTML | **Not verified** | Could not bypass cookies-in-response filter to read headers/raw HTML; needs CDP. No `Vary` header on a tested static asset. |
| Image Optimization | **WebP via content negotiation** (no AVIF) | Same URL `image/png` (1928 B) vs `image/webp` (1308 B) depending on `Accept`. **`Vary` header missing** → CDN cache-poisoning risk. |
| CSP | **Unknown** | Document HEAD response could not be inspected (cookie filter). Static CSS asset returned no CSP. Needs Step 2. |
| Bot Protection | **None detected** | No DataDome / Akamai / Cloudflare / PerimeterX markers in scripts. Apache `Server` header on static. Workspace proxy itself blocked our curl (`blocked-by-allowlist`) — that's our limitation, not the site's. |
| Speed Kit Status | **Already installed (Baqend)** | `fritz-berger.app.baqend.com/v1/speedkit/install.js`, model files `cl_desktop_xgb.json`, `cl_desktop_cfg.json`. `?disableSpeedKit=1` works (SW unregisters). |
| Other ServiceWorker | **No** | Only Speed Kit registers a SW. `Service-Worker-Allowed: /` header set on origin. |
| Personalization | **Client-side JSON hydration** | `/personal.json?vw_type=…&vw_name=…&form=1&token=…` returns user/cart/wishlist/branch/active-tests payload. SSR shell is generic. |
| A/B testing — client | **A/B Tasty** | `try.abtasty.com/06d0bf372c239a5bcc1c1750c21dd215.js`, active variations (`variation-js-1781161-5727459`), `emotionsAI`, scroll tracking. Some variations may execute ATF (`me.<hash>.js` is preloaded). |
| A/B testing — server | **Yes, observed** | `personal.json` lists active server-side test `epoqsearch` (Epoq Suche). GA4 also carries `ep.speedkit_gruppe=B` / `up.speedkit_gruppe=B` — the Speed Kit cohort flag itself is a server/SW-side split. |
| ATF personalization | **No** (homepage tested) | Hero/grid is the same server-rendered content; personalization fills the cart icon, branch name, and recommendations later. Confirm Step 2 raw-HTML diff. |
| Recommendation engine | **Epoq Inspire** | `cdn.epoq.de/assets/fritz-berger-de/...epoq-inspire.live.js`, RUM at `fritz-berger-de.arc.epoq.de`. 15 Epoq containers seen on a PDP. |
| Site search | **SearchHub** | `c.searchhub.io/9Z7HgHCCz`. Plus a server-side `epoqsearch` A/B test exists. |
| Reviews / Trust | **eTrusted (Trustedshops)** | `integrations.etrusted.com/applications/widget.js/v2`. |
| Consent | **OneTrust** | `cdn.cookielaw.org`. Default state seen pre-consent: `OnetrustActiveGroups=,C0001,` (strictly necessary only). Scripts gated by consent — raw HTML differences pre/post-consent need Step 2 verification. |
| Speculation Rules | **No** | No `<script type="speculationrules">` in DOM. |
| Tracking params | utm_*, gclid, fbclid not seen organically; GA4 + Google Ads + page_view events run | GTM container `GTM-5VZQDH`; GA4 `G-25PL1RZJ5Z`; Google Ads `AW-540784920`; Pagead/Doubleclick collect endpoints. |
| Performance — origin TTFB (live nav) | Homepage 71 ms, PDP 1268 ms, Cart 364 ms, Search 243 ms, PLP fast (cached) | Big PDP TTFB gap is the SK opportunity. |
| Performance — CrUX (origin, 2026-04-14 → 2026-05-11) | See below | Includes existing SK uplift. |
| Languages / sister sites | **3 separate domains** | de-de → `fritz-berger.de`, de-at → `fritz-berger.at` (same stack + Microsoft Clarity / Bing), de-ch → `berger-camping.ch` (sister brand "Berger Camping", same platform). All three share the same Baqend Speed Kit app `fritz-berger.app.baqend.com`. No `/en` or `/de` URL paths inside the .de site — only the OneTrust banner shows visible EN text fragments. |
| Native app | **Yes, hybrid suspected** | iOS `id 434824753` (iOS 16.6+), Android `de.etailer.fritzbergerapp`. Android package name confirms the platform vendor "**eTailer**" built it. Likely a webview-driven hybrid app given the package naming and the "redesigned interface / faster loading times" patch notes — confirm by app store inspection if needed. |

## CrUX (origin, 28-day window 2026-04-14 → 2026-05-11)

| Metric | Mobile p75 | Desktop p75 | Overall p75 | Verdict |
|---|---|---|---|---|
| LCP | **1873 ms** (Good 84.8 / NI 10.2 / Poor 5.0) | **1520 ms** (Good 89.7) | **1845 ms** (Good 85.1) | Good — but mobile is close to the 2.5 s threshold |
| INP | **157 ms** (Good 84.8) | **94 ms** (Good 93.6) | **157 ms** (Good 84.0) | Good |
| CLS | **0.02** (Good 85.5 / NI 3.5 / **Poor 11.0**) | **0.01** (Good 86.4 / Poor 10.1) | **0.02** (Poor 10.7) | Good at p75, but ~11% of sessions are Poor — long-tail issue to investigate |
| TTFB (experimental) | **951 ms** (Good 68.5 / NI 24.4 / Poor 7.1) | **902 ms** (Good 71.0) | **941 ms** (Good 69.1) | **Needs Improvement** — Speed Kit's prime target |
| FCP | 1329 ms | 1111 ms | 1315 ms | Good |
| LCP image TTFB | 970 ms | 896 ms | 954 ms | Slow — driven by document TTFB |
| LCP image element render delay | 593 ms | 317 ms | 568 ms | Notable headroom on mobile |
| LCP image resource load delay | 299 ms | 280 ms | 306 ms | Late discovery of the LCP image (no preload of LCP image observed) |
| LCP image resource load duration | 62 ms | 36 ms | 57 ms | Fast once started |
| RTT | 74 ms | 54 ms | 71 ms | — |

Sister sites for completeness (overall p75):
- `fritz-berger.at` — LCP 2255 ms, TTFB 1299 ms, FCP 1630 ms, INP 136 ms, CLS 0.01.
- `berger-camping.ch` — LCP 1822 ms, TTFB 1074 ms, FCP 1364 ms, INP 109 ms, CLS 0.01.

The .at site has materially worse TTFB and a softer LCP — possibly less Speed Kit coverage or different cache state.

## Page Types Found

| Body class | URL pattern | Live TTFB |
|---|---|---|
| `body-seite body-startpage` (Homepage) | `/` | 71 ms (cache hit during test) |
| `body-warengruppe body-warengruppe-detail` (PLP / Category) | `/zelte/campingzelte/`, sub-categories like `/zelte/campingzelte/4-personen-zelte/`, brand filter `/zelte/campingzelte/marke.berger/` | Fast (was cached on revisit) |
| `body-artikel body-artikel-detail` (PDP) | `/artikel/<slug>-<id>` (e.g. `/artikel/berger-kiwi-nz-kuppelzelt-fuer-3-personen-389672`) | **1268 ms** |
| `body-praesenz-search` (Search) | `/suche/?suchwort=<term>` | 243 ms |
| `body-warenkorb body-warenkorb-detail` (Cart) | `/cart/` | 364 ms |
| Also exists | `/themen/...` (Themes/Topics), `/blog/`, `/marken/` (Brands), `/sale/`, `/neuheiten/` (New), `/merkzettel/` (Wishlist), `/anmelden/` (Sign-in), `/meinkonto/` (Account), `/click_collect/`, `/filiale/<city>/` (Branch locator), `/service/`, `/faq-kontakt/`, `/agb/`, `/impressum/`, `/datenschutz/`, `/katalog/`, `/produkttests/`, `/vorteilskarte-beantragen/` (loyalty card), `/bestellstatus/` (order status) | — |

## Tech Stack

| Component | Value |
|---|---|
| E-commerce platform | **"eTailer"** (custom platform from a German agency — domain `etailercdn.de`, Android package `de.etailer.fritzbergerapp`). Not Shopify / Magento / SFCC / Shopware / Spryker / OXID / JTL. |
| Origin web server | Apache (seen on static and SVG responses) |
| CDN | **No obvious public CDN** on origin — no `Via`, `X-Cache`, `Cf-Ray`, `X-Served-By`, `X-Akamai-*`. Asset domain `fbr.etailercdn.de` also presents bare headers (no CDN markers). Likely a private edge or no CDN; needs Step 2 to confirm. |
| Frontend framework | jQuery 2.2.4, UIkit 2.21.0, custom `fbr_esm-*.js` bundle from `fbr.etailercdn.de` |
| SSR framework | Unknown (proprietary "eTailer"); confirm Step 2 raw HTML |
| Personalization / Recommendations | **Epoq Inspire** (`cdn.epoq.de`, `fritz-berger-de.arc.epoq.de`) |
| Site search | **SearchHub** (`c.searchhub.io/9Z7HgHCCz`); active server-side A/B test `epoqsearch` switching to Epoq Search |
| A/B testing — client | **A/B Tasty** (account `06d0bf372c239a5bcc1c1750c21dd215`); also runs A/B Tasty `emotionsAI` and scroll tracking |
| A/B testing — server | Built into the platform via `personal.json` Tests payload; current active test: `epoqsearch` |
| Reviews | **eTrusted / Trustedshops** widget |
| Consent | **OneTrust** (CMP id `6c4e5feb-03cc-4737-8042-fdf9a19fe8e1`) |
| Analytics | **GTM** (`GTM-5VZQDH`), **GA4** (`G-25PL1RZJ5Z`), **Google Ads** (`AW-540784920`), Google Doubleclick/syndication, Baqend RUM, Epoq RUM. The .at sister site also runs **Microsoft Clarity** + **Bing UET**. |
| Hosting | Could not determine. No `Server` revealed on document; needs Step 2. |
| Speed Kit | **Active** — Baqend app `fritz-berger.app.baqend.com`; A/B-tested with `speedkit_gruppe` cohort sent to GA4. |
| Fonts | Self-hosted Open Sans (Regular/Semibold/Bold) + custom `fritzberger.woff` — all preloaded |

## Data Layer (GTM `dataLayer`)

Already very rich. Tracks ecommerce impressions with the following fields per product: `id`, `BaseId`, `name`, `price`, `disponent`, `category`, `availability`, `discount`, `priceTaxFree`, `currency`, `quantity`, `brand`, `variant`, `variant2`, `position`, `list`. The `personal.json` payload supplies `Tests[*]` (active A/B test descriptor including `internal_description`, `template_set`, `testgroup_id`) and a `presence` object (`fritzberger_b2c`, `shopId`) — both worth surfacing in Speed Kit tracking.

For Speed Kit specifically, the helpful data points to forward:
- `up.speedkit_gruppe` / `ep.speedkit_gruppe` (already present in GA4 — keep aligned)
- `presence.shopInternalDescription` (B2C vs B2B distinction if any)
- `Tests[*].internal_description` (active server-side experiment, e.g. `epoqsearch`)
- A/B Tasty variation IDs from `window.ABTasty` if exposed
- `user.loggedIn` and `cart.numItems` to segment performance by state

## Image Optimization

- CDN: `fbr.etailercdn.de` (max-age `15778800` ≈ 6 months, headers very sparse, no `Vary` header)
- Default URL extension is `.png` / `.jpg`. Same URL **returns WebP** when the client sends `Accept: image/webp` and **returns PNG/JPG** when it doesn't. **AVIF is not served** even when explicitly requested.
- Missing `Vary: Accept` means a shared cache between WebP/non-WebP clients could serve the wrong format — worth flagging to the customer.
- Lazy loading: applied broadly, but **ATF assets are mis-tagged** — header country-flag images (24 px PNGs) and the navigation icons carry `loading="lazy"`. PDP gallery main image is `eager`. Important LCP-candidate images for Step 2 to inspect:
  - Homepage hero banner / first stage tile
  - PLP first row of product tile thumbnails (`/media/k76778/k216569/thumbs/*`)
  - PDP main product image (`/media/pimg/<id>/thumbs/*`)
- `Timing-Allow-Origin` missing on `fbr.etailercdn.de` (Resource Timing returns 0 for transfer/encoded sizes) — minor, but blocks Speed Kit's own image timing analysis.

## Third-Party Domains Loaded (static and runtime)

`fbr.etailercdn.de` · `www.fritz-berger.de` · `cdn.cookielaw.org` · `geolocation.onetrust.com` · `try.abtasty.com` · `ariane.abtasty.com` · `fritz-berger.app.baqend.com` · `cdn.epoq.de` · `fritz-berger-de.arc.epoq.de` · `c.searchhub.io` · `integrations.etrusted.com` · `www.googletagmanager.com` · `region1.google-analytics.com` · `pagead2.googlesyndication.com` · (.at adds) `scripts.clarity.ms`, `www.clarity.ms`, `bat.bing.com`.

Candidates Speed Kit could 3P-accelerate: `cdn.epoq.de`, `try.abtasty.com` (carefully — A/B Tasty must remain authoritative), `cdn.cookielaw.org`, `c.searchhub.io`, `integrations.etrusted.com`, `fbr.etailercdn.de` (already same-org but cross-origin).

## Filters & Pagination (URL or session?)

URL-based — confirmed in DOM:
- Pagination: `/zelte/campingzelte/?page=2` … `?page=9`
- Brand filter as path: `/zelte/campingzelte/marke.high-peak/`, `marke.berger/`, `marke.coleman/`
- Sub-attribute as path segment: `/zelte/campingzelte/1-personen-zelte/`, `tunnelzelte/`, `wurfzelte/`, `iglu-und-kuppelzelte/`, `aufblasbare-zelte/`, …
- Range filter form (`<form id="rangeform" method="get">`) writes to GET params on the same path.
- Search: `/suche/?suchwort=<term>` (GET).

That's cache-friendly. **Step 2 should still confirm** that opening filters does not also fire a session-state mutation on the server.

## Key Findings for Speed Kit

1. **TTFB is the dominant pain point.** Mobile p75 ~951 ms and PDP live ~1.27 s. Speed Kit's HTML-cache should drop p75 LCP meaningfully and lift the still-borderline mobile LCP further inside Good.
2. **Architecture is ideal** — pure SSR multi-page, dynamic state isolated behind `/personal.json`. Speed Kit can cache the HTML shell aggressively; the JSON stays uncached, no per-user HTML variations needed (pending Step 2 confirmation that no per-user content leaks into the HTML).
3. **Speed Kit is already deployed and A/B-tested in GA4** (`speedkit_gruppe`). Pre-vetting should focus on configuration optimizations rather than a green-field install. Worth pulling the existing A/B uplift numbers from the customer.
4. **CLS Poor-rate is 11% on mobile** despite a Good p75. Long-tail layout shift — likely from late-injecting A/B Tasty variations, Epoq containers, or the OneTrust banner.
5. **A/B Tasty preloads a script before consent** (`try.abtasty.com/shared/me.<hash>.js` is in `<link rel="preload" as="script">`). Some variations execute ATF. Speed Kit should be configured to keep A/B Tasty variations executing pre-paint to avoid CLS / flicker.
6. **Image CDN does WebP but no AVIF and no `Vary` header.** Two easy wins: ask the CDN to send `Vary: Accept`, and consider AVIF.
7. **LCP image is discovered ~300 ms late** (resource load delay p75 mobile). A `fetchpriority="high"` and/or `<link rel="preload">` on the LCP image, plus removing `loading="lazy"` from ATF imagery, would shave ~200–300 ms off LCP.
8. **Sister sites share the same Baqend tenant.** `.at` is the slowest origin in CrUX — worth checking whether Speed Kit is configured equally for it.
9. **No Speculation Rules.** Worth piloting once Speed Kit's prefetch logic is verified to compose well with them.
10. **No Vary, no obvious public CDN.** Step 2 must confirm origin caching and the actual CDN topology — if there's no CDN in front, Speed Kit's own edge becomes more valuable.

## Items That Could Not Be Determined in Step 1

- **Raw HTML / SSR-vs-CSR proof:** workspace `curl` blocked; can only see rendered DOM via Chrome. (Heavy SSR is strongly suggested by raw-fetch product IDs and SEO-quality structured data, but should be confirmed with the CDP toolkit.)
- **Response headers** for the document (Set-Cookie filter blocked reads). Specifically: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Powered-By`, `Server`, `Vary`, `Age`, CDN markers.
- **Mobile vs Desktop raw HTML diff** (proper UA emulation).
- **Pre-consent vs post-consent script set** at the raw HTML level.
- **Whether filter-clicks issue session-state writes** server-side.
- **CDN identity** of `fbr.etailercdn.de` (custom origin or behind Cloudflare/Akamai/etc.).
- **Whether the native app is a webview wrapper or genuinely native** (heuristic only: Android package `de.etailer.fritzbergerapp` and "redesigned interface" patch notes suggest hybrid).

All of these are Step 2 (CDP toolkit) jobs.

## Recommended Step 2 Run

```
prevetting-checker raw-html https://www.fritz-berger.de/ -d desktop -s
prevetting-checker raw-html https://www.fritz-berger.de/ -d mobile -s
prevetting-checker compare-html https://www.fritz-berger.de/
prevetting-checker compare-html https://www.fritz-berger.de/zelte/campingzelte/
prevetting-checker compare-html https://www.fritz-berger.de/artikel/berger-kiwi-nz-kuppelzelt-fuer-3-personen-389672
prevetting-checker headers https://www.fritz-berger.de/ -s
prevetting-checker headers https://www.fritz-berger.de/artikel/berger-kiwi-nz-kuppelzelt-fuer-3-personen-389672 -s
prevetting-checker check-ssr https://www.fritz-berger.de/artikel/berger-kiwi-nz-kuppelzelt-fuer-3-personen-389672 -d mobile -s
prevetting-checker check-images https://www.fritz-berger.de/ -d mobile -s
prevetting-checker check-images https://www.fritz-berger.de/zelte/campingzelte/ -d mobile -s
prevetting-checker check-filters https://www.fritz-berger.de/zelte/campingzelte/ -d desktop -s
prevetting-checker check-nav https://www.fritz-berger.de/zelte/campingzelte/ https://www.fritz-berger.de/artikel/berger-kiwi-nz-kuppelzelt-fuer-3-personen-389672 -s
prevetting-checker full-check https://www.fritz-berger.de/ -m -s
```

Also worth running the same on `https://www.fritz-berger.at/` (worst-performing sister) and `https://www.berger-camping.ch/` to confirm Speed Kit parity.
