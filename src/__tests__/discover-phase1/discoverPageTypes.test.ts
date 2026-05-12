import { selectPageTypes, MIN_CONFIDENCE_THRESHOLD } from '../../commands/discover-phase1/page-types';
import type { SiteLink } from '../../commands/discover-phase1/crawl';

const BASE_URL = 'https://example.com';

function link(
  href: string,
  inferredType: SiteLink['inferredType'],
  score: number,
): SiteLink {
  return { href, text: '', score, inferredType };
}

describe('selectPageTypes', () => {
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it('classifies links and returns one named entry per page type', () => {
    const links: SiteLink[] = [
      link('https://example.com/', 'home', 0.1),
      link('https://example.com/category/shoes', 'plp', 0.8),
      link('https://example.com/product/trail-boot', 'pdp', 0.6),
    ];

    const types = selectPageTypes(links, BASE_URL);

    const names = types.map(t => t.name);
    expect(names).toContain('Homepage');
    expect(names).toContain('PLP');
    expect(names).toContain('PDP');

    expect(types.find(t => t.name === 'PLP')!.urlPattern)
      .toBe('https://example.com/category/shoes');
    expect(types.find(t => t.name === 'PDP')!.urlPattern)
      .toBe('https://example.com/product/trail-boot');
  });

  it('deduplicates — returns at most one entry per type', () => {
    const links: SiteLink[] = [
      link('https://example.com/category/boots',   'plp', 0.8),
      link('https://example.com/category/jackets', 'plp', 0.8),
      link('https://example.com/category/tents',   'plp', 0.8),
      link('https://example.com/product/boot-a',   'pdp', 0.6),
      link('https://example.com/product/jacket-b', 'pdp', 0.6),
    ];

    const types = selectPageTypes(links, BASE_URL);

    expect(types.filter(t => t.name === 'PLP')).toHaveLength(1);
    expect(types.filter(t => t.name === 'PDP')).toHaveLength(1);
  });

  it('sorts by score DESC internally — correct output regardless of input order', () => {
    // PDP arrives before PLP in the array, but PLP has a higher score
    const links: SiteLink[] = [
      link('https://example.com/product/boot',    'pdp', 0.6),
      link('https://example.com/category/shoes',  'plp', 0.8),
    ];

    const types = selectPageTypes(links, BASE_URL);

    // PLP should still be identified correctly even though PDP came first
    expect(types.find(t => t.name === 'PLP')!.urlPattern)
      .toBe('https://example.com/category/shoes');
    expect(types.find(t => t.name === 'PDP')!.urlPattern)
      .toBe('https://example.com/product/boot');
  });

  it(`rejects links below MIN_CONFIDENCE_THRESHOLD (${MIN_CONFIDENCE_THRESHOLD})`, () => {
    const links: SiteLink[] = [
      link('https://example.com/product/boot', 'pdp', 0.6),          // above threshold ✓
      link('https://example.com/category/maybe', 'plp', 0.3),        // below threshold ✗
    ];

    const types = selectPageTypes(links, BASE_URL);

    expect(types.find(t => t.name === 'PDP')).toBeDefined();          // accepted
    expect(types.find(t => t.name === 'PLP')).toBeUndefined();        // rejected
  });

  it('warns when no confident PLP can be identified', () => {
    const links: SiteLink[] = [
      link('https://example.com/product/boot', 'pdp', 0.6),
      // no PLP
    ];

    selectPageTypes(links, BASE_URL);

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('PLP'),
    );
  });

  it('warns when no confident PDP can be identified', () => {
    const links: SiteLink[] = [
      link('https://example.com/category/shoes', 'plp', 0.8),
      // no PDP
    ];

    selectPageTypes(links, BASE_URL);

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('PDP'),
    );
  });
});
