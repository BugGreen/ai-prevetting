import { fetchCruxData } from '../../commands/discover-phase1/crux';

// Mock global fetch
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

describe('fetchCruxData', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns CrUX metrics for both mobile and desktop', async () => {
    const mockResponse = {
      loadingExperience: {
        metrics: {
          LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2500, category: 'NEEDS_IMPROVEMENT' },
          CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 10, category: 'GOOD' },
          INTERACTION_TO_NEXT_PAINT: { percentile: 200, category: 'GOOD' },
          EXPERIMENTAL_TIME_TO_FIRST_BYTE: { percentile: 800, category: 'GOOD' },
        },
      },
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await fetchCruxData('https://example.com', 'test-api-key');

    expect(result).not.toBeNull();
    expect(result!.mobile).toBeDefined();
    expect(result!.mobile!['LCP']).toContain('2500');
    expect(result!.desktop).toBeDefined();
    expect(mockFetch).toHaveBeenCalledTimes(2); // mobile + desktop
  });

  it('returns null when no API key is provided', async () => {
    const result = await fetchCruxData('https://example.com');

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
