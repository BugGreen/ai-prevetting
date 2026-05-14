import { detectServiceWorkers } from '../../commands/discover-phase1/service-workers';

function mockClient(evalResult: any) {
  return {
    Runtime: {
      evaluate: jest.fn().mockResolvedValue({
        result: { type: 'string', value: JSON.stringify(evalResult) },
      }),
    },
  };
}

describe('detectServiceWorkers', () => {
  it('detects and classifies service worker registrations', async () => {
    const client = mockClient([
      'https://example.com/speed-kit/sw.js',
      'https://example.com/workbox-sw.js',
      'https://example.com/custom-worker.js',
    ]);

    const result = await detectServiceWorkers(client);

    expect(result.hasServiceWorker).toBe(true);
    expect(result.registrations).toEqual([
      { scriptURL: 'https://example.com/speed-kit/sw.js', type: 'speed-kit' },
      { scriptURL: 'https://example.com/workbox-sw.js', type: 'workbox' },
      { scriptURL: 'https://example.com/custom-worker.js', type: 'custom' },
    ]);
  });

  it('returns empty when no service workers registered', async () => {
    const client = mockClient([]);

    const result = await detectServiceWorkers(client);

    expect(result.hasServiceWorker).toBe(false);
    expect(result.registrations).toEqual([]);
  });
});
