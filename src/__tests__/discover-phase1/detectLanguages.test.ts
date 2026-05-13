import { detectLanguages } from '../../commands/discover-phase1/languages';

describe('detectLanguages', () => {
  it('detects html lang attribute and hreflang tags', () => {
    const html = `
      <html lang="de">
        <head>
          <link rel="alternate" hreflang="de" href="https://www.example.de/">
          <link rel="alternate" hreflang="en" href="https://www.example.com/">
          <link rel="alternate" hreflang="fr" href="https://www.example.fr/">
        </head>
      </html>
    `;

    const result = detectLanguages(html);

    expect(result.htmlLang).toBe('de');
    expect(result.hreflangTags).toHaveLength(3);
    expect(result.hreflangTags[0]).toEqual({ lang: 'de', href: 'https://www.example.de/' });
    expect(result.hreflangTags[2]).toEqual({ lang: 'fr', href: 'https://www.example.fr/' });
  });

  it('returns null htmlLang and empty hreflangTags when no language info exists', () => {
    const html = '<html><head></head><body></body></html>';

    const result = detectLanguages(html);

    expect(result.htmlLang).toBeNull();
    expect(result.hreflangTags).toEqual([]);
  });
});
