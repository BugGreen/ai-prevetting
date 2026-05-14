import { detectThirdPartyDomains } from '../../commands/discover-phase1/third-party';

describe('detectThirdPartyDomains', () => {
  it('extracts external domains from script, link, and img tags', () => {
    const html = `
      <html>
        <head>
          <script src="https://cdn.cookielaw.org/sdk.js"></script>
          <script src="https://cdn.cookielaw.org/other.js"></script>
          <link href="https://fonts.googleapis.com/css?family=Open+Sans" rel="stylesheet">
        </head>
        <body>
          <img src="https://cdn.example-cdn.com/hero.jpg">
          <script src="/local/app.js"></script>
        </body>
      </html>
    `;

    const result = detectThirdPartyDomains(html, 'https://www.example.com');

    expect(result.domains.length).toBe(3);

    const cookielaw = result.domains.find(d => d.domain === 'cdn.cookielaw.org');
    expect(cookielaw).toBeDefined();
    expect(cookielaw!.count).toBe(2);
    expect(cookielaw!.types).toContain('script');

    const fonts = result.domains.find(d => d.domain === 'fonts.googleapis.com');
    expect(fonts).toBeDefined();
    expect(fonts!.types).toContain('link');
  });

  it('returns empty domains array when no external resources exist', () => {
    const html = '<html><head></head><body><script src="/app.js"></script></body></html>';

    const result = detectThirdPartyDomains(html, 'https://www.example.com');

    expect(result.domains).toEqual([]);
  });
});
