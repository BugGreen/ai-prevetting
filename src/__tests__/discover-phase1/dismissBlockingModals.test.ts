import { dismissBlockingModals } from '../../commands/discover-phase1/modals';

/** Build a mock CDP client from an ordered list of evaluate return values. */
function makeMockClient(...responses: unknown[]) {
  const evaluate = jest.fn();
  responses.forEach(r => evaluate.mockResolvedValueOnce(r));
  return { Runtime: { evaluate } };
}

const hostname = (h: string) => ({ result: { value: h } });
const probe = (found: boolean, selector?: string, method?: string, matchText?: string | null, matchTextFlags?: string) =>
  ({ result: { value: found ? { found, selector, method, matchText: matchText ?? null, matchTextFlags: matchTextFlags ?? '' } : { found: false } } });
const click = () => ({ result: { value: true } });

describe('dismissBlockingModals', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('dismisses a Cookiebot banner', async () => {
    const client = makeMockClient(
      hostname('example.com'),
      probe(true, '#CybotCookiebotDialogBodyButtonAccept', 'cookiebot'),
      click(),
      probe(false),
    );

    const promise = dismissBlockingModals(client as any);
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result.dismissed).toBe(true);
    expect(result.count).toBe(1);
    expect(result.methods).toEqual(['cookiebot']);
  });

  it('dismisses an OneTrust banner', async () => {
    const client = makeMockClient(
      hostname('shop.example.com'),
      probe(true, '#onetrust-accept-btn-handler', 'onetrust'),
      click(),
      probe(false),
    );

    const promise = dismissBlockingModals(client as any);
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result.dismissed).toBe(true);
    expect(result.count).toBe(1);
    expect(result.methods).toEqual(['onetrust']);
  });

  it('returns dismissed=false when no modal is present', async () => {
    const client = makeMockClient(
      hostname('example.com'),
      probe(false),
    );

    const result = await dismissBlockingModals(client as any);

    expect(result.dismissed).toBe(false);
    expect(result.count).toBe(0);
    expect(result.methods).toEqual([]);
    // hostname + one probe only — no click
    expect(client.Runtime.evaluate).toHaveBeenCalledTimes(2);
  });

  it('handles stacked routing + consent modals on fritz-berger.de', async () => {
    const client = makeMockClient(
      hostname('www.fritz-berger.de'),
      // iteration 1: routing modal found first
      probe(true, 'button', 'fritz-berger-routing', 'stay on www\\.fritz-berger\\.de', 'i'),
      click(),
      // iteration 2: GDPR banner now visible
      probe(true, '#CybotCookiebotDialogBodyButtonAccept', 'cookiebot'),
      click(),
      // iteration 3: nothing left
      probe(false),
    );

    const promise = dismissBlockingModals(client as any);
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result.dismissed).toBe(true);
    expect(result.count).toBe(2);
    expect(result.methods).toEqual(['fritz-berger-routing', 'cookiebot']);
  });

  it('skips fritz-berger routing entry on unrelated domains', async () => {
    // On a non-fritz-berger domain, the routing entry must not be in the
    // probe expression. Simulate: hostname is 'other-shop.de', no modals found.
    const client = makeMockClient(
      hostname('www.other-shop.de'),
      probe(false),
    );

    const result = await dismissBlockingModals(client as any);

    expect(result.dismissed).toBe(false);
    expect(result.count).toBe(0);

    // Verify the routing entry was not included in the probe expression
    const probeCall = client.Runtime.evaluate.mock.calls[1][0];
    expect(probeCall.expression).not.toContain('fritz-berger-routing');
  });
});
