/**
 * languages.ts
 *
 * Detects language/locale configuration from rawHtml by parsing
 * <html lang> attribute and <link rel="alternate" hreflang> tags.
 *
 * Pure function — no CDP dependency.
 *
 * Conventions followed: docs/architecture/08-existing-conventions.md
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LanguageResult {
  htmlLang: string | null;
  hreflangTags: Array<{ lang: string; href: string }>;
}

// ─── Internals ───────────────────────────────────────────────────────────────

const HTML_LANG_PATTERN = /<html[^>]*\blang=["']([^"']+)["']/i;
const HREFLANG_PATTERN = /<link[^>]*\brel=["']alternate["'][^>]*\bhreflang=["']([^"']+)["'][^>]*\bhref=["']([^"']+)["']/gi;
const HREFLANG_PATTERN_ALT = /<link[^>]*\bhref=["']([^"']+)["'][^>]*\bhreflang=["']([^"']+)["'][^>]*\brel=["']alternate["']/gi;

// ─── Function ────────────────────────────────────────────────────────────────

/**
 * Detect language configuration from page HTML.
 *
 * Called by:
 *   - runPhase1Discovery(): after detectTechStack(), pure function
 */
export function detectLanguages(rawHtml: string): LanguageResult {
  // Extract <html lang="...">
  const langMatch = HTML_LANG_PATTERN.exec(rawHtml);
  const htmlLang = langMatch ? langMatch[1] : null;

  // Extract <link rel="alternate" hreflang="..." href="...">
  const hreflangTags: Array<{ lang: string; href: string }> = [];
  const seen = new Set<string>();

  // Try both attribute orderings
  for (const pattern of [HREFLANG_PATTERN, HREFLANG_PATTERN_ALT]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(rawHtml)) !== null) {
      const isAlt = pattern === HREFLANG_PATTERN_ALT;
      const lang = isAlt ? match[2] : match[1];
      const href = isAlt ? match[1] : match[2];
      const key = `${lang}|${href}`;
      if (!seen.has(key)) {
        seen.add(key);
        hreflangTags.push({ lang, href });
      }
    }
  }

  return { htmlLang, hreflangTags };
}
