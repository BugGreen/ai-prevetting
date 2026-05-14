# Speed Kit Pre-Vetting - Step 2

**Website:** {{URL}}

---

## Context

This is Step 2 of the Pre-Vetting process. You have received the Step 1 report as context (pasted or as file). Step 1 was done with the Chrome Extension which has limitations:

- Cannot read raw HTML responses or response headers
- Cannot do device emulation (Mobile vs Desktop)
- Cannot bypass ServiceWorkers

Step 2 uses the **prevetting-checker CLI toolkit** which connects to Chrome via CDP on port 9222 to verify and extend the findings.

---

## Your Task

1. Run `npx ts-node src/cli.ts full-check --import-phase1 output/fritz-berger-prevetting-step1.md -s --skip-wpt` to perform all CDP-based checks using the Step 1 report as input
2. Combine the Step 1 findings with the new CDP-verified results
3. Generate a final comprehensive report

---

## Checklist (CDP-Verified)

### Hard vs. Soft Navigations
- Does the site use Soft Navigations (SPA)?
- Verify with actual navigation tests, not just JS detection

### SSR Detection
- Is content in raw HTML or client-rendered?
- Check raw HTML response, not rendered DOM

### Mobile vs Desktop HTML
- Does the server deliver different HTML?
- Report structural differences if found

### Image Optimization
- Are images optimized (WebP, AVIF)?
- Check response headers/content types
- Identify lazy loading issues on above-the-fold content

### CSP (Content Security Policy)
- Are HTMLs served with CSP headers?
- Report policy if present

### Response Headers
- CDN detection
- Cache-Control settings
- Security headers

---

## Output Format

Generate a **final consolidated report** following this exact structure. Do NOT invent new sections or rearrange the order. Every section marked REQUIRED must be present.

---

### Header (REQUIRED)

```markdown
# Speed Kit Pre-Vetting Report: {domain}

**Date:** YYYY-MM-DD
**Steps Completed:** 1 (Initial Check) + 2 (CDP Verification)
**Analyst:** Claude (Step 1 + Step 2 CDP Verification)
**URL:** https://...
**Status:** Ready for Speed Kit Integration | Needs Further Review
```

---

### 1. Executive Summary (REQUIRED)

Write a concise technical paragraph (3-5 sentences) summarizing:
- What the site is and what platform/framework it uses
- Whether Speed Kit is a good fit and why
- The primary opportunity (e.g. "mobile TTFB which is in Needs Improvement territory")
- One key recommendation

**Do NOT use a Fit/Risk/Impact assessment table.** Keep it technical and concrete.

Example:
> fritz-berger.de is a traditional Multi-Page Application (MPA) with server-side rendering running on a custom etailer-based e-commerce platform. The site already has Speed Kit installed but shows optimization potential, particularly for mobile TTFB which is in "Needs Improvement" territory in CrUX data. All Core Web Vitals are passing, making this a good Speed Kit candidate.
>
> **Key Recommendation:** Speed Kit can significantly improve mobile TTFB (currently 800-1100ms p75) through edge caching. HTML cache variations needed for Mobile vs Desktop due to server-side device detection.

---

### 2. Summary Table (REQUIRED)

CDP-verified results in compact form. Use exactly these columns:

```markdown
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
```

Include additional rows as needed (CDN, Speed Kit status, ServiceWorkers, A/B Testing, etc.).

---

### 3. Step 2 CDP-Verified Findings (REQUIRED)

Group ALL CDP findings under this one section with numbered subsections. Do NOT scatter them as separate top-level sections.

#### 3.1 Hard vs. Soft Navigations

Table with navigation paths tested, type, document requests, evidence.

#### 3.2 SSR Verification (Raw HTML Analysis)

Table with raw HTML size, text content, rendered HTML size, SSR ratio. State confidence level and evidence.

#### 3.3 Mobile vs Desktop HTML Comparison

Table with Mobile vs Desktop metrics (TTFB, HTML size, lines changed). List structural differences. State whether cache variations are needed.

#### 3.4 Image Optimization

Format distribution table (WebP, AVIF, JPEG, PNG, SVG with count + %). Payload size, lazy loading stats, ATF issues. Note the image CDN used.

#### 3.5 CSP Headers

Full header value. Assessment of Speed Kit compatibility. List other security headers (HSTS, X-Frame-Options, Cache-Control, Server, Content-Encoding).

#### 3.6 Consent-Based Script Differences

State consent tool used, implementation type (client-side/server-side), whether raw HTML changes with consent. State whether cache variations are needed.

Include additional subsections (3.7, 3.8...) only if relevant checks were performed (e.g. PLP Filters).

---

### 4. Page Types Found (REQUIRED)

```markdown
| Page Type | URL Pattern | Navigation | SSR |
|-----------|-------------|------------|-----|
| Homepage | `/` | Hard | Yes |
| Category/PLP | `/category/` | Hard | Yes |
| ... | ... | ... | ... |
```

---

### 5. Tech Stack (REQUIRED)

```markdown
| Component | Value | CDP-Verified |
|-----------|-------|--------------|
| E-commerce Platform | ... | Yes/No |
| CDN | ... | Yes (headers) |
| Frontend Framework | ... | Yes |
| ... | ... | ... |
```

Use the `CDP-Verified` column to show what was actually verified vs. taken from Step 1.

---

### 6. Performance Data (REQUIRED if available)

Combine CrUX field data and CDP lab measurements in one section.

**CrUX (Mobile):** Table with LCP, INP, CLS, TTFB — p75 value + rating.
**CrUX (Desktop):** Same table.
**CDP-Measured TTFB:** Table with page, device, TTFB from lab tests.

If CrUX data is not available, state that explicitly.

---

### 7. Key Findings for Speed Kit (REQUIRED)

Numbered list of findings, grouped by importance. Each finding should be a short paragraph explaining the what, why, and recommendation.

Example structure:
1. **Primary Opportunity: Mobile TTFB** — ...
2. **HTML Cache Variations Required** — ...
3. **Store Personalization** — ...
4. **PLP Filters are Session-Based** — ...

---

### 8. DataLayer Properties for Speed Kit Tracking (REQUIRED if relevant)

```markdown
| Property | Description | Example |
|----------|-------------|---------|
| `category` | Page breadcrumb | "Home > Tents" |
| `platform` | Device type | "desktop" |
| ... | ... | ... |
```

If no relevant DataLayer was found, state "No relevant DataLayer properties detected" and omit the table.

---

### 9. Speed Kit Scope Recommendations (REQUIRED)

Two subsections:

**Good Candidates for Acceleration:**
- List of page types with reasoning

**Exclude from Speed Kit / Careful Handling:**
- List of page types with reason (user-specific, dynamic, etc.)

---

### 10. Items Verified via CDP (REQUIRED)

Compact summary table of everything that was actually checked:

```markdown
| Item | Method | Result |
|------|--------|--------|
| Navigation Type | `check-nav` command | Hard (MPA) |
| SSR Content | `check-ssr` command | Yes, 89% SSR |
| Mobile vs Desktop HTML | `compare-html` command | Different, variations needed |
| Image Formats | `check-images` command | 84% WebP |
| CSP Headers | `headers` command | Permissive CSP present |
| Consent Scripts | Raw HTML analysis | Client-side only |
```

---

### 11. Conclusion (REQUIRED)

Short paragraph stating whether the site is a good Speed Kit candidate, followed by a numbered list of key configuration requirements and recommendations.

---

### Footer (REQUIRED)

```markdown
---

*Report generated by Speed Kit Pre-Vetting Analysis Tool*
*Step 1: Initial Analysis | Step 2: CDP Verification Complete*
```

---

## Additional Sections (Beta)

> The following sections are **optional** and provide additional context beyond the core report. Include them after the Footer, separated by the "(Beta)" heading. They add value but are not part of the established report format.

### Topic Coverage Comparison (Beta)

Three tables showing which topics were verified by Step 1 only, Step 2 only, or both steps. Helps identify gaps and authoritative sources for each finding.

```markdown
| Topic | Step 1 Finding | Step 2 Status |
|-------|----------------|---------------|
```

### Speed Kit Value Proposition (Beta)

Before/after comparison table showing current metrics vs. expected metrics with Speed Kit. Include primary and secondary benefits.

```markdown
| Benefit | Current | With Speed Kit | Impact |
|---------|---------|----------------|--------|
| TTFB | Xms | ~Yms | High/Medium/Low |
```

### Recommended Implementation (Beta)

Phased implementation plan (Phase 1: Preparation, Phase 2: Core Setup, Phase 3: Optimization). Keep each phase to 3-5 bullet points.

### Risk Assessment (Beta)

```markdown
| Risk | Level | Mitigation |
|------|-------|------------|
| Bot Protection | 🟢 None / 🟡 Medium / 🔴 High | ... |
```

### Action Items for Customer (Beta)

Numbered list of concrete actions the customer should take before or alongside Speed Kit integration.

---

## Instructions

1. Run `full-check` command first
2. Compare results with Step 1 report
3. Generate report following the **exact section structure** above
4. Do NOT rearrange, rename, or merge sections
5. Do NOT invent new top-level sections outside this template
6. Highlight any discrepancies between Step 1 and Step 2 within the relevant subsection of "CDP-Verified Findings"
7. Be technical and thorough — prefer concrete data over generic assessments
