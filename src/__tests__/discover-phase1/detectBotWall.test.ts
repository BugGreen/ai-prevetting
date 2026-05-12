import { detectBotWall } from '../../commands/discover-phase1';

describe('detectBotWall', () => {
  it('detects a Cloudflare challenge page', async () => {
    const html = `
      <html>
        <head><title>Just a moment...</title></head>
        <body>
          <div class="cf-browser-verification">
            Checking if the site connection is secure
          </div>
          <input name="cf_chl_opt" type="hidden" value="abc123" />
        </body>
      </html>
    `;
    const result = await detectBotWall(html);
    expect(result.isWall).toBe(true);
    expect(result.type).toBe('cloudflare');
    expect(result.confidence).toBeDefined();
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it('detects a DataDome challenge page', async () => {
    const html = `
      <html>
        <body>
          <script src="https://geo.captcha-delivery.com/captcha/?initialCid=AHrl"></script>
          <p>Please complete the captcha to continue.</p>
        </body>
      </html>
    `;
    const result = await detectBotWall(html);
    expect(result.isWall).toBe(true);
    expect(result.type).toBe('datadome');
    expect(result.evidence).toContain('DataDome captcha delivery');
  });

  it('detects a generic bot wall by title', async () => {
    const html = `
      <html>
        <head><title>Access Denied</title></head>
        <body><p>You do not have permission to access this resource.</p></body>
      </html>
    `;
    const result = await detectBotWall(html);
    expect(result.isWall).toBe(true);
    expect(result.type).toBe('generic');
  });

  it('returns isWall=false for a clean product page', async () => {
    const html = `
      <html>
        <head><title>Camping Gear &mdash; Fritz Berger</title></head>
        <body>
          <main>
            <h1>Zelte &amp; Camping</h1>
            <div class="product-grid">
              <article class="product">
                <img src="/images/tent.webp" alt="2-person tent" loading="lazy" />
                <span itemprop="price">129.99</span>
              </article>
            </div>
          </main>
        </body>
      </html>
    `;
    const result = await detectBotWall(html);
    expect(result.isWall).toBe(false);
    expect(result.type).toBeNull();
    expect(result.evidence).toHaveLength(0);
  });
});
