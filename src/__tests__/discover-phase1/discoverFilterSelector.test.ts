import { discoverFilterSelector } from '../../commands/discover-phase1/filter-selector';

function mockClient(evalResult: string | null) {
  return {
    Page: {
      navigate: jest.fn().mockResolvedValue({}),
      loadEventFired: jest.fn().mockResolvedValue({}),
    },
    Runtime: {
      evaluate: jest.fn().mockResolvedValue({
        result: {
          type: evalResult ? 'string' : 'undefined',
          value: evalResult,
        },
      }),
    },
  };
}

describe('discoverFilterSelector', () => {
  it('finds a filter element on the PLP', async () => {
    const client = mockClient('[data-filter-panel]');

    const result = await discoverFilterSelector(client, 'https://example.com/category/shoes');

    expect(result.found).toBe(true);
    expect(result.selector).toBe('[data-filter-panel]');
    expect(client.Page.navigate).toHaveBeenCalledWith({ url: 'https://example.com/category/shoes' });
  });

  it('returns not found when no filter elements exist', async () => {
    const client = mockClient(null);

    const result = await discoverFilterSelector(client, 'https://example.com/category/shoes');

    expect(result.found).toBe(false);
    expect(result.selector).toBeNull();
  });
});
