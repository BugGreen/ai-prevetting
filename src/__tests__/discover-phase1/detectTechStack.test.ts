import { detectTechStack } from '../../commands/discover-phase1/tech-stack';

describe('detectTechStack', () => {
  it('detects Next.js from __NEXT_DATA__ script tag in HTML', () => {
    const html = '<html><script id="__NEXT_DATA__" type="application/json">{}</script></html>';

    const result = detectTechStack(html, {});

    expect(result['Framework']).toContain('Next.js');
  });

  it('detects CDN from response headers', () => {
    const result = detectTechStack('', { 'cf-ray': '8abc123-LHR' });

    expect(result['CDN']).toContain('Cloudflare');
  });

  it('detects Shopify CMS from window.Shopify in HTML', () => {
    const html = '<script>window.Shopify = { shop: "example.myshopify.com" };</script>';

    const result = detectTechStack(html, {});

    expect(result['CMS']).toContain('Shopify');
  });

  it('accumulates multiple values per category — Next.js page also reports React', () => {
    // Next.js pages always include data-reactroot alongside __NEXT_DATA__
    const html = '<html data-reactroot><script id="__NEXT_DATA__" type="application/json">{}</script></html>';

    const result = detectTechStack(html, {});

    expect(result['Framework']).toContain('Next.js');
    expect(result['Framework']).toContain('React');
    expect(result['Framework'].length).toBe(2);
  });

  it('uses raw header value for x-powered-by (useRawValue)', () => {
    const result = detectTechStack('', { 'x-powered-by': 'PHP/8.2' });

    expect(result['Server']).toContain('PHP/8.2');
  });

  it('deduplicates — does not push the same value twice for a category', () => {
    // Both 'server: cloudflare' and 'cf-ray' map to CDN: Cloudflare
    const result = detectTechStack('', {
      'cf-ray': '8abc123-LHR',
      'server': 'cloudflare',
    });

    expect(result['CDN'].filter((v: string) => v === 'Cloudflare')).toHaveLength(1);
  });

  it('ignores tech markers placed after the first 250,000 characters', () => {
    const padding = 'x'.repeat(250_000);
    const html = padding + '<script id="__NEXT_DATA__" type="application/json">{}</script>';

    const result = detectTechStack(html, {});

    expect(result['Framework']).toBeUndefined();
  });

  it('skips useRawValue header values longer than 100 characters', () => {
    const longValue = 'A'.repeat(101);
    const result = detectTechStack('', { 'x-powered-by': longValue });

    expect(result['Server']).toBeUndefined();
  });

  // ── Extended registry tests ─────────────────────────────────────────────────

  it('detects personalization engines from HTML signals', () => {
    const html = '<script src="https://cdn.epoq.de/assets/shop/epoq-inspire.live.js"></script>' +
      '<script>window.Nosto = {};</script>';

    const result = detectTechStack(html, {});

    expect(result['Personalization']).toContain('Epoq');
    expect(result['Personalization']).toContain('Nosto');
  });

  it('detects consent management platforms from HTML signals', () => {
    const html = '<script src="https://cdn.cookielaw.org/scripttemplates/otSDKStub.js"></script>';

    const result = detectTechStack(html, {});

    expect(result['Consent']).toContain('OneTrust');
  });

  it('detects RUM/APM tools from HTML signals', () => {
    const html = '<script>window.DD_RUM && window.DD_RUM.init({});</script>' +
      '<script src="https://www.clarity.ms/tag/abc123"></script>';

    const result = detectTechStack(html, {});

    expect(result['RUM/APM']).toContain('Datadog');
    expect(result['RUM/APM']).toContain('Microsoft Clarity');
  });

  it('detects search providers from HTML signals', () => {
    const html = '<script src="https://c.searchhub.io/9Z7HgHCCz"></script>';

    const result = detectTechStack(html, {});

    expect(result['Search']).toContain('SearchHub');
  });
});
