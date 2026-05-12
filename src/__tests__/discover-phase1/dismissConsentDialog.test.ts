import { dismissConsentDialog } from '../../commands/discover-phase1/consent';

function makeMockClient(probeValue: unknown, clickValue: unknown = { result: { value: true } }) {
  const evaluate = jest.fn()
    .mockResolvedValueOnce({ result: { value: probeValue } })   // probe call
    .mockResolvedValueOnce({ result: { value: clickValue } });  // click call
  return { Runtime: { evaluate } };
}

describe('dismissConsentDialog', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('dismisses a Cookiebot banner', async () => {
    const client = makeMockClient({
      found: true,
      selector: '#CybotCookiebotDialogBodyButtonAccept',
      method: 'cookiebot',
    });

    const promise = dismissConsentDialog(client as any);
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result.dismissed).toBe(true);
    expect(result.method).toBe('cookiebot');
    expect(result.selector).toBe('#CybotCookiebotDialogBodyButtonAccept');
    expect(client.Runtime.evaluate).toHaveBeenCalledTimes(2);
  });

  it('dismisses an OneTrust banner', async () => {
    const client = makeMockClient({
      found: true,
      selector: '#onetrust-accept-btn-handler',
      method: 'onetrust',
    });

    const promise = dismissConsentDialog(client as any);
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result.dismissed).toBe(true);
    expect(result.method).toBe('onetrust');
    expect(result.selector).toBe('#onetrust-accept-btn-handler');
  });

  it('returns dismissed=false when no consent banner is present', async () => {
    const evaluate = jest.fn().mockResolvedValueOnce({
      result: { value: { found: false, selector: null, method: null } },
    });
    const client = { Runtime: { evaluate } };

    const result = await dismissConsentDialog(client as any);

    expect(result.dismissed).toBe(false);
    expect(result.method).toBeNull();
    expect(result.selector).toBeNull();
    // Only one evaluate call — no click needed
    expect(evaluate).toHaveBeenCalledTimes(1);
  });
});
