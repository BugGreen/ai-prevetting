import { detectQueryParams } from '../../commands/discover-phase1/query-params';

describe('detectQueryParams', () => {
  it('detects known tracking parameters in href attributes', () => {
    const html = `
      <html><body>
        <a href="https://example.com/page?utm_source=google&utm_medium=cpc&gclid=abc123">Link</a>
        <a href="https://example.com/other?fbclid=xyz">FB Link</a>
      </body></html>
    `;

    const result = detectQueryParams(html);

    expect(result.trackingParams).toContain('utm_source');
    expect(result.trackingParams).toContain('utm_medium');
    expect(result.trackingParams).toContain('gclid');
    expect(result.trackingParams).toContain('fbclid');
  });

  it('returns empty array when no tracking parameters exist', () => {
    const html = '<html><body><a href="/about">About</a></body></html>';

    const result = detectQueryParams(html);

    expect(result.trackingParams).toEqual([]);
  });
});
