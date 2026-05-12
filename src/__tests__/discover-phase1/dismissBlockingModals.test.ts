import { dismissBlockingModals } from '../../commands/discover-phase1/modals';

/** Build a mock CDP client from an ordered list of evaluate return values. */
function makeMockClient(...responses: unknown[]) {
  const evaluate = jest.fn();
  responses.forEach(r => evaluate.mockResolvedValueOnce(r));
  return { Runtime: { evaluate } };
}

const probe = (
  found: boolean,
  selector?: string,
  method?: string,
  matchText?: string | null,
  matchTextFlags?: string,
) => ({
  result: {
    value: found
      ? { found, selector, method, matchText: matchText ?? null, matchTextFlags: matchTextFlags ?? '' }
      : { found: false },
  },
});

const click = () => ({ result: { value: true } });

describe('dismissBlockingModals', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('dismisses a Cookiebot banner', async () => {
    const client = makeMockClient(
      probe(true, '#CybotCookiebotDialogBodyButtonAccept', 'cookiebot'),
      click(),
      probe(false),
    );

    const promise = dismissBlockingModals(client as any, 'example.com');
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result.dismissed).toBe(true);
    expect(result.count).toBe(1);
    expect(result.methods).toEqual(['cookiebot']);
  });

  it('dismisses an OneTrust banner', async () => {
    const client = makeMockClient(
      probe(true, '#onetrust-accept-btn-handler', 'onetrust'),
      click(),
      probe(false),
    );

    const promise = dismissBlockingModals(client as any, 'shop.example.com');
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result.dismissed).toBe(true);
    expect(result.count).toBe(1);
    expect(result.methods).toEqual(['onetrust']);
  });

  it('returns dismissed=false when no modal is present', async () => {
    const client = makeMockClient(probe(false));

    const result = await dismissBlockingModals(client as any, 'example.com');

    expect(result.dismissed).toBe(false);
    expect(result.count).toBe(0);
    expect(result.methods).toEqual([]);
    // One probe only — no hostname CDP call, no click
    expect(client.Runtime.evaluate).toHaveBeenCalledTimes(1);
  });

  it('dynamically detects a routing modal by hostname, then clears a stacked GDPR banner', async () => {
    // Simulates fritz-berger.de: routing modal appears first, consent banner second
    const client = makeMockClient(
      // iteration 1: dynamic routing modal detected
      probe(true, 'button,[role="button"]', 'dynamic-routing', 'fritz\\-berger\\.de', 'i'),
      click(),
      // iteration 2: GDPR banner now visible
      probe(true, '#CybotCookiebotDialogBodyButtonAccept', 'cookiebot'),
      click(),
      // iteration 3: nothing left
      probe(false),
    );

    const promise = dismissBlockingModals(client as any, 'www.fritz-berger.de');
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result.dismissed).toBe(true);
    expect(result.count).toBe(2);
    expect(result.methods).toEqual(['dynamic-routing', 'cookiebot']);
  });

  it('skips dynamic routing check when no targetHostname is provided', async () => {
    const client = makeMockClient(probe(false));

    const result = await dismissBlockingModals(client as any);

    expect(result.dismissed).toBe(false);
    // Verify the probe expression did not inject any dynamic routing logic
    const probeExpression: string = client.Runtime.evaluate.mock.calls[0][0].expression;
    expect(probeExpression).not.toContain('dynamic-routing');
  });
});
