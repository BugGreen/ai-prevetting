# Speed Kit Pre-Vetting Skill (Parallel Agents)

## WICHTIGE EINSCHRÄNKUNGEN

**VERBOTEN - Diese Tools dürfen NICHT verwendet werden:**
- ❌ `mcp__playwright__*` - KEIN Playwright MCP
- ❌ `mcp__MCP_DOCKER__*` - KEIN MCP Docker
- ❌ `WebFetch` - KEIN WebFetch Tool
- ❌ `plugin-testing-suite:playwright-server` - KEINE Playwright Server

**ERLAUBT - NUR diese Tools verwenden:**
- ✅ `Bash` - curl, npx ts-node, etc.
- ✅ `Read` / `Write` - Dateien lesen/schreiben
- ✅ `Grep` / `Glob` - Suchen

**Agenten müssen diese Einschränkungen in ihrem Prompt erhalten!**

---

## PHASE 1: Setup

### 1.1 User-Datei lesen & Step 1 Context extrahieren
Der User hat eine .md Datei als Argument übergeben: `$ARGUMENTS`
Lies diese Datei und extrahiere:
- **URL** (die zu untersuchende Website)
- **Step 1 Key Findings** als Kontext für die Agenten (zusammenfassen):
  - Locale/Markets (z.B. `/de-de`, `/gb-en` — path-based oder subdomain?)
  - Consent Provider (z.B. CookieYes, OneTrust, Custom)
  - A/B Testing Tool (z.B. AB Tasty, Optimizely)
  - Bekannte Page Types und URL-Patterns
  - CrUX-Daten inkl. Trends (regressing/improving)
  - Bekannte Tech Stack Infos
  - Alle Items die "Need Step 2 CDP Verification" markiert sind

Speichere diesen Kontext als `STEP1_CONTEXT` Variable (kompakter Text-Block, max 500 Wörter).

### 1.2 Variablen vorbereiten
- `URL` = extrahierte URL (mit https://)
- `DOMAIN` = Domain ohne www. (z.B. `shop-shimamura.com`)
- `URL_ENCODED` = URL-encoded für API calls
- `STEP1_CONTEXT` = Zusammenfassung der Step 1 Findings

### 1.3 Chrome prüfen & starten
Prüfe ob Chrome auf Port 9222 läuft:
```bash
curl -s http://localhost:9222/json/version
```
Falls nicht, starte Chrome automatisch mit separatem Profil (läuft parallel zu normaler Chrome-Instanz):
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chrome-debug-profile" \
  --no-first-run \
  --no-default-browser-check \
  about:blank &
sleep 2
curl -s http://localhost:9222/json/version
```
Falls Chrome nach Start nicht auf Port 9222 antwortet, informiere den User.

---

## PHASE 2: Parallele Agenten starten

**KRITISCH: Nutze das Task-Tool um ALLE 5 Agenten in EINER Nachricht parallel zu starten!**

Starte diese 5 Agenten **gleichzeitig** (ein Tool-Call pro Agent, alle in derselben Nachricht):

### Agent 1: CDP Raw Analysis
```
subagent_type: "general-purpose"
prompt: |
  **WICHTIG: Nutze NUR Bash-Befehle. KEINE MCP Tools, KEIN WebFetch, KEIN Playwright!**

  Du analysierst {{URL}} via CDP Tools.

  Step 1 Context: {{STEP1_CONTEXT}}

  Working Directory: . (project root)

  Führe diese Befehle aus:
  1. npx ts-node src/cli.ts raw-html "{{URL}}" -d desktop -s
  2. npx ts-node src/cli.ts raw-html "{{URL}}" -d mobile -s
  3. npx ts-node src/cli.ts compare-html "{{URL}}"
  4. npx ts-node src/cli.ts headers "{{URL}}" -d desktop -s
  5. npx ts-node src/cli.ts check-ssr "{{URL}}" -s

  Falls CDP fehlschlägt, nutze curl als Fallback:
  curl -sL -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" "{{URL}}"
  curl -sI -A "Mozilla/5.0" "{{URL}}" (für Headers)

  Speichere Ergebnisse in: output/{{DOMAIN}}/cdp-results.md

  Format:
  ## CDP Analysis Results
  ### Raw HTML Desktop
  - Size: X KB
  - SSR Content: Yes/No
  - Key findings: ...

  ### Raw HTML Mobile
  - Size: X KB
  - Differences to Desktop: ...

  ### Response Headers
  - CSP: Yes/No (details)
  - Cache-Control: ...
  - Server: ...

  ### SSR Check
  - Result: ...
```

### Agent 2: CrUX & Performance
```
subagent_type: "general-purpose"
prompt: |
  **WICHTIG: Nutze NUR Bash-Befehle (curl). KEINE MCP Tools, KEIN WebFetch!**

  Du holst CrUX/Performance-Daten für {{URL}} via PageSpeed Insights API.

  Step 1 Context: {{STEP1_CONTEXT}}

  **Nutze die keyless PSI API** (kein Auth-Setup nötig).

  **Fetch BEIDE: URL-level UND origin-level Daten** (können sich stark unterscheiden):

  Mobile:
  ```bash
  curl -s "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url={{URL_ENCODED}}&strategy=mobile&category=performance" \
    -o /tmp/psi_mobile.json
  ```

  Desktop:
  ```bash
  curl -s "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url={{URL_ENCODED}}&strategy=desktop&category=performance" \
    -o /tmp/psi_desktop.json
  ```

  Falls eine Response einen `error` Key enthält (z.B. Quota), warte kurz und probiere erneut.

  Extrahiere aus der JSON Response:
  - **loadingExperience** (URL-level CrUX):
    - metrics.LARGEST_CONTENTFUL_PAINT_MS
    - metrics.INTERACTION_TO_NEXT_PAINT
    - metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE
    - metrics.EXPERIMENTAL_TIME_TO_FIRST_BYTE
    - overall_category
  - **originLoadingExperience** (origin-level CrUX):
    - Same metrics as above (WICHTIG: kann signifikant abweichen!)
  - **lighthouseResult.audits** (Lighthouse lab data):
    - first-contentful-paint, largest-contentful-paint
    - total-blocking-time, cumulative-layout-shift
    - speed-index, server-response-time

  **Vergleiche URL-level vs origin-level** — Unterschiede dokumentieren.
  **Vergleiche mit Step 1 Daten** — Trends (regressing/improving) übernehmen.

  Bewerte: Hat der Kunde ein TTFB-Problem? (Speed Kit hilft hier am meisten)

  Speichere in: output/{{DOMAIN}}/crux-results.md

  Format:
  ## CrUX Performance Data

  ### URL-Level CrUX ({{URL}})
  | Metric | Mobile p75 | Mobile Status | Desktop p75 | Desktop Status |
  |--------|------------|---------------|-------------|----------------|
  | LCP    | X.Xs       | Good/NI/Poor  | X.Xs        | Good/NI/Poor   |
  | INP    | X ms       | Good/NI/Poor  | X ms        | Good/NI/Poor   |
  | CLS    | X.XX       | Good/NI/Poor  | X.XX        | Good/NI/Poor   |
  | TTFB   | X ms       | Good/NI/Poor  | X ms        | Good/NI/Poor   |

  ### Origin-Level CrUX ({{DOMAIN}})
  [Same table]

  ### URL vs Origin Comparison
  [Note significant differences]

  ### Lighthouse Lab Data
  [Table with lab metrics]

  ### Comparison with Step 1 Data
  [Table showing changes/trends]

  ### TTFB Analysis
  - Problem: Yes/No
  - URL-level: X ms
  - Origin-level: X ms
  - Speed Kit opportunity: ...
```

### Agent 3: Tech Stack & Locale Detection
```
subagent_type: "general-purpose"
prompt: |
  **WICHTIG: Nutze NUR Bash-Befehle (curl, grep). KEINE MCP Tools, KEIN Playwright, KEIN WebFetch!**

  Du analysierst den Tech Stack UND die Locale/Market-Struktur von {{URL}}.

  Step 1 Context: {{STEP1_CONTEXT}}

  Working Directory: . (project root)

  1. HTML herunterladen und analysieren:
     curl -sL -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" "{{URL}}" > /tmp/techstack.html

  2. Im HTML suchen nach:
     - grep -i "__NEXT_DATA__\|_next/" /tmp/techstack.html (Next.js)
     - grep -i "__NUXT__\|_nuxt/" /tmp/techstack.html (Nuxt)
     - grep -i "ng-server-context\|app-root\|_ngcontent\|angular" /tmp/techstack.html (Angular)
     - grep -i "react\|__REACT" /tmp/techstack.html (React)
     - grep -i "vue\|__vue" /tmp/techstack.html (Vue)
     - grep -i "shopify\|cdn.shopify" /tmp/techstack.html (Shopify)
     - grep -i "magento\|mage-" /tmp/techstack.html (Magento)
     - grep -i "cx-storefront\|cx-page\|spartacus\|hybris\|x-sap" /tmp/techstack.html (SAP Spartacus)
     - grep -i "googletagmanager\|GTM-\|dataLayer" /tmp/techstack.html (GTM)
     - grep -i "algolia\|algoliasearch" /tmp/techstack.html (Algolia)
     - grep -i "abtasty\|optimizely\|vwo\|kameleoon" /tmp/techstack.html (A/B Testing)
     - grep -i "cookieyes\|onetrust\|didomi\|cookiebot\|usercentrics\|consent" /tmp/techstack.html (Consent)
     - grep -i "serviceWorker\|workbox" /tmp/techstack.html (Service Worker)
     - grep -i "speed-kit\|speedkit\|baqend" /tmp/techstack.html (Speed Kit)

  3. Headers analysieren:
     curl -sI "{{URL}}" | grep -iE "server|x-powered|cf-ray|x-amz|akamai|x-sap|cache-control|vary|set-cookie"

  4. DNS Check für CDN:
     dig +short www.{{DOMAIN}} | head -3
     dig +short {{DOMAIN}} | head -3

  5. **LOCALE/MARKET ANALYSIS** (WICHTIG für Cache-Keying):
     a. Suche nach hreflang Tags:
        grep -i "hreflang" /tmp/techstack.html | head -30
     b. Suche nach locale path patterns in Links:
        grep -oP 'href="(/[a-z]{2}(-[a-z]{2})?/)[^"]*"' /tmp/techstack.html | sort -u | head -30
     c. Suche nach locale-Konfiguration im HTML/JS:
        grep -iE "locale|language|country|region|baseSite|data-site" /tmp/techstack.html | head -20
     d. Suche nach locale-Switcher/Selector:
        grep -iE "language-selector\|locale-selector\|country-selector\|site-selector" /tmp/techstack.html | head -10
     e. Teste 2-3 Locale-Varianten (falls gefunden):
        curl -sI "{{URL}}/de-de/" 2>/dev/null | head -5
        curl -sI "{{URL}}/gb-en/" 2>/dev/null | head -5
     f. Prüfe ob Subdomains oder separate Domains für Regionen:
        dig +short de.{{DOMAIN}} 2>/dev/null | head -1

  6. Dokumentiere:
     - E-commerce Platform
     - CDN Provider
     - Frontend Framework
     - SSR Status
     - Analytics/Tag Manager (zähle GTM Container IDs!)
     - Search Provider
     - A/B Testing Tool
     - Consent Manager (ALLE Consent-Tools, auch wenn via GTM geladen)
     - Bot Protection (Akamai: _abck, bm_sz; CF Bot Management; DataDome; PerimeterX)
     - Payment/BNPL
     - **Locale/Market Structure:**
       - Routing type: path-based (/de-de/) vs subdomain (de.example.com) vs separate domain
       - Number of active locales
       - Cache-Keying implication: what dimension(s) must be in cache key?

  Speichere in: output/{{DOMAIN}}/techstack-results.md
```

### Agent 4: Navigation & Page Types
```
subagent_type: "general-purpose"
prompt: |
  **WICHTIG: Nutze NUR Bash-Befehle und CDP CLI Tools. KEINE MCP Tools, KEIN Playwright!**

  Du analysierst Navigation und Page Types für {{URL}}.

  Step 1 Context: {{STEP1_CONTEXT}}

  Working Directory: . (project root)

  1. Homepage HTML laden:
     curl -sL "{{URL}}" > /tmp/homepage.html

  2. Links extrahieren und Page Types finden:
     grep -oP 'href="[^"]*"' /tmp/homepage.html | sort -u | head -80

     Suche nach typischen Patterns:
     - PLP: /category/, /collection/, /shop/, /c/, /pc/
     - PDP: /product/, /item/, /p/, /dp/
     - Search: /search, ?q=, ?query=
     - Cart: /cart, /basket, /warenkorb
     - Campaign/Landing: /campaigns/, /promo/
     Nutze auch die Page Types aus dem Step 1 Context falls vorhanden.

  3. **TESTE MINDESTENS 5-8 NAVIGATION-PFADE mit CDP:**
     Verschiedene Kombinationen testen:
     a. Homepage → PLP (Kategorie-Seite)
     b. Homepage → PDP (Produkt-Seite, falls direkt verlinkt)
     c. PLP → PDP (Produktliste zu Produkt)
     d. PLP → PLP (zwischen Kategorien)
     e. PDP → PDP (zwischen Produkten)
     f. Homepage → Cart
     g. Homepage → Search oder andere Page Types
     h. PDP → Buy/Add-to-Cart Page (falls vorhanden)

     Für jeden Pfad:
     npx ts-node src/cli.ts check-nav "<from-url>" "<to-url>"

     WICHTIG: Teste genug Pfade um sicher zu sagen ob ALLE navigations hard sind
     oder ob es mixed (hard+soft) Verhalten gibt. Bei SPAs können bestimmte
     Übergänge soft sein und andere hard.

  4. Prüfe auf Speculation Rules im HTML:
     grep -i "speculationrules" /tmp/homepage.html

  5. Prüfe Preload/Prefetch:
     grep -iE 'rel="preload"|rel="prefetch"|rel="preconnect"' /tmp/homepage.html | head -10

  6. Query Parameters dokumentieren:
     grep -oP '\?[^"]*' /tmp/homepage.html | sort -u | head -20

  Speichere in: output/{{DOMAIN}}/navigation-results.md

  Format:
  ## Navigation Analysis Results
  ### Page Types Found
  | # | Navigation Path | Type | Navigation Type | Duration |
  |---|----------------|------|-----------------|----------|
  | 1 | Homepage → PLP | ... | Hard/Soft | Xms |
  | 2 | PLP → PDP | ... | Hard/Soft | Xms |
  ... (mindestens 5-8 Einträge)

  ### Navigation Summary
  [ALL HARD / ALL SOFT / MIXED — mit Erklärung]

  ### Speculation Rules: Yes/No
  ### Preload/Prefetch: ...
  ### Query Parameters: ...

  ### URL Structure
  | Type | URL Pattern | Example |
  |------|-------------|---------|
  (alle gefundenen Page Types mit URL-Patterns)
```

### Agent 5: Filters, CSP & Consent
```
subagent_type: "general-purpose"
prompt: |
  **WICHTIG: Nutze NUR Bash-Befehle und CDP CLI Tools. KEINE MCP Tools, KEIN Playwright!**

  Du analysierst PLP Filters, CSP und Bot Protection für {{URL}}.

  Step 1 Context: {{STEP1_CONTEXT}}

  Working Directory: . (project root)

  1. PLP Filter Check:
     - Finde eine PLP URL im Homepage HTML (nutze Step 1 Context für bekannte PLP-URLs)
     - Teste ob Filter URL-basiert sind:
       a. Lade PLP mit und ohne Filter-Parameter und vergleiche:
          curl -sL "{{URL}}<plp-path>" > /tmp/plp1.html
          curl -sL "{{URL}}<plp-path>?sort=newest" > /tmp/plp2.html
          md5sum /tmp/plp1.html /tmp/plp2.html
          diff /tmp/plp1.html /tmp/plp2.html | head -30
       b. Nutze CDP Tool für live-Browser Test:
          npx ts-node src/cli.ts check-filters "<plp-url>" -s
     - Dokumentiere: Sind Filter URL-basiert (pushState/query params) oder session-basiert?
     - Ist die SSR-Shell identisch mit/ohne Filter-Params?

  2. CSP & Security Headers:
     curl -sI "{{URL}}" | grep -iE "content-security|x-frame|strict-transport|x-content-type|x-xss|permissions-policy"

  3. Cache Headers (Homepage UND PLP):
     curl -sI "{{URL}}" | grep -iE "cache-control|pragma|expires|etag|age|cf-cache|vary"
     curl -sI "{{URL}}<plp-path>" | grep -iE "cache-control|cf-cache|age|vary"

  4. Bot Protection Detection:
     curl -sI "{{URL}}" | grep -iE "akamai|cloudflare|datadome|perimeterx|incapsula"
     curl -s "{{URL}}" | grep -iE "_abck|bm_sz|cf_|__cf|px_|datadome|cf_clearance" | head -5

  5. Consent Banner Check (UMFASSEND — alle gängigen CMPs prüfen):
     curl -s "{{URL}}" | grep -iE "onetrust|didomi|cookiebot|cookieyes|cookie-yes|usercentrics|trustarc|quantcast|consent|gdpr|cookie-popup|cookie-banner|cookie-notice" | head -15
     WICHTIG: Manche CMPs werden via GTM/JS nachgeladen und sind NICHT im raw HTML.
     Prüfe auch:
     - Script-Tags mit consent-bezogenen URLs
     - data-Attribute mit consent/cookie Bezug
     - Inline-JS das Consent-Logik enthält
     Dokumentiere ALLE gefundenen Consent-Tools, auch wenn sie nicht im raw HTML sind
     (z.B. "CookieYes loaded via GTM, not in raw HTML").

  6. Image Optimization Check:
     npx ts-node src/cli.ts check-images "{{URL}}" -s

  Speichere in: output/{{DOMAIN}}/filters-results.md

  Format:
  ## Filters, CSP & Consent Analysis
  ### PLP Filters: URL-based / Session-based
  (Methode: pushState/query params/session-based, SSR shell identical yes/no)
  ### CSP Headers: Present/Not Present
  (Full CSP value, Speed Kit compatibility assessment)
  ### Cache-Control: ...
  (Homepage + PLP cache headers, Vary header analysis)
  ### Bot Protection: Akamai/Cloudflare/None
  (Evidence: which detection methods found what)
  ### Consent Banner: Yes/No (Provider: ...)
  (ALL consent tools found, even if loaded via GTM. Note which are in raw HTML vs JS-loaded.)
  ### Image Optimization
  (Format distribution, lazy loading, LCP image config)
```

---

## PHASE 3: Ergebnisse zusammenführen

Warte bis ALLE 5 Agenten fertig sind, dann:

1. Lies alle Ergebnis-Dateien aus `output/{{DOMAIN}}/`
2. Lies die **Step 1 Report-Datei** nochmals (die User-Input Datei aus Phase 1.1)

3. Erstelle **Final Report** in `output/reports/{{DOMAIN}}-final-report.md`

**WICHTIGE REGELN für den Final Report:**

- **Folge exakt der Sektionsreihenfolge.** Keine Sektionen umbenennen, zusammenlegen oder neu erfinden.
- **Step 1 Daten integrieren:** Wenn der Step 1 Report CrUX-Trends enthält (regressing/improving), übernimm diese. Wenn Step 1 Locales/Markets dokumentiert hat, nutze diese Daten für die Locale-Sektion.
- **Quellen-Transparenz:** Bei jedem Finding angeben ob die Datenquelle CDP, curl oder Step 1 ist. Besonders wichtig wenn CDP und curl unterschiedliche Ergebnisse liefern (z.B. CDP check-ssr false negative → curl als autoritativ markieren).
- **Consent vollständig:** Alle Consent-Tools auflisten die gefunden wurden — auch wenn via GTM/JS geladen und nicht im raw HTML. Step 1 Report als zusätzliche Quelle nutzen.
- **Conclusion konkret:** Die Conclusion muss nummerierte, spezifische Konfigurationsanweisungen enthalten, nicht generische Empfehlungen.

```markdown
# Speed Kit Pre-Vetting Report: {{DOMAIN}}

**Date:** {{DATUM}}
**Steps Completed:** 1 (Initial Check) + 2 (CDP Verification)
**Analyst:** Claude (Step 1 + Step 2 CDP Verification)
**URL:** {{URL}}
**Status:** Ready for Speed Kit Integration | Needs Further Review

---

## Executive Summary

[Concise technical paragraph (3-5 sentences):
- What the site is and what platform/framework it uses
- Whether Speed Kit is a good fit and why
- The primary opportunity (e.g. TTFB, LCP)
- One key recommendation (specific, e.g. "TTFB reduction via edge HTML caching with SWR extending the 5-min cache")
Do NOT use a Fit/Risk/Impact assessment table.
Include locale/market implications if the site serves multiple regions.]

---

## Summary Table (CDP-Verified)

| Category | Finding | Details |
|----------|---------|---------|
| **Navigation Type** | Hard/Soft | CDP-verified: ... |
| **SPA Framework** | None / React / Vue / ... | ... |
| **SSR Status** | YES/NO | Raw HTML analysis: ... |
| **Mobile vs Desktop HTML** | Same/Different | Lines diff, structural or dynamic |
| **Image Optimization** | X% modern formats | WebP/AVIF breakdown |
| **CSP Headers** | YES/NO | Policy summary |
| **Consent Scripts** | Client-side/Server-side | Impact on HTML |
| **Bot Protection** | Type or None | Impact on testing |
| **TTFB (Desktop)** | Xms | Lab measurement |
| **TTFB (Mobile CrUX)** | Xms p75 | Field data |
| **Core Web Vitals** | All Passing / Failing | Which metrics fail |
| **Markets/Locales** | X regions | Routing type, cache-keying implication |
[Add rows as needed: CDN, Speed Kit status, ServiceWorkers, A/B Testing, etc.]

---

## Step 2 CDP-Verified Findings

[Group ALL CDP findings here with numbered subsections. Do NOT scatter as separate top-level sections.]

### 1. Hard vs. Soft Navigations
[Table: navigation paths tested, type, document requests, evidence]

### 2. SSR Verification (Raw HTML Analysis)
[Table: raw HTML size, text content, rendered HTML size, SSR ratio. Confidence + evidence.]

### 3. Mobile vs Desktop HTML Comparison
[Table: Mobile vs Desktop (TTFB, HTML size, lines changed). Structural differences. Cache variations needed?]

### 4. Image Optimization
[Format distribution table (WebP, AVIF, JPEG, PNG, SVG). Payload, lazy loading stats, ATF issues. Image CDN.]

### 5. CSP Headers
[Full header value. Speed Kit compatibility. Other security headers (HSTS, Cache-Control, Server).]

### 6. Consent-Based Script Differences
[Consent tool, implementation type, whether raw HTML changes. Cache variations needed?]

[Add 7, 8... only for additional checks performed, e.g. PLP Filters]

---

## Page Types Found

| Page Type | URL Pattern | Navigation | SSR |
|-----------|-------------|------------|-----|
| Homepage | `/` | Hard | Yes |
| ... | ... | ... | ... |

---

## Tech Stack

| Component | Value | CDP-Verified |
|-----------|-------|--------------|
| E-commerce Platform | ... | Yes/No |
| CDN | ... | Yes (headers) |
| Frontend Framework | ... | Yes |
| ... | ... | ... |

---

## Locale / Market Structure

[Include this section if the site serves multiple regions/languages. Skip if single-locale site.]

| Aspect | Finding |
|--------|---------|
| Routing Type | Path-based (`/de-de/`) / Subdomain (`de.example.com`) / Separate domain |
| Active Locales | X regions (list all found) |
| Cache-Keying | Cache key must include locale path prefix / subdomain |
| HTML Differences | Same HTML across locales (translated) / Different structure |

| Region | URL Pattern | Currency | Language |
|--------|-------------|----------|----------|
| US | `/` (default) | USD | en_US |
| ... | ... | ... | ... |

**Speed Kit Implication:** [How does the locale structure affect cache keying? Does it dilute CDN cache hit ratio? How many cache variants are needed?]

---

## Performance Data

**CrUX (Mobile):**
| Metric | p75 Value | Status |
|--------|-----------|--------|
| LCP | ... | Good/NI/Poor |
| INP | ... | Good/NI/Poor |
| CLS | ... | Good/NI/Poor |
| TTFB | ... | Good/NI/Poor |

**CrUX (Desktop):** [Same table]

**CDP-Measured TTFB:**
| Page | Device | TTFB |
|------|--------|------|
| Homepage | Desktop | Xms |
| ... | ... | ... |

[If CrUX not available, state explicitly.]

---

## Key Findings for Speed Kit

[Numbered list grouped by importance. Each finding: what, why, recommendation.]
1. **Primary Opportunity: ...** — ...
2. **...** — ...

---

## DataLayer Properties for Speed Kit Tracking

| Property | Description | Example |
|----------|-------------|---------|
| ... | ... | ... |

[If none found, state "No relevant DataLayer properties detected".]

---

## Speed Kit Scope Recommendations

**Good Candidates for Acceleration:**
- [Page types with reasoning]

**Exclude from Speed Kit / Careful Handling:**
- [Page types with reason]

---

## Items Verified via CDP

| Item | Method | Result |
|------|--------|--------|
| Navigation Type | `check-nav` | Hard (MPA) |
| SSR Content | `check-ssr` | Yes, X% SSR |
| Mobile vs Desktop HTML | `compare-html` | Same/Different |
| Image Formats | `check-images` | X% WebP |
| CSP Headers | `headers` | Present/Not set |
| Consent Scripts | Raw HTML analysis | Client-side only |

---

## Conclusion

[Short paragraph: is the site a good Speed Kit candidate?]

**Key Configuration Requirements:**

[Numbered list of CONCRETE, SPECIFIC configuration items. Not generic — each item must reference actual findings from the report. Examples of good items:
1. HTML caching with stale-while-revalidate (extend current max-age=X)
2. Cache key must include locale path prefix (/de-de/, /gb-en/ — X variants)
3. No device-type cache variation needed (identical mobile/desktop HTML)
4. No consent-based cache variation needed (consent scripts are client-side)
5. Include query parameters in cache key for PLP filter pages
6. Exclude: cart, checkout, account, SSO paths
7. Static asset acceleration for assets.example.com
8. Prefetch likely navigation targets (PLP→PDP, Homepage→Category)

Each item MUST reference specific evidence from the CDP verification.]

---

*Report generated by Speed Kit Pre-Vetting Analysis Tool*
*Step 1: Initial Analysis | Step 2: CDP Verification Complete*

---

## Additional Sections (Beta)

> Optional sections providing extra context. Include after Footer if data is available.

### Topic Coverage Comparison (Beta)
[Tables: topics verified by Step 1 only, Step 2 only, both, neither]

### Speed Kit Value Proposition (Beta)
| Benefit | Current | With Speed Kit | Impact |
|---------|---------|----------------|--------|
| TTFB | Xms | ~Yms | High/Medium/Low |

### Recommended Implementation (Beta)
[Phase 1: Preparation, Phase 2: Core Setup, Phase 3: Optimization. 3-5 bullets each.]

### Risk Assessment (Beta)
| Risk | Level | Mitigation |
|------|-------|------------|
| ... | 🟢/🟡/🔴 | ... |

### Action Items for Customer (Beta)
[Numbered list of concrete actions]
```

---

## PHASE 4: Execution Log erstellen

Erstelle **Execution Log** in `output/logs/{{DOMAIN}}-{{DATUM}}.md`:

```markdown
# Execution Log: {{DOMAIN}}

**Date:** {{DATUM}}
**URL:** {{URL}}
**Total Duration:** [Gesamtdauer von Phase 2 Start bis Phase 3 Ende]

---

## Agent Execution Summary

| Agent | Duration | Status | Issues |
|-------|----------|--------|--------|
| CDP Raw Analysis | Xs | ✅/❌ | ... |
| CrUX & Performance | Xs | ✅/❌ | ... |
| Tech Stack Detection | Xs | ✅/❌ | ... |
| Navigation & Page Types | Xs | ✅/❌ | ... |
| Filters, CSP & Consent | Xs | ✅/❌ | ... |

**Agents succeeded:** X/5
**Agents failed:** X/5

---

## Check Timings (from CDP Agent)

| Check | Duration | Status |
|-------|----------|--------|
| raw-html (desktop) | Xs | ✅/❌ |
| raw-html (mobile) | Xs | ✅/❌ |
| compare-html | Xs | ✅/❌ |
| headers | Xs | ✅/❌ |
| check-ssr | Xs | ✅/❌ |
| check-images | Xs | ✅/❌ |
| check-filters | Xs | ✅/❌ |

---

## Errors & Warnings

[List all errors/warnings from all agents. Include full error messages and workarounds used.]

- ❌ CDP: Could not read response body → Fallback to curl
- ...

---

## Fallbacks Used

| Original Method | Fallback | Reason |
|----------------|----------|--------|
| CDP raw-html | curl | Response body empty |
| ... | ... | ... |

---

## Notes for Next Run

- [Tool improvements needed]
- [Patterns observed]
- [Configuration changes suggested]
```

---

## WICHTIG

- **NUR BASH:** Agenten dürfen NUR Bash, Read, Write, Grep, Glob verwenden
- **KEIN MCP:** Keine mcp__playwright, mcp__MCP_DOCKER, WebFetch Tools!
- **Parallel:** Alle 5 Task-Tools in EINER Nachricht starten
- **Output:** Erstelle `output/{{DOMAIN}}/` Ordner wenn nicht vorhanden
- **Fallbacks:** CDP CLI → curl (dokumentiere welcher funktionierte)
- **Chrome:** Muss auf Port 9222 laufen für CDP Tools
