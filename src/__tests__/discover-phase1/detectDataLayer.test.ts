import { detectDataLayer } from '../../commands/discover-phase1/data-layer';

function mockClient(evalResult: any) {
  return {
    Runtime: {
      evaluate: jest.fn().mockResolvedValue({
        result: { type: 'string', value: JSON.stringify(evalResult) },
      }),
    },
  };
}

describe('detectDataLayer', () => {
  it('detects dataLayer with interesting keys', async () => {
    const client = mockClient({
      entryCount: 5,
      keys: ['event', 'gtm.start', 'user.loginStatus', 'experiment.variant', 'currency'],
    });

    const result = await detectDataLayer(client);

    expect(result.hasDataLayer).toBe(true);
    expect(result.entryCount).toBe(5);
    expect(result.interestingKeys).toContain('user.loginStatus');
    expect(result.interestingKeys).toContain('experiment.variant');
    expect(result.interestingKeys).toContain('currency');
  });

  it('returns empty when no dataLayer exists', async () => {
    const client = mockClient(null);

    const result = await detectDataLayer(client);

    expect(result.hasDataLayer).toBe(false);
    expect(result.entryCount).toBe(0);
    expect(result.interestingKeys).toEqual([]);
  });
});
