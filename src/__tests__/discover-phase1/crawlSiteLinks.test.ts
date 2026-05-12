import { crawlSiteLinks } from '../../commands/discover-phase1/crawl';

const BASE_URL = 'https://example.com';

function makeClient(rawLinks: { href: string; text: string }[]) {
  // mockResolvedValue repeats forever — stabilization logic will call evaluate twice
  return {
    Runtime: {
      evaluate: jest.fn().mockResolvedValue({ result: { value: rawLinks } }),
    },
  };
}

describe('crawlSiteLinks', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('scores a PLP link correctly', async () => {
    const client = makeClient([
      { href: 'https://example.com/category/shoes', text: 'Shoes' },
    ]);

    const promise = crawlSiteLinks(client as any, BASE_URL);
    await jest.runAllTimersAsync();
    const links = await promise;

    expect(links).toHaveLength(1);
    expect(links[0].inferredType).toBe('plp');
    expect(links[0].score).toBeGreaterThanOrEqual(0.7);
    expect(links[0].text).toBe('Shoes');
  });

  it('scores a PDP link correctly', async () => {
    const client = makeClient([
      { href: 'https://example.com/product/running-shoe-x', text: 'Running Shoe X' },
    ]);

    const promise = crawlSiteLinks(client as any, BASE_URL);
    await jest.runAllTimersAsync();
    const links = await promise;

    expect(links).toHaveLength(1);
    expect(links[0].inferredType).toBe('pdp');
    expect(links[0].score).toBeGreaterThanOrEqual(0.4);
    expect(links[0].score).toBeLessThan(0.7);
  });

  it('excludes cart, checkout, and account links', async () => {
    const client = makeClient([
      { href: 'https://example.com/cart',             text: 'Cart' },
      { href: 'https://example.com/checkout',         text: 'Checkout' },
      { href: 'https://example.com/account/orders',   text: 'My Orders' },
      { href: 'https://example.com/category/jackets', text: 'Jackets' },
    ]);

    const promise = crawlSiteLinks(client as any, BASE_URL);
    await jest.runAllTimersAsync();
    const links = await promise;

    const hrefs = links.map((l: { href: string }) => l.href);
    expect(hrefs).not.toContain('https://example.com/cart');
    expect(hrefs).not.toContain('https://example.com/checkout');
    expect(hrefs).not.toContain('https://example.com/account/orders');
    expect(hrefs).toContain('https://example.com/category/jackets');
  });

  it('excludes external domain links', async () => {
    const client = makeClient([
      { href: 'https://facebook.com/examplestore',    text: 'Facebook' },
      { href: 'https://other-shop.com/sale',          text: 'Other Shop' },
      { href: 'https://example.com/collections/sale', text: 'Sale' },
    ]);

    const promise = crawlSiteLinks(client as any, BASE_URL);
    await jest.runAllTimersAsync();
    const links = await promise;

    expect(links).toHaveLength(1);
    expect(links[0].inferredType).toBe('plp');
  });

  it('retries when DOM returns no links (SPA hydration)', async () => {
    const plpLink = { href: 'https://example.com/category/shoes', text: 'Shoes' };
    const evaluate = jest.fn()
      .mockResolvedValueOnce({ result: { value: [] } })          // attempt 1: empty DOM
      .mockResolvedValueOnce({ result: { value: [plpLink] } })   // attempt 2: links appear
      .mockResolvedValueOnce({ result: { value: [plpLink] } });  // attempt 3: stable

    const promise = crawlSiteLinks(client({ Runtime: { evaluate } }) as any, BASE_URL);
    await jest.runAllTimersAsync();
    const links = await promise;

    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(links).toHaveLength(1);
    expect(links[0].inferredType).toBe('plp');
  });

  it('waits for DOM to stabilize — does not break on app shell links alone', async () => {
    // Simulates a CSR app: header nav (3 links) renders first, main content (5 links) hydrates later
    const appShell = [
      { href: 'https://example.com/', text: 'Home' },
      { href: 'https://example.com/about', text: 'About' },
      { href: 'https://example.com/contact', text: 'Contact' },
    ];
    const hydrated = [
      ...appShell,
      { href: 'https://example.com/category/shoes', text: 'Shoes' },
      { href: 'https://example.com/product/boot-x',  text: 'Boot X' },
    ];

    const evaluate = jest.fn()
      .mockResolvedValueOnce({ result: { value: appShell } })  // attempt 1: app shell only
      .mockResolvedValueOnce({ result: { value: hydrated } })  // attempt 2: main content loaded
      .mockResolvedValueOnce({ result: { value: hydrated } }); // attempt 3: stable

    const promise = crawlSiteLinks(client({ Runtime: { evaluate } }) as any, BASE_URL);
    await jest.runAllTimersAsync();
    const links = await promise;

    // Must not have broken at attempt 1 (3 links) — PLP and PDP must be present
    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(links.some(l => l.inferredType === 'plp')).toBe(true);
    expect(links.some(l => l.inferredType === 'pdp')).toBe(true);
  });
  it('includes high-score links even when they appear after maxLinks in DOM order (mega-menu trap)', async () => {
    // 200 low-score "other" links from a mega-menu come first in DOM order,
    // followed by one PLP link in the main content. With maxLinks=200 (default),
    // the old approach would exhaust the quota in the mega-menu and never see the PLP.
    const megaMenuLinks = Array.from({ length: 200 }, (_, i) => ({
      href: `https://example.com/page-${i}`,
      text: `Page ${i}`,
    }));
    const plpLink = { href: 'https://example.com/category/shoes', text: 'Shoes' };
    const allLinks = [...megaMenuLinks, plpLink]; // PLP is at DOM position 201

    const evaluate = jest.fn().mockResolvedValue({ result: { value: allLinks } });
    const c = { Runtime: { evaluate } };

    const promise = crawlSiteLinks(c as any, BASE_URL); // maxLinks defaults to 200
    await jest.runAllTimersAsync();
    const links = await promise;

    // The PLP must appear in the result even though it was beyond the 200-link DOM cap
    expect(links.some(l => l.inferredType === 'plp')).toBe(true);
    // And it must be first (highest score)
    expect(links[0].inferredType).toBe('plp');
    // Total result must not exceed maxLinks
    expect(links.length).toBeLessThanOrEqual(200);
  });
});

// Helper to satisfy TypeScript for inline client objects in tests 5 & 6
function client(obj: object) { return obj; }
